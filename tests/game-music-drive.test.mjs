import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  nextRoute,
  chooseStartingWeapon,
  changeRouteBeforeStart,
  exportNightfallSave,
  restoreNightfallSave,
} from '../public/game/src/simulation.js';
import {
  useCurrentMusicRules,
  updateMusicDrive,
  suspendMusicDrive,
  applyMusicEncounter,
} from '../public/game/src/music-drive.js';
import {
  MUSIC_RULES_VERSION,
  createSurvivalRecords,
  normalizeSurvivalRecords,
  normalizeSurvivalSave,
  survivalResult,
  survivalRecordCategory,
  setSurvivalAssistance,
} from '../public/game/src/survival.js';
import {
  updateEncounterActor,
  ENCOUNTER_RULES,
} from '../public/game/src/encounter-director.js';
import { CHROME_BOUNCE_CHART as chart } from '../public/game/src/track-charts.js';
import { getRoadCue } from '../public/game/src/road-feedback.js';

const fresh = (options = {}) =>
  createState({
    mode: 'survival',
    survivalDay: '2026-10-24',
    seed: 175,
    runId: 'music-drive',
    ...options,
  });
const radio = (currentTime, changes = {}) => ({
  track: { id: chart.trackId, duration: chart.duration },
  currentTime,
  playing: true,
  revision: 1,
  volume: 1,
  muted: false,
  seeking: false,
  hidden: false,
  ...changes,
});
function play(state, start, seconds, changes = {}) {
  for (let i = 0; i <= seconds * 60; i++)
    updateMusicDrive(state, radio(start + i / 60, changes), 1 / 60);
}
function quiet(state) {
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  state._encounterCursor = state._encounterPlan.length;
  return state;
}
function speaker(state) {
  const actor = structuredClone(
    state._encounterPlan.find(
      (item) => item.headliner?.id === 'shibuya-feedback',
    ),
  );
  Object.assign(actor, {
    id: 900,
    distance: 300,
    motionBaseDistance: 300,
    telegraphBaseDistance: 300,
  });
  state.entities = [actor];
  return actor;
}

test('music changes speed by default in both modes while silence keeps the seeded simulation', () => {
  for (const mode of ['survival', 'story']) {
    const state = fresh({ mode });
    play(state, 50.5, 3);
    assert.equal(
      state.events.filter((event) => event.type === 'music-drop').length,
      1,
    );
    assert.ok(
      state.musicDrive.multiplier > 1 && state.musicDrive.multiplier <= 1.03,
    );
    assert.equal(Object.hasOwn(state, 'musicDriveEnabled'), false);
    if (mode === 'survival') {
      assert.equal(state.survival.musicDriven, true);
      assert.equal(state.survival.musicVersion, MUSIC_RULES_VERSION);
    }
  }
  const silence = fresh(),
    muted = fresh();
  for (let i = 0; i < 180; i++) {
    update(silence, { boost: i > 90 }, 1 / 60);
    update(
      muted,
      { boost: i > 90 },
      1 / 60,
      radio(50.5 + i / 60, { muted: true }),
    );
  }
  const gameplay = ({ musicDrive: _musicDrive, ...state }) => state;
  assert.deepEqual(gameplay(muted), gameplay(silence));
  assert.equal(muted.musicDrive.multiplier, 1);
});

test('headliners retain their ordinary guard when silent and lose an undelivered cue when music stops', () => {
  const state = fresh({ routeIndex: 5 }),
    actor = speaker(state);
  play(state, 88.5, 2.3, { muted: true });
  updateEncounterActor(actor, state, 0);
  const phase = actor.headlinerPhase,
    guarded = actor.shielded;
  applyMusicEncounter(actor, state);
  assert.equal(actor.headlinerPhase, phase);
  assert.equal(actor.shielded, guarded);
  assert.equal(actor.musicOpened, undefined);
  play(state, 88.5, 1, { revision: 2 });
  applyMusicEncounter(actor, state);
  assert.equal(actor.musicCue, true);
  suspendMusicDrive(state);
  applyMusicEncounter(actor, state);
  assert.equal(actor.musicCue, false);
});

