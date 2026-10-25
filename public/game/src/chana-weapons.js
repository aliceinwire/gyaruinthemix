/** Passenger gadget poses, registered to the existing portrait and front seat. */
export const CHANA_WEAPON_ACTIONS = Object.freeze(['flash', 'vinyl', 'bass', 'phone', 'cd', 'cassette']);
export const CHANA_WEAPON_SHEET = Object.freeze({
  url: new URL('../assets/characters/motion/chana-weapon-poses.png', import.meta.url).href,
  width: 1447,
  height: 1087,
});
const pose = (column, top, height) => Object.freeze({
  portrait: Object.freeze([column * 362, top, 362, height]),
  cabin: Object.freeze([(column + 1) * 362, top, column === 2 ? 361 : 362, height]),
});
export const CHANA_WEAPON_POSES = Object.freeze({
  flash: pose(0, 0, 358),
  vinyl: pose(2, 0, 358),
  bass: pose(0, 358, 356),
  phone: pose(2, 358, 356),
  cd: pose(0, 714, 373),
  cassette: pose(2, 714, 373),
});

let image, loading;
export function preloadChanaWeapons() {
  if (!loading) loading = new Promise(resolve => {
    if (typeof Image === 'undefined') return resolve(false);
    const candidate = new Image();
    let settled = false;
    const finish = ready => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      candidate.onload = candidate.onerror = null;
      if (ready) image = candidate;
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 15000);
    candidate.onload = () => finish(
      (candidate.naturalWidth || candidate.width) === CHANA_WEAPON_SHEET.width &&
      (candidate.naturalHeight || candidate.height) === CHANA_WEAPON_SHEET.height,
    );
    candidate.onerror = () => finish(false);
    candidate.src = CHANA_WEAPON_SHEET.url;
  }).then(ready => { if (!ready) loading = null; return ready; });
  return loading;
}

export function drawChanaWeapon(ctx, {
  weapon, view = 'portrait', x = 0, y = 0, width = 128, height = 128,
  time = 0, animate = true, crewWeaponGesture,
} = {}) {
  const rect = CHANA_WEAPON_POSES[weapon]?.[view];
  if (!image || !rect) return false;
  const [sx, sy, sw, sh] = rect;
  const cabin = view === 'cabin';
  // One registration per perspective keeps every head the same size even when
  // a record or boombox reaches farther than the hands in the idle drawing.
  const baseScale = Math.min(width / (cabin ? 314 : 325), height / (cabin ? 238 : 322));
  const scale = baseScale * (cabin ? .7 : .95);
  const elapsed = crewWeaponGesture?.elapsed ?? time;
  const bob = animate ? Math.sin(elapsed * (weapon === 'bass' ? 12 : 6)) * height * .007 : 0;
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  const dx = Math.round(x + (cabin ? 45 * baseScale : (width - dw) / 2));
  const dy = Math.round(y + height - dh + bob);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
  return true;
}
