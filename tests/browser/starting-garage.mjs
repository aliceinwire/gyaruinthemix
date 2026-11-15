import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  createState,
  beginCampaign,
  chooseStartingWeapon,
  exportNightfallSave,
} from '../../public/game/src/simulation.js';
import { createMetaProgress } from '../../public/game/src/garage.js';
import { buyRunMod } from '../../public/game/src/run-build.js';
import {
  META_KEY,
  NIGHTFALL_SAVE_KEY,
} from '../../public/game/src/save-store.js';

export async function checkStartingGarage(browser, { root, csp }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 667 },
    locale: 'ja-JP',
  });
  const origin = 'http://garage.local';
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/game-audio/v1/config')
      return route.fulfill({
        contentType: 'application/json',
        body: '{"enabled":false}',
      });
    const path = url.pathname.endsWith('/')
      ? `${url.pathname}index.html`
      : url.pathname;
    const body = await readFile(resolve(root, 'dist', path.slice(1)));
    return route.fulfill({
      body,
      contentType: mime[extname(path)] || 'application/octet-stream',
      headers: { 'content-security-policy': csp },
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = createState({ mode: 'survival', survivalDay: '2026-11-15' });
  const seed = exportNightfallSave(state);
  const load = async (save, meta) => {
    await page.evaluate(
      ({ save, meta, metaKey, saveKey }) => {
        localStorage.setItem(metaKey, JSON.stringify(meta));
        localStorage.setItem(saveKey, JSON.stringify(save));
      },
      { save, meta, metaKey: META_KEY, saveKey: NIGHTFALL_SAVE_KEY },
    );
    await page.reload();
    await page.waitForFunction(
      () => globalThis.__HYPERDRIVE__?.snapshot().ready,
    );
    await page.locator('#resume-tour').click();
    await page.waitForFunction(
      () => __HYPERDRIVE__.snapshot().screen !== 'menu',
    );
  };
  const snapshot = () => page.evaluate(() => __HYPERDRIVE__.snapshot().state);
  const points = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).completionPoints,
      META_KEY,
    );
  const tab = (index) =>
    page.locator('#car-select > .frame-tabs button').nth(index).click();
  const capture = async (name) => {
    await mkdir(resolve(root, 'artifacts/browser/game-test'), {
      recursive: true,
    });
    await page.screenshot({
      path: resolve(root, `artifacts/browser/game-test/garage-${name}.png`),
    });
  };
  try {
    await page.goto(`${origin}/game/`);
    await page.waitForFunction(
      () => globalThis.__HYPERDRIVE__?.snapshot().ready,
    );
    await load(seed, createMetaProgress());
    assert.equal(
      await page.locator('[data-weapon="flash"]').isDisabled(),
      true,
    );
    assert.equal(
      await page.locator('[data-weapon="heart"]').isDisabled(),
      true,
    );
    assert.equal((await snapshot()).survival.startingWeapon, null);
    assert.deepEqual((await snapshot()).survival.upgrades, {});
    assert.equal(await page.locator('#cars-ready').isEnabled(), true);
    await tab(3);
    assert.equal(
      await page.locator('[data-upgrade="battery"]').isDisabled(),
      true,
    );
    await page.locator('#cars-ready').click();
    assert.equal(await page.locator('#garage-tab').count(), 0);
    assert.equal(await page.locator('#change-starting-car').isVisible(), true);
    await page.locator('#change-starting-car').click();
    assert.equal(await page.locator('#car-select').isVisible(), true);

    await load(seed, createMetaProgress({ completionPoints: 20 }));
    await tab(0);
    await page.locator('[data-weapon="flash"]').click();
    assert.equal(await points(), 19);
    await page.locator('[data-weapon="none"]').click();
    await page.locator('[data-weapon="flash"]').click();
    assert.equal(await points(), 19);
    await tab(3);
    await page.locator('[data-upgrade="battery"]').click();
    assert.equal(await points(), 18);
    assert.equal((await snapshot()).energyCapacity, 130);
    await tab(4);
    await page.locator('[data-mod-id="charge-shield"]').click();
    assert.equal(await points(), 17);
    assert.deepEqual((await snapshot()).runBuild.mods, ['charge-shield']);
    await page.locator('[data-remove-mod="charge-shield"]').click();
    await page.locator('[data-mod-id="charge-shield"]').click();
    assert.equal(await points(), 17);
    await tab(2);
    await page.locator('#custom-decal').selectOption('stars');
    await page.locator('#customization-apply').click();
    assert.equal(await points(), 16);
    const prepared = await snapshot();
    assert.equal(prepared.money, 0);
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      NIGHTFALL_SAVE_KEY,
    );
    const meta = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      META_KEY,
    );
    await load(saved, meta);
    assert.equal((await snapshot()).survival.startingWeapon, 'flash');
    assert.equal((await snapshot()).energyCapacity, 130);
    assert.deepEqual((await snapshot()).runBuild.mods, ['charge-shield']);

    const layoutFaults = [];
    for (const [width, height] of [
      [320, 740],
      [390, 667],
      [667, 375],
      [844, 390],
      [1440, 1000],
    ]) {
      await page.setViewportSize({ width, height });
      for (const language of ['ja', 'en', 'it']) {
        await page.locator('.settings select').selectOption(language);
        for (let index = 0; index < 5; index++) {
          await tab(index);
          const faults = await page.evaluate(() => {
            const radio = document
              .querySelector('.radio-dock')
              .getBoundingClientRect();
            const wallet = document
              .querySelector('#car-select-wallet')
              .getBoundingClientRect();
            const footerTop = Math.min(
              wallet.top,
              document.querySelector('#cars-ready').getBoundingClientRect().top,
            );
            return [
              ...document.querySelectorAll(
                '#car-select button, #car-select select',
              ),
            ]
              .filter((el) => {
                if (!el.getClientRects().length || el.closest('[hidden]'))
                  return false;
                const r = el.getBoundingClientRect();
                return (
                  r.left < -1 ||
                  r.right > innerWidth + 1 ||
                  r.top < -1 ||
                  r.bottom > Math.min(innerHeight, radio.top) + 1 ||
                  (el.closest('.frame-page') && r.bottom > footerTop + 1)
                );
              })
              .map((el) => el.id || el.textContent);
          });
          await capture(`${width}-${language}-${index}`);
          if (faults.length)
            layoutFaults.push({
              viewport: `${width}x${height}`,
              language,
              tab: index,
              faults,
            });
        }
      }
    }
    const full = createState({ mode: 'survival', survivalDay: '2026-11-15' });
    const fullMeta = createMetaProgress({ completionPoints: 20 });
    assert.equal(chooseStartingWeapon(full, 'heart', fullMeta), true);
    for (const id of [
      'charge-shield',
      'charged-heart',
      'air-control',
      'rush-pulse',
    ])
      assert.equal(buyRunMod(full, id, null, fullMeta), true);
    await load(exportNightfallSave(full), fullMeta);
    await tab(4);
    const modulePager = page.locator('.build-workshop > .card-pager');
    for (const [width, height] of [
      [320, 740],
      [390, 667],
      [667, 375],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      for (const language of ['ja', 'en', 'it']) {
        await page.locator('.settings select').selectOption(language);
        while (await modulePager.locator('button').first().isEnabled())
          await modulePager.locator('button').first().click();
        const count = await page.locator('#build-offers > article').count();
        for (let card = 0; card < count; card++) {
          const faults = await page.evaluate(() => {
            const limit = Math.min(
              ...['#car-select-wallet', '#cars-ready'].map(
                (selector) =>
                  document.querySelector(selector).getBoundingClientRect().top,
              ),
            );
            return [
              ...document.querySelectorAll(
                '#car-select .frame-page button, #car-select .frame-page select',
              ),
            ]
              .filter((el) => {
                if (!el.getClientRects().length || el.closest('[hidden]'))
                  return false;
                const r = el.getBoundingClientRect();
                return (
                  r.left < -1 ||
                  r.right > innerWidth + 1 ||
                  r.bottom > limit + 1
                );
              })
              .map((el) => el.id || el.textContent);
          });
          await capture(`${width}-${language}-full-${card}`);
          if (faults.length)
            layoutFaults.push({
              viewport: `${width}x${height}`,
              language,
              tab: `full-${card}`,
              faults,
            });
          if (card < count - 1)
            await modulePager.locator('button').last().click();
        }
      }
    }
    assert.deepEqual(layoutFaults, []);
    await page.setViewportSize({ width: 1440, height: 1000 });
    while (await modulePager.locator('button').first().isEnabled())
      await modulePager.locator('button').first().click();
    const replacement = page
      .locator('.build-card')
      .filter({ has: page.locator('[data-mod-id="heart-pierce"]') });
    assert.equal(await replacement.locator('button').isDisabled(), true);
    await replacement.locator('select').selectOption('charge-shield');
    const beforeReplacement = await points();
    await replacement.locator('button').evaluate((button) => {
      button.click();
      button.click();
    });
    assert.equal(await points(), beforeReplacement - 1);
    assert.deepEqual((await snapshot()).runBuild.mods, [
      'charged-heart',
      'air-control',
      'rush-pulse',
      'heart-pierce',
    ]);
    beginCampaign(state);
    await load(exportNightfallSave(state), meta);
    assert.equal(await page.locator('#car-select').isVisible(), false);
    assert.equal(await page.locator('#change-starting-car').isVisible(), false);
    await page
      .locator('#change-starting-car')
      .evaluate((button) => button.click());
    assert.equal(await page.locator('#car-select').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
