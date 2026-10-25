/**
 * 120 art-directed neighbourhood compositions, twenty for each story city.
 * Every layout below is authored: module order, gaps, elevations and silhouettes
 * describe a place. Shared pixel-architecture pieces are not entire backgrounds.
 * Coordinates use a 1152 × 330 strip; heights are measured up from its pavement.
 */
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
export const SEASONS = deepFreeze([
  {
    id: "spring",
    name: "春",
    english: "SPRING",
    foliage: ["#d98caf", "#f5b5cc", "#ffe0dd"],
    grass: "#648869",
    light: "#ffd8d1",
    lightAlpha: 0.045,
    blossom: true,
    snowCover: 0,
  },
  {
    id: "summer",
    name: "夏",
    english: "SUMMER",
    foliage: ["#24564c", "#45866a", "#80b377"],
    grass: "#46755a",
    light: "#ffe4a4",
    lightAlpha: 0.055,
    blossom: false,
    snowCover: 0,
  },
  {
    id: "autumn",
    name: "秋",
    english: "AUTUMN",
    foliage: ["#9c495c", "#d87c54", "#e9b968"],
    grass: "#8b8261",
    light: "#efad70",
    lightAlpha: 0.065,
    blossom: false,
    snowCover: 0,
  },
  {
    id: "winter",
    name: "冬",
    english: "WINTER",
    foliage: ["#475d69", "#6e8b8a", "#bbc9ca"],
    grass: "#6a7c80",
    light: "#b5d8ed",
    lightAlpha: 0.07,
    blossom: false,
    snowCover: 0.8,
  },
]);
export const WEATHERS = deepFreeze([
  {
    id: "sunny",
    name: "晴れ",
    english: "SUN",
    traction: 1,
    visibility: 1,
    crosswind: 0,
    wetness: 0,
    snow: 0,
    mud: 0,
    wind: 0.12,
    precipitation: 0,
  },
  {
    id: "cloudy",
    name: "曇り",
    english: "CLOUD",
    traction: 1,
    visibility: 0.93,
    crosswind: 0,
    wetness: 0,
    snow: 0,
    mud: 0,
    wind: 0.22,
    precipitation: 0,
  },
  {
    id: "rain",
    name: "雨",
    english: "RAIN",
    traction: 0.82,
    visibility: 0.8,
    crosswind: 0.1,
    wetness: 0.85,
    snow: 0,
    mud: 0,
    wind: 0.35,
    precipitation: 0.7,
  },
  {
    id: "storm",
    name: "雷雨",
    english: "STORM",
    traction: 0.7,
    visibility: 0.64,
    crosswind: 0.65,
    wetness: 1,
    snow: 0,
    mud: 0.12,
    wind: 0.92,
    precipitation: 1,
  },
  {
    id: "snow",
    name: "雪",
    english: "SNOW",
    traction: 0.65,
    visibility: 0.75,
    crosswind: 0.14,
    wetness: 0.15,
    snow: 1,
    mud: 0,
    wind: 0.25,
    precipitation: 0.8,
  },
  {
    id: "fog",
    name: "霧",
    english: "FOG",
    traction: 0.94,
    visibility: 0.48,
    crosswind: 0,
    wetness: 0.2,
    snow: 0,
    mud: 0,
    wind: 0.06,
    precipitation: 0,
  },
  {
    id: "mud",
    name: "ぬかるみ",
    english: "MUD",
    traction: 0.72,
    visibility: 0.87,
    crosswind: 0.06,
    wetness: 0.65,
    snow: 0,
    mud: 1,
    wind: 0.16,
    precipitation: 0.16,
  },
  {
    id: "wind",
    name: "強風",
    english: "WIND",
    traction: 0.96,
    visibility: 0.9,
    crosswind: 1,
    wetness: 0,
    snow: 0,
    mud: 0,
    wind: 1,
    precipitation: 0,
  },
]);
export const MODULE_TYPES = deepFreeze([
  "shop",
  "arcade",
  "tower",
  "apartment",
  "machiya",
  "temple",
  "torii",
  "gate",
  "viaduct",
  "station",
  "tunnel",
  "canal",
  "bridge",
  "footbridge",
  "dock",
  "warehouse",
  "market",
  "park",
  "bamboo",
  "stairs",
  "garden",
  "factory",
  "tram",
  "theater",
  "cafe",
  "record",
  "bookstore",
  "greenhouse",
  "court",
  "bath",
  "pavilion",
  "terrace",
  "parking",
  "playground",
  "shrine",
  "museum",
  "school",
  "pagoda",
  "fountain",
  "waterfall",
]);
export const PROP_TYPES = deepFreeze([
  "tree",
  "pine",
  "lantern",
  "pole",
  "sign",
  "vending",
  "bike",
  "flower",
  "bench",
  "boat",
  "statue",
  "foodcart",
  "traffic",
  "stone",
  "banner",
  "planter",
  "bollard",
  "crates",
  "umbrella",
  "busstop",
]);
const CITY_PALETTES = {
  nakano: {
    wall: "#63506d",
    trim: "#da8eb6",
    accent: "#ff97ce",
    roof: "#342941",
    glass: "#426d79",
    glow: "#ffe7ac",
  },
  shinjuku: {
    wall: "#4b4c68",
    trim: "#7fa8b1",
    accent: "#80e5e3",
    roof: "#27243c",
    glass: "#455a7c",
    glow: "#ffe5ad",
  },
  shibuya: {
    wall: "#705066",
    trim: "#e090ba",
    accent: "#ff7cc6",
    roof: "#32253c",
    glass: "#527b8c",
    glow: "#fff0ba",
  },
  asakusa: {
    wall: "#7e5b64",
    trim: "#c78d77",
    accent: "#ed9b79",
    roof: "#352d40",
    glass: "#54747d",
    glow: "#ffdc9d",
  },
  osaka: {
    wall: "#5b526d",
    trim: "#8ba6b2",
    accent: "#67ded6",
    roof: "#2c2b43",
    glass: "#476d82",
    glow: "#ffe395",
  },
  kyoto: {
    wall: "#755c64",
    trim: "#b58a79",
    accent: "#e9a0bd",
    roof: "#3e3446",
    glass: "#5a7e7c",
    glow: "#ffe0aa",
  },
};
// Compact authored-layout notation: type,x,width,height,variant,elevation.
function modules(layout) {
  return layout.split(";").map((part) => {
    const [type, x, width, height, variant = "0", elevation = "0"] = part
      .trim()
      .split(",");
    return {
      type,
      x: +x,
      width: +width,
      height: +height,
      variant: +variant,
      elevation: +elevation,
    };
  });
}
function props(layout) {
  return layout
    .split(";")
    .filter(Boolean)
    .map((part) => {
      const [type, x, size = "1", elevation = "0", variant = "0"] = part
        .trim()
        .split(",");
      return {
        type,
        x: +x,
        size: +size,
        elevation: +elevation,
        variant: +variant,
      };
    });
}
const authored = [];
function L(
  cityId,
  slug,
  name,
  english,
  kind,
  terrain,
  layout,
  streetProps,
  motif,
) {
  const index = authored.filter((l) => l.cityId === cityId).length;
  const elements = modules(layout);
  const street = props(streetProps);
  const location = {
    id: `${cityId}-${slug}`,
    cityId,
    index,
    name,
    english,
    kind,
    terrain,
    span: 1152,
    horizon: 330,
    landmarkWindow: [350, 650],
    palette: CITY_PALETTES[cityId],
    modules: elements,
    props: street,
    motif,
    // Deliberately excludes names, palette, city and numeric variants. Equal
    // silhouette/topology records cannot masquerade as different places.
    signature: elements
      .map(
        ({ type, x, width, height, elevation }) =>
          `${type}:${x}:${width}:${height}:${elevation}`,
      )
      .join("|"),
  };
  authored.push(location);
}

