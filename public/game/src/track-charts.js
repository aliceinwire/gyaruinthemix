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
export const MANDATORY_CHART = defineChart('floor-becomes-mandatory-v1', 't-5bfd9b0135298a65d1d78763', 'Floor Becomes Mandatory', 330.141333, [
  [0, 'intro', 0.2], [3, 'groove', 0.6], [13.1, 'break', 0.3],
  [23, 'build', 0.55], [35.65, 'drop', 1], [57.65, 'break', 0.35],
  [68.55, 'drop', 0.95], [85.55, 'break', 0.25], [94, 'build', 0.55],
  [102.85, 'drop', 1], [182.6, 'break', 0.3], [199, 'build', 0.55],
  [209.55, 'drop', 1], [223.6, 'break', 0.35], [233.15, 'drop', 0.95],
  [282, 'build', 0.6], [304.95, 'finale', 1], [328.5, 'outro', 0.2],
]);

export const IGNITION_CHART = defineChart('floor-ignition-protocol-v1', 't-e85d4590b891969ac00070a3', 'Floor Ignition Protocol', 184.861333, [
  [0, 'intro', 0.2], [3, 'build', 0.55], [7.1, 'drop', 0.95],
  [12.75, 'break', 0.3], [17, 'groove', 0.55], [29, 'build', 0.6],
  [40.95, 'drop', 1], [62, 'build', 0.55], [63.45, 'drop', 0.95],
  [97.9, 'break', 0.25], [101.65, 'drop', 1], [111, 'groove', 0.6],
  [134, 'build', 0.55], [136.95, 'groove', 0.6], [146.9, 'break', 0.3],
  [148.25, 'drop', 0.95], [169, 'build', 0.6], [170.8, 'finale', 1],
  [182.9, 'outro', 0.15],
]);

export const AMIGA_CHART = defineChart('happy-amiga-bounce-reactor-v1', 't-b2254a27045ff97ea1c217a0', 'Happy Amiga Bounce Reactor', 718.821334, [
  [0, 'intro', 0.25], [8, 'build', 0.55], [13.7, 'drop', 0.95],
  [23.2, 'break', 0.25], [24.65, 'drop', 0.9], [82.15, 'break', 0.3],
  [90, 'build', 0.55], [97.75, 'drop', 1], [139, 'break', 0.3],
  [141, 'drop', 0.95], [174.25, 'break', 0.25], [179.2, 'drop', 1],
  [205, 'build', 0.6], [207.1, 'drop', 0.95], [218.1, 'break', 0.3],
  [225, 'groove', 0.65], [319, 'groove', 0.6], [389, 'groove', 0.65],
  [460.2, 'break', 0.3], [462.2, 'drop', 0.9], [500, 'groove', 0.55],
  [576, 'groove', 0.6],
]);

export const REDIRECTION_CHART = defineChart('subfloor-redirection-v1', 't-f3961eb9e7d0e66059b2ee35', 'Subfloor redirection', 193.901333, [
  [0, 'intro', 0.3], [10.95, 'drop', 0.95], [19, 'break', 0.35],
  [22, 'groove', 0.6], [32, 'build', 0.55], [43.85, 'drop', 1],
  [77, 'break', 0.3], [82, 'build', 0.55], [87.4, 'drop', 1],
  [98, 'groove', 0.55], [124, 'build', 0.6], [134.05, 'drop', 0.95],
  [177.1, 'build', 0.6], [178.3, 'finale', 1], [192.05, 'outro', 0.2],
]);

export const ORITORI_CHART = defineChart('oritori-gyaru-v1', 't-93fcd1e67965064beb01910d', 'おーりとーりギャル', 229.901334, [
  [0, 'intro', 0.2], [3, 'groove', 0.55], [9, 'build', 0.6],
  [14.05, 'drop', 0.95], [33.4, 'break', 0.3], [36, 'drop', 1],
  [88.65, 'break', 0.3], [90.85, 'drop', 0.95], [100, 'break', 0.3],
  [113, 'groove', 0.55], [119, 'build', 0.6], [126.45, 'drop', 1],
  [165.8, 'break', 0.25], [173, 'build', 0.6], [178.75, 'drop', 1],
  [210.3, 'build', 0.6], [211.75, 'finale', 1], [228.5, 'outro', 0.2],
]);

export const ROOM_BOUNCE_CHART = defineChart('room-bounce-v1', 't-22c0b722610970edd5d324ec', 'かたずれない部屋でBounce', 238.381334, [
  [0, 'intro', 0.2], [10, 'build', 0.55], [15.9, 'drop', 0.9],
  [28, 'build', 0.55], [37.9, 'drop', 1], [80.85, 'break', 0.3],
  [83, 'groove', 0.5], [94.2, 'break', 0.25], [104, 'build', 0.55],
  [116.05, 'drop', 0.95], [151.05, 'break', 0.25], [162, 'build', 0.55],
  [169.95, 'drop', 1], [207.1, 'build', 0.6], [208.75, 'finale', 1],
  [231.1, 'outro', 0.2],
]);

export const TRACK_CHARTS = Object.freeze([CHROME_BOUNCE_CHART, CHROME_FLOOR_CHART, SUBFLOOR_CHART,
  MANDATORY_CHART, IGNITION_CHART, AMIGA_CHART, REDIRECTION_CHART, ORITORI_CHART, ROOM_BOUNCE_CHART]);

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
