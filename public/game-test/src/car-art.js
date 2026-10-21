/**
 * Illustrated vehicle foreground layers. Each PNG has its own measured crop:
 * no atlas-cell assumptions. Windows and wheel arches are true alpha holes.
 * Coordinates in CAR_ART are cropped RUNTIME-image pixels, before game scale.
 * Public drawing coordinates are bottom-center at the tires' ground line.
 */
const assetUrl = (name) => new URL(`../assets/cars/${name}.png`, import.meta.url).href;
const RUNTIME_HEIGHTS = Object.freeze({ 'mix-175': 145, 'spark-k': 252, 'rocket-gal': 140, 'bass-van': 225, 'heart-limo': 112 });
const define = (id, settings) => {
  const source = settings.crop, width = 600, height = RUNTIME_HEIGHTS[id];
  const sx = width / source.width, sy = height / source.height;
  const point = (p) => ({ x: (p.x - source.x) * sx, y: (p.y - source.y) * sy });
  const rect = (p) => ({ ...point(p), width: p.width * sx, height: p.height * sy });
  return Object.freeze({
    ...settings, id, src: assetUrl(id), sourceWidth: width, sourceHeight: height,
    crop: { x: 0, y: 0, width, height },
    originalCrop: source, sourceScaleX: sx, sourceScaleY: sy,
    groundY: (settings.groundY - source.y) * sy,
    wheels: settings.wheels.map((p) => ({ ...point(p), radius: p.radius * sy })),
    cabins: settings.cabins.map(rect), seats: settings.seats.map(point),
    logo: rect(settings.logo), protectedPaint: settings.protectedPaint.map(rect),
  });
};

export const CAR_ART = Object.freeze({
  'mix-175': define('mix-175', {
    crop: { x: 32, y: 81, width: 2119, height: 513 },
    sourceWidth: 2172, sourceHeight: 724, defaultWidth: 194,
    defaultPaint: 'pink', bodyHue: 337, hueTolerance: 37, openTop: true,
    groundY: 685,
    wheels: [{ x: 440, y: 526, radius: 159 }, { x: 1737, y: 526, radius: 159 }],
    cabins: [{ x: 772, y: 83, width: 436, height: 176 }],
    seats: [{ x: 864, y: 260 }, { x: 1110, y: 260 }],
    logo: { x: 790, y: 350, width: 614, height: 178 },
    protectedPaint: [{ x: 86, y: 312, width: 101, height: 68 }, { x: 1930, y: 362, width: 182, height: 61 }],
  }),
  'spark-k': define('spark-k', {
    crop: { x: 33, y: 72, width: 1708, height: 718 },
    sourceWidth: 1774, sourceHeight: 887, defaultWidth: 166,
    defaultPaint: 'mint', bodyHue: 157, hueTolerance: 46, openTop: false,
    groundY: 912,
    wheels: [{ x: 341, y: 746, radius: 166 }, { x: 1456, y: 752, radius: 160 }],
    cabins: [{ x: 365, y: 157, width: 276, height: 205 }, { x: 748, y: 163, width: 326, height: 201 }],
    seats: [{ x: 502, y: 373 }, { x: 911, y: 373 }],
    logo: { x: 717, y: 490, width: 493, height: 184 },
    protectedPaint: [{ x: 68, y: 415, width: 65, height: 145 }, { x: 1640, y: 440, width: 98, height: 190 }],
  }),
  'rocket-gal': define('rocket-gal', {
    crop: { x: 23, y: 122, width: 2126, height: 497 },
    sourceWidth: 2172, sourceHeight: 724, defaultWidth: 200,
    defaultPaint: 'purple', bodyHue: 257, hueTolerance: 39, openTop: true,
    groundY: 686,
    wheels: [{ x: 448, y: 520, radius: 166 }, { x: 1671, y: 535, radius: 151 }],
    cabins: [{ x: 894, y: 126, width: 394, height: 171 }],
    seats: [{ x: 966, y: 299 }, { x: 1171, y: 299 }],
    logo: { x: 873, y: 369, width: 549, height: 145 },
    protectedPaint: [{ x: 1852, y: 389, width: 234, height: 96 }],
  }),
  'bass-van': define('bass-van', {
    crop: { x: 16, y: 81, width: 1785, height: 668 },
    sourceWidth: 1817, sourceHeight: 866, defaultWidth: 200,
    defaultPaint: 'gold', bodyHue: 42, hueTolerance: 28, openTop: false,
    groundY: 856,
    wheels: [{ x: 327, y: 706, radius: 150 }, { x: 1512, y: 706, radius: 150 }],
    cabins: [{ x: 580, y: 178, width: 371, height: 185 }, { x: 1069, y: 187, width: 245, height: 176 }],
    seats: [{ x: 774, y: 374 }, { x: 1190, y: 374 }],
    logo: { x: 550, y: 469, width: 803, height: 187 },
    protectedPaint: [{ x: 36, y: 161, width: 76, height: 359 }, { x: 1684, y: 439, width: 110, height: 121 }],
  }),
  'heart-limo': define('heart-limo', {
    crop: { x: 7, y: 177, width: 2065, height: 386 },
    sourceWidth: 2079, sourceHeight: 756, defaultWidth: 230,
    defaultPaint: 'blue', bodyHue: 224, hueTolerance: 34, openTop: false,
    groundY: 664,
    wheels: [{ x: 333, y: 543, radius: 121 }, { x: 1752, y: 543, radius: 121 }],
    cabins: [{ x: 779, y: 228, width: 379, height: 93 }, { x: 1248, y: 235, width: 176, height: 86 }],
    seats: [{ x: 987, y: 327 }, { x: 1335, y: 327 }],
    logo: { x: 788, y: 378, width: 739, height: 148 },
    protectedPaint: [{ x: 30, y: 350, width: 48, height: 104 }, { x: 1935, y: 368, width: 108, height: 77 }],
  }),
});

