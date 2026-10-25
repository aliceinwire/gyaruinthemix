import { ENCOUNTER_RULES } from '../public/game/src/encounter-director.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  update,
  beginCampaign,
  nextRoute,
  retryRoute,
  answerQuiz,
  exportCampaignSave,
  restoreCampaignSave,
  changeRouteBeforeStart,
} from '../public/game/src/simulation.js';
import {
  RUN_MOD_CATALOG,
  normalizeRunBuild,
  getBuildModifiers,
  getBuildOffers,
  buyRunMod,
  getRouteMission,
} from '../public/game/src/run-build.js';
import {
  RUN_STYLES,
  PERK_CATALOG,
  RANK_XP,
  normalizeRpg,
  chooseRunStyle,
  getRpgView,
  choosePerk,
  recordRpgEvent,
  openRpgDraft,
} from '../public/game/src/tour-rpg.js';

function quiet(style, options = {}) {
  const state = createState(options);
  if (style) assert.equal(chooseRunStyle(state, style), true);
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  state._quizTriggered = true;
  return state;
}
function perks(state, ids) {
  state.rpg.xp = RANK_XP.at(-1);
  state.rpg.perks = ids;
  return state;
}
function arrived(state) {
  state.entities = [];
  state._stations = [];
  state._nextEncounter = 1e9;
  state._quizTriggered = true;
  state.distance = state.routeLength - 0.01;
  state.status = 'playing';
  update(state, {}, 0.01);
  assert.equal(state.status, 'won');
  return state;
}
function installMods(state, ids) {
  state.runBuild = normalizeRunBuild(
    {
      ...state.runBuild,
      mods: ids,
      acquiredIds: RUN_MOD_CATALOG.map((item) => item.id),
    },
    state,
  );
  return state;
}
function draftPerk(state, id) {
  state.rpg.xp = RANK_XP[state.rpg.perks.length + 1];
  state.status = 'playing';
  for (let seed = 1; seed < 10000; seed++) {
    state.seed = seed;
    if (getRpgView(state).offers.some((item) => item.id === id)) break;
  }
  assert.equal(openRpgDraft(state), true);
  assert.equal(choosePerk(state, id), true);
}

test('overlapping shop parts and perks grant bounded gains in either acquisition order', () => {
  const cases = [
    {
      mod: 'heart-pierce',
      perk: 'spotlight',
      style: 'relay',
      field: 'heartPierce',
      total: 3,
    },
    {
      mod: 'heart-chain',
      perk: 'chorus',
      style: 'guardian',
      field: 'heartChain',
      total: 2,
    },
    {
      mod: 'heart-recycle',
      perk: 'recycle',
      style: 'guardian',
      field: 'conversionEnergy',
      total: 6,
    },
    {
      mod: 'charge-shield',
      perk: 'sanctuary',
      style: 'guardian',
      field: 'chargeShieldSeconds',
      total: 0.5,
      lower: true,
    },
    {
      mod: 'charged-heart',
      perk: 'capacitor',
      style: 'guardian',
      field: 'chargedHeartBonus',
      total: 2,
    },
    {
      mod: 'air-control',
      perk: 'glide',
      style: 'air',
      field: 'descentMultiplier',
      total: 0.5,
      lower: true,
    },
    {
      mod: 'rush-pulse',
      perk: 'drop',
      style: 'air',
      field: 'rushPulse',
      total: 75,
    },
    {
      mod: 'combo-flight',
      perk: 'rebound',
      style: 'air',
      field: 'comboFlight',
      total: 8,
    },
  ];
  for (const spec of cases)
    for (const perkFirst of [false, true]) {
      const state = quiet(spec.style),
        item = RUN_MOD_CATALOG.find((item) => item.id === spec.mod);
      const previous = RUN_MOD_CATALOG.filter(
        (other) => other.family === item.family && other.tier < item.tier,
      ).map((other) => other.id);
      state.runBuild = normalizeRunBuild(
        { ...state.runBuild, acquiredIds: previous },
        state,
      );
      state.routeIndex = 6;
      state.campaignStarted = true;
      state.money = 10000;
      const improved = (before, after) =>
        assert.ok(
          spec.lower ? after < before : after > before,
          `${spec.mod} / ${spec.perk}: ${before} → ${after}`,
        );
      const buy = () => {
        state.status = 'won';
        const offer = getBuildOffers(state).find(
          (item) => item.id === spec.mod,
        );
        assert.equal(offer.available, true);
        assert.match(offer.preview, /→|1回ガード/);
        assert.equal(buyRunMod(state, spec.mod), true);
      };
      let before = getBuildModifiers(state)[spec.field];
      if (perkFirst) draftPerk(state, spec.perk);
      else buy();
      let after = getBuildModifiers(state)[spec.field];
      improved(before, after);
      before = after;
      if (perkFirst) buy();
      else draftPerk(state, spec.perk);
      after = getBuildModifiers(state)[spec.field];
      improved(before, after);
      assert.equal(after, spec.total);
    }
});

