import { isSurvival, createSurvival, SURVIVAL_WEAPONS, normalizeSurvivalSave, applySurvivalModifiers, recordSurvivalEvent, survivalStep, openSurvivalDraft, survivalEncounterPlan, finishSurvivalWave } from './survival.js';
import { createEncounterPlan, updateEncounterActor, getEncounterPhase } from './encounter-director.js';
import { DRIVING_PACE } from './pace.js';
import { littleFindAt } from './street-culture.js';
import { createRunBuild, normalizeRunBuild, getBuildModifiers, routeMissionProgress, settleRouteReward } from './run-build.js';
import { normalizeRpg, recordRpgEvent, openRpgDraft } from './tour-rpg.js';
import { JOURNEY_STAGE_COUNT, getJourneyChoices, getJourneyNode, createJourneyProgress, chooseJourneyNode, completeJourneyNode, restoreJourneyProgress } from './journey.js';
import { normalizeGarage, serializeGarage, applyCarStats } from "./garage.js";
import {
  normalizeEnvironment,
  environmentRules,
  updateEnvironment,
} from "./environment.js";
/** DOM-free seeded story campaign. Hold boost, shoot or charge. No driving inputs.
 * Metres in simulation; screen x = 190 + (entity.distance - state.distance) * 3.
 */
export const PLAYER_X = 190;
export const METERS_TO_PIXELS = 3;
export const GROUND_Y = 465;
export const LANE_Y = Object.freeze([365, 414, GROUND_Y]);
export const MAX_SPEED = 108 * DRIVING_PACE.speedMultiplier;
export const VIEW_DISTANCE = 430;
export const FIXED_STEP = 1 / 120;
export const THRUST_DRAIN = 23;
export const GRAVITY = 450;
export const THRUST_ACCELERATION = 830;
export const HOVER_HEIGHT_UNIT = 112;
export const MAX_ALTITUDE = HOVER_HEIGHT_UNIT * 2.6;
export const MAX_DESCENT_SPEED = 200;
export const SHOT_COOLDOWN = 0.36;
export const CHARGE_RATE = 42;
export const COMBO_WINDOW = 5;
export const COLLISION_GRACE = 1.15;
export const RECORDS_REQUIRED = 0;
export const RUSH_DURATION = 2;
export const RUSH_COOLDOWN = 5;
export const RUSH_MIN_ENERGY = 25;
export const RUSH_DRAIN = 40;
export const RUSH_SPEED_MULTIPLIER = 1.65;

const CITY_ROUTES = Object.freeze(
  [
    {
      id: "01",
      cityId: "nakano",
      start: "野方",
      goal: "中野",
      name: "中野ナイトクルーズ",
      title: "寝坊したら、ブースは遠い。",
      club: "BEAT BASE 175",
      distance: 1680,
      weather: "clear",
      accent: "#ff72bd",
      difficulty: 0,
      intro: "ちゃな「街のみんなに招待を届けて、中野のフロアへ出発や！」",
      win: "ありねぇ「間に合った。中野、音出すで！」",
    },
    {
      id: "02",
      cityId: "shinjuku",
      start: "高円寺",
      goal: "新宿",
      name: "新宿ネオン・ラッシュ",
      title: "ネオンの街に、招待をつなげ。",
      club: "PINK FLASH",
      distance: 1750,
      weather: "rain",
      accent: "#ad7aff",
      difficulty: 1,
      intro: "ちゃな「新宿のネオン！ 電池と盛り髪、守るで！」",
      win: "ちゃな「新宿の夜、全員ぶちアゲやー！」",
    },
    {
      id: "03",
      cityId: "shibuya",
      start: "原宿",
      goal: "渋谷",
      name: "渋谷スクランブル",
      title: "109まで、あと一跳ね。",
      club: "NEON LEOPARD",
      distance: 1820,
      weather: "clear",
      accent: "#ff527f",
      difficulty: 2,
      intro: "ありねぇ「段差はジャンプ。街のみんなには招待のハートや！」",
      win: "ちゃな「109もフロアも、全部きらきらやん！」",
    },
    {
      id: "04",
      cityId: "asakusa",
      start: "上野",
      goal: "浅草",
      name: "浅草ランタン・ラン",
      title: "提灯の先に、低音がある。",
      club: "LANTERN BASS",
      distance: 1880,
      weather: "clear",
      accent: "#ffb66e",
      difficulty: 2,
      intro: "ちゃな「雷門見えた！ 提灯よりうちらが光るで！」",
      win: "ありねぇ「お祭りとベース、相性ええやろ。」",
    },
    {
      id: "05",
      cityId: "osaka",
      start: "大阪駅",
      goal: "大阪",
      name: "大阪ミッドナイト",
      title: "関西ツッコミ超特急。",
      club: "BASS TAKOYAKI",
      distance: 1940,
      weather: "rain",
      accent: "#ff974e",
      difficulty: 3,
      intro: "ありねぇ「大阪のフロア、音であっためよか。」",
      win: "ちゃな「道頓堀！ ツッコミも低音も全開や！」",
    },
    {
      id: "06",
      cityId: "kyoto",
      start: "京都駅",
      goal: "京都",
      name: "京都ギャラクシー",
      title: "最後のフロアまで、全開。",
      club: "GALAXY FLOOR",
      distance: 2020,
      weather: "clear",
      accent: "#d899fc",
      difficulty: 3,
      intro: "ちゃな「ラストは京都！ うちらのミックス、届けるで！」",
      win: "ありねぇ「6つの街、全部つないだな。DJセット、始めよか！」",
    },
  ].map((route) =>
    Object.freeze({ ...route, meters: route.distance, deadline: null }),
  ),
);

export const ROUTES = Object.freeze(CITY_ROUTES.flatMap((city, cityIndex) => [0, 1].map(leg => Object.freeze({
  ...city, id: String(cityIndex * 2 + leg + 1).padStart(2, '0'), cityIndex, leg,
  name: `${city.name}・${leg === 0 ? '街角編' : 'クラブ編'}`,
  distance: Math.round(city.distance * (leg === 0 ? .76 : .88) * DRIVING_PACE.distanceMultiplier),
  meters: Math.round(city.distance * (leg === 0 ? .76 : .88) * DRIVING_PACE.distanceMultiplier),
  intro: leg === 0 ? city.intro : `ちゃな「次は${city.club}！ 選んだ街を抜けて行こ！」`,
  win: leg === 0 ? `${city.goal}の街角に到着！ 次の目的地を選ぼ。` : city.win,
}))));

