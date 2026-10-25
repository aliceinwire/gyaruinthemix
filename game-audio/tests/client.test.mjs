import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamAudio } from '../../public/game/src/stream-audio.js';
const a = 't-' + 'a'.repeat(24),
  b = 't-' + 'b'.repeat(24),
  settle = () => new Promise((r) => setTimeout(r, 0));
class Media extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.duration = 48;
    this.paused = true;
    this.plays = 0;
    this.loads = 0;
  }
  canPlayType() {
    return 'maybe';
  }
  async play() {
    this.plays++;
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads++;
  }
  removeAttribute() {
    this.src = '';
    this.currentTime = 0;
  }
}
function fixture({
  delay = false,
  native = true,
  blocked = false,
  spectrum = false,
  delayedSpectrum = false,
  brokenSpectrum = false,
} = {}) {
  const media = new Media(),
    doc = new EventTarget();
  doc.hidden = false;
  let calls = [],
    states = [],
    resolveSession,
    playable = true,
    sessionId = 'x'.repeat(32),
    nextTimer = 0;
  const spectrumResolvers = [];
  const scheduled = new Map();
  const timers = {
    setTimeout: (fn) => {
      const id = ++nextTimer;
      scheduled.set(id, fn);
      return id;
    },
    clearTimeout: (id) => scheduled.delete(id),
  };
  if (!native) media.canPlayType = () => '';
  if (blocked)
    media.play = async () => {
      throw Object.assign(new Error(), { name: 'NotAllowedError' });
    };
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/spectrum.bin')) {
      const value = new Uint8Array([
        71,
        69,
        81,
        49,
        1,
        0,
        0,
        0,
        url.includes(a) ? 255 : 0,
        0,
        0,
        0,
        url.includes(b) ? 255 : 0,
      ]);
      const result = {
        ok: !brokenSpectrum,
        arrayBuffer: async () => value.buffer,
      };
      if (delayedSpectrum)
        return new Promise((resolve) =>
          spectrumResolvers.push(() => resolve(result)),
        );
      return result;
    }
    if (url.endsWith('/catalog'))
      return {
        ok: true,
        json: async () => ({
          tracks: [a, b].map((id, i) => ({
            id,
            title: `ギャルインザミックス ${i + 1}`,
            duration: 48,
            excerpt: true,
          })),
        }),
      };
    const result = {
      ok: true,
      json: async () => ({
        sessionId,
        trackId: JSON.parse(opts.body).trackId,
        expiresAt: Date.now() + 120000,
        renewAfterMs: 40000,
        manifestUrl: '/game-audio/test.m3u8',
        ...(spectrum
          ? {
              spectrumUrl: `/game-audio/v1/stream/${JSON.parse(opts.body).trackId}/${sessionId}/spectrum.bin`,
            }
          : {}),
      }),
    };
    if (delay) return new Promise((r) => (resolveSession = () => r(result)));
    return result;
  };
  let imports = 0;
  const hls = {
    startLoad() {},
    stopLoad() {},
    attachMedia() {},
    loadSource() {},
    destroy() {},
    on() {},
  };
  const Hls = class {
    constructor() {
      return hls;
    }
    static isSupported() {
      return true;
    }
    static Events = { ERROR: 'error' };
  };
  const audio = createStreamAudio({
    media,
    documentRef: doc,
    fetchImpl,
    timers,
    canPlay: () => playable,
    onState: (s) => states.push(s),
    loadHlsImpl: async () => {
      imports++;
      return Hls;
    },
  });
  return {
    audio,
    spectrumResolvers,
    setSpectrumAvailable: () => {
      brokenSpectrum = false;
    },
    media,
    doc,
    calls,
    states,
    release: () => resolveSession(),
    setSessionId: (value) => {
      sessionId = value;
    },
    renew: async () => {
      const [id, fn] = scheduled.entries().next().value;
      scheduled.delete(id);
      await fn();
    },
    setPlayable: (v) => (playable = v),
    imports: () => imports,
  };
}
test('no autoplay, no session and no JS fallback before explicit play', async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  await f.audio.loadCatalog();
  assert.equal(f.media.plays, 0);
  assert.equal(f.imports(), 0);
  await f.audio.play();
  assert.equal(f.media.plays, 0);
  await f.audio.play({ userGesture: true });
  assert.equal(f.media.plays, 1);
  assert.equal(f.imports(), 0);
  assert.equal(f.audio.state.playing, true);
  f.audio.destroy();
});
test('mute/pause during loading and destroy prevent late play', async () => {
  const f = fixture({ delay: true });
  await f.audio.loadCatalog();
  const work = f.audio.play({ userGesture: true });
  await settle();
  f.audio.pause();
  f.release();
  await work;
  assert.equal(f.media.plays, 0);
  f.audio.destroy();
  const g = fixture({ delay: true });
  await g.audio.loadCatalog();
  const pending = g.audio.play({ userGesture: true });
  await settle();
  g.audio.destroy();
  g.release();
  await pending;
  assert.equal(g.media.plays, 0);
});
test('map/quiz unlocks reuse the same media session and preserve timeline', async () => {
  const f = fixture();
  await f.audio.loadCatalog();
  await f.audio.play({ userGesture: true });
  f.media.currentTime = 17;
  const sessions = () =>
    f.calls.filter((c) => c.url.endsWith('/session')).length;
  for (const scene of ['map', 'quiz', 'playing'])
    assert.equal(await f.audio.play(), true, scene);
  assert.equal(sessions(), 1);
  assert.equal(f.media.currentTime, 17);
  f.audio.pause();
  await f.audio.play();
  assert.equal(f.audio.state.playing, true);
  assert.equal(sessions(), 1);
  f.audio.destroy();
});
test('track switching while paused does not start music, next while playing continues', async () => {
  const f = fixture();
  await f.audio.loadCatalog();
  await f.audio.next({ userGesture: true });
  assert.equal(f.audio.state.track.id, b);
  assert.equal(f.media.plays, 0);
  await f.audio.play({ userGesture: true });
  await f.audio.next({ userGesture: true });
  assert.equal(f.audio.state.track.id, a);
  assert.equal(f.audio.state.playing, true);
  f.media.currentTime = 10;
  await f.audio.previous();
  assert.equal(f.media.currentTime, 0);
  assert.equal(f.audio.state.track.id, a);
  f.audio.destroy();
});
test('volume, mute, seeking and background playback preserve manual pause', async () => {
  const f = fixture();
  await f.audio.loadCatalog();
  await f.audio.play({ userGesture: true });
  f.audio.setVolume(2);
  assert.equal(f.media.volume, 1);
  f.audio.setVolume(-2);
  assert.equal(f.media.volume, 0);
  f.audio.setMuted(true);
  assert.equal(f.media.muted, true);
  f.audio.seek(100);
  assert.equal(f.media.currentTime, 48);
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.audio.enabled, true);
  assert.equal(f.media.paused, false);
  await f.renew();
  assert.equal(f.calls.filter((c) => c.url.endsWith('/session')).length, 2);
  f.audio.pause();
  f.doc.hidden = false;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(f.media.paused, true);
  await f.audio.play({ userGesture: true });
  assert.equal(f.media.paused, false);
  f.audio.destroy();
});
test('non-native fallback is local and lazy; browser autoplay denial leaves a retry', async () => {
  const f = fixture({ native: false });
  await f.audio.loadCatalog();
  assert.equal(f.imports(), 0);
  await f.audio.play({ userGesture: true });
  assert.equal(f.imports(), 1);
  f.audio.destroy();
  const g = fixture({ blocked: true });
  await g.audio.loadCatalog();
  await g.audio.play({ userGesture: true });
  assert.equal(g.audio.state.status, 'tap-to-play');
  assert.equal(g.audio.enabled, false);
  g.audio.destroy();
});
test('disallowed game pause does not start on late session completion', async () => {
  const f = fixture({ delay: true });
  await f.audio.loadCatalog();
  const p = f.audio.play({ userGesture: true });
  await settle();
  f.setPlayable(false);
  f.release();
  await p;
  assert.equal(f.media.plays, 0);
  f.audio.destroy();
});
test('repeated unlock while lazy HLS import is pending waits for attached source', async () => {
  const media = new Media();
  media.canPlayType = () => '';
  let attached = false,
    release;
  media.play = async () => {
    if (!attached)
      throw Object.assign(new Error(), { name: 'NotSupportedError' });
    media.paused = false;
    media.plays++;
  };
  const Hls = class {
    static isSupported() {
      return true;
    }
    static Events = { ERROR: 'error' };
    on() {}
    attachMedia() {
      attached = true;
    }
    loadSource() {}
    startLoad() {}
    destroy() {}
  };
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/catalog')
        ? { tracks: [{ id: a, title: 'ギャルインザミックス', duration: 48 }] }
        : {
            sessionId: 'x'.repeat(32),
            trackId: a,
            expiresAt: Date.now() + 120000,
            manifestUrl: '/game-audio/test.m3u8',
          },
  });
  const audio = createStreamAudio({
    media,
    fetchImpl,
    documentRef: new EventTarget(),
    timers: { setTimeout: () => 1, clearTimeout() {} },
    loadHlsImpl: () => new Promise((r) => (release = () => r(Hls))),
  });
  await audio.loadCatalog();
  const first = audio.play({ userGesture: true });
  await settle();
  const second = audio.play();
  await settle();
  assert.equal(media.plays, 0);
  release();
  await Promise.all([first, second]);
  assert.equal(audio.enabled, true);
  assert.equal(media.paused, false);
  audio.destroy();
});
test('stale rejected play promise cannot cancel a newer deliberate replay', async () => {
  const media = new Media(),
    pending = [];
  media.play = () =>
    new Promise((resolve, reject) =>
      pending.push({
        resolve: () => {
          media.paused = false;
          resolve();
        },
        reject,
      }),
    );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/catalog')
        ? { tracks: [{ id: a, title: 'ギャルインザミックス', duration: 48 }] }
        : {
            sessionId: 'x'.repeat(32),
            trackId: a,
            expiresAt: Date.now() + 120000,
            manifestUrl: '/game-audio/test.m3u8',
          },
  });
  const audio = createStreamAudio({
    media,
    fetchImpl,
    documentRef: new EventTarget(),
    timers: { setTimeout: () => 1, clearTimeout() {} },
  });
  await audio.loadCatalog();
  const first = audio.play({ userGesture: true });
  await settle();
  audio.pause();
  const latest = audio.play({ userGesture: true });
  await settle();
  assert.equal(pending.length, 2);
  pending[0].reject(Object.assign(new Error(), { name: 'AbortError' }));
  await first;
  assert.equal(audio.enabled, true);
  pending[1].resolve();
  await latest;
  assert.equal(audio.enabled, true);
  assert.equal(audio.state.playing, true);
  audio.destroy();
});

