import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../src/pages/robots.txt.js';
import { siteOrigin } from '../src/data/urls.mjs';

test('archive crawlers are excluded without blocking ordinary search crawlers', async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'text/plain; charset=utf-8',
  );
  const text = await response.text();
  const groups = text.trim().split(/\n\s*\n/);
  for (const agent of [
    'archive.org_bot',
    'ia_archiver',
    'CCBot',
    'Arquivo-web-crawler',
    'Megalodon',
  ]) {
    const group = groups.find((entry) =>
      entry.split('\n').includes(`User-agent: ${agent}`),
    );
    assert.ok(group, `${agent}: crawler policy exists`);
    assert.match(group, /^Disallow: \/$/m, `${agent}: all paths excluded`);
    assert.doesNotMatch(group, /^Allow:/m, `${agent}: no path exceptions`);
    assert.doesNotMatch(group, /^User-agent: \*$/m);
  }
  assert.equal(
    groups[1],
    'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /game/\nDisallow: /game-test/',
  );
  assert.equal(groups[2], `Sitemap: ${siteOrigin}/sitemap.xml`);
});
