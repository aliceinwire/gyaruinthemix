/** Small, bounded feedback layer. Detailed world and character art remain unobscured. */
const MAX_EFFECTS = 36;
export function createRoadFeedback() { return { effects: [], time: 0 }; }
export function captureRoadFeedback(feedback, events, distance = 0) {
  for (const event of events || []) {
    let label = '', color = '#ffadd9', kind = 'ring';
    if (event.type === 'convert') { label = `+${event.reward} ♡`; kind = 'heart'; }
    else if (event.type === 'collision') { label = `−${event.damage}`; color = '#ffd29a'; }
    else if (event.type === 'jump-clear') { label = 'NICE!'; color = '#a6f6e5'; }
    else if (event.type === 'destroy') { label = 'CLEAR'; color = '#d4b7ff'; }
    else if (event.type === 'shield-block') { label = 'ガード'; color = '#a6f6e5'; }
    else if (event.type === 'rush-start') { label = 'GO!'; color = '#ffda91'; }
    else if (event.type === 'heart-hit') { label = '♡'; }
    else continue;
    feedback.effects.push({ label, color, kind, distance: event.distance ?? distance, age: 0, duration: event.type === 'convert' ? 1.15 : .8 });
  }
  if (feedback.effects.length > MAX_EFFECTS) feedback.effects.splice(0, feedback.effects.length - MAX_EFFECTS);
}
export function updateRoadFeedback(feedback, dt) {
  feedback.time += dt;
  for (const effect of feedback.effects) effect.age += dt;
  feedback.effects = feedback.effects.filter(effect => effect.age < effect.duration);
}
export function drawRoadFeedback(ctx, feedback, state) {
  for (const effect of feedback?.effects || []) {
    const p = effect.age / effect.duration, x = 190 + (effect.distance - state.distance) * 3, y = 357 - p * 38;
    if (x < -90 || x > 1050) continue;
    ctx.save(); ctx.globalAlpha = Math.min(1, (1 - p) * 2);
    ctx.font = '800 18px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#20152e'; ctx.strokeText(effect.label, x, y);
    ctx.fillStyle = effect.color; ctx.fillText(effect.label, x, y);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5, radius = 9 + p * 30;
      ctx.fillRect(x + Math.cos(angle) * radius, y + 24 + Math.sin(angle) * radius, 3, 3);
    }
    ctx.restore();
  }
}
export function getRoadCue(state) {
  const upcoming = (state.entities || []).filter(e => !e.resolved && !e.cleared && !e.converted && ['salaryman', 'pothole', 'barrier', 'cone'].includes(e.type) && e.distance > state.distance - 10 && e.distance < state.distance + 177).sort((a,b) => a.distance-b.distance)[0];
  if (state.energy < 15 && !state.atStation && !upcoming) return { label: 'でんち少なめ。EVまで地上で行こ', action: 'charge', urgency: 'low' };
  if (upcoming?.type === 'pothole') return { label: '穴や！ 飛んでかわそ', action: 'boost', urgency: 'warning' };
  if (upcoming?.behavior === 'shield') return { label: 'ガード中は飛ぶか、開いた時にハート', action: 'shoot', urgency: 'warning' };
  if (upcoming?.behavior === 'charger') return { label: '前に出てくるで！ 先にハートかジャンプ', action: 'shoot', urgency: 'warning' };
  if (upcoming?.elite) return { label: '盛り上げ隊長！ 何発かハート届けよ', action: 'shoot', urgency: 'warning' };
  if (state.atStation) return { label: state.altitude > 12 ? 'EVや！ 地面に降りて充電しよ' : 'EV到着。充電を長押しや', action: 'charge', urgency: 'safe' };
  if (state.routeIndex === 0 && state.distance < 145) return { label: '運転は自動やで。ハートを長押ししてみよ', action: 'shoot', urgency: 'learn' };
  if (state.routeIndex === 0 && state.distance > 390 && state.distance < 540) return { label: '加速は無敵。でんちを残して、ここぞで使お', action: 'rush', urgency: 'learn' };
  if (upcoming?.type === 'barrier') return { label: 'バリケードはハート2発かジャンプや', action: 'shoot', urgency: 'warning' };
  return { label: state.combo >= 3 ? `${state.combo}連続！ この調子で街をつなご` : 'ハートで仲間に。段差は飛んでいこ', action: null, urgency: 'calm' };
}
