import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAR_ART,
  getCarArtLayout,
  getCarRoofLayout,
  preloadCarArt,
} from '../public/game-test/src/car-art.js';
import { preloadCabinCharacters } from '../public/game-test/src/cabin-characters.js';
import {
  drawCar,
  getCrewSeatLayout,
  heartVisualPosition,
} from '../public/game-test/src/renderer.js';

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
await Promise.all([preloadCarArt(), preloadCabinCharacters()]);

function context() {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [],
    draws = [],
    clips = [];
  const transform = (a, b, c, d, e, f) => {
    const [m, n, p, q, x, y] = matrix;
    matrix = [
      m * a + p * b,
      n * a + q * b,
      m * c + p * d,
      n * c + q * d,
      m * e + p * f + x,
      n * e + q * f + y,
    ];
  };
  return new Proxy(
    {
      draws,
      clips,
      globalAlpha: 1,
      save() {
        stack.push([...matrix]);
      },
      restore() {
        matrix = stack.pop();
      },
      translate(x, y) {
        transform(1, 0, 0, 1, x, y);
      },
      scale(x, y) {
        transform(x, 0, 0, y, 0, 0);
      },
      rotate(r) {
        transform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0);
      },
      transform,
      clip() {
        clips.push([...matrix]);
      },
      drawImage(image, ...args) {
        draws.push({ url: image.url, args, matrix: [...matrix] });
      },
    },
    {
      get(target, key) {
        return key in target ? target[key] : () => {};
      },
    },
  );
}

const windshields = {
  // Measured top corners on the original, unmodified 600px body PNGs.
  'mix-175': { x: 334, y: 2 },
  'rocket-gal': { x: 326, y: 8 },
};

test('each hardtop meets its original windshield without raising the car silhouette', () => {
  for (const [carId, corner] of Object.entries(windshields)) {
    for (const options of [
      { width: 600 },
      { width: 194, x: 85, y: 250 },
      { width: 400, height: 110, x: -30, y: 100 },
    ]) {
      const body = getCarArtLayout({ carId, ...options }),
        roof = getCarRoofLayout({ carId, ...options });
      const header = {
        x: body.body.x + corner.x * body.scaleX,
        y: body.body.y + corner.y * body.scaleY,
      };
      assert.deepEqual(roof.windshield.top, header);
      assert.ok(
        header.x >= roof.cap.x && header.x <= roof.cap.x + roof.cap.width,
        carId + ' cap reaches windshield',
      );
      assert.ok(
        header.y >= roof.cap.y && header.y <= roof.cap.y + roof.cap.height,
        carId + ' cap meets existing header height',
      );
      assert.ok(
        header.y - roof.cap.y <= 18 * body.scaleY,
        carId + ' no raised replacement canopy',
      );
      assert.ok(
        roof.cap.x + roof.cap.width - header.x <= 8 * body.scaleX,
        carId + ' no extra front pillar',
      );
    }
  }
  for (const carId of Object.keys(CAR_ART).filter((id) => !windshields[id]))
    assert.equal(getCarRoofLayout({ carId }), null);
});

test('closing the roof preserves the body and its movement at every car scale', () => {
  for (const carId of Object.keys(windshields))
    for (const scale of [0.65, 1, 2.8])
      for (const jump of [0, 0.8]) {
        const open = context(),
          closed = context(),
          options = { carId, scale, jump, time: 0.7, speed: 28 };
        drawCar(open, 190, 465, options);
        drawCar(closed, 190, 465, {
          ...options,
          roofClosed: true,
          weather: 'rain',
        });
        const body = (g) =>
          g.draws.find((d) => d.url.endsWith('/' + carId + '.png'));
        assert.deepEqual(
          body(closed),
          body(open),
          'same body sprite, dimensions, paint and movement',
        );
        const cap = closed.draws.findLast((d) =>
          d.url.endsWith('/' + carId + '-roof.png'),
        );
        assert.ok(cap);
        for (const axis of [0, 3])
          assert.ok(
            Math.abs(
              cap.matrix[axis] -
                (body(closed).matrix[axis] * CAR_ART[carId].defaultWidth) / 600,
            ) < 1e-9,
          );
        assert.equal(
          closed.clips.length,
          2,
          'each occupant is clipped inside the fitted window',
        );
        assert.equal(
          open.clips.length,
          0,
          'open roof keeps the existing crew presentation',
        );
        assert.equal(
          open.draws.some((d) => d.url.endsWith('-roof.png')),
          false,
        );
      }
});

test('closed-roof crew keeps both DJs in the front row and below the cap', () => {
  for (const carId of Object.keys(windshields)) {
    const layout = getCarArtLayout({ carId }),
      roof = getCarRoofLayout({ carId });
    const wet = getCrewSeatLayout(layout, { roofClosed: true, roof }),
      dry = getCrewSeatLayout(layout);
    assert.deepEqual(
      wet.map((p) => p.character),
      ['chana', 'arisu'],
    );
    for (const [i, seat] of wet.entries()) {
      assert.ok(
        seat.width < dry[i].width,
        'occupants fit the real cabin instead of raising its roof',
      );
      // Cabin artwork is fitted to 314x238, with feet anchored at the seat bottom.
      assert.ok(
        seat.y + seat.height - (seat.width * 238) / 314 >=
          Math.min(...roof.window.map((p) => p.y)),
      );
      assert.equal(seat.cabin, roof.cabin);
    }
    assert.ok(
      Math.abs(wet[0].x + wet[0].width / 2 - wet[1].x - wet[1].width / 2) <
        wet[1].width * 0.2,
    );
  }
});

test('kiss hearts follow the fitted passenger when the roof is closed', () => {
  for (const carId of Object.keys(windshields)) {
    const state = {
      garage: { equipped: carId },
      roofClosed: true,
      jumpHeight: 0.5,
      windOffset: 3,
      distance: 100,
    };
    const options = { carId, x: 193, y: 469 - 0.5 * 95 };
    const layout = getCarArtLayout(options),
      roof = getCarRoofLayout(options);
    const passenger = getCrewSeatLayout(layout, { roofClosed: true, roof })[0];
    const heart = heartVisualPosition(state, {
      age: 0,
      distance: 100,
      height: 0.5,
    });
    assert.deepEqual(heart, {
      x: passenger.x + passenger.width * 0.75,
      y: passenger.y + passenger.height * 0.65,
    });
  }
});
