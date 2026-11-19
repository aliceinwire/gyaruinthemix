import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awardRoadPoints,
  buyStartingUpgrade,
  createMetaProgress,
  equipStartingCar,
  roadPointProgress,
} from '../public/game/src/garage.js';
import {
  createState,
  update,
  nextRoute,
  changeRouteBeforeStart,
  exportNightfallSave,
  restoreNightfallSave,
  exportCampaignSave,
  restoreCampaignSave,
} from '../public/game/src/simulation.js';
import { getJourneyChoices } from '../public/game/src/journey.js';
import {
  getRouteMission,
  routeMissionProgress,
} from '../public/game/src/run-build.js';

const tour = (options = {}) =>
  createState({
    mode: 'survival',
    survivalDay: '2026-11-18',
    runId: 'tour-a',
    ...options,
  });
const arrive = (state) => {
  state.distance = state.routeLength - 0.01;
  update(state, {}, 0.01);
  assert.equal(state.status, 'won');
};
function charge(state, stationId = 1, energyRestored = 40) {
  for (let i = 0; i < 3; i++)
    routeMissionProgress(state, {
      type: 'charge',
      stationId,
      seconds: 1,
      energyRestored: i === 0 ? energyRestored : 0,
    });
}

test('twelve real arrivals pay only on the first, fourth and ninth qualifying missions', () => {
  let state = tour();
  const wallet = createMetaProgress();
  for (let road = 0; road < 12; road++) {
    if (road) {
      const node = getJourneyChoices(road, state.seed).find(
        (item) => item.kind === 'ev',
      );
      nextRoute(state, node.routeOption, node.nodeId);
      state = changeRouteBeforeStart(state, node.routeOption, {
        journeyNodeId: node.nodeId,
      });
    }
    charge(state);
    assert.equal(awardRoadPoints(wallet, state), 0);
    arrive(state);
    assert.equal(roadPointProgress(state).mastered, road + 1);
    assert.equal(
      awardRoadPoints(wallet, state),
      [0, 3, 8].includes(road) ? 1 : 0,
    );
    assert.equal(awardRoadPoints(wallet, state), 0);
    if (road === 3) {
      state = restoreNightfallSave(exportNightfallSave(state));
      assert.equal(
        awardRoadPoints(createMetaProgress(JSON.stringify(wallet)), state),
        0,
      );
    }
  }
  assert.equal(state.campaignComplete, true);
  assert.equal(wallet.completionPoints, 3);
});

test('a full tour without qualifying missions earns no GP in either game mode', () => {
  for (const mode of ['story', 'survival']) {
    const state = tour({ mode }),
      wallet = createMetaProgress();
    for (let road = 0; road < 12; road++) {
      if (road) nextRoute(state, 'scenic');
      arrive(state);
      assert.equal(awardRoadPoints(wallet, state), 0);
    }
    assert.equal(state.campaignComplete, true);
    assert.equal(wallet.completionPoints, 0);
    if (mode === 'story')
      assert.equal(
        awardRoadPoints(wallet, restoreCampaignSave(exportCampaignSave(state))),
        0,
      );
  }
});

test('one real recharge banks a spendable point even if the next road is lost', () => {
  const state = tour(),
    wallet = createMetaProgress();
  state.distance = state._stations[0] - 60;
  state.energy = state.energyCapacity * 0.4;
  update(state, {}, 1 / 60);
  update(state, { charge: true }, 2.1);
  assert.ok(getRouteMission(state).mastered);
  arrive(state);
  assert.equal(awardRoadPoints(wallet, state), 1);
  const checkpoint = exportNightfallSave(state);
  nextRoute(state);
  state.integrity = 0;
  update(state, {}, 1 / 60);
  assert.equal(state.status, 'lost');
  assert.equal(awardRoadPoints(wallet, state), 0);
  const next = tour({ runId: 'tour-b' });
  assert.equal(buyStartingUpgrade(next, wallet, 'battery'), true);
  assert.equal(wallet.completionPoints, 0);
  assert.equal(
    awardRoadPoints(
      createMetaProgress(JSON.stringify(wallet)),
      restoreNightfallSave(checkpoint),
    ),
    0,
  );
  const another = tour({ runId: 'tour-c' });
  equipStartingCar(another, wallet, another.garage.equipped);
  assert.equal(another.energyCapacity, 130);
  charge(another);
  another.energy = 20;
  arrive(another);
  assert.equal(awardRoadPoints(wallet, another), 1);
});

test('ordinary EV rewards pay coins even when the harder charging condition is missed', () => {
  for (const scenario of ['full battery', 'second charger', 'low reserve']) {
    const state = tour(),
      wallet = createMetaProgress();
    charge(state, 1, scenario === 'full battery' ? 0 : 40);
    if (scenario === 'second charger') charge(state, 2);
    if (scenario === 'low reserve') state.energy = state.energyCapacity * 0.19;
    arrive(state);
    assert.equal(state.lastRouteReward.reward, 80);
    assert.equal(awardRoadPoints(wallet, state), 0);
  }
});

test('street challenges scale to the generated crowd and still require the route combo', () => {
  for (const [road, target] of [
    [0, 14],
    [4, 15],
    [8, 16],
  ]) {
    const node = getJourneyChoices(road, 175).find(
      (item) => item.kind === 'event',
    );
    for (const combo of [1, 4]) {
      const state = tour({ routeIndex: road, journeyNodeId: node.nodeId });
      state._encounterPlan = Array.from({ length: 20 }, (_, i) => ({
        type: 'salaryman',
        distance: 100 + i * 24,
      }));
      for (let i = 1; i <= target; i++) {
        routeMissionProgress(state, { type: 'convert', entityId: i, combo });
        assert.equal(
          getRouteMission(state).mastered,
          i === target && combo === 4,
        );
      }
    }
  }
});

test('a pit challenge requires a rush, two different jumps and zero damage', () => {
  const node = getJourneyChoices(0, 175).find(
    (item) => item.kind === 'service',
  );
  const state = tour({ journeyNodeId: node.nodeId });
  for (const id of [1, 1])
    routeMissionProgress(state, { type: 'jump-clear', entityId: id });
  routeMissionProgress(state, { type: 'rush-start' });
  assert.equal(getRouteMission(state).mastered, false);
  routeMissionProgress(state, { type: 'jump-clear', entityId: 2 });
  assert.equal(getRouteMission(state).mastered, true);
  routeMissionProgress(state, { type: 'collision', entityId: 3 });
  assert.equal(getRouteMission(state).complete, true);
  assert.equal(getRouteMission(state).mastered, false);
});

test('old wallets keep their purchases and paid tours, old checkpoints start without retroactive GP', () => {
  const state = tour();
  charge(state);
  arrive(state);
  const wallet = createMetaProgress({
    completionPoints: 7,
    upgrades: { armor: 1 },
    creditedRunIds: [state.runId, state.runId],
  });
  assert.equal(awardRoadPoints(wallet, state), 0);
  assert.equal(wallet.completionPoints, 7);
  assert.equal(wallet.upgrades.armor, 1);
  const old = exportNightfallSave(state);
  delete old.checkpoint.runBuild.masteredLegs;
  const restored = restoreNightfallSave(old);
  assert.deepEqual(roadPointProgress(restored), {
    mastered: 0,
    points: 0,
    next: 1,
  });
  assert.equal(awardRoadPoints(createMetaProgress(), restored), 0);
});
