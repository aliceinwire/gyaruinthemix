import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  chooseStartingWeapon,
  beginCampaign,
  exportNightfallSave,
  restoreNightfallSave,
  beginClubQuiz,
  answerQuiz,
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
  SURVIVAL_UPGRADES,
  SURVIVAL_STARTERS,
  SURVIVAL_EVOLUTIONS,
  SURVIVAL_MAX_LEVEL,
  survivalView,
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

test('automatic hearts deliver real hits without manual fire or battery drain', () => {
  const auto = quiet(),
    focus = quiet();
  const a = enemy(auto, 800, 60),
    b = enemy(focus, 800, 60);
  update(auto, {}, 0.3);
  update(focus, { shoot: true }, 0.3);
  assert.equal(a.converted, true);
  assert.equal(b.converted, true);
  assert.equal(focus.energy, auto.energy);
  assert.equal(focus._nextProjectileId, auto._nextProjectileId);
  assert.deepEqual(focus.survival, auto.survival);
  assert.ok(auto.survival.xp > 0 || auto.survival.gems.length > 0);
});

test('every starting weapon attacks automatically, and hearts require acquisition', () => {
  for (const weapon of SURVIVAL_STARTERS) {
    const s = createState({ mode: 'survival', startingWeapon: weapon.id });
    s.entities = [];
    s._stations = [];
    s._nextEncounter = 1e9;
    const target = enemy(s, 700, 30);
    update(s, { shoot: true }, 0.15);
    assert.equal(target.converted, true, weapon.id);
    assert.deepEqual(s.survival.upgrades, { [weapon.id]: 1 });
    if (weapon.id !== 'heart') {
      assert.equal(
        s._nextProjectileId,
        1,
        'Manual fire cannot summon an unowned weapon',
      );
      assert.equal(s.shooting, false);
      s.survival.xp = 0;
      draft(s, 'heart');
      s.survival.xp = 0;
      update(s, {}, 0.01);
      assert.ok(s._nextProjectileId > 1, 'Acquired hearts fire without input');
    }
  }
});

test('starting weapon choices close at departure and cannot reset an earned build', () => {
  const s = fresh();
  assert.equal(chooseStartingWeapon(s, 'unknown'), false);
  assert.equal(chooseStartingWeapon(s, 'bass'), true);
  assert.deepEqual(s.survival.upgrades, { bass: 1 });
  changeRouteBeforeStart(s, 'express');
  assert.deepEqual(s.survival.upgrades, { bass: 1 });
  assert.equal(s.survival.startingWeapon, 'bass');
  beginCampaign(s);
  assert.equal(chooseStartingWeapon(s, 'heart'), false);
  const progressed = fresh();
  draft(progressed, 'armor');
  assert.equal(chooseStartingWeapon(progressed, 'heart'), false);
  assert.equal(progressed.survival.upgrades.armor, 1);
});

test('bass reaches behind the car and its evolution pierces guards', () => {
  const s = quiet();
  chooseStartingWeapon(s, 'bass');
  const behind = enemy(s, 730, -25, { hp: 2 });
  const guard = enemy(s, 731, 45, { hp: 4, shielded: true });
  update(s, {}, 0.01);
  assert.equal(behind.converted, true);
  assert.equal(guard.converted, undefined);
  assert.equal(guard.hp, 4);
  draft(s, 'bass');
  draft(s, 'bass');
  draft(s, 'hype');
  draft(s, 'hype');
  s.survival.bassClock = 0;
  s.survival.xp = 0;
  update(s, {}, 0.01);
  assert.equal(guard.converted, true);
  assert.ok(
    s.events.some(
      (event) => event.type === 'survival-attack' && event.kind === 'bass',
    ),
  );
});

