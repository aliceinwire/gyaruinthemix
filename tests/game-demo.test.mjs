import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDemoSearch,
  demoFinished,
  demoStorage,
  demoLink,
} from '../public/game/src/demo.js';
import { createSaveStore } from '../public/game/src/save-store.js';
import { createState } from '../public/game/src/simulation.js';
import { createSurvivalRecords } from '../public/game/src/survival.js';

test('demo is explicit and its links preserve language without carrying demo into the full tour', () => {
  assert.equal(isDemoSearch('?demo=1&lang=en'), true);
  for (const search of ['', '?demo=0', '?demo=true', '?lang=en'])
    assert.equal(isDemoSearch(search), false);
  assert.equal(demoLink(true, 'ko'), '/game/?lang=ko&demo=1');
  assert.equal(demoLink(false, 'ko'), '/game/?lang=ko');
});

test('the demo ends only after completing both Nakano roads', () => {
  assert.equal(demoFinished({ routeIndex: 0, status: 'won' }), false);
  assert.equal(demoFinished({ routeIndex: 1, status: 'playing' }), false);
  assert.equal(demoFinished({ routeIndex: 1, status: 'lost' }), false);
  assert.equal(demoFinished({ routeIndex: 1, status: 'won' }), true);
});

test('demo saves resume within the page but do not survive another page instance', () => {
  const storage = demoStorage();
  const saves = createSaveStore(storage);
  const state = createState({
    mode: 'survival',
    survivalDay: '2026-10-25',
    seed: 175,
    runId: 'demo-test',
  });
  state.survival.recordEligible = false;
  assert.equal(saves.saveNightfall(state).persisted, true);
  assert.equal(saves.loadNightfall().runId, 'demo-test');
  assert.equal(createSaveStore(demoStorage()).loadNightfall(), null);
  state.status = 'lost';
  assert.equal(createSurvivalRecords(storage).save(state).eligible, false);
  assert.deepEqual(createSurvivalRecords(storage).read(), []);
  saves.clearNightfall();
  assert.equal(saves.loadNightfall(), null);
});
