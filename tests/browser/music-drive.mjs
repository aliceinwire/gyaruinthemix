import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createState, exportNightfallSave } from '../../public/game/src/simulation.js';
import { SURVIVAL_UPGRADES } from '../../public/game/src/survival.js';
import { NIGHTFALL_SAVE_KEY } from '../../public/game/src/save-store.js';
import { SETTINGS_KEY } from '../../public/game/src/tour-settings.js';

/** Uses the same native-HLS radio fixture as the club set, including real media events. */
export async function checkMusicDrive(page, root) {
  const state = createState({ mode: 'survival', survivalDay: '2026-10-24', routeIndex: 5, campaignStarted: true });
  // A completed build avoids unrelated level-up dialogs during radio checks.
  state.survival.upgrades = Object.fromEntries(SURVIVAL_UPGRADES.map(item => [item.id, item.maxLevel]));
  state.survival.level = Object.values(state.survival.upgrades).reduce((sum, value) => sum + value, -1);
  await page.evaluate(({ save, key, settings }) => {
    localStorage.setItem(key, JSON.stringify(save));
    localStorage.setItem(settings, JSON.stringify({ musicDrive: false, reducedMotion: false }));
  }, { save: exportNightfallSave(state), key: NIGHTFALL_SAVE_KEY, settings: SETTINGS_KEY });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 667 });
  await page.reload();
  await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
  assert.equal(await page.locator('#menu-music-drive').isChecked(), false);
  await page.locator('#menu-music-drive').check();
  assert.match(await page.locator('#survival-record').textContent(), /Music Drive/);
  assert.doesNotMatch(await page.locator('#survival-record').textContent(), /Earlier rules/);
  await page.locator('#menu-assist-mode').check();
  assert.match(await page.locator('#survival-record').textContent(), /Assisted/);
  await page.locator('#menu-assist-mode').uncheck();
  await page.locator('#resume-tour').click();
  await page.waitForFunction(() => __HYPERDRIVE__.snapshot().screen === 'map');
  await page.locator('#depart').click();
  for (let line = 0; line < 60; line++) {
    if (await page.evaluate(() => __HYPERDRIVE__.snapshot().screen !== 'story')) break;
    const choices = page.locator('#story-choices button');
    if (await choices.count()) await choices.first().click();
    else await page.locator('#story-next').click();
  }
  await page.waitForFunction(() => __HYPERDRIVE__.snapshot().screen === 'playing');
  assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.musicDrive.multiplier), 1);
  await page.locator('[data-action="play"]').click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await page.locator('audio').evaluate(media => { media.currentTime = 53; });
  await page.waitForFunction(() => __HYPERDRIVE__.snapshot().state.musicDrive.multiplier > 1.015);
  assert.equal(await page.locator('.stereo-equalizer').getAttribute('data-active'), 'true');
  assert.equal(await page.locator('audio').count(), 1);
  assert.equal(await page.locator('audio').evaluate(media => media.playbackRate), 1);
  await page.locator('#pause').click();
  const distance = await page.evaluate(() => __HYPERDRIVE__.snapshot().state.distance);
  await page.locator('audio').evaluate(media => { media.currentTime = 91; });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.distance), distance);
  for (const [width, height] of [[390, 667], [320, 740], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#music-drive').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/music-drive-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
    assert.equal(await page.locator('#music-drive').isChecked(), true);
    await page.locator('#resume').click();
    await page.locator('#pause').click();
  }
  await page.locator('#reduced-motion').check();
  await page.locator('#resume').click();
  await page.waitForFunction(() => __HYPERDRIVE__.snapshot().state.musicDrive.active);
  assert.equal(await page.locator('.stereo-equalizer').getAttribute('data-active'), 'false');
  assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.musicDrive.dropSection), -1, 'game pause cannot award a skipped drop');
  await page.locator('[data-action="mute"]').click();
  await page.waitForFunction(() => !__HYPERDRIVE__.snapshot().state.musicDrive.active);
  await page.waitForFunction(() => Math.abs(__HYPERDRIVE__.snapshot().state.musicDrive.multiplier - 1) < .0005);
  await page.locator('[data-action="mute"]').click();
  await page.waitForFunction(() => __HYPERDRIVE__.snapshot().state.musicDrive.active);
  await page.locator('[data-action="next"]').click();
  await page.waitForFunction(() => !__HYPERDRIVE__.snapshot().state.musicDrive.active);
  await page.locator('#pause').click();
  await page.locator('#music-drive').uncheck();
  assert.match(await page.locator('#music-drive-note').textContent(), /stays in Music Drive/);
  assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.survival.musicDriven), true);
  assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.musicDriveEnabled), false);
  await page.locator('#reduced-motion').uncheck();
  await page.locator('#resume').click();
  await page.waitForFunction(() => Math.abs(__HYPERDRIVE__.snapshot().state.musicDrive.multiplier - 1) < .0005);
  assert.equal(await page.locator('.stereo-equalizer').getAttribute('data-active'), 'true');
  assert.equal(await page.locator('audio').count(), 1);
  console.log('PASS optional Music Drive follows real radio playback, preserves reduced-motion settings and keeps its record category');
}
