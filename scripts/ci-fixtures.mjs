import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
if (process.env.CHECKOUT_MODE === 'api') {
  await mkdir('secrets', { recursive: true });
  for (const [name, value] of [
    ['stripe_secret_key', 'rk_test_CIPlaceholderNotARealKey'],
    ['stripe_webhook_secret', 'whsec_CIPlaceholderNotARealSecret'],
  ]) {
    const path = `secrets/${name}`;
    await writeFile(path, `${value}\n`, { mode: 0o400 });
    execFileSync('sudo', ['chown', '10001:10001', path]);
  }
} else {
  assert.equal(process.env.CI_PAYMENT_LINK_FIXTURE, 'true');
  const products = JSON.parse(await readFile('config/products.json', 'utf8'));
  Object.assign(products[0], {
    availability: 'available',
    displayPriceJPY: 800,
    paymentLink: 'https://buy.stripe.com/test_CIFixture',
  });
  await writeFile('config/products.json', JSON.stringify(products));
  await writeFile(
    'config/payment-links.json',
    JSON.stringify({
      mode: 'test',
      salesEnabled: true,
      configurationReviewed: true,
      liveModeAck: '',
    }),
  );
}