// NAKANO: covered shopping, small rail-side lanes and unusually green back streets.
L(
  "nakano",
  "sunmall",
  "サンモール入口",
  "SUN MALL GATE",
  "covered-shopping",
  "pavers",
  "shop,0,134,92,1;arcade,145,246,102,0;market,416,132,47,1;cafe,700,118,72,0;apartment,850,156,119,2;record,1030,112,78,1",
  "vending,124;bike,596;pole,682;flower,828;banner,1018",
  "pink shopping arches and checkerboard shop awnings",
);
L(
  "nakano",
  "broadway",
  "ブロードウェイ裏通り",
  "BROADWAY BACKSTREET",
  "collectors-lane",
  "brick",
  "record,0,146,103,2;shop,161,92,77,4;apartment,268,154,126,1;bookstore,494,111,64,2;arcade,718,185,85,2;shop,958,194,98,3",
  "sign,140;vending,450;bike,645;pole,920;crates,1064",
  "record bins, toy shop cases and stacked collector signs",
);
L(
  "nakano",
  "sunplaza",
  "サンプラザ広場",
  "SUNPLAZA PLAZA",
  "music-plaza",
  "plaza",
  "cafe,0,128,74,2;stairs,160,148,46,1;fountain,380,156,36,0;garden,607,166,39,1;theater,842,174,114,1;shop,1052,100,73,5",
  "banner,142;bench,333;tree,563,1.1;flower,796;statue,1034",
  "broad festival plaza, stepped seating and record-shaped fountain",
);
L(
  "nakano",
  "arai",
  "新井薬師の参道",
  "ARAI YAKUSHI LANE",
  "temple-approach",
  "stone",
  "machiya,0,146,70,0;shrine,175,112,85,1;garden,338,129,32,0;gate,502,126,87,0;temple,710,213,104,2;machiya,1000,152,68,2",
  "lantern,152;stone,314;pine,650,0.9;foodcart,951;banner,1072",
  "stone approach and tiled temple with paired incense lanterns",
);
L(
  "nakano",
  "numabukuro",
  "沼袋の踏切",
  "NUMABUKURO CROSSING",
  "rail-crossing",
  "rail",
  "apartment,0,135,112,0;shop,153,109,75,3;tram,310,315,55,0,20;station,650,190,81,1;machiya,874,124,63,0;shop,1020,132,88,2",
  "traffic,281;pole,300;traffic,634;bike,859;vending,1009",
  "yellow crossing barriers, local train and low platform canopy",
);
L(
  "nakano",
  "nogata",
  "野方商店街",
  "NOGATA SHOTENGAI",
  "food-market",
  "brick",
  "shop,0,105,84,5;market,126,208,58,1;bath,370,130,93,0;cafe,579,115,65,1;market,746,174,52,3;apartment,992,160,113,2",
  "foodcart,350;banner,518;bike,716;lantern,950;crates,1092",
  "produce crates, striped groceries and a bathhouse chimney",
);
L(
  "nakano",
  "yamato",
  "大和町の細道",
  "YAMATO BACK LANES",
  "residential-lane",
  "asphalt",
  "apartment,0,154,118,3;machiya,188,100,65,1;garden,328,123,33,2;stairs,493,97,47,0;shop,657,123,72,4;apartment,851,173,129,0;machiya,1061,91,59,3",
  "pole,169;bike,307;tree,464,0.8;vending,627;flower,804;pole,1040",
  "staggered garden walls and exterior stair apartment balconies",
);
L(
  "nakano",
  "wakamiya",
  "若宮の路地公園",
  "WAKAMIYA POCKET PARK",
  "playground-court",
  "park",
  "machiya,0,124,67,2;court,153,206,74,0;playground,414,205,61,1;garden,677,147,35,2;apartment,872,172,106,1;cafe,1068,84,60,0",
  "tree,137,0.9;bench,384;flower,645;tree,844,1.1;bike,1057",
  "mesh ball court, orange climbing slide and flower-bordered paths",
);
L(
  "nakano",
  "toritsu",
  "都立家政駅前",
  "TORITSU KASEI STATION",
  "local-station",
  "pavers",
  "station,0,279,86,3;shop,310,112,76,1;parking,455,145,82,0;garden,648,113,29,1;cafe,797,130,70,2;apartment,970,182,116,2",
  "busstop,291;vending,437;bike,613;tree,774,0.8;pole,950",
  "station clock, bicycle parking ramps and bakery terrace",
);
L(
  "nakano",
  "saginomiya",
  "鷺宮の水辺",
  "SAGINOMIYA WATERWAY",
  "canal-lane",
  "waterfront",
  "canal,0,1152,31,1;machiya,0,151,68,1,19;bridge,189,164,44,2;garden,397,152,37,0,24;apartment,607,173,112,2,18;footbridge,827,165,67,0;shop,1023,129,75,3,20",
  "tree,170,1,22;stone,367,1,20;bench,567,1,20;pole,808,1,18;boat,1010,0.6",
  "narrow canal, two unequal bridges and raised waterside houses",
);
L(
  "nakano",
  "shirasagi",
  "白鷺の花道",
  "SHIRASAGI FLOWER WALK",
  "flower-garden",
  "park",
  "greenhouse,0,198,86,0;garden,236,181,42,2;park,468,215,79,1;cafe,747,129,71,1;machiya,939,118,67,0;garden,1080,72,27,3",
  "flower,215;bench,443;tree,708,1;planter,910;bike,1068",
  "glass nursery and layered flower beds opening onto a leafy walk",
);
L(
  "nakano",
  "ekoda",
  "江古田の森",
  "EGOTA FOREST EDGE",
  "woodland",
  "park",
  "park,0,214,112,2;garden,267,126,39,0;pavilion,435,132,72,1;park,615,245,103,1;playground,910,178,57,2;garden,1108,44,24,0",
  "tree,239,1.2;bench,407;stone,591;tree,885,1.25;flower,1098",
  "deep woodland clusters, hexagonal shelter and forest play structures",
);
L(
  "nakano",
  "higashi",
  "東中野ガード下",
  "HIGASHI NAKANO VIADUCT",
  "rail-arches",
  "rail",
  "viaduct,0,358,92,0;shop,22,125,56,4;record,183,127,58,0;stairs,404,126,67,1;station,581,216,90,2;apartment,875,158,116,3;shop,1055,97,68,0",
  "pole,373;vending,547;bike,820;banner,850;traffic,1044",
  "rivet-edged elevated railway over tiny bars and an outside stair",
);
L(
  "nakano",
  "ochiai",
  "落合のせせらぎ",
  "OCHIAI STREAM WALK",
  "stream-park",
  "waterfront",
  "canal,0,1152,28,2;park,0,211,87,0,20;bridge,259,144,43,0;garden,454,206,41,3,22;machiya,733,147,75,2,20;footbridge,928,158,64,1",
  "tree,236,1.1,19;stone,425,1,19;bench,689,1,20;flower,902,1,20;boat,1116,0.7",
  "stone-edged stream, leaning trees and compact pedestrian crossings",
);
L(
  "nakano",
  "kamitakada",
  "上高田寺町",
  "KAMITAKADA TEMPLE ROW",
  "temple-quarter",
  "stone",
  "temple,0,203,105,0;machiya,241,139,69,3;garden,425,124,33,1;pagoda,600,91,123,0;shrine,751,154,89,2;machiya,978,174,71,1",
  "pine,218;stone,403;lantern,573;stone,723;pine,942,1.1",
  "temple roofs at different heights and a small wooden pagoda",
);
L(
  "nakano",
  "shinnakano",
  "新中野のアーケード",
  "SHIN NAKANO ARCADE",
  "metro-shopping",
  "pavers",
  "shop,0,132,89,2;arcade,157,193,96,3;stairs,394,121,51,2;market,577,156,50,2;tower,784,141,134,1;shop,987,165,87,5",
  "traffic,143;sign,368;vending,542;bike,754;pole,951",
  "subway stairwell, barrel-vault market and narrow office building",
);
L(
  "nakano",
  "honcho",
  "本町の工房",
  "HONCHO WORKSHOPS",
  "craft-workshops",
  "asphalt",
  "warehouse,0,178,85,1;shop,211,119,64,4;factory,373,149,95,1;garden,576,123,31,0;bookstore,750,141,77,1;apartment,956,196,124,3",
  "crates,192;pole,353;vending,550;bike,720;banner,925",
  "sawtooth workshop roofs, tiny bookbinder and a pipe-lined studio",
);
L(
  "nakano",
  "yayoi",
  "弥生町の坂道",
  "YAYOI TERRACED LANE",
  "terraced-residential",
  "slope",
  "apartment,0,149,106,1,14;stairs,176,104,64,1;machiya,313,129,65,2,31;garden,481,136,35,3,22;stairs,653,127,42,2;shop,815,132,72,1,12;apartment,1002,150,117,0",
  "pole,161,1,14;flower,292,1,30;tree,464,0.9,22;bench,633,1,18;bike,970",
  "retaining walls and split-level entrances linked by stair flights",
);
L(
  "nakano",
  "minamidai",
  "南台の団地広場",
  "MINAMIDAI COURTYARD",
  "housing-courtyard",
  "plaza",
  "apartment,0,173,132,2;garden,214,116,31,0;playground,372,165,64,0;fountain,595,112,32,1;school,770,197,104,0;apartment,1003,149,118,1",
  "tree,189,1.2;bench,347;flower,561;tree,735,0.95;bike,984",
  "housing towers around a round splash pool and painted play court",
);
L(
  "nakano",
  "centralpark",
  "中野四季の森",
  "SHIKI NO MORI PARK",
  "urban-green",
  "park",
  "tower,0,153,137,2;cafe,191,131,72,3;park,367,219,93,3;fountain,630,148,35,2;terrace,818,170,65,1;garden,1036,116,40,1",
  "tree,173,1.1;bench,345;flower,609;umbrella,799;tree,1014,1",
  "office-edge lawns, stepped water feature and open cafe deck",
);

