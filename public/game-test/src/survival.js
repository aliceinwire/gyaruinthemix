/** One-life, seeded score attack. All power belongs to this run, never the garage. */
import { ENCOUNTER_RULES } from './encounter-director.js';
import { decorateEncounter } from './street-culture.js';

export const SURVIVAL_VERSION = 2;
export const SURVIVAL_RECORD_KEY = 'gyaruinthemix-survival-records-v2';
export const SURVIVAL_UPGRADES = Object.freeze([
  { id: 'heart', kind: 'weapon', name: 'ハート連射', family: 'HEART', description: '自動ハートが速くなる。Lv.3とリレーLv.2で3方向のハートストームに進化。' },
  { id: 'relay', name: 'ファンリレー', family: 'HEART', description: 'ハートが近くの相手へ連鎖。レベルごとに届く人数と距離が増える。' },
  { id: 'flash', kind: 'weapon', name: 'フォトフラッシュ', family: 'CAMERA', description: 'カメラが前方をまとめてフラッシュ。Lv.3と電池Lv.2でガードも貫くフラッシュモブに進化。' },
  { id: 'vinyl', kind: 'weapon', name: 'レコードオービット', family: 'VINYL', description: '回るレコードが近くの相手へ自動攻撃。Lv.3と浮力Lv.2でアンコールオービットに進化。' },
  { id: 'bass', kind: 'weapon', name: 'ベースウェーブ', family: 'BASS', description: '近くへ重低音の波を自動で放つ。Lv.3と熱狂Lv.2で、ガードを抜くアフターパーティーに進化。' },
  { id: 'battery', name: 'ときめき電池', family: 'SUPPORT', description: '招待するたびに電池を回復。XPを引き寄せる範囲もレベルごとに広がる。' },
  { id: 'glide', name: 'フェザー浮力', family: 'SUPPORT', description: 'レベルごとに浮力の電池消費を12%減らす。ジャンプ成功でも電池を回復。' },
  { id: 'armor', name: 'ネオンアーマー', family: 'SUPPORT', description: '今すぐ耐久+12。レベルごとに受けるダメージを12%減らす。' },
  { id: 'hype', name: 'フロア熱狂', family: 'SUPPORT', description: 'HEATがたまりやすくなり、FEVERが1秒長くなる。連続招待でスコアを伸ばそ。' },
].map(item => Object.freeze({ kind: 'support', icon: item.id, ...item })));
export const SURVIVAL_WEAPONS = Object.freeze(SURVIVAL_UPGRADES.filter(item => item.kind === 'weapon'));
export const SURVIVAL_MAX_LEVEL = SURVIVAL_UPGRADES.length * 3 - 1;
export const SURVIVAL_EVOLUTIONS = Object.freeze([
  { id: 'heartstorm', name: 'ハートストーム', weapon: 'heart', support: 'relay' },
  { id: 'flashmob', name: 'フラッシュモブ', weapon: 'flash', support: 'battery' },
  { id: 'encore', name: 'アンコールオービット', weapon: 'vinyl', support: 'glide' },
  { id: 'afterparty', name: 'アフターパーティー', weapon: 'bass', support: 'hype' },
].map(Object.freeze));
const hash = value => { let n = 2166136261; for (const char of String(value)) n = Math.imul(n ^ char.charCodeAt(0), 16777619) >>> 0; return n; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const isSurvival = state => state?.mode === 'survival' && state?.survival?.version === SURVIVAL_VERSION;
export function dailySurvival(date = new Date()) {
  // Japan midnight changes the course; an in-progress run keeps its original seed.
  const day = new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  return { day, seed: hash(`night-survival:${SURVIVAL_VERSION}:${day}`) };
}
export function createSurvival(day = '', startingWeapon = 'heart') {
  const weapon = SURVIVAL_WEAPONS.some(item => item.id === startingWeapon) ? startingWeapon : 'heart';
  return { version: SURVIVAL_VERSION, day, startingWeapon: weapon, xp: 0, level: 0, upgrades: { [weapon]: 1 }, evolutions: [],
    quizRoads: [], heat: 0, fever: 0, sinceHit: 0, seconds: 0, wave: 0, waveStats: Array.from({ length: 6 }, () => ({ kills: 0, hits: 0 })), settledWaves: [],
    cleanWaves: 0, kills: 0, elites: 0, bestMultiplier: 1, gems: [], receipts: [],
    flashClock: 0, vinylClock: 0, bassClock: 0, bestNotified: false };
}
/** Only durable run progress crosses the between-road save boundary. */
export function normalizeSurvivalSave(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== SURVIVAL_VERSION ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !SURVIVAL_WEAPONS.some(item => item.id === value.startingWeapon) ||
      !value.upgrades || typeof value.upgrades !== 'object' || Array.isArray(value.upgrades)) return null;
  const date = new Date(`${value.day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.day) return null;
  const result = createSurvival(value.day, value.startingWeapon);
  result.upgrades = {};
  for (const item of SURVIVAL_UPGRADES) {
    const level = value.upgrades[item.id] ?? 0;
    if (!Number.isInteger(level) || level < 0 || level > 3) return null;
    if (level) result.upgrades[item.id] = level;
  }
  if (!result.upgrades[value.startingWeapon]) return null;
  result.level = Object.values(result.upgrades).reduce((sum, level) => sum + level, 0) - 1;
  if (value.level !== result.level || !Number.isFinite(value.xp) || value.xp < 0) return null;
  result.xp = Math.min(1e8, value.xp);
  if (value.quizRoads !== undefined && (!Array.isArray(value.quizRoads) || value.quizRoads.some(road => !Number.isInteger(road) || road < 1 || road > 11 || road % 2 !== 1))) return null;
  result.quizRoads = [...new Set(value.quizRoads || [])].sort((a, b) => a - b);
  result.evolutions = SURVIVAL_EVOLUTIONS.filter(recipe => result.upgrades[recipe.weapon] >= 3 && result.upgrades[recipe.support] >= 2).map(recipe => recipe.id);
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
export const survivalXpCost = level => 18 + level * 6 + Math.floor(level * level * 1.4);
export function survivalMultiplier(state) {
  const s = state.survival;
  return s.fever > 0 ? 6 : 1 + Math.min(4, Math.floor(s.heat / 20));
}
export function survivalOffers(state) {
  if (!isSurvival(state)) return [];
  const s = state.survival;
  if (s.level >= SURVIVAL_MAX_LEVEL || s.xp < survivalXpCost(s.level)) return [];
  const pool = SURVIVAL_UPGRADES.filter(item => (s.upgrades[item.id] || 0) < 3)
    .sort((a,b) => hash(`${state.seed}:${s.level}:${a.id}`) - hash(`${state.seed}:${s.level}:${b.id}`));
  // Always expose an offensive choice and a support while both remain available.
  const picks = [pool.find(item => item.kind === 'weapon'), pool.find(item => item.kind === 'support')].filter(Boolean);
  for (const item of pool) if (picks.length < 3 && !picks.includes(item)) picks.push(item);
  return picks.map(item => {
    const level = (s.upgrades[item.id] || 0) + 1;
    const effects = { heart: `AUTO ×${(1 / (1 - level * .16)).toFixed(2)}`, relay: `CHAIN ${level} / ${40 + level * 16}m`,
      flash: `${level} DMG / ${50 + level * 15}m / ${(4 - level * .35).toFixed(2)}s`,
      vinyl: `${level} DMG / ${35 + level * 8}m / ${(2.4 - level * .25).toFixed(2)}s`,
      bass: `${level + 1} DMG / ${38 + level * 10}m / ${(3.5 - level * .3).toFixed(2)}s`,
      battery: `+${level} EV / XP ${48 + level * 25}m`, glide: `EV −${level * 12}% / JUMP +${level * 2} EV`,
      armor: `DMG −${level * 12}% / +12 HP`, hype: `HEAT +${9 + level * 3} / FEVER ${6 + level}s` };
    const evolution = SURVIVAL_EVOLUTIONS.find(recipe => recipe.weapon === item.id || recipe.support === item.id);
    const next = { ...s.upgrades, [item.id]: level };
    const evolutionReady = Boolean(evolution && !s.evolutions.includes(evolution.id) && next[evolution.weapon] >= 3 && next[evolution.support] >= 2);
    return { ...item, familyName: item.family, effect: `Lv.${level} / 3`, synergy: effects[item.id],
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
    if (s.upgrades[evolution.weapon] >= 3 && s.upgrades[evolution.support] >= 2 && !s.evolutions.includes(evolution.id)) {
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
  m.heartPierce = Math.max(m.heartPierce, state.survival.evolutions.includes('heartstorm') ? 3 : 1);
  m.heartChain = Math.max(m.heartChain, u.relay || 0);
  m.heartChainRange = Math.max(m.heartChainRange, 40 + (u.relay || 0) * 16);
  m.conversionEnergy += u.battery || 0;
  m.thrustDrainMultiplier *= 1 - (u.glide || 0) * .12;
  m.comboFlight += (u.glide || 0) * 2;
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
  const fireArea = (kind, radius, damage, pierce, limit = 16, behind = 12) => {
    const targets = state.entities.filter(e => ['salaryman', 'cone', 'barrier'].includes(e.type) && !e.resolved && !e.converted && !e.cleared && e.distance >= state.distance - behind && e.distance <= state.distance + radius).slice(0, limit);
    if (!targets.length) return false;
    for (const target of targets) strike(target, damage, false, pierce);
    state.events.push({ type: 'survival-attack', kind, radius, distance: state.distance });
    return true;
  };
  s.bassClock = Math.max(0, s.bassClock - dt);
  s.flashClock = Math.max(0, s.flashClock - dt);
  s.vinylClock = Math.max(0, s.vinylClock - dt);
  const afterparty = s.evolutions.includes('afterparty');
  if (u.bass && !s.bassClock && fireArea('bass', afterparty ? 110 : 38 + u.bass * 10, afterparty ? 5 : u.bass + 1, afterparty, 24, afterparty ? 80 : 35)) s.bassClock = afterparty ? 1.8 : 3.5 - u.bass * .3;
  const flashmob = s.evolutions.includes('flashmob'), encore = s.evolutions.includes('encore');
  if (u.flash && !s.flashClock && fireArea('flash', flashmob ? 125 : 50 + u.flash * 15, flashmob ? 4 : u.flash, flashmob)) s.flashClock = flashmob ? 2.6 : 4 - u.flash * .35;
  if (u.vinyl && !s.vinylClock && fireArea('vinyl', encore ? 85 : 35 + u.vinyl * 8, encore ? 4 : u.vinyl, false, encore ? 4 : 2)) s.vinylClock = encore ? 1.2 : 2.4 - u.vinyl * .25;
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
  return { id: state.runId, version: SURVIVAL_VERSION, day: state.survival.day, seed: state.seed,
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
    if (!row || row.version !== SURVIVAL_VERSION || typeof row.id !== 'string' || row.id.length > 160 || seen.has(row.id) || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !Number.isInteger(row.seed) || row.seed < 0 || row.seed > 0xffffffff) return false;
    for (const key of ['score', 'seconds', 'road', 'waves', 'cleanWaves', 'kills']) if (!Number.isFinite(row[key]) || row[key] < 0 || row[key] > 1e8) return false;
    seen.add(row.id); return true;
  }).map(row => ({ id: row.id, version: SURVIVAL_VERSION, day: row.day, seed: row.seed,
    score: Math.floor(row.score), seconds: Math.floor(row.seconds), road: clamp(Math.floor(row.road), 1, 12),
    waves: clamp(Math.floor(row.waves), 0, 72), cleanWaves: clamp(Math.floor(row.cleanWaves), 0, 72), kills: Math.floor(row.kills), won: row.won === true,
    build: Object.fromEntries(SURVIVAL_UPGRADES.map(item => [item.id, clamp(Math.floor(Number(row.build?.[item.id]) || 0), 0, 3)])),
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
      const best = !old.some(row => row.day === result.day && row.score >= result.score);
      const records = normalizeSurvivalRecords([result, ...old.filter(row => row.id !== result.id)]);
      try { if (!storage) throw new Error('Storage unavailable'); storage.setItem(SURVIVAL_RECORD_KEY, JSON.stringify(records)); return { persisted: true, best, records }; }
      catch { return { persisted: false, best, records }; }
    } };
}
