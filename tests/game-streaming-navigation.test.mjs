import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicPaths } from '../src/data/urls.mjs';
import { GET as sitemap } from '../src/pages/sitemap.xml.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('streaming rules are not discoverable from normal website navigation or sitemap', async () => {
  assert.doesNotMatch(
    await read('src/layouts/Layout.astro'),
    /streaming-guidelines/,
  );
  assert.ok(
    publicPaths.every((path) => !path.includes('streaming-guidelines')),
  );
  assert.doesNotMatch(await sitemap().text(), /streaming-guidelines/);
});

test('game keeps the existing streaming rules page and bilingual destination', async () => {
  assert.match(
    await read('public/game/index.html'),
    /id="streaming-guidelines" href="\/streaming-guidelines\/"/,
  );
  assert.match(
    await read('public/game/main.js'),
    /i18n.language === 'ja' \? '\/streaming-guidelines\/' : '\/en\/streaming-guidelines\/'/,
  );
  assert.match(
    await read('src/pages/streaming-guidelines.astro'),
    /GAMEPLAY & STREAMING/,
  );
  assert.match(
    await read('src/pages/en/streaming-guidelines.astro'),
    /import Page from '\.\.\/streaming-guidelines.astro'/,
  );
});
