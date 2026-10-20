import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameAudioConfig } from '../public/game-test/src/game-audio-config.js';
import { createGameAudio } from '../public/game-test/src/audio.js';

const pending = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('audio config accepts only an explicit boolean from its same-origin endpoint', async () => {
  for (const config of [
    { enabled: true },
    { enabled: false },
    { enabled: 'true' },
    { enabled: 1 },
    {},
    null,
  ]) {
    let calls = 0;
    const enabled = await loadGameAudioConfig({
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, '/game-audio/v1/config');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.mode, 'same-origin');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.redirect, 'error');
        return { ok: true, json: async () => config };
      },
    });
    assert.equal(enabled, config?.enabled === true);
    assert.equal(calls, 1);
  }
});

test('absent, rejected, malformed and hung config preserve default-off within the bound', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false }),
    async () => {
      throw new Error('offline');
    },
    async () => ({
      ok: true,
      json: async () => {
        throw new Error('invalid JSON');
      },
    }),
  ])
    assert.equal(await loadGameAudioConfig({ fetchImpl }), false);

  for (const hangInBody of [false, true]) {
    const late = pending();
    let timeout,
      signal,
      cleared = false;
    const work = loadGameAudioConfig({
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        if (!hangInBody) return late.promise;
        return { ok: true, json: () => late.promise };
      },
      timers: {
        setTimeout(callback, ms) {
          assert.equal(ms, 1500);
          timeout = callback;
          return 1;
        },
        clearTimeout(id) {
          assert.equal(id, 1);
          cleared = true;
        },
      },
    });
    await Promise.resolve();
    timeout();
    assert.equal(await work, false);
    assert.equal(signal.aborted, true);
    assert.equal(cleared, true);
    late.resolve(
      hangInBody
        ? { enabled: true }
        : { ok: true, json: async () => ({ enabled: true }) },
    );
    assert.equal(await work, false);
  }
});

function fixture() {
  const config = pending(),
    music = {};
  let mounts = 0;
  const instance = {
    unlocked: 0,
    paused: 0,
    destroyed: 0,
    beeps: [],
    enabled: false,
    unlock() {
      this.unlocked++;
    },
    pause() {
      this.paused++;
    },
    beep(...args) {
      this.beeps.push(args);
    },
    destroy() {
      this.destroyed++;
    },
  };
  let availability;
  const audio = createGameAudio({
    music,
    loadConfig: () => config.promise,
    streamingFactory(options) {
      mounts++;
      assert.equal(options.music, music);
      availability = options.loadAvailability;
      return instance;
    },
  });
  return { config, audio, instance, availability, mounts: () => mounts };
}
test('the radio mounts immediately and remains the same through late discovery', async () => {
  for (const enabled of [true, false]) {
    const f = fixture();
    assert.equal(f.mounts(), 1);
    assert.equal(f.instance.unlocked, 0);
    f.audio.unlock();
    f.config.resolve(enabled);
    assert.equal(await f.audio.ready, enabled);
    assert.equal(await f.availability(), enabled);
    assert.equal(f.mounts(), 1);
    assert.equal(f.instance.unlocked, 1, 'discovery never triggers autoplay');
    f.audio.pause();
    f.audio.beep(500, 0.1);
    assert.equal(f.instance.paused, 1);
    assert.deepEqual(f.instance.beeps, [[500, 0.1]]);
  }
});
test('destroy is idempotent and later discovery cannot revive the radio', async () => {
  const f = fixture();
  f.audio.destroy();
  f.audio.destroy();
  f.config.resolve(true);
  await f.audio.ready;
  f.audio.unlock();
  f.audio.pause();
  f.audio.beep();
  assert.equal(f.instance.destroyed, 1);
  assert.equal(f.instance.unlocked, 0);
  assert.equal(f.instance.paused, 0);
  assert.equal(f.audio.enabled, false);
});
test('failed discovery keeps the built-in radio unavailable', async () => {
  let available;
  const audio = createGameAudio({
    loadConfig: async () => {
      throw Error('offline');
    },
    streamingFactory: (options) => {
      available = options.loadAvailability;
      return {};
    },
  });
  assert.equal(await audio.ready, false);
  assert.equal(await available(), false);
});
