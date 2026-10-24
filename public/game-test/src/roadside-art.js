import { SILENT_MUSIC } from './music-reactivity.js';
/** Illustrated roadway objects. x is center; y is the object's ground line. */
const frame = (crop, width, height) => Object.freeze({
  crop: Object.freeze(crop), width, height,
});
export const ROADSIDE_ART = Object.freeze({
  url: new URL('../assets/roadside/roadside-atlas.png', import.meta.url).href,
  width: 408,
  height: 216,
  frames: Object.freeze({
    ev: frame([4, 4, 240, 200], 120, 100),
    barrier: frame([252, 4, 90, 80], 45, 40),
    cone: frame([352, 4, 48, 64], 24, 32),
    pothole: frame([252, 96, 130, 24], 65, 12),
  }),
});
let atlas = null;
let pending = null;
const name = (value, fallback = '') => {
  const result = typeof value === 'string' ? value : value?.id ?? value?.type;
  return typeof result === 'string' ? result.toLowerCase() : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** A failed load resolves false and permits a later retry. */
export function preloadRoadsideArt() {
  if (atlas) return Promise.resolve(true);
  if (pending) return pending;
  if (typeof Image === 'undefined') return Promise.resolve(false);
  pending = new Promise((resolve) => {
    const image = new Image();
    let done = false;
    let timer;
    const finish = (ready) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (ready) atlas = image;
      resolve(ready);
    };
    image.onload = () => finish(
      (image.naturalWidth || image.width) === ROADSIDE_ART.width &&
      (image.naturalHeight || image.height) === ROADSIDE_ART.height,
    );
    image.onerror = () => finish(false);
    timer = setTimeout(() => finish(false), 12000);
    image.src = ROADSIDE_ART.url;
  }).then((ready) => {
    if (!ready) pending = null;
    return ready;
  });
  return pending;
}

// Tiny climate details sit on the illustrated surfaces, never replace them.
function drawSurfaceWeather(ctx, type, weather, season, time) {
  const snow = weather === 'snow' || season === 'winter';
  const wet = weather === 'rain' || weather === 'storm';
  const mud = weather === 'mud' || weather === 'rally';
  if (snow) {
    ctx.fillStyle = '#eaf3ed';
    if (type === 'ev') {
      ctx.fillRect(15, 1, 83, 1);
      ctx.fillRect(21, 0, 13, 2);
      ctx.fillRect(47, 0, 19, 2);
      ctx.fillRect(85, 0, 11, 2);
    } else if (type === 'barrier') {
      ctx.fillRect(3, 10, 15, 1);
      ctx.fillRect(26, 10, 15, 1);
      ctx.fillRect(4, 37, 5, 1);
    } else if (type === 'cone') {
      ctx.fillRect(10, 1, 4, 1);
      ctx.fillRect(3, 30, 5, 1);
    } else {
      ctx.fillRect(9, 3, 8, 1);
      ctx.fillRect(44, 3, 7, 1);
      ctx.fillRect(19, 10, 6, 1);
    }
  }
  if (wet) {
    ctx.globalAlpha *= 0.6;
    ctx.fillStyle = '#bee4ef';
    if (type === 'ev') {
      ctx.fillRect(23, 3, 25, 1);
      ctx.fillRect(108, 64, 1, 17);
      ctx.fillRect(103, 96, 8, 1);
    } else if (type === 'pothole') {
      ctx.fillRect(20, 6, 17, 1);
      ctx.fillRect(35, 8, 7, 1);
      if (Math.floor(time * 5) % 2 === 0) ctx.fillRect(18, 8, 6, 1);
    } else if (type === 'barrier') {
      ctx.fillRect(6, 13, 10, 1);
      ctx.fillRect(38, 15, 1, 5);
    } else {
      ctx.fillRect(16, 15, 1, 6);
      ctx.fillRect(15, 25, 3, 1);
    }
  }
  if (mud) {
    ctx.globalAlpha *= 0.8;
    ctx.fillStyle = '#8a6958';
    if (type === 'ev') {
      ctx.fillRect(10, 96, 6, 2);
      ctx.fillRect(103, 93, 3, 3);
      ctx.fillRect(109, 97, 5, 1);
    } else if (type === 'cone') {
      ctx.fillRect(7, 28, 3, 2);
      ctx.fillRect(15, 29, 3, 1);
    } else if (type === 'barrier') {
      ctx.fillRect(4, 36, 4, 2);
      ctx.fillRect(34, 37, 3, 1);
    } else {
      ctx.fillRect(23, 8, 10, 1);
      ctx.fillRect(40, 6, 8, 1);
    }
  }
}

/**
 * Paint one complete sprite; returns false for an unknown type or unavailable
 * art so an existing caller may use its fallback. Supports optional scale,
 * time, weather and season without changing collision/gameplay state.
 */
export function drawRoadsideObject(ctx, {
  type = '', x = 0, y = 0, time = 0, scale = 1,
  weather = 'sunny', season = 'summer', charging = false,
  music = SILENT_MUSIC,
} = {}) {
  const selected = name(type);
  const sprite = Object.hasOwn(ROADSIDE_ART.frames, selected)
    ? ROADSIDE_ART.frames[selected]
    : null;
  if (!atlas || !sprite || !ctx ||
      !['save', 'restore', 'translate', 'scale', 'drawImage', 'fillRect'].every(
        (method) => typeof ctx[method] === 'function',
      ) || !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(scale) || scale <= 0) return false;
  const size = Math.min(scale, 8);
  const t = finite(time) % 100000;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x - sprite.width * size / 2), Math.round(y - sprite.height * size));
  ctx.scale(size, size);
  ctx.drawImage(atlas, ...sprite.crop, 0, 0, sprite.width, sprite.height);
  if (selected === 'ev' && music.active && music.energy > 0) {
    // Small highlights follow the painted canopy tubes, clear of its sign text.
    ctx.save(); ctx.globalAlpha *= music.energy * .5;
    ctx.fillStyle = '#d0ffe2';
    ctx.fillRect(15, 3, 83, 1);
    ctx.fillRect(15, 17, 83, 1);
    ctx.restore();
  }
  // The beacon and charger lights blink within their existing painted lamps.
  if (selected === 'barrier' && Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = '#fff6c3';
    ctx.fillRect(21, 3, 2, 2);
  }
  if (selected === 'ev' && charging && Math.floor(t * 4) % 2 === 0) {
    ctx.fillStyle = '#d0ffe2';
    ctx.fillRect(102, 57, 2, 1);
  }
  drawSurfaceWeather(ctx, selected, name(weather, 'sunny'), name(season, 'summer'), t);
  ctx.restore();
  return true;
}
