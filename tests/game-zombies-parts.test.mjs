import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  buyUpgrade,
  upgradePrice,
  UPGRADE_CATALOG,
  exportCampaignSave,
  restoreCampaignSave,
  exportNightfallSave,
  restoreNightfallSave,
} from '../public/game/src/simulation.js';
import {
  CAR_CATALOG,
  getCarStats,
  restoreMetaProgress,
} from '../public/game/src/garage.js';
import {
  ZOMBIE_TYPES,
  addZombieEncounters,
} from '../public/game/src/street-culture.js';
import {
  drawZombieCharacter,
  preloadZombieCharacters,
  ZOMBIE_SHEET,
} from '../public/game/src/zombie-art.js';
import { getRoadCue } from '../public/game/src/road-feedback.js';
import { getBuildModifiers } from '../public/game/src/run-build.js';
import {
  SURVIVAL_UPGRADES,
  survivalOffers,
  survivalXpCost,
  openSurvivalDraft,
  chooseSurvivalUpgrade,
  applySurvivalModifiers,
  survivalEchoCooldown,
  survivalGlideReduction,
  recordSurvivalEvent,
  MUSIC_RULES_VERSION,
  createSurvivalRecords,
} from '../public/game/src/survival.js';

function fresh(options = {}) {
  return createState({
    mode: 'survival',
    seed: 175,
    survivalDay: '2026-10-26',
    ...options,
  });
}
function quiet(options = {}) {
  const state = fresh(options);
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  return state;
}

test('zombies replace spaced crowd members deterministically and get tougher later', () => {
  const kinds = new Set();
  for (const seed of [1, 42, 175, 2026]) {
    for (let stage = 0; stage < 12; stage++) {
      const state = fresh({ seed, routeIndex: stage });
      const zombies = state._encounterPlan.filter((actor) => actor.zombie);
      assert.deepEqual(
        state._encounterPlan,
        fresh({ seed, routeIndex: stage })._encounterPlan,
      );
      assert.ok(zombies.length <= 1 + Math.floor(stage / 4));
      assert.equal(zombies.length > 0, stage > 0);
      for (const actor of zombies) {
        kinds.add(actor.zombie.id);
        assert.ok(stage >= actor.zombie.stage);
        assert.equal(actor.hp, actor.zombie.hp + Math.floor(stage / 4));
        assert.equal(actor.maxHp, actor.hp);
        assert.ok(!actor.tutorial && !actor.headliner && !actor.elite);
        assert.ok(
          zombies.every(
            (other) =>
              other === actor ||
              Math.abs(other.distance - actor.distance) >= 300,
          ),
        );
      }
    }
  }
  assert.deepEqual(
    [...kinds].sort(),
    ZOMBIE_TYPES.map((item) => item.id).sort(),
  );
  const plan = Object.freeze(
    Array.from({ length: 6 }, (_, i) =>
      Object.freeze({
        type: 'salaryman',
        distance: 300 + i * 400,
        encounterId: `crowd-${i}`,
        collisionRadius: 15,
        motionAmplitude: 10,
        hp: 1,
        maxHp: 1,
      }),
    ),
  );
  const result = addZombieEncounters(plan, 9, 175);
  assert.equal(result.length, plan.length);
  result.forEach((actor, i) => {
    for (const key of ['distance', 'collisionRadius', 'motionAmplitude'])
      assert.equal(
        actor[key],
        plan[i][key],
        'Collision envelopes stay unchanged',
      );
  });
  assert.ok(plan.every((actor) => !actor.zombie));
});

test('zombies survive a normal hit, become their own gyaru variant once, and remain avoidable', () => {
  for (const zombie of ZOMBIE_TYPES) {
    const state = quiet({ mode: 'story' });
    const actor = {
      id: 900,
      type: 'salaryman',
      distance: 200,
      hp: zombie.hp,
      maxHp: zombie.hp,
      zombie,
    };
    state.entities.push(actor);
    assert.match(getRoadCue(state).label, new RegExp(zombie.name));
    const shoot = (damage) => {
      state.projectiles.push({ distance: 199, height: 0, damage, age: 0 });
      update(state, {}, 0.01);
    };
    shoot(1);
    assert.equal(actor.hp, zombie.hp - 1);
    assert.equal(actor.converted, undefined);
    shoot(zombie.hp);
    assert.equal(actor.type, 'gyaru');
    assert.equal(actor.zombie.gyaruStyle, zombie.gyaruStyle);
    assert.equal(state.gyaruConverted, 1);
    const money = state.money;
    shoot(100);
    assert.equal(state.gyaruConverted, 1);
    assert.equal(state.money, money);
    const flying = quiet({ startingWeapon: 'vinyl' });
    flying.entities.push({
      id: 901,
      type: 'salaryman',
      distance: 100,
      hp: 50,
      zombie,
    });
    update(flying, { boost: true }, 2.5);
    assert.equal(flying.integrity, 100);
  }
});

test('both zombie sprites visibly change into distinct gyaru with bounded drawing work', async () => {
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    naturalWidth = ZOMBIE_SHEET.width;
    naturalHeight = ZOMBIE_SHEET.height;
    set src(value) {
      this.url = value;
      queueMicrotask(() => this.onload());
    }
  };
  try {
    assert.equal(await preloadZombieCharacters(), true);
  } finally {
    if (originalImage) globalThis.Image = originalImage;
    else delete globalThis.Image;
  }
  const drawings = new Set();
  for (const zombie of ZOMBIE_TYPES)
    for (const converted of [false, true]) {
      const calls = [];
      const ctx = new Proxy(
        {},
        {
          get: (target, key) =>
            key in target
              ? target[key]
              : (...args) => calls.push([key, target.fillStyle, ...args]),
        },
      );
      assert.equal(
        drawZombieCharacter(
          ctx,
          { zombie, converted, hp: zombie.hp, maxHp: zombie.hp },
          500,
          465,
          2,
        ),
        true,
      );
      assert.ok(calls.length < 100);
      assert.ok(
        calls.every((args) =>
          args.every(
            (value) => typeof value !== 'number' || Number.isFinite(value),
          ),
        ),
      );
      drawings.add(JSON.stringify(calls));
    }
  assert.equal(drawings.size, 4);
});

