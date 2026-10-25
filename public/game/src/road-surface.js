/** Illustrated street ground, kept separate from weather and gameplay objects. */
export const ROAD_SURFACE_ART = Object.freeze({
  url: new URL('../assets/streets/detailed-road-surface.png', import.meta.url).href,
  sourceWidth: 2172,
  sourceHeight: 724,
  tileWidth: 960,
  height: 214,
  top: 326,
  curb: 478,
});
export const ROAD_SURFACE_VARIANTS = Object.freeze(Object.fromEntries(
  [['dry','surface'],['wet','wet'],['snow','snow'],['mud','mud']].map(([key,suffix]) => [key,Object.freeze({
    url:new URL(`../assets/streets/detailed-road-${suffix}.png`, import.meta.url).href,
    sourceWidth:2172, sourceHeight:724,
  })]),
));
const sources = new Map();
const tiles = new Map();
let pending = null;

function loadVariant(key, metadata) {
  if (sources.has(key)) return Promise.resolve(true);
  return new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = ready => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (ready) sources.set(key,image);
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 15000);
    image.onload = () => finish(image.naturalWidth === metadata.sourceWidth && image.naturalHeight === metadata.sourceHeight);
    image.onerror = () => finish(false);
    image.src = metadata.url;
  });
}

/** All four surfaces are required. Failed variants can be retried without reloading successes. */
export function preloadRoadSurfaceArt() {
  if (sources.size === Object.keys(ROAD_SURFACE_VARIANTS).length) return Promise.resolve(true);
  if (pending) return pending;
  if (typeof Image === 'undefined') return Promise.resolve(false);
  pending = Promise.all(Object.entries(ROAD_SURFACE_VARIANTS).map(([key,metadata])=>loadVariant(key,metadata)))
    .then(results => { pending = null; return results.every(Boolean); });
  return pending;
}

/** Explicit mud wins; winter/snow wins over rain; otherwise wet rain/storm or dry. */
export function roadSurfaceVariant({weather = 'sunny', season = 'summer'} = {}) {
  const id = value => typeof value === 'string' ? value.toLowerCase() : String(value?.id || value?.type || '').toLowerCase();
  const climate = id(weather);
  if (climate === 'mud' || climate === 'rally') return 'mud';
  if (climate === 'snow' || id(season) === 'winter') return 'snow';
  if (climate === 'rain' || climate === 'storm') return 'wet';
  return 'dry';
}

function getTile(key) {
  const source = sources.get(key);
  if (tiles.has(key) || !source) return tiles.get(key);
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(480, 107)
    : typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) return null;
  canvas.width = 480;
  canvas.height = 107;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  // Art-directed bands put the foreground curb just below the wheel ground.
  // The source itself supplies all material texture and worn markings.
  ctx.drawImage(source, 0, 0, 2172, 90, 0, 0, 480, 15);
  ctx.drawImage(source, 0, 90, 2172, 492, 0, 15, 480, 61);
  ctx.drawImage(source, 0, 582, 2172, 142, 0, 76, 480, 31);
  tiles.set(key,canvas);
  return canvas;
}

/** Deterministic, gap-free tile placement, including negative travel. */
export function roadSurfaceTiles(distance = 0, width = 960) {
  const shift = Math.floor((Number.isFinite(distance) ? distance : 0) * 3 / 2) * 2;
  const size = ROAD_SURFACE_ART.tileWidth;
  const first = Math.floor(shift / size);
  const offset = shift - first * size;
  const result = [];
  for (let i = 0; i * size - offset < width; i++) {
    result.push({x:i * size - offset, mirrored:Math.abs((first + i) % 2) === 1});
  }
  return result;
}

/** Includes weather surface materials; do not cover with legacy flat road overlays. */
export function drawRoadSurface(ctx, {distance = 0, width = 960, y = 326, height = 214, weather = 'sunny', season = 'summer'} = {}) {
  const image = getTile(roadSurfaceVariant({weather,season}));
  if (!image) return false;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.beginPath();
  ctx.rect(0, y, width, height);
  ctx.clip();
  for (const placement of roadSurfaceTiles(distance, width)) {
    ctx.save();
    ctx.translate(placement.x + (placement.mirrored ? 960 : 0), y);
    if (placement.mirrored) ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, 960, height);
    ctx.restore();
  }
  ctx.restore();
  return true;
}