export const ROUTE_OPTIONS = Object.freeze({
  scenic: Object.freeze({
    id: "scenic",
    name: "充電ゆったりルート",
    description: "EV多め・長い道・障害物少なめ",
    lengthMultiplier: 1,
    speed: 92 * DRIVING_PACE.speedMultiplier,
    stationSpacing: 360 * DRIVING_PACE.speedMultiplier,
    stationRadius: 72 * DRIVING_PACE.speedMultiplier,
    encounterSpacing: 105 * DRIVING_PACE.speedMultiplier,
  }),
  express: Object.freeze({
    id: "express",
    name: "ハートリレー特急ルート",
    description: "近道・サラリーマン多め・EV少なめ",
    lengthMultiplier: 0.8,
    speed: MAX_SPEED,
    stationSpacing: 510 * DRIVING_PACE.speedMultiplier,
    stationRadius: 60 * DRIVING_PACE.speedMultiplier,
    encounterSpacing: 77 * DRIVING_PACE.speedMultiplier,
  }),
});
export const UPGRADE_CATALOG = Object.freeze(
  [
    { id: "rushCooler", name: "ラッシュクーラー", description: "ラッシュ再使用 -0.75秒", basePrice: 130, maxLevel: 3 },
    { id: "heartReach", name: "ワイドハート", description: "ハートの届く幅と高さUP", basePrice: 150, maxLevel: 3 },
    { id: "evRange", name: "EVキャッチ", description: "充電できる範囲 +10m", basePrice: 110, maxLevel: 3 },
    {
      id: "battery",
      name: "バッテリーPLUS",
      description: "容量 +30 / スラスター消費 -2毎秒",
      basePrice: 120,
      maxLevel: 3,
    },
    {
      id: "hearts",
      name: "ハート連射",
      description: "ハートの発射間隔を短縮",
      basePrice: 140,
      maxLevel: 3,
    },
    {
      id: "charger",
      name: "急速チャージ",
      description: "EV充電 +18毎秒",
      basePrice: 100,
      maxLevel: 3,
    },
    {
      id: "armor",
      name: "タフかわボディ",
      description: "耐久上限 +25 / その場で耐久 +25",
      basePrice: 160,
      maxLevel: 3,
    },
    {
      id: "repair",
      name: "ボディリペア",
      description: "耐久を45回復",
      basePrice: 70,
      maxLevel: null,
    },
  ].map((item) => Object.freeze(item)),
);
export const CONSTANTS = Object.freeze({
  PLAYER_X,
  METERS_TO_PIXELS,
  GROUND_Y,
  LANE_Y,
  MAX_SPEED,
  VIEW_DISTANCE,
  FIXED_STEP,
  THRUST_DRAIN,
  GRAVITY,
  THRUST_ACCELERATION,
  MAX_ALTITUDE,
  HOVER_HEIGHT_UNIT, MAX_DESCENT_SPEED,
  SHOT_COOLDOWN,
  CHARGE_RATE,
  COMBO_WINDOW,
  COLLISION_GRACE,
  RUSH_DURATION, RUSH_COOLDOWN, RUSH_MIN_ENERGY, RUSH_DRAIN, RUSH_SPEED_MULTIPLIER,
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const HAZARDS = Object.freeze({
  salaryman: { radius: 15, damage: 8, clearance: 0.4 },
  cone: { radius: 21, damage: 10, clearance: 0.17 },
  barrier: { radius: 27, damage: 22, clearance: 0.32 },
  pothole: { radius: 21, damage: 19, clearance: 0.2 },
});
const modeFor = (option) => ROUTE_OPTIONS[option] || ROUTE_OPTIONS.scenic;
function seedNumber(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0 || 1;
  let value = 2166136261;
  for (const letter of String(seed ?? 175))
    value = Math.imul(value ^ letter.charCodeAt(0), 16777619);
  return value >>> 0 || 1;
}
function random(state) {
  let value = state._rng;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state._rng = value >>> 0;
  return state._rng / 4294967296;
}
function emit(state, type, detail = {}) {
  const event = { ...detail, type };
  state.events.push(event);
  recordSurvivalEvent(state, event);
  if (state.runBuild) routeMissionProgress(state, { ...detail, type });
  if (state.rpg) recordRpgEvent(state, { ...detail, type });
}
function stats(state) {
  applyCarStats(state);
}
function spawn(state, type, distance, detail = {}) {
  const item = {
    id: state._nextEntityId++,
    type,
    distance,
    lane: 1,
    variant: Math.floor(random(state) * 4),
    resolved: false,
    ...detail,
  };
  if (type === "salaryman" && !detail.directorManaged) {
    const node = getJourneyNode(state.journeyNodeId);
    const fraction = ((Math.imul(item.id + state.seed, 2654435761) >>> 0) % 1000) / 1000;
    if (fraction < (node?.movingEnemyRate ?? .2)) {
      item.motionBaseDistance = distance; item.motionAmplitude = 10 + item.variant * 3;
      item.motionRate = 1.4 + item.variant * .2; item.motionPhase = item.id * 1.7;
    }
  }
  state.entities.push(item);
  return item;
}
function roadSettings(state) {
  const mode = modeFor(state.routeOption), node = getJourneyNode(state.journeyNodeId);
  return { ...mode, stationSpacing: mode.stationSpacing * (node?.stationSpacingMultiplier ?? 1) * (isSurvival(state) ? 1.5 : 1),
    encounterSpacing: mode.encounterSpacing * (node?.encounterSpacingMultiplier ?? 1) };
}
/** Enemy distance is the authoritative moving position for renderer, hits and collisions. */
function moveEnemies(state, dt) {
  for (const target of state.entities) {
    if (target.directorManaged) { updateEncounterActor(target, state, dt); continue; }
    if (target.motionBaseDistance === undefined || target.converted || target.cleared) continue;
    target.motionOffset = Math.sin(state.elapsed * target.motionRate + target.motionPhase) * target.motionAmplitude;
    target.distance = target.motionBaseDistance + target.motionOffset;
    target.moving = true;
  }
}

function stationPositions(state) {
  const settings = roadSettings(state);
  const positions = [];
  for (
    let distance = 300 * DRIVING_PACE.speedMultiplier;
    distance < state.routeLength - 120 * DRIVING_PACE.speedMultiplier;
    distance += settings.stationSpacing
  )
    positions.push(distance);
  if (
    !positions.some(
      (distance) => Math.abs(distance - (state.routeLength - 170 * DRIVING_PACE.speedMultiplier)) < 140 * DRIVING_PACE.speedMultiplier,
    )
  )
    positions.push(state.routeLength - 170 * DRIVING_PACE.speedMultiplier);
  return positions;
}
function populate(state) {
  const settings = roadSettings(state);
  if (
    !isSurvival(state) && !state._fanSpawned &&
    state._quizDistance <= state.distance + VIEW_DISTANCE
  ) {
    const fan = spawn(state, "fan", state._quizDistance, { recruited: false });
    state._fanSpawned = true;
    state._fanId = fan.id;
  }
  for (const distance of state._stations) {
    if (
      distance <= state.distance + VIEW_DISTANCE &&
      !state._spawnedStations.includes(distance)
    ) {
      spawn(state, "ev", distance, { radius: settings.stationRadius });
      spawn(state, 'little-find', distance, { find: littleFindAt(state.seed + state.routeIndex, state._stations.indexOf(distance)) });
      state._spawnedStations.push(distance);
    }
  }
  // The legacy next-encounter sentinel remains an intentional empty-road test seam.
  if (state._nextEncounter < 1e9) {
    while (state._encounterCursor < state._encounterPlan.length) {
      const descriptor = state._encounterPlan[state._encounterCursor];
      if (descriptor.distance > state.distance + VIEW_DISTANCE) break;
      spawn(state, descriptor.type, descriptor.distance, { ...descriptor });
      state._encounterCursor++;
    }
  }
  state.entities.sort((a, b) => a.distance - b.distance || a.id - b.id);
}
const PRESERVED = [
  "totalDistance",
  "score",
  "money",
  "totalFans",
  "gyaruConverted",
  "littleFinds",
  "signalClears",
  "stageSignals",
  "bestCombo",
  "stagesCompleted",
  "integrity",
  "energy",
  "mudAmount",
  "locationIndex",
];
function snapshot(state) {
  return Object.fromEntries([
    ...PRESERVED.map((key) => [key, state[key]]),
    ["upgrades", { ...state.upgrades }],
    ["garage", serializeGarage(state)],
    ["runBuild", normalizeRunBuild(state.runBuild, { carId: state.garage.equipped })],
    ["rpg", normalizeRpg(state.rpg)],
    ["survival", isSurvival(state) ? structuredClone(state.survival) : null],
    ["runId", state.runId],
    ["campaignStarted", state.campaignStarted === true],
  ]);
}
function restoreSnapshot(state, saved) {
  for (const key of PRESERVED) state[key] = saved[key];
  state.upgrades = { ...saved.upgrades };
  state.garage = normalizeGarage(saved.garage);
  state.runBuild = normalizeRunBuild(saved.runBuild, { carId: state.garage.equipped });
  state.rpg = normalizeRpg(saved.rpg);
  if (isSurvival(state) && saved.survival) state.survival = structuredClone(saved.survival);
  state.buildModifiers = getBuildModifiers(state);
  state.runId = validCampaignRunId(saved.runId) ? saved.runId : state.runId;
  state.campaignStarted = state.campaignStarted === true || saved.campaignStarted === true;
  stats(state);
}
export function createState({
  mode = "story",
  survivalDay = "",
  startingWeapon = "heart",
  routeIndex = 0,
  routeOption = "scenic",
  seed = 175,
  season = "summer",
  weather = "sunny",
  garage = null,
  locationIndex = 0,
  runId = null,
  campaignStarted = false,
  journeyNodeId = null,
  journey = null,
} = {}) {
  const index = clamp(
    Math.trunc(Number(routeIndex) || 0),
    0,
    ROUTES.length - 1,
  );
  const numericSeed = seedNumber(seed);
  const requestedNode = getJourneyNode(journeyNodeId);
  const node = requestedNode?.stageIndex === index ? requestedNode : getJourneyChoices(index, numericSeed).find(n => n.routeOption === routeOption) || getJourneyChoices(index, numericSeed)[0];
  const option = modeFor(node.routeOption);
  let progress = restoreJourneyProgress(journey);
  if (!progress || progress.stageIndex !== index) {
    progress = createJourneyProgress(numericSeed);
    // Direct stage constructors support tests and old-save migration. They do not
    // infer earned stage counts or completion-point eligibility.
    progress.stageIndex = index;
    progress.completedNodeIds = Array.from({ length: index }, (_, i) => getJourneyChoices(i, numericSeed)[0].nodeId);
  }
  progress = chooseJourneyNode(progress, node.nodeId);
  const state = {
    ...normalizeEnvironment(season, weather),
    locationIndex: node.locationIndex,
    journeyNodeId: node.nodeId,
    journey: progress,
    roofClosed: false,
    mudAmount: 0,
    wetness: 0,
    windOffset: 0,
    landingRecovery: 0,
    mode: mode === "survival" ? "survival" : "story",
    survival: mode === "survival" ? createSurvival(survivalDay, startingWeapon) : null,
    status: "playing",
    reason: null,
    routeIndex: index,
    route: ROUTES[index],
    routeOption: option.id,
    routeLength: Math.round(ROUTES[index].distance * option.lengthMultiplier * node.lengthMultiplier),
    distance: 0,
    routeDistance: 0,
    totalDistance: 0,
    elapsed: 0,
    timeRemaining: null,
    speed: option.speed,
    integrity: 100,
    integrityCapacity: 100,
    energy: 100,
    energyCapacity: 100,
    lane: 1,
    targetLane: 1,
    jumpHeight: 0,
    altitude: 0,
    altitudeVelocity: 0,
    jumpRemaining: 0,
    rushing: false,
    rushTime: 0,
    rushGestureTime: 0,
    rushCooldown: 0,
    _rushHeld: false,
    boosting: false,
    shooting: false,
    charging: false,
    atStation: false,
    stationId: null,
    invulnerability: 0,
    shotCooldown: 0,
    hitSlow: 0,
    score: 0,
    money: 0,
    totalFans: 0,
    stageFans: 0,
    gyaruConverted: 0,
    littleFinds: 0,
    stageGyaru: 0,
    signalClears: 0,
    stageSignals: 0,
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    upgrades: { battery: 0, hearts: 0, charger: 0, armor: 0, rushCooler: 0, heartReach: 0, evRange: 0 },
    garage: normalizeGarage(garage),
    finishPending: false,
    campaignComplete: false,
    stagesCompleted: 0,
    entities: [],
    projectiles: [],
    events: [],
    lastHit: null,
    seed: numericSeed,
    runId: validCampaignRunId(runId) ? runId : `run:${numericSeed.toString(16)}`,
    campaignStarted: campaignStarted === true,
    assistMode: false,
    rpg: normalizeRpg(null),
    _rng:
      (numericSeed ^
        Math.imul(index + 1, 0x9e3779b9) ^
        (option.id === "express" ? 0x751fab : 0)) >>>
        0 || 1,
    _nextEntityId: 1,
    _nextProjectileId: 1,
    _nextEncounter: 120,
    _encounter: 0,
    _encounterPlan: [],
    _encounterCursor: 0,
    buildRuntime: { shield: 0, chargeSeconds: 0, shieldStation: null, chargedShot: 0 },
    runBuild: null,
    lastRouteReward: null,
    _stations: [],
    _spawnedStations: [],
    pendingQuiz: null,
    _quizDistance: 0,
    _quizTriggered: false,
    _quizAnswered: false,
    _fanSpawned: false,
    _fanId: null,
  };
  stats(state);
  state.runBuild = createRunBuild(state.garage.equipped);
  state.buildModifiers = getBuildModifiers(state);
  state.energy = state.energyCapacity;
  state.integrity = state.integrityCapacity;
  updateEnvironment(state, 0);
  state._stations = stationPositions(state);
  state._quizDistance = [...state._stations].sort(
    (a, b) =>
      Math.abs(a - state.routeLength * 0.6) -
      Math.abs(b - state.routeLength * 0.6),
  )[0];
  state._encounterPlan = createEncounterPlan({ seed: state.seed, routeIndex: index, routeLength: state.routeLength, node, stations: state._stations, stationRadius: roadSettings(state).stationRadius });
  if (isSurvival(state)) state._encounterPlan = survivalEncounterPlan(state._encounterPlan, state, roadSettings(state).stationRadius);
  populate(state);
  state._stageStart = snapshot(state);
  return state;
}
/** Starting equipment is chosen once in the garage, before the run begins. */
export function chooseStartingWeapon(state, id) {
  if (!isSurvival(state) || !SURVIVAL_WEAPONS.some(item => item.id === id) || state.status !== "playing" || state.campaignStarted || state.routeIndex !== 0 || state.distance !== 0 || state.elapsed !== 0 || state.survival.level !== 0 || state.survival.xp !== 0) return false;
  state.survival = createSurvival(state.survival.day, id);
  state.projectiles = [];
  state.shotCooldown = 0;
  state.shooting = false;
  state._stageStart = snapshot(state);
  return true;
}
function convert(state, target) {
  if (target.converted || target.type !== "salaryman") return;
  target.converted = true;
  target.type = "gyaru";
  target.convertedAt = state.elapsed;
  state.combo = state.comboTimer > 0 ? state.combo + 1 : 1;
  state.comboTimer = COMBO_WINDOW;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  const reward = Math.round((50 + Math.min(state.combo - 1, 5) * 10) * (getJourneyNode(state.journeyNodeId)?.conversionRewardMultiplier ?? 1));
  state.money += reward;
  if (target.headliner) {
    state.signalClears++;
    state.stageSignals++;
  } else {
    state.gyaruConverted++;
    state.stageGyaru++;
  }
  state.score += reward * 2;
  state.energy = Math.min(state.energyCapacity, state.energy + (state.buildModifiers?.conversionEnergy || 0));
  emit(state, "convert", {
    entityId: target.id,
    distance: target.distance,
    reward,
    money: state.money,
    combo: state.combo,
    totalFans: state.totalFans,
    gyaruConverted: state.gyaruConverted,
    signalRepaired: Boolean(target.headliner),
    signalClears: state.signalClears,
    elite: Boolean(target.elite),
    headliner: target.headliner || null,
    streetRole: target.streetRole || null,
  });
}
function fire(state) {
  const evolved = isSurvival(state) && state.survival.evolutions.includes("heartstorm");
  const heights = evolved ? [.18, .42, .65] : [.18 + state.jumpHeight * .85];
  for (const height of heights) state.projectiles.push({
    id: state._nextProjectileId++,
    distance: state.distance + 18,
    height,
    lane: 1,
    age: 0,
    resolved: false,
    hitIds: [],
    pierceLeft: (state.buildModifiers?.heartPierce || 0) + (state.buildModifiers?.shieldPiercing && state.buildRuntime.shield > 0 ? state.buildModifiers.guardedHeartPierce ?? 1 : 0),
    damage: 1 + (evolved ? 1 : 0) + (state.buildRuntime.chargedShot || 0),
  });
  state.buildRuntime.chargedShot = 0;
  state.shotCooldown = state.shotInterval * (isSurvival(state) ? Math.max(.36, 1 - (state.survival.upgrades.heart || 0) * .16) * (state.survival.fever > 0 ? .55 : 1) : 1);
  emit(state, "shoot");
}
function hitTarget(state, target, damage = 1, chain = true, bypassGuard = false) {
  if (target.resolved || target.converted || target.cleared) return false;
  if (target.shielded && !bypassGuard && !(state.buildModifiers.shieldPiercing && state.buildRuntime.shield > 0)) {
    if (!target._lastGuardHit || state.elapsed - target._lastGuardHit > .4) {
      emit(state, "guard-hit", { entityId: target.id, distance: target.distance }); target._lastGuardHit = state.elapsed;
    }
    return false;
  }
  target.hp = (target.hp ?? (target.type === "barrier" ? 2 : 1)) - damage;
  if (target.hp > 0) { emit(state, "heart-hit", { entityId: target.id, distance: target.distance }); return false; }
  if (target.type === "salaryman") {
    convert(state, target);
    if (chain && state.buildModifiers.heartChain) {
      // Each source adds one distinct secondary target. Secondary hits never recurse.
      const neighbors = state.entities.filter(other => other.id !== target.id && other.type === "salaryman" && !other.converted && !other.cleared && !other.resolved && Math.abs(other.distance - target.distance) <= state.buildModifiers.heartChainRange).slice(0, state.buildModifiers.heartChain);
      for (const next of neighbors) { hitTarget(state, next, 1, false); emit(state, "heart-chain", { distance: target.distance, targetDistance: next.distance }); }
    }
  } else {
    target.resolved = true; state.score += 25;
    emit(state, "destroy", { entityId: target.id, entityType: target.type, distance: target.distance });
  }
  return true;
}
function projectilesStep(state, dt) {
  for (const heart of state.projectiles) {
    if (heart.resolved) continue;
    const previous = heart.distance;
    heart.distance += (state.speed / 3.6 + 100) * dt; heart.age += dt;
    heart.hitIds ??= [];
    for (const target of state.entities) {
      if (target.resolved || target.converted || target.cleared || heart.hitIds.includes(target.id) || !["salaryman", "cone", "barrier"].includes(target.type)) continue;
      const heightLimit = target.type === "salaryman" ? 0.7 + (state.heartHeightBonus || 0) : target.type === "barrier" ? .44 : .29;
      if (heart.height > heightLimit || previous > target.distance + (state.heartHitRadius || 8) || heart.distance < target.distance - (state.heartHitRadius || 8)) continue;
      heart.hitIds.push(target.id);
      hitTarget(state, target, heart.damage || 1);
      if ((heart.pierceLeft || 0) > 0) heart.pierceLeft--; else { heart.resolved = true; break; }
    }
  }
  state.projectiles = state.projectiles.filter(heart => !heart.resolved && heart.age < 3.1);
}
function collide(state, target, hazard) {
  target.cleared = true;
  if (target.cluster) for (const member of state.entities) if (member.cluster && member.encounterId === target.encounterId) member.cleared = true;
  if (state.buildRuntime.shield > 0) {
    state.buildRuntime.shield = 0; state.buildRuntime.chargeSeconds = 0; state.invulnerability = COLLISION_GRACE;
    emit(state, "shield-block", { distance: target.distance, entityId: target.id }); return;
  }
  const damage = Math.round(
    hazard.damage * (state.routeOption === "express" ? 1.12 : 1) * (isSurvival(state) ? (1.3 + state.routeIndex * .08) * (1 - (state.survival.upgrades.armor || 0) * .12) : state.assistMode === true ? .55 : 1),
  );
  state.integrity = Math.max(0, state.integrity - damage);
  state.invulnerability = COLLISION_GRACE;
  state.hitSlow = 0.75;
  state.combo = 0;
  state.comboTimer = 0;
  state.lastHit = {
    entityType: target.type,
    distance: target.distance,
    damage,
    lane: 1,
  };
  emit(state, "collision", { ...state.lastHit, entityId: target.id });
}
function stopRush(state, reason) {
  if (!state.rushing) return;
  state.rushing = false;
  state.rushTime = 0;
  state.rushCooldown = state.rushRecovery ?? RUSH_COOLDOWN;
  emit(state, "rush-stop", { reason });
}
/** Call on pause, blur or pointer cancellation after clearing input. */
export function cancelRush(state) {
  stopRush(state, "cancel");
  state._rushHeld = false;
  return state;
}
function finish(state, status, reason) {
  stopRush(state, "finish");
  state.status = status;
  state.reason = reason;
  state.boosting = state.shooting = state.charging = false;
  if (status === "won") {
    if (isSurvival(state)) for (let wave = 0; wave < 6; wave++) finishSurvivalWave(state, wave);
    state.stagesCompleted++;
    state.journey = completeJourneyNode(state.journey, state.journeyNodeId) || state.journey;
    state.integrity = Math.min(state.integrityCapacity, state.integrity + (getJourneyNode(state.journeyNodeId)?.arrivalRepair || 0));
    state.campaignComplete = state.routeIndex === ROUTES.length - 1;
    state.score += 500 + Math.floor(state.integrity * 3);
    state.lastRouteReward = settleRouteReward(state, getJourneyNode(state.journeyNodeId));
  }
  emit(state, status, { reason, campaignComplete: state.campaignComplete });
}
function step(state, input, dt) {
  state.elapsed += dt;
  state.rushGestureTime = Math.max(0, (state.rushGestureTime || 0) - dt);
  const environment = updateEnvironment(state, dt);
  state.invulnerability = Math.max(0, state.invulnerability - dt);
  state.hitSlow = Math.max(0, state.hitSlow - dt);
  state.shotCooldown = Math.max(0, state.shotCooldown - dt);
  state.comboTimer = Math.max(0, state.comboTimer - dt);
  if (state.comboTimer === 0) state.combo = 0;
  state.rushCooldown = Math.max(0, state.rushCooldown - dt);
  const station = state.entities.find(item => {
    if (item.type !== "ev") return false;
    const range = Math.abs(item.distance - state.distance);
    if (range <= item.radius) return true;
    if (range > item.radius + (state.chargeRadiusBonus || 0)) return false;
    // Range upgrades only add SAFE charging windows. Their fringe cannot pull
    // the car into a charge lock beside a hazard outside the protected base zone.
    return !state.entities.some(actor => HAZARDS[actor.type] && !actor.cleared && !actor.converted && !actor.resolved && Math.abs(actor.distance - state.distance) < HAZARDS[actor.type].radius + 40);
  });
  const chargeIntent = Boolean(input.charge && station && !input.boost);
  const rushPressed = Boolean(input.rush) && !state._rushHeld;
  state._rushHeld = Boolean(input.rush);
  if (state.rushing && (!input.rush || chargeIntent || state.energy <= 0))
    stopRush(state, chargeIntent ? "charge" : !input.rush ? "release" : "empty");
  if (rushPressed && !chargeIntent && !state.rushing && state.rushCooldown <= 1e-9 && state.energy >= RUSH_MIN_ENERGY) {
    state.rushing = true;
    state.rushTime = RUSH_DURATION;
    state.rushGestureTime = 0.75;
    emit(state, "rush-start");
    if (state.buildModifiers.rushPulse > 0) {
      for (const target of state.entities) if (target.type === "salaryman" && !target.converted && !target.cleared && target.distance >= state.distance && target.distance <= state.distance + state.buildModifiers.rushPulse) hitTarget(state, target, 2);
    }
  }
  state.speed =
    modeFor(state.routeOption).speed *
    environment.speed *
    (state.rushing ? RUSH_SPEED_MULTIPLIER : 1) *
    (state.hitSlow > 0 ? 0.76 : 1) *
    (state.landingRecovery > 0 ? 0.8 : 1);
  state.atStation = Boolean(station);
  state.stationId = station?.id ?? null;
  const wasCharging = state.charging;
  state.charging = Boolean(chargeIntent && state.altitude < 12);
  state.boosting = Boolean(input.boost && !chargeIntent && state.energy > 0);
  state.shooting = Boolean((isSurvival(state) ? state.survival.upgrades.heart > 0 : input.shoot) && !chargeIntent);
  if (state.charging) {
    const previous = state.energy;
    state.energy = Math.min(
      state.energyCapacity,
      state.energy + state.chargeRate * dt,
    );
    routeMissionProgress(state, { type: "charge", seconds: dt });
    if (state.buildRuntime.shieldStation !== station.id) { state.buildRuntime.chargeSeconds = 0; state.buildRuntime.shieldStation = station.id; }
    state.buildRuntime.chargeSeconds += dt;
    if (state.buildModifiers.chargeShield && state.buildRuntime.chargeSeconds >= state.buildModifiers.chargeShieldSeconds) state.buildRuntime.shield = 1;
    if (!wasCharging) emit(state, "charge-start", { stationId: station.id });
    if (previous < state.energyCapacity && state.energy >= state.energyCapacity)
      { state.buildRuntime.chargedShot = state.buildModifiers.chargedHeartBonus; emit(state, "charged", { stationId: station.id }); }
  } else if (wasCharging) emit(state, "charge-stop");
  if (state.rushing) state.energy = Math.max(0, state.energy - RUSH_DRAIN * dt);
  const previousAltitude = state.altitude;
  if (state.boosting) {
    if (state.altitude === 0) {
      state.altitudeVelocity = 140;
      emit(state, "boost");
    }
    state.energy = Math.max(
      0,
      state.energy - state.thrustDrain * state.buildModifiers.thrustDrainMultiplier * environment.drain * dt,
    );
  }
  state.altitudeVelocity +=
    ((state.boosting ? state.thrustAcceleration : 0) -
      GRAVITY * environment.gravity +
      (state.weather === "wind" && state.altitude > 0
        ? Math.sin(state.elapsed * 2.4) * 55
        : 0)) *
    dt;
  state.altitudeVelocity = Math.max(-MAX_DESCENT_SPEED * state.buildModifiers.descentMultiplier, state.altitudeVelocity);
  state.altitude = clamp(
    state.altitude + state.altitudeVelocity * dt,
    0,
    MAX_ALTITUDE,
  );
  if (state.altitude === 0 || state.altitude === MAX_ALTITUDE)
    state.altitudeVelocity = 0;
  state.jumpHeight = state.altitude / HOVER_HEIGHT_UNIT;
  if (previousAltitude > 0 && state.altitude === 0) {
    state.landingRecovery = environment.landing;
    emit(state, "land", {
      wet: environment.wetness > 0,
      weather: state.weather,
    });
  }
  if (state.shooting && state.shotCooldown <= 1e-9) fire(state);
  const previousDistance = state.distance;
  const movement = (state.speed / 3.6) * dt;
  state.distance += movement;
  state.routeDistance = state.distance;
  state.totalDistance += movement;
  state.score += movement * 0.3;
  populate(state);
  moveEnemies(state, dt);
  survivalStep(state, dt, (target, damage, chain, bypass) => hitTarget(state, target, damage, chain, bypass));
  projectilesStep(state, dt);
  for (const item of state.entities) {
    if (item.type !== 'little-find' || item.resolved || state.altitude > 36) continue;
    if (previousDistance > item.distance + 18 || state.distance < item.distance - 18) continue;
    item.resolved = true;
    state.littleFinds++;
    state.score += 75;
    state.energy = Math.min(state.energyCapacity, state.energy + 6);
    emit(state, 'little-find', { entityId: item.id, distance: item.distance, find: item.find, reward: 75 });
  }
  for (const target of state.entities) {
    const hazard = HAZARDS[target.type];
    if (!hazard || target.resolved || target.cleared || target.converted)
      continue;
    if (
      previousDistance > target.distance + hazard.radius ||
      state.distance < target.distance - hazard.radius
    )
      continue;
    const clearance = target.routineHazard?.clearance ?? hazard.clearance;
    if (state.jumpHeight < clearance) {
      if (!state.rushing && state.invulnerability <= 0) collide(state, target, hazard);
      else target.cleared = true;
    } else if (state.distance >= target.distance) {
      target.cleared = true;
      state.score += 25;
      state.energy = Math.min(state.energyCapacity, state.energy + state.buildModifiers.comboFlight);
      emit(state, "jump-clear", { entityId: target.id, distance: target.distance });
      if (state.jumpHeight < clearance + .35)
        emit(state, "precision", { entityId: target.id, distance: target.distance });
    }
  }
  state.entities = state.entities.filter(
    (item) =>
      !item.resolved &&
      item.distance > state.distance - Math.max(90, item.radius ?? 0),
  );
  if (state.rushing) {
    state.rushTime = Math.max(0, state.rushTime - dt);
    if (state.rushTime <= 1e-9 || state.energy <= 0) stopRush(state, state.energy <= 0 ? "empty" : "timeout");
  }
  if (state.integrity <= 0) finish(state, "lost", "integrity");
  else if (state.distance >= state.routeLength) finish(state, "won", "club");
  else if (
    !isSurvival(state) && !state._quizTriggered &&
    state.distance >= state._quizDistance - 20
  ) {
    state._quizTriggered = true;
    stopRush(state, "quiz");
    state.status = "quiz";
    state.boosting = state.shooting = state.charging = false;
    state.pendingQuiz = {
      id: `route-${state.routeIndex}-fan`,
      entityId: state._fanId,
      routeIndex: state.routeIndex,
      cityId: state.route.cityId,
    };
    emit(state, "quiz", { ...state.pendingQuiz });
  }
  if (isSurvival(state)) openSurvivalDraft(state);
  else openRpgDraft(state);
}
/** Mutates state. Pause belongs to caller: do not call update while paused. */
export function update(state, input = {}, dt = 0) {
  state.events = [];
  if (state.status !== "playing" || !Number.isFinite(dt) || dt <= 0)
    return state;
  beginCampaign(state);
  state.buildModifiers = getBuildModifiers(state);
  applySurvivalModifiers(state);
  let remaining = dt;
  while (remaining > 1e-10 && state.status === "playing") {
    const delta = Math.min(FIXED_STEP, remaining);
    step(state, input, delta);
    remaining -= delta;
  }
  return state;
}
/** Club quizzes are optional stops after the road is already safely complete. */
export function beginClubQuiz(state) {
  if (!isSurvival(state) || state.status !== "won" || !getJourneyNode(state.journeyNodeId)?.clubStop || state.survival.quizRoads.includes(state.routeIndex)) return false;
  state._quizAnswered = false;
  state.pendingQuiz = { id: `club-${state.routeIndex}-fan`, entityId: `club-${state.routeIndex}`, routeIndex: state.routeIndex, cityId: state.route.cityId, club: true };
  state.status = "quiz";
  state.events = [];
  emit(state, "quiz", { ...state.pendingQuiz });
  return true;
}
/** Question text and answer checking belong to the UI. One answer per encounter. */
export function answerQuiz(state, correct) {
  if (state.status !== "quiz" || !state.pendingQuiz || state._quizAnswered)
    return false;
  const { entityId, club } = state.pendingQuiz;
  const clubQuiz = club === true && isSurvival(state);
  const succeeded = correct === true;
  if (succeeded) {
    state.totalFans++;
    state.stageFans++;
    state.score += 300;
  }
  const fan = state.entities.find((item) => item.id === entityId);
  if (fan) {
    fan.recruited = succeeded;
    fan.answered = true;
  }
  state._quizAnswered = true;
  state.pendingQuiz = null;
  if (clubQuiz && !state.survival.quizRoads.includes(state.routeIndex)) state.survival.quizRoads.push(state.routeIndex);
  state.status = clubQuiz ? "won" : "playing";
  emit(state, "quiz-result", {
    correct: succeeded,
    entityId,
    totalFans: state.totalFans,
  });
  return true;
}
export function upgradePrice(state, id) {
  const item = UPGRADE_CATALOG.find((upgrade) => upgrade.id === id);
  if (!item) return null;
  const level = state.upgrades[id] ?? 0;
  if (item.maxLevel !== null && level >= item.maxLevel) return null;
  return item.basePrice * (level + 1);
}
/** Current-car upgrades and repairs spend campaign coins at club stops only. */
export function buyUpgrade(state, id) {
  if (state.status !== "won") return false;
  const price = upgradePrice(state, id);
  if (price === null || !Number.isFinite(state.money) || state.money < price) return false;
  if (id === "repair" && state.integrity >= state.integrityCapacity) return false;
  state.money -= price;
  if (id === "repair") state.integrity = Math.min(state.integrityCapacity, state.integrity + 45);
  else {
    state.upgrades[id] = (state.upgrades[id] ?? 0) + 1;
    stats(state);
    if (id === "armor") state.integrity = Math.min(state.integrityCapacity, state.integrity + 25);
  }
  emit(state, "purchase", {
    upgrade: id,
    price,
    level: state.upgrades[id] ?? 0,
    money: state.money,
  });
  return true;
}
/** Choose the next road; clubs refill batteries and guarantee 40% hull before departure. */
export function nextRoute(state, routeOption = "scenic", journeyNodeId = null) {
  if (state.status !== "won" || state.campaignComplete) return state;
  const next = createState({
    mode: state.mode, survivalDay: state.survival?.day,
    routeIndex: state.routeIndex + 1,
    routeOption,
    journeyNodeId: journeyNodeId ?? state.pendingJourneyNodeId,
    journey: state.journey,
    seed: state.seed,
    runId: state.runId,
    campaignStarted: true,
    season: state.season,
    weather: state.weather,
  });
  restoreSnapshot(next, snapshot(state));
  next.assistMode = state.assistMode === true;
  if (isSurvival(next)) { next.survival.wave = 0; next.survival.waveStats = Array.from({ length: 6 }, () => ({ kills: 0, hits: 0 })); next.survival.settledWaves = []; next.survival.gems = []; next.survival.receipts = []; }
  next.stageSignals = 0;
  next.locationIndex = getJourneyNode(next.journeyNodeId).locationIndex;
  next.energy = next.energyCapacity;
  if (!isSurvival(next)) next.integrity = Math.max(next.integrity, next.integrityCapacity * 0.4);
  routeMissionProgress(next, { type: "stage-start" });
  next._stageStart = snapshot(next);
  emit(next, "stage-start", {
    routeIndex: next.routeIndex,
    cityId: next.route.cityId,
    routeOption: next.routeOption,
  });
  Object.assign(state, next);
  return state;
}
/** A failed run cannot farm currency/fans or erase purchases made before it. */
export function retryRoute(state) {
  if (state.status !== "lost" || isSurvival(state)) return state;
  const next = createState({
    routeIndex: state.routeIndex,
    routeOption: state.routeOption,
    journeyNodeId: state.journeyNodeId,
    journey: state.journey,
    seed: state.seed,
    runId: state.runId,
    campaignStarted: true,
    season: state.season,
    weather: state.weather,
  });
  restoreSnapshot(next, state._stageStart);
  next.assistMode = state.assistMode === true;
  next._stageStart = snapshot(next);
  emit(next, "stage-retry", { routeIndex: next.routeIndex });
  Object.assign(state, next);
  return state;
}

export const CAMPAIGN_SAVE_VERSION = 3;
const SAVE_NUMBER_LIMIT = 1_000_000_000;
function safeNumber(value, fallback = 0, max = SAVE_NUMBER_LIMIT) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, 0, max)
    : fallback;
}
function normalizeCheckpoint(value, fallback) {
  const saved = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const checkpoint = {};
  for (const key of PRESERVED)
    checkpoint[key] = safeNumber(saved[key], fallback[key]);
  for (const key of ["money", "totalFans", "gyaruConverted", "littleFinds", "signalClears", "stageSignals", "bestCombo", "stagesCompleted"])
    checkpoint[key] = Math.floor(checkpoint[key]);
  checkpoint.stagesCompleted = Math.min(ROUTES.length, checkpoint.stagesCompleted);
  checkpoint.mudAmount = clamp(checkpoint.mudAmount, 0, 1);
  checkpoint.locationIndex = Math.floor(clamp(checkpoint.locationIndex, 0, 19));
  checkpoint.upgrades = {};
  for (const id of ["battery", "hearts", "charger", "armor", "rushCooler", "heartReach", "evRange"])
    checkpoint.upgrades[id] = Math.floor(safeNumber(saved.upgrades?.[id], fallback.upgrades?.[id] || 0, 3));
  checkpoint.garage = normalizeGarage(saved.garage ?? fallback.garage);
  checkpoint.runBuild = normalizeRunBuild(saved.runBuild ?? fallback.runBuild, { carId: checkpoint.garage.equipped });
  checkpoint.rpg = normalizeRpg(saved.rpg ?? fallback.rpg);
  checkpoint.runId = validCampaignRunId(saved.runId) ? saved.runId : fallback.runId;
  checkpoint.campaignStarted = saved.campaignStarted === true || fallback.campaignStarted === true;
  const holder = { garage: checkpoint.garage, upgrades: checkpoint.upgrades };
  stats(holder);
  checkpoint.energy = Math.min(holder.energyCapacity, checkpoint.energy);
  checkpoint.integrity = Math.min(holder.integrityCapacity, checkpoint.integrity);
  return checkpoint;
}
/**
 * JSON-safe local save. A road in progress resumes from its departure checkpoint,
 * so reloading can neither farm its conversion coins nor lose a club purchase.
 * Won saves remain at the club and include all purchases made there.
 */
