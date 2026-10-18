import { createHash } from 'node:crypto';

const STORE = 'gyaruinthemix-membership';
const ATTEMPT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',
]);
const STATUSES = new Set([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const objectId = (value) => (typeof value === 'string' ? value : value?.id);
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};

// A private status ledger keyed to verified, server-supplied member accounts.
// The application owns the database lifecycle and runs a single API process.
export function createMembership({ config, stripe, db, now = Date.now }) {
  if (!db) throw new Error('Membership requires durable storage');
  if (!['test', 'live'].includes(config.mode))
    throw new Error('Invalid membership mode');
  const mode = config.mode;
  const live = mode === 'live';
  const enabled = config.membershipEnabled === true;
  if (enabled && !/^price_[A-Za-z0-9]+$/.test(config.membershipPriceId || ''))
    throw new Error('A recurring membership price is required');
  let portalUrl = null;
  if (config.membershipPortalUrl) {
    const url = new URL(config.membershipPortalUrl);
    if (
      url.origin !== 'https://billing.stripe.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/p\/login\/(?:test_)?[A-Za-z0-9]+$/.test(url.pathname) ||
      url.pathname.includes('/test_') === live
    )
      throw new Error('Invalid membership portal login URL');
    portalUrl = url.href;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS membership_account_checkout (
      mode TEXT NOT NULL, account_id TEXT NOT NULL, attempt_hash TEXT NOT NULL,
      PRIMARY KEY(mode, account_id)
    );
    CREATE TABLE IF NOT EXISTS membership_attempts (
      mode TEXT NOT NULL, attempt_hash TEXT NOT NULL, account_id TEXT NOT NULL, plan_version TEXT NOT NULL,
      parameters TEXT NOT NULL, created_ms INTEGER NOT NULL, session_id TEXT,
      PRIMARY KEY (mode, attempt_hash)
    );
    CREATE TABLE IF NOT EXISTS membership_subscriptions (
      mode TEXT NOT NULL, subscription_id TEXT NOT NULL, account_id TEXT NOT NULL, customer_id TEXT NOT NULL, price_id TEXT NOT NULL,
      status TEXT NOT NULL, cancel_at_period_end INTEGER NOT NULL,
      current_period_end INTEGER, refreshed_ms INTEGER NOT NULL, last_event_id TEXT NOT NULL,
      PRIMARY KEY (mode, subscription_id)
    );
  `);
  const attempts = new Map();
  const refreshes = new Map();
  function serialized(map, key, work) {
    const previous = map.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    map.set(key, task);
    task
      .finally(() => {
        if (map.get(key) === task) map.delete(key);
      })
      .catch(() => {});
    return task;
  }
  async function getPlan() {
    if (!enabled) return { enabled: false, mode, plan: null, portalUrl };
    const price = await stripe.prices.retrieve(config.membershipPriceId, {
      expand: ['product'],
    });
    if (
      price.id !== config.membershipPriceId ||
      !price.active ||
      price.livemode !== live ||
      price.type !== 'recurring' ||
      price.recurring?.interval !== 'month' ||
      price.recurring?.interval_count !== 1 ||
      price.recurring?.usage_type !== 'licensed' ||
      price.recurring?.trial_period_days ||
      price.currency !== 'jpy' ||
      price.billing_scheme !== 'per_unit' ||
      price.custom_unit_amount ||
      !Number.isSafeInteger(price.unit_amount) ||
      price.unit_amount !== (config.membershipAmountJPY ?? 500) ||
      !price.product?.active ||
      price.product?.deleted
    )
      fail('MEMBERSHIP_PRICE_INVALID');
    const plan = {
      amount: price.unit_amount,
      currency: price.currency,
      interval: 'month',
      intervalCount: 1,
      taxBehavior: price.tax_behavior || 'unspecified',
    };
    return {
      enabled: true,
      mode,
      plan,
      portalUrl,
      version: hash(JSON.stringify({ mode, priceId: price.id, ...plan })),
    };
  }
  function verifySession(session, attemptHash) {
    if (
      !session ||
      !new RegExp(`^cs_${live ? 'live' : 'test'}_[A-Za-z0-9_]+$`).test(
        session.id || '',
      ) ||
      session.livemode !== live ||
      session.mode !== 'subscription' ||
      session.metadata?.store !== STORE ||
      session.metadata?.checkout_attempt !== attemptHash
    )
      fail('MEMBERSHIP_SESSION_INVALID');
    if (!['open', 'complete', 'expired'].includes(session.status))
      fail('MEMBERSHIP_SESSION_INVALID');
    const response = { mode, sessionId: session.id, status: session.status };
    // Complete means Checkout closed, not membership entitlement or payment success.
    if (session.status === 'open') {
      const url = new URL(session.url);
      if (
        url.origin !== 'https://checkout.stripe.com' ||
        url.username ||
        url.password
      )
        fail('MEMBERSHIP_SESSION_INVALID');
      response.url = url.href;
    }
    return response;
  }
  async function checkout({
    attemptId,
    planVersion,
    locale = 'ja',
    accountId,
    accountEmail,
  }) {
    if (!enabled) fail('MEMBERSHIP_DISABLED');
    if (!ATTEMPT.test(accountId || '')) fail('MEMBERSHIP_AUTH_REQUIRED');
    const verified = db
      .prepare('SELECT email FROM member_accounts WHERE mode = ? AND id = ?')
      .get(mode, accountId);
    if (!verified || verified.email !== accountEmail)
      fail('MEMBERSHIP_AUTH_REQUIRED');
    if (
      !ATTEMPT.test(attemptId || '') ||
      !['ja', 'en'].includes(locale) ||
      !/^[a-f0-9]{64}$/.test(planVersion || '')
    )
      fail('MEMBERSHIP_INPUT_INVALID');
    const attemptHash = hash(
      `${STORE}:${mode}:${accountId}:${attemptId.toLowerCase()}`,
    );
    return serialized(attempts, accountId, async () => {
      let row = db
        .prepare(
          'SELECT * FROM membership_attempts WHERE mode = ? AND attempt_hash = ?',
        )
        .get(mode, attemptHash);
      if (row && row.plan_version !== planVersion)
        fail('MEMBERSHIP_ATTEMPT_CONFLICT');
      if (row?.session_id) {
        const session = await stripe.checkout.sessions.retrieve(row.session_id);
        if (session.id !== row.session_id) fail('MEMBERSHIP_SESSION_INVALID');
        const result = verifySession(session, attemptHash);
        if (session.status === 'complete' && objectId(session.subscription))
          await refreshSubscription(
            objectId(session.subscription),
            'checkout_reconcile',
          );
        return result;
      }
      // Stripe may prune idempotency keys after 24h. Unknown results must be
      // reconciled by an operator rather than silently starting another charge.
      if (row && now() - row.created_ms >= 23 * 60 * 60 * 1000)
        fail('MEMBERSHIP_ATTEMPT_REQUIRES_REVIEW');
      if (!row) {
        const guard = db
          .prepare(
            'SELECT attempt_hash FROM membership_account_checkout WHERE mode = ? AND account_id = ?',
          )
          .get(mode, accountId);
        const access = await entitlement(accountId);
        if (access.entitled || access.hasSubscription)
          fail('MEMBERSHIP_ALREADY_SUBSCRIBED');
        const others = db
          .prepare(
            'SELECT * FROM membership_attempts WHERE mode = ? AND account_id = ?',
          )
          .all(mode, accountId);
        for (const other of others) {
          if (!other.session_id) fail('MEMBERSHIP_ATTEMPT_REQUIRES_REVIEW');
          const prior = await stripe.checkout.sessions.retrieve(
            other.session_id,
          );
          verifySession(prior, other.attempt_hash);
          if (prior.status === 'open') fail('MEMBERSHIP_CHECKOUT_ALREADY_OPEN');
          if (prior.status === 'complete') {
            const id = objectId(prior.subscription);
            if (!id) fail('MEMBERSHIP_ATTEMPT_REQUIRES_REVIEW');
            await refreshSubscription(id, 'checkout_reconcile');
            if ((await entitlement(accountId)).hasSubscription)
              fail('MEMBERSHIP_ALREADY_SUBSCRIBED');
          }
        }
        const current = await getPlan();
        if (current.version !== planVersion) fail('MEMBERSHIP_PLAN_CHANGED');
        const prefix = locale === 'en' ? '/en/fanclub' : '/fanclub';
        const metadata = {
          store: STORE,
          checkout_attempt: attemptHash,
          membership_account_id: accountId,
        };
        const knownCustomer = db
          .prepare(
            'SELECT customer_id FROM membership_subscriptions WHERE mode = ? AND account_id = ? ORDER BY refreshed_ms DESC LIMIT 1',
          )
          .get(mode, accountId);
        const parameters = {
          mode: 'subscription',
          locale,
          ...(knownCustomer
            ? { customer: knownCustomer.customer_id }
            : { customer_email: verified.email }),
          line_items: [{ price: config.membershipPriceId, quantity: 1 }],
          payment_method_types: ['card'],
          adaptive_pricing: { enabled: false },
          success_url: `${config.siteUrl}${prefix}/?checkout=complete`,
          cancel_url: `${config.siteUrl}${prefix}/?checkout=cancelled`,
          metadata,
          subscription_data: { metadata },
        };
        // A durable compare-and-swap serializes new attempts even if two
        // API instances share this SQLite database. No lease expiry can turn
        // an uncertain checkout result into a second subscription.
        db.exec('BEGIN IMMEDIATE');
        try {
          const locked = db
            .prepare(
              'SELECT attempt_hash FROM membership_account_checkout WHERE mode = ? AND account_id = ?',
            )
            .get(mode, accountId);
          if (
            locked &&
            locked.attempt_hash !== attemptHash &&
            locked.attempt_hash !== guard?.attempt_hash
          )
            fail('MEMBERSHIP_CHECKOUT_ALREADY_OPEN');
          db.prepare(
            `INSERT INTO membership_account_checkout VALUES (?, ?, ?)
            ON CONFLICT(mode,account_id) DO UPDATE SET attempt_hash=excluded.attempt_hash`,
          ).run(mode, accountId, attemptHash);
          db.prepare(
            `INSERT OR IGNORE INTO membership_attempts
            (mode, attempt_hash, account_id, plan_version, parameters, created_ms) VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            mode,
            attemptHash,
            accountId,
            planVersion,
            JSON.stringify(parameters),
            now(),
          );
          row = db
            .prepare(
              'SELECT * FROM membership_attempts WHERE mode = ? AND attempt_hash = ?',
            )
            .get(mode, attemptHash);
          if (row.plan_version !== planVersion)
            fail('MEMBERSHIP_ATTEMPT_CONFLICT');
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      const created = await stripe.checkout.sessions.create(
        JSON.parse(row.parameters),
        {
          idempotencyKey: `gyaru-membership-${mode}-${attemptHash}`,
        },
      );
      // Persist the identifier before a second network call, including when the
      // create response is stale from an earlier idempotent request.
      if (
        created.livemode !== live ||
        created.mode !== 'subscription' ||
        !new RegExp(`^cs_${live ? 'live' : 'test'}_[A-Za-z0-9_]+$`).test(
          created.id || '',
        )
      )
        fail('MEMBERSHIP_SESSION_INVALID');
      db.prepare(
        'UPDATE membership_attempts SET session_id = ? WHERE mode = ? AND attempt_hash = ?',
      ).run(created.id, mode, attemptHash);
      const session = await stripe.checkout.sessions.retrieve(created.id);
      if (session.id !== created.id) fail('MEMBERSHIP_SESSION_INVALID');
      return verifySession(session, attemptHash);
    });
  }
  async function handleWebhook(event) {
    if (!EVENTS.has(event.type)) return false;
    if (event.livemode !== live) fail('MEMBERSHIP_EVENT_MODE_INVALID');
    if (!/^evt_[A-Za-z0-9_]{1,251}$/.test(event.id || ''))
      fail('MEMBERSHIP_EVENT_INVALID');
    const object = event.data?.object;
    let subscriptionId;
    if (event.type.startsWith('customer.subscription.')) {
      if (object?.object !== 'subscription') fail('MEMBERSHIP_EVENT_INVALID');
      if (object.metadata?.store !== STORE) return false;
      subscriptionId = object.id;
    } else if (event.type.startsWith('checkout.session.')) {
      if (object?.metadata?.store !== STORE) return false;
      if (
        object.object !== 'checkout.session' ||
        object.mode !== 'subscription'
      )
        fail('MEMBERSHIP_EVENT_INVALID');
      subscriptionId = objectId(object.subscription);
      if (!subscriptionId) return true;
    } else {
      if (object?.object !== 'invoice') fail('MEMBERSHIP_EVENT_INVALID');
      subscriptionId = objectId(
        object.parent?.subscription_details?.subscription ||
          object.subscription,
      );
      if (!subscriptionId) return false;
    }
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId || ''))
      fail('MEMBERSHIP_EVENT_INVALID');
    return refreshSubscription(subscriptionId, event.id);
  }
  async function refreshSubscription(subscriptionId, eventId) {
    return serialized(refreshes, subscriptionId, async () => {
      // Never apply the event snapshot: retries and out-of-order events retrieve
      // current Stripe state, inside the same serialized refresh operation.
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (
        sub.id !== subscriptionId ||
        sub.object !== 'subscription' ||
        sub.livemode !== live
      )
        fail('MEMBERSHIP_SUBSCRIPTION_INVALID');
      if (sub.metadata?.store !== STORE) return false;
      const accountId = sub.metadata.membership_account_id;
      const customerId = objectId(sub.customer);
      if (
        !ATTEMPT.test(accountId || '') ||
        !/^cus_[A-Za-z0-9]+$/.test(customerId || '')
      )
        fail('MEMBERSHIP_SUBSCRIPTION_INVALID');
      if (
        !db
          .prepare('SELECT id FROM member_accounts WHERE mode = ? AND id = ?')
          .get(mode, accountId)
      )
        fail('MEMBERSHIP_SUBSCRIPTION_INVALID');
      const existing = db
        .prepare(
          'SELECT account_id FROM membership_subscriptions WHERE mode = ? AND subscription_id = ?',
        )
        .get(mode, sub.id);
      if (existing && existing.account_id !== accountId)
        fail('MEMBERSHIP_SUBSCRIPTION_INVALID');
      const items = sub.items?.data;
      if (
        !STATUSES.has(sub.status) ||
        !Array.isArray(items) ||
        items.length !== 1 ||
        sub.items.has_more ||
        items[0].quantity !== 1 ||
        !/^price_[A-Za-z0-9]+$/.test(items[0].price?.id || '') ||
        typeof sub.cancel_at_period_end !== 'boolean'
      )
        fail('MEMBERSHIP_SUBSCRIPTION_INVALID');
      // Preserve historical membership prices across a configured price change.
      // Metadata scopes ownership to a verified application account.
      const end = items[0].current_period_end ?? sub.current_period_end ?? null;
      if (end !== null && (!Number.isSafeInteger(end) || end < 0))
        fail('MEMBERSHIP_SUBSCRIPTION_INVALID');
      db.prepare(
        `INSERT INTO membership_subscriptions
        (mode, subscription_id, account_id, customer_id, price_id, status, cancel_at_period_end, current_period_end, refreshed_ms, last_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mode, subscription_id) DO UPDATE SET
          customer_id=excluded.customer_id, price_id=excluded.price_id, status=excluded.status,
          cancel_at_period_end=excluded.cancel_at_period_end,
          current_period_end=excluded.current_period_end, refreshed_ms=excluded.refreshed_ms,
          last_event_id=excluded.last_event_id`,
      ).run(
        mode,
        sub.id,
        accountId,
        customerId,
        items[0].price.id,
        sub.pause_collection ? 'paused' : sub.status,
        Number(sub.cancel_at_period_end),
        end,
        now(),
        eventId,
      );
      return true;
    });
  }
  async function entitlement(accountId) {
    if (!ATTEMPT.test(accountId || '')) fail('MEMBERSHIP_AUTH_REQUIRED');
    const saved = db
      .prepare(
        'SELECT attempt_hash, session_id FROM membership_attempts WHERE mode = ? AND account_id = ? AND session_id IS NOT NULL',
      )
      .all(mode, accountId);
    for (const row of saved) {
      const session = await stripe.checkout.sessions.retrieve(row.session_id);
      if (session.id !== row.session_id) fail('MEMBERSHIP_SESSION_INVALID');
      verifySession(session, row.attempt_hash);
      if (session.status === 'complete' && objectId(session.subscription))
        await refreshSubscription(
          objectId(session.subscription),
          'access_checkout_reconcile',
        );
    }
    const rows = db
      .prepare(
        'SELECT subscription_id FROM membership_subscriptions WHERE mode = ? AND account_id = ?',
      )
      .all(mode, accountId);
    for (const row of rows)
      await refreshSubscription(row.subscription_id, 'access_refresh');
    const current = db
      .prepare(
        'SELECT status, current_period_end FROM membership_subscriptions WHERE mode = ? AND account_id = ?',
      )
      .all(mode, accountId);
    return {
      entitled: current.some(
        (row) =>
          row.status === 'active' &&
          row.current_period_end > Math.floor(now() / 1000),
      ),
      hasSubscription: current.some(
        (row) => !['canceled', 'incomplete_expired'].includes(row.status),
      ),
    };
  }
  return {
    entitlement,
    getPlan,
    checkout,
    handleWebhook,
    healthy() {
      try {
        db.prepare('SELECT 1 FROM membership_attempts LIMIT 1').get();
        return true;
      } catch {
        return false;
      }
    },
  };
}
