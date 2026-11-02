import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export const repository = 'aliceinwire/gyaruinthemix';
export const source = `https://github.com/${repository}`;
export const registry = `ghcr.io/${repository}-`;
export const manifestLabel = 'io.gyaruinthemix.release';
export const components = [
  'web',
  'web-api',
  'api',
  'game-audio',
  'game-audio-packager',
];
export const shaPattern = /^[0-9a-f]{40}$/;
export const digestPattern = /^sha256:[0-9a-f]{64}$/;

export function validateManifest(value) {
  assert.equal(value?.schema, 1, 'Unsupported release manifest');
  assert.match(value.revision, shaPattern);
  assert.deepEqual(Object.keys(value).sort(), [
    'components',
    'revision',
    'schema',
  ]);
  assert.deepEqual(
    Object.keys(value.components).sort(),
    [...components].sort(),
  );
  for (const name of components) {
    const entry = value.components[name];
    assert.deepEqual(Object.keys(entry).sort(), [
      'digest',
      'input',
      'revision',
    ]);
    assert.match(entry.digest, digestPattern);
    assert.match(entry.revision, shaPattern);
    assert.match(entry.input, /^[0-9a-f]{64}$/);
  }
  return value;
}

export function docker(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function inspectImage(reference) {
  return JSON.parse(docker('image', 'inspect', reference))[0];
}

export function assertImage(image, name, revision) {
  assert.ok(components.includes(name));
  const labels = image.Config.Labels || {};
  assert.equal(labels['org.opencontainers.image.source'], source);
  assert.equal(labels['org.opencontainers.image.revision'], revision);
  if (name === 'web' || name === 'web-api')
    assert.equal(
      labels['io.gyaruinthemix.checkout-mode'],
      name === 'web' ? 'payment_links' : 'api',
    );
  if (name === 'game-audio-packager')
    assert.equal(labels['io.gyaruinthemix.role'], 'audio-packager');
  assert.match(image.Id, digestPattern);
}

export function buildManifestImage(manifest, reference) {
  validateManifest(manifest);
  execFileSync(
    'docker',
    [
      'build',
      '-t',
      reference,
      '--label',
      `org.opencontainers.image.source=${source}`,
      '--label',
      `org.opencontainers.image.revision=${manifest.revision}`,
      '--label',
      `${manifestLabel}=${JSON.stringify(manifest)}`,
      '-',
    ],
    { input: 'FROM scratch\n', stdio: ['pipe', 'inherit', 'inherit'] },
  );
  assert.equal(
    inspectImage(reference).Config.Labels[manifestLabel],
    JSON.stringify(manifest),
  );
}

export function publishedManifest() {
  const reference = `${registry}release:main`;
  try {
    docker('pull', reference);
  } catch {
    console.log(
      'No readable release baseline; rebuilding all production components.',
    );
    return null;
  }
  const labels = inspectImage(reference).Config.Labels || {};
  assert.equal(labels['org.opencontainers.image.source'], source);
  assert.ok(
    typeof labels[manifestLabel] === 'string' &&
      labels[manifestLabel].length < 16384,
  );
  const manifest = validateManifest(JSON.parse(labels[manifestLabel]));
  assert.equal(labels['org.opencontainers.image.revision'], manifest.revision);
  return manifest;
}

export function localImage(name, revision) {
  assert.ok(components.includes(name));
  assert.match(revision, shaPattern);
  return `gyaruinthemix-${name}:release-${revision}`;
}
