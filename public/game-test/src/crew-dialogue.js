import { getJourneyNode } from './journey.js';
import { resolveCrewActions } from './character-actions.js';

/** Pure dialogue selectors. Time is simulation seconds, never wall-clock time.
 * Keep an existing action/toast visible until its hold expires before showing
 * ambient dialogue. Event selection never mutates or consumes state.events.
 */
export const CREW_DIALOGUE_BUCKET_SECONDS = 8;
const SPEAKERS = { arisu: 'DJありねぇ / ドライバー', chana: 'DJちゃな / ナビ担当' };
const CREATIVE = [
  '同じ服、同じ作業、同じ音。うちらのオリジナル曲は、その枠に収まらへんで。',
  '平成のデコケータイに、今日の出演メモ。古い好きと、新しい曲、どっちも連れてこ。',
  '強めメイクもヒョウ柄も、うちの好きや。相手まで同じにせんでええやんな。',
  'DJもテレビもイベントも、うちららしく出たいな。見つけてくれる人、もっと増やそ！',
  'プリ帳の余白、まだあるで。ライブのあと、来たい子と今日の日付も書きたいな。',
  'EVのそば、ねこ休んでる。遠くからそっと見守ろな。',
  'MDの手書きラベル、字ぃはみ出した。キラキラのシールで囲んだら、ええ感じやん。',
];
const CITY = {
  nakano: ['中野のBEAT BASE 175へ！ 予定表にない楽しみ、今夜つくろ。', '中野の小さい店、手描きのフライヤー貼ってくれた。うちらの出番、届いてるな。', '中野、角を曲がるたび景色変わるな。ナビ任せてや。'],
  shinjuku: ['新宿の広告、同じ曲ばっかやな。PINK FLASHでは、うちらの曲かけるで。', '新宿の看板、まぶしいな。ケータイのストラップも光ってる。地図はちゃんと見えてるで。', '新宿のビル、背ぇ高いなあ。地図は上向けても伸びへんか。'],
  shibuya: ['渋谷、好きな服で出かけると気分上がるな。うちはこの盛りでNEON LEOPARDへ！', '渋谷で撮るプリ、星も日付も盛りたいな。まずはクラブまで案内するで。', '渋谷まで来たな。地図のピンも踊りたそうやん。'],
  asakusa: ['浅草の手描きの提灯、色が一個ずつ違う。LANTERN BASSも、あの感じで飾りたいな。', '浅草、ゆっくり眺めたいな。案内は任せとき。', '浅草の灯り、じんわりくるわ。音もあったかめにしたなるな。'],
  osaka: ['大阪の夜、やることリストはひと休み。BASS TAKOYAKIで、自分の時間取り戻そ。', '大阪の夜、招待するで。気になったら遊びに来てな。', '移動と休憩、ちゃんと取れたな。今日は大阪の道からや。'],
  kyoto: ['京都のGALAXY FLOOR、もうすぐや。ここまでの五つのクラブの録音、最後のセットにつなご。', '京都、曲がり角まで絵になるやん。ナビは任せて。', '最後のクラブやな。MDのラベル、順番確認できた。あとはうちらのセットや！'],
};
const ROAD = {
  scenic: ['ゆったりルートや。景色と充電スポット、両方チェックするで。', 'この道、充電スポット多めやな。電池にも休憩いるもんな。', '遠回りもええな。地図の余白まで楽しめるやん。'],
  express: ['特急ルート、充電スポット少なめや。残量見とくで。', '近道やけど人多いな。装備に任せて、抜けられる道を見よ。', '特急ルートや。次の充電場所、地図で先に探しとくな。'],
};
ROAD.ev = ROAD.scenic;
ROAD.event = ['街角イベントの道や。人波多め、招待に返事くれたらコインも多めやで。'];
ROAD.service = ['整備ピットへの近道や。充電所は少なめ、着いたら車を直してもらお。'];
const WEATHER = {
  sunny: ['晴れてるな。窓の光、ラメにちょうどええわ。', 'ええ天気や。地図も見やすいし、案内は順調やで。'],
  cloudy: ['曇り空やな。街の色はよう見えるで。', '雲多いな。まぶしないぶん、地図読みやすいわ。'],
  rain: ['雨やな。屋根閉まってて助かるわ、前髪も地図も。', '雨粒、リズム刻んでるな。路面は慎重にいこ。'],
  storm: ['風も雨も強いな。前の道、しっかり見ていくで。', '嵐でも案内は落ち着いてな。地図まで荒れたら困るわ。'],
  snow: ['雪やな。白い道、慎重にいこか。', '雪景色きれいやな。地図の線まで白くならんでええで。'],
  fog: ['霧やな。見えるところから、落ち着いていこ。', '景色かくれてるな。地図の出番や、任せとき。'],
  mud: ['泥道やな。ありねぇ、運転よろしく。うちは先の道見るで。', '泥はねてるな。車の模様、増えてもうた。'],
  wind: ['風あるな。紙の地図、飛ばされんよう押さえとくわ。', '風、強めやな。前髪より先に道の確認や。'],
};
const SEASON = {
  spring: ['春の色、やわらかいな。今日の音も軽やかにいこ。', '春やなあ。景色がちょっと明るく見えるわ。'],
  summer: ['夏の夜やな。街も、元気あり余ってるやん。', '夏の景色、色濃いな。地図の青まで涼しそうや。'],
  autumn: ['秋の色、ええな。次のメイク、この色にしよかな。', '秋やな。街の色が落ち着いてて、よう見えるわ。'],
  winter: ['冬やな。うちはナビ、ありねぇは運転、ぬくぬく連携や。', '冬の空気、きりっとしてるな。道案内もしゃきっといくで。'],
};
const ACTION = {
  map: ['地図チェック中や。ぐるぐる回しても近道は増えへんな。', '次の道、地図で確認したで。案内は任せとき。', '地図の向き、合ってるで。うちの方向感覚も今んとこ順調や。'],
  directions: ['次の道、こっちやで。ありねぇ、前は任せた！', '案内するで。曲がるところはちゃんと言うからな。'],
  makeup: ['鏡チェック、口紅よし。次は地図に戻るで。', '助手席でメイク直し中や。ありねぇは運転に集中してな。', 'リップ整ったで。ナビの精度まで上がった気するわ。'],
  hearts: ['ハートの招待状、うちから届けるで。ありねぇは運転よろしく！', 'ちゃなのハート便や。気になったら、そのままの格好で遊びに来てな。'],
  flash: ['その笑顔、今や！ 助手席から一枚、ばっちり撮れたで。'],
  vinyl: ['レコードつなぐで。次の一曲、うちらのノリで決めよ！'],
  bass: ['この低音、たまらんな！ 助手席でも肩が勝手に揺れるわ。'],
  phone: ['デコ電つながった！ 今夜うちらの出番やで、クラブで会おな！'],
  cd: ['このCD、やっぱええ音やな。次に聴く一枚も、手元に用意したで。'],
  cassette: ['カセット、頭出しできたで。この曲から、ゆっくり上げてこ。'],
  cheer: ['ええ調子やん！ ありねぇ、前は任せたで。', '助手席から応援するで。招待もナビも、うちに任せて！'],
  rush: ['息合わせていくで！ ありねぇ、運転よろしく！', 'ふたりのタイミング、ぴったりやん！'],
};
const EVENTS = {
  lost: { priority: 100, holdSeconds: 6, speaker: 'arisu', lines: ['安全なピットへ戻ろ。車もふたりも、いったん休憩や。'] },
  won: { priority: 100, holdSeconds: 6, speaker: 'arisu', lines: ['着いたで。ナビも招待も、ええ連携やったな。'] },
  collision: { priority: 90, speaker: 'arisu', lines: ['おっと、立て直すで。前の道、もう一回確認や。', 'ぶつかったな。落ち着いて、ハンドル戻すで。'] },
  'rush-start': { priority: 80, lines: ACTION.rush },
  charged: { priority: 75, lines: ['充電いっぱいや！ 電池のごきげん、満点やな。'] },
  'charge-start': { priority: 70, lines: ['充電中やで。ここで息整えて、次の街角へ行こ。'] },
  'charge-stop': { priority: 65, lines: ['充電おしまい。残量見ながら、次へいこか。'] },
  'rush-stop': { priority: 60, lines: ['息ぴったりやったな。ほな、いつものペースでいこ。'] },
  boost: { priority: 55, speaker: 'arisu', lines: ['浮くで！ 前の道、しっかり見とくな。'] },
  'jump-clear': { priority: 50, speaker: 'arisu', lines: ['段差、越えたで。着地も落ち着いていこ。'] },
  'little-find': { priority: 48, lines: ['ちいさな好き、またひとつ増えた！'] },
  convert: { priority: 45, lines: ['招待に返事くれた！ 遊びに来てくれるん、うれしいな。', 'そのノリええやん。好きな格好のままで、フロアでも会おな！'] },
  shoot: { priority: 40, lines: ACTION.hearts },
};
const seconds = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const key = value => typeof value === 'string' ? value : value?.id || value?.type;
function makeLine(group, lines, index, { speaker = 'chana', priority = 0, holdSeconds = 4, previousId } = {}) {
  let selected = index % lines.length;
  if (`${group}:${selected}` === previousId && lines.length > 1) selected = (selected + 1) % lines.length;
  return { id: `${group}:${selected}`, text: lines[selected], speaker: SPEAKERS[speaker], priority, holdSeconds };
}

