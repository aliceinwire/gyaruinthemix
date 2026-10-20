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
  const redirect = await get('/game-test');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/game-test/');
  const page = await get('/game-test/');
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
    '/game-test/main.js',
    '/game-test/style.css',
    '/game-test/frame.css',
    '/game-test/car-stereo.css',
    '/game-test/src/audio.js',
    '/game-test/src/game-audio-config.js',
    '/game-test/src/car-stereo.js',
    '/game-test/src/stream-audio.js',
    '/game-test/src/journey.js',
    '/game-test/src/frame.js',
    '/game-test/src/pace.js',
    '/game-test/src/street-culture.js',
    '/game-test/src/street-culture-art.js',
    '/game-test/src/encounter-director.js',
    '/game-test/src/run-build.js',
    '/game-test/src/tour-rpg.js',
    '/game-test/src/tour-story.js',
    '/game-test/src/tour-director.js',
    '/game-test/src/tour-settings.js',
    '/game-test/src/performance.js',
    '/game-test/src/road-feedback.js',
    '/game-test/src/road-surface.js',
    '/game-test/src/umbrella-art.js',
    '/game-test/assets/brand/gyaruinthemix-logo.png',
    '/game-test/build-info.json',
  ]) {
    const resource = await get(path);
    assert.equal(resource.status, 200, path);
    assert.equal(resource.headers.get('x-content-type-options'), 'nosniff');
  }
  await checkServedHlsModule(
    await get('/game-test/src/vendor/hls.light.min.mjs'),
  );
  const main = await get('/');
  assert.doesNotMatch(
    main.headers.get('content-security-policy'),
    /soundcloud|media-src|blob:/,
  );
  assert.doesNotMatch(await main.text(), /game-test/);
  assert.doesNotMatch(await (await get('/sitemap.xml')).text(), /game-test/);
  assert.match(
    await (await get('/robots.txt')).text(),
    /Disallow: \/game-test\//,
  );
  assert.equal((await get('/game-test/not-a-real-asset.png')).status, 404);
  console.log(
    'PASS unlisted game route, subpath assets, scoped CSP and existing home isolation',
  );
}
