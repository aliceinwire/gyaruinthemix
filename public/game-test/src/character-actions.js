/**
 * Genuine four-keyframe action animation for the approved DJ duo.
 * Generated sheets are not perfectly square or uniformly spaced: measured
 * source rectangles are explicit, never inferred from width / column count.
 * The original base/pet atlases are intentionally untouched.
 */
const rects = (rows) => rows.map(([top, bottom, edges]) =>
  edges.slice(0, -1).map((left, column) =>
    Object.freeze([left, top, edges[column + 1] - left, bottom - top]),
  ),
);

export const CHARACTER_ACTION_SHEETS = Object.freeze({
  arisu: {
    url: new URL(
      "../assets/characters/motion/arisu-motion-v2.png",
      import.meta.url,
    ).href,
    width: 1254,
    height: 1254,
    columns: 4,
    rows: 4,
    framesPerAction: 4,
    actions: ["drive", "point", "shocked", "rally"],
    // Repaired isolated drawings, measured on the generated 1254px sheet.
    // Equal runtime crops keep head scale fixed across actions and frames;
    // broad transparent atlas gutters separate every hand and hair outline.
    sourceRects: [76, 384, 690, 982].map((top) =>
      [42, 356, 670, 984].map((left) => Object.freeze([left, top, 244, 210])),
    ),
  },
  chana: {
    url: new URL(
      "../assets/characters/motion/chana-motion.png",
      import.meta.url,
    ).href,
    width: 1265,
    height: 1244,
    columns: 4,
    rows: 4,
    framesPerAction: 4,
    actions: ["map", "directions", "makeup", "cheer"],
    sourceRects: rects([
      [0, 322, [0, 307, 624, 949, 1265]],
      [322, 626, [0, 306, 624, 965, 1265]],
      [626, 930, [0, 306, 626, 954, 1265]],
      [930, 1240, [0, 311, 636, 957, 1265]],
    ]),
  },
});

export const CHANA_HEART_SHEET = Object.freeze({
  url: new URL('../assets/characters/motion/chana-hearts.png',import.meta.url).href,
  width:1265,height:1243,
  sourceRects:[[0,0,631,600],[631,0,634,600],[0,600,636,600],[636,600,629,600]],
});

export const RUSH_ACTION_SHEETS = Object.freeze({
 arisu: {url:new URL('../assets/characters/motion/duo-rush-arisu.png',import.meta.url).href,width:1278,height:1230,sourceRects:[[0,0,645,610],[645,0,633,610],[0,610,645,620],[645,610,633,620]]},
 chana: {url:new URL('../assets/characters/motion/duo-rush-chana.png',import.meta.url).href,width:1265,height:1243,sourceRects:[[0,0,646,608],[646,0,619,608],[0,608,646,635],[646,608,619,635]]},
});

/** Each sequence contains four genuinely different hand/prop/face drawings. */
export const CHARACTER_MOTION = Object.freeze({
  rush: { fps:2, sequence:[0,1,2,3] },
  hearts: { fps:6, sequence:[0,1,2,2,3,3] },
  drive: { fps: 4, sequence: [0, 1, 0, 3, 0, 2] },
  point: { fps: 5, sequence: [0, 1, 2, 2, 3, 0] },
  shocked: { fps: 5, sequence: [0, 1, 2, 2, 3, 0] },
  rally: { fps: 6, sequence: [0, 1, 2, 3] },
  map: { fps: 3, sequence: [0, 1, 2, 3, 2, 1] },
  directions: { fps: 4, sequence: [0, 1, 2, 2, 3, 1] },
  makeup: { fps: 4, sequence: [0, 1, 2, 3, 2, 1] },
  cheer: { fps: 6, sequence: [0, 1, 2, 3] },
});

export function characterMotionFrame(action, time = 0, animate = true) {
  const motion = CHARACTER_MOTION[action];
  if (!animate || !motion) return 0;
  const seconds = Number.isFinite(time) ? Math.max(0, time) : 0;
  return motion.sequence[Math.floor(seconds * motion.fps) % motion.sequence.length];
}

