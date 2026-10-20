import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_MOD_CATALOG,
  RUN_BUILD_VERSION,
  RUN_BUILD_CAPACITY,
  createRunBuild,
  normalizeRunBuild,
  getBuildModifiers,
  getBuildOffers,
  buyRunMod,
  describeBuild,
  getRouteMission,
  routeMissionProgress,
  settleRouteReward,
} from '../public/game-test/src/run-build.js';
import { CAR_CATALOG } from '../public/game-test/src/garage.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';

const route = (leg = 0, kind = 'ev', seed = 175) =>
  getJourneyChoices(leg, seed).find((node) => node.kind === kind);
function state({
  leg = 0,
  kind = 'ev',
  carId = 'mix-175',
  status = 'won',
  seed = 175,
} = {}) {
  const node = route(leg, kind, seed);
  return {
    routeIndex: leg,
    seed,
    status,
    campaignStarted: true,
    campaignComplete: false,
    journeyNodeId: node.nodeId,
    journey: {
      completedNodeIds: Array.from(
        { length: leg + (status === 'won' ? 1 : 0) },
        (_, index) =>
          index === leg ? node.nodeId : route(index, 'ev', seed).nodeId,
      ),
    },
    garage: { equipped: carId },
    money: 10_000,
    completionPoints: 7,
    stagesCompleted: leg + (status === 'won' ? 1 : 0),
    runBuild: createRunBuild(carId),
    events: [],
    combo: 0,
    energy: 50,
    integrity: 50,
  };
}
function install(target, ids, acquiredIds = ids) {
  target.runBuild = normalizeRunBuild(
    { ...target.runBuild, mods: ids, acquiredIds },
    target,
  );
  return target;
}
function clear(target) {
  target.status = 'won';
  target.stagesCompleted = target.routeIndex + 1;
  target.journey.completedNodeIds[target.routeIndex] = target.journeyNodeId;
  return target;
}
function next(target, leg, kind = 'ev') {
  const result = state({ leg, kind, carId: target.garage.equipped });
  result.runBuild = normalizeRunBuild(target.runBuild, result);
  result.money = target.money;
  return result;
}

// The model is deliberately independent from rendering and from permanent progression.
test('catalog has three synergistic families with immutable readable effects and previews', () => {
  assert.equal(RUN_MOD_CATALOG.length, 9);
  assert.equal(RUN_BUILD_CAPACITY, 4);
  for (const family of ['relay', 'guardian', 'air']) {
    const items = RUN_MOD_CATALOG.filter((item) => item.family === family);
    assert.deepEqual(
      items.map((item) => item.tier),
      [1, 2, 3],
    );
    assert.deepEqual(
      items.map((item) => item.minLeg),
      [0, 2, 5],
    );
    assert.equal(items[0].requires, null);
    assert.equal(items[1].requires, items[0].id);
    assert.equal(items[2].requires, items[1].id);
    for (const item of items) {
      assert.ok(item.description.length > 12 && item.preview.length > 4);
      assert.ok(Object.isFrozen(item) && Object.isFrozen(item.effects));
      assert.ok(Number.isInteger(item.basePrice) && item.basePrice > 0);
    }
  }
});

