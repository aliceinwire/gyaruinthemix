import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  chooseStartingWeapon,
  update,
  availableCarUpgrades,
  buyUpgrade,
  exportNightfallSave,
  restoreNightfallSave,
  campaignEnvironment,
} from '../public/game-test/src/simulation.js';
import {
  survivalOffers,
  survivalXpCost,
  survivalWeaponStats,
  survivalResult,
  createSurvivalRecords,
  normalizeSurvivalRecords,
  SURVIVAL_RECORD_KEY,
  applySurvivalModifiers,
  SURVIVAL_VERSION,
  SURVIVAL_STARTERS,
} from '../public/game-test/src/survival.js';
import {
  normalizeRunBuild,
  getBuildModifiers,
  getBuildOffers,
} from '../public/game-test/src/run-build.js';
import {
  createMetaProgress,
  equipStartingCar,
} from '../public/game-test/src/garage.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';
function quiet(weapon = 'heart') {
  const state = createState({
    mode: 'survival',
    startingWeapon: weapon,
    seed: 175,
    survivalDay: '2026-10-21',
  });
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  return state;
}
function actor(state, id, distance, hp = 1, extra = {}) {
  const target = {
    id,
    type: 'salaryman',
    distance: state.distance + distance,
    hp,
    resolved: false,
    ...extra,
  };
  state.entities.push(target);
  return target;
}
function install(state, ids) {
  state.runBuild = normalizeRunBuild({ mods: ids, acquiredIds: ids }, state);
  return state;
}

test('heart range is bounded and workshop piercing adds a real extra hit', () => {
  const ranged = quiet(),
    far = actor(ranged, 1, 350);
  update(ranged, {}, 1.4);
  assert.equal(far.hp, 1);
  assert.equal(far.converted, undefined);
  assert.ok(
    ranged.projectiles.every(
      (shot) =>
        shot.distance - ranged.distance <=
        survivalWeaponStats(ranged, 'heart').range,
    ),
  );
  for (const purchased of [false, true]) {
    const state = quiet();
    if (purchased) install(state, ['heart-pierce']);
    actor(state, 2, 35);
    const second = actor(state, 3, 55);
    update(state, {}, 0.45);
    assert.equal(Boolean(second.converted), purchased);
  }
});

test('area weapons hit at their shared cadence and stay within target and reach budgets', () => {
  for (const id of ['flash', 'vinyl', 'bass']) {
    const state = quiet(id),
      spec = survivalWeaponStats(state, id);
    const targets = Array.from({ length: spec.targets + 2 }, (_, index) =>
      actor(state, 20 + index, spec.range - 2 - index * 0.1, 20),
    );
    const far = actor(state, 90, spec.range + 20, 20);
    update(state, {}, 0.01);
    assert.equal(
      targets.filter((target) => target.hp < 20).length,
      spec.targets,
    );
    assert.equal(far.hp, 20);
    assert.ok(Math.abs(state.survival[`${id}Clock`] - spec.interval) < 0.02);
  }
});

test('deco phone links a bounded nearby group and preserves all existing starter choices', () => {
  assert.deepEqual(
    SURVIVAL_STARTERS.map((item) => item.id),
    ['heart', 'flash', 'vinyl', 'bass', 'phone'],
  );
  const state = quiet('flash');
  state.survival.upgrades = { phone: 1 };
  const first = actor(state, 101, 60),
    second = actor(state, 102, 90),
    far = actor(state, 103, 200);
  update(state, {}, 0.01);
  assert.equal(first.converted, true);
  assert.equal(second.converted, true);
  assert.equal(far.hp, 1);
  const event = state.events.find(
    (item) => item.type === 'survival-attack' && item.kind === 'phone',
  );
  assert.deepEqual(event.targetDistances, [60, 90]);
});

