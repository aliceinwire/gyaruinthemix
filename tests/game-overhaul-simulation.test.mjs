import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  nextRoute,
  retryRoute,
  answerQuiz,
  buyUpgrade,
  upgradePrice,
  ROUTES,
  ROUTE_OPTIONS,
} from '../public/game/src/simulation.js';

function purchase(s, id) {
  s.status = 'won';
  s.money = 9999;
  return buyUpgrade(s, id);
}
function emptyRoad(options = {}) {
  const s = createState(options);
  s.entities = [];
  s._nextEncounter = 1e9;
  s._stations = [];
  s._quizTriggered = true;
  return s;
}
const entity = (type, distance, id = 999, details = {}) => ({
  id,
  type,
  distance,
  lane: 1,
  resolved: false,
  ...details,
});
const almost = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≈ ${b}`);

test('one six-club story campaign; steering/acceleration/endless do not exist', () => {
  const s = emptyRoad({ mode: 'endless' });
  assert.equal(s.mode, 'story');
  assert.equal(ROUTES.length, 12);
  assert.equal(new Set(ROUTES.map((r) => r.cityId)).size, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  update(s, { throttle: false, brake: true, left: true, right: true }, 2);
  assert.equal(s.speed, ROUTE_OPTIONS.scenic.speed);
  assert.equal(s.lane, 1);
  assert.ok(s.distance > 50);
  assert.equal(s.timeRemaining, null);
});
test('road choice changes length, speed, EV frequency and generation', () => {
  const a = createState({ routeOption: 'scenic', seed: 42 }),
    b = createState({ routeOption: 'express', seed: 42 });
  assert.ok(b.routeLength < a.routeLength);
  assert.ok(b.speed > a.speed);
  assert.ok(a._stations.length > b._stations.length);
  assert.notDeepEqual(a.entities, b.entities);
});
test('hold thrusters to lift, release to land, no passive charging', () => {
  const s = emptyRoad();
  update(s, { boost: true }, 0.1);
  assert.ok(s.jumpHeight > 0 && s.jumpHeight < 1);
  assert.ok(s.energy < 100);
  update(s, { boost: true }, 1.5);
  assert.equal(s.jumpHeight, 2.6);
  const energy = s.energy;
  update(s, {}, 2);
  assert.equal(s.jumpHeight, 0);
  assert.equal(s.energy, energy);
  s.energy = 0;
  update(s, { boost: true }, 1);
  assert.equal(s.jumpHeight, 0);
});
test('thrusters clear potholes while hearts cannot remove them', () => {
  const a = emptyRoad();
  a.entities = [entity('pothole', 45)];
  update(a, { boost: true }, 2.1);
  assert.equal(a.integrity, 100);
  assert.ok(a.events.some((e) => e.type === 'jump-clear'));
  const b = emptyRoad();
  b.entities = [entity('pothole', 45)];
  update(b, { shoot: true }, 2.1);
  assert.ok(b.integrity < 100);
});
test('hearts convert a salaryman once into a harmless paid fan', () => {
  const s = emptyRoad();
  s.entities = [entity('salaryman', 100)];
  update(s, { shoot: true }, 1);
  assert.equal(s.gyaruConverted, 1);
  assert.equal(s.totalFans, 0);
  assert.equal(s.money, 45);
  assert.equal(s.entities[0].type, 'gyaru');
  assert.equal(s.entities[0].converted, true);
  const event = s.events.find((e) => e.type === 'convert');
  assert.equal(event.reward, 45);
  assert.equal(event.money, 45);
  update(s, { shoot: true }, 5);
  assert.equal(s.gyaruConverted, 1);
  assert.equal(s.totalFans, 0);
  assert.equal(s.money, 45);
  assert.equal(s.integrity, 100);
});
test('consecutive conversions increase combo money; expiry resets it', () => {
  const s = emptyRoad();
  s.entities = [
    entity('salaryman', 100, 1),
    entity('salaryman', 160, 2),
    entity('salaryman', 220, 3),
  ];
  update(s, { shoot: true }, 3);
  assert.equal(s.gyaruConverted, 3);
  assert.equal(s.totalFans, 0);
  assert.equal(s.combo, 3);
  assert.equal(s.money, 162);
  update(s, {}, 6);
  assert.equal(s.combo, 0);
  assert.equal(s.bestCombo, 3);
});
test('barriers take two hearts and pay score but no money', () => {
  const s = emptyRoad();
  s.entities = [entity('barrier', 130, 999, { hp: 2 })];
  update(s, { shoot: true }, 1.6);
  assert.equal(s.entities.length, 0);
  assert.equal(s.money, 0);
  assert.equal(s.totalFans, 0);
  assert.ok(s.events.some((e) => e.type === 'destroy'));
});
test('high airborne shots do not auto-target ground salarymen', () => {
  const s = emptyRoad();
  s.altitude = 112;
  s.jumpHeight = 1;
  s.entities = [entity('salaryman', 100)];
  update(s, { boost: true, shoot: true }, 1);
  assert.equal(s.totalFans, 0);
});
test('hold charge only refills at an EV, grounded; jump deliberately escapes charging', () => {
  const s = emptyRoad();
  s.energy = 10;
  update(s, { charge: true }, 1);
  assert.equal(s.energy, 10);
  s.entities = [entity('ev', s.distance, 999, { radius: 72 })];
  update(s, { charge: true, shoot: true }, 1);
  assert.ok(s.energy > 51 && s.energy < 53);
  assert.equal(s.jumpHeight, 0);
  assert.equal(s.projectiles.length, 0);
  assert.equal(s.charging, true);
  assert.ok(s.events.some((e) => e.type === 'charge-start'));
  const energy = s.energy;
  update(s, {}, 0.2);
  assert.equal(s.energy, energy);
  update(s, { charge: true, boost: true }, 0.1);
  assert.equal(s.charging, false);
  assert.ok(s.altitude > 0);
});
test('collision emits correct event, grace prevents duplicate row damage, large dt cannot tunnel', () => {
  const s = emptyRoad();
  s.entities = [entity('barrier', 50, 1), entity('barrier', 51, 2)];
  update(s, {}, 4);
  assert.equal(s.integrity, 78);
  assert.equal(s.events.filter((e) => e.type === 'collision').length, 1);
  assert.equal(s.lastHit.entityType, 'barrier');
});
test('reaching each club wins; final city unlocks DJ ending', () => {
  for (const routeIndex of [0, 5, 11]) {
    const s = emptyRoad({ routeIndex });
    s.distance = s.routeLength - 1;
    update(s, {}, 0.1);
    assert.equal(s.status, 'won');
    assert.equal(s.campaignComplete, routeIndex === 11);
    assert.equal(s.stagesCompleted, 1);
  }
});
test('zero integrity loses and terminal simulation freezes', () => {
  const s = emptyRoad();
  s.integrity = 1;
  s.entities = [entity('barrier', 20)];
  update(s, {}, 0.1);
  assert.equal(s.status, 'lost');
  assert.equal(s.reason, 'integrity');
  const distance = s.distance;
  update(s, { boost: true }, 1);
  assert.equal(s.distance, distance);
});
test('club coins buy current-car upgrades and repairs only at stops', () => {
  const s = emptyRoad();
  s.money = 9999;
  for (const id of ['repair', 'battery', 'hearts', 'charger', 'armor'])
    assert.equal(buyUpgrade(s, id), false);
  s.status = 'won';
  assert.equal(upgradePrice(s, 'battery'), 120);
  assert.equal(buyUpgrade(s, 'battery'), true);
  assert.equal(s.energyCapacity, 130);
  assert.equal(s.energy, 100);
  assert.equal(upgradePrice(s, 'battery'), 240);
  for (let level = 2; level <= 6; level++)
    assert.equal(buyUpgrade(s, 'battery'), true);
  assert.equal(upgradePrice(s, 'battery'), null);
  assert.equal(buyUpgrade(s, 'battery'), false);
  assert.equal(buyUpgrade(s, 'unknown'), false);
  assert.equal(buyUpgrade(s, 'repair'), false);
  s.integrity = 40;
  const money = s.money;
  assert.equal(buyUpgrade(s, 'repair'), true);
  assert.equal(s.integrity, 85);
  assert.equal(s.money, money - 70);
  buyUpgrade(s, 'repair');
  assert.equal(s.integrity, 100);
  assert.equal(buyUpgrade(s, 'repair'), false);
});
test('next route keeps upgrades, money and fans; complimentary service refills the battery', () => {
  const s = emptyRoad();
  purchase(s, 'battery');
  purchase(s, 'hearts');
  s.status = 'won';
  s.money = 500;
  s.totalFans = 9;
  s.stageFans = 9;
  s.integrity = 72;
  s.energy = 43;
  s.totalDistance = 1680;
  s.stagesCompleted = 1;

  const money = s.money;
  assert.equal(nextRoute(s, 'express'), s);
  assert.equal(s.routeIndex, 1);
  assert.equal(s.routeOption, 'express');
  assert.equal(s.status, 'playing');
  assert.equal(s.money, money);
  assert.equal(s.totalFans, 9);
  assert.equal(s.stageFans, 0);
  assert.equal(s.upgrades.battery, 1);
  assert.equal(s.upgrades.hearts, 1);
  assert.equal(s.energyCapacity, 130);
  assert.equal(s.energy, 130);
  assert.equal(s.integrity, 72);
  assert.equal(s.totalDistance, 1680);
  assert.equal(s.stagesCompleted, 1);
});
test('retry restores stage-start state: no money/fan farming or erased purchases', () => {
  const s = emptyRoad();
  purchase(s, 'battery');
  s.status = 'won';
  s.money = 600;
  s.totalFans = 4;
  nextRoute(s, 'express');
  const baseline = structuredClone(s._stageStart);
  s.money += 500;
  s.totalFans += 8;
  s.integrity = 0;
  s.energy = 0;
  s.status = 'lost';
  retryRoute(s);
  assert.equal(s.status, 'playing');
  assert.equal(s.distance, 0);
  assert.equal(s.routeIndex, 1);
  assert.equal(s.routeOption, 'express');
  assert.equal(s.money, baseline.money);
  assert.equal(s.totalFans, baseline.totalFans);
  assert.equal(s.integrity, baseline.integrity);
  assert.equal(s.energy, baseline.energy);
  assert.deepEqual(s.upgrades, baseline.upgrades);
});
test('seeded generation and inputs yield exactly reproducible outcomes', () => {
  const a = createState({ seed: 'gyaru', routeOption: 'express' }),
    b = createState({ seed: 'gyaru', routeOption: 'express' });
  assert.notDeepEqual(a.entities, createState({ seed: 'other' }).entities);
  for (let i = 0; i < 600; i++) {
    const input = { shoot: true, boost: i >= 400 && i < 450, charge: i >= 500 };
    update(a, input, 1 / 60);
    update(b, input, 1 / 60);
  }
  assert.deepEqual(a, b);
});
test('auto driving has stable physics at 30/60/120 fps', () => {
  const states = [30, 60, 120].map((fps) => {
    const s = emptyRoad();
    for (let i = 0; i < fps * 6; i++) update(s, {}, 1 / fps);
    return s;
  });
  for (const s of states.slice(1)) almost(s.distance, states[0].distance);
});
function play(routeIndex, routeOption, seed, environment = {}) {
  const s = createState({ routeIndex, routeOption, seed, ...environment });
  const ids = new Set();
  let fansSeen = 0;
  for (
    let frame = 0;
    frame < 9000 && ['playing', 'quiz'].includes(s.status);
    frame++
  ) {
    if (s.status === 'quiz') {
      answerQuiz(s, true);
      continue;
    }
    for (const item of s.entities) {
      if (item.type === 'salaryman' && !ids.has(item.id)) {
        ids.add(item.id);
        fansSeen++;
      }
      if (['salaryman', 'barrier', 'cone', 'pothole'].includes(item.type))
        assert.ok(
          s._stations.every(
            (p) =>
              Math.abs(p - item.distance) >
              ROUTE_OPTIONS[routeOption].stationRadius,
          ),
        );
    }
    const hazard = s.entities.find(
      (e) =>
        !e.cleared &&
        !e.resolved &&
        e.type === 'pothole' &&
        e.distance > s.distance - 1 &&
        e.distance - s.distance < 54,
    );
    const station = s.entities.find(
      (e) => e.type === 'ev' && Math.abs(e.distance - s.distance) <= e.radius,
    );
    update(
      s,
      {
        shoot: !hazard,
        boost: Boolean(hazard),
        charge: Boolean(station && !hazard),
      },
      1 / 60,
    );
  }
  return { s, fansSeen };
}
test('all cities/branches are winnable, EV zones safe and express has more fans per metre', () => {
  let scenicDensity = 0,
    expressDensity = 0;
  for (let routeIndex = 0; routeIndex < ROUTES.length; routeIndex++)
    for (const routeOption of ['scenic', 'express'])
      for (const seed of [1, 42, 175]) {
        const { s, fansSeen } = play(routeIndex, routeOption, seed);
        assert.equal(
          s.status,
          'won',
          `${routeIndex}/${routeOption}/${seed}: ${s.reason}`,
        );
        assert.ok(s.totalFans > 0);
        assert.ok(s.money >= 45);
        assert.ok(s.integrity > 0);
        if (routeOption === 'scenic') scenicDensity += fansSeen / s.routeLength;
        else expressDensity += fansSeen / s.routeLength;
      }
  assert.ok(
    expressDensity > scenicDensity * 1.2,
    `${expressDensity} vs ${scenicDensity}`,
  );
});

test('fan quiz pauses in a safe EV zone; only a correct answer recruits a fan', () => {
  for (const correct of [true, false]) {
    const s = createState();
    s.entities = [];
    s._nextEncounter = 1e9;
    s.distance = s._quizDistance - 20.1;
    update(s, {}, 0.1);
    assert.equal(s.status, 'quiz');
    assert.ok(s.pendingQuiz);
    assert.ok(s.events.some((e) => e.type === 'quiz'));
    const distance = s.distance;
    const elapsed = s.elapsed;
    update(s, { boost: true }, 5);
    assert.equal(s.distance, distance);
    assert.equal(s.elapsed, elapsed);
    assert.equal(answerQuiz(s, correct), true);
    assert.equal(s.status, 'playing');
    assert.equal(s.totalFans, correct ? 1 : 0);
    assert.equal(s.gyaruConverted, 0);
    assert.equal(s.money, 0);
    assert.equal(answerQuiz(s, true), false);
    assert.equal(s.totalFans, correct ? 1 : 0);
    update(s, {}, 0.1);
    assert.equal(s.status, 'playing');
  }
});
test('failed retry cannot farm a correctly answered fan quiz or conversion cash', () => {
  const s = createState();
  s.entities = [];
  s._nextEncounter = 1e9;
  s.distance = s._quizDistance - 20.1;
  update(s, {}, 0.1);
  answerQuiz(s, true);
  assert.equal(s.totalFans, 1);
  s.money = 500;
  s.gyaruConverted = 9;
  s.status = 'lost';
  retryRoute(s);
  assert.equal(s.totalFans, 0);
  assert.equal(s.money, 0);
  assert.equal(s.gyaruConverted, 0);
  assert.equal(s._quizTriggered, false);
  assert.equal(s._quizAnswered, false);
});

test('all 768 stage-road-season-weather combinations remain winnable', () => {
  for (let routeIndex = 0; routeIndex < ROUTES.length; routeIndex++)
    for (const routeOption of ['scenic', 'express'])
      for (const season of ['spring', 'summer', 'autumn', 'winter'])
        for (const weather of [
          'sunny',
          'cloudy',
          'rain',
          'storm',
          'snow',
          'fog',
          'mud',
          'wind',
        ]) {
          const { s } = play(routeIndex, routeOption, 175, { season, weather });
          assert.equal(
            s.status,
            'won',
            `${routeIndex}/${routeOption}/${season}/${weather}: ${s.reason}`,
          );
          assert.ok(s.integrity > 0);
          assert.ok(s.money >= 45);
          assert.equal(s.totalFans, 1);
        }
});