test('corrupt input always normalizes to a finite JSON-safe detached value', () => {
  for (const value of [
    null,
    undefined,
    false,
    7,
    [],
    '',
    '{',
    'null',
    '[]',
    { version: 999 },
    { mods: ['__proto__'] },
  ]) {
    const build = normalizeRunBuild(value);
    assert.equal(build.version, RUN_BUILD_VERSION);
    assert.equal(build.carId, 'mix-175');
    assert.deepEqual(build.mods, []);
    assert.doesNotThrow(() => JSON.stringify(build));
  }
  const corrupt = normalizeRunBuild({
    version: 1,
    carId: 'invented',
    mods: ['heart-pierce', 'constructor'],
    purchasedLegs: [0, 0, -1, 12, 1.2, '2', null],
    settledLegs: [11, 2, 2, Infinity],
    mission: {
      nodeId: route().nodeId,
      conversions: Infinity,
      chargeSeconds: NaN,
      hits: -5,
      rushes: '10',
      bestCombo: 1e100,
      convertedIds: ['n:1', 'n:1', '__proto__', {}],
    },
  });
  assert.deepEqual(corrupt.mods, []);
  assert.deepEqual(corrupt.purchasedLegs, [0]);
  assert.deepEqual(corrupt.settledLegs, [2, 11]);
  assert.equal(corrupt.mission.conversions, 0);
  assert.equal(corrupt.mission.chargeSeconds, 0);
  assert.equal(corrupt.mission.hits, 0);
  assert.equal(corrupt.mission.rushes, 0);
  assert.equal(corrupt.mission.bestCombo, 512);
  assert.deepEqual(corrupt.mission.convertedIds, ['n:1']);
});

test('normalization validates acquired progression but installed modules need not retain their prerequisite', () => {
  const acquiredIds = [
    'heart-pierce',
    'heart-chain',
    'heart-recycle',
    'charge-shield',
    'air-control',
  ];
  const build = normalizeRunBuild({
    version: 1,
    carId: 'mix-175',
    acquiredIds,
    mods: [
      'heart-recycle',
      'charge-shield',
      'air-control',
      'heart-chain',
      'heart-pierce',
      'heart-chain',
    ],
  });
  assert.equal(build.mods.length, 4);
  assert.equal(build.mods.includes('heart-pierce'), false);
  assert.equal(build.acquiredIds.includes('heart-pierce'), true);
  assert.deepEqual(normalizeRunBuild({ mods: ['heart-recycle'] }).mods, []);
  const rebound = normalizeRunBuild(build, { carId: 'spark-k' });
  assert.deepEqual(rebound.mods, []);
  assert.deepEqual(rebound.acquiredIds, []);
  assert.equal(rebound.carId, 'spark-k');
});

test('JSON round trips preserve purchases, rewards and mission progress without sharing arrays', () => {
  const target = state({ status: 'playing', kind: 'event' });
  install(target, ['heart-pierce', 'heart-chain']);
  target.runBuild.purchasedLegs = [0, 2];
  target.runBuild.settledLegs = [0];
  target.routeIndex = 3;
  target.journeyNodeId = route(3, 'event').nodeId;
  routeMissionProgress(target, { type: 'convert', entityId: 1, combo: 4 });
  const saved = JSON.parse(JSON.stringify(target.runBuild));
  const restored = normalizeRunBuild(saved, target);
  assert.deepEqual(restored, saved);
  restored.mods.push('air-control');
  restored.mission.convertedIds.push('n:5');
  assert.equal(saved.mods.includes('air-control'), false);
  assert.equal(saved.mission.convertedIds.includes('n:5'), false);
  const contextRestored = normalizeRunBuild({ runBuild: saved }, target);
  assert.deepEqual(contextRestored, saved);
});

test('initial three offers are deterministic, current-car bound, and never consume simulation RNG', () => {
  for (const car of CAR_CATALOG) {
    const target = state({ carId: car.id });
    target._rng = 777;
    const before = JSON.stringify(target);
    const offers = getBuildOffers(target);
    assert.equal(offers.length, 3);
    assert.equal(new Set(offers.map((item) => item.family)).size, 3);
    assert.deepEqual(
      getBuildOffers(JSON.parse(JSON.stringify(target))),
      offers,
    );
    assert.equal(JSON.stringify(target), before);
    for (const item of offers) {
      assert.equal(item.carId, car.id);
      assert.match(item.preview, new RegExp(car.name));
      assert.equal(item.available, true);
    }
    offers[0].effects.heartPierce = 999;
    assert.notEqual(getBuildOffers(target)[0].effects.heartPierce, 999);
  }
  for (const bad of [
    null,
    [],
    {},
    { routeIndex: Infinity },
    { routeIndex: -1 },
  ])
    assert.deepEqual(getBuildOffers(bad), []);
});

