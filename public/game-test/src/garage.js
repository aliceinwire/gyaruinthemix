import { JOURNEY_STAGE_COUNT } from "./journey.js";
/** Completion-point new-game car unlocks and start-only cosmetic customization. No network, payments, driving inputs, or DOM dependencies. */
export const GARAGE_VERSION = 1;
export const DEFAULT_CAR_ID = "mix-175";
const freezeOptions = (items) => Object.freeze(items.map((item) => Object.freeze(item)));
export const PAINT_OPTIONS = freezeOptions([
  { id: "pink", name: "ホットピンク", color: "#ff4f9b", highlight: "#ffb5d8" },
  { id: "mint", name: "ミントソーダ", color: "#55dcc8", highlight: "#b5fff0" },
  { id: "purple", name: "ネオンパープル", color: "#a77aff", highlight: "#e0c8ff" },
  { id: "gold", name: "シャンパンゴールド", color: "#ffc452", highlight: "#fff1ac" },
  { id: "blue", name: "エレクトリックブルー", color: "#5395ff", highlight: "#b7d8ff" },
  { id: "black", name: "ミッドナイト", color: "#424457", highlight: "#8b8fa9" },
]);
export const WHEEL_OPTIONS = freezeOptions([
  { id: "classic", name: "クローム", rim: "#dce8fa", glow: "#a9b6cf" },
  { id: "heart", name: "ハートリム", rim: "#ff82bd", glow: "#ff4f9b" },
  { id: "neon", name: "ネオンリム", rim: "#8effee", glow: "#36e9da" },
  { id: "gold", name: "ゴールドリム", rim: "#ffe59c", glow: "#ffc452" },
]);
export const DECAL_OPTIONS = freezeOptions([
  { id: "none", name: "ロゴのみ", color: "#fff4fb" },
  { id: "hearts", name: "ハート", color: "#fff0f8" },
  { id: "stars", name: "きら星", color: "#fff1a0" },
  { id: "leopard", name: "レオパード", color: "#2b183b" },
  { id: "flames", name: "ネオンフレーム", color: "#ffdf66" },
]);

