/** A fictional six-night tour. Story memory never grants money or changes a run.
 * All selectors and memory helpers are pure; callers explicitly persist results.
 * Route indices describe twelve local roads, not interstate travel distances.
 */
export const STORY_VERSION = 1;
export const STORY_SPEAKERS = Object.freeze({ arisu: 'DJありねぇ', chana: 'DJちゃな' });
const CITIES = ['中野', '新宿', '渋谷', '浅草', '大阪', '京都'];
const CLUBS = ['BEAT BASE 175', 'PINK FLASH', 'NEON LEOPARD', 'LANTERN BASS', 'BASS TAKOYAKI', 'GALAXY FLOOR'];
const line = (speaker, text) => ({ speaker, text });
const a = text => line('arisu', text);
const c = text => line('chana', text);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const scenes = new Map();
function register(id, kicker, summary, lines, extra = {}) {
  const value = freeze({ id, kicker, summary, lines, ...extra });
  scenes.set(id, value);
  return value;
}

register('tour:opening', 'NIGHTFALL MIX / ふたりで、六つの音を。',
  '六つの街の架空のクラブでサウンドチェックを録り、京都で一本のミックスにつなぐ。', [
    c('六つの街で音を集めて、京都でひとつのミックスにしよ！ 最初は中野や。'),
    a('各街で二本の道を走って、クラブで音を録る。都市間は別の日に移動やで。'),
    c('うちはナビとハートの招待状！ 気になった人が、好きな格好のまま遊びに来てくれたらええな。'),
    a('運転はうち。電池と車を守って、ふたりで最後まで届けよ。今回、何を大事にする？'),
  ], { choices: [
    { id: 'crew', label: '出会った仲間の声をつなぐ', description: '街の人との出会いを、ふたりの会話に残す。能力や報酬は変わりません。' },
    { id: 'discovery', label: '街ごとの違う音を見つける', description: '道や音の発見を、ふたりの会話に残す。能力や報酬は変わりません。' },
  ] });

const DEPARTURES = [
  [c('中野の一晩目、スタート！ 招待状はうちから届けるで。'), a('まずは道に慣れよ。浮くと電池を使う。充電ポイントは見逃さんとこ。')],
  [c('街角まで来たな！ 次はBEAT BASE 175のサウンドチェックや。'), a('ここからクラブまでの道を選ぼ。充電、街角イベント、整備。今の車に必要なんはどれや？')],
  [a('次のツアーナイトは新宿。休んで移動して、今日はここからや。'), c('中野で録った音、持ってきたで。今夜はネオンみたいに跳ねる音、探そ！')],
  [c('PINK FLASHまで、あと一本道！ 看板多いけど、目印は確認したで。'), a('人波の前で慌てんようにな。届く距離で招待して、道が詰まったら浮いて抜けよ。')],
  [c('今夜は渋谷！ 二つの街の音に、どんな跳ね方足そかな。'), a('比べて勝ち負け決める旅ちゃうしな。ここの音をちゃんと聞こ。')],
  [a('NEON LEOPARDへ向かうで。段差と人波、両方見とこ。'), c('了解！ 招待状に返事くれたらうれしいし、見送る人にもええ夜を、やな。')],
  [a('浅草の夜。今日は四つ目の音を録る。'), c('提灯の色、ええなあ。どんどん派手にするだけやなくて、間も気持ちよくしたい！')],
  [c('LANTERN BASSの音出しまで、あと一本道や。'), a('ここが東京側の最後の夜。終わったら荷物まとめて、別の日に関西へ移動やで。')],
  [a('東京での四夜が終了。移動と休息をはさんで、ここから大阪のツアーナイトや。'), c('地図一枚ぶんワープしたんちゃうで！ 車もふたりも整えてきた。五つ目の音、録りにいこ！')],
  [c('BASS TAKOYAKIまで行こ！ 名前だけでおなか鳴りそうや。'), a('先にサウンドチェックな。低音に混ざったら、どっちの音か分からん。')],
  [a('大阪の夜を終えて、改めて京都へ。最終日はこの街から始めるで。'), c('五つの録音、確認できた！ 六つ目を重ねて、みんなの夜をつなご！')],
  [c('GALAXY FLOORまで、最後の一本道！'), a('ラストやからこそ、残量見て落ち着いてな。六つ目の音を録って、ミックスを完成させよ。')],
];
const ARRIVALS = [
  [a('中野の街角に着いた。まだ録音はこれからや。'), c('次はクラブへの道！ 充電多めにするか、仲間に声かけにいくか、選ぼ！')],
  [c('中野のサウンドチェック、録れた！ 最初の一本や。'), a('始まりの音はこれでええ。今夜はここまで。次の新宿に備えよ。')],
  [a('新宿の街角を抜けた。クラブは次の道やで。'), c('街で手ぇ振ってくれた人おったな！ あのテンション、音に連れていきたい。')],
  [c('新宿の音も録れた！ 二つとも違うのに、一緒に鳴らしたらええ感じや。'), a('無理に揃えんでええ。その違いをつなぐんが、ミックスやしな。')],
  [c('渋谷の街角、到着！ 次の道でクラブに向かお。'), a('電池と車、見直すなら今や。盛り上がる準備にも休憩は要る。')],
  [a('渋谷のサウンドチェック、保存できた。これで三つ。'), c('半分や！ でも同じこと三回した感じちゃうな。街ごとに返ってくるノリが違う！')],
  [a('浅草の街角に到着。あと一本道で今日の音出しや。'), c('賑やかなところも静かなところも、ちゃんと覚えとこ。どっちもこの街やもんな。')],
  [c('浅草の音、録れた！ 東京の四つ、揃ったで。'), a('今夜は片付けて休も。関西への長距離移動は次の日程。次のプレイは大阪の街からや。')],
  [c('大阪の街角、到着！ 笑って手ぇ振ってくれた人、おったな。'), a('来たい人が来てくれたらええ。次はクラブで、ちゃんと音返そ。')],
  [a('大阪のサウンドチェックも録れた。五つ揃ったな。'), c('最後は京都！ 今日は休んで、次の夜に全部つなご。ここで無茶して終わったらもったいない！')],
  [a('京都の街角まで来た。最後のクラブは次の道や。'), c('五つの音を持って、六つ目に会いにいく。なんか、荷物より気持ちのほうが大きいな。')],
  [c('京都の音も録れた！ 六つ、全部ここにあるで。'), a('十二本の道、完走。ほな、最後のミックスを始めよか。')],
];