test('rare offers escalate gradually and mastered/locked families do not occupy choices', () => {
  const target = install(state(), ['heart-pierce']);
  assert.equal(
    getBuildOffers(target).some((item) => item.family === 'relay'),
    false,
  );
  target.routeIndex = 2;
  assert.equal(
    getBuildOffers(target).find((item) => item.family === 'relay').id,
    'heart-chain',
  );
  install(target, ['heart-pierce', 'heart-chain']);
  assert.equal(
    getBuildOffers(target).some((item) => item.family === 'relay'),
    false,
  );
  target.routeIndex = 5;
  assert.equal(
    getBuildOffers(target).find((item) => item.family === 'relay').id,
    'heart-recycle',
  );
  install(target, ['heart-pierce', 'heart-chain', 'heart-recycle']);
  assert.equal(
    getBuildOffers(target).some((item) => item.family === 'relay'),
    false,
  );
});

test('purchases spend coins once at a stop, not points, and never change the car', () => {
  const target = state(),
    offer = getBuildOffers(target).find((item) => item.id === 'heart-pierce');
  target.money = offer.price;
  assert.equal(buyRunMod(target, offer.id), true);
  assert.equal(target.money, 0);
  assert.equal(target.completionPoints, 7);
  assert.equal(target.garage.equipped, 'mix-175');
  assert.deepEqual(target.runBuild.mods, ['heart-pierce']);
  assert.deepEqual(target.runBuild.purchasedLegs, [0]);
  target.money = 9999;
  for (const id of ['heart-pierce', 'charge-shield', '__proto__', null, {}])
    assert.equal(buyRunMod(target, id), false);
  assert.equal(target.money, 9999);
  assert.equal(
    target.events.filter((event) => event.type === 'run-mod-purchase').length,
    1,
  );
  const second = next(target, 2);
  assert.equal(buyRunMod(second, 'heart-chain'), true);
  assert.equal(getBuildModifiers(second).heartChain, 1);
});

test('purchase phase, startup, finale and wallet validation fail without mutation', () => {
  const variants = [
    { status: 'playing' },
    { status: 'lost' },
    { status: 'quiz' },
    { status: 'shop' },
    { campaignStarted: false },
    { campaignComplete: true },
    { money: Infinity },
    { money: NaN },
    { money: '9999' },
    { money: -1 },
    { money: 0 },
    { money: 999.5 },
    { money: 1e100 },
    { routeIndex: 11 },
  ];
  for (const variant of variants) {
    const target = Object.assign(state(), variant),
      before = structuredClone(target);
    assert.equal(
      buyRunMod(target, 'heart-pierce'),
      false,
      JSON.stringify(variant),
    );
    assert.deepEqual(target, before);
  }
});

test('four slots force an explicit paid replacement and cannot refund or repurchase acquired mods', () => {
  const target = install(state({ leg: 5 }), [
    'heart-pierce',
    'heart-chain',
    'charge-shield',
    'air-control',
  ]);
  const offer = getBuildOffers(target).find(
      (item) => item.id === 'heart-recycle',
    ),
    money = target.money;
  assert.equal(offer.requiresReplacement, true);
  assert.equal(offer.installedMods.length, 4);
  for (const replaceId of [
    null,
    'invented',
    'heart-recycle',
    {},
    'constructor',
  ]) {
    assert.equal(buyRunMod(target, offer.id, replaceId), false);
    assert.equal(target.money, money);
  }
  assert.equal(buyRunMod(target, offer.id, 'heart-pierce'), true);
  assert.equal(target.money, money - offer.price);
  assert.equal(target.runBuild.mods.length, 4);
  assert.equal(target.runBuild.mods.includes('heart-pierce'), false);
  assert.equal(target.runBuild.acquiredIds.includes('heart-pierce'), true);
  assert.equal(getBuildModifiers(target).heartPierce, 0);
  assert.equal(getBuildModifiers(target).conversionEnergy, 3);
  const resumed = next(target, 6);
  assert.equal(buyRunMod(resumed, 'heart-pierce', 'heart-recycle'), false);
  assert.equal(
    getBuildOffers(resumed).some((item) => item.family === 'relay'),
    false,
  );
  assert.equal(buyRunMod(resumed, 'charged-heart', 'heart-chain'), true);
  assert.equal(getBuildModifiers(resumed).heartChain, 0);
  assert.equal(getBuildModifiers(resumed).chargedHeartBonus, 1);
});

