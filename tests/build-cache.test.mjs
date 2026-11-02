import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cachedImage, fingerprint } from '../scripts/build-cache.mjs';

test('image reuse invalidates on source bytes and conversion settings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-images-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let encodes = 0;
  const produce = async () => Buffer.from(`encoded-${++encodes}`);
  const first = await cachedImage(
    Buffer.from('first'),
    { width: 540 },
    produce,
    directory,
  );
  assert.deepEqual(
    await cachedImage(Buffer.from('first'), { width: 540 }, produce, directory),
    first,
  );
  assert.equal(encodes, 1);
  await cachedImage(Buffer.from('changed'), { width: 540 }, produce, directory);
  await cachedImage(Buffer.from('first'), { width: 1200 }, produce, directory);
  assert.equal(encodes, 3);
});

test('build fingerprints include source contents and checkout mode', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-fingerprint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'page');
  await writeFile(path, 'before');
  const first = await fingerprint([path], { mode: 'payment_links' });
  assert.notEqual(first, await fingerprint([path], { mode: 'api' }));
  await writeFile(path, 'after');
  assert.notEqual(first, await fingerprint([path], { mode: 'payment_links' }));
});
