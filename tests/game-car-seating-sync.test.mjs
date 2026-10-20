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
function context() {
  const draws = [];
  return new Proxy(
    {
      draws,
      globalAlpha: 1,
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
    assert.ok(passenger.x < driver.x);
    assert.ok(
      passenger.x + passenger.width > driver.x + driver.width * 0.5,
      carId + ' depth overlap',
    );
    assert.ok(
      Math.abs(passenger.y + passenger.height - driver.y - driver.height) <=
        2.01,
    );
  }
});

test('portrait and car consume identical source poses for every event and frame', () => {
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
        const portrait = context();
        drawCharacter(portrait, {
          ...crewVisuals,
          character,
          width: 128,
          height: 128,
        });
        const source = portrait.draws[0].slice(0, 5);
        assert.deepEqual(
          car.draws.find((row) => row[0] === source[0]).slice(0, 5),
          source,
          `${character} at ${time}`,
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
      drawCharacter(context(), { ...visual, character }).animationFrame,
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