test('each installed family exposes real complementary mechanics, not unconditional base stat bloat', () => {
  const neutral = getBuildModifiers(state());
  assert.deepEqual(neutral, {
    heartPierce: 0,
    heartChain: 0,
    heartChainRange: 0,
    conversionEnergy: 0,
    chargeShield: false,
    chargeShieldSeconds: 2,
    chargedHeartBonus: 0,
    shieldPiercing: false,
    rushPulse: 0,
    descentMultiplier: 1,
    thrustDrainMultiplier: 1,
    comboFlight: 0,
  });
  const relay = getBuildModifiers(
    install(state(), ['heart-pierce', 'heart-chain', 'heart-recycle']),
  );
  assert.equal(relay.heartPierce, 1);
  assert.equal(relay.heartChain, 1);
  assert.equal(relay.heartChainRange, 32);
  assert.equal(relay.conversionEnergy, 3);
  const guardian = getBuildModifiers(
    install(state(), ['charge-shield', 'charged-heart', 'shield-piercing']),
  );
  assert.equal(guardian.chargeShield, true);
  assert.equal(guardian.chargedHeartBonus, 1);
  assert.equal(guardian.shieldPiercing, true);
  const air = getBuildModifiers(
    install(state(), ['air-control', 'rush-pulse', 'combo-flight']),
  );
  assert.equal(air.descentMultiplier, 0.65);
  assert.equal(air.thrustDrainMultiplier, 0.85);
  assert.equal(air.rushPulse, 45);
  assert.equal(air.comboFlight, 4);
  for (const effects of [relay, guardian, air])
    for (const baseStat of [
      'speed',
      'integrityCapacity',
      'energyCapacity',
      'chargeRate',
      'shotInterval',
    ])
      assert.equal(baseStat in effects, false);
  const readable = describeBuild(
    install(state(), ['air-control', 'rush-pulse', 'combo-flight']),
  );
  assert.equal(readable.capacity, 4);
  assert.equal(readable.installedCount, 3);
  assert.match(readable.name, /空中ラッシュ/);
  assert.equal(readable.mods.length, 3);
});

test('map goal previews match existing EV, event and service consequences and grow gently', () => {
  const target = state();
  const before = JSON.stringify(target);
  for (let leg = 0; leg < 12; leg++)
    for (const kind of ['ev', 'event', 'service']) {
      const goal = getRouteMission(target, route(leg, kind));
      assert.equal(goal.kind, kind);
      assert.ok(goal.reward >= 80 && goal.reward <= 120);
      assert.ok(goal.description.length > 10);
      assert.equal(goal.complete, false);
      if (kind === 'ev')
        assert.ok(goal.goal.chargeSeconds >= 2 && goal.goal.chargeSeconds <= 3);
      if (kind === 'event')
        assert.ok(goal.goal.conversions >= 3 && goal.goal.conversions <= 5);
      if (kind === 'service') assert.match(goal.description, /修理\+20/);
    }
  assert.equal(JSON.stringify(target), before);
  assert.equal(getRouteMission(target, 'invented'), null);
});

