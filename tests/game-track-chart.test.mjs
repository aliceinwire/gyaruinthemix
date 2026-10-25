import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHROME_BOUNCE_CHART as chart,
  TRACK_CHARTS,
  chartForTrack,
  chartSectionAt,
} from '../public/game/src/track-charts.js';
import {
  createPerformance,
  createRadioPerformance,
  RADIO_PERFORMANCE_LENGTH,
  updatePerformance,
  performanceView,
  suspendPerformance,
} from '../public/game/src/performance.js';

const track = {
  id: chart.trackId,
  title: chart.title,
  duration: chart.duration,
  excerpt: false,
};
const transport = (currentTime, extra = {}) => ({
  track,
  currentTime,
  playing: true,
  seeking: false,
  hidden: false,
  revision: 0,
  endRevision: 0,
  ...extra,
});
const all = { boost: true, charge: true, rush: true };
const tick = (set, time, extra = {}, input = all) =>
  updatePerformance(set, input, 1 / 60, transport(time, extra));

test('only the measured complete master can select the chart', () => {
  assert.equal(chartForTrack(track), chart);
  for (const changed of [
    { id: 't-other' },
    { duration: 176 },
    { duration: NaN },
    { excerpt: true },
  ])
    assert.equal(chartForTrack({ ...track, ...changed }), null);
  assert.equal(chartForTrack(null), null);
  assert.ok(Object.isFrozen(chart) && Object.isFrozen(chart.sections[0]));
  assert.equal(chart.sections[0].start, 0);
  for (let i = 0; i < chart.sections.length; i++) {
    const section = chart.sections[i];
    assert.equal(chartSectionAt(chart, section.start), i);
    assert.equal(chartSectionAt(chart, section.start - 0.001), i - 1);
    assert.ok(section.start < chart.duration);
    if (i) assert.ok(section.start > chart.sections[i - 1].start);
  }
  for (const time of [-1, NaN, Infinity, chart.duration])
    assert.equal(chartSectionAt(chart, time), -1);
});

test('media time selects the actual drop and breakdown even at a different render rate', () => {
  const set = createPerformance(chart);
  tick(set, 52.5);
  assert.equal(performanceView(set).phase, 'DROP');
  assert.equal(performanceView(set).action, 'rush');
  assert.equal(performanceView(set).total, 11);
  tick(set, 78);
  assert.equal(performanceView(set).phase, 'ONE CREW');
  assert.equal(set.hits, 0, 'catching up must not score the sections passed');
  assert.equal(performanceView(set).progress, 78 / chart.duration);
});

test('100ms media-clock precision still credits held input, but a stalled clock cannot', () => {
  const set = createPerformance(chart);
  tick(set, 53);
  for (let i = 1; i <= 70; i++) tick(set, 53 + Math.floor(i / 6) / 10);
  assert.equal(set.hits, 1);
  const stalled = createPerformance(chart);
  for (let i = 0; i < 600; i++) tick(stalled, 53);
  assert.equal(stalled.hits, 0);
});

test('seeking and replaying sections neither awards skipped cues nor duplicates hits', () => {
  const set = createPerformance(chart);
  tick(set, 53);
  for (let i = 1; i <= 60; i++) tick(set, 53 + i / 60);
  assert.equal(set.hits, 1);
  tick(set, 142, { seeking: true, revision: 1 });
  tick(set, 142.1, { revision: 1 });
  assert.equal(set.hits, 1);
  assert.equal(set.phraseHeld, 0);
  tick(set, 53, { revision: 2 });
  for (let i = 1; i <= 60; i++) tick(set, 53 + i / 60, { revision: 2 });
  assert.equal(set.hits, 1);
  tick(set, 54.1, { revision: 3 });
  assert.equal(set.phraseHeld, 0, 'even a short seek clears the held cue');
});

test('pause, buffering and a hidden tab stop cue credit and resume at the media clock', () => {
  for (const extra of [
    { playing: false },
    { hidden: true },
    { seeking: true },
  ]) {
    const set = createPerformance(chart);
    tick(set, 53);
    for (let i = 1; i <= 100; i++) tick(set, 53 + i / 60, extra);
    assert.equal(set.hits, 0);
    assert.equal(performanceView(set).action, null);
    tick(set, 55);
    assert.equal(set.phraseHeld, 0);
    suspendPerformance(set);
    tick(set, 55.1);
    assert.equal(set.phraseHeld, 0);
  }
});

test('natural end is complete even when the radio has already advanced to the next track', () => {
  const set = createPerformance(chart);
  tick(set, 173);
  tick(set, 0, {
    track: { id: 'next' },
    endRevision: 1,
    endedTrackId: chart.trackId,
  });
  assert.equal(set.done, true);
  assert.equal(set.interrupted, false);
  assert.equal(performanceView(set).progress, 1);
  const before = structuredClone(set);
  tick(set, 2);
  assert.deepEqual(set, before);
});