test('Guardian starting shield and three shield sources each reduce real charge preparation time', () => {
  for (const [mods, learned, expected] of [
    [[], [], 1.5],
    [['charge-shield'], [], 1.25],
    [[], ['sanctuary'], 0.75],
    [['charge-shield'], ['sanctuary'], 0.5],
  ]) {
    const state = installMods(perks(quiet('guardian'), learned), mods);
    state.rpg.xp = learned.length ? 32 : 0;
    state.entities = [{ id: 80, type: 'ev', distance: 0, radius: 1000 }];
    assert.equal(getBuildModifiers(state).chargeShieldSeconds, expected);
    update(state, { charge: true }, expected - 0.025);
    assert.equal(state.buildRuntime.shield, 0);
    update(state, { charge: true }, 0.05);
    assert.equal(state.buildRuntime.shield, 1);
  }
});

test('stacked chains reach two distinct neighbors without recursive chain explosions', () => {
  const state = installMods(perks(quiet('guardian'), ['chorus']), [
    'heart-chain',
  ]);
  state.rpg.xp = 32;
  state.entities = [40, 50, 60, 70].map((distance, id) => ({
    id: 90 + id,
    type: 'salaryman',
    distance,
  }));
  update(state, { shoot: true }, 0.01);
  update(state, {}, 0.3);
  assert.equal(state.gyaruConverted, 3);
  assert.equal(
    state.entities.filter(
      (target) => target.type === 'salaryman' && !target.converted,
    ).length,
    1,
  );
  assert.equal(
    state.events.filter((event) => event.type === 'heart-chain').length,
    2,
  );
});

test('stacked charge damage, guarded piercing and rush range change actual hits within their caps', () => {
  const charged = installMods(perks(quiet('guardian'), ['capacitor']), [
    'charged-heart',
  ]);
  charged.rpg.xp = 32;
  charged.energy = 99;
  charged.entities = [{ id: 110, type: 'ev', distance: 0, radius: 1000 }];
  update(charged, { charge: true }, 0.1);
  assert.equal(charged.buildRuntime.chargedShot, 2);
  charged.entities = [
    { id: 111, type: 'salaryman', distance: charged.distance + 40, hp: 3 },
  ];
  update(charged, { shoot: true }, 0.01);
  update(charged, {}, 0.4);
  assert.equal(
    charged.gyaruConverted,
    1,
    'one prepared shot deals exactly 3 damage',
  );

  const guarded = installMods(
    perks(quiet('guardian'), ['capacitor', 'comeback']),
    ['shield-piercing'],
  );
  guarded.rpg.xp = 90;
  guarded.buildRuntime.shield = 1;
  guarded.entities = [40, 65, 90, 115].map((distance, id) => ({
    id: 120 + id,
    type: 'salaryman',
    distance,
    shielded: true,
  }));
  update(guarded, { shoot: true }, 0.01);
  update(guarded, {}, 0.8);
  assert.equal(getBuildModifiers(guarded).guardedHeartPierce, 2);
  assert.equal(
    guarded.gyaruConverted,
    3,
    'two guarded sources add two penetrations to one shot',
  );

  const rush = installMods(perks(quiet('air'), ['drop']), ['rush-pulse']);
  rush.rpg.xp = 32;
  rush.entities = [70, 80].map((distance, id) => ({
    id: 130 + id,
    type: 'salaryman',
    distance,
    hp: 2,
  }));
  update(rush, { rush: true }, 0.01);
  assert.equal(rush.gyaruConverted, 1);
  assert.equal(
    rush.entities.find((target) => target.id === 131).hp,
    2,
    '75m wave cannot reach an 80m target',
  );
  assert.ok(rush.speed <= ENCOUNTER_RULES.maximumSupportedSpeed);
});