test('mission hooks track verified event types once, reject corrupt values, and reset on new road', () => {
  const target = state({ status: 'playing', kind: 'event' });
  assert.equal(routeMissionProgress(target, { type: 'stage-start' }), true);
  assert.equal(
    routeMissionProgress(target, { type: 'convert', entityId: 1, combo: 3 }),
    true,
  );
  assert.equal(
    routeMissionProgress(target, { type: 'convert', entityId: 1, combo: 99 }),
    false,
  );
  assert.equal(
    routeMissionProgress(target, { type: 'collision', entityId: 2 }),
    true,
  );
  assert.equal(
    routeMissionProgress(target, { type: 'collision', entityId: 2 }),
    false,
  );
  routeMissionProgress(target, { type: 'jump-clear', entityId: 3 });
  routeMissionProgress(target, { type: 'jump-clear', entityId: 3 });
  routeMissionProgress(target, { type: 'rush-start' });
  routeMissionProgress(target, { type: 'charged' });
  for (const seconds of [-1, 0, NaN, Infinity, '2', 2])
    assert.equal(
      routeMissionProgress(target, { type: 'charge', seconds }),
      false,
    );
  for (const event of [null, {}, [], { type: '__proto__' }])
    assert.equal(routeMissionProgress(target, event), false);
  const progress = getRouteMission(target).progress;
  assert.equal(progress.conversions, 1);
  assert.equal(progress.bestCombo, 3);
  assert.equal(progress.hits, 1);
  assert.equal(progress.jumpClears, 1);
  assert.equal(progress.rushes, 1);
  assert.equal(progress.fullCharges, 1);
  routeMissionProgress(target, { type: 'stage-start' });
  assert.deepEqual(getRouteMission(target).progress, progress);
  target.routeIndex = 1;
  target.journeyNodeId = route(1).nodeId;
  routeMissionProgress(target, { type: 'stage-start' });
  assert.equal(getRouteMission(target).progress.conversions, 0);
  target.status = 'won';
  assert.equal(
    routeMissionProgress(target, { type: 'convert', entityId: 4 }),
    false,
  );
});

test('EV success, event synergy and service risk settle only after a real arrival', () => {
  for (const kind of ['ev', 'event', 'service']) {
    const target = state({ status: 'playing', kind });
    if (kind === 'ev')
      for (let tick = 0; tick < 240; tick++)
        routeMissionProgress(target, { type: 'charge', seconds: 1 / 120 });
    if (kind === 'event')
      for (let id = 0; id < 5; id++)
        routeMissionProgress(target, {
          type: 'convert',
          entityId: id,
          combo: id + 1,
        });
    if (kind === 'service') {
      routeMissionProgress(target, { type: 'rush-start' });
      for (let id = 0; id < 2; id++)
        routeMissionProgress(target, { type: 'collision', entityId: id });
    }
    assert.equal(getRouteMission(target).complete, true, kind);
    const money = target.money;
    assert.equal(settleRouteReward(target), false);
    assert.equal(target.money, money);
    clear(target);
    const result = settleRouteReward(target);
    assert.deepEqual(result, {
      completed: true,
      reward: 80,
      nodeId: target.journeyNodeId,
    });
    assert.equal(target.money, money + 80);
    assert.equal(target.integrity, 50);
    assert.equal(target.completionPoints, 7);
    assert.equal(settleRouteReward(target), false);
    assert.equal(target.money, money + 80);
    target.runBuild = normalizeRunBuild(
      JSON.stringify(target.runBuild),
      target,
    );
    assert.equal(settleRouteReward(target), false);
    assert.equal(target.money, money + 80);
  }
});

test('missed missions are settled with zero, wrong nodes and corrupt clears never pay', () => {
  const target = state({ status: 'playing', kind: 'service' });
  routeMissionProgress(target, { type: 'rush-start' });
  for (let id = 0; id < 3; id++)
    routeMissionProgress(target, { type: 'collision', entityId: id });
  assert.equal(getRouteMission(target).complete, false);
  clear(target);
  const money = target.money;
  assert.equal(settleRouteReward(target, route(0, 'event')), false);
  assert.deepEqual(settleRouteReward(target), {
    completed: false,
    reward: 0,
    nodeId: target.journeyNodeId,
  });
  target.runBuild.mission.hits = 0;
  assert.equal(settleRouteReward(target), false);
  assert.equal(target.money, money);
  for (const variant of [
    { stagesCompleted: 0 },
    { journey: { completedNodeIds: [] } },
    { money: NaN },
    { status: 'lost' },
    { routeIndex: 1 },
  ]) {
    const corrupted = Object.assign(state(), variant);
    assert.equal(settleRouteReward(corrupted), false);
  }
});

