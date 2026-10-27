import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRadioPerformance,
  startPerformance,
  updatePerformance,
  tapPerformance,
  performanceView,
  suspendPerformance,
  RADIO_PERFORMANCE_LENGTH,
} from '../public/game/src/performance.js';
import {
  clubOnsets,
  NOTE_LEAD,
  TAP_WINDOW,
} from '../public/game/src/club-rhythm.js';
import { TRACK_CHARTS } from '../public/game/src/track-charts.js';

const track = { id: 'radio-track', duration: 180 };
const transport = (currentTime, extra = {}) => ({
  track,
  currentTime,
  playing: true,
  revision: 0,
  ...extra,
});
const held = { boost: true, charge: true, rush: true };
const tick = (set, time, extra = {}) =>
  updatePerformance(set, held, 0.01, transport(time, extra));
function started(time = 30, extra = {}) {
  const set = createRadioPerformance();
  startPerformance(set);
  tick(set, time, extra);
  return set;
}
function advance(set, from, to, extra = {}) {
  for (let time = from + 0.01; time < to - 0.00001; time += 0.01)
    tick(set, time, extra);
  tick(set, to, extra);
}

test('club is opt-in, lasts 20 seconds and never scores held controls', () => {
  const set = createRadioPerformance();
  for (let i = 0; i < 300; i++) tick(set, i / 10);
  assert.equal(performanceView(set).ready, true);
  assert.equal(set.elapsed, 0);
  assert.equal(set.notes.length, 0);
  assert.equal(tapPerformance(set, 'boost'), null);
  assert.equal(startPerformance(set), true);
  assert.equal(startPerformance(set), false);
  tick(set, 30);
  advance(set, 30, 51);
  assert.equal(RADIO_PERFORMANCE_LENGTH, 20);
  assert.equal(set.done, true);
  assert.equal(set.elapsed, 20);
  assert.equal(set.hits, 0);
  assert.ok(
    set.judged >= 45,
    'brisk fallback has more than two notes a second',
  );
  assert.equal(set.misses, set.judged);
  assert.equal(Object.hasOwn(set, 'completionPoints'), false);
  assert.deepEqual(performanceView(set).notes, []);
});

test('tap timing uses the media event timestamp and awards each note only once', () => {
  const set = started();
  const first = set.notes[0];
  assert.equal(first.at, NOTE_LEAD);
  assert.equal(
    tapPerformance(set, first.action, transport(30)),
    'EARLY / LATE',
  );
  advance(set, 30, 31.1);
  assert.equal(tapPerformance(set, 'charge', transport(31.2)), 'EARLY / LATE');
  assert.equal(tapPerformance(set, first.action, transport(31.2)), 'PERFECT');
  assert.equal(
    tapPerformance(set, first.action, transport(31.2)),
    'EARLY / LATE',
  );
  assert.equal(set.hits, 1);
  assert.equal(set.bestCombo, 1);
  advance(set, 31.1, 31.6);
  assert.equal(tapPerformance(set, 'charge', transport(31.7)), 'GOOD');
  assert.equal(set.hits, 2);
  assert.equal(performanceView(set).accuracy, 40);
  assert.equal(new Set(set.completed).size, 2);
});

test('early and late taps outside the window miss, and missing a note resets the combo', () => {
  for (const offset of [-TAP_WINDOW - 0.01, TAP_WINDOW + 0.01]) {
    const set = started();
    advance(set, 30, 31.2 + offset);
    tapPerformance(set, 'boost', transport(31.2 + offset));
    assert.equal(set.hits, 0);
  }
  const set = started();
  advance(set, 30, 31.2);
  tapPerformance(set, 'boost', transport(31.2));
  assert.equal(set.combo, 1);
  advance(set, 31.2, 31.8);
  assert.equal(set.combo, 0);
  assert.equal(set.misses, 1);
});

