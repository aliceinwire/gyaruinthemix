import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRadioEqualizer,
  radioSpectrumBars,
  RADIO_IDLE_BARS,
} from '../public/game-test/src/radio-equalizer.js';
import {
  SILENT_MUSIC,
  decodeMusicTimeline,
} from '../public/game-test/src/music-reactivity.js';

function fixture({
  blocked = false,
  deferred = false,
  supported = true,
  native = false,
} = {}) {
  const media = new EventTarget();
  Object.assign(media, {
    canPlayType: () => (native ? 'probably' : ''),
    currentTime: 0,
    paused: true,
    ended: false,
    muted: false,
    volume: 0.7,
  });
  const documentRef = new EventTarget();
  Object.assign(documentRef, { hidden: false, body: { dataset: {} } });
  const motionQuery = new EventTarget();
  motionQuery.matches = false;
  const display = { textContent: '▂▅▃▇▅', dataset: {} };
  const frames = new Map();
  let frameId = 0,
    context,
    finishResume,
    mutation;
  class AudioContext extends EventTarget {
    constructor() {
      super();
      context = this;
      this.state = 'suspended';
      this.sampleRate = 48000;
      this.destination = {};
      this.createdSources = 0;
      this.createdAnalysers = 0;
      this.samples = 0;
      this.closes = 0;
      this.data = new Uint8Array(512);
      this.source = {
        destinations: [],
        connect(destination) {
          this.destinations.push(destination);
        },
        disconnect() {
          this.destinations.length = 0;
        },
      };
    }
    async resume() {
      if (blocked) throw Error('blocked');
      if (deferred)
        await new Promise((resolve) => {
          finishResume = resolve;
        });
      this.state = 'running';
    }
    createMediaElementSource(element) {
      assert.equal(element, media);
      this.createdSources++;
      return this.source;
    }
    createAnalyser() {
      this.createdAnalysers++;
      return {
        frequencyBinCount: 512,
        getByteFrequencyData: (array) => {
          this.samples++;
          array.set(this.data);
        },
        disconnect() {},
      };
    }
    async close() {
      this.closes++;
      this.state = 'closed';
    }
  }
  class Observer {
    constructor(callback) {
      mutation = callback;
    }
    observe() {}
    disconnect() {
      mutation = null;
    }
  }
  const equalizer = createRadioEqualizer({
    media,
    display,
    documentRef,
    motionQuery,
    AudioContextClass: supported ? AudioContext : null,
    MutationObserverClass: Observer,
    requestFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelFrame: (id) => frames.delete(id),
  });
  return {
    equalizer,
    media,
    display,
    documentRef,
    motionQuery,
    frames,
    context: () => context,
    resolveResume: () => finishResume(),
    reducedMotion: (value) => {
      documentRef.body.dataset.reducedMotion = String(value);
      mutation();
    },
    playing() {
      media.paused = false;
      media.ended = false;
      media.dispatchEvent(new Event('playing'));
      equalizer.update({ status: 'playing', playing: true, enabled: true });
    },
    frame(timestamp = 100) {
      const current = [...frames.entries()];
      frames.clear();
      for (const [, callback] of current) callback(timestamp);
    },
  };
}

test('radio bars use separate bass-to-treble bins and settle for a silent signal', () => {
  const data = new Uint8Array(512);
  assert.equal(radioSpectrumBars(data, 48000, 1024), RADIO_IDLE_BARS);
  data[2] = 255;
  const bass = radioSpectrumBars(data, 48000, 1024);
  assert.notEqual(bass[0], '▁');
  assert.equal(bass.slice(1), '▁▁▁▁');
  data.fill(0);
  data[180] = 255;
  const treble = radioSpectrumBars(data, 48000, 1024);
  assert.equal(treble.slice(0, 4), '▁▁▁▁');
  assert.notEqual(treble[4], '▁');
  assert.equal(radioSpectrumBars(data, 0, 1024), RADIO_IDLE_BARS);
});

