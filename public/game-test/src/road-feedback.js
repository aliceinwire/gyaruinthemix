import { t } from './i18n.js';
/** Small, bounded feedback layer. Detailed world and character art remain unobscured. */
import { ENCOUNTER_RULES } from './encounter-director.js';
import { DRIVING_PACE } from './pace.js';
const MAX_EFFECTS = 36;
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export function createRoadFeedback() { return { effects: [], time: 0 }; }
export function captureRoadFeedback(feedback, events, distance = 0) {
  for (const event of events || []) {
    let label = '', color = '#ffadd9', kind = 'ring';
    if (event.type === 'convert') { label = event.headliner || event.elite ? 'SIGNAL CLEAR' : `+${Math.max(0, finite(event.survivalPoints, event.reward))}`; kind = event.headliner || event.elite ? 'signal' : 'heart'; }
    else if (event.type === 'survival-attack') { label = event.kind === 'flash' ? 'FLASH' : 'VINYL'; color = event.kind === 'flash' ? '#fff1b8' : '#c5a6ff'; kind = event.kind; }
    else if (event.type === 'collision') { label = `−${event.damage}`; color = '#ffd29a'; }
    else if (event.type === 'jump-clear') { label = 'NICE!'; color = '#a6f6e5'; }
    else if (event.type === 'destroy') { label = 'CLEAR'; color = '#d4b7ff'; }
    else if (event.type === 'shield-block') { label = 'ガード'; color = '#a6f6e5'; }
    else if (event.type === 'rush-start') { label = 'GO!'; color = '#ffda91'; }
    else if (event.type === 'heart-hit') { label = 'HIT'; }
    else if (event.type === 'near-miss') { label = 'CLOSE CALL'; color = '#a6f6e5'; }
    else if (event.type === 'rank-up') { label = 'LEVEL UP'; color = '#ffe2a8'; }
    else if (event.type === 'headliner-clear') { label = 'SIGNAL CLEAR'; color = '#ffe2a8'; kind = 'signal'; }
    else if (event.type === 'heart-chain') { label = 'RELAY'; color = '#d4b7ff'; }
    else if (event.type === 'little-find') { label = 'ちいさなしあわせ +75'; color = '#a6f6e5'; kind = 'heart'; }
    else continue;
    feedback.effects.push({ label, color, kind, distance: finite(event.distance, finite(distance)), age: 0, duration: event.type === 'convert' ? 1.15 : .8 });
  }
  if (feedback.effects.length > MAX_EFFECTS) feedback.effects.splice(0, feedback.effects.length - MAX_EFFECTS);
}
export function updateRoadFeedback(feedback, dt) {
  if (!feedback || !Array.isArray(feedback.effects) || !Number.isFinite(dt) || dt <= 0) return;
  feedback.time += dt;
  for (const effect of feedback.effects) effect.age += dt;
  feedback.effects = feedback.effects.filter(effect => effect.age < effect.duration);
}
export function drawRoadFeedback(ctx, feedback, state, { reducedMotion = false } = {}) {
  for (const effect of feedback?.effects || []) {
    const p = effect.age / effect.duration, x = 190 + (effect.distance - state.distance) * 3, y = 300 - (reducedMotion ? 0 : p * 24);
    if (x < -90 || x > 1050) continue;
    ctx.save(); ctx.globalAlpha = Math.min(1, (1 - p) * 2);
    if (effect.kind === 'flash' || effect.kind === 'vinyl') {
      ctx.strokeStyle = effect.color; ctx.lineWidth = reducedMotion ? 2 : 3;
      ctx.beginPath(); ctx.ellipse(x + 50, 415, reducedMotion ? 65 : 30 + p * 120, 24 + p * 12, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = '800 18px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#20152e'; ctx.strokeText(t(effect.label), x, y, 260);
    ctx.fillStyle = effect.color; ctx.fillText(t(effect.label), x, y, 260);
    for (let i = 0; i < (reducedMotion ? 0 : 5); i++) {
      const angle = i * Math.PI * 2 / 5, radius = 9 + p * 30;
      ctx.fillRect(x + Math.cos(angle) * radius, y + 24 + Math.sin(angle) * radius, 3, 3);
    }
    ctx.restore();
  }
}
/** Read-only threat vocabulary shared by the outside-canvas HUD and renderer.
 * One nearest action is announced; graphical brackets stay on the pavement. */
export function getThreatSignals(state = {}) {
  const distance = finite(state.distance);
  const metresPerSecond = Math.max(1, finite(state.speed, 108) / 3.6);
  return (Array.isArray(state.entities) ? state.entities : [])
    .filter(actor => actor && !actor.resolved && !actor.cleared && !actor.converted &&
      ['salaryman', 'pothole', 'barrier', 'cone'].includes(actor.type) &&
      Number.isFinite(actor.distance) && actor.distance > distance - 10 &&
      actor.distance <= distance + ENCOUNTER_RULES.warningViewDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(actor => {
      const phase = actor.behaviorPhase || (actor.shielded ? 'guard' : 'open');
      let label, action = 'shoot';
      if (actor.type === 'pothole') { label = '穴や！ 飛んでかわそ'; action = 'boost'; }
      else if (actor.headliner) label = actor.shielded
        ? `${actor.headliner.name}：ゲート待ち。飛んで通ってもOK`
        : `${actor.headliner.name}：いまハートを重ねよ！`;
      else if (actor.behavior === 'shield') label = actor.shielded
        ? 'ガード中。飛ぶか、開くのを待とう'
        : 'ガードが開いた！ ハートのチャンス';
      else if (actor.behavior === 'charger') label = phase === 'tell'
        ? '動く前にハート！ 飛んで避けてもOK'
        : phase === 'recover' ? '立て直し中や。ハートを届けよ' : '前に動くで！ ハートか浮上';
      else if (actor.type === 'barrier') label = 'バリケードはハート2発かジャンプや';
      else if (actor.type === 'cone') label = 'コーンはハートか、短く浮いてかわそ';
      else if (actor.behavior === 'sway') label = 'ゆれる人波。ハートをつないでこ';
      else label = 'ハートでフロアに誘お';
      if (actor.routineHazard) label = `${actor.routineHazard.name}：${actor.routineHazard.advice}`;
      else if (actor.streetRole) label = `${actor.streetRole.name}：${label}`;
      return { actor, id: actor.id ?? actor.encounterId, label, action, phase,
        distance: Math.max(0, actor.distance - distance),
        seconds: Math.max(0, (actor.distance - distance - (actor.collisionRadius || 15)) / metresPerSecond),
        x: 190 + (actor.distance - distance) * 3,
        urgency: actor.distance - distance < metresPerSecond * 2 ? 'urgent' : 'warning',
        color: actor.shielded ? '#c7b2ff' : phase === 'tell' ? '#ffdb91' : phase === 'recover' ? '#a1f4dc' : '#ffdca4' };
    });
}
export function getRoadCue(state) {
  const upcoming = getThreatSignals(state)[0];
  // Distant warning brackets remain visible while a safe EV window gets the
  // instruction rail. A threat within two seconds still takes priority.
  if (upcoming && (!state.atStation || upcoming.seconds < 2)) return { label: upcoming.label, action: upcoming.action, urgency: upcoming.urgency };
  if (state.energy < 15 && !state.atStation) return { label: 'でんち少なめ。EVまで地上で行こ', action: 'charge', urgency: 'low' };
  if (state.atStation) return { label: state.altitude > 12 ? 'EVや！ 地面に降りて充電しよ' : 'EV到着。充電を長押しや', action: 'charge', urgency: 'safe' };
  if (state.routeIndex === 0 && state.distance < 145 * DRIVING_PACE.speedMultiplier) return { label: '運転は自動やで。ハートを長押ししてみよ', action: 'shoot', urgency: 'learn' };
  if (state.routeIndex === 0 && state.distance > 390 * DRIVING_PACE.speedMultiplier && state.distance < 540 * DRIVING_PACE.speedMultiplier) return { label: '加速は無敵。でんちを残して、ここぞで使お', action: 'rush', urgency: 'learn' };
  return { label: state.combo >= 3 ? `${state.combo}連続！ この調子で街をつなご` : 'ハートで誘って、段差は飛んでいこ', action: null, urgency: 'calm' };
}
