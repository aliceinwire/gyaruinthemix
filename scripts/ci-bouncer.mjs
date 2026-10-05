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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.match(
  process.env.COMPOSE_PROJECT_NAME || '',
  /^gyaruinthemix-ci-\d+-\d+$/,
);
const apiMode = process.env.CHECKOUT_MODE === 'api';
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'gyaru-merged-'));
const directory = join(temporary, 'bouncer');
const project = `${process.env.COMPOSE_PROJECT_NAME}-bouncer`;
const env = {
  ...process.env,
  COMPOSE_PROFILES: apiMode ? 'checkout-api' : '',
  CHECKOUT_MODE: apiMode ? 'api' : 'payment_links',
  COMPOSE_PROJECT_NAME: project,
  COMPOSE_FILE: join(directory, 'docker-compose.yml'),
  STORE_DOMAIN: 'gyaruinthemix.example',
  STORE_HOSTS: '',
  SITE_URL: 'https://gyaruinthemix.example',
  LETSENCRYPT_EMAIL: 'ci@example.test',
  GYARUINTHEMIX_WEB_IMAGE: `gyaruinthemix-web:${process.env.IMAGE_TAG}`,
  GYARUINTHEMIX_API_IMAGE: `gyaruinthemix-api:${process.env.IMAGE_TAG}`,
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
  const appServices = apiMode
    ? ['gyaruinthemix-api', 'gyaruinthemix-web']
    : ['gyaruinthemix-web'];
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
  // Both hosts can acquire TLS while checkout remains bound to the primary origin.
  env.STORE_HOSTS = `${env.STORE_DOMAIN},legacy.gyaruinthemix.example`;
  const staged = render(env.COMPOSE_FILE);
  const stagedWeb = staged.services['gyaruinthemix-web'];
  assert.equal(stagedWeb.environment.VIRTUAL_HOST, env.STORE_HOSTS);
  assert.equal(stagedWeb.environment.LETSENCRYPT_HOST, env.STORE_HOSTS);
  if (apiMode)
    assert.equal(
      staged.services['gyaruinthemix-api'].environment.SITE_URL,
      env.SITE_URL,
    );
  for (const name of oldServices)
    assert.deepEqual(staged.services[name], original.services[name]);
  env.STORE_HOSTS = '';

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
  if (!process.argv.includes('--config-only')) {
    // Only the runner gets a private test port and uniquely named proxy network.
    // No proxy, companion, ZNC or Limnoria image is built or started in this test.
    const override = join(directory, 'ci.yaml');
    await writeFile(
      override,
      `services:\n  gyaruinthemix-web:\n    ports: ["127.0.0.1:8089:8080"]\nnetworks:\n  proxy-tier:\n    name: ${project}-proxy\n`,
    );
    env.COMPOSE_FILE += `:${override}`;
    docker('compose', 'build', '--pull', ...appServices);
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
    smoke();
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
    await rm(temporary, { recursive: true, force: true });
  }
}
