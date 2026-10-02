// Manual UI testing only. Never copied into either production image.
import Stripe from 'stripe';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../api/app.mjs';
const products = JSON.parse(
  await readFile(new URL('../config/products.json', import.meta.url), 'utf8'),
).map((p) => ({ ...p, availability: 'available', priceId: `price_${p.slug}` }));
const app = await buildApp({
  config: {
    siteUrl: process.env.PREVIEW_ORIGIN || 'http://localhost:4321',
    mode: 'test',
    salesEnabled: true,
    shippingRate: 'shr_fixture',
    webhookSecret: 'whsec_FIXTUREONLY',
    products,
  },
  stripe: {
    webhooks: new Stripe('rk_test_FIXTUREONLY').webhooks,
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
      }),
    },
    shippingRates: {
      retrieve: async () => ({
        active: true,
        livemode: false,
        type: 'fixed_amount',
        fixed_amount: { amount: 0, currency: 'jpy' },
        tax_behavior: 'inclusive',
      }),
    },
    checkout: {
      sessions: {
        create: async () => {
          throw new Error('Offline fixture never creates payments');
        },
      },
    },
  },
  journal: {
    healthy: () => true,
    claim: async () => true,
    close: async () => {},
  },
  logger: false,
});
await app.listen({ port: 3000, host: '127.0.0.1' });
console.log(
  'OFFLINE UI FIXTURE: all displayed amounts are test data; no Stripe network calls, payment or fulfillment.',
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
