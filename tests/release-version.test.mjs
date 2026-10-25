import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSemanticVersion, releaseVersion } from '../src/data/release.mjs';
import {
  stampGameRelease,
  syncGameRelease,
} from '../scripts/release-version.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const footer =
  '<small>Credits<span data-release-version="1.0.0" translate="no"> · v1.0.0</span></small>';

test('release versions follow SemVer including prerelease and build identifiers', () => {
  for (const version of [
    '0.0.0',
    '1.1.0',
    '10.20.30',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-0.3.7',
    '1.0.0-x.7.z.92',
    '1.0.0-x-y-z.--',
    '1.0.0+001',
    '1.0.0-beta+exp.sha.5114f85',
    '1.0.0-0A.01B+001',
  ])
    assert.equal(isSemanticVersion(version), true, version);
  for (const version of [
    undefined,
    null,
    1,
    '',
    '1',
    '1.1',
    'v1.1.0',
    '01.1.0',
    '1.01.0',
    '1.1.01',
    '1.0.0-01',
    '1.0.0-a.01',
    '1.0.0-',
    '1.0.0+',
    '1.0.0-alpha..1',
    '1.0.0+build..1',
    '1.0.0+meta_data',
    '1.0.0\n',
    ' 1.0.0',
    '1.0.0+日本語',
  ])
    assert.equal(isSemanticVersion(version), false, String(version));
});

test('stamping keeps credits intact and rejects missing, duplicate or invalid versions', () => {
  const stamped = stampGameRelease(footer, '1.2.3-rc.1+abc');
  assert.equal(
    stamped,
    '<small>Credits<span data-release-version="1.2.3-rc.1+abc" translate="no"> · v1.2.3-rc.1+abc</span></small>',
  );
  assert.equal(stampGameRelease(stamped, '1.2.3-rc.1+abc'), stamped);
  assert.throws(() => stampGameRelease('<small>Credits</small>', '1.1.0'));
  assert.throws(() => stampGameRelease(footer + footer, '1.1.0'));
  assert.throws(() => stampGameRelease(footer, '1.1'));
});

test('checking a stale footer never edits it; synchronization updates to the canonical release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-release-'));
  const path = join(directory, 'index.html');
  try {
    await writeFile(path, stampGameRelease(footer, '0.0.0'));
    await assert.rejects(syncGameRelease({ path, check: true }), /stale/);
    assert.match(await readFile(path, 'utf8'), /v0\.0\.0/);
    await syncGameRelease({ path });
    assert.equal(
      await readFile(path, 'utf8'),
      stampGameRelease(footer, releaseVersion),
    );
    await syncGameRelease({ path, check: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('package lock, shared footer and standalone game expose the same release', async () => {
  const manifest = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  assert.equal(manifest.version, releaseVersion);
  assert.equal(lock.version, releaseVersion);
  assert.equal(lock.packages[''].version, releaseVersion);
  const game = await read('public/game/index.html');
  assert.equal(stampGameRelease(game, releaseVersion), game);
  assert.match(
    game,
    /<small class="game-copyright">[^<]+<span data-release-version=/,
  );
  const layout = await read('src/layouts/Layout.astro');
  assert.match(
    layout,
    /import \{ releaseVersion \} from '\.\.\/data\/release\.mjs'/,
  );
  assert.match(layout, /data-release-version=\{releaseVersion\}/);
  assert.match(layout, /v\{releaseVersion\}/);
  for (const page of ['index', 'shop/index', 'fanclub']) {
    assert.match(await read(`src/pages/${page}.astro`), /import Layout from/);
  }
  for (const name of ['prebuild', 'predev', 'version']) {
    assert.equal(manifest.scripts[name], 'node scripts/release-version.mjs');
  }
  assert.match(
    await read('Dockerfile.web'),
    /COPY scripts\/images\.mjs scripts\/check-site-build\.mjs scripts\/release-version\.mjs \.\/scripts\//,
  );
  assert.match(
    await read('.dockerignore'),
    /^!scripts\/release-version\.mjs$/m,
  );
  await syncGameRelease({ check: true });
});
