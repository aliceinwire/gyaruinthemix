/** Fictional obstacles to self-expression. People become fans; animals are
 * scenery, never collision targets. Decoration preserves reserved road space. */
export const STREET_ROLES = Object.freeze([
  { id: 'salaryman', name: 'スーツの通勤人', behavior: 'steady', stage: 0, fan: 'dj', welcome: '定時のあとは、好きな音で踊ろ！' },
  { id: 'brand-rep', name: '流行おしの広告係', behavior: 'steady', stage: 0, fan: 'model', welcome: '流行もええけど、うちの好きも見つけよ！' },
  { id: 'copy-clerk', name: 'コピペ係', behavior: 'sway', stage: 2, fan: 'photographer', welcome: '同じ写真ばっかやめて、うちらの一枚撮ろ！' },
  { id: 'meeting-host', name: '終わらん会議の司会', behavior: 'shield', stage: 3, fan: 'tv', welcome: '会議は閉じて、テレビの出番いこ！' },
  { id: 'deadline-runner', name: '締切ダッシュ係', behavior: 'charger', stage: 4, fan: 'event', welcome: '追うなら締切より、楽しそうな現場や！' },
  { id: 'approval-chief', name: '承認待ちの番人', behavior: 'shield', stage: 5, fan: 'stylist', welcome: 'その服、好きなら着てみよ！' },
  { id: 'notification-clerk', name: '通知おかわり係', behavior: 'steady', stage: 0, fan: 'photographer', welcome: '通知はミュート。今この瞬間を撮ろ！' },
  { id: 'metrics-inspector', name: '数字ばっかり監査官', behavior: 'sway', stage: 2, fan: 'dj', welcome: '数字よりノリや。好きな音、回してこ！' },
  { id: 'dress-code-guard', name: '無難コーデの番人', behavior: 'shield', stage: 3, fan: 'model', welcome: '着たい服でええねん。ここから、うちだけのランウェイや！' },
  { id: 'overtime-runner', name: '残業ぐるぐる係', behavior: 'charger', stage: 4, fan: 'event', welcome: '残業はおしまい。今夜のイベント間に合うで！' },
  { id: 'script-reader', name: 'マニュアル読み上げ係', behavior: 'steady', stage: 1, fan: 'tv', welcome: '台本の外にも、うちの言葉あるで！' },
  { id: 'hierarchy-keeper', name: '肩書きタワーの番人', behavior: 'shield', stage: 5, fan: 'stylist', welcome: '肩書きより、そのアクセめっちゃ似合う！' },
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
  if (actor.converted || actor.headliner || actor.elite || actor.type !== 'salaryman') return null;
  return SUIT_STYLES[actor.streetRole?.id] || SUIT_STYLES.salaryman;
}

export const ROUTINE_HAZARDS = Object.freeze([
  { id: 'paper-stack', name: 'おかわり書類', type: 'cone', hp: 1, clearance: .17, advice: '攻撃で片づく。短く浮いてもOK', stage: 0 },
  { id: 'deadline-clock', name: '締切タイマー', type: 'cone', hp: 1, clearance: .2, advice: '攻撃でオフ。浮いてもOK', stage: 1 },
  { id: 'ad-totem', name: '流行だらけの広告タワー', type: 'barrier', hp: 2, clearance: .4, advice: '攻撃で崩すか、上を越えよ', stage: 1 },
  { id: 'meeting-wall', name: '終わらん会議ボード', type: 'barrier', hp: 2, clearance: .32, advice: '攻撃でおひらき。上も通れるで', stage: 2 },
  { id: 'copy-printer', name: '無限コピー機', type: 'barrier', hp: 3, clearance: .32, advice: 'かたいコピー機。火力を育てるか浮こ', stage: 3 },
  { id: 'task-loop', name: '作業ループの溝', type: 'pothole', hp: 1, clearance: .25, advice: '攻撃は通らへん。飛んで抜けよ', stage: 2 },
  { id: 'inbox-pile', name: '未読メールの山', type: 'cone', hp: 1, clearance: .2, advice: '攻撃で受信箱を空に。浮いてもOK', stage: 0 },
  { id: 'notification-tower', name: '鳴りっぱなし通知塔', type: 'barrier', hp: 2, clearance: .4, advice: '攻撃でミュート。上から抜けてもOK', stage: 0 },
  { id: 'metrics-gate', name: 'ノルマの数字ゲート', type: 'barrier', hp: 3, clearance: .36, advice: 'かたいゲート。火力を育てるか浮こ', stage: 3 },
  { id: 'approval-queue', name: '承認待ちの行列', type: 'pothole', hp: 1, clearance: .25, advice: '待たんでええ。飛んで抜けよ', stage: 2 },
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
