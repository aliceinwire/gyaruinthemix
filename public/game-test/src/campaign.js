import { t, message, number } from './i18n.js';
/** Campaign interludes. All coordinates are designed at 960 × 540. */
import { ROUTES } from "./simulation.js";
import { drawCarBody, drawCarWheels, getCarArtLayout } from "./car-art.js";
import { getCityImage } from "./scenery.js";
import { getDistrictRaster, preloadDistrictArt } from "./district-art.js";
import { getJourneyStage, getJourneyChoices, JOURNEY_STAGE_COUNT } from "./journey.js";

const W = 960;
const H = 540;
const FONT =
  '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const MONO = '"Courier New", monospace';
const C = {
  bg: "#100d22",
  panel: "#17152e",
  line: "#3c3355",
  muted: "#a298ba",
  ink: "#fff2ff",
  pink: "#ff57b7",
  cyan: "#77f4e8",
  gold: "#ffe091",
};
const images = { arisu: null, chana: null, logo: null, stage: null, console: null, duoConsole: null };
let preload;

/** Resolves when the approved transparent character atlases and logo are ready. */
export function preloadCampaign() {
  if (!preload) {
    preload = Promise.allSettled(
      [
        ["arisu", "../assets/characters/arisu-atlas.png"],
        ["chana", "../assets/characters/chana-atlas.png"],
        ["logo", "../assets/brand/gyaruinthemix-logo.png"],
        ["stage", "../assets/finale/neon-club-stage.png"],
        ["console", "../assets/finale/dj-console.png"],
        ["duoConsole", "../assets/finale/duo-dj-console.png"],
      ].map(([key, path]) => {
        if (images[key]) return Promise.resolve(images[key]);
        return new Promise((resolve, reject) => {
          const img = new Image();
          let settled = false;
          let timeout;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            img.onload = null;
            img.onerror = null;
            if (error) {
              img.src = "";
              if (key === "duoConsole") resolve(null);
              else reject(error);
            }
            else { images[key] = img; resolve(img); }
          };
          img.onload = () => finish();
          img.onerror = () => finish(new Error(`Could not load campaign art: ${key}`));
          timeout = setTimeout(() => finish(new Error(`Campaign art load timed out: ${key}`)), 15000);
          img.src = new URL(path, import.meta.url).href;
        });
      }),
    ).then(results => {
      const failed = results.find(result => result.status === "rejected");
      if (failed) { preload = null; throw failed.reason; }
      return results.map(result => result.value);
    });
  }
  return preload;
}

function rect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height),
  );
}

function text(
  ctx,
  str,
  x,
  y,
  size = 16,
  color = C.ink,
  align = "left",
  weight = 700,
  mono = false,
) {
  ctx.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(t(str), x, y);
}

function line(ctx, points, color, width = 2, dash = []) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "bevel";
  ctx.lineCap = "butt";
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function panel(ctx, x, y, width, height, border = C.line, fill = C.panel) {
  rect(ctx, x, y, width, height, fill);
  rect(ctx, x + 8, y, width - 16, 1, border);
  rect(ctx, x + 8, y + height - 1, width - 16, 1, border);
  rect(ctx, x, y + 8, 1, height - 16, border);
  rect(ctx, x + width - 1, y + 8, 1, height - 16, border);
  for (const [px, py] of [
    [x + 3, y + 3],
    [x + width - 6, y + 3],
    [x + 3, y + height - 6],
    [x + width - 6, y + height - 6],
  ]) {
    rect(ctx, px, py, 3, 3, border);
  }
}

