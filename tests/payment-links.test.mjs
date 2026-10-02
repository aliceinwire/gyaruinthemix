import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkoutMode,
  validatePaymentLinks,
} from '../src/data/payment-links.mjs';

const settings = {
  mode: 'test',
  salesEnabled: true,
  configurationReviewed: true,
  liveModeAck: '',
};
// Synthetic URLs and amounts are test fixtures, never published shop configuration.
const product = {
  slug: 'fixture',
  availability: 'available',
  displayPriceJPY: 800,
  paymentLink: 'https://buy.stripe.com/test_CIFixture',
};
const build = (s = {}, p = {}) =>
  validatePaymentLinks({ ...settings, ...s }, [{ ...product, ...p }]);

test('Payment Links is default; API is an explicit build choice', () => {
  assert.equal(checkoutMode(), 'payment_links');
  assert.equal(checkoutMode('api'), 'api');
  assert.throws(() => checkoutMode('typo'));
});
test('valid public test link works without credentials', () => {
  assert.equal(build()[0].checkoutUrl, product.paymentLink);
});
test('disabled sales and unavailable products expose no purchase action', () => {
  assert.equal(
    build({ salesEnabled: false, configurationReviewed: false })[0].checkoutUrl,
    null,
  );
  for (const availability of ['coming_soon', 'sold_out'])
    assert.equal(build({}, { availability })[0].checkoutUrl, null);
  assert.equal(
    build(
      { salesEnabled: false },
      { displayPriceJPY: null, paymentLink: null },
    )[0].checkoutUrl,
    null,
  );
});
test('available products need actual display prices and URLs', () => {
  for (const displayPriceJPY of [
    null,
    0,
    -1,
    8.5,
    '800',
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => build({}, { displayPriceJPY }));
  assert.throws(() => build({}, { paymentLink: null }));
});
test('unsafe URLs and injected identity/tracking parameters fail the build', () => {
  for (const paymentLink of [
    'javascript:alert(1)',
    'http://buy.stripe.com/test_abc',
    'https://buy.stripe.com.evil.test/test_abc',
    'https://evil.test/test_abc',
    'https://user:pass@buy.stripe.com/test_abc',
    '//buy.stripe.com/test_abc',
    'https://buy.stripe.com/test_abc?prefilled_email=person@example.test',
    'https://buy.stripe.com/test_abc#secret',
    'https://buy.stripe.com/test_abc/extra',
    42,
  ])
    assert.throws(() => build({}, { paymentLink }));
});
test('test/live link mismatch and accidental live switching are rejected', () => {
  assert.throws(() =>
    build({}, { paymentLink: 'https://buy.stripe.com/LiveFixture' }),
  );
  assert.throws(() => build({ mode: 'live' }));
  assert.throws(() =>
    build({ mode: 'live', liveModeAck: 'I_HAVE_COMPLETED_TEST_CHECKOUT' }),
  );
  const live = {
    ...settings,
    mode: 'live',
    liveModeAck: 'I_HAVE_COMPLETED_TEST_CHECKOUT',
  };
  const store = { seller: 'Fixture seller' };
  assert.throws(() => validatePaymentLinks(live, [product], store));
  const actual = validatePaymentLinks(
    live,
    [{ ...product, paymentLink: 'https://buy.stripe.com/LiveFixture' }],
    store,
  );
  assert.equal(actual[0].checkoutUrl, 'https://buy.stripe.com/LiveFixture');
});
test('publishing requires deliberate Dashboard configuration review', () => {
  assert.throws(() => build({ configurationReviewed: false }));
  assert.throws(() => build({ salesEnabled: 'false' }));
  assert.throws(() => build({ mode: 'automatic' }));
  assert.throws(() => build({}, { availability: 'typo' }));
  assert.throws(() => validatePaymentLinks(settings, [product, product]));
});
