/** One persistent HTMLAudioElement, never one element per chunk. Silent until consent. */
const BASE = '/game-audio/v1';
export const loadHls = () =>
  import('./vendor/hls.light.min.mjs').then((m) => m.default);
export function createStreamAudio({
  media,
  trackId,
  onState = () => {},
  canPlay = () => true,
  loadAvailability = async () => true,
  fetchImpl = globalThis.fetch,
  loadHlsImpl = loadHls,
  documentRef = globalThis.document,
  timers = globalThis,
} = {}) {
  if (!media) throw new Error('A persistent audio element is required.');
  let catalog = [],
    track = null,
    status = 'idle',
    desired = false,
    consented = false,
    destroyed = false,
    hls = null,
    session = null,
    renewTimer = null,
    generation = 0,
    pending = null,
    recoveries = 0,
    repeat = true;
  let volume = 0.7,
    muted = false,
    sessionQueue = Promise.resolve(),
    playIntent = 0;
  const listeners = [];
  media.preload = 'none';
  media.volume = volume;
  media.autoplay = false;
  const state = () => ({
    catalog,
    track,
    status,
    currentTime: Number(media.currentTime) || 0,
    duration: Number.isFinite(media.duration)
      ? media.duration
      : track?.duration || 0,
    playing: !media.paused,
    enabled: desired,
    muted,
    volume,
    repeat,
  });
  const emit = () => {
    if (!destroyed) onState(state());
  };
  const listen = (target, name, fn) => {
    target?.addEventListener(name, fn);
    listeners.push(() => target?.removeEventListener(name, fn));
  };
  const allowed = () =>
    !destroyed && desired && consented && canPlay();
  const cancelTimer = () => {
    if (renewTimer !== null) timers.clearTimeout(renewTimer);
    renewTimer = null;
  };
  const message = (s) => {
    status = s;
    emit();
  };
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${BASE}/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
    });
    if (!response.ok) throw new Error(`Audio service ${response.status}`);
    return response.json();
  };
  async function loadCatalog() {
    try {
      const available = await loadAvailability();
      if (destroyed) return [];
      if (!available) { desired = false; message('unavailable'); return []; }
      const data = await request('catalog');
      if (destroyed) return [];
      catalog = Array.isArray(data.tracks)
        ? data.tracks.filter(
            (t) =>
              /^t-[a-f0-9]{24}$/.test(t.id) &&
              typeof t.title === 'string' &&
              t.duration > 0,
          )
        : [];
      track =
        catalog.find((t) => t.id === track?.id) ||
        catalog.find((t) => t.id === trackId) ||
        catalog[0] ||
        null;
      if (!track) desired = false;
      message(track ? 'ready' : 'empty');
      return catalog;
    } catch {
      if (destroyed) return [];
      desired = false;
      message('unavailable');
      return [];
    }
  }
  async function safePlay() {
    if (!allowed()) return false;
    const intent = playIntent;
    try {
      hls?.startLoad();
      await media.play();
      if (intent !== playIntent) return false;
      if (!allowed()) {
        media.pause();
        return false;
      }
      recoveries = 0;
      message('playing');
      return true;
    } catch (e) {
      if (intent !== playIntent || !allowed()) return false;
      desired = false;
      cancelTimer();
      message(e?.name === 'NotAllowedError' ? 'tap-to-play' : 'unavailable');
      return false;
    }
  }
  function scheduleRenew() {
    cancelTimer();
    if (!allowed() || !session) return;
    renewTimer = timers.setTimeout(
      () =>
        refreshSession().catch(() => {
          if (allowed()) {
            message('reconnecting');
            renewTimer = timers.setTimeout(() => {
              if (allowed()) recover();
            }, 5000);
          }
        }),
      session.renewAfterMs || 40000,
    );
  }
  function getSession() {
    const id = track.id;
    const next = sessionQueue
      .catch(() => {})
      .then(() =>
        request('session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: id }),
        }),
      );
    sessionQueue = next;
    return next;
  }
  async function refreshSession() {
    if (!allowed()) return;
    const version = generation,
      t = track.id,
      fresh = await getSession();
    if (!allowed() || version !== generation || t !== track?.id) return;
    if (session?.sessionId !== fresh.sessionId) {
      await attach(fresh, media.currentTime, version);
      if (allowed()) await safePlay();
    } else session = fresh;
    scheduleRenew();
  }
  async function attach(fresh, position, version) {
    if (version !== generation || destroyed) return;
    session = fresh;
    hls?.destroy();
    hls = null;
    // Native Safari HLS first. The JS fallback is lazy and local, never a CDN iframe.
    if (media.canPlayType('application/vnd.apple.mpegurl')) {
      media.src = fresh.manifestUrl;
      media.load();
      if (position > 0) media.currentTime = position;
    } else {
      const Hls = await loadHlsImpl();
      if (version !== generation || destroyed) return;
      if (!Hls.isSupported()) throw new Error('No HLS support.');
      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        backBufferLength: 8,
        maxBufferLength: 12,
        maxMaxBufferLength: 20,
        startPosition: position || 0,
        manifestLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 2,
      });
      const thisHls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (thisHls !== hls || destroyed || !data.fatal) return;
        recover(data.type === 'mediaError');
      });
      hls.attachMedia(media);
      hls.loadSource(fresh.manifestUrl);
    }
  }
  async function prepare(force = false) {
    if (pending && !force) return pending;
    const version = ++generation,
      position = Number(media.currentTime) || 0;
    pending = (async () => {
      if (!track) await loadCatalog();
      if (!track || destroyed || version !== generation) return false;
      message('loading');
      const fresh = await getSession();
      if (version !== generation || destroyed) return false;
      await attach(fresh, position, version);
      if (version !== generation || destroyed) return false;
      message('ready');
      return true;
    })()
      .catch(() => {
        if (version === generation) {
          desired = false;
          message('unavailable');
        }
        return false;
      })
      .finally(() => {
        if (version === generation) pending = null;
      });
    return pending;
  }
  async function play({ userGesture = false } = {}) {
    if (destroyed) return false;
    if (userGesture) {
      consented = true;
      playIntent++;
    }
    if (!consented) return false;
    desired = true;
    if (!canPlay()) {
      desired = false;
      emit();
      return false;
    }
    if (
      !pending &&
      session &&
      session.trackId === track?.id &&
      session.expiresAt > Date.now() + 5000
    ) {
      const played = await safePlay();
      scheduleRenew();
      return played;
    }
    const ready = await prepare();
    if (!ready || !allowed()) return false;
    const played = await safePlay();
    scheduleRenew();
    return played;
  }
  function pause() {
    playIntent++;
    desired = false;
    cancelTimer();
    hls?.stopLoad();
    media.pause();
    message('paused');
  }
  async function recover(mediaError = false) {
    if (!allowed()) return;
    if (recoveries++ >= 2) {
      pause();
      message('unavailable');
      return;
    }
    message('reconnecting');
    if (mediaError && hls) {
      hls.recoverMediaError();
      return;
    }
    await prepare(true);
    if (allowed()) {
      await safePlay();
      scheduleRenew();
    }
  }
  async function selectTrack(id, { userGesture = false } = {}) {
    const selected = catalog.find((t) => t.id === id);
    if (!selected || destroyed) return false;
    const resume = desired || !media.paused;
    pause();
    generation++;
    pending = null;
    hls?.destroy();
    hls = null;
    session = null;
    media.removeAttribute('src');
    media.load();
    track = selected;
    message('ready');
    return resume ? play({ userGesture }) : true;
  }
  async function step(delta, { userGesture = false } = {}) {
    if (!catalog.length) await loadCatalog();
    if (!catalog.length) return false;
    if (delta < 0 && (Number(media.currentTime) || 0) > 3) {
      seek(0);
      return true;
    }
    const current = Math.max(
      0,
      catalog.findIndex((t) => t.id === track?.id),
    );
    return selectTrack(
      catalog[(current + delta + catalog.length) % catalog.length].id,
      { userGesture },
    );
  }
  function seek(seconds) {
    const duration = Number.isFinite(media.duration)
      ? media.duration
      : track?.duration || 0;
    if (session && Number.isFinite(seconds)) {
      media.currentTime = Math.max(0, Math.min(duration, seconds));
      emit();
    }
  }
  function setVolume(value) {
    if (!Number.isFinite(value)) return;
    volume = Math.max(0, Math.min(1, value));
    media.volume = volume;
    emit();
  }
  function setMuted(value) {
    muted = Boolean(value);
    media.muted = muted;
    emit();
  }
  listen(media, 'timeupdate', emit);
  listen(media, 'durationchange', emit);
  listen(media, 'playing', () => {
    if (!allowed()) {
      media.pause();
      return;
    }
    message('playing');
  });
  listen(media, 'waiting', () => {
    if (allowed()) message('buffering');
  });
  listen(media, 'error', () => {
    if (allowed()) recover();
  });
  listen(media, 'ended', async () => {
    if (!allowed()) return;
    if (catalog.length > 1) {
      await step(1);
    } else if (repeat) {
      seek(0);
      await safePlay();
      scheduleRenew();
    } else pause();
  });
  listen(documentRef, 'visibilitychange', () => {
    // Background audio keeps its play intent. Renew promptly after timer throttling.
    if (!documentRef.hidden && allowed() && session) {
      refreshSession().then(() => {
        if (allowed() && media.paused) return safePlay();
      }).catch(() => {
        if (allowed()) recover();
      });
    }
  });
  emit();
  return {
    loadCatalog,
    selectTrack,
    play,
    pause,
    toggle: () => (desired ? pause() : play({ userGesture: true })),
    next: (o) => step(1, o),
    previous: (o) => step(-1, o),
    seek,
    setVolume,
    setMuted,
    setRepeat: (value) => {
      repeat = Boolean(value);
      emit();
    },
    get state() {
      return state();
    },
    get enabled() {
      return desired;
    },
    destroy() {
      destroyed = true;
      playIntent++;
      desired = false;
      generation++;
      cancelTimer();
      hls?.destroy();
      hls = null;
      media.pause();
      media.removeAttribute('src');
      media.load();
      listeners.forEach((fn) => fn());
    },
  };
}