/** Pass state directly, optionally adding {time, action, previousId}.
 * Explicit/active actions take precedence over ambient rotation. */
export function selectCrewDialogue(context = {}) {
  const time = seconds(context.time ?? context.elapsed);
  const bucket = Math.floor(time / CREW_DIALOGUE_BUCKET_SECONDS);
  const weaponDriven = Object.hasOwn(context, 'crewWeaponGesture') || context.weaponDriven === true;
  const action = resolveCrewActions({ ...context, time, weaponDriven }).chana;
  const gesture = context.crewWeaponGesture;
  const activeWeapon = gesture?.elapsed >= 0 && gesture.elapsed < gesture.duration &&
    (gesture.weapon === 'heart' ? action === 'hearts' : action === gesture.weapon);
  const options = { previousId: context.previousId };
  if (context.charging) return makeLine('action:charging', EVENTS['charge-start'].lines, bucket, { ...options, priority: 30 });
  if (context.action || activeWeapon || (context.shooting && !weaponDriven && context.mode !== 'survival') || context.rushing || context.boosting) {
    return makeLine(`action:${action}`, ACTION[action] || ACTION.map, bucket, { ...options, priority: 30 });
  }
  const city = key(context.cityId) || context.route?.cityId;
  const road = getJourneyNode(context.journeyNodeId)?.kind || key(context.routeOption) || 'scenic';
  const weather = key(context.weather) === 'clear' ? 'sunny' : key(context.weather);
  const groups = [
    [`city:${city || 'unknown'}`, CITY[city] || ['この街の道、地図で確認しとくな。案内は任せて。', '次の角まで確認したで。落ち着いていこか。']],
    [`road:${road}`, ROAD[road] || ROAD.scenic],
    [`weather:${weather || 'sunny'}`, WEATHER[weather] || WEATHER.sunny],
    [`season:${key(context.season) || 'summer'}`, SEASON[key(context.season)] || SEASON.summer],
    [`action:${action}`, ACTION[action] || ACTION.map],
    ['creative', CREATIVE],
  ];
  const [group, lines] = groups[bucket % groups.length];
  return makeLine(group, lines, Math.floor(bucket / groups.length), options);
}

/** Accept one event, event name, or events array. Stable ties keep first event.
 * Returns null for unrelated events so gameplay-specific UI can remain intact. */
export function selectCrewEvent(events, context = {}) {
  const list = Array.isArray(events) ? events : [events];
  let winner;
  for (const event of list) {
    const type = typeof event === 'string' ? event : event?.type;
    if (type === 'shoot' && context.mode === 'survival') continue;
    if (EVENTS[type] && (!winner || EVENTS[type].priority > EVENTS[winner].priority)) winner = type;
  }
  if (!winner) return null;
  const config = EVENTS[winner];
  const source = list.find(event => event?.type === winner);
  if (winner === 'convert' && source?.streetRole?.welcome)
    return makeLine(`event:welcome:${source.streetRole.id}`, [source.streetRole.welcome], 0, config);
  if (winner === 'little-find' && source?.find?.line)
    return makeLine(`event:find:${source.find.id}`, [source.find.line], 0, config);
  const index = Math.floor(seconds(context.time ?? context.elapsed) / 2);
  return makeLine(`event:${winner}`, config.lines, index, { ...config, previousId: context.previousId });
}
