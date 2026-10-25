import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createState,
  update,
  chooseStartingWeapon,
  exportNightfallSave,
  restoreNightfallSave,
  beginClubQuiz,
} from '../public/game/src/simulation.js';
import {
  resetCrewWeaponGesture,
  requestCrewWeaponGesture,
  advanceCrewWeaponGesture,
  settleCrewWeaponGesture,
} from '../public/game/src/crew-weapon-state.js';
import {
  resolveCrewVisuals,
  drawCharacter,
  preloadCharacterActions,
} from '../public/game/src/character-actions.js';
import {
  drawCabinCharacter,
  preloadCabinCharacters,
} from '../public/game/src/cabin-characters.js';
import { selectCrewDialogue } from '../public/game/src/crew-dialogue.js';
import { drawCar } from '../public/game/src/renderer.js';
import { CAR_ART } from '../public/game/src/car-art.js';
import { LANGUAGES } from '../public/game/src/i18n.js';

const weapons = ['heart', 'flash', 'vinyl', 'bass', 'phone', 'cd', 'cassette'];
const make = (weapon) =>
  createState({
    mode: 'survival',
    survivalDay: '2026-10-23',
    startingWeapon: weapon,
  });
const target = () => ({
  id: 1000,
  type: 'salaryman',
  distance: 25,
  hp: 10000,
  maxHp: 10000,
  baseHeight: 0,
});

for (const weapon of weapons)
  test(`${weapon} primary attack selects its own passenger expression and dialogue`, () => {
    const state = make(weapon);
    state.entities = [target()];
    update(state, {}, 1 / 60);
    assert.equal(state.crewWeaponGesture.weapon, weapon);
    const visual = resolveCrewVisuals(state, { time: 10 });
    assert.equal(visual.action.arisu, 'drive');
    assert.equal(visual.action.chana, weapon === 'heart' ? 'hearts' : weapon);
    assert.match(
      selectCrewDialogue(state).id,
      new RegExp(`^action:${visual.action.chana}:`),
    );
    assert.ok(Object.isFrozen(visual.crewWeaponGesture));
    if (weapon !== 'heart') {
      assert.doesNotMatch(selectCrewDialogue(state).text, /ハート/);
      for (const { code } of LANGUAGES) {
        if (code === 'ja') continue;
        const catalog = JSON.parse(
          readFileSync(
            new URL(`../public/game/locales/${code}.json`, import.meta.url),
          ),
        );
        assert.ok(
          catalog[selectCrewDialogue(state).text],
          `${code}: ${weapon}`,
        );
      }
    }
  });

test('area weapons cannot invent an attack without a target', () => {
  for (const weapon of weapons.slice(1)) {
    const state = make(weapon);
    state.entities = [];
    update(state, {}, 0.1);
    assert.equal(state.crewWeaponGesture, null);
  }
});

test('mixed builds hold readable gestures and give each fresh weapon a turn', () => {
  const state = {};
  resetCrewWeaponGesture(state);
  for (const id of weapons) requestCrewWeaponGesture(state, id);
  settleCrewWeaponGesture(state);
  const first = state.crewWeaponGesture;
  for (let i = 0; i < 20; i++) requestCrewWeaponGesture(state, 'heart');
  advanceCrewWeaponGesture(state, 0.2);
  settleCrewWeaponGesture(state);
  assert.equal(state.crewWeaponGesture, first);
  assert.equal(first.elapsed, 0.2);
  const shown = new Set([first.weapon]);
  for (let round = 0; round < weapons.length * 2; round++) {
    advanceCrewWeaponGesture(state, 0.72);
    for (const id of weapons) requestCrewWeaponGesture(state, id);
    assert.ok(state._crewWeaponRequests.length <= 7);
    settleCrewWeaponGesture(state);
    shown.add(state.crewWeaponGesture.weapon);
  }
  assert.deepEqual(shown, new Set(weapons));
  advanceCrewWeaponGesture(state, 2);
  settleCrewWeaponGesture(state);
  assert.equal(state.crewWeaponGesture, null);
});

