import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(
  new URL('../src/scripts/membership.js', import.meta.url),
  'utf8',
);
function harness(checkoutResponse) {
  const elements = new Map();
  const element = () => ({
    hidden: false,
    disabled: false,
    textContent: '',
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    replaceChildren() {},
    append() {},
  });
  const panel = {
    dataset: { locale: 'en' },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
  };
  const stored = new Map([
    [
      'gyaru-membership-attempt-v1',
      JSON.stringify({
        id: '22222222-2222-4222-8222-222222222222',
        version: 'a'.repeat(64),
        locale: 'en',
        plan: { amount: 500, taxBehavior: 'inclusive' },
      }),
    ],
  ]);
  const requests = [];
  const currentPlan = {
    enabled: true,
    mode: 'test',
    plan: { amount: 700, taxBehavior: 'inclusive' },
    version: 'b'.repeat(64),
  };
  const listeners = {};
  const context = {
    window: {
      addEventListener(name, handler) {
        listeners[name] = handler;
      },
    },
    document: {
      querySelector: () => panel,
      createElement: element,
      visibilityState: 'visible',
      addEventListener(name, handler) {
        listeners[name] = handler;
      },
    },
    location: {
      hash: '',
      pathname: '/en/fanclub/',
      search: '',
      origin: 'https://example.com',
      assign() {},
    },
    history: { replaceState() {} },
    URL,
    URLSearchParams,
    Intl,
    crypto: { randomUUID: () => '33333333-3333-4333-8333-333333333333' },
    sessionStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, val) => stored.set(key, val),
      removeItem: (key) => stored.delete(key),
    },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/membership/plan')
        return { ok: true, json: async () => currentPlan };
      if (path === '/api/member/session')
        return {
          ok: true,
          json: async () => ({
            authenticated: true,
            member: false,
            email: 'member@example.com',
          }),
        };
      if (path === '/api/membership/checkout') return checkoutResponse();
      throw new Error(`Unexpected path ${path}`);
    },
  };
  runInNewContext(source, context);
  return {
    get: (name) => elements.get(`[data-${name}]`),
    stored,
    requests,
    listeners,
    context,
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test('expired saved checkout redraws latest fee before allowing a fresh attempt', async () => {
  const h = harness(() => ({
    ok: true,
    json: async () => ({ status: 'expired' }),
  }));
  await settle();
  assert.match(h.get('member-price').textContent, /500/);
  await h.get('member-join').listeners.click();
  assert.match(h.get('member-price').textContent, /700/);
  assert.match(
    h.get('membership-status').textContent,
    /Review the current monthly fee/,
  );
  assert.equal(h.stored.size, 0);
  await h.get('member-join').listeners.click();
  const calls = h.requests.filter(
    (call) => call.path === '/api/membership/checkout',
  );
  assert.equal(JSON.parse(calls[1].options.body).planVersion, 'b'.repeat(64));
});
test('only explicitly uncreated stale-plan error clears pending attempt', async () => {
  const stale = harness(() => ({
    ok: false,
    json: async () => ({ code: 'MEMBERSHIP_PLAN_CHANGED' }),
  }));
  await settle();
  await stale.get('member-join').listeners.click();
  assert.equal(stale.stored.size, 0);
  assert.match(stale.get('member-price').textContent, /700/);
  const uncertain = harness(() => ({
    ok: false,
    json: async () => ({ code: 'MEMBERSHIP_ATTEMPT_REQUIRES_REVIEW' }),
  }));
  await settle();
  await uncertain.get('member-join').listeners.click();
  assert.equal(uncertain.stored.size, 1);
});

test('pagehide clears private content and discards an in-flight private response', async () => {
  const h = harness(() => ({
    ok: true,
    json: async () => ({ status: 'expired' }),
  }));
  const original = h.context.fetch;
  let release;
  h.context.fetch = async (path, options) => {
    if (path === '/api/member/session')
      return {
        ok: true,
        json: async () => ({
          authenticated: true,
          member: true,
          email: 'member@example.com',
        }),
      };
    if (path === '/api/member/posts')
      return {
        ok: true,
        json: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      };
    return original(path, options);
  };
  await settle();
  assert.equal(typeof release, 'function');
  h.listeners.pagehide();
  release({
    posts: [
      {
        title: 'Private',
        body: 'Secret',
        publishedAt: '2026-10-18',
        assets: [],
      },
    ],
  });
  await settle();
  assert.equal(h.get('member-feed').hidden, true);
  h.listeners.pageshow({ persisted: true });
  await settle();
  release({ posts: [] });
  await settle();
  assert.equal(h.get('member-feed').hidden, false);
  h.context.document.visibilityState = 'hidden';
  h.listeners.visibilitychange();
  assert.equal(h.get('member-feed').hidden, true);
});

test('failed pricing refresh after expiry cannot enable a fresh checkout with stale displayed terms', async () => {
  const h = harness(() => ({
    ok: true,
    json: async () => ({ status: 'expired' }),
  }));
  await settle();
  assert.match(h.get('member-price').textContent, /500/);
  const original = h.context.fetch;
  h.context.fetch = async (path, options) => {
    if (path === '/api/membership/plan')
      return { ok: false, json: async () => ({}) };
    return original(path, options);
  };
  await h.get('member-join').listeners.click();
  assert.equal(h.get('member-join').disabled, true);
  assert.equal(h.stored.size, 0);
  const count = h.requests.filter(
    (call) => call.path === '/api/membership/checkout',
  ).length;
  await h.get('member-join').listeners.click();
  assert.equal(
    h.requests.filter((call) => call.path === '/api/membership/checkout')
      .length,
    count,
  );
});

test('already-subscribed refresh never re-enables subscribe for an active member', async () => {
  const h = harness(() => ({
    ok: false,
    json: async () => ({ code: 'MEMBERSHIP_ALREADY_SUBSCRIBED' }),
  }));
  await settle();
  const original = h.context.fetch;
  h.context.fetch = async (path, options) => {
    if (path === '/api/member/session')
      return {
        ok: true,
        json: async () => ({
          authenticated: true,
          member: true,
          email: 'member@example.com',
        }),
      };
    if (path === '/api/member/posts')
      return { ok: true, json: async () => ({ posts: [] }) };
    return original(path, options);
  };
  await h.get('member-join').listeners.click();
  assert.equal(h.get('member-join').disabled, true);
  assert.equal(h.get('member-feed').hidden, false);
});
