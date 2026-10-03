import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { readConfig } from '../api/config.mjs';
import { buildApp } from '../api/app.mjs';
import { openJournal } from '../api/journal.mjs';

const definitions = JSON.parse(
  await readFile(
    new URL('../config/test-products.json', import.meta.url),
    'utf8',
  ),
);
const secretKey = 'rk_test_UNITTESTONLY';
const webhookSecret = 'whsec_UNITTESTONLY';
const signer = new Stripe(secretKey);

async function environment(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-test-shop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    NODE_ENV: 'production',
    SITE_URL: 'https://shop.example',
    STRIPE_MODE: 'test',
    SALES_ENABLED: 'false',
    TEST_SHOP_ENABLED: 'true',
    STRIPE_SECRET_KEY_FILE: join(directory, 'key'),
    STRIPE_WEBHOOK_SECRET_FILE: join(directory, 'webhook'),
    STRIPE_SHIPPING_RATE_JP: 'shr_UNITTESTONLY',
    STATE_DIR: join(directory, 'state'),
  };
  await writeFile(env.STRIPE_SECRET_KEY_FILE, secretKey, { mode: 0o600 });
  await writeFile(env.STRIPE_WEBHOOK_SECRET_FILE, webhookSecret, {
    mode: 0o600,
  });
  for (const product of definitions)
    env[product.priceEnv] = `price_${product.slug}`;
  return env;
}

async function setup(t, overrides = {}) {
  const env = { ...(await environment(t)), ...overrides.env };
  const config = readConfig(env);
  const calls = { prices: [], shipping: [], checkout: [] };
  const stripe = {
    webhooks: signer.webhooks,
    prices: {
      retrieve: async (id) => {
        calls.prices.push(id);
        return {
          active: true,
          livemode: false,
          type: 'one_time',
          currency: 'jpy',
          unit_amount: 500,
          billing_scheme: 'per_unit',
          tax_behavior: 'inclusive',
          product: { active: true, livemode: false },
          ...overrides.price,
        };
      },
    },
    shippingRates: {
      retrieve: async (id) => {
        calls.shipping.push(id);
        return {
          active: true,
          livemode: false,
          type: 'fixed_amount',
          fixed_amount: { amount: 800, currency: 'jpy' },
          tax_behavior: 'inclusive',
          ...overrides.shipping,
        };
      },
    },
    checkout: {
      sessions: {
        create: async (...args) => {
          calls.checkout.push(args);
          return {
            id: 'cs_test_UNITTESTONLY',
            livemode: false,
            url: 'https://checkout.stripe.com/c/pay/cs_test_UNITTESTONLY',
            ...overrides.session,
          };
        },
      },
    },
  };
  const journal = await openJournal(config.stateDir);
  const app = await buildApp({ config, stripe, journal, logger: false });
  t.after(() => app.close());
  const checkout = async (
    path = '/api/test-shop/checkout',
    patch = {},
    headers = {},
  ) => {
    const catalog = await app.inject('/api/test-shop/catalog');
    return app.inject({
      method: 'POST',
      url: path,
      headers: {
        origin: config.siteUrl,
        'idempotency-key': randomUUID(),
        ...headers,
      },
      payload: {
        catalogVersion: catalog.json().version || 'a'.repeat(64),
        items: definitions.map((p) => ({ product: p.slug, quantity: 1 })),
        ...patch,
      },
    });
  };
  return { env, config, stripe, journal, app, calls, checkout };
}

test('hidden shop requires explicit switch, test mode, closed public sales and every runtime price', async (t) => {
  const env = await environment(t);
  assert.equal(
    readConfig({ ...env, TEST_SHOP_ENABLED: undefined }).testShopEnabled,
    false,
  );
  const config = readConfig(env);
  assert.deepEqual(
    config.testProducts.map((p) => p.slug),
    ['sticker', 'towel', 'keychain', 'tshirt'],
  );
  assert.ok(config.products.every((p) => p.availability === 'coming_soon'));
  for (const patch of [
    { TEST_SHOP_ENABLED: 'yes' },
    { SALES_ENABLED: 'true', STORE_DETAILS_REVIEWED: 'true' },
    { STRIPE_SHIPPING_RATE_JP: '' },
    { STRIPE_MODE: 'live', LIVE_MODE_ACK: 'I_HAVE_COMPLETED_TEST_CHECKOUT' },
    ...definitions.map((p) => ({ [p.priceEnv]: '' })),
  ])
    assert.throws(() => readConfig({ ...env, ...patch }));
  await writeFile(env.STRIPE_SECRET_KEY_FILE, 'rk_live_UNITTESTONLY');
  assert.throws(() => readConfig(env));
  assert.throws(() =>
    readConfig({
      ...env,
      STRIPE_MODE: 'live',
      LIVE_MODE_ACK: 'I_HAVE_COMPLETED_TEST_CHECKOUT',
    }),
  );
});

test('disabled hidden endpoints fail closed without Stripe calls', async (t) => {
  const x = await setup(t, { env: { TEST_SHOP_ENABLED: 'false' } });
  await x.app.validateCatalog();
  assert.equal((await x.app.inject('/api/test-shop/catalog')).statusCode, 404);
  assert.equal((await x.checkout()).statusCode, 404);
  assert.deepEqual(x.calls, { prices: [], shipping: [], checkout: [] });
});

