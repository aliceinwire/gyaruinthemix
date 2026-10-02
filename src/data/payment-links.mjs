// Build-time validation only. Public links are not API credentials.
export function validatePaymentLinks(settings, products, store = {}) {
  const fail = (message) => {
    throw new Error(`Payment Links configuration: ${message}`);
  };
  if (!['test', 'live'].includes(settings.mode)) fail('use test or live mode');
  if (
    typeof settings.salesEnabled !== 'boolean' ||
    typeof settings.configurationReviewed !== 'boolean'
  )
    fail('salesEnabled and configurationReviewed must be booleans');
  if (settings.salesEnabled && !settings.configurationReviewed)
    fail(
      'review Dashboard prices, quantities, JP shipping and seller details first',
    );
  if (settings.mode === 'live') {
    if (settings.liveModeAck !== 'I_HAVE_COMPLETED_TEST_CHECKOUT')
      fail('complete TEST checkout before selecting live mode');
    if (
      settings.salesEnabled &&
      (!Object.keys(store).length ||
        Object.values(store).some(
          (value) => typeof value !== 'string' || !value.trim(),
        ))
    )
      fail('complete seller details before live sales');
  }
  const seen = new Set();
  return products.map((product) => {
    if (!/^[a-z0-9-]{1,40}$/.test(product.slug) || seen.has(product.slug))
      fail('invalid or duplicate product slug');
    seen.add(product.slug);
    if (
      !['available', 'coming_soon', 'sold_out'].includes(product.availability)
    )
      fail('invalid availability');
    if (
      product.displayPriceJPY !== null &&
      product.displayPriceJPY !== undefined &&
      (!Number.isSafeInteger(product.displayPriceJPY) ||
        product.displayPriceJPY < 1)
    )
      fail('displayPriceJPY must be a positive integer or null');
    let link = null;
    if (product.paymentLink !== null && product.paymentLink !== undefined) {
      // Reject tracking/identity parameters, embedded credentials and lookalike domains.
      if (
        typeof product.paymentLink !== 'string' ||
        !/^https:\/\/buy\.stripe\.com\/(?:test_)?[A-Za-z0-9]+$/.test(
          product.paymentLink,
        )
      )
        fail('use a plain https://buy.stripe.com/ Dashboard link');
      const isTest = new URL(product.paymentLink).pathname.startsWith('/test_');
      if (isTest !== (settings.mode === 'test'))
        fail('link does not match the configured test/live mode');
      link = product.paymentLink;
    }
    const purchasable =
      settings.salesEnabled && product.availability === 'available';
    if (
      purchasable &&
      (!link || [null, undefined].includes(product.displayPriceJPY))
    )
      fail(
        'available products need a Payment Link and its matching JPY display price',
      );
    return { ...product, checkoutUrl: purchasable ? link : null };
  });
}

export function checkoutMode(value = 'payment_links') {
  if (!['payment_links', 'api'].includes(value))
    throw new Error('CHECKOUT_MODE must be payment_links or api');
  return value;
}
