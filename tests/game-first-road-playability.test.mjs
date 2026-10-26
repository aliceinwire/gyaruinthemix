import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  chooseStartingWeapon,
  changeRouteBeforeStart,
  exportNightfallSave,
  restoreNightfallSave,
  nextRoute,
} from '../public/game/src/simulation.js';
import {
  setSurvivalAssistance,
  createSurvivalRecords,
  normalizeSurvivalRecords,
  normalizeSurvivalSave,
  survivalResult,
  survivalOffers,
  survivalXpCost,
  chooseSurvivalUpgrade,
  survivalWeaponStats,
  SURVIVAL_STARTERS,
  SURVIVAL_EVOLUTIONS,
} from '../public/game/src/survival.js';
import {
  createDrivingLessons,
  updateDrivingLessons,
  getDrivingCue,
} from '../public/game/src/driving-lessons.js';
import { getRoadCue } from '../public/game/src/road-feedback.js';

const fresh = (options = {}) =>
  createState({
    mode: 'survival',
    seed: 175,
    runId: 'playability-175',
    survivalDay: '2026-10-24',
    season: 'summer',
    weather: 'sunny',
    ...options,
  });
function quiet(options) {
  const state = fresh(options);
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  return state;
}
const hole = (distance) => ({
  id: 900,
  type: 'pothole',
  distance,
  resolved: false,
});
function finishRoad(state) {
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  state.distance = state.routeLength - 0.01;
  update(state, {}, 0.01);
  assert.equal(state.status, 'won');
}

test('assistance reduces actual collision damage across roads and armor levels without changing encounters', () => {
  for (const routeIndex of [0, 6, 11])
    for (const armor of [0, 3]) {
      const normal = quiet({ routeIndex }),
        assisted = quiet({ routeIndex });
      assert.deepEqual(normal._encounterPlan, assisted._encounterPlan);
      setSurvivalAssistance(assisted, true);
      for (const state of [normal, assisted]) {
        state.survival.upgrades.armor = armor;
        state.entities = [hole(20)];
        update(state, {}, 0.1);
      }
      const rawDamage = 19 * (1.3 + routeIndex * 0.08) * (1 - armor * 0.12);
      assert.equal(normal.lastHit.damage, Math.round(rawDamage));
      assert.equal(assisted.lastHit.damage, Math.round(rawDamage * 0.55));
      assert.ok(assisted.integrity > normal.integrity);
      assert.equal(assisted.survival.assisted, true);
      assert.equal(normal.survival.assisted, false);
    }
});

test('assisted classification survives turning help off, changing starters, checkpoints and the next road', () => {
  const state = fresh();
  setSurvivalAssistance(state, true);
  setSurvivalAssistance(state, false);
  assert.equal(state.assistMode, false);
  assert.equal(chooseStartingWeapon(state, 'cassette'), true);
  changeRouteBeforeStart(state, 'express');
  const restored = restoreNightfallSave(
    JSON.stringify(exportNightfallSave(state)),
  );
  assert.ok(restored);
  assert.equal(restored.survival.assisted, true);
  setSurvivalAssistance(restored, false);
  finishRoad(restored);
  const resumed = restoreNightfallSave(exportNightfallSave(restored));
  assert.equal(resumed.survival.assisted, true);
  const next = nextRoute(resumed);
  assert.equal(next.survival.assisted, true);
  next.status = 'lost';
  assert.equal(survivalResult(next).assisted, true);
});

test('finished runs keep their category and existing checkpoints default to normal', () => {
  for (const terminal of [{ status: 'lost' }, { campaignComplete: true }]) {
    const state = Object.assign(fresh(), terminal);
    setSurvivalAssistance(state, true);
    assert.equal(survivalResult(state).assisted, false);
  }
  const legacy = exportNightfallSave(fresh());
  delete legacy.survival.assisted;
  assert.equal(restoreNightfallSave(legacy).survival.assisted, false);
  assert.equal(
    normalizeSurvivalSave({ ...legacy.survival, assisted: 'true' }),
    null,
  );
  const state = fresh();
  setSurvivalAssistance(state, 'true');
  assert.equal(state.assistMode, false);
  assert.equal(state.survival.assisted, false);
});

test('normal and assisted personal bests remain separate and each retains its five daily records', () => {
  const memory = new Map();
  const records = createSurvivalRecords({
    getItem: (key) => memory.get(key),
    setItem: (key, value) => memory.set(key, value),
  });
  for (const assisted of [false, true])
    for (let i = 1; i <= 7; i++) {
      const state = fresh({ runId: `records-${assisted}-${i}` });
      setSurvivalAssistance(state, assisted);
      state.status = 'lost';
      state.score = i * (assisted ? 1000 : 10);
      assert.equal(records.save(state).best, true);
      assert.equal(records.save(state).best, false);
    }
  assert.equal(records.best('2026-10-24').score, 70);
  assert.equal(records.best('2026-10-24', true).score, 7000);
  assert.equal(records.read().length, 10);
  for (const assisted of [false, true])
    assert.equal(
      records.read().filter((row) => row.assisted === assisted).length,
      5,
    );
  const legacy = { ...records.best('2026-10-24') };
  delete legacy.assisted;
  assert.equal(normalizeSurvivalRecords([legacy])[0].assisted, false);
  assert.deepEqual(
    normalizeSurvivalRecords([{ ...legacy, assisted: 'false' }]),
    [],
  );
});