test('one audio graph follows signal changes at a bounded rate across track changes', async () => {
  const f = fixture();
  assert.equal(
    f.context(),
    undefined,
    'nothing captures audio before a user gesture',
  );
  await Promise.all([f.equalizer.unlock(), f.equalizer.unlock()]);
  assert.equal(f.context().createdSources, 1);
  assert.equal(f.context().source.destinations[0], f.context().destination);
  assert.equal(
    f.context().source.destinations.length,
    2,
    'one audible and one metering branch',
  );
  f.playing();
  f.context().data[2] = 255;
  f.frame(0);
  const bass = f.display.textContent;
  const shared = f.equalizer.reactivity;
  assert.ok(shared.bass > shared.treble);
  assert.ok(Object.isFrozen(shared) && Object.isFrozen(shared.bands));
  for (let i = 0; i < 50; i++) assert.equal(f.equalizer.reactivity, shared);
  assert.equal(f.context().samples, 1, 'readers reuse one sample');
  assert.equal(f.context().createdAnalysers, 1);
  assert.notEqual(bass, RADIO_IDLE_BARS);
  f.context().data.fill(0);
  f.context().data[180] = 255;
  f.frame(30);
  assert.equal(f.display.textContent, bass);
  f.frame(60);
  assert.notEqual(f.display.textContent, bass);
  assert.equal(f.context().samples, 2);
  f.media.dispatchEvent(new Event('emptied'));
  assert.equal(f.display.textContent, RADIO_IDLE_BARS);
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  f.playing();
  await f.equalizer.unlock();
  assert.equal(
    f.context().createdSources,
    1,
    'track changes reuse the media source',
  );
  f.equalizer.destroy();
});

test('pause, mute, zero volume, buffering, end and hidden tabs clear and stop the meter', async () => {
  const f = fixture();
  await f.equalizer.unlock();
  f.context().data.fill(255);
  for (const reason of [
    'pause',
    'mute',
    'volume',
    'waiting',
    'ended',
    'hidden',
  ]) {
    f.media.muted = false;
    f.media.volume = 0.7;
    f.documentRef.hidden = false;
    f.playing();
    f.frame();
    assert.notEqual(f.display.textContent, RADIO_IDLE_BARS, reason);
    if (reason === 'mute') {
      f.media.muted = true;
      f.media.dispatchEvent(new Event('volumechange'));
    } else if (reason === 'volume') {
      f.media.volume = 0;
      f.media.dispatchEvent(new Event('volumechange'));
    } else if (reason === 'hidden') {
      f.documentRef.hidden = true;
      f.documentRef.dispatchEvent(new Event('visibilitychange'));
    } else f.media.dispatchEvent(new Event(reason));
    assert.equal(f.display.textContent, RADIO_IDLE_BARS, reason);
    assert.equal(f.frames.size, 0, reason);
    assert.equal(f.display.dataset.active, 'false', reason);
    assert.equal(f.equalizer.reactivity, SILENT_MUSIC, reason);
  }
  f.equalizer.destroy();
});

test('reduced-motion changes disable animation and resume cleanly when opted back in', async () => {
  const f = fixture();
  await f.equalizer.unlock();
  f.context().data.fill(255);
  f.playing();
  f.frame();
  f.reducedMotion(true);
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  assert.equal(f.display.textContent, RADIO_IDLE_BARS);
  assert.equal(f.frames.size, 0);
  f.reducedMotion(false);
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.notEqual(f.display.textContent, RADIO_IDLE_BARS);
  f.equalizer.destroy();
});

test('cancelled frames cannot revive old loops after pause or destruction', async () => {
  const f = fixture();
  await f.equalizer.unlock();
  f.playing();
  const staleFrame = [...f.frames.values()][0];
  f.media.dispatchEvent(new Event('pause'));
  f.playing();
  staleFrame(100);
  assert.equal(f.frames.size, 1, 'only the replacement loop remains');
  assert.equal(f.context().samples, 0, 'cancelled callbacks cannot sample');
  f.equalizer.destroy();
  staleFrame(200);
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  assert.equal(f.frames.size, 0);
  assert.equal(f.display.textContent, RADIO_IDLE_BARS);
  f.media.dispatchEvent(new Event('playing'));
  assert.equal(f.frames.size, 0);
  await f.equalizer.unlock();
  f.equalizer.destroy();
  assert.equal(f.context().closes, 1);
});