for (let route = 0; route < 12; route++) {
  const city = Math.floor(route / 2), night = String(city + 1).padStart(2, '0');
  register(`departure:${route}`, `NIGHT ${night} / ${CITIES[city]} / ${route % 2 ? 'クラブへの道' : '街角への道'}`,
    `${CITIES[city]}の${route % 2 ? 'クラブ' : '街角'}へ出発。`, DEPARTURES[route]);
  register(`arrival:${route}`, route % 2 ? `SOUNDCHECK ${city + 1} / 6 / ${CLUBS[city]}` : `ROAD CLEAR / ${CITIES[city]}`,
    route % 2 ? `${CITIES[city]}のサウンドチェックを録音。${city + 1}本目。` : `${CITIES[city]}の街角に到着。クラブへの道を選ぶ。`, ARRIVALS[route]);
  register(`retry:${route}:first`, `PIT STOP / ${CITIES[city]} / もう一度、ここから。`,
    `${CITIES[city]}で車と作戦を立て直した。`, [
      a('いったん安全なピットへ戻ろ。今回の道の前まで巻き戻して、準備し直せるで。'),
      c('前の街で録った音と、道の選び方は残ってる！ 今回の道の途中で拾った分は、やり直しやな。'),
      a('次は充電の場所と、浮くタイミングを見よ。急がんでも、次の一本は録れる。'),
    ]);
  register(`retry:${route}:again`, `PIT STOP / ${CITIES[city]} / 作戦を変えてみよ。`,
    `${CITIES[city]}の同じ道に再挑戦。`, [
      c('同じ道でも、同じ走り方せんでええもんな。'),
      a('せやな。ハートはうちが浮く前に。充電中は浮上を休める。それだけでも変わるで。'),
    ]);
}

register('tour:finale', 'FINAL MIX / 六つの街、ひとつの夜。',
  '京都で六つのサウンドチェックをつなぎ、ふたりのツアーミックスが完成した。', [
    c('中野、新宿、渋谷、浅草、大阪、京都。六つの音、つながった！'),
    a('同じ音にせんでよかったな。違うまま、ひとつのセットになった。'),
    c('遊びに来た人も、道で手ぇ振ってくれた人も。みんな、好きな自分のままでええ夜にしよ！'),
    a('ギャルインザミックス、準備完了。ほな、音出すで。'),
  ]);

