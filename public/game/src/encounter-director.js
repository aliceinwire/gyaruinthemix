import { DRIVING_PACE } from './pace.js';
import { decorateEncounter } from './street-culture.js';

/** Seeded, DOM-free encounter pacing. Distances are metres; speed inputs are km/h.
 * The plan owns only road threats. Charging stations, rewards and collisions stay
 * in the simulation. Every moving actor reserves its entire motion envelope.
 */
export const ENCOUNTER_RULES = Object.freeze({
  minimumCounterTime: 1.25,
  maximumSupportedSpeed: 180 * DRIVING_PACE.speedMultiplier,
  warningViewDistance: 210 * DRIVING_PACE.speedMultiplier,
  stationBuffer: 8,
  arrivalClearance: 96 * DRIVING_PACE.speedMultiplier,
  maximumMotion: 18,
});

/** Named, fictional sound-system challenges. They are optional skill checks: the
 * safe aerial route remains available and clearing one never gates arrival. */
export const SIGNAL_HEADLINERS = Object.freeze([
  { id: 'nakano-relay', cityId: 'nakano', name: '中野リレー', title: '止まった街角スピーカー', lesson: 'うちらの音で信号を送ろ', color: '#ff91cd' },
  { id: 'shinjuku-filter', cityId: 'shinjuku', name: '新宿フィルター', title: 'ネオンのノイズゲート', lesson: 'ゲートが開いたら届くで', color: '#c0a4ff' },
  { id: 'shibuya-feedback', cityId: 'shibuya', name: '渋谷フィードバック', title: 'スクランブルの音詰まり', lesson: '開くタイミングをつなご', color: '#ff87ad' },
  { id: 'asakusa-echo', cityId: 'asakusa', name: '浅草エコー', title: '提灯通りのエコーボックス', lesson: '音を重ねて響きを戻そ', color: '#ffcc8d' },
  { id: 'osaka-resonance', cityId: 'osaka', name: '大阪レゾナンス', title: '道頓堀の共鳴タワー', lesson: '開いたら一気に届けよ', color: '#ffb673' },
  { id: 'kyoto-nightfall', cityId: 'kyoto', name: '京都ナイトフォール', title: '最後のミックスゲート', lesson: '最後の信号、ふたりでつなご', color: '#d4b5ff' },
].map(Object.freeze));

