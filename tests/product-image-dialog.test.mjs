import test from 'node:test';
import assert from 'node:assert/strict';
import { initProductImageDialogs } from '../src/scripts/product-image-dialog.mjs';

function fixture(count = 3) {
  const root = { activeElement: null };
  const element = (extra = {}) => ({
    dataset: {},
    handlers: {},
    addEventListener(name, fn) {
      (this.handlers[name] ||= []).push(fn);
    },
    fire(name, event = {}) {
      for (const fn of this.handlers[name] || []) fn(event);
    },
    focus() {
      this.focused = true;
      root.activeElement = this;
    },
    ...extra,
  });
  const full = {};
  const caption = {};
  const close = element();
  const previous = element({ hidden: count < 2 });
  const next = element({ hidden: count < 2 });
  const position = {};
  const track = { scrollLeft: 0 };
  const dialog = element({
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      this.fire('close');
    },
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 90, bottom: 90 }),
    querySelector: (selector) =>
      ({
        '[data-product-image-full]': full,
        '[data-product-image-caption]': caption,
        '[data-product-image-close]': close,
        '[data-product-image-prev]': previous,
        '[data-product-image-next]': next,
        '[data-product-image-position]': position,
      })[selector],
  });
  const links = Array.from({ length: count }, (_, index) =>
    element({
      href: `/image-${index}.webp`,
      dataset: {
        caption: `Caption ${index}`,
        position: `Image ${index + 1} / ${count}`,
      },
      closest: () => ({ querySelector: () => ({ alt: `Image ${index}` }) }),
    }),
  );
  const gallery = {
    querySelector: (selector) =>
      selector === '[data-product-image-dialog]' ? dialog : track,
    querySelectorAll: () => links,
  };
  root.querySelectorAll = () => [gallery];
  const click = (link, more = {}) => {
    let prevented = false;
    link.fire('click', {
      detail: 0,
      preventDefault() {
        prevented = true;
      },
      ...more,
    });
    return prevented;
  };
  const key = (key, more = {}) => {
    let prevented = false;
    dialog.fire('keydown', {
      key,
      preventDefault() {
        prevented = true;
      },
      ...more,
    });
    return prevented;
  };
  return {
    root,
    dialog,
    full,
    caption,
    close,
    previous,
    next,
    position,
    track,
    links,
    click,
    key,
  };
}

test('product image dialogs support repeated keyboard opening, close and focus return', () => {
  const f = fixture();
  initProductImageDialogs(f.root);
  initProductImageDialogs(f.root);
  assert.equal(f.links[0].handlers.click.length, 1);
  for (const link of [...f.links, ...f.links]) {
    assert.ok(f.click(link));
    assert.equal(f.dialog.open, true);
    assert.equal(f.full.src, link.href);
    assert.ok(f.full.alt);
    assert.equal(f.caption.textContent, link.dataset.caption);
    assert.ok(f.close.focused);
    for (const control of [f.previous, f.next, f.close]) {
      assert.ok(f.key('Tab'));
      assert.equal(f.root.activeElement, control);
    }
    for (const control of [f.next, f.previous, f.close]) {
      assert.ok(f.key('Tab', { shiftKey: true }));
      assert.equal(f.root.activeElement, control);
    }
    f.close.fire('click');
    assert.equal(f.dialog.open, false);
    assert.ok(link.focused);
  }
});

test('arrows wrap within the open product and update image, alternative text and position', () => {
  const f = fixture();
  const other = fixture();
  initProductImageDialogs(f.root);
  initProductImageDialogs(other.root);
  f.click(f.links[2]);
  const expect = (index) => {
    assert.equal(f.full.src, f.links[index].href);
    assert.equal(f.full.alt, `Image ${index}`);
    assert.equal(f.caption.textContent, `Caption ${index}`);
    assert.equal(f.position.textContent, `Image ${index + 1} / 3`);
    assert.equal(other.dialog.open, false);
    assert.equal(other.full.src, undefined);
  };
  f.next.fire('click');
  expect(0);
  f.previous.fire('click');
  expect(2);
  assert.ok(f.key('ArrowRight'));
  expect(0);
  assert.ok(f.key('ArrowLeft'));
  expect(2);
  assert.ok(f.key('ArrowLeft'));
  expect(1);
  assert.equal(f.key('ArrowRight', { altKey: true }), false);
  expect(1);
  f.close.fire('click');
  assert.equal(f.root.activeElement, f.links[2]);
  assert.equal(f.key('ArrowRight'), false);
  expect(1);
});

test('a single image keeps its only dialog control and modified clicks follow the original link', () => {
  const f = fixture(1);
  initProductImageDialogs(f.root);
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.equal(f.click(f.links[0], { [modifier]: true }), false);
    assert.equal(f.dialog.open, false);
  }
  f.click(f.links[0]);
  f.key('ArrowRight');
  f.key('ArrowLeft');
  assert.equal(f.full.src, f.links[0].href);
  assert.equal(f.position.textContent, 'Image 1 / 1');
  for (const shiftKey of [false, true]) {
    assert.ok(f.key('Tab', { shiftKey }));
    assert.equal(f.root.activeElement, f.close);
  }
});

test('swipes and scroll movement do not open the image; a later tap does', () => {
  const f = fixture();
  initProductImageDialogs(f.root);
  const link = f.links[0];
  for (const delta of [{ clientX: 50 }, { clientY: 50 }, { scroll: 30 }]) {
    f.track.scrollLeft = 0;
    link.fire('pointerdown', { clientX: 20, clientY: 20 });
    f.track.scrollLeft = delta.scroll || 0;
    f.click(link, { detail: 1, clientX: 20, clientY: 20, ...delta });
    assert.equal(f.dialog.open, false);
  }
  link.fire('pointerdown', { clientX: 20, clientY: 20 });
  f.click(link, { detail: 1, clientX: 20, clientY: 20 });
  assert.equal(f.dialog.open, true);
});

test('only a click that starts and ends on the backdrop dismisses', () => {
  const f = fixture();
  initProductImageDialogs(f.root);
  f.click(f.links[0]);
  const inside = { target: f.dialog, clientX: 40, clientY: 40 };
  const outside = { target: f.dialog, clientX: 0, clientY: 0 };
  f.dialog.fire('pointerdown', inside);
  f.dialog.fire('click', outside);
  assert.equal(f.dialog.open, true);
  f.dialog.fire('pointerdown', outside);
  f.dialog.fire('click', outside);
  assert.equal(f.dialog.open, false);
  assert.ok(f.links[0].focused);
});

test('unsupported dialogs leave direct image links usable', () => {
  const f = fixture();
  f.dialog.showModal = undefined;
  initProductImageDialogs(f.root);
  assert.equal(f.links[0].handlers.click, undefined);
});
