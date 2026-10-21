import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  nextRoute,
  retryRoute,
  changeRouteBeforeStart,
  exportCampaignSave,
  buyUpgrade,
} from '../public/game-test/src/simulation.js';
import {
  createSaveStore,
  SAVE_KEY,
} from '../public/game-test/src/save-store.js';
import {
  dailySurvival,
  survivalOffers,
  chooseSurvivalUpgrade,
  survivalXpCost,
  recordSurvivalEvent,
  openSurvivalDraft,
  createSurvivalRecords,
  normalizeSurvivalRecords,
  survivalMultiplier,
  finishSurvivalWave,
  SURVIVAL_RECORD_KEY,
} from '../public/game-test/src/survival.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';

function fresh(seed = 175) {
  return createState({
    mode: 'survival',
    seed,
    survivalDay: '2026-10-21',
    runId: `survival-test-${seed}`,
  });
}
function quiet() {
  const s = fresh();
  s.entities = [];
  s._stations = [];
  s._nextEncounter = 1e9;
  return s;
}
function enemy(s, id, distance, extra = {}) {
  const e = {
    id,
    type: 'salaryman',
    hp: 1,
    distance: s.distance + distance,
    resolved: false,
    ...extra,
  };
  s.entities.push(e);
  return e;
}
function draft(s, id) {
  s.survival.xp = survivalXpCost(s.survival.level);
  for (let seed = 1; seed < 1000; seed++) {
    s.seed = seed;
    if (survivalOffers(s).some((item) => item.id === id)) break;
  }
  assert.equal(openSurvivalDraft(s), true);
  assert.equal(chooseSurvivalUpgrade(s, id), true);
}
function clearRoad(s) {
  s.entities = [];
  s._stations = [];
  s._nextEncounter = 1e9;
  s.distance = s.routeLength - 0.01;
  s.status = 'playing';
  update(s, {}, 0.01);
  assert.equal(s.status, 'won');
}

test('daily seed changes at Japan midnight and all map choices reproduce their encounter packs', () => {
  assert.deepEqual(
    dailySurvival(new Date('2026-10-21T00:00:00Z')),
    dailySurvival(new Date('2026-10-21T14:59:59Z')),
  );
  assert.notEqual(
    dailySurvival(new Date('2026-10-21T14:59:59Z')).seed,
    dailySurvival(new Date('2026-10-21T15:00:00Z')).seed,
  );
  for (const seed of [1, 175, 1456847409])
    for (let stage = 0; stage < 12; stage++) {
      for (const node of getJourneyChoices(stage, seed)) {
        const options = {
          mode: 'survival',
          seed,
          routeIndex: stage,
          journeyNodeId: node.nodeId,
        };
        const a = createState(options),
          b = createState(options);
        assert.deepEqual(a._encounterPlan, b._encounterPlan);
        const evRadius = a.routeOption === 'express' ? 120 : 144;
        for (const actor of a._encounterPlan.filter(
          (e) => e.beat === 'survival-pack',
        )) {
          assert.ok(
            a._stations.every(
              (ev) => Math.abs(ev - actor.distance) >= evRadius + 46,
            ),
          );
          assert.ok(actor.distance >= 160);
          assert.ok(actor.distance < a.routeLength - 192);
        }
      }
    }
});

test('automatic hearts deliver real hits; holding hearts increases rate and spends battery', () => {
  const auto = quiet(),
    focus = quiet();
  const a = enemy(auto, 800, 60),
    b = enemy(focus, 800, 60);
  update(auto, {}, 0.3);
  update(focus, { shoot: true }, 0.3);
  assert.equal(a.converted, true);
  assert.equal(b.converted, true);
  assert.ok(focus.energy < auto.energy);
  assert.ok(focus._nextProjectileId > auto._nextProjectileId);
  assert.ok(auto.survival.xp > 0 || auto.survival.gems.length > 0);
});

test('distinct attack and support offers spend XP once, stop time, and exclude maxed upgrades', () => {
  const s = quiet();
  s.survival.xp = 50;
  const offers = survivalOffers(s);
  assert.equal(offers.length, 3);
  assert.ok(offers.some((item) => item.family === 'SUPPORT'));
  assert.ok(offers.some((item) => item.family !== 'SUPPORT'));
  assert.deepEqual(offers, survivalOffers(s));
  openSurvivalDraft(s);
  const before = [s.distance, s.energy, s.survival.seconds, s.survival.heat];
  update(s, { boost: true, rush: true }, 10);
  assert.deepEqual(
    [s.distance, s.energy, s.survival.seconds, s.survival.heat],
    before,
  );
  assert.equal(chooseSurvivalUpgrade(s, 'fake'), false);
  const id = offers[0].id;
  assert.equal(chooseSurvivalUpgrade(s, id), true);
  assert.equal(s.survival.xp, 32);
  assert.equal(chooseSurvivalUpgrade(s, id), false);
  s.survival.upgrades[id] = 3;
  assert.ok(survivalOffers(s).every((item) => item.id !== id));
});