const images = {};
let loading;
const wetWeather = new Set(["rain", "storm", "snow"]);
const muddyWeather = new Set(["mud", "rally"]);

/** Call with the other game preloads. Returns a status instead of hanging. */
export function preloadCharacterActions() {
  if (!loading) {
    loading = Promise.all(
      Object.entries({...CHARACTER_ACTION_SHEETS, "chana-hearts":CHANA_HEART_SHEET,"arisu-rush":RUSH_ACTION_SHEETS.arisu,"chana-rush":RUSH_ACTION_SHEETS.chana}).map(
        ([name, sheet]) =>
          new Promise((resolve) => {
            if (typeof Image === "undefined")
              return resolve({ name, ready: false });
            const img = new Image();
            let settled=false;
            const timer=setTimeout(()=>finish(false),15000);
            function finish(ready) {
              if(settled)return;settled=true;clearTimeout(timer);
              img.onload=null;img.onerror=null;
              if(ready)images[name]=img;
              resolve({name,ready});
            }
            img.onload=()=>finish((img.naturalWidth||img.width)===sheet.width&&(img.naturalHeight||img.height)===sheet.height);
            img.onerror=()=>finish(false);
            img.src=sheet.url;
          }),
      ),
    ).then(result=>{if(result.some(item=>!item.ready))loading=null;return result;});
  }
  return loading;
}

function weatherName(weather) {
  return typeof weather === "string"
    ? weather
    : weather?.id || weather?.type || "sunny";
}

/** Shared by the small cabin and larger portraits so they act together. */
export function resolveCrewActions({
  time = 0,
  action,
  weather = "sunny",
  boosting = false,
  boost = false,
  shooting = false,
  charging = false,
  rushing = false,
  rushGestureTime = 0,
  invulnerability = 0,
  damage = false,
} = {}) {
  const climate = weatherName(weather);
  const automatic = ["map", "map", "directions", "makeup", "map", "directions"];
  const requested = typeof action === "string" ? action.toLowerCase() : "";
  let arisu = "drive";
  let chana = automatic[Math.floor(Math.max(0, time) / 3) % automatic.length];
  if (
    boosting ||
    boost ||
    /cheer|celebrat|win|success|boost|jump/.test(requested)
  ) {
    chana = "cheer";
  }
  if (
    shooting ||
    charging ||
    /point|direct|turn|shoot|charge|talk/.test(requested)
  ) {
    chana = "directions";
  }
  if (/map|navigat/.test(requested)) chana = "map";
  if (/mirror|lipstick|makeup/.test(requested)) chana = "makeup";
  if (
    damage ||
    invulnerability > 0 ||
    /shock|crash|wrong|ouch|surpris|fail/.test(requested)
  ) {
    arisu = "shocked";
    chana = "directions";
  }
  if (muddyWeather.has(climate) || requested === "rally") arisu = "rally";
  if (action && typeof action === "object") {
    if (CHARACTER_ACTION_SHEETS.arisu.actions.includes(action.arisu))
      arisu = action.arisu;
    if (CHARACTER_ACTION_SHEETS.chana.actions.includes(action.chana) || action.chana === "hearts")
      chana = action.chana;
  }
  // Chana sends the hearts; Arisu keeps both hands on driving duties.
  if (shooting || /shoot/.test(requested)) {
    arisu = muddyWeather.has(climate) ? "rally" : "drive";
    chana = "hearts";
  }
  if (rushing || (rushGestureTime > 0 && !shooting) || requested === "rush" || action?.arisu === "rush") { arisu = "rush"; chana = "rush"; }
  return {
    arisu,
    chana,
    roofClosed: wetWeather.has(climate),
    weather: climate,
  };
}