test('unavailable or blocked Web Audio leaves media playback untouched', async () => {
  for (const options of [{ blocked: true }, { supported: false }]) {
    const f = fixture(options);
    f.playing();
    assert.equal(await f.equalizer.unlock(), false);
    assert.equal(f.media.paused, false);
    assert.equal(f.context()?.createdSources || 0, 0);
    assert.equal(f.frames.size, 0);
    assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
    f.equalizer.destroy();
  }
});

test('destroy during a pending resume cannot capture the audio element later', async () => {
  const f = fixture({ deferred: true });
  const unlocking = f.equalizer.unlock();
  f.equalizer.destroy();
  f.resolveResume();
  assert.equal(await unlocking, false);
  assert.equal(f.context().createdSources, 0);
  assert.equal(f.frames.size, 0);
});

test('seeking stays quiet through controller updates and resumes only with a fresh sample', async () => {
  const f = fixture();
  await f.equalizer.unlock();
  f.playing();
  f.context().data[2] = 255;
  f.frame(0);
  assert.ok(f.equalizer.reactivity.bass > 0);
  f.media.seeking = true;
  f.media.dispatchEvent(new Event('seeking'));
  f.equalizer.update({ playing: true, enabled: true, status: 'playing' });
  assert.equal(f.frames.size, 0);
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  f.context().data.fill(0);
  f.context().data[180] = 255;
  f.media.seeking = false;
  f.media.dispatchEvent(new Event('seeked'));
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  f.frame(60);
  assert.equal(f.equalizer.reactivity.bass, 0);
  assert.ok(f.equalizer.reactivity.treble > 0);
  f.context().state = 'suspended';
  assert.equal(
    f.equalizer.reactivity,
    SILENT_MUSIC,
    'suspension is visible before another frame',
  );
  f.equalizer.destroy();
});

test('native HLS follows song envelopes without capturing the media element', async () => {
  const f = fixture({ native: true, supported: false });
  const bytes = new Uint8Array(18);
  bytes.set([71, 69, 81, 49, 2, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255]);
  const spectrum = decodeMusicTimeline(bytes.buffer);
  const state = { status: 'playing', playing: true, enabled: true, spectrum };
  f.playing();
  f.equalizer.update(state);
  assert.equal(await f.equalizer.unlock(), true);
  assert.equal(f.context(), undefined);
  f.frame(0);
  assert.equal(f.display.textContent, '█▁▁▁▁');
  f.media.currentTime = 0.05;
  f.frame(50);
  assert.equal(f.display.textContent, '▁▁▁▁█');
  f.media.seeking = true;
  f.media.dispatchEvent(new Event('seeking'));
  f.equalizer.update(state);
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  f.media.currentTime = 0;
  f.media.seeking = false;
  f.media.dispatchEvent(new Event('seeked'));
  f.frame(100);
  assert.equal(f.display.textContent, '█▁▁▁▁');
  f.reducedMotion(true);
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  f.reducedMotion(false);
  f.frame(150);
  f.media.muted = true;
  f.media.dispatchEvent(new Event('volumechange'));
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  f.media.muted = false;
  f.equalizer.update({ ...state, spectrum: null });
  assert.equal(f.equalizer.reactivity, SILENT_MUSIC);
  assert.equal(f.frames.size, 0);
  f.equalizer.destroy();
});

test('native spectrum payloads reject truncated, oversized and unsupported data', () => {
  for (const buffer of [
    new ArrayBuffer(0),
    new ArrayBuffer(13),
    new ArrayBuffer(1024 * 1024 + 1),
  ])
    assert.equal(decodeMusicTimeline(buffer), null);
  const bytes = new Uint8Array([71, 69, 81, 49, 2, 0, 0, 0, 255, 0, 0, 0, 0]);
  assert.equal(decodeMusicTimeline(bytes.buffer), null);
});
