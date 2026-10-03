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
  const document = {
    querySelector: (selector) =>
      selector.startsWith('#') ? ids[selector.slice(1)] : lists[selector]?.[0],
    querySelectorAll: (selector) => lists[selector] || [],
    createElement: (tag) => new Element(tag),
  };
  const requests = [];
  const destinations = [];
  const windowListeners = {};
  const replies = [];
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
    location: { assign: (url) => destinations.push(url) },
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
    ui.replies.push(response(result));
    await ui.ids.checkout.click();
    assert.deepEqual(ui.destinations, []);
    assert.match(
      ui.ids['cart-error'].textContent,
      /決済ページを開けませんでした/,
    );
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
    'test-uuid-1',
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
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }),
  );
  await first;
  ui.windowListeners.pageshow();
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
