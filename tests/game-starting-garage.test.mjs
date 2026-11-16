import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMetaProgress,
  exportMetaProgress,
  restoreMetaProgress,
  canUseGarage,
  unlockCar,
  equipStartingCar,
  buyStartingUpgrade,
  customizeStartingCar,
  awardCompletion,
} from '../public/game/src/garage.js';
import {
  createState,
  update,
  chooseStartingWeapon,
  beginCampaign,
  changeRouteBeforeStart,
  exportNightfallSave,
  restoreNightfallSave,
  exportCampaignSave,
  restoreCampaignSave,
  retryRoute,
} from '../public/game/src/simulation.js';
import {
  buyRunMod,
  removeStartingRunMod,
  getBuildModifiers,
} from '../public/game/src/run-build.js';
import {
  survivalOffers,
  chooseSurvivalUpgrade,
  SURVIVAL_UPGRADES,
  SURVIVAL_MAX_LEVEL,
  survivalXpCost,
} from '../public/game/src/survival.js';
import { createSaveStore } from '../public/game/src/save-store.js';

const fresh = () =>
  createState({ mode: 'survival', survivalDay: '2026-11-15' });
const purchases = [
  (state, meta) => unlockCar(meta, 'spark-k', state),
  (state, meta) => chooseStartingWeapon(state, 'flash', meta),
  (state, meta) => chooseStartingWeapon(state, 'heart', meta),
  (state, meta) => buyStartingUpgrade(state, meta, 'battery'),
  (state, meta) => customizeStartingCar(state, meta, { decal: 'stars' }),
  (state, meta) => buyRunMod(state, 'air-control', null, meta),
];

test('an unarmed loadout can depart and coins cannot unlock any starting weapon', () => {
  const state = fresh(),
    meta = createMetaProgress();
  state.money = 100000;
  assert.equal(state.garage.equipped, 'mix-175');
  assert.equal(state.survival.startingWeapon, null);
  assert.deepEqual(state.survival.upgrades, {});
  assert.deepEqual(meta.ownedStartingWeapons, []);
  for (const purchase of purchases) {
    const before = structuredClone({ state, meta });
    assert.equal(purchase(state, meta), false);
    assert.deepEqual({ state, meta }, before);
  }
  assert.equal(beginCampaign(state), true);
});

test('every unlock spends exactly one gyaru point, never road coins', () => {
  for (const purchase of purchases) {
    const state = fresh(),
      meta = createMetaProgress({ completionPoints: 1 });
    state.money = 70;
    assert.equal(purchase(state, meta), true);
    assert.equal(meta.completionPoints, 0);
    assert.equal(state.money, 70);
  }
});

test('starter purchases are permanent, repeat selection is free and missing ownership cannot bypass payment', () => {
  const state = fresh(),
    meta = createMetaProgress({ completionPoints: 1 });
  assert.equal(chooseStartingWeapon(state, 'flash'), false);
  assert.equal(chooseStartingWeapon(state, 'flash', meta), true);
  assert.equal(meta.completionPoints, 0);
  assert.equal(chooseStartingWeapon(state, 'heart', meta), false);
  assert.equal(chooseStartingWeapon(state, null, meta), true);
  assert.equal(chooseStartingWeapon(state, 'flash', meta), true);
  const saved = exportMetaProgress(meta),
    next = fresh();
  assert.equal(chooseStartingWeapon(next, 'flash', saved), true);
  assert.equal(saved.completionPoints, 0);
  assert.equal(next.survival.startingWeapon, 'flash');
  assert.deepEqual(next.survival.upgrades, { flash: 1 });
});

test('all garage actions stay locked after departure, a reload and a first-road retry', () => {
  const original = fresh();
  beginCampaign(original);
  const restored = restoreNightfallSave(exportNightfallSave(original));
  const story = createState();
  beginCampaign(story);
  story.status = 'lost';
  retryRoute(story);
  const retry = restoreCampaignSave(exportCampaignSave(story));
  for (const state of [original, restored, retry]) {
    assert.equal(canUseGarage(state), false);
    const meta = createMetaProgress({ completionPoints: 100 });
    const before = structuredClone({ state, meta });
    for (const purchase of purchases)
      assert.equal(purchase(state, meta), false);
    assert.equal(equipStartingCar(state, meta, 'mix-175'), false);
    assert.equal(removeStartingRunMod(state, 'air-control'), false);
    assert.deepEqual({ state, meta }, before);
  }
});

test('purchased hardware and selected modules survive car switching, destination changes and reloads', () => {
  const state = fresh(),
    meta = createMetaProgress({ completionPoints: 10 });
  assert.equal(buyStartingUpgrade(state, meta, 'battery'), true);
  assert.equal(buyRunMod(state, 'air-control', null, meta), true);
  assert.equal(unlockCar(meta, 'spark-k', state), true);
  assert.equal(equipStartingCar(state, meta, 'spark-k'), true);
  assert.equal(state.energyCapacity, 175);
  assert.equal(getBuildModifiers(state).descentMultiplier, 0.65);
  changeRouteBeforeStart(state, 'express');
  const resumed = restoreNightfallSave(exportNightfallSave(state));
  assert.equal(resumed.energyCapacity, 175);
  assert.equal(resumed.garage.equipped, 'spark-k');
  assert.deepEqual(resumed.runBuild.mods, ['air-control']);
  assert.equal(getBuildModifiers(resumed).descentMultiplier, 0.65);
  const next = fresh();
  equipStartingCar(next, exportMetaProgress(meta), 'mix-175');
  assert.equal(next.energyCapacity, 130);
  assert.deepEqual(next.runBuild.mods, []);
  assert.equal(buyRunMod(next, 'air-control', null, meta), true);
  assert.equal(removeStartingRunMod(next, 'air-control'), true);
  assert.equal(getBuildModifiers(next).descentMultiplier, 1);
  assert.equal(meta.completionPoints, 7);
});

