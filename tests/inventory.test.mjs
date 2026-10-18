import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInventory } from '../api/inventory.mjs';

const stock = { 'test:sandbox': { keychain: 10 } };
const catalog = {
  version: 'stable',
  products: [
    { slug: 'keychain', availability: 'available', maxQuantity: 5 },
    { slug: 'sticker', availability: 'available', maxQuantity: 5 },
  ],
};
function fixture({ db = new DatabaseSync(':memory:'), now = () => 1000 } = {}) {
  const sessions = new Map();
  const keys = new Map();
  const calls = [];
  let failure;
  const stripe = {
    checkout: {
      sessions: {
        async create(params, options) {
          calls.push({ params: structuredClone(params), options });
          let session = keys.get(options.idempotencyKey);
          if (!session) {
            session = {
              id: `cs_test_${keys.size + 1}`,
              mode: 'payment',
              livemode: false,
              status: 'open',
              payment_status: 'unpaid',
              metadata: params.metadata,
              url: 'https://checkout.stripe.com/example',
            };
            keys.set(options.idempotencyKey, session);
            sessions.set(session.id, structuredClone(session));
          }
          if (failure) throw failure;
          return structuredClone(session);
        },
        async retrieve(id) {
          return structuredClone(sessions.get(id));
        },
      },
    },
  };
  const inventory = createInventory({ db, stripe, stock, now });
  const checkout = (attemptId, quantity = 1, extra = {}) =>
    inventory.checkout({
      scope: 'test:sandbox',
      attemptId,
      items: [{ product: 'keychain', quantity }],
      params: {
        mode: 'payment',
        metadata: { store: 'test' },
        line_items: [{ price: 'price_test', quantity }],
      },
      ...extra,
    });
  return {
    db,
    stripe,
    inventory,
    checkout,
    calls,
    sessions,
    fail: (error) => {
      failure = error;
    },
    available: () =>
      inventory.decorateCatalog('test:sandbox', catalog).products[0]
        .availableStock,
  };
}

test('unconfigured SKUs and other scopes fail closed; catalog version is stable', async () => {
  const f = fixture();
  assert.equal(f.available(), 10);
  const result = f.inventory.decorateCatalog('test:sandbox', catalog);
  assert.equal(result.version, catalog.version);
  assert.equal(result.products[1].availability, 'sold_out');
  assert.equal(result.products[1].availableStock, null);
  await assert.rejects(f.checkout('a', 1, { scope: 'live:public' }), {
    code: 'INVENTORY_UNAVAILABLE',
  });
  assert.equal(f.calls.length, 0);
  f.db.close();
});

test('concurrent requests cannot oversell and a retry does not reserve twice', async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => f.checkout(`attempt-${i}`)),
  );
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    10,
  );
  assert.equal(f.available(), 0);
  await f.checkout('attempt-0');
  assert.equal(f.available(), 0);
  assert.equal(f.calls.length, 10);
  await assert.rejects(f.checkout('attempt-0', 2), {
    code: 'ATTEMPT_CONFLICT',
  });
  f.db.close();
});

test('all items reserve atomically; malformed or duplicate lines cannot bypass stock', async () => {
  const f = fixture();
  await assert.rejects(
    f.checkout('mixed', 1, {
      items: [
        { product: 'keychain', quantity: 1 },
        { product: 'sticker', quantity: 1 },
      ],
    }),
    { code: 'INVENTORY_UNAVAILABLE' },
  );
  await assert.rejects(
    f.checkout('duplicate', 1, {
      items: [
        { product: 'keychain', quantity: 1 },
        { product: 'keychain', quantity: 1 },
      ],
    }),
    { code: 'INVALID_ITEMS' },
  );
  assert.equal(f.available(), 10);
  assert.equal(f.calls.length, 0);
  f.db.close();
});

test('ambiguous create retains stock and immutable retry params/key across restart', async () => {
  const f = fixture();
  f.fail(new Error('response lost'));
  await assert.rejects(f.checkout('uncertain', 3));
  assert.equal(f.available(), 7);
  assert.equal(
    f.db.prepare('SELECT COUNT(*) AS count FROM inventory_attempts').get()
      .count,
    1,
  );
  f.fail(null);
  const restarted = createInventory({
    db: f.db,
    stripe: f.stripe,
    stock,
    now: () => 2000,
  });
  assert.deepEqual(await restarted.reconcile(), {
    checked: 1,
    failed: 0,
    review: 0,
  });
  assert.equal(f.available(), 7);
  assert.deepEqual(f.calls[0], f.calls[1]);
  f.db.close();
});

