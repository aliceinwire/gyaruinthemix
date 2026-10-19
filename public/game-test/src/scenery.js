import { getDistrictRaster } from "./district-art.js";
import {
  preloadSeasonalScenery,
  getSeasonalRaster,
  isSeasonalSceneryReady,
} from "./seasonal-scenery.js";
/**
 * Illustrated, location-specific Japanese scenery.
 * Original city plates generated for this game; all animation is drawn locally.
 * World distance is in screen/world pixels and time is in seconds.
 */
const asset = (name) =>
  new URL(`../assets/cities/${name}.png`, import.meta.url).href;

export const CITY_ART = Object.freeze([
  {
    id: "nakano",
    name: "中野",
    english: "NAKANO",
    subtitle: "サンプラザ / サンモール",
    accent: "#ff91d2",
    sky: "#9660b1",
    image: asset("nakano"),
    landmark: "Sunplaza & Sun Mall",
    atmosphere: "shopping",
  },
  {
    id: "shinjuku",
    name: "新宿",
    english: "SHINJUKU",
    subtitle: "都庁 / 歌舞伎町",
    accent: "#70f3eb",
    sky: "#8e57ae",
    image: asset("shinjuku"),
    landmark: "Metropolitan towers & Kabukicho",
    atmosphere: "neon",
  },
  {
    id: "shibuya",
    name: "渋谷",
    english: "SHIBUYA",
    subtitle: "109 / スクランブル交差点",
    accent: "#ff66bd",
    sky: "#9360ae",
    image: asset("shibuya"),
    landmark: "109 & Scramble Crossing",
    atmosphere: "fashion",
  },
  {
    id: "asakusa",
    name: "浅草",
    english: "ASAKUSA",
    subtitle: "雷門 / 東京スカイツリー",
    accent: "#ffbf86",
    sky: "#9560b0",
    image: asset("asakusa"),
    landmark: "Kaminarimon, Senso-ji & Skytree",
    atmosphere: "lanterns",
  },
  {
    id: "osaka",
    name: "大阪",
    english: "OSAKA",
    subtitle: "道頓堀 / 通天閣",
    accent: "#68e9ef",
    sky: "#8c55ac",
    image: asset("osaka"),
    landmark: "Dotonbori canal & Tsutenkaku",
    atmosphere: "canal",
  },
  {
    id: "kyoto",
    name: "京都",
    english: "KYOTO",
    subtitle: "八坂の塔 / 東山",
    accent: "#ffb5ce",
    sky: "#9860ae",
    image: asset("kyoto"),
    landmark: "Yasaka Pagoda & Higashiyama",
    atmosphere: "sakura",
  },
]);

const catalog = new Map(CITY_ART.map((city) => [city.id, city]));
const images = new Map();
const raster = new Map();
const jobs = new Map();
const mod = (value, max) => ((value % max) + max) % max;
const hash = (n) => mod(Math.sin(n * 127.1 + 311.7) * 43758.5453, 1);

export function getCityArt(cityId) {
  return catalog.get(cityId) || CITY_ART[0];
}
export function getCityImage(cityId) {
  return images.get(getCityArt(cityId).id) || null;
}
export function isSceneryReady(cityId, season = "spring") {
  const id = getCityArt(cityId).id;
  return season === "spring"
    ? raster.has(id)
    : isSeasonalSceneryReady(id, season);
}

/** Loads all city art once. Individual failures do not prevent the other routes. */
export async function preloadScenery(
  cityIds = CITY_ART.map((city) => city.id),
) {
  if (typeof Image === "undefined") return Promise.resolve([]);
  const originals = await Promise.all(
    cityIds.map((id) => {
      const city = getCityArt(id);
      if (jobs.has(city.id)) return jobs.get(city.id);
      let resolveJob;
      const job = new Promise(resolve => { resolveJob = resolve; });
      jobs.set(city.id, job);
      const image = new Image();
      let settled = false;
      let timeout;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        if (!loaded) {
          jobs.delete(city.id);
          image.src = "";
        }
        resolveJob({ id: city.id, loaded });
      };
      image.decoding = "async";
      image.onload = () => {
        if (settled) return;
        try {
          // Keep city plates on the same honest pixel grid as the car and effects.
          const plate = document.createElement("canvas");
          plate.width = 528;
          plate.height = 165;
          const ctx = plate.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D context unavailable");
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(image, 0, 0, plate.width, plate.height);
          images.set(city.id, image);
          raster.set(city.id, plate);
          finish(true);
        } catch { finish(false); }
      };
      image.onerror = () => finish(false);
      timeout = setTimeout(() => finish(false), 15000);
      image.src = city.image;
      return job;
    }),
  );
  const seasonal = await preloadSeasonalScenery(
    cityIds.map((id) => getCityArt(id).id),
  );
  const results = [...originals, ...seasonal];
  if (results.some((result) => !result.loaded))
    throw new Error("Required city or seasonal art failed to load");
  return results;
}

