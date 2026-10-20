import { getThreatSignals } from './road-feedback.js';
import { drawCabinCharacter, preloadCabinCharacters } from "./cabin-characters.js";
import { preloadUmbrellaArt, drawUmbrellaArt } from "./umbrella-art.js";
import { preloadRoadSurfaceArt, drawRoadSurface } from "./road-surface.js";
import { preloadRoadsideArt, drawRoadsideObject } from "./roadside-art.js";
import { preloadCarArt, getCarArt, CAR_ROOF_ART, getCarArtLayout, drawCarBody, drawCarWheels, drawCarRoof } from "./car-art.js";
import { getCarProfile, getCarAppearance } from "./garage.js";
import {
  preloadStreetCharacters,
  drawStreetCharacter,
  streetCharacterBob,
} from "./street-characters.js";
import { drawLocation } from "./location-renderer.js";
import { environmentFor, getLocation } from "./locations.js";
import { drawCharacter, resolveCrewActions, resolveCrewVisuals, preloadCharacterActions } from "./character-actions.js";
import {
  drawNpcWeather,
  drawCarWeather,
  drawWeatherOverlay,
} from "./weather-renderer.js";
import { drawScenery } from "./scenery.js";
const W = 960,
  H = 540,
  LANES = [365, 414, 465];
const assets = {};
const worldLayers = [];
function paintLocation(g, options, alpha, slot = 0) {
  if (alpha <= 0) return;
  if (!worldLayers[slot]) {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(W, 330)
        : document.createElement("canvas");
    canvas.width = W;
    canvas.height = 330;
    worldLayers[slot] = canvas;
  }
  const canvas = worldLayers[slot],
    layer = canvas.getContext("2d");
  layer.clearRect(0, 0, W, 330);
  drawLocation(layer, options);
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(canvas, 0, 0);
  g.restore();
}
export async function preloadSprites() {
  const [crew, street, , roadside, roadReady, umbrellasReady] = await Promise.all([
    Promise.all([preloadCharacterActions(), preloadCabinCharacters()]).then(([crew]) => crew),
    preloadStreetCharacters(),
    preloadCarArt(),
    preloadRoadsideArt(),
    preloadRoadSurfaceArt(),
    preloadUmbrellaArt(),
  ]);
  if (!umbrellasReady) throw new Error("Required umbrella art failed to load");
  if (!roadReady) throw new Error("Required road surface art failed to load");
  if (!street) throw new Error("Required street character art failed to load");
  if (!roadside) throw new Error("Required roadside art failed to load");
  if (crew.some((item) => !item.ready))
    throw new Error("Required DJ action art failed to load");
  await Promise.all(
    Object.entries({
      logo: "brand/gyaruinthemix-logo.png",
    }).map(
      ([key, path]) =>
        new Promise((resolve, reject) => {
          const im = new Image();
          const timer=setTimeout(()=>{im.onload=null;im.onerror=null;reject(new Error("Brand logo load timed out"));},15000);
          im.onload = () => {
            clearTimeout(timer);
            assets[key] = im;
            resolve();
          };
          im.onerror = () => {clearTimeout(timer);reject(new Error("Brand logo failed to load"));};
          im.src = new URL("../assets/" + path, import.meta.url).href;
        }),
    ),
  );
}
function box(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}
function poly(g, points, color) {
  g.fillStyle = color;
  g.beginPath();
  points.forEach(([x, y], i) =>
    i
      ? g.lineTo(Math.round(x), Math.round(y))
      : g.moveTo(Math.round(x), Math.round(y)),
  );
  g.closePath();
  g.fill();
}
function text(g, str, x, y, size = 12, color = "#fff1f5") {
  g.font = `bold ${size}px monospace`;
  g.fillStyle = color;
  g.fillText(str, Math.round(x), Math.round(y));
}
export function heartVisualPosition(state, shot) {
  const carId=getCarProfile(state).id;
  const layout=getCarArtLayout({carId,x:190+(state.windOffset||0),y:469-(state.jumpHeight||0)*95,...(carId==="heart-limo"?{height:62}:{})});
  const passenger=getCrewSeatLayout(layout)[0];
  const startX=passenger.x+passenger.width*.75;
  const startY=passenger.y+passenger.height*.65;
  const progress=Math.max(0,Math.min(1,(shot.age||0)/.28));
  const targetX=190+(shot.distance-state.distance)*3;
  const targetY=425-(shot.height||0)*95;
  return {x:startX+(targetX-startX)*progress,y:startY+(targetY-startY)*progress-Math.sin(progress*Math.PI)*18};
}

