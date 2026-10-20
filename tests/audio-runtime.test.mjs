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

class Element extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  replaceWith(element) {
    this.replacement = element;
    this.isConnected = false;
    element.isConnected = true;
  }
}

function fixture({ failure = false } = {}) {
  const config = pending(),
    music = new Element('iframe'),
    button = new Element('button');
  music.id = 'music';
  music.isConnected = true;
  const documentRef = {
    activeElement: null,
    createElement: (tag) => new Element(tag),
  };
  const instances = [],
    states = [];
  let events,
    widgetPlays = 0,
    widgetPauses = 0;
  const callbacks = new Map();
  const widget = {
    bind: (name, callback) => callbacks.set(name, callback),
    unbind: (name) => callbacks.delete(name),
    play: () => {
      widgetPlays++;
    },
    pause: () => {
      widgetPauses++;
    },
    setVolume() {},
  };
  const Widget = () => widget;
  Widget.Events = { READY: 'ready', PLAY: 'play', ERROR: 'error' };
  const audio = createGameAudio({
    music,
    button,
    status: new Element('span'),
    loadAPI: async () => ({ Widget }),
    AudioContextClass: null,
    documentRef,
    loadConfig: () => config.promise,
    onEnabledChange: (value) => states.push(value),
    streamingFactory(options) {
      if (failure) throw new Error('unsupported UI');
      assert.equal(options.music.tagName, 'DIV');
      assert.notEqual(options.music, music);
      assert.equal(options.music.id, 'music');
      let enabled = false;
      const instance = {
        options,
        unlocked: 0,
        paused: 0,
        beeps: [],
        destroyed: 0,
        unlock() {
          this.unlocked++;
        },
        pause() {
          this.paused++;
        },
        beep(...args) {
          this.beeps.push(args);
        },
        get enabled() {
          return enabled;
        },
        destroy() {
          this.destroyed++;
          enabled = false;
        },
      };
      instances.push(instance);
      return instance;
    },
  });
  events = Widget.Events;
  return {
    audio,
    music,
    button,
    config,
    documentRef,
    instances,
    states,
    nativePlay: () => callbacks.get(events.PLAY)?.(),
    readyWidget: () => callbacks.get(events.READY)?.(),
    counts: () => ({ widgetPlays, widgetPauses }),
  };
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test('default-off retains the original SoundCloud iframe and immediate button behavior', async () => {
  const f = fixture();
  await settle();
  f.readyWidget();
  f.button.dispatchEvent(new Event('click'));
  assert.equal(f.audio.enabled, true);
  assert.ok(f.counts().widgetPlays > 0);
  f.config.resolve(false);
  await f.audio.ready;
  assert.equal(f.instances.length, 0);
  assert.equal(f.music.isConnected, true);
  f.button.dispatchEvent(new Event('click'));
  assert.equal(f.audio.enabled, false);
  f.audio.destroy();
});

test('available audio replaces iframe with a real mount once, without autoplay or scene recreation', async () => {
  const f = fixture();
  f.config.resolve(true);
  await f.audio.ready;
  assert.equal(f.instances.length, 1);
  assert.equal(f.music.isConnected, false);
  assert.equal(f.music.replacement.tagName, 'DIV');
  assert.equal(f.music.replacement.isConnected, true);
  assert.equal(f.counts().widgetPlays, 0);
  assert.equal(f.audio.enabled, false);
  const instance = f.instances[0];
  for (let scene = 0; scene < 3; scene++) f.audio.unlock();
  f.audio.pause();
  f.audio.beep(500, 0.1);
  assert.equal(f.instances.length, 1);
  assert.equal(instance.unlocked, 3);
  assert.equal(instance.paused, 1);
  assert.deepEqual(instance.beeps, [[500, 0.1]]);
  f.audio.destroy();
  f.audio.destroy();
  assert.equal(instance.destroyed, 1);
});

test('early sound toggles, native widget play and iframe focus prevent a late provider switch', async () => {
  for (const interaction of [
    'toggle',
    'native-play',
    'focus',
    'active-element',
  ]) {
    const f = fixture();
    await settle();
    f.readyWidget();
    if (interaction === 'toggle') {
      f.button.dispatchEvent(new Event('click'));
      f.button.dispatchEvent(new Event('click'));
    } else if (interaction === 'native-play') f.nativePlay();
    else if (interaction === 'focus') f.music.dispatchEvent(new Event('focus'));
    else f.documentRef.activeElement = f.music;
    f.config.resolve(true);
    await f.audio.ready;
    assert.equal(f.instances.length, 0, interaction);
    assert.equal(f.music.isConnected, true, interaction);
    f.audio.destroy();
  }
});

test('destroy and detection failure cannot mount late audio or break gameplay calls', async () => {
  const f = fixture();
  f.audio.destroy();
  f.config.resolve(true);
  await f.audio.ready;
  assert.equal(f.instances.length, 0);
  assert.equal(f.counts().widgetPlays, 0);
  f.audio.unlock();
  f.audio.beep();

  const g = fixture({ failure: true });
  g.config.resolve(true);
  await g.audio.ready;
  assert.equal(g.instances.length, 0);
  assert.equal(g.music.isConnected, true);
  await settle();
  g.readyWidget();
  g.button.dispatchEvent(new Event('click'));
  assert.equal(g.audio.enabled, true);
  g.audio.destroy();
});