const TYPES = Object.freeze(['salaryman', 'cone', 'barrier', 'pothole']);
const RADII = Object.freeze({ salaryman: 15, cone: 21, barrier: 27, pothole: 21 });
const MAX_METRES_PER_SECOND = ENCOUNTER_RULES.maximumSupportedSpeed / 3.6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const round = value => Math.round(value * 1000) / 1000;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0 || 1;
  let value = 2166136261;
  for (const char of String(seed ?? 175).slice(0, 1024)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0 || 1;
}
function makeRandom(seed) {
  let value = seed >>> 0 || 1;
  // Avalanche nearby tour seeds before the first draw.
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value = (value ^ (value >>> 15)) >>> 0 || 1;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
function phaseAt(progress, stage) {
  if (progress < (stage === 0 ? .26 : .16)) return 'opening';
  if (progress < .43) return 'groove';
  if (progress < .65) return 'pressure';
  if (progress < .73) return 'breather';
  if (progress < .92) return stage === 11 ? 'finale' : 'climax';
  return 'arrival';
}
const PHASE_LABELS = Object.freeze({ opening: '助走', groove: 'グルーヴ', pressure: '盛り上げ', breather: 'ひと息', climax: 'ラストスパート', finale: 'ファイナルミックス', recharge: '充電タイム', arrival: 'クラブへ' });

function actorDefinition(type, behavior = 'steady', elite = false) {
  return { type, behavior, elite };
}
function grammar(stage, kind, phase, random) {
  const heart = () => actorDefinition('salaryman');
  const sway = () => actorDefinition('salaryman', 'sway');
  const shield = () => actorDefinition('salaryman', 'shield');
  const charger = () => actorDefinition('salaryman', 'charger');
  const obstacle = () => actorDefinition(random() < .52 ? 'cone' : 'barrier');
  const jump = () => actorDefinition('pothole');
  const choices = [
    { name: 'heart-line', actors: [heart()] },
    { name: 'road-read', actors: [random() < .55 ? jump() : obstacle()] },
  ];
  if (kind === 'event') choices.push({ name: 'heart-line', actors: [heart()] });
  if (stage >= 1) choices.push({ name: 'heart-duet', actors: [heart(), heart()] });
  if (stage >= 2) choices.push({ name: 'sway-read', actors: [sway()] });
  if (stage >= 3) choices.push({ name: 'guard-break', actors: [shield()] });
  if (stage >= 4) choices.push({ name: 'charge-read', actors: [charger()] });
  if (stage >= 5) choices.push({ name: 'lift-and-heart', actors: [jump(), heart()] });
  if (stage >= 6) choices.push({ name: 'guard-and-sway', actors: [shield(), sway()] });
  if (stage >= 7) choices.push({ name: 'charge-and-answer', actors: [charger(), heart()] });
  if (stage >= 8) choices.push({ name: 'heart-trio', actors: [heart(), sway(), heart()] });
  if (stage >= 9) choices.push({ name: 'guard-and-charge', actors: [shield(), charger()] });
  // Authored calls and answers teach combinations before the climax. These use
  // the same reserved movement envelopes as solos, never surprise spawns.
  if (stage >= 2) choices.push({ name: 'call-and-response', actors: [heart(), sway()] });
  if (stage >= 4 && kind !== 'ev') choices.push({ name: 'lift-refrain', actors: [heart(), jump(), heart()] });
  if (stage >= 5) choices.push({ name: 'gate-response', actors: [shield(), heart(), obstacle()] });
  if (stage >= 7 && phase === 'pressure') choices.push({ name: 'syncopated-lift', actors: [sway(), jump(), charger()] });
  if (stage >= 8 && ['climax', 'finale'].includes(phase)) choices.push({ name: 'last-call', actors: [charger(), heart(), shield()] });
  if (stage >= 2 && phase === 'pressure') choices.push({ name: 'notification-burst', actors: [heart(), sway(), heart()] });
  if (stage >= 3 && kind !== 'ev') choices.push({ name: 'inspection-pair', actors: [shield(), sway()] });
  if (stage >= 4 && ['groove', 'pressure'].includes(phase)) choices.push({ name: 'overtime-release', actors: [charger(), obstacle()] });
  if (phase === 'breather') return { name: 'breathing-space', actors: [heart()] };
  if (stage >= 2 && kind === 'event' && random() < .42) {
    const member = stage >= 6 && random() < .6 ? sway : heart;
    return { name: 'crowd-group', actors: [member(), member()], cluster: true };
  }
  return choices[Math.floor(random() * choices.length)];
}

function descriptor(definition, stage, random, lowCeiling) {
  let { type, behavior = 'steady', elite = false } = definition;
  if (lowCeiling && type === 'pothole') type = 'cone';
  const motionAmplitude = behavior === 'sway' ? 6 + Math.floor(random() * 5) : behavior === 'charger' ? 18 : 0;
  const hp = type === 'salaryman' ? elite ? (stage === 11 ? 4 : 3) : behavior === 'shield' ? 2 : 1 : type === 'barrier' ? 2 : 1;
  const anticipation = behavior === 'charger' ? 1.45 : behavior === 'shield' ? 1.25 : 1.25;
  const counterWindow = behavior === 'shield' ? 1.75 : ENCOUNTER_RULES.minimumCounterTime;
  const radius = RADII[type];
  const leadDistance = Math.min(ENCOUNTER_RULES.warningViewDistance, Math.max(94, MAX_METRES_PER_SECOND * (anticipation + counterWindow) + radius + motionAmplitude));
  const counter = type === 'pothole' ? 'hover' : behavior === 'shield' ? 'open-or-hover' : behavior === 'charger' ? 'shoot-or-hover' : type === 'salaryman' ? 'heart-or-hover' : 'shoot-or-hover';
  const label = type === 'pothole' ? '浮いてかわそう' : behavior === 'shield' ? 'ゲートが開いたら届くで' : behavior === 'charger' ? '突進の合図。攻撃か浮上' : behavior === 'sway' ? '揺れる相手。間合いを見よ' : type === 'salaryman' ? 'うちらのフロアへ誘お' : '攻撃か浮上でクリア';
  return {
    type, behavior, hp, maxHp: hp, elite, variant: Math.floor(random() * 4),
    directorManaged: true, converted: false, collisionRadius: radius,
    motionAmplitude, motionRate: round(.9 + random() * .55), motionPhase: round(random() * Math.PI * 2),
    counter, requiresHover: type === 'pothole',
    telegraph: Object.freeze({ label, counter, anticipation, leadTime: round(leadDistance / MAX_METRES_PER_SECOND), leadDistance: round(leadDistance), counterWindow }),
    anticipation, counterWindow, warningDistance: round(leadDistance),
    shielded: behavior === 'shield', vulnerable: behavior !== 'shield',
  };
}
function synchronizeCluster(actors, cluster) {
  if (!cluster || actors.length < 2) return;
  const leader = actors[0];
  for (const actor of actors.slice(1)) {
    actor.motionAmplitude = leader.motionAmplitude;
    actor.motionRate = leader.motionRate;
    actor.motionPhase = leader.motionPhase;
    actor.warningDistance = leader.warningDistance;
    actor.telegraph = leader.telegraph;
  }
}
function envelope(actor) { return actor.collisionRadius + actor.motionAmplitude; }
function separation(previous, next) { return envelope(previous) + envelope(next) + MAX_METRES_PER_SECOND * ENCOUNTER_RULES.minimumCounterTime; }
function stationClearance(actor, radius) { return radius + envelope(actor) + ENCOUNTER_RULES.stationBuffer; }
function safeAt(distance, actor, stations, radius) {
  return stations.every(station => Math.abs(station - distance) + 1e-8 >= stationClearance(actor, radius));
}
function nextSafe(distance, actor, stations, radius) {
  let next = distance;
  for (const station of stations) {
    const clearance = stationClearance(actor, radius);
    if (Math.abs(station - next) < clearance) next = station + clearance;
  }
  return next;
}
function placePattern(actors, requested, end, stations, radius, cluster = false, maxAdvance = 112 * DRIVING_PACE.speedMultiplier) {
  const offsets = [0];
  for (let i = 1; i < actors.length; i++) offsets.push(offsets[i - 1] + (cluster ? 28 : separation(actors[i - 1], actors[i]) + 8));
  let start = requested;
  // A conflicting station moves the entire phrase, never just one member.
  for (let attempt = 0; attempt < stations.length * actors.length + 2; attempt++) {
    let changed = false;
    for (let i = 0; i < actors.length; i++) {
      const position = start + offsets[i];
      const legal = nextSafe(position, actors[i], stations, radius);
      if (legal > position + 1e-8) { start += legal - position; changed = true; break; }
    }
    if (start + offsets.at(-1) > end || start - requested > maxAdvance) return null;
    if (!changed) return offsets.map(offset => start + offset);
  }
  return null;
}

function nearestLegalPosition(preferred, lower, upper, actor, stations, radius) {
  if (lower > upper) return null;
  const clearance = stationClearance(actor, radius);
  const candidates = [clamp(preferred, lower, upper), lower, upper];
  for (const station of stations) candidates.push(station - clearance, station + clearance);
  const legal = candidates.filter(distance => distance >= lower - 1e-8 && distance <= upper + 1e-8 && safeAt(distance, actor, stations, radius));
  legal.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
  return legal[0] ?? null;
}

/** Preserve explicit jump checks in later roads: permanent firing must not solve
 * every encounter. Swap legal slots rather than stacking threats onto the plan.
 */
function ensureLiftChecks(plan, { stage, kind, length, end, stations, radius, random, lowCeiling }) {
  const quota = lowCeiling ? 0 : stage >= 6 && kind !== 'ev' ? 3 : stage >= 4 ? 2 : 0;
  for (let pass = 0; pass < quota; pass++) {
    const existing = plan.filter(actor => actor.type === 'pothole');
    if (existing.length >= quota) break;
    const targets = quota === 3 ? [.23, .48, .73] : [.35, .7];
    const preferred = targets.map(fraction => fraction * length).sort((a, b) => {
      const nearest = value => existing.length ? Math.min(...existing.map(actor => Math.abs(actor.distance - value))) : length - Math.abs(value - length * .5);
      return nearest(b) - nearest(a);
    })[0];
    const hole = descriptor(actorDefinition('pothole'), stage, random, false);
    const candidates = [];
    for (let index = 0; index < plan.length; index++) {
      const old = plan[index];
      if (old.elite || old.type === 'pothole' || (old.cluster && old.phraseIndex !== 0)) continue;
      const last = old.cluster ? index + old.clusterSize - 1 : index;
      const previous = plan[index - 1], next = plan[last + 1];
      const lower = previous ? previous.distance + separation(previous, hole) : 112 * DRIVING_PACE.speedMultiplier;
      const upper = next ? next.distance - separation(hole, next) : end;
      const position = nearestLegalPosition(preferred, lower, upper, hole, stations, radius);
      if (position === null) continue;
      const nearOtherLift = existing.some(actor => Math.abs(actor.distance - position) < 180) ? 100 : 0;
      candidates.push({ index, last, old, position, cost: Math.abs(position - preferred) + (old.cluster ? 65 : 0) + nearOtherLift });
    }
    candidates.sort((a, b) => a.cost - b.cost || a.position - b.position);
    const chosen = candidates[0];
    if (!chosen) break; // An artificially blocked/short route stays safe, not overfilled.
    const { old, position } = chosen;
    const replacement = Object.freeze({ ...old, ...hole, distance: position, motionBaseDistance: position, telegraphBaseDistance: position,
      encounterId: `${old.encounterId}-lift`, phraseIndex: 0, phraseSize: 1, beat: 'lift-check', routePhase: phaseAt(position / Math.max(length, 1), stage),
      cluster: false, clusterSize: 1, clusterGrace: 0, tutorial: false });
    plan.splice(chosen.index, chosen.last - chosen.index + 1, replacement);
  }
}

function minimumPotential(stage, kind, lowCeiling) {
  return { holes: lowCeiling ? 0 : stage >= 6 && kind !== 'ev' ? 3 : stage >= 4 ? 2 : 0,
    hearts: kind === 'event' ? stage >= 4 ? 5 : 3 : 0 };
}
function meetsPotential(plan, minimum) {
  return plan.filter(actor => actor.type === 'pothole').length >= minimum.holes && plan.filter(actor => actor.type === 'salaryman').length >= minimum.hearts;
}
function ensureHeartPotential(plan, { stage, kind, random, lowCeiling }) {
  const minimum = minimumPotential(stage, kind, lowCeiling);
  let needed = minimum.hearts - plan.filter(actor => actor.type === 'salaryman').length;
  let spareHoles = plan.filter(actor => actor.type === 'pothole').length - minimum.holes;
  for (let index = plan.length - 1; index >= 0 && needed > 0; index--) {
    const old = plan[index];
    if (old.type === 'salaryman' || old.tutorial || old.elite || (old.type === 'pothole' && spareHoles <= 0)) continue;
    if (old.type === 'pothole') spareHoles--;
    const actor = descriptor(actorDefinition('salaryman'), stage, random, lowCeiling);
    plan[index] = Object.freeze({ ...old, ...actor, beat: 'heart-check' });
    needed--;
  }
}

/** Compact fallback for a rare random phrase layout that leaves an objective
 * impossible. Its required vocabulary is packed as whole readable phrases,
 * including safe chain pairs, rather than adding a hidden quota of collisions.
 */
function minimumPlan({ stage, kind, length, end, stations, radius, random, lowCeiling }) {
  const minimum = minimumPotential(stage, kind, lowCeiling);
  const elite = stage >= 5 && (stage % 2 === 1 || stage === 10);
  const pair = () => {
    const behavior = stage >= 6 && random() < .65 ? 'sway' : 'steady';
    return { name: 'crowd-group', cluster: true, actors: [actorDefinition('salaryman', behavior), actorDefinition('salaryman', behavior)] };
  };
  const lift = () => ({ name: 'lift-check', actors: [actorDefinition(lowCeiling ? 'cone' : 'pothole')] });
  const solo = () => ({ name: elite ? stage === 11 ? 'finale-anchor' : 'club-anchor' : 'heart-line', actors: [actorDefinition('salaryman', elite ? 'shield' : 'steady', elite)] });
  const phrases = kind === 'event'
    ? [pair(), lift(), pair(), lift(), solo(), ...(minimum.holes >= 3 ? [lift()] : [])]
    : [lift(), { name: 'heart-line', actors: [actorDefinition('salaryman')] }, lift(), solo(), ...(minimum.holes >= 3 ? [lift()] : [])];
  const result = [];
  let cursor = (112 + random() * 8) * DRIVING_PACE.speedMultiplier;
  for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex++) {
    const phrase = phrases[phraseIndex];
    const actors = phrase.actors.map(def => descriptor(def, stage, random, lowCeiling));
    synchronizeCluster(actors, phrase.cluster);
    if (result.length) cursor = Math.max(cursor, result.at(-1).distance + separation(result.at(-1), actors[0]) + 2);
    const positions = placePattern(actors, cursor, end, stations, radius, phrase.cluster, length);
    if (!positions) return null;
    const encounterId = `road-${stage + 1}-essential-${phraseIndex}`;
    for (let i = 0; i < actors.length; i++) {
      const distance = positions[i];
      result.push(Object.freeze({ ...actors[i], distance, motionBaseDistance: distance, encounterId, encounterIndex: phraseIndex, phraseIndex: i,
        phraseSize: actors.length, beat: phrase.name, routePhase: actors[i].elite ? stage === 11 ? 'finale' : 'climax' : phaseAt(distance / Math.max(1, length), stage),
        tutorial: false, cluster: phrase.cluster === true, clusterSize: phrase.cluster ? actors.length : 1, clusterGrace: phrase.cluster ? 1.7 : 0,
        threatBudget: 1, telegraphBaseDistance: phrase.cluster ? positions[0] : distance, telegraph: phrase.cluster ? actors[0].telegraph : actors[i].telegraph }));
    }
    cursor = positions.at(-1);
  }
  return meetsPotential(result, minimum) ? result : null;
}

