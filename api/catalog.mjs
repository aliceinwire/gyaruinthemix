import { createHash } from 'node:crypto';

export function createCatalog(config, stripe, ttlMs = 60_000) {
  let cached;
  let until = 0;
  let pending;
  async function load() {
    let shipping = null;
    if (config.salesEnabled) {
      const rate = await stripe.shippingRates.retrieve(config.shippingRate);
      if (
        !rate.active ||
        rate.livemode !== (config.mode === 'live') ||
        rate.type !== 'fixed_amount' ||
        rate.fixed_amount?.currency !== 'jpy' ||
        !Number.isSafeInteger(rate.fixed_amount.amount) ||
        rate.fixed_amount.amount < 0 ||
        rate.tax_behavior !== 'inclusive'
      )
        throw new Error('Invalid shipping configuration');
      shipping = { amount: rate.fixed_amount.amount, country: 'JP' };
    }
    const products = [];
    for (const p of config.products) {
      let amount = null;
      let availability = p.availability;
      if (!config.salesEnabled && availability === 'available')
        availability = 'coming_soon';
      if (availability === 'available') {
        const price = await stripe.prices.retrieve(p.priceId, {
          expand: ['product'],
        });
        if (
          !price.active ||
          price.livemode !== (config.mode === 'live') ||
          price.type !== 'one_time' ||
          price.currency !== 'jpy' ||
          !Number.isSafeInteger(price.unit_amount) ||
          price.unit_amount < 1 ||
          price.billing_scheme !== 'per_unit' ||
          price.custom_unit_amount ||
          price.tax_behavior !== 'inclusive' ||
          !price.product?.active ||
          price.product?.deleted
        )
          throw new Error('Invalid product price');
        amount = price.unit_amount;
      }
      products.push({
        slug: p.slug,
        name: p.name,
        amount,
        availability,
        maxQuantity: p.maxQuantity,
      });
    }
    const version = createHash('sha256')
      .update(
        JSON.stringify({
          products,
          shipping,
          mode: config.mode,
          ids: config.products.map((p) => p.priceId),
          shippingId: config.shippingRate,
        }),
      )
      .digest('hex');
    cached = {
      products,
      shipping,
      version,
      salesEnabled: config.salesEnabled,
      mode: config.mode,
      currency: 'jpy',
    };
    until = Date.now() + ttlMs;
    return cached;
  }
  return {
    get: async () => {
      if (cached && Date.now() < until) return cached;
      if (!pending)
        pending = load().finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
