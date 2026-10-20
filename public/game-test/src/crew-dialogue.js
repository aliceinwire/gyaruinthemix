import { resolveCrewActions } from './character-actions.js';

/** Pure dialogue selectors. Time is simulation seconds, never wall-clock time.
 * Keep an existing action/toast visible until its hold expires before showing
 * ambient dialogue. Event selection never mutates or consumes state.events.
 */
export const CREW_DIALOGUE_BUCKET_SECONDS = 8;
const SPEAKERS = { arisu: 'DJありねぇ / ドライバー', chana: 'DJちゃな / ナビ担当' };
const CITY = {
  nakano: ['中野から一本目の音、録りにいこ。地図も準備できたで。', '中野の看板、気になる店多すぎ。寄り道はあとやな。', '中野、角を曲がるたび景色変わるな。ナビ任せてや。'],
  shinjuku: ['新宿のネオン、うちのラメとええ勝負やん。', '新宿、看板多いな。目的地まで見失わへんで。', '新宿のビル、背ぇ高いなあ。地図は上向けても伸びへんか。'],
  shibuya: ['渋谷、街ごとビート刻んでるみたいやな。', '渋谷の看板、目移りするわ。道案内はちゃんとするで。', '渋谷まで来たな。地図のピンも踊りたそうやん。'],
  asakusa: ['浅草の提灯、ええ色やな。今日の音にもこの感じ、残したい。', '浅草、ゆっくり眺めたいな。案内は任せとき。', '浅草の灯り、じんわりくるわ。音もあったかめにしたなるな。'],
  osaka: ['大阪の看板、声まで聞こえてきそうやん。', '大阪の夜、招待するで。気になったら遊びに来てな。', '移動と休憩、ちゃんと取れたな。今日は大阪の道からや。'],
  kyoto: ['京都の街並み、色の合わせ方うまいなあ。', '京都、曲がり角まで絵になるやん。ナビは任せて。', '最後の街やな。ここで録る音、ほかの五つとつなぐの楽しみ！'],
};
const ROAD = {
  scenic: ['ゆったりルートや。景色と充電スポット、両方チェックするで。', 'この道、充電スポット多めやな。電池にも休憩いるもんな。', '遠回りもええな。地図の余白まで楽しめるやん。'],
  express: ['特急ルート、充電スポット少なめや。残量見とくで。', '近道やけど人多いな。ハートの招待状はうちに任せて。', '特急ルートや。次の充電場所、地図で先に探しとくな。'],
};
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
  summer: ['夏やな。日差しも街も、元気あり余ってるやん。', '夏の景色、色濃いな。地図の青まで涼しそうや。'],
  autumn: ['秋の色、ええな。次のメイク、この色にしよかな。', '秋やな。街の色が落ち着いてて、よう見えるわ。'],
  winter: ['冬やな。うちはナビ、ありねぇは運転、ぬくぬく連携や。', '冬の空気、きりっとしてるな。道案内もしゃきっといくで。'],
};
const ACTION = {
  map: ['地図チェック中や。ぐるぐる回しても近道は増えへんな。', '次の道、地図で確認したで。案内は任せとき。', '地図の向き、合ってるで。うちの方向感覚も今んとこ順調や。'],
  directions: ['次の道、こっちやで。ありねぇ、前は任せた！', '案内するで。曲がるところはちゃんと言うからな。'],
  makeup: ['鏡チェック、口紅よし。次は地図に戻るで。', '助手席でメイク直し中や。ありねぇは運転に集中してな。', 'リップ整ったで。ナビの精度まで上がった気するわ。'],
  hearts: ['ハートの招待状、うちから届けるで。ありねぇは運転よろしく！', 'ちゃなのハート便や。気になったら、そのままの格好で遊びに来てな。'],
  cheer: ['ええ調子やん！ ありねぇ、前は任せたで。', '助手席から応援するで。招待もナビも、うちに任せて！'],
  rush: ['息合わせていくで！ ありねぇ、運転よろしく！', 'ふたりのタイミング、ぴったりやん！'],
};
const EVENTS = {
  lost: { priority: 100, holdSeconds: 6, speaker: 'arisu', lines: ['安全なピットへ戻ろ。前の道までの記録は残る。また準備しよ。'] },
  won: { priority: 100, holdSeconds: 6, speaker: 'arisu', lines: ['着いたで。ナビも招待も、ええ連携やったな。'] },
  collision: { priority: 90, speaker: 'arisu', lines: ['おっと、立て直すで。前の道、もう一回確認や。', 'ぶつかったな。落ち着いて、ハンドル戻すで。'] },
  'rush-start': { priority: 80, lines: ACTION.rush },
  charged: { priority: 75, lines: ['充電いっぱいや！ 電池のごきげん、満点やな。'] },
  'charge-start': { priority: 70, lines: ['充電中やで。ハートはひと休み、電池にごほうびや。'] },
  'charge-stop': { priority: 65, lines: ['充電おしまい。残量見ながら、次へいこか。'] },
  'rush-stop': { priority: 60, lines: ['息ぴったりやったな。ほな、いつものペースでいこ。'] },
  boost: { priority: 55, speaker: 'arisu', lines: ['浮くで！ 前の道、しっかり見とくな。'] },
  'jump-clear': { priority: 50, speaker: 'arisu', lines: ['段差、越えたで。着地も落ち着いていこ。'] },
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
  const action = resolveCrewActions({ ...context, time }).chana;
  const options = { previousId: context.previousId };
  if (context.charging) return makeLine('action:charging', EVENTS['charge-start'].lines, bucket, { ...options, priority: 30 });
  if (context.action || context.shooting || context.rushing || context.boosting) {
    return makeLine(`action:${action}`, ACTION[action] || ACTION.map, bucket, { ...options, priority: 30 });
  }
  const city = key(context.cityId) || context.route?.cityId;
  const weather = key(context.weather) === 'clear' ? 'sunny' : key(context.weather);
  const groups = [
    [`city:${city || 'unknown'}`, CITY[city] || ['この街の道、地図で確認しとくな。案内は任せて。', '次の角まで確認したで。落ち着いていこか。']],
    [`road:${key(context.routeOption) || 'scenic'}`, ROAD[key(context.routeOption)] || ROAD.scenic],
    [`weather:${weather || 'sunny'}`, WEATHER[weather] || WEATHER.sunny],
    [`season:${key(context.season) || 'summer'}`, SEASON[key(context.season)] || SEASON.summer],
    [`action:${action}`, ACTION[action] || ACTION.map],
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
    if (EVENTS[type] && (!winner || EVENTS[type].priority > EVENTS[winner].priority)) winner = type;
  }
  if (!winner) return null;
  const config = EVENTS[winner];
  const index = Math.floor(seconds(context.time ?? context.elapsed) / 2);
  return makeLine(`event:${winner}`, config.lines, index, { ...config, previousId: context.previousId });
}