/** All cars auto-drive at the same route speed. Strengths cost energy, hull or fire rate. */
export const CAR_CATALOG = Object.freeze([
  {
    id: DEFAULT_CAR_ID, name: "MIX 175", subtitle: "バランス・カブリオレ",
    description: "いつものオープンカー。電池・浮力・連射のバランス型。",
    strength: "扱いやすいバランス", tradeoff: "特化性能はひかえめ", price: 0,
    shape: "convertible", paint: "pink",
    stats: { energyCapacity: 100, integrityCapacity: 100, thrustDrain: 23, thrustAcceleration: 830, chargeRate: 42, shotInterval: 0.36 },
  },
  {
    id: "spark-k", name: "SPARK K", subtitle: "省エネ・コンパクト",
    description: "大きな電池と速い充電。軽いボディは衝突に弱く、ハートはゆっくり。",
    strength: "大容量・省電力・急速充電", tradeoff: "低耐久・連射ひかえめ", price: 1,
    shape: "compact", paint: "mint",
    stats: { energyCapacity: 145, integrityCapacity: 80, thrustDrain: 19, thrustAcceleration: 760, chargeRate: 50, shotInterval: 0.44 },
  },
  {
    id: "rocket-gal", name: "ROCKET GAL", subtitle: "高浮力・スポーツ",
    description: "鋭く浮き上がるロケット仕様。小さな電池と高い消費に気をつけて。",
    strength: "いちばん強いロケット浮力", tradeoff: "電池が小さい・消費大・低耐久", price: 2,
    shape: "sport", paint: "purple",
    stats: { energyCapacity: 85, integrityCapacity: 85, thrustDrain: 31, thrustAcceleration: 1040, chargeRate: 40, shotInterval: 0.34 },
  },
  {
    id: "bass-van", name: "BASS VAN", subtitle: "タフネス・ツアーバン",
    description: "機材を積める頑丈なバン。重い車体はゆっくり上昇、充電と連射も控えめ。",
    strength: "最大の耐久・大きめ電池", tradeoff: "浮力・充電・連射がひかえめ", price: 3,
    shape: "van", paint: "gold",
    stats: { energyCapacity: 125, integrityCapacity: 160, thrustDrain: 28, thrustAcceleration: 710, chargeRate: 36, shotInterval: 0.45 },
  },
  {
    id: "heart-limo", name: "HEART LIMO", subtitle: "連射・パーティリムジン",
    description: "ハートを素早く連射するロングボディ。電池消費が多く、充電はゆっくり。",
    strength: "最速のハート連射", tradeoff: "消費大・充電が遅い", price: 4,
    shape: "limo", paint: "blue",
    stats: { energyCapacity: 100, integrityCapacity: 110, thrustDrain: 27, thrustAcceleration: 780, chargeRate: 34, shotInterval: 0.24 },
  },
].map((car) => Object.freeze({ ...car, unlockPrice: car.price, currency: "completionPoints", body: car.shape, stats: Object.freeze(car.stats) })));
const carById = (id) => CAR_CATALOG.find((car) => car.id === id);
const optionById = (catalog, id, fallback) => catalog.find((item) => item.id === id) || catalog.find((item) => item.id === fallback) || catalog[0];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value);
function parseSaved(value) {
  if (typeof value !== "string") return plainObject(value) ? value : {};
  try { const parsed = JSON.parse(value); return plainObject(parsed) ? parsed : {}; } catch { return {}; }
}
function normalizeCustomization(value, car) {
  const saved = plainObject(value) ? value : {};
  return {
    paint: optionById(PAINT_OPTIONS, saved.paint, car.paint).id,
    wheels: optionById(WHEEL_OPTIONS, saved.wheels, "classic").id,
    decal: optionById(DECAL_OPTIONS, saved.decal, "none").id,
  };
}
/** Accepts the current schema, an old plain garage/state, or JSON. Never trusts IDs. */
export function normalizeGarage(value) {
  const parsed = parseSaved(value);
  const saved = plainObject(parsed.garage) ? parsed.garage : parsed;
  const rawOwned = saved.owned ?? saved.ownedCars;
  const owned = [DEFAULT_CAR_ID];
  for (const id of Array.isArray(rawOwned) ? rawOwned : []) {
    if (carById(id) && !owned.includes(id)) owned.push(id);
  }
  const requested = saved.equipped ?? saved.equippedCar ?? saved.carId;
  const equipped = owned.includes(requested) ? requested : DEFAULT_CAR_ID;
  const customizations = {};
  for (const id of owned) {
    const raw = saved.customizations?.[id] ?? (id === equipped ? saved.customization : null);
    customizations[id] = normalizeCustomization(raw, carById(id));
  }
  return { version: GARAGE_VERSION, owned, equipped, customizations };
}
/** A detached, JSON-safe garage snapshot; currency/upgrades belong to the campaign save. */
export function serializeGarage(stateOrGarage) {
  return normalizeGarage(stateOrGarage?.garage ?? stateOrGarage);
}
export function getCarProfile(stateOrId) {
  const id = typeof stateOrId === "string" ? stateOrId : stateOrId?.garage?.equipped ?? stateOrId?.equipped;
  return carById(id) || CAR_CATALOG[0];
}
/** Resolved option objects: .paint.color/.highlight, .wheels.rim/.glow, .decal.id/.color. */
export function getCarAppearance(stateOrGarage, carId) {
  const garage = stateOrGarage?.garage ?? stateOrGarage;
  const car = carById(carId) || getCarProfile(garage);
  const saved = normalizeCustomization(garage?.customizations?.[car.id], car);
  return {
    paint: optionById(PAINT_OPTIONS, saved.paint, car.paint),
    wheels: optionById(WHEEL_OPTIONS, saved.wheels, "classic"),
    decal: optionById(DECAL_OPTIONS, saved.decal, "none"),
  };
}
export function getCarStats(carOrId, upgrades = {}) {
  const car = typeof carOrId === "string" ? getCarProfile(carOrId) : carOrId?.stats ? carOrId : getCarProfile(carOrId);
  const level = (id) => clamp(Math.trunc(Number(upgrades[id]) || 0), 0, 3);
  return {
    energyCapacity: car.stats.energyCapacity + level("battery") * 30,
    integrityCapacity: car.stats.integrityCapacity + level("armor") * 25,
    thrustDrain: car.stats.thrustDrain - level("battery") * 2,
    thrustAcceleration: car.stats.thrustAcceleration,
    shotInterval: car.stats.shotInterval / (1 + level("hearts") * 0.4),
    chargeRate: car.stats.chargeRate + level("charger") * 18,
    rushRecovery: 5 - level("rushCooler") * 0.75,
    heartHeightBonus: level("heartReach") * 0.15,
    heartHitRadius: 8 + level("heartReach") * 4,
    chargeRadiusBonus: level("evRange") * 10,
  };
}
export function applyCarStats(state) {
  Object.assign(state, getCarStats(getCarProfile(state), state.upgrades));
  return state;
}
export function ownsCar(stateOrGarage, carId) {
  return normalizeGarage(stateOrGarage?.garage ?? stateOrGarage).owned.includes(carId);
}
export function carPrice(meta, carId) {
  const car = carById(carId);
  return !car || createMetaProgress(meta).ownedCars.includes(carId) ? null : car.unlockPrice;
}
function emit(state, type, detail) {
  state.events ??= [];
  state.events.push({ ...detail, type });
}
/** Club garage offers current-car coin upgrades; car selection stays new-game-only. */
export function canUseGarage(state) { return state?.status === "won"; }
/** Retired coin-purchase APIs intentionally reject all requests. */
export function buyCar() { return false; }
export function equipCar() { return false; }
export const META_PROGRESS_VERSION = 1;
export const COMPLETION_POINT_REWARD = 3;
const validRunId = (id) => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(id);
function emptyMeta() {
  return { version: META_PROGRESS_VERSION, completionPoints: 0, ownedCars: [DEFAULT_CAR_ID], creditedRunIds: [],
    upgrades: { battery: 0, hearts: 0, charger: 0, armor: 0 },
    cosmeticUnlocks: { paint: ["pink"], wheels: ["classic"], decal: ["none"] }, customizations: { [DEFAULT_CAR_ID]: { paint: "pink", wheels: "classic", decal: "none" } } };
}
/** Corrupt/future saves are rejected; unknown car IDs and duplicate credits are discarded. */
export function restoreMetaProgress(value) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!plainObject(value) || (value.version !== undefined && value.version !== 0 && value.version !== META_PROGRESS_VERSION)) return null;
  const meta = emptyMeta();
  if (Number.isFinite(value.completionPoints))
    meta.completionPoints = clamp(Math.floor(value.completionPoints), 0, 1_000_000_000);
  for (const id of Array.isArray(value.ownedCars) ? value.ownedCars : [])
    if (carById(id) && !meta.ownedCars.includes(id)) meta.ownedCars.push(id);
  for (const id of Object.keys(meta.upgrades)) {
    const level = value.upgrades?.[id];
    meta.upgrades[id] = Number.isFinite(level) ? clamp(Math.floor(level), 0, 3) : 0;
  }
  for (const [key, catalog] of Object.entries(COSMETIC_CATALOGS)) {
    const values = value.cosmeticUnlocks?.[key];
    for (const id of Array.isArray(values) ? values : [])
      if (catalog.some((option) => option.id === id) && !meta.cosmeticUnlocks[key].includes(id)) meta.cosmeticUnlocks[key].push(id);
  }
  // Factory colors from every owned car are free, regardless of ownership order.
  for (const id of meta.ownedCars) {
    const paint = carById(id).paint;
    if (!meta.cosmeticUnlocks.paint.includes(paint)) meta.cosmeticUnlocks.paint.push(paint);
  }
  for (const id of meta.ownedCars) {
    const car = carById(id);
    const selection = normalizeCustomization(value.customizations?.[id], car);
    for (const key of Object.keys(COSMETIC_CATALOGS))
      if (!meta.cosmeticUnlocks[key].includes(selection[key])) selection[key] = key === "paint" ? car.paint : key === "wheels" ? "classic" : "none";
    meta.customizations[id] = selection;
  }
  meta.creditedRunIds = [...new Set((Array.isArray(value.creditedRunIds) ? value.creditedRunIds : []).filter(validRunId))];
  return meta;
}
export function createMetaProgress(saved) { return restoreMetaProgress(saved) || emptyMeta(); }
export function exportMetaProgress(meta) { return createMetaProgress(meta); }
/** First departure permanently locks this run's vehicle, including after retries/reloads. */
export function canChooseStartingCar(state) {
  return state?.status === "playing" && state.routeIndex === 0 &&
    state.distance === 0 && state.elapsed === 0 && state.stagesCompleted === 0 &&
    state.campaignStarted === false;
}
/** Car unlocks spend only completion points, only while preparing a new campaign. */
export function unlockCar(meta, carId, state) {
  if (!plainObject(meta) || !canChooseStartingCar(state)) return false;
  const normalized = restoreMetaProgress(meta), car = carById(carId);
  if (!normalized || !car || normalized.ownedCars.includes(carId) ||
      !Number.isFinite(meta.completionPoints) || normalized.completionPoints < car.unlockPrice) return false;
  normalized.completionPoints -= car.unlockPrice;
  normalized.ownedCars.push(carId);
  Object.assign(meta, restoreMetaProgress(normalized));
  emit(state, "car-unlock", { carId, price: car.unlockPrice, completionPoints: meta.completionPoints });
  return true;
}
/** Free selection among already unlocked vehicles before the new tour's first departure. */
export function equipStartingCar(state, meta, carId) {
  if (!canChooseStartingCar(state) || !carById(carId)) return false;
  const progress = restoreMetaProgress(meta);
  if (!progress || !progress.ownedCars.includes(carId)) return false;
  const garage = normalizeGarage({ owned: progress.ownedCars, equipped: carId, customizations: progress.customizations });
  // Grandfather already-earned legacy upgrades; new purchases use campaign coins only.
  state.upgrades = { ...progress.upgrades };
  const changed = state.garage?.equipped !== carId;
  state.garage = garage;
  applyCarStats(state);
  // These are fresh-run starting resources, never a midcampaign repair.
  state.energy = state.energyCapacity;
  state.integrity = state.integrityCapacity;
  if (state._stageStart) {
    state._stageStart.upgrades = { ...state.upgrades };
    state._stageStart.garage = serializeGarage(state);
    state._stageStart.energy = state.energy;
    state._stageStart.integrity = state.integrity;
  }
  if (changed) emit(state, "car-equip", { carId });
  return true;
}
/** Only a complete journey credits this persisted run once; watching the DJ set is optional. */
export function awardCompletion(meta, state) {
  if (!plainObject(meta) || !state || state.status !== "won" || state.campaignComplete !== true ||
      state.routeIndex !== JOURNEY_STAGE_COUNT - 1 || state.stagesCompleted !== JOURNEY_STAGE_COUNT || state.campaignStarted !== true ||
      !Number.isFinite(state.routeLength) || state.routeLength <= 0 || state.distance < state.routeLength ||
      !validRunId(state.runId)) return 0;
  const normalized = restoreMetaProgress(meta);
  if (!normalized || normalized.creditedRunIds.includes(state.runId)) return 0;
  normalized.completionPoints = Math.min(1_000_000_000, normalized.completionPoints + COMPLETION_POINT_REWARD);
  normalized.creditedRunIds.push(state.runId);
  Object.assign(meta, normalized);
  return COMPLETION_POINT_REWARD;
}
/** Old free/midrun cosmetic API is deliberately disabled. */
export function customizeCar() { return false; }