export const CAR_WHEEL_ART = Object.freeze({ src: assetUrl('chrome-wheel'), sourceWidth: 128, sourceHeight: 128, crop: { x: 0, y: 0, width: 128, height: 128 } });
// Hardtop fittings are measured on each 600px body sprite. Reuse its windshield
// and, on Rocket Gal, its rear pillar. Only the missing cap/support is added;
// the illustrated roof's unrelated front pillar must never replace the car's.
export const CAR_ROOF_ART = Object.freeze({
  'mix-175': Object.freeze({
    id: 'mix-175-roof', src: assetUrl('mix-175-roof'), sourceWidth: 600, sourceHeight: 180,
    crop: { x: 0, y: 0, width: 600, height: 180 },
    cap: { source: { x: 0, y: 0, width: 524, height: 74 }, body: { x: 180, y: -14, width: 158, height: 24 } },
    rearPillar: {
      source: { x: 0, y: 70, width: 90, height: 110 }, thicknessScale: .4,
      sourceTop: { x: 47, y: 80 }, sourceFoot: { x: 13, y: 177 },
      // Extend the existing raised rear frame (199, 29), rather than landing
      // on the flat trunk behind it and leaving that frame inside the window.
      top: { x: 194, y: 8 }, foot: { x: 199, y: 29 },
    },
    windshield: { top: { x: 334, y: 2 }, foot: { x: 408, y: 51 } },
    snow: { x: 202, y: -14, width: 114 },
  }),
  'rocket-gal': Object.freeze({
    id: 'rocket-gal-roof', src: assetUrl('rocket-gal-roof'), sourceWidth: 600, sourceHeight: 149,
    crop: { x: 0, y: 0, width: 600, height: 149 },
    cap: { source: { x: 58, y: 0, width: 442, height: 48 }, body: { x: 217, y: -7, width: 115, height: 20 } },
    windshield: { top: { x: 326, y: 8 }, foot: { x: 413, y: 53 } },
    snow: { x: 236, y: -7, width: 76 },
  }),
});
const PAINTS = Object.freeze({ pink: '#ff4f9b', mint: '#55dcc8', purple: '#a77aff', gold: '#ffc452', blue: '#5395ff', black: '#424457' });
const images = new Map();
const painted = new Map();
let preloadPromise;

export function getCarArt(carId = 'mix-175') {
  return typeof carId === 'string' && Object.hasOwn(CAR_ART, carId) ? CAR_ART[carId] : CAR_ART['mix-175'];
}

/**
 * Width is total vehicle width. Height, when supplied, is cropped BODY height,
 * not total crew height; omit it to keep the illustration's natural aspect.
 * Crew can use .seats as foot/torso anchors; draw crew before drawCarBody.
 */
export function getCarArtLayout({ carId = 'mix-175', x = 0, y = 0, width, height } = {}) {
  const art = getCarArt(carId);
  x = Number.isFinite(x) ? x : 0;
  y = Number.isFinite(y) ? y : 0;
  width = Number.isFinite(width) && width > 0 ? width : art.defaultWidth;
  const sx = width / art.crop.width;
  const sy = Number.isFinite(height) && height > 0 ? height / art.crop.height : sx;
  const point = (p) => ({ x: x - width / 2 + (p.x - art.crop.x) * sx, y: y + (p.y - art.groundY) * sy });
  const rect = (p) => ({ ...point(p), width: p.width * sx, height: p.height * sy });
  return {
    carId: art.id, openTop: art.openTop, defaultWidth: art.defaultWidth,
    body: rect(art.crop),
    wheels: art.wheels.map((p) => ({ ...point(p), radius: p.radius * sy })),
    cabins: art.cabins.map(rect), seats: art.seats.map(point), logo: rect(art.logo),
    scaleX: sx, scaleY: sy,
  };
}