test('disabled discovery cannot request a catalog, session, or media even after Play', async () => {
  const media = new Media(),
    calls = [];
  const controller = createStreamAudio({
    media,
    documentRef: new EventTarget(),
    loadAvailability: async () => false,
    fetchImpl: async (url) => {
      calls.push(url);
      throw Error('unexpected request');
    },
  });
  assert.deepEqual(await controller.loadCatalog(), []);
  assert.equal(await controller.play({ userGesture: true }), false);
  assert.deepEqual(calls, []);
  assert.equal(media.plays, 0);
  assert.equal(controller.state.enabled, false);
  assert.equal(controller.state.status, 'unavailable');
  controller.destroy();
});
test('destroy during delayed discovery prevents all late requests', async () => {
  let ready;
  const calls = [],
    controller = createStreamAudio({
      media: new Media(),
      documentRef: new EventTarget(),
      loadAvailability: () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
      fetchImpl: async (url) => {
        calls.push(url);
        throw Error('unexpected request');
      },
    });
  const loading = controller.loadCatalog();
  controller.destroy();
  ready(true);
  assert.deepEqual(await loading, []);
  assert.deepEqual(calls, []);
});

test('returning to a throttled tab renews its session at the current position', async () => {
  const f = fixture();
  await f.audio.play({ userGesture: true });
  f.media.currentTime = 17;
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  f.setSessionId('y'.repeat(32));
  f.doc.hidden = false;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(f.media.currentTime, 17);
  assert.equal(f.media.paused, false);
  assert.equal(f.media.loads, 2);
  f.audio.destroy();
});
test('manual pause during return renewal prevents a late restart', async () => {
  const f = fixture({ delay: true });
  const playing = f.audio.play({ userGesture: true });
  await settle();
  f.release();
  await playing;
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  f.doc.hidden = false;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  f.audio.pause();
  f.release();
  await settle();
  assert.equal(f.media.plays, 1);
  assert.equal(f.media.paused, true);
  assert.equal(f.audio.enabled, false);
  f.audio.destroy();
});
test('the next track continues while the tab is hidden', async () => {
  const f = fixture();
  await f.audio.play({ userGesture: true });
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  f.media.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(f.audio.state.track.id, b);
  assert.equal(f.media.paused, false);
  f.audio.destroy();
});

