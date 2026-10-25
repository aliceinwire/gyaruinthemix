import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  exportNightfallSave,
  restoreNightfallSave,
  chooseStartingWeapon,
} from '../public/game-test/src/simulation.js';
import {
  TRACK_CHARTS,
  chartForTrack,
  selectChartTrack,
} from '../public/game-test/src/track-charts.js';
import {
  createPerformance,
  updatePerformance,
} from '../public/game-test/src/performance.js';
import {
  setMusicDrive,
  updateMusicDrive,
  suspendMusicDrive,
  applyMusicEncounter,
  MUSIC_ENCOUNTER_IDS,
} from '../public/game-test/src/music-drive.js';
import {
  MUSIC_RULES_VERSION,
  createSurvivalRecords,
  normalizeSurvivalRecords,
  normalizeSurvivalSave,
  survivalRecordCategory,
} from '../public/game-test/src/survival.js';
import { updateEncounterActor } from '../public/game-test/src/encounter-director.js';
import { selectCrewEvent } from '../public/game-test/src/crew-dialogue.js';

const fresh = (options) =>
  createState({
    mode: 'survival',
    survivalDay: '2026-10-25',
    seed: 175,
    ...options,
  });
const track = (chart) => ({
  id: chart.trackId,
  title: chart.title,
  duration: chart.duration,
  excerpt: false,
});
const radio = (chart, currentTime, revision = 1) => ({
  track: track(chart),
  currentTime,
  revision,
  endRevision: 0,
  playing: true,
  volume: 1,
});
function play(state, chart, start, duration, revision = 1) {
  for (let i = 0; i <= duration * 60; i++)
    updateMusicDrive(state, radio(chart, start + i / 60, revision), 1 / 60);
}

test('every supported master has a complete playable chart and mismatched recordings are rejected', () => {
  assert.equal(TRACK_CHARTS.length, 3);
  assert.equal(new Set(TRACK_CHARTS.map((chart) => chart.trackId)).size, 3);
  for (const chart of TRACK_CHARTS) {
    assert.equal(chartForTrack(track(chart)), chart);
    assert.ok(
      Object.isFrozen(chart) &&
        Object.isFrozen(chart.sections) &&
        Object.isFrozen(chart.sections[0]),
    );
    for (const change of [
      { duration: chart.duration + 0.5 },
      { duration: NaN },
      { id: 'unrecognized' },
      { excerpt: true },
    ])
      assert.equal(chartForTrack({ ...track(chart), ...change }), null);
    const set = createPerformance(chart);
    for (let i = 0; i <= Math.ceil(chart.duration * 60); i++)
      updatePerformance(
        set,
        { boost: true, charge: true, rush: true },
        1 / 60,
        radio(chart, i / 60),
      );
    assert.equal(set.done, true);
    assert.equal(set.hits, chart.sections.length);
    assert.equal(new Set(set.completed).size, set.hits);
    assert.equal(chart.sections[0].start, 0);
    assert.ok(
      chart.sections.every(
        (s, i) =>
          Number.isFinite(s.intensity) &&
          s.intensity >= 0 &&
          s.intensity <= 1 &&
          s.start < chart.duration &&
          (!i || s.start > chart.sections[i - 1].start),
      ),
    );
  }
});

test('club selection follows the radio and falls back explicitly when its current recording has no chart', () => {
  const catalog = TRACK_CHARTS.map(track);
  for (const selected of catalog)
    assert.equal(selectChartTrack(catalog, selected), selected);
  assert.equal(selectChartTrack(catalog, { id: 'other' }), catalog[0]);
  assert.equal(
    selectChartTrack([{ ...catalog[0], excerpt: true }], catalog[0]),
    null,
  );
  assert.equal(selectChartTrack([], catalog[0]), null);
});

test('each chart drives natural drop cues and bounded speed, including media clocks rounded to 100 ms', () => {
  for (const chart of TRACK_CHARTS) {
    const state = fresh();
    setMusicDrive(state, true);
    const drop = chart.sections.find((s) => s.kind === 'drop').start;
    for (let i = 0; i <= 240; i++)
      updateMusicDrive(
        state,
        radio(chart, Math.floor((drop - 2 + i / 60) * 10) / 10),
        1 / 60,
      );
    assert.ok(
      state.musicDrive.multiplier > 1 && state.musicDrive.multiplier <= 1.03,
    );
    assert.equal(
      state.events.filter((event) => event.type === 'music-drop').length,
      1,
    );
    const before = state.events.length;
    suspendMusicDrive(state);
    play(state, chart, drop + 1, 2);
    assert.equal(state.events.length, before);
    play(state, chart, drop - 2, 4, 2);
    assert.equal(
      state.events.length,
      before,
      'seeking and replay do not repeat a story cue',
    );
  }
});

