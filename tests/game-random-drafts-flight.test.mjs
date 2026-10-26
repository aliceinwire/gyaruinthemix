import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  exportNightfallSave,
  restoreNightfallSave,
  ROUTE_OPTIONS,
} from '../public/game/src/simulation.js';
import {
  survivalOffers,
  survivalXpCost,
  SURVIVAL_UPGRADES,
  SURVIVAL_WEAPONS,
} from '../public/game/src/survival.js';
import {
  ENCOUNTER_RULES,
  addFlightObstacles,
} from '../public/game/src/encounter-director.js';
import { getJourneyChoices } from '../public/game/src/journey.js';
import { getRoadCue } from '../public/game/src/road-feedback.js';

const fresh = (options = {}) =>
  createState({
    mode: 'survival',
    seed: 175,
    survivalDay: '2026-10-26',
    startingWeapon: 'vinyl',
    ...options,
  });

test('XP draws reach the entire eligible pool with no guaranteed weapon, support, or slot', () => {
  const appearances = new Map(),
    positions = new Map(),
    sets = new Set();
  const state = fresh();
  state.survival.xp = survivalXpCost(0);
  let weaponsOnly = false,
    supportsOnly = false;
  for (let seed = 1; seed <= 512; seed++) {
    state.seed = seed;
    const before = JSON.stringify(state);
    const offers = survivalOffers(state);
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(survivalOffers(state), offers);
    assert.equal(offers.length, 3);
    assert.equal(new Set(offers.map((item) => item.id)).size, 3);
    assert.ok(offers.every((item) => item.id !== 'relay'));
    weaponsOnly ||= offers.every((item) => item.kind === 'weapon');
    supportsOnly ||= offers.every((item) => item.kind === 'support');
    sets.add(
      offers
        .map((item) => item.id)
        .sort()
        .join(','),
    );
    offers.forEach((item, index) => {
      appearances.set(item.id, (appearances.get(item.id) || 0) + 1);
      if (!positions.has(item.id)) positions.set(item.id, new Set());
      positions.get(item.id).add(index);
    });
  }
  assert.ok(weaponsOnly && supportsOnly);
  assert.ok(sets.size > 100);
  for (const item of SURVIVAL_UPGRADES.filter((item) => item.id !== 'relay')) {
    // Broad guard against accidental bias or guaranteed offers, not an exact RNG fixture.
    assert.ok(
      appearances.get(item.id) > 70 && appearances.get(item.id) < 190,
      item.id,
    );
    assert.equal(positions.get(item.id).size, 3, item.id);
  }
});

test('save/resume preserves a draw, while a later XP level produces new choices', () => {
  const state = fresh();
  state.survival.xp = 100;
  const offers = survivalOffers(state);
  const restored = restoreNightfallSave(exportNightfallSave(state));
  assert.ok(restored);
  assert.deepEqual(survivalOffers(restored), offers);
  state.survival.upgrades.vinyl++;
  state.survival.level++;
  assert.notDeepEqual(
    survivalOffers(state).map((item) => item.id),
    offers.map((item) => item.id),
  );
});

test('flight gaps leave EV windows, breathers, arrival and other collision envelopes clear', () => {
  const speed = ENCOUNTER_RULES.maximumSupportedSpeed / 3.6;
  for (const seed of [1, 42, 175, 2026])
    for (let routeIndex = 0; routeIndex < 12; routeIndex++)
      for (const node of getJourneyChoices(routeIndex, seed)) {
        const state = fresh({ seed, routeIndex, journeyNodeId: node.nodeId });
        const plan = state._encounterPlan;
        assert.ok(
          plan.filter((actor) => actor.type === 'pothole').length >= 2,
          `${seed}/${node.nodeId}`,
        );
        assert.deepEqual(
          plan,
          fresh({ seed, routeIndex, journeyNodeId: node.nodeId })
            ._encounterPlan,
        );
        for (const actor of plan.filter(
          (actor) => actor.beat === 'flight-gap',
        )) {
          assert.ok(actor.requiresHover);
          assert.ok(
            actor.distance <=
              state.routeLength - ENCOUNTER_RULES.arrivalClearance,
          );
          assert.ok(
            actor.distance + actor.collisionRadius < state.routeLength * 0.65 ||
              actor.distance - actor.collisionRadius > state.routeLength * 0.73,
          );
          assert.ok(
            (actor.warningDistance - actor.collisionRadius) / speed >=
              ENCOUNTER_RULES.minimumCounterTime,
          );
          for (const station of state._stations)
            assert.ok(
              Math.abs(actor.distance - station) >=
                ROUTE_OPTIONS[state.routeOption].stationRadius +
                  actor.collisionRadius +
                  ENCOUNTER_RULES.stationBuffer,
            );
          for (const other of plan.filter((other) => other !== actor)) {
            const free =
              Math.abs(actor.distance - other.distance) -
              actor.collisionRadius -
              other.collisionRadius -
              other.motionAmplitude;
            assert.ok(
              free / speed >= ENCOUNTER_RULES.minimumCounterTime - 1e-8,
              `${seed}/${node.nodeId}: ${free}`,
            );
          }
        }
      }
});

test('flight placement preserves authored actors and declines impossible or low-ceiling roads', () => {
  const options = {
    seed: 175,
    routeIndex: 2,
    routeLength: 3000,
    stations: [],
    stationRadius: 144,
  };
  const authored = Object.freeze({
    type: 'barrier',
    distance: 1000,
    collisionRadius: 27,
    motionAmplitude: 0,
  });
  const plan = Object.freeze([authored]);
  const result = addFlightObstacles(plan, options);
  assert.ok(result.includes(authored));
  assert.equal(plan.length, 1);
  assert.deepEqual(
    addFlightObstacles(plan, { ...options, node: { lowCeiling: true } }),
    plan,
  );
  assert.deepEqual(
    addFlightObstacles(plan, { ...options, node: { maxAltitude: 23 } }),
    plan,
  );
  assert.deepEqual(
    addFlightObstacles([], { ...options, routeLength: 200 }),
    [],
  );
  assert.deepEqual(
    addFlightObstacles([], {
      ...options,
      stations: Array.from({ length: 30 }, (_, i) => i * 100),
    }),
    [],
  );
});

test('fully upgraded automatic weapons cannot clear a flight gap, but holding flight avoids its damage', () => {
  function drive(boost) {
    const state = fresh();
    const gap = state._encounterPlan.find(
      (actor) => actor.beat === 'flight-gap',
    );
    assert.ok(gap);
    const target = {
      ...gap,
      id: 9000,
      distance: 160,
      motionBaseDistance: 160,
      telegraphBaseDistance: 160,
    };
    state.entities = [target];
    state._nextEncounter = 1e9;
    state._stations = [];
    state.survival.upgrades = Object.fromEntries(
      SURVIVAL_WEAPONS.map((item) => [item.id, 6]),
    );
    assert.equal(getRoadCue(state).action, 'boost');
    const events = [];
    for (let i = 0; i < 180 && state.distance < 200; i++) {
      update(state, { boost }, 1 / 30);
      events.push(...state.events);
    }
    assert.ok(!target.resolved, 'weapons cannot destroy the gap');
    return { state, events };
  }
  const ground = drive(false),
    flight = drive(true);
  assert.ok(ground.state.integrity < 100);
  assert.equal(flight.state.integrity, 100);
  assert.ok(flight.events.some((event) => event.type === 'jump-clear'));
  assert.ok(!ground.events.some((event) => event.type === 'jump-clear'));
});
