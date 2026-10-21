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
  assert.equal(
    groups[0],
    'User-agent: archive.org_bot\nUser-agent: ia_archiver\nDisallow: /',
  );
  assert.equal(
    groups[1],
    'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /game-test/',
  );
  assert.equal(groups[2], `Sitemap: ${siteOrigin}/sitemap.xml`);
});
