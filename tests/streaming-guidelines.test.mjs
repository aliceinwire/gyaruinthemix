import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { publicPaths } from '../src/data/urls.mjs';

test('temporarily unpublished streaming rules have no routes or public links', async () => {
  for (const path of [
    'src/pages/streaming-guidelines.astro',
    'src/pages/en/streaming-guidelines.astro',
  ]) {
    await assert.rejects(access(new URL('../' + path, import.meta.url)), {
      code: 'ENOENT',
    });
  }
  assert.ok(
    publicPaths.every((path) => !path.includes('streaming-guidelines')),
  );
  for (const path of [
    'src/layouts/Layout.astro',
    'public/game/index.html',
    'public/game/main.js',
  ]) {
    const source = await readFile(
      new URL('../' + path, import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(source, /streaming-guidelines/);
  }
});