const COSMETIC_CATALOGS = Object.freeze({ paint: PAINT_OPTIONS, wheels: WHEEL_OPTIONS, decal: DECAL_OPTIONS });
export const STARTING_UPGRADE_CATALOG = freezeOptions([
  { id: "battery", name: "バッテリーPLUS", description: "容量 +30 / スラスター消費 -2毎秒", basePrice: 1, maxLevel: 3 },
  { id: "hearts", name: "ハート連射", description: "ハートの発射間隔を短縮", basePrice: 1, maxLevel: 3 },
  { id: "charger", name: "急速チャージ", description: "EV充電 +18毎秒", basePrice: 1, maxLevel: 3 },
  { id: "armor", name: "タフかわボディ", description: "耐久上限 +25", basePrice: 1, maxLevel: 3 },
]);
/** Use this view in the picker; locked vehicles expose no name, art or stats. */
export function getCarReveal(meta, carId) {
  const car = carById(carId);
  if (!car) return null;
  return createMetaProgress(meta).ownedCars.includes(carId)
    ? { ...car, locked: false }
    : { id: carId, locked: true, name: "シークレットカー", price: car.unlockPrice, unlockPrice: car.unlockPrice, currency: "completionPoints" };
}
/** Retired GP modification APIs: preserve old saves, never spend new completion points. */
export function startingUpgradePrice() { return null; }
export function buyStartingUpgrade() { return false; }
/** Each nonfactory cosmetic unlock costs one GP, globally reusable across owned cars. */
export const STARTING_COSMETIC_PRICE = 1;
function customizationRequest(state, meta, patch) {
  if (!canChooseStartingCar(state) || !plainObject(meta) || !plainObject(patch)) return null;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !Object.hasOwn(COSMETIC_CATALOGS, key) ||
      !COSMETIC_CATALOGS[key].some((option) => option.id === patch[key]))) return null;
  const progress = restoreMetaProgress(meta), carId = state.garage?.equipped;
  if (!progress || !carById(carId) || !progress.ownedCars.includes(carId) ||
      !Array.isArray(state.garage?.owned) || !state.garage.owned.includes(carId)) return null;
  const selection = { ...normalizeCustomization(state.garage.customizations?.[carId], carById(carId)), ...patch };
  const price = keys.reduce((sum, key) => sum + (progress.cosmeticUnlocks[key].includes(patch[key]) ? 0 : STARTING_COSMETIC_PRICE), 0);
  return { progress, carId, selection, keys, price };
}
/** Pure quote: null means invalid/locked phase; zero means already owned. Does not check affordability. */
export function startingCustomizationPrice(state, meta, patch) {
  return customizationRequest(state, meta, patch)?.price ?? null;
}
/** Atomic GP-only purchase/equip for the selected owned car before first departure. */
export function customizeStartingCar(state, meta, patch) {
  const request = customizationRequest(state, meta, patch);
  if (!request || !Number.isFinite(meta.completionPoints) || meta.completionPoints < 0 ||
      request.progress.completionPoints < request.price) return false;
  const { progress, carId, selection, keys, price } = request;
  progress.completionPoints -= price;
  for (const key of keys)
    if (!progress.cosmeticUnlocks[key].includes(patch[key])) progress.cosmeticUnlocks[key].push(patch[key]);
  progress.customizations[carId] = { ...selection };
  Object.assign(meta, progress);
  state.garage.customizations[carId] = { ...selection };
  // A retry or checkpoint reload must retain the departure appearance without another charge.
  if (state._stageStart) state._stageStart.garage = serializeGarage(state);
  emit(state, "car-customize", { carId, customization: { ...selection }, price, completionPoints: meta.completionPoints });
  return true;
}
