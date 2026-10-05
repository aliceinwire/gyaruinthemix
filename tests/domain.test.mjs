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

test('www redirect ships in both web modes with a fixed destination and safe exceptions', async () => {
  const nginx = await read('deploy/nginx.conf');
  assert.match(nginx, /listen 8080 default_server;/);
  assert.match(nginx, /include \/etc\/nginx\/www-redirect\.conf;/);
  const redirect = await read('deploy/bouncer/nginx-www-redirect.conf');
  assert.match(redirect, /server_name www\.gyaruinthemix\.com;/);
  assert.match(
    redirect,
    /return 308 https:\/\/gyaruinthemix\.com\$request_uri;/,
  );
  assert.doesNotMatch(
    redirect,
    /\$(?:host|http_|scheme)|gyaruinthemix\.alicef\.me/,
  );
  assert.match(redirect, /location = \/web-health \{[^}]*return 200 'ok';/);
  assert.match(
    redirect,
    /location \^~ \/\.well-known\/acme-challenge\/ \{ return 404; \}/,
  );
  const dockerfile = await read('Dockerfile.web');
  assert.match(
    dockerfile,
    /COPY deploy\/bouncer\/nginx-www-redirect\.conf \/etc\/nginx\/www-redirect\.conf/,
  );
  assert.match(
    await read('.dockerignore'),
    /^!deploy\/bouncer\/nginx-www-redirect\.conf$/m,
  );
  const ci = await read('scripts/ci-bouncer.mjs');
  assert.equal(ci.match(/await checkWwwRedirect\(/g).length, 2);
});
