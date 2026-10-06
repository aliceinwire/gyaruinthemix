// Offline UI integration checks. Never contact Stripe, YouTube, or a live API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(repo, 'dist');
const mode = process.env.CHECKOUT_MODE || 'payment_links';
assert.ok(['payment_links', 'api'].includes(mode), 'Unknown CHECKOUT_MODE');
const out = resolve(repo, 'artifacts/browser', mode);
await mkdir(out, { recursive: true });
const origin = 'http://127.0.0.1:4331';
const widths = [320, 375, 768, 960, 1440];
const publicPaths = [
  '/',
  '/about/',
  '/music/',
  '/live/',
  '/news/',
  '/fanclub/',
  '/shop/',
  '/contact/',
  '/legal/',
  '/privacy/',
];
const otherPaths = [
  '/shop/success/',
  '/shop/cancel/',
  '/shop-test/',
  '/shop-test/success/',
  '/shop-test/cancel/',
];
const paths = [...publicPaths, ...otherPaths];
const report = {
  mode,
  started: new Date().toISOString(),
  checks: [],
  failures: [],
  pageErrors: [],
  externalRequests: [],
  screenshots: [],
};
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
    const target = resolve(dist, '.' + pathname);
    if (target !== dist && !target.startsWith(dist + sep)) {
      response.writeHead(403).end();
      return;
    }
    let file = target;
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    } catch {
      /* 404 below */
    }
    const data = await readFile(file);
    response
      .writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
      })
      .end(data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(4331, '127.0.0.1', accept);
});
let browser;
function check(condition, label, detail) {
  const entry = {
    label,
    passed: Boolean(condition),
    ...(detail === undefined ? {} : { detail }),
  };
  report.checks.push(entry);
  if (!condition) {
    report.failures.push(entry);
    console.error('FAIL:', label, detail || '');
  }
}
async function scenario(label, action, page) {
  try {
    await action();
  } catch (error) {
    check(false, label, error.stack);
    if (page && !page.isClosed())
      await screenshot(page, 'FAIL-' + label).catch(() => {});
  }
}
async function screenshot(page, name) {
  const file = name.replace(/[^a-zA-Z0-9_-]/g, '-') + '.png';
  await page.screenshot({ path: resolve(out, file), fullPage: true });
  report.screenshots.push(file);
}
const definitions = JSON.parse(
  await readFile(resolve(repo, 'config/products.json'), 'utf8'),
);
const testDefinitions = JSON.parse(
  await readFile(resolve(repo, 'config/test-products.json'), 'utf8'),
);
const catalog = (testShop = false, enabled = false) => ({
  mode: 'test',
  salesEnabled: enabled,
  version: 'offline-browser-fixture-v1',
  products: (testShop ? testDefinitions : definitions).map((p) => ({
    ...p,
    availability: enabled ? 'available' : 'coming_soon',
    amount: enabled ? 800 : null,
  })),
  shipping: enabled ? { amount: 500, country: 'JP' } : null,
});
// Every request is intercepted: static files are local; APIs and media are fixtures.
async function context(options = {}, fixture = {}) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', ...options });
  ctx.setDefaultTimeout(8000);
  ctx.setDefaultNavigationTimeout(15000);
  await ctx.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      report.externalRequests.push(url.href);
      if (url.origin === 'https://www.youtube-nocookie.com') {
        await route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><head><title>Offline video fixture</title></head><body>Offline player fixture</body></html>',
        });
      } else {
        check(false, 'Unexpected external request was blocked', url.href);
        await route.abort();
      }
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const en = request.headers()['x-shop-locale'] === 'en';
      if (url.pathname.endsWith('/catalog')) {
        if (fixture.catalogFailure) {
          await route.fulfill({
            status: 503,
            json: { error: 'Offline fixture unavailable' },
          });
          return;
        }
        const isTest = url.pathname.startsWith('/api/test-shop/');
        await route.fulfill({
          json: catalog(isTest, Boolean(fixture.enabled)),
        });
      } else if (url.pathname.endsWith('/checkout')) {
        fixture.checkoutRequests?.push({
          headers: request.headers(),
          body: request.postDataJSON(),
        });
        await route.fulfill({
          status: 503,
          json: {
            error: en
              ? 'Checkout could not be opened. Please wait a moment and try again.'
              : '決済ページを開けませんでした。少し待ってから、もう一度お試しください。',
          },
        });
      } else {
        await route.fulfill({
          status: 404,
          json: { error: en ? 'Not found.' : '見つかりません。' },
        });
      }
      return;
    }
    await route.continue();
  });
  ctx.on('page', (page) =>
    page.on('pageerror', (error) =>
      report.pageErrors.push({ url: page.url(), error: error.message }),
    ),
  );
  return ctx;
}
async function overflow(page, label) {
  const data = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    elements: [
      ...document.querySelectorAll('main *,header *,footer *, .topline *'),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width && (r.right > innerWidth + 1 || r.left < -1);
      })
      .slice(0, 12)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        text: e.textContent.trim().slice(0, 90),
        left: e.getBoundingClientRect().left,
        right: e.getBoundingClientRect().right,
      })),
  }));
  check(
    data.document <= data.width + 1 && data.body <= data.width + 1,
    label + ' no horizontal overflow',
    data,
  );
  if (data.document > data.width + 1 || data.body > data.width + 1)
    await screenshot(page, 'overflow-' + label);
}
async function inspect(page, pathname, width) {
  await page.setViewportSize({ width, height: 900 });
  const response = await page.goto(origin + pathname, {
    waitUntil: 'networkidle',
  });
  const label = pathname + ' at ' + width;
  check(response.ok(), label + ' response', response.status());
  await overflow(page, label);
  const en = pathname.startsWith('/en/');
  check(
    (await page.locator('html').getAttribute('lang')) === (en ? 'en' : 'ja'),
    label + ' document language',
  );
  if (width === 320) {
    const data = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelectorAll('h1').length,
      description: document.querySelector('meta[name=description]')?.content,
      canonical: document.querySelector('link[rel=canonical]')?.href,
      robots: document.querySelector('meta[name=robots]')?.content,
      alternates: [...document.querySelectorAll('link[rel=alternate]')].map(
        (a) => [a.hreflang, a.href],
      ),
      localLinks: [
        ...document.querySelectorAll('a[href^="/"]:not([data-language-link])'),
      ].map((a) => a.getAttribute('href')),
      brokenImages: [...document.images]
        .filter((i) => i.complete && i.currentSrc && !i.naturalWidth)
        .map((i) => i.currentSrc),
    }));
    check(
      data.h1 === 1 && data.title && data.description,
      label + ' page identity',
      data,
    );
    const base = pathname.replace(/^\/en/, '') || '/';
    if (publicPaths.includes(base)) {
      check(
        data.canonical === 'https://gyaruinthemix.com' + pathname &&
          !data.robots,
        label + ' canonical/indexability',
        data.canonical,
      );
      const expected = [
        ['ja', 'https://gyaruinthemix.com' + base],
        ['en', 'https://gyaruinthemix.com/en' + base],
        ['x-default', 'https://gyaruinthemix.com' + base],
      ];
      check(
        JSON.stringify(data.alternates) === JSON.stringify(expected),
        label + ' reciprocal alternates',
        data.alternates,
      );
    } else check(/noindex/.test(data.robots || ''), label + ' noindex');
    if (en)
      check(
        data.localLinks.every((href) => href.startsWith('/en/')),
        label + ' English local navigation',
        data.localLinks.filter((href) => !href.startsWith('/en/')),
      );
    check(
      !data.brokenImages.length,
      label + ' loaded images',
      data.brokenImages,
    );
  }
  if (
    [375, 1440].includes(width) &&
    ['/en/', '/en/fanclub/', '/en/shop/'].includes(pathname)
  )
    await screenshot(page, label);
  if (width <= 900) {
    const menu = page.locator('.mobile-menu');
    await menu.locator('summary').click();
    check(await menu.locator('nav').isVisible(), label + ' mobile menu opens');
    await overflow(page, label + ' open menu');
    await menu.locator('summary').click();
    check(
      (await menu.getAttribute('open')) === null,
      label + ' mobile menu closes',
    );
  } else
    check(
      await page.locator('.desktop-navigation').isVisible(),
      label + ' desktop navigation visible',
    );
}
async function artistInteractions(page, prefix, width) {
  const label = (prefix || 'ja') + ' at ' + width;
  await page.setViewportSize({ width, height: 900 });
  await page.goto(origin + prefix + '/fanclub/', { waitUntil: 'networkidle' });
  const photos = page.locator('[data-photo]');
  check((await photos.count()) > 0, label + ' gallery exists');
  for (let i = 0; i < 3; i++) {
    const photo = photos.nth(i % (await photos.count()));
    await photo.click();
    check(
      await page.locator('#photo-dialog').evaluate((d) => d.open),
      label + ' photo opens ' + i,
    );
    check(
      (await page.locator('#photo-full').getAttribute('alt')) ===
        (await photo.locator('img').getAttribute('alt')),
      label + ' full photo alt ' + i,
    );
    await page.locator('#photo-full').evaluate((img) => img.decode());
    check(
      await page.locator('#photo-full').evaluate((img) => img.naturalWidth > 0),
      label + ' full image loads ' + i,
    );
    await overflow(page, label + ' photo dialog');
    if (i === 1) {
      await page.keyboard.press('Tab');
      check(
        await page
          .locator('#photo-dialog')
          .evaluate(
            (d) =>
              d.contains(document.activeElement) ||
              document.activeElement === document.body,
          ),
        label + ' modal does not focus a background control',
      );
      await page.keyboard.press('Escape');
    } else await page.locator('[data-photo-close]').click();
    check(
      !(await page.locator('#photo-dialog').evaluate((d) => d.open)),
      label + ' photo closes ' + i,
    );
    check(
      await photo.evaluate((e) => e === document.activeElement),
      label + ' photo focus restored ' + i,
    );
  }
  const faq = page.locator('.club-faq details').first();
  await faq.locator('summary').click();
  check((await faq.getAttribute('open')) !== null, label + ' FAQ expands');
  await faq.locator('summary').click();
  if (width <= 900) {
    await page.locator('.mobile-menu summary').press('Enter');
    await page.locator(`.mobile-menu a[href="${prefix}/music/"]`).click();
  } else {
    await page
      .locator(`.desktop-navigation a[href="${prefix}/music/"]`)
      .click();
  }
  await page.waitForURL(origin + prefix + '/music/');
  await page.goBack({ waitUntil: 'networkidle' });
  check(
    new URL(page.url()).pathname === prefix + '/fanclub/',
    label + ' Back restores fan page',
  );
  check(
    !(await page.locator('#photo-dialog').evaluate((d) => d.open)),
    label + ' Back does not reopen dismissed gallery',
  );
  await page.goForward({ waitUntil: 'networkidle' });
  await page.waitForURL(origin + prefix + '/music/');
  check(
    (await page.locator('iframe').count()) === 0,
    label + ' player lazy before opt-in',
  );
  const card = page.locator('[data-music-video]').first();
  for (let i = 0; i < 2; i++) {
    await card.locator('[data-video-load]').click();
    check(
      (await card.locator('iframe').count()) === 1,
      label + ' exactly one frame ' + i,
    );
    check(
      !/autoplay/.test(await card.locator('iframe').getAttribute('src')),
      label + ' no autoplay ' + i,
    );
    await card.locator('[data-video-close]').click();
    check(
      (await card.locator('iframe').count()) === 0,
      label + ' player removed ' + i,
    );
    check(
      await card
        .locator('[data-video-load]')
        .evaluate((e) => e === document.activeElement),
      label + ' player focus restored ' + i,
    );
  }
}
async function switchLanguage(page) {
  for (const path of paths) {
    await page.goto(origin + path + '?qa=1#qa-fragment', {
      waitUntil: 'networkidle',
    });
    await page.locator('[data-language-link][lang=en]').click();
    await page.waitForURL(origin + '/en' + path + '?qa=1#qa-fragment');
    check(
      page.url() === origin + '/en' + path + '?qa=1#qa-fragment',
      'JA to EN retains route/query/hash ' + path,
    );
    await page.locator('[data-language-link][lang=ja]').click();
    await page.waitForURL(origin + path + '?qa=1#qa-fragment');
    check(
      page.url() === origin + path + '?qa=1#qa-fragment',
      'EN to JA retains route/query/hash ' + path,
    );
  }
}
async function cartScenarios() {
  // Closed sales, unavailable API, persisted contents and error-only mock checkout.
  for (const testShop of [false, true]) {
    if (!testShop && mode !== 'api') continue;
    const base = testShop ? '/shop-test/' : '/shop/';
    for (const width of [320, 375, 960, 1440]) {
      const ctx = await context({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await scenario(
        'closed bag ' + base + width,
        async () => {
          await page.goto(origin + '/en' + base, { waitUntil: 'networkidle' });
          check(
            (await page.locator('[data-add]:not([disabled])').count()) === 0,
            base + width + ' closed products disabled',
          );
          const trigger = page.locator('[data-open-cart]').first();
          for (let i = 0; i < 2; i++) {
            await trigger.click();
            check(
              await page.locator('#checkout').isDisabled(),
              base + width + ' closed checkout disabled',
            );
            check(
              (await page.locator('#cart-items').innerText()).includes(
                'Your bag is empty',
              ),
              base + width + ' English empty bag',
            );
            await overflow(page, base + width + ' closed bag');
            if (i) await page.keyboard.press('Escape');
            else await page.locator('[data-close-cart]').first().click();
            check(
              await trigger.evaluate((e) => e === document.activeElement),
              base + width + ' bag focus restored',
            );
          }
        },
        page,
      );
      await ctx.close();
    }
    const checkoutRequests = [];
    const ctx = await context(
      { viewport: { width: 375, height: 900 } },
      { enabled: true, checkoutRequests },
    );
    const page = await ctx.newPage();
    await scenario(
      'mock cart ' + base,
      async () => {
        await page.goto(origin + '/en' + base, { waitUntil: 'networkidle' });
        await page.locator('[data-add="sticker"]').click();
        await page.locator('[data-open-cart]').first().click();
        check(
          (await page.locator('#cart-items').innerText()).includes(
            'Logo sticker',
          ),
          base + ' localized product',
        );
        await page
          .getByRole('button', {
            name: 'Increase quantity of Logo sticker',
            exact: true,
          })
          .click();
        check(
          (await page.locator('#cart-items').innerText()).includes('2 items'),
          base + ' quantity increases',
        );
        await page
          .getByRole('button', {
            name: 'Decrease quantity of Logo sticker',
            exact: true,
          })
          .click();
        check(
          (await page.locator('#cart-items').innerText()).includes('1 item'),
          base + ' quantity decreases',
        );
        await overflow(page, base + ' populated bag');
        await screenshot(page, base + '-mock-populated-bag');
        await page.locator('#checkout').click();
        await page
          .locator('#cart-error')
          .filter({ hasText: 'Checkout could not be opened.' })
          .waitFor();
        check(
          checkoutRequests.length === 1 &&
            checkoutRequests[0].body.locale === 'en',
          base + ' mocked checkout locale',
        );
        await page.locator('[data-close-cart]').first().click();
        await page.locator('[data-language-link][lang=ja]').click();
        await page.waitForURL(origin + base);
        await page.locator('[data-open-cart]').first().click();
        check(
          (await page.locator('#cart-items').innerText()).includes(
            'ロゴステッカー',
          ),
          base + ' cross-language bag kept',
        );
        if (!testShop) {
          await page.locator('#checkout').click();
          await page
            .locator('#cart-error')
            .filter({ hasText: '決済ページを開けませんでした。' })
            .waitFor();
          check(
            checkoutRequests.length === 2 &&
              checkoutRequests[1].headers['idempotency-key'] ===
                checkoutRequests[0].headers['idempotency-key'] &&
              checkoutRequests[1].body.locale === 'en' &&
              checkoutRequests[1].headers['x-shop-locale'] === 'ja',
            base + ' retry retains attempt/locale and translates error',
          );
        }
        await page.locator('.cart-remove').click();
        check(
          (await page.locator('.cart-row').count()) === 0,
          base + ' removal empties bag',
        );
        await page.locator('[data-close-cart]').first().click();
        await page.goto(
          origin + '/en' + base + 'success/?session_id=cs_test_QA',
          { waitUntil: 'networkidle' },
        );
        if (testShop)
          check(
            /No verifiable checkout|previous test checkout/i.test(
              await page.locator('#test-return-status').innerText(),
            ),
            base + ' unverified return remains cautious',
          );
      },
      page,
    );
    await ctx.close();
    const failed = await context({}, { catalogFailure: true });
    const failurePage = await failed.newPage();
    await scenario(
      'catalog failure ' + base,
      async () => {
        await failurePage.goto(origin + '/en' + base, {
          waitUntil: 'networkidle',
        });
        check(
          (await failurePage.locator('#catalog-status').innerText()).includes(
            'Product information could not be loaded',
          ),
          base + ' translated catalog error',
        );
        check(
          (await failurePage.locator('[data-add]:not([disabled])').count()) ===
            0,
          base + ' failed catalog disables products',
        );
      },
      failurePage,
    );
    await failed.close();
  }
}
try {
  browser = await chromium.launch({ headless: true });
  const ctx = await context();
  const page = await ctx.newPage();
  for (const width of widths) {
    for (const path of [
      ...paths.map((p) => '/en' + p),
      '/en/404/',
      '/',
      '/about/',
      '/fanclub/',
      '/shop/',
    ])
      await scenario(
        path + ' at ' + width,
        () => inspect(page, path, width),
        page,
      );
  }
  for (const width of widths)
    for (const prefix of ['/en', ''])
      await scenario(
        'artist interactions ' + prefix + width,
        () => artistInteractions(page, prefix, width),
        page,
      );
  await scenario(
    'equivalent language routes',
    () => switchLanguage(page),
    page,
  );
  await ctx.close();
  await cartScenarios();
  check(
    report.pageErrors.length === 0,
    'No uncaught page JavaScript errors',
    report.pageErrors,
  );
} catch (error) {
  check(false, 'Browser test infrastructure', error.stack);
} finally {
  await browser?.close();
  await new Promise((accept) => server.close(accept));
  report.finished = new Date().toISOString();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    `${mode}: ${report.checks.length} assertions; ${report.failures.length} failures. Evidence: ${out}`,
  );
  if (report.failures.length) process.exitCode = 1;
}
