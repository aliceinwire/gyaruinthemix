/** Public, source-checked facts. answer is a zero-based choice index. */
export const QUESTIONS = Object.freeze([
  {
    id: "gitm-members",
    question: "ギャルインザミックスのふたりは？",
    choices: [
      "DJありねぇ ＋ DJちゃな",
      "DJさくら ＋ DJもみじ",
      "DJほし ＋ DJつき",
    ],
    answer: 0,
    explanation: "DJありねぇとDJちゃなのDJユニットやで！",
    source:
      "https://github.com/aliceinwire/gyaruinthemix/blob/main/config/site.json",
  },
  {
    id: "gyaru-109",
    question: "ギャル文化とゆかりが深い、渋谷のファッションビルは？",
    choices: ["SHIBUYA109", "東京タワー", "日本武道館"],
    answer: 0,
    explanation: "SHIBUYA109は、1990年代にギャル文化の発信地として発展したんやで。",
    source: "https://www.shibuya109.co.jp/shibuya109lab/reports/180517-2/",
  },
  {
    id: "gitm-sound",
    question: "公式プロフィールにある音楽ジャンルは？",
    choices: ["ボサノヴァ", "ハードバウンス", "ブルーグラス"],
    answer: 1,
    explanation:
      "公式プロフィールにはハードバウンスとバウンスラップが載ってるんやで。",
    source:
      "https://github.com/aliceinwire/gyaruinthemix/blob/main/config/site.json",
  },
  {
    id: "gyaru-socks",
    question: "平成のギャルファッションで流行した靴下は？",
    choices: ["足袋", "五本指ソックス", "ルーズソックス"],
    answer: 2,
    explanation: "ルーズソックスは、平成の女子高生の間で大ブームになったんやで。",
    source:
      "https://www.tv-tokyo.co.jp/adomachi/smp/backnumber/20250726/146160.html",
  },
  {
    id: "gyaru-parapara",
    question: "eggモデルもDVDで紹介したダンスは？",
    choices: ["パラパラ", "フラメンコ", "タンゴ"],
    answer: 0,
    explanation:
      "2009年のegg公式コンピには、モデルによるパラパラ紹介も収録されたんやで。",
    source: "https://avex.jp/chozen/discography/",
  },
  {
    id: "gitm-style",
    question: "ギャルインザミックスの公式スタイルは？",
    choices: ["大正ロマン", "昭和モダン", "平成ギャル"],
    answer: 2,
    explanation: "公式プロフィールのスタイルは「平成ギャル」やで！",
    source:
      "https://github.com/aliceinwire/gyaruinthemix/blob/main/config/site.json",
  },
  {
    id: "gyaru-amuraa",
    question: "「アムラー」が憧れたアーティストは？",
    choices: ["宇多田ヒカル", "安室奈美恵", "椎名林檎"],
    answer: 1,
    explanation: "安室奈美恵さんに憧れるスタイルは「アムラー」と呼ばれたよ。",
    source: "https://www.shibuya109.co.jp/shibuya109lab/reports/180517-2/",
  },
  {
    id: "gyaru-egg",
    question: "2009年に公式コンピCD＋DVDを出したギャル雑誌は？",
    choices: ["Newton", "egg", "鉄道ファン"],
    answer: 1,
    explanation:
      "egg公式コンピは、30曲のノンストップMIXとモデル出演DVDのセットやったんやで。",
    source: "https://avex.jp/chozen/discography/",
  },
  { id:"egg-start", question:"ギャル雑誌eggが創刊された年は？", choices:["1985年","1995年","2005年"], answer:1, explanation:"eggは1995年9月に始まったんやで。", source:"https://prtimes.jp/main/html/rd/p/000000175.000020107.html" },
  { id:"egg-return", question:"2018年3月、eggはどんな形で復活した？", choices:["WEB版","ラジオ番組","舞台作品"], answer:0, explanation:"2014年の休刊を経て、2018年にWEB版で復活したんやで。", source:"https://prtimes.jp/main/html/rd/p/000000175.000020107.html" },
  { id:"egg-name", question:"雑誌eggの名前に込められた思いは？", choices:["朝ごはんを紹介したい","鳥の図鑑を作りたい","モデルと読者で一緒に成長したい"], answer:2, explanation:"まだタマゴのモデルも読者も、一緒に育っていこうという思いやで。", source:"https://prtimes.jp/main/html/rd/p/000000175.000020107.html" },
  { id:"gitm-name", question:"うちらのユニット名、正しいのはどれ？", choices:["ギャルインザボックス","ギャルインザミックス","ギャルオンザマイク"], answer:1, explanation:"ギャルインザミックスやで！ クラブでも覚えて呼んでな。", source:"https://github.com/aliceinwire/gyaruinthemix/blob/main/config/site.json" },
]);
export function questionForStage(routeIndex, road = "scenic") {
  return QUESTIONS[
    Math.max(0,Math.trunc(Number(routeIndex)||0)) % QUESTIONS.length
  ];
}
