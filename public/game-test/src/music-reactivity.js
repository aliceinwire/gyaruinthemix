/** Shared visual energy from the radio. These values are not beat or tempo estimates. */
const BANDS = Object.freeze([45, 150, 500, 1600, 5000, 16000]);
export const SILENT_MUSIC = Object.freeze({
  active: false, bands: Object.freeze([0, 0, 0, 0, 0]), bass: 0, mid: 0, treble: 0, energy: 0,
});

export function readMusicSpectrum(data, sampleRate, fftSize) {
  if (!data?.length || !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isFinite(fftSize) || fftSize <= 0) return SILENT_MUSIC;
  const bands = Object.freeze(BANDS.slice(0, -1).map((low, band) => {
    const first = Math.max(1, Math.floor(low * fftSize / sampleRate));
    const end = Math.min(data.length, Math.max(first + 1, Math.ceil(BANDS[band + 1] * fftSize / sampleRate)));
    let peak = 0, sum = 0;
    for (let bin = first; bin < end; bin++) {
      const value = Number.isFinite(data[bin]) ? Math.max(0, Math.min(255, data[bin])) : 0;
      peak = Math.max(peak, value);
      sum += value;
    }
    return (peak * .8 + sum / Math.max(1, end - first) * .2) / 255;
  }));
  return Object.freeze({
    active: true, bands, bass: bands[0], mid: (bands[1] + bands[2]) / 2,
    treble: (bands[3] + bands[4]) / 2, energy: bands.reduce((sum, value) => sum + value, 0) / bands.length,
  });
}