test('all three evolutions require both ingredients and change live attacks', () => {
  for (const [weapon, support, evolution] of [
    ['heart', 'relay', 'heartstorm'],
    ['flash', 'battery', 'flashmob'],
    ['vinyl', 'glide', 'encore'],
  ]) {
    const s = quiet();
    for (let i = 0; i < 3; i++) draft(s, weapon);
    assert.equal(s.survival.evolutions.includes(evolution), false);
    draft(s, support);
    draft(s, support);
    assert.ok(s.survival.evolutions.includes(evolution));
    assert.equal(s.events.filter((e) => e.type === 'evolution').length, 1);
    s.survival.xp = 0;
    s.projectiles = [];
    s.shotCooldown = 0;
    const target = enemy(s, 900, 45, { hp: 4, shielded: weapon === 'flash' });
    s.survival.flashClock = s.survival.vinylClock = 0;
    update(s, {}, 0.01);
    if (weapon === 'heart') assert.equal(s.projectiles.length, 3);
    else assert.equal(target.converted, true);
  }
});

test('HEAT rewards distinct actions, FEVER has bounded duration, hits end it', () => {
  const s = quiet();
  for (let id = 0; id < 12; id++)
    recordSurvivalEvent(s, {
      type: 'convert',
      entityId: id,
      reward: 50,
      distance: 500,
    });
  assert.equal(survivalMultiplier(s), 6);
  const before = [s.score, s.survival.kills, s.survival.gems.length];
  recordSurvivalEvent(s, {
    type: 'convert',
    entityId: 0,
    reward: 50,
    distance: 500,
  });
  assert.deepEqual([s.score, s.survival.kills, s.survival.gems.length], before);
  s.survival.gems = [];
  update(s, {}, 0.5);
  assert.ok(s.survival.fever < 6);
  recordSurvivalEvent(s, { type: 'collision' });
  assert.equal(survivalMultiplier(s), 1);
  assert.equal(s.survival.fever, 0);
});

test('projectiles clearing the next wave early preserve its later clean-wave reward', () => {
  const s = quiet(),
    boundary = s.routeLength / 6;
  s.distance = boundary - 100;
  const nearby = enemy(s, 810, 35),
    distant = enemy(s, 811, 140);
  update(s, {}, 0.9);
  assert.equal(nearby.converted, true);
  assert.equal(distant.converted, true);
  assert.ok(s.distance < boundary);
  assert.equal(s.survival.wave, 0);
  assert.equal(s.survival.waveStats[0].kills, 1);
  assert.equal(s.survival.waveStats[1].kills, 1);

  s.distance = boundary + 49;
  update(s, {}, 0.01);
  assert.equal(s.survival.cleanWaves, 1);
  assert.deepEqual(
    s.events
      .filter((event) => event.type === 'clean-wave')
      .map((event) => event.points),
    [150],
  );
  s.distance = boundary * 2 + 49;
  update(s, {}, 0.01);
  assert.equal(s.survival.cleanWaves, 2);
  assert.deepEqual(
    s.events
      .filter((event) => event.type === 'clean-wave')
      .map((event) => event.points),
    [165],
  );
});

test('clean-wave settlement waits for the collision envelope and cannot pay twice', () => {
  const s = quiet(),
    boundary = s.routeLength / 6;
  recordSurvivalEvent(s, {
    type: 'convert',
    entityId: 820,
    reward: 50,
    distance: boundary - 10,
  });
  s.distance = boundary + 10;
  update(s, {}, 0.01);
  assert.equal(s.survival.cleanWaves, 0);
  assert.equal(s.survival.settledWaves.includes(0), false);

  recordSurvivalEvent(s, {
    type: 'collision',
    entityId: 821,
    distance: boundary - 5,
  });
  s.distance = boundary + 49;
  update(s, {}, 0.01);
  assert.equal(s.survival.waveStats[0].hits, 1);
  assert.equal(s.survival.cleanWaves, 0);
  assert.equal(s.survival.settledWaves.includes(0), true);

  recordSurvivalEvent(s, {
    type: 'convert',
    entityId: 822,
    reward: 50,
    distance: boundary + 100,
  });
  s.distance = boundary * 2 + 49;
  update(s, {}, 0.01);
  assert.equal(s.survival.cleanWaves, 1);
  const score = s.score,
    rewardCount = s.events.filter(
      (event) => event.type === 'clean-wave',
    ).length;
  finishSurvivalWave(s, 1);
  finishSurvivalWave(s, 0);
  assert.equal(s.score, score);
  assert.equal(s.survival.cleanWaves, 1);
  assert.equal(
    s.events.filter((event) => event.type === 'clean-wave').length,
    rewardCount,
  );
});

