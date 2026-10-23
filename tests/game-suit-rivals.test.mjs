import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STREET_ROLES,
  SUIT_STYLES,
  suitStyleFor,
} from '../public/game-test/src/street-culture.js';
import { drawSuitUniform } from '../public/game-test/src/street-culture-art.js';
import { createState, update } from '../public/game-test/src/simulation.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';
import { normalizeRunBuild } from '../public/game-test/src/run-build.js';

test('suit strength is visible in distinct cuts and progressively broader jackets', () => {
  assert.deepEqual(
    Object.keys(SUIT_STYLES).sort(),
    STREET_ROLES.map((role) => role.id).sort(),
  );
  assert.equal(SUIT_STYLES.salaryman.minimumHp, 1);
  assert.equal(SUIT_STYLES['metrics-inspector'].minimumHp, 2);
  assert.equal(SUIT_STYLES['dress-code-guard'].minimumHp, 3);
  assert.equal(SUIT_STYLES['hierarchy-keeper'].minimumHp, 4);
  assert.ok(
    SUIT_STYLES['hierarchy-keeper'].width >
      SUIT_STYLES['dress-code-guard'].width,
  );
  assert.ok(
    SUIT_STYLES['dress-code-guard'].width >
      SUIT_STYLES['metrics-inspector'].width,
  );
  assert.ok(Object.values(SUIT_STYLES).every(Object.isFrozen));
  assert.equal(
    new Set(Object.values(SUIT_STYLES).map((style) => style.jacket)).size,
    STREET_ROLES.length,
  );
});

test('seeded road plans preserve stronger suits without strengthening opening crowds', () => {
  const found = new Map();
  for (const mode of ['story', 'survival']) {
    for (const stage of [0, 2, 3, 4, 5, 11]) {
      for (const seed of [1, 42, 175, 2026]) {
        for (const node of getJourneyChoices(stage, seed)) {
          const options = {
            mode,
            routeIndex: stage,
            seed,
            journeyNodeId: node.nodeId,
          };
          const state = createState(options);
          assert.deepEqual(
            state._encounterPlan,
            createState(options)._encounterPlan,
          );
          for (const actor of state._encounterPlan.filter(
            (item) => item.streetRole,
          )) {
            const style = suitStyleFor(actor);
            assert.ok(actor.hp >= style.minimumHp);
            if (actor.cluster)
              assert.equal(
                style.minimumHp,
                1,
                'heavy suits stay out of short relay groups',
              );
            assert.equal(actor.maxHp, actor.hp);
            found.set(actor.streetRole.id, actor.hp);
            if (stage === 0)
              assert.equal(actor.hp, 1, `${mode}: beginner crowd`);
            if (actor.beat === 'survival-pack') {
              assert.equal(
                actor.hp,
                1 + Math.floor(stage / 4),
                'crowd health still follows road scaling',
              );
            }
          }
        }
      }
    }
  }
  for (const id of [
    'metrics-inspector',
    'overtime-runner',
    'dress-code-guard',
    'approval-chief',
    'hierarchy-keeper',
  ]) {
    assert.ok(found.has(id), `${id} appears in playable roads`);
    assert.ok(found.get(id) >= SUIT_STYLES[id].minimumHp, id);
  }
});

test('stronger suits take several real hits and become gyaru exactly once', () => {
  for (const id of [
    'salaryman',
    'metrics-inspector',
    'dress-code-guard',
    'hierarchy-keeper',
  ]) {
    const state = createState();
    state.entities = [];
    state._stations = [];
    state._nextEncounter = 1e9;
    state._quizTriggered = true;
    const hp = SUIT_STYLES[id].minimumHp;
    const actor = {
      id: 900,
      type: 'salaryman',
      hp,
      maxHp: hp,
      distance: 40,
      streetRole: STREET_ROLES.find((role) => role.id === id),
    };
    state.entities.push(actor);
    let hits = 0,
      converted = 0;
    for (let tick = 0; tick < 600; tick++) {
      actor.distance = state.distance + 40;
      update(state, { shoot: true }, 1 / 120);
      hits += state.events.filter(
        (event) => event.type === 'heart-hit' || event.type === 'convert',
      ).length;
      converted += state.events.filter(
        (event) => event.type === 'convert',
      ).length;
      if (hits < hp) assert.notEqual(actor.converted, true, id);
    }
    assert.equal(hits, hp, id);
    assert.equal(converted, 1, id);
    assert.equal(actor.type, 'gyaru');
    assert.equal(state.gyaruConverted, 1);
    assert.equal(
      suitStyleFor(actor),
      null,
      'corporate jacket cannot overlay the new gyaru',
    );
  }
});

test('a short relay still converts both light suits in a real swaying crowd group', () => {
  let state, pair;
  for (let seed = 1; seed <= 100 && !pair; seed++) {
    const node = getJourneyChoices(11, seed).find(
      (item) => item.kind === 'event',
    );
    state = createState({ routeIndex: 11, seed, journeyNodeId: node.nodeId });
    const first = state._encounterPlan.find(
      (actor) => actor.cluster && actor.behavior === 'sway',
    );
    if (first)
      pair = state._encounterPlan
        .filter((actor) => actor.encounterId === first.encounterId)
        .map((actor, index) => ({ ...actor, id: 900 + index }));
  }
  assert.equal(pair?.length, 2);
  state.entities = pair;
  state.distance = pair[0].distance - 90;
  state._stations = [];
  state._nextEncounter = 1e9;
  state._quizTriggered = true;
  state.runBuild = normalizeRunBuild(
    { mods: ['heart-chain'], acquiredIds: ['heart-pierce', 'heart-chain'] },
    state,
  );
  let relays = 0;
  for (let tick = 0; tick < 240 && !pair[0].converted; tick++) {
    update(state, { shoot: true }, 1 / 120);
    relays += state.events.filter(
      (event) => event.type === 'heart-chain',
    ).length;
  }
  assert.equal(relays, 1);
  assert.ok(pair.every((actor) => actor.converted && actor.type === 'gyaru'));
  assert.equal(state.gyaruConverted, 2);
});

test('every tailored suit has distinct bounded artwork and conversion removes it', () => {
  const portraits = new Set();
  for (const role of STREET_ROLES) {
    const calls = [];
    const context = new Proxy(
      {},
      {
        get: (target, key) =>
          key in target
            ? target[key]
            : (...args) => calls.push([key, target.fillStyle, ...args]),
      },
    );
    const actor = { type: 'salaryman', streetRole: role };
    drawSuitUniform(context, actor, 500, 465);
    portraits.add(JSON.stringify(calls));
    assert.ok(calls.length < 100, role.id);
    assert.ok(
      calls.every(([, , ...args]) =>
        args.every(
          (value) => typeof value !== 'number' || Number.isFinite(value),
        ),
      ),
    );
    const count = calls.length;
    assert.equal(
      drawSuitUniform(
        context,
        { ...actor, type: 'gyaru', converted: true },
        500,
        465,
      ),
      false,
    );
    assert.equal(calls.length, count);
  }
  assert.equal(portraits.size, STREET_ROLES.length);
  for (const actor of [
    { type: 'fan' },
    { type: 'salaryman', headliner: {} },
    { type: 'salaryman', elite: true },
  ]) {
    assert.equal(suitStyleFor(actor), null);
  }
});
