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

/** Authenticated, song-derived envelopes for native HLS players. */
export function decodeMusicTimeline(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 13 || buffer.byteLength > 1024 * 1024) return null;
  const bytes = new Uint8Array(buffer), header = new DataView(buffer);
  const frames = header.getUint32(4, true);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'GEQ1' || !frames || frames > 7201 * 20 || buffer.byteLength !== 8 + frames * 5) return null;
  return { frames, data: bytes.subarray(8) };
}

export function readMusicTimeline(timeline, time) {
  if (!timeline || !Number.isFinite(time) || time < 0) return SILENT_MUSIC;
  const frame = Math.floor(time * 20);
  if (frame >= timeline.frames) return SILENT_MUSIC;
  const bands = Object.freeze(Array.from(timeline.data.subarray(frame * 5, frame * 5 + 5), value => value / 255));
  return Object.freeze({ active: true, bands, bass: bands[0], mid: (bands[1] + bands[2]) / 2,
    treble: (bands[3] + bands[4]) / 2, energy: bands.reduce((sum, value) => sum + value, 0) / 5 });
}
