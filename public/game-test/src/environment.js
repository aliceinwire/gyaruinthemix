/** Gameplay consequences of weather, separate from the scenic renderer. */
export const WEATHER_RULES = Object.freeze({
  sunny: {
    roof: false,
    speed: 1,
    drain: 1,
    gravity: 1,
    landing: 0,
    wetness: 0,
    visibility: 1,
  },
  cloudy: {
    roof: false,
    speed: 1,
    drain: 1,
    gravity: 1,
    landing: 0,
    wetness: 0,
    visibility: 0.9,
  },
  rain: {
    roof: true,
    speed: 0.96,
    drain: 1.04,
    gravity: 1,
    landing: 0.34,
    wetness: 1,
    visibility: 0.82,
  },
  storm: {
    roof: true,
    speed: 0.92,
    drain: 1.12,
    gravity: 1,
    landing: 0.45,
    wetness: 1,
    visibility: 0.7,
  },
  snow: {
    roof: true,
    speed: 0.9,
    drain: 1.08,
    gravity: 0.98,
    landing: 0.6,
    wetness: 0.5,
    visibility: 0.8,
  },
  fog: {
    roof: false,
    speed: 0.96,
    drain: 1,
    gravity: 1,
    landing: 0,
    wetness: 0.25,
    visibility: 0.62,
  },
  mud: {
    roof: false,
    speed: 0.92,
    drain: 1.12,
    gravity: 1.03,
    landing: 0.48,
    wetness: 0.7,
    visibility: 1,
  },
  wind: {
    roof: false,
    speed: 1,
    drain: 1.06,
    gravity: 1,
    landing: 0.1,
    wetness: 0,
    visibility: 1,
  },
});
export const SEASON_IDS = Object.freeze([
  "spring",
  "summer",
  "autumn",
  "winter",
]);
export function normalizeEnvironment(season = "summer", weather = "sunny") {
  return {
    season: SEASON_IDS.includes(season) ? season : "summer",
    weather: Object.hasOwn(WEATHER_RULES, weather) ? weather : "sunny",
  };
}
export function environmentRules(state) {
  const base = Object.hasOwn(WEATHER_RULES, state.weather)
    ? WEATHER_RULES[state.weather]
    : WEATHER_RULES.sunny;
  return {
    ...base,
    drain: base.drain * (state.season === "winter" ? 1.04 : 1),
  };
}
export function updateEnvironment(state, dt) {
  const rules = environmentRules(state);
  state.roofClosed = rules.roof;
  // A chosen district remains spatially coherent for the entire road.
  state.locationIndex = Math.max(0, Math.min(19, Math.floor(Number(state.locationIndex) || 0)));
  state.landingRecovery = Math.max(0, (state.landingRecovery || 0) - dt);
  state.wetness = rules.wetness;
  state.windOffset = ["wind", "storm"].includes(state.weather)
    ? Math.sin(state.elapsed * 2.4) * state.jumpHeight * 5
    : 0;
  if (state.weather === "mud" && state.altitude < 8)
    state.mudAmount = Math.min(1, (state.mudAmount || 0) + dt * 0.018);
  else if (["rain", "storm"].includes(state.weather))
    state.mudAmount = Math.max(0, (state.mudAmount || 0) - dt * 0.008);
  return rules;
}
