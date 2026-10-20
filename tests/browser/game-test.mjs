// Offline subpath/CSP integration; SoundCloud's actual playback remains provider-dependent.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  createState,
  update,
  exportCampaignSave,
} from '../../public/game-test/src/simulation.js';
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
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    context.setDefaultTimeout(10000);
    const errors = [];
    await mkdir(resolve(root, 'artifacts/browser/game-test'), {
      recursive: true,
    });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://w.soundcloud.com') {
        if (url.pathname.endsWith('api.js'))
          return route.fulfill({
            contentType: 'application/javascript',
            body: '/* offline provider fixture */',
          });
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><button>Offline SoundCloud fixture</button>',
        });
      }
      if (url.origin !== origin) return route.abort();
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
      // Deterministic autumn/rain fixture, not random user gameplay.
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
    await page.locator('#story').click();
    assert.equal(
      await page.locator('#starting-customization').isVisible(),
      true,
    );
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
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 18),
      );
      await node.click();
      assert.equal(await node.getAttribute('aria-pressed'), 'true');
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
    await page.locator('#garage-tab').click();
    assert.equal(await page.locator('#garage-content').isVisible(), true);
    assert.ok((await page.locator('#shop button').count()) >= 8);
    await page.screenshot({
      path: resolve(root, `artifacts/browser/game-test/${width}-garage.png`),
      fullPage: true,
    });
    await page.locator('#garage-done').click();
    await page.locator('#depart').click();
    await page.waitForFunction(
      () => __HYPERDRIVE__.snapshot().screen === 'playing',
    );
    await page.waitForTimeout(1800);
    assert.equal(
      await page.evaluate(() => __HYPERDRIVE__.snapshot().state.weather),
      'rain',
    );
    assert.ok(
      await page.evaluate(() => __HYPERDRIVE__.snapshot().state.distance > 0),
    );
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
        .locator('#auto-hearts')
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#auto-hearts').isChecked(), true);
    await page.keyboard.press('Tab');
    assert.equal(
      await page
        .locator('#resume')
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.locator('#resume').click();
    await page.locator('#music-open').click();
    assert.equal(await page.locator('#music-panel').isVisible(), true);
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
      await page.evaluate(
        (save) =>
          localStorage.setItem(
            'gyaruinthemix-club-tour-v1',
            JSON.stringify(save),
          ),
        exportCampaignSave(fixture),
      );
      await page.reload();
      await page.waitForFunction(() => __HYPERDRIVE__?.snapshot().ready);
      await page.locator('#resume-tour').click();
      assert.match(
        await page.locator('#route-mission-preview').innerText(),
        /目標/,
      );
      await page.locator('#garage-tab').click();
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
      await page.waitForFunction(() => __HYPERDRIVE__?.snapshot().ready);
      await page.locator('#resume-tour').click();
      assert.deepEqual(
        (await page.evaluate(() => __HYPERDRIVE__.snapshot())).state.runBuild,
        bought.runBuild,
      );
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
