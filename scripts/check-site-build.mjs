import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getLocale, localizePath } from '../src/data/i18n.mjs';
import { canonicalUrl, publicPaths, siteOrigin } from '../src/data/urls.mjs';

const read = (path) =>
  readFile(new URL(`../dist/${path}`, import.meta.url), 'utf8');
for (const path of publicPaths) {
  const html = await read(`${path.slice(1)}index.html`);
  assert.ok(
    html.includes(`rel="canonical" href="${canonicalUrl(path)}"`),
    path,
  );
  assert.ok(
    html.includes(`property="og:url" content="${canonicalUrl(path)}"`),
    path,
  );
  assert.ok(
    html.includes(
      `property="og:image" content="${canonicalUrl('/assets/logo.webp')}"`,
    ),
    path,
  );
  assert.doesNotMatch(html, /name="robots" content="noindex/);
  assert.ok(
    html.includes(`<html lang="${getLocale(path)}"`),
    `${path}: document language`,
  );
  for (const locale of ['ja', 'en', 'x-default']) {
    assert.ok(
      html.includes(
        `rel="alternate" hreflang="${locale}" href="${canonicalUrl(localizePath(path, locale))}"`,
      ),
      `${path}: alternate ${locale}`,
    );
  }
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
    if (
      href.startsWith('/assets/') ||
      href.startsWith('/_astro/') ||
      href === '/favicon.svg'
    )
      continue;
    assert.ok(
      !href.includes('/shop-test/'),
      `${path}: hidden shop must stay undiscoverable`,
    );
    if (getLocale(path) === 'en' && !href.startsWith('/en/')) {
      assert.equal(
        href,
        localizePath(path, 'ja'),
        `${path}: untranslated internal link ${href}`,
      );
    }
  }
}
for (const path of [
  'shop/success/index.html',
  'shop/cancel/index.html',
  'shop-test/index.html',
  'shop-test/success/index.html',
  'shop-test/cancel/index.html',
  '404.html',
  'en/shop/success/index.html',
  'en/shop/cancel/index.html',
  'en/shop-test/index.html',
  'en/shop-test/success/index.html',
  'en/shop-test/cancel/index.html',
  'en/404/index.html',
]) {
  const html = await read(path);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.doesNotMatch(html, /rel="canonical"|property="og:url"/);
  assert.ok(html.includes(`<html lang="${getLocale('/' + path)}"`));
}
const sitemap = await read('sitemap.xml');
assert.deepEqual(
  [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
  publicPaths.map(canonicalUrl),
);
assert.doesNotMatch(
  sitemap,
  /shop-test|success|cancel|404|alicef\.me|localhost/,
);
assert.match(
  await read('robots.txt'),
  new RegExp(`Sitemap: ${siteOrigin.replaceAll('.', '\\.')}\/sitemap\\.xml`),
);
assert.ok(
  (await readFile(new URL('../dist/assets/logo.webp', import.meta.url)))
    .length > 0,
);
console.log(
  `PASS canonical URLs, Open Graph, sitemap, robots and ${publicPaths.length} public pages; sandbox/returns remain noindex`,
);
