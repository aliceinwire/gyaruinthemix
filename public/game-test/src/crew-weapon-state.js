/** Short, attack-driven passenger gestures. This presentation state never enters saves. */
export const CREW_WEAPON_GESTURE_DURATION = 0.72;
const REQUEST_LIFETIME = 1;
const weapons = new Set(['heart', 'flash', 'vinyl', 'bass', 'phone', 'cd', 'cassette']);

export function resetCrewWeaponGesture(state) {
  state.crewWeaponGesture = null;
  state._crewWeaponRequests = [];
  state._crewWeaponShown = {};
  state._crewWeaponSequence = 0;
}

/** Only primary attacks call this; delayed echoes and tape sweeps have no new hand motion. */
export function requestCrewWeaponGesture(state, weapon) {
  if (!weapons.has(weapon)) return;
  state._crewWeaponRequests ||= [];
  const pending = state._crewWeaponRequests.find(request => request.weapon === weapon);
  if (pending) pending.age = 0;
  else state._crewWeaponRequests.push({ weapon, age: 0 });
}

export function advanceCrewWeaponGesture(state, dt) {
  if (state.crewWeaponGesture) {
    state.crewWeaponGesture.elapsed += dt;
    if (state.crewWeaponGesture.elapsed >= CREW_WEAPON_GESTURE_DURATION - 1e-9)
      state.crewWeaponGesture = null;
  }
  state._crewWeaponRequests = (state._crewWeaponRequests || []).filter(request => {
    request.age += dt;
    return request.age <= REQUEST_LIFETIME;
  });
}

/** Finish the simulation step before choosing, so attack iteration order cannot win every time. */
export function settleCrewWeaponGesture(state) {
  if (state.crewWeaponGesture || !state._crewWeaponRequests?.length) return;
  const history = state._crewWeaponShown ||= {};
  // Among recent attacks, favor the weapon shown least recently. One entry per
  // weapon bounds memory; old attacks expire instead of building a gesture backlog.
  state._crewWeaponRequests.sort((a, b) => (history[a.weapon] ?? -1) - (history[b.weapon] ?? -1));
  const { weapon } = state._crewWeaponRequests.shift();
  history[weapon] = state._crewWeaponSequence = (state._crewWeaponSequence || 0) + 1;
  state.crewWeaponGesture = { weapon, elapsed: 0, duration: CREW_WEAPON_GESTURE_DURATION };
}
