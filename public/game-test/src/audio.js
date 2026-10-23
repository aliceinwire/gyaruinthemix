import { loadGameAudioConfig } from './game-audio-config.js';
import { createCarStereo } from './car-stereo.js';
/** One built-in player for the whole game. Availability never blocks gameplay. */
export function createGameAudio({ loadConfig = loadGameAudioConfig, streamingFactory = createStreamingAudio, ...options }) {
  const ready = Promise.resolve().then(loadConfig).then(value => value === true).catch(() => false);
  const active = streamingFactory({ ...options, loadAvailability: () => ready });
  let destroyed = false;
  return {
    ready,
    unlock: (...args) => { if (!destroyed) return active.unlock(...args); },
    pause: (...args) => { if (!destroyed) return active.pause(...args); },
    beep: (...args) => { if (!destroyed) return active.beep(...args); },
    get enabled() { return !destroyed && active.enabled; },
    destroy() { if (!destroyed) { destroyed = true; active.destroy(); } },
  };
}

export function createStreamingAudio(options) {
  const {
    music,
    onEnabledChange = () => {},
    canPlay = () => true,
    AudioContextClass = globalThis.AudioContext ||
      globalThis.webkitAudioContext,
  } = options;
  let enabled = false,
    suspending = false,
    context = null,
    effectVolume = 0.7,
    destroyed = false;
  const sync = () => {
    onEnabledChange(enabled);
  };
  const stereo = createCarStereo({
    mount: music,
    canPlay,
    AudioContextClass,
    loadAvailability: options.loadAvailability,
    onState: (state) => {
      if (!suspending) enabled = state.enabled;
      sync();
      effectVolume = state.muted ? 0 : state.volume;
    },
  });
  async function unlock() {
    if (!enabled || destroyed || !canPlay()) return;
    stereo.controller.play();
    stereo.equalizer.unlock();
    unlockEffects();
  }
  async function unlockEffects() {
    try {
      if (AudioContextClass) {
        context ??= new AudioContextClass();
        await context.resume();
      }
    } catch {}
  }
  function pause() {
    suspending = true;
    stereo.controller.pause();
    suspending = false;
  }
  function beep(frequency = 600, duration = 0.08) {
    if (!enabled || !context || destroyed || !effectVolume) return;
    const osc = context.createOscillator(),
      gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(0.035 * effectVolume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      context.currentTime + duration,
    );
    osc.connect(gain).connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + duration);
  }
  music.addEventListener('pointerdown', unlockEffects);
  music.addEventListener('keydown', unlockEffects);
  sync();
  return {
    unlock,
    pause,
    beep,
    get enabled() {
      return enabled;
    },
    destroy() {
      destroyed = true;
      enabled = false;
      music.removeEventListener('pointerdown', unlockEffects);
      music.removeEventListener('keydown', unlockEffects);
      stereo.destroy();
      context?.close?.();
    },
  };
}