test('only native HLS fetches spectrum data after consent and late tracks cannot replace it', async () => {
  const f = fixture({ spectrum: true, delayedSpectrum: true });
  await f.audio.loadCatalog();
  assert.equal(
    f.calls.filter((c) => c.url.endsWith('/spectrum.bin')).length,
    0,
  );
  await f.audio.play({ userGesture: true });
  assert.equal(f.media.plays, 1);
  await f.audio.next({ userGesture: true });
  assert.equal(f.spectrumResolvers.length, 2);
  f.spectrumResolvers[1]();
  await settle();
  const current = f.audio.state.spectrum;
  assert.equal(current.data[4], 255);
  f.spectrumResolvers[0]();
  await settle();
  assert.equal(f.audio.state.spectrum, current);
  f.audio.destroy();
  assert.equal(f.audio.state.spectrum, null);
  const js = fixture({ native: false, spectrum: true });
  await js.audio.play({ userGesture: true });
  assert.equal(
    js.calls.filter((c) => c.url.endsWith('/spectrum.bin')).length,
    0,
  );
  js.audio.destroy();
});

test('unavailable spectrum metadata never prevents native playback', async () => {
  const f = fixture({ spectrum: true, brokenSpectrum: true });
  await f.audio.play({ userGesture: true });
  await settle();
  assert.equal(f.audio.state.playing, true);
  assert.equal(f.audio.state.spectrum, null);
  f.setSpectrumAvailable();
  await f.renew();
  await settle();
  assert.equal(f.audio.state.spectrum.data[0], 255);
  f.audio.destroy();
});

test('a chart launch can start a selected track from silence using the existing media element', async () => {
  const f = fixture();
  await f.audio.loadCatalog();
  assert.equal(f.media.plays, 0);
  await f.audio.selectTrack(b, { autoplay: true, userGesture: true });
  assert.equal(f.audio.state.track.id, b);
  assert.equal(f.audio.state.playing, true);
  assert.equal(f.media.currentTime, 0);
  const revision = f.audio.state.revision;
  f.audio.seek(10);
  assert.ok(f.audio.state.revision > revision);
  f.media.seeking = true;
  f.media.dispatchEvent(new Event('seeking'));
  assert.equal(f.audio.state.seeking, true);
  f.media.dispatchEvent(new Event('playing'));
  assert.equal(f.audio.state.seeking, false, 'confirmed playback overrides a stale native seek flag');
  f.media.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(f.audio.state.endedTrackId, b);
  assert.equal(f.audio.state.endRevision, 1);
  assert.equal(f.audio.state.track.id, a);
  f.audio.destroy();
});