test('enabled hidden sandbox leaves public catalog and checkout closed', async (t) => {
  const x = await setup(t);
  const publicCatalog = (await x.app.inject('/api/catalog')).json();
  assert.equal(publicCatalog.salesEnabled, false);
  assert.equal(publicCatalog.shipping, null);
  assert.equal(publicCatalog.products.length, 3);
  assert.ok(
    publicCatalog.products.every(
      (p) => p.availability === 'coming_soon' && p.amount === null,
    ),
  );
  assert.deepEqual(x.calls, { prices: [], shipping: [], checkout: [] });
  assert.equal((await x.checkout('/api/checkout')).statusCode, 503);
  assert.equal(x.calls.checkout.length, 0);
});

test('sandbox cart uses all four runtime prices, JP shipping, isolated metadata and return paths', async (t) => {
  const x = await setup(t);
  await x.app.validateCatalog();
  assert.deepEqual(
    x.calls.prices,
    definitions.map((p) => `price_${p.slug}`),
  );
  const catalog = (await x.app.inject('/api/test-shop/catalog')).json();
  assert.equal(catalog.mode, 'test');
  assert.equal(catalog.salesEnabled, true);
  assert.deepEqual(catalog.shipping, { amount: 800, country: 'JP' });
  assert.ok(
    catalog.products.every(
      (p) => p.availability === 'available' && p.amount === 500,
    ),
  );
  const response = await x.checkout();
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'test');
  const [params] = x.calls.checkout[0];
  assert.deepEqual(
    params.line_items,
    definitions
      .toSorted((a, b) => a.slug.localeCompare(b.slug))
      .map((p) => ({ price: `price_${p.slug}`, quantity: 1 })),
  );
  assert.deepEqual(params.shipping_options, [
    { shipping_rate: x.env.STRIPE_SHIPPING_RATE_JP },
  ]);
  assert.deepEqual(params.shipping_address_collection, {
    allowed_countries: ['JP'],
  });
  assert.equal(params.success_url, 'https://shop.example/shop-test/success/');
  assert.equal(params.cancel_url, 'https://shop.example/shop-test/cancel/');
  assert.deepEqual(params.metadata, { store: 'gyaruinthemix-test' });
  assert.deepEqual(params.payment_intent_data.metadata, params.metadata);
});

for (const [name, overrides] of [
  ['live Price', { price: { livemode: true } }],
  ['inactive Price', { price: { active: false } }],
  ['wrong Price currency', { price: { currency: 'usd' } }],
  ['recurring Price', { price: { type: 'recurring' } }],
  ['unspecified Price tax', { price: { tax_behavior: 'unspecified' } }],
  ['live shipping', { shipping: { livemode: true } }],
  ['inactive shipping', { shipping: { active: false } }],
  [
    'wrong shipping currency',
    { shipping: { fixed_amount: { amount: 800, currency: 'usd' } } },
  ],
  ['unspecified shipping tax', { shipping: { tax_behavior: 'unspecified' } }],
])
  test(`sandbox refuses ${name} before creating checkout`, async (t) => {
    const x = await setup(t, overrides);
    await assert.rejects(() => x.app.validateCatalog());
    assert.equal(
      (await x.app.inject('/api/test-shop/catalog')).statusCode,
      503,
    );
    assert.equal((await x.checkout()).statusCode, 503);
    assert.equal(x.calls.checkout.length, 0);
  });

test('sandbox reuses strict cart, origin and stale-catalog safeguards', async (t) => {
  const x = await setup(t);
  for (const patch of [
    { items: [{ product: 'unknown', quantity: 1 }] },
    { items: [{ product: 'tshirt', quantity: 6 }] },
    {
      items: [
        { product: 'sticker', quantity: 1 },
        { product: 'sticker', quantity: 1 },
      ],
    },
    { price: 'price_INJECTED' },
  ])
    assert.equal((await x.checkout(undefined, patch)).statusCode, 400);
  assert.equal(
    (await x.checkout(undefined, {}, { origin: 'https://evil.example' }))
      .statusCode,
    403,
  );
  assert.equal(
    (await x.checkout(undefined, { catalogVersion: 'b'.repeat(64) }))
      .statusCode,
    409,
  );
  assert.equal(x.calls.checkout.length, 0);
});

for (const session of [
  { livemode: true },
  { id: 'cs_live_UNEXPECTED' },
  { livemode: undefined },
])
  test('sandbox never returns a live or ambiguous session', async (t) => {
    const x = await setup(t, { session });
    assert.equal((await x.checkout()).statusCode, 503);
  });

test('app-level defense refuses enabled sandbox with live mode, live key or public sales', async (t) => {
  const x = await setup(t);
  for (const patch of [
    { mode: 'live' },
    { secretKey: 'rk_live_UNITTESTONLY' },
    { salesEnabled: true },
  ])
    await assert.rejects(() =>
      buildApp({
        config: { ...x.config, ...patch },
        stripe: x.stripe,
        journal: x.journal,
        logger: false,
      }),
    );
});

test('signed sandbox webhook is observed only as a test payment', async (t) => {
  const x = await setup(t);
  const event = {
    id: 'evt_UNITTESTONLY',
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: 'cs_test_UNITTESTONLY',
        object: 'checkout.session',
        payment_status: 'paid',
        metadata: { store: 'gyaruinthemix-test' },
      },
    },
  };
  const send = (data) => {
    const payload = JSON.stringify(data);
    return x.app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signer.webhooks.generateTestHeaderString({
          payload,
          secret: webhookSecret,
        }),
      },
    });
  };
  assert.equal((await send(event)).statusCode, 200);
  assert.equal((await send(event)).statusCode, 200);
  assert.equal((await send({ ...event, livemode: true })).statusCode, 400);
  assert.equal(
    await x.journal.claim(['test:cs_test_UNITTESTONLY:payment_received'], []),
    false,
  );
  assert.equal(x.calls.checkout.length, 0);
});
