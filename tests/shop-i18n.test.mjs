import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { localizeProduct, shopText } from '../src/data/shop-i18n.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('English product presentation cannot change catalog identity, prices or availability', async () => {
  for (const path of ['config/products.json', 'config/test-products.json']) {
    for (const definition of JSON.parse(await read(path))) {
      const english = localizeProduct(definition, 'en');
      assert.doesNotMatch(
        [
          english.name,
          english.description,
          english.imageAlt,
          english.imageLabel,
        ].join(' '),
        /[\u3040-\u30ff\u3400-\u9fff]/u,
      );
      for (const key of Object.keys(definition).filter(
        (key) =>
          !['name', 'description', 'imageAlt', 'imageLabel'].includes(key),
      ))
        assert.equal(english[key], definition[key]);
      assert.equal(localizeProduct(definition), definition);
      assert.equal(localizeProduct(definition, 'ja'), definition);
    }
  }
});

test('every static Japanese controller message has an English translation', async () => {
  const source = await read('src/scripts/store-controller.mjs');
  const messages = [...source.matchAll(/\bt\(\s*'([^']+)'\s*,?\s*\)/gu)].map(
    (m) => m[1],
  );
  assert.ok(messages.length >= 40);
  for (const message of messages) {
    assert.equal(shopText('ja', message), message);
    assert.notEqual(
      shopText('en', message),
      message,
      `Missing translation: ${message}`,
    );
    assert.doesNotMatch(
      shopText('en', message),
      /[\u3040-\u30ff\u3400-\u9fff]/u,
    );
  }
});

test('every shop page is localized and return links preserve the active language', async () => {
  for (const shop of ['shop', 'shop-test']) {
    for (const page of ['index', 'success', 'cancel']) {
      const source = await read(`src/pages/${shop}/${page}.astro`);
      assert.match(source, /getLocale\(Astro.url.pathname\)/u);
      assert.match(source, /translator/u);
      if (page !== 'index')
        assert.ok(source.includes(`localizePath('/${shop}/', locale)`));
    }
  }
});
