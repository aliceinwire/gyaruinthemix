import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  exportNightfallSave,
  restoreNightfallSave,
  nextRoute,
} from '../public/game/src/simulation.js';
import {
  SURVIVAL_UPGRADES,
  SURVIVAL_WEAPONS,
  SURVIVAL_EVOLUTIONS,
  SURVIVAL_MAX_LEVEL,
  SURVIVAL_VERSION,
  survivalWeaponStats,
  survivalOffers,
  survivalXpCost,
  survivalStep,
  normalizeSurvivalSave,
  normalizeSurvivalRecords,
  survivalResult,
  openSurvivalDraft,
  chooseSurvivalUpgrade,
} from '../public/game/src/survival.js';

function quiet(weapon = 'cd') {
  const state = createState({
    mode: 'survival',
    startingWeapon: weapon,
    seed: 175,
    survivalDay: '2026-10-23',
  });
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  return state;
}
function actor(state, id, distance, hp = 10, extra = {}) {
  const target = { id, type: 'salaryman', distance, hp, ...extra };
  state.entities.push(target);
  return target;
}

test('all seven weapons gain something at each of six levels without lowering another stat', () => {
  assert.equal(SURVIVAL_WEAPONS.length, 7);
  assert.equal(SURVIVAL_MAX_LEVEL, 59);
  for (const item of SURVIVAL_WEAPONS) {
    assert.equal(item.maxLevel, 6);
    const state = quiet(item.id);
    let previous;
    for (let level = 1; level <= 6; level++) {
      state.survival.upgrades[item.id] = level;
      const stats = survivalWeaponStats(state, item.id);
      assert.equal(stats.level, level);
      if (previous) {
        const powers = [
          'damage',
          'range',
          'behind',
          'targets',
          'chainRange',
          'pulses',
        ];
        for (const key of powers)
          assert.ok(stats[key] >= previous[key], `${item.id}/${level}/${key}`);
        assert.ok(stats.interval <= previous.interval);
        assert.ok(
          stats.interval < previous.interval ||
            powers.some((key) => stats[key] > previous[key]),
          `${item.id}/${level}`,
        );
      }
      previous = stats;
    }
    state.survival.upgrades[item.id] = 7;
    assert.equal(survivalWeaponStats(state, item.id), null);
  }
  assert.ok(
    SURVIVAL_UPGRADES.filter((item) => item.kind === 'support').every(
      (item) => item.maxLevel === 3,
    ),
  );
});

test('CDs prioritize toughness, break distance ties deterministically, and skip closed guards', () => {
  const state = quiet();
  const close = actor(state, 1, 35, 1);
  const tough = actor(state, 2, 110, 8);
  const tied = actor(state, 3, 120, 8);
  const guard = actor(state, 4, 100, 20, { shielded: true });
  const far = actor(state, 5, 190, 30);
  update(state, {}, 0.01);
  assert.equal(tough.hp, 6);
  assert.equal(close.hp, 1);
  assert.equal(tied.hp, 8);
  assert.equal(guard.hp, 20);
  assert.equal(far.hp, 30);
  assert.deepEqual(
    state.events.find((event) => event.kind === 'cd').targetDistances,
    [110],
  );
  const hp = tough.hp;
  update(state, {}, 0.2);
  assert.equal(tough.hp, hp, 'Cooldown limits focused hits');
});

test('Prism CD pierces one guarded target without turning into a crowd attack', () => {
  const state = quiet();
  state.survival.upgrades = { cd: 6, armor: 2 };
  state.survival.evolutions = ['prism'];
  const first = actor(state, 11, 100, 20, { shielded: true });
  const second = actor(state, 12, 110, 20, { shielded: true });
  update(state, {}, 0.01);
  assert.equal(first.hp, 14);
  assert.equal(second.hp, 20);
});

test('cassette sweeps stay on the original road stretch and stop after their bounded repeat', () => {
  const state = quiet('cassette');
  state.distance = 100;
  const first = actor(state, 20, 140);
  const behind = actor(state, 21, 70);
  const far = actor(state, 22, 200);
  const hits = [];
  const strike = (target, damage, chain, bypass, source) => {
    target.hp -= damage;
    hits.push({ id: target.id, damage, source });
  };
  survivalStep(state, 0.01, strike);
  assert.equal(first.hp, 9);
  assert.equal(behind.hp, 9);
  assert.equal(far.hp, 10);
  assert.equal(state.survival.cassetteLoops.length, 1);
  state.distance = 200;
  state.survival.cassetteClock = 99;
  survivalStep(state, 0.29, strike);
  assert.equal(first.hp, 8.5);
  assert.equal(behind.hp, 8.5);
  assert.equal(
    far.hp,
    10,
    'The ribbon cannot move to a new target alongside the car',
  );
  assert.equal(state.survival.cassetteLoops.length, 0);
  survivalStep(state, 1, strike);
  assert.equal(hits.length, 4);
  assert.deepEqual(
    hits.slice(2).map((hit) => hit.source),
    ['tape', 'tape'],
  );
});