/** Build an independent, reproducible route plan. No simulation RNG is consumed.
 * Optional lowCeiling/maxAltitude constraints replace jump-only obstacles with
 * shootable cones, so the director never demands an unavailable vertical route.
 */
export function createEncounterPlan(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const stage = clamp(Math.trunc(finite(source.routeIndex)), 0, 11);
  const length = clamp(finite(source.routeLength, 1400), 0, 100000);
  const node = source.node && typeof source.node === 'object' ? source.node : {};
  const kind = ['ev', 'event', 'service'].includes(node.kind) ? node.kind : node.routeOption === 'express' ? 'event' : 'ev';
  const radius = clamp(finite(source.stationRadius, (kind === 'ev' ? 72 : 60) * DRIVING_PACE.speedMultiplier), 0, 400);
  const stations = [...new Set((Array.isArray(source.stations) ? source.stations : []).map(item => typeof item === 'object' && item ? item.distance : item).filter(value => Number.isFinite(value) && value >= 0 && value <= length))].sort((a, b) => a - b).slice(0, 512);
  const lowCeiling = node.lowCeiling === true || (Number.isFinite(node.maxAltitude) && node.maxAltitude < 24);
  const random = makeRandom(hashSeed(source.seed) ^ Math.imul(stage + 1, 0x9e3779b9) ^ hashSeed(node.nodeId ?? kind));
  const plan = [], end = length - ENCOUNTER_RULES.arrivalClearance;
  let encounter = 0;
  const add = (actors, positions, beat, phase, tutorial = false, cluster = false) => {
    const id = `road-${stage + 1}-phrase-${encounter++}`;
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i], distance = positions[i];
      plan.push(Object.freeze({ ...actor, distance, motionBaseDistance: distance, encounterId: id, encounterIndex: encounter - 1, phraseIndex: i, phraseSize: actors.length, beat, routePhase: phase, tutorial, cluster, clusterSize: cluster ? actors.length : 1, clusterGrace: cluster ? 1.7 : 0, threatBudget: 1, telegraphBaseDistance: cluster ? positions[0] : distance, telegraph: cluster ? actors[0].telegraph : actor.telegraph }));
    }
  };
  const firstHeart = 80 * DRIVING_PACE.speedMultiplier, firstLift = 185 * DRIVING_PACE.speedMultiplier;
  if (stage === 0 && end >= firstLift) {
    const heart = descriptor(actorDefinition('salaryman'), stage, random, lowCeiling);
    const hole = descriptor(actorDefinition('pothole'), stage, random, lowCeiling);
    if (safeAt(firstHeart, heart, stations, radius)) add([heart], [firstHeart], 'first-heart', 'opening', true);
    if (safeAt(firstLift, hole, stations, radius) && (!plan.length || firstLift - plan.at(-1).distance >= separation(plan.at(-1), hole))) add([hole], [firstLift], lowCeiling ? 'first-obstacle' : 'first-lift', 'opening', true);
  }
  let cursor = stage === 0 ? Math.max(320 * DRIVING_PACE.speedMultiplier, (plan.at(-1)?.distance ?? firstHeart) + 130 * DRIVING_PACE.speedMultiplier) : (112 + random() * 18) * DRIVING_PACE.speedMultiplier;
  const spacingMultiplier = clamp(finite(node.encounterSpacingMultiplier, 1), .7, 1.4);
  for (let count = 0; count < 1000 && cursor <= end; count++) {
    const phase = phaseAt(cursor / Math.max(length, 1), stage);
    let phrase = grammar(stage, kind, phase, random);
    let actors = phrase.actors.map(def => descriptor(def, stage, random, lowCeiling));
    synchronizeCluster(actors, phrase.cluster);
    if (plan.length) cursor = Math.max(cursor, plan.at(-1).distance + separation(plan.at(-1), actors[0]));
    let positions = placePattern(actors, cursor, end, stations, radius, phrase.cluster);
    if (!positions) {
      actors = [actors[0]];
      const distance = nextSafe(cursor, actors[0], stations, radius);
      if (distance > end) break;
      positions = [distance];
      phrase = { name: actors[0].behavior === 'steady' ? 'solo-read' : `${actors[0].behavior}-read` };
    }
    const actualPhase = phaseAt(positions[0] / Math.max(length, 1), stage);
    add(actors, positions, phrase.name, actualPhase, false, phrase.cluster === true);
    const breathing = actualPhase === 'breather' ? 150 : phrase.cluster ? 45 : actors.length > 1 ? 70 : 20;
    cursor = positions.at(-1) + (108 + breathing + random() * 28 - stage * 2) * spacingMultiplier * DRIVING_PACE.speedMultiplier;
  }
  // Club roads feature a single readable anchor, never extra overlapping spawns.
  // An existing late-route slot becomes elite; station and spacing guarantees
  // remain valid because the shield envelope is smaller than every other actor.
  if (stage >= 5 && (stage % 2 === 1 || stage === 10)) {
    const candidates = plan.map((actor, index) => ({ actor, index })).filter(({ actor }) => actor.distance >= length * .42 && actor.distance <= length * .9);
    const chosen = candidates.sort((a, b) => Number(a.actor.cluster) - Number(b.actor.cluster) || Math.abs(a.actor.distance - length * .78) - Math.abs(b.actor.distance - length * .78))[0];
    if (chosen) {
      const old = chosen.actor;
      const elite = descriptor(actorDefinition('salaryman', 'shield', true), stage, random, lowCeiling);
      plan[chosen.index] = Object.freeze({ ...old, ...elite, distance: old.distance, motionBaseDistance: old.distance, beat: stage === 11 ? 'finale-anchor' : 'club-anchor', routePhase: stage === 11 ? 'finale' : 'climax', cluster: false, clusterSize: 1, clusterGrace: 0, phraseIndex: 0, phraseSize: 1, telegraphBaseDistance: old.distance });
      if (old.cluster) {
        for (let i = plan.length - 1; i >= 0; i--) if (i !== chosen.index && plan[i].encounterId === old.encounterId) plan.splice(i, 1);
      }
    }
  }
  const constraints = { stage, kind, length, end, stations, radius, random, lowCeiling };
  ensureLiftChecks(plan, constraints);
  ensureHeartPotential(plan, constraints);
  if (stage >= 4 && !meetsPotential(plan, minimumPotential(stage, kind, lowCeiling))) {
    const replacement = minimumPlan(constraints);
    if (replacement) plan.splice(0, plan.length, ...replacement);
  }
  // Attach a chapter identity only after the safety/quota pass. The beginner
  // chapters retain their original one/two-hit teaching vocabulary; late-road
  // anchors keep existing HP and collision envelopes. Never add an extra actor.
  if (stage % 2 === 1 || stage === 10) {
    const headliner = SIGNAL_HEADLINERS[Math.floor(stage / 2)];
    const eliteIndex = plan.findIndex(actor => actor.elite);
    const candidates = plan.map((actor, index) => ({ actor, index })).filter(({ actor }) =>
      !actor.cluster && !actor.tutorial && (actor.type === 'salaryman' || stage < 4) &&
      actor.distance >= length * .4 && actor.distance <= length * .9);
    const chosen = eliteIndex >= 0 ? eliteIndex : candidates.sort((a, b) =>
      Math.abs(a.actor.distance - length * .76) - Math.abs(b.actor.distance - length * .76))[0]?.index
      ?? plan.map((actor, index) => ({ actor, index })).filter(({ actor }) =>
        actor.type === 'salaryman' && !actor.tutorial && (!actor.cluster || actor.phraseIndex === 0) && actor.distance >= length * .25 && actor.distance <= length * .9).at(-1)?.index;
    if (chosen !== undefined && chosen >= 0) {
      const old = plan[chosen];
      const actor = old.type === 'salaryman' ? old : { ...old,
        ...descriptor(actorDefinition('salaryman', stage >= 3 ? 'shield' : 'steady'), stage, random, lowCeiling),
        telegraphBaseDistance: old.distance, motionBaseDistance: old.distance };
      plan[chosen] = Object.freeze({ ...actor, headliner,
        headlinerOptional: true,
        telegraph: Object.freeze({ ...actor.telegraph,
          label: `${headliner.name} / ${headliner.lesson}` }),
      });
    }
  }
  return Object.freeze(plan.map(actor => decorateEncounter(actor, stage, source.seed)));
}