export function exportCampaignSave(state) {
  if (isSurvival(state)) return null;
  const checkpoint = state.status === "won" ? snapshot(state) : state._stageStart || snapshot(state);
  return {
    version: CAMPAIGN_SAVE_VERSION,
    runId: state.runId,
    campaignStarted: state.campaignStarted === true,
    routeIndex: state.routeIndex,
    routeOption: state.routeOption,
    journeyNodeId: state.journeyNodeId,
    journey: state.status === "won" && state.journey?.stageIndex === state.routeIndex ? completeJourneyNode(state.journey) : state.journey,
    pendingJourneyNodeId: state.pendingJourneyNodeId || null,
    seed: state.seed,
    season: state.season,
    weather: state.weather,
    locationIndex: state.locationIndex,
    status: state.status === "won" ? "won" : "playing",
    checkpoint: normalizeCheckpoint(checkpoint, snapshot(state)),
  };
}
/**
 * Accepts v1 saves or legacy plain state snapshots (missing/v0 version).
 * Rejects corrupt/future schemas without throwing; rebuilds entities and derived stats.
 */
export function restoreCampaignSave(value) {
  let saved = value;
  if (typeof saved === "string") {
    try { saved = JSON.parse(saved); } catch { return null; }
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || saved.mode === "survival") return null;
  if (saved.version !== undefined && saved.version !== 0 && saved.version !== 1 && saved.version !== 2 && saved.version !== CAMPAIGN_SAVE_VERSION) return null;
  if (!Number.isInteger(saved.routeIndex) || saved.routeIndex < 0 || saved.routeIndex >= ROUTES.length) return null;
  if ((saved.version === 1 || saved.version === 2 || saved.version === CAMPAIGN_SAVE_VERSION) && (!saved.checkpoint || typeof saved.checkpoint !== "object" || Array.isArray(saved.checkpoint))) return null;
  const legacy = saved.version === undefined || saved.version === 0 || saved.version === 1;
  const atClub = saved.status === "won";
  const source = saved.checkpoint ?? (!atClub && saved._stageStart ? saved._stageStart : saved);
  if (legacy && saved.routeIndex > 5) return null;
  const migratedIndex = legacy ? saved.routeIndex * 2 + (atClub ? 1 : 0) : saved.routeIndex;
  const savedJourney = legacy ? null : restoreJourneyProgress(saved.journey);
  if (!legacy && (!savedJourney || savedJourney.stageIndex !== migratedIndex + (atClub ? 1 : 0))) return null;
  if (!legacy && (atClub ? savedJourney.completedNodeIds[migratedIndex] : savedJourney.selectedNodeId) !== saved.journeyNodeId) return null;
  const next = createState({
    routeIndex: migratedIndex,
    journeyNodeId: legacy ? null : saved.journeyNodeId,
    journey: atClub ? null : savedJourney,
    routeOption: saved.routeOption,
    seed: saved.seed,
    runId: validCampaignRunId(saved.runId) ? saved.runId : `legacy:${seedNumber(saved.seed).toString(16)}`,
    campaignStarted: saved.campaignStarted !== false,
    season: saved.season,
    weather: saved.weather,
    locationIndex: saved.locationIndex,
  });
  restoreSnapshot(next, normalizeCheckpoint(source, snapshot(next)));
  if (legacy) {
    const count = Math.floor(Number(source.stagesCompleted) || 0);
    next.stagesCompleted = count >= 0 && count <= 6 ? count * 2 : 0;
  }
  const pendingNode = getJourneyNode(saved.pendingJourneyNodeId);
  next.pendingJourneyNodeId = atClub && pendingNode?.stageIndex === migratedIndex + 1 ? pendingNode.nodeId : null;
  next.locationIndex = getJourneyNode(next.journeyNodeId).locationIndex;
  if (atClub) next.journey = savedJourney || completeJourneyNode(next.journey);
  else if (savedJourney) next.journey = savedJourney;
  next._stageStart = snapshot(next);
  if (atClub) {
    next.status = "won";
    next.reason = "club";
    next.distance = next.routeLength;
    next.routeDistance = next.routeLength;
    next.campaignComplete = next.routeIndex === ROUTES.length - 1;
    // Never infer cleared stages from routeIndex: completion points require all twelve actual clears (or a validated legacy six-clear save).
  }
  updateEnvironment(next, 0);
  return next;
}
/** Map-only checkpoints. The persistence owner consumes them before departure. */
export function exportNightfallSave(state) {
  if (!isSurvival(state) || state.campaignComplete || !(state.status === "won" || state.status === "playing" && state.distance === 0 && state.elapsed === 0)) return null;
  const survival = normalizeSurvivalSave(state.survival);
  if (!survival) return null;
  const checkpoint = normalizeCheckpoint(snapshot(state), snapshot(state));
  // The legacy exporter only rejects recognized survival states. Its format is
  // reused so journey validation and old-save migration remain in one place.
  const campaign = exportCampaignSave({ ...state, mode: "story", _stageStart: checkpoint });
  return { ...campaign, mode: "survival", nightfallVersion: 1, survival };
}
export function restoreNightfallSave(value) {
  let saved = value;
  if (typeof saved === "string") {
    try { saved = JSON.parse(saved); } catch { return null; }
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || saved.mode !== "survival" || saved.nightfallVersion !== 1 || saved.version !== CAMPAIGN_SAVE_VERSION || !["playing", "won"].includes(saved.status)) return null;
  const survival = normalizeSurvivalSave(saved.survival);
  if (!survival) return null;
  const campaign = restoreCampaignSave({ ...saved, mode: "story" });
  if (!campaign || campaign.campaignComplete || survival.quizRoads.some(road => road > campaign.routeIndex || road === campaign.routeIndex && campaign.status !== "won")) return null;
  const next = createState({
    mode: "survival", survivalDay: survival.day, startingWeapon: survival.startingWeapon,
    routeIndex: campaign.routeIndex, journeyNodeId: campaign.journeyNodeId,
    journey: campaign.status === "won" ? null : campaign.journey,
    routeOption: campaign.routeOption, seed: campaign.seed, runId: campaign.runId,
    campaignStarted: campaign.campaignStarted, season: campaign.season, weather: campaign.weather,
  });
  restoreSnapshot(next, { ...snapshot(campaign), survival });
  next.journey = campaign.journey;
  next.pendingJourneyNodeId = campaign.pendingJourneyNodeId;
  if (campaign.status === "won") {
    next.status = "won";
    next.reason = "club";
    next.distance = next.routeDistance = next.routeLength;
    next.survival.wave = 5;
    next.survival.settledWaves = [0, 1, 2, 3, 4, 5];
  }
  next._stageStart = snapshot(next);
  updateEnvironment(next, 0);
  return next;
}

