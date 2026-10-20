import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, update } from '../public/game-test/src/simulation.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';
import {
  createEncounterPlan,
  ENCOUNTER_RULES,
  SIGNAL_HEADLINERS,
  updateEncounterActor,
  getHeadlinerView,
} from '../public/game-test/src/encounter-director.js';
import {
  getThreatSignals,
  getRoadCue,
  createRoadFeedback,
  captureRoadFeedback,
  updateRoadFeedback,
  drawRoadFeedback,
} from '../public/game-test/src/road-feedback.js';
import { drawSignalHeadliner } from '../public/game-test/src/renderer.js';

const maxSpeed = ENCOUNTER_RULES.maximumSupportedSpeed / 3.6;

test('all six club chapters carry one distinct optional signal challenge without new spawns', () => {
  assert.equal(new Set(SIGNAL_HEADLINERS.map((item) => item.id)).size, 6);
  for (let routeIndex = 1; routeIndex < 12; routeIndex += 2) {
    for (let seed = 1; seed <= 100; seed++) {
      for (const node of getJourneyChoices(routeIndex, seed)) {
        const state = createState({
          routeIndex,
          seed,
          journeyNodeId: node.nodeId,
        });
        const heads = state._encounterPlan.filter((actor) => actor.headliner);
        assert.equal(heads.length, 1, `${routeIndex}/${seed}/${node.kind}`);
        const head = heads[0];
        assert.equal(head.headliner.cityId, state.route.cityId);
        assert.equal(head.headlinerOptional, true);
        assert.ok(Object.isFrozen(head.headliner));
        assert.equal(
          head.type,
          'salaryman',
          'uses established collision and projectile contract',
        );
        assert.ok(head.hp <= 4 && head.hp >= 1);
        assert.ok(
          head.distance < state.routeLength - ENCOUNTER_RULES.arrivalClearance,
        );
        for (const station of state._stations) {
          const radius = state.routeOption === 'express' ? 60 : 72;
          assert.ok(
            Math.abs(head.distance - station) >=
              radius +
                head.collisionRadius +
                head.motionAmplitude +
                ENCOUNTER_RULES.stationBuffer -
                1e-7,
          );
        }
      }
    }
  }
});

test('authored calls and responses occur without reducing full-speed warning time', () => {
  const beats = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    const plan = createEncounterPlan({
      seed,
      routeIndex: 9,
      routeLength: 4000,
      stations: [],
      node: { kind: 'event' },
    });
    for (const actor of plan) {
      beats.add(actor.beat);
      const clearance =
        actor.telegraph.leadDistance -
        actor.collisionRadius -
        actor.motionAmplitude;
      assert.ok(
        clearance / maxSpeed >= actor.anticipation + actor.counterWindow - 1e-7,
      );
    }
  }
  for (const name of [
    'call-and-response',
    'lift-refrain',
    'gate-response',
    'syncopated-lift',
    'last-call',
  ])
    assert.ok(beats.has(name), name);
});

test('chapter view reflects guard, opening, last signal and completion without mutating play', () => {
  const head = {
    ...createEncounterPlan({
      seed: 2,
      routeIndex: 11,
      routeLength: 2000,
      node: { kind: 'event' },
    }).find((actor) => actor.headliner),
  };
  head.distance = head.motionBaseDistance = head.telegraphBaseDistance = 500;
  const state = { distance: 340, elapsed: 10, speed: 108, entities: [head] };
  updateEncounterActor(head, state, 0);
  assert.equal(getHeadlinerView(state).phase, 'closed');
  assert.equal(getHeadlinerView(state).optional, true);
  state.distance = 460;
  state.elapsed = 12;
  updateEncounterActor(head, state, 0.1);
  assert.equal(getHeadlinerView(state).phase, 'response');
  head.hp = 1;
  updateEncounterActor(head, state, 0.1);
  assert.equal(getHeadlinerView(state).phase, 'last-signal');
  const before = JSON.stringify(state);
  getHeadlinerView(state);
  assert.equal(JSON.stringify(state), before);
  head.converted = true;
  assert.equal(getHeadlinerView(state), null);
});

