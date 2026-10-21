import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasItemIcon,
  itemIconRects,
} from '../public/game-test/src/item-icons.js';
import {
  streetCharacterIdentity,
  resolveStreetPose,
} from '../public/game-test/src/street-characters.js';
import {
  finaleCrowdCount,
  drawFinale,
} from '../public/game-test/src/campaign.js';
import {
  createRoadFeedback,
  captureRoadFeedback,
  drawRoadFeedback,
  updateRoadFeedback,
} from '../public/game-test/src/road-feedback.js';

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

test('supporters retain their clothes, weather gear and individual identity', () => {
  const supporter = {
    type: 'gyaru',
    originalType: 'salaryman',
    converted: true,
  };
  assert.equal(streetCharacterIdentity(supporter), 'salaryman');
  assert.equal(resolveStreetPose({ ...supporter, weather: 'rain' }), 'rain');
  assert.equal(resolveStreetPose({ ...supporter, season: 'winter' }), 'winter');
  assert.equal(resolveStreetPose({ type: 'gyaru' }), 'gyaru');
  assert.equal(resolveStreetPose({ type: 'converted' }), 'salaryman');
  assert.equal(
    resolveStreetPose({ type: 'converted', originalType: 'fan' }),
    'fan',
  );
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
