import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_FIXTURE_KEY,
  AUDIO_FIXTURE_SOURCE,
  createGameAudioFixtures,
  syntheticWave,
} from '../scripts/ci-game-audio-fixtures.mjs';
import { assertPrivateAudioDenied } from '../scripts/check-game-audio-runtime.mjs';
import { checkServedHlsModule } from '../scripts/check-game-test.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ga-canonical-ci-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('CI creates deterministic bounded PCM without host packaging tools', async (t) => {
  const directory = await temporary(t);
  const checkoutRoot = join(directory, 'checkout');
  const secretFile = join(directory, 'fixture-secret');
  await mkdir(join(checkoutRoot, 'assets'), { recursive: true });
  const fixture = await createGameAudioFixtures({ checkoutRoot, secretFile });
  assert.equal(await readFile(secretFile, 'utf8'), AUDIO_FIXTURE_KEY);
  assert.equal((await stat(secretFile)).mode & 0o777, 0o444);
  const wave = await readFile(join(fixture.library, AUDIO_FIXTURE_SOURCE));
  assert.ok(wave.length < 1024 * 1024);
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wave.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wave.readUInt16LE(20), 1);
  assert.equal(wave.readUInt32LE(24), 48000);
  assert.equal(wave.length, 44 + 8 * 48000 * 2);
  assert.deepEqual(wave, syntheticWave());
  assert.throws(() => syntheticWave(13));
  await assert.rejects(access(join(fixture.library, '.hls')), {
    code: 'ENOENT',
  });
  await fixture.cleanup();
  await assert.rejects(access(fixture.library), { code: 'ENOENT' });
  await assert.rejects(access(secretFile), { code: 'ENOENT' });
});

test('CI refuses any existing media library or signing file without modifying it', async (t) => {
  const directory = await temporary(t);
  const checkoutRoot = join(directory, 'checkout');
  const library = join(checkoutRoot, 'assets/music');
  const secretFile = join(directory, 'existing-secret');
  await mkdir(library, { recursive: true });
  await writeFile(join(library, 'keep.txt'), 'do not touch');
  await assert.rejects(createGameAudioFixtures({ checkoutRoot, secretFile }), {
    code: 'EEXIST',
  });
  assert.equal(
    await readFile(join(library, 'keep.txt'), 'utf8'),
    'do not touch',
  );
  await rm(library, { recursive: true });
  await writeFile(secretFile, 'do not touch');
  await assert.rejects(createGameAudioFixtures({ checkoutRoot, secretFile }), {
    code: 'EEXIST',
  });
  assert.equal(await readFile(secretFile, 'utf8'), 'do not touch');
  await assert.rejects(access(library), { code: 'ENOENT' });
});