test('styles are free, distinct action changes and lock on first departure', () => {
  assert.equal(RUN_STYLES.length, 3);
  const relay = quiet('relay'),
    guardian = quiet('guardian'),
    air = quiet('air');
  assert.equal(getBuildModifiers(relay).heartPierce, 1);
  assert.equal(getBuildModifiers(guardian).chargeShield, true);
  assert.equal(getBuildModifiers(guardian).chargeShieldSeconds, 1.5);
  assert.equal(getBuildModifiers(air).thrustDrainMultiplier, 0.85);
  assert.equal(getBuildModifiers(air).comboFlight, 2);
  for (const state of [relay, guardian, air]) {
    assert.equal(state.money, 0);
    assert.equal(state.rpg.perks.length, 0);
    beginCampaign(state);
    assert.equal(chooseRunStyle(state, 'relay'), false);
  }
  assert.equal(chooseRunStyle(quiet(), 'invented'), false);
  assert.equal(chooseRunStyle(createState({ routeIndex: 1 }), 'relay'), false);
});

test('invalid saves cannot invent perks, overflow XP or activate a legacy run', () => {
  for (const value of [
    null,
    [],
    {},
    { version: 2, enabled: true, style: 'relay' },
    { version: 1, enabled: true, style: '__proto__' },
  ])
    assert.equal(normalizeRpg(value).enabled, false);
  const malformed = normalizeRpg({
    version: 1,
    enabled: true,
    style: 'air',
    xp: Infinity,
    perks: ['drop'],
    receipts: ['0:charged:1', '0:charged:1', '__proto__'],
  });
  assert.equal(malformed.xp, 0);
  assert.deepEqual(malformed.perks, []);
  assert.deepEqual(malformed.receipts, ['0:charged:1']);
  const limited = normalizeRpg({
    version: 1,
    enabled: true,
    style: 'relay',
    xp: 32,
    perks: ['chorus', 'chorus', 'drop', 'invented'],
  });
  assert.deepEqual(limited.perks, ['chorus']);
  const legacy = exportCampaignSave(quiet());
  delete legacy.checkpoint.rpg;
  assert.equal(restoreCampaignSave(legacy).rpg.enabled, false);
});

test('XP uses real unique event receipts and charging cannot farm ranks', () => {
  const state = quiet('guardian');
  state.integrity = 60;
  assert.equal(recordRpgEvent(state, { type: 'charged', stationId: 10 }), true);
  assert.equal(state.rpg.xp, 6);
  assert.equal(state.integrity, 64);
  assert.equal(
    recordRpgEvent(state, { type: 'charged', stationId: 10 }),
    false,
  );
  assert.equal(state.integrity, 64);
  assert.equal(recordRpgEvent(state, { type: 'charged' }), false);
  assert.equal(
    recordRpgEvent(state, { type: 'quiz-result', entityId: 2, correct: false }),
    false,
  );
  assert.equal(recordRpgEvent(state, { type: 'shoot', entityId: 4 }), false);
  state.status = 'lost';
  assert.equal(
    recordRpgEvent(state, { type: 'convert', entityId: 3, combo: 1 }),
    false,
  );
});

