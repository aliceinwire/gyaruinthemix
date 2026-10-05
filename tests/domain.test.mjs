import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonicalUrl, publicPaths, siteOrigin } from '../src/data/urls.mjs';
import { GET as sitemap } from '../src/pages/sitemap.xml.js';
import { GET as robots } from '../src/pages/robots.txt.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public canonical metadata has one production origin', () => {
  assert.equal(siteOrigin, 'https://gyaruinthemix.com');
  assert.equal(canonicalUrl('/'), 'https://gyaruinthemix.com/');
  assert.equal(canonicalUrl('/music/'), 'https://gyaruinthemix.com/music/');
  assert.equal(new Set(publicPaths).size, publicPaths.length);
  assert.ok(
    publicPaths.every((path) => path.startsWith('/') && path.endsWith('/')),
  );
});

test('sitemap contains public pages only and robots allows noindex discovery', async () => {
  const response = sitemap();
  assert.equal(
    response.headers.get('content-type'),
    'application/xml; charset=utf-8',
  );
  const xml = await response.text();
  assert.deepEqual(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    publicPaths.map(canonicalUrl),
  );
  assert.doesNotMatch(xml, /shop-test|success|cancel|404|alicef\.me|localhost/);
  const text = await robots().text();
  assert.match(text, /Disallow: \/api\//);
  assert.ok(text.includes(`Sitemap: ${siteOrigin}/sitemap.xml`));
  assert.doesNotMatch(text, /Disallow: \/shop/);
});

test('deployment defaults use the new domain without changing local or sales defaults', async () => {
  const sample = await read('deploy/bouncer/.env.example');
  assert.match(sample, /^STORE_DOMAIN=gyaruinthemix\.com$/m);
  assert.match(sample, /^STORE_HOSTS=$/m);
  assert.match(sample, /^STRIPE_MODE=test$/m);
  assert.match(sample, /^SALES_ENABLED=false$/m);
  assert.match(sample, /^TEST_SHOP_ENABLED=false$/m);
  assert.match(
    await read('.env.example'),
    /^SITE_URL=http:\/\/localhost:4321$/m,
  );
  const compose = await read('deploy/bouncer/docker-compose.yml');
  assert.match(
    compose,
    /SITE_URL: https:\/\/\$\{STORE_DOMAIN:\?Set STORE_DOMAIN in bouncer\/\.env\}/,
  );
  assert.match(compose, /VIRTUAL_HOST: \$\{STORE_HOSTS:-\$\{STORE_DOMAIN:/);
  assert.match(compose, /LETSENCRYPT_HOST: \$\{STORE_HOSTS:-\$\{STORE_DOMAIN:/);
});