test('MD echo repeats once on the original living recipient without recursive repeats', () => {
  const state = quiet('flash');
  state.survival.upgrades.md = 1;
  const first = actor(state, 110, 60, 5),
    second = actor(state, 111, 65, 5);
  update(state, {}, 0.01);
  assert.equal(first.hp, 4);
  assert.equal(second.hp, 4);
  state.survival.flashClock = 99;
  state.survival.echoClock = 0;
  update(state, {}, 0.4);
  assert.equal(first.hp, 3.5);
  assert.equal(second.hp, 4);
  assert.equal(state.survival.echoPending, null);
  assert.equal(
    state.events.filter(
      (item) => item.type === 'survival-attack' && item.kind === 'echo',
    ).length,
    1,
  );
});

test('an echo whose original recipient has left never jumps to someone else', () => {
  const state = quiet('flash');
  state.survival.upgrades.md = 3;
  const first = actor(state, 120, 60, 5),
    second = actor(state, 121, 65, 5);
  update(state, {}, 0.01);
  first.converted = true;
  state.survival.flashClock = 99;
  update(state, {}, 0.4);
  assert.equal(second.hp, 4);
  assert.equal(state.survival.echoPending, null);
  assert.equal(
    state.events.some((item) => item.kind === 'echo'),
    false,
  );
});

test('a full-charge bonus can power a non-heart attack and is consumed once', () => {
  const state = quiet('flash');
  state.buildRuntime.chargedShot = 1;
  const first = actor(state, 130, 45, 2),
    second = actor(state, 131, 55, 2);
  update(state, {}, 0.01);
  assert.equal(first.converted, true);
  assert.equal(second.hp, 1);
  assert.equal(state.buildRuntime.chargedShot, 0);
  assert.equal(state._nextProjectileId, 1);
});

test('parts and support choices cannot sell inactive heart-only effects', () => {
  const state = quiet('flash');
  state.status = 'won';
  state.campaignStarted = true;
  state.money = 10000;
  assert.equal(
    availableCarUpgrades(state).some((item) =>
      ['hearts', 'heartReach'].includes(item.id),
    ),
    false,
  );
  assert.equal(buyUpgrade(state, 'hearts'), false);
  assert.equal(
    getBuildOffers(state).some((item) => item.family === 'relay'),
    false,
  );
  state.survival.xp = survivalXpCost(0);
  for (let seed = 1; seed <= 40; seed++) {
    state.seed = seed;
    assert.equal(
      survivalOffers(state).some((item) => item.id === 'relay'),
      false,
    );
    for (const offer of survivalOffers(state).filter(
      (item) => item.kind === 'weapon',
    )) {
      assert.ok(offer.weaponStats.range > 0);
      assert.ok(offer.synergy.includes(offer.weaponStats.interval.toFixed(2)));
    }
  }
  state.survival.upgrades.heart = 1;
  assert.ok(availableCarUpgrades(state).some((item) => item.id === 'hearts'));
  assert.ok(getBuildOffers(state).some((item) => item.family === 'relay'));
});

test('survival support stacking respects advertised recovery caps', () => {
  const state = install(quiet(), ['air-control', 'rush-pulse', 'combo-flight']);
  state.survival.upgrades.glide = 3;
  state.buildModifiers = getBuildModifiers(state);
  applySurvivalModifiers(state);
  assert.equal(state.buildModifiers.comboFlight, 8);
  state.buildModifiers.conversionEnergy = 6;
  state.survival.upgrades.battery = 3;
  applySurvivalModifiers(state);
  assert.equal(state.buildModifiers.conversionEnergy, 6);
});

test('legacy completion upgrades stay in story saves while new scored tours start stock', () => {
  const meta = createMetaProgress();
  meta.upgrades = { battery: 3, hearts: 3, charger: 3, armor: 3 };
  const story = createState(),
    survival = quiet();
  equipStartingCar(story, meta, 'mix-175');
  equipStartingCar(survival, meta, 'mix-175');
  assert.equal(story.integrityCapacity, 175);
  assert.equal(story.energyCapacity, 190);
  assert.equal(survival.integrityCapacity, 100);
  assert.equal(survival.energyCapacity, 100);
  assert.equal(survival.shotInterval, 0.36);
  assert.deepEqual(meta.upgrades, {
    battery: 3,
    hearts: 3,
    charger: 3,
    armor: 3,
  });
});

