import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildImage } from './build-image.mjs';
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
assert.ok(['push', 'pull_request'].includes(process.env.GITHUB_EVENT_NAME));
if (process.env.GITHUB_EVENT_NAME === 'push')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
const plan = JSON.parse(await readFile('artifacts/release-plan.json', 'utf8'));
assert.equal(plan.revision, process.env.GITHUB_SHA);
assert.equal(plan.deploy, true);
if (plan.previous) validateManifest(plan.previous);
const revisions = {};
for (const name of components) {
  const image = localImage(name, plan.revision);
  if (plan.build[name]) {
    buildImage(name, image, plan.revision);
    revisions[name] = plan.revision;
  } else {
    assert.equal(plan.componentReleases, true);
    const previous = plan.previous.components[name];
    assert.equal(previous.input, plan.inputs[name]);
    const reference = `${registry}${name}@${previous.digest}`;
    docker('pull', reference);
    assertImage(inspectImage(reference), name, previous.revision);
    docker('tag', reference, image);
    revisions[name] = previous.revision;
  }
  assertImage(inspectImage(image), name, revisions[name]);
}
// Exercise the metadata-image format before publishing is permitted. Local
// image IDs are placeholders here; publication replaces them with registry digests.
buildManifestImage(
  {
    schema: 1,
    revision: plan.revision,
    components: Object.fromEntries(
      components.map((name) => [
        name,
        {
          digest: inspectImage(localImage(name, plan.revision)).Id,
          revision: revisions[name],
          input: plan.inputs[name],
        },
      ]),
    ),
  },
  'gyaruinthemix-release:metadata-check',
);
const env = {
  ...process.env,
  CI_PAYMENT_LINK_FIXTURE: 'false',
  CI_IMAGE_REVISIONS: JSON.stringify(revisions),
  CI_API_IMAGE: localImage('api', plan.revision),
  CI_AUDIO_IMAGE: localImage('game-audio', plan.revision),
  CI_PACKAGER_IMAGE: localImage('game-audio-packager', plan.revision),
};
for (const mode of ['payment_links', 'api']) {
  if (mode === 'api')
    execFileSync(process.execPath, ['scripts/ci-fixtures.mjs'], {
      stdio: 'inherit',
      env: { ...env, CHECKOUT_MODE: mode },
    });
  for (const audio of ['false', 'true']) {
    execFileSync(process.execPath, ['scripts/ci-bouncer.mjs', '--no-build'], {
      stdio: 'inherit',
      env: {
        ...env,
        CHECKOUT_MODE: mode,
        GAME_AUDIO_ENABLED: audio,
        CI_WEB_IMAGE: localImage(
          mode === 'api' ? 'web-api' : 'web',
          plan.revision,
        ),
      },
    });
  }
}
await mkdir('artifacts/release', { recursive: true });
await writeFile(
  'artifacts/release/plan.json',
  JSON.stringify(plan, null, 2) + '\n',
);
docker(
  'save',
  '-o',
  'artifacts/release/images.tar',
  ...components.map((name) => localImage(name, plan.revision)),
);
