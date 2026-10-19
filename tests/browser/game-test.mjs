// Offline subpath/CSP integration; SoundCloud's actual playback remains provider-dependent.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
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
  for (const width of [390, 1440]) {
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
    const destinations = page.locator('#destination-choices button');
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
    await page.waitForTimeout(700);
    assert.ok(
      await page.evaluate(() => __HYPERDRIVE__.snapshot().state.distance > 0),
    );
    await page.screenshot({
      path: resolve(root, `artifacts/browser/game-test/${width}-driving.png`),
      fullPage: true,
    });
    await page.keyboard.press('KeyP');
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
    await context.close();
    console.log(
      `PASS game subpath start/drive/pause/resume/music panel at ${width}px with production CSP`,
    );
  }
} finally {
  await browser.close();
}
