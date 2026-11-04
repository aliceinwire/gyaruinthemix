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
  catalog = availableCatalog(),
  local = storage(),
  session = storage(),
  productCards = true,
  blockedStorage = false,
  returnPage,
  search = '',
  pathname = '/',
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
    ].map((id) => [id, new Element()]),
  );
  ids['cart-dialog'].dataset.shopScope = 'public';
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
    location: { pathname, search, assign: (url) => destinations.push(url) },
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
  const controller = initializeStore({ definitions }, environment);
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

test('retired test-shop pages, catalog and bootstrap are absent', async () => {
  for (const locale of ['', 'en/']) {
    for (const page of ['index', 'success', 'cancel']) {
      await assert.rejects(
        readFile(`src/pages/${locale}shop-test/${page}.astro`),
        { code: 'ENOENT' },
      );
    }
  }
  for (const path of [
    'config/test-products.json',
    'src/scripts/test-store.js',
    'src/components/TestCart.astro',
  ])
    await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('public shop ignores retired test-cart state and accepts only Stripe checkout URLs', async () => {
  const oldCart = JSON.stringify([{ product: 'tshirt', quantity: 4 }]);
  const local = storage({ 'gyaru-test-cart-v1': oldCart });
  const ui = fixture({ local, catalog: availableCatalog('live') });
  await ui.controller.ready;
  assert.equal(ui.count.textContent, '0');
  assert.equal(ui.requests[0].url, '/api/catalog');
  assert.equal(ui.ids['cart-mode'].hidden, true);
  ui.windowListeners.storage({ key: 'gyaru-test-cart-v1', newValue: oldCart });
  assert.equal(ui.count.textContent, '0');
  ui.cards[0].add.click();
  assert.equal(local.getItem('gyaru-test-cart-v1'), oldCart);
  for (const url of [
    'https://checkout.stripe.com.evil.example/pay',
    'http://checkout.stripe.com/pay',
  ]) {
    ui.replies.push(response({ url }));
    await ui.ids.checkout.click();
    assert.equal(ui.ids.checkout.disabled, false);
    assert.deepEqual(ui.destinations, []);
  }
  ui.replies.push(
    response({ url: 'https://checkout.stripe.com/c/pay/cs_live_fixture' }),
  );
  await ui.ids.checkout.click();
  assert.equal(ui.requests.at(-1).url, '/api/checkout');
  assert.equal(ui.destinations.length, 1);
});

test('unavailable public catalog leaves purchase controls disabled', async () => {
  for (const catalog of [
    null,
    { mode: 'test' },
    { ...availableCatalog(), salesEnabled: false, products: [] },
  ]) {
    const ui = fixture({ catalog });
    await ui.controller.ready;
    assert.equal(ui.ids.checkout.disabled, true);
    assert.ok(ui.cards.every((card) => card.add.disabled));
  }
});

test('retry reuses an idempotency key and changing the bag creates a new attempt', async () => {
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
  assert.match(ui.ids.checkout.textContent, /決済へ進む/);
  assert.equal(initializeStore({ definitions }, ui.environment), undefined);
});

test('blocked browser storage getters retain a usable in-memory cart and retry key', async () => {
  {
    const ui = fixture({ blockedStorage: true });
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

test('English shop localizes products, controls, accessible labels and test-mode notices', async () => {
  const ui = fixture({ pathname: '/en/shop/' });
  await ui.controller.ready;
  assert.equal(ui.requests[0].options.headers['X-Shop-Locale'], 'en');
  assert.match(
    ui.ids['cart-items'].children[0].textContent,
    /Your bag is empty/,
  );
  assert.match(
    ui.ids['catalog-status'].textContent,
    /No real purchases or shipping/,
  );
  assert.match(
    ui.cards[0].querySelector('[data-price]').textContent,
    /¥800 \(tax included\)/,
  );
  assert.equal(
    ui.cards[0].querySelector('[data-availability]').textContent,
    'Available',
  );
  assert.equal(ui.cards[0].add.textContent, 'Add to bag ＋');
  ui.cards[0].add.click();
  assert.equal(
    ui.ids['cart-items'].children[0].children[0].textContent,
    'Logo sticker',
  );
  const buttons = ui.ids['cart-items'].querySelectorAll('button');
  assert.deepEqual(
    buttons.map((b) => b.getAttribute('aria-label')),
    [
      'Decrease quantity of Logo sticker',
      'Increase quantity of Logo sticker',
      'Remove Logo sticker',
    ],
  );
  assert.equal(buttons[2].textContent, 'Remove');
  assert.match(
    ui.ids['cart-shipping'].textContent,
    /Shipping \(tax included\): ¥500 \/ Japan only/,
  );
  assert.equal(ui.ids['announcement'].textContent, 'Added to your bag ♡');
  assert.equal(ui.ids.checkout.textContent, 'Continue to checkout ↗');
  ui.replies.push(response({ error: 'Please retry later.' }, 503));
  await ui.ids.checkout.click();
  const request = ui.requests[1];
  assert.equal(JSON.parse(request.options.body).locale, 'en');
  assert.equal(request.options.headers['X-Shop-Locale'], 'en');
  assert.equal(ui.ids['cart-error'].textContent, 'Please retry later.');
});

test('language switches reuse the original attempt locale, body and key instead of starting another payment', async () => {
  for (const [from, to, originalLocale] of [
    ['/en/shop/', '/shop/', 'en'],
    ['/shop/', '/en/shop/', 'ja'],
  ]) {
    const first = fixture({ pathname: from });
    await first.controller.ready;
    first.cards[0].add.click();
    first.replies.push(response({ error: 'retry' }, 503));
    await first.ids.checkout.click();
    const saved = JSON.parse(first.session.getItem('gyaru-checkout-v1'));
    assert.equal(saved.locale, originalLocale);
    assert.equal(JSON.parse(saved.body).locale, undefined);
    const second = fixture({
      pathname: to,
      local: first.local,
      session: first.session,
    });
    await second.controller.ready;
    second.replies.push(response({ error: 'retry' }, 503));
    await second.ids.checkout.click();
    assert.equal(
      first.requests[1].options.headers['Idempotency-Key'],
      second.requests[1].options.headers['Idempotency-Key'],
    );
    assert.equal(
      first.requests[1].options.body,
      second.requests[1].options.body,
    );
    assert.equal(
      JSON.parse(second.requests[1].options.body).locale,
      originalLocale,
    );
    assert.equal(
      second.requests[1].options.headers['X-Shop-Locale'],
      originalLocale === 'en' ? 'ja' : 'en',
    );
  }
});

test('an old Japanese attempt stays Japanese on an English retry with the exact same key', async () => {
  const first = fixture();
  await first.controller.ready;
  first.cards[0].add.click();
  first.replies.push(response({ error: 'retry' }, 503));
  await first.ids.checkout.click();
  const saved = JSON.parse(first.session.getItem('gyaru-checkout-v1'));
  delete saved.locale;
  first.session.setItem('gyaru-checkout-v1', JSON.stringify(saved));
  const english = fixture({
    pathname: '/en/shop/',
    local: first.local,
    session: first.session,
  });
  await english.controller.ready;
  english.replies.push(response({ error: 'retry' }, 503));
  await english.ids.checkout.click();
  assert.equal(
    english.requests[1].options.headers['Idempotency-Key'],
    saved.key,
  );
  assert.equal(JSON.parse(english.requests[1].options.body).locale, 'ja');
});
