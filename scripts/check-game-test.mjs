import assert from 'node:assert/strict';

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
    /script-src 'self' https:\/\/w.soundcloud.com;/,
  );
  assert.match(
    page.headers.get('content-security-policy'),
    /frame-src https:\/\/w.soundcloud.com;/,
  );
  assert.match(
    await page.text(),
    /name="robots" content="noindex, nofollow, noarchive"/,
  );
  for (const path of [
    '/game-test/main.js',
    '/game-test/style.css',
    '/game-test/src/journey.js',
    '/game-test/src/encounter-director.js',
    '/game-test/src/run-build.js',
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
  const main = await get('/');
  assert.doesNotMatch(
    main.headers.get('content-security-policy'),
    /soundcloud/,
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
