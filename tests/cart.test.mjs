import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCart, subtotal, money } from '../src/scripts/cart.mjs';
const products = [
  { slug: 'sticker', maxQuantity: 5, amount: 800, availability: 'available' },
];
test('cart rejects corrupt storage and clamps quantities', () => {
  assert.deepEqual(sanitizeCart(null, products), []);
  assert.deepEqual(
    sanitizeCart(
      [
        { product: 'bad', quantity: 1 },
        { product: 'sticker', quantity: 999 },
        { product: 'sticker', quantity: 2 },
      ],
      products,
    ),
    [{ product: 'sticker', quantity: 5 }],
  );
  assert.deepEqual(
    sanitizeCart([{ product: 'sticker', quantity: -1 }], products),
    [],
  );
});
test('Japanese price and subtotal; unavailable product blocks checkout', () => {
  assert.equal(money(1500), '¥1,500');
  assert.equal(subtotal([{ product: 'sticker', quantity: 2 }], products), 1600);
  assert.equal(subtotal([{ product: 'unknown', quantity: 1 }], products), null);
});
