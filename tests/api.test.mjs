import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import Stripe from 'stripe';
import { buildApp } from '../api/app.mjs';
import { openJournal } from '../api/journal.mjs';

const webhookSecret = 'whsec_UNITTESTONLY';
const secretKey = 'rk_test_UNITTESTONLY';
const signer = new Stripe(secretKey);
async function setup(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-test-'));
  const journal = await openJournal(directory);
  const calls = [];
  const observed = [];
  const logs = [];
  const config = {
    siteUrl: 'https://shop.example',
    mode: 'test',
    salesEnabled: true,
    shippingRate: 'shr_test',
    webhookSecret,
    secretKey,
    products: [
      {
        slug: 'sticker',
        name: 'ステッカー',
        priceId: 'price_sticker',
        availability: 'available',
        maxQuantity: 5,
      },
    ],
    ...overrides.config,
  };
  const stripe = {
    webhooks: signer.webhooks,
    prices: {
      retrieve: async () => ({
        active: true,
        livemode: false,
        type: 'one_time',
        currency: 'jpy',
        unit_amount: 800,
        billing_scheme: 'per_unit',
        tax_behavior: 'inclusive',
        product: { active: true },
        ...overrides.price,
      }),
    },
    shippingRates: {
      retrieve: async () => ({
        active: true,
        livemode: false,
        type: 'fixed_amount',
        fixed_amount: { amount: 400, currency: 'jpy' },
        tax_behavior: 'inclusive',
        ...overrides.shipping,
      }),
    },
    checkout: {
      sessions: {
        create: async (...args) => {
          calls.push(args);
          if (overrides.stripeFailure)
            throw new Error(`leak ${secretKey} ${webhookSecret} /secret/file`);
          return { url: 'https://checkout.stripe.com/c/pay/cs_test' };
        },
      },
    },
  };
  const stream = new Writable({
    write(chunk, _encoding, next) {
      logs.push(chunk.toString());
      next();
    },
  });
  const app = await buildApp({
    config,
    stripe,
    journal,
    observe: (e) => observed.push(e),
    rateMax: overrides.rateMax || 100,
    logger: { stream },
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const response = await app.inject('/api/catalog');
  const version =
    response.statusCode === 200 ? response.json().version : 'a'.repeat(64);
  const valid = {
    items: [{ product: 'sticker', quantity: 2 }],
    catalogVersion: version,
  };
  function checkout(payload = valid, headers = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/checkout',
      headers: {
        origin: config.siteUrl,
        'idempotency-key': randomUUID(),
        ...headers,
      },
      payload,
    });
  }
  const event = (
    type = 'checkout.session.completed',
    status = 'paid',
    extra = {},
  ) => ({
    id: 'evt_test',
    object: 'event',
    type,
    livemode: false,
    data: {
      object: {
        id: 'cs_test',
        object: 'checkout.session',
        payment_status: status,
        metadata: { store: 'gyaruinthemix' },
        customer_details: {
          email: 'DO_NOT_LOG@example.com',
          address: { line1: 'DO_NOT_LOG_ADDRESS' },
        },
      },
    },
    ...extra,
  });
  function webhook(payload = event(), signature) {
    const raw =
      typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    return app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature':
          signature ||
          signer.webhooks.generateTestHeaderString({
            payload: raw,
            secret: webhookSecret,
          }),
      },
      payload: raw,
    });
  }
  return {
    app,
    config,
    journal,
    calls,
    observed,
    logs,
    valid,
    checkout,
    webhook,
    event,
    stripe,
  };
}