/** Retune a departure/resumed checkpoint without resetting its wallet or garage. */
export function changeRouteBeforeStart(state, routeOption = "scenic", environment = {}) {
  if (state.status !== "playing" || state.distance !== 0 || state.elapsed !== 0) return state;
  const next = createState({
    mode: state.mode, survivalDay: state.survival?.day,
    routeIndex: state.routeIndex,
    routeOption,
    journeyNodeId: environment.journeyNodeId ?? state.journeyNodeId,
    journey: state.journey,
    seed: state.seed,
    runId: state.runId,
    campaignStarted: state.campaignStarted,
    season: environment.season ?? state.season,
    weather: environment.weather ?? state.weather,
    locationIndex: environment.locationIndex ?? state.locationIndex,
  });
  const selectedLocation = next.locationIndex;
  restoreSnapshot(next, snapshot(state));
  next.assistMode = state.assistMode === true;
  next.locationIndex = selectedLocation;
  next._stageStart = snapshot(next);
  Object.assign(state, next);
  return state;
}

const CAMPAIGN_SEASONS = Object.freeze(["spring", "summer", "autumn", "winter"]);
const CAMPAIGN_WEATHER_WEIGHTS = Object.freeze({
  spring: Object.freeze({ sunny: 32, cloudy: 18, rain: 24, storm: 6, fog: 8, mud: 5, wind: 7 }),
  summer: Object.freeze({ sunny: 36, cloudy: 15, rain: 20, storm: 12, fog: 4, mud: 5, wind: 8 }),
  autumn: Object.freeze({ sunny: 28, cloudy: 22, rain: 18, storm: 8, fog: 9, mud: 6, wind: 9 }),
  winter: Object.freeze({ sunny: 28, cloudy: 18, rain: 9, storm: 4, snow: 25, fog: 8, mud: 2, wind: 6 }),
});
/**
 * Reproducible, season-weighted conditions for an automatically chosen departure.
 * This uses an independent stream and never consumes the obstacle-generation RNG.
 * A saved stage keeps these explicit values on retry; a new seed makes a new tour.
 */
