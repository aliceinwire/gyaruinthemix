import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWwwRedirect } from './check-www-redirect.mjs';
import { checkGameTest } from './check-game-test.mjs';
import { createGameAudioFixtures } from './ci-game-audio-fixtures.mjs';
import { checkGameAudioRuntime } from './check-game-audio-runtime.mjs';
import {
  assertGameAudioCompose,
  GAME_AUDIO_SERVICE,
} from '../game-audio/scripts/check-game-audio-compose.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.match(
  process.env.COMPOSE_PROJECT_NAME || '',
  /^gyaruinthemix-ci-\d+-\d+$/,
);
const apiMode = process.env.CHECKOUT_MODE === 'api';
assert.ok(
  ['false', 'true'].includes(process.env.GAME_AUDIO_ENABLED || 'false'),
);
const audioEnabled = process.env.GAME_AUDIO_ENABLED === 'true';
const configOnly = process.argv.includes('--config-only');
const noBuild = process.argv.includes('--no-build');
const buildAudioOnly = process.argv.includes('--build-audio-only');
assert.ok(!(noBuild && buildAudioOnly));
assert.ok(!buildAudioOnly || audioEnabled);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'gyaru-merged-'));
const directory = join(temporary, 'bouncer');
const project = `${process.env.COMPOSE_PROJECT_NAME}-bouncer`;
const env = {
  ...process.env,
  COMPOSE_PROFILES: [apiMode && 'checkout-api', audioEnabled && 'game-audio']
    .filter(Boolean)
    .join(','),
  GAME_AUDIO_ENABLED: String(audioEnabled),
  GAME_AUDIO_SIGNING_KEY_FILE: join(temporary, 'ci_audio_signing_fixture'),
  CHECKOUT_MODE: apiMode ? 'api' : 'payment_links',
  COMPOSE_PROJECT_NAME: project,
  COMPOSE_FILE: join(directory, 'docker-compose.yml'),
  STORE_DOMAIN: 'gyaruinthemix.example',
  STORE_HOSTS: '',
  SITE_URL: 'https://gyaruinthemix.example',
  LETSENCRYPT_EMAIL: 'ci@example.test',
  GYARUINTHEMIX_WEB_IMAGE: `gyaruinthemix-web:${process.env.IMAGE_TAG}`,
  GYARUINTHEMIX_API_IMAGE: `gyaruinthemix-api:${process.env.IMAGE_TAG}`,
  GYARUINTHEMIX_GAME_AUDIO_IMAGE: `gyaruinthemix-game-audio:${process.env.GAME_AUDIO_IMAGE_TAG || process.env.IMAGE_TAG}`,
  STRIPE_MODE: 'test',
  SALES_ENABLED: 'false',
  CI_LAYOUT: 'bouncer',
};
const docker = (...args) =>
  execFileSync('docker', args, {
    cwd: directory,
    env,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
let started = false;
let audioFixtures;
try {
  await mkdir(directory);
  await symlink(root, join(directory, 'gyaruinthemix'), 'dir');
  await copyFile(
    join(root, 'deploy/bouncer/docker-compose.yml'),
    env.COMPOSE_FILE,
  );
  const render = (file) =>
    JSON.parse(
      docker(
        'compose',
        '--project-directory',
        directory,
        '-f',
        file,
        'config',
        '--format',
        'json',
      ),
    );
  const original = render(join(root, 'tests/fixtures/bouncer.original.yml'));
  const merged = render(env.COMPOSE_FILE);
  const oldServices = ['proxy', 'letsencrypt-companion', 'znc', 'limnoria'];
  const appServices = [
    ...(apiMode ? ['gyaruinthemix-api'] : []),
    ...(audioEnabled ? [GAME_AUDIO_SERVICE] : []),
    'gyaruinthemix-web',
  ];
  assertGameAudioCompose({
    original,
    config: merged,
    audioEnabled,
    apiMode,
    checkoutRoot: join(directory, 'gyaruinthemix'),
    expectedMediaSource: join(directory, 'gyaruinthemix/assets/music'),
    expectedSecretFile: env.GAME_AUDIO_SIGNING_KEY_FILE,
    expectedImage: env.GYARUINTHEMIX_GAME_AUDIO_IMAGE,
  });
  assert.deepEqual(
    Object.keys(merged.services).sort(),
    [...oldServices, ...appServices].sort(),
  );
  for (const name of oldServices)
    assert.deepEqual(
      merged.services[name],
      original.services[name],
      `${name} must remain unchanged`,
    );
  for (const name of Object.keys(original.volumes))
    assert.deepEqual(merged.volumes[name], original.volumes[name]);
  for (const name of Object.keys(original.networks))
    assert.deepEqual(merged.networks[name], original.networks[name]);
  assert.equal(merged.name, original.name);
  assert.doesNotMatch(await readFile(env.COMPOSE_FILE, 'utf8'), /^name:/m);
  const web = merged.services['gyaruinthemix-web'];
  const api = merged.services['gyaruinthemix-api'];
  assert.deepEqual(Object.keys(web.networks).sort(), [
    'gyaruinthemix',
    'proxy-tier',
  ]);
  if (apiMode) {
    assert.deepEqual(Object.keys(api.networks), ['gyaruinthemix']);
    assert.ok(api.networks.gyaruinthemix.aliases.includes('api'));
  }
  assert.equal(merged.networks['proxy-tier'].name, 'nginx-proxy');
  if (apiMode) {
    assert.equal(
      api.environment.SITE_URL,
      `https://${web.environment.VIRTUAL_HOST}`,
    );
  }
  assert.equal(web.environment.LETSENCRYPT_HOST, web.environment.VIRTUAL_HOST);
  // www is opt-in routing/TLS only; checkout remains bound to the apex origin.
  env.STORE_DOMAIN = 'gyaruinthemix.com';
  env.STORE_HOSTS = `${env.STORE_DOMAIN},www.gyaruinthemix.com`;
  const staged = render(env.COMPOSE_FILE);
  const stagedWeb = staged.services['gyaruinthemix-web'];
  assert.equal(stagedWeb.environment.VIRTUAL_HOST, env.STORE_HOSTS);
  assert.equal(stagedWeb.environment.LETSENCRYPT_HOST, env.STORE_HOSTS);
  if (apiMode)
    assert.equal(
      staged.services['gyaruinthemix-api'].environment.SITE_URL,
      'https://gyaruinthemix.com',
    );
  for (const name of oldServices)
    assert.deepEqual(staged.services[name], original.services[name]);
  env.STORE_DOMAIN = 'gyaruinthemix.example';
  env.STORE_HOSTS = '';

  assert.equal(web.environment.GAME_AUDIO_ENABLED, String(audioEnabled));
  if (audioEnabled) {
    const audio = merged.services[GAME_AUDIO_SERVICE];
    assert.equal(audio.environment.GAME_AUDIO_ENABLED, 'true');
    assert.equal(
      audio.environment.AUDIO_ORIGIN,
      'https://gyaruinthemix.example',
    );
    assert.deepEqual(audio.build.labels, {
      'org.opencontainers.image.source':
        'https://github.com/aliceinwire/gyaruinthemix',
      'org.opencontainers.image.revision':
        process.env.GYARUINTHEMIX_REVISION || 'local',
    });
  }
  assert.equal(web.environment.VIRTUAL_PORT, '8080');
  assert.equal(web.environment.HTTPS_METHOD, 'redirect');
  assert.ok(!web.depends_on);
  assert.equal(web.build.args.CHECKOUT_MODE, apiMode ? 'api' : 'payment_links');
  if (apiMode) {
    assert.deepEqual(api.profiles, ['checkout-api']);
    assert.ok(!api.depends_on);
  } else assert.equal(api, undefined);
  for (const service of apiMode ? [web, api] : [web]) {
    assert.equal(service.ports?.length || 0, 0);
    assert.equal(service.build.context, join(directory, 'gyaruinthemix'));
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.ok(!service.volumes?.some((volume) => volume.type === 'bind'));
  }
  if (apiMode) {
    assert.deepEqual(
      api.volumes.map((volume) => volume.source),
      ['gyaruinthemix_webhook_state'],
    );
    assert.ok(!web.secrets?.length);
    for (const name of ['stripe_secret_key', 'stripe_webhook_secret']) {
      const secret = merged.secrets[`gyaruinthemix_${name}`];
      assert.equal(secret.file, join(directory, 'gyaruinthemix/secrets', name));
      assert.ok(
        api.secrets.some(
          (item) =>
            item.source === `gyaruinthemix_${name}` && item.target === name,
        ),
      );
    }
  }
  assert.ok(!web.secrets?.length);
  console.log(
    'PASS merged Compose: four original services/networks/volumes preserved, website paths, secret targets, API alias and isolation',
  );
  if (!configOnly) {
    if (audioEnabled)
      audioFixtures = await createGameAudioFixtures({
        checkoutRoot: resolve(root),
        secretFile: env.GAME_AUDIO_SIGNING_KEY_FILE,
      });
    // Only the runner gets a private test port and uniquely named proxy network.
    // No proxy, companion, ZNC or Limnoria image is built or started in this test.
    const override = join(directory, 'ci.yaml');
    await writeFile(
      override,
      `services:\n  gyaruinthemix-web:\n    ports: ["127.0.0.1:8089:8080"]\nnetworks:\n  proxy-tier:\n    name: ${project}-proxy\n`,
    );
    env.COMPOSE_FILE += `:${override}`;
    if (!noBuild)
      docker(
        'compose',
        'build',
        '--pull',
        ...(buildAudioOnly ? [GAME_AUDIO_SERVICE] : appServices),
      );
    // Reused release images are never rebuilt between their smoke test and push.
    for (const service of appServices) {
      const [image] = JSON.parse(
        docker('image', 'inspect', merged.services[service].image),
      );
      assert.equal(
        image.Config.Labels['org.opencontainers.image.source'],
        'https://github.com/aliceinwire/gyaruinthemix',
      );
      assert.equal(
        image.Config.Labels['org.opencontainers.image.revision'],
        process.env.GYARUINTHEMIX_REVISION || 'local',
      );
    }
    started = true;
    docker(
      'compose',
      'up',
      '--no-build',
      '--no-deps',
      '--pull',
      'never',
      '--wait',
      '--wait-timeout',
      '120',
      ...appServices,
    );
    docker('compose', 'exec', '-T', 'gyaruinthemix-web', 'nginx', '-t');
    const running = docker('compose', 'ps', '--services', '--status', 'running')
      .trim()
      .split('\n')
      .sort();
    assert.deepEqual(running, appServices);
    const smoke = () =>
      process.stdout.write(
        execFileSync(
          process.execPath,
          [
            join(
              root,
              apiMode ? 'scripts/ci-smoke.mjs' : 'scripts/ci-secretless.mjs',
            ),
          ],
          {
            cwd: directory,
            env,
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
          },
        ),
      );
    const audioSmoke = async () => {
      await checkGameAudioRuntime('http://127.0.0.1:8089', {
        enabled: audioEnabled,
      });
      if (!audioEnabled) return;
      const [container] = JSON.parse(
        docker(
          'inspect',
          docker('compose', 'ps', '-q', GAME_AUDIO_SERVICE).trim(),
        ),
      );
      assert.equal(container.State.Health.Status, 'healthy');
      assert.equal(container.State.OOMKilled, false);
      assert.equal(container.Config.User, '10001:10001');
      assert.equal(container.HostConfig.ReadonlyRootfs, true);
      assert.equal(container.HostConfig.Privileged, false);
      assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
      assert.ok(
        container.HostConfig.SecurityOpt.includes('no-new-privileges:true'),
      );
      assert.ok(
        container.HostConfig.Memory >= 32 * 1024 * 1024 &&
          container.HostConfig.Memory <= 192 * 1024 * 1024,
      );
      assert.ok(
        container.HostConfig.NanoCpus > 0 &&
          container.HostConfig.NanoCpus <= 750000000,
      );
      assert.ok(
        container.HostConfig.PidsLimit > 0 &&
          container.HostConfig.PidsLimit <= 64,
      );
      assert.deepEqual(container.HostConfig.PortBindings || {}, {});
      assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1);
      assert.deepEqual(
        container.Mounts.map((mount) => mount.Destination).sort(),
        ['/private/media', '/run/secrets/game_audio_signing_key'],
      );
      assert.ok(container.Mounts.every((mount) => mount.RW === false));
    };
    smoke();
    await audioSmoke();
    await checkWwwRedirect('http://127.0.0.1:8089');
    await checkGameTest('http://127.0.0.1:8089');
    docker('compose', 'restart', ...appServices);
    docker(
      'compose',
      'up',
      '--no-build',
      '--no-deps',
      '--pull',
      'never',
      '--wait',
      '--wait-timeout',
      '120',
      ...appServices,
    );
    smoke();
    await audioSmoke();
    await checkWwwRedirect('http://127.0.0.1:8089');
    await checkGameTest('http://127.0.0.1:8089');
    if (audioEnabled) {
      docker('compose', 'stop', GAME_AUDIO_SERVICE);
      await checkGameAudioRuntime('http://127.0.0.1:8089', { enabled: false });
      await checkGameTest('http://127.0.0.1:8089');
      docker(
        'compose',
        'up',
        '--no-build',
        '--no-deps',
        '--pull',
        'never',
        '--wait',
        '--wait-timeout',
        '120',
        GAME_AUDIO_SERVICE,
      );
      await audioSmoke();
    }
    console.log(
      'PASS merged website startup and restart; existing services were never started',
    );
  }
} catch (error) {
  if (started) {
    try {
      process.stdout.write(
        docker(
          'compose',
          'logs',
          '--no-color',
          '--tail',
          '50',
          'gyaruinthemix-web',
        ),
      );
    } catch {
      /* Preserve the original failure. */
    }
  }
  throw error;
} finally {
  try {
    if (started)
      docker(
        'compose',
        'down',
        '--volumes',
        '--remove-orphans',
        '--timeout',
        '20',
      );
  } finally {
    try {
      if (audioFixtures) await audioFixtures.cleanup();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
