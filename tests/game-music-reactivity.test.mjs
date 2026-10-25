import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readMusicSpectrum,
  SILENT_MUSIC,
  weaponMusicLevel,
} from '../public/game/src/music-reactivity.js';
import { drawSurvival } from '../public/game/src/survival-ui.js';
import {
  createRoadFeedback,
  captureRoadFeedback,
  drawRoadFeedback,
} from '../public/game/src/road-feedback.js';
import {
  drawSignalHeadliner,
  drawCar,
  render,
} from '../public/game/src/renderer.js';
import { CAR_ART } from '../public/game/src/car-art.js';
import {
  resolveCrewVisuals,
  resolveCharacterPose,
} from '../public/game/src/character-actions.js';
import { createState, update } from '../public/game/src/simulation.js';

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
      stroke() {
        calls.push([
          'stroke',
          this.lineWidth,
          this.strokeStyle,
          this.globalAlpha,
        ]);
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

test('charted club lighting follows sections, its meters follow music, and reduced motion stays still', async () => {
  const { drawFinale } = await import('../public/game/src/campaign.js');
  const performance = {
    charted: true,
    playing: true,
    intensity: 1,
    musicTime: 53,
    color: '#ffda91',
    phase: 'DROP',
  };
  const draw = (options = {}) => {
    const g = context();
    drawFinale(g, { performance, music: bass, totalFans: 30, ...options });
    return g;
  };
  const low = draw(),
    high = draw({ music: treble });
  const meters = (g) =>
    g.fills.filter(({ args: [x, , w] }) => x >= 449 && x <= 505 && w === 4);
  assert.notDeepEqual(meters(low), meters(high));
  const breakScene = draw({
    performance: {
      ...performance,
      intensity: 0.28,
      color: '#ff9ed3',
      phase: 'ONE CREW',
    },
  });
  assert.ok(
    low.fills.length > breakScene.fills.length,
    'confetti is reserved for drops and the finale',
  );
  const still = draw({ reducedMotion: true });
  const later = draw({
    reducedMotion: true,
    music: treble,
    performance: { ...performance, musicTime: 60 },
  });
  assert.deepEqual(still.fills, later.fills);
  assert.deepEqual(still.calls, later.calls);
  const stopped = draw({
    performance: { ...performance, playing: false },
    music: bass,
  });
  const stoppedTreble = draw({
    performance: { ...performance, playing: false },
    music: treble,
  });
  assert.deepEqual(stopped.fills, stoppedTreble.fills);
});

test('all weapon families react through presentation only, with neutral mute and reduced-motion output', () => {
  const music = {
    active: true,
    bass: 1,
    mid: 0.8,
    treble: 0.6,
    energy: 0.8,
    bands: [1, 0.8, 0.8, 0.6, 0.6],
  };
  const state = createState({ mode: 'survival', seed: 175 });
  for (const kind of [
    'flash',
    'vinyl',
    'bass',
    'phone',
    'cd',
    'cassette',
    'echo',
  ]) {
    const feedback = createRoadFeedback();
    captureRoadFeedback(feedback, [
      {
        type: 'survival-attack',
        kind,
        distance: 0,
        radius: 50,
        behind: 25,
        targetDistances: [30],
        repeat: kind === 'echo',
      },
    ]);
    const before = JSON.stringify({ state, feedback });
    const quiet = context(),
      loud = context(),
      still = context(),
      neutral = context(),
      muted = context();
    drawRoadFeedback(quiet, feedback, state);
    drawRoadFeedback(loud, feedback, state, { music });
    assert.notDeepEqual(
      [loud.calls, loud.fills],
      [quiet.calls, quiet.fills],
      kind,
    );
    drawRoadFeedback(still, feedback, state, { music, reducedMotion: true });
    drawRoadFeedback(neutral, feedback, state, { reducedMotion: true });
    assert.deepEqual(
      [still.calls, still.fills],
      [neutral.calls, neutral.fills],
      kind,
    );
    drawRoadFeedback(muted, feedback, state, {
      music: { ...music, active: false },
    });
    assert.deepEqual(
      [muted.calls, muted.fills],
      [quiet.calls, quiet.fills],
      kind,
    );
    assert.equal(JSON.stringify({ state, feedback }), before);
  }
  state.survival.upgrades.vinyl = 1;
  const quiet = context(),
    loud = context();
  drawSurvival(quiet, state, 1);
  drawSurvival(loud, state, 1, false, music);
  assert.notDeepEqual(
    loud.calls,
    quiet.calls,
    'the persistent orbit follows the mid band',
  );
  update(state, {}, 0.05);
  assert.ok(state.projectiles.length);
  const a = context(),
    b = context();
  const before = JSON.stringify(state);
  render(a, state);
  render(b, state, { music });
  const hearts = (g) =>
    g.calls.filter(([name, glyph]) => name === 'fillText' && glyph === '♥');
  assert.equal(hearts(b).length - hearts(a).length, state.projectiles.length);
  assert.equal(JSON.stringify(state), before);
  for (const kind of [
    'heart',
    'flash',
    'vinyl',
    'bass',
    'phone',
    'cd',
    'cassette',
    'echo',
  ]) {
    assert.ok(weaponMusicLevel(kind, music) > 0);
    assert.equal(weaponMusicLevel(kind, music, true), 0);
    assert.equal(
      weaponMusicLevel(kind, {
        active: true,
        bass: NaN,
        mid: Infinity,
        treble: -1,
      }),
      0,
    );
  }
});
