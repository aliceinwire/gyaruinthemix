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
const attemptPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const testSessionPattern = /^cs_test_[A-Za-z0-9_]{1,247}$/;
const testAttemptProof = (token) =>
  createHash('sha256')
    .update(`gyaruinthemix-test:checkout-v2:${token.toLowerCase()}`)
    .digest('hex');

function testSessionMatches(session, sessionId, token) {
  return (
    session?.id === sessionId &&
    testSessionPattern.test(sessionId) &&
    session.livemode === false &&
    session.mode === 'payment' &&
    session.metadata?.store === 'gyaruinthemix-test' &&
    session.metadata?.checkout_attempt === testAttemptProof(token)
  );
}

// Only confirmed, paid completion can clear a cart. A closed but unpaid
// Checkout stays pending; it must never receive a fresh payment URL.
function testSessionStatus(session) {
  if (session.status === 'complete') {
    if (session.payment_status === 'paid') return 'paid';
    if (['unpaid', 'no_payment_required'].includes(session.payment_status))
      return 'pending';
  }
  if (
    ['open', 'expired'].includes(session.status) &&
    session.payment_status === 'unpaid'
  )
    return session.status;
  throw new Error('Unverified test checkout status');
}
const englishErrors = Object.freeze({
  '処理できませんでした。時間をおいてお試しください。':
    'Something went wrong. Please try again later.',
  '少し時間をおいて、もう一度お試しください。':
    'Please wait a moment and try again.',
  '入力内容を確認してください。': 'Please check the information you entered.',
  '見つかりません。': 'Not found.',
  '商品情報を取得できません。時間をおいてお試しください。':
    'Product information is unavailable. Please try again later.',
  'ショップからもう一度お試しください。': 'Please try again from the shop.',
  'ページを再読み込みして、カートを確認してください。':
    'Please reload the page and review your bag.',
  'ただいま販売準備中です。': 'Sales are not open yet.',
  '商品または数量を確認してください。':
    'Please check the products and quantities.',
  '一度に購入できるのは合計20点までです。':
    'You can buy up to 20 items in one order.',
  '商品情報が更新されました。カートを確認して、もう一度お試しください。':
    'Product information has changed. Please review your bag and try again.',
  '決済ページを開けませんでした。少し待ってから、もう一度お試しください。':
    'Checkout could not be opened. Please wait a moment and try again.',
  '決済情報を確認できません。': 'Checkout information could not be verified.',
  '決済情報を確認できません。時間をおいてお試しください。':
    'Checkout information could not be verified. Please try again later.',
});
function errorLocale(request) {
  // The bounded header only chooses error copy. Checkout language comes from
  // the saved attempt's body.locale, so changing page language cannot alter it.
  const header = request?.headers['x-shop-locale'];
  if (header === 'en' || header === 'ja') return header;
  return request?.body?.locale === 'en' ? 'en' : 'ja';
}
const errorBody = (message, request) => ({
  error:
    errorLocale(request) === 'en' ? englishErrors[message] || message : message,
});

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
          request,
        ),
      );
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(errorBody('見つかりません。', request)),
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
      async (request, reply) => {
        if (sandbox && !testShopAllowed)
          return reply.code(404).send(errorBody('見つかりません。', request));
        try {
          return await storeCatalog.get();
        } catch {
          app.log.error({ event: 'catalog_unavailable' });
          return reply
            .code(503)
            .send(
              errorBody(
                '商品情報を取得できません。時間をおいてお試しください。',
                request,
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
              locale: { type: 'string', enum: ['ja', 'en'] },
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
          return reply.code(404).send(errorBody('見つかりません。', request));
        if (request.headers.origin !== storeConfig.siteUrl)
          return reply
            .code(403)
            .send(errorBody('ショップからもう一度お試しください。', request));
        const token = request.headers['idempotency-key'];
        if (typeof token !== 'string' || !attemptPattern.test(token))
          return reply
            .code(400)
            .send(errorBody('ショップからもう一度お試しください。', request));
        if (sandbox && request.headers['x-checkout-protocol'] !== '2')
          return reply
            .code(409)
            .send(
              errorBody(
                'ページを再読み込みして、カートを確認してください。',
                request,
              ),
            );
        if (!storeConfig.salesEnabled)
          return reply
            .code(503)
            .send(errorBody('ただいま販売準備中です。', request));
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
              .send(errorBody('商品または数量を確認してください。', request));
          unique.add(item.product);
          total += item.quantity;
          lines.push({ price: product.priceId, quantity: item.quantity });
        }
        if (total > 20)
          return reply
            .code(400)
            .send(errorBody('一度に購入できるのは合計20点までです。', request));
        try {
          const current = await storeCatalog.get();
          if (request.body.catalogVersion !== current.version)
            return reply
              .code(409)
              .send(
                errorBody(
                  '商品情報が更新されました。カートを確認して、もう一度お試しください。',
                  request,
                ),
              );
          const locale = request.body.locale === 'en' ? 'en' : 'ja';
          const returnPrefix =
            locale === 'en' ? `/en${pagePrefix}` : pagePrefix;
          // Locale is deliberately excluded: the same attempt cannot create a
          // second session after a language change. Stripe rejects changed
          // parameters for an existing key; the client preserves attempt locale.
          const key =
            (sandbox ? 'gyaru-test-v2-' : 'gyaru-') +
            createHash('sha256')
              .update(
                JSON.stringify({
                  token: sandbox ? token.toLowerCase() : token,
                  lines,
                  version: current.version,
                  ...(sandbox ? { scope: apiPrefix } : {}),
                }),
              )
              .digest('hex');
          const session = await stripe.checkout.sessions.create(
            {
              mode: 'payment',
              locale,
              line_items: lines,
              payment_method_types: ['card'],
              adaptive_pricing: { enabled: false },
              shipping_address_collection: { allowed_countries: ['JP'] },
              shipping_options: [{ shipping_rate: storeConfig.shippingRate }],
              success_url: `${storeConfig.siteUrl}${returnPrefix}/success/${sandbox ? '?session_id={CHECKOUT_SESSION_ID}' : ''}`,
              cancel_url: `${storeConfig.siteUrl}${returnPrefix}/cancel/`,
              metadata: {
                store: sandbox ? 'gyaruinthemix-test' : 'gyaruinthemix',
                ...(sandbox
                  ? { checkout_attempt: testAttemptProof(token) }
                  : {}),
              },
              payment_intent_data: {
                metadata: {
                  store: sandbox ? 'gyaruinthemix-test' : 'gyaruinthemix',
                },
              },
            },
            { idempotencyKey: key },
          );
          if (sandbox) {
            if (
              session.livemode !== false ||
              !testSessionPattern.test(session.id || '')
            )
              throw new Error('Invalid test checkout session');
            // Idempotent create returns its original cached response even after
            // payment or expiry. Retrieve current state before returning a URL.
            const currentSession = await stripe.checkout.sessions.retrieve(
              session.id,
            );
            if (!testSessionMatches(currentSession, session.id, token))
              throw new Error('Invalid test checkout scope');
            const result = {
              mode: 'test',
              sessionId: session.id,
              status: testSessionStatus(currentSession),
            };
            if (result.status !== 'open') return result;
            const target = new URL(currentSession.url);
            if (target.origin !== 'https://checkout.stripe.com')
              throw new Error('Invalid checkout destination');
            return { ...result, url: target.href };
          }
          const target = new URL(session.url);
          if (target.origin !== 'https://checkout.stripe.com')
            throw new Error('Invalid checkout destination');
          return { url: target.href };
        } catch {
          app.log.error({ event: 'stripe_api_failure', requestId: request.id });
          return reply
            .code(503)
            .send(
              errorBody(
                '決済ページを開けませんでした。少し待ってから、もう一度お試しください。',
                request,
              ),
            );
        }
      },
    );
    if (sandbox)
      app.post(
        `${apiPrefix}/checkout-status`,
        {
          config: { rateLimit: { max: rateMax } },
          schema: {
            body: {
              type: 'object',
              additionalProperties: false,
              required: ['sessionId', 'attemptId'],
              properties: {
                sessionId: {
                  type: 'string',
                  pattern: testSessionPattern.source,
                },
                attemptId: {
                  type: 'string',
                  pattern: attemptPattern.source,
                },
              },
            },
          },
        },
        async (request, reply) => {
          if (!testShopAllowed)
            return reply.code(404).send(errorBody('見つかりません。', request));
          if (request.headers.origin !== storeConfig.siteUrl)
            return reply
              .code(403)
              .send(errorBody('ショップからもう一度お試しください。', request));
          const { sessionId, attemptId } = request.body;
          try {
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            if (!testSessionMatches(session, sessionId, attemptId))
              return reply
                .code(404)
                .send(errorBody('決済情報を確認できません。', request));
            return {
              mode: 'test',
              sessionId,
              status: testSessionStatus(session),
            };
          } catch {
            app.log.error({
              event: 'checkout_status_unavailable',
              requestId: request.id,
            });
            return reply
              .code(503)
              .send(
                errorBody(
                  '決済情報を確認できません。時間をおいてお試しください。',
                  request,
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
