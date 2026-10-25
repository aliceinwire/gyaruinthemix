import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSettingsStore,
  normalizeSettings,
  SETTINGS_KEY,
} from '../public/game/src/tour-settings.js';

test('preferences survive reload without sharing run currencies or accepting coercion', () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key),
    setItem: (key, value) => records.set(key, value),
  };
  const store = createSettingsStore(storage, true);
  assert.equal(store.load().reducedMotion, true);
  assert.equal(
    store.save({
      autoHearts: true,
      assistMode: true,
      reducedMotion: false,
      money: 999,
    }),
    true,
  );
  assert.deepEqual(createSettingsStore(storage).load(), {
    version: 1,
    autoHearts: true,
    assistMode: true,
    reducedMotion: false,
  });
  assert.equal(JSON.parse(records.get(SETTINGS_KEY)).money, undefined);
  assert.equal(normalizeSettings({ assistMode: 'true' }).assistMode, false);
  for (const musicDrive of [true, false, 'true'])
    assert.equal(
      Object.hasOwn(normalizeSettings({ musicDrive }), 'musicDrive'),
      false,
    );
});

test('denied storage and corrupt saved settings do not prevent play', () => {
  const denied = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('full');
    },
  };
  const store = createSettingsStore(denied, true);
  assert.equal(store.load().reducedMotion, true);
  assert.equal(store.save({}), false);
  for (const value of ['{', 'null', '[]', 12])
    assert.equal(normalizeSettings(value).assistMode, false);
});
