import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createState, exportCampaignSave, exportNightfallSave } from '../../public/game-test/src/simulation.js';
import { SAVE_KEY, NIGHTFALL_SAVE_KEY } from '../../public/game-test/src/save-store.js';

export async function checkClubResume(browser, { root, csp }) {
  for (const [city, routeIndex, legacy] of [['shinjuku', 3, false], ['kyoto', 11, true]]) {
    const state = createState({ mode: legacy ? 'story' : 'survival', survivalDay: '2026-10-23', routeIndex, campaignStarted: true });
    state.status = 'won'; state.distance = state.routeLength;
    state.stagesCompleted = routeIndex + 1; state.campaignComplete = legacy;
    if (state.survival) state.survival.quizRoads = [routeIndex];
    const save = legacy ? exportCampaignSave(state) : exportNightfallSave(state);
    assert.ok(save);
    const key = legacy ? SAVE_KEY : NIGHTFALL_SAVE_KEY;
    const context = await browser.newContext({ viewport: { width: 390, height: 667 }, locale: 'ja-JP' });
    try {
      let failVenue = !legacy;
      const requests = [], errors = [];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://club-resume.local') return route.abort();
        if (url.pathname === '/game-audio/v1/config') return route.fulfill({ contentType: 'application/json', body: '{"enabled":false}' });
        if (url.pathname.includes('/assets/clubs/')) {
          requests.push(url.pathname);
          if (failVenue && url.pathname.endsWith(`/${city}.png`)) return route.fulfill({ status: 503, body: 'Unavailable' });
        }
        const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
        try {
          await route.fulfill({ body: await readFile(resolve(root, 'dist', path.slice(1))),
            contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' })[extname(path)] || 'application/octet-stream',
            headers: { 'content-security-policy': csp, 'x-content-type-options': 'nosniff' } });
        } catch { errors.push(path); await route.fulfill({ status: 404, body: 'Missing' }); }
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ key, save }) => {
        localStorage.setItem(key, JSON.stringify(save));
        globalThis.clubDraws = [];
        const drawImage = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
          if (image?.src?.includes('/assets/clubs/')) globalThis.clubDraws.push(image.src);
          if (globalThis.clubDraws.length > 100) globalThis.clubDraws.shift();
          return drawImage.call(this, image, ...args);
        };
      }, { key, save });
      await page.goto('http://club-resume.local/game-test/');
      await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
      assert.ok(requests.every(path => path.endsWith('/nakano.png')));
      await page.locator('#resume-tour').click();
      if (failVenue) {
        await page.locator('#retry-art').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().state.routeIndex), 0);
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), save);
        assert.equal(await page.locator('#resume-tour').isEnabled(), true);
        failVenue = false;
        await page.locator('#retry-art').click();
      }
      await page.waitForFunction(index => __HYPERDRIVE__.snapshot().state.routeIndex === index, routeIndex);
      for (let i = 0; i < 15; i++) {
        if (await page.locator('#story-next').isVisible()) await page.locator('#story-next').click();
        else if (await page.evaluate(() => __HYPERDRIVE__.snapshot().screen === 'finale')) break;
        else await page.waitForTimeout(50);
      }
      await page.waitForFunction(city => clubDraws.some(src => src.endsWith(`/${city}.png`)), city);
      assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().screen), 'finale');
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log('PASS fresh saved-club resume loads the correct venue, retries safely, and fits the frame');
}
