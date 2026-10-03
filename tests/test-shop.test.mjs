import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
  const calls = { prices: [], shipping: [], checkout: [], retrieve: [] };
  const sessions = new Map();
  const cachedCreates = new Map();
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
          if (overrides.createFailure) throw new Error('Mock create failure');
          const [params, options] = args;
          if (!cachedCreates.has(options.idempotencyKey)) {
            const id = `cs_test_UNITTESTONLY_${cachedCreates.size + 1}`;
            const session = {
              id,
              livemode: false,
              mode: 'payment',
              status: 'open',
              payment_status: 'unpaid',
              metadata: params.metadata,
              url: `https://checkout.stripe.com/c/pay/${id}`,
              ...overrides.session,
            };
            cachedCreates.set(options.idempotencyKey, session);
            sessions.set(session.id, {
              ...session,
              ...overrides.currentSession,
            });
          }
          return structuredClone(cachedCreates.get(options.idempotencyKey));
        },
        retrieve: async (id) => {
          calls.retrieve.push(id);
          if (overrides.retrieveFailure)
            throw new Error('Mock retrieve failure with DO_NOT_LEAK details');
          return structuredClone(sessions.get(id));
        },
      },
    },
  };
  const journal = await openJournal(config.stateDir);
  const app = await buildApp({
    config,
    stripe,
    journal,
    logger: false,
    rateMax: overrides.rateMax || 100,
  });
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
        'x-checkout-protocol': '2',
        ...headers,
      },
      payload: {
        catalogVersion: catalog.json().version || 'a'.repeat(64),
        items: definitions.map((p) => ({ product: p.slug, quantity: 1 })),
        ...patch,
      },
    });
  };
  const status = (sessionId, attemptId, patch = {}, headers = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/test-shop/checkout-status',
      headers: { origin: config.siteUrl, ...headers },
      payload: { sessionId, attemptId, ...patch },
    });
  return {
    env,
    config,
    stripe,
    journal,
    app,
    calls,
    checkout,
    sessions,
    status,
  };
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

