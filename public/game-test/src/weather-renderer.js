const px = (g, x, y, w, h, c) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};
const mod = (n, m) => ((n % m) + m) % m;
export function drawRoadWeather(g, state, time) {
  const wet = ["rain", "storm", "mud"].includes(state.weather);
  if (wet) {
    for (let i = 0; i < 15; i++) {
      const x = mod(i * 137 - state.distance * 3, 1100) - 70,
        y = 400 + (i % 4) * 18;
      px(
        g,
        x,
        y,
        38 + (i % 3) * 18,
        3,
        state.weather === "mud" ? "#735a52" : "#6c5a7e",
      );
      px(
        g,
        x + 7,
        y + 3,
        29,
        1,
        state.weather === "mud" ? "#9f7b58" : "#af809b",
      );
      if (state.weather !== "mud")
        px(g, x + 12, y + (Math.floor(time * 5 + i) % 4), 9, 1, "#cf9ab2");
    }
  }
  if (state.weather === "snow" || state.season === "winter") {
    for (let i = 0; i < 24; i++) {
      const x = mod(i * 53 - state.distance * 3, 1040) - 40;
      px(g, x, 348, 20 + (i % 4) * 5, 3, "#c9d8ed");
      px(g, x + 5, 472, 19, 3, "#dce5ef");
    }
  }
  if (state.weather === "mud") {
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 30; i++) {
        const x = mod(i * 37 - state.distance * 3, 1050) - 30;
        px(g, x, 439 + j * 19, 20, 2, "#735447");
        px(g, x + 3, 442 + j * 19, 8, 1, "#a1815b");
      }
  }
}
export function drawNpcWeather(g, e, x, y, time, state) {
  if (!["salaryman", "gyaru", "fan"].includes(e.type)) return;
  const rain = ["rain", "storm"].includes(state.weather);
  if (rain) {
    px(g, x + 18, y - 90, 2, 66, "#9fb5c1");
    px(g, x + 15, y - 27, 5, 2, "#e5ac87");
    px(
      g,
      x - 17,
      y - 86,
      56,
      5,
      e.type === "salaryman" ? "#6c8199" : "#e980c4",
    );
    px(
      g,
      x - 11,
      y - 91,
      44,
      5,
      e.type === "salaryman" ? "#8ca0b7" : "#ffb1dc",
    );
    px(g, x - 4, y - 95, 30, 4, "#d7d9ed");
    px(g, x + 9, y - 99, 3, 5, "#eef5f3");
    px(g, x - 17, y - 81, 56, 2, "#2c293f");
  }
  if (state.season === "winter" || state.weather === "snow") {
    px(
      g,
      x - 13,
      y - 70,
      26,
      9,
      e.type === "salaryman" ? "#687d92" : "#f38abc",
    );
    px(g, x - 8, y - 76, 16, 7, e.type === "salaryman" ? "#8c9caf" : "#ffc2e5");
    px(g, x - 12, y - 43, 25, 5, "#e4d3b9");
    px(g, x + 7, y - 39, 6, 16, "#e4d3b9");
  }
  if (state.weather === "mud") {
    px(g, x - 11, y - 14, 11, 12, "#806044");
    px(g, x + 1, y - 14, 11, 12, "#806044");
    px(
      g,
      x - 12,
      y - 62,
      26,
      5,
      e.type === "salaryman" ? "#8c7974" : "#e9b458",
    );
    px(g, x - 9, y - 59, 19, 3, "#3a3547");
    for (let i = 0; i < 5; i++)
      px(g, x - 12 + i * 5, y - 26 + (i % 3) * 4, 3, 3, "#8f6c4c");
  }
  if (state.season === "autumn" && !rain) {
    px(g, x - 12, y - 43, 24, 4, "#dc976d");
    px(g, x - 9, y - 39, 5, 11, "#dc976d");
  }
}
export function drawCarWeather(
  g,
  {
    weather = "sunny",
    season = "summer",
    roofClosed = false,
    snowRoof = null,
    mudAmount = 0,
    time = 0,
    jump = 0,
    speed = 0,
  } = {},
) {
  if (roofClosed) {
    // Closed hardtop and glass; the transparent cabin still reveals both DJs.
    g.globalAlpha = 0.14;
    px(g, -59, -100, 102, 57, "#94dceb");
    g.globalAlpha = 1;
    px(g, -64, -106, 98, 5, "#3b2348");
    px(g, -60, -111, 90, 5, "#dd6fae");
    px(g, -57, -113, 83, 2, "#ffc1e0");
    px(g, -65, -104, 5, 61, "#a95b93");
    g.fillStyle = "#a95b93";
    g.beginPath();
    g.moveTo(30, -106);
    g.lineTo(37, -104);
    g.lineTo(59, -42);
    g.lineTo(52, -42);
    g.closePath();
    g.fill();
    px(g, -11, -103, 3, 60, "#6a426c");
    px(g, -58, -102, 5, 2, "#d8f5f6");
    px(g, 37, -87, 3, 15, "#bce3ef");
    // Wiper is a visible moving state, not a static weather recolor.
    const wx = 43 + Math.sin(time * 5) * 9;
    g.strokeStyle = "#251e38";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(53, -43);
    g.lineTo(wx, -75);
    g.stroke();
    if (weather === "snow" || season === "winter") {
      px(g, -60, -115, 87, 3, "#e4ecf4");
      px(g, -57, -118, 22, 3, "#eef4f8");
      px(g, -11, -117, 35, 2, "#eef4f8");
    }
  }
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
