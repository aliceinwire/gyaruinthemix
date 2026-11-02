import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  allScopes,
  changedFiles,
  classify,
  componentInputs,
  makePlan,
} from '../scripts/ci-plan.mjs';
import { checkResults } from '../scripts/ci-result.mjs';
import { components } from '../scripts/release-manifest.mjs';

const revision = 'a'.repeat(40);
const inputs = Object.fromEntries(
  components.map((name) => [name, '1'.repeat(64)]),
);
const previous = {
  schema: 1,
  revision: 'b'.repeat(40),
  components: Object.fromEntries(
    components.map((name) => [
      name,
      {
        revision: 'b'.repeat(40),
        digest: 'sha256:' + '2'.repeat(64),
        input: inputs[name],
      },
    ]),
  ),
};
const plan = (paths, extra = {}) =>
  makePlan({
    paths,
    revision,
    inputs,
    previous,
    componentReleases: true,
    ...extra,
  });

test('game logic rebuilds only web variants and selects game checks', () => {
  const result = plan(['public/game/src/simulation.js']);
  assert.deepEqual(
    Object.entries(result.build)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    ['web', 'web-api'],
  );
  assert.deepEqual(result.scopes, ['game']);
  assert.deepEqual(result.browser.include, [
    { suite: 'game', mode: 'payment_links' },
  ]);
});

test('game radio changes also exercise audio integration without rebuilding its server', () => {
  const result = plan(['public/game/src/stream-audio.js']);
  assert.ok(result.scopes.includes('audio'));
  assert.equal(result.build['game-audio'], false);
  assert.ok(result.containers.include.some(({ audio }) => audio === 'true'));
});

test('website, API and audio component changes have independent build boundaries', () => {
  for (const [path, names] of [
    ['src/pages/about.astro', ['web', 'web-api']],
    ['api/server.mjs', ['api']],
    ['game-audio/server/app.mjs', ['game-audio']],
    ['game-audio/scripts/package-library.mjs', ['game-audio-packager']],
  ])
    assert.deepEqual(
      Object.entries(plan([path]).build)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
      names,
    );
});

test('shared versions, dependencies and unknown paths expand coverage', () => {
  assert.deepEqual(classify('src/data/release.mjs').scopes, ['site', 'game']);
  for (const path of [
    'package-lock.json',
    'future-component/entry.js',
    '.github/workflows/ci.yml',
  ]) {
    const result = plan([path]);
    assert.deepEqual(result.scopes, [...allScopes].sort());
    assert.ok(Object.values(result.build).every(Boolean));
    assert.equal(result.containers.include.length, 4);
  }
});

test('documentation and tests never publish production images', () => {
  for (const paths of [
    ['README.md', 'deploy/bouncer/README.md'],
    ['tests/game-survival.test.mjs'],
    ['tests/test_bouncer_update.py'],
  ]) {
    const result = plan(paths);
    assert.equal(result.deploy, false);
    assert.ok(Object.values(result.build).every((value) => !value));
  }
  assert.deepEqual(plan(['README.md']).browser.include, []);
  assert.equal(
    plan(['tests/browser/game-test.mjs']).browser.include[0].suite,
    'game',
  );
});

test('legacy mode publishes a coherent revision until the host is migrated', () => {
  assert.ok(
    Object.values(
      plan(['public/game/main.js'], { componentReleases: false }).build,
    ).every(Boolean),
  );
});

test('a changed component fingerprint prevents reuse even if a path was missed', () => {
  const changedInputs = { ...inputs, api: '3'.repeat(64) };
  assert.equal(plan([], { inputs: changedInputs }).build.api, true);
});

test('release comparisons retain unpublished merges and both sides of a rename', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-diff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = process.cwd();
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Arisu Tachibana');
  git('config', 'user.email', 'arisut@riseup.net');
  await mkdir(join(directory, 'src/pages'), { recursive: true });
  await mkdir(join(directory, 'public/game'), { recursive: true });
  await writeFile(join(directory, 'src/pages/index.astro'), 'original');
  await writeFile(join(directory, 'public/game/main.js'), 'original');
  git('add', '.');
  git('commit', '-m', 'Initial sources');
  const released = git('rev-parse', 'HEAD');
  await writeFile(join(directory, 'src/pages/index.astro'), 'updated page');
  git('add', '.');
  git('commit', '-m', 'Update website');
  await rename(
    join(directory, 'public/game/main.js'),
    join(directory, 'public/game/play.js'),
  );
  git('add', '.');
  git('commit', '-m', 'Move game entry');
  const head = git('rev-parse', 'HEAD');
  try {
    process.chdir(directory);
    assert.deepEqual(changedFiles(released, head).sort(), [
      'public/game/main.js',
      'public/game/play.js',
      'src/pages/index.astro',
    ]);
    const old = componentInputs(released),
      current = componentInputs(head);
    assert.notEqual(old.web, current.web);
    assert.equal(old.api, current.api);
  } finally {
    process.chdir(cwd);
  }
});

test('the final gate rejects failed, cancelled or unexpectedly skipped checks', () => {
  const needs = {
    changes: {
      result: 'success',
      outputs: { has_browser: 'true', has_containers: 'true', deploy: 'true' },
    },
    ...Object.fromEntries(
      ['source', 'secrets', 'static', 'browser', 'containers', 'prepare'].map(
        (name) => [name, { result: 'success' }],
      ),
    ),
  };
  const check = (value) =>
    checkResults(value, 'push', 'refs/heads/main', 'aliceinwire/gyaruinthemix');
  assert.doesNotThrow(() => check(needs));
  for (const result of ['failure', 'cancelled', 'skipped'])
    for (const name of [
      'source',
      'secrets',
      'static',
      'browser',
      'containers',
      'prepare',
    ])
      assert.throws(
        () => check({ ...needs, [name]: { result } }),
        new RegExp(name),
      );
  const docs = structuredClone(needs);
  docs.changes.outputs = {
    has_browser: 'false',
    has_containers: 'false',
    deploy: 'false',
  };
  for (const name of ['static', 'browser', 'containers', 'prepare'])
    docs[name].result = 'skipped';
  assert.doesNotThrow(() => check(docs));
});
