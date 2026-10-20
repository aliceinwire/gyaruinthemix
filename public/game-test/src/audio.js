import { createGameAudio as createSoundCloudAudio } from './audio-soundcloud.js';
import { GAME_AUDIO_STREAMING_ENABLED } from './game-audio-config.js';
import { createCarStereo } from './car-stereo.js';
/** Drop-in bridge. Existing SoundCloud behavior is the unchanged default. */
export function createGameAudio(options) {
  if (!GAME_AUDIO_STREAMING_ENABLED) return createSoundCloudAudio(options);
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