test('all car parts can be purchased through six, stop at six, and survive checkpoints', () => {
  const state = quiet({ mode: 'story' });
  state.status = 'won';
  state.distance = state.routeLength;
  state.money = 100000;
  for (const part of UPGRADE_CATALOG.filter((item) => item.maxLevel !== null)) {
    assert.equal(part.maxLevel, 6);
    for (let level = 1; level <= 6; level++) {
      const money = state.money;
      assert.equal(upgradePrice(state, part.id), part.basePrice * level);
      assert.equal(buyUpgrade(state, part.id), true);
      assert.equal(state.upgrades[part.id], level);
      assert.equal(state.money, money - part.basePrice * level);
    }
    assert.equal(upgradePrice(state, part.id), null);
    assert.equal(buyUpgrade(state, part.id), false);
  }
  const restored = restoreCampaignSave(exportCampaignSave(state));
  assert.deepEqual(restored.upgrades, state.upgrades);
  for (const level of [3, 6]) {
    const upgrades = {
      battery: level,
      hearts: level,
      charger: level,
      armor: level,
    };
    assert.deepEqual(restoreMetaProgress({ upgrades }).upgrades, upgrades);
  }
  for (const car of CAR_CATALOG)
    for (const part of UPGRADE_CATALOG.filter((item) => item.maxLevel)) {
      let previous = getCarStats(car);
      for (let level = 1; level <= 6; level++) {
        const stats = getCarStats(car, { [part.id]: level });
        assert.notDeepEqual(stats, previous, `${car.id}/${part.id}/${level}`);
        assert.ok(
          stats.thrustDrain > 0 &&
            stats.rushRecovery > 0 &&
            stats.shotInterval > 0,
        );
        previous = stats;
      }
    }
});

test('six-level support drafts, saves and caps work for every part', () => {
  for (const part of SURVIVAL_UPGRADES.filter(
    (item) => item.kind === 'support',
  ))
    for (let level = 1; level <= 6; level++) {
      const state = quiet();
      state.integrity = 20;
      state.survival.upgrades = Object.fromEntries(
        SURVIVAL_UPGRADES.map((item) => [
          item.id,
          item.id === part.id ? level - 1 : 6,
        ]),
      );
      state.survival.level =
        Object.values(state.survival.upgrades).reduce((sum, n) => sum + n, 0) -
        1;
      state.survival.xp = survivalXpCost(state.survival.level);
      const offers = survivalOffers(state);
      assert.deepEqual(
        offers.map((item) => item.id),
        [part.id],
      );
      if (part.id === 'glide')
        assert.ok(
          offers[0].synergy.includes(`${survivalGlideReduction(level)}%`),
        );
      assert.equal(openSurvivalDraft(state), true);
      assert.equal(chooseSurvivalUpgrade(state, part.id), true);
      assert.equal(state.survival.upgrades[part.id], level);
      if (part.id === 'armor') assert.equal(state.integrity, 32);
      assert.deepEqual(
        restoreNightfallSave(exportNightfallSave(state)).survival.upgrades,
        state.survival.upgrades,
      );
      if (level === 6) {
        state.survival.xp = 1e6;
        assert.deepEqual(survivalOffers(state), []);
      }
    }
});

test('each support level changes actual combat or recovery through level six', () => {
  let previous;
  for (let level = 1; level <= 6; level++) {
    const state = quiet();
    state.survival.upgrades = {
      heart: 1,
      relay: level,
      glide: level,
      battery: level,
      hype: level,
      armor: level,
    };
    state.buildModifiers = getBuildModifiers(state);
    applySurvivalModifiers(state);
    const modifiers = state.buildModifiers;
    assert.equal(modifiers.comboFlight, level * 2);
    assert.equal(modifiers.heartChain, level);
    assert.equal(modifiers.conversionEnergy, level);
    recordSurvivalEvent(state, {
      type: 'convert',
      entityId: 1,
      reward: 1,
      distance: 1,
    });
    assert.equal(state.survival.heat, 9 + level * 3);
    state.survival.heat = 99;
    recordSurvivalEvent(state, {
      type: 'convert',
      entityId: 2,
      reward: 1,
      distance: 1,
    });
    assert.equal(state.survival.fever, 6 + level);
    state.entities.push({ id: 77, type: 'barrier', distance: 12, hp: 100 });
    update(state, {}, 0.1);
    const current = {
      drain: modifiers.thrustDrainMultiplier,
      echo: survivalEchoCooldown(level),
      hull: state.integrity,
    };
    if (previous) {
      assert.ok(current.drain < previous.drain);
      assert.ok(current.echo < previous.echo);
      assert.ok(current.hull > previous.hull);
    }
    previous = current;
  }
});

test('scores from before zombies and extended parts remain in their earlier rules category', () => {
  const data = new Map();
  const records = createSurvivalRecords({
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  });
  for (const version of [4, MUSIC_RULES_VERSION]) {
    const state = fresh({ runId: `parts-${version}` });
    state.survival.musicVersion = version;
    state.status = 'lost';
    state.score = version === 4 ? 9999 : 1;
    records.save(state);
  }
  assert.equal(records.best('2026-10-26').score, 1);
  assert.equal(records.best('2026-10-26', false, true, 4).score, 9999);
});