test('old ambiguous attempts require operator reconciliation without new create', async () => {
  let now = 1000;
  const f = fixture({ now: () => now });
  f.fail(new Error('uncertain'));
  await assert.rejects(f.checkout('old', 2));
  now += 24 * 60 * 60 * 1000;
  f.fail(null);
  assert.deepEqual(await f.inventory.reconcile(), {
    checked: 0,
    failed: 0,
    review: 1,
  });
  await assert.rejects(f.checkout('old', 2), {
    code: 'RECONCILIATION_REQUIRED',
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.available(), 8);
  f.db.close();
});

test('current Stripe status, not webhook payload, controls idempotent settlement', async () => {
  const f = fixture();
  const session = await f.checkout('paid', 4);
  f.sessions.get(session.id).status = 'complete';
  f.sessions.get(session.id).payment_status = 'paid';
  const stale = {
    type: 'checkout.session.expired',
    data: { object: { ...session, status: 'expired' } },
  };
  assert.equal(await f.inventory.handleWebhook(stale), true);
  assert.equal(await f.inventory.handleWebhook(stale), true);
  assert.equal(f.available(), 6);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) AS count FROM inventory_audit WHERE transition='settled'",
      )
      .get().count,
    1,
  );
  const retry = await f.checkout('paid', 4);
  assert.equal(retry.payment_status, 'paid');
  f.db.close();
});

test('unpaid completion holds indefinitely; only verified expiry returns stock', async () => {
  const f = fixture();
  const session = await f.checkout('pending', 5);
  f.sessions.get(session.id).status = 'complete';
  await f.inventory.reconcile();
  assert.equal(f.available(), 5);
  await f.inventory.handleWebhook({
    type: 'checkout.session.async_payment_failed',
    data: { object: session },
  });
  assert.equal(f.available(), 5);
  f.sessions.get(session.id).status = 'expired';
  await f.inventory.reconcile();
  assert.equal(f.available(), 10);
  await f.inventory.handleWebhook({ data: { object: session } });
  assert.equal(f.available(), 10);
  const expired = await f.checkout('pending', 5);
  assert.equal(expired.status, 'expired');
  assert.equal(f.calls.length, 1);
  f.db.close();
});

test('wrong-scope session cannot settle or release inventory', async () => {
  const f = fixture();
  const session = await f.checkout('scope', 2);
  f.sessions.get(session.id).livemode = true;
  f.sessions.get(session.id).status = 'expired';
  await assert.rejects(
    f.inventory.handleWebhook({ data: { object: session } }),
    { code: 'UNVERIFIED_SESSION' },
  );
  assert.equal(f.available(), 8);
  f.db.close();
});

test('webhook can recover session binding lost after Stripe created successfully', async () => {
  const f = fixture();
  f.fail(new Error('response lost'));
  await assert.rejects(f.checkout('lost', 2));
  const session = f.sessions.get('cs_test_1');
  session.status = 'complete';
  session.payment_status = 'paid';
  await f.inventory.handleWebhook({ data: { object: session } });
  assert.equal(
    f.db.prepare('SELECT state,session_id FROM inventory_attempts').get().state,
    'settled',
  );
  assert.equal(f.available(), 8);
  f.db.close();
});

test('bootstrap cannot reset consumed inventory or silently change totals', async () => {
  const f = fixture();
  await f.checkout('used', 2);
  assert.throws(
    () =>
      createInventory({
        db: f.db,
        stripe: f.stripe,
        stock: { 'test:sandbox': { keychain: 20 } },
      }),
    { code: 'STOCK_CONFIG_MISMATCH' },
  );
  const restarted = createInventory({ db: f.db, stripe: f.stripe, stock });
  assert.equal(
    restarted.decorateCatalog('test:sandbox', catalog).products[0]
      .availableStock,
    8,
  );
  f.db.close();
});

test('independent processes share atomic durable stock reservations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-inventory-'));
  const file = join(directory, 'inventory.sqlite');
  const db = new DatabaseSync(file);
  createInventory({ db, stripe: {}, stock });
  db.close();
  const moduleUrl = new URL('../api/inventory.mjs', import.meta.url).href;
  const script = `import { DatabaseSync } from 'node:sqlite';
    import { createInventory } from ${JSON.stringify(moduleUrl)};
    const db = new DatabaseSync(process.argv[1]);
    const stripe = { checkout: { sessions: { create: async () => { throw new Error('uncertain'); } } } };
    const inventory = createInventory({ db, stripe, stock: ${JSON.stringify(stock)} });
    try { await inventory.checkout({scope:'test:sandbox',attemptId:process.argv[2],items:[{product:'keychain',quantity:1}],params:{mode:'payment'}}); } catch {}
    db.close();`;
  try {
    await Promise.all(
      Array.from(
        { length: 15 },
        (_, i) =>
          new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              ['--input-type=module', '-e', script, file, `child-${i}`],
              { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            let stderr = '';
            child.stderr.on('data', (data) => {
              stderr += data;
            });
            child.on('error', reject);
            child.on('exit', (code) =>
              code === 0 ? resolve() : reject(new Error(stderr)),
            );
          }),
      ),
    );
    const reopened = new DatabaseSync(file);
    assert.equal(
      reopened
        .prepare('SELECT SUM(quantity) AS count FROM inventory_lines')
        .get().count,
      10,
    );
    assert.equal(
      reopened.prepare('SELECT COUNT(*) AS count FROM inventory_attempts').get()
        .count,
      10,
    );
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
