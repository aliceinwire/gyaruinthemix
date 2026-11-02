import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertImage,
  components,
  source,
  validateManifest,
} from '../scripts/release-manifest.mjs';

const manifest = () => ({
  schema: 1,
  revision: 'a'.repeat(40),
  components: Object.fromEntries(
    components.map((name, i) => [
      name,
      {
        digest: 'sha256:' + String(i + 1).repeat(64),
        revision: String(i + 1).repeat(40),
        input: 'b'.repeat(64),
      },
    ]),
  ),
});

test('release manifests retain different original revisions and immutable digests', () => {
  const value = manifest();
  assert.deepEqual(validateManifest(value), value);
  assert.notEqual(value.components.web.revision, value.components.api.revision);
});

test('incomplete, mutable and redirected releases are rejected', () => {
  for (const mutate of [
    (value) => {
      delete value.components.api;
    },
    (value) => {
      value.components.other = value.components.api;
    },
    (value) => {
      value.components.api.digest = 'latest';
    },
    (value) => {
      value.components.api.repository = 'other/api';
    },
    (value) => {
      value.components.api.revision = 'main';
    },
    (value) => {
      value.schema = 2;
    },
  ]) {
    const value = manifest();
    mutate(value);
    assert.throws(() => validateManifest(value));
  }
});

test('reused images must preserve source, component role and source revision', () => {
  const image = {
    Id: 'sha256:' + '1'.repeat(64),
    Config: {
      Labels: {
        'org.opencontainers.image.source': source,
        'org.opencontainers.image.revision': 'b'.repeat(40),
        'io.gyaruinthemix.checkout-mode': 'payment_links',
      },
    },
  };
  assert.doesNotThrow(() => assertImage(image, 'web', 'b'.repeat(40)));
  assert.throws(() => assertImage(image, 'web', 'a'.repeat(40)));
  assert.throws(() => assertImage(image, 'web-api', 'b'.repeat(40)));
  assert.throws(() =>
    assertImage(image, 'game-audio-packager', 'b'.repeat(40)),
  );
  image.Config.Labels['org.opencontainers.image.source'] =
    'https://example.com';
  assert.throws(() => assertImage(image, 'web', 'b'.repeat(40)));
});