test('valid version-two map saves migrate without losing earned equipment or tour identity', () => {
  const state = quiet('bass'),
    saved = exportNightfallSave(state);
  saved.survival.version = 2;
  const restored = restoreNightfallSave(saved);
  assert.equal(restored.survival.version, SURVIVAL_VERSION);
  assert.deepEqual(restored.survival.upgrades, { bass: 1 });
  assert.equal(restored.seed, state.seed);
  assert.equal(restored.runId, state.runId);
  assert.equal(restored.survival.day, state.survival.day);
});

test('one tour keeps its season while road weather remains varied and deterministic', () => {
  for (const seed of [1, 42, 175, 2026]) {
    const climates = Array.from({ length: 12 }, (_, road) =>
      campaignEnvironment(seed, road),
    );
    assert.equal(new Set(climates.map((item) => item.season)).size, 1);
    assert.ok(new Set(climates.map((item) => item.weather)).size > 1);
    assert.deepEqual(
      climates,
      Array.from({ length: 12 }, (_, road) => campaignEnvironment(seed, road)),
    );
  }
});

test('opening-road starter yields remain comparable across seeds and route branches', () => {
  const yields = [];
  for (const { id } of SURVIVAL_STARTERS) {
    let invitations = 0;
    for (const seed of [175, 42, 2026])
      for (const node of getJourneyChoices(0, seed)) {
        const state = createState({
          mode: 'survival',
          seed,
          startingWeapon: id,
          journeyNodeId: node.nodeId,
        });
        for (let tick = 0; tick < 10000 && state.status === 'playing'; tick++) {
          // Compare only stock weapons, with the same driving policy and no drafts.
          state.survival.xp = 0;
          const hazard = state.entities.some(
            (actor) =>
              !actor.cleared &&
              !actor.resolved &&
              !actor.converted &&
              ['salaryman', 'barrier', 'cone', 'pothole'].includes(
                actor.type,
              ) &&
              actor.distance > state.distance - 1 &&
              actor.distance - state.distance < 45,
          );
          const station = state.entities.some(
            (actor) =>
              actor.type === 'ev' &&
              Math.abs(actor.distance - state.distance) <= actor.radius,
          );
          update(state, { boost: hazard, charge: station && !hazard }, 1 / 30);
          if (state.status === 'draft') state.status = 'playing';
        }
        assert.equal(state.status, 'won', `${id}: ${seed}/${node.kind}`);
        invitations += state.survival.kills;
      }
    yields.push(invitations / 9);
  }
  // A broad guard against one starter eclipsing the others, not equal-damage tuning.
  assert.ok(Math.min(...yields) > 12, JSON.stringify(yields));
  assert.ok(
    Math.max(...yields) / Math.min(...yields) < 1.25,
    JSON.stringify(yields),
  );
});

test('version-two phone and MD checkpoints retain equipment while discarding pending attacks', () => {
  const state = quiet('phone');
  state.survival.upgrades = { phone: 3, md: 2 };
  state.survival.level = 4;
  const saved = exportNightfallSave(state);
  saved.survival.version = 2;
  saved.survival.mdClock = 4;
  saved.survival.repeat = { kind: 'phone', delay: 0.1 };
  const restored = restoreNightfallSave(saved);
  assert.deepEqual(restored.survival.upgrades, { phone: 3, md: 2 });
  assert.deepEqual(restored.survival.evolutions, ['hotline']);
  assert.equal(restored.survival.echoPending, null);
  assert.equal(restored.survival.echoClock, 0);
  assert.equal(restored.runId, state.runId);
});