test('headliner is cleared by the actual heart simulation and cannot award twice', () => {
  const state = createState();
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  state._quizTriggered = true;
  const head = {
    id: 900,
    type: 'salaryman',
    hp: 3,
    maxHp: 3,
    distance: 75,
    elite: true,
    headliner: SIGNAL_HEADLINERS[2],
    converted: false,
  };
  state.entities.push(head);
  for (let tick = 0; tick < 240; tick++)
    update(state, { shoot: true }, 1 / 120);
  assert.equal(head.converted, true);
  assert.equal(head.type, 'gyaru');
  assert.equal(
    state.gyaruConverted,
    0,
    'restoring a sound rig never counts it as a person',
  );
  assert.equal(state.signalClears, 1);
  assert.equal(state.stageSignals, 1);
  const money = state.money;
  for (let tick = 0; tick < 240; tick++)
    update(state, { shoot: true }, 1 / 120);
  assert.equal(state.money, money);
  assert.equal(state.signalClears, 1);
});

test('nearest threat has priority, shield opening changes advice, and lists remain bounded', () => {
  const shield = {
    id: 2,
    type: 'salaryman',
    distance: 180,
    behavior: 'shield',
    shielded: true,
    behaviorPhase: 'guard',
  };
  const state = {
    distance: 100,
    speed: 178.2,
    energy: 0,
    entities: [
      shield,
      { id: 1, type: 'pothole', distance: 130 },
      ...Array.from({ length: 100 }, (_, i) => ({
        id: i + 3,
        type: 'cone',
        distance: 190 + i,
      })),
    ],
  };
  const signals = getThreatSignals(state);
  assert.equal(signals.length, 3);
  assert.equal(signals[0].id, 1);
  assert.equal(getRoadCue(state).action, 'boost');
  assert.equal(signals[0].urgency, 'urgent');
  state.entities[1].cleared = true;
  assert.match(getRoadCue(state).label, /ガード中/);
  shield.shielded = false;
  shield.behaviorPhase = 'open';
  assert.match(getRoadCue(state).label, /チャンス/);
  assert.deepEqual(
    getThreatSignals({ entities: [null, {}, { type: 'cone', distance: NaN }] }),
    [],
  );
  const atEv = {
    distance: 100,
    speed: 108,
    atStation: true,
    energy: 5,
    entities: [{ id: 1, type: 'pothole', distance: 280 }],
  };
  assert.equal(
    getRoadCue(atEv).action,
    'charge',
    'far warnings do not hide the current safe charging window',
  );
  atEv.entities[0].distance = 150;
  assert.equal(
    getRoadCue(atEv).action,
    'boost',
    'immediate lift still interrupts the charging advice',
  );
});

function drawContext() {
  const calls = [];
  return new Proxy(
    { calls },
    {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => {
          calls.push([key, ...args]);
        };
      },
    },
  );
}

test('signal artwork restores its own rig and keeps drawing work bounded', () => {
  for (const converted of [false, true]) {
    const context = drawContext();
    drawSignalHeadliner(
      context,
      { headliner: SIGNAL_HEADLINERS[0], converted, shielded: !converted },
      400,
      465,
      4,
    );
    assert.ok(context.calls.length < 120);
    assert.ok(context.calls.some(([op]) => op === 'fillRect'));
    assert.ok(
      context.calls.every(([, ...args]) =>
        args.every(
          (value) => typeof value !== 'number' || Number.isFinite(value),
        ),
      ),
    );
  }
});

test('reduced motion keeps event text but removes expanding particles and rejects invalid elapsed time', () => {
  const feedback = createRoadFeedback();
  captureRoadFeedback(feedback, [
    { type: 'convert', reward: 70, distance: 100, elite: true },
  ]);
  for (const dt of [NaN, Infinity, -1, 0]) updateRoadFeedback(feedback, dt);
  assert.equal(feedback.effects[0].age, 0);
  const normal = drawContext(),
    reduced = drawContext();
  drawRoadFeedback(normal, feedback, { distance: 100 });
  drawRoadFeedback(
    reduced,
    feedback,
    { distance: 100 },
    { reducedMotion: true },
  );
  assert.ok(normal.calls.some(([op]) => op === 'fillRect'));
  assert.ok(!reduced.calls.some(([op]) => op === 'fillRect'));
  assert.ok(
    reduced.calls.some(
      ([op, label]) => op === 'fillText' && label === 'SIGNAL CLEAR',
    ),
  );
});
