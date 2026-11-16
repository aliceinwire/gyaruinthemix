import test from 'node:test';
import assert from 'node:assert/strict';
import {
  randomStartingWeapon,
  SURVIVAL_STARTERS,
} from '../public/game/src/survival.js';
import {
  createState,
  exportNightfallSave,
  restoreNightfallSave,
  chooseStartingWeapon,
  beginCampaign,
  retryRoute,
} from '../public/game/src/simulation.js';
import { createMetaProgress } from '../public/game/src/garage.js';

test('random starters cover every weapon with equal intervals, including hearts', () => {
  const choices = SURVIVAL_STARTERS.map((item) => item.id);
  for (let index = 0; index < choices.length; index++) {
    for (const fraction of [0, 0.5, 0.999999]) {
      assert.equal(
        randomStartingWeapon(() => (index + fraction) / choices.length),
        choices[index],
      );
    }
  }
});

test('random equipment survives saves and retries without granting a permanent unlock', () => {
  for (const weapon of SURVIVAL_STARTERS) {
    const meta = createMetaProgress();
    const state = createState({
      mode: 'survival',
      survivalDay: '2026-11-16',
      startingWeapon: weapon.id,
    });
    assert.deepEqual(state.survival.upgrades, { [weapon.id]: 1 });
    const restored = restoreNightfallSave(exportNightfallSave(state));
    assert.equal(restored.survival.startingWeapon, weapon.id);
    assert.equal(beginCampaign(restored), true);
    restored.status = 'lost';
    retryRoute(restored);
    assert.equal(restored.survival.startingWeapon, weapon.id);
    assert.deepEqual(restored.survival.upgrades, { [weapon.id]: 1 });
    const other = SURVIVAL_STARTERS.find((item) => item.id !== weapon.id).id;
    assert.equal(chooseStartingWeapon(state, other, meta), false);
    assert.equal(meta.completionPoints, 0);
    assert.deepEqual(meta.ownedStartingWeapons, []);
    meta.completionPoints = 1;
    assert.equal(chooseStartingWeapon(state, other, meta), true);
    assert.equal(meta.completionPoints, 0);
    assert.deepEqual(meta.ownedStartingWeapons, [other]);
  }
});