function streetLamp(ctx, x, floor, lantern, accent) {
  const top = floor - (lantern ? 66 : 86);
  ctx.fillStyle = "#201b38";
  ctx.fillRect(x - 2, top, 4, floor - top);
  ctx.fillRect(x - 7, floor - 5, 14, 5);
  ctx.fillStyle = "#6f5075";
  ctx.fillRect(x - 1, top + 17, 1, floor - top - 23);
  if (lantern) {
    ctx.fillStyle = "#271d39";
    ctx.fillRect(x - 10, top, 20, 3);
    ctx.fillRect(x - 8, top + 17, 16, 3);
    ctx.fillStyle = "#da6682";
    ctx.fillRect(x - 8, top + 3, 16, 14);
    ctx.fillStyle = "#ffdbab";
    ctx.fillRect(x - 5, top + 4, 10, 11);
    ctx.fillStyle = "#fff2cf";
    ctx.fillRect(x - 2, top + 5, 3, 9);
  } else {
    ctx.fillStyle = "#211d39";
    ctx.fillRect(x - 4, top - 4, 8, 3);
    ctx.fillRect(x - 8, top - 1, 16, 15);
    ctx.fillRect(x - 5, top + 14, 10, 3);
    ctx.fillStyle = "#ffdf9c";
    ctx.fillRect(x - 5, top + 1, 10, 11);
    ctx.fillStyle = "#fff7ce";
    ctx.fillRect(x - 2, top + 2, 4, 8);
    ctx.fillStyle = accent;
    ctx.fillRect(x + 3, top + 24, 12, 19);
    ctx.fillStyle = "#efdaeb";
    ctx.fillRect(x + 6, top + 28, 6, 2);
    ctx.fillRect(x + 6, top + 33, 4, 2);
    ctx.fillRect(x + 6, top + 37, 6, 2);
  }
}

function foreground(ctx, city, distance, time, horizon, season) {
  const traditional = city.id === "asakusa" || city.id === "kyoto";
  const floor = horizon - 4;
  // Fine dark railing and tactile sidewalk remain beneath the actual city art.
  ctx.fillStyle = "#262039";
  ctx.fillRect(0, floor - 4, 960, 8);
  ctx.fillStyle = "#8b657f";
  ctx.fillRect(0, floor - 5, 960, 1);
  const near = mod(distance * 0.34, 192);
  for (let i = -1; i < 7; i++) {
    const x = Math.round(i * 192 - near);
    ctx.fillStyle = "#221d36";
    ctx.fillRect(x, floor - 17, 190, 2);
    ctx.fillRect(x + 10, floor - 19, 3, 19);
    ctx.fillRect(x + 65, floor - 17, 2, 17);
    ctx.fillRect(x + 124, floor - 17, 2, 17);
    ctx.fillStyle = "#9c647f";
    ctx.fillRect(x + 10, floor - 19, 3, 1);
  }
  const lampPhase = mod(distance * 0.39, 390);
  for (let i = -1; i < 4; i++) {
    streetLamp(
      ctx,
      Math.round(i * 390 - lampPhase + 140),
      floor,
      traditional,
      city.accent,
    );
  }
  // Flower boxes add passing detail without concealing landmark silhouettes.
  const boxPhase = mod(distance * 0.43, 520);
  for (let i = -1; i < 3; i++) {
    const x = Math.round(i * 520 + 295 - boxPhase);
    ctx.fillStyle = "#3a2c45";
    ctx.fillRect(x, floor - 9, 39, 9);
    ctx.fillStyle = "#96617a";
    ctx.fillRect(x - 2, floor - 12, 43, 4);
    ctx.fillStyle = "#25454b";
    ctx.fillRect(x + 3, floor - 17, 31, 5);
    for (let f = 0; f < 8; f++) {
      ctx.fillStyle =
        season === "winter"
          ? "#d5e4ed"
          : season === "autumn"
            ? f % 3
              ? "#d58c4f"
              : "#aa6650"
            : season === "summer"
              ? f % 3
                ? "#6ca66c"
                : "#ffe5b8"
              : f % 3
                ? "#ef7daf"
                : "#ffe5b8";
      ctx.fillRect(x + 3 + f * 4, floor - 20 - (f % 3) * 2, 3, 3);
    }
  }
  if (city.id === "osaka") {
    ctx.save();
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(hash(i + 100) * 960 + Math.sin(time * 1.1 + i) * 3);
      const y = Math.floor(horizon * 0.84 + hash(i + 300) * horizon * 0.1);
      ctx.fillStyle = i % 3 ? "#ff78c0" : "#ffe6a7";
      ctx.fillRect(x, y, 4 + Math.floor(hash(i) * 15), 1);
    }
    ctx.restore();
  }
}