function diamond(ctx, x, y, size, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function sparkle(ctx, x, y, color, size = 6) {
  rect(ctx, x - size, y - 1, size * 2 + 2, 2, color);
  rect(ctx, x - 1, y - size, 2, size * 2 + 2, color);
  rect(ctx, x - 2, y - 2, 4, 4, color);
}

function setCanvas(ctx, width, height) {
  ctx.save();
  ctx.scale(width / W, height / H);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  ctx.lineDashOffset = 0;
}

function mapBackground(ctx, time) {
  rect(ctx, 0, 0, W, H, C.bg);
  for (let x = 18; x < W; x += 24) {
    for (let y = 18; y < H; y += 24) rect(ctx, x, y, 1, 1, "#32223e");
  }
  // Discrete corner marks keep the map ordered rather than visually noisy.
  line(
    ctx,
    [
      [0, 34],
      [12, 34],
      [12, 12],
      [34, 12],
    ],
    "#5a2954",
    2,
  );
  line(
    ctx,
    [
      [926, 528],
      [948, 528],
      [948, 506],
      [960, 506],
    ],
    "#3a6f76",
    2,
  );
  sparkle(ctx, 620, 43, C.pink, 4 + Math.round(Math.sin(time * 2)));
  sparkle(ctx, 643, 56, C.cyan, 3);
}

function cityIcon(ctx, x, y, index, color) {
  if (index === 0) {
    rect(ctx, x - 12, y - 9, 24, 18, color);
    for (let i = 0; i < 3; i++) rect(ctx, x - 8 + i * 7, y - 5, 3, 3, C.bg);
    rect(ctx, x - 3, y + 2, 6, 7, C.bg);
  } else if (index === 1) {
    rect(ctx, x - 11, y - 13, 8, 24, color);
    rect(ctx, x + 3, y - 17, 8, 28, color);
    rect(ctx, x - 14, y + 9, 28, 3, color);
    for (let k = 0; k < 3; k++) rect(ctx, x + 5, y - 13 + k * 7, 3, 3, C.bg);
  } else if (index === 2) {
    rect(ctx, x - 10, y - 13, 20, 26, color);
    text(ctx, "109", x, y - 1, 9, C.bg, "center", 900, true);
    rect(ctx, x - 13, y + 10, 26, 3, color);
  } else if (index === 3) {
    rect(ctx, x - 16, y - 11, 32, 5, color);
    rect(ctx, x - 11, y - 5, 4, 19, color);
    rect(ctx, x + 7, y - 5, 4, 19, color);
    rect(ctx, x - 4, y - 3, 8, 13, color);
  } else if (index === 4) {
    rect(ctx, x - 13, y - 12, 26, 24, color);
    rect(ctx, x - 10, y - 9, 20, 18, C.bg);
    rect(ctx, x - 2, y - 7, 4, 4, color);
    line(
      ctx,
      [
        [x - 8, y - 4],
        [x, y],
        [x + 8, y - 4],
      ],
      color,
      3,
    );
    line(
      ctx,
      [
        [x, y],
        [x - 5, y + 7],
      ],
      color,
      3,
    );
  } else {
    for (let i = 0; i < 3; i++) {
      rect(ctx, x - 6 - i * 3, y - 12 + i * 8, 12 + i * 6, 4, color);
      rect(ctx, x - 4, y - 8 + i * 8, 8, 5, color);
    }
    rect(ctx, x - 1, y - 18, 2, 6, color);
  }
}

function drawTour(ctx, stageIndex) {
  const cityIndex = Math.floor(stageIndex / 2);
  line(ctx, [[88, 105], [872, 105]], C.line, 3);
  ROUTES.filter((_, index) => index % 2 === 0).forEach((route, i) => {
    const x = 88 + i * 156;
    const color = i === cityIndex ? C.pink : i < cityIndex ? C.cyan : C.muted;
    panel(ctx, x - 22, 83, 44, 44, color, C.panel);
    cityIcon(ctx, x, 105, i, color);
    text(ctx, route.goal || route.city || route.cityId, x, 142, 14, color, "center");
    for (let leg = 0; leg < 2; leg++) {
      const n = i * 2 + leg;
      rect(ctx, x - 13 + leg * 15, 157, 11, 4, n < stageIndex ? C.cyan : n === stageIndex ? C.pink : C.line);
    }
  });
}

function road(ctx, points, color, active, time) {
  line(ctx, points, active ? `${color}24` : "#211f36", active ? 26 : 22);
  line(ctx, points, active ? color : "#56506b", 16);
  line(ctx, points, active ? "#242437" : "#252235", 10);
  ctx.lineDashOffset = -time * (active ? 22 : 8);
  line(ctx, points, active ? color : "#80738c", 2, [9, 13]);
  ctx.lineDashOffset = 0;
}

function tinyCar(ctx, x, y, time, carId) {
  const options = {carId, x, y: y + 22, width: 122, rotation: time * .3};
  drawCarWheels(ctx, options); drawCarBody(ctx, options);
  const mark = getCarArtLayout(options).logo;
  if (images.logo) ctx.drawImage(images.logo, mark.x, mark.y, mark.width, mark.height);
}

/** Pointer regions use the same logical 960 × 540 space as the canvas. */
export const MAP_CHOICE_HITBOXES = Object.freeze([188, 296, 404].map((y, index) =>
  Object.freeze({ index, x: 298, y, width: 234, height: 96 })));
export function hitTestMapChoice(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return MAP_CHOICE_HITBOXES.find(box => x >= box.x && x < box.x + box.width &&
    y >= box.y && y < box.y + box.height)?.index ?? null;
}
export async function preloadJourneyMap(stageIndex = 0, seed = 0, season = "spring") {
  const nodes = [...getJourneyChoices(stageIndex, seed), ...getJourneyChoices(stageIndex + 1, seed)];
  return Promise.allSettled(nodes.map(node => preloadDistrictArt(node.cityId, node.locationIndex, season)));
}
function districtThumb(ctx, node, x, y, width, height, season) {
  const img = getDistrictRaster(node.cityId, node.locationIndex, season) || getCityImage(node.cityId);
  if (img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const sourceHeight = Math.min(ih, iw * height / width);
    ctx.drawImage(img, 0, ih - sourceHeight, iw, sourceHeight, x, y, width, height);
  } else {
    rect(ctx, x, y, width, height, "#302d49");
    cityIcon(ctx, x + width / 2, y + height / 2, node.cityIndex, C.muted);
  }
}
const nodeColor = node => node.kind === "ev" ? C.cyan : node.kind === "event" ? C.pink : C.gold;
const nodePerk = node => node.kind === "ev" ? "EV多め / ゆったり" : node.kind === "event" ? "コイン +25% / 人波多め" : "到着で耐久 +20 / EV少なめ";

/** A connected destination graph: current stop → three roads → next three roads → club. */
export function drawMap(ctx, {
  routeIndex = 0, stageIndex = routeIndex, route, choices, choice,
  carId = "mix-175", season = "spring", seed = 0, time = 0, width = W, height = H,
} = {}) {
  const index = Math.max(0, Math.min(JOURNEY_STAGE_COUNT - 1, Math.trunc(Number(stageIndex) || 0)));
  const stage = getJourneyStage(index);
  const nodes = choices?.length === 3 ? choices : getJourneyChoices(index, seed);
  const next = getJourneyStage(index + 1);
  const future = getJourneyChoices(index + 1, seed);
  const selected = nodes.find(n => n.nodeId === choice) || nodes.find(n => n.routeOption === choice) || nodes[0];
  const color = nodeColor(selected);
  setCanvas(ctx, width, height);
  mapBackground(ctx, time);
  text(ctx, "今夜は、どの街角を走る？", 32, 31, 24, C.ink, "left", 900);
  text(ctx, "東京から関西へ · 6つの街を12本の道でつなぐで", 34, 59, 11, C.muted, "left", 700);
  panel(ctx, 731, 20, 197, 44, C.pink, "#2c1933");
  text(ctx, `道のり ${String(index + 1).padStart(2, "0")} / 12`, 829, 42, 19, "#ffc2e4", "center", 900);
  drawTour(ctx, index);

  text(ctx, "いまここ", 115, 211, 13, C.cyan, "center");
  text(ctx, "行き先を選んで出発", 298, 177, 12, C.ink);
  text(ctx, next ? "その先の分岐" : "ラストセット", 708, 177, 12, C.muted, "center");
  // Draw every edge before the nodes, so the graph remains legible beneath art.
  road(ctx, [[173, 344], [222, 344]], C.gold, true, time);
  nodes.forEach((node, i) => {
    const cy = MAP_CHOICE_HITBOXES[i].y + 48;
    const active = node.nodeId === selected.nodeId;
    road(ctx, [[222, 344], [260, cy], [298, cy]], nodeColor(node), active, time);
    line(ctx, [[532, cy], [566, cy], [596, 344]], active ? color : C.line, active ? 3 : 2);
  });
  if (future.length) {
    future.forEach((node, i) => {
      const y = 235 + i * 108;
      line(ctx, [[596, 344], [632, y], [665, y]], "#665476", 2, [4, 5]);
      line(ctx, [[751, y], [781, y], [809, 344]], "#665476", 2, [4, 5]);
    });
  } else line(ctx, [[596, 344], [809, 344]], color, 3, [5, 7]);

  // The chosen vehicle is the player's current-position marker, not a generic dot.
  panel(ctx, 42, 246, 146, 166, "#41525e", "#171b30");
  tinyCar(ctx, 115, 318, time, carId);
  text(ctx, index ? "前の街角から" : "ガレージから", 115, 376, 13, C.ink, "center");
  text(ctx, `${stage.cityName} / ${stage.leg + 1}本目`, 115, 397, 12, C.cyan, "center");
  text(ctx, "線でつながる場所へ", 115, 440, 11, C.muted, "center");
  text(ctx, "走って進もう", 115, 457, 11, C.muted, "center");

  nodes.forEach((node, i) => {
    const {x, y, width: w, height: h} = MAP_CHOICE_HITBOXES[i];
    const active = node.nodeId === selected.nodeId, accent = nodeColor(node);
    panel(ctx, x, y, w, h, active ? accent : C.line, active ? "#27213b" : C.panel);
    districtThumb(ctx, node, x + 5, y + 5, w - 10, 40, season);
    rect(ctx, x + 5, y + 5, 25, 21, active ? accent : "#17152ee8");
    text(ctx, String(i + 1), x + 17, y + 16, 13, active ? C.bg : C.ink, "center", 900, true);
    text(ctx, node.name, x + 10, y + 59, 14, C.ink);
    text(ctx, nodePerk(node), x + 10, y + 81, 11, accent);
    if (active) diamond(ctx, x - 10, y + 48, 5, accent);
  });
  diamond(ctx, 596, 344, 9, color);
  text(ctx, stage.clubStop ? "クラブ到着" : "街角に到着", 596, 376, 10, C.gold, "center");
  if (stage.clubStop) text(ctx, stage.club, 596, 393, 9, C.gold, "center", 700, true);

  future.forEach((node, i) => {
    const y = 235 + i * 108;
    panel(ctx, 665, y - 30, 86, 60, "#62516e", C.panel);
    districtThumb(ctx, node, 669, y - 26, 78, 30, season);
    text(ctx, ["充電", "イベント", "整備"][i], 708, y + 17, 11, nodeColor(node), "center");
    const label = node.name.length > 10 ? node.name.slice(0, 9) + "…" : node.name;
    text(ctx, label, 708, y + 42, 10, C.muted, "center");
  });
  panel(ctx, 809, 278, 123, 134, C.pink, "#28182d");
  const destinationStage = next || stage;
  const cityImage = getCityImage(destinationStage.cityId);
  if (cityImage) ctx.drawImage(cityImage, 815, 284, 111, 67);
  else cityIcon(ctx, 870, 318, destinationStage.cityIndex, C.pink);
  rect(ctx, 815, 335, 111, 25, "#17152eda");
  text(ctx, next ? destinationStage.cityName : "最後のDJセット", 870, 347, 12, C.gold, "center", 900);
  if (images.logo) ctx.drawImage(images.logo, 817, 363, 107, 36);
  else text(ctx, "CLUB", 870, 381, 18, C.pink, "center", 900, true);
  text(ctx, destinationStage.club, 870, 432, 10, C.ink, "center", 800, true);
  text(ctx, next ? "この先のフロア" : "ありねぇ × ちゃな", 870, 451, 11, C.pink, "center");
  text(ctx, selected.story, 480, 523, 14, "#d7c4df", "center");
  ctx.restore();
}

function beam(ctx, x, y, endX, endY, spread, color) {
  ctx.beginPath();
  ctx.moveTo(x - 4, y);
  ctx.lineTo(endX - spread, endY);
  ctx.lineTo(endX + spread, endY);
  ctx.lineTo(x + 4, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function avatar(ctx, key, centerX, time, phase) {
  const img = images[key];
  if (!img) return;
  const wave = Math.floor((time + phase) / 3) % 3 === 1;
  const row = wave ? 3 : 0;
  const frame = Math.floor((time + phase) * (wave ? 4 : 3)) % (wave ? 4 : 6);
  // Chana's source silhouette is narrower; equal visual head height keeps both readable.
  const scale = key === "chana" ? 1.6 : 1.28;
  // Arisu's wave row has 21px more top padding than her idle row.
  const baseline = key === "chana" ? 99 : wave ? 104 : 128;
  const y = baseline + Math.round(Math.sin(time * 6.8 + phase) * 3);
  ctx.drawImage(
    img,
    frame * 192,
    row * 208,
    192,
    208,
    Math.round(centerX - 96 * scale),
    y,
    Math.round(192 * scale),
    Math.round(208 * scale),
  );
}

function crowd(ctx, time, totalFans) {
  const energy = Math.min(1, Math.log2(totalFans + 1) / 7);
  for (let row = 0; row < 2; row++) {
    const count = Math.round((row ? 18 : 14) + energy * 12);
    for (let i = 0; i < count; i++) {
      const x = -12 + i * (984 / (count - 1)) + (row ? 11 : 0);
      const hop = Math.round(
        Math.max(0, Math.sin(time * 6.8 + i * 0.57)) * (4 + energy * 8),
      );
      const y = (row ? 526 : 496) - hop;
      const color = row ? "#090b19" : i % 3 === 0 ? "#452142" : "#27203c";
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(x, y-3, 10, 12, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x-9,y+6); ctx.lineTo(x+9,y+6); ctx.quadraticCurveTo(x+17,y+10,x+18,y+40); ctx.lineTo(x-18,y+40); ctx.quadraticCurveTo(x-17,y+10,x-9,y+6); ctx.fill();
      const raise = (i * 7 + row * 11) % 10 < 3 + energy * 6;
      if (raise) {
        line(
          ctx,
          [
            [x - 10, y + 13],
            [x - 23, y - 3],
            [x - 24, y - 23],
          ],
          color,
          7,
        );
        line(
          ctx,
          [
            [x + 10, y + 13],
            [x + 21, y - 6],
            [x + 20, y - 28],
          ],
          color,
          7,
        );
        if (i % 3 === 0)
          rect(ctx, x + 17, y - 37, 5, 18, i % 2 ? C.cyan : C.pink);
      }
      if (!row && i % 4 === 2) rect(ctx, x - 7, y - 13, 14, 3, "#d56aa5");
    }
  }
}

/** Animated two-DJ set for each club and the final shared mix. */
export function drawFinale(
  ctx,
  { time = 0, score = 0, totalFans = 0, converted = 0, performance = null, club = '', complete = true, width = W, height = H } = {},
) {
  setCanvas(ctx, width, height);
  rect(ctx, 0, 0, W, H, "#0c1023");
  if (images.stage) ctx.drawImage(images.stage, 0, 0, W, H);
  const setEnergy = performance?.energy || 0;
  for (let i = 0; i < 6; i++) {
    const x = 80 + i * 160;
    beam(ctx, x, 72, x + Math.sin(time * (.7 + setEnergy*.25) + i * 1.7) * 190, 450, 55 + setEnergy*20,
      i % 2 ? "#61f2eb0d" : "#ff50bd10");
  }
  rect(ctx, 20, 8, 920, 30, "#0c1023c9");
  text(ctx, complete ? "ツアー完走や！" : club, 32, 23, 18, C.gold, "left", 900, true);
  const scoreValue = Math.max(0, Math.round(Number(score) || 0));
  const fanCount = Math.max(0, Math.floor(Number(totalFans) || 0));
  text(
    ctx,
    message("{0} 人のファンが来たで", [number(fanCount, { useGrouping: true })]),
    480,
    23,
    15,
    C.cyan,
    "center",
    800,
    true,
  );
  text(
    ctx,
    message("{0} 点", [number(scoreValue, { useGrouping: true })]),
    928,
    23,
    16,
    "#edc7e6",
    "right",
    800,
    true,
  );

  if (images.logo) ctx.drawImage(images.logo, 290, 61, 380, 127);
  else text(ctx, "ギャルインザミックス", 480, 130, 35, C.pink, "center", 900);
  text(
    ctx,
    "DJ ARINEE × DJ CHANA",
    480,
    66,
    12,
    "#ffe1ef",
    "center",
    800,
    true,
  );

  // Hands and hardware share one composition, keeping every wrist attached
  // throughout the beat. Lighting moves independently of the contact points.
  if (images.duoConsole) {
    const pulse = Math.sin(time * 6.8) * .002;
    const w = 640 * (1 + pulse), h = 365 * (1 + pulse);
    ctx.drawImage(images.duoConsole, 480 - w / 2, 490 - h, w, h);
    for (let i = 0; i < 12; i++) {
      const h = 2 + (Math.sin(time * 8 + i) + 1) * 5;
      rect(ctx, 453 + i * 5, 425 - h, 3, h, i % 2 ? C.cyan : C.pink);
    }
  } else {
    avatar(ctx, "arisu", 348, time, 0);
    avatar(ctx, "chana", 609, time, 1.8);
    if (images.console) ctx.drawImage(images.console, 193, 335, 574, 159);
  }
  text(ctx, "DJありねぇ", 333, 453, 24, "#ffe0f0", "center", 900);
  text(ctx, "DJちゃな", 626, 453, 24, "#e0fffa", "center", 900);
  text(ctx, "音出してるで", 480, 457, 11, C.pink, "center", 900, true);
  for (let i = 0; i < 9; i++) {
    const h = 3 + Math.round((Math.sin(time * 6.8 + i * 0.8) + 1) * 5);
    rect(ctx, 449 + i * 7, 478 - h, 4, h, i % 2 ? C.cyan : C.pink);
  }

  // Deterministic confetti: looping, subtle, and free of random frame-to-frame noise.
  for (let i = 0; i < 38; i++) {
    const x = (i * 137 + Math.sin(time + i) * 18 + 960) % 960;
    const y = ((i * 73 + time * (18 + (i % 11))) % 420) + 63;
    if (x > 235 && x < 720 && y > 150 && y < 350) continue;
    rect(
      ctx,
      x,
      y,
      i % 2 ? 4 : 7,
      i % 2 ? 7 : 3,
      [C.pink, C.cyan, C.gold, "#b78ffa"][i % 4],
    );
  }
  crowd(ctx, time, fanCount + Math.min(120, converted) + Math.round(setEnergy * 80));
  panel(ctx, 259, 489, 442, 35, "#a5659c", "#201329");
  text(ctx, performance?.phase || "6つの街、全員ぶちアゲ！", 480, 507, 20, performance?.color || "#fff0fd", "center", 900);
  if (performance?.energy > .2) {
    for (let i = 0; i < 8; i++) {
      const x = 98 + i * 108, h = (12 + Math.sin(time*4+i)*8) * performance.energy;
      rect(ctx,x,194-h,3,h, i%2 ? C.cyan : C.pink);
    }
  }
  ctx.restore();
}
