import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeStore } from '../src/scripts/store-controller.mjs';

const definitions = [
  { slug: 'sticker', name: 'ステッカー', maxQuantity: 5 },
  { slug: 'tshirt', name: 'Tシャツ', maxQuantity: 5 },
];
const availableCatalog = (mode = 'test') => ({
  mode,
  version: 'catalog-v1',
  salesEnabled: true,
  products: definitions.map((p) => ({
    ...p,
    availability: 'available',
    amount: 800,
  })),
  shipping: { amount: 500 },
});
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.focused = false;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  focus() {
    this.focused = true;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.listeners.close?.();
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.tag === selector ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  click() {
    return this.listeners.click?.({ currentTarget: this });
  }
}

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function fixture({
  testShop = true,
  catalog = availableCatalog(),
  local = storage(),
  session = storage(),
  productCards = true,
  blockedStorage = false,
  returnPage,
  search = '',
  initialReplies = [],
} = {}) {
  const ids = Object.fromEntries(
    [
      'cart-dialog',
      'cart-error',
      'checkout',
      'cart-items',
      'announcement',
      'cart-subtotal',
      'cart-shipping',
      'cart-mode',
      'catalog-status',
      'test-checkout-status',
      'test-checkout-reset',
      'test-return-status',
    ].map((id) => [id, new Element()]),
  );
  ids['cart-dialog'].dataset.shopScope = testShop ? 'test' : 'public';
  const count = new Element();
  const opener = new Element('button');
  const closer = new Element('button');
  const cards = productCards
    ? definitions.map((p) => {
        const card = new Element();
        card.dataset.product = p.slug;
        const price = new Element();
        const availability = new Element();
        const add = new Element('button');
        add.dataset.add = p.slug;
        add.disabled = true;
        card.querySelector = (selector) =>
          ({
            '[data-price]': price,
            '[data-availability]': availability,
            '[data-add]': add,
          })[selector];
        card.add = add;
        return card;
      })
    : [];
  const lists = {
    '[data-product]': cards,
    '[data-cart-count]': [count],
    '[data-open-cart]': [opener],
    '[data-close-cart]': [closer],
    '[data-add]': cards.map((card) => card.add),
  };
  const returned = returnPage
    ? { dataset: { checkoutReturn: returnPage } }
    : undefined;
  const document = {
    querySelector: (selector) =>
      selector === '[data-checkout-return]'
        ? returned
        : selector.startsWith('#')
          ? ids[selector.slice(1)]
          : lists[selector]?.[0],
    querySelectorAll: (selector) => lists[selector] || [],
    createElement: (tag) => new Element(tag),
  };
  const requests = [];
  const destinations = [];
  const windowListeners = {};
  const replies = [...initialReplies];
  let uuid = 0;
  const environment = {
    document,
    window: {
      addEventListener: (name, fn) => {
        windowListeners[name] = fn;
      },
    },
    localStorage: local,
    sessionStorage: session,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return replies.length ? replies.shift() : response(catalog);
    },
    location: { search, assign: (url) => destinations.push(url) },
    crypto: { randomUUID: () => `test-uuid-${++uuid}` },
    setTimeout: () => 1,
    clearTimeout: () => {},
    AbortSignal,
    AbortController,
  };
  if (blockedStorage) {
    for (const name of ['localStorage', 'sessionStorage'])
      Object.defineProperty(environment, name, {
        get() {
          throw new DOMException('Blocked storage', 'SecurityError');
        },
      });
  }
  const controller = initializeStore({ definitions, testShop }, environment);
  return {
    ids,
    cards,
    count,
    opener,
    closer,
    requests,
    replies,
    destinations,
    windowListeners,
    local,
    session,
    controller,
    environment,
  };
}