function atmosphere(ctx, city, distance, time, horizon, season) {
  const petals =
    season === "spring" && (city.id === "kyoto" || city.id === "asakusa");
  const count = petals ? 20 : 9;
  ctx.save();
  for (let i = 0; i < count; i++) {
    if (petals) {
      const x =
        mod(
          hash(i + 30) * 1100 - distance * (0.12 + hash(i) * 0.08) - time * 12,
          1100,
        ) - 70;
      const y = mod(
        hash(i + 9) * horizon + time * (4 + hash(i + 5) * 5),
        horizon - 18,
      );
      const drift = Math.sin(time * 1.5 + i) * 10;
      ctx.globalAlpha = 0.5 + hash(i) * 0.35;
      ctx.fillStyle = i % 3 ? "#ffc3dc" : "#ffe3e9";
      ctx.fillRect(Math.round(x + drift), Math.round(y), 3, 2);
      if (Math.sin(time * 3 + i) > 0)
        ctx.fillRect(Math.round(x + drift + 2), Math.round(y - 1), 2, 1);
    } else {
      const flash = Math.sin(time * 1.2 + i * 2.6);
      if (flash < 0.55) continue;
      const x = Math.round(hash(i + 80) * 960);
      const y = Math.round(12 + hash(i + 25) * 45);
      ctx.globalAlpha = (flash - 0.55) * 0.8;
      ctx.fillStyle = "#ffe8eb";
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
    }
  }
  ctx.restore();
}

/**
 * Draws scenery only, ending at horizonY (default 330 on a 960 × 540 canvas).
 * Call before road, hazards, player, and HUD. Does not modify caller state.
 */
export function drawScenery(ctx, options = {}) {
  const {
    cityId = "nakano",
    locationIndex = 0,
    season = "summer",
    distance = 0,
    time = 0,
    width = 960,
    height = 540,
    horizonY = 330,
  } = options;
  const city = getCityArt(cityId);
  const plate = getDistrictRaster(city.id, locationIndex, season) ||
    (season === "spring" ? raster.get(city.id) : getSeasonalRaster(city.id, season));
  const d = Number.isFinite(distance) ? distance : 0;
  const t = Number.isFinite(time) ? time : 0;
  ctx.save();
  ctx.scale(width / 960, height / 540);
  ctx.beginPath();
  ctx.rect(0, 0, 960, horizonY);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = city.sky;
  ctx.fillRect(0, 0, 960, horizonY);
  if (plate) {
    // A long slow tracking pan keeps each landmark recognizable throughout its
    // route; the independent faster sidewalk layers supply side-scrolling depth.
    const pan = Math.min(96, Math.max(0, d) * 0.024);
    ctx.drawImage(plate, -Math.floor(pan / 2) * 2, 0, 1056, horizonY);
  } else {
    // Request late city loads without making the animation loop wait for them.
    if (!jobs.has(city.id)) preloadScenery([city.id]).catch(() => {});
    ctx.fillStyle = "#e687a9";
    ctx.fillRect(0, horizonY * 0.42, 960, horizonY * 0.58);
    ctx.fillStyle = "#30213e";
    ctx.fillRect(0, horizonY - 18, 960, 18);
  }
  atmosphere(ctx, city, d, t, horizonY, season);
  // Painted near-street art replaces the procedural prop layer.
  ctx.restore();
}
