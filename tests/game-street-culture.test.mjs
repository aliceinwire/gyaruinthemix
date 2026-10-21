import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  retryRoute,
  exportCampaignSave,
  restoreCampaignSave,
  ROUTES,
  ROUTE_OPTIONS,
  RUSH_SPEED_MULTIPLIER,
} from '../public/game-test/src/simulation.js';
import { ENCOUNTER_RULES } from '../public/game-test/src/encounter-director.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';
import {
  STREET_ROLES,
  ROUTINE_HAZARDS,
  LITTLE_FINDS,
} from '../public/game-test/src/street-culture.js';
import {
  drawCultureProp,
  drawRoutineHazard,
  drawLittleFind,
  drawFriendlyCat,
} from '../public/game-test/src/street-culture-art.js';
import { getRoadCue } from '../public/game-test/src/road-feedback.js';
import { selectCrewEvent } from '../public/game-test/src/crew-dialogue.js';

function emptyRoad() {
  const state = createState();
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  state._quizTriggered = true;
  return state;
}

test('twice the cruising speed and longer roads give about 25 percent more driving time', () => {
  const cities = [1680, 1750, 1820, 1880, 1940, 2020];
  for (const [index, road] of ROUTES.entries()) {
    const previousLength = Math.round(
      cities[Math.floor(index / 2)] * (index % 2 ? 0.88 : 0.76),
    );
    for (const [id, previousSpeed] of [
      ['scenic', 92],
      ['express', 108],
    ]) {
      assert.equal(ROUTE_OPTIONS[id].speed, previousSpeed * 2);
      const ratio =
        road.distance /
        ROUTE_OPTIONS[id].speed /
        (previousLength / previousSpeed);
      assert.ok(ratio >= 1.249 && ratio <= 1.251);
      assert.ok(
        ROUTE_OPTIONS[id].speed * RUSH_SPEED_MULTIPLIER <=
          ENCOUNTER_RULES.maximumSupportedSpeed,
      );
      assert.ok(
        (ROUTE_OPTIONS[id].stationRadius * 2) /
          (ROUTE_OPTIONS[id].speed / 3.6) >=
          4,
      );
    }
  }
  const state = emptyRoad();
  update(state, {}, 1);
  assert.ok(
    Math.abs(state.distance - 184 / 3.6) < 1e-7,
    'actual movement, not only the speed label',
  );
});

test('all street identities appear in real seeded roads while original suits and safe envelopes remain', () => {
  const roles = new Set(),
    hazards = new Set();
  for (let stage = 0; stage < 12; stage++)
    for (let seed = 1; seed <= 20; seed++) {
      for (const node of getJourneyChoices(stage, seed)) {
        const state = createState({
          routeIndex: stage,
          seed,
          journeyNodeId: node.nodeId,
        });
        for (const actor of state._encounterPlan) {
          if (actor.streetRole) {
            roles.add(actor.streetRole.id);
            assert.equal(actor.type, 'salaryman');
            assert.equal(actor.streetRole.behavior, actor.behavior);
          }
          if (actor.routineHazard) {
            hazards.add(actor.routineHazard.id);
            assert.equal(actor.type, actor.routineHazard.type);
            assert.equal(actor.hp, actor.routineHazard.hp);
            assert.equal(actor.maxHp, actor.hp);
          }
          assert.ok(!/cat|dog|animal/.test(actor.type));
          for (const station of state._stations)
            assert.ok(
              Math.abs(actor.distance - station) + 1e-7 >=
                ROUTE_OPTIONS[state.routeOption].stationRadius +
                  actor.collisionRadius +
                  actor.motionAmplitude +
                  ENCOUNTER_RULES.stationBuffer,
            );
        }
      }
    }
  assert.deepEqual(
    [...roles].sort(),
    STREET_ROLES.map((role) => role.id).sort(),
  );
  assert.deepEqual(
    [...hazards].sort(),
    ROUTINE_HAZARDS.map((hazard) => hazard.id).sort(),
  );
});

test('new hazards use their advertised counters in the real simulation', () => {
  for (const hazard of ROUTINE_HAZARDS) {
    const state = emptyRoad();
    const target = {
      id: 999,
      type: hazard.type,
      distance: 200,
      hp: hazard.hp,
      routineHazard: hazard,
    };
    state.entities.push(target);
    const cue = getRoadCue(state);
    assert.ok(cue.label.includes(hazard.name));
    assert.equal(cue.action, hazard.type === 'pothole' ? 'boost' : 'shoot');
    update(state, { shoot: true }, 4.5);
    if (hazard.type === 'pothole') {
      assert.ok(!target.resolved, 'loop cannot be shot away');
      assert.ok(state.integrity < 100);
    } else {
      assert.equal(target.resolved, true, hazard.id);
      assert.equal(state.integrity, 100, hazard.id);
    }
    const flight = emptyRoad();
    flight.entities.push({
      id: 999,
      type: hazard.type,
      distance: 100,
      hp: hazard.hp,
      routineHazard: hazard,
    });
    update(flight, { boost: true }, 2.5);
    assert.equal(flight.integrity, 100, `${hazard.id} remains avoidable`);
  }
});

