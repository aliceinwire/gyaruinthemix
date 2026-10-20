import { createGameAudio as createSoundCloudAudio } from './audio-soundcloud.js';
import { loadGameAudioConfig } from './game-audio-config.js';
import { createCarStereo } from './car-stereo.js';
/**
 * Synchronous bridge: SoundCloud works immediately while optional audio is
 * detected. Never switch away after a deliberate audio interaction, and never
 * replay a gesture asynchronously. Scene changes keep this one controller.
 */
export function createGameAudio({
  loadConfig = loadGameAudioConfig,
  soundCloudFactory = createSoundCloudAudio,
  streamingFactory = createStreamingAudio,
  documentRef = globalThis.document,
  ...options
}) {
  const { music, button, onEnabledChange = () => {} } = options;
  let destroyed = false,
    selectionLocked = false,
    active;
  const lockSelection = () => {
    selectionLocked = true;
  };
  const controllerOptions = {
    ...options,
    onEnabledChange(enabled) {
      if (enabled) lockSelection();
      onEnabledChange(enabled);
    },
  };
  // Capture clicks before the provider listener so an early toggle is retained.
  button.addEventListener('click', lockSelection, true);
  music.addEventListener('focus', lockSelection);
  active = soundCloudFactory(controllerOptions);
  const removeSelectionListeners = () => {
    button.removeEventListener('click', lockSelection, true);
    music.removeEventListener('focus', lockSelection);
  };
  const ready = Promise.resolve()
    .then(loadConfig)
    .then((available) => {
      if (
        available !== true ||
        destroyed ||
        selectionLocked ||
        active.enabled ||
        documentRef.activeElement === music
      )
        return;
      // An iframe is not a DOM mount for visible controls. Preserve its ID for
      // styling/focus queries, but never put an audio element inside the iframe.
      const mount = documentRef.createElement('div');
      mount.id = music.id;
      active.destroy();
      music.replaceWith(mount);
      try {
        active = streamingFactory({ ...controllerOptions, music: mount });
      } catch {
        mount.replaceWith(music);
        active = soundCloudFactory(controllerOptions);
      }
    })
    .catch(() => {})
    .finally(removeSelectionListeners);
  return {
    ready,
    unlock: (...args) => active.unlock(...args),
    pause: (...args) => active.pause(...args),
    beep: (...args) => active.beep(...args),
    get enabled() {
      return active.enabled;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeSelectionListeners();
      active.destroy();
    },
  };
}

export function createStreamingAudio(options) {
  const {
    music,
    button,
    status,
    onEnabledChange = () => {},
    canPlay = () => true,
    AudioContextClass = globalThis.AudioContext ||
      globalThis.webkitAudioContext,
  } = options;
  let enabled = false,
    suspending = false,
    context = null,
    destroyed = false;
  const sync = () => {
    button.textContent = enabled ? '音：あり' : '音：おやすみ';
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute(
      'aria-label',
      enabled ? '音楽と効果音をオフ' : '音楽と効果音をオン',
    );
    onEnabledChange(enabled);
  };
  const stereo = createCarStereo({
    mount: music,
    canPlay,
    onState: (state) => {
      if (!suspending) enabled = state.enabled;
      sync();
      if (status)
        status.textContent =
          state.status === 'unavailable'
            ? '音楽が読み込めへんかった。ゲームはそのまま遊べるで。'
            : state.status === 'tap-to-play'
              ? '▶ PLAY をもう一度タップしてな。'
              : state.track?.excerpt
                ? 'ギャルインザミックス · プレビュー'
                : 'ギャルインザミックス';
    },
  });
  async function unlock() {
    if (!enabled || destroyed || !canPlay()) return;
    stereo.controller.play();
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
  function toggle() {
    if (destroyed) return;
    if (enabled) {
      enabled = false;
      stereo.controller.pause();
    } else {
      enabled = true;
      stereo.controller.play({ userGesture: true });
      unlock();
    }
    sync();
  }
  function beep(frequency = 600, duration = 0.08) {
    if (!enabled || !context || destroyed) return;
    const osc = context.createOscillator(),
      gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      context.currentTime + duration,
    );
    osc.connect(gain).connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + duration);
  }
  button.addEventListener('click', toggle);
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
      button.removeEventListener('click', toggle);
      stereo.destroy();
      context?.close?.();
    },
  };
}
