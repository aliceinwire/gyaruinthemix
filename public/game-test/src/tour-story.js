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

register('tour:opening', 'NIGHTFALL MIX / 好きな音で、街をひらこ。',
  'DJありねぇとDJちゃなは、平成ギャルのスタイルとオリジナル曲を六つの街のクラブへ届ける。', [
    c('街じゅう会社の広告、服も音も「指定どおり」やって。うちらの夜まで、決められてたまるか！'),
    a('中野から京都まで、六つのクラブでDJする。平成ギャルの盛りと、うちらのハードバウンスを持ってな。都市間は別の日に移動やで。'),
    c('オリジナル曲、175 BPMで鳴らそ！ 各街のサウンドチェックも録って、最後はみんなの声をつないだセットや！'),
    a('道と装備は選べる。運転はうち、音はふたりで。好きな格好で、好きに踊れる場所を増やそ。何を大事にする？'),
  ], { choices: [
    { id: 'crew', label: '出会った仲間の声をつなぐ', description: '街の人との出会いを、ふたりの会話に残す。能力や報酬は変わりません。' },
    { id: 'discovery', label: '街ごとの違う音を見つける', description: '道や音の発見を、ふたりの会話に残す。能力や報酬は変わりません。' },
  ] });

const DEPARTURES = [
  [c('中野からツアー開始！ 通勤の列にも、好きな音ひとつぐらい持っててええやんな。'), a('まずはBEAT BASE 175へ。浮くと電池を使うから、充電ポイントも見とこ。')],
  [c('「予定にない楽しみは禁止」って看板や。予定、今から足したらええやん！'), a('会議が終わった人も、今日は休みの人も。来たい人をBEAT BASE 175へ誘お。')],
  [a('次の夜は新宿。ビルも画面も同じ会社の広告やな。うちらの出演ポスター、埋もれとる。'), c('ほなPINK FLASHまで、うちらの音で道つくろ！ 中野の録音も一緒やで。')],
  [c('PINK FLASHの前、広告係が「人気の音だけ」やって。うちらの曲、まだ聴いてへんやろ！'), a('流行に合わせるより、ちゃんと鳴らして届けよ。気に入った人が次の人を連れてくれる。')],
  [c('渋谷や！ 「その髪、その服、規定外」って、街にまで服装チェックあんの？'), a('平成ギャルの盛りは置いてかへん。NEON LEOPARDで、自分で選ぶ楽しさも見せよ。')],
  [a('NEON LEOPARDへ。コピーされたポーズより、ふたりの今日の一枚やな。'), c('モデルも撮影も、正解ひとつにせんでええ！ 遊びに来る子も、好きな格好でおいでや。')],
  [a('浅草。工房の手仕事まで、同じ速さと形に揃えろと言われとる。'), c('手描きの提灯も、ちっちゃい花も、違うからかわいいねん。LANTERN BASSで、その色ごと鳴らそ！')],
  [c('LANTERN BASSの飾り、職人さんが一個ずつ色変えてくれたで。どれも主役やな！'), a('音もそうしよ。うちらのハードバウンスに、この街の手拍子を重ねる。ねこは静かな場所で休ませとこな。')],
  [a('移動と休息をはさんで大阪へ。工場の終業ベルのあとまで、ノルマの通知が追いかけてくるんか。'), c('今夜はBASS TAKOYAKIの出番や！ 仕事終わりの時間は、自分の好きに使お！')],
  [c('イベント係まで数字の報告ばっか。うちらの出演、笑った顔で覚えてもらいたいわ！'), a('BASS TAKOYAKIでええセットにしよ。撮りたい人も、踊りたい人も、それぞれ楽しめるようにな。')],
  [a('大阪の夜を終えて京都へ。最後のGALAXY FLOORには、出演許可の書類が山積みや。'), c('五つの街で仲間できたやん。うちらだけで抱えんと、みんなで今夜のフロア開こ！')],
  [c('GALAXY FLOOR、最後の一本道！ 各街から「聴くで」って連絡きてる！'), a('残量見て、最後まで落ち着いて。六つ目の録音を重ねて、うちらの曲で自由な夜をつなご。')],
];
const ARRIVALS = [
  [a('中野の街角に到着。予定表を閉じて、ポスターを見に来た人がおる。'), c('寄り道ひとつで顔変わるな！ 次はクラブ。充電か、出会いか、整備か、地図で選ぼ！')],
  [c('BEAT BASE 175、オリジナル曲で踊ってくれた！ スーツのままの人も、めっちゃええ顔やった！'), a('中野のサウンドチェックを一本目に。好きな時間を取り戻した声、京都のセットにも連れていこ。')],
  [a('新宿の街角まで来た。広告を配ってた人が、今はうちらのポスターを見てる。'), c('好きなもの、自分で選んでええねん。PINK FLASHで、曲の続きを聴いてって！')],
  [c('PINK FLASH、ハードバウンスで跳ねたな！ 撮影の子も、自分の構図で撮ってくれた！'), a('新宿のサウンドチェック、二本目。大きい広告より、今日ここで聴いた音を覚えてもらえたらええ。')],
  [c('渋谷の街角、到着！ 規定の上着を脱いだ子、めっちゃ好きな色着てたな。'), a('脱がん人も自由やで。着るもんも踊り方も、本人が決めたらええ。次はNEON LEOPARDや。')],
  [a('NEON LEOPARDのセット終了。渋谷のサウンドチェックで三本目や。'), c('平成ギャルもスーツも、一緒に踊ってた！ 同じ格好にせんでも、同じフロアになれるんやな。')],
  [a('浅草の街角に到着。量産の看板の横に、手描きの小さな案内が戻ってる。'), c('あの花は摘まんと写真に残そ。ちっちゃい好きも、LANTERN BASSまで連れてこ！')],
  [c('LANTERN BASS、手拍子と175 BPMがぴったりやった！ 浅草の録音で四本目！'), a('工房のみんなも、今日は自分のペースで楽しめたな。片付けて休も。関西への長距離移動は次の日程や。')],
  [c('大阪の街角や！ 通知切って遊びに行くって。さっきまで締切追ってた人やんな？'), a('休む時間も自分のもんや。BASS TAKOYAKI、来たい人にええ音を返そ。')],
  [a('BASS TAKOYAKI、無事にプレイできた。大阪のサウンドチェックで五本目。'), c('「また来て」って言われたで！ 撮影もイベントも、数字よりこの顔やな。次の京都まで、今日は休も！')],
  [a('京都の街角に到着。入口の準備、各街で出会った仲間も手伝ってくれとる。'), c('服の承認印はいらんで。GALAXY FLOOR、好きな自分で入れるフロアにしよ！')],
  [c('京都のサウンドチェックも録れた！ 六つの街の声と、うちらの曲、全部ここにある！'), a('十二本の道、完走や。クラブの扉は開いた。ほな、最後のセットを始めよか。')],
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
      a('せやな。装備の届く距離を見て、電池は充電所で整える。浮くタイミングだけでも変わるで。'),
    ]);
}

register('tour:finale', 'FINAL MIX / 六つの街、ひとつの夜。',
  '六つの街で届けたオリジナル曲と出会った人の声が、京都の自由なフロアでつながった。', [
    c('中野、新宿、渋谷、浅草、大阪、京都！ うちらの曲に、六つの街の声が重なった！'),
    a('会社のルールが全部なくなったわけやない。でも、好きに踊れる場所は六つ、ちゃんとつながった。'),
    c('平成ギャルも、初めてクラブ来た人も！ 明日の自分まで誰かに決めさせんと、今夜は好きに楽しも！'),
    a('DJちゃな、準備ええな。ギャルインザミックス、175 BPM。うちらの音、鳴らすで。'),
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
      if (state.status === 'won' || state.mode === 'survival') return null;
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