// SHINJUKU: high-rise edges, neon alleys, railway spaces and old canal districts.
L(
  "shinjuku",
  "westtowers",
  "西新宿の摩天楼",
  "WEST TOWER EDGE",
  "office-plaza",
  "plaza",
  "tower,0,168,142,3;stairs,205,141,44,0;garden,387,149,31,2;fountain,582,125,39,0;tower,767,148,132,2;terrace,976,176,67,0",
  "traffic,185;bench,365;tree,556;statue,737;banner,945",
  "stepped glass offices with a sunken plaza and abstract sculpture",
);
L(
  "shinjuku",
  "kabukicho",
  "歌舞伎町ネオン門",
  "KABUKICHO NEON GATE",
  "neon-gateway",
  "asphalt",
  "theater,0,147,113,3;shop,168,105,84,6;gate,309,218,98,3;shop,589,136,83,5;parking,772,160,95,1;theater,987,165,126,2",
  "sign,154;pole,289;foodcart,553;sign,746;vending,954",
  "neon gateway over an open lane, theater marquees and sign stacks",
);
L(
  "shinjuku",
  "omoide",
  "思い出横丁",
  "OMOIDE YOKOCHO",
  "lantern-alley",
  "brick",
  "viaduct,0,251,88,2;machiya,11,102,61,4;shop,128,101,66,5;market,284,168,49,4;shop,510,113,74,2;machiya,668,147,65,5;shop,878,112,82,3;machiya,1014,138,59,4",
  "lantern,245;foodcart,476;pole,646;crates,838;lantern,1004",
  "grill smoke, hanging lanterns and miniature eateries under the tracks",
);
L(
  "shinjuku",
  "goldengai",
  "ゴールデン街",
  "GOLDEN GAI LANES",
  "stacked-bars",
  "brick",
  "shop,0,89,86,6;shop,99,93,69,3;stairs,207,76,61,1;record,305,104,95,3;shop,468,109,78,7;machiya,621,103,66,5;shop,769,104,91,6;apartment,917,125,108,3;shop,1060,92,77,4",
  "sign,195;lantern,433;vending,593;pole,744;sign,895",
  "unequal two-storey bar fronts and exposed rooftop stairways",
);
L(
  "shinjuku",
  "hanazono",
  "花園神社の灯",
  "HANAZONO SHRINE",
  "shrine-courtyard",
  "stone",
  "shop,0,115,85,2;torii,156,151,91,1;garden,356,132,40,0;shrine,534,193,104,0;market,779,179,56,3;machiya,1005,147,72,0",
  "lantern,132;stone,330;pine,512,0.9;banner,756;foodcart,980",
  "vermillion torii, shrine courtyard and festival stall line",
);
L(
  "shinjuku",
  "gyoen",
  "新宿御苑の外苑",
  "GYOEN GARDEN WALL",
  "garden-edge",
  "park",
  "museum,0,171,87,1;garden,215,185,43,3;park,448,234,113,2;pavilion,732,133,75,0;greenhouse,920,232,99,2",
  "tree,193,1.05;bench,422;stone,705;flower,890",
  "garden stone walls, tall clipped trees and luminous greenhouse panes",
);
L(
  "shinjuku",
  "southdeck",
  "南口デッキ",
  "SOUTH EXIT DECK",
  "station-deck",
  "rail",
  "station,0,255,103,4;footbridge,303,209,82,2;stairs,545,104,67,0;terrace,699,139,61,2;tower,889,147,138,0;shop,1065,87,75,2",
  "busstop,274;sign,526;bike,670;banner,859;pole,1051",
  "split-height station deck and suspended pedestrian bridge",
);
L(
  "shinjuku",
  "baba",
  "高田馬場ガード街",
  "TAKADANOBABA TRACKS",
  "student-rail-street",
  "rail",
  "viaduct,0,307,100,1;bookstore,20,119,67,3;shop,166,114,71,5;school,353,171,110,1;market,587,138,51,0;station,778,220,89,1;record,1042,110,83,0",
  "vending,323;bike,553;pole,751;banner,1018",
  "student bookstores and ramen stalls beneath pale green rail girders",
);
L(
  "shinjuku",
  "shinokubo",
  "新大久保の市場",
  "SHIN OKUBO MARKET",
  "food-neon-market",
  "pavers",
  "market,0,190,58,5;shop,215,114,97,7;apartment,367,149,122,2;market,568,187,56,4;cafe,810,132,73,3;shop,994,158,95,6",
  "foodcart,199;sign,346;banner,540;vending,783;crates,967",
  "food kiosks, colorful cosmetic displays and banner-lined balconies",
);
L(
  "shinjuku",
  "okubo",
  "大久保の音楽通り",
  "OKUBO MUSIC ROW",
  "music-street",
  "asphalt",
  "record,0,157,91,1;shop,183,118,82,4;theater,336,186,112,4;garden,578,101,31,0;cafe,723,129,69,0;apartment,903,155,115,0;record,1080,72,72,2",
  "banner,168;pole,317;bike,550;sign,700;vending,874;flower,1070",
  "rehearsal staircases, instrument shop windows and tiny live-house stage",
);
L(
  "shinjuku",
  "kagurazaka",
  "神楽坂の石畳",
  "KAGURAZAKA STONE LANE",
  "stepped-old-lane",
  "slope",
  "machiya,0,147,78,3,20;stairs,174,107,54,0;machiya,317,120,68,4,31;shrine,483,136,91,2,15;garden,675,129,38,0;cafe,854,122,71,1;machiya,1007,145,73,1",
  "lantern,157,1,21;stone,298,1,30;pine,458,0.8,20;sign,649;flower,826;lantern,991",
  "stone stairs weaving between lattice restaurants and a quiet shrine",
);
L(
  "shinjuku",
  "iidabashi",
  "飯田橋の運河",
  "IIDABASHI CANAL DECK",
  "canal-cafe",
  "waterfront",
  "canal,0,1152,38,0;station,0,224,83,2,23;bridge,268,153,55,1;terrace,467,181,71,3,26;park,701,161,81,0,24;footbridge,902,197,75,2",
  "boat,235,0.75;pole,438,1,24;umbrella,672,1,26;tree,879,1,24;bench,1120,1,24",
  "canal restaurant decking, moored boat and railway-side trees",
);
L(
  "shinjuku",
  "yotsuya",
  "四谷の切通し",
  "YOTSUYA CUTTING",
  "rail-cutting",
  "rail",
  "garden,0,171,45,2,30;bridge,204,214,71,3;tram,453,267,52,2;stairs,749,111,69,0;school,903,176,109,2;garden,1110,42,29,0",
  "pine,183,1.1,27;pole,435;stone,731;bike,880;tree,1092",
  "deep rail cutting and broad stone arch crossing below retaining walls",
);
L(
  "shinjuku",
  "shinanomachi",
  "信濃町の緑道",
  "SHINANOMACHI GREENWAY",
  "sports-greenway",
  "park",
  "school,0,202,105,3;court,245,169,81,1;park,464,194,91,3;stairs,706,108,42,2;cafe,853,139,74,0;garden,1040,112,39,2",
  "tree,223,1.1;bench,441;flower,682;bike,834;banner,1017",
  "sports court fences, broad green walkway and school brick facade",
);
L(
  "shinjuku",
  "waseda",
  "早稲田の古書通り",
  "WASEDA BOOK WALK",
  "bookshop-tram",
  "brick",
  "bookstore,0,151,96,2;school,190,173,120,4;bookstore,408,107,69,0;tram,559,255,55,1;shop,861,123,79,4;machiya,1027,125,67,2",
  "bike,169;banner,385;crates,534;pole,835;sign,1005",
  "university clock gable, used-book shelves and a small streetcar",
);
L(
  "shinjuku",
  "nishiwaseda",
  "西早稲田の坂",
  "NISHI WASEDA SLOPE",
  "tram-hill",
  "slope",
  "apartment,0,151,121,1,18;stairs,177,124,56,2;tram,342,252,55,3,22;garden,636,133,36,2,13;bookstore,818,126,79,3;shop,992,160,88,2",
  "pole,162,1,17;traffic,319,1,20;bench,617,1,18;tree,792;bike,968",
  "sloped streetcar stop, terraced bookseller and retaining-wall gardens",
);
L(
  "shinjuku",
  "nishiochiai",
  "西落合アトリエ",
  "NISHI OCHIAI STUDIOS",
  "artist-workshops",
  "brick",
  "warehouse,0,174,89,2;museum,218,167,98,2;garden,432,128,36,1;factory,605,154,100,2;machiya,809,126,72,3;cafe,987,165,77,2",
  "statue,197;crates,408;tree,582,0.85;bike,784;banner,960",
  "studio skylights, outdoor sculpture and a converted factory facade",
);
L(
  "shinjuku",
  "akebono",
  "曙橋の高架",
  "AKEBONOBASHI UNDERPASS",
  "underpass-market",
  "asphalt",
  "bridge,0,301,107,4;shop,27,112,62,6;shop,167,105,67,1;stairs,343,102,69,1;market,495,189,54,3;apartment,740,170,126,3;shop,969,183,89,4",
  "traffic,318;pole,463;vending,710;bike,938;sign,1090",
  "wide road bridge, stair landings and bright tucked-under storefronts",
);
L(
  "shinjuku",
  "ichigaya",
  "市ヶ谷のお堀",
  "ICHIGAYA MOAT",
  "moat-fishing-deck",
  "waterfront",
  "canal,0,1152,44,3;garden,0,192,43,1,29;bridge,234,181,59,3;dock,459,189,55,0;park,700,178,94,2,27;station,924,228,91,2,27",
  "tree,213,1.2,28;boat,435,0.8;bench,672,1,24;pole,901,1,25;stone,1090,1,25",
  "broad moat water, low timber fishing deck and tall bank trees",
);
L(
  "shinjuku",
  "nishiportal",
  "西口地下道入口",
  "WEST SUBWAY PORTAL",
  "subway-plaza",
  "plaza",
  "tower,0,135,139,1;tunnel,178,192,91,2;stairs,415,133,62,3;fountain,599,123,37,3;parking,772,187,99,2;shop,1002,150,84,0",
  "busstop,156;traffic,392;sign,568;bench,746;pole,980",
  "two angular underground entrances, taxi rank and parking ramps",
);