test('manual track changes end the set cleanly and a fresh set has no old hits', () => {
  const set = createPerformance(chart);
  tick(set, 53);
  tick(set, 0, { track: { id: 'next' } });
  assert.equal(set.interrupted, true);
  assert.equal(performanceView(set).action, null);
  const restarted = createPerformance(chart);
  tick(restarted, 0, { endRevision: 3, endedTrackId: chart.trackId });
  assert.equal(restarted.done, false);
  assert.equal(restarted.hits, 0);
});

test('watching the whole chart without input completes it without campaign rewards', () => {
  const set = createPerformance(chart);
  for (let i = 0; i <= Math.ceil(chart.duration * 10); i++)
    tick(set, i / 10, {}, {});
  assert.equal(set.done, true);
  assert.equal(set.hits, 0);
  assert.equal(Object.hasOwn(set, 'completionPoints'), false);
});

test('radio encores join every chart at its current position, including the last instant, and span tracks', () => {
  for (const selected of TRACK_CHARTS) {
    for (const start of [0, selected.duration / 2, selected.duration - 0.05]) {
      const set = createRadioPerformance();
      const current = { id: selected.trackId, duration: selected.duration };
      tick(set, start, { track: current });
      assert.equal(
        set.elapsed,
        0,
        'joining never treats earlier music as played',
      );
      assert.equal(set.musicTime, start);
      assert.equal(set.done, false);
      for (let i = 1; i <= 325; i++) {
        const seconds = start + i / 10;
        tick(
          set,
          seconds < selected.duration ? seconds : seconds - selected.duration,
          {
            track:
              seconds < selected.duration
                ? current
                : { id: 'next-song', duration: 180 },
            endRevision: seconds < selected.duration ? 0 : 1,
            endedTrackId: selected.trackId,
          },
        );
      }
      assert.equal(set.done, true, `${selected.title} at ${start}`);
      assert.equal(set.interrupted, false);
      assert.equal(set.elapsed, RADIO_PERFORMANCE_LENGTH);
      assert.equal(performanceView(set).total, 8);
      assert.ok(set.hits >= 6 && set.hits <= 8);
      assert.equal(new Set(set.completed).size, set.hits);
    }
  }
});

test('uncharted recordings and excerpts use playable prompts without claiming authored drops', () => {
  for (const current of [
    { id: 'new-release', duration: 200 },
    { ...track, excerpt: true },
  ]) {
    const set = createRadioPerformance();
    tick(set, 57, { track: current });
    assert.equal(set.chart, null);
    assert.equal(performanceView(set).charted, false);
    assert.ok(
      ['HANDS UP', 'ONE CREW', 'ALL TOGETHER'].includes(
        performanceView(set).phase,
      ),
    );
    for (let i = 1; i <= 325; i++) tick(set, 57 + i / 10, { track: current });
    assert.equal(set.done, true);
    assert.equal(set.hits, 8);
    assert.equal(Object.hasOwn(set, 'completionPoints'), false);
  }
});

test('live encore progress uses heard media time and cannot be farmed by seeking, muting or stalling', () => {
  const set = createRadioPerformance();
  tick(set, 53);
  for (let i = 1; i <= 10; i++) tick(set, 53 + i / 10);
  assert.equal(set.hits, 1);
  const elapsed = set.elapsed;
  tick(set, 142, { revision: 1 });
  assert.equal(set.elapsed, elapsed);
  assert.equal(set.phraseHeld, 0);
  for (const extra of [
    {},
    { playing: false },
    { muted: true },
    { volume: 0 },
    { hidden: true },
    { seeking: true },
  ]) {
    for (let i = 0; i < 100; i++) tick(set, 142, { revision: 1, ...extra });
    assert.equal(set.elapsed, elapsed);
    assert.equal(set.hits, 1);
  }
  suspendPerformance(set);
  tick(set, 142.1, { revision: 1 });
  assert.equal(set.phraseHeld, 0);
  for (let i = 1; i <= 10; i++) tick(set, 142.1 + i / 10, { revision: 1 });
  assert.equal(set.hits, 1, 'one cue window can only score once');
  tick(set, 70, { track: { id: 'new', duration: 200 }, revision: 2 });
  assert.equal(set.interrupted, false);
  assert.equal(set.done, false);
  assert.equal(set.hits, 1);
});

test('radio encores remain playable offline and adopt music started during the silent performance', () => {
  const silent = createRadioPerformance();
  for (let i = 0; i < 370; i++) updatePerformance(silent, all, 0.1, null);
  assert.equal(silent.done, true);
  assert.equal(silent.hits, 8);
  const set = createRadioPerformance();
  updatePerformance(set, all, 1, null);
  tick(set, 142);
  assert.equal(set.elapsed, 0);
  assert.equal(performanceView(set).phase, 'FINALE');
  assert.equal(set.musicTime, 142);
});