test('gestures freeze outside play and never leak into checkpoints or new equipment', () => {
  const state = make('cd');
  state.entities = [target()];
  update(state, {}, 1 / 60);
  const gesture = structuredClone(state.crewWeaponGesture);
  state.status = 'draft';
  update(state, {}, 1);
  assert.deepEqual(state.crewWeaponGesture, gesture);
  const fresh = make('cd');
  requestCrewWeaponGesture(fresh, 'cd');
  settleCrewWeaponGesture(fresh);
  const save = exportNightfallSave(fresh);
  assert.ok(save);
  assert.doesNotMatch(JSON.stringify(save), /crewWeapon|_crewWeapon/);
  assert.equal(restoreNightfallSave(save).crewWeaponGesture, null);
  assert.equal(chooseStartingWeapon(fresh, 'phone'), true);
  assert.equal(fresh.crewWeaponGesture, null);
  const club = createState({
    mode: 'survival',
    survivalDay: '2026-10-23',
    routeIndex: 3,
  });
  club.status = 'won';
  requestCrewWeaponGesture(club, 'cd');
  settleCrewWeaponGesture(club);
  assert.equal(beginClubQuiz(club), true);
  assert.equal(club.crewWeaponGesture, null);
});

class LocalImage {
  set src(url) {
    this.url = url;
    const bytes = readFileSync(new URL(url));
    this.width = this.naturalWidth = bytes.readUInt32BE(16);
    this.height = this.naturalHeight = bytes.readUInt32BE(20);
    queueMicrotask(() => this.onload?.());
  }
}
function context() {
  return new Proxy(
    {
      draws: [],
      drawImage(image, ...args) {
        this.draws.push([image.url, ...args]);
      },
    },
    {
      get: (object, key) => (key in object ? object[key] : () => {}),
    },
  );
}
test('portrait and cabin use distinct gadget cells while all five drivers keep their geometry', async () => {
  const original = globalThis.Image;
  globalThis.Image = LocalImage;
  try {
    await Promise.all([preloadCharacterActions(), preloadCabinCharacters()]);
    const cells = new Set();
    for (const weapon of weapons.slice(1)) {
      const visual = resolveCrewVisuals(
        {
          crewWeaponGesture: { weapon, elapsed: 0.25, duration: 0.72 },
          shooting: true,
        },
        { time: 15 },
      );
      const portrait = context(),
        cabin = context();
      const p = drawCharacter(portrait, { character: 'chana', ...visual });
      const c = drawCabinCharacter(cabin, { character: 'chana', ...visual });
      assert.equal(p.action, weapon);
      assert.equal(c.action, weapon);
      assert.equal(p.animationFrame, c.animationFrame);
      assert.match(portrait.draws[0][0], /chana-weapon-poses/);
      assert.notDeepEqual(
        portrait.draws[0].slice(1, 5),
        cabin.draws[0].slice(1, 5),
      );
      cells.add(JSON.stringify(portrait.draws[0].slice(1, 5)));
      for (const carId of Object.keys(CAR_ART))
        for (const roofClosed of [false, true]) {
          const baseline = context(),
            equipped = context();
          drawCar(baseline, 0, 0, {
            carId,
            roofClosed,
            crewVisuals: resolveCrewVisuals(
              { crewWeaponGesture: null },
              { time: 15 },
            ),
          });
          drawCar(equipped, 0, 0, { carId, roofClosed, crewVisuals: visual });
          const driver = (ctx) =>
            ctx.draws.filter((draw) => draw[0].includes('arisu-cabin'));
          assert.deepEqual(driver(equipped), driver(baseline));
        }
      const stillA = context(),
        stillB = context();
      drawCharacter(stillA, {
        character: 'chana',
        ...resolveCrewVisuals(
          { crewWeaponGesture: { weapon, elapsed: 0.1, duration: 0.72 } },
          { time: 1, reducedMotion: true },
        ),
      });
      drawCharacter(stillB, {
        character: 'chana',
        ...resolveCrewVisuals(
          { crewWeaponGesture: { weapon, elapsed: 0.6, duration: 0.72 } },
          { time: 20, reducedMotion: true },
        ),
      });
      assert.deepEqual(stillA.draws, stillB.draws);
    }
    assert.equal(cells.size, 6);
  } finally {
    globalThis.Image = original;
  }
});
