// Offline subpath/CSP integration with the persistent built-in radio.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  createState,
  update,
  exportCampaignSave,
  exportNightfallSave,
  UPGRADE_CATALOG,
  upgradePrice,
} from '../../public/game-test/src/simulation.js';
import {
  SAVE_KEY,
  NIGHTFALL_SAVE_KEY,
} from '../../public/game-test/src/save-store.js';
import {
  survivalOffers,
  survivalXpCost,
} from '../../public/game-test/src/survival.js';
import {
  getRpgView,
  normalizeRpg,
} from '../../public/game-test/src/tour-rpg.js';
import { SETTINGS_KEY } from '../../public/game-test/src/tour-settings.js';
import { LANGUAGES } from '../../public/game-test/src/i18n.js';
import { STORY_SAVE_KEY } from '../../public/game-test/src/tour-director.js';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://game-test.local';
const headers = await readFile(
  resolve(root, 'deploy/game-security-headers.conf'),
  'utf8',
);
const csp = headers.match(/Content-Security-Policy "([^"]+)"/)[1];
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
async function checkLanguages(page, picker, selectors) {
  const before = await page.evaluate(() =>
    JSON.stringify(__HYPERDRIVE__.snapshot()),
  );
  const audio = await page.locator('#music audio').elementHandle();
  for (const { code } of LANGUAGES) {
    await page.locator(picker).selectOption(code);
    await page.waitForFunction(
      (code) => document.documentElement.lang === code,
      code,
    );
    if (await page.locator('#menu').isVisible()) {
      const catalog = JSON.parse(
        await readFile(
          resolve(root, `public/game-test/locales/${code}.json`),
          'utf8',
        ),
      );
      assert.equal(
        await page.locator('#menu h1').textContent(),
        catalog.NIGHTFALL + catalog.TOUR,
      );
      assert.equal(
        await page.locator('#menu > .eyebrow').textContent(),
        catalog['A GYARUINTHEMIX ROAD ROGUELITE'],
      );
      assert.equal(
        await page.title(),
        catalog['ギャルインザミックス / NIGHTFALL TOUR'],
      );
    }
    await assertFrameFits(page, selectors);
    assert.equal(
      await page.evaluate(() => JSON.stringify(__HYPERDRIVE__.snapshot())),
      before,
      'Changing language must not advance, reroll, or reset the tour',
    );
    assert.equal(
      await audio.evaluate(
        (node) => node === document.querySelector('#music audio'),
      ),
      true,
      'The same audio element survives language changes',
    );
  }
  await page.locator(picker).selectOption('ja');
  await page.waitForFunction(() => document.documentElement.lang === 'ja');
  await audio.dispose();
}

