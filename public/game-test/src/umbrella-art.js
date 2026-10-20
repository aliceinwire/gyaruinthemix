/** Generated umbrella accessories. x is the NPC center; y is its ground line. */
export const UMBRELLA_SHEET = Object.freeze({
  url: new URL('../assets/characters/street/umbrellas-v2.png', import.meta.url).href,
  width: 1536,
  height: 1024,
  frames: Object.freeze({
    navy: Object.freeze([8, 168, 504, 672]),
    leopard: Object.freeze([520, 168, 500, 672]),
    lavender: Object.freeze([1028, 168, 500, 672]),
  }),
});
let atlas = null;
let pending = null;

/** Safe to call repeatedly; missing artwork resolves false and can be retried. */
export function preloadUmbrellaArt() {
  if (atlas) return Promise.resolve(true);
  if (pending) return pending;
  if (typeof Image === 'undefined') return Promise.resolve(false);
  pending = new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    let timeout;
    const finish = (ready) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (ready) atlas = image;
      resolve(ready);
    };
    image.onload = () => finish(image.naturalWidth === UMBRELLA_SHEET.width && image.naturalHeight === UMBRELLA_SHEET.height);
    image.onerror = () => finish(false);
    timeout = setTimeout(() => finish(false), 12000);
    image.src = UMBRELLA_SHEET.url;
  }).then((ready) => { if (!ready) pending = null; return ready; });
  return pending;
}

/**
 * Draw one 60×80 logical-pixel umbrella, returning false only when unavailable.
 * Call only in rain/storm, after the dry NPC sprite. No weather assumption here.
 * type: salaryman → navy; gyaru/converted → leopard; fan → lavender.
 * Optional variant overrides type. Optional offsetX/top let callers align hands.
 * No additional animation: callers may supply the NPC's already-bobbed y.
 */
export function drawUmbrellaArt(ctx, {
  type = 'salaryman', variant, x = 0, y = 0, scale = 1,
  offsetX = 12, top = -113,
} = {}) {
  if (!atlas || !ctx || !['save', 'restore', 'drawImage'].every((method) => typeof ctx[method] === 'function') ||
      ![x, y, scale, offsetX, top].every(Number.isFinite) || scale <= 0) return false;
  const selected = variant ?? (type === 'fan' ? 'lavender' : ['gyaru', 'converted'].includes(type) ? 'leopard' : 'navy');
  const crop = typeof selected === "string" && Object.hasOwn(UMBRELLA_SHEET.frames,selected) ? UMBRELLA_SHEET.frames[selected] : null;
  if (!crop) return false;
  const size = Math.min(scale, 8);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, ...crop,
    Math.round(x + (offsetX - 30) * size), Math.round(y + top * size),
    Math.round(60 * size), Math.round(80 * size));
  ctx.restore();
  return true;
}