test('crew cue history survives road transitions without carrying old speed or drop openings', () => {
  const state = fresh();
  play(state, 50.5, 3);
  const seen = [...state.musicDrive.cueSeen];
  const cooldown = state.musicDrive.cueCooldown;
  state.status = 'won';
  nextRoute(state);
  assert.deepEqual(state.musicDrive.cueSeen, seen);
  assert.equal(state.musicDrive.cueCooldown, cooldown);
  assert.equal(state.musicDrive.active, false);
  assert.equal(state.musicDrive.multiplier, 1);
  assert.equal(state.musicDrive.dropSection, -1);
  changeRouteBeforeStart(state, 'express');
  assert.deepEqual(state.musicDrive.cueSeen, seen);
  play(state, 50.5, 3, { revision: 2 });
  assert.equal(
    state.events.filter((event) => event.type === 'music-drop').length,
    0,
  );
});

test('charted intensity eases within ±3% and affects only horizontal driving speed', () => {
  const baseline = quiet(fresh()),
    state = quiet(fresh());
  play(state, 53, 10);
  assert.ok(
    state.musicDrive.multiplier > 1.029 && state.musicDrive.multiplier <= 1.03,
  );
  const multiplier = state.musicDrive.multiplier;
  update(baseline, { boost: true }, 1 / 60);
  update(state, { boost: true }, 1 / 60, radio(63 + 1 / 60));
  assert.ok(Math.abs(state.speed / baseline.speed - multiplier) < 0.0001);
  assert.ok(Math.abs(state.distance / baseline.distance - multiplier) < 0.0001);
  for (const key of [
    'elapsed',
    'altitude',
    'altitudeVelocity',
    'energy',
    'shotCooldown',
  ])
    assert.equal(state[key], baseline[key], key);
  play(state, 0, 10, { revision: 2 });
  assert.ok(
    state.musicDrive.multiplier < 1 && state.musicDrive.multiplier >= 0.97,
  );
});

test('pause, mute, zero volume, buffering, seeking, hiding and unsupported masters return to neutral', () => {
  for (const changes of [
    { playing: false },
    { muted: true },
    { volume: 0 },
    { seeking: true },
    { hidden: true },
    { ended: true },
    { track: null },
    { track: { id: 'another', duration: chart.duration } },
    { track: { id: chart.trackId, duration: chart.duration + 1 } },
    { track: { id: chart.trackId, duration: chart.duration, excerpt: true } },
    { currentTime: NaN },
  ]) {
    const state = fresh();
    play(state, 53, 4);
    const before = state.musicDrive.multiplier;
    updateMusicDrive(state, radio(57, changes), 1 / 60);
    assert.equal(state.musicDrive.active, false);
    assert.ok(
      state.musicDrive.multiplier < before && state.musicDrive.multiplier > 1,
    );
    play(state, 57, 12, changes);
    assert.ok(Math.abs(state.musicDrive.multiplier - 1) < 0.00001);
  }
});

test('100 ms media clocks stay active but a stopped clock and seek discontinuities do not', () => {
  const state = fresh();
  for (let i = 0; i < 180; i++)
    updateMusicDrive(state, radio(53 + Math.floor(i / 6) / 10), 1 / 60);
  assert.equal(state.musicDrive.active, true);
  for (let i = 0; i < 30; i++) updateMusicDrive(state, radio(55.9), 1 / 60);
  assert.equal(state.musicDrive.active, false);
  updateMusicDrive(state, radio(70), 1 / 60);
  assert.equal(state.musicDrive.active, false);
  updateMusicDrive(state, radio(70.02, { revision: 2 }), 1 / 60);
  assert.equal(state.musicDrive.active, false);
});