/** Roof fittings share the body's scale and ground anchor. */
export function getCarRoofLayout(options = {}) {
  const body = getCarArtLayout(options), roof = CAR_ROOF_ART[body.carId];
  if (!roof) return null;
  const point = p => ({ x: body.body.x + p.x * body.scaleX, y: body.body.y + p.y * body.scaleY });
  const rect = p => ({ ...point(p), width: p.width * body.scaleX, height: p.height * body.scaleY });
  return {
    cap: rect(roof.cap.body),
    windshield: { top: point(roof.windshield.top), foot: point(roof.windshield.foot) },
    snow: { ...point(roof.snow), width: roof.snow.width * body.scaleX },
  };
}

/** All bodies, illustrated wheel and open-car rain roofs are required. */
export function preloadCarArt() {
  if (preloadPromise) return preloadPromise;
  if (typeof Image === 'undefined') return Promise.reject(new Error('Car art requires a browser Image implementation.'));
  const resources = [...Object.values(CAR_ART), ...Object.values(CAR_ROOF_ART), { id: 'wheel', ...CAR_WHEEL_ART }];
  preloadPromise = Promise.all(resources.map(({ id, src, sourceWidth, sourceHeight }) => new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`Car sprite timed out: ${id}`)), 15000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (error) reject(error);
      else { images.set(id, img); resolve(id); }
    }
    img.onload = () => {
      if (img.naturalWidth !== sourceWidth || img.naturalHeight !== sourceHeight)
        return finish(new Error(`Car sprite dimensions do not match ${id}: expected ${sourceWidth}x${sourceHeight}, received ${img.naturalWidth}x${img.naturalHeight}`));
      finish();
    };
    img.onerror = () => finish(new Error(`Car sprite failed to load: ${id}`));
    img.src = src;
  }))).then((loaded) => Object.freeze({ ready: true, loaded }));
  preloadPromise.catch(() => { preloadPromise = undefined; });
  return preloadPromise;
}

export function areCarSpritesReady() {
  return Object.keys(CAR_ART).every((id) => images.has(id)) && Object.values(CAR_ROOF_ART).every((art) => images.has(art.id)) && images.has('wheel');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const l = (max + min) / 2;
  if (!delta) return [0, 0, l];
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = max === r ? (g - b) / delta % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, k = h / 60, z = c * (1 - Math.abs(k % 2 - 1)), m = l - c / 2;
  const rgb = k < 1 ? [c, z, 0] : k < 2 ? [z, c, 0] : k < 3 ? [0, c, z] : k < 4 ? [0, z, c] : k < 5 ? [z, 0, c] : [c, 0, z];
  return rgb.map((v) => Math.round((v + m) * 255));
}

function paintInfo(paint, art) {
  if (!paint || paint === art.defaultPaint || paint.id === art.defaultPaint) return null;
  const value = typeof paint === 'string' ? PAINTS[paint] || paint : paint.color;
  const hex = /^#([\da-f]{6})$/i.exec(value || '');
  if (!hex) return null;
  const color = Number.parseInt(hex[1], 16);
  return { key: hex[1], hsl: rgbToHsl(color >> 16, color >> 8 & 255, color & 255) };
}

function paintSource(art, img, paint) {
  const target = paintInfo(paint, art);
  if (!target) return { image: img, crop: art.crop };
  const key = `${art.id}:${target.key}`;
  if (painted.has(key)) return painted.get(key);
  // Chroma-key only body paint. Alpha, white/chrome, rubber, lights and outlines
  // retain source colors; never hue-rotate the entire car or its transparent cabin.
  const surface = document.createElement('canvas');
  surface.width = art.crop.width; surface.height = art.crop.height;
  const g = surface.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, art.crop.x, art.crop.y, art.crop.width, art.crop.height, 0, 0, surface.width, surface.height);
  const pixels = g.getImageData(0, 0, surface.width, surface.height), d = pixels.data;
  const [targetH, targetS, targetL] = target.hsl;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const pixel = i / 4, x = pixel % surface.width + art.crop.x, y = Math.floor(pixel / surface.width) + art.crop.y;
    if (art.protectedPaint.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const distance = Math.min(Math.abs(h - art.bodyHue), 360 - Math.abs(h - art.bodyHue));
    if (distance > art.hueTolerance || s < .18 || l < .08 || l > .94) continue;
    const shade = targetL < .34 ? l * (.52 + targetL) : l;
    const sat = targetS < .2 ? s * .16 : Math.min(.95, s * (.6 + targetS * .55));
    const [r, green, b] = hslToRgb(targetH, sat, shade);
    d[i] = r; d[i + 1] = green; d[i + 2] = b;
  }
  g.putImageData(pixels, 0, 0);
  const result = { image: surface, crop: { x: 0, y: 0, width: surface.width, height: surface.height } };
  painted.set(key, result);
  return result;
}