test('assisted records do not evict normal history and denied storage preserves a reviewable result', () => {
  const state = fresh();
  state.status = 'lost';
  const row = survivalResult(state),
    entries = [];
  for (const assisted of [false, true])
    for (let i = 0; i < 100; i++)
      entries.push({
        ...row,
        id: `history-${assisted}-${i}`,
        assisted,
        day: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      });
  const normalized = normalizeSurvivalRecords(entries);
  assert.equal(normalized.length, 180);
  assert.equal(normalized.filter((record) => !record.assisted).length, 90);
  const denied = createSurvivalRecords({
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('full');
    },
  });
  state.survival.assisted = true;
  const result = denied.save(state);
  assert.equal(result.persisted, false);
  assert.equal(result.records[0].assisted, true);
});

test('first-road hints teach successful actions and preserve urgent warnings', () => {
  const state = quiet(),
    lessons = createDrivingLessons();
  const before = structuredClone(state);
  assert.equal(
    getDrivingCue(state, lessons).label,
    '運転と攻撃は自動。まずは道を見よ。',
  );
  assert.deepEqual(state, before);
  state.elapsed = 5;
  state.entities = [hole(180)];
  assert.equal(
    getDrivingCue(state, lessons).label,
    '飛ぶを長押しで回避。越えたら離して着地。',
  );
  state.entities = [hole(20)];
  assert.deepEqual(getDrivingCue(state, lessons), getRoadCue(state));
  state.entities = [hole(180)];
  state.events = [{ type: 'boost' }];
  updateDrivingLessons(lessons, state, 0.1);
  assert.equal(lessons.boost, false);
  state.events = [{ type: 'jump-clear' }];
  updateDrivingLessons(lessons, state, 0.1);
  assert.equal(lessons.boost, true);
  assert.deepEqual(getDrivingCue(state, lessons), getRoadCue(state));
  state.entities = [];
  state.atStation = true;
  assert.equal(
    getDrivingCue(state, lessons).label,
    '飛ぶを離して着地。充電を長押しで回復。',
  );
  state.charging = true;
  updateDrivingLessons(lessons, state, 0.3);
  assert.equal(lessons.charge, false);
  updateDrivingLessons(lessons, state, 0.3);
  assert.equal(lessons.charge, true);
  assert.deepEqual(getDrivingCue(state, lessons), getRoadCue(state));
});

test('rush practice only appears with safe space, enough battery, grounded car and a ready rush', () => {
  const state = quiet(),
    lessons = createDrivingLessons();
  state.elapsed = 8;
  lessons.boost = true;
  assert.equal(getDrivingCue(state, lessons).action, 'rush');
  for (const overrides of [
    { energy: 50 },
    { altitude: 15 },
    { rushCooldown: 1 },
    { _stations: [state.distance + 100] },
    { routeIndex: 1 },
    { status: 'draft' },
  ]) {
    const blocked = { ...state, ...overrides };
    assert.deepEqual(getDrivingCue(blocked, lessons), getRoadCue(blocked));
  }
  state.rushing = true;
  updateDrivingLessons(lessons, state, 0.1);
  assert.equal(lessons.rush, true);
  assert.deepEqual(getDrivingCue(state, lessons), getRoadCue(state));
});

test('every weapon preview describes a real upgrade and shows recipe progress after the choice', () => {
  for (const weapon of SURVIVAL_STARTERS)
    for (let level = 1; level < 6; level++) {
      const state = fresh({ startingWeapon: weapon.id });
      const recipe = SURVIVAL_EVOLUTIONS.find(
        (item) => item.weapon === weapon.id,
      );
      state.survival.upgrades[weapon.id] = level;
      if (level === 5) state.survival.upgrades[recipe.support] = 2;
      state.survival.level =
        Object.values(state.survival.upgrades).reduce((sum, n) => sum + n, 0) -
        1;
      state.survival.xp = survivalXpCost(state.survival.level);
      state.survival.fever = 4;
      // Find a draw containing this weapon so every preview level is exercised.
      for (state.seed = 1; state.seed < 1000; state.seed++) {
        if (survivalOffers(state).some((item) => item.id === weapon.id)) break;
      }
      const offer = survivalOffers(state).find((item) => item.id === weapon.id);
      assert.ok(offer.role);
      assert.ok(offer.benefit);
      assert.equal(offer.evolution.nextWeaponLevel, level + 1);
      assert.equal(offer.evolution.nextSupportLevel, level === 5 ? 2 : 0);
      assert.equal(offer.evolutionReady, level === 5);
      state.status = 'draft';
      assert.equal(chooseSurvivalUpgrade(state, weapon.id), true);
      state.survival.fever = 0;
      assert.deepEqual(
        survivalWeaponStats(state, weapon.id),
        offer.weaponStats,
      );
    }
});
