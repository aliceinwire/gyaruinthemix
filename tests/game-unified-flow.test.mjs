import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputState, KEY_ACTIONS } from '../public/game/src/input.js';
import { createState } from '../public/game/src/simulation.js';
import {
  createSaveStore,
  NIGHTFALL_SAVE_KEY,
  SAVE_KEY,
} from '../public/game/src/save-store.js';
import { getRoadCue } from '../public/game/src/road-feedback.js';

test('three independent driving actions release safely and manual attack inputs do nothing', () => {
  const controls = createInputState();
  assert.deepEqual([...new Set(Object.values(KEY_ACTIONS))].sort(), [
    'boost',
    'charge',
    'rush',
  ]);
  controls.keyDown('KeyZ');
  controls.keyDown('KeyJ');
  controls.pointerDown(99, 'shoot');
  assert.equal(controls.input.shoot, false);
  controls.pointerDown(1, 'boost');
  controls.keyDown('KeyE');
  controls.pointerDown(2, 'rush');
  assert.deepEqual(controls.input, {
    boost: true,
    shoot: false,
    charge: true,
    rush: true,
  });
  controls.pointerUp(1);
  assert.equal(controls.input.boost, false);
  assert.equal(controls.input.rush, true);
  controls.release();
  assert.deepEqual(Object.values(controls.input), [false, false, false, false]);
});

test('Nightfall map saves are separate and consumed without deleting legacy progress', () => {
  const data = new Map();
  const store = createSaveStore({
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  });
  assert.ok(store.saveCampaign(createState({ seed: 77 })).persisted);
  const run = createState({
    mode: 'survival',
    seed: 175,
    survivalDay: '2026-10-21',
    startingWeapon: 'bass',
  });
  assert.ok(store.saveNightfall(run).persisted);
  assert.equal(store.loadNightfall().survival.startingWeapon, 'bass');
  run.elapsed = 1;
  run.distance = 1;
  assert.equal(store.saveNightfall(run).persisted, false);
  assert.ok(store.clearNightfall());
  assert.equal(data.has(NIGHTFALL_SAVE_KEY), false);
  assert.equal(store.loadNightfall(), null);
  assert.ok(data.has(SAVE_KEY));
  assert.equal(store.loadCampaign().seed, 77);
});

test('storage denial and corrupt Nightfall checkpoints fail safely', () => {
  const store = createSaveStore({
    getItem: () => '{bad json',
    setItem() {
      throw Error('denied');
    },
    removeItem() {
      throw Error('denied');
    },
  });
  assert.equal(store.loadNightfall(), null);
  assert.equal(store.clearNightfall(), false);
  assert.equal(
    store.saveNightfall(
      createState({ mode: 'survival', survivalDay: '2026-10-21' }),
    ).persisted,
    false,
  );
});

test('automatic weapons never produce a manual attack control prompt', () => {
  const state = createState({ mode: 'survival', startingWeapon: 'flash' });
  for (const type of ['salaryman', 'cone', 'barrier', 'pothole']) {
    state.entities = [
      { id: 1, type, distance: state.distance + 35, behavior: 'steady' },
    ];
    assert.notEqual(getRoadCue(state).action, 'shoot');
  }
  state.entities = [];
  assert.notEqual(getRoadCue(state).action, 'shoot');
});