test('all six existing headliners respond to drops without spawning actors or changing health and rewards', () => {
  assert.equal(MUSIC_ENCOUNTER_IDS.length, 6);
  for (const routeIndex of [1, 3, 5, 7, 9, 11]) {
    const state = fresh({ routeIndex });
    setMusicDrive(state, true);
    const actor = structuredClone(
      state._encounterPlan.find((item) => item.headliner),
    );
    Object.assign(actor, {
      id: 900,
      distance: 200,
      motionBaseDistance: 200,
      telegraphBaseDistance: 200,
    });
    state.entities = [actor];
    const hp = actor.hp,
      score = state.score;
    play(state, TRACK_CHARTS[1], 31.1, 2.2);
    updateEncounterActor(actor, state, 0);
    applyMusicEncounter(actor, state);
    assert.equal(actor.musicOpened, true, actor.headliner.id);
    assert.equal(actor.shielded, false);
    assert.equal(actor.hp, hp);
    assert.equal(state.score, score);
    assert.equal(state.entities.length, 1);
    const until = actor.musicOpenUntil;
    state.elapsed += 1;
    // A different song with the same revision/section number cannot extend the old opening.
    state.musicDrive.trackId = 'another-recording';
    applyMusicEncounter(actor, state);
    assert.equal(actor.musicOpenUntil, until);
    assert.equal(
      state.events.filter((event) => event.type === 'music-gate').length,
      1,
    );
  }
});

test('crew music reactions yield to driving warnings and retain Arinee at the wheel and Chana on the passenger side', () => {
  const cues = ['music-drop', 'music-break', 'music-finale'];
  for (const type of cues) {
    const line = selectCrewEvent([{ type }], { energy: 100 });
    assert.ok(line && line.id.startsWith('event:music-'));
    assert.match(line.speaker, type === 'music-break' ? /ありねぇ/ : /ちゃな/);
    assert.match(
      selectCrewEvent([{ type }, { type: 'collision' }]).id,
      /collision/,
    );
    for (const context of [
      { charging: true },
      { atStation: true },
      { energy: 10 },
      { invulnerability: 1 },
      { rushing: true },
      { boosting: true },
    ])
      assert.equal(selectCrewEvent([{ type }], context), null);
  }
  const state = fresh();
  setMusicDrive(state, true);
  play(state, TRACK_CHARTS[2], 25.5, 15);
  assert.equal(
    state.events.filter((event) => event.type.startsWith('music-')).length,
    1,
    'short adjacent sections cannot chatter over the driver',
  );
});

test('pilot and expanded Music Drive records remain separate, including assistance and history retention', () => {
  const data = new Map(),
    records = createSurvivalRecords({
      getItem: (key) => data.get(key),
      setItem: (key, value) => data.set(key, value),
    });
  for (const assisted of [false, true])
    for (const version of [1, MUSIC_RULES_VERSION])
      for (let i = 1; i <= 7; i++) {
        const state = fresh({ runId: `${assisted}-${version}-${i}` });
        setMusicDrive(state, true);
        state.survival.assisted = assisted;
        state.survival.musicVersion = version;
        state.status = 'lost';
        state.score = version === 1 ? 10000 + i : i;
        assert.equal(records.save(state).best, true);
      }
  for (const assisted of [false, true]) {
    assert.equal(records.best('2026-10-25', assisted, true).score, 7);
    assert.equal(records.best('2026-10-25', assisted, true, 1).score, 10007);
  }
  assert.equal(records.read().length, 20);
  const pilot = records.read()[0];
  delete pilot.musicVersion;
  assert.equal(normalizeSurvivalRecords([pilot])[0].musicVersion, 1);
  assert.match(survivalRecordCategory(pilot), /以前/);
  for (const invalid of ['2', -1, 999])
    assert.deepEqual(
      normalizeSurvivalRecords([{ ...pilot, musicVersion: invalid }]),
      [],
    );
});

test('resuming a pilot checkpoint keeps its category until the player enables the expanded mode', () => {
  const state = fresh();
  setMusicDrive(state, true);
  const saved = exportNightfallSave(state);
  delete saved.survival.musicVersion;
  const resumed = restoreNightfallSave(saved);
  assert.equal(resumed.survival.musicVersion, 1);
  setMusicDrive(resumed, false);
  assert.equal(resumed.survival.musicVersion, 1);
  resumed.survival.bestNotified = true;
  setMusicDrive(resumed, true);
  assert.equal(resumed.survival.musicVersion, MUSIC_RULES_VERSION);
  assert.equal(resumed.survival.bestNotified, false);
  setMusicDrive(resumed, false);
  chooseStartingWeapon(resumed, 'cassette');
  assert.equal(
    restoreNightfallSave(exportNightfallSave(resumed)).survival.musicVersion,
    MUSIC_RULES_VERSION,
  );
  assert.equal(
    normalizeSurvivalSave({ ...saved.survival, musicVersion: 999 }),
    null,
  );
  assert.equal(
    restoreNightfallSave(exportNightfallSave(fresh())).survival.musicVersion,
    0,
  );
});