test('three-way drafts are seeded, family-distinct and exclude owned perks', () => {
  const state = quiet('relay', { seed: 951 });
  state.rpg.xp = 90;
  const before = JSON.stringify(state),
    offers = getRpgView(state).offers;
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((item) => item.family)).size, 3);
  assert.deepEqual(getRpgView(state).offers, offers);
  assert.equal(JSON.stringify(state), before);
  assert.equal(choosePerk(state, offers[0].id), false);
  assert.equal(openRpgDraft(state), true);
  assert.equal(choosePerk(state, 'invented'), false);
  assert.equal(choosePerk(state, offers[0].id), true);
  assert.equal(choosePerk(state, offers[1].id), false);
  assert.equal(getRpgView(state).rank, 2);
  assert.equal(
    getRpgView(state).offers.some((item) => item.id === offers[0].id),
    false,
  );
  state.rpg = normalizeRpg({
    ...state.rpg,
    xp: RANK_XP.at(-1),
    perks: PERK_CATALOG.slice(0, 6).map((item) => item.id),
  });
  assert.equal(getRpgView(state).offers.length, 0);
  assert.equal(getRpgView(state).rank, 7);
});

test('draft stops simulation, collisions, combo decay, energy drain and cooldowns', () => {
  const state = quiet('air');
  state.rpg.xp = 32;
  state.combo = 5;
  state.comboTimer = 4;
  state.rushing = true;
  state.rushTime = 1;
  state.rushCooldown = 0;
  assert.equal(openRpgDraft(state), true);
  assert.equal(state.rushCooldown, state.rushRecovery);
  state.entities = [{ id: 10, type: 'barrier', distance: 0.1 }];
  const snapshot = {
    elapsed: state.elapsed,
    distance: state.distance,
    energy: state.energy,
    integrity: state.integrity,
    comboTimer: state.comboTimer,
    rushCooldown: state.rushCooldown,
  };
  update(state, { rush: true, boost: true, shoot: true }, 20);
  for (const [key, value] of Object.entries(snapshot))
    assert.equal(state[key], value, key);
  assert.equal(choosePerk(state, getRpgView(state).offers[0].id), true);
  assert.equal(state.status, 'playing');
});

test('relay starting piercing and chorus perk affect actual projectile collisions', () => {
  const state = quiet('relay');
  state.entities = [40, 65].map((distance, id) => ({
    id: 20 + id,
    type: 'salaryman',
    distance,
  }));
  update(state, { shoot: true }, 0.01);
  update(state, {}, 0.8);
  assert.equal(state.gyaruConverted, 2);
  assert.equal(state.rpg.xp, 15);
  const chain = perks(quiet('guardian'), ['chorus']);
  chain.entities = [40, 65].map((distance, id) => ({
    id: 30 + id,
    type: 'salaryman',
    distance,
  }));
  // No draft is due when all earned perk slots are already assigned.
  chain.rpg.xp = 32;
  update(chain, { shoot: true }, 0.01);
  update(chain, {}, 0.8);
  assert.equal(chain.gyaruConverted, 2);
});

