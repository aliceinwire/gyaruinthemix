import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  AUDIO_FIXTURE_KEY,
  AUDIO_FIXTURE_TITLE,
  createGameAudioFixtures,
} from '../scripts/ci-game-audio-fixtures.mjs';
import { createAudioHandler, loadCatalog } from '../game-audio/server/app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function runHttpPhase(base, enabled) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [join(root, 'scripts/ci-bouncer-http.mjs'), base],
      {
        env: { ...process.env, GAME_AUDIO_ENABLED: String(enabled) },
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ pid: child.pid, stdout });
      },
    );
  });
}

test('each HTTP phase has a fresh process across restart, audio stop and recovery', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bouncer-http-phases-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkoutRoot = join(directory, 'checkout');
  await mkdir(join(checkoutRoot, 'assets'), { recursive: true });
  const fixture = await createGameAudioFixtures({
    checkoutRoot,
    secretFile: join(directory, 'fixture-key'),
  });
  t.after(fixture.cleanup);
  // HTTP lifecycle isolation is independent of encoding. Use inert synthetic
  // bytes here; the actual FFmpeg output is tested inside the release image.
  const id = 't-' + 'a'.repeat(24);
  const output = join(fixture.library, '.hls');
  await mkdir(join(output, id), { recursive: true });
  await writeFile(
    join(output, id, 'spectrum.bin'),
    Buffer.from([71, 69, 81, 49, 1, 0, 0, 0, 100, 0, 0, 0, 0]),
  );
  await writeFile(join(output, id, 'init.mp4'), Buffer.alloc(20, 1));
  await writeFile(join(output, id, 'seg-00000.m4s'), Buffer.alloc(100, 2));
  await writeFile(
    join(output, 'catalog.json'),
    JSON.stringify({
      version: 1,
      tracks: [
        {
          id,
          title: AUDIO_FIXTURE_TITLE,
          init: 'init.mp4',
          spectrum: 'spectrum.bin',
          duration: 4,
          chunks: [{ file: 'seg-00000.m4s', duration: 4 }],
        },
      ],
    }),
  );
  const tracks = await loadCatalog(output);
  const moduleSource = await readFile(
    join(root, 'public/game-test/src/vendor/hls.light.min.mjs'),
    'utf8',
  );
  const csp = (
    await readFile(join(root, 'deploy/game-security-headers.conf'), 'utf8')
  ).match(/Content-Security-Policy "([^"]+)"/)[1];
  let port = 0;
  const pids = new Set();
  for (const [phase, enabled] of [
    ['startup', true],
    ['restart', true],
    ['audio-stopped', false],
    ['audio-recovered', true],
  ]) {
    const handler = createAudioHandler({
      enabled,
      tracks,
      key: Buffer.from(AUDIO_FIXTURE_KEY),
      origin: 'https://gyaruinthemix.example',
    });
    let configs = 0;
    let sessions = 0;
    const server = createServer(async (request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const path = request.url;
      const host = request.headers.host || '';
      if (host.includes('/')) {
        response.writeHead(400).end();
      } else if (path.startsWith('/web-health')) {
        response.end('ok');
      } else if (path.startsWith('/.well-known/')) {
        response.writeHead(404).end();
      } else if (/^www\.gyaruinthemix\.com(?::443|\.)?$/i.test(host)) {
        request.resume();
        response
          .writeHead(308, { Location: `https://gyaruinthemix.com${path}` })
          .end();
      } else if (path.startsWith('/game-audio/')) {
        if (path === '/game-audio/v1/config') configs++;
        if (path === '/game-audio/v1/session') sessions++;
        await handler(request, response);
      } else if (path.includes('/assets/music/')) {
        response.writeHead(path.includes('/.hls/') ? 403 : 404).end();
      } else if (path === '/game-test') {
        response.writeHead(308, { Location: '/game-test/' }).end();
      } else if (path === '/game-test/') {
        response.setHeader('Content-Security-Policy', csp);
        response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        response.end(
          '<meta name="robots" content="noindex, nofollow, noarchive">',
        );
      } else if (path.endsWith('/hls.light.min.mjs')) {
        response.setHeader('Content-Type', 'application/javascript');
        response.end(moduleSource);
      } else if (path === '/game-test/not-a-real-asset.png') {
        response.writeHead(404).end();
      } else if (path === '/robots.txt') {
        response.end('Disallow: /game-test/');
      } else {
        response.setHeader('Content-Security-Policy', "default-src 'self'");
        response.end('fixture');
      }
    });
    // Rebind the same endpoint after forcibly closing every previous server
    // connection. The next phase must not inherit any earlier HTTP client pool.
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    port = server.address().port;
    try {
      const result = await runHttpPhase(`http://127.0.0.1:${port}`, enabled);
      assert.ok(!pids.has(result.pid), `${phase} must use a fresh process`);
      pids.add(result.pid);
      assert.equal(configs, 1, `${phase}: no automatic retry`);
      assert.equal(sessions, enabled ? 2 : 0);
      assert.match(result.stdout, /PASS (?:synthetic|default-off) audio/);
      assert.match(result.stdout, /PASS www redirect/);
      assert.match(result.stdout, /PASS unlisted game route/);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  assert.equal(pids.size, 4);
});

test('fresh HTTP worker propagates a failed assertion without retrying', async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(500).end('failed fixture');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      runHttpPhase(`http://127.0.0.1:${server.address().port}`, false),
      /game-audio\/v1\/config status/,
    );
    assert.equal(requests, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('lifecycle orchestrator keeps route checks out of its own HTTP pool', async () => {
  const source = await readFile(join(root, 'scripts/ci-bouncer.mjs'), 'utf8');
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(|\bcheckGameAudioRuntime\(|\bcheckWwwRedirect\(|\bcheckGameTest\(/,
  );
  assert.match(source, /scripts\/ci-bouncer-http\.mjs/);
  assert.equal((source.match(/routeSmoke\(\);/g) || []).length, 3);
  assert.equal((source.match(/routeSmoke\(false\);/g) || []).length, 1);
  assert.equal((source.match(/audioIsolation\(\);/g) || []).length, 3);
});
