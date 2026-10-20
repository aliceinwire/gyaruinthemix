import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createGameAudioFixtures } from './ci-game-audio-fixtures.mjs';

export function assertGameAudioFixturePermissions(library, output, uid) {
  for (const [name, info, mode] of [
    ['library', library, 0o750],
    ['output', output, 0o2750],
  ]) {
    assert.equal(info.uid, uid, `${name}: fixture owner must be the runner`);
    assert.equal(info.gid, 10001, `${name}: fixture group must be 10001`);
    assert.equal(info.mode & 0o7777, mode, `${name}: private fixture mode`);
  }
}

export async function prepareGameAudioFixturesInContainer({
  root,
  temporary,
  secretFile,
  packagerImage,
  servingImage,
  docker,
}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  const [packager] = JSON.parse(docker('image', 'inspect', packagerImage));
  const [serving] = JSON.parse(docker('image', 'inspect', servingImage));
  for (const image of [packager, serving]) {
    assert.match(image.Id, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      image.Config.Labels['org.opencontainers.image.source'],
      'https://github.com/aliceinwire/gyaruinthemix',
    );
    assert.equal(
      image.Config.Labels['org.opencontainers.image.revision'],
      process.env.GYARUINTHEMIX_REVISION || 'local',
    );
  }
  assert.equal(
    packager.Config.Labels['io.gyaruinthemix.role'],
    'audio-packager',
  );
  const library = join(root, 'assets/music');
  // Reserve an absent destination before touching fixtures. Never read or replace
  // an existing media directory, even on a disposable runner.
  await mkdir(library);
  let fixture;
  const cleanup = async () => {
    await rm(library, { recursive: true, force: true });
    if (fixture) await fixture.cleanup();
  };
  try {
    const deployment = join(temporary, 'packager-contract');
    const checkoutRoot = join(deployment, 'gyaruinthemix');
    await mkdir(join(checkoutRoot, 'assets'), { recursive: true });
    fixture = await createGameAudioFixtures({ checkoutRoot, secretFile });
    const output = join(fixture.library, '.hls');
    await mkdir(output);
    // CI-only synthetic permissions match the production operator UID/group.
    // No generated artifacts are made world-readable to mask permission errors.
    execFileSync('sudo', [
      'chown',
      `${process.getuid()}:10001`,
      fixture.library,
      output,
    ]);
    await chmod(fixture.library, 0o750);
    // Linux may silently clear setgid when the owner is not a member of the
    // newly assigned group. Only this disposable CI fixture uses sudo chmod.
    execFileSync('sudo', ['chmod', '2750', '--', output]);
    assertGameAudioFixturePermissions(
      await stat(fixture.library),
      await stat(output),
      process.getuid(),
    );
    process.stdout.write(
      execFileSync(
        'python3',
        [
          join(root, 'scripts/ci-game-audio-packager.py'),
          deployment,
          packager.Id,
        ],
        { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
      ),
    );
    const catalog = JSON.parse(
      await readFile(join(output, 'catalog.json'), 'utf8'),
    );
    assert.equal(catalog.tracks.length, 1);
    assert.ok(
      catalog.tracks[0].duration >= 8 && catalog.tracks[0].duration < 8.1,
    );
    // Exercise all existing real encoding/format/cache tests with the exact image
    // tools. Host Node only orchestrates Docker and writes deterministic WAV bytes.
    process.stdout.write(
      docker(
        'run',
        '--rm',
        '--pull',
        'never',
        '--read-only',
        '--network',
        'none',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--user',
        `${process.getuid()}:10001`,
        '--memory',
        '192m',
        '--memory-swap',
        '192m',
        '--cpus',
        '0.50',
        '--pids-limit',
        '64',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777',
        '--mount',
        `type=bind,src=${join(root, 'game-audio/tests')},dst=/app/tests,readonly`,
        '--mount',
        `type=bind,src=${join(root, 'game-audio/server')},dst=/app/server,readonly`,
        '--entrypoint',
        'node',
        packager.Id,
        '--jitless',
        '--max-old-space-size=64',
        '--test',
        '--test-concurrency=1',
        '/app/tests/packager.test.mjs',
      ),
    );
    // Serving identity must read exactly the produced permissions, and must not
    // contain transcoding tools. This uses its own immutable tested image ID.
    docker(
      'run',
      '--rm',
      '--pull',
      'never',
      '--read-only',
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      '10001:10001',
      '--memory',
      '96m',
      '--pids-limit',
      '32',
      '--mount',
      `type=bind,src=${fixture.library},dst=/private/media,readonly`,
      '--entrypoint',
      'node',
      serving.Id,
      '--input-type=module',
      '-e',
      "import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process'; import {loadCatalog} from '/app/app.mjs'; assert.equal((await loadCatalog('/private/media/.hls')).size, 1); for (const command of ['ffmpeg','ffprobe']) assert.equal(spawnSync(command,['-version']).error?.code, 'ENOENT');",
    );
    await rename(fixture.library, library);
    console.log(
      'PASS exact offline packager: bounded real updater, RO originals, group-readable output, cache, strict failure and timeout cleanup',
    );
    return { library, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
