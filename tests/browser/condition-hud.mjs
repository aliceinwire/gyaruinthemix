import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createState, exportNightfallSave } from '../../public/game/src/simulation.js';
import { NIGHTFALL_SAVE_KEY } from '../../public/game/src/save-store.js';

async function finishStory(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => __HYPERDRIVE__.snapshot().screen !== 'story')) return;
    const choices = page.locator('#story-choices button');
    if (await choices.count()) await choices.first().click();
    else await page.locator('#story-next').click();
  }
  assert.fail('Story did not finish');
}

async function checkMeters(page) {
  const faults = await page.evaluate(() => {
    const faults = [];
    const panel = document.querySelector('.dashboard').getBoundingClientRect();
    for (const id of ['health-value', 'health-meter', 'health-bar', 'energy-value', 'energy-meter', 'energy-bar', 'money']) {
      const el = document.getElementById(id), rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.left < panel.left || rect.right > panel.right + 1 || rect.top < panel.top || rect.bottom > panel.bottom + 1)
        faults.push(`${id} is clipped by the dashboard`);
      if (el.scrollWidth > el.clientWidth + 1) faults.push(`${id} overflows`);
      if (rect.bottom > document.querySelector('.radio-dock').getBoundingClientRect().top) faults.push(`${id} overlaps radio`);
    }
    const state = __HYPERDRIVE__.snapshot().state;
    for (const [id, value, capacity] of [['health', state.integrity, state.integrityCapacity], ['energy', state.energy, state.energyCapacity]]) {
      const displayed = Number(document.getElementById(`${id}-value`).textContent);
      // The display updates every 90ms and freezes on pause, so allow one HUD tick.
      if (Math.abs(displayed - Math.ceil(value)) > 3) faults.push(`${id} text is stale`);
      const percent = parseFloat(document.getElementById(`${id}-bar`).style.width);
      if (Math.abs(percent - value / capacity * 100) > 3) faults.push(`${id} bar is stale`);
      if (Math.abs(Math.ceil(percent * capacity / 100 - .0001) - displayed) > 1) faults.push(`${id} text and bar disagree`);
    }
    return faults;
  });
  assert.deepEqual(faults, [], `${JSON.stringify(page.viewportSize())}: visible, current resource meters`);
}

export async function checkConditionHud(browser, { root, csp }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 667 }, locale: 'ja-JP' });
  const errors = [];
  try {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://condition-hud.local') return route.abort();
      if (url.pathname === '/game-audio/v1/config') return route.fulfill({ json: { enabled: false } });
      const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      try {
        await route.fulfill({ body: await readFile(resolve(root, 'dist', path.slice(1))),
          contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' })[extname(path)] || 'application/octet-stream',
          headers: { 'content-security-policy': csp, 'x-content-type-options': 'nosniff' } });
      } catch { errors.push(path); await route.fulfill({ status: 404, body: 'Missing' }); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const state = createState({ mode: 'survival', seed: 175, routeIndex: 1, survivalDay: '2026-10-26', startingWeapon: 'vinyl', campaignStarted: true });
    state.integrity = 79; state.energy = 65; state.score = 99999999;
    const save = exportNightfallSave(state);
    assert.ok(save);
    await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), { key: NIGHTFALL_SAVE_KEY, save });
    await page.goto('http://condition-hud.local/game/');
    await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
    await page.locator('#resume-tour').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().screen !== 'menu');
    await finishStory(page);
    await page.locator('#depart').click();
    await page.waitForFunction(() => ['playing', 'story'].includes(__HYPERDRIVE__.snapshot().screen));
    await finishStory(page);
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().screen === 'playing');
    assert.equal(await page.locator('#health-value').textContent(), '79');
    await page.keyboard.down('Space');
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().state.energy < 60);
    await page.keyboard.up('Space');
    await page.locator('#pause').click();
    await checkMeters(page);
    await mkdir(resolve(root, 'artifacts/browser/game-test'), { recursive: true });
    for (const [width, height] of [[320, 568], [390, 667], [414, 768], [667, 375], [844, 390], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      await checkMeters(page);
      for (const code of ['en', 'de', 'ja']) {
        await page.locator('.settings select').selectOption(code);
        await page.waitForFunction(code => document.documentElement.lang === code, code);
        await checkMeters(page);
      }
      await page.locator('#resume').click();
      await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/${width}-condition-hud.png`) });
      await page.locator('#pause').click();
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log('PASS live hull and battery meters fit portrait, landscape and desktop dashboards');
}