test('sound rigs keep action rewards but are never counted as invited people, including save and retry', () => {
  const state = quiet('relay');
  const peopleOnly = quiet('relay');
  state.entities = [
    {
      id: 70,
      type: 'salaryman',
      distance: 40,
      hp: 1,
      headliner: { id: 'test-signal', name: 'テストシグナル' },
    },
    { id: 71, type: 'salaryman', distance: 65, hp: 1 },
  ];
  peopleOnly.entities = state.entities.map((entity) => {
    const target = { ...entity };
    delete target.headliner;
    return target;
  });
  update(peopleOnly, { shoot: true }, 0.01);
  update(peopleOnly, {}, 0.8);
  update(state, { shoot: true }, 0.01);
  update(state, {}, 0.8);
  assert.equal(state.signalClears, 1);
  assert.equal(state.stageSignals, 1);
  assert.equal(state.gyaruConverted, 1);
  assert.equal(state.stageGyaru, 1);
  assert.equal(state.combo, 2);
  assert.equal(state.money, peopleOnly.money);
  assert.equal(state.rpg.xp, 15);
  assert.equal(state.score, peopleOnly.score);
  assert.equal(
    getRouteMission(state).progress.conversions,
    2,
    'route connection goals remain achievable with a sound rig',
  );
  const converted = state.events.filter((event) => event.type === 'convert');
  assert.equal(
    converted.find((event) => event.entityId === 70)?.signalRepaired,
    true,
  );
  assert.equal(
    converted.find((event) => event.entityId === 71)?.signalRepaired,
    false,
  );
  update(state, { shoot: true }, 0.5);
  assert.equal(state.signalClears, 1);
  assert.equal(state.gyaruConverted, 1);
  const restarted = restoreCampaignSave(exportCampaignSave(state));
  assert.equal(restarted.signalClears, 0);
  assert.equal(restarted.stageSignals, 0);
  arrived(state);
  const saved = restoreCampaignSave(exportCampaignSave(state));
  assert.equal(saved.signalClears, 1);
  assert.equal(saved.stageSignals, 1);
  nextRoute(saved);
  assert.equal(saved.signalClears, 1);
  assert.equal(saved.stageSignals, 0);
  saved.status = 'lost';
  retryRoute(saved);
  assert.equal(saved.signalClears, 1);
  assert.equal(saved.stageSignals, 0);
});

test('guardian shield, capacitor and comeback work together on live charge and collision', () => {
  const state = perks(quiet('guardian'), ['capacitor', 'comeback']);
  state.rpg.xp = 90;
  state.energy = 10;
  state.integrity = 50;
  state.entities = [{ id: 40, type: 'ev', distance: 50, radius: 1000 }];
  update(state, { charge: true }, 2.3);
  assert.equal(state.buildRuntime.shield, 1);
  assert.equal(state.buildRuntime.chargedShot, 1);
  assert.equal(state.integrity, 54);
  state.entities = [
    { id: 41, type: 'barrier', distance: state.distance + 0.1 },
  ];
  update(state, {}, 0.01);
  assert.equal(state.buildRuntime.shield, 0);
  assert.equal(state.integrity, 62);
  assert.equal(getBuildModifiers(state).shieldPiercing, true);
});

test('air precision rewards exact low clear once and changes rush recovery', () => {
  const state = perks(quiet('air'), ['glide', 'rebound']);
  state.rpg.xp = 90;
  state.energy = 20;
  state.rushCooldown = 3;
  state.altitude = 0.35 * 112;
  state.jumpHeight = 0.35;
  state.altitudeVelocity = 0;
  state.entities = [{ id: 60, type: 'pothole', distance: 0.1 }];
  update(state, {}, 0.01);
  assert.ok(state.energy > 28, 'base, rebound and precision energy reward');
  assert.ok(state.rushCooldown < 2.01);
  assert.ok(state.events.some((event) => event.type === 'precision'));
  const xp = state.rpg.xp,
    energy = state.energy;
  update(state, {}, 0.01);
  assert.equal(state.rpg.xp, xp);
  assert.equal(state.energy, energy);
});