/** One immutable pose clock/event snapshot for every view in a display frame. */
export function resolveCrewVisuals(state = {}, { time = 0, reducedMotion = false, action } = {}) {
  const visual = {
    time: reducedMotion ? 0 : time,
    animate: !reducedMotion,
    weather: state.weather,
    season: state.season,
    boosting: state.boosting,
    rushing: state.rushing,
    rushTime: state.rushTime,
    rushGestureTime: state.rushGestureTime,
    shooting: state.shooting,
    charging: state.charging,
    invulnerability: state.invulnerability,
    action,
  };
  return Object.freeze({ ...visual, action: Object.freeze(resolveCrewActions(visual)) });
}

function box(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(
    Math.round(x),
    Math.round(y),
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  );
}

function pixelSpark(ctx, x, y, size, color) {
  box(ctx, x - size, y, size * 2 + 1, 1, color);
  box(ctx, x, y - size, 1, size * 2 + 1, color);
}

function drawWeatherAccessories(
  ctx,
  { character, width: w, height: h, weather, season, time },
) {
  if (season === "winter" || weather === "snow") {
    // Warm scarf below the face; the original hair and costume remain visible.
    const neck = character === "arisu" ? 0.73 : 0.75;
    box(ctx, w * 0.39, h * neck, w * 0.22, h * 0.035, "#a8f7fa");
    box(ctx, w * 0.54, h * (neck + 0.025), w * 0.045, h * 0.1, "#66ced9");
    box(ctx, w * 0.43, h * neck, w * 0.025, h * 0.035, "#efffff");
    if (Math.sin(time * 2.4) > 0.2) {
      ctx.globalAlpha *= 0.5;
      box(ctx, w * 0.57, h * 0.66, w * 0.07, h * 0.02, "#e2faff");
      box(ctx, w * 0.62, h * 0.64, w * 0.06, h * 0.02, "#e2faff");
      ctx.globalAlpha /= 0.5;
    }
  }
  if (muddyWeather.has(weather)) {
    // The driver's goggles and mud are illustrated in the rally frame.
    // Passenger keeps her real face, with a little matching road mud.
    if (character === "chana") {
      box(ctx, w * 0.31, h * 0.58, w * 0.035, h * 0.025, "#80502f");
      box(ctx, w * 0.67, h * 0.65, w * 0.04, h * 0.02, "#94623b");
      box(ctx, w * 0.73, h * 0.84, w * 0.04, h * 0.04, "#80502f");
    }
    box(ctx, w * 0.22, h * 0.21, w * 0.025, h * 0.025, "#966239");
  }
  if (weather === "rain" || weather === "storm") {
    // Comical worry bead catches the light without covering their eyes.
    box(ctx, w * 0.71, h * 0.47, w * 0.018, h * 0.045, "#baf5ff");
    box(ctx, w * 0.7, h * 0.5, w * 0.035, h * 0.024, "#5ac5e8");
  }
  if (season === "spring") {
    box(ctx, w * 0.22, h * 0.25, w * 0.03, h * 0.018, "#ffd1e9");
    box(ctx, w * 0.23, h * 0.235, w * 0.012, h * 0.045, "#ff8bc6");
  }
  if (season === "autumn") {
    box(ctx, w * 0.78, h * 0.78, w * 0.035, h * 0.025, "#e99540");
    box(ctx, w * 0.79, h * 0.76, w * 0.014, h * 0.065, "#a45335");
  }
  if (
    (season === "summer" || weather === "sunny") &&
    Math.sin(time * 3) > 0.3
  ) {
    pixelSpark(ctx, w * 0.86, h * 0.36, Math.max(1, w / 35), "#fff5b5");
  }
}

/**
 * Draw one expressive upper-body portrait, with top-left x/y and an explicit
 * box. action may be a single action, a shared event, or { arisu, chana }.
 * Frame changes animate the hands, eyes, head and props inside the illustration;
 * any small weather sway below is secondary, never a substitute for animation.
 */