// SHIBUYA: crossings, fashion lanes, wooded edges and river-side terraces.
L(
  "shibuya",
  "scramble",
  "スクランブル交差点",
  "SCRAMBLE CROSSING",
  "crossing-plaza",
  "crosswalk",
  "tower,0,151,137,4;shop,180,125,96,7;stairs,350,116,50,1;garden,542,106,29,3;theater,711,192,119,5;shop,977,175,93,6",
  "traffic,160;sign,329;statue,497;traffic,680;banner,942",
  "broad diagonal crossing mouth, stacked video facade and statue plaza",
);
L(
  "shibuya",
  "center",
  "センター街",
  "CENTER STREET",
  "fashion-neon",
  "brick",
  "shop,0,117,99,7;record,133,131,96,4;arcade,300,195,96,4;shop,554,132,85,6;cafe,729,111,73,3;theater,890,151,118,1;shop,1063,89,82,3",
  "sign,279;banner,518;vending,707;pole,864;foodcart,1053",
  "record-store windows, hanging neon arch and compact fashion fronts",
);
L(
  "shibuya",
  "dogenzaka",
  "道玄坂のクラブ街",
  "DOGENZAKA CLUB HILL",
  "club-stair-street",
  "slope",
  "theater,0,153,113,6,15;stairs,184,119,66,0;record,341,128,91,5,28;shop,526,120,82,7,14;stairs,689,99,46,2;cafe,831,121,76,4;theater,996,156,121,3",
  "sign,167,1,15;pole,319,1,25;banner,495,1,22;vending,667;bike,808;sign,976",
  "club stair landings, large speaker marquee and sloping neon signs",
);
L(
  "shibuya",
  "bunkamura",
  "文化村通り",
  "BUNKAMURA ART WALK",
  "theater-museum",
  "pavers",
  "museum,0,213,114,3;cafe,250,118,73,1;garden,412,144,36,2;theater,608,192,109,4;bookstore,847,128,83,1;terrace,1027,125,62,0",
  "statue,231;banner,391;bench,582;tree,824;sign,1001",
  "museum steps, sculpture court and wide cinema canopy",
);
L(
  "shibuya",
  "spain",
  "スペイン坂",
  "SPAIN HILL STEPS",
  "boutique-steps",
  "slope",
  "cafe,0,129,77,5,15;stairs,158,149,75,3;shop,341,105,81,8,37;garden,494,117,32,3,22;stairs,653,118,54,0;shop,811,130,85,6,12;apartment,992,160,116,4",
  "planter,141,1,18;banner,322,1,35;flower,471,1,26;bench,631,1,16;sign,789;tree,968",
  "split stair flights, tiny boutiques and mosaic planter landings",
);
L(
  "shibuya",
  "catstreet",
  "キャットストリート",
  "CAT STREET BOUTIQUES",
  "low-fashion-lane",
  "pavers",
  "shop,0,149,77,8;cafe,192,130,69,6;garden,365,129,32,4;record,547,143,83,4;shop,743,147,92,7;terrace,940,130,58,2;shop,1092,60,62,1",
  "tree,171,0.9;bike,343;planter,516;sign,716;bench,917;banner,1081",
  "low-set fashion studios, sculpted shop windows and outdoor coffee seating",
);
L(
  "shibuya",
  "takeshita",
  "竹下通り",
  "TAKESHITA POP STREET",
  "pop-market",
  "brick",
  "gate,0,167,91,4;shop,191,110,88,9;market,337,143,53,6;shop,531,108,97,8;cafe,682,112,75,6;market,838,160,55,5;shop,1035,117,89,9",
  "banner,178;foodcart,317;sign,505;vending,659;flower,816;sign,1017",
  "pastel gateway, crepe cart, accessory stalls and pink vertical signs",
);
L(
  "shibuya",
  "omotesando",
  "表参道の並木",
  "OMOTESANDO TREE ROW",
  "fashion-boulevard",
  "pavers",
  "shop,0,178,102,10;garden,217,87,32,1;museum,347,187,107,4;cafe,595,131,74,3;garden,775,108,34,2;shop,934,218,111,8",
  "tree,196,1.35;bench,326;tree,562,1.3;planter,751;tree,907,1.4",
  "glass display pavilions framed by tall boulevard trees",
);
L(
  "shibuya",
  "yoyogipark",
  "代々木公園入口",
  "YOYOGI PARK GATE",
  "forest-festival",
  "park",
  "park,0,193,109,4;gate,231,159,84,5;garden,432,127,38,1;pavilion,607,154,76,2;park,806,203,102,3;market,1050,102,47,7",
  "tree,213,1.25;bike,410;bench,582;foodcart,784;banner,1032",
  "wooded park entrance, picnic shelter and weekend craft stall",
);
L(
  "shibuya",
  "harajuku",
  "原宿の駅ホーム",
  "HARAJUKU PLATFORM",
  "station-woodland",
  "rail",
  "station,0,266,104,5;park,305,163,91,1;footbridge,518,178,79,3;stairs,726,108,65,1;shop,875,132,84,8;cafe,1040,112,71,4",
  "pole,285;tree,492,1.1;bike,711;vending,853;banner,1022",
  "pointed station roof, platform footbridge and wooded track edge",
);
L(
  "shibuya",
  "shinsen",
  "神泉トンネル",
  "SHINSEN RAIL TUNNEL",
  "tunnel-hillside",
  "rail",
  "machiya,0,137,68,1,23;garden,175,126,42,2,32;tunnel,348,193,113,0;tram,570,252,57,4;stairs,847,114,67,2;apartment,1000,152,121,4",
  "tree,154,1.1,26;pole,323;traffic,554;sign,833;bike,979",
  "ivy-covered tunnel portal and a little train emerging beside hillside homes",
);
L(
  "shibuya",
  "ebisu",
  "恵比寿レンガ広場",
  "EBISU BRICK SQUARE",
  "brick-market-plaza",
  "brick",
  "warehouse,0,189,101,3;cafe,228,131,76,2;fountain,404,156,42,4;garden,611,126,36,1;theater,791,185,111,7;terrace,1021,131,65,4",
  "banner,208;bench,381;statue,586;tree,764,1.1;umbrella,997",
  "red-brick arched halls and fountain surrounded by outdoor tables",
);
L(
  "shibuya",
  "daikanyama",
  "代官山のテラス",
  "DAIKANYAMA TERRACES",
  "terraced-boutiques",
  "slope",
  "bookstore,0,164,85,4,12;terrace,202,143,68,5,26;stairs,377,102,57,3;garden,523,144,39,4,21;cafe,715,135,73,5;shop,904,151,84,10;garden,1080,72,28,1",
  "tree,184,1,17;bench,359,1,24;flower,498,1,22;bike,692;planter,879;banner,1068",
  "stacked timber decks, garden stairs and low modern bookshop",
);
L(
  "shibuya",
  "hiroo",
  "広尾の散歩道",
  "HIROO GARDEN LANE",
  "quiet-garden-street",
  "park",
  "greenhouse,0,164,79,3;shop,205,126,75,2;garden,377,172,42,3;park,596,178,96,5;cafe,819,127,72,6;apartment,996,156,111,5",
  "flower,186;bike,355;bench,574;tree,797,1.1;planter,973",
  "flower seller, layered hedges and broad garden opening",
);
L(
  "shibuya",
  "sendagaya",
  "千駄ヶ谷の競技場道",
  "SENDAGAYA SPORTS WALK",
  "stadium-greenway",
  "pavers",
  "court,0,207,86,2;school,251,169,112,5;stairs,467,129,51,0;garden,647,139,33,2;museum,832,190,105,5;cafe,1061,91,65,2",
  "banner,229;tree,444,1.05;bench,621;bike,809;traffic,1043",
  "sports fencing, broad spectator stairs and patterned stadium-edge facade",
);
L(
  "shibuya",
  "sasazuka",
  "笹塚ガード商店街",
  "SASAZUKA UNDERTRACK",
  "rail-shopping",
  "rail",
  "viaduct,0,327,101,3;shop,21,128,64,2;market,179,125,50,5;station,372,211,90,6;canal,626,167,28,1;bridge,658,102,42,0;shop,839,128,79,7;apartment,1008,144,117,2",
  "pole,347;vending,604;bike,810;flower,988",
  "elevated shops beside a narrow stream and small station entrance",
);
L(
  "shibuya",
  "hatagaya",
  "幡ヶ谷六号通り",
  "HATAGAYA SIXTH STREET",
  "neighborhood-shopping",
  "asphalt",
  "arcade,0,218,92,5;shop,250,120,78,3;bath,412,128,95,1;market,587,167,53,2;apartment,803,154,110,1;record,1002,150,87,5",
  "foodcart,232;banner,393;vending,562;pole,777;bike,979",
  "local arcade portal, bathhouse chimney and open produce stand",
);
L(
  "shibuya",
  "uehara",
  "代々木上原の坂",
  "YOYOGI UEHARA HILL",
  "residential-steps",
  "slope",
  "apartment,0,146,114,4,22;stairs,173,117,68,4;garden,330,143,39,2,30;cafe,519,126,74,7,18;school,696,173,103,6;machiya,923,139,67,0;garden,1087,65,27,0",
  "tree,158,1.1,24;flower,311,1,29;bench,496,1,22;pole,671;bike,897;planter,1076",
  "retaining-wall stair route and bakery perched above garden terraces",
);
L(
  "shibuya",
  "miyashita",
  "宮下の高架公園",
  "MIYASHITA PARK DECK",
  "elevated-park",
  "plaza",
  "parking,0,220,91,3;garden,21,179,35,4,91;stairs,260,127,84,2;court,436,198,73,3,38;terrace,683,172,66,6;shop,906,246,96,11",
  "tree,236,1.05;bike,408;banner,657;bench,882;sign,1037",
  "raised lawn over parking bays, skateboard fence and wide outdoor steps",
);
L(
  "shibuya",
  "riverdeck",
  "渋谷川の遊歩道",
  "SHIBUYA RIVER WALK",
  "urban-river-deck",
  "waterfront",
  "canal,0,1152,37,4;tower,0,154,132,5,25;bridge,201,178,54,2;terrace,424,177,72,7,23;garden,653,127,37,4,23;footbridge,824,163,68,3;shop,1024,128,87,10,24",
  "tree,179,1.1,26;bench,401,1,22;umbrella,628,1,23;pole,800,1,21;boat,1006,0.65",
  "concrete river edges, layered cafe deck and angular pedestrian bridge",
);

