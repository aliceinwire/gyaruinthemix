import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(
  new URL('../src/styles/global.css', import.meta.url),
  'utf8',
);

test('shop cards use bounded equal-width tracks at desktop and mobile widths', () => {
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  const mobile = styles.slice(styles.indexOf('@media (max-width: 760px)'));
  assert.match(
    mobile,
    /\.product-grid\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
});

test('the last product keeps the same stacked card layout for odd and even catalogs', () => {
  // A full-row last card with a height-driven square image overlapped its body.
  // Product order/count must not change an individual card's layout.
  assert.doesNotMatch(styles, /\.product[^,{]*:(?:last|nth)-child/);
  assert.doesNotMatch(styles, /\.product-art[^}]*min-height:\s*100%/);
});

test('public and hidden test shops use the same product component and grid', async () => {
  for (const path of ['shop/index.astro', 'shop-test/index.astro']) {
    const page = await readFile(
      new URL(`../src/pages/${path}`, import.meta.url),
      'utf8',
    );
    assert.match(
      page,
      /import Product from '\.\.\/\.\.\/components\/Product\.astro'/,
    );
    assert.match(page, /class="product-grid"/);
    assert.match(page, /products\.map\(/);
  }
});