test('sandbox calls only test catalog and checkout, with no real-payment or shipping labels hidden', async () => {
  const ui = fixture();
  await ui.controller.ready;
  assert.equal(ui.requests[0].url, '/api/test-shop/catalog');
  assert.equal(ui.ids['cart-mode'].hidden, false);
  assert.match(
    ui.ids['cart-shipping'].textContent,
    /実際のお支払い・商品の発送はありません/,
  );
  assert.equal(ui.cards[0].add.disabled, false);
  ui.cards[0].add.click();
  assert.equal(ui.count.textContent, '1');
  assert.equal(ui.ids.checkout.disabled, false);
  assert.match(ui.ids.checkout.textContent, /テスト決済/);
  ui.replies.push(
    response({
      mode: 'test',
      sessionId: 'cs_test_fixture',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }),
  );
  await ui.ids.checkout.click();
  assert.equal(ui.requests[1].url, '/api/test-shop/checkout');
  assert.equal(
    ui.destinations[0],
    'https://checkout.stripe.com/c/pay/cs_test_fixture',
  );
  assert.deepEqual(JSON.parse(ui.requests[1].options.body), {
    items: [{ product: 'sticker', quantity: 1 }],
    catalogVersion: 'catalog-v1',
  });
});

test('sandbox fails closed for live, missing-mode, unavailable and malformed catalogs', async () => {
  for (const catalog of [
    availableCatalog('live'),
    { ...availableCatalog(), mode: undefined },
    null,
    { mode: 'test' },
  ]) {
    const ui = fixture({ catalog });
    await ui.controller.ready;
    assert.equal(ui.ids.checkout.disabled, true);
    assert.ok(ui.cards.every((card) => card.add.disabled));
    assert.equal(ui.ids['cart-mode'].hidden, false);
    assert.match(ui.ids['catalog-status'].textContent, /読み込めませんでした/);
    await ui.ids.checkout.click();
    assert.equal(ui.requests.length, 1);
  }
  const ui = fixture({
    catalog: { ...availableCatalog(), salesEnabled: false, products: [] },
  });
  await ui.controller.ready;
  assert.equal(ui.ids.checkout.disabled, true);
  assert.ok(ui.cards.every((card) => card.add.disabled));
});