test('storage round trips preserve new unlocks, reject unknown IDs and migrate old progression', () => {
  const memory = new Map(),
    saves = createSaveStore({
      getItem: (key) => memory.get(key),
      setItem: (key, value) => memory.set(key, value),
    });
  const state = fresh(),
    meta = createMetaProgress({ completionPoints: 10 });
  chooseStartingWeapon(state, 'cd', meta);
  buyStartingUpgrade(state, meta, 'evRange');
  buyRunMod(state, 'charge-shield', null, meta);
  assert.equal(saves.saveMeta(meta), true);
  assert.equal(saves.saveNightfall(state).persisted, true);
  assert.deepEqual(saves.loadMeta(), meta);
  assert.deepEqual(saves.loadNightfall().upgrades, state.upgrades);
  assert.equal(saves.loadNightfall().survival.startingWeapon, 'cd');
  const old = restoreMetaProgress({
    version: 1,
    completionPoints: 4,
    upgrades: { battery: 3 },
    ownedCars: ['spark-k'],
  });
  assert.equal(old.upgrades.battery, 3);
  assert.equal(old.completionPoints, 4);
  assert.deepEqual(old.ownedStartingWeapons, []);
  const bad = createMetaProgress({
    ownedStartingWeapons: ['unknown', 'cd', 'cd'],
    ownedRunMods: ['unknown', 'heart-recycle'],
  });
  assert.deepEqual(bad.ownedStartingWeapons, ['cd']);
  assert.deepEqual(bad.ownedRunMods, []);
});

test('only a completed tour earns three points, once per run', () => {
  const meta = createMetaProgress(),
    state = fresh();
  assert.equal(awardCompletion(meta, state), 0);
  state.status = 'lost';
  assert.equal(awardCompletion(meta, state), 0);
  Object.assign(state, {
    status: 'won',
    campaignComplete: true,
    campaignStarted: true,
    routeIndex: 11,
    stagesCompleted: 12,
    distance: state.routeLength,
  });
  assert.equal(awardCompletion(meta, state), 3);
  assert.equal(awardCompletion(meta, state), 0);
  assert.equal(
    awardCompletion(createMetaProgress(JSON.stringify(meta)), state),
    0,
  );
  assert.equal(meta.completionPoints, 3);
});

test('an unarmed run earns its first weapon from precise dodges without free starters or GP', () => {
  const state = fresh(),
    meta = createMetaProgress();
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  beginCampaign(state);
  for (let i = 0; i < 4; i++) {
    state.altitude = 30;
    state.altitudeVelocity = 0;
    state.entities = [
      { id: 900 + i, type: 'pothole', distance: state.distance + 0.1 },
    ];
    update(state, {}, 0.02);
  }
  assert.equal(state.projectiles.length, 0);
  assert.deepEqual(state.survival.upgrades, {});
  assert.equal(state.survival.xp, 20);
  assert.equal(state.status, 'draft');
  const weapon = survivalOffers(state).find((item) => item.kind === 'weapon');
  assert.ok(weapon);
  assert.equal(chooseSurvivalUpgrade(state, weapon.id), true);
  assert.equal(state.survival.upgrades[weapon.id], 1);
  assert.equal(state.survival.startingWeapon, null);
  assert.equal(meta.completionPoints, 0);
  assert.deepEqual(meta.ownedStartingWeapons, []);
  state.distance = state.elapsed = 0;
  const restored = restoreNightfallSave(exportNightfallSave(state));
  assert.ok(restored);
  assert.equal(restored.survival.level, 1);
  assert.equal(restored.survival.upgrades[weapon.id], 1);
  assert.equal(restored.survival.startingWeapon, null);
});

test('unarmed runs can fill every weapon and support level without losing the final upgrade', () => {
  const state = fresh();
  while (state.survival.level < SURVIVAL_MAX_LEVEL) {
    state.survival.xp = survivalXpCost(state.survival.level);
    state.status = 'draft';
    const offer = survivalOffers(state)[0];
    assert.ok(offer);
    assert.equal(chooseSurvivalUpgrade(state, offer.id), true);
  }
  for (const item of SURVIVAL_UPGRADES)
    assert.equal(state.survival.upgrades[item.id], item.maxLevel);
  assert.equal(state.survival.level, 78);
  const restored = restoreNightfallSave(exportNightfallSave(state));
  assert.ok(restored);
  assert.deepEqual(restored.survival.upgrades, state.survival.upgrades);
  assert.equal(restored.survival.level, 78);
});
