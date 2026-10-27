import { chartForTrack, chartSectionAt } from './track-charts.js';

export const CLUB_SET_SECONDS = 20;
export const NOTE_LEAD = 1.2;
export const TAP_WINDOW = .14;
export const DJ_ACTIONS = Object.freeze(['boost', 'charge', 'rush']);
const pattern = ['boost', 'charge', 'boost', 'rush', 'charge', 'boost', 'rush', 'charge'];
const onsetCache = new WeakMap();

/** Use measured bass attacks when available; do not invent a recording's BPM. */
export function clubOnsets(timeline) {
  if (!timeline?.data || !Number.isInteger(timeline.frames) || timeline.frames < 3 || timeline.data.length !== timeline.frames * 5) return [];
  if (onsetCache.has(timeline)) return onsetCache.get(timeline);
  const peaks = [];
  for (let i = 2; i < timeline.frames - 1; i++) {
    const value = timeline.data[i * 5], before = timeline.data[(i - 1) * 5];
    const floor = Math.min(before, timeline.data[(i - 2) * 5]);
    if (value >= 65 && value - floor >= 18 && value >= before && value > timeline.data[(i + 1) * 5] &&
        (!peaks.length || i / 20 - peaks.at(-1) >= .28)) peaks.push(i / 20);
  }
  onsetCache.set(timeline, peaks);
  return peaks;
}
export function createClubRhythm() {
  return { radio: true, rhythm: true, started: false, elapsed: 0, hits: 0, misses: 0, mistakes: 0,
    combo: 0, bestCombo: 0, judged: 0, completed: [], notes: [], serial: 0, nextNoteAt: NOTE_LEAD, countInUntil: NOTE_LEAD,
    energy: 0, peak: 0, active: null, lastHit: null, feedback: null, feedbackUntil: 0,
    done: false, chart: null, clock: null, revision: null, playing: false, interrupted: false,
    trackId: null, phraseIndex: -1, musicTime: 0, cueSource: 'practice' };
}
export function startClubRhythm(set) {
  if (!set?.rhythm || set.started || set.done) return false;
  set.started = true;
  return true;
}
export function suspendClubRhythm(set) {
  set.clock = null; set.playing = false; set.active = null;
  // Unheard pending notes are discarded, not judged as missed after a seek/pause.
  set.notes = []; set.nextNoteAt = set.elapsed + NOTE_LEAD; set.countInUntil = set.nextNoteAt;
}
function schedule(set, transport) {
  const onsets = clubOnsets(transport?.spectrum);
  while (set.nextNoteAt <= set.elapsed + NOTE_LEAD + .4 && set.nextNoteAt < CLUB_SET_SECONDS - TAP_WINDOW) {
    let at = set.nextNoteAt;
    let source = 'practice';
    if (onsets.length && set.playing && transport?.track) {
      const target = set.musicTime + at - set.elapsed;
      // Bound the search to the next audible attack, keeping notes readable and brisk.
      let lo = 0, hi = onsets.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (onsets[mid] < target) lo = mid + 1; else hi = mid; }
      if (onsets[lo] <= target + .35) { at += onsets[lo] - target; source = 'audio'; }
    }
    if (at >= CLUB_SET_SECONDS - TAP_WINDOW) break;
    const id = set.serial++;
    if (!set.notes.length) set.countInUntil = at;
    set.notes.push({ id, at, action: pattern[id % pattern.length], status: 'pending', source });
    set.cueSource = source;
    set.nextNoteAt = at + (source === 'audio' ? .3 : .4);
  }
}
export function updateClubRhythm(set, dt, transport) {
  if (!set.started || set.done) return set;
  const trackId = transport?.track?.id ?? null;
  const now = transport?.currentTime;
  const live = Boolean(trackId);
  const playing = live ? Boolean(Number.isFinite(now) && now >= 0 && transport.playing && !transport.seeking &&
    !transport.hidden && !transport.ended && !transport.muted && transport.volume !== 0) : !set.trackId;
  const changed = trackId !== set.trackId;
  const delta = live ? now - set.clock : Math.min(dt, .1);
  const continuous = playing && (!live || set.playing && set.clock !== null && !changed &&
    set.revision === transport.revision && delta >= 0 && delta <= .25);
  if (changed || live && !continuous) {
    set.notes = []; set.nextNoteAt = set.elapsed + NOTE_LEAD; set.countInUntil = set.nextNoteAt;
  }
  set.trackId = trackId || set.trackId;
  set.clock = Number.isFinite(now) ? now : null;
  set.revision = transport?.revision ?? null;
  set.chart = chartForTrack(transport?.track);
  set.musicTime = live && Number.isFinite(now) ? now : set.elapsed;
  set.phraseIndex = chartSectionAt(set.chart, now);
  set.playing = playing;
  if (continuous) set.elapsed = Math.min(CLUB_SET_SECONDS, set.elapsed + delta);
  if (playing) schedule(set, transport);
  for (const note of set.notes) if (note.status === 'pending' && note.at + TAP_WINDOW < set.elapsed) {
    note.status = 'miss'; set.misses++; set.judged++; set.combo = 0;
    set.feedback = 'MISS'; set.feedbackUntil = set.elapsed + .35;
  }
  set.notes = set.notes.filter(note => note.at > set.elapsed - .6);
  set.active = playing ? set.notes.find(note => note.status === 'pending')?.action ?? null : null;
  set.energy = Math.max(0, set.energy - (continuous ? delta : 0) * .08);
  if (set.elapsed >= CLUB_SET_SECONDS) { set.done = true; set.active = null; set.playing = false; }
  return set;
}
/** Called once on a real key/pointer press; holding a pad never repeats a hit. */
export function tapClubRhythm(set, action, transport = null) {
  if (!set?.started || !set.playing || set.done || !DJ_ACTIONS.includes(action)) return null;
  let now = set.elapsed;
  if (set.trackId) {
    const delta = transport?.currentTime - set.clock;
    if (transport?.track?.id !== set.trackId || transport.revision !== set.revision || !transport.playing ||
        transport.seeking || transport.hidden || transport.muted || transport.volume === 0 || transport.ended ||
        !Number.isFinite(delta) || delta < 0 || delta > .25) return null;
    now += delta;
  }
  const note = set.notes.filter(note => note.status === 'pending' && note.action === action && Math.abs(note.at - now) <= TAP_WINDOW)
    .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))[0];
  if (!note) { set.mistakes++; set.combo = 0; set.feedback = 'EARLY / LATE'; }
  else {
    note.status = 'hit'; set.hits++; set.judged++; set.combo++; set.bestCombo = Math.max(set.bestCombo, set.combo);
    set.completed.push(note.id); set.lastHit = now;
    set.energy = Math.min(1, set.energy + .12); set.peak = Math.max(set.peak, set.energy);
    set.feedback = Math.abs(note.at - now) <= .07 ? 'PERFECT' : 'GOOD';
  }
  set.feedbackUntil = set.elapsed + .35;
  return set.feedback;
}
export function clubRhythmView(set) {
  const next = set.notes.find(note => note.status === 'pending');
  const section = set.chart?.sections[set.phraseIndex];
  const waiting = set.started && !set.done && !set.playing;
  const countdown = set.started && set.playing && next && set.countInUntil - set.elapsed > TAP_WINDOW ? Math.ceil((next.at - set.elapsed) / .4) : 0;
  return { rhythm: true, ready: !set.started, done: set.done, waiting, title: !set.started ? '20秒のDJセットで遊ぼ！' : set.done ? 'ナイスセット！' : waiting ? 'ラジオを再生したら、今の曲に合わせて続けよ。' : 'ラインに重なったらタップ！',
    phase: !set.started ? 'DJ RHYTHM' : set.done ? 'ENCORE' : section?.kind?.toUpperCase() || 'FREE RHYTHM',
    action: set.active, color: '#ff9ed3', progress: set.elapsed / CLUB_SET_SECONDS,
    energy: set.energy, hits: set.hits, total: set.judged, combo: set.combo, bestCombo: set.bestCombo,
    accuracy: set.judged + set.mistakes ? Math.round(set.hits / (set.judged + set.mistakes) * 100) : 0,
    remaining: Math.ceil(CLUB_SET_SECONDS - set.elapsed), countdown: Math.min(3, countdown),
    feedback: set.feedbackUntil > set.elapsed ? set.feedback : null,
    notes: set.done ? [] : set.notes.filter(note => note.at <= set.elapsed + NOTE_LEAD).map(note => ({ ...note, offset: note.at - set.elapsed })),
    charted: Boolean(set.chart), playing: set.playing, intensity: section?.intensity || 0,
    musicTime: set.musicTime, cueSource: next?.source || set.cueSource };
}
