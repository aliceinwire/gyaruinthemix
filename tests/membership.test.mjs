import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMembership } from '../api/membership.mjs';

const accountId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
function fixture(overrides = {}) {
  const db = overrides.db || new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE IF NOT EXISTS member_accounts (id TEXT PRIMARY KEY, mode TEXT, email TEXT)',
  );
  db.prepare('INSERT OR IGNORE INTO member_accounts VALUES (?, ?, ?)').run(
    accountId,
    'test',
    'member@example.com',
  );
  const config = {
    mode: 'test',
    siteUrl: 'https://example.com',
    membershipEnabled: true,
    membershipPriceId: 'price_monthly',
    ...overrides.config,
  };
  const price = {
    id: 'price_monthly',
    active: true,
    livemode: false,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    currency: 'jpy',
    unit_amount: 500,
    billing_scheme: 'per_unit',
    tax_behavior: 'inclusive',
    product: { active: true },
  };
  const sub = {
    id: 'sub_member',
    object: 'subscription',
    livemode: false,
    metadata: {
      store: 'gyaruinthemix-membership',
      membership_account_id: accountId,
    },
    customer: 'cus_member',
    status: 'active',
    cancel_at_period_end: false,
    items: {
      data: [
        {
          quantity: 1,
          price: { id: 'price_monthly' },
          current_period_end: 2000000000,
        },
      ],
    },
  };
  const calls = { creates: [], retrieves: 0 };
  let session;
  const stripe = {
    prices: { retrieve: async () => price },
    checkout: {
      sessions: {
        create: async (params, opts) => {
          calls.creates.push({ params, opts });
          session = {
            id: 'cs_test_member',
            mode: 'subscription',
            livemode: false,
            status: 'open',
            url: 'https://checkout.stripe.com/c/pay/example',
            metadata: params.metadata,
          };
          return session;
        },
        retrieve: async () => session,
      },
    },
    subscriptions: {
      retrieve: async () => {
        calls.retrieves++;
        return sub;
      },
    },
  };
  const membership = createMembership({
    config,
    stripe,
    db,
    now: overrides.now,
  });
  return {
    db,
    config,
    price,
    sub,
    stripe,
    calls,
    membership,
    setSession(value) {
      session = value;
    },
  };
}
const event = (type = 'customer.subscription.updated', object) => ({
  id: 'evt_update',
  type,
  livemode: false,
  data: {
    object: object || {
      id: 'sub_member',
      object: 'subscription',
      metadata: { store: 'gyaruinthemix-membership' },
      status: 'past_due',
    },
  },
});

