/** Destination graph for the twelve-road, six-city club tour. Pure data and immutable progress helpers. */
import { DISTRICT_CATALOG } from './district-catalog.js';

export const JOURNEY_VERSION = 1;
export const JOURNEY_STAGE_COUNT = 12;
export const JOURNEY_CITY_IDS = Object.freeze(['nakano', 'shinjuku', 'shibuya', 'asakusa', 'osaka', 'kyoto']);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
// Authored alternatives use real, completed district artwork. Each city has an
// approach road and a club road; all alternatives reconverge at the next stop.
const CITY_PLANS = [
  { city: '中野', club: 'BEAT BASE 175', legs: [
    [[5, 'ev', '野方で充電して、旅の準備'], [0, 'event', '裏通りでレコード好きにハート'], [4, 'service', '踏切を越えて整備屋へ']],
    [[19, 'ev', '四季の森で最後の充電'], [2, 'event', 'アーケードの客をフロアへ'], [12, 'service', 'ガード下を抜けてブース入り']],
  ] },
  { city: '新宿', club: 'PINK FLASH', legs: [
    [[5, 'ev', '御苑の外苑をゆっくり走ろ'], [8, 'event', '市場の人波でコンボ稼ぎ'], [17, 'service', '曙橋の高架で修理待ち']],
    [[11, 'ev', '運河沿いのEVで電池満タン'], [1, 'event', 'ネオン門から仲間を連れて'], [0, 'service', '摩天楼の近道でクラブへ']],
  ] },
  { city: '渋谷', club: 'NEON LEOPARD', legs: [
    [[8, 'ev', '公園入口でひと息充電'], [6, 'event', '竹下通りでハート連鎖'], [10, 'service', '神泉トンネルの整備ピット']],
    [[19, 'ev', '渋谷川沿いで電池を整えて'], [0, 'event', '交差点の仲間をフロアへ招待'], [2, 'service', '道玄坂の近道から音出し']],
  ] },
  { city: '浅草', club: 'LANTERN BASS', legs: [
    [[3, 'ev', '桜堤の充電所で川風休憩'], [1, 'event', '仲見世の人波にハート'], [13, 'service', '蔵前の工房で車をケア']],
    [[11, 'ev', '向島を回って安全に到着'], [7, 'event', '劇場前の客とクラブ入り'], [19, 'service', '祭り船着場の短い道へ']],
  ] },
  { city: '大阪', club: 'BASS TAKOYAKI', legs: [
    [[8, 'ev', '天王寺の芝生沿いで充電'], [5, 'event', '黒門市場でハート大繁盛'], [18, 'service', '大正の工場ピットに寄り道']],
    [[14, 'ev', '中之島をゆったり渡ろ'], [0, 'event', '道頓堀の人波で連続コンボ'], [4, 'service', 'なんばの高架から最短入り']],
  ] },
  { city: '京都', club: 'GALAXY FLOOR', legs: [
    [[13, 'ev', '哲学の道で最後の遠出'], [8, 'event', '錦市場にラストセットの招待'], [19, 'service', '西陣の工房で最終整備']],
    [[5, 'ev', '鴨川で満充電、ラストへ'], [0, 'event', '祇園の仲間を全員フロアへ'], [6, 'service', '先斗町の川床からブースへ']],
  ] },
];
export const JOURNEY_PATH_PROFILES = freeze({
  ev: { kind: 'ev', label: '充電ルート', routeOption: 'scenic', description: 'EV多め・長い道・コイン控えめ', lengthMultiplier: 1.08, encounterSpacingMultiplier: 1.15, stationSpacingMultiplier: .72, conversionRewardMultiplier: .9, movingEnemyRate: .12, arrivalRepair: 0 },
  event: { kind: 'event', label: '街角イベント', routeOption: 'express', description: '人波多め・コイン25%増・動く相手に注意', lengthMultiplier: 1.04, encounterSpacingMultiplier: .8, stationSpacingMultiplier: 1.05, conversionRewardMultiplier: 1.25, movingEnemyRate: .5, arrivalRepair: 0 },
  service: { kind: 'service', label: '整備ピットへの近道', routeOption: 'express', description: '短い道・EV少なめ・到着時に耐久+20', lengthMultiplier: .88, encounterSpacingMultiplier: 1.05, stationSpacingMultiplier: 1.2, conversionRewardMultiplier: 1, movingEnemyRate: .35, arrivalRepair: 20 },
});
const STAGES = freeze(CITY_PLANS.flatMap((plan, cityIndex) => plan.legs.map((alternatives, leg) => {
  const stageIndex = cityIndex * 2 + leg, cityId = JOURNEY_CITY_IDS[cityIndex];
  return {
    stageIndex, cityIndex, cityId, cityName: plan.city, leg, club: plan.club,
    clubStop: leg === 1, finale: stageIndex === JOURNEY_STAGE_COUNT - 1,
    title: `${plan.city} ${leg === 0 ? '街へ向かう道' : 'クラブへの道'}`,
    nodes: DISTRICT_CATALOG[cityId].slice(leg * 10, leg * 10 + 10).flatMap((district, localIndex) =>
      Object.entries(JOURNEY_PATH_PROFILES).map(([kind, profile]) => ({
        nodeId: `${cityId}-${leg + 1}-${kind}-${district.id}`, stageIndex, cityIndex, cityId, leg,
        districtId: district.id, name: district.name, districtName: district.name, locationIndex: leg * 10 + localIndex,
        story: `${district.name}で${kind === 'ev' ? '充電してから出発' : kind === 'event' ? '街の仲間にハートを届けよ' : '整備ピットを目指そう'}`,
        club: plan.club, clubStop: leg === 1, ...profile,
      }))),
  };
})));
const NODES = new Map(STAGES.flatMap(stage => stage.nodes.map(node => [node.nodeId, node])));
export function getJourneyStage(stageIndex) { return Number.isInteger(stageIndex) ? STAGES[stageIndex] || null : null; }
/** Every tour exposes three different districts; all twenty per city rotate across seeds.
 * IDs embed the district and resolve independently of seed, including older saves. */
