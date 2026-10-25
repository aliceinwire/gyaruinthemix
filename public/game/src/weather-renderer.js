import { drawUmbrellaArt } from "./umbrella-art.js";
import { streetCharacterBob } from "./street-characters.js";
const px = (g, x, y, w, h, c) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};
const mod = (n, m) => ((n % m) + m) % m;
// Ground materials are illustrated in road-surface.js, not rectangular overlays.
export function drawNpcWeather(g, e, x, y, time, state) {
  if (!["salaryman", "gyaru", "fan"].includes(e.type)) return;
  y = Math.round(y) + streetCharacterBob({type:e.type,id:e.id,time});
  x = Math.round(x);
  const rain = ["rain", "storm"].includes(state.weather);
  if (rain) drawUmbrellaArt(g,{type:e.type,x,y});
  // Accumulation follows clothing, never a rectangular hat/goggle pasted over faces.
  if (state.season === "winter" || state.weather === "snow") {
    for (const [dx,dy,w] of [[-13,-43,3],[-9,-46,2],[8,-44,3],[13,-40,2],[-8,-5,3],[10,-4,3]])
      px(g,x+dx,y+dy,w,1,"#e4eaf3");
  }
  if (state.weather === "mud") {
    for (const [dx,dy,w] of [[-10,-5,4],[-7,-8,3],[8,-4,4],[11,-7,2],[-8,-22,2],[7,-18,2],[-5,-12,2]]) {
      px(g,x+dx,y+dy,w,2,"#76513e");
      px(g,x+dx+1,y+dy,1,1,"#a97b56");
    }
  }

}
export function drawCarWeather(
  g,
  {
    weather = "sunny",
    season = "summer",
    snowRoof = null,
    mudAmount = 0,
    time = 0,
    jump = 0,
    speed = 0,
  } = {},
) {
  if (snowRoof && (weather === "snow" || season === "winter")) {
    const {x,y,width} = snowRoof;
    px(g, x, y-2, width, 2, "#e4ecf4");
    px(g, x+width*.12, y-4, width*.24, 2, "#eef4f8");
    px(g, x+width*.58, y-3, width*.25, 1, "#eef4f8");
  }
  if (mudAmount > 0.02) {
    const count = Math.floor(38 * mudAmount);
    for (let i = 0; i < count; i++) {
      const x = -78 + mod(i * 47, 153),
        y = -18 + mod(i * 13, 16);
      px(g, x, y, 3 + (i % 5), 2 + (i % 3), i % 2 ? "#9d7651" : "#73543f");
    }
    px(g, -68, 7, 26, 2, "#8e6949");
    px(g, 44, 7, 25, 2, "#8e6949");
    if (speed > 20 && jump < 0.1)
      for (let i = 0; i < 7; i++)
        px(
          g,
          -86 - mod(time * 45 + i * 9, 45),
          -2 - (i % 3) * 6,
          3,
          3,
          "#9b7754",
        );
  }
  if (["fog", "rain", "storm", "snow"].includes(weather)) {
    g.globalAlpha = 0.12;
    g.fillStyle = "#ffe8ad";
    g.beginPath();
    g.moveTo(82, -30);
    g.lineTo(215, -59);
    g.lineTo(215, -3);
    g.lineTo(82, -23);
    g.fill();
    g.globalAlpha = 1;
  }
}
export function drawWeatherOverlay(g, state, time, reducedMotion = false) {
  const t = reducedMotion ? 0 : time,
    w = state.weather;
  if (["rain", "storm"].includes(w)) {
    g.strokeStyle = w === "storm" ? "#cfbde75c" : "#d9ddfa49";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < (w === "storm" ? 100 : 65); i++) {
      const x = mod(i * 83 - t * 95, 980),
        y = mod(i * 47 + t * 260, 540);
      g.moveTo(x, y);
      g.lineTo(x - 4, y + 13);
    }
    g.stroke();
  }
  if (w === "snow") {
    for (let i = 0; i < 90; i++) {
      const x = mod(i * 73 + Math.sin(t + i) * 15, 970),
        y = mod(i * 41 + t * 28, 540);
      px(g, x, y, i % 3 === 0 ? 3 : 2, 2, "#e6eff5b0");
    }
  }
  if (w === "fog") {
    g.globalAlpha = 0.12;
    px(g, 0, 180, 960, 290, "#d1c4dd");
    g.globalAlpha = 0.18;
    for (let i = 0; i < 4; i++)
      px(g, mod(i * 270 + t * 7, 1250) - 240, 260 + i * 38, 330, 13, "#d8cde3");
    g.globalAlpha = 1;
  }
  if (w === "wind" || state.season === "autumn") {
    for (let i = 0; i < 12; i++) {
      const x = mod(i * 111 - t * (w === "wind" ? 65 : 20), 1040) - 40,
        y = mod(i * 71 + t * 15, 490);
      px(g, x, y, 5, 2, state.season === "autumn" ? "#dd9d73" : "#aed59f");
      px(g, x + 2, y + 2, 3, 2, "#a17764");
    }
  }
  if (w === "storm" && !reducedMotion && Math.floor(time * 2) % 31 === 0) {
    g.globalAlpha = 0.035;
    px(g, 0, 0, 960, 330, "#f4e9ff");
    g.globalAlpha = 1;
  }
}
