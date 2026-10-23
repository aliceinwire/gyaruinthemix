/** Five bass-to-treble bands sampled from the radio's persistent audio element. */
const BANDS = Object.freeze([45, 150, 500, 1600, 5000, 16000]);
const BLOCKS = '▁▂▃▄▅▆▇█';
export const RADIO_IDLE_BARS = BLOCKS[0].repeat(5);

export function radioSpectrumBars(data, sampleRate, fftSize) {
  if (!data?.length || !(sampleRate > 0) || !(fftSize > 0)) return RADIO_IDLE_BARS;
  return BANDS.slice(0, -1).map((low, band) => {
    const first = Math.max(1, Math.floor(low * fftSize / sampleRate));
    const end = Math.min(data.length, Math.max(first + 1, Math.ceil(BANDS[band + 1] * fftSize / sampleRate)));
    let peak = 0, sum = 0;
    for (let bin = first; bin < end; bin++) {
      peak = Math.max(peak, data[bin]);
      sum += data[bin];
    }
    const energy = peak * .8 + (sum / Math.max(1, end - first)) * .2;
    return BLOCKS[Math.max(0, Math.min(7, Math.round(energy / 255 * 7)))];
  }).join('');
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
  let frame = null, lastSample = -Infinity, destroyed = false, buffering = false;
  let controllerPlaying = false, resumePending = null, generation = 0;
  const disposers = [];
  const listen = (node, event, handler) => {
    node?.addEventListener?.(event, handler);
    disposers.push(() => node?.removeEventListener?.(event, handler));
  };
  const reducedMotion = () => {
    const preference = documentRef?.body?.dataset?.reducedMotion;
    return preference === undefined ? Boolean(motionQuery?.matches) : preference === 'true';
  };
  const active = () => !destroyed && analyser && context?.state === 'running'
    && controllerPlaying && !media.paused && !media.ended && !media.muted
    && media.volume > 0 && !buffering && !documentRef?.hidden && !reducedMotion();
  function paint(value) {
    if (display.textContent !== value) display.textContent = value;
  }
  function stop() {
    generation++;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    lastSample = -Infinity;
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
      analyser.getByteFrequencyData(spectrum);
      paint(radioSpectrumBars(spectrum, context.sampleRate, analyser.fftSize));
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
    if (destroyed || !AudioContextClass) return false;
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
  listen(media, 'playing', () => { buffering = false; controllerPlaying = true; sync(); });
  for (const event of ['pause', 'ended', 'emptied', 'error'])
    listen(media, event, () => { controllerPlaying = false; stop(); });
  for (const event of ['waiting', 'seeking'])
    listen(media, event, () => { buffering = true; stop(); });
  listen(media, 'seeked', () => { buffering = false; sync(); });
  listen(media, 'volumechange', sync);
  listen(documentRef, 'visibilitychange', sync);
  listen(motionQuery, 'change', sync);
  const observer = documentRef?.body && MutationObserverClass ? new MutationObserverClass(sync) : null;
  observer?.observe(documentRef.body, { attributes: true, attributeFilter: ['data-reduced-motion'] });
  stop();
  return {
    unlock,
    update(state) {
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
