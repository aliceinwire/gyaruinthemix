import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Exercise the actual scanner with disposable, locally generated fake credentials.
const root = await mkdtemp(join(tmpdir(), 'gyaru-gitleaks-'));
const git = (...args) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root,
    stdio: 'pipe',
  });
const commit = () =>
  git(
    '-c',
    'user.name=Security fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-qm',
    'Offline fixture',
  );
const scan = (mode) =>
  spawnSync('bash', ['scripts/scan-secrets.sh', mode], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
try {
  git('init', '-q');
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, '.githooks'));
  for (const path of [
    '.gitleaks.toml',
    'scripts/scan-secrets.sh',
    'scripts/install-hooks.sh',
    '.githooks/pre-commit',
  ])
    await copyFile(new URL(`../${path}`, import.meta.url), join(root, path));
  await chmod(join(root, '.githooks/pre-commit'), 0o755);
  await writeFile(
    join(root, 'fixture.txt'),
    [
      'rk_test_UNITTESTONLY',
      'sk_test_UNITTESTONLY',
      'rk_live_UNITTESTONLY',
      'sk_live_UNITTESTONLY',
      'whsec_UNITTESTONLY',
      'rk_test_CIPlaceholderNotARealKey',
      'sk_test_CIPlaceholderNotARealKey',
      'whsec_CIPlaceholderNotARealSecret',
    ].join('\n'),
  );
  git('add', '.');
  assert.equal(
    scan('staged').status,
    0,
    'exact synthetic fixtures must be permitted',
  );
  commit();
  assert.equal(scan('history').status, 0, 'clean history must pass');
  const install = () =>
    spawnSync('bash', ['scripts/install-hooks.sh'], {
      cwd: root,
      encoding: 'utf8',
    });
  git('config', '--local', 'core.hooksPath', 'existing-custom-hooks');
  assert.equal(install().status, 1, 'existing hooks must not be replaced');
  assert.equal(
    execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    'existing-custom-hooks',
  );
  git('config', '--local', '--unset', 'core.hooksPath');
  assert.equal(install().status, 0, 'commit hook installs explicitly');
  const file = join(root, 'fixture.txt');
  for (const prefix of [
    'rk_live_',
    'rk_test_',
    'sk_live_',
    'sk_test_',
    'whsec_',
  ]) {
    const fake = prefix + randomBytes(24).toString('hex');
    await writeFile(file, `credential = "${fake}" // gitleaks:allow\n`);
    git('add', 'fixture.txt');
    await writeFile(
      file,
      'clean working copy; the index still contains the fake credential\n',
    );
    const result = scan('staged');
    assert.equal(
      result.status,
      1,
      `staged ${prefix} must be blocked even with an inline allow comment`,
    );
    assert.ok(
      !(result.stdout + result.stderr).includes(fake),
      'scanner must redact the value',
    );
    const attempt = spawnSync(
      'git',
      [
        '-c',
        'user.name=Security fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '-qm',
        'Must be blocked',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(
      attempt.status,
      0,
      'installed hook must block the actual commit',
    );
    assert.ok(
      !(attempt.stdout + attempt.stderr).includes(fake),
      'hook must redact the value',
    );
    git('add', 'fixture.txt');
    assert.equal(
      scan('staged').status,
      0,
      'removing a staged credential must unblock the commit',
    );
  }
  const fake = 'rk_live_' + randomBytes(24).toString('hex');
  await writeFile(file, fake);
  git('add', 'fixture.txt');
  commit();
  await writeFile(file, 'removed from the current tree\n');
  git('add', 'fixture.txt');
  commit();
  const historical = scan('history');
  assert.equal(
    historical.status,
    1,
    'deleted historical credentials must still block CI',
  );
  assert.ok(
    !(historical.stdout + historical.stderr).includes(fake),
    'history output must be redacted',
  );
  console.log(
    'PASS real Gitleaks: clean/exact fixtures, restricted/unrestricted test/live keys, webhook secrets, staged vs working tree, inline bypass rejection, full history and output redaction',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
