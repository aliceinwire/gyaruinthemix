import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const products = JSON.parse(
  readFileSync(new URL('../config/products.json', import.meta.url), 'utf8'),
);

test('public merchandise displays the announced yen prices', () => {
  assert.deepEqual(
    Object.fromEntries(products.map((p) => [p.slug, p.displayPriceJPY])),
    { sticker: 300, towel: 2900, keychain: 1500, tshirt: 5000 },
  );
});

test('towel and T-shirt remain unavailable for purchase', () => {
  for (const slug of ['towel', 'tshirt']) {
    const product = products.find((p) => p.slug === slug);
    assert.equal(product.availability, 'coming_soon');
    assert.equal(product.paymentLink, null);
  }
});
