import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Synthetic credentials are valid only for this offline, disposable CI fixture.
const secretKey = 'rk_test_CIPlaceholderNotARealKey';
const signingSecret = 'whsec_CIPlaceholderNotARealSecret';
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.match(
  process.env.COMPOSE_PROJECT_NAME || '',
  /^gyaruinthemix-ci-\d+-\d+-bouncer$/,
);
assert.equal(process.env.SALES_ENABLED, 'false');
assert.equal(process.env.STRIPE_MODE, 'test');
assert.equal(process.env.CI_LAYOUT, 'bouncer');
const webService = 'gyaruinthemix-web';
const apiService = 'gyaruinthemix-api';
const base = 'http://127.0.0.1:8089';
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });

function noSecrets(text) {
  assert.ok(!text.includes(secretKey), 'Secret key exposed');
  assert.ok(!text.includes(signingSecret), 'Webhook signing secret exposed');
}

async function request(path, status = 200, options = {}) {
  const response = await fetch(base + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    ...options,
  });
  assert.equal(response.status, status, `${path}: HTTP ${response.status}`);
  const text = await response.text();
  noSecrets(text);
  return { response, text };
}

for (const service of [webService, apiService]) {
  const id = docker('compose', 'ps', '-q', service).trim();
  assert.ok(id, `${service} container missing`);
  const [container] = JSON.parse(docker('inspect', id));
  assert.equal(container.State.Health.Status, 'healthy');
  assert.equal(
    container.Config.User,
    service === apiService ? '10001:10001' : '101:101',
  );
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(container.HostConfig.Privileged, false);
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  assert.ok(
    container.HostConfig.SecurityOpt.includes('no-new-privileges:true'),
  );
  assert.ok(container.HostConfig.Memory > 0);
  assert.equal(container.HostConfig.RestartPolicy.Name, 'unless-stopped');
  assert.equal(
    Object.keys(container.NetworkSettings.Networks).length,
    service === webService ? 2 : 1,
  );
  const bindings = container.HostConfig.PortBindings || {};
  if (service === apiService) assert.deepEqual(bindings, {});
  else {
    assert.deepEqual(Object.keys(bindings), ['8080/tcp']);
    assert.equal(bindings['8080/tcp'][0].HostIp, '127.0.0.1');
  }
  assert.ok(
    !container.Mounts.some((mount) =>
      mount.Destination.includes('docker.sock'),
    ),
  );
  console.log(
    `PASS ${service}: health, user, isolation and resource configuration`,
  );
}

const checkedAssets = new Set();
for (const path of [
  '/',
  '/about/',
  '/contact/',
  '/music/',
  '/live/',
  '/news/',
  '/fanclub/',
  '/shop/',
  '/shop/success/',
  '/shop/cancel/',
  '/legal/',
  '/privacy/',
  '/en/',
  '/en/about/',
  '/en/contact/',
  '/en/music/',
  '/en/live/',
  '/en/news/',
  '/en/fanclub/',
  '/en/shop/',
  '/en/shop/success/',
  '/en/shop/cancel/',
  '/en/legal/',
  '/en/privacy/',
]) {
  const { response, text } = await request(path);
  assert.ok(
    text.includes(`<html lang="${path.startsWith('/en/') ? 'en' : 'ja'}"`),
    `${path}: expected document language`,
  );
  for (const header of [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ])
    assert.ok(response.headers.has(header), `${path}: missing ${header}`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  // Inline executable code would be blocked by the production CSP.
  assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i);
  assert.doesNotMatch(text, /<style\b|\sstyle=|\son(?:click|load|error)=/i);
  for (const match of text.matchAll(
    /(?:src|href)="(\/(?:assets|_astro)\/[^" ]+)"/g,
  )) {
    if (checkedAssets.has(match[1])) continue;
    checkedAssets.add(match[1]);
    const asset = await request(match[1]);
    assert.ok(
      !asset.response.headers.get('content-type')?.includes('text/html'),
    );
  }
  console.log(`PASS ${path}: static page, security headers and assets`);
}
await request('/favicon.svg');
await request('/leopard.svg');
await request('/page-that-does-not-exist/', 404);
assert.match(
  (await request('/en/page-that-does-not-exist/', 404)).text,
  /<html lang="en"/,
);
await request('/.env', 403);
assert.equal(JSON.parse((await request('/api/health')).text).status, 'ok');
const catalog = JSON.parse((await request('/api/catalog')).text);
assert.equal(catalog.mode, 'test');
assert.equal(catalog.salesEnabled, false);
// www routing/redirects never grant an additional browser checkout origin.
await request('/api/checkout', 403, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'https://www.gyaruinthemix.com',
    'idempotency-key': randomUUID(),
  },
  body: JSON.stringify({
    items: [{ product: 'sticker', quantity: 1 }],
    catalogVersion: 'a'.repeat(64),
  }),
});
await request('/api/checkout', 503, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: process.env.SITE_URL,
    'idempotency-key': randomUUID(),
  },
  body: JSON.stringify({
    items: [{ product: 'sticker', quantity: 1 }],
    catalogVersion: 'a'.repeat(64),
  }),
});
await request('/api/stripe/webhook', 400, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'stripe-signature': 'invalid',
  },
  body: '{}',
});

// The same event/session is deliberately reused after the container restart.
const payload = JSON.stringify({
  id: 'evt_ci_restart',
  object: 'event',
  livemode: false,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_ci_restart',
      object: 'checkout.session',
      payment_status: 'paid',
      metadata: { store: 'gyaruinthemix' },
    },
  },
});
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac('sha256', signingSecret)
  .update(`${timestamp}.${payload}`)
  .digest('hex');
for (let attempt = 0; attempt < 2; attempt++) {
  const result = await request('/api/stripe/webhook', 200, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });
  assert.deepEqual(JSON.parse(result.text), { received: true });
}
const logs = docker(
  'compose',
  'logs',
  '--no-color',
  '--no-log-prefix',
  apiService,
);
noSecrets(logs);
const payments = logs.split('\n').filter((line) => {
  try {
    const entry = JSON.parse(line);
    return (
      entry.event === 'payment_received' && entry.eventId === 'evt_ci_restart'
    );
  } catch {
    return false;
  }
});
assert.equal(
  payments.length,
  1,
  'One payment observation, including after restart',
);
console.log(
  'PASS closed checkout, invalid/valid signatures, durable deduplication and safe logs',
);
