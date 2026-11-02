import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertImage,
  buildManifestImage,
  components,
  docker,
  inspectImage,
  localImage,
  registry,
  repository,
  validateManifest,
} from './release-manifest.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
const plan = JSON.parse(await readFile('artifacts/release/plan.json', 'utf8'));
assert.equal(plan.revision, process.env.GITHUB_SHA);
assert.equal(plan.deploy, true);
if (plan.previous) validateManifest(plan.previous);
docker('load', '-i', 'artifacts/release/images.tar');
for (const name of components) {
  assert.equal(typeof plan.build[name], 'boolean');
  assert.match(plan.inputs[name], /^[0-9a-f]{64}$/);
  if (!plan.build[name]) {
    assert.equal(plan.componentReleases, true);
    assert.equal(plan.previous.components[name].input, plan.inputs[name]);
  }
  assertImage(
    inspectImage(localImage(name, plan.revision)),
    name,
    plan.build[name] ? plan.revision : plan.previous.components[name].revision,
  );
}
const current = execFileSync(
  'gh',
  ['api', `repos/${repository}/git/ref/heads/main`, '--jq', '.object.sha'],
  { encoding: 'utf8' },
).trim();
if (current !== plan.revision) {
  console.log(
    'A newer main commit exists; leaving the published release unchanged.',
  );
} else {
  const temporary = await mkdtemp(join(tmpdir(), 'gyaru-registry-'));
  const oldConfig = process.env.DOCKER_CONFIG;
  process.env.DOCKER_CONFIG = temporary;
  try {
    execFileSync(
      'docker',
      ['login', 'ghcr.io', '-u', process.env.GITHUB_ACTOR, '--password-stdin'],
      {
        input: process.env.GHCR_TOKEN,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const manifest = { schema: 1, revision: plan.revision, components: {} };
    for (const name of components) {
      if (!plan.build[name]) {
        manifest.components[name] = plan.previous.components[name];
        continue;
      }
      const reference = `${registry}${name}:sha-${plan.revision}`;
      const image = localImage(name, plan.revision);
      docker('tag', image, reference);
      docker('push', reference);
      const digest = inspectImage(image)
        .RepoDigests.find((entry) => entry.startsWith(`${registry}${name}@`))
        ?.split('@')[1];
      manifest.components[name] = {
        digest,
        revision: plan.revision,
        input: plan.inputs[name],
      };
    }
    validateManifest(manifest);
    // Legacy tags stay coherent until the operator enables component reuse.
    // Manifest-aware hosts select immutable digests from the final release pointer.
    for (const name of [...components].reverse()) {
      docker('tag', localImage(name, plan.revision), `${registry}${name}:main`);
      docker('push', `${registry}${name}:main`);
    }
    const releaseImage = `${registry}release:sha-${plan.revision}`;
    buildManifestImage(manifest, releaseImage);
    docker('push', releaseImage);
    docker('tag', releaseImage, `${registry}release:main`);
    docker('push', `${registry}release:main`);
    console.log(`Published release ${plan.revision}`);
  } finally {
    if (oldConfig === undefined) delete process.env.DOCKER_CONFIG;
    else process.env.DOCKER_CONFIG = oldConfig;
    await rm(temporary, { recursive: true, force: true });
  }
}
