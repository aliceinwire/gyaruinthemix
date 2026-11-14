/** Fictional obstacles to self-expression. People become fans; animals are
 * scenery, never collision targets. Decoration preserves reserved road space. */
export const STREET_ROLES = Object.freeze([
  { id: 'salaryman', name: '街角の音楽好き', behavior: 'steady', stage: 0, fan: 'dj', welcome: '今夜は一緒に、好きな音で踊ろ！' },
  { id: 'brand-rep', name: 'フライヤー配りの音楽好き', behavior: 'steady', stage: 0, fan: 'model', welcome: 'いろんな音から、うちの好きも見つけよ！' },
  { id: 'copy-clerk', name: 'アルバムめくりの写真好き', behavior: 'sway', stage: 2, fan: 'photographer', welcome: '今日の思い出に、うちらの一枚撮ろ！' },
  { id: 'meeting-host', name: 'おしゃべり広場の案内人', behavior: 'shield', stage: 3, fan: 'tv', welcome: 'おしゃべりの続きは、次のステージで！' },
  { id: 'deadline-runner', name: '開演わくわくランナー', behavior: 'charger', stage: 4, fan: 'event', welcome: '楽しそうな音がするで。一緒に見にいこ！' },
  { id: 'approval-chief', name: '衣装箱の案内人', behavior: 'shield', stage: 5, fan: 'stylist', welcome: 'その服、好きなら着てみよ！' },
  { id: 'notification-clerk', name: 'デコケータイの写真好き', behavior: 'steady', stage: 0, fan: 'photographer', welcome: 'ケータイ構えて、今この瞬間を撮ろ！' },
  { id: 'metrics-inspector', name: 'リズム数えの音楽好き', behavior: 'sway', stage: 2, fan: 'dj', welcome: 'リズムに乗って、好きな音、回してこ！' },
  { id: 'dress-code-guard', name: '衣装選びの案内人', behavior: 'shield', stage: 3, fan: 'model', welcome: '着たい服でええねん。ここから、うちだけのランウェイや！' },
  { id: 'overtime-runner', name: 'ぐるぐるダンスランナー', behavior: 'charger', stage: 4, fan: 'event', welcome: '準備はばっちり。今夜のイベント楽しも！' },
  { id: 'script-reader', name: '歌詞ノートの読み手', behavior: 'steady', stage: 1, fan: 'tv', welcome: '歌詞ノートに、うちの言葉も足してこ！' },
  { id: 'hierarchy-keeper', name: 'アクセタワーの案内人', behavior: 'shield', stage: 5, fan: 'stylist', welcome: 'きらきらしてる！ そのアクセめっちゃ似合う！' },
].map(Object.freeze));

/** Suit silhouettes make stamina readable before the first invitation lands.
 * Floors preserve the later roads' existing crowd scaling. */
export const SUIT_STYLES = Object.freeze({
  salaryman: { cut: 'classic', jacket: '#343b54', light: '#58617c', tie: '#bd4155', width: 0, minimumHp: 1 },
  'brand-rep': { cut: 'tailored', jacket: '#645d68', light: '#9a8d9a', tie: '#c29d76', width: 0, minimumHp: 1 },
  'notification-clerk': { cut: 'slim', jacket: '#434653', light: '#737b87', tie: '#87a7b1', width: -1, glasses: true, minimumHp: 1 },
  'script-reader': { cut: 'vest', jacket: '#565769', light: '#9795a6', tie: '#8e657c', width: -1, minimumHp: 1 },
  'copy-clerk': { cut: 'vest', jacket: '#60564a', light: '#9d8e75', tie: '#b88569', width: -1, glasses: true, minimumHp: 1 },
  'metrics-inspector': { cut: 'pinstripe', jacket: '#344955', light: '#718d98', tie: '#b6b2a7', width: 1, glasses: true, minimumHp: 2 },
  'meeting-host': { cut: 'double', jacket: '#55495f', light: '#877894', tie: '#a894bd', width: 2, minimumHp: 2 },
  'deadline-runner': { cut: 'tailored', jacket: '#3e4d66', light: '#7790ad', tie: '#bd6969', width: -1, minimumHp: 1 },
  'overtime-runner': { cut: 'rolled', jacket: '#4d5961', light: '#8b9ba5', tie: '#bc815b', width: 1, minimumHp: 2 },
  'dress-code-guard': { cut: 'double', jacket: '#2d354a', light: '#66718a', tie: '#b1b7c5', width: 3, glasses: true, minimumHp: 3 },
  'approval-chief': { cut: 'pinstripe', jacket: '#574552', light: '#957784', tie: '#c7a375', width: 3, silverHair: true, minimumHp: 3 },
  'hierarchy-keeper': { cut: 'coat', jacket: '#3b3e50', light: '#7d819b', tie: '#d1b178', width: 4, glasses: true, silverHair: true, minimumHp: 4 },
});
for (const style of Object.values(SUIT_STYLES)) Object.freeze(style);