async function finishStory(page) {
  // Use the same reading/choice controls as players, including remembered
  // scenes that return immediately without opening a panel.
  for (let line = 0; line < 60; line++) {
    if (
      (await page.evaluate(() => __HYPERDRIVE__.snapshot().screen)) !== 'story'
    )
      return;
    const choices = page.locator('#story-choices button');
    if (await choices.count()) await choices.first().click();
    else await page.locator('#story-next').click();
  }
  assert.fail('Story did not finish through its reading controls');
}
async function assertFrameFits(page, selectors) {
  const faults = await page.evaluate((selectors) => {
    const shell = document.querySelector('.shell').getBoundingClientRect();
    const radio = document.querySelector('.radio-dock').getBoundingClientRect();
    const faults = [];
    if (
      document.documentElement.scrollHeight > innerHeight + 1 ||
      document.documentElement.scrollWidth > innerWidth + 1
    )
      faults.push('page scroll');
    for (const selector of selectors) {
      const el = document.querySelector(selector),
        box = el.getBoundingClientRect();
      const bottom =
        selector === '.radio-dock' || el.closest('.modal')
          ? shell.bottom
          : radio.top;
      if (
        !box.width ||
        !box.height ||
        box.top < shell.top ||
        box.left < shell.left ||
        box.right > shell.right + 1 ||
        box.bottom > bottom + 1
      )
        faults.push({
          selector,
          lang: document.documentElement.lang,
          route: document.querySelector(
            '#destination-choices [aria-pressed="true"]',
          )?.textContent,
          viewport: [innerWidth, innerHeight],
          box: box.toJSON(),
          availableBottom: bottom,
        });
    }
    return faults;
  }, selectors);
  assert.deepEqual(
    faults,
    [],
    'All actions must fit inside the frame without overlapping the radio',
  );
}
async function assertNavigatorReadable(page) {
  await assertFrameFits(page, ['.crew', '#crew-actions', '.dialogue', '.controls', '.radio-dock']);
  const layout = await page.evaluate(() => {
    const portrait = document.querySelector('#crew-actions');
    const dialogue = document.querySelector('.dialogue');
    const text = document.querySelector('#dialogue');
    const crew = document.querySelector('.crew').getBoundingClientRect();
    const controls = document.querySelector('.controls').getBoundingClientRect();
    const image = portrait.getBoundingClientRect();
    const words = dialogue.getBoundingClientRect();
    const shortLandscape = innerWidth >= 540 && innerHeight <= 600;
    return {
      portraitWidth: image.width,
      requiredWidth: shortLandscape ? 96 : innerWidth <= 680 ? 112 : 144,
      sourceWidth: portrait.width,
      fontSize: parseFloat(getComputedStyle(text).fontSize),
      requiredFontSize: shortLandscape ? 12 : innerWidth <= 680 ? 13 : 14,
      textFits: text.scrollHeight <= text.clientHeight + 1 && text.scrollWidth <= text.clientWidth + 1,
      portraitsSeparate: image.right <= words.left + 1,
      contained: image.top >= crew.top - 1 && image.bottom <= crew.bottom + 1 && words.bottom <= crew.bottom + 1,
      controlsSeparate: Math.min(crew.right, controls.right) - Math.max(crew.left, controls.left) <= 1 || Math.min(crew.bottom, controls.bottom) - Math.max(crew.top, controls.top) <= 1,
    };
  });
  assert.ok(layout.portraitWidth >= layout.requiredWidth - 1, JSON.stringify(layout));
  assert.ok(layout.sourceWidth >= layout.portraitWidth, 'Portraits retain native pixel detail');
  assert.ok(layout.fontSize >= layout.requiredFontSize, JSON.stringify(layout));
  assert.ok(layout.textFits && layout.portraitsSeparate && layout.contained && layout.controlsSeparate, JSON.stringify(layout));
}
async function assertWorldUncovered(page) {
  const overlaps = await page.evaluate(() => {
    const world = document.querySelector('#game').getBoundingClientRect();
    return [
      '.topline',
      '#rpg-status',
      '#road-status',
      '.dashboard',
      '.crew',
      '.controls',
      '#toast',
      '#story-panel',
      '#draft-panel',
      '#pause-overlay',
    ].filter((selector) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      if (
        element.hidden ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      )
        return false;
      const box = element.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        Math.min(world.right, box.right) - Math.max(world.left, box.left) > 1 &&
        Math.min(world.bottom, box.bottom) - Math.max(world.top, box.top) > 1
      );
    });
  });
  if (overlaps.length) {
    await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/${page.viewportSize().width}-layout-overlap.png`), fullPage: true });
    console.log('Road layout bounds', await page.evaluate(() => Object.fromEntries(['.shell', '.workspace', '.cabinet', '.viewport', '#game', '.below-stage', '.crew', '.controls', '.radio-dock', '.topline', '.rpg-status', '.road-status', '.dashboard'].map(selector => {
      const el = document.querySelector(selector);
      return [selector, { box: el.getBoundingClientRect().toJSON(), rows: getComputedStyle(el).gridTemplateRows, height: getComputedStyle(el).height }];
    }))));
  }
  assert.deepEqual(
    overlaps,
    [],
    'Live UI must occupy its own space outside the road',
  );
}
async function loadCampaignFixture(page, save) {
  await page.evaluate(
    ({ key, nightfallKey, value }) => {
      localStorage.removeItem(nightfallKey);
      localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: SAVE_KEY,
      nightfallKey: NIGHTFALL_SAVE_KEY,
      value: save,
    },
  );
  await page.reload();
  await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
  await page.locator('#resume-tour').click();
  await finishStory(page);
}
async function departThroughStory(page) {
  await page.locator('#depart').click();
  // Departure can wait for route artwork before opening its remembered or new
  // conversation. Do not mistake that loading interval for a skipped story.
  await page.waitForFunction(() =>
    ['story', 'playing', 'draft'].includes(__HYPERDRIVE__.snapshot().screen),
  );
  await finishStory(page);
}
async function reloadWithoutCampaign(page) {
  // Independent audio fixtures must not inherit the workshop's unfinished tour
  // or the new tour created by the previous audio case. Keep garage progress.
  await page.evaluate(
    (keys) => keys.forEach((key) => localStorage.removeItem(key)),
    [SAVE_KEY, NIGHTFALL_SAVE_KEY],
  );
  await page.reload();
  await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
  assert.equal(await page.locator('#resume-tour').isVisible(), false);
  assert.equal(
    await page.evaluate(() => __HYPERDRIVE__.snapshot().screen),
    'menu',
  );
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
try {
  for (const [width, height] of [
    [320, 740],
    [390, 667],
    [768, 1000],
    [667, 375],
    [844, 390],
    [1440, 1000],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'ja-JP',
    });
    context.setDefaultTimeout(10000);
    const errors = [];
    let audioEnabled = false,
      audioConfigStatus = 200,
      languageBootDelay = 0;
    const audioRequests = [];
    const moduleRequests = [];
    await mkdir(resolve(root, 'artifacts/browser/game-test'), {
      recursive: true,
    });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('.mjs')) moduleRequests.push(url.pathname);
      if (languageBootDelay && url.pathname.startsWith('/game-test/locales/'))
        await new Promise((resolve) => setTimeout(resolve, languageBootDelay));
      if (url.pathname === '/game-audio/v1/config') {
        audioRequests.push(url.pathname);
        return route.fulfill({
          status: audioConfigStatus,
          contentType: 'application/json',
          body: JSON.stringify({ enabled: audioEnabled }),
          headers: { 'cache-control': 'no-store' },
        });
      }
      if (audioEnabled && url.pathname === '/game-audio/v1/catalog') {
        audioRequests.push(url.pathname);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ brand: 'ギャルインザミックス', tracks: [] }),
          headers: { 'cache-control': 'no-store' },
        });
      }
      const path = url.pathname.endsWith('/')
        ? url.pathname + 'index.html'
        : url.pathname;
      try {
        const body = await readFile(resolve(root, 'dist', path.slice(1)));
        await route.fulfill({
          status: 200,
          body,
          contentType: mime[extname(path)] || 'application/octet-stream',
          headers: {
            'content-security-policy': csp,
            'x-content-type-options': 'nosniff',
          },
        });
      } catch {
        errors.push(`Missing asset: ${path}`);
        await route.fulfill({ status: 404, body: 'Not found' });
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error('Game page error:', e.message);
    });
    await page.addInitScript(() => {
      // Stable incidental randomness; the daily run keeps its own seeded course.
      Math.random = () => 7.1 / 0x7fffffff;
      globalThis.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        globalThis.cspViolations.push(
          `${e.effectiveDirective}: ${e.blockedURI}`,
        ),
      );
    });
    await page.goto(origin + '/game-test/');
    await page.waitForFunction(
      () => globalThis.__HYPERDRIVE__?.snapshot().ready,
    );
    assert.equal(await page.locator('iframe#music').count(), 0);
    assert.equal(await page.locator('#music audio').count(), 1);
    assert.equal(
      await page
        .locator('#survival, [data-control=shoot], #auto-hearts')
        .count(),
      0,
    );
    assert.deepEqual(
      await page
        .locator('[data-control]')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.dataset.control),
        ),
      ['boost', 'charge', 'rush'],
    );
    await checkLanguages(page, '.settings select', [
      '#menu h1',
      '#menu > .eyebrow',
      '#story',
      '.language-picker',
      '.radio-dock',
    ]);
    await page.locator('#story').click();
    assert.equal(await page.locator('#story-panel').isVisible(), true);
    assert.equal(
      await page.locator('#story-panel').getAttribute('aria-modal'),
      'true',
    );
    assert.ok((await page.locator('#story-speaker').innerText()).length > 0);
    assert.ok((await page.locator('#story-text').innerText()).length > 0);
    await checkLanguages(page, '#story-panel select', [
      '#story-panel .modal-card',
    ]);
    const openingState = (await page.evaluate(() => __HYPERDRIVE__.snapshot()))
      .state;
    await page.waitForTimeout(150);
    assert.equal(
      (await page.evaluate(() => __HYPERDRIVE__.snapshot())).state.elapsed,
      openingState.elapsed,
      'Reading the opening must freeze simulation time',
    );
    await page.screenshot({
      path: resolve(root, `artifacts/browser/game-test/${width}-story.png`),
      fullPage: true,
    });
    await page.locator('#story-skip').click();
    assert.equal(await page.locator('#story-choices button').count(), 2);
    assert.equal(await page.locator('#story-next').isVisible(), false);
    await finishStory(page);
    const openingMemory = (await page.evaluate(() => __HYPERDRIVE__.snapshot()))
      .story;
    assert.equal(openingMemory.choices['tour:opening'], 'crew');
    assert.ok(openingMemory.seen.includes('tour:opening'));
    assert.equal(await page.locator('#car-select').isVisible(), true);
    const weapons = page.locator('#style-options button');
    assert.equal(await weapons.count(), 5);
    for (const id of ['heart', 'flash', 'vinyl', 'bass', 'phone', 'flash']) {
      const choice = page.locator(`#style-options [data-weapon="${id}"]`);
      assert.equal(await choice.locator('.item-icon').count(), 1);
      await choice.click();
      assert.equal(await choice.getAttribute('aria-pressed'), 'true');
      const selected = (await page.evaluate(() => __HYPERDRIVE__.snapshot()))
        .state;
      assert.equal(selected.mode, 'survival');
      assert.equal(selected.survival.startingWeapon, id);
      assert.deepEqual(selected.survival.upgrades, { [id]: 1 });
      assert.equal(await choice.locator(':scope > span:not(.item-heading)').isVisible(), true);
      await assertFrameFits(page, ['#style-options', '#cars-ready']);
    }
    await page.screenshot({
      path: resolve(
        root,
        `artifacts/browser/game-test/${width}-style-selection.png`,
      ),
      fullPage: true,
    });
    await checkLanguages(page, '.settings select', [
      '#cars-ready',
      '#style-options',
    ]);
    await assertFrameFits(page, ['#cars-ready']);
    await page.locator('#car-select .frame-tabs button').nth(2).click();
    await assertFrameFits(page, ['#customization-apply', '#cars-ready']);
    assert.ok((await page.locator('#custom-paint option').count()) > 1);
    assert.equal(await page.locator('#customization-apply').isDisabled(), true);
    await page.screenshot({
      path: resolve(
        root,
        `artifacts/browser/game-test/${width}-customization.png`,
      ),
      fullPage: true,
    });
    await page.locator('#cars-ready').click();
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => __HYPERDRIVE__.snapshot().screen),
      'map',
    );
    await page.locator('#change-starting-car').click();
    await page.locator('#cars-ready').click();
    const destinations = page.locator('.journey-map button');
    assert.equal(await destinations.count(), 3);
    for (const node of await destinations.all()) {
      const box = await node.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
      assert.ok(
        await node
          .locator('strong')
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 12),
      );
      await node.click();
      assert.equal(await node.getAttribute('aria-pressed'), 'true');
      await checkLanguages(page, '.settings select', [
        '.map-origin',
        '#destination-choices',
        '.map-goal',
        '#depart',
      ]);
      await assertFrameFits(page, [
        '.map-origin',
        '#destination-choices',
        '.map-goal',
        '#route-mission-preview',
        '#change-starting-car',
        '#depart',
      ]);
    }
    await destinations.first().focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await destinations.first().getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.ok((await destinations.count()) >= 2);
    const destinationId = await destinations
      .nth(1)
      .getAttribute('data-node-id');
    await destinations.nth(1).click();
    assert.equal(
      await page
        .locator('#destination-choices [aria-pressed=true]')
        .getAttribute('data-node-id'),
      destinationId,
    );
    await page.screenshot({
      path: resolve(root, `artifacts/browser/game-test/${width}-map.png`),
      fullPage: true,
    });
    await assertFrameFits(page, [
      '.map-origin',
      '#destination-choices',
      '.map-goal',
      '#depart',
    ]);
    await page.locator('#garage-tab').click();
    await assertFrameFits(page, ['#garage-done']);
    assert.equal(await page.locator('#garage-content').isVisible(), true);
    const shopState = await page.evaluate(() => __HYPERDRIVE__.snapshot().state);
    const eligibleUpgrades = UPGRADE_CATALOG.filter(item => upgradePrice(shopState, item.id) !== null);
    assert.equal(await page.locator('#shop button').count(), eligibleUpgrades.length);
    assert.equal(shopState.survival.upgrades.heart || 0, 0);
    assert.equal(eligibleUpgrades.some(item => ['hearts', 'heartReach'].includes(item.id)), false);
    await page.screenshot({
      path: resolve(root, `artifacts/browser/game-test/${width}-garage.png`),
      fullPage: true,
    });
    await page.locator('#garage-done').click();
    const selectedWeather = await page.evaluate(
      () => __HYPERDRIVE__.snapshot().state.weather,
    );
    assert.ok(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        NIGHTFALL_SAVE_KEY,
      ),
    );
    await page.locator('#depart').click();
    await page.locator('#story-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#story-panel').isVisible(), true);
    await finishStory(page);
    await page.waitForFunction(
      () => __HYPERDRIVE__.snapshot().screen === 'playing',
    );
    await page.waitForTimeout(1800);
    assert.equal(
      await page.evaluate(() => __HYPERDRIVE__.snapshot().state.weather),
      selectedWeather,
    );
    assert.ok(
      await page.evaluate(() => __HYPERDRIVE__.snapshot().state.distance > 0),
    );
    assert.equal(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        NIGHTFALL_SAVE_KEY,
      ),
      null,
      'Departure consumes the safe-stop checkpoint',
    );
    await page.keyboard.down('KeyZ');
    await page.keyboard.down('KeyJ');
    assert.equal(
      await page.evaluate(() => Boolean(__HYPERDRIVE__.snapshot().input.shoot)),
      false,
    );
    await page.keyboard.up('KeyZ');
    await page.keyboard.up('KeyJ');
    assert.equal(
      await page.evaluate(() =>
        Boolean(__HYPERDRIVE__.snapshot().state.survival.upgrades.heart),
      ),
      false,
      'A camera build does not silently equip hearts',
    );
    await assertWorldUncovered(page);
    await page.screenshot({
      path: resolve(
        root,
        `artifacts/browser/game-test/${width}-rain-driving.png`,
      ),
      fullPage: true,
    });
    await page.keyboard.press('KeyP');
    await page.locator('#resume').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await page
        .locator('#reduced-motion')
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#reduced-motion').isChecked(), true);
    await page.keyboard.press('Tab');
    assert.equal(
      await page
        .locator('#resume')
        .evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(await page.locator('#assist-mode').isDisabled(), true);
    const expectedSettings = {
      version: 1,
      autoHearts: false,
      assistMode: false,
      reducedMotion: true,
    };
    assert.deepEqual(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        SETTINGS_KEY,
      ),
      expectedSettings,
    );
    assert.deepEqual(
      (await page.evaluate(() => __HYPERDRIVE__.snapshot())).settings,
      expectedSettings,
    );
    assert.equal(
      await page.evaluate(() => document.body.dataset.reducedMotion),
      'true',
    );
    await page.screenshot({
      path: resolve(
        root,
        `artifacts/browser/game-test/${width}-pause-settings.png`,
      ),
      fullPage: true,
    });
    await page.locator('#resume').click();
    await page.locator('#run-journal').click();
    assert.equal(await page.locator('#story-panel').isVisible(), true);
    assert.match(await page.locator('#story-kicker').innerText(), /JOURNAL/);
    assert.equal(await page.locator('#story-skip').isVisible(), true);
    assert.equal(await page.locator('#story-skip').innerText(), '記録を閉じる');
    await page.locator('#story-skip').click();
    assert.equal(await page.locator('#pause-overlay').isVisible(), true);
    assert.equal(
      (await page.evaluate(() => __HYPERDRIVE__.snapshot())).paused,
      true,
    );
    await page.locator('#resume').click();
    await page.locator('#run-journal').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#story-panel').isVisible(), false);
    assert.equal(await page.locator('#pause-overlay').isVisible(), true);
    assert.equal(
      (await page.evaluate(() => __HYPERDRIVE__.snapshot())).paused,
      true,
      'Closing the journal with Escape must not also toggle the global pause off',
    );
    await page.locator('#resume').click();
    assert.equal(await page.locator('.radio-dock').isVisible(), true);
    assert.equal(await page.locator('#music-open, #sound').count(), 0);
    await assertFrameFits(page, ['.controls', '.radio-dock']);
    await assertNavigatorReadable(page);
    await assertWorldUncovered(page);
    await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/${width}-navigator.png`), fullPage: true });
    assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
    assert.deepEqual(errors, []);
    await mkdir(resolve(root, 'artifacts/browser/game-test'), {
      recursive: true,
    });
    await page.screenshot({
      path: resolve(root, `artifacts/browser/game-test/${width}.png`),
      fullPage: true,
    });
    const metrics = await page.evaluate(() => __HYPERDRIVE__.metrics());
    assert.ok(metrics.frames > 10);
    await writeFile(
      resolve(root, `artifacts/browser/game-test/${width}-frame-metrics.json`),
      JSON.stringify(metrics, null, 2),
    );
    if (width === 1440) {
      const nightfall = createState({
        mode: 'survival',
        startingWeapon: 'bass',
        survivalDay: '2026-10-21',
        routeIndex: 1,
        seed: 175,
        campaignStarted: true,
      });
      nightfall.survival.xp = survivalXpCost(nightfall.survival.level);
      const nightfallOffers = survivalOffers(nightfall).map((item) => item.id);
      const nightfallSave = exportNightfallSave(nightfall);
      assert.ok(nightfallSave);
      await page.evaluate(
        ({ key, legacyKey, save }) => {
          localStorage.removeItem(legacyKey);
          localStorage.setItem(key, JSON.stringify(save));
        },
        { key: NIGHTFALL_SAVE_KEY, legacyKey: SAVE_KEY, save: nightfallSave },
      );
      await page.reload();
      await page.waitForFunction(
        () => globalThis.__HYPERDRIVE__?.snapshot().ready,
      );
      await page.locator('#resume-tour').click();
      await finishStory(page);
      assert.equal(
        await page.evaluate(() => __HYPERDRIVE__.snapshot().screen),
        'map',
      );
      assert.deepEqual(
        await page.evaluate(
          () => __HYPERDRIVE__.snapshot().state.survival.upgrades,
        ),
        { bass: 1 },
      );
      await departThroughStory(page);
      await page.waitForFunction(
        () => __HYPERDRIVE__.snapshot().screen === 'draft',
      );
      assert.deepEqual(
        await page
          .locator('#draft-options button')
          .evaluateAll((buttons) =>
            buttons.map((button) => button.dataset.perkId),
          ),
        nightfallOffers,
      );
      assert.equal(
        await page.locator('#draft-options button > .item-heading > .item-icon').count(),
        3,
      );
      const frozenNightfall = await page.evaluate(
        () => __HYPERDRIVE__.snapshot().state,
      );
      await checkLanguages(page, '#draft-panel select', [
        '#draft-panel .modal-card',
      ]);
      assert.deepEqual(
        await page.evaluate(() => __HYPERDRIVE__.snapshot().state),
        frozenNightfall,
      );
      await page.locator('#draft-options button').first().click();
      await page.waitForFunction(
        () => __HYPERDRIVE__.snapshot().screen === 'playing',
      );
      const chosenNightfall = await page.evaluate(
        () => __HYPERDRIVE__.snapshot().state,
      );
      assert.equal(chosenNightfall.survival.level, 1);
      assert.equal(
        chosenNightfall.survival.upgrades[nightfallOffers[0]],
        (nightfall.survival.upgrades[nightfallOffers[0]] || 0) + 1,
      );
      assert.equal(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          NIGHTFALL_SAVE_KEY,
        ),
        null,
      );
      await page.reload();
      await page.waitForFunction(
        () => globalThis.__HYPERDRIVE__?.snapshot().ready,
      );
      assert.equal(
        await page.locator('#resume-tour').isVisible(),
        false,
        'Reloading a road cannot restore a consumed checkpoint',
      );

      const gadgetFixture = createState({
        mode: 'survival', startingWeapon: 'phone', survivalDay: '2026-10-21',
        routeIndex: 1, seed: 23, campaignStarted: true,
      });
      gadgetFixture.survival.upgrades.md = 1;
      gadgetFixture.survival.level = 1;
      const gadgetSave = exportNightfallSave(gadgetFixture);
      assert.ok(gadgetSave);
      await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), { key: NIGHTFALL_SAVE_KEY, save: gadgetSave });
      await page.reload();
      await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
      await page.locator('#resume-tour').click();
      await finishStory(page);
      assert.deepEqual(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.survival.upgrades), { phone: 1, md: 1 });
      await departThroughStory(page);
      await page.waitForFunction(() => {
        const snapshot = __HYPERDRIVE__.snapshot();
        return snapshot.screen === 'playing' && snapshot.state.events.some(event => event.type === 'survival-attack' && event.kind === 'phone' && event.repeat);
      });
      await assertWorldUncovered(page);
      await assertFrameFits(page, ['.controls', '.radio-dock']);
      await page.screenshot({ path: resolve(root, 'artifacts/browser/game-test/1440-phone-md-road.png'), fullPage: true });
      const gadgetState = await page.evaluate(() => __HYPERDRIVE__.snapshot().state);
      assert.ok(gadgetState.elapsed > 0);
      assert.ok(gadgetState.survival.mdClock > 0, 'Automatic phone attacks record a bounded MD repeat');

      const clubFixture = createState({ mode: 'survival', survivalDay: '2026-10-21', routeIndex: 1, seed: 175, campaignStarted: true });
      clubFixture.entities = []; clubFixture._stations = []; clubFixture._encounterPlan = [];
      clubFixture.totalFans = 1;
      clubFixture.distance = clubFixture.routeLength - .01;
      update(clubFixture, {}, .01);
      assert.equal(clubFixture.status, 'won');
      await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), { key: NIGHTFALL_SAVE_KEY, save: exportNightfallSave(clubFixture) });
      await page.reload();
      await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
      await page.locator('#resume-tour').click();
      await page.locator('#quiz').waitFor({ state: 'visible' });
      const beforeClubQuiz = await page.evaluate(() => __HYPERDRIVE__.snapshot().state);
      await checkLanguages(page, '#quiz select', ['#quiz .modal-card']);
      assert.deepEqual(await page.evaluate(() => __HYPERDRIVE__.snapshot().state), beforeClubQuiz);
      await page.locator('#quiz-choices button').first().click();
      assert.deepEqual(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.survival.quizRoads), [1]);
      await page.locator('#quiz-continue').click();
      assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().screen), 'finale');
      assert.match(await page.locator('#performance-tip').textContent(), /BEAT BASE 175/);
      assert.doesNotMatch(await page.locator('#performance-title').textContent(), /ツアー完走/);
      await assertFrameFits(page, ['#finale-home', '.controls', '.radio-dock']);
      assert.ok([1, 2].includes(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.totalFans)));
      await page.screenshot({ path: resolve(root, 'artifacts/browser/game-test/1440-low-fan-club.png'), fullPage: true });
      await page.evaluate(async () => {
        const { drawFinale } = await import('/game-test/src/campaign.js');
        const canvas = document.createElement('canvas');
        canvas.id = 'zero-fan-scene'; canvas.width = 960; canvas.height = 540;
        canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;width:960px;height:540px';
        document.body.append(canvas);
        drawFinale(canvas.getContext('2d'), { totalFans: 0, time: 0, complete: false, club: 'BEAT BASE 175' });
      });
      await page.locator('#zero-fan-scene').screenshot({ path: resolve(root, 'artifacts/browser/game-test/zero-fan-stage.png') });
      await page.locator('#zero-fan-scene').evaluate(canvas => canvas.remove());
      await page.locator('#finale-home').click();
      await finishStory(page);
      assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().screen), 'map');
      const afterClubScore = await page.evaluate(() => __HYPERDRIVE__.snapshot().state.score);
      await page.reload();
      await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
      await page.locator('#resume-tour').click();
      assert.equal(await page.locator('#quiz').isVisible(), false);
      assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.score), afterClubScore);
      await page.locator('#finale-home').click();
      await finishStory(page);

      // A committed departure with one earned level makes the browser draft
      // deterministic without farming live encounters or mutating browser state.
      const draftFixture = createState({
        routeIndex: 1,
        seed: 175,
        campaignStarted: true,
      });
      draftFixture.rpg = normalizeRpg({
        version: 1,
        enabled: true,
        style: 'guardian',
        xp: 32,
      });
      draftFixture._stageStart.rpg = normalizeRpg(draftFixture.rpg);
      const expectedOffers = getRpgView(draftFixture).offers.map(
        (perk) => perk.id,
      );
      assert.equal(expectedOffers.length, 3);
      await loadCampaignFixture(page, exportCampaignSave(draftFixture));
      assert.deepEqual(
        (await page.evaluate(() => __HYPERDRIVE__.snapshot())).settings,
        expectedSettings,
        'Assist and motion settings survive a reload',
      );
      await departThroughStory(page);
      await page.waitForFunction(
        () => __HYPERDRIVE__.snapshot().screen === 'draft',
      );
      const draftOptions = page.locator('#draft-options button');
      assert.deepEqual(
        await draftOptions.evaluateAll((buttons) =>
          buttons.map((button) => button.dataset.perkId),
        ),
        expectedOffers,
      );
      assert.equal(
        await page.locator('#draft-panel').getAttribute('aria-modal'),
        'true',
      );
      const draftPager = page.locator('#draft-options + .card-pager');
      assert.equal(
        await page.locator('#draft-options button:visible').count(),
        3,
        'Wide screens compare all three upgrade choices',
      );
      assert.equal(await draftPager.isVisible(), false);
      await assertFrameFits(page, ['#draft-panel .modal-card']);
      await page.setViewportSize({ width: 390, height: 667 });
      await page.waitForFunction(
        () =>
          document.querySelector('#draft-options').dataset.compare === 'false',
      );
      assert.equal(
        await page.locator('#draft-options button:visible').count(),
        1,
        'Narrow screens show one complete upgrade choice at a time',
      );
      assert.equal(await draftPager.isVisible(), true);
      await assertFrameFits(page, ['#draft-panel .modal-card']);
      await draftPager
        .getByRole('button', { name: '次へ →', exact: true })
        .click();
      assert.equal(await draftOptions.nth(1).isVisible(), true);
      await draftPager
        .getByRole('button', { name: '← 前へ', exact: true })
        .click();
      assert.equal(await draftOptions.first().isVisible(), true);
      await page.setViewportSize({ width, height });
      await page.waitForFunction(
        () =>
          document.querySelector('#draft-options').dataset.compare === 'true',
      );
      assert.equal(
        await page.locator('#draft-options button:visible').count(),
        3,
      );
      assert.equal(await draftPager.isVisible(), false);
      assert.equal(await page.locator('#pause').isDisabled(), true);
      assert.equal(await page.locator('#run-journal').isDisabled(), true);
      const frozenDraft = (await page.evaluate(() => __HYPERDRIVE__.snapshot()))
        .state;
      // Keep Space off the focused choice: releasing Space on a button is a
      // legitimate selection, whereas driving keys on the panel must do nothing.
      await page.locator('#draft-panel').focus();
      await page.keyboard.down('Space');
      await page.keyboard.down('KeyX');
      await page.waitForTimeout(200);
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyX');
      const afterReading = (
        await page.evaluate(() => __HYPERDRIVE__.snapshot())
      ).state;
      for (const key of [
        'elapsed',
        'distance',
        'energy',
        'integrity',
        'rushCooldown',
      ]) {
        assert.equal(
          afterReading[key],
          frozenDraft[key],
          `${key} freezes during a draft`,
        );
      }
      assert.deepEqual(afterReading.rpg, frozenDraft.rpg);
      await page.screenshot({
        path: resolve(root, 'artifacts/browser/game-test/rpg-draft.png'),
        fullPage: true,
      });
      const selectedPerk = expectedOffers[0];
      await draftOptions.first().click();
      await page.waitForFunction(
        () => __HYPERDRIVE__.snapshot().screen === 'playing',
      );
      const afterDraft = await page.evaluate(() => __HYPERDRIVE__.snapshot());
      assert.deepEqual(afterDraft.state.rpg.perks, [selectedPerk]);
      assert.equal(afterDraft.rpg.rank, 2);
      assert.equal(await page.locator('#draft-panel').isVisible(), false);
      await assertWorldUncovered(page);
      const savedDeparture = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        SAVE_KEY,
      );
      assert.deepEqual(
        savedDeparture.checkpoint.rpg.perks,
        [],
        'An unfinished road saves its departure, not newly selected run power',
      );
      const memoryBeforeReload = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        STORY_SAVE_KEY,
      );
      assert.equal(memoryBeforeReload.runId, draftFixture.runId);
      assert.equal(memoryBeforeReload.choices['tour:opening'], undefined, 'A different tour cannot inherit the opening choice');
      assert.ok(memoryBeforeReload.seen.includes('departure:1'));
      // The document can load before asynchronous language initialization finishes.
      languageBootDelay = 150;
      await page.reload();
      await page.waitForFunction(
        () => globalThis.__HYPERDRIVE__?.snapshot().ready,
      );
      await page.locator('#resume-tour').click();
      languageBootDelay = 0;
      const rolledBack = await page.evaluate(() => __HYPERDRIVE__.snapshot());
      assert.equal(rolledBack.screen, 'map');
      assert.deepEqual(rolledBack.state.rpg.perks, []);
      assert.equal(rolledBack.state.rpg.xp, 32);
      assert.deepEqual(
        rolledBack.story,
        memoryBeforeReload,
        'Story memory survives a road rollback',
      );

      // Completing the road commits the selected skill into the next departure.
      const completedDraft = createState({
        routeIndex: 1,
        seed: 175,
        campaignStarted: true,
      });
      completedDraft.rpg = normalizeRpg({
        ...draftFixture.rpg,
        perks: [selectedPerk],
      });
      completedDraft.entities = [];
      completedDraft._stations = [];
      completedDraft._nextEncounter = 1e9;
      completedDraft._quizTriggered = true;
      completedDraft.distance = completedDraft.routeLength - 0.01;
      update(completedDraft, {}, 0.01);
      assert.equal(completedDraft.status, 'won');
      await loadCampaignFixture(page, exportCampaignSave(completedDraft));
      assert.deepEqual(
        (await page.evaluate(() => __HYPERDRIVE__.snapshot())).state.rpg.perks,
        [selectedPerk],
        'A completed road retains its selected skill',
      );
      await departThroughStory(page);
      await page.waitForFunction(
        () => __HYPERDRIVE__.snapshot().screen === 'playing',
      );
      assert.deepEqual(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).checkpoint.rpg.perks,
          SAVE_KEY,
        ),
        [selectedPerk],
        'The next road departure commits the acquired skill',
      );

      // Fixture-backed stop UI: the earned twelve-road simulation is tested separately.
      const fixture = createState({
        routeIndex: 5,
        seed: 175,
        campaignStarted: true,
      });
      fixture.stagesCompleted = 5;
      fixture.money = 1800;
      fixture.entities = [];
      fixture._stations = [];
      fixture._nextEncounter = 1e9;
      fixture._quizTriggered = true;
      fixture.runBuild.mods = [
        'heart-pierce',
        'heart-chain',
        'charge-shield',
        'air-control',
      ];
      fixture.runBuild.acquiredIds = [...fixture.runBuild.mods];
      fixture.runBuild.purchasedLegs = [0, 1, 2, 3];
      fixture.distance = fixture.routeLength - 0.01;
      update(fixture, {}, 0.01);
      await loadCampaignFixture(page, exportCampaignSave(fixture));
      assert.match(
        await page.locator('#route-mission-preview').innerText(),
        /目標/,
      );
      await assertFrameFits(page, [
        '.map-origin',
        '#destination-choices',
        '.map-goal',
        '#depart',
      ]);
      await page.locator('#garage-tab').click();
      await assertFrameFits(page, ['#garage-done']);
      assert.match(await page.locator('#build-summary').innerText(), /4 \/ 4/);
      const card = page.locator('.build-card').first();
      assert.equal(await card.locator('button').isDisabled(), true);
      await card.locator('select').selectOption('heart-pierce');
      const before = (await page.evaluate(() => __HYPERDRIVE__.snapshot()))
        .state.money;
      await card.locator('button').evaluate((button) => {
        button.click();
        button.click();
      });
      const bought = (await page.evaluate(() => __HYPERDRIVE__.snapshot()))
        .state;
      assert.equal(bought.runBuild.mods.length, 4);
      assert.ok(!bought.runBuild.mods.includes('heart-pierce'));
      assert.ok(bought.money < before);
      assert.equal(
        bought.runBuild.purchasedLegs.filter((leg) => leg === 5).length,
        1,
      );
      await page.screenshot({
        path: resolve(
          root,
          'artifacts/browser/game-test/workshop-replacement.png',
        ),
        fullPage: true,
      });
      await page.reload();
      await page.waitForFunction(
        () => globalThis.__HYPERDRIVE__?.snapshot().ready,
      );
      await page.locator('#resume-tour').click();
      await finishStory(page);
      assert.deepEqual(
        (await page.evaluate(() => __HYPERDRIVE__.snapshot())).state.runBuild,
        bought.runBuild,
      );
      assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
      assert.deepEqual(errors, []);

      // Optional runtime enabled fixture contains no media. It checks the real
      // div-mounted controls and scene continuity, not actual browser playback.
      audioEnabled = true;
      audioRequests.length = 0;
      await reloadWithoutCampaign(page);
      await page.waitForSelector('#music.car-stereo', { state: 'attached' });
      await page.waitForFunction(
        () =>
          document.querySelector('#music [data-stereo="status"]')
            ?.textContent === '曲なし',
      );
      assert.equal(await page.locator('iframe#music').count(), 0);
      assert.equal(await page.locator('#music [data-stereo="format"]').innerText(), 'MUSIC');
      assert.doesNotMatch(await page.locator('#music').innerText(), /HLS|DIGITAL/i);
      assert.equal(await page.locator('#music [data-stereo="title"]').innerText(), '');
      assert.equal(await page.locator('#music .stereo-knob').getAttribute('role'), 'slider');
      const deckBounds = await page.locator('#music').boundingBox();
      assert.ok(deckBounds.x >= 0 && deckBounds.x + deckBounds.width <= width);
      for (const [radioWidth, radioHeight] of [[320, 740], [390, 667], [667, 375], [1440, 1000]]) {
        await page.setViewportSize({ width: radioWidth, height: radioHeight });
        const bounds = await page.locator('#music').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= radioWidth);
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= radioHeight);
        for (const button of await page.locator('#music .stereo-controls button').all()) {
          const target = await button.boundingBox();
          assert.ok(target.width >= 24 && target.height >= 24);
        }
        await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/${radioWidth}-radio.png`) });
      }
      await page.setViewportSize({ width, height });


      assert.equal(await page.locator('#music audio').count(), 1);
      assert.equal(
        await page.locator('#music [data-action="play"]').isVisible(),
        true,
      );
      assert.equal(
        await page.locator('#music [data-stereo="status"]').innerText(),
        '曲なし',
      );
      await page.evaluate(() => {
        globalThis.fixtureAudio = document.querySelector('#music audio');
      });
      await page.locator('#music [data-action="play"]').click();
      await page.locator('#story').click();
      await finishStory(page);
      assert.equal(
        await page.evaluate(() => __HYPERDRIVE__.snapshot().screen),
        'cars',
      );
      await page.locator('#cars-ready').click();
      assert.equal(
        await page.evaluate(() => __HYPERDRIVE__.snapshot().screen),
        'map',
      );
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.fixtureAudio ===
              document.querySelector('#music audio') &&
            globalThis.fixtureAudio.paused &&
            !globalThis.fixtureAudio.getAttribute('src'),
        ),
        true,
      );
      assert.equal(
        audioRequests.filter((path) => path.endsWith('/config')).length,
        1,
      );
      assert.ok(
        audioRequests.every((path) => /\/(config|catalog)$/.test(path)),
      );
      assert.deepEqual(moduleRequests, [], 'HLS stays lazy before playback');
      // Import-only module smoke, with no media or playback. This complements
      // the controller's synthetic non-native playback tests and catches a MIME
      // or CSP failure when the real vendored module is fetched by the browser.
      const hlsPath = '/game-test/src/vendor/hls.light.min.mjs';
      const [moduleResponse, moduleAvailable] = await Promise.all([
        page.waitForResponse(
          (response) => new URL(response.url()).pathname === hlsPath,
        ),
        page.evaluate(async () => {
          const { loadHls } = await import('/game-test/src/stream-audio.js');
          const Hls = await loadHls();
          return (
            typeof Hls === 'function' && typeof Hls.isSupported === 'function'
          );
        }),
      ]);
      assert.equal(moduleAvailable, true);
      assert.match(
        moduleResponse.headers()['content-type'],
        /^application\/javascript(?:;|$)/,
      );
      assert.equal(
        moduleResponse.headers()['x-content-type-options'],
        'nosniff',
      );
      assert.deepEqual(moduleRequests, [hlsPath]);
      assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: resolve(
          root,
          'artifacts/browser/game-test/optional-audio-empty.png',
        ),
        fullPage: true,
      });

      // A failed discovery request leaves the radio unavailable, and does
      // not turn into a missing-asset exception or a gameplay startup failure.
      audioEnabled = false;
      audioConfigStatus = 503;
      await reloadWithoutCampaign(page);
      assert.equal(await page.locator('iframe#music').count(), 0);
      assert.equal(await page.locator('#music audio').count(), 1);
      await page.locator('#story').click();
      await finishStory(page);
      assert.equal(await page.locator('#car-select').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
      assert.deepEqual(errors, []);
    }
    await context.close();
    console.log(
      `PASS game subpath start/drive/pause/resume/music panel at ${width}px with production CSP`,
    );
  }
} finally {
  await browser.close();
}
