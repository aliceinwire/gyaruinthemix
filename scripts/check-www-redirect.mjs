import assert from 'node:assert/strict';
import { request } from 'node:http';

// Use raw request targets and Host headers: fetch/URL normalization can hide
// path escaping bugs, and redirect following would contact the public site.
export async function checkWwwRedirect(base) {
  const origin = 'https://gyaruinthemix.com';
  const www = 'www.gyaruinthemix.com';
  const probe = (path, host = www, method = 'GET', headers = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        base,
        { path, method, headers: { ...headers, host } },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('error', reject);
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        },
      );
      req.setTimeout(15_000, () => req.destroy(new Error('Probe timed out')));
      req.on('error', reject);
      req.end(method === 'POST' ? '{}' : undefined);
    });

  for (const path of [
    '/',
    '/music/?from=www&tag=a%2Fb&tag=two+words',
    '/%E3%82%AE%E3%83%A3%E3%83%AB/%2F?value=%26%3D',
    '//other.example/path?next=https://other.example/',
    '/shop-test/success/?session_id=cs_test_www_probe',
    '/shop-test/cancel/',
    '/api/health',
    '/api/stripe/webhook',
  ]) {
    const res = await probe(path);
    assert.equal(res.status, 308, path);
    assert.equal(res.headers.location, origin + path, path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
  for (const host of [www, 'WWW.GYARUINTHEMIX.COM', `${www}:443`, `${www}.`]) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const path = '/contact/?source=www';
      const res = await probe(path, host, method);
      assert.equal(res.status, 308, `${method} ${host}`);
      assert.equal(res.headers.location, origin + path);
      if (method === 'HEAD') assert.equal(res.body, '');
    }
  }
  for (const path of ['/api/checkout', '/api/stripe/webhook']) {
    const res = await probe(path, www, 'POST', {
      'content-type': 'application/json',
      origin: `https://${www}`,
    });
    assert.equal(res.status, 308, `POST ${path}`);
    assert.equal(res.headers.location, origin + path);
  }
  for (const host of [www, 'gyaruinthemix.com', '127.0.0.1']) {
    const res = await probe('/web-health?probe=1', host);
    assert.equal(res.status, 200, host);
    assert.equal(res.body, 'ok');
    assert.equal(res.headers.location, undefined);
  }
  const acme = await probe('/.well-known/acme-challenge/missing-token');
  assert.equal(acme.status, 404);
  assert.equal(acme.headers.location, undefined);

  // A suffix/prefix lookalike must not select the exact www server. Preserve
  // the existing default vhost behavior, including local container probes.
  for (const host of [
    'gyaruinthemix.com',
    '127.0.0.1',
    'www.gyaruinthemix.com.evil.test',
    'evil-www.gyaruinthemix.com',
    'unrelated.example',
  ]) {
    const res = await probe('/contact/', host, 'GET', {
      'x-forwarded-host': www,
      forwarded: `host=${www};proto=http`,
    });
    assert.equal(res.status, 200, host);
    assert.equal(res.headers.location, undefined, host);
  }
  const spoofed = await probe('/music/?next=//evil.test', www, 'GET', {
    'x-forwarded-host': 'evil.test',
    'x-forwarded-proto': 'http',
    forwarded: 'host=evil.test;proto=http',
  });
  assert.equal(spoofed.status, 308);
  assert.equal(spoofed.headers.location, `${origin}/music/?next=//evil.test`);
  const malformed = await probe('/', `${www}/evil`);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.location, undefined);
  console.log(
    'PASS www redirect: fixed HTTPS apex, exact host, escaped paths/queries, methods, forwarding-header isolation, health and ACME exceptions',
  );
}