export function suitStyleFor(actor = {}) {
  if (actor.zombie || actor.converted || actor.headliner || actor.elite || actor.type !== 'salaryman') return null;
  return SUIT_STYLES[actor.streetRole?.id] || SUIT_STYLES.salaryman;
}

export const ZOMBIE_TYPES = Object.freeze([
  Object.freeze({ id: 'shambler', name: '夜ふかしゾンビ', hp: 3, stage: 1, gyaruStyle: 'silver-manba' }),
  Object.freeze({ id: 'bouncer', name: 'ヘビーゾンビ', hp: 6, stage: 5, gyaruStyle: 'purple-rokku' }),
]);

/** Replace a few already-spaced crowd members; never add another collision. */
export function addZombieEncounters(plan, stage, seed) {
  if (stage < 1) return plan;
  const candidates = plan.filter(actor => actor.type === 'salaryman' && !actor.headliner && !actor.elite && !actor.tutorial &&
    (!actor.cluster || actor.phraseIndex === actor.phraseSize - 1))
    .sort((a, b) => hash(`${seed}:zombie:${a.encounterId}`) - hash(`${seed}:zombie:${b.encounterId}`));
  const selected = new Map();
  for (const actor of candidates) {
    if ([...selected.keys()].some(other => Math.abs(other.distance - actor.distance) < 300)) continue;
    const zombie = ZOMBIE_TYPES[stage >= 5 && selected.size % 2 === 0 ? 1 : 0];
    const hp = zombie.hp + Math.floor(stage / 4);
    selected.set(actor, Object.freeze({ ...actor, zombie, streetRole: undefined, hp, maxHp: hp,
      telegraph: Object.freeze({ ...actor.telegraph, label: zombie.name }) }));
    if (selected.size >= 1 + Math.floor(stage / 4)) break;
  }
  return plan.map(actor => selected.get(actor) || actor);
}

