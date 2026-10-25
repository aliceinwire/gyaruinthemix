import test from 'node:test';
import assert from 'node:assert/strict';
import { hasItemIcon, itemIconRects } from '../public/game/src/item-icons.js';
import {
  streetCharacterIdentity,
  resolveStreetPose,
  streetCharacterBob,
  drawStreetCharacter,
  preloadStreetCharacters,
  STREET_CHARACTER_SHEET,
} from '../public/game/src/street-characters.js';
import { createState, update } from '../public/game/src/simulation.js';
import {
  finaleCrowdCount,
  drawFinale,
  drawFinaleStage,
} from '../public/game/src/campaign.js';
import {
  createRoadFeedback,
  captureRoadFeedback,
  drawRoadFeedback,
  updateRoadFeedback,
} from '../public/game/src/road-feedback.js';

function canvas() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (target, key) =>
        key in target ? target[key] : (...args) => calls.push([key, ...args]),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    },
  );
  return { ctx, calls };
}

test('phone, MD and hotline use distinct bounded pixel art', () => {
  const gadgets = ['phone', 'md', 'hotline'];
  for (const id of gadgets) {
    assert.equal(hasItemIcon(id), true);
    for (const pixel of itemIconRects(id)) {
      assert.ok(
        pixel.x >= 0 &&
          pixel.y >= 0 &&
          pixel.x + pixel.width <= 32 &&
          pixel.y + pixel.height <= 32,
      );
      assert.match(pixel.color, /^#[0-9a-f]{6}$/i);
    }
  }
  assert.equal(
    new Set(gadgets.map((id) => JSON.stringify(itemIconRects(id)))).size,
    3,
  );
});

test('defeated suits become gyaru in every climate while existing fans keep their identity', () => {
  const supporter = {
    type: 'gyaru',
    originalType: 'salaryman',
    converted: true,
  };
  assert.equal(streetCharacterIdentity(supporter), 'gyaru');
  for (const weather of ['sunny', 'rain', 'storm', 'snow', 'mud'])
    for (const season of ['summer', 'winter'])
      assert.equal(
        resolveStreetPose({ ...supporter, weather, season }),
        'gyaru',
      );
  assert.equal(resolveStreetPose({ type: 'gyaru' }), 'gyaru');
  assert.equal(resolveStreetPose({ type: 'converted' }), 'gyaru');
  assert.equal(
    resolveStreetPose({ type: 'salaryman', converted: true }),
    'gyaru',
  );
  assert.equal(
    resolveStreetPose({ type: 'converted', originalType: 'fan' }),
    'fan',
  );
  assert.equal(
    resolveStreetPose({ type: 'salaryman', weather: 'rain' }),
    'rain',
  );
  assert.equal(
    resolveStreetPose({ type: 'salaryman', season: 'winter' }),
    'winter',
  );
});

test('a weapon defeat changes the visible outfit and only rewards conversion once', () => {
  const state = createState();
  state._stations = [];
  state._nextEncounter = 1e9;
  state._quizTriggered = true;
  const actor = { id: 900, type: 'salaryman', distance: 100, hp: 1 };
  state.entities = [actor];
  assert.equal(streetCharacterIdentity(actor), 'salaryman');
  update(state, { shoot: true }, 1);
  assert.equal(actor.converted, true);
  assert.equal(actor.originalType, 'salaryman');
  assert.equal(streetCharacterIdentity(actor), 'gyaru');
  assert.equal(resolveStreetPose({ ...actor, weather: 'storm' }), 'gyaru');
  assert.equal(state.gyaruConverted, 1);
  const money = state.money;
  update(state, { shoot: true }, 2);
  assert.equal(state.gyaruConverted, 1);
  assert.equal(state.money, money);
});

test('converted NPC rendering selects the full gyaru sprite and gyaru animation', async () => {
  const previousImage = globalThis.Image;
  globalThis.Image = class {
    naturalWidth = STREET_CHARACTER_SHEET.width;
    naturalHeight = STREET_CHARACTER_SHEET.height;
    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  };
  try {
    assert.equal(await preloadStreetCharacters(), true);
    for (const weather of ['sunny', 'rain', 'snow', 'mud']) {
      const options = {
        type: 'salaryman',
        originalType: 'salaryman',
        converted: true,
        id: 'former-suit',
        weather,
        season: 'winter',
        x: 500,
        y: 465,
        time: 3,
      };
      const { ctx, calls } = canvas();
      assert.equal(drawStreetCharacter(ctx, options), true);
      const draw = calls.find(([method]) => method === 'drawImage');
      const frame = STREET_CHARACTER_SHEET.poses.gyaru;
      assert.deepEqual(draw.slice(2, 6), frame.crop);
      assert.equal(draw[9], frame.height);
      assert.equal(
        draw[7],
        465 - frame.height + streetCharacterBob({ ...options, type: 'gyaru' }),
      );
    }
  } finally {
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  }
});

test('finale never invents fans or duplicates the earned audience', () => {
  for (const count of [0, 1, 2, 7, 55, 56, 200])
    assert.equal(finaleCrowdCount(count), Math.min(count, 56));
  for (const count of [-5, NaN, Infinity, undefined])
    assert.equal(finaleCrowdCount(count), 0);
  assert.equal(finaleCrowdCount(3.9), 3);
});

test('phone feedback links actual targets and preserves MD repeat identity', () => {
  const feedback = createRoadFeedback();
  captureRoadFeedback(feedback, [
    {
      type: 'survival-attack',
      kind: 'phone',
      distance: 100,
      targetDistances: [110, 125, NaN],
      repeat: true,
    },
  ]);
  assert.equal(feedback.effects[0].label, 'LINK');
  assert.equal(feedback.effects[0].kind, 'phone');
  assert.equal(feedback.effects[0].repeat, true);
  assert.deepEqual(feedback.effects[0].targets, [110, 125]);
  for (const reducedMotion of [false, true]) {
    const { ctx, calls } = canvas();
    drawRoadFeedback(ctx, feedback, { distance: 100 }, { reducedMotion });
    const links = calls.filter((call) => call[0] === 'strokeRect');
    assert.deepEqual(links, [
      ['strokeRect', 215, 403, 10, 10],
      ['strokeRect', 260, 403, 10, 10],
    ]);
    assert.equal(
      calls.some((call) => call[0] === 'ellipse'),
      false,
    );
    assert.ok(calls.some((call) => call[0] === 'fillRect'));
  }
  updateRoadFeedback(feedback, 1);
  assert.equal(feedback.effects.length, 0);
});

test('signal feedback bounds malicious or stale event coordinates and queue size', () => {
  const feedback = createRoadFeedback();
  captureRoadFeedback(
    feedback,
    Array.from({ length: 80 }, () => ({
      type: 'survival-attack',
      kind: 'phone',
      targetDistances: [NaN, Infinity, -2000, 9000],
      distance: 0,
    })),
  );
  assert.equal(feedback.effects.length, 36);
  const { ctx, calls } = canvas();
  drawRoadFeedback(ctx, feedback, { distance: 0 });
  assert.equal(
    calls.some((call) => call[0] === 'strokeRect'),
    false,
  );
});

test('rendered finale attendance ignores energy and conversion double counts', () => {
  for (const totalFans of [0, 1, 7, 200]) {
    const { ctx, calls } = canvas();
    drawFinale(ctx, {
      totalFans,
      converted: 200,
      performance: { energy: 1 },
      time: 3,
    });
    const heads = calls.filter(
      (call) => call[0] === 'ellipse' && call[3] === 10 && call[4] === 12,
    );
    assert.equal(heads.length, Math.min(totalFans, 56));
    for (const call of heads) assert.ok(call.slice(1).every(Number.isFinite));
  }
});

test('stage artwork excludes its baked audience before earned fans are drawn', () => {
  const { ctx, calls } = canvas();
  const stage = { naturalWidth: 960, naturalHeight: 540 };
  drawFinaleStage(ctx, stage);
  assert.deepEqual(
    calls.find((call) => call[0] === 'drawImage'),
    ['drawImage', stage, 0, 0, 960, 432, 0, 0, 960, 432],
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === 'fillRect' &&
        call[1] === 0 &&
        call[2] === 432 &&
        call[3] === 960 &&
        call[4] === 108,
    ),
  );
  assert.equal(
    calls.some((call) => call[0] === 'ellipse'),
    false,
  );
});