test('pause, mute, seeks, hidden tabs and stalls cannot advance or award unheard notes', () => {
  for (const extra of [
    { playing: false },
    { muted: true },
    { volume: 0 },
    { hidden: true },
    { seeking: true },
    { ended: true },
  ]) {
    const set = started();
    advance(set, 30, 31.1);
    assert.equal(tapPerformance(set, 'boost', transport(31.2, extra)), null);
    const before = set.elapsed;
    advance(set, 31.1, 32, extra);
    assert.equal(set.elapsed, before);
    assert.equal(set.hits, 0);
    assert.equal(set.misses, 0);
    assert.equal(performanceView(set).waiting, true);
    tick(set, 32);
    assert.ok(
      set.notes[0].at >= set.elapsed + NOTE_LEAD - 0.001,
      'resume gives time to read new notes',
    );
  }
  const set = started();
  for (let i = 0; i < 500; i++) tick(set, 30);
  assert.equal(set.elapsed, 0);
  tick(set, 142, { revision: 1 });
  assert.equal(set.elapsed, 0);
  assert.equal(set.misses, 0);
  assert.equal(
    tapPerformance(set, 'boost', transport(143.2, { revision: 1 })),
    null,
    'a seek between frames cannot hit',
  );
  suspendPerformance(set);
  tick(set, 144, { revision: 1 });
  assert.equal(set.elapsed, 0);
  assert.equal(set.notes[0].at, NOTE_LEAD);
});

test('sets join every chart at any position and continue across a song ending without resetting', () => {
  for (const chart of TRACK_CHARTS) {
    for (const start of [0, chart.duration / 2, chart.duration - 0.05]) {
      const current = { id: chart.trackId, duration: chart.duration };
      const set = started(start, { track: current });
      assert.equal(set.musicTime, start);
      assert.equal(set.elapsed, 0);
      assert.equal(set.chart, chart);
      for (let i = 1; i <= 2100; i++) {
        const seconds = start + i / 100;
        tick(
          set,
          seconds < chart.duration ? seconds : seconds - chart.duration,
          {
            track:
              seconds < chart.duration
                ? current
                : { id: 'next-song', duration: 180 },
          },
        );
      }
      assert.equal(set.done, true);
      assert.equal(set.elapsed, 20);
      assert.equal(set.interrupted, false);
      assert.equal(set.hits, 0);
    }
  }
});

test('offline visual rhythm finishes and adopts a newly started radio without losing progress', () => {
  const set = createRadioPerformance();
  startPerformance(set);
  for (let i = 0; i < 20; i++) updatePerformance(set, held, 0.1, null);
  const elapsed = set.elapsed;
  assert.equal(performanceView(set).cueSource, 'practice');
  tick(set, 142);
  assert.equal(set.elapsed, elapsed);
  assert.equal(set.musicTime, 142);
  assert.equal(set.notes[0].at, elapsed + NOTE_LEAD);
  const offline = createRadioPerformance();
  startPerformance(offline);
  for (let i = 0; i < 201; i++) updatePerformance(offline, {}, 0.1, null);
  assert.equal(offline.done, true);
});

test('bass onset cues use measured timestamps, with a readable lead and an honest fallback', () => {
  const frames = 800,
    data = new Uint8Array(frames * 5);
  for (let i = 0; i < frames; i++) data[i * 5] = i % 7 === 0 ? 220 : 35;
  const spectrum = { frames, data };
  const onsets = clubOnsets(spectrum);
  assert.equal(onsets[0], 0.35);
  assert.equal(onsets[1], 0.7);
  assert.equal(
    clubOnsets(spectrum),
    onsets,
    'analysis is cached per recording',
  );
  const set = started(0, { spectrum });
  assert.equal(set.notes[0].at, 1.4);
  assert.equal(set.notes[0].source, 'audio');
  assert.equal(performanceView(set).countdown, 3);
  advance(set, 0, 1.4, { spectrum });
  assert.equal(
    tapPerformance(set, set.notes[0].action, transport(1.4, { spectrum })),
    'PERFECT',
  );
  assert.ok(
    set.notes.every(
      (note, i, notes) => i === 0 || note.at - notes[i - 1].at >= 0.299,
    ),
  );
  for (const invalid of [
    null,
    {},
    { frames: 2, data },
    { frames, data: data.subarray(2) },
    { frames, data: new Uint8Array(frames * 5).fill(140) },
  ]) {
    assert.deepEqual(clubOnsets(invalid), []);
    const fallback = started(0, { spectrum: invalid });
    assert.equal(fallback.notes[0].at, 1.2);
    assert.equal(performanceView(fallback).cueSource, 'practice');
  }
});