for (const enabled of [undefined, 'false'])
  test(`hidden endpoints fail closed when switch is ${enabled ?? 'absent'}`, async (t) => {
    const x = await setup(t, { env: { TEST_SHOP_ENABLED: enabled } });
    await x.app.validateCatalog();
    assert.equal(
      (await x.app.inject('/api/test-shop/catalog')).statusCode,
      404,
    );
    assert.equal((await x.checkout()).statusCode, 404);
    assert.equal(
      (await x.status('cs_test_UNITTESTONLY', randomUUID())).statusCode,
      404,
    );
    assert.deepEqual(x.calls, {
      prices: [],
      shipping: [],
      checkout: [],
      retrieve: [],
    });
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
  assert.deepEqual(x.calls, {
    prices: [],
    shipping: [],
    checkout: [],
    retrieve: [],
  });
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
  const attemptId = randomUUID();
  const response = await x.checkout(
    undefined,
    {},
    { 'idempotency-key': attemptId },
  );
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
  assert.equal(
    params.success_url,
    'https://shop.example/shop-test/success/?session_id={CHECKOUT_SESSION_ID}',
  );
  assert.equal(params.cancel_url, 'https://shop.example/shop-test/cancel/');
  assert.deepEqual(params.metadata, {
    store: 'gyaruinthemix-test',
    checkout_attempt: createHash('sha256')
      .update(`gyaruinthemix-test:checkout-v2:${attemptId}`)
      .digest('hex'),
  });
  assert.deepEqual(params.payment_intent_data.metadata, {
    store: 'gyaruinthemix-test',
  });
  assert.match(
    x.calls.checkout[0][1].idempotencyKey,
    /^gyaru-test-v2-[a-f0-9]{64}$/,
  );
  assert.deepEqual(response.json(), {
    mode: 'test',
    sessionId: 'cs_test_UNITTESTONLY_1',
    status: 'open',
    url: 'https://checkout.stripe.com/c/pay/cs_test_UNITTESTONLY_1',
  });
  assert.deepEqual(x.calls.retrieve, ['cs_test_UNITTESTONLY_1']);
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
    { secretKey: 'sk_test_UNITTESTONLY' },
    { secretKey: 'rk_test_' },
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

test('sandbox checkout protocol gate blocks legacy clients before a Stripe create', async (t) => {
  const x = await setup(t);
  for (const protocol of ['', '1', '3']) {
    const response = await x.checkout(
      undefined,
      {},
      {
        'x-checkout-protocol': protocol,
      },
    );
    assert.equal(response.statusCode, 409);
  }
  const catalog = (await x.app.inject('/api/test-shop/catalog')).json();
  const missing = await x.app.inject({
    method: 'POST',
    url: '/api/test-shop/checkout',
    headers: { origin: x.config.siteUrl, 'idempotency-key': randomUUID() },
    payload: {
      catalogVersion: catalog.version,
      items: [{ product: 'sticker', quantity: 1 }],
    },
  });
  assert.equal(missing.statusCode, 409);
  assert.equal(x.calls.checkout.length, 0);
  assert.equal(x.calls.retrieve.length, 0);
});

for (const [status, paymentStatus, expected] of [
  ['open', 'unpaid', 'open'],
  ['complete', 'paid', 'paid'],
  ['complete', 'unpaid', 'pending'],
  ['complete', 'no_payment_required', 'pending'],
  ['expired', 'unpaid', 'expired'],
])
  test(`fresh ${status}/${paymentStatus} returns only ${expected} and no closed URL`, async (t) => {
    const x = await setup(t, {
      currentSession: {
        status,
        payment_status: paymentStatus,
        ...(status === 'open' ? {} : { url: null }),
        customer: 'cus_DO_NOT_LEAK',
        customer_details: { email: 'DO_NOT_LEAK@example.com' },
        payment_intent: 'pi_DO_NOT_LEAK',
        amount_total: 123456,
      },
    });
    const attemptId = randomUUID();
    const response = await x.checkout(
      undefined,
      {},
      {
        'idempotency-key': attemptId,
      },
    );
    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.deepEqual(result, {
      mode: 'test',
      sessionId: 'cs_test_UNITTESTONLY_1',
      status: expected,
      ...(status === 'open'
        ? { url: 'https://checkout.stripe.com/c/pay/cs_test_UNITTESTONLY_1' }
        : {}),
    });
    const lookup = await x.status(result.sessionId, attemptId);
    assert.equal(lookup.statusCode, 200);
    assert.deepEqual(lookup.json(), {
      mode: 'test',
      sessionId: result.sessionId,
      status: expected,
    });
    assert.equal(lookup.headers['cache-control'], 'no-store');
    assert.deepEqual(x.calls.retrieve, [result.sessionId, result.sessionId]);
    assert.equal(x.calls.checkout.length, 1);
  });

test('same attempt retries keep identical create parameters but retrieve paid state instead of cached open URL', async (t) => {
  const x = await setup(t);
  const attemptId = randomUUID();
  const headers = { 'idempotency-key': attemptId };
  const first = await x.checkout(undefined, {}, headers);
  const sessionId = first.json().sessionId;
  Object.assign(x.sessions.get(sessionId), {
    status: 'complete',
    payment_status: 'paid',
    url: null,
  });
  const retry = await x.checkout(undefined, {}, headers);
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.json(), { mode: 'test', sessionId, status: 'paid' });
  assert.deepEqual(x.calls.checkout[0], x.calls.checkout[1]);
  assert.deepEqual(x.calls.retrieve, [sessionId, sessionId]);
  assert.equal(x.sessions.size, 1);
});

test('expired retry keeps the same session and requires a separate new attempt', async (t) => {
  const x = await setup(t);
  const headers = { 'idempotency-key': randomUUID() };
  const first = await x.checkout(undefined, {}, headers);
  const sessionId = first.json().sessionId;
  Object.assign(x.sessions.get(sessionId), { status: 'expired', url: null });
  const retry = await x.checkout(undefined, {}, headers);
  assert.deepEqual(retry.json(), {
    mode: 'test',
    sessionId,
    status: 'expired',
  });
  assert.deepEqual(x.calls.checkout[0], x.calls.checkout[1]);
  assert.equal(x.sessions.size, 1);
  const next = await x.checkout();
  assert.equal(next.json().status, 'open');
  assert.notEqual(next.json().sessionId, sessionId);
  assert.notEqual(
    x.calls.checkout[0][1].idempotencyKey,
    x.calls.checkout[2][1].idempotencyKey,
  );
});

test('attempt UUID case is normalized consistently for create and status verification', async (t) => {
  const x = await setup(t);
  const attemptId = randomUUID();
  const first = await x.checkout(
    undefined,
    {},
    { 'idempotency-key': attemptId },
  );
  const second = await x.checkout(
    undefined,
    {},
    {
      'idempotency-key': attemptId.toUpperCase(),
    },
  );
  assert.deepEqual(second.json(), first.json());
  assert.deepEqual(x.calls.checkout[0], x.calls.checkout[1]);
  const lookup = await x.status(
    first.json().sessionId,
    attemptId.toUpperCase(),
  );
  assert.equal(lookup.statusCode, 200);
});

test('status needs the matching attempt, never just a success URL or another session ID', async (t) => {
  const x = await setup(t);
  const attemptId = randomUUID();
  const response = await x.checkout(
    undefined,
    {},
    { 'idempotency-key': attemptId },
  );
  const sessionId = response.json().sessionId;
  const otherAttempt = randomUUID();
  const other = await x.checkout(
    undefined,
    {},
    { 'idempotency-key': otherAttempt },
  );
  for (const [id, attempt] of [
    [sessionId, otherAttempt],
    [other.json().sessionId, attemptId],
    ['cs_test_UNKNOWN', attemptId],
  ]) {
    const lookup = await x.status(id, attempt);
    assert.equal(lookup.statusCode, 404);
    assert.deepEqual(Object.keys(lookup.json()), ['error']);
  }
  assert.equal(x.calls.checkout.length, 2);
});

for (const [name, patch] of [
  ['live mode', { livemode: true }],
  ['ambiguous mode', { livemode: undefined }],
  ['a live session ID', { id: 'cs_live_OTHER' }],
  ['a different test session', { id: 'cs_test_OTHER' }],
  ['subscription mode', { mode: 'subscription' }],
  ['unspecified payment mode', { mode: undefined }],
  ['public shop metadata', { metadata: { store: 'gyaruinthemix' } }],
  [
    'legacy session without proof',
    { metadata: { store: 'gyaruinthemix-test' } },
  ],
  ['missing metadata', { metadata: undefined }],
  [
    'wrong proof',
    {
      metadata: {
        store: 'gyaruinthemix-test',
        checkout_attempt: '0'.repeat(64),
      },
    },
  ],
])
  test(`fresh ${name} is rejected both by create retry and status`, async (t) => {
    const x = await setup(t);
    const attemptId = randomUUID();
    const headers = { 'idempotency-key': attemptId };
    const response = await x.checkout(undefined, {}, headers);
    const sessionId = response.json().sessionId;
    Object.assign(x.sessions.get(sessionId), patch);
    const lookup = await x.status(sessionId, attemptId);
    assert.equal(lookup.statusCode, 404);
    assert.deepEqual(Object.keys(lookup.json()), ['error']);
    const retry = await x.checkout(undefined, {}, headers);
    assert.equal(retry.statusCode, 503);
    assert.deepEqual(Object.keys(retry.json()), ['error']);
    assert.equal(x.sessions.size, 1);
  });

for (const [status, payment_status] of [
  ['open', 'paid'],
  ['expired', 'paid'],
  ['complete', undefined],
  ['unknown', 'unpaid'],
  [undefined, 'unpaid'],
])
  test(`ambiguous ${status}/${payment_status} fails closed`, async (t) => {
    const x = await setup(t);
    const attemptId = randomUUID();
    const headers = { 'idempotency-key': attemptId };
    const response = await x.checkout(undefined, {}, headers);
    const sessionId = response.json().sessionId;
    Object.assign(x.sessions.get(sessionId), { status, payment_status });
    assert.equal((await x.status(sessionId, attemptId)).statusCode, 503);
    assert.equal((await x.checkout(undefined, {}, headers)).statusCode, 503);
  });

test('retrieve failure never leaks the cached URL and retry keeps the original attempt', async (t) => {
  const overrides = { retrieveFailure: true };
  const x = await setup(t, overrides);
  const attemptId = randomUUID();
  const headers = { 'idempotency-key': attemptId };
  const failed = await x.checkout(undefined, {}, headers);
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(Object.keys(failed.json()), ['error']);
  assert.doesNotMatch(failed.body, /DO_NOT_LEAK|checkout\.stripe\.com/);
  const lookup = await x.status('cs_test_UNITTESTONLY_1', attemptId);
  assert.equal(lookup.statusCode, 503);
  assert.doesNotMatch(lookup.body, /DO_NOT_LEAK/);
  overrides.retrieveFailure = false;
  const retry = await x.checkout(undefined, {}, headers);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().status, 'open');
  assert.deepEqual(x.calls.checkout[0], x.calls.checkout[1]);
  assert.equal(x.sessions.size, 1);
});