// ASAKUSA: tiled roofs, craft streets, festival structures and riverside docks.
L(
  "asakusa",
  "kaminarimon",
  "雷門の大提灯",
  "KAMINARIMON APPROACH",
  "grand-lantern-gate",
  "stone",
  "machiya,0,153,76,5;market,191,139,54,6;gate,380,214,114,6;garden,647,105,35,0;machiya,793,160,73,6;shop,1003,149,80,4",
  "lantern,172;foodcart,351;stone,623;pine,775;banner,978",
  "large red lantern gate set between tiled souvenir roofs",
);
L(
  "asakusa",
  "nakamise",
  "仲見世の屋根並み",
  "NAKAMISE ROOFLINE",
  "temple-market",
  "stone",
  "market,0,174,61,7;machiya,200,111,72,6;market,343,173,58,8;gate,566,127,83,7;market,740,187,60,6;machiya,967,185,75,4",
  "lantern,187;crates,329;banner,539;foodcart,715;lantern,948",
  "alternating tiled souvenir stalls and red textile shop curtains",
);
L(
  "asakusa",
  "sensoji",
  "浅草寺の境内",
  "SENSOJI PRECINCT",
  "temple-court",
  "stone",
  "temple,0,231,118,3;garden,271,131,38,0;pagoda,451,103,142,1;gate,609,156,97,8;shrine,816,177,100,3;garden,1036,116,34,3",
  "pine,250,1.1;stone,425;lantern,582;statue,791;pine,1016",
  "wide temple eaves, tiered pagoda and incense-burner courtyard",
);
L(
  "asakusa",
  "sumida",
  "隅田川の桜堤",
  "SUMIDA CHERRY BANK",
  "river-promenade",
  "waterfront",
  "canal,0,1152,47,5;park,0,194,92,0,30;bridge,235,211,64,5;garden,495,140,39,0,31;dock,681,187,58,1;park,914,238,95,1,30",
  "tree,214,1.2,30;boat,469,0.8;bench,655,1,30;lantern,893,1,27;flower,1096,1,30",
  "broad river, riverside cherry canopy and low sightseeing-boat pier",
);
L(
  "asakusa",
  "azuma",
  "吾妻橋のたもと",
  "AZUMABASHI EMBANKMENT",
  "river-bridge",
  "waterfront",
  "canal,0,1152,45,6;bridge,0,306,92,6;stairs,344,126,69,4;terrace,514,166,70,8,28;warehouse,731,174,89,4,25;dock,951,201,61,2",
  "boat,323,0.9;traffic,490,1,22;bench,703,1,27;pole,930,1,24;stone,1098,1,25",
  "red steel bridge girders and stair descent to mooring docks",
);
L(
  "asakusa",
  "kappabashi",
  "かっぱ橋道具街",
  "KAPPABASHI KITCHEN ROW",
  "craft-shopping",
  "brick",
  "shop,0,151,99,12;warehouse,187,148,86,5;market,377,145,55,9;shop,574,129,91,11;factory,747,166,94,3;shop,966,186,97,12",
  "statue,169;crates,356;sign,547;vending,726;foodcart,941",
  "kitchenware display grids, ceramic stacks and oversized chef sign",
);
L(
  "asakusa",
  "denboin",
  "伝法院通り",
  "DENBOIN CRAFT LANE",
  "edo-craft-lane",
  "stone",
  "machiya,0,177,78,7;gate,215,139,89,9;machiya,398,139,69,8;garden,585,109,38,0;shop,737,147,81,13;machiya,932,220,82,7",
  "lantern,194;banner,377;stone,562;pine,716,0.9;crates,906",
  "black lattice craft fronts, narrow tiled gateway and Edo-style signs",
);
L(
  "asakusa",
  "hanayashiki",
  "花やしき遊園地前",
  "HANAYASHIKI FUN FAIR",
  "fairground-lane",
  "plaza",
  "theater,0,179,111,8;gate,216,153,97,10;playground,410,191,93,3;market,648,142,53,10;tower,837,116,129,6;cafe,998,154,77,8",
  "banner,198;foodcart,389;sign,626;lantern,814;flower,976",
  "carnival gate, colorful play towers and amusement-side ticket booth",
);
L(
  "asakusa",
  "rokku",
  "浅草六区の劇場",
  "ROKKU THEATER STREET",
  "retro-theaters",
  "brick",
  "theater,0,211,118,9;shop,250,125,88,14;stairs,418,110,45,0;theater,583,176,108,10;record,808,131,86,6;market,987,165,53,11",
  "banner,231;sign,397;statue,552;lantern,785;vending,964",
  "retro cinema fronts, stepped poster wall and little vinyl stall",
);
L(
  "asakusa",
  "hoppy",
  "ホッピー通り",
  "HOPPY STREET",
  "open-eating-lane",
  "brick",
  "machiya,0,136,71,9;terrace,170,151,61,9;shop,357,112,74,15;market,518,174,52,12;terrace,739,180,64,10;machiya,967,185,76,9",
  "lantern,152;foodcart,340;crates,494;umbrella,718;banner,944",
  "open table decks, rolled fabric awnings and dense paper lanterns",
);
L(
  "asakusa",
  "imado",
  "今戸の招き猫路地",
  "IMADO LUCKY CAT LANE",
  "craft-shrine",
  "stone",
  "shrine,0,176,96,4;garden,219,138,35,1;shop,400,129,80,16;machiya,580,147,70,10;factory,773,160,88,4;garden,980,172,39,0",
  "statue,194;pine,379,0.85;crates,554;lantern,752;flower,955",
  "paired cat statues, ceramics workshop and neighborhood shrine garden",
);
L(
  "asakusa",
  "matsuchi",
  "待乳山の石段",
  "MATSUTCHIYAMA STEPS",
  "hilltop-shrine",
  "slope",
  "garden,0,163,44,1,26;stairs,200,162,88,5;temple,405,211,107,4,31;garden,662,123,38,3,22;machiya,830,146,72,11;park,1023,129,84,2",
  "pine,183,1.2,27;stone,382,1,29;lantern,641,1,26;bench,807;flower,999",
  "long ceremonial stone stair and temple raised above tree-lined walls",
);
L(
  "asakusa",
  "mukojima",
  "向島の花街",
  "MUKOJIMA RIVER LANES",
  "river-teahouses",
  "waterfront",
  "canal,0,1152,31,7;machiya,0,178,77,12,20;bridge,218,137,45,7;garden,400,145,39,0,23;terrace,589,167,66,11,24;shrine,802,158,91,5,21;machiya,1005,147,69,13,19",
  "tree,199,1.2,21;lantern,378,1,23;boat,566,0.6;umbrella,778,1,22;pine,984,0.85,21",
  "small flower-district teahouse balconies along a quiet branch canal",
);
L(
  "asakusa",
  "tawara",
  "田原町の仏具通り",
  "TAWARAMACHI CRAFT ROW",
  "temple-supply-street",
  "pavers",
  "shop,0,165,91,17;machiya,206,133,73,14;warehouse,382,148,89,6;garden,580,111,31,3;shop,734,175,95,18;station,954,198,85,7",
  "sign,186;crates,362;lantern,557;stone,714;bike,931",
  "lacquered craft cabinets, warehouse shutters and subway entrance roof",
);
L(
  "asakusa",
  "kuramae",
  "蔵前の倉庫カフェ",
  "KURAMAE WAREHOUSE CAFES",
  "warehouse-river",
  "waterfront",
  "canal,0,1152,33,8;warehouse,0,207,99,7,22;cafe,248,137,77,9,24;dock,429,168,57,3;factory,646,172,95,5,20;terrace,866,175,65,12,21;garden,1074,78,30,2,20",
  "crates,228,1,23;boat,407,0.75;bench,623,1,21;pole,841,1,20;flower,1058,1,21",
  "converted warehouse cafes, timber loading dock and brick factory vents",
);
L(
  "asakusa",
  "okachimachi",
  "御徒町ガード市場",
  "OKACHIMACHI RAIL MARKET",
  "rail-market",
  "rail",
  "viaduct,0,381,104,4;market,23,152,60,13;shop,203,149,72,19;market,424,168,56,14;shop,637,124,91,17;arcade,806,198,95,6;warehouse,1041,111,79,0",
  "banner,397;foodcart,615;pole,783;crates,1023;vending,1125",
  "busy rail arch stalls, gem display windows and multicolored awnings",
);
L(
  "asakusa",
  "uenoedge",
  "上野の不忍みち",
  "UENO POND EDGE",
  "pond-garden",
  "park",
  "canal,0,1152,37,9;garden,0,171,46,5,24;pavilion,212,151,85,3,25;bridge,406,157,54,8;park,609,187,105,6,24;museum,846,213,111,6,25;garden,1090,62,28,1,24",
  "stone,191,1,24;boat,385,0.6;bench,586,1,24;tree,821,1.3,24;lantern,1075,1,23",
  "pond pavilion, lily-like water details and broad museum garden edge",
);
L(
  "asakusa",
  "yanaka",
  "谷中の夕やけ段々",
  "YANAKA SUNSET STEPS",
  "old-market-steps",
  "slope",
  "machiya,0,151,72,15,18;stairs,190,164,79,6;market,395,160,55,15,29;garden,598,122,33,0,18;shop,761,141,79,20;machiya,946,206,75,16",
  "statue,174,1,20;banner,375,1,29;foodcart,576,1,21;tree,742;bike,926",
  "broad sunset stairway descending into small tile-roof market shops",
);
L(
  "asakusa",
  "yoshiwara",
  "吉原の柳並木",
  "YOSHIWARA WILLOW WALK",
  "willow-street",
  "pavers",
  "machiya,0,167,77,17;garden,212,137,38,6;shrine,394,143,87,6;cafe,588,137,74,10;garden,770,127,36,6;apartment,947,205,118,5",
  "tree,190,1.25,0,3;lantern,372;stone,564;tree,748,1.3,0,3;bench,919",
  "willow-like hanging branches, old stone markers and quiet tiled fronts",
);
L(
  "asakusa",
  "festivaldock",
  "隅田の祭り船着場",
  "SUMIDA FESTIVAL PIER",
  "festival-dock",
  "waterfront",
  "canal,0,1152,48,10;dock,0,225,68,4;market,264,174,58,16,28;bridge,483,191,64,9;gate,723,134,94,11,27;terrace,905,247,72,13,29",
  "boat,245,1.1;lantern,460,1,27;banner,699,1,28;foodcart,883,1,28;umbrella,1080,1,29",
  "festival boat landing, hanging lantern strings and raised food terraces",
);