test('sandbox never follows a checkout response lacking test mode or a trusted Stripe origin', async () => {
  for (const result of [
    { mode: 'live', url: 'https://checkout.stripe.com/c/pay/cs_live_fixture' },
    { url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' },
    { mode: 'test', url: 'https://checkout.stripe.com.evil.example/pay' },
    { mode: 'test', url: 'http://checkout.stripe.com/pay' },
  ]) {
    const ui = fixture();
    await ui.controller.ready;
    ui.cards[0].add.click();
    ui.replies.push(
      response({ sessionId: 'cs_test_fixture', status: 'open', ...result }),
    );
    await ui.ids.checkout.click();
    assert.deepEqual(ui.destinations, []);
    assert.match(ui.ids['cart-error'].textContent, /ませんでした/);
    assert.equal(ui.ids.checkout.disabled, false);
  }
});

test('public and sandbox carts, storage events and idempotency attempts remain isolated', async () => {
  const publicCart = JSON.stringify([{ product: 'sticker', quantity: 3 }]);
  const publicAttempt = JSON.stringify({
    body: 'public',
    key: 'public-key',
    at: Date.now(),
  });
  const local = storage({ 'gyaru-cart-v1': publicCart });
  const session = storage({ 'gyaru-checkout-v1': publicAttempt });
  const ui = fixture({ local, session });
  await ui.controller.ready;
  assert.equal(ui.count.textContent, '0');
  ui.windowListeners.storage({ key: 'gyaru-cart-v1', newValue: publicCart });
  assert.equal(ui.count.textContent, '0');
  ui.cards[1].add.click();
  ui.replies.push(response({ error: 'retry' }, 503));
  await ui.ids.checkout.click();
  assert.equal(local.getItem('gyaru-cart-v1'), publicCart);
  assert.equal(session.getItem('gyaru-checkout-v1'), publicAttempt);
  assert.deepEqual(JSON.parse(local.getItem('gyaru-test-cart-v1')), [
    { product: 'tshirt', quantity: 1 },
  ]);
  assert.equal(
    JSON.parse(session.getItem('gyaru-test-checkout-v1')).key,
    'test-uuid-2',
  );
  ui.windowListeners.storage({ key: 'gyaru-test-cart-v1', newValue: 'broken' });
  assert.equal(ui.count.textContent, '0');
  const publicUI = fixture({
    testShop: false,
    local,
    session,
    catalog: availableCatalog('live'),
  });
  await publicUI.controller.ready;
  assert.equal(publicUI.requests[0].url, '/api/catalog');
  assert.equal(publicUI.count.textContent, '3');
  assert.equal(publicUI.ids['cart-mode'].hidden, true);
  assert.match(publicUI.ids['cart-shipping'].textContent, /送料（税込） ¥500/);
  publicUI.replies.push(
    response({ url: 'https://checkout.stripe.com/c/pay/cs_live_fixture' }),
  );
  await publicUI.ids.checkout.click();
  assert.equal(publicUI.requests[1].url, '/api/checkout');
  assert.equal(publicUI.destinations.length, 1);
  assert.match(publicUI.ids['catalog-status'].textContent, /テスト/);
  assert.equal(publicUI.ids['catalog-status'].hidden, true);
});

test('retry reuses a test idempotency key and changing the bag creates a new attempt', async () => {
  const ui = fixture();
  await ui.controller.ready;
  ui.cards[0].add.click();
  for (let i = 0; i < 2; i++) {
    ui.replies.push(response({ error: 'retry' }, 503));
    await ui.ids.checkout.click();
  }
  assert.equal(
    ui.requests[1].options.headers['Idempotency-Key'],
    ui.requests[2].options.headers['Idempotency-Key'],
  );
  ui.cards[1].add.click();
  ui.replies.push(response({ error: 'retry' }, 503));
  await ui.ids.checkout.click();
  assert.notEqual(
    ui.requests[2].options.headers['Idempotency-Key'],
    ui.requests[3].options.headers['Idempotency-Key'],
  );
});

test('repeat checkout clicks submit once; Back/pageshow and cancel/close restore usable controls and focus', async () => {
  const ui = fixture();
  await ui.controller.ready;
  ui.cards[0].add.click();
  ui.opener.click();
  assert.equal(ui.ids['cart-dialog'].open, true);
  ui.closer.click();
  assert.equal(ui.ids['cart-dialog'].open, false);
  assert.equal(ui.opener.focused, true);
  let finish;
  ui.replies.push(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const first = ui.ids.checkout.click();
  await ui.ids.checkout.click();
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.ids.checkout.disabled, true);
  finish(
    response({
      mode: 'test',
      sessionId: 'cs_test_fixture',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }),
  );
  await first;
  ui.replies.push(
    response({ mode: 'test', sessionId: 'cs_test_fixture', status: 'open' }),
  );
  await ui.windowListeners.pageshow();
  assert.equal(ui.ids.checkout.disabled, false);
  assert.match(ui.ids.checkout.textContent, /テスト決済/);
  assert.equal(
    initializeStore({ definitions, testShop: true }, ui.environment),
    undefined,
  );
});

test('wrong-scope bootstrap does nothing, and return pages load only their own test cart', async () => {
  const local = storage({
    'gyaru-test-cart-v1': JSON.stringify([{ product: 'tshirt', quantity: 2 }]),
  });
  const ui = fixture({ productCards: false, local });
  await ui.controller.ready;
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.count.textContent, '2');
  assert.equal(ui.ids['cart-mode'].hidden, false);
  assert.equal(initializeStore({ definitions }, ui.environment), undefined);
  ui.opener.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.requests[0].url, '/api/test-shop/catalog');
  assert.equal(ui.ids.checkout.disabled, false);
});