/** Reserve flight-only road gaps before survival crowds are packed around them.
 * Add only in free space: never move an authored encounter or crowd an EV stop.
 * Short or blocked roads may contain fewer gaps rather than unsafe placements. */
export function addFlightObstacles(plan, { seed, routeIndex, routeLength, stations, stationRadius, node = {} }) {
  const result = [...plan];
  if (node.lowCeiling || node.maxAltitude < 24) return result;
  const quota = routeIndex === 0 ? 2 : routeIndex < 4 ? 3 : routeIndex < 8 ? 4 : 5;
  const random = makeRandom(hashSeed(`${seed}:${routeIndex}:flight`));
  const end = routeLength - ENCOUNTER_RULES.arrivalClearance;
  for (let pass = 0; pass < quota; pass++) {
    const holes = result.filter(actor => actor.type === 'pothole');
    if (holes.length >= quota) break;
    const actor = descriptor(actorDefinition('pothole'), routeIndex, random, false);
    const targets = Array.from({ length: quota }, (_, i) => routeLength * (i + 1) / (quota + 1));
    const preferred = targets.sort((a, b) => {
      const gap = value => holes.length ? Math.min(...holes.map(hole => Math.abs(hole.distance - value))) : routeLength - Math.abs(value - routeLength / 2);
      return gap(b) - gap(a);
    })[0];
    const candidates = [];
    // Preserve the opening tutorial and first XP choice on the first road.
    const start = routeIndex === 0 ? 800 : actor.warningDistance + actor.collisionRadius;
    for (let distance = start; distance <= end; distance += 14) {
      if (!safeAt(distance, actor, stations, stationRadius)) continue;
      if (distance + actor.collisionRadius >= routeLength * .65 && distance - actor.collisionRadius <= routeLength * .73) continue;
      if (result.some(other => Math.abs(other.distance - distance) < separation(other, actor))) continue;
      if (holes.some(hole => Math.abs(hole.distance - distance) < 360)) continue;
      candidates.push(distance);
    }
    candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
    const distance = candidates[0];
    if (distance === undefined) break;
    const gap = { ...actor, distance, motionBaseDistance: distance, telegraphBaseDistance: distance,
      encounterId: `flight-${routeIndex}-${pass}`, encounterIndex: pass, phraseIndex: 0, phraseSize: 1,
      beat: 'flight-gap', routePhase: phaseAt(distance / routeLength, routeIndex),
      cluster: false, clusterSize: 1, clusterGrace: 0, tutorial: false, threatBudget: 1 };
    result.push(Object.freeze(decorateEncounter(gap, routeIndex, seed)));
  }
  return result.sort((a, b) => a.distance - b.distance);
}