// OSAKA: canal geometry, elevated rail, shopping roofs and working waterfronts.
L(
  "osaka",
  "dotonbori",
  "道頓堀のネオン水辺",
  "DOTONBORI CANALSIDE",
  "neon-canal",
  "waterfront",
  "canal,0,1152,43,11;shop,0,158,114,21,27;bridge,200,184,62,10;theater,431,179,116,11,26;terrace,658,166,72,14,27;shop,868,137,103,22,26;dock,1042,110,52,5",
  "sign,180,1,26;boat,408,0.9;foodcart,635,1,27;lantern,846,1,26;banner,1025,1,27",
  "oversized restaurant silhouettes, neon water reflections and crowded decks",
);
L(
  "osaka",
  "ebisu",
  "戎橋の広場",
  "EBISUBASHI PLAZA",
  "canal-crossing",
  "waterfront",
  "canal,0,1152,42,12;tower,0,145,131,7,25;bridge,187,258,77,11;stairs,487,116,61,7;shop,649,154,106,23,23;terrace,849,161,69,15,26;garden,1054,98,32,1,24",
  "traffic,166,1,25;boat,464,0.8;sign,625,1,24;bench,827,1,24;banner,1032,1,25",
  "broad pedestrian canal bridge, stepped promenade and running-man-like light frame",
);
L(
  "osaka",
  "shinsaibashi",
  "心斎橋筋アーケード",
  "SHINSAIBASHI ARCADE",
  "grand-shopping-arcade",
  "pavers",
  "shop,0,136,103,24;arcade,174,271,115,7;shop,489,131,92,25;cafe,669,117,76,11;arcade,830,192,99,8;shop,1057,95,86,22",
  "sign,155;banner,467;bike,646;foodcart,808;vending,1041",
  "double arcade rooflines, brass posts and broad fashion-shop windows",
);
L(
  "osaka",
  "amerikamura",
  "アメリカ村の広場",
  "AMERIKAMURA TRIANGLE",
  "street-fashion-plaza",
  "plaza",
  "record,0,164,97,7;shop,202,129,91,26;stairs,373,131,47,1;garden,556,127,31,4;theater,731,181,114,12;cafe,957,195,81,12",
  "statue,183;bike,354;banner,529;bench,707;sign,936",
  "triangular stepped meeting plaza, mural shop wall and vinyl store",
);
L(
  "osaka",
  "namba",
  "なんば駅の高架",
  "NAMBA RAIL DECK",
  "terminal-rail",
  "rail",
  "station,0,284,111,8;stairs,326,133,80,8;viaduct,507,261,95,5;shop,524,110,60,23;shop,648,101,65,24;parking,813,178,99,4;shop,1030,122,90,25",
  "busstop,307;sign,481;vending,790;pole,1011;bike,1115",
  "large terminal canopy and elevated railway stores under riveted girders",
);
L(
  "osaka",
  "kuromon",
  "黒門市場",
  "KUROMON MARKET",
  "covered-food-market",
  "brick",
  "gate,0,156,92,12;market,191,177,61,17;warehouse,407,133,87,8;market,585,184,62,18;arcade,813,198,96,9;shop,1048,104,82,27",
  "foodcart,173;crates,388;banner,562;sign,793;lantern,1031",
  "fish-market roof gate, ice-box counters and striped produce stalls",
);
L(
  "osaka",
  "nipponbashi",
  "日本橋でんでん街",
  "NIPPONBASHI ELECTRIC ROW",
  "electronics-street",
  "asphalt",
  "shop,0,129,108,28;record,155,131,99,8;tower,324,131,132,8;shop,508,133,98,29;arcade,683,176,94,10;shop,905,139,104,28;warehouse,1069,83,78,1",
  "sign,140;vending,305;pole,481;banner,662;bike,884;sign,1059",
  "stacked electric shop facades, tiny screen grids and illuminated toy windows",
);
L(
  "osaka",
  "shinsekai",
  "新世界の串カツ街",
  "SHINSEKAI RETRO ROW",
  "retro-food-street",
  "brick",
  "gate,0,168,98,13;shop,202,124,91,30;theater,367,159,113,13;market,574,169,60,19;shop,788,137,102,31;machiya,974,178,77,18",
  "foodcart,183;sign,347;lantern,549;banner,766;vending,950",
  "retro illuminated gate, round food-shop signs and festival-style stalls",
);
L(
  "osaka",
  "tennoji",
  "天王寺公園の芝生",
  "TENNOJI PARK LAWNS",
  "urban-park",
  "park",
  "museum,0,190,107,7;garden,232,153,39,7;park,434,188,96,7;pavilion,669,139,80,4;playground,854,186,68,4;cafe,1073,79,62,13",
  "tree,211,1.15;bench,410;flower,648;statue,832;banner,1059",
  "open lawns, museum garden and broad timber picnic shelter",
);
L(
  "osaka",
  "abeno",
  "阿倍野の路面電車",
  "ABENO TRAM STOP",
  "tram-boulevard",
  "rail",
  "tower,0,148,140,9;station,187,183,82,9;tram,410,283,59,5;garden,738,118,33,4;shop,904,141,89,32;cafe,1070,82,65,14",
  "traffic,166;pole,389;busstop,716;tree,878,1;bike,1058",
  "low streetcar stop under a tall stepped office silhouette",
);
L(
  "osaka",
  "umeda",
  "梅田の連絡橋",
  "UMEDA SKY DECK",
  "interchange-deck",
  "plaza",
  "tower,0,158,144,10;footbridge,201,240,96,4;stairs,470,132,82,9;station,650,228,108,10;terrace,925,137,67,16;shop,1086,66,70,27",
  "busstop,179;sign,450;traffic,627;banner,902;bike,1075",
  "tall glazed edge tower, suspended station deck and multi-flight stair",
);
L(
  "osaka",
  "nakazakicho",
  "中崎町の古い街角",
  "NAKAZAKICHO BACKSTREETS",
  "old-house-cafes",
  "brick",
  "machiya,0,139,72,19;cafe,175,129,74,15;record,346,121,83,9;garden,514,114,35,3;machiya,669,146,70,20;shop,861,128,79,33;cafe,1024,128,73,16",
  "flower,155;bike,327;pole,491;bench,649;planter,838;banner,1009",
  "old-house cafes, irregular pocket gardens and vinyl-shop stoops",
);
L(
  "osaka",
  "tenma",
  "天満ガード横丁",
  "TENMA RAIL TAVERN LANE",
  "rail-food-lane",
  "rail",
  "viaduct,0,350,103,6;market,19,147,55,20;shop,197,125,69,34;shop,391,116,86,35;market,550,178,56,21;station,774,207,91,11;machiya,1021,131,70,21",
  "foodcart,370;lantern,530;pole,752;crates,1003;vending,1130",
  "dense grill stalls under viaduct arches and a small local platform",
);
L(
  "osaka",
  "tenjin",
  "天神橋筋の屋根",
  "TENJINBASHISUJI ROOFS",
  "long-shopping-arcade",
  "pavers",
  "arcade,0,248,109,11;shop,286,127,91,36;market,457,162,57,22;arcade,667,224,104,12;shop,937,139,87,37;garden,1102,50,27,0",
  "banner,268;bike,437;foodcart,641;sign,914;vending,1090",
  "long glazed arcade sections separated by a local open-air junction",
);
L(
  "osaka",
  "nakanoshima",
  "中之島の中州",
  "NAKANOSHIMA ISLAND",
  "river-civic-park",
  "waterfront",
  "canal,0,1152,43,13;museum,0,221,117,8,26;bridge,264,189,63,12;garden,501,165,42,8,28;terrace,714,176,69,17,27;park,935,217,99,8,27",
  "tree,242,1.1,27;boat,478,0.9;bench,692,1,28;statue,914,1,27;flower,1083,1,27",
  "civic red-brick hall, rose beds and a two-bank island promenade",
);
L(
  "osaka",
  "kitahama",
  "北浜リバーサイド",
  "KITAHAMA RIVER CAFES",
  "river-business-terrace",
  "waterfront",
  "canal,0,1152,39,14;tower,0,142,131,11,25;terrace,184,180,72,18,25;bridge,408,170,58,13;cafe,623,139,79,17,24;warehouse,809,177,101,9,24;dock,1030,122,56,6",
  "umbrella,164,1,25;boat,387,0.8;bench,600,1,24;pole,786,1,24;banner,1009,1,24",
  "river-facing cafe decks and old office warehouse beside angular bridge",
);
L(
  "osaka",
  "osakacastle",
  "大阪城の石垣",
  "OSAKA CASTLE MOAT",
  "castle-park",
  "waterfront",
  "canal,0,1152,38,15;garden,0,188,54,9,25;bridge,230,175,67,14;temple,449,222,121,5,29;park,721,182,108,9,25;gate,950,202,104,14,26",
  "pine,210,1.25,26;stone,426,1,27;boat,695,0.7;lantern,928,1,26;statue,1090,1,26",
  "massive stone courses, multi-eave castle gate and moat bridge",
);
L(
  "osaka",
  "tempozan",
  "天保山の船着場",
  "TEMPOZAN HARBOR PIER",
  "harbor-docks",
  "waterfront",
  "canal,0,1152,49,16;warehouse,0,196,99,10,29;dock,238,233,91,7;factory,516,167,112,6,27;bridge,727,173,63,15;terrace,944,208,73,19,30",
  "crates,217,1,28;boat,494,1.2;pole,705,1,27;banner,922,1,28;busstop,1070,1,29",
  "cargo cranes, harbor warehouse and broad passenger-boat landing",
);
L(
  "osaka",
  "taisho",
  "大正の運河工場",
  "TAISHO INDUSTRIAL CANAL",
  "industrial-canal",
  "waterfront",
  "canal,0,1152,43,17;factory,0,210,119,7,25;bridge,254,204,76,16;warehouse,503,179,95,11,25;dock,728,182,78,8;factory,957,195,111,8,25",
  "pole,232,1,25;boat,481,1;crates,707,1,24;banner,934,1,25;stone,1092,1,25",
  "pipe-stacked workshops, steel truss bridge and working barge wharf",
);
L(
  "osaka",
  "sumiyoshi",
  "住吉の太鼓橋",
  "SUMIYOSHI DRUM BRIDGE",
  "shrine-pond",
  "stone",
  "canal,0,1152,30,18;park,0,168,91,10,19;bridge,209,190,83,17;torii,443,153,96,2,20;shrine,645,196,106,7,20;garden,892,142,42,0,20;machiya,1071,81,64,22,19",
  "pine,188,1.1,20;lantern,422,1,20;stone,620,1,20;boat,869,0.55;banner,1053,1,20",
  "steep arched red drum bridge, shrine gates and pine-fringed pond",
);