test('disabled has no advertised price and makes no price call', async () => {
  const f = fixture({
    config: { membershipEnabled: false, membershipPriceId: '' },
  });
  f.stripe.prices.retrieve = () => {
    throw new Error('must not call');
  };
  assert.deepEqual(await f.membership.getPlan(), {
    enabled: false,
    mode: 'test',
    plan: null,
    portalUrl: null,
  });
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'member@example.com',
      attemptId,
    }),
    {
      code: 'MEMBERSHIP_DISABLED',
    },
  );
  f.db.close();
});
test('validates monthly recurring price separately from merchandise, default 500 JPY', async () => {
  for (const change of [
    { type: 'one_time' },
    { livemode: true },
    { unit_amount: 501 },
    { active: false },
    {
      recurring: {
        interval: 'year',
        interval_count: 1,
        usage_type: 'licensed',
      },
    },
    {
      recurring: {
        interval: 'month',
        interval_count: 1,
        usage_type: 'metered',
      },
    },
  ]) {
    const f = fixture();
    Object.assign(f.price, change);
    await assert.rejects(f.membership.getPlan(), {
      code: 'MEMBERSHIP_PRICE_INVALID',
    });
    f.db.close();
  }
  const f = fixture({ config: { membershipAmountJPY: 700 } });
  f.price.unit_amount = 700;
  assert.equal((await f.membership.getPlan()).plan.amount, 700);
  f.db.close();
});
test('authenticated immutable idempotency, concurrent retries and terminal checkout', async () => {
  const f = fixture();
  const planVersion = (await f.membership.getPlan()).version;
  await assert.rejects(f.membership.checkout({ attemptId, planVersion }), {
    code: 'MEMBERSHIP_AUTH_REQUIRED',
  });
  const input = {
    accountId,
    accountEmail: 'member@example.com',
    attemptId,
    planVersion,
    locale: 'en',
  };
  const results = await Promise.all([
    f.membership.checkout(input),
    f.membership.checkout({ ...input, locale: 'ja' }),
  ]);
  assert.equal(f.calls.creates.length, 1);
  assert.equal(results[0].url, results[1].url);
  const params = f.calls.creates[0].params;
  assert.equal(params.mode, 'subscription');
  assert.equal(params.locale, 'en');
  assert.equal(
    params.subscription_data.metadata.membership_account_id,
    accountId,
  );
  assert.equal(params.shipping_options, undefined);
  f.setSession({
    ...params,
    id: 'cs_test_member',
    livemode: false,
    status: 'complete',
  });
  assert.equal((await f.membership.checkout(input)).url, undefined);
  f.db.close();
});
test('expired Stripe idempotency window blocks unknown result and new attempts', async () => {
  let time = 0;
  const f = fixture({ now: () => time });
  const planVersion = (await f.membership.getPlan()).version;
  f.stripe.checkout.sessions.create = async () => {
    throw new Error('network timeout');
  };
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'member@example.com',
      attemptId,
      planVersion,
    }),
  );
  time = 24 * 60 * 60 * 1000;
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'member@example.com',
      attemptId,
      planVersion,
    }),
    { code: 'MEMBERSHIP_ATTEMPT_REQUIRES_REVIEW' },
  );
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'member@example.com',
      attemptId: '33333333-3333-4333-8333-333333333333',
      planVersion,
    }),
    { code: 'MEMBERSHIP_ATTEMPT_REQUIRES_REVIEW' },
  );
  f.db.close();
});
test('duplicate and stale webhook snapshots retrieve current state; cancellation revokes', async () => {
  const f = fixture();
  await f.membership.handleWebhook(event());
  assert.equal((await f.membership.entitlement(accountId)).entitled, true);
  f.sub.status = 'canceled';
  await f.membership.handleWebhook(event());
  assert.equal((await f.membership.entitlement(accountId)).entitled, false);
  assert.equal(f.calls.retrieves, 4);
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM membership_subscriptions').get().n,
    1,
  );
  await assert.rejects(
    f.membership.handleWebhook({ ...event(), livemode: true }),
    { code: 'MEMBERSHIP_EVENT_MODE_INVALID' },
  );
  f.db.close();
});
test('renewal failure/action-required events reconcile and fail closed on Stripe error', async () => {
  const f = fixture();
  f.sub.status = 'past_due';
  await f.membership.handleWebhook(
    event('invoice.payment_failed', {
      object: 'invoice',
      parent: { subscription_details: { subscription: 'sub_member' } },
    }),
  );
  assert.equal((await f.membership.entitlement(accountId)).entitled, false);
  f.sub.status = 'active';
  await f.membership.handleWebhook(
    event('invoice.paid', { object: 'invoice', subscription: 'sub_member' }),
  );
  f.stripe.subscriptions.retrieve = async () => {
    throw new Error('offline');
  };
  await assert.rejects(f.membership.entitlement(accountId), /offline/);
  f.db.close();
});
test('active subscriptions block a second checkout and account rebinding is rejected', async () => {
  const f = fixture();
  await f.membership.handleWebhook(event());
  const planVersion = (await f.membership.getPlan()).version;
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'member@example.com',
      attemptId,
      planVersion,
    }),
    { code: 'MEMBERSHIP_ALREADY_SUBSCRIBED' },
  );
  f.sub.metadata.membership_account_id = attemptId;
  await assert.rejects(f.membership.entitlement(accountId), {
    code: 'MEMBERSHIP_SUBSCRIPTION_INVALID',
  });
  f.db.close();
});
test('durable SQLite state survives reopen and stays separated by mode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'membership-'));
  const file = join(dir, 'state.sqlite');
  try {
    const f = fixture({ db: new DatabaseSync(file) });
    await f.membership.handleWebhook(event());
    f.db.close();
    const g = fixture({ db: new DatabaseSync(file) });
    assert.equal((await g.membership.entitlement(accountId)).entitled, true);
    const live = createMembership({
      config: { mode: 'live', membershipEnabled: false },
      stripe: g.stripe,
      db: g.db,
    });
    assert.equal((await live.entitlement(accountId)).entitled, false);
    g.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('portal accepts only mode-matching Stripe hosted login URLs', () => {
  for (const membershipPortalUrl of [
    'https://evil.example/p/login/test_x',
    'https://billing.stripe.com/p/login/liveexample',
    'https://billing.stripe.com/p/login/test_abc?prefilled_email=private@example.com',
  ]) {
    assert.throws(
      () => fixture({ config: { membershipPortalUrl } }),
      /Invalid membership portal/,
    );
  }
  const f = fixture({
    config: {
      membershipPortalUrl: 'https://billing.stripe.com/p/login/test_abc',
    },
  });
  f.db.close();
});

test('separate instances cannot create different subscriptions for one account concurrently', async () => {
  const f = fixture();
  const other = createMembership({
    config: f.config,
    stripe: f.stripe,
    db: f.db,
  });
  const planVersion = (await f.membership.getPlan()).version;
  const input = {
    accountId,
    accountEmail: 'member@example.com',
    attemptId,
    planVersion,
  };
  const result = await Promise.allSettled([
    f.membership.checkout(input),
    other.checkout({
      ...input,
      attemptId: '33333333-3333-4333-8333-333333333333',
    }),
  ]);
  assert.equal(result.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(f.calls.creates.length, 1);
  f.db.close();
});
test('same attempt across separate instances uses original persisted parameters', async () => {
  const f = fixture();
  const other = createMembership({
    config: f.config,
    stripe: f.stripe,
    db: f.db,
  });
  const planVersion = (await f.membership.getPlan()).version;
  const input = {
    accountId,
    accountEmail: 'member@example.com',
    attemptId,
    planVersion,
    locale: 'en',
  };
  await Promise.all([
    f.membership.checkout(input),
    other.checkout({ ...input, locale: 'ja' }),
  ]);
  for (const call of f.calls.creates) {
    assert.deepEqual(call, f.calls.creates[0]);
    assert.equal(call.params.customer_email, 'member@example.com');
  }
  f.db.close();
});
test('unverified or unknown account cannot check out or gain membership', async () => {
  const f = fixture();
  const planVersion = (await f.membership.getPlan()).version;
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'attacker@example.com',
      attemptId,
      planVersion,
    }),
    { code: 'MEMBERSHIP_AUTH_REQUIRED' },
  );
  f.sub.metadata.membership_account_id = attemptId;
  await assert.rejects(f.membership.handleWebhook(event()), {
    code: 'MEMBERSHIP_SUBSCRIPTION_INVALID',
  });
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM membership_subscriptions').get().n,
    0,
  );
  f.db.close();
});
test('past period, trial and collection pause deny access; end-of-period cancellation keeps paid access', async () => {
  const f = fixture();
  await f.membership.handleWebhook(event());
  f.sub.cancel_at_period_end = true;
  assert.equal((await f.membership.entitlement(accountId)).entitled, true);
  f.sub.items.data[0].current_period_end = 1;
  assert.equal((await f.membership.entitlement(accountId)).entitled, false);
  f.sub.items.data[0].current_period_end = 2000000000;
  f.sub.status = 'trialing';
  assert.equal((await f.membership.entitlement(accountId)).entitled, false);
  f.sub.status = 'active';
  f.sub.pause_collection = { behavior: 'void' };
  assert.equal((await f.membership.entitlement(accountId)).entitled, false);
  f.db.close();
});

