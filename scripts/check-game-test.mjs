import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export async function checkServedHlsModule(response) {
  assert.equal(response.status, 200, 'HLS module must be served');
  assert.match(
    response.headers.get('content-type') || '',
    /^(?:application|text)\/javascript(?:\s*;|$)/i,
    'HLS module needs a JavaScript MIME type under nosniff',
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const source = await response.text();
  assert.doesNotMatch(source, /<(?:!doctype|html|head|body)\b/i);
  assert.match(source, /export\s*\{[^}]*\bas default\b/);
  // Parse only; never execute the received module or load media in this check.
  execFileSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
}

export async function checkGameTest(origin) {
  const get = (path) =>
    fetch(new URL(path, origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  for (const [from, to] of [
    ['/game', '/game/'],
    ['/game?lang=en', '/game/?lang=en'],
    ['/game-test', '/game/'],
    ['/game-test?lang=en', '/game/?lang=en'],
    ['/game-test/', '/game/'],
    ['/game-test/?lang=en', '/game/?lang=en'],
    ['/game-test/index.html?lang=it', '/game/index.html?lang=it'],
    [
      '/game-test/src/stream-audio.js?v=1%202',
      '/game/src/stream-audio.js?v=1%202',
    ],
    [
      '/game-test/assets/brand/gyaruinthemix-logo.png',
      '/game/assets/brand/gyaruinthemix-logo.png',
    ],
  ]) {
    const redirect = await get(from);
    assert.equal(redirect.status, 308, from);
    assert.equal(redirect.headers.get('location'), to, from);
    assert.equal((await get(to)).status, 200, to);
  }
  const page = await get('/game/');
  assert.equal(page.status, 200);
  assert.equal(
    page.headers.get('x-robots-tag'),
    'noindex, nofollow, noarchive',
  );
  assert.match(
    page.headers.get('content-security-policy'),
    /script-src 'self';/,
  );
  assert.match(
    page.headers.get('content-security-policy'),
    /frame-src 'none';/,
  );
  assert.match(
    page.headers.get('content-security-policy'),
    /media-src 'self' blob:;/,
  );
  assert.match(
    await page.text(),
    /name="robots" content="noindex, nofollow, noarchive"/,
  );
  for (const path of [
    '/game/main.js',
    '/game/style.css',
    '/game/frame.css',
    '/game/car-stereo.css',
    '/game/src/audio.js',
    '/game/src/game-audio-config.js',
    '/game/src/car-stereo.js',
    '/game/src/stream-audio.js',
    '/game/src/journey.js',
    '/game/src/frame.js',
    '/game/src/pace.js',
    '/game/src/street-culture.js',
    '/game/src/street-culture-art.js',
    '/game/src/encounter-director.js',
    '/game/src/run-build.js',
    '/game/src/tour-rpg.js',
    '/game/src/tour-story.js',
    '/game/src/tour-director.js',
    '/game/src/tour-settings.js',
    '/game/src/performance.js',
    '/game/src/road-feedback.js',
    '/game/src/road-surface.js',
    '/game/src/umbrella-art.js',
    '/game/assets/brand/gyaruinthemix-logo.png',
    '/game/build-info.json',
  ]) {
    const resource = await get(path);
    assert.equal(resource.status, 200, path);
    assert.equal(resource.headers.get('x-content-type-options'), 'nosniff');
  }
  await checkServedHlsModule(await get('/game/src/vendor/hls.light.min.mjs'));
  const main = await get('/');
  assert.doesNotMatch(
    main.headers.get('content-security-policy'),
    /soundcloud|media-src|blob:/,
  );
  assert.doesNotMatch(await main.text(), /\/game(?:\/|["\s<>])/);
  assert.doesNotMatch(
    await (await get('/sitemap.xml')).text(),
    /\/game(?:\/|["\s<>])/,
  );
  assert.match(await (await get('/robots.txt')).text(), /Disallow: \/game\//);
  assert.equal((await get('/game/not-a-real-asset.png')).status, 404);
  console.log(
    'PASS unlisted game route, subpath assets, scoped CSP and existing home isolation',
  );
}