// KYOTO: river walks, temple hills, old timber lanes and outer green districts.
L(
  "kyoto",
  "gion",
  "祇園の格子通り",
  "GION LATTICE LANE",
  "timber-teahouses",
  "stone",
  "machiya,0,182,81,23;shrine,223,134,89,8;machiya,398,146,74,24;garden,593,112,34,0;machiya,748,177,79,25;terrace,973,179,64,20",
  "lantern,203;stone,376;banner,569;pine,726,0.95;umbrella,950",
  "ochre lattice teahouses, hanging noren and narrow recessed entrances",
);
L(
  "kyoto",
  "yasaka",
  "八坂の塔への坂",
  "YASAKA PAGODA LANE",
  "pagoda-slope",
  "slope",
  "machiya,0,151,74,26,18;stairs,184,120,59,10;pagoda,349,113,145,2,26;garden,510,131,38,0,21;machiya,686,173,78,27,12;shop,908,147,83,38;shrine,1080,72,67,1",
  "lantern,166,1,18;stone,326,1,24;pine,487,1,23;banner,664;flower,884;sign,1069",
  "sloping timber facades and a five-tier silhouette above stepped stone walls",
);
L(
  "kyoto",
  "ninenzaka",
  "二年坂の石段",
  "NINENZAKA STONE STEPS",
  "historic-stair-street",
  "slope",
  "machiya,0,164,77,28,22;stairs,199,174,88,11;shop,414,129,78,39,36;garden,590,115,39,1,24;stairs,745,105,51,5;machiya,894,173,75,29;market,1090,62,45,23",
  "lantern,182,1,24;stone,392,1,34;flower,567,1,27;bench,725,1,17;banner,873;crates,1079",
  "two unequal stair runs with pottery shop landings and mossy garden wall",
);
L(
  "kyoto",
  "sannenzaka",
  "三年坂の茶店",
  "SANNENZAKA TEA SHOPS",
  "tea-shop-stairs",
  "slope",
  "cafe,0,145,78,18,19;stairs,179,135,72,12;machiya,353,162,78,30,32;temple,562,184,102,6,19;garden,793,123,35,2;shop,959,193,82,40",
  "umbrella,163,1,21;stone,333,1,31;lantern,539,1,25;pine,771;flower,938",
  "steep tea-house steps, deep temple eaves and small parasol terrace",
);
L(
  "kyoto",
  "kiyomizu",
  "清水の山門道",
  "KIYOMIZU HILLSIDE",
  "hillside-temple",
  "slope",
  "park,0,183,109,11,22;stairs,225,152,89,13;gate,421,176,113,15,31;temple,644,234,118,7,27;garden,926,134,45,0,21;machiya,1086,66,61,31",
  "pine,204,1.2,25;lantern,400,1,31;stone,621,1,28;tree,902,1.05,24;banner,1074,1,18",
  "large raised timber temple veranda and ceremonial stair approach",
);
L(
  "kyoto",
  "kamo",
  "鴨川の飛び石",
  "KAMOGAWA STEPPING STONES",
  "river-open-bank",
  "waterfront",
  "canal,0,1152,46,19;garden,0,171,39,10,28;bridge,214,183,59,18;park,445,177,96,12,29;terrace,671,191,72,21,28;garden,909,243,42,1,29",
  "stone,192,1,27;boat,420,0.6;bench,649,1,28;tree,886,1.2,29;stone,1061,1,8",
  "wide river, low stepping-stone shapes and long grassy embankment",
);
L(
  "kyoto",
  "pontocho",
  "先斗町の川床",
  "PONTOCHO RIVER TERRACES",
  "teahouse-river-deck",
  "waterfront",
  "canal,0,1152,35,20;machiya,0,164,79,32,24;terrace,204,175,74,22,25;bridge,424,151,54,19;machiya,620,168,76,33,23;terrace,835,184,73,23,25;shrine,1054,98,78,9,23",
  "lantern,184,1,24;umbrella,402,1,24;boat,597,0.65;banner,812,1,24;bench,1037,1,24",
  "long timber dining decks on stilts and narrow lantern-lined teahouses",
);
L(
  "kyoto",
  "shirakawa",
  "白川の柳と石橋",
  "SHIRAKAWA STONE BRIDGE",
  "willow-canal",
  "waterfront",
  "canal,0,1152,33,21;machiya,0,177,78,34,22;bridge,218,153,49,20;garden,414,145,39,6,22;shrine,604,148,92,10,22;footbridge,797,151,65,5;machiya,991,161,73,35,21",
  "tree,197,1.15,22,3;stone,391,1,21;lantern,583,1,22;tree,774,1.2,22,3;boat,971,0.6",
  "shallow canal, willow branches and unequal stone-and-timber crossings",
);
L(
  "kyoto",
  "nishiki",
  "錦市場の天井",
  "NISHIKI MARKET ROOFS",
  "covered-market",
  "brick",
  "arcade,0,242,101,13;market,276,159,59,24;shop,475,128,86,41;arcade,648,211,98,14;market,900,166,58,25;machiya,1088,64,63,36",
  "foodcart,256;crates,455;banner,626;lantern,880;vending,1078",
  "colored-panel market ceilings, pickle barrels and tile-roofed vendors",
);
L(
  "kyoto",
  "teramachi",
  "寺町の古書店",
  "TERAMACHI BOOK ARCADE",
  "bookstore-arcade",
  "stone",
  "bookstore,0,155,92,5;arcade,195,209,104,15;shrine,449,137,89,11;bookstore,635,132,81,6;shop,811,147,86,42;machiya,1005,147,74,37",
  "banner,176;stone,428;lantern,610;bike,789;sign,984",
  "book tables beneath a tiled arcade and shrine tucked between shop fronts",
);
L(
  "kyoto",
  "fushimi",
  "伏見稲荷の鳥居道",
  "FUSHIMI TORII APPROACH",
  "torii-path",
  "stone",
  "shrine,0,174,103,12;torii,214,128,94,3;torii,377,105,83,4,10;torii,527,93,76,5,19;park,665,181,110,13;market,891,153,57,26;machiya,1076,76,65,38",
  "pine,194,1.1;statue,359;stone,505,1,12;lantern,643;foodcart,869;banner,1061",
  "three diminishing torii silhouettes climbing toward cedar-like trees",
);
L(
  "kyoto",
  "sake",
  "伏見の酒蔵運河",
  "FUSHIMI SAKE CANAL",
  "brewery-canal",
  "waterfront",
  "canal,0,1152,42,22;warehouse,0,212,102,12,27;bridge,256,174,57,21;machiya,478,165,77,39,27;dock,689,175,61,9;warehouse,910,242,106,13,26",
  "tree,234,1.2,27,3;boat,453,0.95;crates,667,1,26;lantern,888,1,26;banner,1064,1,26",
  "white-plaster brewery walls, barrel docks and willow-lined boat canal",
);
L(
  "kyoto",
  "arashiyama",
  "嵐山の渡月橋",
  "ARASHIYAMA RIVER BRIDGE",
  "wide-river-bridge",
  "waterfront",
  "canal,0,1152,48,23;park,0,186,119,14,28;bridge,231,304,81,22;garden,580,130,42,2,29;temple,755,204,109,8,28;dock,1005,147,59,10",
  "pine,209,1.25,29;boat,558,1;stone,733,1,28;lantern,984,1,28;bench,1118,1,27",
  "long timber river bridge, forested bank and low rowing-boat dock",
);
L(
  "kyoto",
  "bamboo",
  "嵯峨野の竹林",
  "SAGANO BAMBOO PATH",
  "bamboo-grove",
  "park",
  "bamboo,0,218,139,0;garden,255,121,42,0;gate,418,137,90,16;bamboo,600,224,132,1;pavilion,870,136,77,5;bamboo,1043,109,119,2",
  "stone,237;lantern,398;bench,578;pine,847,0.9;banner,1025",
  "dense jointed bamboo stalks, woven low fences and a narrow temple gate",
);
L(
  "kyoto",
  "philosopher",
  "哲学の道の水路",
  "PHILOSOPHERS CANAL",
  "cherry-canal-path",
  "waterfront",
  "canal,0,1152,29,24;park,0,174,88,0,20;bridge,215,123,44,23;garden,381,159,39,0,21;cafe,585,132,74,19,20;footbridge,762,142,59,6;park,949,203,93,1,20",
  "tree,195,1.2,20;stone,360,1,20;bench,562,1,20;flower,740,1,20;tree,927,1.3,20",
  "small stone bridges under cherry branches and a tea kiosk by the canal",
);
L(
  "kyoto",
  "nanzenji",
  "南禅寺の水路閣",
  "NANZENJI AQUEDUCT",
  "brick-aqueduct",
  "stone",
  "temple,0,199,109,9;garden,239,125,41,0;viaduct,407,332,119,7;park,786,175,111,15;shrine,1005,147,92,13",
  "pine,220,1.2;stone,386;lantern,764;bench,984;flower,1125",
  "red-brick aqueduct arches through a temple garden with mossy stone edges",
);
L(
  "kyoto",
  "nijo",
  "二条の城壁道",
  "NIJO CASTLE WALLS",
  "castle-wall",
  "stone",
  "garden,0,186,53,11;gate,228,188,112,17;garden,463,139,48,11;temple,652,218,115,10;park,914,163,97,16;shop,1101,51,58,1",
  "pine,208,1.3;stone,440;lantern,626;bench,893;banner,1088",
  "thick plaster-and-stone walls, black tiled gate and clipped pine garden",
);
L(
  "kyoto",
  "nishijin",
  "西陣の織物工房",
  "NISHIJIN WEAVING LANES",
  "textile-workshops",
  "brick",
  "machiya,0,177,79,40;factory,218,151,97,9;shop,411,134,83,43;garden,590,113,36,2;warehouse,747,176,93,14;machiya,970,182,78,41",
  "banner,199;crates,391;bike,568;flower,726;lantern,948",
  "timber weaving studios, sawtooth skylights and hanging patterned textiles",
);
L(
  "kyoto",
  "demachi",
  "出町柳の合流点",
  "DEMACHI RIVER FORK",
  "river-confluence",
  "waterfront",
  "canal,0,1152,45,25;station,0,208,89,12,26;bridge,250,186,61,24;garden,480,170,45,12,28;bridge,697,165,55,25;park,908,244,103,17,28",
  "tree,230,1.1,27;stone,459,1,12;bench,674,1,27;boat,886,0.65;flower,1066,1,28",
  "two bridge spans around a triangular grassy river confluence",
);
L(
  "kyoto",
  "ohara",
  "大原の里みち",
  "OHARA COUNTRY LANE",
  "rural-temple-garden",
  "park",
  "machiya,0,164,82,42;garden,206,167,46,13;waterfall,416,132,75,0;temple,594,212,110,11;park,854,167,117,18;greenhouse,1057,95,72,4",
  "pine,185,1.2;stone,394;flower,570;bench,833;banner,1040",
  "thatched-looking farmhouse eaves, irrigated beds and mountain garden cascade",
);