test('all hidden routes use noindex layout and explicit test labels; normal navigation has no test links', async () => {
  const read = (path) =>
    readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const layout = await read('src/layouts/Layout.astro');
  assert.match(
    layout,
    /testShop && <meta name="robots" content="noindex, nofollow, noarchive"/,
  );
  assert.match(layout, /position: sticky/);
  assert.match(layout, /実際のお支払い・商品の発送はありません/);
  assert.doesNotMatch(layout, /href="\/shop-test\/"|\['\/shop-test\//);
  for (const page of ['index', 'success', 'cancel']) {
    const source = await read(`src/pages/shop-test/${page}.astro`);
    assert.match(source, /<Layout\s+testShop/);
    assert.match(source, /TEST ONLY · Stripe Sandbox/);
    assert.match(source, /実際のお支払い・商品の発送はありません/);
    assert.doesNotMatch(source, /<select|data-size/);
  }
  const index = await read('src/pages/shop-test/index.astro');
  assert.match(index, /config\/test-products.json/);
  assert.match(index, /サイズ選択のない単一のテスト用SKU/);
  const publicShop = await read('src/pages/shop/index.astro');
  assert.doesNotMatch(publicShop, /shop-test|test-products/);
  const testBootstrap = await read('src/scripts/test-store.js');
  const publicBootstrap = await read('src/scripts/store.js');
  assert.match(testBootstrap, /testShop: true/);
  assert.doesNotMatch(publicBootstrap, /testShop|test-products/);
});

test('blocked browser storage getters retain a usable in-memory cart and retry key', async () => {
  for (const testShop of [true, false]) {
    const ui = fixture({ testShop, blockedStorage: true });
    await ui.controller.ready;
    ui.cards[0].add.click();
    assert.equal(ui.count.textContent, '1');
    assert.equal(ui.ids.checkout.disabled, false);
    for (let i = 0; i < 2; i++) {
      ui.replies.push(response({ error: 'retry' }, 503));
      await ui.ids.checkout.click();
    }
    assert.equal(
      ui.requests[1].options.headers['Idempotency-Key'],
      ui.requests[2].options.headers['Idempotency-Key'],
    );
  }
});

const submittedCart = [{ product: 'sticker', quantity: 1 }];
function pendingFixture({
  status = 'paid',
  current = submittedCart,
  revision = 'before',
  testShop = true,
  returnPage = 'success',
  search = '?session_id=cs_test_fixture',
  replyStatus = 200,
  attemptPatch = {},
} = {}) {
  const local = storage({
    'gyaru-test-cart-v1': JSON.stringify(current),
    'gyaru-test-cart-revision-v1': revision,
    'gyaru-cart-v1': JSON.stringify([{ product: 'tshirt', quantity: 3 }]),
  });
  const attempt = {
    version: 2,
    key: 'existing-attempt',
    at: Date.now(),
    sessionId: 'cs_test_fixture',
    body: JSON.stringify({
      items: submittedCart,
      catalogVersion: 'catalog-v1',
    }),
    cartSnapshot: JSON.stringify(submittedCart),
    cartRevision: 'before',
    url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    ...attemptPatch,
  };
  const session = storage({
    'gyaru-test-checkout-v1': JSON.stringify(attempt),
    'gyaru-checkout-v1': 'public-untouched',
  });
  const ui = fixture({
    testShop,
    local,
    session,
    productCards: false,
    returnPage,
    search,
    initialReplies: [
      response(
        { mode: 'test', sessionId: 'cs_test_fixture', status },
        replyStatus,
      ),
    ],
  });
  return { ...ui, attempt };
}

test('verified paid return clears only an unchanged sandbox bag and retires its retry key', async () => {
  const ui = pendingFixture();
  await ui.controller.ready;
  assert.deepEqual(JSON.parse(ui.local.getItem('gyaru-test-cart-v1')), []);
  assert.equal(JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')), null);
  assert.equal(ui.count.textContent, '0');
  assert.match(ui.ids['test-return-status'].textContent, /完了を確認/);
  assert.equal(ui.requests[0].url, '/api/test-shop/checkout-status');
  assert.equal(ui.destinations.length, 0);
  assert.equal(ui.session.getItem('gyaru-checkout-v1'), 'public-untouched');
  assert.deepEqual(JSON.parse(ui.local.getItem('gyaru-cart-v1')), [
    { product: 'tshirt', quantity: 3 },
  ]);
  await ui.windowListeners.pageshow();
  assert.equal(ui.requests.length, 1);
});

test('paid return preserves newer additions, quantity changes, and remove/re-add revisions', async () => {
  for (const current of [
    [...submittedCart, { product: 'tshirt', quantity: 1 }],
    [{ product: 'sticker', quantity: 2 }],
    submittedCart,
  ]) {
    const ui = pendingFixture({ current, revision: 'edited-later' });
    await ui.controller.ready;
    assert.deepEqual(
      JSON.parse(ui.local.getItem('gyaru-test-cart-v1')),
      current,
    );
    assert.equal(
      JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')),
      null,
    );
    assert.match(
      ui.ids['test-return-status'].textContent,
      /変更されているため保持/,
    );
  }
});

test('cancel/open, pending, failed verification and mismatched return never clear a bag', async () => {
  for (const options of [
    { status: 'open', returnPage: 'cancel', search: '' },
    { status: 'pending' },
    { replyStatus: 503 },
    { search: '?session_id=cs_test_other' },
    { search: '' },
  ]) {
    const ui = pendingFixture(options);
    await ui.controller.ready;
    assert.deepEqual(
      JSON.parse(ui.local.getItem('gyaru-test-cart-v1')),
      submittedCart,
    );
    assert.notEqual(
      JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')),
      null,
    );
    assert.equal(ui.destinations.length, 0);
    assert.ok(ui.requests.every((r) => r.url.endsWith('/checkout-status')));
  }
});

test('direct success page without an attempt is not payment proof; public bootstrap ignores sandbox attempts', async () => {
  const local = storage({
    'gyaru-test-cart-v1': JSON.stringify(submittedCart),
  });
  const ui = fixture({
    local,
    productCards: false,
    returnPage: 'success',
    search: '?session_id=cs_test_fixture',
  });
  await ui.controller.ready;
  assert.equal(ui.requests.length, 0);
  assert.deepEqual(
    JSON.parse(local.getItem('gyaru-test-cart-v1')),
    submittedCart,
  );
  const publicUI = pendingFixture({ testShop: false });
  await publicUI.controller.ready;
  assert.equal(publicUI.requests.length, 0);
  assert.notEqual(
    JSON.parse(publicUI.session.getItem('gyaru-test-checkout-v1')),
    null,
  );
});

test('expired attempt retires only its key; legacy and uncertain old attempts need explicit review', async () => {
  const expired = pendingFixture({ status: 'expired' });
  await expired.controller.ready;
  assert.deepEqual(
    JSON.parse(expired.local.getItem('gyaru-test-cart-v1')),
    submittedCart,
  );
  assert.equal(
    JSON.parse(expired.session.getItem('gyaru-test-checkout-v1')),
    null,
  );
  for (const patch of [
    { version: undefined, sessionId: undefined },
    { sessionId: undefined, at: Date.now() - 24 * 60 * 60 * 1000 },
  ]) {
    const ui = pendingFixture({
      attemptPatch: patch,
      returnPage: undefined,
      search: '',
    });
    await ui.controller.ready;
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.ids['test-checkout-reset'].hidden, false);
    assert.equal(ui.ids.checkout.disabled, true);
    ui.ids['test-checkout-reset'].click();
    assert.equal(
      JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')),
      null,
    );
    assert.deepEqual(
      JSON.parse(ui.local.getItem('gyaru-test-cart-v1')),
      submittedCart,
    );
  }
});

test('replayed paid checkout reconciles without following a closed Stripe URL', async () => {
  const ui = fixture();
  await ui.controller.ready;
  ui.cards[0].add.click();
  ui.replies.push(
    response({ mode: 'test', sessionId: 'cs_test_fixture', status: 'paid' }),
  );
  await ui.ids.checkout.click();
  assert.equal(ui.requests[1].options.headers['X-Checkout-Protocol'], '2');
  assert.equal(ui.destinations.length, 0);
  assert.equal(ui.count.textContent, '0');
  assert.equal(JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')), null);
});

test('failed paid-cart write keeps its proof and never claims clearing succeeded', async () => {
  const ui = pendingFixture();
  ui.local.setItem = () => {
    throw new DOMException('Full', 'QuotaExceededError');
  };
  await ui.controller.ready;
  assert.deepEqual(
    JSON.parse(ui.local.getItem('gyaru-test-cart-v1')),
    submittedCart,
  );
  assert.notEqual(
    JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')),
    null,
  );
  assert.equal(ui.ids.checkout.disabled, true);
  assert.match(
    ui.ids['test-return-status'].textContent,
    /保存できませんでした/,
  );
  assert.doesNotMatch(ui.ids['test-return-status'].textContent, /空にしました/);
});

test('blocked session receipt storage never navigates away and loses its retry proof', async () => {
  const ui = fixture();
  await ui.controller.ready;
  ui.cards[0].add.click();
  ui.session.setItem = () => {
    throw new DOMException('Full', 'QuotaExceededError');
  };
  ui.replies.push(
    response({
      mode: 'test',
      sessionId: 'cs_test_fixture',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }),
  );
  await ui.ids.checkout.click();
  assert.equal(ui.destinations.length, 0);
  assert.match(ui.ids['cart-error'].textContent, /保存できません/);
  ui.replies.push(
    response({ mode: 'test', sessionId: 'cs_test_fixture', status: 'open' }),
  );
  await ui.ids.checkout.click();
  assert.equal(ui.destinations.length, 0);
  assert.equal(
    ui.requests.filter((r) => r.url === '/api/test-shop/checkout').length,
    1,
  );
});

test('initial pageshow does not start a second restore; concurrent storage edits remain current', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const base = pendingFixture({
    status: 'open',
    returnPage: undefined,
    search: '',
  });
  await base.controller.ready;
  const ui = fixture({
    local: base.local,
    session: base.session,
    productCards: false,
    initialReplies: [pending],
  });
  await ui.windowListeners.pageshow();
  assert.equal(ui.requests.length, 1);
  const newer = JSON.stringify([{ product: 'tshirt', quantity: 2 }]);
  ui.local.setItem('gyaru-test-cart-v1', newer);
  ui.local.setItem('gyaru-test-cart-revision-v1', 'newer');
  ui.windowListeners.storage({ key: 'gyaru-test-cart-v1', newValue: newer });
  finish(
    response({ mode: 'test', sessionId: 'cs_test_fixture', status: 'expired' }),
  );
  await ui.controller.ready;
  assert.equal(ui.count.textContent, '2');
  assert.equal(ui.local.getItem('gyaru-test-cart-v1'), newer);
});

test('paid clear failing only the cart write leaves the matching revision for safe retry', async () => {
  const ui = pendingFixture();
  const write = ui.local.setItem;
  ui.local.setItem = (key, value) => {
    if (key === 'gyaru-test-cart-v1') throw new Error('quota');
    return write(key, value);
  };
  await ui.controller.ready;
  assert.equal(ui.local.getItem('gyaru-test-cart-revision-v1'), 'before');
  assert.notEqual(
    JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')),
    null,
  );
  ui.local.setItem = write;
  ui.replies.push(
    response({ mode: 'test', sessionId: 'cs_test_fixture', status: 'paid' }),
  );
  await ui.windowListeners.pageshow();
  assert.deepEqual(JSON.parse(ui.local.getItem('gyaru-test-cart-v1')), []);
  assert.equal(JSON.parse(ui.session.getItem('gyaru-test-checkout-v1')), null);
});

test('open receipt is persisted atomically with its URL, or remains safely retryable', async () => {
  const ui = fixture();
  await ui.controller.ready;
  ui.cards[0].add.click();
  const write = ui.session.setItem;
  ui.session.setItem = (key, value) => {
    if (value.includes('checkout.stripe.com')) throw new Error('quota');
    return write(key, value);
  };
  ui.replies.push(
    response({
      mode: 'test',
      sessionId: 'cs_test_fixture',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }),
  );
  await ui.ids.checkout.click();
  assert.equal(ui.destinations.length, 0);
  const saved = JSON.parse(ui.session.getItem('gyaru-test-checkout-v1'));
  assert.equal(saved.sessionId, undefined);
  assert.equal(saved.version, 2);
});

test('an unsaved in-memory cart cannot redirect to a payment that would leave a stale paid bag', async () => {
  const local = storage({
    'gyaru-test-cart-v1': JSON.stringify(submittedCart),
  });
  const ui = fixture({ local });
  await ui.controller.ready;
  const write = local.setItem;
  local.setItem = (key, value) => {
    if (key === 'gyaru-test-cart-v1') throw new Error('quota');
    return write(key, value);
  };
  ui.cards[1].add.click();
  ui.replies.push(
    response({
      mode: 'test',
      sessionId: 'cs_test_fixture',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }),
  );
  await ui.ids.checkout.click();
  assert.equal(ui.destinations.length, 0);
  assert.match(ui.ids['cart-error'].textContent, /バッグを保存できません/);
  assert.deepEqual(
    JSON.parse(local.getItem('gyaru-test-cart-v1')),
    submittedCart,
  );
});