/** Side view: both front seats share a row, with the far passenger behind the driver. */
export function getCrewSeatLayout(layout) {
  const cabin = layout.cabins.at(-1);
  const driverSeat = layout.seats.at(-1);
  const size = layout.openTop ? 37 : Math.min(cabin.width + 3, cabin.height + 6);
  const center = layout.openTop ? driverSeat.x : cabin.x + cabin.width * .57;
  const bottom = layout.openTop ? driverSeat.y + 6 : cabin.y + cabin.height + 2;
  return [
    { character: "chana", x: center + size * .13 - size * .90 / 2, y: bottom - size * .90 - 5, width: size * .90, height: size * .90, cabin },
    { character: "arisu", x: center - size / 2, y: bottom - size, width: size, height: size, cabin },
  ];
}

export function drawCar(g, x, y, {
  time = 0, speed = 0, jump = 0, scale = 1, boost = false,
  damage = false, shooting = false, charging = false, rushing = false, rushTime = 0, rushGestureTime,
  weather = "sunny", season = "summer", roofClosed = false, mudAmount = 0,
  crewVisuals, carId = "mix-175", appearance = getCarAppearance({equipped:carId}),
} = {}) {
  g.save(); g.translate(Math.round(x), Math.round(y)); g.scale(scale, scale);
  g.globalAlpha = Math.max(.08, .28 - jump * .06);
  box(g, -94 + jump * 12, -2, 188 - jump * 24, 5, "#0b1020"); g.globalAlpha = 1;
  g.translate(0, Math.round(-jump * 95 + (speed > 4 ? Math.sin(time * 9) : 0)));
  if (rushing) {
    for (let i = 0; i < 17; i++) {
      const age = ((time * 1.7 + i / 17) % 1);
      const px = -85 - age * 220, py = -12 - age * 24 + Math.sin(i * 2.1) * 13;
      const size = 8 + age * 27;
      g.globalAlpha = (1 - age) * .65;
      box(g, px - size, py - size * .5, size * 2, size, i % 3 ? "#b8a9c5" : "#efd5e6");
      box(g, px - size * .7, py - size * .8, size * 1.4, size * 1.6, "#d6bdd4");
    }
    g.globalAlpha = 1;
  }
  const layoutOptions = {carId, x:0, y:4, ...(carId === "heart-limo" ? {height:62} : {})};
  const layout = getCarArtLayout(layoutOptions);
  if (boost || jump > .15) {
    for (let i=0;i<3;i++) {
      const flame = 12 + Math.round((Math.sin(time * 28 + i) + 1) * 7);
      const fx = -55 + i*48;
      box(g, fx-5, -6, 10, 7, "#3a3a56"); box(g, fx-4, 0, 8, flame, "#f478bb");
      box(g, fx-2, 0, 4, flame-3, "#ffd89b"); box(g, fx-1, 0, 2, flame-7, "#fff5da");
    }
  }
  drawCarWheels(g, {...layoutOptions, rotation:time*speed/12, wheels:appearance.wheels});
  const visual = crewVisuals || { time, action: resolveCrewActions({time,boosting:boost,shooting,charging,damage,weather,rushing,rushGestureTime}), weather, season, rushing, rushTime, rushGestureTime };
  for (const {character, x, y, width, height, cabin} of getCrewSeatLayout(layout)) {
    g.save();
    if (!layout.openTop) { g.beginPath();g.rect(cabin.x-1,cabin.y-1,cabin.width+2,cabin.height+2);g.clip(); }
    drawCabinCharacter(g, {...visual, character, x, y, width, height});
    g.restore();
  }
  drawCarBody(g,{...layoutOptions,paint:appearance.paint});
  const logo=layout.logo;
  if(assets.logo) {
    const lw=Math.min(layout.body.width*.62,Math.max(logo.width*1.2,96)), lh=lw/3;
    g.drawImage(assets.logo,Math.round(logo.x+(logo.width-lw)/2),Math.round(logo.y+(logo.height-lh)/2),Math.round(lw),Math.round(lh));
  }
  // Optional motifs occupy spare rear bodywork; the authentic logo stays clear.
  const decal=appearance.decal;
  if (decal?.id && decal.id!=="none") {
    const dx=layout.body.x+layout.body.width*.1, dy=logo.y+logo.height/2;
    if(decal.id==="hearts") text(g,"♥",dx,dy,9,decal.color);
    else if(decal.id==="stars") text(g,"✦",dx,dy,10,decal.color);
    else if(decal.id==="leopard") for(let i=0;i<5;i++) { box(g,dx+i*3,dy+(i%2)*3,3,2,"#34213c");box(g,dx+i*3+1,dy+(i%2)*3,1,1,"#b28b64"); }
    else for(let i=0;i<4;i++) poly(g,[[dx+i*3,dy],[dx+i*3+9,dy-6],[dx+i*3+4,dy+2]],decal.color);
  }
  // Damage feedback stays outside the sprite silhouette; never flash an opaque body rectangle.
  if (damage && Math.floor(time*12)%2===0) {
    for (let i=0;i<4;i++) { const angle=time*4+i*Math.PI/2; text(g,"✦",Math.round(Math.cos(angle)*36),Math.round(layout.body.y-7+Math.sin(angle)*7),9,"#fff0bd"); }
  }
  if (roofClosed && layout.openTop) {
    drawCarRoof(g,{...layoutOptions,paint:appearance.paint});
    const front=layout.cabins.at(-1);
    g.strokeStyle="#242234";g.lineWidth=1;g.beginPath();
    g.moveTo(front.x+front.width,front.y+front.height);
    g.lineTo(front.x+front.width-12+Math.sin(time*5)*7,front.y+4);g.stroke();
  }
  // Snow sits on the actual car-specific roof, independently of legacy canopy drawing.
  let snowRoof = null;
  if (!layout.openTop) snowRoof = {x:layout.cabins[0].x-3,y:layout.body.y,width:layout.cabins.at(-1).x+layout.cabins.at(-1).width-layout.cabins[0].x+6};
  else if (roofClosed) {
    const art = getCarArt(carId), roof = CAR_ROOF_ART[art.id];
    if (roof) snowRoof = {x:layout.body.x+(roof.mount.x-art.originalCrop.x)*art.sourceScaleX*layout.scaleX,y:layout.body.y+(roof.mount.y-art.originalCrop.y)*art.sourceScaleY*layout.scaleY,width:roof.mount.width*art.sourceScaleX*layout.scaleX};
  }
  drawCarWeather(g,{weather,season,roofClosed:false,snowRoof,mudAmount,time,jump,speed});
  g.restore();
}

