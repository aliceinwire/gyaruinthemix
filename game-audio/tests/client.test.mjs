import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamAudio } from '../../public/game-test/src/stream-audio.js';
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
function fixture({ delay = false, native = true, blocked = false } = {}) {
  const media = new Media(),
    doc = new EventTarget();
  doc.hidden = false;
  let calls = [],
    states = [],
    resolveSession,
    playable = true;
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  if (!native) media.canPlayType = () => '';
  if (blocked)
    media.play = async () => {
      throw Object.assign(new Error(), { name: 'NotAllowedError' });
    };
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
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
        sessionId: 'x'.repeat(32),
        trackId: JSON.parse(opts.body).trackId,
        expiresAt: Date.now() + 120000,
        renewAfterMs: 40000,
        manifestUrl: '/game-audio/test.m3u8',
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
    media,
    doc,
    calls,
    states,
    release: () => resolveSession(),
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
test('volume, mute, seeking, visibility pause and deliberate resume', async () => {
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
  assert.equal(f.audio.enabled, false);
  assert.equal(f.media.paused, true);
  f.doc.hidden = false;
  f.doc.dispatchEvent(new Event('visibilitychange'));
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