test('cassette repeats honor guards and cleared targets without spending charge or triggering MD', () => {
  const state = quiet('cassette');
  const first = actor(state, 30, 60);
  const second = actor(state, 31, 64);
  update(state, {}, 0.01);
  first.shielded = true;
  second.cleared = true;
  const newcomer = actor(state, 32, 63);
  state.survival.upgrades.md = 1;
  state.buildRuntime.chargedShot = 1;
  state.survival.cassetteClock = 99;
  update(state, {}, 0.3);
  assert.equal(first.hp, 9);
  assert.equal(second.hp, 9);
  assert.equal(newcomer.hp, 9.5);
  assert.equal(state.buildRuntime.chargedShot, 1);
  assert.equal(state.survival.echoPending, null);
  assert.equal(state.survival.cassetteLoops.length, 0);
});

test('new primary weapons can use MD and a full-charge bonus exactly once', () => {
  for (const id of ['cd', 'cassette']) {
    const state = quiet(id);
    state.survival.upgrades.md = 1;
    state.buildRuntime.chargedShot = 1;
    const first = actor(state, 40, 60);
    const damage = survivalWeaponStats(state, id).damage + 1;
    update(state, {}, 0.01);
    assert.equal(first.hp, 10 - damage, id);
    assert.equal(state.buildRuntime.chargedShot, 0);
    assert.equal(state.survival.echoPending.damage, damage * 0.5);
    assert.equal(state.survival.echoPending.targetId, first.id);
  }
});

test('Double deck repeats twice at half power and pause freezes both sweeps', () => {
  const state = quiet('cassette');
  state.survival.upgrades = { cassette: 6, glide: 2 };
  state.survival.evolutions = ['doubledeck'];
  const target = actor(state, 50, 88, 20);
  update(state, {}, 0.01);
  assert.equal(target.hp, 17);
  assert.equal(state.survival.cassetteLoops.length, 2);
  state.survival.cassetteClock = 99;
  state.survival.xp = survivalXpCost(0);
  openSurvivalDraft(state);
  const pending = structuredClone(state.survival.cassetteLoops);
  update(state, {}, 2);
  assert.deepEqual(state.survival.cassetteLoops, pending);
  state.status = 'playing';
  state.survival.xp = 0;
  update(state, {}, 0.6);
  assert.equal(target.hp, 14);
  assert.equal(state.survival.cassetteLoops.length, 0);
});

test('equipped weapons and recipe supports can appear or miss a seeded XP draft', () => {
  for (const item of SURVIVAL_WEAPONS) {
    const recipe = SURVIVAL_EVOLUTIONS.find(
      (entry) => entry.weapon === item.id,
    );
    const seen = new Set(),
      missed = new Set();
    for (let seed = 1; seed <= 100; seed++) {
      const state = quiet(item.id);
      state.seed = seed;
      for (let level = 1; level < 6; level++) {
        state.survival.upgrades = { [item.id]: level };
        state.survival.level = level - 1;
        state.survival.xp = survivalXpCost(state.survival.level);
        const offers = survivalOffers(state);
        assert.equal(new Set(offers.map((offer) => offer.id)).size, 3);
        for (const id of [item.id, recipe.support]) {
          if (offers.some((offer) => offer.id === id)) seen.add(id);
          else missed.add(id);
        }
        const weapon = offers.find((offer) => offer.id === item.id);
        if (weapon) assert.equal(weapon.effect, `Lv.${level + 1} / 6`);
      }
    }
    assert.deepEqual([...seen].sort(), [item.id, recipe.support].sort());
    assert.deepEqual([...missed].sort(), [...seen].sort());
  }
});

test('a shared support previews the ready recipe and can evolve both eligible weapons', () => {
  const state = quiet('cassette');
  state.survival.upgrades = Object.fromEntries(
    SURVIVAL_UPGRADES.map((item) => [item.id, item.maxLevel]),
  );
  state.survival.upgrades.glide = 1;
  state.survival.level =
    Object.values(state.survival.upgrades).reduce(
      (sum, level) => sum + level,
      0,
    ) - 1;
  state.survival.evolutions = SURVIVAL_EVOLUTIONS.filter(
    (recipe) => recipe.support !== 'glide',
  ).map((recipe) => recipe.id);
  state.survival.xp = survivalXpCost(state.survival.level);
  const offer = survivalOffers(state).find((item) => item.id === 'glide');
  assert.equal(offer.evolutionReady, true);
  openSurvivalDraft(state);
  chooseSurvivalUpgrade(state, 'glide');
  assert.ok(state.survival.evolutions.includes('encore'));
  assert.ok(state.survival.evolutions.includes('doubledeck'));
  assert.equal(
    state.events.filter((event) => event.type === 'evolution').length,
    2,
  );
});

