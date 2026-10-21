import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPerformance,
  updatePerformance,
  performanceView,
  PERFORMANCE_PHRASES,
  PERFORMANCE_LENGTH,
} from '../public/game-test/src/performance.js';
import {
  createRoadFeedback,
  captureRoadFeedback,
  updateRoadFeedback,
  getRoadCue,
} from '../public/game-test/src/road-feedback.js';
import {
  createState,
  update,
  exportCampaignSave,
  restoreCampaignSave,
} from '../public/game-test/src/simulation.js';

test('optional encore uses the same three actions and never needs an exact rhythm', () => {
  const set = createPerformance();
  assert.deepEqual(
    [...new Set(PERFORMANCE_PHRASES.map((p) => p.action))].sort(),
    ['boost', 'charge', 'rush'],
  );
  for (let t = 0; t < PERFORMANCE_LENGTH + 2; t += 1 / 60)
    updatePerformance(
      set,
      { boost: true, charge: true, rush: true, shoot: true },
      1 / 60,
    );
  assert.equal(set.done, true);
  assert.equal(set.hits, 8);
  assert.equal(new Set(set.completed).size, 8);
  const before = structuredClone(set);
  updatePerformance(set, { shoot: true }, 100);
  assert.deepEqual(set, before);
  assert.equal(performanceView(set).action, null);
});
test('watching the whole encore remains valid and never creates campaign rewards', () => {
  const set = createPerformance();
  for (let i = 0; i < 40; i++) updatePerformance(set, {}, 1);
  assert.equal(set.done, true);
  assert.equal(set.hits, 0);
  assert.equal(performanceView(set).done, true);
  assert.equal(Object.hasOwn(set, 'completionPoints'), false);
  const empty = createPerformance();
  for (const dt of [-1, NaN, Infinity, 0])
    updatePerformance(empty, { rush: true }, dt);
  assert.deepEqual(empty, createPerformance());
});
test('feedback is bounded and expires without random accumulation', () => {
  const fx = createRoadFeedback();
  captureRoadFeedback(
    fx,
    Array.from({ length: 300 }, (_, i) => ({
      type: 'convert',
      reward: 50,
      distance: i,
    })),
  );
  assert.equal(fx.effects.length, 36);
  updateRoadFeedback(fx, 2);
  assert.equal(fx.effects.length, 0);
});
test('an imminent hole warning beats a low battery reminder', () => {
  const s = createState();
  s.energy = 0;
  s.distance = 100;
  s.entities = [{ id: 1, type: 'pothole', distance: 150 }];
  assert.equal(getRoadCue(s).action, 'boost');
});
test('invalid charge away from EV does not trap the other three controls', () => {
  const s = createState();
  s.entities = [];
  s._stations = [];
  s._nextEncounter = 1e9;
  s._quizTriggered = true;
  update(s, { shoot: true, boost: true, charge: true, rush: true }, 0.1);
  assert.equal(s.shooting, true);
  assert.equal(s.boosting, true);
  assert.equal(s.rushing, true);
  assert.ok(s.altitude > 0);
});
test('schema2 remains twelve roads while schema3 preserves new build checkpoints', () => {
  const s = createState({ routeIndex: 8 });
  const saved = exportCampaignSave(s);
  saved.version = 2;
  delete saved.checkpoint.runBuild;
  const restored = restoreCampaignSave(saved);
  assert.ok(restored);
  assert.equal(restored.routeIndex, 8);
  assert.deepEqual(restored.runBuild.mods, []);
  assert.equal(exportCampaignSave(restored).version, 3);
});

test('extended EV fringe never locks controls next to an unresolved hazard', () => {
  const s = createState();
  s.entities = [
    { id: 1, type: 'ev', distance: 100, radius: 72 },
    { id: 2, type: 'pothole', distance: 55 },
  ];
  s._stations = [];
  s._nextEncounter = 1e9;
  s._quizTriggered = true;
  s.upgrades.evRange = 3;
  s.chargeRadiusBonus = 30;
  s.energy = 20;
  update(s, { charge: true, boost: true, shoot: true }, 0.1);
  assert.equal(s.atStation, false);
  assert.equal(s.charging, false);
  assert.equal(s.boosting, true);
  assert.equal(s.shooting, true);
  const clean = createState();
  clean.entities = [{ id: 1, type: 'ev', distance: 100, radius: 72 }];
  clean._stations = [];
  clean._nextEncounter = 1e9;
  clean._quizTriggered = true;
  clean.upgrades.evRange = 3;
  clean.chargeRadiusBonus = 30;
  clean.energy = 20;
  update(clean, { charge: true }, 0.1);
  assert.equal(clean.atStation, true);
  assert.ok(clean.energy > 20);
});
