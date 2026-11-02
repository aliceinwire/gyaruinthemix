export function savedProductSlugs(value, allowed) {
  try {
    const parsed = JSON.parse(value);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((slug) => typeof slug === 'string' && allowed.has(slug))
        : [],
    );
  } catch {
    return new Set();
  }
}

export function initShopDiscovery(root) {
  const view = root.defaultView;
  for (const shop of root.querySelectorAll('[data-shop-discovery]')) {
    if (shop.dataset.discoveryReady) continue;
    shop.dataset.discoveryReady = 'true';
    const cards = [...shop.querySelectorAll('[data-product]')];
    const allowed = new Set(cards.map((card) => card.dataset.product));
    const filters = [...shop.querySelectorAll('[data-product-filter]')];
    const note = shop.querySelector('[data-storage-note]');
    const status = shop.querySelector('[data-saved-status]');
    const empty = shop.querySelector('[data-shop-empty]');
    const key = shop.dataset.savedKey;
    let storage;
    let saved = new Set();
    let filter = 'all';
    const unavailable = () => {
      storage = null;
      note.textContent = note.dataset.unavailable;
    };
    try {
      storage = view.localStorage;
      saved = savedProductSlugs(storage.getItem(key), allowed);
    } catch {
      unavailable();
    }
    const render = (announce = false) => {
      shop.querySelector('[data-saved-count]').textContent = saved.size;
      for (const button of filters)
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.productFilter === filter),
        );
      for (const card of cards) {
        const button = card.querySelector('[data-save-product]');
        const selected = saved.has(card.dataset.product);
        button.hidden = false;
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute(
          'aria-label',
          selected ? button.dataset.removeLabel : button.dataset.saveLabel,
        );
        const shouldHide = filter === 'saved' && !selected;
        const hadFocus = card.contains(root.activeElement);
        if (shouldHide) card.querySelector('dialog[open]')?.close();
        card.hidden = shouldHide;
        if (shouldHide && hadFocus)
          filters
            .find((item) => item.dataset.productFilter === filter)
            .focus({ preventScroll: true });
      }
      empty.hidden = filter !== 'saved' || saved.size !== 0;
      if (announce)
        status.textContent = status.dataset.template.replace(
          '{count}',
          saved.size,
        );
    };
    for (const card of cards) {
      card
        .querySelector('[data-save-product]')
        .addEventListener('click', () => {
          if (storage) {
            try {
              saved = savedProductSlugs(storage.getItem(key), allowed);
            } catch {
              unavailable();
            }
          }
          const slug = card.dataset.product;
          if (saved.has(slug)) saved.delete(slug);
          else saved.add(slug);
          if (storage) {
            try {
              storage.setItem(key, JSON.stringify([...saved]));
            } catch {
              unavailable();
            }
          }
          render(true);
        });
    }
    for (const button of filters) {
      button.addEventListener('click', () => {
        filter = button.dataset.productFilter;
        render(true);
      });
    }
    shop.querySelector('[data-show-all]').addEventListener('click', () => {
      filter = 'all';
      render();
      filters[0].focus({ preventScroll: true });
    });
    view.addEventListener('storage', (event) => {
      if (
        !storage ||
        (event.storageArea && event.storageArea !== storage) ||
        (event.key !== key && event.key !== null)
      )
        return;
      saved = savedProductSlugs(event.newValue, allowed);
      render(true);
    });
    shop.querySelector('.shop-hero-feature')?.addEventListener('click', () => {
      filter = 'all';
      render();
    });
    shop.querySelector('[data-shop-filters]').hidden = false;
    render();
  }
}