test('upgrade offers reveal evolution ingredients and exhaust at the actual build cap', () => {
  const s = fresh();
  while (s.survival.level < SURVIVAL_MAX_LEVEL) {
    s.survival.xp = survivalXpCost(s.survival.level);
    const offers = survivalOffers(s);
    assert.ok(offers.length > 0 && offers.length <= 3);
    for (const offer of offers) {
      assert.equal(offer.icon, offer.id);
      if (offer.evolution) {
        const next = {
          ...s.survival.upgrades,
          [offer.id]: (s.survival.upgrades[offer.id] || 0) + 1,
        };
        assert.equal(
          offer.evolutionReady,
          !s.survival.evolutions.includes(offer.evolution.id) &&
            next[offer.evolution.weapon] >= 3 &&
            next[offer.evolution.support] >= 2,
        );
      }
    }
    assert.equal(openSurvivalDraft(s), true);
    assert.equal(chooseSurvivalUpgrade(s, offers[0].id), true);
  }
  assert.equal(s.survival.level, SURVIVAL_MAX_LEVEL);
  assert.ok(
    SURVIVAL_UPGRADES.every((item) => s.survival.upgrades[item.id] === 3),
  );
  assert.deepEqual(survivalOffers(s), []);
  assert.equal(survivalView(s).nextXp, null);
  assert.equal(survivalView(s).progress, 1);
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

test('all five evolutions require both ingredients and change live attacks', () => {
  for (const [weapon, support, evolution] of [
    ['heart', 'relay', 'heartstorm'],
    ['flash', 'battery', 'flashmob'],
    ['vinyl', 'glide', 'encore'],
    ['bass', 'hype', 'afterparty'],
    ['phone', 'md', 'hotline'],
  ]) {
    const s = quiet();
    while ((s.survival.upgrades[weapon] || 0) < 3) draft(s, weapon);
    assert.equal(s.survival.evolutions.includes(evolution), false);
    draft(s, support);
    draft(s, support);
    assert.ok(s.survival.evolutions.includes(evolution));
    assert.equal(s.events.filter((e) => e.type === 'evolution').length, 1);
    s.survival.xp = 0;
    s.projectiles = [];
    s.shotCooldown = 0;
    const target = enemy(s, 900, 45, {
      hp: weapon === 'phone' ? 3 : 4,
      shielded: weapon === 'flash',
    });
    s.survival.flashClock = s.survival.vinylClock = s.survival.bassClock = 0;
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
    distant = enemy(s, 811, 110);
  update(s, {}, 1.2);
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
  assert.equal(buyUpgrade(s, 'repair'), true);
  assert.equal(s.integrity, 53);
  assert.ok(s.money < 10000);
});

test('club quizzes happen only on arrival and cannot repeat rewards after a reload', () => {
  const s = fresh();
  assert.equal(beginClubQuiz(s), false);
  clearRoad(s);
  assert.equal(
    beginClubQuiz(s),
    false,
    'Approach roads do not interrupt with club quizzes',
  );
  nextRoute(s);
  clearRoad(s);
  assert.equal(beginClubQuiz(s), true);
  assert.equal(s.status, 'quiz');
  assert.equal(s.pendingQuiz.club, true);
  const score = s.score;
  const distance = s.distance;
  update(s, { boost: true, rush: true }, 30);
  assert.equal(s.distance, distance);
  assert.equal(beginClubQuiz(s), false);
  assert.equal(answerQuiz(s, true), true);
  assert.equal(s.status, 'won');
  assert.equal(s.score, score + 300);
  assert.deepEqual(s.survival.quizRoads, [1]);
  assert.equal(answerQuiz(s, true), false);
  assert.equal(beginClubQuiz(s), false);
  const restored = restoreNightfallSave(exportNightfallSave(s));
  assert.equal(restored.score, s.score);
  assert.deepEqual(restored.survival.quizRoads, [1]);
  assert.equal(beginClubQuiz(restored), false);
  nextRoute(restored);
  clearRoad(restored);
  nextRoute(restored);
  clearRoad(restored);
  assert.equal(beginClubQuiz(restored), true);
  const beforeWrongAnswer = restored.score;
  assert.equal(answerQuiz(restored, false), true);
  assert.equal(restored.status, 'won');
  assert.equal(restored.score, beforeWrongAnswer);
  assert.deepEqual(restored.survival.quizRoads, [1, 3]);
  assert.equal(beginClubQuiz(restored), false);
});

test('club purchases spend run currency and survive the next map checkpoint', () => {
  const s = fresh();
  s.money = 10000;
  assert.equal(buyUpgrade(s, 'battery'), false);
  clearRoad(s);
  const capacity = s.energyCapacity;
  assert.equal(buyUpgrade(s, 'battery'), true);
  assert.ok(s.energyCapacity > capacity);
  const restored = restoreNightfallSave(exportNightfallSave(s));
  assert.equal(restored.upgrades.battery, 1);
  assert.equal(restored.energyCapacity, s.energyCapacity);
  assert.equal(restored.money, s.money);
  nextRoute(restored);
  assert.equal(restored.energyCapacity, s.energyCapacity);
});

test('between-road saves preserve the chosen weapon, build, resources and branch', () => {
  const s = fresh();
  chooseStartingWeapon(s, 'flash');
  const departure = exportNightfallSave(s);
  const ready = restoreNightfallSave(JSON.stringify(departure));
  assert.equal(ready.mode, 'survival');
  assert.deepEqual(ready.survival.upgrades, { flash: 1 });
  assert.equal(ready.survival.day, '2026-10-21');
  assert.equal(ready.distance, 0);
  assert.equal(ready.campaignStarted, false);
  beginCampaign(s);
  draft(s, 'flash');
  draft(s, 'flash');
  draft(s, 'battery');
  draft(s, 'battery');
  s.survival.seconds = 180;
  s.survival.kills = 16;
  s.survival.cleanWaves = 3;
  s.integrity = 23;
  s.energy = 44;
  clearRoad(s);
  s.pendingJourneyNodeId = getJourneyChoices(1, s.seed)[2].nodeId;
  const saved = exportNightfallSave(s);
  const restored = restoreNightfallSave(saved);
  assert.equal(restored.status, 'won');
  assert.equal(restored.distance, restored.routeLength);
  assert.equal(restored.score, s.score);
  assert.equal(restored.integrity, s.integrity);
  assert.equal(restored.energy, s.energy);
  assert.equal(restored.survival.seconds, s.survival.seconds);
  assert.equal(restored.survival.kills, 16);
  assert.equal(restored.survival.cleanWaves, s.survival.cleanWaves);
  assert.deepEqual(restored.survival.upgrades, s.survival.upgrades);
  assert.deepEqual(restored.survival.evolutions, ['flashmob']);
  assert.deepEqual(restored.journey, s.journey);
  assert.equal(restored.pendingJourneyNodeId, s.pendingJourneyNodeId);
  const score = restored.score;
  finishSurvivalWave(restored, 5);
  assert.equal(
    restored.score,
    score,
    'Reloading an arrival cannot reward a wave twice',
  );
  nextRoute(restored);
  assert.equal(restored.journeyNodeId, s.pendingJourneyNodeId);
  assert.equal(restored.integrity, s.integrity);
  assert.deepEqual(restored.survival.upgrades, s.survival.upgrades);
  assert.equal(chooseStartingWeapon(restored, 'heart'), false);
});

test('nightfall saves reject active or ended roads and corrupt progression', () => {
  const s = fresh();
  const valid = exportNightfallSave(s);
  update(s, {}, 0.01);
  assert.equal(exportNightfallSave(s), null);
  s.status = 'lost';
  assert.equal(exportNightfallSave(s), null);
  s.status = 'won';
  s.campaignComplete = true;
  assert.equal(exportNightfallSave(s), null);
  assert.equal(exportNightfallSave(createState()), null);
  assert.equal(restoreNightfallSave(exportCampaignSave(createState())), null);
  assert.equal(restoreNightfallSave('{bad'), null);
  for (const mutate of [
    (save) => {
      save.nightfallVersion = 99;
    },
    (save) => {
      save.status = 'lost';
    },
    (save) => {
      save.survival.version = 1;
    },
    (save) => {
      save.survival.day = '2026-02-31';
    },
    (save) => {
      save.survival.startingWeapon = 'unknown';
    },
    (save) => {
      save.survival.upgrades.heart = 4;
    },
    (save) => {
      save.survival.upgrades.heart = 0;
    },
    (save) => {
      save.survival.level = 12;
    },
    (save) => {
      save.survival.xp = Infinity;
    },
    (save) => {
      save.journeyNodeId = 'invalid';
    },
    (save) => {
      save.survival.quizRoads = [2];
    },
    (save) => {
      save.survival.quizRoads = [11];
    },
  ]) {
    const corrupt = structuredClone(valid);
    mutate(corrupt);
    assert.equal(restoreNightfallSave(corrupt), null);
  }
  const optional = structuredClone(valid);
  optional.survival.evolutions = ['flashmob'];
  optional.survival.seconds = Infinity;
  optional.survival.heat = 1e12;
  optional.survival.cleanWaves = 1e12;
  optional.survival.gems = [{ xp: 1e12, distance: 0 }];
  const restored = restoreNightfallSave(optional);
  assert.deepEqual(restored.survival.evolutions, []);
  assert.equal(restored.survival.seconds, 0);
  assert.equal(restored.survival.heat, 100);
  assert.equal(restored.survival.cleanWaves, 72);
  assert.deepEqual(restored.survival.gems, []);
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

test('all five starters can finish the twelve-road run with driving and build choices', () => {
  for (const starter of SURVIVAL_STARTERS) {
    const s = createState({
      mode: 'survival',
      startingWeapon: starter.id,
      seed: 175,
      survivalDay: '2026-10-21',
    });
    for (
      let tick = 0;
      tick < 36000 && s.status !== 'lost' && !s.campaignComplete;
      tick++
    ) {
      if (s.status === 'draft') {
        const offers = survivalOffers(s);
        const recipe = SURVIVAL_EVOLUTIONS.find(
          (item) => item.weapon === starter.id,
        );
        const pick =
          offers.find((offer) => offer.evolutionReady) ||
          offers.find((offer) => offer.id === 'armor' && s.integrity < 55) ||
          offers.find((offer) => offer.id === starter.id) ||
          offers.find((offer) => offer.id === recipe.support) ||
          offers.find((offer) => offer.kind === 'weapon') ||
          offers[0];
        chooseSurvivalUpgrade(s, pick.id);
      }
      if (s.status === 'won') nextRoute(s);
      const hazard = s.entities.find(
        (actor) =>
          !actor.cleared &&
          !actor.resolved &&
          !actor.converted &&
          ['salaryman', 'barrier', 'cone', 'pothole'].includes(actor.type) &&
          actor.distance > s.distance - 1 &&
          actor.distance - s.distance < 45,
      );
      const station = s.entities.find(
        (actor) =>
          actor.type === 'ev' &&
          Math.abs(actor.distance - s.distance) <= actor.radius,
      );
      update(
        s,
        { boost: Boolean(hazard), charge: Boolean(station && !hazard) },
        1 / 30,
      );
    }
    assert.equal(s.status, 'won', starter.id);
    assert.equal(s.campaignComplete, true, starter.id);
    assert.equal(s.stagesCompleted, 12, starter.id);
    assert.ok(s.survival.kills > 0, starter.id);
    assert.ok(s.survival.evolutions.length > 0, starter.id);
  }
});

function measureRoad(seed, weapon, routeIndex, level) {
  const s = createState({
    mode: 'survival',
    seed,
    startingWeapon: weapon,
    routeIndex,
  });
  s.survival.upgrades[weapon] = level;
  s.survival.level = level - 1;
  let firstInvitation = null;
  for (
    let tick = 0;
    tick < 12000 && ['playing', 'draft'].includes(s.status);
    tick++
  ) {
    // Keep the chosen build fixed so draft luck cannot mask a weak starter.
    s.survival.xp = 0;
    s.survival.gems = [];
    if (s.status === 'draft') s.status = 'playing';
    const hazard = s.entities.find(
      (a) =>
        !a.cleared &&
        !a.resolved &&
        !a.converted &&
        ['salaryman', 'barrier', 'cone', 'pothole'].includes(a.type) &&
        a.distance > s.distance - 1 &&
        a.distance - s.distance < 45,
    );
    const station = s.entities.find(
      (a) => a.type === 'ev' && Math.abs(a.distance - s.distance) <= a.radius,
    );
    update(
      s,
      { boost: Boolean(hazard), charge: Boolean(station && !hazard) },
      1 / 30,
    );
    if (firstInvitation === null && s.survival.kills)
      firstInvitation = s.survival.seconds;
  }
  return {
    status: s.status,
    kills: s.survival.kills,
    integrity: s.integrity,
    firstInvitation,
  };
}

test('seeded early and late roads give every weapon a viable fixed-build role', () => {
  for (const [stage, level] of [
    [0, 1],
    [8, 3],
  ]) {
    const totals = [];
    for (const weapon of SURVIVAL_STARTERS) {
      let total = 0;
      for (const seed of [1, 175, 819, 1456847409]) {
        const result = measureRoad(seed, weapon.id, stage, level);
        assert.equal(result.status, 'won', `${weapon.id}/${seed}/${stage}`);
        assert.ok(result.integrity > 0);
        assert.ok(result.firstInvitation > 0 && result.firstInvitation < 20);
        assert.ok(result.kills > 0);
        total += result.kills;
      }
      totals.push(total);
    }
    // Allow distinct specializations; reject the old threefold invitation gap.
    assert.ok(
      Math.min(...totals) >= Math.max(...totals) * 0.55,
      `${stage}: ${totals}`,
    );
  }
  assert.deepEqual(
    measureRoad(175, 'phone', 0, 1),
    measureRoad(175, 'phone', 0, 1),
  );
});

test('every starter reaches its first build choice promptly without taking unavoidable damage', () => {
  for (const weapon of SURVIVAL_STARTERS)
    for (const seed of [1, 175, 819, 1456847409]) {
      const s = createState({
        mode: 'survival',
        seed,
        startingWeapon: weapon.id,
      });
      for (let tick = 0; tick < 600 && s.status === 'playing'; tick++) {
        const hazard = s.entities.find(
          (a) =>
            !a.cleared &&
            !a.resolved &&
            !a.converted &&
            ['salaryman', 'barrier', 'cone', 'pothole'].includes(a.type) &&
            a.distance > s.distance - 1 &&
            a.distance - s.distance < 45,
        );
        const station = s.entities.find(
          (a) =>
            a.type === 'ev' && Math.abs(a.distance - s.distance) <= a.radius,
        );
        update(
          s,
          { boost: Boolean(hazard), charge: Boolean(station && !hazard) },
          1 / 30,
        );
      }
      assert.equal(s.status, 'draft', `${weapon.id}/${seed}`);
      assert.ok(s.survival.seconds < 15);
      assert.ok(s.integrity >= 80);
    }
});