test('MD repeats still respect a guard that closes after the original hit', () => {
  const state = quiet('phone');
  state.survival.upgrades.md = 1;
  const target = actor(state, 150, 60, 5);
  update(state, {}, 0.01);
  assert.equal(target.hp, 4);
  assert.ok(state.survival.echoPending);
  target.shielded = true;
  state.survival.phoneClock = 99;
  update(state, {}, 0.4);
  assert.equal(target.hp, 4);
  assert.equal(state.survival.echoPending, null);
  assert.ok(state.survival.echoClock > 0);
});

test('continued older-rules tours retain progress through reload without entering current records', () => {
  const memory = new Map();
  const records = createSurvivalRecords({
    getItem: (key) => memory.get(key),
    setItem: (key, value) => memory.set(key, value),
  });
  const current = quiet('phone');
  current.runId = 'current-rules';
  assert.equal(current.survival.recordEligible, true);
  assert.equal(
    restoreNightfallSave(exportNightfallSave(current)).survival.recordEligible,
    true,
  );
  current.status = 'lost';
  current.score = 100;
  const recorded = records.save(current);
  assert.equal(recorded.eligible, true);
  assert.equal(recorded.persisted, true);
  assert.equal(recorded.best, true);
  const previousRecords = memory.get(SURVIVAL_RECORD_KEY);

  const legacy = quiet('bass');
  legacy.runId = 'older-rules';
  legacy.score = 50000;
  legacy.money = 321;
  legacy.survival.upgrades = { bass: 3, hype: 2 };
  legacy.survival.level = 4;
  const old = exportNightfallSave(legacy);
  old.survival.version = 2;
  const migrated = restoreNightfallSave(old);
  assert.equal(migrated.survival.recordEligible, false);
  assert.equal(migrated.score, legacy.score);
  assert.equal(migrated.money, legacy.money);
  assert.deepEqual(migrated.survival.upgrades, legacy.survival.upgrades);
  assert.equal(migrated.runId, legacy.runId);
  assert.equal(migrated.seed, legacy.seed);

  const resaved = exportNightfallSave(migrated);
  assert.equal(resaved.survival.version, SURVIVAL_VERSION);
  assert.equal(resaved.survival.recordEligible, false);
  const reloaded = restoreNightfallSave(JSON.stringify(resaved));
  assert.equal(reloaded.survival.recordEligible, false);
  assert.equal(reloaded.score, legacy.score);
  update(reloaded, {}, 1 / 60);
  assert.ok(reloaded.distance > 0, 'the continued run remains playable');
  reloaded.status = 'lost';
  const displayed = survivalResult(reloaded);
  assert.equal(displayed.recordEligible, false);
  assert.equal(displayed.score, Math.floor(reloaded.score));
  assert.deepEqual(records.save(reloaded), {
    persisted: false,
    best: false,
    eligible: false,
    records: records.read(),
  });
  assert.equal(memory.get(SURVIVAL_RECORD_KEY), previousRecords);
  assert.equal(records.best(current.survival.day).id, current.runId);
  assert.equal(records.best(current.survival.day).score, 100);
  assert.deepEqual(
    normalizeSurvivalRecords([displayed, ...records.read()]),
    records.read(),
  );
});

test('changing a migrated garage starter cannot restore competitive eligibility', () => {
  const saved = exportNightfallSave(quiet('heart'));
  saved.survival.version = 2;
  const migrated = restoreNightfallSave(saved);
  assert.equal(migrated.survival.recordEligible, false);
  assert.equal(chooseStartingWeapon(migrated, 'phone'), true);
  assert.deepEqual(migrated.survival.upgrades, { phone: 1 });
  assert.equal(migrated.survival.recordEligible, false);
  assert.equal(
    restoreNightfallSave(exportNightfallSave(migrated)).survival.recordEligible,
    false,
  );
});
