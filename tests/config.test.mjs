import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../api/config.mjs';

async function configuration(t) {
  const dir = await mkdtemp(join(tmpdir(), 'gyaru-secrets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = join(dir, 'key');
  const webhook = join(dir, 'webhook');
  await writeFile(key, 'rk_test_UNITTESTONLY\n', { mode: 0o600 });
  await writeFile(webhook, 'whsec_UNITTESTONLY\n', { mode: 0o600 });
  return {
    SITE_URL: 'https://shop.example',
    NODE_ENV: 'production',
    STRIPE_SECRET_KEY_FILE: key,
    STRIPE_WEBHOOK_SECRET_FILE: webhook,
  };
}
test('file secrets load; defaults are TEST with sales disabled', async (t) => {
  const config = readConfig(await configuration(t));
  assert.equal(config.secretKey, 'rk_test_UNITTESTONLY');
  assert.equal(config.mode, 'test');
  assert.equal(config.salesEnabled, false);
});
test('HTTP production, malformed origin and mode changes fail closed', async (t) => {
  const env = await configuration(t);
  for (const overrides of [
    { SITE_URL: 'http://shop.example' },
    { SITE_URL: 'https://shop.example/path' },
    { STRIPE_MODE: 'live' },
    { STRIPE_MODE: 'typo' },
    { SALES_ENABLED: 'yes' },
  ])
    assert.throws(() => readConfig({ ...env, ...overrides }));
});
test('shipping and details acknowledgement required before sales', async (t) => {
  const env = await configuration(t);
  assert.throws(() => readConfig({ ...env, SALES_ENABLED: 'true' }));
  assert.throws(() =>
    readConfig({
      ...env,
      SALES_ENABLED: 'true',
      STORE_DETAILS_REVIEWED: 'true',
    }),
  );
});
test('environment secret values are never substituted for missing file secrets', async (t) => {
  const env = await configuration(t);
  env.STRIPE_SECRET_KEY_FILE = '/missing/unit-test-secret';
  env.STRIPE_SECRET_KEY = 'rk_test_UNITTESTONLY';
  assert.throws(
    () => readConfig(env),
    (error) =>
      !error.message.includes('UNITTESTONLY') &&
      !error.message.includes('/missing'),
  );
});

test('only restricted API keys matching the configured mode are accepted', async (t) => {
  const env = await configuration(t);
  for (const value of [
    'sk_test_UNITTESTONLY',
    'sk_live_UNITTESTONLY',
    'rk_live_UNITTESTONLY',
    'pk_test_UNITTESTONLY',
    'rk_test_...',
    'rk_test_line\nbreak',
    '',
  ]) {
    await writeFile(env.STRIPE_SECRET_KEY_FILE, value);
    assert.throws(() => readConfig(env), {
      message:
        'Invalid store configuration; check README and environment names.',
    });
  }
  await writeFile(env.STRIPE_SECRET_KEY_FILE, 'rk_live_UNITTESTONLY');
  const live = {
    ...env,
    STRIPE_MODE: 'live',
    LIVE_MODE_ACK: 'I_HAVE_COMPLETED_TEST_CHECKOUT',
  };
  assert.equal(readConfig(live).mode, 'live');
  await writeFile(env.STRIPE_SECRET_KEY_FILE, 'rk_test_UNITTESTONLY');
  assert.throws(() => readConfig(live));
});

test('production refuses unsafe permissions on either secret file', async (t) => {
  const env = await configuration(t);
  for (const file of [
    env.STRIPE_SECRET_KEY_FILE,
    env.STRIPE_WEBHOOK_SECRET_FILE,
  ]) {
    for (const mode of [0o644, 0o660, 0o601, 0o700]) {
      await chmod(file, mode);
      assert.throws(() => readConfig(env), {
        message:
          'Invalid store configuration; check README and environment names.',
      });
    }
    for (const mode of [0o400, 0o440, 0o600, 0o640]) {
      await chmod(file, mode);
      assert.equal(readConfig(env).mode, 'test');
    }
    await chmod(file, 0o600);
  }
});

test('secret files must be regular, nonempty, small files; errors reveal no values or paths', async (t) => {
  const env = await configuration(t);
  for (const value of ['', 'x'.repeat(4097), 'malformed-sensitive-input']) {
    await writeFile(env.STRIPE_WEBHOOK_SECRET_FILE, value);
    assert.throws(() => readConfig(env), {
      message:
        'Invalid store configuration; check README and environment names.',
    });
  }
  env.STRIPE_WEBHOOK_SECRET_FILE = join(env.STRIPE_SECRET_KEY_FILE, '..');
  assert.throws(() => readConfig(env), {
    message: 'Invalid store configuration; check README and environment names.',
  });
});