test('the Shibuya speaker opens on a naturally reached drop with a visible cue and a minimum counter window', () => {
  const state = fresh({ routeIndex: 5 }),
    actor = speaker(state);
  play(state, 88.5, 1);
  updateEncounterActor(actor, state, 0);
  applyMusicEncounter(actor, state);
  assert.equal(actor.shielded, true);
  assert.equal(actor.musicCue, true);
  assert.match(getRoadCue(state).label, /ドロップ/);
  play(state, 89.5, 1.2);
  updateEncounterActor(actor, state, 0);
  applyMusicEncounter(actor, state);
  assert.equal(actor.shielded, false);
  assert.equal(actor.musicOpen, true);
  assert.equal(
    state.events.filter((event) => event.type === 'music-gate').length,
    1,
  );
  assert.match(getRoadCue(state).label, /開放/);
  suspendMusicDrive(state);
  state.elapsed = 1;
  updateEncounterActor(actor, state, 0);
  applyMusicEncounter(actor, state);
  assert.equal(
    actor.shielded,
    false,
    'stopping music cannot snap the gate shut',
  );
  state.elapsed = 10;
  updateEncounterActor(actor, state, 0);
  const normal = actor.shielded;
  applyMusicEncounter(actor, state);
  assert.equal(actor.musicOpen, false);
  assert.equal(actor.shielded, normal);
  play(state, 88.5, 2.3, { revision: 2 });
  applyMusicEncounter(actor, state);
  assert.equal(
    state.events.filter((event) => event.type === 'music-gate').length,
    1,
    'replaying cannot grant another opening',
  );
});

test('seeking, restarting or resuming inside a drop does not grant an opening; unknown speakers keep ordinary rules', () => {
  for (const interrupt of [
    (state) => suspendMusicDrive(state),
    (state) => updateMusicDrive(state, radio(90.7, { revision: 2 }), 1 / 60),
  ]) {
    const state = fresh({ routeIndex: 5 }),
      actor = speaker(state);
    play(state, 88.5, 1);
    interrupt(state);
    play(state, 90.8, 2, { revision: 2 });
    updateEncounterActor(actor, state, 0);
    const normal = actor.shielded;
    applyMusicEncounter(actor, state);
    assert.equal(actor.musicOpened, undefined);
    assert.equal(actor.shielded, normal);
  }
  const state = fresh({ routeIndex: 7 });
  const actor = structuredClone(
    state._encounterPlan.find((item) => item.headliner),
  );
  actor.headliner.id = 'unknown-speaker';
  play(state, 88.5, 2.3);
  const before = structuredClone(actor);
  applyMusicEncounter(actor, state);
  assert.deepEqual(actor, before);
});

test('music never closes a normal opening or repeats conversion rewards', () => {
  const state = fresh({ routeIndex: 5 }),
    actor = speaker(state);
  state.distance = 340;
  updateEncounterActor(actor, state, 0);
  applyMusicEncounter(actor, state);
  assert.equal(actor.shielded, false);
  quiet(state);
  state.distance = 0;
  Object.assign(actor, {
    distance: 75,
    motionBaseDistance: 75,
    telegraphBaseDistance: 75,
    hp: 1,
    encounterStartedAt: 0,
  });
  state.entities = [actor];
  play(state, 88.5, 2.3);
  update(state, {}, 1 / 60, radio(90.82));
  for (let i = 0; i < 120; i++)
    update(state, {}, 1 / 60, radio(90.84 + i / 60));
  assert.equal(actor.converted, true);
  assert.equal(state.signalClears, 1);
  const money = state.money;
  for (let i = 0; i < 120; i++)
    update(state, {}, 1 / 60, radio(90.84 + i / 60, { revision: 2 }));
  assert.equal(state.signalClears, 1);
  assert.equal(state.money, money);
});

test('maximum music-assisted rush speed retains the authored reaction window', () => {
  const state = fresh({ routeIndex: 5 }),
    actor = speaker(state);
  state.musicDrive.multiplier = 1.03;
  state.speed = ENCOUNTER_RULES.maximumSupportedSpeed * 1.03;
  updateEncounterActor(actor, state, 0);
  const clearance =
    actor.warningDistance - actor.collisionRadius - actor.motionAmplitude;
  assert.ok(
    clearance / (state.speed / 3.6) >=
      actor.anticipation + actor.telegraph.counterWindow - 1e-7,
  );
});

