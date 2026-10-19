/**
 * Painted near-street scenery. All visible architectural details come from the
 * original generated RGBA artwork, rather than a second procedural building style.
 *
 * This first art set is a shared Nakano-style street, not 120 unique paintings.
 * Location labels do not shuffle it: scenery has stable world coordinates and
 * advances continuously with distance. Weather remains the caller's overlay.
 */
const IMAGE_URL = new URL(
  "../assets/streets/nakano-near-street.png",
  import.meta.url,
).href;

export const STREET_ART = Object.freeze({
  nakano: Object.freeze({
    id: "nakano",
    image: IMAGE_URL,
    // Ignore empty transparent margin while preserving the original PNG alpha.
    source: Object.freeze({ x: 10, y: 250, width: 2152, height: 390 }),
    baseline: 636,
    authoredStrips: 1,
  }),
});

const cache = new Map();
let loading;
const mod = (value, period) => ((value % period) + period) % period;
const number = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

function makeCanvas(width, height) {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Resolves per-asset readiness; no placeholder architecture on an image error. */
export function preloadStreetScenery() {
  if (loading) return loading;
  if (typeof Image === "undefined") return Promise.resolve([]);
  loading = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const art = STREET_ART.nakano;
      // Display on the same two-screen-pixel grid as the landmark panorama.
      // The 0.4 artwork scale keeps roofs low and the major skyline readable.
      const strip = makeCanvas(430, 78);
      const context = strip.getContext("2d");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        art.source.x,
        art.source.y,
        art.source.width,
        art.source.height,
        0,
        0,
        strip.width,
        strip.height,
      );
      // This low open railing is a real slice of the same painted illustration.
      // It supplies breathing room between shop clusters without flat substitutes.
      const open = makeCanvas(58, 78);
      const openContext = open.getContext("2d");
      openContext.imageSmoothingEnabled = true;
      openContext.imageSmoothingQuality = "high";
      openContext.drawImage(image, 16, 250, 290, 390, 0, 0, 58, 78);
      cache.set("nakano", { strip, open });
      resolve([{ id: "nakano", loaded: true, authoredStrips: 1 }]);
    };
    image.onerror = () => resolve([{ id: "nakano", loaded: false }]);
    image.src = IMAGE_URL;
  });
  return loading;
}

export function isStreetSceneryReady() {
  return cache.has("nakano");
}

/**
 * Draw after the landmark panorama and before the street's weather overlay.
 * Returns false until art loads. `locationIndex`, `season`, and `weather` are
 * accepted for compatibility, but never alter the geometry or randomly replace
 * a visible shop. The six routes currently share this one original near layer.
 *
 * Distance is the same continuous route distance used by drawScenery.
 */
export function drawStreetScenery(ctx, options = {}) {
  const {
    cityId = "nakano",
    locationIndex = 0,
    season = "summer",
    weather = "sunny",
    distance = 0,
    time = 0,
    width = 960,
    horizon = 330,
  } = options;
  // Explicitly accepted API inputs; this initial shared set is not fake variety.
  void cityId;
  void locationIndex;
  void season;
  void weather;
  void time;
  const artwork = cache.get("nakano");
  if (!artwork) {
    if (!loading) preloadStreetScenery();
    return false;
  }
  const screenWidth = Math.max(1, number(width, 960));
  const floor = number(horizon, 330) - 2;
  const scale = screenWidth / 960;
  const stripWidth = artwork.strip.width * 2;
  const stripHeight = artwork.strip.height * 2;
  const openWidth = artwork.open.width * 2;
  const gapCount = 4;
  const period = stripWidth + openWidth * gapCount;
  // Stable world distance, never animation time or the ten-second location index.
  const offset = mod(number(distance, 0) * 0.48, period);
  const y = Math.round((floor - stripHeight + 2) / 2) * 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, screenWidth, Math.max(0, floor + 2));
  ctx.clip();
  ctx.scale(scale, 1);
  ctx.imageSmoothingEnabled = false;
  for (let tile = -1; tile <= Math.ceil(960 / period) + 1; tile++) {
    const x = Math.round((tile * period - offset) / 2) * 2;
    ctx.drawImage(artwork.strip, x, y, stripWidth, stripHeight);
    for (let gap = 0; gap < gapCount; gap++) {
      ctx.drawImage(
        artwork.open,
        x + stripWidth + gap * openWidth,
        y,
        openWidth,
        stripHeight,
      );
    }
  }
  ctx.restore();
  return true;
}