test('valid cart uses trusted Price IDs, Japan shipping and fixed return URLs', async (t) => {
  const x = await setup(t);
  const r = await x.checkout();
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().url, 'https://checkout.stripe.com/c/pay/cs_test');
  const [params, options] = x.calls[0];
  assert.deepEqual(params.line_items, [
    { price: 'price_sticker', quantity: 2 },
  ]);
  assert.deepEqual(params.shipping_address_collection.allowed_countries, [
    'JP',
  ]);
  assert.deepEqual(params.shipping_options, [{ shipping_rate: 'shr_test' }]);
  assert.equal(params.success_url, 'https://shop.example/shop/success/');
  assert.equal(params.cancel_url, 'https://shop.example/shop/cancel/');
  assert.deepEqual(params.adaptive_pricing, { enabled: false });
  assert.match(options.idempotencyKey, /^gyaru-[a-f0-9]{64}$/);
  assert.equal('price_data' in params.line_items[0], false);
});
for (const [name, items] of [
  ['unknown product', [{ product: 'unknown', quantity: 1 }]],
  ['zero quantity', [{ product: 'sticker', quantity: 0 }]],
  ['negative quantity', [{ product: 'sticker', quantity: -1 }]],
  ['excessive quantity', [{ product: 'sticker', quantity: 6 }]],
  ['fractional quantity', [{ product: 'sticker', quantity: 1.5 }]],
  ['string quantity', [{ product: 'sticker', quantity: '2' }]],
  [
    'duplicate product',
    [
      { product: 'sticker', quantity: 4 },
      { product: 'sticker', quantity: 4 },
    ],
  ],
  ['empty cart', []],
  ['array shape', 'sticker'],
])
  test(`rejects ${name}`, async (t) => {
    const x = await setup(t);
    assert.equal((await x.checkout({ ...x.valid, items })).statusCode, 400);
    assert.equal(x.calls.length, 0);
  });
for (const field of ['price', 'unit_amount', 'currency', 'stripe_price_id'])
  test(`rejects arbitrary ${field} at both object levels`, async (t) => {
    const x = await setup(t);
    assert.equal(
      (await x.checkout({ ...x.valid, [field]: 'attacker' })).statusCode,
      400,
    );
    assert.equal(
      (
        await x.checkout({
          ...x.valid,
          items: [{ ...x.valid.items[0], [field]: 'attacker' }],
        })
      ).statusCode,
      400,
    );
    assert.equal(x.calls.length, 0);
  });
test('malformed JSON and oversize request are rejected', async (t) => {
  const x = await setup(t);
  assert.equal(
    (await x.checkout('{', { 'content-type': 'application/json' })).statusCode,
    400,
  );
  assert.equal((await x.checkout({ stuff: 'x'.repeat(9000) })).statusCode, 413);
});
test('origin and idempotency key are required', async (t) => {
  const x = await setup(t);
  assert.equal(
    (await x.checkout(x.valid, { origin: 'https://evil.example' })).statusCode,
    403,
  );
  assert.equal(
    (await x.checkout(x.valid, { 'idempotency-key': 'invalid' })).statusCode,
    400,
  );
});
test('stale catalog cannot silently bill a new price', async (t) => {
  const x = await setup(t);
  assert.equal(
    (await x.checkout({ ...x.valid, catalogVersion: 'b'.repeat(64) }))
      .statusCode,
    409,
  );
  assert.equal(x.calls.length, 0);
});
test('same attempt produces identical Stripe request parameters and key', async (t) => {
  const x = await setup(t);
  const headers = { 'idempotency-key': randomUUID() };
  await x.checkout(x.valid, headers);
  await x.checkout(x.valid, headers);
  assert.deepEqual(x.calls[0], x.calls[1]);
});
test('different carts do not share an idempotency key', async (t) => {
  const x = await setup(t);
  const headers = { 'idempotency-key': randomUUID() };
  await x.checkout(x.valid, headers);
  await x.checkout(
    { ...x.valid, items: [{ product: 'sticker', quantity: 1 }] },
    headers,
  );
  assert.notEqual(x.calls[0][1].idempotencyKey, x.calls[1][1].idempotencyKey);
});
test('disabled sales refuse Checkout and publish no prices', async (t) => {
  const x = await setup(t, { config: { salesEnabled: false } });
  assert.equal((await x.checkout()).statusCode, 503);
  assert.equal(
    (await x.app.inject('/api/catalog')).json().products[0].amount,
    null,
  );
});
for (const [name, price] of [
  ['wrong currency', { currency: 'usd' }],
  ['inactive price', { active: false }],
  ['subscription', { type: 'recurring' }],
  ['wrong mode', { livemode: true }],
  ['tax unspecified', { tax_behavior: 'unspecified' }],
  ['inactive product', { product: { active: false } }],
]) {
  test(`fails closed for ${name}`, async (t) => {
    const x = await setup(t, { price });
    assert.equal((await x.app.inject('/api/catalog')).statusCode, 503);
    assert.equal((await x.checkout()).statusCode, 503);
    assert.equal(x.calls.length, 0);
  });
}
test('invalid shipping rate blocks purchases', async (t) => {
  const x = await setup(t, { shipping: { active: false } });
  assert.equal((await x.checkout()).statusCode, 503);
});
test('checkout rate limit returns 429', async (t) => {
  const x = await setup(t, { rateMax: 2 });
  await x.checkout();
  await x.checkout();
  assert.equal((await x.checkout()).statusCode, 429);
});
test('invalid webhook signature is rejected without logging payload', async (t) => {
  const x = await setup(t);
  assert.equal((await x.webhook(x.event(), 't=1,v1=invalid')).statusCode, 400);
  assert.equal(x.observed.length, 0);
  assert.match(x.logs.join(''), /webhook_verification_failure/);
  assert.doesNotMatch(x.logs.join(''), /DO_NOT_LOG/);
});
test('raw webhook body is verified exactly', async (t) => {
  const x = await setup(t);
  const raw = JSON.stringify(x.event(), null, 2);
  const signature = signer.webhooks.generateTestHeaderString({
    payload: raw,
    secret: webhookSecret,
  });
  assert.equal((await x.webhook(raw + ' ', signature)).statusCode, 400);
  assert.equal((await x.webhook(raw, signature)).statusCode, 200);
});
for (const [type, status, outcome] of [
  ['checkout.session.completed', 'paid', 'payment_received'],
  ['checkout.session.completed', 'unpaid', 'payment_pending'],
  ['checkout.session.async_payment_succeeded', 'paid', 'payment_received'],
  ['checkout.session.async_payment_failed', 'unpaid', 'payment_failed'],
])
  test(`handles ${type} / ${status}`, async (t) => {
    const x = await setup(t);
    assert.equal((await x.webhook(x.event(type, status))).statusCode, 200);
    assert.equal(x.observed[0].event, outcome);
  });
