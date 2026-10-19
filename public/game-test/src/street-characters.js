/** Detailed, game-only street NPCs. x is the center and y the ground line. */
const pose = (index, crop, height = 76) =>
  Object.freeze({ index, crop: Object.freeze(crop), height });

export const STREET_CHARACTER_SHEET = Object.freeze({
  url: new URL(
    "../assets/characters/street/street-npc-atlas.png",
    import.meta.url,
  ).href,
  width: 1536,
  height: 1024,
  columns: 3,
  rows: 2,
  // Inspected silhouette bounds, including two pixels of safety padding.
  // The umbrella tip slightly crosses its nominal row; a tailored crop keeps
  // it intact without leaking any pixels from the salaryman's shoes above.
  poses: Object.freeze({
    salaryman: pose(0, [143, 14, 297, 476]),
    gyaru: pose(1, [601, 4, 334, 489]),
    fan: pose(2, [1100, 14, 311, 480]),
    rain: pose(3, [106, 496, 360, 514], 83),
    winter: pose(4, [648, 519, 278, 491]),
    mud: pose(5, [1129, 520, 299, 492]),
  }),
});

let atlas = null;
let loading = null;
const finite = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function key(value, fallback = "") {
  const result =
    typeof value === "string" ? value : value?.id ?? value?.type ?? fallback;
  return typeof result === "string" ? result.toLowerCase() : fallback;
}

/** Stable unsigned hash: entity IDs may be strings, never Number(id). */
function phaseOf(value) {
  const valueType = typeof value;
  const input =
    valueType === "string" || (valueType === "number" && Number.isFinite(value))
      ? String(value)
      : "street";
  let hash = 2166136261;
  for (let i = 0; i < Math.min(input.length, 128); i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash / 4294967296) * Math.PI * 2;
}

/** Salarymen change gear with the weather; fan/gyaru identities stay clear. */
export function resolveStreetPose({
  type = "salaryman",
  weather = "sunny",
  season = "summer",
} = {}) {
  const character = key(type);
  if (character === "gyaru" || character === "converted") return "gyaru";
  if (character === "fan") return "fan";
  if (character !== "salaryman") return null;
  const climate = key(weather, "sunny");
  if (climate === "mud" || climate === "rally") return "mud";
  if (climate === "rain" || climate === "storm") return "rain";
  if (climate === "snow" || key(season) === "winter") return "winter";
  return "salaryman";
}

/** Resolves false on missing assets so callers can keep their fallback art. */
export function preloadStreetCharacters() {
  if (atlas) return Promise.resolve(true);
  if (loading) return loading;
  if (typeof Image === "undefined") return Promise.resolve(false);
  loading = new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let timer;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (ready) atlas = image;
      resolve(ready);
    };
    image.onload = () =>
      finish(
        image.naturalWidth === STREET_CHARACTER_SHEET.width &&
          image.naturalHeight === STREET_CHARACTER_SHEET.height,
      );
    image.onerror = () => finish(false);
    timer = setTimeout(() => finish(false), 12000);
    image.src = STREET_CHARACTER_SHEET.url;
  }).then((ready) => {
    if (!ready) loading = null;
    return ready;
  });
  return loading;
}

/**
 * Draw a roughly 45–58 × 76px sprite, or an 83px umbrella pose. Returns only
 * readiness, so `if (!drawStreetCharacter(...))` can preserve a fallback.
 * Optional id provides deterministic per-NPC animation; optional scale helps
 * portrait previews. Weather overlays and interaction effects remain external.
 */
export function drawStreetCharacter(ctx, options = {}) {
  const {
    type = "salaryman",
    x = 0,
    y = 0,
    time = 0,
    weather = "sunny",
    season = "summer",
    id = type,
    scale = 1,
  } = options;
  if (
    !atlas ||
    !ctx ||
    !["save", "restore", "drawImage"].every(
      (method) => typeof ctx[method] === "function",
    ) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(scale) ||
    scale <= 0
  )
    return false;
  const selected = resolveStreetPose({ type, weather, season });
  const frame = STREET_CHARACTER_SHEET.poses[selected];
  if (!frame) return false;
  const [sx, sy, sw, sh] = frame.crop;
  if (
    ![sx, sy, sw, sh].every(Number.isFinite) ||
    sx < 0 ||
    sy < 0 ||
    sw <= 0 ||
    sh <= 0 ||
    sx + sw > atlas.naturalWidth ||
    sy + sh > atlas.naturalHeight
  )
    return false;
  const size = Math.min(scale, 8);
  const height = frame.height * size;
  const width = (sw / sh) * height;
  const t = finite(time) % 100000;
  const phase = phaseOf(id);
  const bob =
    Math.sin(t * (selected === "gyaru" ? 7 : 4.2) + phase) *
    (selected === "gyaru" ? 1.8 : 0.8) *
    size;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    atlas,
    sx,
    sy,
    sw,
    sh,
    Math.round(x - width / 2),
    Math.round(y - height + bob),
    Math.round(width),
    Math.round(height),
  );
  ctx.restore();
  return true;
}
