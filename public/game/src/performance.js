import { chartForTrack, chartSectionAt } from './track-charts.js';
/** Optional encore. Uses the same three controls, never gates tour credit. */
export const PERFORMANCE_PHRASES = Object.freeze([
  { action: 'boost', label: '手ぇ上げて、フロアに挨拶や！', name: 'WELCOME', color: '#ff9ed3' },
  { action: 'charge', label: '低音ためて、じわっと上げよ', name: 'BUILD UP', color: '#97f5df' },
  { action: 'boost', label: '手ぇ上げて！ みんなでジャンプ', name: 'HANDS UP', color: '#d1b2ff' },
  { action: 'rush', label: 'ここでドロップ！ 一気に行くで', name: 'DROP', color: '#ffda91' },
  { action: 'charge', label: '街で会った仲間と、低音ためよ！', name: 'ONE CREW', color: '#ff9ed3' },
  { action: 'boost', label: 'このフロアを、ひとつにしよ', name: 'ALL TOGETHER', color: '#d1b2ff' },
  { action: 'charge', label: 'ラストの低音、しっかりためよ', name: 'ONE MORE', color: '#97f5df' },
  { action: 'rush', label: 'うちらのラスト！ 全員ぶちアゲ！', name: 'FINALE', color: '#ffda91' },
]);
export const PERFORMANCE_INTRO = 4;
export const PERFORMANCE_PHRASE_SECONDS = 4;
export const PERFORMANCE_LENGTH = PERFORMANCE_INTRO + PERFORMANCE_PHRASES.length * PERFORMANCE_PHRASE_SECONDS;
export const RADIO_PERFORMANCE_LENGTH = PERFORMANCE_PHRASES.length * PERFORMANCE_PHRASE_SECONDS;
const RADIO_PHRASES = [2, 4, 5];
export function createPerformance(chart = null) {
  return { elapsed: 0, phraseIndex: -1, phraseHeld: 0, hits: 0, completed: [], energy: 0, peak: 0, active: null, lastHit: null, done: false,
    chart, clock: null, revision: null, endRevision: null, playing: false, interrupted: false };
}
/** Join the radio in place. Eight playable windows can span songs and their endings. */
export function createRadioPerformance() {
  return { ...createPerformance(), radio: true, trackId: null, cueIndex: -1, prompt: -1, musicTime: 0 };
}
export function updatePerformance(set, input = {}, dt = 0, transport = null) {
  if (!set || set.done || !Number.isFinite(dt) || dt <= 0) return set;
  if (set.radio) return updateRadioPerformance(set, input, dt, transport);
  if (set.chart) return updateChartPerformance(set, input, transport);
  return updateTimedPerformance(set, input, dt);
}
function updateTimedPerformance(set, input, dt) {
  let left = Math.min(dt, 2);
  while (left > 1e-9 && !set.done) {
    const delta = Math.min(left, 1 / 60); left -= delta;
    set.elapsed += delta;
    const index = Math.floor((set.elapsed - PERFORMANCE_INTRO) / PERFORMANCE_PHRASE_SECONDS);
    if (index >= PERFORMANCE_PHRASES.length) { set.done = true; set.active = null; break; }
    if (index !== set.phraseIndex) { set.phraseIndex = index; set.phraseHeld = 0; }
    const phrase = PERFORMANCE_PHRASES[index];
    set.active = phrase?.action ?? null;
    const held = phrase && input[phrase.action] === true;
    if (held) set.phraseHeld += delta;
    set.energy = Math.max(0, Math.min(1, set.energy + (held ? .55 : -.14) * delta));
    set.peak = Math.max(set.peak, set.energy);
    if (phrase && set.phraseHeld >= .85 && !set.completed.includes(index)) {
      set.completed.push(index); set.hits++; set.lastHit = set.elapsed;
    }
  }
  return set;
}

function updateRadioPerformance(set, input, dt, transport) {
  if (!transport?.track && !set.trackId) return updateTimedPerformance(set, input, dt);
  const trackId = transport?.track?.id ?? null, now = transport?.currentTime;
  const playing = Boolean(trackId && Number.isFinite(now) && now >= 0 && transport.playing &&
    !transport.seeking && !transport.hidden && !transport.ended && !transport.muted && transport.volume !== 0);
  const changed = trackId !== set.trackId;
  const delta = set.clock === null ? 0 : now - set.clock;
  const continuous = playing && set.playing && !changed && set.revision === transport.revision && delta >= 0 && delta <= .25;
  // A radio started during the silent encore begins a full set at its current position.
  if (trackId && !set.trackId) {
    set.elapsed = 0; set.hits = 0; set.completed = []; set.energy = 0; set.peak = 0;
  }
  set.chart = chartForTrack(transport?.track);
  const index = chartSectionAt(set.chart, now);
  const prompt = set.chart ? set.chart.sections[index]?.phrase ?? -1 : RADIO_PHRASES[Math.floor((now || 0) / PERFORMANCE_PHRASE_SECONDS) % RADIO_PHRASES.length];
  const cue = Math.min(PERFORMANCE_PHRASES.length - 1, Math.floor(set.elapsed / PERFORMANCE_PHRASE_SECONDS));
  if (!continuous || prompt !== set.prompt || cue !== set.cueIndex) set.phraseHeld = 0;
  set.trackId = trackId || set.trackId;
  set.clock = Number.isFinite(now) ? now : null;
  set.revision = transport?.revision ?? null;
  set.playing = playing; set.musicTime = Number.isFinite(now) ? now : 0;
  set.phraseIndex = index; set.prompt = prompt; set.cueIndex = cue;
  const phrase = PERFORMANCE_PHRASES[prompt];
  set.active = playing ? phrase?.action ?? null : null;
  if (continuous) {
    const held = phrase && input[phrase.action] === true;
    if (held) set.phraseHeld += delta;
    set.energy = Math.max(0, Math.min(1, set.energy + (held ? .55 : -.14) * delta));
    set.peak = Math.max(set.peak, set.energy);
    if (set.phraseHeld >= .85 && !set.completed.includes(cue)) {
      set.completed.push(cue); set.hits++; set.lastHit = set.elapsed;
    }
    set.elapsed = Math.min(RADIO_PERFORMANCE_LENGTH, set.elapsed + delta);
  }
  if (set.elapsed >= RADIO_PERFORMANCE_LENGTH) { set.done = true; set.active = null; set.playing = false; }
  return set;
}