test('retry checkpoint drops in-road mission progress while preserving previous rewards and choices', () => {
  const prior = state();
  buyRunMod(prior, 'heart-pierce');
  prior.runBuild.settledLegs = [0];
  const current = next(prior, 1, 'event');
  current.status = 'playing';
  routeMissionProgress(current, { type: 'stage-start' });
  const checkpoint = JSON.stringify({
    money: current.money,
    runBuild: current.runBuild,
  });
  for (let id = 0; id < 6; id++)
    routeMissionProgress(current, {
      type: 'convert',
      entityId: id,
      combo: id + 1,
    });
  current.money += 400;
  current.status = 'lost';
  assert.equal(settleRouteReward(current), false);
  const loaded = JSON.parse(checkpoint);
  current.money = loaded.money;
  current.runBuild = normalizeRunBuild(loaded.runBuild, current);
  current.status = 'playing';
  assert.equal(getRouteMission(current).progress.conversions, 0);
  assert.equal(current.money, prior.money);
  assert.deepEqual(current.runBuild.mods, ['heart-pierce']);
  assert.deepEqual(current.runBuild.settledLegs, [0]);
  assert.deepEqual(current.runBuild.purchasedLegs, [0]);
});

import {
  createState,
  update,
  nextRoute,
  retryRoute,
  exportCampaignSave,
  restoreCampaignSave,
} from '../public/game-test/src/simulation.js';
const emptyRoad = (target) => {
  target.entities = [];
  target._stations = [];
  target._nextEncounter = 1e9;
  target._quizTriggered = true;
  return target;
};
const actualWin = (target) => {
  emptyRoad(target);
  target.distance = target.routeLength - 0.01;
  update(target, {}, 0.01);
  assert.equal(target.status, 'won');
  return target;
};

test('real simulation relay combines piercing, one-hop chains and conversion energy without duplicate hits', () => {
  const target = install(emptyRoad(createState()), [
    'heart-pierce',
    'heart-chain',
    'heart-recycle',
  ]);
  target.energy = 30;
  target.entities = [40, 64, 115, 139].map((distance, index) => ({
    id: 900 + index,
    type: 'salaryman',
    distance,
    converted: false,
  }));
  update(target, { shoot: true }, 0.01);
  update(target, {}, 1.3);
  assert.equal(target.gyaruConverted, 4);
  assert.equal(target.energy, 42);
  assert.equal(target.runBuild.mission.conversions, 4);
  assert.equal(target.runBuild.mission.bestCombo, 4);
  update(target, {}, 0.1);
  assert.equal(target.gyaruConverted, 4);
  assert.equal(target.energy, 42);
});

