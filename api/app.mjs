import Fastify, { LogController } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createHash } from 'node:crypto';
import { createCatalog } from './catalog.mjs';

const supportedEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);
const idPattern = /^[A-Za-z0-9_]{1,255}$/;
const errorBody = (message) => ({ error: message });

export async function buildApp({
  config,
  stripe,
  journal,
  logger = true,
  rateMax = 10,
  observe,
}) {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
    bodyLimit: 8192,
    requestTimeout: 20_000,
    connectionTimeout: 25_000,
    keepAliveTimeout: 5000,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
  });
  const catalog = createCatalog(config, stripe);
  const testShopAllowed =
    config.testShopEnabled === true &&
    config.mode === 'test' &&
    /^rk_test_[A-Za-z0-9]+$/.test(config.secretKey) &&
    config.salesEnabled === false;
  if (config.testShopEnabled && !testShopAllowed)
    throw new Error('Invalid test shop configuration');
  const testConfig = {
    ...config,
    mode: 'test',
    salesEnabled: testShopAllowed,
    products: config.testProducts || [],
  };
  const testCatalog = createCatalog(testConfig, stripe);
  await app.register(rateLimit, {
    global: false,
    max: rateMax,
    timeWindow: '1 minute',
    // nginx overwrites this header. The API must stay on the project-only network.
    keyGenerator: (request) =>
      request.headers['x-store-client-ip'] || request.ip,
    errorResponseBuilder: () =>
      Object.assign(new Error('Rate limited'), { statusCode: 429 }),
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const status = error.validation
      ? 400
      : [400, 413, 415, 429].includes(error.statusCode)
        ? error.statusCode
        : 500;
    app.log.warn({ event: 'request_failure', requestId: request.id, status });
    reply
      .code(status)
      .send(
        errorBody(
          status === 500
            ? '処理できませんでした。時間をおいてお試しください。'
            : status === 429
              ? '少し時間をおいて、もう一度お試しください。'
              : '入力内容を確認してください。',
        ),
      );
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(errorBody('見つかりません。')),
  );
  app.get('/api/health', async (_request, reply) => {
    if (!journal.healthy()) {
      app.log.warn({ event: 'health_unavailable' });
      return reply.code(503).send({ status: 'unavailable' });
    }
    return { status: 'ok' };
  });
  function registerShop(
    apiPrefix,
    pagePrefix,
    storeConfig,
    storeCatalog,
    sandbox = false,
  ) {
    app.get(
      `${apiPrefix}/catalog`,
      { config: { rateLimit: { max: 120 } } },
      async (_request, reply) => {
        if (sandbox && !testShopAllowed)
          return reply.code(404).send(errorBody('見つかりません。'));
        try {
          return await storeCatalog.get();
        } catch {
          app.log.error({ event: 'catalog_unavailable' });
          return reply
            .code(503)
            .send(
              errorBody(
                '商品情報を取得できません。時間をおいてお試しください。',
              ),
            );
        }
      },
    );
    app.post(
      `${apiPrefix}/checkout`,
      {
        config: { rateLimit: { max: rateMax } },
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'catalogVersion'],
            properties: {
              catalogVersion: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              items: {
                type: 'array',
                minItems: 1,
                maxItems: 10,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['product', 'quantity'],
                  properties: {
                    product: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' },
                    quantity: { type: 'integer', minimum: 1, maximum: 10 },
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        if (sandbox && !testShopAllowed)
          return reply.code(404).send(errorBody('見つかりません。'));
        if (request.headers.origin !== storeConfig.siteUrl)
          return reply
            .code(403)
            .send(errorBody('ショップからもう一度お試しください。'));
        const token = request.headers['idempotency-key'];
        if (
          typeof token !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            token,
          )
        )
          return reply
            .code(400)
            .send(errorBody('ショップからもう一度お試しください。'));
        if (!storeConfig.salesEnabled)
          return reply.code(503).send(errorBody('ただいま販売準備中です。'));
        const items = [...request.body.items].sort((a, b) =>
          a.product.localeCompare(b.product),
        );
        const unique = new Set();
        let total = 0;
        const lines = [];
        for (const item of items) {
          const product = storeConfig.products.find(
            (p) => p.slug === item.product,
          );
          if (
            !product ||
            product.availability !== 'available' ||
            unique.has(item.product) ||
            item.quantity > product.maxQuantity
          )
            return reply
              .code(400)
              .send(errorBody('商品または数量を確認してください。'));
          unique.add(item.product);
          total += item.quantity;
          lines.push({ price: product.priceId, quantity: item.quantity });
        }
        if (total > 20)
          return reply
            .code(400)
            .send(errorBody('一度に購入できるのは合計20点までです。'));
        try {
          const current = await storeCatalog.get();
          if (request.body.catalogVersion !== current.version)
            return reply
              .code(409)
              .send(
                errorBody(
                  '商品情報が更新されました。カートを確認して、もう一度お試しください。',
                ),
              );
          const key =
            'gyaru-' +
            createHash('sha256')
              .update(
                JSON.stringify({
                  token,
                  lines,
                  version: current.version,
                  ...(sandbox ? { scope: apiPrefix } : {}),
                }),
              )
              .digest('hex');
          const session = await stripe.checkout.sessions.create(
            {
              mode: 'payment',
              locale: 'ja',
              line_items: lines,
              payment_method_types: ['card'],
              adaptive_pricing: { enabled: false },
              shipping_address_collection: { allowed_countries: ['JP'] },
              shipping_options: [{ shipping_rate: storeConfig.shippingRate }],
              success_url: `${storeConfig.siteUrl}${pagePrefix}/success/`,
              cancel_url: `${storeConfig.siteUrl}${pagePrefix}/cancel/`,
              metadata: {
                store: sandbox ? 'gyaruinthemix-test' : 'gyaruinthemix',
              },
              payment_intent_data: {
                metadata: {
                  store: sandbox ? 'gyaruinthemix-test' : 'gyaruinthemix',
                },
              },
            },
            { idempotencyKey: key },
          );
          if (
            sandbox &&
            (session.livemode !== false || !/^cs_test_/.test(session.id || ''))
          )
            throw new Error('Invalid test checkout session');
          const target = new URL(session.url);
          if (target.origin !== 'https://checkout.stripe.com')
            throw new Error('Invalid checkout destination');
          return { url: target.href, ...(sandbox ? { mode: 'test' } : {}) };
        } catch {
          app.log.error({ event: 'stripe_api_failure', requestId: request.id });
          return reply
            .code(503)
            .send(
              errorBody(
                '決済ページを開けませんでした。少し待ってから、もう一度お試しください。',
              ),
            );
        }
      },
    );
  }
  registerShop('/api', '/shop', config, catalog);
  if (testShopAllowed)
    registerShop('/api/test-shop', '/shop-test', testConfig, testCatalog, true);
  await app.register(async (webhook) => {
    webhook.removeContentTypeParser('application/json');
    webhook.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 262144 },
      (_request, body, done) => done(null, body),
    );
    webhook.post(
      '/api/stripe/webhook',
      { bodyLimit: 262144 },
      async (request, reply) => {
        let event;
        try {
          event = stripe.webhooks.constructEvent(
            request.body,
            request.headers['stripe-signature'],
            config.webhookSecret,
          );
        } catch {
          app.log.warn({
            event: 'webhook_verification_failure',
            requestId: request.id,
          });
          return reply.code(400).send(errorBody('Invalid signature'));
        }
        if (event.livemode !== (config.mode === 'live'))
          return reply.code(400).send(errorBody('Invalid event mode'));
        if (!supportedEvents.has(event.type)) return { received: true };
        const session = event.data?.object;
        const store = session?.metadata?.store;
        if (
          store !== 'gyaruinthemix' &&
          !(store === 'gyaruinthemix-test' && testShopAllowed)
        )
          return { received: true };
        if (
          !idPattern.test(event.id || '') ||
          !idPattern.test(session.id || '') ||
          session.object !== 'checkout.session'
        )
          return reply.code(400).send(errorBody('Invalid event'));
        let outcome = 'payment_pending';
        if (session.payment_status === 'paid') outcome = 'payment_received';
        else if (event.type === 'checkout.session.async_payment_failed')
          outcome = 'payment_failed';
        const scope = `${config.mode}:${session.id}`;
        const keys = [`event:${event.id}`, `${scope}:${outcome}`];
        const blockers =
          outcome === 'payment_received' ? [] : [`${scope}:payment_received`];
        try {
          if (await journal.claim(keys, blockers)) {
            const safe = {
              event: outcome,
              eventId: event.id,
              eventType: event.type,
              sessionId: session.id,
              mode: config.mode,
            };
            app.log.info(safe);
            if (observe) observe(safe);
          }
          return { received: true };
        } catch {
          app.log.error({
            event: 'webhook_journal_failure',
            requestId: request.id,
          });
          return reply.code(503).send(errorBody('Please retry later'));
        }
      },
    );
  });
  app.addHook('onClose', () => journal.close());
  app.decorate('validateCatalog', async () => {
    await catalog.get();
    if (testShopAllowed) await testCatalog.get();
  });
  return app;
}