function updateChartPerformance(set, input, transport) {
  if (set.endRevision !== null && transport?.endRevision !== set.endRevision && transport?.endedTrackId === set.chart.trackId) {
    set.elapsed = set.chart.duration; set.done = true; set.active = null; set.playing = false;
    return set;
  }
  set.endRevision = transport?.endRevision ?? null;
  if (!transport || transport.track?.id !== set.chart.trackId) {
    set.interrupted = true; set.done = true; set.active = null; set.playing = false;
    return set;
  }
  const now = transport.currentTime;
  if (!Number.isFinite(now) || now < 0) return set;
  const index = chartSectionAt(set.chart, now);
  const playing = Boolean(transport.playing && !transport.seeking && !transport.hidden);
  const delta = set.clock === null ? 0 : now - set.clock;
  // Seek, resume, track restart and background catch-up never award skipped cues.
  const continuous = playing && set.playing && set.revision === transport.revision && delta >= 0 && delta <= .25;
  const sameSection = index === set.phraseIndex;
  if (!continuous || !sameSection) set.phraseHeld = 0;
  set.clock = now; set.revision = transport.revision; set.playing = playing;
  set.elapsed = Math.min(now, set.chart.duration);
  if (transport.ended || now >= set.chart.duration) {
    set.done = true; set.active = null; set.playing = false;
    return set;
  }
  set.phraseIndex = index;
  const phrase = PERFORMANCE_PHRASES[set.chart.sections[index]?.phrase];
  set.active = playing ? phrase?.action ?? null : null;
  const held = playing && phrase && input[phrase.action] === true;
  if (continuous && sameSection) {
    if (held) set.phraseHeld += delta;
    set.energy = Math.max(0, Math.min(1, set.energy + (held ? .55 : -.14) * delta));
    set.peak = Math.max(set.peak, set.energy);
    if (set.phraseHeld >= .85 && !set.completed.includes(index)) {
      set.completed.push(index); set.hits++; set.lastHit = now;
    }
  }
  return set;
}

export function suspendPerformance(set) {
  if (set?.chart || set?.radio) { set.clock = null; set.playing = false; set.active = null; set.phraseHeld = 0; }
}

export function performanceView(set) {
  const section = set?.chart?.sections[set.phraseIndex];
  const live = Boolean(set?.radio && set.trackId);
  const phrase = PERFORMANCE_PHRASES[live ? set.prompt : set?.chart ? section?.phrase : set?.phraseIndex];
  const done = Boolean(set?.done);
  const total = live ? PERFORMANCE_PHRASES.length : set?.chart?.sections.length || PERFORMANCE_PHRASES.length;
  return {
    title: set?.interrupted ? 'ラジオの曲が変わったで。もう一度始めよか。' : done ? (set.hits >= Math.ceil(total * .75) ? '最高のフロア、できたで！' : '一緒に走ってくれて、ありがとう！') : live && !set.playing ? 'ラジオを再生したら、今の曲に合わせて続けよ。' : phrase?.label || 'クラブ到着！ ここからは、うちらの時間や。',
    phase: done ? 'ENCORE' : phrase?.name || 'WELCOME HOME',
    action: done || ((live || set?.chart) && !set.playing) ? null : phrase?.action || null,
    color: phrase?.color || '#ff9ed3',
    progress: Math.min(1, (set?.elapsed || 0) / (live ? RADIO_PERFORMANCE_LENGTH : set?.chart?.duration || PERFORMANCE_LENGTH)),
    phraseProgress: Math.min(1, (set?.phraseHeld || 0) / .85),
    energy: set?.energy || 0,
    hits: set?.hits || 0,
    total,
    charted: Boolean(set?.chart),
    playing: Boolean((live || set?.chart) && set.playing && !done),
    intensity: section?.intensity || 0,
    musicTime: live ? set.musicTime : set?.elapsed || 0,
    done,
  };
}
