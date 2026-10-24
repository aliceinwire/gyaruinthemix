import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readMusicSpectrum,
  SILENT_MUSIC,
} from '../public/game-test/src/music-reactivity.js';
import {
  drawSignalHeadliner,
  drawCar,
  render,
} from '../public/game-test/src/renderer.js';
import { CAR_ART } from '../public/game-test/src/car-art.js';
import {
  resolveCrewVisuals,
  resolveCharacterPose,
} from '../public/game-test/src/character-actions.js';
import { createState, update } from '../public/game-test/src/simulation.js';

function signal(bin) {
  const data = new Uint8Array(512);
  data[bin] = 255;
  return readMusicSpectrum(data, 48000, 1024);
}
const bass = signal(2),
  treble = signal(180);

function context() {
  const calls = [],
    fills = [],
    stack = [];
  return new Proxy(
    {
      calls,
      fills,
      globalAlpha: 1,
      save() {
        stack.push({
          globalAlpha: this.globalAlpha,
          fillStyle: this.fillStyle,
        });
      },
      restore() {
        Object.assign(this, stack.pop());
      },
      fillRect(...args) {
        fills.push({ args, color: this.fillStyle, alpha: this.globalAlpha });
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
    },
    {
      get(target, key) {
        return key in target
          ? target[key]
          : (...args) => calls.push([key, ...args]);
      },
    },
  );
}

globalThis.OffscreenCanvas = class {
  getContext() {
    return context();
  }
};

test('visual samples isolate frequency bands and remain bounded for invalid inputs', () => {
  assert.ok(bass.bass > 0.5);
  assert.equal(bass.treble, 0);
  assert.equal(treble.bass, 0);
  assert.ok(treble.treble > 0);
  for (const args of [
    [null, 48000, 1024],
    [[], 48000, 1024],
    [[255], NaN, 1024],
    [[255], 48000, Infinity],
  ])
    assert.equal(readMusicSpectrum(...args), SILENT_MUSIC);
  const malformed = readMusicSpectrum([NaN, -1, Infinity, 999], 48000, 1024);
  assert.ok(
    malformed.bands.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ),
  );
  assert.throws(() => {
    bass.bands[0] = 0;
  }, TypeError);
});

function speaker(music, shielded = false, time = 0) {
  const g = context();
  drawSignalHeadliner(g, { headliner: {}, shielded }, 400, 465, time, music);
  return g;
}
const barHeights = (g) =>
  g.fills
    .filter(
      ({ args: [x, y, w, h] }) =>
        w === 3 && x >= -12 && x <= 8 && y + h === -84,
    )
    .map(({ args }) => args[3]);

test('speaker bars and cones follow the signal while closed shutters retain their meaning', () => {
  const low = speaker(bass),
    high = speaker(treble);
  assert.ok(barHeights(low)[0] > barHeights(high)[0]);
  assert.ok(barHeights(high)[4] > barHeights(low)[4]);
  assert.deepEqual(
    barHeights(speaker(SILENT_MUSIC, false, 0)),
    barHeights(speaker(SILENT_MUSIC, false, 37)),
  );
  const shutter = (g) =>
    g.fills.filter(({ args: [, , w, h] }) => w === 28 && h === 2);
  assert.deepEqual(
    shutter(speaker(bass, true)),
    shutter(speaker(treble, true)),
  );
  const coneWidths = (g) =>
    g.fills
      .filter(({ args: [, y, w, h] }) => w === h && w >= 8 && y < -20)
      .map(({ args }) => args[2]);
  assert.ok(Math.max(...coneWidths(low)) > Math.max(...coneWidths(high)));
});

test('car response stays within two pixels and does not change jump rush or damage poses', () => {
  const translations = (music, options) => {
    const g = context();
    drawCar(g, 190, 465, { time: 0, speed: 184, music, ...options });
    return g.calls.filter(([name]) => name === 'translate');
  };
  for (const carId of Object.keys(CAR_ART)) {
    const quiet = translations(SILENT_MUSIC, { carId });
    const loud = translations(bass, { carId });
    assert.equal(loud[0][1], quiet[0][1]);
    assert.equal(loud[0][2], quiet[0][2]);
    assert.ok(Math.abs(loud[1][2] - quiet[1][2]) <= 2);
    assert.notEqual(loud[1][2], quiet[1][2]);
    for (const action of [{ jump: 1 }, { rushing: true }, { damage: true }])
      assert.deepEqual(
        translations(bass, { carId, ...action }),
        translations(SILENT_MUSIC, { carId, ...action }),
      );
  }
});

test('crew keep the same actions and event frames while only idle motion follows bass', () => {
  const states = [
    {},
    { charging: true },
    { boosting: true },
    { invulnerability: 1 },
    { rushing: true },
    { crewWeaponGesture: { weapon: 'heart', elapsed: 0.2, duration: 0.7 } },
    { crewWeaponGesture: { weapon: 'bass', elapsed: 0.2, duration: 0.7 } },
  ];
  for (const state of states) {
    const quiet = resolveCrewVisuals(state, { time: 4.5 });
    const loud = resolveCrewVisuals(state, { time: 4.5, music: bass });
    assert.deepEqual(loud.action, quiet.action);
    for (const character of ['arisu', 'chana']) {
      const pose = resolveCharacterPose({ ...loud, character });
      const baseline = resolveCharacterPose({ ...quiet, character });
      assert.equal(pose.animationFrame, baseline.animationFrame);
      assert.equal(pose.localAction, baseline.localAction);
      if (
        state.charging ||
        state.boosting ||
        state.invulnerability ||
        state.rushing ||
        (character === 'chana' && state.crewWeaponGesture)
      )
        assert.equal(pose.musicBob, null);
    }
  }
  const idle = resolveCrewVisuals({}, { music: bass });
  assert.ok(resolveCharacterPose({ ...idle, character: 'chana' }).musicBob < 0);
  const reduced = resolveCrewVisuals({}, { music: bass, reducedMotion: true });
  assert.equal(
    resolveCharacterPose({ ...reduced, character: 'chana' }).musicBob,
    null,
  );
});

test('music rendering cannot change an identical seeded run and reduced motion ignores the signal', () => {
  const normal = createState({ mode: 'survival', seed: 'music-visuals' });
  const reactive = createState({ mode: 'survival', seed: 'music-visuals' });
  for (let frame = 0; frame < 90; frame++) {
    const input = { boost: frame < 30, rush: frame >= 45 && frame < 60 };
    update(normal, input, 1 / 60);
    update(reactive, input, 1 / 60);
    render(context(), normal, { time: frame / 60 });
    render(context(), reactive, {
      time: frame / 60,
      music: frame % 2 ? bass : treble,
    });
  }
  assert.deepEqual(reactive, normal);
  const quiet = context(),
    loud = context();
  render(quiet, normal, { reducedMotion: true });
  render(loud, normal, { reducedMotion: true, music: bass });
  assert.deepEqual(loud.fills, quiet.fills);
  assert.deepEqual(loud.calls, quiet.calls);
});
