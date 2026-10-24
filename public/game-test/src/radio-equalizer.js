import { readMusicSpectrum, readMusicTimeline, SILENT_MUSIC } from './music-reactivity.js';
/** One bass-to-treble sample feeds both the radio display and the game artwork. */
const BLOCKS = '▁▂▃▄▅▆▇█';
export const RADIO_IDLE_BARS = BLOCKS[0].repeat(5);
const spectrumBars = music => music.bands.map(value => BLOCKS[Math.round(value * 7)]).join('');

export function radioSpectrumBars(data, sampleRate, fftSize) {
  return spectrumBars(readMusicSpectrum(data, sampleRate, fftSize));
}

export function createRadioEqualizer({
  media,
  display,
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  documentRef = globalThis.document,
  motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),
  MutationObserverClass = globalThis.MutationObserver,
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame(id),
} = {}) {
  let context = null, source = null, analyser = null, spectrum = null;
  let frame = null, lastSample = -Infinity, destroyed = false, buffering = false, seeking = false;
  let controllerPlaying = false, resumePending = null, generation = 0;
  let music = SILENT_MUSIC, timeline = null;
  const nativeHls = Boolean(media.canPlayType?.('application/vnd.apple.mpegurl'));
  const disposers = [];
  const listen = (node, event, handler) => {
    node?.addEventListener?.(event, handler);
    disposers.push(() => node?.removeEventListener?.(event, handler));
  };
  const reducedMotion = () => {
    const preference = documentRef?.body?.dataset?.reducedMotion;
    return preference === undefined ? Boolean(motionQuery?.matches) : preference === 'true';
  };
  const active = () => !destroyed && (nativeHls ? timeline : analyser && context?.state === 'running')
    && controllerPlaying && !media.paused && !media.ended && !media.muted && !seeking
    && media.volume > 0 && !buffering && !documentRef?.hidden && !reducedMotion();
  function paint(value) {
    if (display.textContent !== value) display.textContent = value;
  }
  function stop() {
    generation++;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    lastSample = -Infinity;
    music = SILENT_MUSIC;
    display.dataset.active = 'false';
    paint(RADIO_IDLE_BARS);
  }
  function schedule() {
    const token = generation;
    frame = requestFrame(timestamp => {
      if (token === generation) sample(timestamp);
    });
  }
  function sample(timestamp) {
    frame = null;
    if (!active()) { stop(); return; }
    if (timestamp - lastSample >= 50) {
      if (nativeHls) music = readMusicTimeline(timeline, media.currentTime);
      else {
        analyser.getByteFrequencyData(spectrum);
        music = readMusicSpectrum(spectrum, context.sampleRate, analyser.fftSize);
      }
      paint(spectrumBars(music));
      lastSample = timestamp;
    }
    schedule();
  }
  function sync() {
    if (!active()) { stop(); return; }
    display.dataset.active = 'true';
    if (frame === null) schedule();
  }
  async function unlock() {
    if (destroyed) return false;
    // Native HLS can bypass Web Audio. Keep its audible path intact and use
    // measured song envelopes at the media clock instead of an empty analyser.
    if (nativeHls) { sync(); return true; }
    if (!AudioContextClass) return false;
    if (resumePending) return resumePending;
    // Resume inside the user gesture, before moving playback into Web Audio.
    // A blocked context must leave the original media playback path untouched.
    try {
      context ??= new AudioContextClass();
      const resuming = context.state === 'running' ? Promise.resolve() : context.resume();
      resumePending = Promise.resolve(resuming).then(() => {
        if (destroyed || context.state !== 'running') return false;
        if (!source) {
          const meter = context.createAnalyser();
          meter.fftSize = 1024;
          meter.minDecibels = -80;
          meter.maxDecibels = -20;
          meter.smoothingTimeConstant = .65;
          source = context.createMediaElementSource(media);
          // Keep audible output independent of the optional metering branch.
          source.connect(context.destination);
          source.connect(meter);
          analyser = meter;
          spectrum = new Uint8Array(analyser.frequencyBinCount);
          listen(context, 'statechange', sync);
        }
        sync();
        return true;
      }).catch(() => false).finally(() => { resumePending = null; });
      return resumePending;
    } catch { return false; }
  }
  // Playback events confirm resumed audio even if the media seek flag lags.
  listen(media, 'playing', () => { seeking = false; buffering = false; controllerPlaying = true; sync(); });
  for (const event of ['pause', 'ended', 'emptied', 'error'])
    listen(media, event, () => { controllerPlaying = false; stop(); });
  for (const event of ['waiting', 'seeking'])
    listen(media, event, () => { if (event === 'seeking') seeking = true; buffering = true; stop(); });
  listen(media, 'seeked', () => { seeking = false; buffering = false; sync(); });
  listen(media, 'volumechange', sync);
  listen(documentRef, 'visibilitychange', sync);
  listen(motionQuery, 'change', sync);
  const observer = documentRef?.body && MutationObserverClass ? new MutationObserverClass(sync) : null;
  observer?.observe(documentRef.body, { attributes: true, attributeFilter: ['data-reduced-motion'] });
  stop();
  return {
    unlock,
    get reactivity() { return active() ? music : SILENT_MUSIC; },
    update(state) {
      if (timeline !== (state.spectrum || null)) { timeline = state.spectrum || null; stop(); }
      controllerPlaying = Boolean(state.playing && state.enabled
        && !['paused', 'idle', 'empty', 'unavailable', 'tap-to-play'].includes(state.status));
      buffering = ['buffering', 'loading', 'reconnecting'].includes(state.status);
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      disposers.forEach(dispose => dispose());
      observer?.disconnect();
      source?.disconnect();
      analyser?.disconnect();
      try { Promise.resolve(context?.close()).catch(() => {}); } catch {}
    },
  };
}
