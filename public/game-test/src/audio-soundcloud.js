/** Official SoundCloud widget only. No track downloads, credentials, or local BGM. */
const API_URL = "https://w.soundcloud.com/player/api.js";
let apiLoading;
export function loadSoundCloudAPI() {
  if (globalThis.SC?.Widget) return Promise.resolve(globalThis.SC);
  if (apiLoading) return apiLoading;
  apiLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onload = () => globalThis.SC?.Widget
      ? resolve(globalThis.SC)
      : reject(new Error("SoundCloud API unavailable"));
    script.onerror = () => { script.remove(); reject(new Error("SoundCloud API blocked")); };
    document.head.append(script);
  }).catch((error) => { apiLoading = undefined; throw error; });
  return apiLoading;
}

/** Keep this controller and its iframe mounted across scene changes. */
export function createGameAudio({
  music,
  button,
  status,
  onEnabledChange = () => {},
  canPlay = () => true,
  loadAPI = loadSoundCloudAPI,
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
}) {
  let enabled = false, explicitlyMuted = false, context = null, widget = null, ready = false;
  let loading = null, destroyed = false, events = null;
  const hint = "SoundCloudプレイヤーの▶で、そのまま聴けるで。";
  const message = (text) => { if (status && !destroyed) status.textContent = text; };
  const allowed = () => !destroyed && enabled && canPlay();
  function pause() { widget?.pause(); }
  function play() {
    if (!ready || !allowed()) return;
    widget.setVolume(70);
    widget.play();
    message("再生されない時は、SoundCloudプレイヤーの▶をタップしてな。");
  }
  function initialize() {
    if (widget || loading || destroyed) return loading;
    loading = Promise.resolve().then(loadAPI).then((SC) => {
      if (destroyed) return;
      widget = SC.Widget(music);
      events = SC.Widget.Events;
      widget.bind(events.READY, () => {
        if (destroyed) return;
        ready = true;
        if (allowed()) play();
        else if (explicitlyMuted) { widget.setVolume(0); pause(); }
      });
      widget.bind(events.PLAY, () => {
        // Native SoundCloud Play is itself an explicit playback request. It
        // must not be undone by the game's stale mute or pause-menu state.
        if (destroyed) return;
        enabled = true;
        explicitlyMuted = false;
        widget.setVolume(70);
        syncButton();
        message("GYARUINTHEMIX · SoundCloudで再生中");
      });
      widget.bind(events.ERROR, () => {
        message("SoundCloudが読み込めへんかった。下の公式リンクから聴いてな。");
      });
    }).catch(() => {
      message("SoundCloudにつながらへんかった。公式プレイヤーか下のリンクを使ってな。");
    }).finally(() => { loading = null; });
    return loading;
  }
  async function unlock() {
    if (!allowed()) return;
    // Call widget play synchronously within the user's tap when already ready.
    play();
    initialize();
    try {
      if (AudioContextClass) {
        context ??= new AudioContextClass();
        await context.resume();
      }
    } catch { /* SoundCloud still works when Web Audio is unavailable. */ }
  }
  function beep(frequency = 600, duration = 0.08) {
    if (!enabled || !context || destroyed) return;
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    osc.connect(gain).connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + duration);
  }
  function syncButton() {
    button.textContent = enabled ? "音：あり" : "音：おやすみ";
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "音楽と効果音をオフ" : "音楽と効果音をオン");
    onEnabledChange(enabled);
  }
  function toggle() {
    if (destroyed) return;
    enabled = !enabled;
    explicitlyMuted = !enabled;
    syncButton();
    if (enabled) unlock();
    else { widget?.setVolume(0); pause(); message(hint); }
  }
  button.addEventListener("click", toggle);
  message(hint);
  // Attach early so direct widget interactions also respect the mute button.
  initialize();
  return {
    unlock, beep, pause,
    get enabled() { return enabled; },
    destroy() {
      destroyed = true;
      enabled = false;
      button.removeEventListener("click", toggle);
      widget?.setVolume(0);
      pause();
      if (widget && events) for (const name of [events.READY, events.PLAY, events.ERROR]) widget.unbind(name);
      context?.close?.();
    },
  };
}