test('status strictly validates input and origin before retrieving any session', async (t) => {
  const x = await setup(t);
  const sessionId = 'cs_test_UNITTESTONLY';
  const attemptId = randomUUID();
  for (const patch of [
    { sessionId: 'cs_live_OTHER' },
    { sessionId: 'cs_test_bad/value' },
    { sessionId: 'cs_test_' + 'a'.repeat(248) },
    { sessionId: '' },
    { sessionId: null },
    { attemptId: 'not-a-uuid' },
    { attemptId: '' },
    { attemptId: null },
    { customer: 'cus_INJECTED' },
    { paid: true },
  ])
    assert.equal((await x.status(sessionId, attemptId, patch)).statusCode, 400);
  for (const payload of [{ sessionId }, { attemptId }, {}])
    assert.equal(
      (
        await x.app.inject({
          method: 'POST',
          url: '/api/test-shop/checkout-status',
          headers: { origin: x.config.siteUrl },
          payload,
        })
      ).statusCode,
      400,
    );
  for (const origin of [
    '',
    'https://evil.example',
    'https://shop.example.evil',
  ])
    assert.equal(
      (await x.status(sessionId, attemptId, {}, { origin })).statusCode,
      403,
    );
  assert.equal(
    (
      await x.app.inject({
        method: 'POST',
        url: '/api/test-shop/checkout-status',
        payload: { sessionId, attemptId },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await x.app.inject('/api/test-shop/checkout-status')).statusCode,
    404,
  );
  assert.equal(
    (
      await x.app.inject({
        method: 'POST',
        url: '/api/checkout-status',
        payload: { sessionId, attemptId },
      })
    ).statusCode,
    404,
  );
  assert.equal(x.calls.retrieve.length, 0);
  assert.equal(x.calls.checkout.length, 0);
});

test('status lookups have a bounded rate limit', async (t) => {
  const x = await setup(t, { rateMax: 2 });
  const attemptId = randomUUID();
  for (let count = 0; count < 2; count++)
    assert.equal(
      (await x.status('cs_test_UNKNOWN', attemptId)).statusCode,
      404,
    );
  assert.equal((await x.status('cs_test_UNKNOWN', attemptId)).statusCode, 429);
  assert.equal(x.calls.retrieve.length, 2);
});

test('open checkout uses only the freshly retrieved, trusted Stripe destination', async (t) => {
  const x = await setup(t, {
    currentSession: { url: 'https://evil.example/cached-checkout' },
  });
  assert.equal((await x.checkout()).statusCode, 503);
});