export function getJourneyChoices(stageIndex, seed = 0) {
  const stage = getJourneyStage(stageIndex);
  if (!stage) return Object.freeze([]);
  const start = ((Math.trunc(Number(seed) || 0) + stageIndex * 7) % 10 + 10) % 10;
  return Object.freeze([0, 3, 7].map((offset, kindIndex) => stage.nodes[((start + offset) % 10) * 3 + kindIndex]));
}
export function getJourneyNode(nodeId) { return NODES.get(nodeId) || null; }
export function createJourneyProgress(seed = 1) {
  return { version: JOURNEY_VERSION, seed: Number.isSafeInteger(seed) ? seed : 1, stageIndex: 0, selectedNodeId: null, completedNodeIds: [], complete: false };
}
/** Reject malformed histories rather than allowing skipped cities or invented destinations. */
export function restoreJourneyProgress(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  if (!value || value.version !== JOURNEY_VERSION || !Number.isSafeInteger(value.seed) ||
      !Number.isInteger(value.stageIndex) || value.stageIndex < 0 || value.stageIndex > JOURNEY_STAGE_COUNT ||
      !Array.isArray(value.completedNodeIds) || value.completedNodeIds.length !== value.stageIndex ||
      value.complete !== (value.stageIndex === JOURNEY_STAGE_COUNT)) return null;
  if (value.completedNodeIds.some((id, index) => getJourneyNode(id)?.stageIndex !== index)) return null;
  if (value.selectedNodeId !== null && (value.complete || getJourneyNode(value.selectedNodeId)?.stageIndex !== value.stageIndex)) return null;
  return { version: JOURNEY_VERSION, seed: value.seed, stageIndex: value.stageIndex,
    selectedNodeId: value.selectedNodeId, completedNodeIds: [...value.completedNodeIds], complete: value.complete };
}
/** Selection itself never grants a service reward; apply arrivalRepair only on a successful road. */
export function chooseJourneyNode(progress, nodeId) {
  const next = restoreJourneyProgress(progress), node = getJourneyNode(nodeId);
  if (!next || next.complete || !node || node.stageIndex !== next.stageIndex) return null;
  next.selectedNodeId = nodeId;
  return next;
}
export function completeJourneyNode(progress, nodeId = progress?.selectedNodeId) {
  const next = restoreJourneyProgress(progress);
  if (!next || next.complete || !nodeId || nodeId !== next.selectedNodeId) return null;
  next.completedNodeIds.push(nodeId);
  next.stageIndex++;
  next.selectedNodeId = null;
  next.complete = next.stageIndex === JOURNEY_STAGE_COUNT;
  return next;
}
