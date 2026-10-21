/** Optional, deterministic encore. Uses the same three controls, never gates tour credit. */
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
export function createPerformance() {
  return { elapsed: 0, phraseIndex: -1, phraseHeld: 0, hits: 0, completed: [], energy: 0, peak: 0, active: null, lastHit: null, done: false };
}
export function updatePerformance(set, input = {}, dt = 0) {
  if (!set || set.done || !Number.isFinite(dt) || dt <= 0) return set;
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
export function performanceView(set) {
  const phrase = PERFORMANCE_PHRASES[set?.phraseIndex];
  const done = Boolean(set?.done);
  return {
    title: done ? (set.hits >= 6 ? '最高のフロア、できたで！' : '一緒に走ってくれて、ありがとう！') : phrase?.label || 'クラブ到着！ ここからは、うちらの時間や。',
    phase: done ? 'ENCORE' : phrase?.name || 'WELCOME HOME',
    action: done ? null : phrase?.action || null,
    color: phrase?.color || '#ff9ed3',
    progress: Math.min(1, (set?.elapsed || 0) / PERFORMANCE_LENGTH),
    phraseProgress: Math.min(1, (set?.phraseHeld || 0) / .85),
    energy: set?.energy || 0,
    hits: set?.hits || 0,
    done,
  };
}
