import { chartForTrack, chartSectionAt, TRACK_CHARTS } from './track-charts.js';
import { isSurvival, MUSIC_RULES_VERSION } from './survival.js';
import { SIGNAL_HEADLINERS } from './encounter-director.js';

export const MUSIC_SPEED_LIMIT = .03;
export const MUSIC_ENCOUNTER_IDS = Object.freeze(SIGNAL_HEADLINERS.map(actor => actor.id));
const CUE_KINDS = Object.freeze(['drop', 'break', 'finale']);
const MAX_MUSIC_CUES = TRACK_CHARTS.reduce((total, chart) => total + chart.sections.filter(section => CUE_KINDS.includes(section.kind)).length, 0);

export function createMusicDrive(previous = null) {
  return { multiplier: 1, active: false, clock: null, trackId: null, revision: null,
    playing: false, stagnant: 0, lead: 0, section: -1, dropSection: -1, preview: false,
    cueSeen: previous?.cueSeen?.slice(-MAX_MUSIC_CUES) || [], cueCooldown: previous?.cueCooldown || 0 };
}

/** The preference can change; opting in permanently separates this run's records. */
export function setMusicDrive(state, enabled) {
  state.musicDriveEnabled = isSurvival(state) && enabled === true;
  if (state.musicDriveEnabled && state.status !== 'lost' && !state.campaignComplete) {
    if (!state.survival.musicDriven || state.survival.musicVersion !== MUSIC_RULES_VERSION) state.survival.bestNotified = false;
    state.survival.musicDriven = true;
    state.survival.musicVersion = MUSIC_RULES_VERSION;
  }
  if (!state.musicDriveEnabled) suspendMusicDrive(state);
}

export function suspendMusicDrive(state) {
  const multiplier = state.musicDrive?.multiplier ?? 1;
  state.musicDrive = { ...createMusicDrive(state.musicDrive), multiplier };
}

/** Read the existing radio clock, never create an audio source or change its rate.
 * Only the charted master drives physics. No FFT-derived BPM or wall-clock beat. */
export function updateMusicDrive(state, transport, dt) {
  const drive = state.musicDrive;
  if (!drive || !Number.isFinite(dt) || dt <= 0) return;
  const enabled = isSurvival(state) && state.musicDriveEnabled;
  if (enabled) {
    // Presentation follows the radio in every mode; only opting in changes records.
    state.survival.musicDriven = true;
    state.survival.musicVersion = MUSIC_RULES_VERSION;
  }
  drive.cueCooldown = Math.max(0, drive.cueCooldown - dt);
  const chart = chartForTrack(transport?.track), now = transport?.currentTime;
  const index = chartSectionAt(chart, now);
  const playing = Boolean(chart && index >= 0 && transport.playing && !transport.seeking &&
    !transport.hidden && !transport.muted && transport.volume > 0 && !transport.ended);
  const delta = drive.clock === null ? 0 : now - drive.clock;
  const continuous = playing && drive.playing && drive.trackId === transport.track.id &&
    drive.revision === transport.revision && delta >= 0 && delta <= .25;
  // Firefox can round media clocks to 100 ms. A genuinely stalled clock goes neutral.
  drive.stagnant = continuous && delta === 0 ? drive.stagnant + dt : 0;
  drive.active = continuous && drive.stagnant <= .25;
  if (!drive.active) { drive.lead = 0; drive.dropSection = -1; }
  if (drive.active && index !== drive.section) {
    drive.dropSection = chart.sections[index].kind === 'drop' && index === drive.section + 1 && drive.lead >= 1 ? index : -1;
    const kind = chart.sections[index].kind, key = `${chart.id}:${index}`;
    if (index === drive.section + 1 && drive.lead >= 1 && CUE_KINDS.includes(kind) && !drive.cueSeen.includes(key)) {
      drive.cueSeen.push(key);
      if (drive.cueSeen.length > MAX_MUSIC_CUES) drive.cueSeen.shift();
      if (!drive.cueCooldown) {
        state.events.push({ type: `music-${kind}`, trackId: chart.trackId, section: index });
        drive.cueCooldown = 24;
      }
    }
  }
  if (drive.active) drive.lead = Math.min(2, drive.lead + delta);
  const next = chart?.sections[index + 1];
  drive.preview = drive.active && next?.kind === 'drop' && next.start - now <= 4;
  drive.clock = Number.isFinite(now) ? now : null;
  drive.trackId = transport?.track?.id ?? null;
  drive.revision = transport?.revision ?? null;
  drive.playing = playing;
  drive.section = index;
  const intensity = enabled && drive.active ? chart.sections[index].intensity : .5;
  const target = 1 + MUSIC_SPEED_LIMIT * (intensity * 2 - 1);
  drive.multiplier += (target - drive.multiplier) * (1 - Math.exp(-dt / 1.2));
  drive.multiplier = Math.max(1 - MUSIC_SPEED_LIMIT, Math.min(1 + MUSIC_SPEED_LIMIT, drive.multiplier));
  if (!enabled && Math.abs(drive.multiplier - 1) < 1e-6) drive.multiplier = 1;
}

/** Existing speakers gain an extra opening. Never replace their ordinary tells,
 * add a hazard, alter HP, or award another conversion for repeating/seeking a song. */
export function applyMusicEncounter(actor, state) {
  if (!MUSIC_ENCOUNTER_IDS.includes(actor.headliner?.id) || actor.converted || actor.cleared || actor.resolved) return;
  if (!state.musicDriveEnabled && !actor.musicOpened) { actor.musicCue = false; return; }
  const drive = state.musicDrive;
  const active = state.musicDriveEnabled && drive?.active && actor.tell;
  const drop = active && drive.dropSection === drive.section && drive.dropSection >= 0;
  const dropKey = drop ? `${drive.trackId}:${drive.revision}:${drive.section}` : null;
  actor.musicCue = Boolean(active && drive.preview && !actor.musicOpened);
  if (drop && !actor.musicOpened) {
    actor.musicOpened = true;
    actor.musicDrop = dropKey;
    actor.musicOpenUntil = state.elapsed + 2.5;
    state.events.push({ type: 'music-gate', entityId: actor.id, distance: actor.distance });
  }
  if (drop && actor.musicDrop === dropKey) actor.musicOpenUntil = state.elapsed + 2.5;
  // A delivered opening lasts at least 2.5 s, even when audio stops or is changed.
  actor.musicOpen = (actor.musicOpenUntil || 0) > state.elapsed;
  if (actor.musicOpen) {
    actor.shielded = false; actor.vulnerable = true; actor.behaviorPhase = 'open';
    actor.headlinerPhase = actor.hp <= 1 ? 'last-signal' : 'response';
  }
}