test('default music records stay classified through silence, starter changes, checkpoint reload and the next road', () => {
  const state = fresh();
  suspendMusicDrive(state);
  assert.equal(chooseStartingWeapon(state, 'cassette'), true);
  changeRouteBeforeStart(state, 'express');
  const restored = restoreNightfallSave(
    JSON.stringify(exportNightfallSave(state)),
  );
  assert.equal(restored.survival.musicDriven, true);
  assert.equal(restored.musicDrive.multiplier, 1);
  suspendMusicDrive(restored);
  quiet(restored);
  restored.distance = restored.routeLength - 0.01;
  update(restored, {}, 0.01);
  const resumed = restoreNightfallSave(exportNightfallSave(restored));
  assert.equal(resumed.survival.musicDriven, true);
  nextRoute(resumed);
  assert.equal(resumed.survival.musicVersion, MUSIC_RULES_VERSION);
  assert.equal(resumed.survival.musicDriven, true);
  resumed.status = 'lost';
  assert.equal(survivalResult(resumed).musicDriven, true);
});

test('legacy saves adopt current rules on continuation while completed records retain their rules', () => {
  const saved = exportNightfallSave(fresh());
  delete saved.survival.musicDriven;
  const resumed = restoreNightfallSave(saved);
  assert.equal(resumed.survival.musicDriven, false);
  play(resumed, 53, 1);
  assert.equal(resumed.survival.musicVersion, MUSIC_RULES_VERSION);
  assert.equal(
    normalizeSurvivalSave({ ...saved.survival, musicDriven: 'true' }),
    null,
  );
  for (const complete of [false, true]) {
    const state = fresh();
    state.survival.musicDriven = false;
    state.survival.musicVersion = 0;
    state.status = complete ? 'won' : 'lost';
    state.campaignComplete = complete;
    useCurrentMusicRules(state);
    assert.equal(survivalResult(state).musicDriven, false);
  }
});

test('each of the four score categories keeps its own daily best and five records', () => {
  const data = new Map(),
    records = createSurvivalRecords({
      getItem: (key) => data.get(key),
      setItem: (key, value) => data.set(key, value),
    });
  for (const assisted of [false, true])
    for (const musicDriven of [false, true]) {
      for (let i = 1; i <= 7; i++) {
        const state = fresh({
          runId: `category-${assisted}-${musicDriven}-${i}`,
        });
        setSurvivalAssistance(state, assisted);
        state.survival.musicDriven = musicDriven;
        state.survival.musicVersion = musicDriven ? MUSIC_RULES_VERSION : 0;
        state.score = i * (musicDriven ? 1000 : 10);
        state.status = 'lost';
        assert.equal(records.save(state).best, true);
      }
      assert.equal(
        records.best('2026-10-24', assisted, musicDriven).score,
        7 * (musicDriven ? 1000 : 10),
      );
      assert.equal(
        records
          .read()
          .filter(
            (row) =>
              row.assisted === assisted && row.musicDriven === musicDriven,
          ).length,
        5,
      );
    }
  const old = records.read()[0];
  delete old.musicDriven;
  assert.equal(normalizeSurvivalRecords([old])[0].musicDriven, false);
  assert.deepEqual(
    normalizeSurvivalRecords([{ ...old, musicDriven: 'true' }]),
    [],
  );
  assert.equal(new Set(records.read().map(survivalRecordCategory)).size, 4);
});

test('music history cannot evict ordinary history, including when storage is denied', () => {
  const state = fresh();
  state.status = 'lost';
  const row = survivalResult(state);
  const history = [];
  for (const assisted of [false, true])
    for (const musicDriven of [false, true])
      for (let i = 0; i < 100; i++)
        history.push({
          ...row,
          id: `${assisted}-${musicDriven}-${i}`,
          day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
          assisted,
          musicDriven,
        });
  const normalized = normalizeSurvivalRecords(history);
  assert.equal(normalized.length, 360);
  assert.equal(normalized.filter((record) => !record.musicDriven).length, 180);
  const denied = createSurvivalRecords({
    getItem() {
      throw new Error('blocked');
    },
  });
  state.survival.musicDriven = true;
  const saved = denied.save(state);
  assert.equal(saved.persisted, false);
  assert.equal(saved.records[0].musicDriven, true);
});
