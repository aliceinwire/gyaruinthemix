import { JOURNEY_STAGE_COUNT, getJourneyChoices, getJourneyNode } from "./src/journey.js";
import { selectCrewDialogue, selectCrewEvent } from "./src/crew-dialogue.js";
import { createSaveStore } from "./src/save-store.js";
import { prepareRouteArt, prepareGameArt } from "./src/resources.js";
import { bindGameInput } from "./src/input.js";
import { createSceneUI } from "./src/scene-ui.js";
import { createGameAudio } from "./src/audio.js";
import { getDistricts, getDistrictScene } from "./src/district-art.js";
import {
  CAR_CATALOG,
  STARTING_UPGRADE_CATALOG,
  PAINT_OPTIONS,
  WHEEL_OPTIONS,
  DECAL_OPTIONS,
  getCarProfile,
  getCarAppearance,
  buyStartingUpgrade,
  startingUpgradePrice,
  customizeStartingCar,
  startingCustomizationPrice,
  getCarReveal,
  awardCompletion,
  unlockCar,
  equipStartingCar,
} from "./src/garage.js";
import { drawCharacter } from "./src/character-actions.js";
import {
  createState,
  cancelRush,
  update,
  nextRoute,
  ROUTES,
  UPGRADE_CATALOG,
  buyUpgrade,
  upgradePrice,
  retryRoute,
  answerQuiz,
  exportCampaignSave,
  restoreCampaignSave,
  changeRouteBeforeStart,
  campaignEnvironment,
  beginCampaign,
  chooseStageDestination,
  selectNextJourneyDestination,
} from "./src/simulation.js";
import { questionForStage } from "./src/questions.js";
import { render, drawCar } from "./src/renderer.js";
import { drawMap, drawFinale, preloadJourneyMap, hitTestMapChoice } from "./src/campaign.js";
const $ = (s) => document.querySelector(s),
  canvas = $("#game"),
  ctx = canvas.getContext("2d", { alpha: false });
