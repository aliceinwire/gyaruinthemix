/** Current-car tour builds and destination goals. No DOM, randomness, unlocks or new currency. */
import { CAR_CATALOG, DEFAULT_CAR_ID } from './garage.js';
import { getJourneyNode, JOURNEY_STAGE_COUNT } from './journey.js';

export const RUN_BUILD_VERSION = 1;
export const RUN_BUILD_CAPACITY = 4;
const MONEY_LIMIT = 1_000_000_000;
const FAMILIES = Object.freeze([
  Object.freeze({ id: 'relay', name: 'ハート連鎖', color: '#ff72bd', description: '貫通から連鎖へ。街の人波を味方にするで。' }),
  Object.freeze({ id: 'guardian', name: '充電ガード', color: '#77f4e8', description: 'EVで守りを仕込んで、次の一発につなぐで。' }),
  Object.freeze({ id: 'air', name: '空中ラッシュ', color: '#ffe091', description: '浮いてよけて、ラッシュで道を開こ。' }),
]);
const data = [
  { id: 'heart-pierce', family: 'relay', tier: 1, name: 'つらぬきハート', description: 'ハートがもう1体まで貫通するで。並んだ相手をねらお。', preview: '1発で最大2体に届く', effects: { heartPierce: 1 } },
  { id: 'heart-chain', family: 'relay', tier: 2, name: 'となりもギャル', description: 'ギャル化した相手から32m以内のもう1人へ連鎖や。貫通と組むと人波に強いで。', preview: '命中した相手の近くへ1回連鎖', effects: { heartChain: 1, heartChainRange: 32 } },
  { id: 'heart-recycle', family: 'relay', tier: 3, name: 'ときめき還元', description: 'ギャル化1人につき電池+3や。貫通も連鎖も次の浮力につながるで。', preview: 'ギャル化ごとに電池+3', effects: { conversionEnergy: 3 } },
  { id: 'charge-shield', family: 'guardian', tier: 1, name: 'EVおまもり', description: 'EVで2秒充電したら、次の衝突1回をガードや。使ったらまた充電しよ。', preview: '2秒のEV充電で1回ガード', effects: { chargeShield: true, chargeShieldSeconds: 2 } },
  { id: 'charged-heart', family: 'guardian', tier: 2, name: '満タンの一撃', description: '満充電で次のハートの威力+1や。守りを仕込んだあとの障害物に使お。', preview: '満充電後の次弾は威力+1', effects: { chargedHeartBonus: 1 } },
  { id: 'shield-piercing', family: 'guardian', tier: 3, name: 'おまもり貫通', description: 'EVガードを持ってる間は敵のガードを無視して、ハートがさらに1体貫通や。EVおまもりと一緒に積んで、守りを残そ。', preview: 'EVガード保持中、敵のガードを無視・貫通+1', effects: { shieldPiercing: true } },
  { id: 'air-control', family: 'air', tier: 1, name: 'ふわっと着地', description: '落ちる速さを35%抑えて、スラスター消費も15%節約や。高く飛ぶほど着地を見よ。', preview: '下降速度×0.65 / スラスター消費×0.85', effects: { descentMultiplier: .65, thrustDrainMultiplier: .85 } },
  { id: 'rush-pulse', family: 'air', tier: 2, name: 'ラッシュ開花', description: 'ラッシュ開始で前45mにハートの波や。浮いて距離を合わせてから、一気にいこ。', preview: 'ラッシュ開始時、前45mへハート波', effects: { rushPulse: 45 } },
  { id: 'combo-flight', family: 'air', tier: 3, name: '飛びこえチャージ', description: '障害物を空中でよけたら電池+4や。ふわっと飛んで次のラッシュへつなご。', preview: '空中で障害物を回避するたび電池+4', effects: { comboFlight: 4 } },
];
export const RUN_MOD_CATALOG = Object.freeze(data.map(item => Object.freeze({
  ...item, minLeg: [0, 2, 5][item.tier - 1], rarity: ['basic', 'uncommon', 'rare'][item.tier - 1],
  rarityLabel: ['ベーシック', '連携', 'レア'][item.tier - 1], basePrice: [210, 330, 450][item.tier - 1],
  requires: item.tier === 1 ? null : data.find(other => other.family === item.family && other.tier === item.tier - 1).id,
  effects: Object.freeze({ ...item.effects }),
})));
const BY_ID = new Map(RUN_MOD_CATALOG.map(item => [item.id, item]));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, max = MONEY_LIMIT) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, max) : 0;
const integer = (value, max = MONEY_LIMIT) => Math.floor(number(value, max));
const validCar = id => CAR_CATALOG.some(car => car.id === id);
const carIdFrom = value => {
  const id = typeof value === 'string' ? value : value?.garage?.equipped ?? value?.carId ?? value?.equipped;
  return validCar(id) ? id : DEFAULT_CAR_ID;
};
const hasCarContext = value => typeof value === 'string' || plain(value) && ('carId' in value || 'garage' in value || 'equipped' in value);
const validMoney = value => Number.isSafeInteger(value) && value >= 0 && value <= MONEY_LIMIT;
const legNumber = value => Number.isInteger(value) && value >= 0 && value < JOURNEY_STAGE_COUNT;
const legList = value => [...new Set((Array.isArray(value) ? value : []).filter(legNumber))].sort((a, b) => a - b);
const eventId = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? `n:${value}` : typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(value) ? `s:${value}` : null;
const eventIds = value => [...new Set((Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && /^(n:\d+|s:[A-Za-z0-9_.:-]{1,96})$/.test(id)))].slice(0, 512);
const emptyMission = (nodeId = null) => ({ nodeId, conversions: 0, bestCombo: 0, chargeSeconds: 0, hits: 0, rushes: 0, jumpClears: 0, fullCharges: 0, convertedIds: [], hitIds: [], jumpIds: [] });
function normalizeMission(value) {
  if (!plain(value) || !getJourneyNode(value.nodeId)) return emptyMission();
  return { nodeId: value.nodeId, conversions: integer(value.conversions, 512), bestCombo: integer(value.bestCombo, 512),
    chargeSeconds: number(value.chargeSeconds, 1200), hits: integer(value.hits, 512), rushes: integer(value.rushes, 512),
    jumpClears: integer(value.jumpClears, 512), fullCharges: integer(value.fullCharges, 512),
    convertedIds: eventIds(value.convertedIds), hitIds: eventIds(value.hitIds), jumpIds: eventIds(value.jumpIds) };
}
/** A detached, JSON-safe value; malformed/future data cannot add powers or invent IDs. */
export function normalizeRunBuild(value, context) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  const saved = plain(value?.runBuild) ? value.runBuild : plain(value) ? value : {};
  const expectedCar = hasCarContext(context) ? carIdFrom(context) : null;
  const carId = expectedCar ?? carIdFrom(saved);
  const fresh = { version: RUN_BUILD_VERSION, carId, mods: [], acquiredIds: [], purchasedLegs: [], settledLegs: [], mission: emptyMission() };
  if (saved.version !== undefined && saved.version !== RUN_BUILD_VERSION) return fresh;
  const matchingCar = !saved.carId || validCar(saved.carId) && saved.carId === carId;
  const rawMods = Array.isArray(saved.mods) ? saved.mods : [];
  const rawAcquired = Array.isArray(saved.acquiredIds) ? saved.acquiredIds : rawMods;
  const requested = new Set(rawAcquired.filter(id => typeof id === 'string'));
  if (matchingCar) for (const item of RUN_MOD_CATALOG) {
    if (requested.has(item.id) && (!item.requires || fresh.acquiredIds.includes(item.requires))) fresh.acquiredIds.push(item.id);
  }
  fresh.mods = [...new Set(rawMods.filter(id => fresh.acquiredIds.includes(id)))].slice(0, RUN_BUILD_CAPACITY);
  // Keep receipts even if a corrupt car binding invalidated its powers: no extra stop purchases/rewards.
  fresh.purchasedLegs = legList(saved.purchasedLegs);
  fresh.settledLegs = legList(saved.settledLegs);
  fresh.mission = normalizeMission(saved.mission);
  return fresh;
}
export function createRunBuild(carOrState = DEFAULT_CAR_ID) {
  return normalizeRunBuild({ version: RUN_BUILD_VERSION, carId: carIdFrom(carOrState) });
}
function stateBuild(state) { return normalizeRunBuild(state?.runBuild, { carId: carIdFrom(state) }); }
function emit(state, event) {
  if (!Array.isArray(state.events)) state.events = [];
  state.events.push(event);
}
/** All consumers get explicit neutral values. Does not mutate base vehicle stats. */
export function getBuildModifiers(state) {
  const effects = { heartPierce: 0, heartChain: 0, heartChainRange: 0, conversionEnergy: 0,
    chargeShield: false, chargeShieldSeconds: 2, chargedHeartBonus: 0, shieldPiercing: false,
    rushPulse: 0, descentMultiplier: 1, thrustDrainMultiplier: 1, comboFlight: 0 };
  for (const id of stateBuild(state).mods) Object.assign(effects, BY_ID.get(id).effects);
  return effects;
}
function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
  return result;
}
/** Up to three stable, unlocked next-step choices. Mastered families never crowd out a choice. */
export function getBuildOffers(state) {
  if (!plain(state) || !legNumber(state.routeIndex)) return [];
  const build = stateBuild(state), carId = carIdFrom(state), car = CAR_CATALOG.find(item => item.id === carId);
  const rotation = hash(`${Number.isSafeInteger(state.seed) ? state.seed : 0}:${state.routeIndex}:${carId}`) % FAMILIES.length;
  return FAMILIES.map((_, index) => FAMILIES[(index + rotation) % FAMILIES.length]).map(family => {
    const familyMods = RUN_MOD_CATALOG.filter(item => item.family === family.id);
    const item = familyMods.find(item => !build.acquiredIds.includes(item.id));
    if (!item || state.routeIndex < item.minLeg) return null;
    const price = item.basePrice + Math.floor(state.routeIndex / 3) * 10;
    let reason = '';
    if (state.routeIndex === JOURNEY_STAGE_COUNT - 1 || state.campaignComplete) reason = 'ツアー完走！ 次の旅で組み直そ';
    else if (state.status !== 'won' || state.campaignStarted !== true) reason = '到着後のお店で選ぼ';
    else if (build.purchasedLegs.includes(state.routeIndex)) reason = 'この到着地点では選択済みや';
    else if (!validMoney(state.money) || state.money < price) reason = 'コインが足りへんで';
    return { ...item, effects: { ...item.effects }, price, carId, carName: car.name,
      familyName: family.name, color: family.color, mastered: false, owned: false,
      requiresReplacement: build.mods.length >= RUN_BUILD_CAPACITY,
      installedMods: build.mods.map(id => ({ id, name: BY_ID.get(id).name, preview: BY_ID.get(id).preview })),
      available: reason === '', reason, preview: `${item.preview} / ${car.name}専用・今回の旅だけ` };
  }).filter(Boolean);
}
/** Spend tour coins once at a cleared stop, never permanent completion points. */
export function buyRunMod(state, id, replaceId = null) {
  if (typeof id !== 'string' || !BY_ID.has(id)) return false;
  const offer = getBuildOffers(state).find(item => item.id === id);
  if (!offer?.available) return false;
  const build = stateBuild(state);
  const replacing = replaceId !== null && replaceId !== undefined;
  if (replacing && (typeof replaceId !== 'string' || !build.mods.includes(replaceId))) return false;
  if (build.mods.length >= RUN_BUILD_CAPACITY && !replacing) return false;
  if (replacing) build.mods = build.mods.filter(installed => installed !== replaceId);
  build.mods.push(id);
  build.acquiredIds.push(id);
  build.purchasedLegs.push(state.routeIndex);
  state.money -= offer.price;
  state.runBuild = normalizeRunBuild(build, state);
  emit(state, { type: 'run-mod-purchase', id, upgrade: id, family: offer.family, replacedId: replacing ? replaceId : null, price: offer.price, money: state.money });
  return true;
}
export function describeBuild(state) {
  const build = stateBuild(state);
  const families = FAMILIES.map(family => {
    const mods = RUN_MOD_CATALOG.filter(item => item.family === family.id && build.mods.includes(item.id));
    return { ...family, level: mods.length, mods: mods.map(item => item.id) };
  });
  const active = families.filter(family => family.level > 0), max = Math.max(0, ...active.map(family => family.level));
  const leaders = active.filter(family => family.level === max);
  const name = !active.length ? 'まだ自由なノーマル仕様' : leaders.length > 1 ? 'ええとこ混ぜるミックス仕様' : `${leaders[0].name}仕様`;
  return { name, carId: build.carId, capacity: RUN_BUILD_CAPACITY, installedCount: build.mods.length, acquiredIds: [...build.acquiredIds], families, mods: RUN_MOD_CATALOG.filter(item => build.mods.includes(item.id)).map(item => ({ id: item.id, name: item.name, description: item.description, preview: item.preview })),
    effects: getBuildModifiers(state), summary: active.length ? active.map(family => `${family.name} ${family.level}/3`).join('・') : '到着後、3つの系統からこの車の伸ばし方を選ぼ。' };
}
function routeNode(state, candidate) {
  const requested = typeof candidate === 'string' ? candidate : candidate?.nodeId ?? state?.journeyNodeId;
  return getJourneyNode(requested);
}
/** Read-only previews also work for a future map node; only its matching progress is displayed. */
export function getRouteMission(state, node) {
  const target = routeNode(state, node);
  if (!target) return null;
  const build = stateBuild(state), progress = build.mission.nodeId === target.nodeId ? build.mission : emptyMission(target.nodeId);
  const tier = Math.floor(target.stageIndex / 4);
  let label, description, goal, complete;
  if (target.kind === 'ev') {
    label = 'EVでひと息'; goal = { chargeSeconds: 2 + tier * .5 };
    description = `EVで合計${goal.chargeSeconds}秒充電して到着や。電池満タンでも数えるで。`;
    complete = progress.chargeSeconds + 1e-8 >= goal.chargeSeconds;
  } else if (target.kind === 'event') {
    label = '街角で連続ギャル化'; goal = { conversions: 3 + tier, bestCombo: 2 + (tier === 2 ? 1 : 0) };
    // Use the complete deterministic road plan, never the transient visible entities.
    // Map previews construct this same candidate road, so their promise matches play.
    if (state?.journeyNodeId === target.nodeId && state.routeIndex === target.stageIndex && Array.isArray(state._encounterPlan)) {
      const distances = state._encounterPlan.filter(item => item?.type === 'salaryman' && Number.isFinite(item.distance))
        .map(item => item.distance).sort((a, b) => a - b);
      let longest = 0, consecutive = 0, previous = -Infinity;
      for (const distance of distances) {
        consecutive = distance - previous <= 80 ? consecutive + 1 : 1;
        longest = Math.max(longest, consecutive);
        previous = distance;
      }
      goal.conversions = Math.max(1, Math.min(goal.conversions, distances.length - 1));
      goal.bestCombo = Math.max(1, Math.min(goal.bestCombo, longest));
    }
    description = `${goal.conversions}人ギャル化して、${goal.bestCombo}コンボを1回決めよ。人波をつなぐで。`;
    complete = progress.conversions >= goal.conversions && progress.bestCombo >= goal.bestCombo;
  } else {
    label = 'ピットまでスマートに'; goal = { maxHits: 2, rushes: 1 };
    description = 'ラッシュを1回使って、衝突2回以内で到着や。到着修理+20は別でもらえるで。';
    complete = progress.rushes >= goal.rushes && progress.hits <= goal.maxHits;
  }
  const reward = 80 + tier * 20;
  return { id: `${target.nodeId}:goal`, nodeId: target.nodeId, kind: target.kind, stageIndex: target.stageIndex,
    label, description, goal, progress: { ...progress, convertedIds: [...progress.convertedIds], hitIds: [...progress.hitIds], jumpIds: [...progress.jumpIds] },
    complete, reward, rewardLabel: `達成して到着：コイン+${reward}`, settled: build.settledLegs.includes(target.stageIndex) };
}
/** Consume simulation events only on the current road. Call for each charge tick, even at full battery. */
export function routeMissionProgress(state, event) {
  const node = routeNode(state);
  if (!plain(state) || state.status !== 'playing' || !node || node.stageIndex !== state.routeIndex || !plain(event)) return false;
  const type = event.type;
  if (!['stage-start', 'convert', 'charge', 'collision', 'rush-start', 'jump-clear', 'charged'].includes(type)) return false;
  const build = stateBuild(state);
  if (build.settledLegs.includes(state.routeIndex)) return false;
  const progress = build.mission.nodeId === node.nodeId ? build.mission : emptyMission(node.nodeId);
  const addUnique = (key, countKey) => {
    const id = eventId(event.entityId);
    if (id && progress[key].includes(id)) return false;
    if (id && progress[key].length < 512) progress[key].push(id);
    progress[countKey] = Math.min(512, progress[countKey] + 1);
    return true;
  };
  if (type === 'stage-start') {
    build.mission = progress;
    state.runBuild = build;
    return true;
  }
  if (type === 'convert') {
    if (!addUnique('convertedIds', 'conversions')) return false;
    progress.bestCombo = Math.max(progress.bestCombo, integer(event.combo ?? state.combo, 512));
  } else if (type === 'charge') {
    if (typeof event.seconds !== 'number' || !Number.isFinite(event.seconds) || event.seconds <= 0 || event.seconds > 1) return false;
    progress.chargeSeconds = Math.min(1200, progress.chargeSeconds + event.seconds);
  } else if (type === 'collision') {
    if (!addUnique('hitIds', 'hits')) return false;
  } else if (type === 'jump-clear') {
    if (!addUnique('jumpIds', 'jumpClears')) return false;
  } else if (type === 'rush-start') progress.rushes = Math.min(512, progress.rushes + 1);
  else progress.fullCharges = Math.min(512, progress.fullCharges + 1);
  build.mission = progress;
  state.runBuild = build;
  return true;
}
/** Settle once after the simulation records the real clear. A missed goal is settled too. */
export function settleRouteReward(state, node) {
  const target = routeNode(state, node);
  if (!plain(state) || state.status !== 'won' || !target || target.nodeId !== state.journeyNodeId ||
      target.stageIndex !== state.routeIndex || !validMoney(state.money) ||
      !Number.isInteger(state.stagesCompleted) || state.stagesCompleted < target.stageIndex + 1 ||
      state.journey?.completedNodeIds?.[target.stageIndex] !== target.nodeId) return false;
  const mission = getRouteMission(state, target), build = stateBuild(state);
  if (mission.settled) return false;
  const reward = mission.complete ? mission.reward : 0;
  build.settledLegs.push(target.stageIndex);
  state.runBuild = normalizeRunBuild(build, state);
  state.money = Math.min(MONEY_LIMIT, state.money + reward);
  emit(state, { type: 'route-reward', nodeId: target.nodeId, completed: mission.complete, reward, money: state.money });
  return { completed: mission.complete, reward, nodeId: target.nodeId };
}
