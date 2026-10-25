import { isSurvival } from './survival.js';
import { getRoadCue } from './road-feedback.js';

export function createDrivingLessons() {
  return { boost: false, charge: false, rush: false, chargeSeconds: 0 };
}

/** Observe successful actions without changing the course, clock or rewards. */
export function updateDrivingLessons(lessons, state, dt) {
  if (!isSurvival(state) || state.routeIndex !== 0 || state.status !== 'playing') return;
  if (state.events.some(event => event.type === 'jump-clear')) lessons.boost = true;
  lessons.chargeSeconds = state.charging ? lessons.chargeSeconds + dt : 0;
  if (lessons.chargeSeconds >= .5) lessons.charge = true;
  if (state.rushing) lessons.rush = true;
}

/** Existing danger and low-battery warnings take priority over optional practice. */
export function getDrivingCue(state, lessons) {
  const cue = getRoadCue(state);
  if (!isSurvival(state) || state.routeIndex !== 0 || state.status !== 'playing') return cue;
  if (cue.urgency === 'urgent' || cue.urgency === 'low') return cue;
  if (state.atStation && !lessons.charge && cue.action === 'charge')
    return { ...cue, label: '飛ぶを離して着地。充電を長押しで回復。' };
  if (cue.action === 'boost' && !lessons.boost)
    return { ...cue, label: '飛ぶを長押しで回避。越えたら離して着地。' };
  if (cue.urgency !== 'calm') return cue;
  if (state.elapsed < 4)
    return { label: '運転と攻撃は自動。まずは道を見よ。', action: null, urgency: 'learn' };
  const nearStation = state._stations.some(distance => distance > state.distance && distance - state.distance < 180);
  if (lessons.boost && !lessons.rush && !state.atStation && !nearStation && state.energy >= 60 && state.altitude < 12 && state.rushCooldown <= 0)
    return { label: 'テキーララッシュは長押しで無敵。電池を使うで。', action: 'rush', urgency: 'learn' };
  return cue;
}
