/** Keep decisions in the cabinet: pages replace long, scrolling menus. */
export function installFrame() {
  const $ = selector => document.querySelector(selector);
  function pages(host, groups, labels) {
    const nav = document.createElement('nav');
    nav.className = 'frame-tabs';
    nav.setAttribute('aria-label', '準備のページ');
    const panels = groups.map((nodes, index) => {
      const panel = document.createElement('section');
      panel.className = 'frame-page';
      panel.id = `${host.id}-page-${index}`;
      for (const node of nodes.filter(Boolean)) panel.append(node);
      host.append(panel);
      const button = document.createElement('button');
      button.textContent = labels[index];
      button.setAttribute('aria-controls', panel.id);
      button.addEventListener('click', () => show(index));
      nav.append(button);
      return panel;
    });
    function show(index) {
      panels.forEach((panel, i) => { panel.hidden = i !== index; });
      [...nav.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    }
    host.prepend(nav);
    show(0);
  }
  const cars = $('#car-select');
  pages(cars, [
    [cars.querySelector('.section-heading'), cars.querySelector('.style-picker')],
    [cars.querySelector('.garage-label'), cars.querySelector('.section-note'), $('#car-garage')],
    [$('#starting-customization')],
  ], ['1 / スタイル', '2 / くるま', '3 / カスタム']);
  cars.append($('#car-select-wallet'), $('#car-save-warning'), $('#cars-ready'));
  const garage = $('#garage-content');
  pages(garage, [[garage.querySelector('.build-workshop')], [garage.querySelector(':scope > h3'), $('#shop')], [$('#arrival-summary'), $('#build-summary'), $('#build-note')]], ['リミックス', '基本パーツ', '旅の状態']);
  garage.append($('#garage-wallet'), $('#shop-status'), $('#garage-done'));
  // Collections show one complete card at a time, with explicit navigation.
  for (const selector of ['#car-garage', '#shop', '#build-offers', '#draft-options']) {
    const list = $(selector);
    const nav = document.createElement('nav');
    nav.className = 'card-pager';
    nav.setAttribute('aria-label', 'カードを切り替える');
    const prev = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span');
    prev.textContent = '← 前へ'; next.textContent = '次へ →';
    nav.append(prev, count, next); list.after(nav);
    let index = 0;
    function render() {
      const cards = [...list.children];
      index = Math.max(0, Math.min(index, cards.length - 1));
      cards.forEach((card, i) => { card.hidden = i !== index; });
      count.textContent = `${cards.length ? index + 1 : 0} / ${cards.length}`;
      prev.disabled = index === 0; next.disabled = index >= cards.length - 1;
      nav.hidden = cards.length < 2;
    }
    prev.addEventListener('click', () => { index--; render(); });
    next.addEventListener('click', () => { index++; render(); });
    new MutationObserver(() => {
      if (selector === '#draft-options') index = 0;
      render();
    }).observe(list, { childList: true });
    render();
  }
}
