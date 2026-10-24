import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  CLUB_ART,
  getClubArt,
  getClubImage,
  preloadClubArt,
} from '../public/game-test/src/club-art.js';
import {
  drawFinale,
  drawMap,
  preloadCampaign,
  finaleCrowdCount,
} from '../public/game-test/src/campaign.js';
import { getJourneyStage } from '../public/game-test/src/journey.js';

class LocalImage {
  set src(url) {
    this.url = url;
    const png = readFileSync(new URL(url));
    this.width = this.naturalWidth = png.readUInt32BE(16);
    this.height = this.naturalHeight = png.readUInt32BE(20);
    queueMicrotask(() => this.onload?.());
  }
}
function context() {
  return new Proxy(
    {
      draws: [],
      rects: [],
      drawImage(image, ...args) {
        this.draws.push([image.url, ...args]);
      },
      fillRect(...args) {
        this.rects.push(args);
      },
      measureText(text) {
        return { width: String(text).length * 8 };
      },
    },
    { get: (object, key) => (key in object ? object[key] : () => {}) },
  );
}

test('every city has unique opaque art and both roads point to the same local club', () => {
  const hashes = new Set();
  assert.equal(CLUB_ART.length, 6);
  for (const venue of CLUB_ART) {
    const png = readFileSync(new URL(venue.src));
    assert.equal(png.readUInt32BE(16), 1672);
    assert.equal(png.readUInt32BE(20), 941);
    assert.equal(png[25], 2, 'club art is opaque RGB');
    hashes.add(createHash('sha256').update(png).digest('hex'));
  }
  assert.equal(hashes.size, 6);
  for (let road = 0; road < 12; road++) {
    const stage = getJourneyStage(road);
    assert.equal(getClubArt(stage.club), CLUB_ART[Math.floor(road / 2)]);
  }
  assert.equal(getClubArt('unknown'), null);
  assert.equal(getClubImage('unknown'), null);
});

test('all twelve map destinations and all six sets draw the correct venue without moving the DJs', async () => {
  const original = globalThis.Image;
  globalThis.Image = LocalImage;
  try {
    await preloadCampaign();
    let reference;
    for (let road = 0; road < 12; road++) {
      const stage = getJourneyStage(road),
        venue = getClubArt(stage.club);
      const map = context();
      drawMap(map, { stageIndex: road });
      assert.ok(map.draws.some((draw) => draw[0] === venue.src));
      for (const fans of [0, 1, 12, 200]) {
        const ctx = context();
        drawFinale(ctx, { club: stage.club, totalFans: fans, time: 2 });
        assert.equal(ctx.draws[0][0], venue.src);
        const characters = ctx.draws.filter((draw) =>
          /duo-dj-console|characters/.test(draw[0]),
        );
        assert.ok(characters.length);
        reference ||= characters;
        assert.deepEqual(characters, reference);
        assert.equal(finaleCrowdCount(fans), Math.min(56, fans));
      }
      const stillA = context(),
        stillB = context();
      drawFinale(stillA, {
        club: stage.club,
        time: 1,
        reducedMotion: true,
        totalFans: 12,
      });
      drawFinale(stillB, {
        club: stage.club,
        time: 20,
        reducedMotion: true,
        totalFans: 12,
      });
      assert.deepEqual(stillA.draws, stillB.draws);
      assert.deepEqual(stillA.rects, stillB.rects);
    }
    await assert.rejects(preloadClubArt(['unknown']), /Unknown club/);
  } finally {
    globalThis.Image = original;
  }
});

test('venue loading is selective, shares in-flight work, and retries only failures', async () => {
  const module = await import(
    '../public/game-test/src/club-art.js?isolated-retry'
  );
  const original = globalThis.Image,
    requests = [];
  let fail = true;
  globalThis.Image = class {
    naturalWidth = 1672;
    naturalHeight = 941;
    set src(url) {
      requests.push(url);
      queueMicrotask(() =>
        fail && url.endsWith('kyoto.png') ? this.onerror?.() : this.onload?.(),
      );
    }
  };
  try {
    await Promise.all([
      module.preloadClubArt(['nakano']),
      module.preloadClubArt(['nakano']),
    ]);
    assert.equal(requests.length, 1);
    await assert.rejects(module.preloadClubArt(['kyoto']), /Could not load/);
    fail = false;
    await module.preloadClubArt(['nakano', 'kyoto']);
    assert.equal(requests.length, 3);
    assert.ok(module.getClubImage('kyoto'));
    assert.equal(module.getClubImage('shibuya'), null);
  } finally {
    globalThis.Image = original;
  }
});