test('retries and reloads roll back in-road XP/perks; arrivals keep them without farming', () => {
  const state = quiet('relay');
  beginCampaign(state);
  const firstSave = exportCampaignSave(state);
  recordRpgEvent(state, { type: 'convert', entityId: 1, combo: 1 });
  state.rpg.xp = 32;
  openRpgDraft(state);
  choosePerk(state, getRpgView(state).offers[0].id);
  assert.equal(restoreCampaignSave(exportCampaignSave(state)).rpg.xp, 0);
  state.status = 'lost';
  retryRoute(state);
  assert.deepEqual(state.rpg, restoreCampaignSave(firstSave).rpg);
  state.rpg.xp = 32;
  openRpgDraft(state);
  choosePerk(state, getRpgView(state).offers[0].id);
  arrived(state);
  const retained = normalizeRpg(state.rpg),
    restored = restoreCampaignSave(exportCampaignSave(state));
  assert.deepEqual(restored.rpg, retained);
  assert.equal(recordRpgEvent(restored, { type: 'won' }), false);
  nextRoute(restored);
  assert.deepEqual(restored.rpg, retained);
});

test('assist reduces actual collision damage and survives route/retry transitions', () => {
  const regular = quiet(),
    assisted = quiet();
  assisted.assistMode = true;
  for (const state of [regular, assisted]) {
    state.entities = [{ id: 2, type: 'barrier', distance: 0.1 }];
    update(state, {}, 0.01);
  }
  assert.equal(
    100 - assisted.integrity,
    Math.round((100 - regular.integrity) * 0.55),
  );
  assisted.status = 'lost';
  retryRoute(assisted);
  assert.equal(assisted.assistMode, true);
  changeRouteBeforeStart(assisted);
  assert.equal(assisted.assistMode, true);
  arrived(assisted);
  nextRoute(assisted);
  assert.equal(assisted.assistMode, true);
});

test('RPG movement and XP remain identical across fixed frame subdivisions', () => {
  const a = quiet('air'),
    b = quiet('air');
  for (const state of [a, b])
    state.entities = [{ id: 9, type: 'pothole', distance: 15 }];
  for (let i = 0; i < 30; i++) update(a, { boost: true }, 1 / 30);
  for (let i = 0; i < 120; i++) update(b, { boost: true }, 1 / 120);
  for (const key of ['distance', 'energy', 'altitude', 'score'])
    assert.ok(Math.abs(a[key] - b[key]) < 1e-7, key);
  assert.deepEqual(a.rpg, b.rpg);
});

test('all three styles complete real twelve-road tours with six valid draft decisions', () => {
  for (const style of RUN_STYLES)
    for (const seed of [42, 175]) {
      const state = createState({ seed });
      chooseRunStyle(state, style.id);
      let decisions = 0;
      for (let road = 0; road < 12; road++) {
        for (
          let frame = 0;
          frame < 9000 && ['playing', 'quiz', 'draft'].includes(state.status);
          frame++
        ) {
          if (state.status === 'quiz') {
            answerQuiz(state, true);
            continue;
          }
          if (state.status === 'draft') {
            const view = getRpgView(state),
              pick =
                view.offers.find((item) => item.family === style.id) ||
                view.offers[0];
            assert.equal(view.offers.length, 3);
            assert.equal(choosePerk(state, pick.id), true);
            decisions++;
            continue;
          }
          const hole = state.entities.find(
            (item) =>
              !item.cleared &&
              !item.resolved &&
              item.type === 'pothole' &&
              item.distance > state.distance - 1 &&
              item.distance - state.distance < 54,
          );
          const station = state.entities.find(
            (item) =>
              item.type === 'ev' &&
              Math.abs(item.distance - state.distance) <= item.radius,
          );
          update(
            state,
            {
              shoot: !hole,
              boost: Boolean(hole),
              charge: Boolean(station && !hole),
            },
            1 / 60,
          );
        }
        assert.equal(
          state.status,
          'won',
          `${style.id}, seed ${seed}, road ${road}`,
        );
        if (road < 11) nextRoute(state);
      }
      assert.equal(state.campaignComplete, true);
      assert.equal(decisions, 6);
      assert.equal(getRpgView(state).rank, 7);
      assert.ok(state.integrity > 0);
    }
});
