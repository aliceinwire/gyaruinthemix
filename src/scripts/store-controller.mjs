import { money, sanitizeCart, subtotal } from './cart.mjs';

// Both storefronts share behavior, never endpoints or browser state.
export function initializeStore(
  { definitions, testShop = false },
  environment = globalThis,
) {
  const {
    document,
    window,
    fetch,
    location,
    crypto,
    setTimeout,
    clearTimeout,
    AbortSignal,
    AbortController,
  } = environment;

  const storageKey = testShop ? 'gyaru-test-cart-v1' : 'gyaru-cart-v1';
  const attemptKey = testShop ? 'gyaru-test-checkout-v1' : 'gyaru-checkout-v1';
  const catalogUrl = testShop ? '/api/test-shop/catalog' : '/api/catalog';
  const checkoutUrl = testShop ? '/api/test-shop/checkout' : '/api/checkout';
  const dialog = document.querySelector('#cart-dialog');
  if (!dialog || dialog.dataset.shopScope !== (testShop ? 'test' : 'public'))
    return;
  if (dialog.dataset.storeInitialized === 'true') return;
  dialog.dataset.storeInitialized = 'true';
  const error = document.querySelector('#cart-error');
  const checkout = document.querySelector('#checkout');
  const itemsNode = document.querySelector('#cart-items');
  let catalog;
  let cart = [];
  let busy = false;
  let announcementTimer;
  let opener;
  let attempt;
  try {
    cart = sanitizeCart(
      JSON.parse(environment.localStorage.getItem(storageKey)),
      definitions,
    );
  } catch {
    /* Storage may be disabled. */
  }
  try {
    attempt = JSON.parse(environment.sessionStorage.getItem(attemptKey));
  } catch {
    /* Memory fallback. */
  }

  function persist() {
    try {
      environment.localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      /* The current tab remains usable. */
    }
  }
  function announce(message) {
    const node = document.querySelector('#announcement');
    clearTimeout(announcementTimer);
    node.textContent = message;
    announcementTimer = setTimeout(() => {
      node.textContent = '';
    }, 3500);
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function change(product, delta) {
    if (busy) return;
    const p = catalog?.products.find((p) => p.slug === product);
    if (!p || p.availability !== 'available') return;
    const existing = cart.find((item) => item.product === product);
    if (
      delta > 0 &&
      (cart.reduce((n, p) => n + p.quantity, 0) >= 20 ||
        (existing?.quantity || 0) >= p.maxQuantity)
    ) {
      announce('購入できる数量の上限です。');
      return;
    }
    if (existing) existing.quantity += delta;
    else if (delta > 0) cart.push({ product, quantity: 1 });
    cart = cart.filter((item) => item.quantity > 0);
    persist();
    render();
    return true;
  }
  function render() {
    for (const count of document.querySelectorAll('[data-cart-count]'))
      count.textContent = String(
        cart.reduce((n, item) => n + item.quantity, 0),
      );
    itemsNode.replaceChildren();
    if (!cart.length)
      itemsNode.append(
        node('p', 'バッグはまだ空っぽ。好きなものを見つけてね。', 'cart-empty'),
      );
    for (const item of cart) {
      const product = (catalog?.products || definitions).find(
        (p) => p.slug === item.product,
      );
      if (!product) continue;
      const row = node('div', undefined, 'cart-row');
      row.append(
        node('h3', product.name),
        node(
          'p',
          Number.isInteger(product.amount)
            ? money(product.amount)
            : '現在は購入できません',
          'muted',
        ),
      );
      const controls = node('div', undefined, 'cart-row-controls');
      for (const [label, delta] of [
        ['−', -1],
        ['＋', 1],
      ]) {
        const button = node('button', label, 'quantity-button');
        button.setAttribute(
          'aria-label',
          `${product.name}の数量を${delta < 0 ? '減らす' : '増やす'}`,
        );
        button.disabled =
          busy ||
          product.availability !== 'available' ||
          (delta > 0 && item.quantity >= product.maxQuantity);
        button.addEventListener('click', () => {
          change(product.slug, delta);
          // Preserve keyboard position after replacing the quantity controls.
          [...itemsNode.querySelectorAll('button')]
            .find(
              (b) =>
                b.getAttribute('aria-label') ===
                button.getAttribute('aria-label'),
            )
            ?.focus();
        });
        if (delta > 0) controls.append(node('span', `${item.quantity}点`));
        controls.append(button);
      }
      const remove = node('button', '削除', 'cart-remove');
      remove.setAttribute('aria-label', `${product.name}を削除`);
      remove.disabled = busy;
      remove.addEventListener('click', () => {
        cart = cart.filter((p) => p.product !== item.product);
        persist();
        render();
        document.querySelector('[data-close-cart]')?.focus();
      });
      controls.append(remove);
      row.append(controls);
      itemsNode.append(row);
    }
    const sum = catalog
      ? subtotal(cart, catalog.products)
      : cart.length
        ? null
        : 0;
    document.querySelector('#cart-subtotal').textContent =
      sum === null ? '確認中' : money(sum);
    document.querySelector('#cart-shipping').textContent = testShop
      ? 'テスト専用です。実際のお支払い・商品の発送はありません。'
      : catalog?.shipping
        ? `送料（税込） ${money(catalog.shipping.amount)} ／ 日本国内のみ`
        : '送料は販売開始時にご案内します。';
    document.querySelector('#cart-mode').hidden =
      !testShop && (!catalog?.salesEnabled || catalog.mode !== 'test');
    checkout.disabled =
      busy || !cart.length || sum === null || !catalog?.salesEnabled;
    checkout.textContent = busy
      ? '決済ページを準備しています…'
      : testShop
        ? 'テスト決済へ進む ↗'
        : '決済へ進む ↗';
  }
  function openCart(event) {
    opener = event?.currentTarget;
    error.textContent = '';
    render();
    if (!dialog.open) dialog.showModal();
    if (!catalog) void refreshCatalog();
  }
  document
    .querySelectorAll('[data-open-cart]')
    .forEach((button) => button.addEventListener('click', openCart));
  document
    .querySelectorAll('[data-close-cart]')
    .forEach((button) =>
      button.addEventListener('click', () => dialog.close()),
    );
  dialog.addEventListener('close', () => opener?.focus());
  document.querySelectorAll('[data-add]').forEach((button) =>
    button.addEventListener('click', () => {
      if (change(button.dataset.add, 1)) announce('バッグに追加しました ♡');
    }),
  );

  async function refreshCatalog() {
    try {
      const response = await fetch(catalogUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('Unavailable');
      const nextCatalog = await response.json();
      if (
        testShop &&
        (!nextCatalog ||
          nextCatalog.mode !== 'test' ||
          !Array.isArray(nextCatalog.products) ||
          typeof nextCatalog.salesEnabled !== 'boolean' ||
          typeof nextCatalog.version !== 'string')
      )
        throw new Error('Test catalog required');
      catalog = nextCatalog;
      for (const card of document.querySelectorAll('[data-product]')) {
        const p = catalog.products.find((p) => p.slug === card.dataset.product);
        if (!p) continue;
        card.querySelector('[data-price]').textContent =
          p.amount === null ? '価格未定' : `${money(p.amount)}（税込）`;
        card.querySelector('[data-availability]').textContent =
          p.availability === 'available'
            ? testShop
              ? 'テスト用'
              : '販売中'
            : p.availability === 'sold_out'
              ? 'SOLD OUT'
              : '販売準備中';
        const button = card.querySelector('[data-add]');
        button.disabled = p.availability !== 'available';
        button.textContent =
          p.availability === 'available'
            ? 'バッグに追加 ＋'
            : p.availability === 'sold_out'
              ? '売り切れ'
              : '準備中';
      }
      const status = document.querySelector('#catalog-status');
      if (status && testShop && !catalog.salesEnabled) {
        status.hidden = false;
        status.textContent =
          'テストショップは現在無効です。実際のお支払い・商品の発送はありません。';
      } else if (status && catalog.salesEnabled) {
        status.hidden = !testShop && catalog.mode === 'live';
        status.textContent =
          'テストショップです。実際の購入・発送はありません。';
      }
    } catch {
      catalog = undefined;
      document.querySelectorAll('[data-add]').forEach((button) => {
        button.disabled = true;
      });
      const status = document.querySelector('#catalog-status');
      if (status) {
        status.hidden = false;
        status.textContent =
          '商品情報を読み込めませんでした。時間をおいてページを再読み込みしてください。';
      }
    }
    render();
  }
  checkout.addEventListener('click', async () => {
    if (busy || checkout.disabled) return;
    busy = true;
    error.textContent = '';
    render();
    try {
      const body = JSON.stringify({
        items: [...cart].sort((a, b) => a.product.localeCompare(b.product)),
        catalogVersion: catalog.version,
      });
      if (
        !attempt ||
        attempt.body !== body ||
        typeof attempt.key !== 'string' ||
        !Number.isFinite(attempt.at) ||
        attempt.at > Date.now() ||
        Date.now() - attempt.at > 24 * 60 * 60 * 1000
      ) {
        attempt = { body, key: crypto.randomUUID(), at: Date.now() };
        try {
          environment.sessionStorage.setItem(
            attemptKey,
            JSON.stringify(attempt),
          );
        } catch {
          /* Memory fallback. */
        }
      }
      const response = await fetch(checkoutUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.key,
        },
        body,
        signal: AbortSignal.timeout(25000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refreshCatalog();
        throw new Error(result.error || '決済ページを開けませんでした。');
      }
      const target = new URL(result.url);
      if (
        target.origin !== 'https://checkout.stripe.com' ||
        (testShop && result.mode !== 'test')
      )
        throw new Error('決済ページを開けませんでした。');
      location.assign(target.href);
    } catch (failure) {
      error.textContent =
        failure.name === 'TimeoutError' || failure instanceof TypeError
          ? '通信を確認して、もう一度お試しください。'
          : failure.message;
      busy = false;
      render();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && !busy) {
      try {
        cart = sanitizeCart(JSON.parse(event.newValue), definitions);
      } catch {
        cart = [];
      }
      render();
    }
  });
  window.addEventListener('pageshow', () => {
    busy = false;
    render();
  });
  render();
  const ready = document.querySelector('[data-product]')
    ? refreshCatalog()
    : Promise.resolve();

  // Optional browser-native access to the same bag state. No payment actions.
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    const tool = {
      name: testShop ? 'read_test_merchandise_bag' : 'read_merchandise_bag',
      description: testShop
        ? 'Read the sandbox test bag. No real payment or shipping.'
        : 'Read the current merchandise bag, availability and displayed subtotal. Does not create a Checkout Session or a payment.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new Error('Expected an empty object');
        return {
          items: cart.map((item) => ({ ...item })),
          currency: 'jpy',
          subtotal: catalog ? subtotal(cart, catalog.products) : null,
          salesEnabled: catalog?.salesEnabled || false,
        };
      },
    };
    try {
      Promise.resolve(
        document.modelContext.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Optional API; the shop does not depend on it. */
    }
    window.addEventListener(
      'pagehide',
      (event) => {
        if (!event.persisted) lifecycle.abort();
      },
      { once: true },
    );
  }

  return { ready, refreshCatalog };
}