/** Update the same authoritative actor position used by both render and collision.
 * Animation is an analytic function of simulation time, not a per-frame random
 * walk. dt is used only to interpolate the initial threshold crossing exactly.
 */
export function updateEncounterActor(entity, state = {}, dt = 0) {
  if (!entity || typeof entity !== 'object') return entity;
  if (!entity.directorManaged || entity.resolved || entity.cleared || entity.converted) return entity;
  const source = state && typeof state === 'object' ? state : {};
  const elapsed = clamp(finite(source.elapsed), 0, 1e9);
  const distance = clamp(finite(source.distance), 0, 1e9);
  const base = clamp(finite(entity.motionBaseDistance, finite(entity.distance)), 0, 1e9);
  const speedScale = Math.max(1, finite(source.musicDrive?.multiplier, 1));
  const maximumSpeed = MAX_METRES_PER_SECOND * speedScale;
  const speed = clamp(finite(source.speed, 108) / 3.6, 0, maximumSpeed);
  const delta = clamp(finite(dt), 0, 1e6);
  const amplitude = clamp(finite(entity.motionAmplitude), 0, ENCOUNTER_RULES.maximumMotion);
  const radius = RADII[entity.type] ?? 15;
  const anticipation = clamp(finite(entity.anticipation, 1.45), ENCOUNTER_RULES.minimumCounterTime, 3);
  const minimumWindow = Math.max(ENCOUNTER_RULES.minimumCounterTime, finite(entity.telegraph?.counterWindow, ENCOUNTER_RULES.minimumCounterTime));
  // The top supported rush speed sets the trigger. Accelerating during a tell
  // cannot silently shorten either the anticipation or the response window.
  const warning = clamp(Math.max(finite(entity.warningDistance, 150), maximumSpeed * (anticipation + minimumWindow) + radius + amplitude), 0, ENCOUNTER_RULES.warningViewDistance * speedScale);
  const telegraphBase = clamp(finite(entity.telegraphBaseDistance, base), 0, 1e9);
  const trigger = telegraphBase - warning;
  if (!Number.isFinite(entity.encounterStartedAt) && distance >= trigger) {
    const crossedAgo = speed > 0 ? clamp((distance - Math.max(0, trigger)) / speed, 0, delta) : 0;
    entity.encounterStartedAt = Math.max(0, elapsed - crossedAgo);
  }
  const started = Number.isFinite(entity.encounterStartedAt);
  const age = started ? Math.max(0, elapsed - entity.encounterStartedAt) : 0;
  const relative = telegraphBase - distance;
  entity.distance = base;
  entity.motionOffset = 0;
  entity.moving = false;
  entity.encounterAge = age;
  entity.warningDistance = warning;
  entity.tell = relative >= -radius && relative <= warning;
  entity.telegraphProgress = started ? clamp(age / anticipation, 0, 1) : 0;
  entity.counterWindow = minimumWindow;
  entity.shielded = false;
  entity.vulnerable = true;
  entity.behaviorPhase = started ? 'open' : 'idle';
  if (entity.behavior === 'sway') {
    const rate = clamp(finite(entity.motionRate, 1.2), 0, 3);
    const phase = finite(entity.motionPhase);
    entity.motionOffset = Math.sin(elapsed * rate + phase) * amplitude;
    entity.distance = base + entity.motionOffset;
    entity.moving = true;
    entity.behaviorPhase = entity.tell ? 'sway' : 'idle';
  } else if (entity.behavior === 'charger') {
    const lungeDuration = .5, recoveryDuration = 1.35;
    entity.behaviorPhase = !started ? 'idle' : age < anticipation ? 'tell' : age < anticipation + lungeDuration ? 'active' : age < anticipation + lungeDuration + recoveryDuration ? 'recover' : 'open';
    if (entity.behaviorPhase === 'active') entity.motionOffset = -amplitude * smooth((age - anticipation) / lungeDuration);
    else if (entity.behaviorPhase === 'recover') entity.motionOffset = -amplitude * (1 - smooth((age - anticipation - lungeDuration) / recoveryDuration));
    entity.distance = base + entity.motionOffset;
    entity.moving = entity.behaviorPhase === 'active' || entity.behaviorPhase === 'recover';
  } else if (entity.behavior === 'shield') {
    const openDuration = Math.max(1.75, minimumWindow);
    const cycle = age % (anticipation + openDuration);
    // Once close, the guard stays open for the complete final counter window.
    // It cannot snap closed on the player at the collision boundary.
    const finalApproach = relative <= radius + maximumSpeed * openDuration;
    entity.shielded = !finalApproach && (!started || cycle < anticipation);
    entity.vulnerable = !entity.shielded;
    entity.behaviorPhase = entity.shielded ? 'guard' : 'open';
    entity.telegraphProgress = entity.shielded && started ? clamp(cycle / anticipation, 0, 1) : 1;
    entity.counterWindow = openDuration;
  }
  if (entity.headliner) {
    const health = clamp(finite(entity.hp, finite(entity.maxHp, 1)), 0, Math.max(1, finite(entity.maxHp, 1)));
    entity.headlinerPhase = health <= 1 ? 'last-signal' : entity.shielded ? 'closed' : 'response';
  }
  return entity;
}

