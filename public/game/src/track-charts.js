/** Media-clock seconds for the released recording. A changed master needs a new chart. */
export const CHROME_BOUNCE_CHART = Object.freeze({
  id: 'chrome-bounce-ritual-v1',
  trackId: 't-b6803b1506a2293804889abb',
  title: 'Chrome Bounce Ritual',
  duration: 177.221333,
  // Boundaries checked against the decoded release and its five-band envelope.
  // Phrase is an index into the existing three-control encore vocabulary.
  sections: Object.freeze([
    { start: 0, kind: 'intro', phrase: 0, intensity: .18 },
    { start: 10.97, kind: 'groove', phrase: 2, intensity: .4 },
    { start: 39.6, kind: 'build', phrase: 1, intensity: .55 },
    { start: 52.48, kind: 'drop', phrase: 3, intensity: 1 },
    { start: 77.74, kind: 'break', phrase: 4, intensity: .28 },
    { start: 90.61, kind: 'drop', phrase: 3, intensity: .9 },
    { start: 103.38, kind: 'build', phrase: 1, intensity: .5 },
    { start: 116.08, kind: 'drop', phrase: 3, intensity: 1 },
    { start: 125.64, kind: 'build', phrase: 6, intensity: .55 },
    { start: 141.51, kind: 'finale', phrase: 7, intensity: 1 },
    { start: 173.66, kind: 'outro', phrase: 5, intensity: .2 },
  ].map(Object.freeze)),
});

const phraseFor = Object.freeze({ intro: 0, groove: 2, build: 1, drop: 3, break: 4, finale: 7, outro: 5 });
function defineChart(id, trackId, title, duration, sections) {
  return Object.freeze({ id, trackId, title, duration,
    sections: Object.freeze(sections.map(([start, kind, intensity]) => Object.freeze({ start, kind, intensity, phrase: phraseFor[kind] }))) });
}

// Recording-specific changes in the released audio and its measured band envelope.
// Short fills remain inside their section; these are not a synthetic BPM grid.
export const CHROME_FLOOR_CHART = defineChart('chrome-floor-magnet-v1', 't-f94235330c38c18c91f21c6a', 'Chrome Floor Magnet', 204.221334, [
  [0, 'intro', .18], [2.05, 'groove', .4], [7.95, 'break', .28],
  [14, 'build', .55], [22.1, 'groove', .5], [27.25, 'build', .6],
  [33.1, 'drop', 1], [74.6, 'build', .55], [77.25, 'drop', .95],
  [88.55, 'break', .32], [103.4, 'build', .6], [110.35, 'drop', 1],
  [162.85, 'break', .28], [165.65, 'groove', .6], [182.8, 'build', .6],
  [187.75, 'finale', 1], [202.6, 'outro', .15],
]);
export const SUBFLOOR_CHART = defineChart('subfloor-magnet-v1', 't-f93804b89102d55ceb5eef9e', 'Subfloor Magnet', 76.501334, [
  [0, 'intro', .2], [1.4, 'groove', .45], [12.45, 'break', .25],
  [18.6, 'build', .55], [27.45, 'drop', 1], [37.05, 'break', .3],
  [39.8, 'drop', .9], [56.65, 'build', .6], [61.7, 'finale', 1], [73.2, 'outro', .15],
]);
export const TRACK_CHARTS = Object.freeze([CHROME_BOUNCE_CHART, CHROME_FLOOR_CHART, SUBFLOOR_CHART]);

export function chartForTrack(track) {
  if (!track || track.excerpt === true || !Number.isFinite(track.duration)) return null;
  return TRACK_CHARTS.find(chart => track.id === chart.trackId && Math.abs(track.duration - chart.duration) <= .1) || null;
}

/** Keep the radio's selection when supported; otherwise show an explicit fallback. */
export function selectChartTrack(catalog = [], current = null) {
  return catalog.find(track => track.id === current?.id && chartForTrack(track)) || catalog.find(chartForTrack) || null;
}

export function chartSectionAt(chart, seconds) {
  if (!chart || !Number.isFinite(seconds) || seconds < 0 || seconds >= chart.duration) return -1;
  return chart.sections.findLastIndex(section => seconds >= section.start);
}
