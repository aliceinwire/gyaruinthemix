import test from 'node:test';
import assert from 'node:assert/strict';
import { productImages } from '../src/data/product-images.mjs';
import { localizeProduct } from '../src/data/shop-i18n.mjs';
import { initProductGalleries } from '../src/scripts/product-gallery.mjs';

const images = [
  {
    src: '/assets/product.webp',
    alt: '商品単体',
    altEn: 'Product only',
    label: '商品',
    labelEn: 'Product',
  },
  { src: '/assets/worn.webp', alt: '着用写真', altEn: 'Worn by a model' },
  { src: '/assets/art.webp', alt: '作品写真', altEn: 'Artistic photograph' },
];

test('legacy single-image products keep their localized image and caption', () => {
  const product = localizeProduct(
    { slug: 'sticker', image: '/assets/logo.webp' },
    'en',
  );
  assert.deepEqual(productImages(product, 'en'), [
    { src: product.image, alt: product.imageAlt, label: product.imageLabel },
  ]);
});

test('gallery preserves cover order and localizes each image independently', () => {
  const product = { slug: 'sticker', images };
  const ja = productImages(product);
  const en = productImages(localizeProduct(product, 'en'), 'en');
  assert.deepEqual(
    ja.map((image) => image.src),
    images.map((image) => image.src),
  );
  assert.deepEqual(
    en.map((image) => image.alt),
    images.map((image) => image.altEn),
  );
  assert.equal(ja[0].label, '商品');
  assert.equal(en[0].label, 'Product');
  assert.equal(en[1].label, '');
  assert.equal(productImages({ ...product, images: [images[0]] }).length, 1);
});

test('gallery rejects empty lists, unsafe paths and missing accessible descriptions', () => {
  for (const invalid of [
    null,
    [],
    {},
    [null],
    [{ ...images[0], src: 'https://example.com/photo' }],
    [{ ...images[0], src: '//example.com/photo' }],
    [{ ...images[0], src: '/\\example.com/photo' }],
    [{ ...images[0], src: '/\n/example.com/photo' }],
    [{ ...images[0], alt: '' }],
    [{ ...images[0], altEn: undefined }],
    [{ ...images[0], labelEn: 4 }],
  ]) {
    assert.throws(() => productImages({ slug: 'sticker', images: invalid }));
  }
});

test('thumbnail navigation is scoped, repeat-safe and updates selection after swiping', (t) => {
  const handlers = {};
  const links = images.map(() => ({
    attributes: {},
    addEventListener(name, fn) {
      this[name] = fn;
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    removeAttribute(key) {
      delete this.attributes[key];
    },
  }));
  const track = {
    clientWidth: 300,
    scrollLeft: 0,
    scrollTo(options) {
      this.scrollLeft = options.left;
      handlers.scroll();
    },
    addEventListener(name, fn) {
      handlers[name] = fn;
    },
  };
  const gallery = {
    dataset: {},
    querySelector() {
      return track;
    },
    querySelectorAll() {
      return links;
    },
  };
  const root = {
    querySelectorAll() {
      return [gallery];
    },
  };
  const oldMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  t.after(() => {
    if (oldMatchMedia) globalThis.matchMedia = oldMatchMedia;
    else delete globalThis.matchMedia;
  });
  // Node has no browser ResizeObserver; restore the temporary browser globals.
  const oldObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
  };
  t.after(() => {
    if (oldObserver) globalThis.ResizeObserver = oldObserver;
    else delete globalThis.ResizeObserver;
  });
  initProductGalleries(root);
  const firstHandler = links[0].click;
  initProductGalleries(root);
  assert.equal(links[0].click, firstHandler);
  assert.equal(links[0].attributes['aria-current'], 'true');
  let prevented = false;
  links[2].click({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(track.scrollLeft, 600);
  assert.equal(links[2].attributes['aria-current'], 'true');
  assert.equal(links[0].attributes['aria-current'], undefined);
  track.scrollLeft = 300;
  handlers.scroll();
  assert.equal(links[1].attributes['aria-current'], 'true');
});

test('supplied keychain photos have a product-first bilingual gallery in both shops', async () => {
  const { readFile } = await import('node:fs/promises');
  const expected = ['keychain-product', 'keychain-bag', 'keychain-styled'];
  for (const file of ['products.json', 'test-products.json']) {
    const catalog = JSON.parse(
      await readFile(new URL(`../config/${file}`, import.meta.url), 'utf8'),
    );
    const product = catalog.find(({ slug }) => slug === 'keychain');
    for (const locale of ['ja', 'en']) {
      const photos = productImages(localizeProduct(product, locale), locale);
      assert.deepEqual(
        photos.map(({ src }) => src),
        expected.map((name) => `/assets/${name}.webp`),
      );
      for (const photo of photos) {
        assert.ok(photo.alt.length > 0);
        assert.ok(photo.label.length > 0);
        assert.match(
          photo.label,
          locale === 'ja'
            ? /イメージ画像.*実物と細部/
            : /Illustrative image.*differ/,
        );
      }
    }
    assert.equal(product.displayPriceJPY, null);
    assert.equal(product.paymentLink, null);
    assert.equal(
      product.availability,
      file === 'products.json' ? 'coming_soon' : 'available',
    );
  }
});