const campaignSeed = () => Math.floor(Math.random() * 0x7fffffff);
function newTour(progress) {
  const seed = campaignSeed();
  const fresh = createState({
    routeIndex: 0,
    routeOption: "scenic",
    seed,
    runId:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tour-${Date.now().toString(36)}-${seed.toString(36)}-${Math.random().toString(36).slice(2)}`,
    ...campaignEnvironment(seed, 0),
  });
  if (progress) equipStartingCar(fresh, progress, getCarProfile(fresh).id);
  return fresh;
}
let state = newTour(),
  screen = "menu",
  roadChoice = "scenic",
  selectedNodeId = null,
  pendingNext = false,
  paused = false,
  last = 0,
  accumulator = 0,
  visualTime = 0,
  toastTime = 0,
  ready = false;
let musicPanelOpen = false;
let musicReturnFocus = null;
let storage;
try {
  storage = globalThis.localStorage;
} catch {}
const saves = createSaveStore(storage);
let meta = saves.loadMeta(),
  savedTour = saves.loadCampaign(),
  storageWarningShown = false;
function storageWarning() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  $("#car-save-warning").hidden = false;
  $("#car-save-warning").textContent = "セーブできへんかった。解禁や買い物の記録は、この画面を閉じると残らへんかもしれんで。";
  toast("このブラウザではセーブできへんみたい。閉じる前に気ぃつけてな。");
}
function saveMeta() {
  if (!saves.saveMeta(meta)) storageWarning();
}
function syncResume() {
  $("#resume-tour").hidden = !savedTour;
}
function saveTour() {
  const result = saves.saveCampaign(state);
  savedTour = result.campaign;
  syncResume();
  if (!result.persisted) storageWarning();
}
syncResume();
$("#resume-tour").addEventListener("click", () => {
  if (!ready || !savedTour) return;
  state = restoreCampaignSave(exportCampaignSave(savedTour));
  roadChoice = state.routeOption;
  if (!state.campaignStarted && state.routeIndex === 0 && state.distance === 0) {
    setScreen("cars"); renderGarage(); $("#cars-ready").focus();
  } else if (state.status === "won" && state.campaignComplete) showResult();
  else openMap(state.status === "won");
});
const sceneUI = createSceneUI();
const controls = bindGameInput({
  isPlaying: () => screen === "playing" && !musicPanelOpen,
  isQuiz: () => screen === "quiz" && !musicPanelOpen,
  isPaused: () => paused,
  onPause: setPause,
  onAnswer: chooseAnswer,
  onInteraction: () => unlockSound(),
});
const input = controls.input,
  releaseInput = () => { controls.release(); cancelRush(state); };
const reducedMotion = false; // Crew and game animation are always on.
const music = $("#music");
const audio = createGameAudio({
  music,
  button: $("#sound"),
  status: $("#music-status"),
  onEnabledChange: enabled => { $("#music-toggle").textContent = enabled ? "音楽と効果音をオフ" : "音楽と効果音をオン"; },
  canPlay: () => musicPanelOpen || !paused,
});
const beep = (...args) => audio.beep(...args),
  unlockSound = () => audio.unlock();
function setMusicPanel(open) {
  if (musicPanelOpen === open) return;
  const panel = $("#music-panel");
  if (open) musicReturnFocus = document.activeElement;
  musicPanelOpen = open;
  releaseInput();
  accumulator = 0;
  document.body.dataset.musicOpen = String(open);
  $(".shell").inert = open;
  $("#music-open").setAttribute("aria-expanded", String(open));
  $("#music-close").hidden = !open;
  $("#music-toggle").hidden = !open;
  if (open) {
    panel.open = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "music-heading");
    $("#music-toggle").textContent = audio.enabled ? "音楽と効果音をオフ" : "音楽と効果音をオン";
    $("#music-close").focus();
    unlockSound();
  } else {
    panel.removeAttribute("role");
    panel.removeAttribute("aria-modal");
    panel.removeAttribute("aria-labelledby");
    if (paused) audio.pause();
    if (screen === "playing" && !paused) canvas.focus({preventScroll:true});
    else (musicReturnFocus?.isConnected ? musicReturnFocus : $("#music-open")).focus({preventScroll:true});
  }
}
$("#music-open").addEventListener("click", () => setMusicPanel(true));
$("#music-close").addEventListener("click", () => setMusicPanel(false));
$("#music-toggle").addEventListener("click", () => { $("#sound").click(); $("#music-toggle").textContent = audio.enabled ? "音楽と効果音をオフ" : "音楽と効果音をオン"; });
$("#music-panel summary").addEventListener("click", event => { if (musicPanelOpen) event.preventDefault(); });
document.addEventListener("keydown", event => {
  if (!musicPanelOpen) return;
  // Keep underlying quiz shortcuts and scene dialog traps out of this dialog.
  event.stopPropagation();
  if (event.code === "Escape") { event.preventDefault(); setMusicPanel(false); return; }
  if (event.code !== "Tab") return;
  const nodes = [...$("#music-panel").querySelectorAll("summary,button:not([hidden]),iframe,a[href]")];
  const first = nodes[0], last = nodes.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}, true);

function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("on");
  toastTime = 2.1;
}
let dialogueUntil = 0, lastDialogueId = null;
function say(text, speaker = "DJちゃな / ナビ担当", holdSeconds = 5) {
  dialogueUntil = visualTime + holdSeconds;
  $("#dialogue").textContent = text;
  $("#speaker").textContent = speaker;
}
function setPause(value) {
  if (screen !== "playing") return;
  paused = value;
  releaseInput();
  $("#pause-overlay").hidden = !paused;
  $("#pause").textContent = paused ? "ほな、再開" : "ひと休み";
  accumulator = 0;
  if (paused) {
    if (document.activeElement !== music) audio.pause();
    $("#resume").focus();
  } else {
    canvas.focus({ preventScroll: true });
    unlockSound();
  }
}
function setScreen(value) {
  screen = value;
  releaseInput();
  sceneUI.show(value);
}
function showMapPanel(panel) {
  sceneUI.mapPanel(panel);
  $(panel === "garage" ? "#garage-tab" : "#route-tab").focus();
  $("#route-panel").scrollIntoView({ block: "start", behavior: "instant" });
}
$("#route-tab").addEventListener("click", () => showMapPanel("route"));
$("#garage-tab").addEventListener("click", () => showMapPanel("garage"));
$("#garage-done").addEventListener("click", () => showMapPanel("route"));
function home() {
  paused = false;
  pendingNext = false;
  releaseInput();
  state = newTour(meta);
  setScreen("menu");
  say("ありねぇ！ハート積んで、クラブ行こ！");
  hud();
  $(savedTour ? "#resume-tour" : "#story").focus();
}
function openMap(next = false) {
  pendingNext = next;
  $("#change-starting-car").hidden = !atNewRunGarage();
  releaseInput();
  setScreen("map");
  sceneUI.mapPanel("route");
  const route = ROUTES[next ? state.routeIndex + 1 : state.routeIndex];
  mapClimate = next
    ? campaignEnvironment(state.seed, state.routeIndex + 1)
    : { season: state.season, weather: state.weather };
  $("#climate-summary").textContent =
    `${seasonNames[mapClimate.season]}・${weatherNames[mapClimate.weather]}やで。${weatherTips[mapClimate.weather]}`;
  $("#map-heading").textContent = `次のフロア / ${route.club}`;
  $("#map-subtitle").textContent = `${route.goal}のフロアへ、どっちで行く？`;
  const stageIndex = next ? state.routeIndex + 1 : state.routeIndex;
  const choices = getJourneyChoices(stageIndex,state.seed);
  selectedNodeId = choices.find(node=>node.nodeId===(next?state.pendingJourneyNodeId:state.journeyNodeId))?.nodeId || choices[0].nodeId;
  roadChoice = getJourneyNode(selectedNodeId).routeOption;
  renderDestinationChoices();
  warmMapArt();
  renderShop();
  hud();
  $("#route-tab").focus();
}
function enterPlay() {
  paused = false;
  releaseInput();
  setScreen("playing");
  canvas.tabIndex = 0;
  canvas.focus({ preventScroll: true });
  $("#pause").textContent = "ひと休み";
  say(state.route.intro || "ハートで仲間増やして、EVで充電やで！");
  toast("SPACEで飛ぶ · Zでハート · Eで充電 · Xでテキーラ加速や");
  unlockSound();
  accumulator = 0;
  saveTour();
  hud();
  $(".cabinet").scrollIntoView({ block: "start", behavior: "instant" });
}
let departing = false;
function warmMapArt() {
  if (screen !== "map") return;
  const route = ROUTES[pendingNext ? state.routeIndex + 1 : state.routeIndex];
  preloadJourneyMap(pendingNext ? state.routeIndex+1 : state.routeIndex,state.seed,mapClimate.season).catch(()=>{});
  prepareRouteArt({
    cityId: route.cityId,
    locationIndex: getJourneyNode(selectedNodeId)?.locationIndex || 0,
    season: mapClimate.season,
  }).catch(() => toast("街の絵、読み込み直してるで。出発で再試行するな。"));
}

async function depart() {
  if (!ready || departing) return;
  departing = true;
  const controls = [...$("#route-panel").querySelectorAll("button,select")];
  const priorDisabled = controls.map((n) => n.disabled);
  controls.forEach((n) => (n.disabled = true));
  const nextCity =
    ROUTES[pendingNext ? state.routeIndex + 1 : state.routeIndex].cityId;
  try {
    await prepareRouteArt({
      cityId: nextCity,
      locationIndex: getJourneyNode(selectedNodeId)?.locationIndex || 0,
      season: mapClimate.season,
    });
  } catch {
    toast("街の絵が読み込めへんかった。もう一回出発押してな。");
    departing = false;
    controls.forEach((n, i) => (n.disabled = priorDisabled[i]));
    return;
  }
  departing = false;
  controls.forEach((n, i) => (n.disabled = priorDisabled[i]));
  if (screen !== "map") return;
  if (pendingNext) {
    state.season = mapClimate.season;
    state.weather = mapClimate.weather;
    state = nextRoute(state, roadChoice, selectedNodeId);
    pendingNext = false;
  }
  state = changeRouteBeforeStart(state, roadChoice, {
    ...mapClimate,
    journeyNodeId: selectedNodeId,
    locationIndex: getJourneyNode(selectedNodeId)?.locationIndex || 0,
  });
  beginCampaign(state);
  enterPlay();
}
const weatherTips = {
  sunny: "晴れた夜は、ロケット日和。",
  cloudy: "雲の下でもネオンは光るで。",
  rain: "屋根を閉めて走行。着地後は濡れた道で少し減速。",
  storm: "屋根とワイパー作動。ロケット消費が増えるからEVを活用！",
  snow: "雪道はゆっくり走行。着地後の回復にも少し時間がかかるで。",
  fog: "ヘッドライト点灯。霧の向こうの障害物に注意！",
  mud: "泥が車に付着。ラリー仕様で走るけど、ロケットの電池消費は多め。",
  wind: "空中で風に揺られるで。ロケットの長押し時間を調整しよう。",
};
const seasonNames = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };
const weatherNames = {
  sunny: "晴れ",
  cloudy: "くもり",
  rain: "雨",
  storm: "嵐",
  snow: "雪",
  fog: "霧",
  mud: "ぬかるみ",
  wind: "強風",
};
let mapClimate = { season: state.season, weather: state.weather };
function atNewRunGarage() {
  return state.routeIndex === 0 && !state.campaignStarted && state.distance === 0;
}
function renderShop() {
  renderGarage();
  $("#shop").replaceChildren();
  for (const item of UPGRADE_CATALOG) {
    const node = document.createElement("article"); node.className = "shop-item";
    const level = state.upgrades[item.id] || 0, price = upgradePrice(state, item.id);
    const repairFull = item.id === "repair" && state.integrity >= state.integrityCapacity;
    const max = repairFull || (item.id !== "repair" && level >= item.maxLevel);
    node.innerHTML = `<h3>${item.name}</h3><p>${item.description}</p><small>${item.id === "repair" ? "お手入れ" : `盛り ${level} / ${item.maxLevel}`}</small>`;
    const button = document.createElement("button");
    button.textContent = repairFull ? "修理いらんで" : max ? "めっちゃ盛れた" : `${price} コインで${item.id === "repair" ? "直そ" : "盛ろ"}`;
    button.disabled = max || state.money < price || state.status !== "won" || !state.campaignStarted;
    button.addEventListener("click", () => {
      if (!buyUpgrade(state, item.id)) return;
      saveTour(); beep(750); renderShop(); hud(); toast(`${item.name}、準備できたで！`);
    });
    node.append(button); $("#shop").append(node);
  }
  $("#shop-status").textContent = "ハートで稼いだコインで、いま乗ってるくるまを盛れるで。";
}
function renderGarage() {
  const grid = $("#car-garage");
  grid.replaceChildren();
  const current = getCarProfile(state);
  const atStart =
    state.routeIndex === 0 && !state.campaignStarted && state.distance === 0;
  $("#garage-wallet").textContent =
    `${state.money} コイン / ギャルポイント ${meta.completionPoints} · ${atStart ? "最初に乗るくるま、選ぼか" : "この旅はこのくるまで行くで"}`;
  $("#car-select-wallet").textContent = `${meta.completionPoints} ギャルポイント · 今回は ${current.name}`;
  $("#starting-customization").hidden = !atStart;
  if (!atStart) return;
  renderStartingCustomization();
  for (const car of CAR_CATALOG) {
    const owned = meta.ownedCars.includes(car.id),
      equipped = current.id === car.id;
    const card = document.createElement("article");
    card.className = `car-card${equipped ? " equipped" : ""}`;
    const preview = document.createElement(owned ? "canvas" : "div");
    if (!owned) { preview.className = "car-mystery"; preview.textContent = "？"; preview.setAttribute("aria-label", "まだ秘密のくるま"); }
    preview.width = 280;
    preview.height = 150;
    if (owned) preview.setAttribute("aria-label", car.name + " のくるま見本");
    if (owned) drawCar(preview.getContext("2d"), 140, 125, {
      carId: car.id,
      appearance: getCarAppearance(state, car.id),
      scale: 1.1,
    });
    const heading = document.createElement("h3");
    heading.textContent = owned ? car.name : "まだ秘密のくるま";
    const copy = document.createElement("p");
    copy.textContent = owned ? car.description : "完走して解禁したら、姿も性能も見せるで。";
    const stats = document.createElement("div");
    stats.className = "car-stats";
    stats.hidden = !owned;
    stats.textContent = owned ? `電池 ${car.stats.energyCapacity} · 耐久 ${car.stats.integrityCapacity} · 浮力 ${car.stats.thrustAcceleration} · 消費 ${car.stats.thrustDrain}/秒 · 充電 ${car.stats.chargeRate}/秒 · 連射 ${car.stats.shotInterval}秒` : "";
    const button = document.createElement("button");
    button.textContent = equipped
      ? "これ乗ってるで"
      : owned
        ? "これに乗り換えよ"
        : `${car.unlockPrice} ギャルポイントで解禁`;
    button.disabled =
      equipped ||
      !atStart ||
      (!owned && meta.completionPoints < car.unlockPrice);
    button.addEventListener("click", () => {
      if (!owned && !unlockCar(meta, car.id, state)) return;
      if (equipStartingCar(state, meta, car.id)) {
        saveMeta();
        saveTour();
        renderShop();
        hud();
        toast(`${car.name}、準備できたで`);
        if (screen === "cars") $("#cars-ready").focus();
      }
    });
    card.append(preview, heading, copy, stats, button);
    grid.append(card);
  }
}


const cosmeticCatalogs = {paint: PAINT_OPTIONS, wheels: WHEEL_OPTIONS, decal: DECAL_OPTIONS};
function customizationPatch() {
  return Object.fromEntries(Object.keys(cosmeticCatalogs).map(key => [key, $("#custom-" + key).value]));
}
function renderStartingCustomization() {
  const appearance = getCarAppearance(state);
  for (const [key, catalog] of Object.entries(cosmeticCatalogs)) {
    const select = $("#custom-" + key); select.replaceChildren();
    for (const item of catalog) {
      const option = document.createElement("option"); option.value = item.id;
      const price = startingCustomizationPrice(state, meta, {[key]: item.id});
      option.textContent = `${item.name} · ${price === 0 ? "解禁済み" : `${price} GP`}`;
      select.append(option);
    }
    select.value = appearance[key].id;
  }
  updateCustomizationPreview();
}
function updateCustomizationPreview() {
  const patch = customizationPatch(), price = startingCustomizationPrice(state, meta, patch);
  const appearance = Object.fromEntries(Object.entries(cosmeticCatalogs).map(([key,catalog]) => [key,catalog.find(item=>item.id===patch[key])]));
  const preview = $("#customization-preview"), g = preview.getContext("2d");
  g.clearRect(0,0,preview.width,preview.height);
  drawCar(g,210,160,{carId:getCarProfile(state).id,appearance,scale:1.7});
  const unchanged = Object.keys(patch).every(key => getCarAppearance(state)[key].id === patch[key]);
  $("#customization-status").textContent = unchanged ? "いまの盛りやで。ロゴはそのまま、うちら仕様！" : price === 0 ? "解禁済みやから、着替えは無料やで。" : `まとめて ${price} ギャルポイント。残り ${meta.completionPoints} GPやで。`;
  $("#customization-apply").disabled = unchanged || price === null || price > meta.completionPoints || !atNewRunGarage();
  $("#customization-apply").textContent = price ? `${price} GPで解禁して着替えよ` : "この盛りで決めよ";
}
for (const key of Object.keys(cosmeticCatalogs)) $("#custom-"+key).addEventListener("change",updateCustomizationPreview);
$("#customization-apply").addEventListener("click", () => {
  if (screen !== "cars" || !customizeStartingCar(state,meta,customizationPatch())) return;
  saveMeta(); saveTour(); renderGarage(); beep(900); toast("うちら仕様、ばっちりやん！");
  $("#custom-paint").focus();
});

let currentQuestion = null,
  quizAnswered = false;
function showQuiz() {
  releaseInput();
  paused = false;
  setScreen("quiz");
  currentQuestion = questionForStage(state.routeIndex, state.routeOption);
  quizAnswered = false;
  $("#quiz").hidden = false;
  $("#quiz-question").textContent = currentQuestion.question;
  $("#quiz-feedback").textContent = "";
  $("#quiz-source").hidden = true;
  $("#quiz-continue").hidden = true;
  $("#quiz-choices").replaceChildren();
  currentQuestion.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.textContent = `${index + 1}. ${choice}`;
    button.addEventListener("click", () => chooseAnswer(index));
    $("#quiz-choices").append(button);
  });
  $("#quiz-choices button").focus();
  $(".cabinet").scrollIntoView({ block: "start", behavior: "instant" });
}
function chooseAnswer(index) {
  if (screen !== "quiz" || quizAnswered) return;
  quizAnswered = true;
  const correct = index === currentQuestion.answer;
  answerQuiz(state, correct);
  releaseInput();
  $("#quiz-feedback").textContent =
    (correct ? "正解！新しいファンが増えたで♡ " : "今回は惜しい！ ") +
    currentQuestion.explanation;
  $("#quiz-source").href = currentQuestion.source;
  $("#quiz-source").hidden = false;
  $("#quiz-continue").hidden = false;
  $("#quiz-choices")
    .querySelectorAll("button")
    .forEach((button, i) => {
      button.disabled = true;
      button.classList.toggle("correct", i === currentQuestion.answer);
    });
  beep(correct ? 1000 : 250, 0.15);
  hud();
  $("#quiz-continue").focus();
}
$("#quiz-continue").addEventListener("click", () => {
  if (!quizAnswered) return;
  enterPlay();
  say("ほな、クラブで会おな！");
});
function showResult() {
  const earned = awardCompletion(meta, state);
  if (earned) {
    saveMeta();
    toast(`ギャルポイント、${earned}もらえたで！ 次の旅でくるま解禁しよ。`);
  }
  saveTour();
  if (state.status === "won") {
    releaseInput();
    if (state.campaignComplete) {
      setScreen("finale");
      say("DJありねぇとDJちゃな、みんなでぶちアゲやー！");
      unlockSound();
      $("#pause").disabled = false;
      $("#pause").textContent = "タイトル戻ろか";
    } else {
      openMap(true);
      toast(state.route.win);
    }
    return;
  }
  releaseInput();
  setScreen("result");
  $("#result").hidden = false;
  const won = state.status === "won";
  $("#result-eyebrow").textContent = won
    ? "出番、間に合ったで"
    : "もっかい行こか？";
  $("#result-title").textContent = won
    ? state.campaignComplete
      ? "うちらのラストセット"
      : "クラブ着いたで"
    : "まだまだ、いけるで。";
  $("#result-copy").textContent = won
    ? state.route.win || "街で増えた仲間も、一緒にフロアへ！"
    : "車が限界や。ハートで前を開けて、段差はロケットで！";
  $("#result-stats").textContent =
    `${state.money} コイン · ${state.totalFans} 人のファン · ${Math.round(state.score)} 点`;
  $("#continue").textContent = won
    ? state.campaignComplete
      ? "ほな、音出そ →"
      : "道とくるま、見てこ →"
    : "もっかいこの道行こ →";
  $("#continue").focus();
  beep(won ? 880 : 190, 0.25);
}
$("#story").addEventListener("click", () => {
  if (!ready) return;
  if (
    savedTour &&
    !savedTour.campaignComplete &&
    !confirm(
      "新しい旅を始めたら、いまの旅のセーブは上書きやで。解禁したくるまとギャルポイントは残るで。始める？",
    )
  )
    return;
  state = newTour(meta);
  roadChoice = "scenic";
  setScreen("cars");
  renderGarage();
  $("#cars-ready").focus();
});
$("#cars-ready").addEventListener("click", () => { saveTour(); openMap(); });
$("#change-starting-car").addEventListener("click", () => {
  if (!atNewRunGarage()) return;
  setScreen("cars"); renderGarage(); $("#cars-ready").focus();
});
$("#depart").addEventListener("click", depart);
$("#home").addEventListener("click", home);
$("#quit").addEventListener("click", home);
$("#resume").addEventListener("click", () => setPause(false));
$("#pause").addEventListener("click", () => setPause(!paused));
$("#continue").addEventListener("click", () => {
  if (state.status === "won") {
    if (state.campaignComplete) {
      setScreen("finale");
      say("DJありねぇとDJちゃな、全員ぶちアゲやー！");
      unlockSound();
      $("#pause").disabled = false;
      $("#pause").textContent = "タイトル戻ろか";
    } else openMap(true);
  } else {
    state = retryRoute(state);
    enterPlay();
  }
});
// Finale has no failure timer; the title control is an explicit way back.
$("#pause").addEventListener("click", () => {
  if (screen === "finale") home();
});
function renderDestinationChoices() {
  const choices = getJourneyChoices(pendingNext ? state.routeIndex+1 : state.routeIndex,state.seed);
  const host = $("#destination-choices"); host.replaceChildren();
  for (const [index,node] of choices.entries()) {
    const button = document.createElement("button");
    button.id = ["scenic","event-road","express"][index];
    button.className = "road-option destination-option";
    button.dataset.nodeId = node.nodeId;
    button.classList.toggle("selected",node.nodeId===selectedNodeId);
    button.setAttribute("aria-pressed",String(node.nodeId===selectedNodeId));
    const image = document.createElement("img");
    const district = getDistrictScene(node.cityId,node.locationIndex);
    image.src = new URL(`./assets/districts/${node.cityId}/${district.files[mapClimate.season]}`,import.meta.url).href; image.alt = ""; image.loading="lazy";
    const title = document.createElement("strong"); title.textContent=node.districtName;
    const detail = document.createElement("small"); detail.textContent=`${node.label} · ${node.description}`;
    button.append(image,title,detail);
    button.addEventListener("click",()=>selectDestination(node.nodeId)); host.append(button);
  }
}
function selectDestination(nodeId) {
  if(screen!=="map" || departing) return;
  const choices=getJourneyChoices(pendingNext ? state.routeIndex+1:state.routeIndex,state.seed);
  const node=choices.find(item=>item.nodeId===nodeId); if(!node)return;
  selectedNodeId=nodeId; roadChoice=node.routeOption;
  if (pendingNext) selectNextJourneyDestination(state,nodeId);
  else state = chooseStageDestination(state,nodeId) || state;
  saveTour();
  renderDestinationChoices(); warmMapArt(); say(node.story);
  $("#destination-choices [aria-pressed=true]")?.focus({preventScroll:true});
}
canvas.addEventListener("pointerup",event=>{
  if(screen!=="map" || musicPanelOpen)return;
  const bounds=canvas.getBoundingClientRect();
  const hit=hitTestMapChoice((event.clientX-bounds.left)*960/bounds.width,(event.clientY-bounds.top)*540/bounds.height);
  const node=getJourneyChoices(pendingNext?state.routeIndex+1:state.routeIndex,state.seed)[hit];
  if(hit!==null&&node)selectDestination(node.nodeId);
});
function hud() {
  const rushButton = $('[data-control="rush"]');
  rushButton.querySelector("small").textContent = state.rushing ? "無敵やで！ 電池めっちゃ使ってる！" : state.rushCooldown > 0 ? `あと ${Math.ceil(state.rushCooldown)} 秒待ってな` : "X / SHIFT · 電池めっちゃ使うで";
  const route = state.route;
  $("#location-label").textContent =
    `${(getDistrictScene(route.cityId, state.locationIndex || 0) || { name: route.goal }).name} / ${String((state.locationIndex || 0) + 1).padStart(2, "0")}`;
  $("#mode-label").textContent = `クラブ旅 ${state.routeIndex + 1} / ${JOURNEY_STAGE_COUNT}`;
  $("#money").textContent = String(state.money).padStart(3, "0");
  $("#combo-bar").style.width =
    `${Math.min(100, ((state.comboTimer || 0) / 4) * 100)}%`;
  $("#destination").textContent = `次のフロア / ${route.club}`;
  const length = state.routeLength || route.distance;
  $("#remaining").textContent =
    `${Math.ceil(Math.max(0, length - state.distance)).toLocaleString()} m`;
  $("#progress").style.width =
    `${Math.min(100, (state.distance / length) * 100)}%`;
  $("#fans").textContent = `ファン ${state.totalFans} 人`;
  $("#combo").textContent = state.charging
    ? "充電中やで"
    : state.atStation
      ? "E長押しで充電や"
      : state.combo > 1
        ? `${state.combo} 連続やで`
        : "♡ 街ごとギャルにしよ";
  $("#health-value").textContent = `${Math.ceil(state.integrity)}`;
  $("#health-bar").style.width =
    `${(state.integrity / (state.integrityCapacity || 100)) * 100}%`;
  $("#energy-value").textContent = `${Math.ceil(state.energy)}`;
  $("#energy-bar").style.width =
    `${(state.energy / (state.energyCapacity || 100)) * 100}%`;
}
function handleEvents() {
  const crewEvent = selectCrewEvent(state.events || [], {...state, time: visualTime});
  for (const event of state.events || []) {
    if (["convert"].includes(event.type)) {
      beep(850, 0.07);
      toast(`ギャル仲間 +${event.reward || event.money || 20} ♡`);
      say("仲間が増えた！フロアで会おな！");
    }
    if (["collision", "hit"].includes(event.type)) {
      beep(110, 0.16);
      toast("いたっ！ロケットでかわして！");
      say("運転は任せて！ちゃな、ハート頼むで！", "DJありねぇ / 運転");
    }
    if (["charge-start", "station-enter"].includes(event.type)) {
      toast("充電所や！ Eを長押ししてな");
      say("充電スポット！Eでバッテリー回復や！");
    }
    if (event.type === "rush-start") {
      beep(520, .18); toast("テキーラ加速！ いま無敵やで！");
      say("乾杯！ 一気に行くで、電池は気ぃつけや！");
    }
    if (event.type === "empty-energy") {
      say("電池ない！次のEVで充電せな！");
    }
  }
  if (crewEvent) { lastDialogueId = crewEvent.id; say(crewEvent.text,crewEvent.speaker,crewEvent.holdSeconds); }
}
function refreshCrewDialogue() {
  if (visualTime < dialogueUntil) return;
  const line = selectCrewDialogue({...state, time:visualTime, previousId:lastDialogueId});
  if (!line) return;
  lastDialogueId = line.id; say(line.text,line.speaker,line.holdSeconds);
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  if (!paused && !musicPanelOpen) visualTime += dt;
  if (screen === "playing" && !paused && !musicPanelOpen) {
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      update(state, input, 1 / 60);
      handleEvents();
      accumulator -= 1 / 60;
      if (state.status !== "playing") {
        if (state.status === "quiz") showQuiz();
        else showResult();
        accumulator = 0;
        break;
      }
    }
    hud();
    refreshCrewDialogue();
  }
  if (toastTime > 0) {
    toastTime -= dt;
    if (toastTime <= 0) $("#toast").classList.remove("on");
  }
  if (screen === "map") {
    const routeIndex = pendingNext ? state.routeIndex + 1 : state.routeIndex;
    drawMap(ctx, {
      routeIndex,
      stageIndex: routeIndex,
      seed: state.seed,
      season: mapClimate.season,
      choices: getJourneyChoices(routeIndex,state.seed),
      route: ROUTES[routeIndex],
      choice: selectedNodeId,
      carId: getCarProfile(state).id,
      time: reducedMotion ? 0 : visualTime,
      width: 960,
      height: 540,
    });
  } else if (screen === "finale")
    drawFinale(ctx, {
      time: reducedMotion ? 0 : visualTime,
      score: state.score,
      totalFans: state.totalFans,
      width: 960,
      height: 540,
    });
  else
    render(ctx, state, {
      time: visualTime,
      menu: screen === "menu",
      reducedMotion,
    });
  const portraits = $("#crew-actions").getContext("2d");
  portraits.clearRect(0, 0, 240, 128);
  for (const [i, character] of ["arisu", "chana"].entries())
    drawCharacter(portraits, {
      character,
      x: i * 112,
      y: 0,
      width: 128,
      height: 128,
      time: reducedMotion ? 0 : visualTime,
      weather: state.weather,
      season: state.season,
      boosting: state.boosting,
      rushing: state.rushing,
      rushTime: state.rushTime,
      rushGestureTime: state.rushGestureTime,
      shooting: state.shooting,
      charging: state.charging,
      invulnerability: state.invulnerability,
      action: screen === "finale" ? "cheer" : undefined,
    });
  requestAnimationFrame(frame);
}
async function loadGameArt() {
  $("#story").disabled = true;
  $("#resume-tour").disabled = true;
  $("#retry-art").hidden = true;
  $("#loading").textContent = "街の灯り、つけてるで…";
  try {
    await prepareGameArt(state);
    ready = true;
    $("#loading").textContent = "準備できたで。いつでも行こ！";
    $("#story").disabled = false;
    $("#resume-tour").disabled = false;
    hud();
    requestAnimationFrame(frame);
  } catch (error) {
    $("#loading").textContent = "絵が読み込めへんかった。下のボタンでもう一回いこ。";
    $("#retry-art").hidden = false;
    console.error(error);
  }
}
$("#retry-art").addEventListener("click", loadGameArt);
loadGameArt();
document.querySelectorAll("[data-control]").forEach((b) => (b.disabled = true));
Object.defineProperty(window, "__HYPERDRIVE__", {
  value: {
    snapshot: () => structuredClone({ state, input, screen, paused, ready }),
  },
  writable: false,
});