export const LOCATIONS = deepFreeze(authored);
export const CITY_IDS = deepFreeze([
  "nakano",
  "shinjuku",
  "shibuya",
  "asakusa",
  "osaka",
  "kyoto",
]);
export const LOCATIONS_BY_CITY = deepFreeze(
  Object.fromEntries(
    CITY_IDS.map((cityId) => [
      cityId,
      LOCATIONS.filter((l) => l.cityId === cityId),
    ]),
  ),
);
export const LOCATION_COUNT = LOCATIONS.length;
export const ENVIRONMENT_COMBINATIONS =
  LOCATIONS.length * SEASONS.length * WEATHERS.length;
const indexOf = (value, length) => {
  const number = Number(value);
  return (
    ((Math.trunc(Number.isFinite(number) ? number : 0) % length) + length) %
    length
  );
};
export function getLocation(cityId = "nakano", index = 0) {
  const list = LOCATIONS_BY_CITY[cityId] || LOCATIONS_BY_CITY.nakano;
  if (typeof index === "string") {
    const found = list.find((entry) => entry.id === index);
    if (found) return found;
  }
  return list[indexOf(index, list.length)];
}
export function getSeason(value = "spring") {
  return (
    SEASONS.find((entry) => entry.id === (value?.id || value)) ||
    SEASONS[indexOf(typeof value === "number" ? value : 0, SEASONS.length)]
  );
}
export function getWeather(value = "sunny") {
  const id = value?.id || value;
  const alias =
    {
      clear: "sunny",
      sun: "sunny",
      cloud: "cloudy",
      rainy: "rain",
      windy: "wind",
      snowy: "snow",
      thunderstorm: "storm",
      muddy: "mud",
    }[id] || id;
  return (
    WEATHERS.find((entry) => entry.id === alias) ||
    WEATHERS[indexOf(typeof value === "number" ? value : 0, WEATHERS.length)]
  );
}
/** Resolves simple simulation state without importing or coupling to simulation. */
export function environmentFor(state = {}) {
  const cityId =
    state.cityId || state.route?.cityId || state.location?.cityId || "nakano";
  let location = state.location;
  if (typeof location === "string")
    location = LOCATIONS.find((entry) => entry.id === location);
  if (!location?.modules)
    location = getLocation(
      cityId,
      state.locationIndex ??
        state.neighborhoodIndex ??
        Math.min(
          19,
          Math.floor(
            (Math.max(0, Number(state.distance) || 0) /
              Math.max(
                1,
                Number(state.routeLength ?? state.route?.distance) || 1680,
              )) *
              20,
          ),
        ),
    );
  return {
    location,
    season: getSeason(state.season ?? state.seasonId),
    weather: getWeather(
      state.weather ?? state.weatherId ?? state.route?.weather,
    ),
  };
}
