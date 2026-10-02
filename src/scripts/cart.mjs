export const money = (amount) =>
  `¥${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(amount)}`;

export function sanitizeCart(input, products) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  let remaining = 20;
  return input.slice(0, 10).flatMap((item) => {
    const product = products.find((p) => p.slug === item?.product);
    if (
      !product ||
      seen.has(product.slug) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      !remaining
    )
      return [];
    seen.add(product.slug);
    const quantity = Math.min(item.quantity, product.maxQuantity, remaining);
    remaining -= quantity;
    return [{ product: product.slug, quantity }];
  });
}

export function subtotal(cart, products) {
  let sum = 0;
  for (const item of cart) {
    const product = products.find((p) => p.slug === item.product);
    if (
      !product ||
      product.availability !== 'available' ||
      !Number.isSafeInteger(product.amount)
    )
      return null;
    sum += product.amount * item.quantity;
  }
  return sum;
}
