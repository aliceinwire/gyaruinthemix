import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createInventory } from '../api/inventory.mjs';
import { adjustStock, parseStockArgs } from '../scripts/inventory-stock.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const stock = { 'test:sandbox': { keychain: 10 } };
  const stripe = {
    checkout: {
      sessions: {
        async create() {
          throw new Error('uncertain');
        },
      },
    },
  };
  const inventory = createInventory({ db, stripe, stock });
  const adjust = (extra) =>
    adjustStock({ db, scope: 'test:sandbox', sku: 'keychain', ...extra });
  return { db, stock, stripe, inventory, adjust };
}

test('restocking preserves reservations and original bootstrap manifest across restart', async () => {
  const f = fixture();
  await assert.rejects(
    f.inventory.checkout({
      scope: 'test:sandbox',
      attemptId: 'held',
      items: [{ product: 'keychain', quantity: 3 }],
      params: {},
    }),
  );
  assert.deepEqual(f.adjust({ add: 5 }), {
    scope: 'test:sandbox',
    sku: 'keychain',
    previousTotal: 10,
    total: 15,
    committed: 3,
    available: 12,
  });
  const inventory = createInventory({
    db: f.db,
    stripe: f.stripe,
    stock: f.stock,
  });
  assert.equal(
    inventory.decorateCatalog('test:sandbox', {
      products: [{ slug: 'keychain', availability: 'available' }],
    }).products[0].availableStock,
    12,
  );
  assert.throws(
    () =>
      createInventory({
        db: f.db,
        stripe: f.stripe,
        stock: { 'test:sandbox': { keychain: 15 } },
      }),
    { code: 'STOCK_CONFIG_MISMATCH' },
  );
  f.db.close();
});

test('set-total cannot remove sold or held units and failed changes do not audit', async () => {
  const f = fixture();
  await assert.rejects(
    f.inventory.checkout({
      scope: 'test:sandbox',
      attemptId: 'held',
      items: [{ product: 'keychain', quantity: 3 }],
      params: {},
    }),
  );
  assert.throws(() => f.adjust({ setTotal: 2 }), /less than sold and held/);
  assert.equal(f.adjust({ setTotal: 3 }).available, 0);
  assert.equal(
    f.db.prepare('SELECT COUNT(*) AS count FROM inventory_stock_audit').get()
      .count,
    1,
  );
  assert.equal(
    f.db.prepare('SELECT total FROM inventory_stock').get().total,
    3,
  );
  f.db.close();
});

test('operator can initialize a new SKU in one scope without authorizing another', () => {
  const f = fixture();
  assert.equal(f.adjust({ sku: 'sticker', add: 4 }).available, 4);
  const catalog = {
    products: [{ slug: 'sticker', availability: 'available' }],
  };
  assert.equal(
    f.inventory.decorateCatalog('test:sandbox', catalog).products[0]
      .availableStock,
    4,
  );
  assert.equal(
    f.inventory.decorateCatalog('live:public', catalog).products[0]
      .availableStock,
    null,
  );
  f.db.close();
});

test('adjustments reject unsafe counts, ambiguous modes and uninitialized database', () => {
  const f = fixture();
  for (const extra of [
    { add: -1 },
    { add: 0 },
    { add: 1.5 },
    { add: 1, setTotal: 1 },
    { add: Number.MAX_SAFE_INTEGER },
    { scope: 'live:sandbox', add: 1 },
  ])
    assert.throws(() => f.adjust(extra));
  const empty = new DatabaseSync(':memory:');
  assert.throws(() =>
    adjustStock({ db: empty, scope: 'test:sandbox', sku: 'keychain', add: 1 }),
  );
  empty.close();
  f.db.close();
});

test('CLI requires explicit offline and backup acknowledgment and strict arguments', () => {
  const args = [
    '--db',
    '/tmp/shop.sqlite',
    '--scope',
    'test:sandbox',
    '--sku',
    'keychain',
    '--add',
    '10',
  ];
  assert.throws(() => parseStockArgs(args));
  assert.deepEqual(parseStockArgs([...args, '--ack-offline-backup']), {
    file: '/tmp/shop.sqlite',
    scope: 'test:sandbox',
    sku: 'keychain',
    add: 10,
  });
  assert.throws(() =>
    parseStockArgs([...args, '--ack-offline-backup', '--add', '2']),
  );
  assert.throws(() =>
    parseStockArgs([...args.slice(0, -1), '1e2', '--ack-offline-backup']),
  );
});