test('one life preserves builds across map branches, never restores hull or a departure checkpoint', () => {
  const s = quiet();
  s.integrity = 8;
  s.survival.upgrades.vinyl = 2;
  clearRoad(s);
  const hull = s.integrity,
    seconds = s.survival.seconds;
  nextRoute(s);
  assert.equal(s.mode, 'survival');
  assert.equal(s.integrity, hull);
  assert.equal(s.survival.upgrades.vinyl, 2);
  assert.equal(s.survival.seconds, seconds);
  const node = getJourneyChoices(s.routeIndex, s.seed)[2];
  changeRouteBeforeStart(s, node.routeOption, { journeyNodeId: node.nodeId });
  assert.equal(s.journeyNodeId, node.nodeId);
  assert.equal(s.mode, 'survival');
  assert.equal(s.survival.upgrades.vinyl, 2);
  s.status = 'lost';
  const before = s.distance;
  retryRoute(s);
  assert.equal(s.status, 'lost');
  assert.equal(s.distance, before);
  assert.equal(exportCampaignSave(s), null);
  s.status = 'won';
  s.money = 10000;
  assert.equal(buyUpgrade(s, 'repair'), false);
});

test('survival cannot overwrite the tour save; records are local, bounded and tolerate denied storage', () => {
  const memory = new Map(),
    storage = {
      getItem: (key) => memory.get(key),
      setItem: (key, value) => memory.set(key, value),
    };
  const saves = createSaveStore(storage);
  saves.saveCampaign(createState());
  const tour = memory.get(SAVE_KEY);
  const s = fresh();
  saves.saveCampaign(s);
  assert.equal(memory.get(SAVE_KEY), tour);
  const records = createSurvivalRecords(storage);
  assert.equal(records.save(s).persisted, false);
  s.status = 'lost';
  s.score = 2300;
  assert.equal(records.save(s).best, true);
  assert.equal(records.save(s).best, false);
  assert.equal(records.read().length, 1);
  assert.equal(records.best('2026-10-21').score, 2300);
  assert.ok(memory.has(SURVIVAL_RECORD_KEY));
  assert.equal(memory.get(SAVE_KEY), tour);
  assert.deepEqual(normalizeSurvivalRecords('{bad'), []);
  assert.deepEqual(normalizeSurvivalRecords([{ score: Infinity }]), []);
  const denied = createSurvivalRecords({
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  });
  assert.equal(denied.save(s).persisted, false);
  assert.equal(denied.save(s).records[0].score, 2300);
});

test('malformed optional evolution metadata preserves both valid records and subsequent saves', () => {
  const memory = new Map(),
    storage = {
      getItem: (key) => memory.get(key),
      setItem: (key, value) => memory.set(key, value),
    },
    records = createSurvivalRecords(storage),
    s = fresh();
  s.status = 'lost';
  s.score = 2300;
  s.survival.evolutions = ['heartstorm'];
  records.save(s);
  const valid = records.read()[0],
    malformed = {
      ...valid,
      id: 'malformed-optional-metadata',
      score: 2000,
      evolutions: { includes: 4 },
    };
  memory.set(SURVIVAL_RECORD_KEY, JSON.stringify([valid, malformed]));
  const restored = records.read();
  assert.equal(restored.length, 2);
  assert.deepEqual(restored.find((row) => row.id === valid.id).evolutions, [
    'heartstorm',
  ]);
  assert.deepEqual(
    restored.find((row) => row.id === malformed.id).evolutions,
    [],
  );
  s.runId = 'next-finished-run';
  s.score = 1000;
  assert.equal(records.save(s).persisted, true);
  assert.equal(records.read().length, 3);
  assert.equal(records.best('2026-10-21').id, valid.id);
});

test('no-input survival is not a winning strategy even with automatic attacks', () => {
  const s = fresh(1456847409);
  for (
    let i = 0;
    i < 36000 && s.status !== 'lost' && !s.campaignComplete;
    i++
  ) {
    if (s.status === 'draft') chooseSurvivalUpgrade(s, survivalOffers(s)[0].id);
    if (s.status === 'won') nextRoute(s);
    update(s, {}, 1 / 30);
  }
  assert.equal(s.status, 'lost');
  assert.ok(s.survival.kills > 0);
});