test('paid Checkout without any webhook is reconciled on authenticated content access', async () => {
  const f = fixture();
  const planVersion = (await f.membership.getPlan()).version;
  const input = {
    accountId,
    accountEmail: 'member@example.com',
    attemptId,
    planVersion,
  };
  await f.membership.checkout(input);
  f.setSession({
    id: 'cs_test_member',
    livemode: false,
    mode: 'subscription',
    status: 'complete',
    subscription: 'sub_member',
    metadata: f.calls.creates[0].params.metadata,
  });
  assert.equal((await f.membership.entitlement(accountId)).entitled, true);
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM membership_subscriptions').get().n,
    1,
  );
  f.db.close();
});
test('plan change is typed only before an attempt exists, never drops an uncertain result', async () => {
  const f = fixture();
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'member@example.com',
      attemptId,
      planVersion: '0'.repeat(64),
    }),
    { code: 'MEMBERSHIP_PLAN_CHANGED' },
  );
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM membership_attempts').get().n,
    0,
  );
  const planVersion = (await f.membership.getPlan()).version;
  await f.membership.checkout({
    accountId,
    accountEmail: 'member@example.com',
    attemptId,
    planVersion,
  });
  await assert.rejects(
    f.membership.checkout({
      accountId,
      accountEmail: 'member@example.com',
      attemptId,
      planVersion: '0'.repeat(64),
    }),
    { code: 'MEMBERSHIP_ATTEMPT_CONFLICT' },
  );
  f.db.close();
});
