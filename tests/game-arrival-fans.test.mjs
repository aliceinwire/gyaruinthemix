import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getArrivalSupporters,
  ARRIVAL_FAN_LIMIT,
} from '../public/game-test/src/arrival-fans.js';
const state = {
  routeIndex: 11,
  routeLength: 1000,
  distance: 900,
  totalFans: 30,
};
test('supporters are earned, final-road arrival decoration only', () => {
  for (const patch of [
    { totalFans: 0 },
    { totalFans: -1 },
    { totalFans: NaN },
    { routeIndex: 10 },
    { distance: 500 },
    { routeLength: 0 },
  ])
    assert.equal(getArrivalSupporters({ ...state, ...patch }).length, 0);
  assert.ok(getArrivalSupporters(state).length > 0);
});
test('large earned audience is bounded and deterministic', () => {
  const fans = getArrivalSupporters({
    ...state,
    distance: 780,
    totalFans: 100000,
  });
  assert.ok(fans.length <= ARRIVAL_FAN_LIMIT);
  assert.deepEqual(
    fans,
    getArrivalSupporters({ ...state, distance: 780, totalFans: 100000 }),
  );
  assert.equal(
    fans.reduce((n, f) => n + f.representedFans, 0),
    100000,
  );
});
test('supporters are world anchored and remain on the sidewalk', () => {
  const before = getArrivalSupporters(state),
    after = getArrivalSupporters({ ...state, distance: 910 });
  for (const fan of after) {
    const old = before.find((f) => f.id === fan.id);
    if (old) assert.equal(old.x - fan.x, 30);
    assert.ok(fan.y >= 340 && fan.y <= 344);
  }
});
test('one earned fan does not imply an invented crowd', () => {
  assert.equal(getArrivalSupporters({ ...state, totalFans: 1 }).length, 1);
});

test('optional connected console art cannot block starting the game', async () => {
  const OriginalImage = globalThis.Image;
  globalThis.Image = class {
    set src(value) {
      if (!value) return;
      queueMicrotask(() => {
        if (value.includes('duo-dj-console')) this.onerror?.();
        else this.onload?.();
      });
    }
  };
  try {
    const { preloadCampaign } = await import(
      '../public/game-test/src/campaign.js?optional-console'
    );
    const loaded = await preloadCampaign();
    assert.equal(loaded.length, 6);
    assert.equal(loaded[5], null);
    assert.ok(loaded.slice(0, 5).every(Boolean));
  } finally {
    globalThis.Image = OriginalImage;
  }
});