test('concurrent duplicate webhooks and distinct paid events do not process twice', async (t) => {
  const x = await setup(t);
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => x.webhook()),
  );
  assert.ok(responses.every((r) => r.statusCode === 200));
  await x.webhook(
    x.event('checkout.session.async_payment_succeeded', 'paid', {
      id: 'evt_second',
    }),
  );
  assert.equal(x.observed.length, 1);
});
test('pending transitions to paid; late failure never regresses paid', async (t) => {
  const x = await setup(t);
  await x.webhook(x.event('checkout.session.completed', 'unpaid'));
  await x.webhook(
    x.event('checkout.session.async_payment_succeeded', 'paid', {
      id: 'evt_second',
    }),
  );
  await x.webhook(
    x.event('checkout.session.async_payment_failed', 'unpaid', {
      id: 'evt_third',
    }),
  );
  assert.deepEqual(
    x.observed.map((e) => e.event),
    ['payment_pending', 'payment_received'],
  );
});
test('unsupported events and other stores are acknowledged without processing', async (t) => {
  const x = await setup(t);
  assert.equal(
    (await x.webhook(x.event('payment_intent.succeeded'))).statusCode,
    200,
  );
  const event = x.event();
  event.data.object.metadata.store = 'other';
  assert.equal((await x.webhook(event)).statusCode, 200);
  assert.equal(x.observed.length, 0);
});
test('wrong webhook mode is rejected', async (t) => {
  const x = await setup(t);
  assert.equal(
    (await x.webhook(x.event(undefined, undefined, { livemode: true })))
      .statusCode,
    400,
  );
});
test('journal failures return retryable 503, without processing', async (t) => {
  const x = await setup(t);
  x.journal.claim = async () => {
    throw new Error('unavailable');
  };
  assert.equal((await x.webhook()).statusCode, 503);
  assert.equal(x.observed.length, 0);
});
test('secrets and customer details never appear in responses or logs', async (t) => {
  const x = await setup(t, { stripeFailure: true });
  const responses = [
    await x.checkout(),
    await x.webhook(),
    await x.app.inject('/api/catalog'),
    await x.app.inject('/api/health'),
  ];
  assert.equal(responses[0].statusCode, 503);
  const output = responses.map((r) => r.body).join('') + x.logs.join('');
  for (const value of [
    secretKey,
    webhookSecret,
    'DO_NOT_LOG',
    '/secret/file',
    'price_sticker',
  ])
    assert.equal(output.includes(value), false);
});
test('health is lightweight and degrades on journal failure', async (t) => {
  const x = await setup(t);
  const response = await x.app.inject('/api/health');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
  assert.equal(response.headers['cache-control'], 'no-store');
  x.journal.healthy = () => false;
  assert.equal((await x.app.inject('/api/health')).statusCode, 503);
});