const FOCUS_LINES = freeze({
  crew: {
    'arrival:1': c('最初に来てくれた人の声、覚えとこ。最後の夜にも、この気持ち持っていくで。'),
    'arrival:5': a('仲間の声をつなぐって、決めたもんな。人数だけやなくて、どんな夜やったか残そ。'),
    'arrival:9': c('街が変わっても、返ってくる笑顔はちゃんとうれしいな。京都でも会えたらええな！'),
    'tour:finale': c('最初に決めた通り、仲間の声をつないだミックスや。ひとりひとり、ありがとうな！'),
  },
  discovery: {
    'arrival:1': a('最初の音、見つけたな。次の街では違う鳴り方を探そ。'),
    'arrival:5': c('街ごとの音、ほんまに違う！ 道を選ぶたび、耳まで寄り道してる気分や。'),
    'arrival:9': a('五つとも違っててええ。京都の音が入ったら、どこをつなぐか楽しみやな。'),
    'tour:finale': a('違う音を探すって決めて、最後まで聞いてきた。これがうちらのツアーミックスや。'),
  },
});

const knownId = value => typeof value === 'string' && scenes.has(value);
const list = value => Array.isArray(value) ? value : [];

/** Sanitize local persisted state. Unknown scene/choice IDs are discarded. */
export function normalizeStoryMemory(value = {}) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const seen = [...new Set(list(value.seen).filter(knownId))];
  const choices = {};
  for (const [id, scene] of scenes) {
    const chosen = value.choices && Object.hasOwn(value.choices, id) ? value.choices[id] : null;
    if (scene.choices?.some(choice => choice.id === chosen)) choices[id] = chosen;
  }
  return { version: STORY_VERSION, seen, choices, history: list(value.history).filter(knownId).slice(-48) };
}

/** Record display only after the player has actually seen a scene. */
export function markStorySeen(memory, id) {
  const next = normalizeStoryMemory(memory);
  if (!knownId(id)) return next;
  if (!next.seen.includes(id)) next.seen.push(id);
  if (next.history.at(-1) !== id) next.history = [...next.history, id].slice(-48);
  return next;
}

/** Narrative decisions are recorded once. No coins, stats or route are changed.
 * Choice definitions are resolved from our catalog, never trusted from callers.
 */
export function chooseStoryOption(memory, scene, id) {
  let next = normalizeStoryMemory(memory);
  const canonical = scenes.get(scene?.id);
  if (!canonical?.choices?.some(choice => choice.id === id) || Object.hasOwn(next.choices, canonical.id)) return next;
  next = markStorySeen(next, canonical.id);
  next.choices[canonical.id] = id;
  return next;
}

/** Journal has plain display data; it contains no HTML or simulation effects. */
export function getStoryJournal(memory) {
  return normalizeStoryMemory(memory).history.map(id => {
    const { kicker, summary } = scenes.get(id);
    return { id, kicker, summary };
  });
}

/** Triggers: opening, departure, arrival, retry, finale.
 * Selects deterministic authored scenes; never marks scenes as seen itself.
 */
export function getStoryScene(state = {}, trigger, memory = {}) {
  if (!state || typeof state !== 'object') return null;
  const route = state.routeIndex ?? 0;
  if (!Number.isInteger(route) || route < 0 || route >= 12) return null;
  const progress = normalizeStoryMemory(memory);
  let id;
  switch (trigger) {
    case 'opening': if (route !== 0) return null; id = 'tour:opening'; break;
    case 'departure': id = `departure:${route}`; break;
    case 'arrival': if (state.status !== 'won') return null; id = `arrival:${route}`; break;
    case 'retry':
      if (state.status === 'won') return null;
      id = `retry:${route}:${progress.seen.includes(`retry:${route}:first`) ? 'again' : 'first'}`;
      break;
    case 'finale':
      if (route !== 11 || state.status !== 'won') return null;
      id = 'tour:finale'; break;
    default: return null;
  }
  if (trigger !== 'retry' && progress.seen.includes(id)) return null;
  const source = scenes.get(id);
  const focus = FOCUS_LINES[progress.choices['tour:opening']]?.[id];
  return {
    id: source.id,
    kicker: source.kicker,
    lines: [...source.lines, ...(focus ? [focus] : [])].map(item => ({ ...item })),
    ...(source.choices ? { choices: source.choices.map(choice => ({ ...choice })) } : {}),
  };
}