function road(g, state, time) {
  drawRoadSurface(g, {distance:state.distance,weather:state.weather,season:state.season});
}

/** A tiny stage rig, drawn with the same integer grid as the street. The jam is
 * an object in the fiction; restoring it lights the speakers without changing
 * an NPC's appearance or implying a fight with a passer-by. */
export function drawSignalHeadliner(g, actor, x, y, time = 0) {
  const color = actor.headliner?.color || '#ff91cd';
  const restored = actor.converted || actor.type === 'gyaru';
  const guarded = !restored && actor.shielded;
  g.save(); g.translate(Math.round(x), Math.round(y));
  box(g, -39, -3, 78, 5, '#10101c');
  // Two cabinets, grill ribs, bass drivers and grounded feet.
  for (const side of [-1, 1]) {
    const left = side < 0 ? -35 : 9;
    box(g, left - 2, -84, 28, 83, '#111322');
    box(g, left, -82, 24, 77, '#323149');
    box(g, left + 2, -80, 20, 73, '#171a2b');
    box(g, left + 1, -81, 22, 2, color);
    for (let row = 0; row < 9; row++) box(g, left + 3, -74 + row * 7, 18, 1, '#424156');
    for (const centerY of [-63, -30]) {
      box(g, left + 5, centerY - 8, 14, 16, '#080c17');
      box(g, left + 3, centerY - 5, 18, 10, '#080c17');
      box(g, left + 8, centerY - 4, 8, 8, guarded ? '#655c81' : color);
      box(g, left + 10, centerY - 2, 4, 4, '#fff2e5');
    }
    box(g, left - 2, -2, 8, 4, '#8d859d');
    box(g, left + 20, -2, 8, 4, '#8d859d');
  }
  // Signal gate: its horizontal shutters visibly open into a live display.
  box(g, -18, -108, 36, 31, '#111321');
  box(g, -16, -106, 32, 25, guarded ? '#413951' : '#163a3a');
  box(g, -17, -108, 34, 2, color);
  if (guarded) {
    for (let i = 0; i < 5; i++) box(g, -14, -102 + i * 4, 28, 2, '#b7a5d5');
  } else {
    for (let i = 0; i < 7; i++) {
      const height = 4 + Math.round((Math.sin(time * 6 + i * 1.2) + 1) * 6);
      box(g, -13 + i * 4, -84 - height, 2, height, restored ? '#9cf5d5' : color);
    }
  }
  // Center cabling and small status lamp stay inside the obstacle silhouette.
  box(g, -2, -78, 4, 74, '#555065');
  box(g, -12, -52, 24, 14, '#111321');
  box(g, -8, -48, 16, 4, restored ? '#9cf5d5' : guarded ? '#b7a5d5' : '#ffe1a2');
  if (restored) {
    for (let i = 0; i < 3; i++) box(g, -25 + i * 24, -115 - Math.round(Math.sin(time * 3 + i) * 3), 3, 3, '#b8ffe3');
  }
  g.restore();
}

