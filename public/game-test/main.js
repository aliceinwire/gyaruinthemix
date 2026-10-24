import { setSurvivalAssistance, isSurvival, dailySurvival, survivalView, chooseSurvivalUpgrade, survivalMultiplier, createSurvivalRecords, SURVIVAL_STARTERS, SURVIVAL_UPGRADES } from './src/survival.js';
import { createDrivingLessons, updateDrivingLessons, getDrivingCue } from './src/driving-lessons.js';
import { createItemIcon } from './src/item-icons.js';
import { drawSurvival, renderSurvivalResult } from './src/survival-ui.js';
import { localizeText, localizeAttribute, localizeHTML, initializeLanguage, installLanguageSelectors } from './src/localized-ui.js';
import { message, number, t } from './src/i18n.js';
import { installFrame } from './src/frame.js';
import { RUN_STYLES, chooseRunStyle, getRpgView, choosePerk } from './src/tour-rpg.js';
import { createSettingsStore } from './src/tour-settings.js';
import { createStoryDirector } from './src/tour-director.js';
import { RUN_MOD_CATALOG, getBuildOffers, buyRunMod, describeBuild, getRouteMission } from './src/run-build.js';
import { getEncounterPhase } from './src/encounter-director.js';
import { createPerformance, updatePerformance, performanceView, suspendPerformance } from './src/performance.js';
import { chartForTrack } from './src/track-charts.js';
import { createRoadFeedback, captureRoadFeedback, updateRoadFeedback, drawRoadFeedback } from './src/road-feedback.js';
import { JOURNEY_STAGE_COUNT, getJourneyChoices, getJourneyNode, getJourneyStage } from "./src/journey.js";
import { selectCrewDialogue, selectCrewEvent } from "./src/crew-dialogue.js";
import { createSaveStore } from "./src/save-store.js";
import { prepareRouteArt, prepareGameArt } from "./src/resources.js";
import { bindGameInput } from "./src/input.js";
import { createSceneUI } from "./src/scene-ui.js";
import { createGameAudio } from "./src/audio.js";
import { SILENT_MUSIC } from './src/music-reactivity.js';
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
import { drawCharacter, resolveCrewVisuals } from "./src/character-actions.js";
import {
  createState,
  cancelRush,
  update,
  nextRoute,
  ROUTES,
  buyUpgrade,
  upgradePrice,
  availableCarUpgrades,
  retryRoute,
  answerQuiz,
  beginClubQuiz,
  exportCampaignSave,
  restoreCampaignSave,
  changeRouteBeforeStart,
  campaignEnvironment,
  beginCampaign,
  chooseStageDestination,
  chooseStartingWeapon,
  exportNightfallSave,
  restoreNightfallSave,
  selectNextJourneyDestination,
} from "./src/simulation.js";
import { questionForStage } from "./src/questions.js";
import { render, drawCar } from "./src/renderer.js";
import { drawMap, drawFinale, preloadJourneyMap, hitTestMapChoice } from "./src/campaign.js";
import { getClubArt } from './src/club-art.js';
await initializeLanguage();

const $ = (s) => document.querySelector(s),
  canvas = $("#game"),
  ctx = canvas.getContext("2d", { alpha: false });