export function campaignEnvironment(seed = 175, routeIndex = 0) {
  const index = clamp(Math.trunc(Number(routeIndex) || 0), 0, ROUTES.length - 1);
  let mixed = (seedNumber(seed) ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  // Avalanche sequential numeric seeds before drawing the first season.
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  const rng = { _rng: (mixed ^ (mixed >>> 15)) >>> 0 || 1 };
  const season = CAMPAIGN_SEASONS[Math.floor(random(rng) * CAMPAIGN_SEASONS.length)];
  const weights = Object.entries(CAMPAIGN_WEATHER_WEIGHTS[season]);
  let roll = random(rng) * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [weather, weight] of weights) {
    roll -= weight;
    if (roll < 0) return { season, weather };
  }
  return { season, weather: "sunny" };
}


function validCampaignRunId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(id);
}
let runSequence = 0;
/** Generate once when the user starts a genuinely new tour; never on retry or resume. */
export function createRunId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  runSequence++;
  return `tour:${Date.now().toString(36)}:${runSequence.toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
}
/** Close the new-game selection window at departure, before saving or advancing time. */
export function beginCampaign(state) {
  if (!state || state.status !== "playing" || state.campaignStarted) return false;
  state.campaignStarted = true;
  if (state._stageStart) state._stageStart.campaignStarted = true;
  return true;
}

/** Destination choices are accepted only at an unplayed departure checkpoint. */
export function chooseStageDestination(state, nodeId) {
  const node = getJourneyNode(nodeId);
  if (!node || node.stageIndex !== state.routeIndex) return state;
  return changeRouteBeforeStart(state, node.routeOption, { journeyNodeId: nodeId });
}

/** Store the next stop on the completed-road map without changing the road just won. */
export function selectNextJourneyDestination(state, nodeId) {
  const node = getJourneyNode(nodeId);
  if (state.status !== 'won' || state.campaignComplete || node?.stageIndex !== state.routeIndex + 1) return false;
  if (!getJourneyChoices(node.stageIndex, state.seed).some(choice => choice.nodeId === nodeId)) return false;
  state.pendingJourneyNodeId = nodeId;
  return true;
}