function entity(g, e, x, y, time, state) {
  if (e.headliner) { drawSignalHeadliner(g, e, x, y, time); return true; }
  if (drawRoadsideObject(g, { type: e.type, x, y, time, weather: state.weather, season: state.season, charging: state.charging })) return true;
  if (
    drawStreetCharacter(g, {
      type: e.type,
      x,
      y,
      time,
      weather: ["rain","storm"].includes(state.weather) ? "sunny" : state.weather,
      season: state.season,
      id: e.id,
    })
  ) {
    if (e.type === "salaryman" && ["rain","storm"].includes(state.weather))
      drawUmbrellaArt(g,{type:e.type,x:Math.round(x),y:Math.round(y)+streetCharacterBob({type:e.type,id:e.id,time})});
    if (e.type === "fan") text(g, "話そ", x - 21, y - 96, 11, "#fff3d7");
    if (e.type === "gyaru") {
      text(g, "♡", x - 6, y - 82 + Math.sin(time * 6) * 2, 18, "#ff9fd3");
      for (let i = 0; i < 3; i++)
        box(
          g,
          x - 24 + i * 23,
          y - 49 + Math.sin(time * 5 + i) * 13,
          2,
          3,
          "#ffe3aa",
        );
    }
    return true;
  }
  return false;
}
export function render(
  g,
  state,
  { time = 0, menu = false, reducedMotion = false, crewVisuals } = {},
) {
  if (reducedMotion) time = 0;
  crewVisuals ||= resolveCrewVisuals(state, {time, reducedMotion});
  g.imageSmoothingEnabled = false;
  drawScenery(g, {
    cityId: state.route.cityId,
    locationIndex: state.locationIndex,
    season: state.season,
    distance: state.distance,
    time: reducedMotion ? 0 : time,
    width: W,
    height: H,
  });
  // Atmospheric depth keeps the detailed skyline behind the nearer street.
  g.save();
  g.globalAlpha = 0.18;
  box(g, 0, 0, W, 330, "#352d49");
  g.restore();
  const environment = environmentFor(state);
  const locationOptions = {
    ...environment,
    distance: state.distance,
    time,
    width: W,
    horizon: 330,
    architectureScale: 1.45,
  };
  // Keep weather, but never overlay the rejected flat geometry on painted city art.
  paintLocation(g, { ...locationOptions, architecture: false }, 1);
  road(g, state, time);
  if (menu) {
    drawCar(g, 690, 443, {
      crewVisuals,
      time,
      speed: 0,
      scale: 1.7,
      weather: state.weather,
      season: state.season,
      roofClosed: state.roofClosed,
      mudAmount: state.mudAmount,
    });
    text(g, "175", 832, 490, 12, "#8b6c91");
    return;
  }
  const objects = state.entities
    .filter((e) => !e.resolved || e.type === "gyaru")
    .map((e) => ({ e, x: 190 + (e.distance - state.distance) * 3, y: 465 }))
    .filter((o) => o.x > -100 && o.x < 1100);
  objects
    .filter((o) => o.e.type === "ev")
    .forEach((o) => {
      const detailed = entity(g, o.e, o.x, o.y, time, state);
      if (
        !(
          detailed &&
          o.e.type === "salaryman" &&
          (["rain", "storm", "snow", "mud"].includes(state.weather) ||
            state.season === "winter")
        )
      )
        drawNpcWeather(g, o.e, o.x, o.y, time, state);
    });
  objects
    .filter((o) => o.e.type !== "ev")
    .forEach((o) => {
      const detailed = entity(g, o.e, o.x, o.y, time, state);
      if (
        !(
          detailed &&
          o.e.type === "salaryman" &&
          (["rain", "storm", "snow", "mud"].includes(state.weather) ||
            state.season === "winter")
        )
      )
        drawNpcWeather(g, o.e, o.x, o.y, time, state);
    });
  drawCar(g, 190 + (state.windOffset || 0), 465, {
    crewVisuals,
    carId:getCarProfile(state).id, appearance:getCarAppearance(state),
    shooting: state.shooting,
    charging: state.charging,
    rushing: state.rushing,
    rushTime: state.rushTime,
    rushGestureTime: state.rushGestureTime,
    weather: state.weather,
    season: state.season,
    roofClosed: state.roofClosed,
    mudAmount: state.mudAmount,
    time,
    speed: state.speed,
    jump: state.jumpHeight,
    boost: state.boosting,
    damage: state.invulnerability > 0,
  });
  // Hearts leave Chana's passenger-side hand, then follow the gameplay path.
  for (const shot of state.projectiles || []) {
    const {x,y}=heartVisualPosition(state,shot);
    text(g, "♥", x, y, 22, "#ffa1d7");
    box(g, x - 10, y - 8, 7, 2, "#d867b3");
  }
  if (state.charging) {
    for (let i = 0; i < 5; i++) {
      const yy = 441 - ((time * 70 + i * 17) % 95);
      text(g, "+", 185 + (i % 2) * 24, yy, 16, "#abffe8");
    }
    text(g, "充電中やで", 140, 316, 15, "#a3ffe0");
  }
  // Passing poles and speed dashes add fast foreground parallax without obscuring hazards.
  if (!reducedMotion && state.speed > 70) {
    for (let i = 0; i < 5; i++) {
      let x = (i * 239 - state.distance * 7) % 1200;
      box(g, x, 511 + i * 5, 35 + state.speed * 0.3, 1, "#77627c");
    }
  }
  const goalX =
    190 + ((state.routeLength || state.route.distance) - state.distance) * 3;
  if (goalX > -110 && goalX < 1050) {
    // Pavement-sized illuminated A-board, never a giant pole over the car.
    box(g, goalX - 3, 296, 48, 34, "#262033");
    box(g, goalX, 298, 42, 27, "#67334f");
    box(g, goalX + 2, 300, 38, 23, "#211c30");
    box(g, goalX + 1, 298, 40, 2, "#ff95ce");
    box(g, goalX + 1, 323, 40, 2, "#ff6cb9");
    box(g, goalX - 4, 327, 7, 4, "#aaa1bb");
    box(g, goalX + 39, 327, 7, 4, "#aaa1bb");
    text(g, "クラブ", goalX + 6, 311, 9, "#ffe2f1");
    text(g, "→", goalX + 17, 322, 10, "#ffd881");
  }
  drawWeatherOverlay(g, state, time, reducedMotion);
  drawThreatSignals(g, state, time);
}

