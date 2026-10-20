import { RUN_MOD_CATALOG, getBuildOffers, buyRunMod, describeBuild, getRouteMission } from './src/run-build.js';
import { getEncounterPhase } from './src/encounter-director.js';
import { createPerformance, updatePerformance, performanceView } from './src/performance.js';
import { createRoadFeedback, captureRoadFeedback, updateRoadFeedback, drawRoadFeedback, getRoadCue } from './src/road-feedback.js';
import { JOURNEY_STAGE_COUNT, getJourneyChoices, getJourneyNode, getJourneyStage } from "./src/journey.js";
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
let performanceSet = createPerformance(), roadFeedback = createRoadFeedback(), autoHearts = false;
let lastHud = 0, lastCue = "";
const frameSamples = [];
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
  isPlaying: () => ["playing", "finale"].includes(screen) && !musicPanelOpen,
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
  const nodes = [...$("#music-panel").querySelectorAll("summary,button:not([hidden]),iframe,a[href],input:not([disabled]),select,[role=slider]")];
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
  if (!["playing", "finale"].includes(screen)) return;
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
  $("#performance-panel").hidden = value !== "finale";
  releaseInput();
  sceneUI.show(value);
  if (value === "finale") { document.querySelectorAll("[data-control]").forEach(button => button.disabled = false); canvas.focus({ preventScroll: true }); }
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
  $("#map-heading").textContent = "次の街角、どの道で行こ？";
  $("#map-subtitle").textContent = `${route.goal}のフロアへ。地図の行き先を選んで出発しよ。`;
  const stageIndex = next ? state.routeIndex + 1 : state.routeIndex;
  const stage = getJourneyStage(stageIndex);
  const previousId = next ? state.journeyNodeId : state.journey?.completedNodeIds?.[stageIndex - 1];
  const previous = getJourneyNode(previousId);
  $("#map-current-location").textContent = previous ? previous.districtName : stageIndex ? "前のクラブ" : "出発ガレージ";
  $("#map-progress").textContent = `道のり ${stageIndex + 1} / ${JOURNEY_STAGE_COUNT} · ${stage.cityName}`;
  $("#map-next-club").textContent = `${stage.cityName} / ${stage.club}`;
  $("#map-club-distance").textContent = stage.clubStop ? "この道を走るとクラブ到着" : "この街角 → もう1本の道 → クラブ到着";
  const choices = getJourneyChoices(stageIndex,state.seed);
  selectedNodeId = choices.find(node=>node.nodeId===(next?state.pendingJourneyNodeId:state.journeyNodeId))?.nodeId || choices[0].nodeId;
  roadChoice = getJourneyNode(selectedNodeId).routeOption;
  renderDestinationChoices();
  warmMapArt();
  renderShop();
  const ribbon = $("#tour-ribbon"); ribbon.replaceChildren();
  ["中野", "新宿", "渋谷", "浅草", "大阪", "京都"].forEach((name,index) => {
    const stamp = document.createElement("span"); stamp.textContent = `${index < Math.floor(stageIndex/2) ? "✓ " : ""}${name}`;
    stamp.className = index < Math.floor(stageIndex/2) ? "passed" : index === Math.floor(stageIndex/2) ? "current" : "";
    if (index === Math.floor(stageIndex/2)) stamp.setAttribute("aria-current", "step"); ribbon.append(stamp);
  });
  const arrived = $("#arrival-summary"); arrived.hidden = !next;
  if (next) {
    const mission = getRouteMission(state);
    arrived.textContent = `${state.route.goal}、到着や！ ${state.stageGyaru}人をギャル仲間に。${mission?.complete ? `道の目標も達成、+${mission.reward}コイン！` : "次の道でもうひと盛りしよ。"} ガレージでこの旅のパーツを選べるで。`;
  }
  hud();
  $("#route-tab").focus();
}
$("#auto-hearts").addEventListener("change", event => { autoHearts = event.target.checked; });
function enterPlay() {
  paused = false;
  releaseInput();
  setScreen("playing");
  canvas.tabIndex = 0;
  canvas.focus({ preventScroll: true });
  $("#pause").textContent = "ひと休み";
  say(state.route.intro || "ハートで仲間増やして、EVで充電やで！");
  if (state.distance === 0) { roadFeedback = createRoadFeedback(); toast(state.routeIndex === 0 ? "運転は自動。まずはハートを長押しや♡" : "選んだ街角へ。今回の盛りで行くで！"); }
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
  renderBuildWorkshop();
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
function renderBuildWorkshop() {
  const build = describeBuild(state), offers = getBuildOffers(state), host = $("#build-offers");
  $("#build-summary").textContent = `${build.name} · ${build.mods.length} / 4 パーツ。${build.summary}`;
  host.replaceChildren();
  for (const offer of offers) {
    const card = document.createElement("article"); card.className = "build-card"; card.dataset.family = offer.family;
    const tag = document.createElement("span"); tag.className = "eyebrow"; tag.textContent = `${offer.familyName} / ${offer.rarityLabel}`;
    const title = document.createElement("h4"); title.textContent = offer.name;
    const copy = document.createElement("p"); copy.textContent = offer.description;
    const preview = document.createElement("small"); preview.textContent = offer.preview;
    card.append(tag,title,copy,preview);
    let replacement;
    if (offer.requiresReplacement) {
      const label = document.createElement("label"); label.textContent = "外すパーツを選んでな";
      replacement = document.createElement("select"); replacement.setAttribute("aria-label", `${offer.name}と入れ替えるパーツ`);
      const none = document.createElement("option"); none.value = ""; none.textContent = "4枠いっぱい。入れ替えを選ぶ"; replacement.append(none);
      for (const item of build.mods) { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; replacement.append(option); }
      label.append(replacement); card.append(label);
    }
    const button = document.createElement("button"); button.dataset.modId = offer.id;
    button.textContent = offer.available ? `${offer.price} コインで${offer.requiresReplacement ? "入れ替えよ" : "付けよ"}` : offer.reason;
    button.disabled = !offer.available || Boolean(replacement && !replacement.value);
    replacement?.addEventListener("change",()=>{ button.disabled = !offer.available || !replacement.value; });
    button.addEventListener("click",()=>{
      if (!buyRunMod(state,offer.id,replacement?.value || null)) return;
      saveTour(); beep(760,.12); renderShop(); hud(); toast(`${offer.name}、この旅の相棒や！`);
    });
    card.append(button); host.append(card);
  }
  $("#build-note").textContent = state.status !== "won" ? "到着してから選べるで。まずは最初の街角へ！" : offers.length ? "各到着地点で1つ。最大4パーツ。外すと効果は消えて、この旅では買い直し・返金なし。くるまは今のままや。" : "今あるパーツで、この旅だけの走りを楽しも。基本パーツと修理も使えるで。";
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
      performanceSet = createPerformance();
      setScreen("finale");
      say("DJありねぇとDJちゃな、みんなでぶちアゲやー！");
      unlockSound();
      $("#pause").disabled = false;
      $("#pause").textContent = "ひと休み";
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
      performanceSet = createPerformance();
      setScreen("finale");
      say("DJありねぇとDJちゃな、全員ぶちアゲやー！");
      unlockSound();
      $("#pause").disabled = false;
      $("#pause").textContent = "ひと休み";
    } else openMap(true);
  } else {
    state = retryRoute(state);
    enterPlay();
  }
});
// The encore is optional; leaving never changes already-earned completion credit.
$("#finale-home").addEventListener("click", home);
function previewMission(node) {
  if (!node) return null;
  const preview = node.nodeId === state.journeyNodeId ? state : createState({ routeIndex: node.stageIndex, seed: state.seed, journeyNodeId: node.nodeId, ...mapClimate });
  return getRouteMission(preview,node);
}
function renderDestinationChoices() {
  const choices = getJourneyChoices(pendingNext ? state.routeIndex+1 : state.routeIndex,state.seed);
  const chosen = choices.find(node => node.nodeId === selectedNodeId);
  const mission = previewMission(chosen);
  $("#route-mission-preview").textContent = mission ? `寄り道の目標「${mission.label}」 ${mission.description} ${mission.rewardLabel}` : "";
  $("#map-selected-route").textContent = chosen ? `選んだ道：${chosen.districtName}` : "地図の行き先を選んでな";
  const host = $("#destination-choices"); host.replaceChildren();
  for (const [index,node] of choices.entries()) {
    const button = document.createElement("button");
    button.id = ["scenic","event-road","express"][index];
    button.className = "road-option destination-option";
    button.dataset.nodeId = node.nodeId;
    button.dataset.kind = node.kind;
    button.classList.toggle("selected",node.nodeId===selectedNodeId);
    button.setAttribute("aria-pressed",String(node.nodeId===selectedNodeId));
    const image = document.createElement("img");
    const district = getDistrictScene(node.cityId,node.locationIndex);
    image.src = new URL(`./assets/districts/${node.cityId}/${district.files[mapClimate.season]}`,import.meta.url).href; image.alt = ""; image.loading="lazy";
    const title = document.createElement("strong"); title.textContent=node.districtName;
    const detail = document.createElement("small"); detail.textContent=`${node.label} · ${node.description}`;
    const kind = document.createElement("span"); kind.className="destination-kind"; kind.textContent=`${index + 1} · ${node.label}`;
    const status = document.createElement("span"); status.className="destination-status"; status.textContent=node.nodeId===selectedNodeId ? "✓ この道を選択中" : "この街角へ →";
    const fit = document.createElement("span"); fit.className = "route-fit";
    fit.textContent = node.kind === "service" ? `到着で耐久+20 / 現在${Math.ceil(state.integrity)}` : node.kind === "event" ? "コイン+25% / 動く相手が多め" : "EV多め / ゆっくり長めの道";
    button.append(kind,image,title,detail,fit,status);
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
  const cue = getRoadCue(state);
  const cueKey = `${cue.label}:${cue.action}`;
  if (cueKey !== lastCue) {
    $("#road-cue").textContent = cue.label; $("#road-status").dataset.urgency = cue.urgency;
    document.querySelectorAll("[data-control]").forEach(button => button.classList.toggle("suggested", button.dataset.control === cue.action)); lastCue = cueKey;
  }
  const ev = state._stations.find(distance => distance > state.distance + 5);
  $("#next-ev").textContent = state.atStation ? "⚡ EVエリア" : ev ? `⚡ あと${Math.ceil(ev - state.distance)}m` : "⚑ まもなく到着";
  $("#road-phase").textContent = getEncounterPhase(state).label;
  for (const [kind,value,capacity] of [["health",state.integrity,state.integrityCapacity],["energy",state.energy,state.energyCapacity]]) {
    const meter = $("#" + kind + "-meter"); meter.setAttribute("aria-valuenow", String(Math.ceil(value))); meter.setAttribute("aria-valuemax", String(capacity)); meter.dataset.low = String(value / capacity < .25);
  }
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
  captureRoadFeedback(roadFeedback, state.events, state.distance);
  const crewEvent = selectCrewEvent(state.events || [], {...state, time: visualTime});
  for (const event of state.events || []) {
    if (["convert"].includes(event.type)) {
      beep(850, 0.07);
      if (event.elite || (state.combo > 1 && state.combo % 5 === 0)) toast(`${state.combo}連続！ 街がつながってきたで♡`);
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
  const frameStart = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  if (!paused && !musicPanelOpen) visualTime += dt;
  if (screen === "playing" && !paused && !musicPanelOpen) {
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      update(state, { ...input, shoot: input.shoot || autoHearts }, 1 / 60);
      handleEvents();
      accumulator -= 1 / 60;
      if (state.status !== "playing") {
        if (state.status === "quiz") showQuiz();
        else showResult();
        accumulator = 0;
        break;
      }
    }
    if (visualTime - lastHud > .09) { hud(); lastHud = visualTime; }
    refreshCrewDialogue();
  }
  if (screen === "finale" && !paused && !musicPanelOpen) {
    updatePerformance(performanceSet, input, dt);
    const view = performanceView(performanceSet);
    $("#performance-title").textContent = view.title;
    $("#performance-phase").textContent = view.phase;
    $("#performance-progress").style.width = `${view.progress * 100}%`;
    const completed = `${view.hits} / 8 フレーズ · ファン ${state.totalFans}人 · ギャル仲間 ${state.gyaruConverted}人`;
    if ($("#performance-score").textContent !== completed) $("#performance-score").textContent = completed;
    document.querySelectorAll("[data-control]").forEach(button => button.classList.toggle("suggested", button.dataset.control === view.action));
  }
  if (!paused && !musicPanelOpen) updateRoadFeedback(roadFeedback, dt);
  if (toastTime > 0) {
    toastTime -= dt;
    if (toastTime <= 0) $("#toast").classList.remove("on");
  }
  if (screen === "map") {
    // The directly selectable DOM map owns this screen; do not redraw a hidden canvas.
  } else if (screen === "finale")
    drawFinale(ctx, {
      time: reducedMotion ? 0 : visualTime,
      score: state.score,
      totalFans: state.totalFans,
      converted: state.gyaruConverted,
      performance: performanceView(performanceSet),
      width: 960,
      height: 540,
    });
  else
    render(ctx, state, {
      time: visualTime,
      menu: screen === "menu",
      reducedMotion,
    });
  if (["playing", "quiz"].includes(screen)) drawRoadFeedback(ctx, roadFeedback, state);
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
  frameSamples.push(performance.now() - frameStart);
  if (frameSamples.length > 600) frameSamples.shift();
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
    snapshot: () => structuredClone({ state, input, screen, paused, ready, performanceSet, autoHearts }),
    metrics: () => { const samples = [...frameSamples].sort((a,b)=>a-b); return { frames: samples.length, p50: samples[Math.floor(samples.length*.5)] || 0, p95: samples[Math.floor(samples.length*.95)] || 0, max: samples.at(-1) || 0 }; },
  },
  writable: false,
});
