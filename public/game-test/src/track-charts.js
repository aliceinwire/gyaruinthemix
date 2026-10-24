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

export function chartForTrack(track) {
  const chart = CHROME_BOUNCE_CHART;
  return track?.id === chart.trackId && track.excerpt !== true &&
    Number.isFinite(track.duration) && Math.abs(track.duration - chart.duration) <= .1 ? chart : null;
}

export function chartSectionAt(chart, seconds) {
  if (!chart || !Number.isFinite(seconds) || seconds < 0 || seconds >= chart.duration) return -1;
  return chart.sections.findLastIndex(section => seconds >= section.start);
}