test('the opening survival road mixes corporate pressures while keeping the original suits', () => {
  for (const seed of [1, 42, 175, 2026]) {
    const state = createState({ mode: 'survival', seed });
    const roles = new Set(
      state._encounterPlan.map((actor) => actor.streetRole?.id).filter(Boolean),
    );
    assert.ok(roles.has('salaryman'), `${seed}: original business suit`);
    assert.ok(roles.has('notification-clerk'), `${seed}: notifications`);
    assert.ok(roles.has('brand-rep'), `${seed}: corporate advertising`);
    assert.ok(roles.size >= 3);
    assert.ok(
      state._encounterPlan.every((actor) => !/cat|dog|animal/.test(actor.type)),
    );
  }
});

test('people become creative fans once and their dialogue follows their role', () => {
  for (const role of STREET_ROLES) {
    const state = emptyRoad();
    const actor = {
      id: 900,
      type: 'salaryman',
      distance: 100,
      hp: 1,
      streetRole: role,
    };
    state.entities.push(actor);
    update(state, { shoot: true }, 1);
    assert.equal(actor.type, 'gyaru');
    assert.equal(state.gyaruConverted, 1);
    const event = state.events.find((event) => event.type === 'convert');
    assert.equal(selectCrewEvent(event).text, role.welcome);
    const money = state.money;
    update(state, { shoot: true }, 2);
    assert.equal(state.money, money);
    assert.equal(actor.streetRole.fan, role.fan);
  }
});

test('little finds are safe, optional, one-time rewards and retry rolls them back', () => {
  const state = emptyRoad();
  state.energy = 50;
  state.entities = [
    { id: 200, type: 'little-find', distance: 10, find: LITTLE_FINDS[1] },
  ];
  update(state, { shoot: true }, 0.5);
  assert.equal(state.littleFinds, 1);
  assert.equal(state.energy, 56);
  assert.equal(state.integrity, 100);
  assert.equal(state.money, 0);
  assert.equal(state.gyaruConverted, 0);
  assert.equal(selectCrewEvent(state.events).text, LITTLE_FINDS[1].line);
  update(state, {}, 1);
  assert.equal(state.littleFinds, 1);
  assert.equal(restoreCampaignSave(exportCampaignSave(state)).littleFinds, 0);
  state.status = 'lost';
  retryRoute(state);
  assert.equal(state.littleFinds, 0);
  const flying = emptyRoad();
  flying.altitude = 200;
  flying.jumpHeight = 200 / 112;
  flying.entities = [
    { id: 201, type: 'little-find', distance: 10, find: LITTLE_FINDS[0] },
  ];
  update(flying, { boost: true }, 0.5);
  assert.equal(flying.littleFinds, 0);
  assert.equal(flying.integrity, 100);
});

test('new pixel props draw bounded finite primitives, including friendly non-target cats', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_, key) =>
        (...args) =>
          calls.push([key, ...args]),
      set: () => true,
    },
  );
  for (const role of STREET_ROLES)
    for (const converted of [false, true])
      drawCultureProp(ctx, { streetRole: role, converted }, 500, 465, 3);
  for (const hazard of ROUTINE_HAZARDS)
    assert.equal(
      drawRoutineHazard(ctx, { routineHazard: hazard }, 500, 465, 3),
      true,
    );
  for (const find of LITTLE_FINDS)
    assert.equal(
      drawLittleFind(ctx, { type: 'little-find', find }, 500, 465, 3),
      true,
    );
  drawFriendlyCat(ctx, 500, 397, 3);
  assert.ok(calls.length < 400);
  assert.ok(
    calls.every(([, ...args]) =>
      args.every(
        (value) => typeof value !== 'number' || Number.isFinite(value),
      ),
    ),
  );
});

test('corporate roles have distinct props and visibly turn into creative fan kits', () => {
  function drawing(role, converted) {
    const calls = [],
      colors = {};
    const ctx = new Proxy(colors, {
      get: (target, key) =>
        key in target
          ? target[key]
          : (...args) => {
              calls.push([key, target.fillStyle, ...args]);
            },
    });
    drawCultureProp(ctx, { streetRole: role, converted }, 500, 465, 3);
    assert.ok(calls.length <= 30, `${role.id}: bounded per-character artwork`);
    return JSON.stringify(calls);
  }
  const corporate = new Set(),
    fanKits = new Map();
  for (const role of STREET_ROLES) {
    const before = drawing(role, false),
      after = drawing(role, true);
    assert.notEqual(after, before, `${role.id}: conversion changes the prop`);
    corporate.add(before);
    fanKits.set(role.fan, after);
  }
  assert.equal(corporate.size, STREET_ROLES.length);
  assert.equal(new Set(fanKits.values()).size, 6);
});
