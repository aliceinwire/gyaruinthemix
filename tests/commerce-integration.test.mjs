import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../api/app.mjs';
import { createInventory } from '../api/inventory.mjs';

test('API stock is shared between orders and survives webhook deduplication', async (t) => {
  const db = new DatabaseSync(':memory:');
  const sessions = new Map();
  const config = {
    mode: 'test',
    siteUrl: 'https://shop.example',
    salesEnabled: true,
    shippingRate: 'shr_test',
    products: [
      {
        slug: 'keychain',
        name: 'Keychain',
        priceId: 'price_keychain',
        availability: 'available',
        maxQuantity: 5,
      },
    ],
  };
  const stripe = {
    prices: {
      retrieve: async () => ({
        active: true,
        livemode: false,
        type: 'one_time',
        currency: 'jpy',
        unit_amount: 500,
        billing_scheme: 'per_unit',
        tax_behavior: 'inclusive',
        product: { active: true },
      }),
    },
    shippingRates: {
      retrieve: async () => ({
        active: true,
        livemode: false,
        type: 'fixed_amount',
        fixed_amount: { currency: 'jpy', amount: 0 },
        tax_behavior: 'inclusive',
      }),
    },
    checkout: {
      sessions: {
        create: async (params, { idempotencyKey }) => {
          if (!sessions.has(idempotencyKey))
            sessions.set(idempotencyKey, {
              id: `cs_test_${sessions.size + 1}`,
              mode: 'payment',
              livemode: false,
              status: 'open',
              payment_status: 'unpaid',
              url: 'https://checkout.stripe.com/c/test',
              metadata: params.metadata,
            });
          return sessions.get(idempotencyKey);
        },
        retrieve: async (id) => [...sessions.values()].find((s) => s.id === id),
      },
    },
    webhooks: { constructEvent: (body) => JSON.parse(body.toString()) },
  };
  const inventory = createInventory({
    db,
    stripe,
    stock: { 'test:public': { keychain: 10 } },
  });
  const app = await buildApp({
    config,
    stripe,
    inventory,
    logger: false,
    rateMax: 100,
    journal: {
      healthy: () => true,
      claim: async () => false,
      close: async () => {},
    },
  });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const catalog = async () =>
    (await app.inject({ url: '/api/catalog' })).json();
  const version = (await catalog()).version;
  const buy = (quantity) =>
    app.inject({
      method: 'POST',
      url: '/api/checkout',
      headers: { origin: config.siteUrl, 'idempotency-key': randomUUID() },
      payload: {
        catalogVersion: version,
        items: [{ product: 'keychain', quantity }],
      },
    });
  assert.equal((await buy(3)).statusCode, 200);
  assert.equal((await buy(3)).statusCode, 200);
  assert.equal((await catalog()).products[0].availableStock, 4);
  assert.equal((await buy(5)).statusCode, 409);
  assert.equal((await buy(4)).statusCode, 200);
  assert.equal((await catalog()).products[0].availability, 'sold_out');
  assert.equal((await buy(1)).statusCode, 409);
  const first = [...sessions.values()][0];
  first.status = 'expired';
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/stripe/webhook',
        payload: {
          id: 'evt_expired',
          type: 'checkout.session.expired',
          livemode: false,
          data: { object: { ...first, object: 'checkout.session' } },
        },
      })
    ).statusCode,
    200,
  );
  assert.equal((await catalog()).products[0].availableStock, 3);
});

test('membership checkout refuses arbitrary account identifiers and anonymous users', async (t) => {
  const calls = [];
  const app = await buildApp({
    config: {
      mode: 'test',
      siteUrl: 'https://shop.example',
      products: [],
      salesEnabled: false,
    },
    stripe: {},
    journal: { healthy: () => true, close: async () => {} },
    logger: false,
    membership: {
      getPlan: async () => ({ enabled: false }),
      healthy: () => true,
      checkout: async (x) => {
        calls.push(x);
        return {};
      },
    },
    memberAccess: {
      registerRoutes() {},
      requireAccount: async (_req, reply) => {
        reply.code(401).send({ error: 'Sign in first' });
        return null;
      },
    },
  });
  t.after(() => app.close());
  for (const payload of [
    { planVersion: 'a'.repeat(64) },
    { planVersion: 'a'.repeat(64), accountId: randomUUID() },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/membership/checkout',
      headers: {
        origin: 'https://shop.example',
        'idempotency-key': randomUUID(),
      },
      payload,
    });
    assert.ok([400, 401].includes(response.statusCode));
  }
  assert.equal(calls.length, 0);
});

test('global API headers preserve private member cache and referrer protections', async (t) => {
  const { createMemberAccess } = await import('../api/member-access.mjs');
  const db = new DatabaseSync(':memory:');
  const config = {
    mode: 'test',
    siteUrl: 'https://shop.example',
    products: [],
    salesEnabled: false,
  };
  const memberAccess = createMemberAccess({
    db,
    config,
    membershipForAccount: async () => ({ entitled: false }),
  });
  const app = await buildApp({
    config,
    stripe: {},
    logger: false,
    memberAccess,
    journal: { healthy: () => true, close: async () => {} },
  });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const result = await app.inject({ url: '/api/member/session' });
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.equal(result.headers['cache-control'], 'private, no-store');
  assert.equal(result.headers.vary, 'Cookie');
});

test('edge preserves no-referrer for authenticated responses', async () => {
  const { readFile } = await import('node:fs/promises');
  assert.match(
    await readFile(
      new URL('../deploy/security-headers.conf', import.meta.url),
      'utf8',
    ),
    /Referrer-Policy 'no-referrer'/,
  );
});

test('enabled commerce components preserve signed legacy merchandise webhook observations', async (t) => {
  const { createMembership } = await import('../api/membership.mjs');
  const db = new DatabaseSync(':memory:');
  const config = {
    mode: 'test',
    siteUrl: 'https://shop.example',
    products: [],
    salesEnabled: false,
  };
  const stripe = {
    webhooks: { constructEvent: (body) => JSON.parse(body.toString()) },
  };
  const membership = createMembership({ db, config, stripe });
  const inventory = createInventory({ db, stripe, stock: {} });
  let claims = 0;
  const app = await buildApp({
    config,
    stripe,
    membership,
    inventory,
    logger: false,
    journal: {
      healthy: () => true,
      claim: async () => {
        claims++;
        return true;
      },
      close: async () => {},
    },
  });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const payload = {
    id: 'evt_ci_restart',
    livemode: false,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_ci_restart',
        object: 'checkout.session',
        payment_status: 'paid',
        metadata: { store: 'gyaruinthemix' },
      },
    },
  };
  const response = await app.inject({
    method: 'POST',
    url: '/api/stripe/webhook',
    payload,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(claims, 1);
});
