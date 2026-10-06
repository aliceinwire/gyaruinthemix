import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.match(
  process.env.COMPOSE_PROJECT_NAME || '',
  /^gyaruinthemix-ci-\d+-\d+-bouncer$/,
);
assert.equal(process.env.CHECKOUT_MODE || 'payment_links', 'payment_links');
const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['stripe_secret_key', 'stripe_webhook_secret'])
  assert.equal(
    existsSync(`${root}/secrets/${name}`),
    false,
    'no secret fixtures allowed',
  );
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' });
assert.equal(process.env.CI_LAYOUT, 'bouncer');
const service = 'gyaruinthemix-web';
assert.deepEqual(
  docker('compose', 'ps', '--services', '--status', 'running')
    .trim()
    .split('\n'),
  [service],
);
const config = JSON.parse(docker('compose', 'config', '--format', 'json'));
assert.ok(
  !config.services['gyaruinthemix-api'],
  'API is excluded from the default profile',
);
assert.ok(!config.services[service].depends_on);
assert.ok(!config.services[service].secrets?.length);
assert.equal(
  config.services[service].build.args.CHECKOUT_MODE,
  'payment_links',
);
const [container] = JSON.parse(
  docker('inspect', docker('compose', 'ps', '-q', service).trim()),
);
assert.equal(container.State.Health.Status, 'healthy');
assert.equal(container.Config.User, '101:101');
assert.equal(container.HostConfig.ReadonlyRootfs, true);
assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
assert.ok(container.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
assert.equal(container.HostConfig.Memory, 64 * 1024 * 1024);
assert.equal(container.Mounts.length, 0);
assert.ok(
  !container.Config.Env.some((value) => /STRIPE_.*(?:KEY|SECRET)/.test(value)),
);
assert.equal(Object.keys(container.NetworkSettings.Networks).length, 2);
const base = 'http://127.0.0.1:8089';
for (const path of [
  '/',
  '/shop/',
  '/about/',
  '/contact/',
  '/live/',
  '/music/',
  '/news/',
  '/legal/',
  '/fanclub/',
  '/shop/success/',
  '/shop/cancel/',
  '/privacy/',
  '/en/',
  '/en/about/',
  '/en/contact/',
  '/en/music/',
  '/en/live/',
  '/en/news/',
  '/en/fanclub/',
  '/en/shop/',
  '/en/shop/success/',
  '/en/shop/cancel/',
  '/en/legal/',
  '/en/privacy/',
]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  assert.ok(
    response.headers
      .get('content-security-policy')
      ?.includes("script-src 'self'"),
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const html = await response.text();
  assert.doesNotMatch(html, /cart-dialog|data-open-cart|id="checkout"/);
  if (path === '/shop/' && process.env.CI_PAYMENT_LINK_FIXTURE === 'true') {
    assert.match(html, /href="https:\/\/buy.stripe.com\/test_CIFixture"/);
    assert.match(html, /¥800/);
    assert.match(html, /テストショップ/);
  }
  for (const [, asset] of html.matchAll(
    /(?:src|href)="(\/(?:_astro|assets)\/[^"?#]+)"/g,
  )) {
    const result = await fetch(base + asset);
    assert.equal(result.status, 200, asset);
    if (asset.endsWith('.js'))
      assert.doesNotMatch(
        await result.text(),
        /\/api\/catalog|\/api\/checkout|gyaru-cart-v1/,
      );
  }
}
for (const path of ['/api/health', '/api/catalog', '/api/stripe/webhook'])
  assert.equal((await fetch(base + path)).status, 404, path);
assert.equal(
  (await fetch(base + '/api/checkout', { method: 'POST', body: '{}' })).status,
  404,
);
const english404 = await fetch(base + '/en/page-that-does-not-exist/');
assert.equal(english404.status, 404);
assert.match(await english404.text(), /<html lang="en"/);
assert.equal((await fetch(base + '/web-health')).status, 200);
console.log(
  'PASS secretless startup: only static web, no credentials/mounts/API/cart requests; hosted links, JPY, test notice, assets, headers and health',
);
