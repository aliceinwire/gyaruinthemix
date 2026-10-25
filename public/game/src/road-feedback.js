import { t } from './i18n.js';
import { drawItemIcon } from './item-icons.js';
/** Small, bounded feedback layer. Detailed world and character art remain unobscured. */
import { ENCOUNTER_RULES } from './encounter-director.js';
import { DRIVING_PACE } from './pace.js';
import { SILENT_MUSIC, weaponMusicLevel } from './music-reactivity.js';
const MAX_EFFECTS = 36;
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export function createRoadFeedback() { return { effects: [], time: 0 }; }
export function captureRoadFeedback(feedback, events, distance = 0) {
  for (const event of events || []) {
    let label = '', color = '#ffadd9', kind = 'ring';
    if (event.type === 'convert') { label = event.headliner || event.elite ? 'SIGNAL CLEAR' : `+${Math.max(0, finite(event.survivalPoints, event.reward))}`; kind = event.headliner || event.elite ? 'signal' : 'heart'; }
    else if (event.type === 'survival-attack') {
      const styles = { echo: ['MD ECHO', '#8ccfff'], phone: ['LINK', '#ffadd9'], flash: ['FLASH', '#fff1b8'], bass: ['BASS', '#8cf0db'], vinyl: ['VINYL', '#c5a6ff'], cd: ['CD', '#d7faff'], cassette: ['CASSETTE', '#ffda83'] };
      [label, color] = styles[event.kind] || styles.vinyl; kind = event.kind;
    }
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
    feedback.effects.push({ label, color, kind, repeat: event.repeat === true, tapeRepeat: event.tapeRepeat === true, radius: finite(event.radius), behind: finite(event.behind), targets: (Array.isArray(event.targetDistances) ? event.targetDistances : []).filter(Number.isFinite).slice(0, 4), distance: finite(event.distance, finite(distance)), age: 0, duration: event.type === 'convert' ? 1.15 : .8 });
  }
  if (feedback.effects.length > MAX_EFFECTS) feedback.effects.splice(0, feedback.effects.length - MAX_EFFECTS);
}
export function updateRoadFeedback(feedback, dt) {
  if (!feedback || !Array.isArray(feedback.effects) || !Number.isFinite(dt) || dt <= 0) return;
  feedback.time += dt;
  for (const effect of feedback.effects) effect.age += dt;
  feedback.effects = feedback.effects.filter(effect => effect.age < effect.duration);
}
export function drawRoadFeedback(ctx, feedback, state, { reducedMotion = false, music = SILENT_MUSIC } = {}) {
  for (const effect of feedback?.effects || []) {
    const p = effect.age / effect.duration, x = 190 + (effect.distance - state.distance) * 3, y = 300 - (reducedMotion ? 0 : p * 24);
    if (x < -90 || x > 1050) continue;
    ctx.save(); ctx.globalAlpha = Math.min(1, (1 - p) * 2) * (effect.repeat ? .65 : 1);
    const level = weaponMusicLevel(effect.kind, music, reducedMotion);
    if (effect.kind === 'phone') {
      // Thin signal links stay at street height instead of covering the scene.
      let previous = Math.max(0, Math.min(960, x + 20));
      drawItemIcon(ctx, 'phone', previous - 12, 382, 24);
      ctx.strokeStyle = effect.color; ctx.lineWidth = 2 + level;
      for (const distance of effect.targets) {
        const target = 190 + (distance - state.distance) * 3;
        if (target < 0 || target > 960) continue;
        const midpoint = (previous + target) / 2;
        ctx.beginPath(); ctx.moveTo(previous, 408); ctx.lineTo(midpoint, 402); ctx.lineTo(target, 408); ctx.stroke();
        ctx.strokeRect(target - 5, 403, 10, 10);
        if (!reducedMotion) {
          const progress = Math.min(1, p * 3);
          ctx.fillStyle = '#fff4e8'; ctx.fillRect(previous + (target - previous) * progress - 2, 404, 4, 4);
        }
        previous = target;
      }
    }
    if (effect.repeat) {
      drawItemIcon(ctx, 'md', x - 10, y + 7, 20);
      if (level) { ctx.fillStyle = '#d7faff'; ctx.fillRect(x - 5, y + 21, 10 * level, 2); }
    }
    if (effect.kind === 'cd') {
      const target = 190 + ((effect.targets[0] ?? effect.distance) - state.distance) * 3;
      const discX = reducedMotion ? target : x + (target - x) * Math.min(1, p * 4);
      ctx.strokeStyle = effect.color; ctx.lineWidth = 2 + level;
      ctx.beginPath(); ctx.moveTo(x, 390); ctx.lineTo(discX, 390); ctx.stroke();
      drawItemIcon(ctx, 'cd', discX - 14, 376, 28);
    }
    if (effect.kind === 'cassette') {
      const left = Math.max(0, x - effect.behind * 3), right = Math.min(960, x + effect.radius * 3);
      ctx.strokeStyle = effect.color; ctx.lineWidth = effect.tapeRepeat ? 1 : 2;
      ctx.beginPath();
      for (let at = left; at <= right; at += 6) {
        const height = 418 + Math.sin((at - left) / 18 + (reducedMotion ? 0 : p * 8)) * (5 + level * 2);
        if (at === left) ctx.moveTo(at, height); else ctx.lineTo(at, height);
      }
      ctx.stroke(); drawItemIcon(ctx, 'cassette', x - 12, 388, 24);
    }
    if (['flash', 'vinyl', 'bass'].includes(effect.kind)) {
      ctx.strokeStyle = effect.color; ctx.lineWidth = reducedMotion ? 2 : 3 + level;
      const center = effect.kind === 'bass' ? x : x + 50;
      ctx.beginPath(); ctx.ellipse(center, 415, reducedMotion ? 65 : 30 + p * 120, 24 + p * 12, 0, 0, Math.PI * 2); ctx.stroke();
      if (effect.kind === 'bass' && !reducedMotion) {
        ctx.beginPath(); ctx.ellipse(center, 415, 15 + p * 90, 12 + p * 8, 0, 0, Math.PI * 2); ctx.stroke();
      }
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
      if (state.mode === 'survival') {
        action = actor.type === 'pothole' || actor.shielded ? 'boost' : null;
        label = actor.type === 'pothole' ? '穴や！ 飛んでかわそ' : actor.shielded ? 'ガード中。飛ぶか、開くのを待とう' : actor.behavior === 'charger' ? '前に動くで！ 距離を見て浮上' : '武器は自動。近づく人波は浮いてかわそ';
      }
      if (actor.routineHazard) label = `${actor.routineHazard.name}：${actor.routineHazard.advice}`;
      else if (actor.streetRole) label = `${actor.streetRole.name}：${label}`;
      if (actor.musicCue) label = 'もうすぐドロップ。音のゲートが開くで';
      if (actor.musicOpen) label = 'ドロップでゲート開放！ 武器は自動やで';
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
  if (state.mode === 'survival') return { label: '武器は自動。飛ぶ・充電・加速で道をつなご。', action: null, urgency: 'calm' };
  if (state.routeIndex === 0 && state.distance < 145 * DRIVING_PACE.speedMultiplier) return { label: '運転もハートも自動。段差は飛んでかわそ。', action: 'boost', urgency: 'learn' };
  if (state.routeIndex === 0 && state.distance > 390 * DRIVING_PACE.speedMultiplier && state.distance < 540 * DRIVING_PACE.speedMultiplier) return { label: '加速は無敵。でんちを残して、ここぞで使お', action: 'rush', urgency: 'learn' };
  return { label: state.combo >= 3 ? `${state.combo}連続！ この調子で街をつなご` : 'ハートで誘って、段差は飛んでいこ', action: null, urgency: 'calm' };
}