export const ROUTINE_HAZARDS = Object.freeze([
  { id: 'roadworks', name: '工事バリケード', type: 'barrier', hp: 4, clearance: .32, advice: '攻撃で崩すか、上を越えよ', stage: 1 },
  { id: 'broken-asphalt', name: '崩れた路面', type: 'pothole', hp: 1, clearance: .25, advice: '攻撃は通らへん。飛んで抜けよ', stage: 1 },
  { id: 'speaker-crates', name: '積み上がった機材ケース', type: 'barrier', hp: 5, clearance: .36, advice: '攻撃で崩すか、上を越えよ', stage: 3 },
  { id: 'paper-stack', name: 'ひらひら紙吹雪', type: 'cone', hp: 1, clearance: .17, advice: '攻撃で片づく。短く浮いてもOK', stage: 0 },
  { id: 'deadline-clock', name: 'くるくるステージ時計', type: 'cone', hp: 1, clearance: .2, advice: '攻撃でオフ。浮いてもOK', stage: 1 },
  { id: 'ad-totem', name: 'カラフルポスタータワー', type: 'barrier', hp: 2, clearance: .4, advice: '攻撃で崩すか、上を越えよ', stage: 1 },
  { id: 'meeting-wall', name: '広場のメッセージボード', type: 'barrier', hp: 2, clearance: .32, advice: '攻撃でおひらき。上も通れるで', stage: 2 },
  { id: 'copy-printer', name: 'きらきらミュージックボックス', type: 'barrier', hp: 3, clearance: .32, advice: 'かたいミュージックボックス。火力を育てるか浮こ', stage: 3 },
  { id: 'task-loop', name: 'くるくる小道の溝', type: 'pothole', hp: 1, clearance: .25, advice: '攻撃は通らへん。飛んで抜けよ', stage: 2 },
  { id: 'inbox-pile', name: 'カラフル招待状の山', type: 'cone', hp: 1, clearance: .2, advice: '攻撃で招待状を広げよ。浮いてもOK', stage: 0 },
  { id: 'notification-tower', name: 'きらきらベルタワー', type: 'barrier', hp: 2, clearance: .4, advice: '攻撃でミュート。上から抜けてもOK', stage: 0 },
  { id: 'metrics-gate', name: 'リズムの光ゲート', type: 'barrier', hp: 3, clearance: .36, advice: 'かたいゲート。火力を育てるか浮こ', stage: 3 },
  { id: 'approval-queue', name: 'くるくる飾りの小道', type: 'pothole', hp: 1, clearance: .25, advice: '待たんでええ。飛んで抜けよ', stage: 2 },
].map(Object.freeze));

export const LITTLE_FINDS = Object.freeze([
  { id: 'star-charm', name: 'ちいさな星チャーム', line: 'ちっちゃい星みっけ。次の衣装につけよ！' },
  { id: 'flower', name: '道ばたの花の写真', line: '道ばたの花、写真に残そ。咲いたままがかわいいな。' },
  { id: 'paw-sticker', name: '肉球ステッカー', line: 'ちいさな肉球シール！ ラジオの横に貼ろか。' },
  { id: 'mini-photo', name: 'ふたりのミニフォト', line: 'この一枚、ええ顔してる。今日の思い出やな。' },
  { id: 'deco-charm', name: 'キラキラのデコチャーム', line: 'このチャーム、デコ電にぴったり。好きな色、足してこ！' },
  { id: 'puri-note', name: '手描きのプリ帳シール', line: '余白に今日のクラブ名書こ。ふたりのプリ帳、またにぎやかになるな。' },
].map(Object.freeze));

function hash(value) {
  let result = 2166136261;
  for (const letter of String(value)) result = Math.imul(result ^ letter.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function decorateEncounter(actor, stage, seed) {
  if (actor.headliner || actor.elite) return actor;
  const roll = hash(`${seed}:${stage}:${actor.encounterId}:${actor.phraseIndex}`);
  if (actor.type === 'salaryman') {
    // Close crowd groups use light suits so one short relay can clear the pair.
    const available = STREET_ROLES.filter(role => role.stage <= stage && role.behavior === actor.behavior &&
      (!actor.cluster || SUIT_STYLES[role.id].minimumHp === 1));
    const role = actor.tutorial ? STREET_ROLES[0] : available[roll % available.length];
    if (!role) return actor;
    const stamina = SUIT_STYLES[role.id].minimumHp;
    return Object.freeze({ ...actor, streetRole: role,
      hp: Math.max(actor.hp || 1, stamina), maxHp: Math.max(actor.maxHp || actor.hp || 1, stamina) });
  }
  if (actor.tutorial || roll % 5 === 0) return actor;
  const available = ROUTINE_HAZARDS.filter(hazard => hazard.type === actor.type && hazard.stage <= stage);
  const hazard = available[roll % available.length];
  return hazard ? Object.freeze({ ...actor, routineHazard: hazard, hp: hazard.hp, maxHp: hazard.hp,
    telegraph: Object.freeze({ ...actor.telegraph, label: `${hazard.name} / ${hazard.advice}` }) }) : actor;
}

export function littleFindAt(seed, index) {
  return LITTLE_FINDS[(hash(seed) + index) % LITTLE_FINDS.length];
}
