import test from 'node:test';
import assert from 'node:assert/strict';
import { savedProductSlugs } from '../src/scripts/shop-discovery.mjs';

test('saved items recover from invalid storage and exclude removed or foreign catalog items', () => {
  const allowed = new Set(['sticker', 'keychain']);
  for (const value of [null, '', '{', 'null', 'false', '42', '"sticker"', '{}'])
    assert.deepEqual([...savedProductSlugs(value, allowed)], []);
  assert.deepEqual(
    [
      ...savedProductSlugs(
        '["sticker", "unknown", null, 2, "keychain", "sticker", "tshirt"]',
        allowed,
      ),
    ],
    ['sticker', 'keychain'],
  );
});