export function drawCharacter(ctx, options = {}) {
  const {
    character = "arisu",
    x = 0,
    y = 0,
    width = 128,
    height = 128,
    time = 0,
    action,
    weather = "sunny",
    season = "summer",
    animate = true,
  } = options;
  const name = character === "chana" ? "chana" : "arisu";
  const resolved = resolveCrewActions(options);
  const localAction =
    typeof action === "string" &&
    (CHARACTER_ACTION_SHEETS[name].actions.includes(action) || action === "rush" || (name === "chana" && action === "hearts"))
      ? action
      : resolved[name];
  const frame = CHARACTER_ACTION_SHEETS[name].actions.indexOf(localAction);
  const gestureElapsed = Number.isFinite(options.rushGestureTime)
    ? Math.max(0, 0.75 - options.rushGestureTime) * 4 / 0.75
    : Math.max(0, 2 - (options.rushTime ?? 2)) * 2.4;
  const animationFrame = localAction === "rush" ? (animate ? Math.min(3, Math.floor(gestureElapsed)) : 0) : characterMotionFrame(localAction, time, animate);
  const heartSending=name==="chana"&&localAction==="hearts";
  const img=images[localAction === "rush" ? `${name}-rush` : heartSending?"chana-hearts":name];
  if(!img)return false;
  const actionRects = localAction === "rush" ? RUSH_ACTION_SHEETS[name].sourceRects : heartSending ? CHANA_HEART_SHEET.sourceRects : CHARACTER_ACTION_SHEETS[name].sourceRects[frame];
  const sourceRect = actionRects[animationFrame];
  const [sx, sy, cellW, cellH] = sourceRect;
  const upbeat = localAction === "cheer" || localAction === "point" || localAction === "hearts";
  const bob = animate
    ? Math.sin(time * (upbeat ? 8 : 4)) *
      height *
      (upbeat ? 0.018 : 0.007)
    : 0;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // A whole-pixel top-left origin avoids half-pixel pivots on odd-size cabins.
  // The illustrated keyframes supply motion; rotating nearest-neighbor pixels
  // continuously makes hair and facial detail crawl even between keyframes.
  ctx.translate(Math.round(x), Math.round(y + bob));
  // All frames of an action use one scale and the same bottom-center seat.
  // Fitting each crop separately made wider hand/prop poses shrink the head.
  // Source rectangles stay untouched: some original illustrations meet across
  // atlas boundaries, so blindly trimming edges would remove hair or fingers.
  const fit = Math.min(
    width / Math.max(...actionRects.map((rect) => rect[2])),
    height / Math.max(...actionRects.map((rect) => rect[3])),
  );
  const drawnWidth = Math.max(1, Math.round(cellW * fit));
  const drawnHeight = Math.max(1, Math.round(cellH * fit));
  ctx.drawImage(img, sx, sy, cellW, cellH,
    Math.round((width - drawnWidth) / 2), Math.round(height) - drawnHeight,
    drawnWidth, drawnHeight);
  drawWeatherAccessories(ctx, {
    character: name,
    width,
    height,
    time,
    season,
    weather: resolved.weather,
  });
  if (upbeat && Math.floor(time * 5) % 2 === 0) {
    pixelSpark(
      ctx,
      width * 0.91,
      height * 0.16,
      Math.max(1, width / 28),
      "#ffe39c",
    );
  }
  ctx.restore();
  return { character: name, action: localAction, frame, animationFrame, ready: true };
}

/**
 * Fits the existing 180px-wide car cabin. Call after rear seats, before doors
 * and windscreen. x/y are the car's ground-origin; scale may remain 1 when the
 * car renderer already applies its own transform. Returns selected poses.
 * Roof/canopy rendering is owned by weather-renderer.js, not this module.
 */
export function drawCrew(ctx, options = {}) {
  const { x = 0, y = 0, scale = 1, time = 0, season = "summer" } = options;
  const resolved = resolveCrewActions(options);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const common = {
    ...options,
    action: resolved,
    time,
    season,
    weather: resolved.weather,
  };
  const chana = drawCharacter(ctx, {
    ...common,
    character: "chana",
    x: -55,
    y: -103,
    width: 66,
    height: 60,
  });
  const arisu = drawCharacter(ctx, {
    ...common,
    character: "arisu",
    x: -8,
    y: -105,
    width: 67,
    height: 62,
  });
  ctx.restore();
  return { ...resolved, ready: Boolean(arisu && chana) };
}