function newTour(progress, challenge = dailySurvival()) {
  const seed = challenge.seed;
  const fresh = createState({
    mode: 'survival', survivalDay: challenge.day, startingWeapon: 'heart',
    routeIndex: 0,
    routeOption: "scenic",
    seed,
    runId:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tour-${Date.now().toString(36)}-${seed.toString(36)}-${Math.random().toString(36).slice(2)}`,
    ...campaignEnvironment(seed, 0),
  });
  fresh.survival.recordEligible = challenge.recordEligible !== false;
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
let performanceSet = createPerformance(), roadFeedback = createRoadFeedback(), drivingLessons = createDrivingLessons();
let performanceNext = null, terminalRecord = null;
let lastHud = 0, lastCue = "";
const frameSamples = [];
let storage;
try {
  storage = globalThis.localStorage;
} catch {}
const saves = createSaveStore(storage);
const survivalRecords = createSurvivalRecords(storage);
const rpgView = value => survivalView(value) || getRpgView(value);
let survivalBest = 0;
let meta = saves.loadMeta(),
  savedTour = saves.loadNightfall() || saves.loadCampaign(),
  storageWarningShown = false;
function storageWarning() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  $("#car-save-warning").hidden = false;
  localizeText($("#car-save-warning"), "セーブできへんかった。解禁や買い物の記録は、この画面を閉じると残らへんかもしれんで。");
  toast("このブラウザではセーブできへんみたい。閉じる前に気ぃつけてな。");
}
function saveMeta() {
  if (!saves.saveMeta(meta)) storageWarning();
}
function syncResume() {
  $("#resume-tour").hidden = !savedTour;
}
function saveTour() {
  if (isSurvival(state) && !exportNightfallSave(state)) return;
  const result = isSurvival(state) ? saves.saveNightfall(state) : saves.saveCampaign(state);
  savedTour = result.campaign;
  syncResume();
  if (!result.persisted) storageWarning();
}
syncResume();
let resumingTour = false, retryResume = false;
async function resumeTour() {
  if (!ready || !savedTour || resumingTour) return;
  const restored = isSurvival(savedTour) ? restoreNightfallSave(exportNightfallSave(savedTour)) : restoreCampaignSave(exportCampaignSave(savedTour));
  if (!restored) return;
  resumingTour = true;
  retryResume = false;
  $("#story").disabled = $("#resume-tour").disabled = true;
  $("#retry-art").hidden = true;
  localizeText($("#loading"), "街の灯り、つけてるで…");
  try {
    // A fresh page has only the opening city's art. Load the saved destination
    // before entering its map or set, and leave the save intact if loading fails.
    await prepareGameArt(restored);
    state = restored;
    drivingLessons = createDrivingLessons();
    localizeText($("#loading"), "準備できたで。いつでも行こ！");
    storyDirector.beginRun();
    applySettings();
    roadChoice = state.routeOption;
    if (!state.campaignStarted && state.routeIndex === 0 && state.distance === 0) {
      setScreen("cars"); renderGarage(); $("#cars-ready").focus();
    } else if (state.status === "won") showResult();
    else openMap(false);
  } catch {
    retryResume = true;
    localizeText($("#loading"), "絵が読み込めへんかった。下のボタンでもう一回いこ。");
    $("#retry-art").hidden = false;
  } finally {
    resumingTour = false;
    $("#story").disabled = $("#resume-tour").disabled = false;
  }
}
$("#resume-tour").addEventListener("click", resumeTour);
const sceneUI = createSceneUI();
const controls = bindGameInput({
  isPlaying: () => ["playing", "finale"].includes(screen),
  isQuiz: () => screen === "quiz",
  isPaused: () => paused,
  onPause: setPause,
  onAnswer: chooseAnswer,
  onInteraction: () => unlockSound(),
});
const input = controls.input,
  releaseInput = () => { controls.release(); cancelRush(state); };
const settingsStore = createSettingsStore(storage, window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
let settings = settingsStore.load();
let reducedMotion = settings.reducedMotion;
function applySettings() {
  reducedMotion = settings.reducedMotion;
  setSurvivalAssistance(state, settings.assistMode);
  document.body.dataset.reducedMotion = String(reducedMotion);
  document.body.dataset.assistMode = String(settings.assistMode);
  $('#reduced-motion').checked = reducedMotion;
  $('#assist-mode').checked = state.assistMode;
  $('#menu-assist-mode').checked = settings.assistMode;
  localizeText($('#assist-record-note'), isSurvival(state) && state.survival.assisted ? 'このランはゆったり記録。途中で戻しても、通常の記録には入らへん。' : 'ダメージを軽減。ゆったりの記録は、通常の記録と別に残るで。');
  survivalBest = isSurvival(state) ? survivalRecords.best(state.survival.day, state.survival.assisted)?.score || 0 : 0;
  document.body.dataset.runMode = state.mode;
}
function saveSettings() {
  applySettings();
  refreshSurvivalRecord();
  if (screen !== "menu") saveTour();
  hud();
  if (!settingsStore.save(settings)) storageWarning();
}
applySettings();
for (const [id, key] of [['reduced-motion','reducedMotion'], ['assist-mode','assistMode'], ['menu-assist-mode','assistMode']]) {
  $('#' + id).addEventListener('change', event => { settings[key] = event.target.checked; saveSettings(); });
}
const storyDirector = createStoryDirector({
  storage, getState: () => state,
  onOpen: () => { paused = false; accumulator = 0; releaseInput(); setScreen('story'); },
  onSaveError: storageWarning,
});
$('#run-journal').addEventListener('click', () => {
  if (storyDirector.active || screen === 'draft') return;
  const previous = screen;
  storyDirector.journal(() => {
    setScreen(previous);
    if (['playing','finale'].includes(previous)) setPause(true);
    else $('#run-journal').focus({ preventScroll: true });
  });
});
const music = $("#music");
const audio = createGameAudio({
  music,

});
const beep = (...args) => audio.beep(...args),
  unlockSound = () => audio.unlock();

function toast(msg) {
  localizeText($("#toast"), msg);
  $("#toast").classList.add("on");
  toastTime = 2.1;
}
let dialogueUntil = 0, lastDialogueId = null;
function say(text, speaker = "DJちゃな / ナビ担当", holdSeconds = 5) {
  dialogueUntil = visualTime + holdSeconds;
  localizeText($("#dialogue"), text);
  localizeText($("#speaker"), speaker);
}
function setPause(value) {
  if (!["playing", "finale"].includes(screen)) return;
  paused = value;
  releaseInput();
  $("#pause-overlay").hidden = !paused;
  localizeText($("#pause"), paused ? "ほな、再開" : "ひと休み");
  accumulator = 0;
  if (paused) {
    suspendPerformance(performanceSet);
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
}
$("#route-tab").addEventListener("click", () => showMapPanel("route"));
$("#garage-tab").addEventListener("click", () => showMapPanel("garage"));
$("#garage-done").addEventListener("click", () => showMapPanel("route"));
function home() {
  paused = false;
  pendingNext = false;
  releaseInput();
  state = newTour(meta);
  performanceNext = null; terminalRecord = null;
  applySettings();
  refreshSurvivalRecord();
  setScreen("menu");
  say("ありねぇ、うちらの曲と平成ギャル、次の街にも届けよ！");
  hud();
  $(savedTour ? "#resume-tour" : "#story").focus();
}
function openMap(next = false) {
  pendingNext = next;
  $("#change-starting-car").hidden = !atNewRunGarage();
  $("#garage-tab").hidden = false;
  releaseInput();
  setScreen("map");
  sceneUI.mapPanel("route");
  const route = ROUTES[next ? state.routeIndex + 1 : state.routeIndex];
  mapClimate = next
    ? campaignEnvironment(state.seed, state.routeIndex + 1)
    : { season: state.season, weather: state.weather };
  localizeText($("#climate-summary"), message("{0}・{1}やで。{2}", [seasonNames[mapClimate.season], weatherNames[mapClimate.weather], weatherTips[mapClimate.weather]]));
  localizeText($("#map-heading"), "次の街角、どの道で行こ？");
  localizeText($("#map-subtitle"), message("{0}のフロアへ。地図の行き先を選んで出発しよ。", [route.goal]));
  const stageIndex = next ? state.routeIndex + 1 : state.routeIndex;
  const stage = getJourneyStage(stageIndex);
  const previousId = next ? state.journeyNodeId : state.journey?.completedNodeIds?.[stageIndex - 1];
  const previous = getJourneyNode(previousId);
  localizeText($("#map-current-location"), previous ? previous.districtName : stageIndex ? "前のクラブ" : "出発ガレージ");
  localizeText($("#map-progress"), message("道のり {0} / {1} · {2}", [stageIndex + 1, JOURNEY_STAGE_COUNT, stage.cityName]));
  localizeText($("#map-next-club"), message("{0} / {1}", [stage.cityName, stage.club]));
  const destinationClub = getClubArt(stage.club);
  $('#map-club-art').src = destinationClub.src;
  $('.map-goal').style.setProperty('--club-accent', destinationClub.accent);
  localizeText($("#map-club-distance"), stage.clubStop ? "この道を走るとクラブ到着" : "この街角 → もう1本の道 → クラブ到着");
  const choices = getJourneyChoices(stageIndex,state.seed);
  selectedNodeId = choices.find(node=>node.nodeId===(next?state.pendingJourneyNodeId:state.journeyNodeId))?.nodeId || choices[0].nodeId;
  roadChoice = getJourneyNode(selectedNodeId).routeOption;
  renderDestinationChoices();
  warmMapArt();
  renderShop();
  const ribbon = $("#tour-ribbon"); ribbon.replaceChildren();
  ["中野", "新宿", "渋谷", "浅草", "大阪", "京都"].forEach((name,index) => {
    const stamp = document.createElement("span"); localizeText(stamp, message("{0}{1}", [index < Math.floor(stageIndex/2) ? "✓ " : "", name]));
    stamp.className = index < Math.floor(stageIndex/2) ? "passed" : index === Math.floor(stageIndex/2) ? "current" : "";
    if (index === Math.floor(stageIndex/2)) stamp.setAttribute("aria-current", "step"); ribbon.append(stamp);
  });
  const arrived = $("#arrival-summary"); arrived.hidden = !next;
  if (next) {
    const mission = getRouteMission(state);
    localizeText(arrived, message("{0}、到着や！ {1}人をフロアの仲間に。{2} ガレージでこの旅のパーツを選べるで。", [state.route.goal, state.stageGyaru, mission?.complete ? message("道の目標も達成、+{0}コイン！", [mission.reward]) : "次の道でもうひと盛りしよ。"]));
  }
  if (isSurvival(state)) {
    localizeText($("#map-subtitle"), "次のクラブへ、うちらの音を届けよ。道と進化を選んで、72ウェーブの夜を走り抜こ。");
    if (next) localizeText(arrived, message("道を突破！ スコア {0} · 耐久 {1} · 次の6ウェーブへ", [number(Math.floor(state.score), { useGrouping: true }), Math.ceil(state.integrity)]));
  }
  hud();
  $("#route-tab").focus();
}
function enterPlay(announce = true) {
  paused = false;
  applySettings();
  releaseInput();
  setScreen("playing");
  canvas.tabIndex = 0;
  canvas.focus({ preventScroll: true });
  localizeText($("#pause"), "ひと休み");
  if (isSurvival(state) && announce) say("音もハートも自動で届くで。ありねぇ、道は任せた！", "DJちゃな / ナビ担当");
  else if (announce) say(state.route.intro || "ハートで仲間を誘って、EVで充電やで！");
  if (announce && state.distance === 0) { roadFeedback = createRoadFeedback(); toast(isSurvival(state) ? "武器は自動。飛ぶ・充電・加速で道をつなご。" : state.routeIndex === 0 ? "運転もハートも自動。段差は飛んでかわそ。" : "選んだ街角へ。今回の盛りで行くで！"); }
  unlockSound();
  accumulator = 0;
  hud();
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
  applySettings();
  if (isSurvival(state)) {
    if (!saves.clearNightfall()) storageWarning();
    savedTour = saves.loadCampaign(); syncResume();
  } else saveTour();
  storyDirector.show("departure", () => enterPlay());
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

function renderStyles() {
  const host = $('#style-options'), current = getRpgView(state);
  host.replaceChildren();
  const weaponMode = isSurvival(state);
  const options = weaponMode ? SURVIVAL_STARTERS : RUN_STYLES;
  host.classList.toggle('weapon-options', weaponMode);
  for (const style of options) {
    const button = document.createElement('button');
    button.className = 'style-card';
    button.dataset[weaponMode ? 'weapon' : 'style'] = style.id;
    button.setAttribute('aria-pressed', String((weaponMode ? state.survival.startingWeapon : current.style) === style.id));
    const name = document.createElement('strong'); localizeText(name, style.name);
    const detail = document.createElement('span'); localizeText(detail, style.role || style.description);
    const hint = document.createElement('small'); localizeText(hint, weaponMode ? "自動アタック / Lv.1" : message("{0} / {1}", [style.effect, style.signature]));
    const heading = document.createElement('span'); heading.className = 'item-heading'; heading.append(createItemIcon(style.id), name);
    button.append(heading, detail, hint);
    button.addEventListener('click', () => {
      if (!(weaponMode ? chooseStartingWeapon(state, style.id) : chooseRunStyle(state, style.id))) return;
      saveTour(); renderStyles(); renderRpgHud();
      host.querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
    });
    host.append(button);
  }
}
function renderRpgHud() {
  const view = rpgView(state);
  localizeText($('#rpg-rank'), view.enabled ? message("MIX Lv.{0} · {1}", [view.rank, view.styleName]) : 'CLASSIC TOUR');
  const xp = $('#rpg-xp');
  xp.value = view.progress || 0; xp.max = 1;
  localizeAttribute(xp, 'aria-valuetext', view.enabled ? message("{0} XP / 次のレベル {1}", [view.xp, view.nextXp ?? 'MAX']) : 'クラシックツアー');
  const active = view.synergy?.filter(item => item.active) || [];
  localizeText($('#rpg-build'), view.enabled ? (active.length ? active.map(item => message("{0}連携", [item.name])).join(' / ') : message("{0} スキル · 招待と回避でXP", [view.perks?.length || 0])) : 'いまの旅はそのまま続けられるで');
}
function showDraft() {
  releaseInput(); accumulator = 0; paused = false;
  setScreen('draft');
  const view = rpgView(state), host = $('#draft-options');
  localizeText($('#draft-title'), message("MIX LEVEL {0} / ひとつ、盛ってこ。", [view.rank + 1]));
  localizeText($('#draft-copy'), '時間は止まってるで。ひとつ選んで、うちらの組み合わせに。進化も装備も、このランだけ。');
  host.replaceChildren();
  for (const perk of view.offers || []) {
    const card = document.createElement('button'); card.className = 'draft-card'; card.dataset.perkId = perk.id;
    const family = document.createElement('span'); family.className = 'eyebrow'; localizeText(family, perk.familyName || perk.family || 'MIX SKILL');
    const name = document.createElement('strong'); localizeText(name, perk.name);
    const description = document.createElement('span'); localizeText(description, perk.role ? message('{0} / {1}', [perk.role, perk.benefit]) : perk.description);
    const detail = document.createElement('small'); localizeText(detail, message("{0} / {1}", [perk.effect, perk.synergy]));
    if (perk.kind === 'weapon') detail.className = 'weapon-stats';
    const heading = document.createElement('span'); heading.className = 'item-heading'; heading.append(createItemIcon(perk.id), name);
    card.append(family, heading, description, detail);
    if (perk.evolution) {
      const recipe = document.createElement('small'); recipe.className = 'evolution-recipe';
      const label = document.createElement('span'), evo = perk.evolution;
      const weapon = SURVIVAL_UPGRADES.find(item => item.id === evo.weapon), support = SURVIVAL_UPGRADES.find(item => item.id === evo.support);
      localizeText(label, message('選ぶと: {0} Lv.{1}/{2} + {3} Lv.{4}/{5} → {6}', [weapon.name, evo.nextWeaponLevel, evo.weaponRequired, support.name, Math.min(evo.supportRequired, evo.nextSupportLevel), evo.supportRequired, evo.name]));
      recipe.append(createItemIcon(evo.id, { size: 24 }), label);
      if (perk.evolutionReady) { const ready = document.createElement('b'); localizeText(ready, 'これで進化！'); recipe.append(ready); }
      card.append(recipe);
    }
    card.addEventListener('click', () => {
      if (!(isSurvival(state) ? chooseSurvivalUpgrade(state, perk.id) : choosePerk(state, perk.id))) return;
      const evolution = state.events.find(event => event.type === 'evolution');
      host.querySelectorAll('button').forEach(button => button.disabled = true);
      beep(880, .12); saveTour();
      if (state.status === 'draft') showDraft();
      else { enterPlay(false); say(`${perk.name}、息ぴったりで使ってこ！`); if (evolution) { toast(message('進化！ {0}', [evolution.name])); beep(1174, .18); } }
    });
    host.append(card);
  }
  host.querySelector('button')?.focus();
  renderRpgHud();
}
$('#draft-panel').addEventListener('keydown', event => {
  if (event.repeat && ['Enter','Space'].includes(event.code)) event.preventDefault();
});

function renderShop() {
  renderGarage();
  renderBuildWorkshop();
  $("#shop").replaceChildren();
  for (const item of availableCarUpgrades(state)) {
    const node = document.createElement("article"); node.className = "shop-item";
    const level = state.upgrades[item.id] || 0, price = upgradePrice(state, item.id);
    if (price === null) continue;
    const repairFull = item.id === "repair" && state.integrity >= state.integrityCapacity;
    const max = repairFull || (item.id !== "repair" && level >= item.maxLevel);
    localizeHTML(node, `<h3>${item.name}</h3><p>${item.description}</p><small>${item.id === "repair" ? "お手入れ" : `盛り ${level} / ${item.maxLevel}`}</small>`);
    const button = document.createElement("button");
    localizeText(button, repairFull ? "修理いらんで" : max ? "めっちゃ盛れた" : message("{0} コインで{1}", [price, item.id === "repair" ? "直そ" : "盛ろ"]));
    button.disabled = max || state.money < price || state.status !== "won" || !state.campaignStarted;
    button.addEventListener("click", () => {
      if (!buyUpgrade(state, item.id)) return;
      saveTour(); beep(750); renderShop(); hud(); toast(`${item.name}、準備できたで！`);
    });
    const heading = document.createElement("div"), title = node.querySelector("h3");
    heading.className = "item-heading"; title.before(heading); heading.append(createItemIcon(item.id), title);
    node.append(button); $("#shop").append(node);
  }
  localizeText($("#shop-status"), "招待と寄り道で集めたコインで、いまのくるまを盛れるで。");
}
function renderBuildWorkshop() {
  const build = describeBuild(state), offers = getBuildOffers(state), host = $("#build-offers");
  localizeText($("#build-summary"), message("{0} · {1} / 4 パーツ。{2}", [build.name, build.mods.length, build.summary]));
  host.replaceChildren();
  for (const offer of offers) {
    const card = document.createElement("article"); card.className = "build-card"; card.dataset.family = offer.family;
    const tag = document.createElement("span"); tag.className = "eyebrow"; localizeText(tag, message("{0} / {1}", [offer.familyName, offer.rarityLabel]));
    const title = document.createElement("h4"); localizeText(title, offer.name);
    const copy = document.createElement("p"); localizeText(copy, offer.description);
    const preview = document.createElement("small"); localizeText(preview, offer.preview);
    const heading = document.createElement('div'); heading.className = 'item-heading'; heading.append(createItemIcon(offer.id),title);
    card.append(tag,heading,copy,preview);
    let replacement;
    if (offer.requiresReplacement) {
      const label = document.createElement("label"); localizeText(label, "外すパーツを選んでな");
      replacement = document.createElement("select"); localizeAttribute(replacement, "aria-label", message("{0}と入れ替えるパーツ", [offer.name]));
      const none = document.createElement("option"); none.value = ""; localizeText(none, "4枠いっぱい。入れ替えを選ぶ"); replacement.append(none);
      for (const item of build.mods) { const option = document.createElement("option"); option.value = item.id; localizeText(option, item.name); replacement.append(option); }
      label.append(replacement); card.append(label);
    }
    const button = document.createElement("button"); button.dataset.modId = offer.id;
    localizeText(button, offer.available ? message("{0} コインで{1}", [offer.price, offer.requiresReplacement ? "入れ替えよ" : "付けよ"]) : offer.reason);
    button.disabled = !offer.available || Boolean(replacement && !replacement.value);
    replacement?.addEventListener("change",()=>{ button.disabled = !offer.available || !replacement.value; });
    button.addEventListener("click",()=>{
      if (!buyRunMod(state,offer.id,replacement?.value || null)) return;
      saveTour(); beep(760,.12); renderShop(); hud(); toast(`${offer.name}、この旅の相棒や！`);
    });
    card.append(button); host.append(card);
  }
  localizeText($("#build-note"), state.status !== "won" ? "到着してから選べるで。まずは最初の街角へ！" : offers.length ? "各到着地点で1つ。最大4パーツ。外すと効果は消えて、この旅では買い直し・返金なし。くるまは今のままや。" : "今あるパーツで、この旅だけの走りを楽しも。基本パーツと修理も使えるで。");
}
function renderGarage() {
  const grid = $("#car-garage");
  grid.replaceChildren();
  const current = getCarProfile(state);
  const atStart =
    state.routeIndex === 0 && !state.campaignStarted && state.distance === 0;
  localizeText($("#garage-wallet"), message("{0} コイン / ギャルポイント {1} · {2}", [state.money, meta.completionPoints, atStart ? "最初に乗るくるま、選ぼか" : "この旅はこのくるまで行くで"]));
  localizeText($("#car-select-wallet"), message("{0} ギャルポイント · 今回は {1}", [meta.completionPoints, current.name]));
  $("#starting-customization").hidden = !atStart;
  if (!atStart) return;
  renderStyles();
  renderStartingCustomization();
  for (const car of CAR_CATALOG) {
    const owned = meta.ownedCars.includes(car.id),
      equipped = current.id === car.id;
    const card = document.createElement("article");
    card.className = `car-card${equipped ? " equipped" : ""}`;
    const preview = document.createElement(owned ? "canvas" : "div");
    if (!owned) { preview.className = "car-mystery"; localizeText(preview, "？"); localizeAttribute(preview, "aria-label", "まだ秘密のくるま"); }
    preview.width = 280;
    preview.height = 150;
    if (owned) localizeAttribute(preview, "aria-label", car.name + " のくるま見本");
    if (owned) drawCar(preview.getContext("2d"), 140, 125, {
      carId: car.id,
      appearance: getCarAppearance(state, car.id),
      scale: 1.1,
    });
    const heading = document.createElement("h3");
    localizeText(heading, owned ? car.name : "まだ秘密のくるま");
    const copy = document.createElement("p");
    localizeText(copy, owned ? car.description : "完走して解禁したら、姿も性能も見せるで。");
    const stats = document.createElement("div");
    stats.className = "car-stats";
    stats.hidden = !owned;
    localizeText(stats, owned ? message("電池 {0} · 耐久 {1} · 浮力 {2} · 消費 {3}/秒 · 充電 {4}/秒 · 連射 {5}秒", [car.stats.energyCapacity, car.stats.integrityCapacity, car.stats.thrustAcceleration, car.stats.thrustDrain, car.stats.chargeRate, car.stats.shotInterval]) : "");
    const button = document.createElement("button");
    localizeText(button, equipped
      ? "これ乗ってるで"
      : owned
        ? "これに乗り換えよ"
        : message("{0} ギャルポイントで解禁", [car.unlockPrice]));
    button.disabled =
      equipped ||
      !atStart ||
      (!owned && meta.completionPoints < car.unlockPrice);
    button.addEventListener("click", () => {
      if (!owned && !unlockCar(meta, car.id, state)) return;
      if (equipStartingCar(state, meta, car.id)) {
        if (!isSurvival(state)) chooseRunStyle(state, getRpgView(state).style || "relay");
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
      localizeText(option, message("{0} · {1}", [item.name, price === 0 ? "解禁済み" : message("{0} GP", [price])]));
      select.append(option);
    }
    select.value = appearance[key].id;
  }
  updateCustomizationPreview();
}
function updateCustomizationPreview() {
  const patch = customizationPatch(), price = startingCustomizationPrice(state, meta, patch);
  for (const [key, id] of Object.entries(patch)) {
    const select = $("#custom-" + key);
    select.parentElement.querySelector(".item-icon")?.remove();
    select.before(createItemIcon(`${key}:${id}`));
  }
  const appearance = Object.fromEntries(Object.entries(cosmeticCatalogs).map(([key,catalog]) => [key,catalog.find(item=>item.id===patch[key])]));
  const preview = $("#customization-preview"), g = preview.getContext("2d");
  g.clearRect(0,0,preview.width,preview.height);
  drawCar(g,210,160,{carId:getCarProfile(state).id,appearance,scale:1.7});
  const unchanged = Object.keys(patch).every(key => getCarAppearance(state)[key].id === patch[key]);
  localizeText($("#customization-status"), unchanged ? "いまの盛りやで。ロゴはそのまま、うちら仕様！" : price === 0 ? "解禁済みやから、着替えは無料やで。" : message("まとめて {0} ギャルポイント。残り {1} GPやで。", [price, meta.completionPoints]));
  $("#customization-apply").disabled = unchanged || price === null || price > meta.completionPoints || !atNewRunGarage();
  localizeText($("#customization-apply"), price ? message("{0} GPで解禁して着替えよ", [price]) : "この盛りで決めよ");
}
for (const key of Object.keys(cosmeticCatalogs)) $("#custom-"+key).addEventListener("change",updateCustomizationPreview);
$("#customization-apply").addEventListener("click", () => {
  if (screen !== "cars" || !customizeStartingCar(state,meta,customizationPatch())) return;
  saveMeta(); saveTour(); renderGarage(); beep(900); toast("うちら仕様、ばっちりやん！");
  $("#custom-paint").focus();
});

let currentQuestion = null,
  quizAnswered = false, quizNext = null;
function showQuiz(next = null) {
  quizNext = next;
  releaseInput();
  paused = false;
  setScreen("quiz");
  localizeText($('#quiz-eyebrow'), isSurvival(state) ? 'CLUB LOUNGE / ギャルトーク' : 'ROADSIDE / ギャルトーク');
  localizeText($('#quiz-continue'), isSurvival(state) ? 'ほな、うちらの出番や' : 'ほな、クラブ目指そ');
  currentQuestion = questionForStage(state.routeIndex, state.routeOption, state.seed);
  quizAnswered = false;
  $("#quiz").hidden = false;
  localizeText($("#quiz-question"), currentQuestion.question);
  localizeText($("#quiz-feedback"), "");
  $("#quiz-source").hidden = true;
  $("#quiz-continue").hidden = true;
  $("#quiz-choices").hidden = false;
  $("#quiz-choices").replaceChildren();
  currentQuestion.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    localizeText(button, message("{0}. {1}", [index + 1, choice]));
    button.addEventListener("click", () => chooseAnswer(index));
    $("#quiz-choices").append(button);
  });
  $("#quiz-choices button").focus();
}
function chooseAnswer(index) {
  if (screen !== "quiz" || quizAnswered) return;
  quizAnswered = true;
  const correct = index === currentQuestion.answer;
  answerQuiz(state, correct);
  if (isSurvival(state)) { saveTour(); if (state.campaignComplete) persistNightfallResult(); }
  releaseInput();
  localizeText($("#quiz-feedback"), (correct ? "正解！新しいファンが増えたで " : "今回は惜しい！ ") +
    message("答えは「{0}」。{1}", [currentQuestion.choices[currentQuestion.answer], currentQuestion.explanation]));
  $("#quiz-choices").hidden = true;
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
  if (quizNext) { const next = quizNext; quizNext = null; next(); return; }
  enterPlay(false);
  say("ほな、クラブで会おな！");
});
function startClubSet(next) {
  const venue = getClubArt(state.route.club);
  $('#performance-panel').style.setProperty('--club-accent', venue?.accent || '#ff9ed3');
  $('#performance-panel').style.setProperty('--club-floor', venue?.floor || '#201329');
  performanceSet = createPerformance(); performanceNext = next;
  setScreen('finale');
  localizeText($('#finale-home'), state.campaignComplete ? 'ランの記録を見る' : '次の街へ');
  localizeText($('#performance-tip'), message('{0} / オリジナル・ハードバウンス、開演！', [state.route.club]));
  say('看板より大きい音で、うちらの出番や！'); unlockSound();
  $('#pause').disabled = false; localizeText($('#pause'), 'ひと休み');
}
function persistNightfallResult() {
  if (terminalRecord?.id === state.runId && terminalRecord.score === state.score) return terminalRecord;
  const sameRun = terminalRecord?.id === state.runId;
  const previous = sameRun ? terminalRecord.previous : survivalRecords.best(state.survival.day, state.survival.assisted);
  const result = survivalRecords.save(state);
  if (sameRun && terminalRecord.result.best) result.best = true;
  terminalRecord = { id: state.runId, score: state.score, previous, result };
  return terminalRecord;
}
function showNightfallRecord() {
  const { previous, result } = persistNightfallResult();
  setScreen('result');
  localizeText($('#result-eyebrow'), 'NIGHTFALL TOUR');
  localizeText($('#result-title'), state.campaignComplete ? '72ウェーブ、生き抜いた！' : 'このビルドで、ここまで来た。');
  localizeText($('#result-copy'), '同じコースでも、選ぶ進化で違う走りに。もう一回なら、新しいビルドで最初から。');
  renderSurvivalResult(state, result, previous, $('#result-stats'));
  localizeText($('#continue'), '同じシードでもう一回');
  $('#continue').focus(); beep(state.campaignComplete ? 880 : 190, .2);
}
function showResult() {
  if (isSurvival(state)) {
    releaseInput();
    if (state.status === 'won') {
      const earned = awardCompletion(meta, state);
      if (earned) saveMeta();
      saveTour();
      if (state.campaignComplete) persistNightfallResult();
      const next = state.campaignComplete ? showNightfallRecord : () => openMap(true);
      if (state.campaignComplete) {
        storyDirector.show('arrival', () => {
          const finale = () => storyDirector.show('finale', () => startClubSet(next));
          if (beginClubQuiz(state)) showQuiz(finale); else finale();
        });
      } else if (getJourneyStage(state.routeIndex).clubStop) {
        const club = () => startClubSet(() => storyDirector.show('arrival', next));
        if (beginClubQuiz(state)) showQuiz(club); else club();
      } else storyDirector.show('arrival', next);
    } else {
      if (!saves.clearNightfall()) storageWarning();
      savedTour = saves.loadCampaign(); syncResume();
      persistNightfallResult();
      storyDirector.show('breakdown', showNightfallRecord);
    }
    return;
  }
  $("#result-stats").classList.remove("survival-results");
  const earned = awardCompletion(meta, state);
  if (earned) {
    saveMeta();
    toast(`ギャルポイント、${earned}もらえたで！ 次の旅でくるま解禁しよ。`);
  }
  saveTour();
  if (state.status === "won") {
    releaseInput();
    if (state.campaignComplete) {
      storyDirector.show('arrival', () => storyDirector.show('finale', () => {
        performanceSet = createPerformance();
        setScreen('finale');
        say('6つのクラブの音、ひとつになったで。ここからはうちらの時間や！');
        unlockSound();
        $('#pause').disabled = false;
        localizeText($('#pause'), 'ひと休み');
      }));
    } else {
      storyDirector.show("arrival", () => { openMap(true); toast(state.route.win); });
    }
    return;
  }
  releaseInput();
  setScreen("result");
  $("#result").hidden = false;
  const won = state.status === "won";
  localizeText($("#result-eyebrow"), won
    ? "出番、間に合ったで"
    : "もっかい行こか？");
  localizeText($("#result-title"), won
    ? state.campaignComplete
      ? "うちらのラストセット"
      : "クラブ着いたで"
    : "まだまだ、いけるで。");
  localizeText($("#result-copy"), won
    ? state.route.win || "街で増えた仲間も、一緒にフロアへ！"
    : (state.reason === "energy" ? "電池が足りへんかったな。次はEVの手前で浮上をやめて、E長押しで充電しよ。" : "いったんピットへ戻ろ。段差は浮上、音の壁はハートかラッシュ。休憩メニューでダメージを減らすこともできるで。"));
  const tourStats = document.createElement("p");
  $("#result-stats").replaceChildren(tourStats);
  localizeText(tourStats, message("{0}人と出会えた · 最高{1}コンボ · ちいさなしあわせ {2}個", [state.stageGyaru, state.bestCombo, state.littleFinds]) + (won ? '。次の街でも、うちららしく。' : '。この道の出発前へ戻って再挑戦。前の街までの記録は残るで。'));
  localizeText($("#continue"), won
    ? state.campaignComplete
      ? "ほな、音出そ →"
      : "道とくるま、見てこ →"
    : "もっかいこの道行こ →");
  $("#continue").focus();
  beep(won ? 880 : 190, 0.25);
}
function refreshSurvivalRecord() {
  const challenge = dailySurvival(), best = survivalRecords.best(challenge.day, settings.assistMode);
  if (settings.assistMode) {
    localizeText($('#survival-record'), best ? message('ゆったり自己ベスト {0} · この端末', [number(best.score, { useGrouping: true })]) : 'ゆったりツアー · 通常の記録とは別');
    return;
  }
  localizeText($('#survival-record'), best ? message('今日の自己ベスト {0} · この端末', [number(best.score, { useGrouping: true })]) : '今日のコースに挑戦 · 記録はこの端末に保存');
}
function startNight(challenge = dailySurvival()) {
  if (!ready) return;
  if (savedTour && isSurvival(savedTour) && !savedTour.campaignComplete && !confirm(t("新しい旅を始めたら、いまの旅のセーブは上書きやで。解禁したくるまとギャルポイントは残るで。始める？"))) return;
  state = newTour(meta, challenge);
  pendingNext = false; paused = false; performanceNext = null; terminalRecord = null; roadFeedback = createRoadFeedback(); drivingLessons = createDrivingLessons();
  applySettings(); roadChoice = 'scenic';
  storyDirector.show('opening', () => {
    setScreen('cars'); renderGarage(); saveTour(); $('#cars-ready').focus();
  });
}
refreshSurvivalRecord();
$('#story').addEventListener('click', () => startNight());
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
  if (isSurvival(state)) { startNight({ seed: state.seed, day: state.survival.day, recordEligible: state.survival.recordEligible }); return; }
  if (state.status === "won") {
    if (state.campaignComplete) {
      performanceSet = createPerformance();
      setScreen("finale");
      say("DJありねぇとDJちゃな、全員ぶちアゲやー！");
      unlockSound();
      $("#pause").disabled = false;
      localizeText($("#pause"), "ひと休み");
    } else openMap(true);
  } else {
    state = retryRoute(state);
    applySettings();
    storyDirector.show("retry", () => enterPlay());
  }
});
// The encore is optional; leaving never changes already-earned completion credit.
$("#finale-home").addEventListener("click", () => { const next = performanceNext; performanceNext = null; if (next) next(); else home(); });
$('#performance-track').addEventListener('click', () => {
  const track = audio.tracks.find(track => chartForTrack(track));
  if (!track || screen !== 'finale' || paused) return;
  releaseInput();
  performanceSet = createPerformance(chartForTrack(track));
  void audio.playTrack(track.id);
  canvas.focus({ preventScroll: true });
});
function previewMission(node) {
  if (!node) return null;
  const preview = node.nodeId === state.journeyNodeId ? state : createState({ mode: state.mode, routeIndex: node.stageIndex, seed: state.seed, journeyNodeId: node.nodeId, ...mapClimate });
  return getRouteMission(preview,node);
}
function survivalRouteDetail(node) {
  if (!isSurvival(state)) return node.description;
  return node.kind === 'event' ? '招待スコア+25%・人波多め・短めの道' : node.kind === 'service' ? '到着で耐久+20・短い道・EV少なめ' : 'EV多め・長い道・招待スコア控えめ';
}
function renderDestinationChoices() {
  const choices = getJourneyChoices(pendingNext ? state.routeIndex+1 : state.routeIndex,state.seed);
  const chosen = choices.find(node => node.nodeId === selectedNodeId);
  const mission = previewMission(chosen);
  localizeText($("#map-route-detail"), chosen ? survivalRouteDetail(chosen) : "");
  localizeText($("#route-mission-preview"), mission ? message("寄り道の目標「{0}」 {1} {2}", [mission.label, mission.description, mission.rewardLabel]) : "");
  localizeText($("#map-selected-route"), chosen ? message("選んだ道：{0}", [chosen.districtName]) : "地図の行き先を選んでな");
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
    const title = document.createElement("strong"); localizeText(title, node.districtName);
    const detail = document.createElement("small"); localizeText(detail, message("{0} · {1}", [node.label, survivalRouteDetail(node)]));
    const kind = document.createElement("span"); kind.className="destination-kind"; localizeText(kind, message("{0} · {1}", [index + 1, node.label]));
    const status = document.createElement("span"); status.className="destination-status"; localizeText(status, node.nodeId===selectedNodeId ? "✓ この道を選択中" : "この街角へ →");
    const fit = document.createElement("span"); fit.className = "route-fit";
    localizeText(fit, isSurvival(state) ? survivalRouteDetail(node) : node.kind === "service" ? message("到着で耐久+20 / 現在{0}", [Math.ceil(state.integrity)]) : node.kind === "event" ? "コイン+25% / 動く相手が多め" : "EV多め / ゆっくり長めの道");
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
  if(screen!=="map")return;
  const bounds=canvas.getBoundingClientRect();
  const hit=hitTestMapChoice((event.clientX-bounds.left)*960/bounds.width,(event.clientY-bounds.top)*540/bounds.height);
  const node=getJourneyChoices(pendingNext?state.routeIndex+1:state.routeIndex,state.seed)[hit];
  if(hit!==null&&node)selectDestination(node.nodeId);
});
function hud() {
  renderRpgHud();
  const rushButton = $('[data-control="rush"]');
  localizeText(rushButton.querySelector("small"), state.rushing ? "無敵やで！ 電池めっちゃ使ってる！" : state.rushCooldown > 0 ? message("あと {0} 秒待ってな", [Math.ceil(state.rushCooldown)]) : "X / SHIFT · 電池めっちゃ使うで");
  const cue = getDrivingCue(state, drivingLessons);
  const cueKey = `${cue.label}:${cue.action}`;
  if (cueKey !== lastCue) {
    localizeText($("#road-cue"), cue.label); $("#road-status").dataset.urgency = cue.urgency;
    document.querySelectorAll("[data-control]").forEach(button => button.classList.toggle("suggested", button.dataset.control === cue.action)); lastCue = cueKey;
  }
  const ev = state._stations.find(distance => distance > state.distance + 5);
  localizeText($("#next-ev"), state.atStation ? "EV · EVエリア" : ev ? message("EV · あと{0}m", [Math.ceil(ev - state.distance)]) : "まもなく到着");
  localizeText($("#road-phase"), isSurvival(state) ? message("ウェーブ {0} / 72", [state.routeIndex * 6 + state.survival.wave + 1]) : getEncounterPhase(state).label);
  for (const [kind,value,capacity] of [["health",state.integrity,state.integrityCapacity],["energy",state.energy,state.energyCapacity]]) {
    const meter = $("#" + kind + "-meter"); meter.setAttribute("aria-valuenow", String(Math.ceil(value))); meter.setAttribute("aria-valuemax", String(capacity)); meter.dataset.low = String(value / capacity < .25);
  }
  const route = state.route;
  localizeText($("#location-label"), message("{0} / {1}", [(getDistrictScene(route.cityId, state.locationIndex || 0) || { name: route.goal }).name, String((state.locationIndex || 0) + 1).padStart(2, "0")]));
  localizeText($("#mode-label"), isSurvival(state) ? state.survival.assisted ? 'ゆったりツアー' : "NIGHTFALL TOUR" : message("クラブ旅 {0} / {1}", [state.routeIndex + 1, JOURNEY_STAGE_COUNT]));
  localizeText($("#money"), isSurvival(state) ? number(Math.floor(state.score), { useGrouping: true }) : String(state.money).padStart(3, "0"));
  localizeText($(".wallet > span"), isSurvival(state) ? "スコア" : "コイン");
  $("#combo-bar").style.width =
    `${Math.min(100, ((state.comboTimer || 0) / 4) * 100)}%`;
  localizeText($("#destination"), message("次のフロア / {0}", [route.club]));
  const length = state.routeLength || route.distance;
  localizeText($("#remaining"), message("{0} m", [number(Math.ceil(Math.max(0, length - state.distance)), { useGrouping: true })]));
  $("#progress").style.width =
    `${Math.min(100, (state.distance / length) * 100)}%`;
  localizeText($("#fans"), message("ファン {0} 人", [state.totalFans]));
  localizeText($("#combo"), state.charging
    ? "充電中やで"
    : state.atStation
      ? "E長押しで充電や"
      : state.combo > 1
        ? message("{0} 連続やで", [state.combo])
        : " ハートでフロアへ誘お");
  localizeText($("#health-value"), message("{0}", [Math.ceil(state.integrity)]));
  if (isSurvival(state)) {
    localizeText($("#combo"), message("HEAT ×{0} · 招待 {1}", [survivalMultiplier(state), state.survival.kills]));
    localizeText($("#rpg-build"), message("進化 {0} · ノーダメージ {1}", [state.survival.evolutions.length, state.survival.cleanWaves]));
    if (state.survival.recordEligible !== false && state.score > survivalBest && survivalBest > 0 && !state.survival.bestNotified) { state.survival.bestNotified = true; toast(state.survival.assisted ? 'ゆったり自己ベスト更新！' : '今日の自己ベスト更新！'); }
  }
  $("#health-bar").style.width =
    `${(state.integrity / (state.integrityCapacity || 100)) * 100}%`;
  localizeText($("#energy-value"), message("{0}", [Math.ceil(state.energy)]));
  $("#energy-bar").style.width =
    `${(state.energy / (state.energyCapacity || 100)) * 100}%`;
}
function handleEvents() {
  captureRoadFeedback(roadFeedback, state.events, state.distance);
  const crewEvent = selectCrewEvent(state.events || [], {...state, time: visualTime});
  for (const event of state.events || []) {
    if (event.type === "fever-start") { toast("FEVER！ スコア6倍、フロア全開！"); beep(1174, .16); }
    if (event.type === "clean-wave") { toast(message("ノーダメージ！ +{0}", [event.points])); beep(988, .1); }
    if (event.type === "survival-elite") { toast(message("シグナル突破！ +{0}", [event.points])); beep(1320, .15); }
    if (["convert"].includes(event.type)) {
      beep(850, 0.07);
      if (event.elite || (state.combo > 1 && state.combo % 5 === 0)) toast(`${state.combo}連続！ 街がつながってきたで`);
    }
    if (event.type === 'little-find') {
      beep(1040, .08);
      toast(`${event.find.name} / +75・でんち+6`);
    }
    if (["collision", "hit"].includes(event.type)) {
      beep(110, 0.16);
      toast("いたっ！ロケットでかわして！");
      say("おっと、立て直すで。前の道、もう一回確認や。", "DJありねぇ / 運転");
    }
    if (["charge-start", "station-enter"].includes(event.type)) {
      toast("充電所や！ Eを長押ししてな");
      say("充電スポット！Eでバッテリー回復や！");
    }
    if (event.type === "rush-start") {
      beep(520, .18); toast("テキーララッシュ！ いま無敵やで！");
      say("息合わせて一気に行くで。電池は気ぃつけや！");
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
  if (!paused && !["story", "draft", "quiz", "result"].includes(screen)) visualTime += dt;
  if (screen === "playing" && !paused) {
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      update(state, { ...input, shoot: !isSurvival(state) }, 1 / 60);
      updateDrivingLessons(drivingLessons, state, 1 / 60);
      handleEvents();
      accumulator -= 1 / 60;
      if (state.status !== "playing") {
        if (state.status === "draft") showDraft();
        else if (state.status === "quiz") showQuiz();
        else showResult();
        accumulator = 0;
        break;
      }
    }
    if (visualTime - lastHud > .09) { hud(); lastHud = visualTime; }
    refreshCrewDialogue();
  }
  if (screen === "finale" && !paused) {
    updatePerformance(performanceSet, input, dt, audio.transport);
    const view = performanceView(performanceSet);
    localizeText($("#performance-title"), view.title);
    localizeText($("#performance-phase"), view.phase);
    $("#performance-progress").style.width = `${view.progress * 100}%`;
    const completed = message('{0} / {1} フレーズ · ファン {2}人 · フロアの仲間 {3}人', [view.hits, view.total, state.totalFans, state.gyaruConverted]);
    if ($("#performance-score").textContent !== t(completed)) localizeText($("#performance-score"), completed);
    $('#performance-track').hidden = !audio.tracks.some(track => chartForTrack(track));
    document.querySelectorAll("[data-control]").forEach(button => button.classList.toggle("suggested", button.dataset.control === view.action));
  }
  if (screen === "playing" && !paused) updateRoadFeedback(roadFeedback, dt);
  if (toastTime > 0) {
    toastTime -= dt;
    if (toastTime <= 0) $("#toast").classList.remove("on");
  }
  const musicLevels = !paused && !reducedMotion && ['menu', 'playing', 'finale'].includes(screen) ? audio.reactivity : SILENT_MUSIC;
  const crewVisuals = resolveCrewVisuals(state, { time: visualTime, reducedMotion, music: musicLevels, action: screen === "finale" ? "cheer" : undefined });
  if (screen === "map") {
    // The directly selectable DOM map owns this screen; do not redraw a hidden canvas.
  } else if (screen === "finale")
    drawFinale(ctx, {
      time: reducedMotion ? 0 : visualTime,
      score: state.score,
      totalFans: state.totalFans,
      performance: performanceView(performanceSet),
      music: musicLevels,
      club: state.route.club, complete: state.campaignComplete,
      reducedMotion,
      width: 960,
      height: 540,
    });
  else
    render(ctx, state, {
      time: visualTime,
      menu: screen === "menu",
      crewVisuals,
      reducedMotion,
      music: musicLevels,
    });
  if (screen === "playing") { drawRoadFeedback(ctx, roadFeedback, state, { reducedMotion }); drawSurvival(ctx, state, visualTime, reducedMotion); }
  const portraits = $("#crew-actions").getContext("2d");
  portraits.clearRect(0, 0, 240, 128);
  for (const [i, character] of ["arisu", "chana"].entries())
    drawCharacter(portraits, {
      character,
      x: i * 112,
      y: 0,
      width: 128,
      height: 128,
      ...crewVisuals,
    });
  frameSamples.push(performance.now() - frameStart);
  if (frameSamples.length > 600) frameSamples.shift();
  requestAnimationFrame(frame);
}
async function loadGameArt() {
  $("#story").disabled = true;
  $("#resume-tour").disabled = true;
  $("#retry-art").hidden = true;
  localizeText($("#loading"), "街の灯り、つけてるで…");
  try {
    await prepareGameArt(state);
    ready = true;
    localizeText($("#loading"), "準備できたで。いつでも行こ！");
    $("#story").disabled = false;
    $("#resume-tour").disabled = false;
    hud();
    requestAnimationFrame(frame);
  } catch (error) {
    localizeText($("#loading"), "絵が読み込めへんかった。下のボタンでもう一回いこ。");
    $("#retry-art").hidden = false;
    console.error(error);
  }
}
$("#retry-art").addEventListener("click", () => retryResume ? resumeTour() : loadGameArt());
loadGameArt();
document.querySelectorAll("[data-control]").forEach((b) => (b.disabled = true));
Object.defineProperty(window, "__HYPERDRIVE__", {
  value: {
    snapshot: () => structuredClone({ state, input, screen, paused, ready, performanceSet, autoHearts: true, settings, rpg: getRpgView(state), story: storyDirector.memory }),
    metrics: () => { const samples = [...frameSamples].sort((a,b)=>a-b); return { frames: samples.length, p50: samples[Math.floor(samples.length*.5)] || 0, p95: samples[Math.floor(samples.length*.95)] || 0, max: samples.at(-1) || 0 }; },
  },
  writable: false,
});

installFrame();
installLanguageSelectors({ onError: toast });
