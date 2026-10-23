/** One-life, seeded club tour. Weapon rules and previews share the same specifications. */
import { ENCOUNTER_RULES } from './encounter-director.js';
import { decorateEncounter } from './street-culture.js';

export const SURVIVAL_VERSION = 4;
export const SURVIVAL_RECORD_KEY = 'gyaruinthemix-survival-records-v4';
export const SURVIVAL_UPGRADES = Object.freeze([
  { id: 'heart', kind: 'weapon', name: 'ハート連射', family: 'HEART', description: '自動ハートが速くなる。Lv.6とリレーLv.2で3方向のハートストームに進化。' },
  { id: 'relay', name: 'ファンリレー', family: 'HEART', description: 'ハートが近くの相手へ連鎖。レベルごとに届く人数と距離が増える。' },
  { id: 'flash', kind: 'weapon', name: 'フォトフラッシュ', family: 'CAMERA', description: 'カメラが前方をまとめてフラッシュ。Lv.6と電池Lv.2でガードも貫くフラッシュモブに進化。' },
  { id: 'vinyl', kind: 'weapon', name: 'レコードオービット', family: 'VINYL', description: '回るレコードが近くの相手へ自動攻撃。Lv.6と浮力Lv.2でアンコールオービットに進化。' },
  { id: 'bass', kind: 'weapon', name: 'ベースウェーブ', family: 'BASS', description: '近くへ重低音の波を自動で放つ。Lv.6と熱狂Lv.2で、ガードを抜くアフターパーティーに進化。' },
  { id: 'phone', kind: 'weapon', name: 'デコ電コール', family: 'PHONE', description: 'デコ電から、近い相手へ少人数の着信リレー。Lv.6とMDアンコールLv.2でデコ電ホットラインに進化。' },
  { id: 'cd', kind: 'weapon', name: 'CDスピン', family: 'CD', description: '前方のガードがない、いちばんタフな相手へCDを飛ばす。Lv.6とアーマーLv.2でガードを貫くプリズムCDに進化。' },
  { id: 'cassette', kind: 'weapon', name: 'カセットリボン', family: 'CASSETTE', description: '近くへテープを広げ、同じ場所を半分の威力でもう一度。Lv.6と浮力Lv.2で3回広がるダブルデッキに進化。' },
  { id: 'md', name: 'MDアンコール', family: 'SUPPORT', description: '当たった相手が残っていたら、0.35秒後に威力半分で1回リピート。連続では発動せず、同じ相手だけに届く。' },
  { id: 'battery', name: 'ときめき電池', family: 'SUPPORT', description: '招待するたびに電池を回復。XPを引き寄せる範囲もレベルごとに広がる。' },
  { id: 'glide', name: 'フェザー浮力', family: 'SUPPORT', description: 'レベルごとに浮力の電池消費を12%減らす。ジャンプ成功でも電池を回復。' },
  { id: 'armor', name: 'ネオンアーマー', family: 'SUPPORT', description: '今すぐ耐久+12。レベルごとに受けるダメージを12%減らす。' },
  { id: 'hype', name: 'フロア熱狂', family: 'SUPPORT', description: 'HEATがたまりやすくなり、FEVERが1秒長くなる。連続招待でスコアを伸ばそ。' },
].map(item => Object.freeze({ kind: 'support', icon: item.id, maxLevel: item.kind === 'weapon' ? 6 : 3, ...item })));
export const SURVIVAL_WEAPONS = Object.freeze(SURVIVAL_UPGRADES.filter(item => item.kind === 'weapon'));
export const SURVIVAL_STARTERS = SURVIVAL_WEAPONS;
const AREA_WEAPONS = SURVIVAL_WEAPONS.filter(item => item.id !== 'heart');
export const SURVIVAL_MAX_LEVEL = SURVIVAL_UPGRADES.reduce((sum, item) => sum + item.maxLevel, 0) - 1;
export const SURVIVAL_EVOLUTIONS = Object.freeze([
  { id: 'heartstorm', name: 'ハートストーム', weapon: 'heart', support: 'relay' },
  { id: 'flashmob', name: 'フラッシュモブ', weapon: 'flash', support: 'battery' },
  { id: 'encore', name: 'アンコールオービット', weapon: 'vinyl', support: 'glide' },
  { id: 'afterparty', name: 'アフターパーティー', weapon: 'bass', support: 'hype' },
  { id: 'hotline', name: 'デコ電ホットライン', weapon: 'phone', support: 'md' },
  { id: 'prism', name: 'プリズムCD', weapon: 'cd', support: 'armor' },
  { id: 'doubledeck', name: 'ダブルデッキ', weapon: 'cassette', support: 'glide' },
].map(recipe => Object.freeze({ ...recipe, weaponRequired: 6, supportRequired: 2 })));
const recipeReady = (upgrades, recipe) => upgrades[recipe.weapon] >= recipe.weaponRequired && upgrades[recipe.support] >= recipe.supportRequired;
const hash = value => { let n = 2166136261; for (const char of String(value)) n = Math.imul(n ^ char.charCodeAt(0), 16777619) >>> 0; return n; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const isSurvival = state => state?.mode === 'survival' && state?.survival?.version === SURVIVAL_VERSION;
export function dailySurvival(date = new Date()) {
  // Japan midnight changes the course; an in-progress run keeps its original seed.
  const day = new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  return { day, seed: hash(`night-survival:${SURVIVAL_VERSION}:${day}`) };
}
export function createSurvival(day = '', startingWeapon = 'heart') {
  const weapon = SURVIVAL_STARTERS.some(item => item.id === startingWeapon) ? startingWeapon : 'heart';
  return { version: SURVIVAL_VERSION, recordEligible: true, day, startingWeapon: weapon, xp: 0, level: 0, upgrades: { [weapon]: 1 }, evolutions: [],
    quizRoads: [], heat: 0, fever: 0, sinceHit: 0, seconds: 0, wave: 0, waveStats: Array.from({ length: 6 }, () => ({ kills: 0, hits: 0 })), settledWaves: [],
    cleanWaves: 0, kills: 0, elites: 0, bestMultiplier: 1, gems: [], receipts: [],
    flashClock: 0, vinylClock: 0, bassClock: 0, phoneClock: 0, cdClock: 0, cassetteClock: 0, cassetteLoops: [], echoClock: 0, echoPending: null, bestNotified: false };
}
/** Only durable run progress crosses the between-road save boundary. */
export function normalizeSurvivalSave(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![2, 3, SURVIVAL_VERSION].includes(value.version) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !SURVIVAL_STARTERS.some(item => item.id === value.startingWeapon) ||
      !value.upgrades || typeof value.upgrades !== 'object' || Array.isArray(value.upgrades)) return null;
  const date = new Date(`${value.day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.day) return null;
  const result = createSurvival(value.day, value.startingWeapon);
  // A continued older-rules tour keeps all progress without entering the new score pool.
  result.recordEligible = value.version === SURVIVAL_VERSION && (value.recordEligible === undefined || value.recordEligible === true);
  result.upgrades = {};
  let savedLevel = -1;
  for (const item of SURVIVAL_UPGRADES) {
    const level = value.upgrades[item.id] ?? 0;
    const legacy = value.version < SURVIVAL_VERSION;
    if (!Number.isInteger(level) || level < 0 || level > (legacy ? 3 : item.maxLevel) || legacy && ['cd', 'cassette'].includes(item.id) && level) return null;
    savedLevel += level;
    // Old levels 1 / 2 / 3 retain comparable power at levels 1 / 3 / 6.
    if (level) result.upgrades[item.id] = legacy && item.kind === 'weapon' ? [0, 1, 3, 6][level] : level;
  }
  if (!result.upgrades[value.startingWeapon]) return null;
  result.level = Object.values(result.upgrades).reduce((sum, level) => sum + level, 0) - 1;
  if (value.level !== savedLevel || !Number.isFinite(value.xp) || value.xp < 0) return null;
  result.xp = Math.min(1e8, value.xp);
  if (value.quizRoads !== undefined && (!Array.isArray(value.quizRoads) || value.quizRoads.some(road => !Number.isInteger(road) || road < 1 || road > 11 || road % 2 !== 1))) return null;
  result.quizRoads = [...new Set(value.quizRoads || [])].sort((a, b) => a - b);
  result.evolutions = SURVIVAL_EVOLUTIONS.filter(recipe => recipeReady(result.upgrades, recipe)).map(recipe => recipe.id);
  const bounded = (key, maximum, integer = false) => {
    const valueNumber = Number.isFinite(value[key]) ? clamp(value[key], 0, maximum) : 0;
    result[key] = integer ? Math.floor(valueNumber) : valueNumber;
  };
  for (const key of ['seconds', 'kills', 'elites']) bounded(key, 1e8, key !== 'seconds');
  bounded('cleanWaves', 72, true);
  bounded('heat', 100);
  bounded('fever', 6 + (result.upgrades.hype || 0));
  bounded('bestMultiplier', 6, true);
  result.bestMultiplier = Math.max(1, result.bestMultiplier);
  result.bestNotified = value.bestNotified === true;
  return result;
}
export const survivalXpCost = level => 18 + level * 6 + Math.floor(level * level * .9);
export function survivalMultiplier(state) {
  const s = state.survival;
  return s.fever > 0 ? 6 : 1 + Math.min(4, Math.floor(s.heat / 20));
}
/** Road speed is about 51m/s: a cooldown must be measured against time in range. */
export const SURVIVAL_WEAPON_SPECS = Object.freeze({
  heart: { levels: [
    { damage: 1, range: 135, interval: .58 },
    { damage: 1, range: 142, interval: .55 },
    { damage: 2, range: 145, interval: .54 },
    { damage: 2, range: 150, interval: .53 },
    { damage: 3, range: 150, interval: .53 },
    { damage: 3, range: 155, interval: .52 },
  ], evolution: { damage: 3, range: 180, interval: .42, pierce: 1, heightBands: 3 } },
  flash: { levels: [
    { damage: 1, range: 70, interval: 1.45, targets: 5 },
    { damage: 1, range: 78, interval: 1.35, targets: 6 },
    { damage: 2, range: 82, interval: 1.30, targets: 6 },
    { damage: 2, range: 88, interval: 1.25, targets: 7 },
    { damage: 3, range: 88, interval: 1.25, targets: 7 },
    { damage: 3, range: 94, interval: 1.15, targets: 8 },
  ], evolution: { damage: 4, range: 115, interval: .95, targets: 10, guardPierce: true } },
  vinyl: { levels: [
    { damage: 1, range: 46, behind: 28, interval: .90, targets: 2 },
    { damage: 1, range: 51, behind: 30, interval: .84, targets: 3 },
    { damage: 2, range: 54, behind: 32, interval: .80, targets: 3 },
    { damage: 2, range: 58, behind: 34, interval: .75, targets: 3 },
    { damage: 3, range: 58, behind: 34, interval: .75, targets: 3 },
    { damage: 3, range: 62, behind: 36, interval: .70, targets: 3 },
  ], evolution: { damage: 4, range: 76, behind: 44, interval: .60, targets: 4 } },
  bass: { levels: [
    { damage: 2, range: 60, behind: 35, interval: 1.25, targets: 8 },
    { damage: 2, range: 64, behind: 38, interval: 1.22, targets: 9 },
    { damage: 3, range: 68, behind: 40, interval: 1.20, targets: 10 },
    { damage: 3, range: 72, behind: 43, interval: 1.18, targets: 11 },
    { damage: 4, range: 72, behind: 43, interval: 1.18, targets: 11 },
    { damage: 4, range: 76, behind: 45, interval: 1.15, targets: 12 },
  ], evolution: { damage: 4, range: 90, behind: 65, interval: 1.10, targets: 16, guardPierce: true } },
  phone: { levels: [
    { damage: 1, range: 105, interval: 1.10, targets: 2, chainRange: 50 },
    { damage: 1, range: 110, interval: 1.05, targets: 2, chainRange: 52 },
    { damage: 2, range: 115, interval: 1.00, targets: 2, chainRange: 55 },
    { damage: 2, range: 120, interval: .95, targets: 3, chainRange: 58 },
    { damage: 3, range: 120, interval: .95, targets: 3, chainRange: 58 },
    { damage: 3, range: 125, interval: .90, targets: 3, chainRange: 60 },
  ], evolution: { damage: 3, range: 140, interval: .75, targets: 4, chainRange: 65 } },
  cd: { levels: [
    { damage: 2, range: 150, interval: .68 },
    { damage: 2, range: 160, interval: .64 },
    { damage: 3, range: 165, interval: .64 },
    { damage: 3, range: 175, interval: .62 },
    { damage: 4, range: 175, interval: .62 },
    { damage: 5, range: 180, interval: .60 },
  ], evolution: { damage: 6, range: 200, interval: .58, guardPierce: true } },
  cassette: { levels: [
    { damage: 1, range: 66, behind: 40, interval: 1.35, targets: 2, pulses: 2 },
    { damage: 1, range: 72, behind: 46, interval: 1.28, targets: 2, pulses: 2 },
    { damage: 2, range: 74, behind: 52, interval: 1.25, targets: 2, pulses: 2 },
    { damage: 2, range: 78, behind: 58, interval: 1.18, targets: 3, pulses: 2 },
    { damage: 2, range: 82, behind: 64, interval: 1.10, targets: 3, pulses: 2 },
    { damage: 2, range: 84, behind: 70, interval: 1.05, targets: 3, pulses: 2 },
  ], evolution: { damage: 3, range: 92, behind: 80, interval: 1, targets: 4, pulses: 3 } },
});
for (const spec of Object.values(SURVIVAL_WEAPON_SPECS)) {
  spec.levels.forEach(Object.freeze); Object.freeze(spec.levels); Object.freeze(spec.evolution); Object.freeze(spec);
}
export function survivalWeaponStats(state, id) {
  const spec = SURVIVAL_WEAPON_SPECS[id], level = state?.survival?.upgrades?.[id] || 0;
  if (!spec || !Number.isInteger(level) || level < 1 || level > spec.levels.length) return null;
  const recipe = SURVIVAL_EVOLUTIONS.find(item => item.weapon === id);
  const evolved = state.survival.evolutions.includes(recipe.id);
  const stats = { damage: 1, range: 0, behind: 0, interval: 1, targets: 1, pierce: 0, guardPierce: false, heightBands: 1, chainRange: 0, pulses: 1,
    ...spec.levels[level - 1], ...(evolved ? spec.evolution : {}), level, evolved };
  // The car's heart hardware remains a deliberate heart-build choice.
  if (id === 'heart') stats.interval *= Math.max(.45, Math.min(1.5, (state.shotInterval || .36) / .36));
  if (state.survival.fever > 0) stats.interval *= .8;
  return stats;
}
export const survivalEchoCooldown = level => [0, 3, 2.3, 1.6][Math.max(0, Math.min(3, level || 0))];
/** A repeat reserves one original target, never fans out or repeats another repeat. */
export function queueSurvivalEcho(state, target, damage, bypassGuard = false) {
  if (!isSurvival(state) || !state.survival.upgrades.md || state.survival.echoClock > 0 || state.survival.echoPending || target.hp <= 0 || target.id == null) return;
  state.survival.echoPending = { targetId: target.id, damage: damage * .5, bypassGuard, delay: .35 };
  state.survival.echoClock = survivalEchoCooldown(state.survival.upgrades.md);
}
export function survivalOffers(state) {
  if (!isSurvival(state)) return [];
  const s = state.survival;
  if (s.level >= SURVIVAL_MAX_LEVEL || s.xp < survivalXpCost(s.level)) return [];
  const pool = SURVIVAL_UPGRADES.filter(item => (s.upgrades[item.id] || 0) < item.maxLevel && (item.id !== 'relay' || s.upgrades.heart > 0))
    .sort((a,b) => hash(`${state.seed}:${s.level}:${a.id}`) - hash(`${state.seed}:${s.level}:${b.id}`));
  // Six-level builds need a dependable way to deepen equipped weapons and finish recipes.
  const weapon = pool.find(item => item.kind === 'weapon' && s.upgrades[item.id]) || pool.find(item => item.kind === 'weapon');
  const support = pool.find(item => item.kind === 'support' && SURVIVAL_EVOLUTIONS.some(recipe => recipe.support === item.id && s.upgrades[recipe.weapon] && (s.upgrades[item.id] || 0) < recipe.supportRequired)) || pool.find(item => item.kind === 'support');
  const picks = [weapon, support].filter(Boolean);
  for (const item of pool) if (picks.length < 3 && !picks.includes(item)) picks.push(item);
  return picks.map(item => {
    const level = (s.upgrades[item.id] || 0) + 1;
    const effects = { relay: `連鎖+${level} / ${40 + level * 16}m`,
      md: `リピート50% / 0.35秒 / 間隔${survivalEchoCooldown(level).toFixed(1)}秒`,
      battery: `招待で電池+${level} / XP回収${48 + level * 25}m`, glide: `浮力消費−${level * 12}% / 回避で電池+${level * 2}`,
      armor: `ダメージ−${level * 12}% / 今すぐ耐久+12`, hype: `HEAT+${9 + level * 3} / FEVER ${6 + level}秒` };
    const next = { ...s.upgrades, [item.id]: level };
    const recipes = SURVIVAL_EVOLUTIONS.filter(recipe => recipe.weapon === item.id || recipe.support === item.id)
      .sort((a, b) => Number(recipeReady(next, b) && !s.evolutions.includes(b.id)) - Number(recipeReady(next, a) && !s.evolutions.includes(a.id)) || (s.upgrades[b.weapon] || 0) - (s.upgrades[a.weapon] || 0));
    const evolution = recipes[0];
    const evolutionReady = Boolean(evolution && !s.evolutions.includes(evolution.id) && recipeReady(next, evolution));
    const preview = { ...state, survival: { ...s, upgrades: next, evolutions: SURVIVAL_EVOLUTIONS.filter(recipe => recipeReady(next, recipe)).map(recipe => recipe.id), fever: 0 } };
    const weaponStats = survivalWeaponStats(preview, item.id);
    const targets = weaponStats && (weaponStats.targets + weaponStats.pierce) * weaponStats.heightBands;
    const base = weaponStats && `基礎: 威力${weaponStats.damage} / 射程${weaponStats.range}m / ${weaponStats.interval.toFixed(2)}秒 / 最大${targets}体`;
    const synergy = weaponStats ? item.id === 'cassette' ? `${base} · ${weaponStats.pulses}回 / 追加50%` : base : effects[item.id];
    return { ...item, familyName: item.family, effect: `Lv.${level} / ${item.maxLevel}`, synergy, weaponStats,
      evolution: evolution ? { ...evolution, weaponLevel: s.upgrades[evolution.weapon] || 0, supportLevel: s.upgrades[evolution.support] || 0 } : null, evolutionReady };
  });
}
export function survivalView(state) {
  if (!isSurvival(state)) return null;
  const s = state.survival, cost = survivalXpCost(s.level);
  return { enabled: true, styleName: 'NIGHTFALL TOUR', rank: s.level + 1, xp: s.xp,
    nextXp: s.level >= SURVIVAL_MAX_LEVEL ? null : cost, progress: s.level >= SURVIVAL_MAX_LEVEL ? 1 : Math.min(1, s.xp / cost),
    perks: Object.entries(s.upgrades), offers: survivalOffers(state), synergy: [] };
}
export function openSurvivalDraft(state) {
  if (state.status !== 'playing' || !survivalOffers(state).length) return false;
  state.status = 'draft'; state.boosting = state.shooting = state.charging = false;
  if (state.rushing) state.rushCooldown = Math.max(state.rushCooldown, state.rushRecovery ?? 5);
  state.rushing = false; state.rushTime = 0; state._rushHeld = false;
  state.events.push({ type: 'rank-up', rank: state.survival.level + 2 });
  return true;
}
export function chooseSurvivalUpgrade(state, id) {
  if (state?.status !== 'draft' || !survivalOffers(state).some(item => item.id === id)) return false;
  const s = state.survival;
  s.xp -= survivalXpCost(s.level); s.level++;
  s.upgrades[id] = (s.upgrades[id] || 0) + 1;
  if (id === 'armor') state.integrity = Math.min(state.integrityCapacity, state.integrity + 12);
  state.events = [{ type: 'perk-chosen', id, rank: s.level + 1 }];
  for (const evolution of SURVIVAL_EVOLUTIONS) {
    if (recipeReady(s.upgrades, evolution) && !s.evolutions.includes(evolution.id)) {
      s.evolutions.push(evolution.id);
      state.events.push({ type: 'evolution', name: evolution.name });
    }
  }
  state.status = 'playing';
  return true;
}
export function applySurvivalModifiers(state) {
  if (!isSurvival(state)) return;
  const u = state.survival.upgrades, m = state.buildModifiers;
  m.heartPierce = Math.min(3, m.heartPierce + (survivalWeaponStats(state, 'heart')?.pierce || 0));
  m.heartChain = Math.min(4, m.heartChain + (u.relay || 0));
  if (u.relay) m.heartChainRange = Math.max(m.heartChainRange, 40 + u.relay * 16);
  m.conversionEnergy = Math.min(6, m.conversionEnergy + (u.battery || 0));
  m.thrustDrainMultiplier = Math.max(.4, m.thrustDrainMultiplier * (1 - (u.glide || 0) * .12));
  m.comboFlight = Math.min(8, m.comboFlight + (u.glide || 0) * 2);
}
export function recordSurvivalEvent(state, event) {
  if (!isSurvival(state)) return;
  const s = state.survival;
  const eventWave = clamp(Math.floor((event.distance ?? state.distance) / state.routeLength * 6), 0, 5);
  if (event.type === 'collision') { s.heat = 0; s.fever = 0; s.waveStats[eventWave].hits++; return; }
  if (!['convert', 'destroy', 'precision', 'little-find'].includes(event.type)) return;
  const receipt = `${state.routeIndex}:${event.type}:${event.entityId}`;
  if (event.entityId == null || s.receipts.includes(receipt)) return;
  s.receipts.push(receipt);
  if (s.receipts.length > 2048) s.receipts.shift();
  if (event.type === 'convert' || event.type === 'destroy') {
    const multiplier = survivalMultiplier(state);
    const base = event.type === 'convert' ? event.reward * 2 : 25;
    state.score += Math.round(base * (multiplier - 1));
    event.survivalPoints = Math.round(base * multiplier);
    s.bestMultiplier = Math.max(s.bestMultiplier, multiplier);
    if (event.type === 'convert' && !event.headliner) s.kills++;
    s.waveStats[eventWave].kills++;
    if (event.elite || event.headliner) { s.elites++; state.score += 600 * multiplier; state.events.push({ type: 'survival-elite', points: 600 * multiplier, distance: event.distance }); }
    if (s.fever <= 0) {
      s.heat = Math.min(100, s.heat + 9 + (s.upgrades.hype || 0) * 3);
      if (s.heat >= 100) { s.fever = 6 + (s.upgrades.hype || 0); state.events.push({ type: 'fever-start' }); }
    }
    s.sinceHit = 0;
  }
  if (event.type === 'little-find') state.integrity = Math.min(state.integrityCapacity, state.integrity + 5);
  s.gems.push({ distance: event.distance ?? state.distance, xp: event.elite || event.headliner ? 24 : event.type === 'convert' ? 8 : 5 });
  if (s.gems.length > 96) { const overflow = s.gems.shift(); s.xp += overflow.xp; }
}
export function survivalStep(state, dt, strike) {
  if (!isSurvival(state)) return;
  const s = state.survival, u = s.upgrades;
  s.seconds += dt; s.sinceHit += dt;
  if (s.fever > 0) { s.fever = Math.max(0, s.fever - dt); if (!s.fever) s.heat = 20; }
  else if (s.sinceHit > 3 && !state.atStation) s.heat = Math.max(0, s.heat - dt * 5);
  const wave = Math.min(5, Math.floor(state.distance / state.routeLength * 6));
  if (wave > s.wave) {
    s.wave = wave;
    state.events.push({ type: 'survival-wave', wave: state.routeIndex * 6 + wave + 1 });
  }
  // Settle after the collision envelope has passed, including targets hit from afar.
  for (let index = 0; index < 6; index++) if (state.distance >= (index + 1) * state.routeLength / 6 + 48) finishSurvivalWave(state, index);
  const range = s.fever > 0 ? 500 : 48 + (u.battery || 0) * 25;
  for (const gem of s.gems) if (gem.distance <= state.distance + range) { s.xp += gem.xp; gem.collected = true; }
  s.gems = s.gems.filter(gem => !gem.collected);
  s.echoClock = Math.max(0, s.echoClock - dt);
  if (s.echoPending) {
    s.echoPending.delay -= dt;
    if (s.echoPending.delay <= 0) {
      const pending = s.echoPending; s.echoPending = null;
      const target = state.entities.find(actor => actor.id === pending.targetId && !actor.resolved && !actor.converted && !actor.cleared);
      if (target) {
        strike(target, pending.damage, false, pending.bypassGuard, 'echo');
        state.events.push({ type: 'survival-attack', kind: 'echo', radius: 0, distance: target.distance, targetDistances: [target.distance], repeat: true });
      }
    }
  }
  const fireArea = (kind, stats, origin = state.distance, tapeRepeat = false) => {
    const candidates = state.entities.filter(e => ['salaryman', 'cone', 'barrier'].includes(e.type) && !e.resolved && !e.converted && !e.cleared && e.distance >= origin - stats.behind && e.distance <= origin + stats.range)
      .sort((a, b) => Math.abs(a.distance - origin) - Math.abs(b.distance - origin) || a.id - b.id);
    let targets = candidates.slice(0, stats.targets);
    if (kind === 'cd') {
      // Precision discs take the toughest open target, leaving small crowds to other gear.
      targets = candidates.filter(actor => stats.guardPierce || !actor.shielded)
        .sort((a, b) => (b.hp ?? 1) - (a.hp ?? 1) || a.distance - b.distance || a.id - b.id).slice(0, stats.targets);
    }
    if (kind === 'phone') {
      // Calls start at the nearest open recipient, then link only nearby recipients.
      const open = candidates.filter(actor => !actor.shielded);
      targets = open.length ? [open[0]] : [];
      while (targets.length && targets.length < stats.targets) {
        const previous = targets[targets.length - 1];
        const next = open.find(actor => !targets.includes(actor) && Math.abs(actor.distance - previous.distance) <= stats.chainRange);
        if (!next) break;
        targets.push(next);
      }
    }
    if (!targets.length) return false;
    for (const target of targets) strike(target, stats.damage, false, stats.guardPierce, tapeRepeat ? 'tape' : kind);
    state.events.push({ type: 'survival-attack', kind, radius: stats.range, behind: stats.behind, distance: origin, tapeRepeat, targetDistances: targets.filter(target => target.hp !== undefined).map(target => target.distance) });
    return true;
  };
  // Tape stays on its original stretch of road; later sweeps do not chase the car.
  for (const loop of s.cassetteLoops) {
    loop.delay -= dt;
    if (loop.delay <= 0) fireArea('cassette', loop.stats, loop.distance, true);
  }
  s.cassetteLoops = s.cassetteLoops.filter(loop => loop.delay > 0);
  for (const { id: kind } of AREA_WEAPONS) {
    const clock = `${kind}Clock`, stats = survivalWeaponStats(state, kind);
    s[clock] = Math.max(0, (s[clock] || 0) - dt);
    if (stats && !s[clock] && fireArea(kind, stats)) {
      s[clock] = stats.interval;
      if (kind === 'cassette') for (let pulse = 1; pulse < stats.pulses; pulse++)
        s.cassetteLoops.push({ delay: .28 * pulse, distance: state.distance, stats: { ...stats, damage: stats.damage * .5 } });
    }
  }
}
export function finishSurvivalWave(state, wave = state.survival?.wave) {
  if (!isSurvival(state)) return;
  const s = state.survival;
  if (s.settledWaves.includes(wave)) return;
  s.settledWaves.push(wave);
  const tally = s.waveStats[wave];
  if (tally?.kills > 0 && tally.hits === 0) {
    const points = 150 + (state.routeIndex * 6 + wave) * 15;
    s.cleanWaves++; state.score += points;
    state.events.push({ type: 'clean-wave', points });
  }
}
/** Pack followers only into already reserved, readable stretches of road.
 * Never occupy EV windows, breather sections, or another obstacle's envelope. */
export function survivalEncounterPlan(plan, state, stationRadius) {
  const stage = state.routeIndex;
  // Keep the authored jump checks, moving tells and named sound-system encounters.
  const anchors = plan.filter(actor => actor.type !== 'salaryman' || actor.headliner || actor.elite || actor.behavior !== 'steady');
  const result = anchors.map(actor => ({ ...actor, hp: actor.headliner || actor.elite ? 6 + stage : actor.hp,
    maxHp: actor.headliner || actor.elite ? 6 + stage : actor.maxHp }));
  const prototype = plan.find(actor => actor.type === 'salaryman');
  if (!prototype) return result;
  const end = state.routeLength - ENCOUNTER_RULES.arrivalClearance;
  const safe = distance => distance < end &&
    !(distance / state.routeLength > .65 && distance / state.routeLength < .73) &&
    !state._stations.some(ev => Math.abs(ev - distance) < stationRadius + ENCOUNTER_RULES.stationBuffer + 38) &&
    !anchors.some(actor => Math.abs(actor.distance - distance) < (actor.type === 'salaryman' ? 100 : 150) + (actor.motionAmplitude || 0));
  let pack = 0;
  for (let cursor = 160; cursor < end;) {
    if (!safe(cursor)) { cursor += 14; continue; }
    const wave = Math.min(5, Math.floor(cursor / state.routeLength * 6));
    const count = Math.min(8, 3 + Math.floor(stage / 2) + (wave >= 2 ? 1 : 0));
    const origin = cursor, encounterId = `survival-${stage}-${pack++}`;
    for (let i = 0; i < count && safe(cursor); i++, cursor += 26) {
      result.push(decorateEncounter({ ...prototype, type: 'salaryman', behavior: 'steady',
        elite: false, headliner: null, routineHazard: undefined, streetRole: undefined,
        hp: 1 + Math.floor(stage / 4), maxHp: 1 + Math.floor(stage / 4),
        motionAmplitude: 0, shielded: false, vulnerable: true, converted: false,
        distance: cursor, motionBaseDistance: cursor, telegraphBaseDistance: origin,
        encounterId, encounterIndex: pack, phraseIndex: i, phraseSize: count,
        cluster: true, clusterSize: count, clusterGrace: 1.7, tutorial: false,
        beat: 'survival-pack', routePhase: wave >= 4 ? 'climax' : 'pressure',
      }, Math.max(stage, 2), state.seed));
    }
    cursor += 90;
  }
  return result.sort((a,b) => a.distance - b.distance);
}

export function survivalResult(state) {
  if (!isSurvival(state) || !(state.status === 'lost' || state.campaignComplete)) return null;
  return { id: state.runId, version: SURVIVAL_VERSION, recordEligible: state.survival.recordEligible !== false, day: state.survival.day, seed: state.seed,
    score: Math.floor(state.score), seconds: Math.round(state.survival.seconds), road: state.routeIndex + 1,
    waves: state.routeIndex * 6 + state.survival.wave + (state.campaignComplete ? 1 : 0),
    cleanWaves: state.survival.cleanWaves, kills: state.survival.kills, won: state.campaignComplete === true,
    build: { ...state.survival.upgrades }, evolutions: [...state.survival.evolutions] };
}
export function normalizeSurvivalRecords(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(row => {
    if (!row || row.version !== SURVIVAL_VERSION || row.recordEligible === false || typeof row.id !== 'string' || row.id.length > 160 || seen.has(row.id) || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !Number.isInteger(row.seed) || row.seed < 0 || row.seed > 0xffffffff) return false;
    for (const key of ['score', 'seconds', 'road', 'waves', 'cleanWaves', 'kills']) if (!Number.isFinite(row[key]) || row[key] < 0 || row[key] > 1e8) return false;
    seen.add(row.id); return true;
  }).map(row => ({ id: row.id, version: SURVIVAL_VERSION, day: row.day, seed: row.seed,
    score: Math.floor(row.score), seconds: Math.floor(row.seconds), road: clamp(Math.floor(row.road), 1, 12),
    waves: clamp(Math.floor(row.waves), 0, 72), cleanWaves: clamp(Math.floor(row.cleanWaves), 0, 72), kills: Math.floor(row.kills), won: row.won === true,
    build: Object.fromEntries(SURVIVAL_UPGRADES.map(item => [item.id, clamp(Math.floor(Number(row.build?.[item.id]) || 0), 0, item.maxLevel)])),
    evolutions: SURVIVAL_EVOLUTIONS.map(item => item.id).filter(id => Array.isArray(row.evolutions) && row.evolutions.includes(id)) }))
    .sort((a,b) => b.day.localeCompare(a.day) || b.score - a.score || a.seconds - b.seconds)
    .filter((row, index, rows) => rows.slice(0, index).filter(other => other.day === row.day).length < 5).slice(0, 90);
}
export function createSurvivalRecords(storage) {
  const read = () => { try { return normalizeSurvivalRecords(storage?.getItem(SURVIVAL_RECORD_KEY)); } catch { return []; } };
  return { read, best: day => read().find(row => row.day === day) || null,
    save(state) {
      const result = survivalResult(state), old = read();
      if (!result) return { persisted: false, best: false, records: old };
      if (!result.recordEligible) return { persisted: false, best: false, eligible: false, records: old };
      const best = !old.some(row => row.day === result.day && row.score >= result.score);
      const records = normalizeSurvivalRecords([result, ...old.filter(row => row.id !== result.id)]);
      try { if (!storage) throw new Error('Storage unavailable'); storage.setItem(SURVIVAL_RECORD_KEY, JSON.stringify(records)); return { persisted: true, best, eligible: true, records }; }
      catch { return { persisted: false, best, eligible: true, records }; }
    } };
}