/** Read-only chapter view for the HTML HUD. A name never implies that clearing
 * the optional obstacle is required to finish the road. */
export function getHeadlinerView(state = {}) {
  const distance = Math.max(0, finite(state?.distance));
  const actor = (Array.isArray(state?.entities) ? state.entities : []).find(item =>
    item?.headliner && !item.cleared && !item.resolved && !item.converted &&
    Number.isFinite(item.distance) && item.distance >= distance - 15 &&
    item.distance - distance <= ENCOUNTER_RULES.warningViewDistance);
  if (!actor) return null;
  const maxHp = Math.max(1, finite(actor.maxHp, 1));
  return { id: actor.headliner.id, name: actor.headliner.name, title: actor.headliner.title,
    lesson: actor.headliner.lesson, color: actor.headliner.color,
    hp: clamp(finite(actor.hp, maxHp), 0, maxHp), maxHp,
    phase: actor.headlinerPhase || (actor.shielded ? 'closed' : 'response'),
    distance: round(Math.max(0, actor.distance - distance)), optional: true };
}

/** Compact HUD data, derived without changing the route or consuming randomness. */
export function getEncounterPhase(state = {}) {
  const source = state && typeof state === 'object' ? state : {};
  const stage = clamp(Math.trunc(finite(source.routeIndex)), 0, 11);
  const length = Math.max(1, finite(source.routeLength, 1400));
  const distance = Math.max(0, finite(source.distance));
  const progress = clamp(distance / length, 0, 1);
  const threats = (Array.isArray(source.entities) ? source.entities : []).filter(actor => actor && TYPES.includes(actor.type) && !actor.resolved && !actor.cleared && !actor.converted && Number.isFinite(actor.distance) && actor.distance >= distance - (RADII[actor.type] ?? 15)).sort((a, b) => a.distance - b.distance);
  const next = threats[0];
  const nextDistance = next ? Math.max(0, next.distance - distance) : null;
  const nearby = threats.filter(actor => actor.distance - distance <= ENCOUNTER_RULES.warningViewDistance);
  const breathingRoom = source.atStation === true || source.charging === true || nearby.length === 0;
  const id = source.status === 'won' || progress >= 1 ? 'arrival' : source.atStation || source.charging ? 'recharge' : next?.elite && nextDistance <= ENCOUNTER_RULES.warningViewDistance ? stage === 11 ? 'finale' : 'climax' : phaseAt(progress, stage);
  const intensity = breathingRoom ? .1 : clamp(.18 + stage * .035 + nearby.length * .12 + (next?.elite ? .2 : 0), 0, 1);
  return { id, label: PHASE_LABELS[id], progress, intensity: round(intensity), breathingRoom, finale: stage === 11 && id === 'finale', nextThreatDistance: nextDistance === null ? null : round(nextDistance), nextBehavior: next?.behavior ?? null, elite: next?.elite === true, encounterId: next?.encounterId ?? null };
}
