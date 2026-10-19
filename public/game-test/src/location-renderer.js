/** Atmospheric lighting and particles only. All architecture is illustrated art. */
import { getLocation, getSeason, getWeather } from './locations.js';
const mod=(n,d)=>((n%d)+d)%d;
const hash=n=>mod(Math.sin(n*127.1+311.7)*43758.5453123,1);
const finite=(n,fallback=0)=>Number.isFinite(Number(n))?Number(n):fallback;
function R(g, x, y, w, h, c) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}
function P(g, pts, color) {
  g.fillStyle = color;
  g.beginPath();
  pts.forEach(([x, y], i) =>
    i
      ? g.lineTo(Math.round(x), Math.round(y))
      : g.moveTo(Math.round(x), Math.round(y)),
  );
  g.closePath();
  g.fill();
}
function L(g, pts, color, width = 1) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  pts.forEach(([x, y], i) =>
    i
      ? g.lineTo(Math.round(x), Math.round(y))
      : g.moveTo(Math.round(x), Math.round(y)),
  );
  g.stroke();
}
function particles(g, env, width, horizon, time, distance) {
  const { weather: w, season: s } = env;
  g.save();
  if (w.id === "rain" || w.id === "storm" || w.id === "mud") {
    const count = w.id === "storm" ? 92 : w.id === "rain" ? 58 : 19;
    for (let i = 0; i < count; i++) {
      const x =
        mod(
          hash(i * 3 + 1) * width -
            time * (54 + w.wind * 100) -
            distance * 0.21,
          width + 30,
        ) - 15;
      const y = mod(
        hash(i * 11) * horizon + time * (140 + hash(i) * 90),
        horizon,
      );
      g.globalAlpha = 0.17 + hash(i * 17) * 0.23;
      L(
        g,
        [
          [x, y],
          [x - 3 - w.wind * 5, y + 7 + w.precipitation * 6],
        ],
        "#c4dae6",
        1,
      );
    }
    for (let i = 0; i < 15; i++) {
      const x = hash(i + 207) * width,
        y = horizon - 8 + hash(i * 31) * 5,
        phase = mod(time * 5 + i * 0.37, 1);
      g.globalAlpha = 0.25 * (1 - phase);
      R(g, x - phase * 6, y, 2 + phase * 12, 1, "#d3dce6");
    }
  }
  if (w.id === "snow") {
    for (let i = 0; i < 70; i++) {
      const x =
        mod(
          hash(i * 5 + 9) * width -
            time * 19 +
            Math.sin(time * 0.7 + i) * 11 -
            distance * 0.13,
          width + 20,
        ) - 10;
      const y = mod(
        hash(i * 13) * horizon + time * (9 + hash(i) * 19),
        horizon,
      );
      g.globalAlpha = 0.45 + hash(i) * 0.45;
      R(g, x, y, i % 4 ? 2 : 3, i % 4 ? 2 : 3, "#e7eff0");
      if (i % 7 === 0) {
        R(g, x - 1, y + 1, 5, 1, "#f2f2ee");
      }
    }
  }
  if (w.id === "fog") {
    for (let i = 0; i < 5; i++) {
      const yy = 80 + i * 47;
      g.globalAlpha = 0.05 + i * 0.017;
      const x = mod(time * 7 + i * 171, width + 400) - 400;
      R(g, 0, yy, width, 24, "#c9c8d9");
      R(g, x, yy - 12, 460, 20, "#d8d6df");
    }
  }
  if (w.id === "wind" || w.id === "storm") {
    for (let i = 0; i < 13; i++) {
      const x =
          mod(hash(i + 41) * width - time * (190 + w.wind * 70), width + 100) -
          50,
        y = 90 + hash(i * 7) * 220;
      g.globalAlpha = 0.13;
      L(
        g,
        [
          [x, y],
          [x + 15, y - 2],
          [x + 37, y - 1],
          [x + 61, y - 4],
        ],
        "#e6d8df",
        1,
      );
    }
  }
  if (s.id === "spring" || s.id === "autumn" || w.id === "wind") {
    const count = w.id === "wind" ? 28 : 14;
    for (let i = 0; i < count; i++) {
      const x =
        mod(
          hash(i + 77) * width - time * (12 + w.wind * 80) - distance * 0.14,
          width + 20,
        ) - 10;
      const y = mod(
        130 + hash(i * 9) * 190 + time * (3 + hash(i) * 6),
        horizon,
      );
      g.globalAlpha = 0.62;
      const col =
        s.id === "spring"
          ? ["#f9c3d7", "#ffe2df"][i % 2]
          : s.id === "autumn"
            ? s.foliage[i % 3]
            : "#b9bd9f";
      R(g, x + Math.sin(time + i) * 4, y, 3, 2, col);
      if (i % 4 === 0) R(g, x + 2, y - 1, 2, 2, col);
    }
  }
  // Long, infrequent muted lightning pulses (one event / 11 s, no strobing).
  if (w.id === "storm") {
    const phase = mod(time, 11);
    if (phase > 8.3 && phase < 8.48) {
      g.globalAlpha = 0.13 * Math.sin(((phase - 8.3) / 0.18) * Math.PI);
      R(g, 0, 0, width, horizon, "#e6e4f1");
      g.globalAlpha = 0.6;
      L(
        g,
        [
          [717, 0],
          [700, 29],
          [713, 26],
          [691, 62],
        ],
        "#e0d7ef",
        2,
      );
    }
  }
  g.restore();
}

export function drawLocation(ctx,options={}) {
 const location=options.location||getLocation(options.cityId,options.locationIndex);
 const season=getSeason(options.season),weather=getWeather(options.weather);
 const width=Math.max(1,finite(options.width,960)),horizon=Math.max(1,finite(options.horizon,330));
 const time=Math.max(0,finite(options.time)),distance=finite(options.distance);
 ctx.save();ctx.imageSmoothingEnabled=false;ctx.beginPath();ctx.rect(0,0,width,horizon);ctx.clip();
 // Seasonal foliage/snow live in the actual image. Weather only relights it.
 const shade={cloudy:.12,rain:.2,storm:.32,mud:.15,snow:.12,fog:.08}[weather.id]||0;
 if(shade){ctx.globalAlpha=shade;R(ctx,0,0,width,horizon,'#334459');ctx.globalAlpha=1;}
 particles(ctx,{season,weather},width,horizon,time,distance);
 ctx.restore();return {location,season,weather};
}
