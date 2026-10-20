/** Fictional obstacles to self-expression. People become fans; animals are
 * scenery, never collision targets. Decoration preserves reserved road space. */
export const STREET_ROLES = Object.freeze([
  { id: 'salaryman', name: 'スーツの通勤人', behavior: 'steady', stage: 0, fan: 'dj', welcome: '定時のあとは、好きな音で踊ろ！' },
  { id: 'brand-rep', name: '巨大企業の広告係', behavior: 'steady', stage: 1, fan: 'model', welcome: '会社のロゴより、自分のスタイルや！' },
  { id: 'copy-clerk', name: 'コピペ係', behavior: 'sway', stage: 2, fan: 'photographer', welcome: '同じ写真ばっかやめて、うちらの一枚撮ろ！' },
  { id: 'meeting-host', name: '終わらん会議の司会', behavior: 'shield', stage: 3, fan: 'tv', welcome: '会議は閉じて、テレビの出番いこ！' },
  { id: 'deadline-runner', name: '締切ダッシュ係', behavior: 'charger', stage: 4, fan: 'event', welcome: '追うなら締切より、楽しそうな現場や！' },
  { id: 'approval-chief', name: '承認待ちの番人', behavior: 'shield', stage: 5, fan: 'stylist', welcome: '好きな服に、ハンコはいらへん！' },
].map(Object.freeze));

export const ROUTINE_HAZARDS = Object.freeze([
  { id: 'paper-stack', name: 'おかわり書類', type: 'cone', hp: 1, clearance: .17, advice: 'ハート1発か、短く浮こ', stage: 0 },
  { id: 'deadline-clock', name: '締切タイマー', type: 'cone', hp: 1, clearance: .2, advice: 'ハート1発でオフ。浮いてもOK', stage: 1 },
  { id: 'ad-totem', name: '巨大企業の広告タワー', type: 'barrier', hp: 2, clearance: .4, advice: 'ハート2発か、上を越えよ', stage: 1 },
  { id: 'meeting-wall', name: '終わらん会議ボード', type: 'barrier', hp: 2, clearance: .32, advice: 'ハート2発でおひらきや', stage: 2 },
  { id: 'copy-printer', name: '無限コピー機', type: 'barrier', hp: 3, clearance: .32, advice: 'ハート3発。早めに撃つか浮こ', stage: 3 },
  { id: 'task-loop', name: '作業ループの溝', type: 'pothole', hp: 1, clearance: .25, advice: 'ハートは通らへん。飛んで抜けよ', stage: 2 },
].map(Object.freeze));

export const LITTLE_FINDS = Object.freeze([
  { id: 'star-charm', name: 'ちいさな星チャーム', line: 'ちっちゃい星みっけ。次の衣装につけよ！' },
  { id: 'flower', name: '道ばたの花の写真', line: '道ばたの花、写真に残そ。咲いたままがかわいいな。' },
  { id: 'paw-sticker', name: '肉球ステッカー', line: 'ちいさな肉球シール！ ラジオの横に貼ろか。' },
  { id: 'mini-photo', name: 'ふたりのミニフォト', line: 'この一枚、ええ顔してる。今日の思い出やな。' },
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
    const available = STREET_ROLES.filter(role => role.stage <= stage && role.behavior === actor.behavior);
    const role = actor.tutorial ? STREET_ROLES[0] : available[roll % available.length];
    return role ? Object.freeze({ ...actor, streetRole: role }) : actor;
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