/** Small world-space markers live on the pavement below actors. Instructions
 * live in the HTML rail, so no floating tooltip can cover the car or a threat. */
function drawThreatSignals(g, state, time) {
  for (const signal of getThreatSignals(state)) {
    const { actor, x, color } = signal;
    if (x < 265 || x > 945) continue;
    const width = actor.headliner ? 42 : 24;
    g.save();
    g.strokeStyle = '#111321'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(x-width,470); g.lineTo(x-width,480);
    g.lineTo(x+width,480); g.lineTo(x+width,470); g.stroke();
    g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    // HP is explicit discrete pips; anticipation is a separate progress stroke.
    const maxHp = Math.max(1, Math.min(8, actor.maxHp || 1));
    const hp = Math.max(0, actor.hp ?? maxHp);
    for (let i = 0; i < maxHp; i++) {
      box(g, x-maxHp*6+i*12, 486, 9, 5, i<hp ? color : '#50465f');
    }
    if (signal.phase === 'tell' || signal.phase === 'guard') {
      box(g, x-width, 495, width*2, 2, '#3d344c');
      box(g, x-width, 495, width*2*Math.max(.04,actor.telegraphProgress || .04), 2, color);
    }
    if (signal.action === 'boost') {
      // An upward chevron supplements colour for a lift-only obstacle.
      g.beginPath(); g.moveTo(x-6,507); g.lineTo(x,501); g.lineTo(x+6,507); g.stroke();
    } else if (signal.phase === 'active') {
      g.beginPath(); g.moveTo(x-6,503); g.lineTo(x-12,507); g.lineTo(x-6,511); g.stroke();
    }
    g.restore();
  }
  if (state.buildRuntime?.shield > 0) {
    const y=433-(state.jumpHeight||0)*95;
    g.save(); g.strokeStyle='#9df2df'; g.lineWidth=2; g.setLineDash([8,7]); g.lineDashOffset=-time*15;
    g.beginPath(); g.ellipse(190,y,111,39,0,Math.PI*.1,Math.PI*1.9); g.stroke(); g.setLineDash([]); g.restore();
  }
}
