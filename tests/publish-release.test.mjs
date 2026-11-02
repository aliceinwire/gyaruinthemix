import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  components,
  localImage,
  manifestLabel,
  registry,
  repository,
  source,
} from '../scripts/release-manifest.mjs';

const revision = 'a'.repeat(40);
const previousRevision = 'b'.repeat(40);
const publisher = fileURLToPath(
  new URL('../scripts/publish-release.mjs', import.meta.url),
);

async function publish(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-publish-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'artifacts/release'), { recursive: true });
  const previous = { schema: 1, revision: previousRevision, components: {} };
  const images = {},
    build = {},
    inputs = {};
  for (const [i, name] of components.entries()) {
    build[name] = !options.reuse || name.startsWith('web');
    inputs[name] = 'c'.repeat(64);
    previous.components[name] = {
      digest: 'sha256:' + 'd'.repeat(64),
      revision: previousRevision,
      input: inputs[name],
    };
    images[localImage(name, revision)] = {
      Id: 'sha256:' + String(i + 1).repeat(64),
      RepoDigests: [],
      Config: {
        Labels: {
          'org.opencontainers.image.source': source,
          'org.opencontainers.image.revision': build[name]
            ? revision
            : previousRevision,
          'io.gyaruinthemix.checkout-mode':
            name === 'web-api' ? 'api' : 'payment_links',
          'io.gyaruinthemix.role': 'audio-packager',
        },
      },
    };
  }
  if (options.invalidImage)
    images[localImage('web', revision)].Config.Labels[
      'org.opencontainers.image.source'
    ] = 'invalid';
  const plan = {
    revision,
    deploy: true,
    componentReleases: Boolean(options.reuse),
    build,
    inputs,
    previous: options.reuse ? previous : null,
  };
  await writeFile(
    join(directory, 'artifacts/release/plan.json'),
    JSON.stringify(plan),
  );
  await writeFile(join(directory, 'state.json'), JSON.stringify({ images }));
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
fs.appendFileSync('commands.jsonl', JSON.stringify([tool, ...args]) + '\\n');
if (tool === 'gh') { console.log(process.env.TEST_MAIN_SHA); process.exit(0); }
if (args[0] === 'push' && args[1] === process.env.TEST_FAIL_PUSH) process.exit(1);
const state = JSON.parse(fs.readFileSync('state.json'));
if (args[0] === 'image' && args[1] === 'inspect') {
  if (!state.images[args[2]]) process.exit(2);
  console.log(JSON.stringify([state.images[args[2]]]));
} else if (args[0] === 'tag') {
  state.images[args[2]] = state.images[args[1]];
} else if (args[0] === 'push') {
  const image = state.images[args[1]];
  const reference = args[1].split(':')[0] + '@' + image.Id;
  for (const entry of Object.values(state.images)) {
    if (entry.Id === image.Id && !entry.RepoDigests.includes(reference)) entry.RepoDigests.push(reference);
  }
} else if (args[0] === 'build') {
  if (fs.readFileSync(0, 'utf8') !== 'FROM scratch\\n') process.exit(3);
  const labels = {};
  for (let i = 0; i < args.length; i++) if (args[i] === '--label') {
    const value = args[++i], at = value.indexOf('=');
    labels[value.slice(0, at)] = value.slice(at + 1);
  }
  state.images[args[args.indexOf('-t') + 1]] = {
    Id: 'sha256:' + '9'.repeat(64), RepoDigests: [], Config: { Labels: labels },
  };
} else if (!['login', 'load'].includes(args[0])) process.exit(4);
fs.writeFileSync('state.json', JSON.stringify(state));
`;
  await mkdir(join(directory, 'bin'));
  for (const command of ['docker', 'gh'])
    await writeFile(join(directory, 'bin', command), fake, { mode: 0o700 });
  const result = spawnSync(process.execPath, [publisher], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: join(directory, 'bin') + ':' + process.env.PATH,
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted',
      GITHUB_EVENT_NAME: options.event || 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: revision,
      GITHUB_ACTOR: 'fixture',
      GHCR_TOKEN: 'fixture',
      TEST_MAIN_SHA: options.stale ? previousRevision : revision,
      TEST_FAIL_PUSH: options.failPush || '',
    },
  });
  const commands = (
    await readFile(join(directory, 'commands.jsonl'), 'utf8').catch(() => '')
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    result,
    commands,
    previous,
    state: JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')),
  };
}

test('release pointer is published last and reused components retain their digests and revisions', async (t) => {
  const { result, commands, state, previous } = await publish(t, {
    reuse: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const pushes = commands
    .filter(([, command]) => command === 'push')
    .map(([, , ref]) => ref);
  assert.equal(pushes.at(-1), registry + 'release:main');
  assert.equal(pushes.at(-2), registry + 'release:sha-' + revision);
  assert.deepEqual(
    pushes.filter((ref) => ref.includes(':sha-')),
    [
      registry + 'web:sha-' + revision,
      registry + 'web-api:sha-' + revision,
      registry + 'release:sha-' + revision,
    ],
  );
  const manifest = JSON.parse(
    state.images[registry + 'release:main'].Config.Labels[manifestLabel],
  );
  for (const name of ['api', 'game-audio', 'game-audio-packager'])
    assert.deepEqual(manifest.components[name], previous.components[name]);
  assert.equal(manifest.components.web.revision, revision);
});

test('superseded candidates never authenticate or publish', async (t) => {
  const { result, commands } = await publish(t, { stale: true });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    !commands.some(([, command]) =>
      ['login', 'push', 'build', 'tag'].includes(command),
    ),
  );
});

test('invalid images and pull request events fail before registry authentication', async (t) => {
  for (const options of [{ invalidImage: true }, { event: 'pull_request' }]) {
    const { result, commands } = await publish(t, options);
    assert.notEqual(result.status, 0);
    assert.ok(
      !commands.some(([, command]) => ['login', 'push'].includes(command)),
    );
  }
});

test('component publication failure cannot advance the release pointer', async (t) => {
  const { result, commands } = await publish(t, {
    failPush: registry + 'api:main',
  });
  assert.notEqual(result.status, 0);
  assert.ok(
    !commands.some(
      ([, command, ref]) =>
        command === 'push' && ref === registry + 'release:main',
    ),
  );
});