test('real simulation guardian charges a guard, full-charge hit and conditional guard-piercing shot', () => {
  const target = install(emptyRoad(createState()), [
    'charge-shield',
    'charged-heart',
    'shield-piercing',
  ]);
  target.energy = 10;
  target.entities = [{ id: 801, type: 'ev', distance: 50, radius: 1000 }];
  update(target, { charge: true }, 2.2);
  assert.equal(target.buildRuntime.shield, 1);
  assert.equal(target.buildRuntime.chargedShot, 1);
  assert.equal(target.energy, target.energyCapacity);
  assert.equal(getRouteMission(target).complete, true);
  target.entities = [35, 55].map((offset, index) => ({
    id: 810 + index,
    type: 'salaryman',
    distance: target.distance + offset,
    hp: 2,
    shielded: true,
  }));
  update(target, { shoot: true }, 0.01);
  update(target, {}, 0.8);
  assert.equal(target.gyaruConverted, 2);
  assert.equal(target.buildRuntime.chargedShot, 0);
  assert.equal(target.buildRuntime.shield, 1);
  const hull = target.integrity;
  target.entities = [
    { id: 820, type: 'cone', distance: target.distance + 0.1 },
  ];
  update(target, {}, 0.01);
  assert.equal(target.integrity, hull);
  assert.equal(target.buildRuntime.shield, 0);
  target.entities = [
    { id: 801, type: 'ev', distance: target.distance, radius: 1000 },
  ];
  update(target, { charge: true }, 0.1);
  assert.equal(
    target.buildRuntime.shield,
    0,
    'a consumed guard must charge for another two seconds, even at the same EV',
  );
  update(target, { charge: true }, 2);
  assert.equal(target.buildRuntime.shield, 1);
});

test('real simulation air family changes descent/drain, pulses at rush start, and rewards a jump only once', () => {
  const regular = emptyRoad(createState()),
    flying = install(emptyRoad(createState()), [
      'air-control',
      'rush-pulse',
      'combo-flight',
    ]);
  for (const target of [regular, flying]) {
    target.altitude = 150;
    target.altitudeVelocity = -200;
    target.jumpHeight = 150 / 112;
    update(target, {}, 0.2);
  }
  assert.ok(flying.altitude > regular.altitude + 10);
  for (const target of [regular, flying]) {
    target.energy = 80;
    update(target, { boost: true }, 0.2);
  }
  assert.ok(flying.energy > regular.energy);
  flying.entities = [
    { id: 850, type: 'salaryman', distance: flying.distance + 40 },
  ];
  update(flying, { rush: true }, 0.01);
  assert.equal(flying.gyaruConverted, 1);
  update(flying, {}, 0.01);
  flying.energy = 50;
  flying.altitude = 70;
  flying.jumpHeight = 70 / 112;
  flying.altitudeVelocity = 0;
  flying.entities = [
    { id: 851, type: 'pothole', distance: flying.distance + 0.2 },
  ];
  update(flying, {}, 0.02);
  assert.equal(flying.energy, 54);
  update(flying, {}, 0.1);
  assert.equal(flying.energy, 54);
});

test('actual save/retry/next-road checkpoints retain builds but cannot farm mission or arrival rewards', () => {
  const target = actualWin(createState());
  target.money = 1000;
  assert.equal(buyRunMod(target, 'heart-pierce'), true);
  const atStop = restoreCampaignSave(exportCampaignSave(target));
  assert.ok(atStop);
  assert.deepEqual(atStop.runBuild, target.runBuild);
  const stopMoney = atStop.money;
  assert.equal(settleRouteReward(atStop), false);
  assert.equal(atStop.money, stopMoney);
  nextRoute(atStop, 'scenic', route(1, 'ev').nodeId);
  emptyRoad(atStop);
  assert.deepEqual(atStop.runBuild.mods, ['heart-pierce']);
  assert.equal(getRouteMission(atStop).progress.chargeSeconds, 0);
  atStop.entities = [{ id: 1001, type: 'ev', distance: 50, radius: 1000 }];
  update(atStop, { charge: true }, 2.1);
  assert.equal(getRouteMission(atStop).complete, true);
  atStop.money += 300;
  atStop.status = 'lost';
  retryRoute(atStop);
  emptyRoad(atStop);
  assert.equal(atStop.money, stopMoney);
  assert.equal(getRouteMission(atStop).progress.chargeSeconds, 0);
  assert.deepEqual(atStop.runBuild.mods, ['heart-pierce']);
  assert.deepEqual(atStop.runBuild.purchasedLegs, [0]);
  const replayed = restoreCampaignSave(exportCampaignSave(atStop));
  assert.deepEqual(replayed.runBuild, atStop.runBuild);
  emptyRoad(replayed);
  replayed.entities = [{ id: 1002, type: 'ev', distance: 50, radius: 1000 }];
  update(replayed, { charge: true }, 2.1);
  actualWin(replayed);
  assert.equal(replayed.money, stopMoney + 80);
  assert.equal(replayed.lastRouteReward.completed, true);
  const reloaded = restoreCampaignSave(exportCampaignSave(replayed));
  assert.equal(settleRouteReward(reloaded), false);
  assert.equal(reloaded.money, stopMoney + 80);
  assert.deepEqual(reloaded.runBuild.settledLegs, [0, 1]);
});

