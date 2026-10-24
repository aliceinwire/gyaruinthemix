import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudioHandler, loadCatalog } from '../server/app.mjs';
const id = 't-' + 'a'.repeat(24),
  other = 't-' + 'b'.repeat(24);
async function setup(t, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ga-server-'));
  for (const track of [id, other]) {
    await mkdir(join(dir, track));
    if (opts.spectrum)
      await writeFile(
        join(dir, track, 'spectrum.bin'),
        Buffer.from('GEQ1test'),
      );
    await writeFile(join(dir, track, 'init.mp4'), Buffer.alloc(20, 1));
    await writeFile(join(dir, track, 'seg-00000.m4s'), Buffer.alloc(100, 2));
  }
  await writeFile(
    join(dir, 'catalog.json'),
    JSON.stringify({
      version: 1,
      tracks: [id, other].map((id) => ({
        id,
        init: 'init.mp4',
        ...(opts.spectrum ? { spectrum: 'spectrum.bin' } : {}),
        title: id === other ? 'Second Song' : '夜のドライブ',
        comment: 'PRIVATE SOURCE COMMENT',
        duration: 4,
        chunks: [{ file: 'seg-00000.m4s', duration: 4 }],
      })),
    }),
  );
  const tracks = await loadCatalog(dir);
  let clock = Date.now();
  let handler;
  const server = createServer(async (req, res) => {
    if (!(await handler(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createAudioHandler({
    tracks,
    key: randomBytes(32),
    origin,
    secureCookies: false,
    enabled: true,
    now: () => clock,
    ...opts,
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const request = (path, init = {}) => fetch(origin + path, init);
  const issue = async (track = id, cookie) => {
    const response = await request('/game-audio/v1/session', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ trackId: track }),
    });
    return {
      response,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  return { request, issue, dir, origin, advance: (s) => (clock += s * 1000) };
}
test('runtime config exposes only an explicit enabled boolean, never keys or paths', async (t) => {
  const f = await setup(t);
  const response = await f.request('/game-audio/v1/config');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true });
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store, max-age=0',
  );
  assert.equal(response.headers.get('set-cookie'), null);
  for (const headers of [
    { Origin: 'https://attacker.invalid' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ])
    assert.equal(
      (await f.request('/game-audio/v1/config', { headers })).status,
      403,
    );
});
test('an explicitly disabled service needs no key and exposes no catalog or sessions', async (t) => {
  const f = await setup(t, { enabled: false, key: null });
  assert.deepEqual(await (await f.request('/game-audio/v1/config')).json(), {
    enabled: false,
  });
  assert.equal((await f.request('/game-audio/v1/health')).status, 200);
  assert.equal((await f.request('/game-audio/v1/catalog')).status, 404);
  const session = await f.issue();
  assert.equal(session.response.status, 404);
  assert.equal(session.cookie, undefined);
  assert.equal(
    (await f.request(`/game-audio/v1/stream/${id}/unavailable/init.mp4`))
      .status,
    404,
  );
});
test('catalog is metadata only and library originals are never routable', async (t) => {
  const f = await setup(t);
  const r = await f.request('/game-audio/v1/catalog'),
    b = await r.json();
  assert.equal(b.tracks.length, 2);
  assert.equal(b.tracks[0].title, '夜のドライブ');
  assert.equal(b.tracks[1].title, 'Second Song');
  assert.equal(b.tracks[0].artist, undefined);
  assert.doesNotMatch(JSON.stringify(b), /SOURCE|chunks|sourceHash|path/);
  for (const path of [
    '/assets/music/track.mp3',
    '/game-audio/assets/music/track.mp3',
    '/game-audio/v1/catalog.json',
    '/game-audio/v1/stream/' + id + '/../catalog.json',
    '/game-audio/v1/stream/%252e%252e/secret',
  ])
    assert.equal((await f.request(path)).status, 404);
});
test('manifest requires cookie AND ticket, segments require matching track session', async (t) => {
  const f = await setup(t),
    s = await f.issue();
  assert.equal(s.response.status, 200);
  assert.match(
    s.response.headers.get('set-cookie'),
    /HttpOnly; SameSite=Strict/,
  );
  const manifest = await f.request(s.body.manifestUrl, {
    headers: { Cookie: s.cookie },
  });
  assert.equal(manifest.status, 200);
  const body = await manifest.text();
  assert.match(body, /#EXT-X-MAP/);
  assert.doesNotMatch(body, /\.mp3|DO NOT/);
  const segment = body.split('\n').find((l) => l.endsWith('.m4s'));
  assert.equal((await f.request(segment)).status, 401);
  assert.equal((await f.request(s.body.manifestUrl)).status, 401);
  assert.equal(
    (
      await f.request(s.body.manifestUrl.split('?')[0], {
        headers: { Cookie: s.cookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request(segment.replace(id, other), {
        headers: { Cookie: s.cookie },
      })
    ).status,
    401,
  );
  const ok = await f.request(segment, { headers: { Cookie: s.cookie } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.arrayBuffer()).byteLength, 100);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store, max-age=0');
});
test('short-lived expiry and renewal preserve active manifest segment identities', async (t) => {
  const f = await setup(t),
    s = await f.issue();
  f.advance(50);
  const renewal = await f.issue(id, s.cookie);
  assert.equal(renewal.body.sessionId, s.body.sessionId);
  f.advance(75);
  assert.equal(
    (await f.request(s.body.manifestUrl, { headers: { Cookie: s.cookie } }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.request(renewal.body.manifestUrl, {
        headers: { Cookie: renewal.cookie },
      })
    ).status,
    200,
  );
  f.advance(121);
  const fresh = await f.issue(id, renewal.cookie);
  assert.notEqual(fresh.body.sessionId, renewal.body.sessionId);
});
test('cross-site minting, tampering and unscoped cookies fail closed', async (t) => {
  const f = await setup(t),
    s = await f.issue();
  for (const headers of [
    { 'Content-Type': 'application/json' },
    { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
    {
      Origin: f.origin,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'cross-site',
    },
  ])
    assert.equal(
      (
        await f.request('/game-audio/v1/session', {
          method: 'POST',
          headers,
          body: JSON.stringify({ trackId: id }),
        })
      ).status,
      403,
    );
  const bad = s.cookie.slice(0, -5) + 'abcde';
  assert.equal(
    (await f.request(s.body.manifestUrl, { headers: { Cookie: bad } })).status,
    401,
  );
  assert.equal(
    (
      await f.request(s.body.manifestUrl, {
        headers: { Cookie: s.cookie + '; ' + s.cookie },
      })
    ).status,
    401,
  );
});
test('HEAD and safe single ranges work without bypassing access control', async (t) => {
  const f = await setup(t),
    s = await f.issue(),
    path = `/game-audio/v1/stream/${id}/${s.body.sessionId}/seg-00000.m4s`;
  const range = await f.request(path, {
    headers: { Cookie: s.cookie, Range: 'bytes=10-19' },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  assert.equal(range.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal(
    (
      await f.request(path, {
        headers: { Cookie: s.cookie, Range: 'bytes=999-' },
      })
    ).status,
    416,
  );
  assert.equal(
    (
      await f.request(path, { method: 'HEAD', headers: { Cookie: s.cookie } })
    ).headers.get('content-length'),
    '100',
  );
  assert.equal((await f.request(path, { method: 'HEAD' })).status, 401);
});
test('rate limits fail closed without issuing another cookie', async (t) => {
  const f = await setup(t, { maxSessionsPerMinute: 1 });
  await f.issue();
  const second = await f.issue();
  assert.equal(second.response.status, 429);
  assert.equal(second.cookie, undefined);
});
test('symlink packages and runtime replacement cannot expose outside files', async (t) => {
  const f = await setup(t),
    s = await f.issue();
  const file = join(f.dir, id, 'seg-00000.m4s');
  await rm(file);
  await symlink('/etc/passwd', file);
  assert.equal(
    (
      await f.request(
        `/game-audio/v1/stream/${id}/${s.body.sessionId}/seg-00000.m4s`,
        { headers: { Cookie: s.cookie } },
      )
    ).status,
    404,
  );
  await assert.rejects(loadCatalog(f.dir), /Unsafe media/);
});

test('catalog entries without a metadata title are not served', async (t) => {
  const f = await setup(t);
  const path = join(f.dir, 'catalog.json');
  const catalog = JSON.parse(await readFile(path, 'utf8'));
  for (const value of [undefined, '', ' \u0000 ']) {
    catalog.tracks[0].title = value;
    await writeFile(path, JSON.stringify(catalog));
    const tracks = await loadCatalog(f.dir);
    assert.equal(tracks.has(id), false);
    assert.equal(tracks.get(other).title, 'Second Song');
  }
});

test('spectrum envelopes require the matching playback session and stay out of the catalog', async (t) => {
  const f = await setup(t, { spectrum: true });
  const session = await f.issue();
  const url = session.body.spectrumUrl;
  assert.ok(url.endsWith('/spectrum.bin'));
  assert.equal((await f.request(url)).status, 401);
  const response = await f.request(url, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'application/octet-stream',
  );
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(await response.text(), 'GEQ1test');
  const wrong = await f.issue(other);
  assert.equal(
    (await f.request(url, { headers: { Cookie: wrong.cookie } })).status,
    401,
  );
  f.advance(121);
  assert.equal(
    (await f.request(url, { headers: { Cookie: session.cookie } })).status,
    401,
  );
  assert.doesNotMatch(
    await (await f.request('/game-audio/v1/catalog')).text(),
    /spectrum|GEQ1/,
  );
});
