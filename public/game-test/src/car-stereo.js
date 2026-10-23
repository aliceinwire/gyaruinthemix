import { localizeHTML, localizeText, localizeAttribute } from './localized-ui.js';
import { message, verbatim } from './i18n.js';
import { createStreamAudio } from './stream-audio.js';
import { createRadioEqualizer } from './radio-equalizer.js';
const time = (n) =>
  `${Math.floor((n || 0) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor((n || 0) % 60)
    .toString()
    .padStart(2, '0')}`;
const statuses = {
  idle: 'STANDBY',
  ready: 'READY',
  empty: 'NO DISC',
  loading: 'LOADING',
  playing: 'PLAY',
  paused: 'PAUSE',
  buffering: 'BUFFERING',
  reconnecting: 'RECONNECTING',
  unavailable: 'OFFLINE · RETRY',
  'tap-to-play': 'TAP PLAY',
};
export function createCarStereo({
  mount,
  onState = () => {},
  canPlay = () => true,
  loadAvailability,
  controllerFactory = createStreamAudio,
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  mount.classList.add('car-stereo');
  localizeHTML(mount, `<div class="stereo-topline"><span class="stereo-brand">ギャルインザミックス</span><span class="stereo-model">GT-MIX / CAR AUDIO</span></div>
    <div class="stereo-core"><div class="stereo-volume"><div class="stereo-knob" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="70"><span></span></div><span class="stereo-knob-label">VOLUME</span></div>
    <div class="stereo-screen"><div class="stereo-display-top"><span data-stereo="status" role="status">STANDBY</span><span class="stereo-equalizer" aria-hidden="true" translate="no">▁▁▁▁▁</span><span data-stereo="disc">TRACK —</span></div><strong data-stereo="title" translate="no"></strong><div class="stereo-display-bottom"><span data-stereo="format">MUSIC</span><output data-stereo="time">00:00 / 00:00</output></div></div></div>
    <div class="stereo-seek"><input type="range" min="0" max="1" step="0.1" value="0" aria-label="Playback position" disabled></div>
    <div class="stereo-controls"><button type="button" data-action="previous" aria-label="Previous track">◀◀<small>PREV</small></button><button type="button" class="stereo-play" data-action="play" aria-label="Play music">▶<small>PLAY</small></button><button type="button" data-action="next" aria-label="Next track">▶▶<small>NEXT</small></button><button type="button" data-action="mute" aria-label="Mute music" aria-pressed="false">ATT<small>MUTE</small></button><button type="button" data-action="list" aria-label="Show playlist" aria-expanded="false">LIST<small>TRACKS</small></button></div>
    <div class="stereo-playlist" hidden><label>SELECT TRACK<select aria-label="Select music track"></select></label><p>Private library · tap play to listen</p></div><audio preload="none" playsinline crossorigin="anonymous"></audio>`);
  const $ = (s) => mount.querySelector(s),
    media = $('audio'),
    knob = $('.stereo-knob'),
    seek = $('.stereo-seek input'),
    select = $('select'),
    list = $('.stereo-playlist');
  let controller,
    lastCatalog = '',
    dragging = false,
    seeking = false;
  const disposers = [];
  const listen = (node, name, fn) => {
    node.addEventListener(name, fn);
    disposers.push(() => node.removeEventListener(name, fn));
  };
  const equalizer = createRadioEqualizer({ media, display: $('.stereo-equalizer'), AudioContextClass });
  const render = (state) => {
    localizeText($('[data-stereo="status"]'), statuses[state.status] || 'READY');
    $('[data-stereo="title"]').textContent = state.track?.title || '';
    localizeText($('[data-stereo="disc"]'), message("TRACK {0}", [state.track ? String(state.catalog.findIndex((t) => t.id === state.track.id) + 1).padStart(2, '0') : '—']));
    localizeText($('[data-stereo="time"]'), message("{0} / {1}", [time(state.currentTime), time(state.duration)]));
    localizeText($('[data-stereo="format"]'), state.track?.excerpt
      ? 'PREVIEW EXCERPT'
      : 'MUSIC');
    const signature = state.catalog.map((t) => t.id).join(',');
    if (signature !== lastCatalog) {
      select.replaceChildren(
        ...state.catalog.map((t, i) => {
          const option = document.createElement('option');
          option.value = t.id;
          localizeText(option, message("{0} · {1}{2}", [String(i + 1).padStart(2, '0'), verbatim(t.title), t.excerpt ? ' · excerpt' : '']));
          return option;
        }),
      );
      lastCatalog = signature;
    }
    if (state.track) select.value = state.track.id;
    const playing = state.enabled;
    const play = $('[data-action="play"]');
    localizeHTML(play, playing
      ? 'Ⅱ<small>PAUSE</small>'
      : '▶<small>PLAY</small>');
    localizeAttribute(play, 'aria-label', playing ? 'Pause music' : 'Play music');
    $('[data-action="mute"]').setAttribute('aria-pressed', String(state.muted));
    knob.setAttribute('aria-valuenow', String(Math.round(state.volume * 100)));
    localizeAttribute(knob, 'aria-valuetext', message("{0} percent", [Math.round(state.volume * 100)]));
    knob.style.setProperty('--angle', `${-135 + state.volume * 270}deg`);
    seek.max = String(state.duration || 1);
    if (!seeking) seek.value = String(state.currentTime);
    seek.disabled =
      !state.track || ['idle', 'empty', 'unavailable'].includes(state.status);
    localizeAttribute(seek, 'aria-valuetext', message("{0} of {1}", [time(state.currentTime), time(state.duration)]));
    mount.dataset.playing = String(state.playing);
    equalizer.update(state);
    onState(state);
  };
  controller = controllerFactory({ media, onState: render, canPlay, loadAvailability });
  const unlockMeter = () => { void equalizer.unlock(); };
  listen(mount, 'pointerdown', unlockMeter);
  listen(mount, 'keydown', unlockMeter);
  listen(mount, 'click', unlockMeter);
  listen($('[data-action="play"]'), 'click', () => controller.toggle());
  listen($('[data-action="previous"]'), 'click', () =>
    controller.previous({ userGesture: true }),
  );
  listen($('[data-action="next"]'), 'click', () =>
    controller.next({ userGesture: true }),
  );
  listen($('[data-action="mute"]'), 'click', () =>
    controller.setMuted(!controller.state.muted),
  );
  listen($('[data-action="list"]'), 'click', () => {
    list.hidden = !list.hidden;
    $('[data-action="list"]').setAttribute(
      'aria-expanded',
      String(!list.hidden),
    );
    if (!list.hidden) {
      controller.loadCatalog();
      select.focus();
    }
  });
  listen(select, 'change', () =>
    controller.selectTrack(select.value, { userGesture: true }),
  );
  listen(seek, 'input', () => {
    seeking = true;
  });
  listen(seek, 'change', () => {
    controller.seek(Number(seek.value));
    seeking = false;
  });
  const pointerVolume = (event) => {
    const r = knob.getBoundingClientRect(),
      x = event.clientX - r.left - r.width / 2,
      y = event.clientY - r.top - r.height / 2;
    let a = (Math.atan2(x, -y) * 180) / Math.PI;
    a = Math.max(-135, Math.min(135, a));
    controller.setVolume((a + 135) / 270);
  };
  listen(knob, 'pointerdown', (event) => {
    dragging = true;
    knob.setPointerCapture?.(event.pointerId);
    pointerVolume(event);
  });
  listen(knob, 'pointermove', (event) => {
    if (dragging) pointerVolume(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(knob, type, () => {
      dragging = false;
    });
  listen(knob, 'keydown', (event) => {
    let value = controller.state.volume;
    if (['ArrowUp', 'ArrowRight'].includes(event.key)) value += 0.05;
    else if (['ArrowDown', 'ArrowLeft'].includes(event.key)) value -= 0.05;
    else if (event.key === 'Home') value = 0;
    else if (event.key === 'End') value = 1;
    else return;
    event.preventDefault();
    controller.setVolume(value);
  });
  controller.loadCatalog();
  return {
    controller,
    media,
    render,
    equalizer,
    destroy() {
      disposers.forEach((fn) => fn());
      controller.destroy();
      equalizer.destroy();
      mount.replaceChildren();
    },
  };
}
