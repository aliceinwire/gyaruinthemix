import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getLocale, localizePath, translator } from '../src/data/i18n.mjs';
import {
  defaultPublicPaths,
  publicPaths,
  canonicalUrl,
} from '../src/data/urls.mjs';
import { GET as sitemap } from '../src/pages/sitemap.xml.js';

test('Japanese stays the default and only the en route segment selects English', () => {
  for (const path of ['/', '/about/', '/english/', '/shop/?locale=en'])
    assert.equal(getLocale(path), 'ja');
  for (const path of ['/en', '/en/', '/en/shop-test/success/'])
    assert.equal(getLocale(path), 'en');
  assert.equal(translator('ja')('日本語', 'English'), '日本語');
  assert.equal(translator('en')('日本語', 'English'), 'English');
});

test('equivalent language links preserve fragments and receipts without localizing assets or external URLs', () => {
  for (const path of [
    ...defaultPublicPaths,
    '/shop/success/',
    '/shop/cancel/',
    '/shop-test/',
    '/shop-test/success/',
    '/shop-test/cancel/',
  ]) {
    assert.equal(localizePath(path, 'en'), `/en${path}`);
    assert.equal(localizePath(`/en${path}`, 'ja'), path);
    assert.equal(localizePath(`/en${path}`, 'en'), `/en${path}`);
  }
  assert.equal(localizePath('/fanclub/#photos', 'en'), '/en/fanclub/#photos');
  assert.equal(
    localizePath('/en/shop-test/success/?session_id=cs_test#receipt', 'ja'),
    '/shop-test/success/?session_id=cs_test#receipt',
  );
  for (const path of [
    '/assets/logo.webp',
    '/api/catalog',
    '/_astro/chunk.js',
    'https://example.com/',
    '//example.com/',
    '#photos',
  ])
    assert.equal(localizePath(path, 'en'), path);
  assert.equal(localizePath('/404.html', 'en'), '/en/404/');
  assert.equal(localizePath('/en/404/', 'ja'), '/404.html');
});

test('every public page has reciprocal ja/en and default sitemap alternates', async () => {
  assert.equal(publicPaths.length, defaultPublicPaths.length * 2);
  const xml = await sitemap().text();
  for (const path of publicPaths) {
    const entry = xml
      .split('<url>')
      .find((item) => item.includes(`<loc>${canonicalUrl(path)}</loc>`));
    assert.ok(entry, path);
    for (const language of ['ja', 'en', 'x-default'])
      assert.ok(
        entry.includes(
          `hreflang="${language}" href="${canonicalUrl(localizePath(path, language))}"`,
        ),
      );
  }
  assert.doesNotMatch(xml, /shop-test|success|cancel|404/);
});

test('English routes reuse templates and nginx serves the English 404 for English paths', async () => {
  for (const path of [
    ...defaultPublicPaths,
    '/shop/success/',
    '/shop/cancel/',
    '/shop-test/',
    '/shop-test/success/',
    '/shop-test/cancel/',
  ]) {
    const file =
      path === '/'
        ? 'index'
        : path.slice(1, -1).replace(/^(shop(?:-test)?)$/, '$1/index');
    const source = await readFile(`src/pages/en/${file}.astro`, 'utf8');
    assert.match(source, /import Page from/);
    assert.match(source, /<Page \/>/);
  }
  const nginx = await readFile('deploy/nginx.conf', 'utf8');
  assert.match(
    nginx,
    /location \/en\/ \{[^}]+error_page 404 \/en\/404\/index.html;/,
  );
  const layout = await readFile('src/layouts/Layout.astro', 'utf8');
  assert.match(layout, /link.search = window.location.search/);
  assert.match(layout, /link.hash = window.location.hash/);
  assert.match(layout, /<html lang=\{locale\}/);
});
