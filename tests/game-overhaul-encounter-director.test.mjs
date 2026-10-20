import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEncounterPlan,
  updateEncounterActor,
  getEncounterPhase,
  ENCOUNTER_RULES,
} from '../public/game-test/src/encounter-director.js';
import {
  createState,
  ROUTE_OPTIONS,
} from '../public/game-test/src/simulation.js';
import { DRIVING_PACE } from '../public/game-test/src/pace.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';

const METRES_PER_SECOND = ENCOUNTER_RULES.maximumSupportedSpeed / 3.6;
const RADII = { salaryman: 15, cone: 21, barrier: 27, pothole: 21 };
const near = (a, b, epsilon = 1e-7) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} should equal ${b}`);
function routeOptions(stage, seed, kindIndex = 1) {
  const node = getJourneyChoices(stage, seed)[kindIndex];
  const state = createState({
    routeIndex: stage,
    seed,
    journeyNodeId: node.nodeId,
  });
  return {
    seed,
    routeIndex: stage,
    routeLength: state.routeLength,
    node,
    stations: state._stations,
    stationRadius: ROUTE_OPTIONS[state.routeOption].stationRadius,
  };
}
function actorFor(behavior, details = {}) {
  for (let seed = 1; seed < 200; seed++) {
    const actor = createEncounterPlan({
      seed,
      routeIndex: 8,
      routeLength: 2200,
      stations: [],
      node: { kind: 'event' },
    }).find((item) => item.behavior === behavior && !item.elite);
    if (actor)
      return {
        ...actor,
        distance: 400,
        motionBaseDistance: 400,
        telegraphBaseDistance: 400,
        ...details,
      };
  }
  assert.fail(`Missing ${behavior} actor`);
}
function assertFiniteTree(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (Array.isArray(value)) value.forEach(assertFiniteTree);
  else if (value && typeof value === 'object')
    Object.values(value).forEach(assertFiniteTree);
}

test('plans are deterministic, deeply safe to share and consume no ambient randomness', () => {
  const options = routeOptions(8, 'tour-night');
  const before = JSON.stringify(options);
  const ambient = Math.random;
  Math.random = () => {
    throw new Error('Unseeded randomness');
  };
  try {
    const a = createEncounterPlan(options),
      b = createEncounterPlan(options);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(options), before);
    assert.ok(Object.isFrozen(a));
    assert.ok(
      a.every(
        (item) => Object.isFrozen(item) && Object.isFrozen(item.telegraph),
      ),
    );
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  } finally {
    Math.random = ambient;
  }
});

test('nearby seeds and district choices vary deterministic phrase and visual details', () => {
  const fingerprints = new Set();
  for (let seed = 1; seed <= 100; seed++)
    fingerprints.add(
      JSON.stringify(createEncounterPlan(routeOptions(9, seed))),
    );
  assert.equal(fingerprints.size, 100);
  const sameSeed = getJourneyChoices(7, 42).map((node) =>
    createEncounterPlan({ seed: 42, routeIndex: 7, routeLength: 1700, node }),
  );
  assert.notDeepEqual(sameSeed[0], sameSeed[1]);
  assert.notDeepEqual(sameSeed[1], sameSeed[2]);
});

test('first road has a visible stationary heart lesson before an isolated lift lesson', () => {
  for (let seed = 1; seed <= 30; seed++)
    for (let kind = 0; kind < 3; kind++) {
      const plan = createEncounterPlan(routeOptions(0, seed, kind));
      assert.equal(plan[0].type, 'salaryman');
      assert.equal(plan[0].distance, 80 * DRIVING_PACE.speedMultiplier);
      assert.equal(plan[1].type, 'pothole');
      assert.equal(plan[1].distance, 185 * DRIVING_PACE.speedMultiplier);
      assert.ok(
        (plan[0].distance - RADII.salaryman) / METRES_PER_SECOND >=
          ENCOUNTER_RULES.minimumCounterTime,
      );
      assert.ok(
        plan.every((actor) => actor.behavior === 'steady' && !actor.elite),
      );
      assert.deepEqual(
        plan.filter((actor) => actor.tutorial).map((actor) => actor.beat),
        ['first-heart', 'first-lift'],
      );
    }
  for (let stage = 1; stage < 12; stage++)
    assert.ok(
      createEncounterPlan(routeOptions(stage, 42)).every(
        (actor) => !actor.tutorial,
      ),
    );
});

test('whole motion envelopes preserve charging zones, response gaps and arrival clearance', () => {
  for (let stage = 0; stage < 12; stage++)
    for (let seed = 1; seed <= 40; seed++)
      for (let kind = 0; kind < 3; kind++) {
        const options = routeOptions(stage, seed, kind),
          plan = createEncounterPlan(options);
        let previous = null;
        for (const actor of plan) {
          assert.ok(Object.hasOwn(RADII, actor.type));
          assert.ok(actor.distance >= 80);
          assert.ok(
            actor.distance <=
              options.routeLength - ENCOUNTER_RULES.arrivalClearance,
          );
          assert.ok(actor.hp >= 1 && actor.hp <= 4);
          assert.equal(actor.maxHp, actor.hp);
          assert.ok(
            actor.motionAmplitude >= 0 &&
              actor.motionAmplitude <= ENCOUNTER_RULES.maximumMotion,
          );
          assert.ok(
            actor.telegraph.counterWindow >= ENCOUNTER_RULES.minimumCounterTime,
          );
          assert.ok(
            actor.telegraph.anticipation >= ENCOUNTER_RULES.minimumCounterTime,
          );
          assert.ok(
            actor.telegraph.leadDistance <= ENCOUNTER_RULES.warningViewDistance,
          );
          for (const station of options.stations)
            assert.ok(
              Math.abs(actor.distance - station) + 1e-7 >=
                options.stationRadius +
                  RADII[actor.type] +
                  actor.motionAmplitude +
                  ENCOUNTER_RULES.stationBuffer,
              `${stage}/${seed}/${kind}: ${actor.type} in station envelope`,
            );
          if (
            previous &&
            actor.cluster &&
            actor.encounterId === previous.encounterId
          ) {
            assert.equal(actor.type, 'salaryman');
            assert.equal(previous.type, 'salaryman');
            assert.ok(['steady', 'sway'].includes(actor.behavior));
            assert.equal(actor.behavior, previous.behavior);
            assert.equal(actor.motionAmplitude, previous.motionAmplitude);
            assert.equal(actor.motionRate, previous.motionRate);
            assert.equal(actor.motionPhase, previous.motionPhase);
            near(actor.distance - previous.distance, 28);
            assert.equal(actor.clusterGrace, 1.7);
            assert.equal(
              actor.telegraphBaseDistance,
              previous.telegraphBaseDistance,
            );
            assert.equal(actor.telegraph, previous.telegraph);
          } else if (previous) {
            const space =
              actor.distance -
              previous.distance -
              RADII[actor.type] -
              actor.motionAmplitude -
              RADII[previous.type] -
              previous.motionAmplitude;
            assert.ok(
              space + 1e-7 >=
                METRES_PER_SECOND * ENCOUNTER_RULES.minimumCounterTime,
              `${stage}/${seed}: gap ${space}`,
            );
          }
          previous = actor;
        }
      }
});

test('all grammar beats occur, later roads gain behavior complexity and club elites remain readable', () => {
  const beats = new Set(),
    types = new Set(),
    behaviors = new Set();
  const specialByStage = Array(12).fill(0),
    totalByStage = Array(12).fill(0);
  for (let stage = 0; stage < 12; stage++)
    for (let seed = 1; seed <= 60; seed++)
      for (let kind = 0; kind < 3; kind++) {
        const plan = createEncounterPlan(routeOptions(stage, seed, kind));
        for (const actor of plan) {
          beats.add(actor.beat);
          types.add(actor.type);
          behaviors.add(actor.behavior);
          specialByStage[stage] += actor.behavior !== 'steady';
          totalByStage[stage]++;
        }
        if (stage >= 5 && (stage % 2 === 1 || stage === 10)) {
          const elite = plan.filter((actor) => actor.elite);
          assert.equal(
            elite.length,
            1,
            `Missing club anchor ${stage}/${seed}/${kind}`,
          );
          assert.equal(elite[0].behavior, 'shield');
          assert.equal(elite[0].hp, stage === 11 ? 4 : 3);
          assert.equal(
            elite[0].beat,
            stage === 11 ? 'finale-anchor' : 'club-anchor',
          );
        } else assert.ok(plan.every((actor) => !actor.elite));
      }
  assert.deepEqual([...types].sort(), [
    'barrier',
    'cone',
    'pothole',
    'salaryman',
  ]);
  assert.deepEqual([...behaviors].sort(), [
    'charger',
    'shield',
    'steady',
    'sway',
  ]);
  assert.ok(beats.size >= 18);
  assert.equal(specialByStage[0], 0);
  assert.equal(specialByStage[1], 0);
  assert.ok(specialByStage[11] / totalByStage[11] > 0.35);
  assert.ok(
    specialByStage[11] / totalByStage[11] > specialByStage[3] / totalByStage[3],
  );
});

test('low ceilings never combine with a mandatory jump-only threat', () => {
  for (const constraint of [{ lowCeiling: true }, { maxAltitude: 12 }]) {
    for (let stage = 0; stage < 12; stage++) {
      const plan = createEncounterPlan({
        seed: 7,
        routeIndex: stage,
        routeLength: 1800,
        node: { kind: 'event', ...constraint },
      });
      assert.ok(plan.length > 0);
      assert.ok(
        plan.every(
          (actor) => actor.type !== 'pothole' && actor.requiresHover === false,
        ),
      );
    }
  }
});

test('charger preserves full anticipation and a counter window even at top rush speed', () => {
  const actor = actorFor('charger');
  const trigger = actor.motionBaseDistance - actor.warningDistance;
  const startTime = trigger / METRES_PER_SECOND;
  updateEncounterActor(
    actor,
    {
      elapsed: startTime,
      distance: trigger,
      speed: ENCOUNTER_RULES.maximumSupportedSpeed,
    },
    1 / 120,
  );
  assert.equal(actor.behaviorPhase, 'tell');
  near(actor.encounterStartedAt, startTime);
  updateEncounterActor(
    actor,
    {
      elapsed: startTime + actor.anticipation - 0.001,
      distance: trigger + METRES_PER_SECOND * (actor.anticipation - 0.001),
      speed: ENCOUNTER_RULES.maximumSupportedSpeed,
    },
    0.1,
  );
  assert.equal(actor.behaviorPhase, 'tell');
  near(actor.distance, 400);
  const worstCaseGap =
    actor.warningDistance -
    METRES_PER_SECOND * actor.anticipation -
    actor.motionAmplitude -
    RADII.salaryman;
  assert.ok(
    worstCaseGap / METRES_PER_SECOND >=
      ENCOUNTER_RULES.minimumCounterTime - 1e-8,
  );
  for (let age = 0; age <= 5; age += 0.01) {
    updateEncounterActor(
      actor,
      {
        elapsed: startTime + age,
        distance: trigger + METRES_PER_SECOND * age,
        speed: ENCOUNTER_RULES.maximumSupportedSpeed,
      },
      0.01,
    );
    assert.ok(
      actor.distance >= 400 - actor.motionAmplitude - 1e-8 &&
        actor.distance <= 400 + 1e-8,
    );
  }
  assert.equal(actor.behaviorPhase, 'open');
  near(actor.distance, 400);
});

test('charger threshold interpolation and all actor movement are frame-partition independent', () => {
  for (const behavior of ['steady', 'sway', 'charger', 'shield']) {
    const run = (step) => {
      const actor = actorFor(behavior);
      updateEncounterActor(
        actor,
        {
          elapsed: 0,
          distance: 0,
          speed: ENCOUNTER_RULES.maximumSupportedSpeed,
        },
        0,
      );
      for (let elapsed = step; elapsed < 7 + step / 2; elapsed += step)
        updateEncounterActor(
          actor,
          {
            elapsed,
            distance: elapsed * METRES_PER_SECOND,
            speed: ENCOUNTER_RULES.maximumSupportedSpeed,
          },
          step,
        );
      return actor;
    };
    const a = run(1 / 30),
      b = run(1 / 120);
    near(a.distance, b.distance);
    near(a.motionOffset, b.motionOffset);
    near(a.encounterStartedAt, b.encounterStartedAt);
    near(a.encounterAge, b.encounterAge);
    assert.equal(a.behaviorPhase, b.behaviorPhase);
    assert.equal(a.shielded, b.shielded);
  }
});

test('shield advertises guarded/open phases and cannot close on the final response window', () => {
  const actor = actorFor('shield');
  updateEncounterActor(
    actor,
    { elapsed: 0, distance: 0, speed: ENCOUNTER_RULES.maximumSupportedSpeed },
    0,
  );
  assert.equal(actor.shielded, true);
  assert.equal(actor.vulnerable, false);
  const trigger = 400 - actor.warningDistance;
  const start = trigger / METRES_PER_SECOND;
  updateEncounterActor(
    actor,
    {
      elapsed: start,
      distance: trigger,
      speed: ENCOUNTER_RULES.maximumSupportedSpeed,
    },
    0.01,
  );
  assert.equal(actor.behaviorPhase, 'guard');
  updateEncounterActor(
    actor,
    {
      elapsed: start + actor.anticipation + 0.05,
      distance: trigger + 30,
      speed: 90,
    },
    0.05,
  );
  assert.equal(actor.behaviorPhase, 'open');
  assert.equal(actor.vulnerable, true);
  for (let age = 0; age < 20; age += 0.07) {
    updateEncounterActor(
      actor,
      {
        elapsed: start + age,
        distance: 400 - RADII.salaryman - METRES_PER_SECOND * 1.75,
        speed: ENCOUNTER_RULES.maximumSupportedSpeed,
      },
      0.07,
    );
    assert.equal(actor.shielded, false);
    assert.ok(actor.counterWindow >= ENCOUNTER_RULES.minimumCounterTime);
  }
});

test('sway stays inside its reserved envelope; converted and cleared actors do not move', () => {
  const actor = actorFor('sway');
  for (let elapsed = 0; elapsed < 120; elapsed += 0.13) {
    updateEncounterActor(actor, { elapsed, distance: 0, speed: 92 }, 0.13);
    assert.ok(Math.abs(actor.distance - 400) <= actor.motionAmplitude + 1e-8);
    near(
      actor.distance,
      400 +
        Math.sin(elapsed * actor.motionRate + actor.motionPhase) *
          actor.motionAmplitude,
    );
  }
  const converted = { ...actor, converted: true },
    cleared = { ...actor, cleared: true },
    legacy = { type: 'salaryman', distance: 80 };
  for (const target of [converted, cleared, legacy]) {
    const before = { ...target };
    assert.equal(
      updateEncounterActor(target, { elapsed: 999, distance: 300 }, 0.1),
      target,
    );
    assert.deepEqual(target, before);
  }
});

test('phase HUD identifies safe charging, nearest active threat and finale without mutation', () => {
  const state = {
    routeIndex: 11,
    routeLength: 1600,
    distance: 1200,
    entities: [
      {
        type: 'salaryman',
        distance: 1350,
        behavior: 'shield',
        elite: true,
        encounterId: 'final',
      },
      { type: 'pothole', distance: 1250, cleared: true },
    ],
  };
  const before = JSON.stringify(state);
  const phase = getEncounterPhase(state);
  assert.equal(phase.id, 'finale');
  assert.equal(phase.finale, true);
  assert.equal(phase.elite, true);
  assert.equal(phase.nextThreatDistance, 150);
  assert.equal(phase.nextBehavior, 'shield');
  assert.equal(phase.encounterId, 'final');
  assert.equal(phase.breathingRoom, false);
  assert.equal(JSON.stringify(state), before);
  const recharge = getEncounterPhase({ ...state, atStation: true });
  assert.equal(recharge.id, 'recharge');
  assert.equal(recharge.breathingRoom, true);
  assert.equal(getEncounterPhase({ ...state, status: 'won' }).id, 'arrival');
  assert.equal(
    getEncounterPhase({ ...state, entities: [] }).breathingRoom,
    true,
  );
});

test('malformed, short and blocked routes remain bounded, JSON-safe and finite', () => {
  for (const options of [
    null,
    undefined,
    {},
    {
      seed: NaN,
      routeIndex: Infinity,
      routeLength: Infinity,
      stations: [NaN, Infinity, null, {}, 300],
      stationRadius: Infinity,
    },
    { routeLength: -1 },
    { routeLength: 40 },
    {
      routeLength: 1000000,
      stations: [],
      node: { encounterSpacingMultiplier: -999 },
    },
    { routeLength: 300, stations: [0, 100, 200, 300], stationRadius: 200 },
  ]) {
    const plan = createEncounterPlan(options);
    assertFiniteTree(plan);
    assert.ok(plan.length <= 3002);
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  }
  assert.deepEqual(createEncounterPlan({ routeLength: 40 }), []);
  assert.deepEqual(
    createEncounterPlan({
      routeLength: 300,
      stations: [0, 100, 200, 300],
      stationRadius: 200,
    }),
    [],
  );
  assert.equal(updateEncounterActor(null), null);
  const corrupt = {
    directorManaged: true,
    type: 'salaryman',
    behavior: 'charger',
    distance: NaN,
    motionBaseDistance: Infinity,
    motionAmplitude: NaN,
    anticipation: Infinity,
    warningDistance: NaN,
  };
  updateEncounterActor(
    corrupt,
    { elapsed: NaN, distance: Infinity, speed: -Infinity },
    NaN,
  );
  for (const key of [
    'distance',
    'motionOffset',
    'encounterAge',
    'warningDistance',
    'telegraphProgress',
    'counterWindow',
  ])
    assert.ok(Number.isFinite(corrupt[key]), key);
  assertFiniteTree(
    getEncounterPhase({
      routeIndex: NaN,
      routeLength: Infinity,
      distance: NaN,
      entities: [null, {}, { distance: NaN, type: 'salaryman' }],
    }),
  );
});

test('event-path crowd clusters enable short-range chaining without mixed-action traps', () => {
  let groups = 0,
    lateCount = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const plan = createEncounterPlan(routeOptions(11, seed));
    lateCount += plan.length;
    for (const actor of plan.filter(
      (actor) => actor.cluster && actor.phraseIndex === 0,
    )) {
      const cluster = plan.filter(
        (item) => item.encounterId === actor.encounterId,
      );
      assert.equal(cluster.length, 2);
      assert.ok(
        cluster.every(
          (item) =>
            item.type === 'salaryman' &&
            ['steady', 'sway'].includes(item.behavior) &&
            item.hp === 1 &&
            !item.elite,
        ),
      );
      assert.ok(cluster[1].distance - cluster[0].distance <= 32);
      assert.ok(cluster.every((item) => item.clusterGrace >= 1.7));
      groups++;
    }
  }
  assert.ok(
    groups >= 75,
    `Expected useful crowd-group distribution, got ${groups}`,
  );
  assert.ok(lateCount / 100 >= 8, `Late event-road density ${lateCount / 100}`);
});

test('later roads require separated hover decisions instead of solving every threat by holding fire', () => {
  for (let stage = 4; stage < 12; stage++)
    for (let seed = 1; seed <= 100; seed++)
      for (let kind = 0; kind < 3; kind++) {
        const plan = createEncounterPlan(routeOptions(stage, seed, kind));
        const holes = plan.filter((actor) => actor.type === 'pothole');
        const quota = stage >= 6 && kind !== 0 ? 3 : 2;
        assert.ok(
          holes.length >= quota,
          `Expected ${quota} lift checks at ${stage}/${seed}/${kind}, got ${holes.length}`,
        );
        assert.ok(
          holes.every((actor) => actor.requiresHover && !actor.cluster),
        );
      }
});

test('every event-road objective has enough reachable conversion targets across real routes', () => {
  for (let stage = 0; stage < 12; stage++)
    for (let seed = 1; seed <= 200; seed++) {
      const plan = createEncounterPlan(routeOptions(stage, seed));
      const targets = plan.filter((actor) => actor.type === 'salaryman');
      assert.ok(
        targets.length >= (stage >= 4 ? 5 : 3),
        `Insufficient targets ${stage}/${seed}: ${targets.length}`,
      );
    }
});

test('synchronized crowd sway retains chain range and a common tell at every frame', () => {
  let pair = null;
  for (let seed = 1; seed <= 100 && !pair; seed++) {
    const plan = createEncounterPlan(routeOptions(11, seed));
    const first = plan.find(
      (actor) =>
        actor.cluster && actor.behavior === 'sway' && actor.phraseIndex === 0,
    );
    if (first)
      pair = plan
        .filter((actor) => actor.encounterId === first.encounterId)
        .map((actor) => ({ ...actor }));
  }
  assert.ok(pair);
  for (let elapsed = 0; elapsed < 90; elapsed += 1 / 30) {
    for (const actor of pair)
      updateEncounterActor(
        actor,
        { elapsed, distance: elapsed * 30, speed: 108 },
        1 / 30,
      );
    near(pair[1].distance - pair[0].distance, 28);
    assert.equal(pair[0].tell, pair[1].tell);
    if (Number.isFinite(pair[0].encounterStartedAt))
      near(pair[0].encounterStartedAt, pair[1].encounterStartedAt);
  }
});
