import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gyaru-secret-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  const script = join(root, 'scripts/setup-secret.sh');
  await copyFile(
    new URL('../scripts/setup-secret.sh', import.meta.url),
    script,
  );
  return {
    root,
    run: (value, kind = 'stripe_secret_key') =>
      spawnSync('bash', ['-x', script, kind, '--local'], {
        input: `${value}\n`,
        encoding: 'utf8',
        timeout: 5000,
      }),
  };
}

test('setup installs restricted keys privately, rotates atomically, and disables shell tracing', async (t) => {
  const { root, run } = await fixture(t);
  for (const value of ['rk_test_UNITTESTONLY', 'rk_live_UNITTESTONLY']) {
    const result = run(value);
    assert.equal(result.status, 0);
    assert.ok(!(result.stdout + result.stderr).includes(value));
    assert.equal(
      await readFile(join(root, 'secrets/stripe_secret_key'), 'utf8'),
      value,
    );
    assert.equal(
      (await stat(join(root, 'secrets/stripe_secret_key'))).mode & 0o777,
      0o600,
    );
    assert.equal((await stat(join(root, 'secrets'))).mode & 0o777, 0o700);
  }
});

test('setup rejects unrestricted/malformed keys without replacing an existing key', async (t) => {
  const { root, run } = await fixture(t);
  assert.equal(run('rk_test_UNITTESTONLY').status, 0);
  for (const value of [
    'sk_test_UNITTESTONLY',
    'sk_live_UNITTESTONLY',
    'rk_test_...',
    'pk_test_UNITTESTONLY',
    '',
  ]) {
    const result = run(value);
    assert.notEqual(result.status, 0);
    if (value) assert.ok(!(result.stdout + result.stderr).includes(value));
    assert.equal(
      await readFile(join(root, 'secrets/stripe_secret_key'), 'utf8'),
      'rk_test_UNITTESTONLY',
    );
  }
  assert.deepEqual(await readdir(join(root, 'secrets')), ['stripe_secret_key']);
});

test('webhook signing secrets remain separate and hidden', async (t) => {
  const { root, run } = await fixture(t);
  const value = 'whsec_UNITTESTONLY';
  const result = run(value, 'stripe_webhook_secret');
  assert.equal(result.status, 0);
  assert.ok(!(result.stdout + result.stderr).includes(value));
  assert.equal(
    await readFile(join(root, 'secrets/stripe_webhook_secret'), 'utf8'),
    value,
  );
});

test('setup refuses symlinked directories and secret destinations', async (t) => {
  const { root, run } = await fixture(t);
  const target = join(root, 'elsewhere');
  await mkdir(target, { mode: 0o755 });
  await symlink(target, join(root, 'secrets'));
  assert.notEqual(run('rk_test_UNITTESTONLY').status, 0);
  assert.deepEqual(await readdir(target), []);
  assert.equal((await stat(target)).mode & 0o777, 0o755);
  await rm(join(root, 'secrets'));
  await mkdir(join(root, 'secrets'), { mode: 0o700 });
  await symlink(target, join(root, 'secrets/stripe_secret_key'));
  assert.notEqual(run('rk_test_UNITTESTONLY').status, 0);
  assert.deepEqual(await readdir(target), []);
});
