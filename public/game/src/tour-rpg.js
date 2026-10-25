/** Run-only mastery. Stable rewards, real action synergies, no attendance grind. */
export const RPG_VERSION = 1;
export const RANK_XP = Object.freeze([0, 32, 90, 175, 290, 435, 610]);
export const RUN_STYLES = Object.freeze([
  Object.freeze({ id: 'relay', name: 'ハートリレー', role: 'つなぐ', color: '#ff72bd', description: '最初からハートが1人分貫通。人波をつないでコンボを育てるで。', effect: '貫通 +1', signature: '5コンボごとに電池 +4' }),
  Object.freeze({ id: 'guardian', name: 'ネオンガード', role: '守る', color: '#77f4e8', description: 'EVで1.5秒充電すると衝突を1回ガード。準備してから攻めるで。', effect: 'EV充電 1.5秒でガード', signature: '満充電で耐久 +4（各EVで1回）' }),
  Object.freeze({ id: 'air', name: 'バウンスライダー', role: '飛ぶ', color: '#ffe091', description: '浮力の消費を15%節約。低く飛びこえるほど次の加速につながるで。', effect: '浮力消費 −15%・回避で電池 +2', signature: '低空の精密回避で電池 +3' }),
]);
export const PERK_CATALOG = Object.freeze([
  { id: 'chorus', family: 'relay', name: 'コーラスハート', description: 'ハートが届いた場所から38m以内の1か所へ連鎖。となりもリレーと組むと2か所へ。', effect: '連鎖 +1 / 距離38m・パーツと合算で2連鎖' },
  { id: 'recycle', family: 'relay', name: 'ときめきリチャージ', description: '招待やシグナル復旧で電池+3。ときめき還元と合わせたら+6や。', effect: 'ハートが届くたび電池 +3 / パーツと合算' },
  { id: 'spotlight', family: 'relay', name: 'スポットライト', description: 'ハートがさらに1人分貫通。並んだ人へまとめて届けよ。', effect: '貫通 +1' },
  { id: 'capacitor', family: 'guardian', name: '満タンアンプ', description: '満充電で次のハートの威力+1。満タンの一撃と合わせて威力+2にできるで。', effect: '満充電後の次弾 威力 +1 / パーツ併用で+2' },
  { id: 'sanctuary', family: 'guardian', name: 'ポケットシールド', description: 'EV充電1秒で衝突1回を防ぐ。他のガード1つごとにさらに0.25秒短縮、最短0.5秒。', effect: 'EV充電1秒でガード / 併用で0.75秒・0.5秒' },
  { id: 'comeback', family: 'guardian', name: 'カムバックライト', description: 'シールドで衝突を防ぐと耐久+8。守った分だけ立て直せるで。', effect: 'ガード成功で耐久 +8' },
  { id: 'glide', family: 'air', name: 'フェザーライン', description: '下降速度×0.70、浮力消費×0.90。下降速度はパーツと合わせて最小×0.50。', effect: '下降速度 ×0.70（最小×0.50）/ 浮力消費 ×0.90' },
  { id: 'drop', family: 'air', name: 'ベースドロップ', description: 'ラッシュ開始で前60mへ威力2のハート波。ラッシュ開花と組むと前75mに広がるで。', effect: '前60mへハート波 / パーツ併用で75m' },
  { id: 'rebound', family: 'air', name: 'リバウンド', description: '空中回避で電池+4。スタイルやパーツと合算、1回につき最大+8。', effect: '空中回避で電池 +4 / 合算で最大+8' },
].map(Object.freeze));
const STYLE = new Map(RUN_STYLES.map(item => [item.id, item]));
const PERK = new Map(PERK_CATALOG.map(item => [item.id, item]));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, max = 100000) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0;
const hash = value => { let n = 2166136261; for (const char of String(value)) n = Math.imul(n ^ char.charCodeAt(0), 16777619) >>> 0; return n; };
export function normalizeRpg(value) {
  const fresh = { version: RPG_VERSION, enabled: false, style: null, xp: 0, perks: [], receipts: [], feedback: '' };
  if (!plain(value) || value.version !== RPG_VERSION || value.enabled !== true || !STYLE.has(value.style)) return fresh;
  fresh.enabled = true; fresh.style = value.style; fresh.xp = integer(value.xp, RANK_XP.at(-1));
  const earned = RANK_XP.slice(1).filter(threshold => fresh.xp >= threshold).length;
  fresh.perks = [...new Set((Array.isArray(value.perks) ? value.perks : []).filter(id => PERK.has(id)))].slice(0, earned);
  fresh.receipts = [...new Set((Array.isArray(value.receipts) ? value.receipts : []).filter(id => typeof id === 'string' && /^\d{1,2}:(convert|jump-clear|precision|charged|quiz-result|won|combo|shield-block):[\w.-]{1,40}$/.test(id)))].slice(-2048);
  fresh.feedback = typeof value.feedback === 'string' ? value.feedback.slice(0, 100) : '';
  return fresh;
}
export function chooseRunStyle(state, id) {
  if (!STYLE.has(id) || !state || state.status !== 'playing' || state.campaignStarted || state.routeIndex !== 0 || state.distance !== 0 || state.elapsed !== 0) return false;
  state.rpg = normalizeRpg({ version: RPG_VERSION, enabled: true, style: id });
  if (state._stageStart) state._stageStart.rpg = normalizeRpg(state.rpg);
  return true;
}
function familyCounts(rpg) {
  return Object.fromEntries(RUN_STYLES.map(style => [style.id, (rpg.style === style.id ? 1 : 0) + rpg.perks.filter(id => PERK.get(id).family === style.id).length]));
}
export function getRpgModifiers(state) {
  const rpg = normalizeRpg(state?.rpg), counts = familyCounts(rpg), has = id => rpg.perks.includes(id);
  if (!rpg.enabled) return null;
  return {
    heartPierce: (rpg.style === 'relay' ? 1 : 0) + (has('spotlight') ? 1 : 0),
    heartChain: has('chorus') ? 1 : 0, heartChainRange: has('chorus') ? 38 : 0,
    conversionEnergy: has('recycle') ? 3 : 0,
    chargeShield: rpg.style === 'guardian' || has('sanctuary'),
    chargeShieldSeconds: has('sanctuary') ? (rpg.style === 'guardian' ? .75 : 1) : 1.5,
    chargedHeartBonus: has('capacitor') ? 1 : 0,
    shieldPiercing: counts.guardian >= 3,
    rushPulse: has('drop') ? 60 : 0,
    descentMultiplier: has('glide') ? .7 : 1,
    thrustDrainMultiplier: (rpg.style === 'air' ? .85 : 1) * (has('glide') ? .9 : 1),
    comboFlight: (rpg.style === 'air' ? 2 : 0) + (has('rebound') ? 4 : 0),
    comboEnergy: rpg.style === 'relay' ? 4 : counts.relay >= 2 ? 3 : 0,
    comboRepair: counts.relay >= 3 ? 3 : 0,
    chargeRepair: rpg.style === 'guardian' ? 4 : 0,
    shieldRepair: has('comeback') ? 8 : 0,
    precisionEnergy: rpg.style === 'air' ? 3 : 0,
    precisionCooldown: counts.air >= 3 ? 1 : 0,
  };
}
function offersFor(state, rpg) {
  if (!rpg.enabled || rpg.perks.length >= RANK_XP.length - 1 || rpg.xp < RANK_XP[rpg.perks.length + 1]) return [];
  const available = PERK_CATALOG.filter(item => !rpg.perks.includes(item.id));
  const order = [...RUN_STYLES].sort((a,b) => hash(`${state.seed}:${rpg.perks.length}:${a.id}`) - hash(`${state.seed}:${rpg.perks.length}:${b.id}`));
  const picks = [];
  for (const style of order) {
    const pool = available.filter(item => item.family === style.id).sort((a,b) => hash(`${state.seed}:${rpg.perks.length}:${a.id}`) - hash(`${state.seed}:${rpg.perks.length}:${b.id}`));
    if (pool[0]) picks.push(pool[0]);
  }
  for (const item of available) if (picks.length < 3 && !picks.includes(item)) picks.push(item);
  const counts = familyCounts(rpg);
  return picks.map(item => ({ ...item, familyName: STYLE.get(item.family).name, color: STYLE.get(item.family).color, synergy: counts[item.family] >= 2 ? 'この系統が3つで連携発動' : `${STYLE.get(item.family).role}スタイルを育てる` }));
}
export function getRpgView(state) {
  const rpg = normalizeRpg(state?.rpg), rank = rpg.perks.length + 1;
  const floor = RANK_XP[rank - 1], nextXp = RANK_XP[rank] ?? null;
  const counts = familyCounts(rpg);
  return { enabled: rpg.enabled, style: rpg.style, styleName: STYLE.get(rpg.style)?.name || '自由な旅', rank, xp: rpg.xp, nextXp,
    progress: nextXp === null ? 1 : Math.min(1, Math.max(0, (rpg.xp - floor) / (nextXp - floor))),
    perks: rpg.perks.map(id => ({ ...PERK.get(id) })), offers: offersFor(state || {}, rpg), feedback: rpg.feedback,
    synergy: RUN_STYLES.map(style => ({ id: style.id, name: style.name, count: counts[style.id], active: counts[style.id] >= 3,
      description: style.id === 'relay' ? '5コンボごとに耐久+3' : style.id === 'guardian' ? 'シールド中はガード無視・貫通+1（パーツと合算）' : '精密回避でラッシュ待ち時間−1秒' })) };
}
export function choosePerk(state, id) {
  if (state?.status !== 'draft') return false;
  const rpg = normalizeRpg(state.rpg), offer = offersFor(state, rpg).find(item => item.id === id);
  if (!offer) return false;
  rpg.perks.push(id); rpg.feedback = `${offer.name}、この旅の得意技や。`;
  state.rpg = normalizeRpg(rpg); state.status = 'playing';
  state.events = [{ type: 'perk-chosen', id, rank: state.rpg.perks.length + 1 }];
  state.boosting = state.shooting = state.charging = false; state._rushHeld = false;
  return true;
}
export function openRpgDraft(state) {
  if (state?.status !== 'playing' || !offersFor(state, normalizeRpg(state.rpg)).length) return false;
  state.status = 'draft'; state.boosting = state.shooting = state.charging = false;
  // Cancel a held rush once, then freeze its recovery while the player reads.
  if (state.rushing) state.rushCooldown = Math.max(state.rushCooldown, state.rushRecovery ?? 5);
  state.rushing = false; state.rushTime = 0; state._rushHeld = false;
  state.events.push({ type: 'rank-up', rank: normalizeRpg(state.rpg).perks.length + 2 });
  return true;
}
/** Each reward is tied to a real entity/station/road, so recharging cannot farm XP. */
export function recordRpgEvent(state, event) {
  const rpg = normalizeRpg(state?.rpg);
  if (!rpg.enabled || !event || !['playing', 'won'].includes(state.status)) return false;
  const type = event.type;
  const id = event.entityId ?? event.stationId ?? (type === 'won' ? 'arrival' : type === 'quiz-result' ? 'fan' : null);
  if (id === null || !['convert', 'jump-clear', 'precision', 'charged', 'quiz-result', 'won', 'shield-block'].includes(type)) return false;
  if (type === 'quiz-result' && event.correct !== true) return false;
  const receipt = `${state.routeIndex}:${type}:${id}`;
  if (!/^\d{1,2}:(convert|jump-clear|precision|charged|quiz-result|won|shield-block):[\w.-]{1,40}$/.test(receipt) || rpg.receipts.includes(receipt)) return false;
  rpg.receipts.push(receipt);
  const amounts = { convert: 6 + Math.min(4, integer(event.combo, 100)), 'jump-clear': 5, precision: 4, charged: 6, 'quiz-result': 8, won: 12, 'shield-block': 3 };
  const amount = amounts[type];
  rpg.xp = Math.min(RANK_XP.at(-1), rpg.xp + amount);
  const mods = getRpgModifiers({ rpg });
  const heal = amount => { state.integrity = Math.min(state.integrityCapacity, state.integrity + amount); };
  const recharge = amount => { state.energy = Math.min(state.energyCapacity, state.energy + amount); };
  if (type === 'convert' && event.combo > 0 && event.combo % 5 === 0) { recharge(mods.comboEnergy); heal(mods.comboRepair); }
  if (type === 'charged') heal(mods.chargeRepair);
  if (type === 'shield-block') heal(mods.shieldRepair);
  if (type === 'precision') { recharge(mods.precisionEnergy); state.rushCooldown = Math.max(0, state.rushCooldown - mods.precisionCooldown); }
  rpg.feedback = `${({ convert: event.signalRepaired ? 'シグナル復旧' : 'ハート届いた', 'jump-clear': '空中回避', precision: '精密回避', charged: '充電完了', 'quiz-result': '新しい仲間', won: '道をつないだ', 'shield-block': 'ガード成功' })[type]} +${amount} XP`;
  state.rpg = normalizeRpg(rpg);
  return true;
}