/** Draw after the crew and preferably after the wheels. Returns false until loaded. */
export function drawCarBody(ctx, options = {}) {
  const art = getCarArt(options.carId), img = images.get(art.id);
  if (!img) return false;
  const layout = getCarArtLayout(options), source = paintSource(art, img, options.paint), c = source.crop, b = layout.body;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source.image, c.x, c.y, c.width, c.height, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height));
  ctx.restore(); return true;
}

/** Optional detailed rain hardtop for the two open cars. False for closed cars. */
export function drawCarRoof(ctx, options = {}) {
  const art = getCarArt(options.carId);
  const roof = Object.hasOwn(CAR_ROOF_ART, art.id) ? CAR_ROOF_ART[art.id] : null;
  if (!roof) return false;
  const img = images.get(roof.id); if (!img) return false;
  const layout = getCarArtLayout(options);
  const roofPalette = { ...art, id: roof.id, crop: roof.crop, protectedPaint: [] };
  const source = paintSource(roofPalette, img, options.paint);
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.translate(layout.body.x, layout.body.y);
  ctx.scale(layout.scaleX, layout.scaleY);
  const pillar = roof.rearPillar;
  if (pillar) {
    // Match the existing rear deck and cap joints without stretching a second
    // windshield over the original. Preserve the source's shading/chrome.
    const { sourceTop: top, sourceFoot: foot, source: c } = pillar;
    const a = pillar.thicknessScale;
    const d = (pillar.foot.y - pillar.top.y) / (foot.y - top.y);
    const skew = (pillar.foot.x - pillar.top.x - a * (foot.x - top.x)) / (foot.y - top.y);
    ctx.save();
    ctx.transform(a, 0, skew, d, pillar.top.x - a * top.x - skew * top.y, pillar.top.y - d * top.y);
    ctx.drawImage(source.image, c.x, c.y, c.width, c.height, c.x, c.y, c.width, c.height);
    ctx.restore();
  }
  const c = roof.cap.source, b = roof.cap.body;
  ctx.drawImage(source.image, c.x, c.y, c.width, c.height, b.x, b.y, b.width, b.height);
  ctx.restore(); return true;
}

/** Illustrated rotating wheel face. Cosmetic rim effects are optional overlays. */
export function drawCarWheels(ctx, options = {}) {
  const img = images.get('wheel'); if (!img) return false;
  const { wheels } = getCarArtLayout(options), c = CAR_WHEEL_ART.crop;
  const rotation = Number.isFinite(options.rotation) ? options.rotation : 0;
  const style = typeof options.wheels === 'string' ? options.wheels : options.wheels?.id;
  for (const wheel of wheels) {
    const r = wheel.radius;
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(wheel.x), Math.round(wheel.y)); ctx.rotate(rotation);
    ctx.drawImage(img, c.x, c.y, c.width, c.height, -r, -r, r * 2, r * 2);
    if (style && style !== 'classic') {
      ctx.globalAlpha = style === 'neon' ? .8 : .55;
      ctx.strokeStyle = style === 'neon' ? '#82ffed' : style === 'gold' ? '#ffe59c' : '#ff82bd';
      ctx.lineWidth = Math.max(.75, r * .09); ctx.beginPath(); ctx.arc(0, 0, r * .64, 0, Math.PI * 2); ctx.stroke();
      if (style === 'heart') {
        ctx.globalAlpha = .95; ctx.fillStyle = '#ff82bd';
        const h = r * .22; ctx.beginPath(); ctx.moveTo(0, h);
        ctx.bezierCurveTo(-h * 2, -h * .2, -h, -h * 1.5, 0, -h * .5);
        ctx.bezierCurveTo(h, -h * 1.5, h * 2, -h * .2, 0, h); ctx.fill();
      }
    }
    ctx.restore();
  }
  return true;
}
