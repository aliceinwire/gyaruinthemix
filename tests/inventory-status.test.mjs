import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInventory } from '../api/inventory.mjs';
import {
  inventoryStatus,
  parseStatusArgs,
} from '../scripts/inventory-status.mjs';

const products = [
  { slug: 'keychain', name: 'アクリルキーホルダー', stockQuantity: 9 },
  { slug: 'sticker', name: 'ロゴシール', stockQuantity: 50 },
  { slug: 'towel', name: 'フェイスタオル' },
];

test('inventory report separates paid, held, review and released units without mixing scopes', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sessions = new Map();
  let now = 1000;
  let failure = false;
  const stripe = {
    checkout: {
      sessions: {
        async create(params) {
          if (failure) throw new Error('Uncertain create');
          const session = {
            id: `cs_live_${sessions.size + 1}`,
            mode: 'payment',
            livemode: true,
            status: 'open',
            payment_status: 'unpaid',
            metadata: params.metadata,
          };
          sessions.set(session.id, session);
          return session;
        },
        async retrieve(id) {
          return sessions.get(id);
        },
      },
    },
  };
  const inventory = createInventory({
    db,
    stripe,
    now: () => now,
    stock: {
      'live:public': { keychain: 10, sticker: 0 },
      'test:public': { keychain: 99 },
    },
  });
  const checkout = (attemptId, quantity) =>
    inventory.checkout({
      scope: 'live:public',
      attemptId,
      items: [{ product: 'keychain', quantity }],
      params: { mode: 'payment' },
    });
  const paid = await checkout('paid', 2);
  paid.status = 'complete';
  paid.payment_status = 'paid';
  await checkout('open', 3);
  const expired = await checkout('expired', 1);
  expired.status = 'expired';
  const pending = await checkout('pending', 1);
  pending.status = 'complete';
  failure = true;
  await assert.rejects(checkout('unknown', 1));
  now += 24 * 60 * 60 * 1000;
  await inventory.reconcile();
  const report = inventoryStatus({ db, scope: 'live:public', products });
  assert.deepEqual(report.products, [
    {
      sku: 'keychain',
      name: 'アクリルキーホルダー',
      total: 10,
      sold: 2,
      held: 5,
      review: 1,
      available: 3,
    },
    {
      sku: 'sticker',
      name: 'ロゴシール',
      total: 0,
      sold: 0,
      held: 0,
      review: 0,
      available: 0,
    },
    {
      sku: 'towel',
      name: 'フェイスタオル',
      total: null,
      sold: null,
      held: null,
      review: null,
      available: null,
    },
  ]);
  assert.equal(
    inventoryStatus({ db, scope: 'test:public', products }).products[0]
      .available,
    99,
  );
  assert.equal(
    inventoryStatus({ db, scope: 'test:sandbox', products }).products[0]
      .available,
    null,
  );
  assert.throws(
    () => inventoryStatus({ db, scope: 'live:sandbox' }),
    /Invalid inventory scope/,
  );
});

test('status CLI reads the existing ledger without writes and never creates a missing database', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gyaru-stock-status-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'commerce.sqlite');
  const db = new DatabaseSync(file);
  createInventory({
    db,
    stripe: {},
    stock: { 'live:public': { keychain: 7, retired: 2 } },
  });
  db.close();
  const before = readFileSync(file);
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/inventory-status.mjs', ...args], {
      encoding: 'utf8',
    });
  const result = run('--db', file, '--scope', 'live:public', '--json');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scope, 'live:public');
  assert.equal(report.products.find((p) => p.sku === 'keychain').available, 7);
  assert.equal(
    report.products.find((p) => p.sku === 'sticker').available,
    null,
  );
  assert.equal(report.products.find((p) => p.sku === 'retired').available, 2);
  assert.deepEqual(readFileSync(file), before);
  const text = run('--db', file, '--scope', 'live:public');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /販売済み/);
  assert.match(text.stdout, /確保中/);
  assert.match(text.stdout, /未設定/);
  assert.deepEqual(readFileSync(file), before);
  const missing = join(directory, 'missing.sqlite');
  assert.notEqual(run('--db', missing, '--scope', 'live:public').status, 0);
  assert.equal(existsSync(missing), false);
  const empty = new DatabaseSync(join(directory, 'empty.sqlite'));
  assert.throws(() => inventoryStatus({ db: empty, scope: 'live:public' }));
  empty.close();
});

test('status CLI requires an explicit scope and rejects adjustment flags and duplicate arguments', () => {
  const args = ['--db', '/tmp/commerce.sqlite', '--scope', 'live:public'];
  assert.deepEqual(parseStatusArgs([...args, '--json']), {
    file: '/tmp/commerce.sqlite',
    scope: 'live:public',
    json: true,
  });
  for (const invalid of [
    [],
    ['--db', '/tmp/commerce.sqlite'],
    [...args, '--scope', 'test:public'],
    [...args, '--json', '--json'],
    [...args, '--add', '10'],
    [...args.slice(0, -1), 'live:sandbox'],
  ])
    assert.throws(() => parseStatusArgs(invalid), /Usage:/);
});
