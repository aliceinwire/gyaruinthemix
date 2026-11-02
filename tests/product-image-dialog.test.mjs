import test from 'node:test';
import assert from 'node:assert/strict';
import { initProductImageDialogs } from '../src/scripts/product-image-dialog.mjs';

function fixture() {
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
    },
    ...extra,
  });
  const full = {};
  const caption = {};
  const close = element();
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
      })[selector],
  });
  const links = [0, 1].map((index) =>
    element({
      href: `/image-${index}.webp`,
      dataset: { caption: `Caption ${index}` },
      closest: () => ({ querySelector: () => ({ alt: `Image ${index}` }) }),
    }),
  );
  const gallery = {
    querySelector: (selector) =>
      selector === '[data-product-image-dialog]' ? dialog : track,
    querySelectorAll: () => links,
  };
  const root = { querySelectorAll: () => [gallery] };
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
  return { root, dialog, full, caption, close, track, links, click };
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
    for (const shiftKey of [false, true]) {
      let prevented = false;
      f.dialog.fire('keydown', {
        key: 'Tab',
        shiftKey,
        preventDefault() {
          prevented = true;
        },
      });
      assert.ok(prevented);
      assert.ok(f.close.focused);
    }
    f.close.fire('click');
    assert.equal(f.dialog.open, false);
    assert.ok(link.focused);
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