async function publishingFixture(t, extraEnv = {}) {
  const directory = await temporary(t);
  const log = join(directory, 'docker-calls.jsonl');
  await writeFile(log, '');
  await writeFile(
    join(directory, 'docker'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'image' && args[1] === 'inspect') {
  const image = args[2], format = args[4];
  if (format.includes('revision')) console.log(((process.env.BAD_AUDIO === 'true' && image.startsWith('gyaruinthemix-game-audio:')) || (process.env.BAD_PACKAGER_REVISION === 'true' && image.startsWith('gyaruinthemix-game-audio-packager:'))) ? 'unreviewed' : process.env.GITHUB_SHA);
  else if (format.includes('source')) console.log(((process.env.BAD_SOURCE === 'true' && image.startsWith('gyaruinthemix-game-audio:')) || (process.env.BAD_PACKAGER_SOURCE === 'true' && image.startsWith('gyaruinthemix-game-audio-packager:'))) ? 'https://other.example/repo' : 'https://github.com/' + process.env.GITHUB_REPOSITORY);
  else if (format.includes('io.gyaruinthemix.role')) console.log(process.env.BAD_PACKAGER_ROLE === 'true' ? 'web' : 'audio-packager');
  else if (format.includes('checkout-mode')) console.log(image.includes('release-links-') ? 'payment_links' : 'api');
  else process.exit(1);
} else if (args[0] === 'login') fs.readFileSync(0);
else if (!['tag', 'push'].includes(args[0])) process.exit(1);
`,
    { mode: 0o755 },
  );
  const sha = 'a'.repeat(40);
  const env = {
    PATH: `${directory}:${process.env.PATH}`,
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'aliceinwire/gyaruinthemix',
    GITHUB_SHA: sha,
    GITHUB_ACTOR: 'ci-fixture',
    GHCR_TOKEN: 'PUBLIC_TEST_PLACEHOLDER',
    TEST_LOG: log,
    ...extraEnv,
  };
  let error;
  try {
    execFileSync('bash', [join(root, 'scripts/publish-images.sh')], {
      env,
      stdio: 'pipe',
    });
  } catch (caught) {
    error = caught;
  }
  const calls = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { calls, error, sha };
}

test('trusted main publishes only the five exact smoke-tested images', async (t) => {
  const { calls, error, sha } = await publishingFixture(t);
  assert.equal(error, undefined);
  const names = ['web', 'web-api', 'api', 'game-audio', 'game-audio-packager'];
  assert.deepEqual(
    calls
      .filter(([command]) => command === 'push')
      .map(([, destination]) => destination),
    [
      ...names.map(
        (name) => `ghcr.io/aliceinwire/gyaruinthemix-${name}:sha-${sha}`,
      ),
      ...names
        .toReversed()
        .map((name) => `ghcr.io/aliceinwire/gyaruinthemix-${name}:main`),
    ],
  );
  const audioTags = calls.filter(
    ([command, source]) =>
      command === 'tag' && source.startsWith('gyaruinthemix-game-audio:'),
  );
  assert.equal(audioTags.length, 2);
  assert.ok(
    audioTags.every(
      ([, source]) =>
        source === `gyaruinthemix-game-audio:release-audio-${sha}`,
    ),
  );
  const packagerTags = calls.filter(
    ([command, source]) =>
      command === 'tag' &&
      source.startsWith('gyaruinthemix-game-audio-packager:'),
  );
  assert.equal(packagerTags.length, 2);
  assert.ok(
    packagerTags.every(
      ([, source]) =>
        source === `gyaruinthemix-game-audio-packager:release-audio-${sha}`,
    ),
  );
  assert.ok(calls.findIndex(([command]) => command === 'login') > 12);
  assert.ok(
    !calls.some(([command]) => ['build', 'pull', 'compose'].includes(command)),
  );
});

for (const [name, env] of [
  ['pull requests', { GITHUB_EVENT_NAME: 'pull_request' }],
  ['non-main refs', { GITHUB_REF: 'refs/heads/audio' }],
  ['fork repositories', { GITHUB_REPOSITORY: 'other/gyaruinthemix' }],
  ['audio revision mismatch', { BAD_AUDIO: 'true' }],
  ['audio source mismatch', { BAD_SOURCE: 'true' }],
  ['packager revision mismatch', { BAD_PACKAGER_REVISION: 'true' }],
  ['packager source mismatch', { BAD_PACKAGER_SOURCE: 'true' }],
  ['packager role mismatch', { BAD_PACKAGER_ROLE: 'true' }],
])
  test(`publication rejects ${name} before authenticating or pushing`, async (t) => {
    const { calls, error } = await publishingFixture(t, env);
    assert.ok(error);
    assert.ok(
      !calls.some(([command]) => ['login', 'tag', 'push'].includes(command)),
    );
  });

test('canonical CI covers both checkout modes with default-off and enabled audio', async () => {
  const workflow = await readFile(
    join(root, '.github/workflows/ci.yml'),
    'utf8',
  );
  assert.match(
    workflow,
    /mode: \[payment_links, api\]\s+audio: \['false', 'true'\]/,
  );
  assert.match(workflow, /node scripts\/ci-bouncer.mjs --config-only/);
  assert.match(workflow, /node scripts\/ci-bouncer.mjs --build-audio-only/);
  assert.match(workflow, /node scripts\/ci-bouncer.mjs --no-build/);
  assert.doesNotMatch(workflow, /apt-get.*ffmpeg|Install.*audio.*tools/i);
  const smoke = await readFile(join(root, 'scripts/ci-bouncer.mjs'), 'utf8');
  assert.match(smoke, /deploy\/bouncer\/docker-compose.yml/);
  assert.doesNotMatch(smoke, /docker-compose\.game-audio/);
});

test('served HLS module requires JavaScript MIME, nosniff and valid module syntax', async () => {
  const source = await readFile(
    join(root, 'public/game-test/src/vendor/hls.light.min.mjs'),
    'utf8',
  );
  const response = (body, type = 'application/javascript; charset=utf-8') =>
    new Response(body, {
      headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' },
    });
  for (const type of [
    'application/javascript; charset=utf-8',
    'text/javascript',
  ])
    await assert.doesNotReject(checkServedHlsModule(response(source, type)));
  await assert.rejects(
    checkServedHlsModule(response(source, 'application/octet-stream')),
    /JavaScript MIME/,
  );
  await assert.rejects(
    checkServedHlsModule(
      response('<!doctype html><html><body>Fallback</body></html>'),
    ),
  );
  await assert.rejects(
    checkServedHlsModule(response('export { missing as default };')),
    /Command failed/,
  );
  await assert.rejects(
    checkServedHlsModule(
      new Response(source, {
        headers: { 'Content-Type': 'application/javascript' },
      }),
    ),
  );
});

test('private audio paths accept deny403 or missing404 but never media/catalog payloads', async () => {
  const path = '/assets/music/.hls/catalog.json';
  for (const status of [403, 404]) {
    await assert.doesNotReject(
      assertPrivateAudioDenied(
        new Response('<html>Access denied</html>', {
          status,
          headers: { 'Content-Type': 'text/html' },
        }),
        path,
      ),
    );
    await assert.rejects(
      assertPrivateAudioDenied(
        new Response('{"tracks":[]}', {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
        path,
      ),
    );
    await assert.rejects(
      assertPrivateAudioDenied(
        new Response('media bytes', {
          status,
          headers: { 'Content-Type': 'audio/mp4' },
        }),
        path,
      ),
    );
    await assert.rejects(
      assertPrivateAudioDenied(
        new Response(AUDIO_FIXTURE_KEY, { status }),
        path,
      ),
    );
    await assert.rejects(
      assertPrivateAudioDenied(new Response('#EXTM3U', { status }), path),
    );
  }
  await assert.rejects(
    assertPrivateAudioDenied(new Response('not denied', { status: 200 }), path),
  );
});

test('offline packaging remains a separate bounded target with no host-tool fallback', async () => {
  const recipe = await readFile(join(root, 'Dockerfile.game-audio'), 'utf8');
  assert.match(recipe, /FROM node:24\.[^ ]+-alpine3\.23 AS packager/);
  assert.match(recipe, /apk add --no-cache ffmpeg coreutils/);
  assert.match(recipe, /io\.gyaruinthemix\.role="audio-packager"/);
  assert.match(
    recipe,
    /umask 0027; exec timeout --signal=TERM --kill-after=5s 600s node --jitless --max-old-space-size=64/,
  );
  assert.match(
    recipe,
    /\/app\/scripts\/package-library\.mjs \/library\/assets\/music --strict/,
  );
  const serving = recipe.split(/FROM [^\n]+ AS serving/)[1];
  assert.ok(serving);
  assert.doesNotMatch(serving, /apk add|package-library|ffmpeg|ffprobe/);
  assert.match(serving, /USER 10001:10001/);
  assert.match(
    await readFile(join(root, '.dockerignore'), 'utf8'),
    /^!game-audio\/scripts\/package-library\.mjs$/m,
  );
  const smoke = await readFile(join(root, 'scripts/ci-bouncer.mjs'), 'utf8');
  assert.match(smoke, /if \(!noBuild\)[\s\S]*'--target',[\s\S]*'packager'/);
  const fixture = await readFile(
    join(root, 'scripts/ci-game-audio-fixtures.mjs'),
    'utf8',
  );
  assert.doesNotMatch(fixture, /packageLibrary|execFile|spawn\(/);
  const contracts = await readFile(
    join(root, 'scripts/ci-game-audio-packager.mjs'),
    'utf8',
  );
  assert.match(contracts, /packager\.Id/);
  assert.match(contracts, /\/app\/tests\/packager\.test\.mjs/);
  assert.match(contracts, /'10001:10001'/);
  const lifecycle = await readFile(
    join(root, 'scripts/ci-game-audio-packager.py'),
    'utf8',
  );
  assert.match(lifecycle, /updater\.package_audio\(image_id\)/);
  assert.match(lifecycle, /EROFS/);
  assert.match(lifecycle, /TimeoutExpired/);
  assert.match(lifecycle, /updater\.assert_removed\(\)/);
});