test('event goals use exact full-plan counts with a spare target and conservative combo gaps', () => {
  const target = state({ leg: 8, kind: 'event', status: 'playing' });
  target._encounterPlan = [100, 180, 260, 500, 800, 1000].map((distance) => ({
    type: 'salaryman',
    distance,
  }));
  assert.deepEqual(getRouteMission(target).goal, {
    conversions: 5,
    bestCombo: 3,
  });
  target._encounterPlan = [100, 181, 500, 800].map((distance) => ({
    type: 'salaryman',
    distance,
  }));
  assert.deepEqual(getRouteMission(target).goal, {
    conversions: 3,
    bestCombo: 1,
  });
  target.entities = Array.from({ length: 30 }, (_, id) => ({
    type: 'salaryman',
    id,
    distance: id,
  }));
  assert.deepEqual(getRouteMission(target).goal, {
    conversions: 3,
    bestCombo: 1,
  });
  assert.deepEqual(getRouteMission(target, route(9, 'event')).goal, {
    conversions: 5,
    bestCombo: 3,
  });
  target._encounterPlan = [{ type: 'salaryman', distance: 300 }];
  assert.deepEqual(getRouteMission(target).goal, {
    conversions: 1,
    bestCombo: 1,
  });
  target._encounterPlan = [];
  assert.equal(
    getRouteMission(target).complete,
    false,
    'an empty malformed plan must never grant a free mission',
  );
  delete target._encounterPlan;
  assert.deepEqual(getRouteMission(target).goal, {
    conversions: 5,
    bestCombo: 3,
  });
});

test('seeded actual event roads and exact candidate previews share reachable mission caps', () => {
  for (let seed = 1; seed <= 30; seed++)
    for (let leg = 0; leg < 12; leg++) {
      const node = route(leg, 'event', seed);
      const actual = createState({
        seed,
        routeIndex: leg,
        journeyNodeId: node.nodeId,
      });
      const preview = createState({
        seed,
        routeIndex: node.stageIndex,
        journeyNodeId: node.nodeId,
      });
      const mission = getRouteMission(actual),
        distances = actual._encounterPlan
          .filter((item) => item.type === 'salaryman')
          .map((item) => item.distance)
          .sort((a, b) => a - b);
      let longest = 0,
        consecutive = 0,
        previous = -Infinity;
      for (const distance of distances) {
        consecutive = distance - previous <= 80 ? consecutive + 1 : 1;
        longest = Math.max(longest, consecutive);
        previous = distance;
      }
      assert.ok(
        distances.length >= 1,
        `seed ${seed}, leg ${leg} has no conversion targets`,
      );
      const tier = Math.floor(leg / 4);
      assert.equal(
        mission.goal.conversions,
        Math.max(1, Math.min(3 + tier, distances.length - 1)),
      );
      assert.equal(
        mission.goal.bestCombo,
        Math.max(1, Math.min(2 + (tier === 2 ? 1 : 0), longest)),
      );
      assert.ok(mission.goal.conversions <= distances.length);
      assert.ok(mission.goal.bestCombo <= longest);
      assert.deepEqual(getRouteMission(preview, node).goal, mission.goal);
      actual.entities = [];
      actual.distance = actual.routeLength / 2;
      assert.deepEqual(
        getRouteMission(actual).goal,
        mission.goal,
        'scrolling must not move the goalposts',
      );
    }
});
