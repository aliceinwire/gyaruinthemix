/**
 * Authored seasonal city plates. Each atlas has three equal-height
 * rows: summer, autumn, winter. Spring is the original plate in scenery.js.
 * Full-resolution images are released after nearest-neighbour rasterization.
 */
const CITY_IDS = Object.freeze([
  "nakano", "shinjuku", "shibuya", "asakusa", "osaka", "kyoto",
]);
export const SEASONAL_ROWS = Object.freeze({ summer: 0, autumn: 1, winter: 2 });
export const SEASONAL_RASTER_SIZE = Object.freeze({ width: 528, height: 165 });
export const SEASONAL_CITY_ART = Object.freeze(Object.fromEntries(
  CITY_IDS.map((id) => [id, Object.freeze({
    id,
    image: new URL(`../assets/cities/seasons/${id}.png`, import.meta.url).href,
    width: 528,
    height: 495,
    rows: SEASONAL_ROWS,
  })]),
));

const rasters = new Map();
const jobs = new Map();
const queue = [];
let active = 0;
// Limit simultaneous full-size decodes on phones. All cached images are tiny.
const MAX_CONCURRENT_DECODES = 2;
const DECODE_TIMEOUT_MS = 20000;

/** Pure integer crop geometry, including atlases whose height is not /3 exact. */
export function seasonalSourceRect(width, height, season) {
  if (!Object.hasOwn(SEASONAL_ROWS, season)) return null;
  const row = SEASONAL_ROWS[season];
  const top = Math.round(height * row / 3);
  const bottom = Math.round(height * (row + 1) / 3);
  return { x: 0, y: top, width, height: bottom - top };
}

/** Returns only the requested season; never substitutes spring pink blossoms. */
export function getSeasonalRaster(cityId, season) {
  if (!Object.hasOwn(SEASONAL_ROWS, season)) return null;
  return rasters.get(cityId)?.[season] || null;
}

export function isSeasonalSceneryReady(cityId, season) {
  return Boolean(getSeasonalRaster(cityId, season));
}

function pump() {
  while (active < MAX_CONCURRENT_DECODES && queue.length) {
    active += 1;
    queue.shift()();
  }
}

function requestCity(id) {
  if (rasters.has(id)) return Promise.resolve({ id, loaded: true });
  if (jobs.has(id)) return jobs.get(id);
  const art = Object.hasOwn(SEASONAL_CITY_ART, id) ? SEASONAL_CITY_ART[id] : null;
  if (!art) return Promise.resolve({ id, loaded: false, reason: "unknown-city" });
  let resolveJob;
  const job = new Promise((resolve) => { resolveJob = resolve; });
  jobs.set(id, job);
  queue.push(() => {
    let image = new Image();
    let settled = false;
    let timeout;
    image.decoding = "async";
    const finish = (loaded, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (!loaded) image.src = "";
      image = null;
      active -= 1;
      // Failed requests may be retried on a later preload after connectivity returns.
      if (!loaded) jobs.delete(id);
      resolveJob({ id, loaded, ...(reason ? { reason } : {}) });
      pump();
    };
    image.onload = () => {
      if (settled) return;
      // Validate the pre-sampled runtime atlas, not a full panorama or master.
      if (image.naturalWidth !== art.width || image.naturalHeight !== art.height) {
        finish(false, "invalid-atlas-shape");
        return;
      }
      try {
        const cityRasters = {};
        for (const season of Object.keys(SEASONAL_ROWS)) {
          const source = seasonalSourceRect(image.naturalWidth, image.naturalHeight, season);
          const plate = document.createElement("canvas");
          plate.width = SEASONAL_RASTER_SIZE.width;
          plate.height = SEASONAL_RASTER_SIZE.height;
          const ctx = plate.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D context unavailable");
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(image, source.x, source.y, source.width, source.height,
            0, 0, plate.width, plate.height);
          cityRasters[season] = plate;
        }
        rasters.set(id, cityRasters);
        finish(true);
      } catch {
        finish(false, "rasterization-failed");
      }
    };
    image.onerror = () => finish(false, "image-load-failed");
    timeout = setTimeout(() => finish(false, "image-load-timeout"), DECODE_TIMEOUT_MS);
    image.src = art.image;
  });
  pump();
  return job;
}

/** Load specific cities first, or all six. A single atlas failure is non-fatal. */
export function preloadSeasonalScenery(cityIds = CITY_IDS) {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return Promise.resolve([]);
  }
  return Promise.all([...new Set(cityIds)].map(requestCity));
}