test('current saves and score recaps retain level-six weapons; supports cannot exceed three', () => {
  const state = quiet('cassette');
  state.survival.upgrades = { cassette: 6, cd: 6, glide: 2, armor: 2 };
  state.survival.level = 15;
  state.survival.evolutions = ['prism', 'doubledeck'];
  const saved = exportNightfallSave(state);
  const restored = restoreNightfallSave(saved);
  assert.deepEqual(restored.survival.upgrades, state.survival.upgrades);
  assert.deepEqual(restored.survival.evolutions, state.survival.evolutions);
  for (const [id, value] of [
    ['cassette', 7],
    ['armor', 4],
  ]) {
    const corrupt = structuredClone(saved);
    corrupt.survival.upgrades[id] = value;
    corrupt.survival.level =
      Object.values(corrupt.survival.upgrades).reduce(
        (sum, level) => sum + level,
        0,
      ) - 1;
    assert.equal(restoreNightfallSave(corrupt), null);
  }
  state.status = 'lost';
  const [record] = normalizeSurvivalRecords([survivalResult(state)]);
  assert.equal(record.build.cd, 6);
  assert.equal(record.build.cassette, 6);
});

test('both old save versions map weapon power and preserve evolutions without entering new records', () => {
  for (const version of [2, 3])
    for (const oldLevel of [1, 2, 3]) {
      const state = quiet('phone');
      state.survival.upgrades = { phone: oldLevel, md: 2 };
      state.survival.level = oldLevel + 1;
      const saved = exportNightfallSave(state);
      saved.survival.version = version;
      const result = restoreNightfallSave(saved).survival;
      assert.equal(result.upgrades.phone, [0, 1, 3, 6][oldLevel]);
      assert.equal(result.upgrades.md, 2);
      assert.equal(result.level, result.upgrades.phone + 1);
      assert.deepEqual(result.evolutions, oldLevel === 3 ? ['hotline'] : []);
      assert.equal(result.recordEligible, false);
      assert.deepEqual(
        normalizeSurvivalSave(result),
        result,
        'Reloading cannot upgrade a migrated weapon twice',
      );
    }
});

test('pending cassette sweeps never carry into the next road or a saved checkpoint', () => {
  const state = quiet('cassette');
  actor(state, 60, 60);
  update(state, {}, 0.01);
  assert.equal(state.survival.cassetteLoops.length, 1);
  state.entities = [];
  state.distance = state.routeLength - 0.01;
  update(state, {}, 0.01);
  assert.equal(state.status, 'won');
  assert.deepEqual(
    restoreNightfallSave(exportNightfallSave(state)).survival.cassetteLoops,
    [],
  );
  nextRoute(state);
  assert.deepEqual(state.survival.cassetteLoops, []);
});

test('six-level saves keep every rank and evolution when suit rules change', () => {
  for (const weapon of SURVIVAL_WEAPONS) {
    for (let level = 1; level <= 6; level++) {
      const state = quiet(weapon.id);
      const recipe = SURVIVAL_EVOLUTIONS.find(
        (item) => item.weapon === weapon.id,
      );
      state.survival.upgrades = { [weapon.id]: level, [recipe.support]: 2 };
      state.survival.level = level + 1;
      state.money = 321;
      const saved = exportNightfallSave(state);
      saved.survival.version = 4;
      const restored = restoreNightfallSave(saved);
      assert.ok(restored, `${weapon.id} Lv.${level} remains loadable`);
      assert.equal(restored.survival.version, SURVIVAL_VERSION);
      assert.deepEqual(restored.survival.upgrades, state.survival.upgrades);
      assert.deepEqual(
        restored.survival.evolutions,
        level === 6 ? [recipe.id] : [],
      );
      assert.equal(restored.survival.level, state.survival.level);
      assert.equal(restored.seed, state.seed);
      assert.equal(restored.runId, state.runId);
      assert.equal(restored.money, state.money);
      assert.equal(restored.survival.recordEligible, false);
      const reloaded = restoreNightfallSave(exportNightfallSave(restored));
      assert.deepEqual(reloaded.survival.upgrades, state.survival.upgrades);
      assert.equal(reloaded.survival.recordEligible, false);
      restored.status = 'lost';
      assert.deepEqual(
        normalizeSurvivalRecords([survivalResult(restored)]),
        [],
      );
    }
  }
});
