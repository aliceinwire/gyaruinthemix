import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';

export function readConfig(env = process.env) {
  const fail = () => {
    throw new Error(
      'Invalid store configuration; check README and environment names.',
    );
  };
  const bool = (name) => {
    if (!['true', 'false', undefined, ''].includes(env[name])) fail();
    return env[name] === 'true';
  };
  const mode = env.STRIPE_MODE || 'test';
  if (!['test', 'live'].includes(mode)) fail();
  const production = env.NODE_ENV === 'production';
  const siteUrl = env.SITE_URL || 'http://localhost:4321';
  let url;
  try {
    url = new URL(siteUrl);
  } catch {
    fail();
  }
  if (
    url.origin !== siteUrl ||
    url.username ||
    url.password ||
    (production && url.protocol !== 'https:') ||
    (url.protocol !== 'https:' &&
      !(
        ['localhost', '127.0.0.1'].includes(url.hostname) &&
        url.protocol === 'http:'
      ))
  )
    fail();
  if (
    mode === 'live' &&
    (env.LIVE_MODE_ACK !== 'I_HAVE_COMPLETED_TEST_CHECKOUT' ||
      url.protocol !== 'https:')
  )
    fail();
  const secret = (name, fallback, pattern) => {
    let value;
    let fd;
    try {
      // Inspect the opened file, so checks and reads refer to the same inode.
      // O_NONBLOCK prevents a mistaken FIFO path from hanging startup.
      fd = openSync(
        env[`${name}_FILE`] || fallback,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size < 1 ||
        stat.size > 4096 ||
        (production && (stat.mode & 0o137) !== 0)
      )
        fail();
      value = readFileSync(fd, 'utf8').trim();
    } catch {
      fail();
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (!pattern.test(value) || value.includes('...')) fail();
    return value;
  };
  const secretKey = secret(
    'STRIPE_SECRET_KEY',
    '/run/secrets/stripe_secret_key',
    new RegExp(`^rk_${mode}_[A-Za-z0-9]+$`),
  );
  const webhookSecret = secret(
    'STRIPE_WEBHOOK_SECRET',
    '/run/secrets/stripe_webhook_secret',
    /^whsec_[A-Za-z0-9]+$/,
  );
  const salesEnabled = bool('SALES_ENABLED');
  const testShopEnabled = bool('TEST_SHOP_ENABLED');
  // The hidden sandbox must never share an enabled public or live checkout.
  if (testShopEnabled && (mode !== 'test' || salesEnabled)) fail();
  if (salesEnabled && !bool('STORE_DETAILS_REVIEWED')) fail();
  if (salesEnabled && mode === 'live') {
    const details = JSON.parse(
      readFileSync(new URL('../config/store.json', import.meta.url), 'utf8'),
    );
    if (
      Object.values(details).some(
        (value) => typeof value !== 'string' || !value.trim(),
      )
    )
      fail();
  }
  const shippingRate = env.STRIPE_SHIPPING_RATE_JP || '';
  if (
    (salesEnabled || testShopEnabled) &&
    !/^shr_[A-Za-z0-9]+$/.test(shippingRate)
  )
    fail();
  function loadProducts(filename, enabled) {
    const products = JSON.parse(
      readFileSync(new URL(`../config/${filename}`, import.meta.url), 'utf8'),
    );
    const slugs = new Set();
    for (const product of products) {
      if (
        !/^[a-z0-9-]{1,40}$/.test(product.slug) ||
        slugs.has(product.slug) ||
        !['available', 'coming_soon', 'sold_out'].includes(
          product.availability,
        ) ||
        !Number.isInteger(product.maxQuantity) ||
        product.maxQuantity < 1 ||
        product.maxQuantity > 10 ||
        !/^STRIPE_PRICE_[A-Z0-9_]+$/.test(product.priceEnv)
      )
        fail();
      slugs.add(product.slug);
      product.priceId = env[product.priceEnv] || '';
      if (
        enabled &&
        product.availability === 'available' &&
        !/^price_[A-Za-z0-9]+$/.test(product.priceId)
      )
        fail();
    }
    return products;
  }
  const products = loadProducts('products.json', salesEnabled);
  const testProducts = loadProducts('test-products.json', testShopEnabled);
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail();
  return {
    mode,
    production,
    siteUrl,
    secretKey,
    webhookSecret,
    salesEnabled,
    testShopEnabled,
    testProducts,
    shippingRate,
    products,
    port,
    host: production ? '0.0.0.0' : '127.0.0.1',
    stateDir: env.STATE_DIR || './state',
  };
}
