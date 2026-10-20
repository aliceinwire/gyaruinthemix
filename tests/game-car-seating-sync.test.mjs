import {
  drawCabinCharacter,
  preloadCabinCharacters,
} from '../public/game-test/src/cabin-characters.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAR_ART, getCarArtLayout } from '../public/game-test/src/car-art.js';
import {
  getCrewSeatLayout,
  drawCar,
} from '../public/game-test/src/renderer.js';
import {
  resolveCrewVisuals,
  preloadCharacterActions,
  drawCharacter,
} from '../public/game-test/src/character-actions.js';

class LocalImage {
  set src(url) {
    this.url = url;
    const png = readFileSync(new URL(url));
    this.width = this.naturalWidth = png.readUInt32BE(16);
    this.height = this.naturalHeight = png.readUInt32BE(20);
    queueMicrotask(() => this.onload?.());
  }
}
globalThis.Image = LocalImage;
await preloadCharacterActions();
await preloadCabinCharacters();
function context() {
  const draws = [];
  const clips = [],
    rectangles = [];
  return new Proxy(
    {
      draws,
      clips,
      rectangles,
      globalAlpha: 1,
      rect(...args) {
        rectangles.push(args);
      },
      clip(rule) {
        clips.push(rule);
      },
      drawImage(image, ...args) {
        draws.push([image.url, ...args]);
      },
    },
    {
      get(target, key) {
        return key in target ? target[key] : () => {};
      },
    },
  );
}

test('all cars place the passenger behind the driver in the same front row', () => {
  for (const carId of Object.keys(CAR_ART)) {
    const layout = getCarArtLayout({ carId });
    const [passenger, driver] = getCrewSeatLayout(layout);
    assert.equal(passenger.character, 'chana');
    assert.equal(driver.character, 'arisu');
    assert.equal(passenger.cabin, layout.cabins.at(-1));
    assert.equal(driver.cabin, passenger.cabin);
    assert.ok(
      Math.abs(
        passenger.x + passenger.width / 2 - (driver.x + driver.width / 2),
      ) <
        driver.width * 0.2,
    );
    assert.ok(
      passenger.x + passenger.width > driver.x + driver.width * 0.5,
      carId + ' depth overlap',
    );
    assert.ok(
      Math.abs(passenger.y + passenger.height - driver.y - driver.height) <=
        5.01,
    );
  }
});

test('portrait and cabin share exact action phases with perspective-specific art', () => {
  const states = [
    {},
    { boosting: true },
    { shooting: true },
    { charging: true },
    { invulnerability: 1 },
    { weather: 'mud' },
    { rushing: true, rushTime: 1.2, rushGestureTime: 0.4 },
  ];
  for (const state of states)
    for (const time of [0, 0.18, 0.4, 0.8, 1.3, 4.5, 10]) {
      const crewVisuals = resolveCrewVisuals(state, { time });
      assert.ok(Object.isFrozen(crewVisuals));
      const car = context();
      drawCar(car, 0, 0, { time, crewVisuals });
      for (const character of ['arisu', 'chana']) {
        const portrait = context(),
          cabin = context();
        const frontPose = drawCharacter(portrait, {
          ...crewVisuals,
          character,
          width: 128,
          height: 128,
        });
        const sidePose = drawCabinCharacter(cabin, {
          ...crewVisuals,
          character,
          width: 37,
          height: 37,
        });
        assert.deepEqual(sidePose, frontPose, `${character} at ${time}`);
        assert.notEqual(
          cabin.draws[0][0],
          portrait.draws[0][0],
          'dedicated perspective art',
        );
        assert.ok(
          car.draws.some((row) => row[0] === cabin.draws[0][0]),
          'car uses profile art',
        );
      }
    }
});

test('reduced motion freezes the same keyframe in both views, including rush', () => {
  const visual = resolveCrewVisuals(
    { rushing: true, rushGestureTime: 0.1 },
    { time: 24, reducedMotion: true },
  );
  assert.equal(visual.time, 0);
  assert.equal(visual.animate, false);
  for (const character of ['arisu', 'chana'])
    assert.equal(
      drawCabinCharacter(context(), { ...visual, character }).animationFrame,
      0,
    );
});

test('main shares one visual snapshot without changing portrait geometry', () => {
  const main = readFileSync(
    new URL('../public/game-test/main.js', import.meta.url),
    'utf8',
  );
  assert.match(main, /const crewVisuals = resolveCrewVisuals\(state/);
  assert.match(main, /menu: screen === "menu",\s+crewVisuals,/);
  assert.match(
    main,
    /x: i \* 112,\s+y: 0,\s+width: 128,\s+height: 128,\s+\.\.\.crewVisuals,/,
  );
});

test('every rush phase and return-to-driving transition are shared exactly', () => {
  for (const remaining of [0.75, 0.56, 0.37, 0.18, 0]) {
    const visual = resolveCrewVisuals(
      { rushGestureTime: remaining },
      { time: 3 },
    );
    for (const character of ['arisu', 'chana']) {
      const front = drawCharacter(context(), { ...visual, character });
      const side = drawCabinCharacter(context(), { ...visual, character });
      assert.deepEqual(side, front);
      assert.equal(front.action === 'rush', remaining > 0);
    }
  }
});

test('kiss hearts appear only during the shared release phases', () => {
  for (const [time, column] of [
    [0, 0],
    [0.17, 0],
    [0.34, 3],
    [0.67, 2],
  ]) {
    const canvas = context();
    drawCabinCharacter(canvas, { character: 'chana', shooting: true, time });
    assert.equal(canvas.draws[0][1], column * 314);
  }
});

test('rush isolates only the preceding driver wheel shaft without moving the frame', () => {
  for (const character of ['arisu', 'chana']) {
    for (const [frame, remaining] of [
      [0, 0.75],
      [1, 0.5],
      [2, 0.25],
      [3, 0.1],
    ]) {
      const canvas = context();
      const pose = drawCabinCharacter(canvas, {
        character,
        rushGestureTime: remaining,
        x: 7,
        y: 11,
        width: 560,
        height: 455,
      });
      assert.equal(pose.animationFrame, frame);
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = canvas.draws[0];
      assert.equal(sx, frame * 443);
      assert.equal(sw, 443);
      assert.equal(dx, 7);
      assert.equal(dw, 443);
      if (character === 'arisu' && frame > 0) {
        assert.deepEqual(canvas.clips, ['evenodd']);
        assert.deepEqual(canvas.rectangles, [
          [dx, dy, dw, dh],
          [dx, dy + 354, 31, 40],
        ]);
      } else {
        assert.deepEqual(canvas.clips, []);
      }
      assert.equal(sy, character === 'arisu' ? 0 : 446);
      assert.equal(sh, character === 'arisu' ? 438 : 441);
    }
  }
});
