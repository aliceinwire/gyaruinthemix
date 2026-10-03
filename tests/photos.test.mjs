import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const site = JSON.parse(await readFile('config/site.json', 'utf8'));
const names = [
  'duo-camera',
  'duo-clapperboard',
  'duo-outing-wide',
  'duo-outing-pose',
];

test('all four supplied photos lead the gallery with accurate dimensions and descriptions', async () => {
  assert.deepEqual(
    site.photos.slice(0, 4).map((p) => p.image),
    names.map((name) => `/assets/${name}.webp`),
  );
  for (const [index, name] of names.entries()) {
    const metadata = await sharp(`assets/originals/${name}.jpeg`).metadata();
    assert.equal(site.photos[index].width, metadata.width);
    assert.equal(site.photos[index].height, metadata.height);
    assert.ok(site.photos[index].alt.length > 15);
    assert.ok(site.photos[index].caption);
    for (const field of ['exif', 'xmp', 'iptc'])
      assert.equal(metadata[field], undefined);
  }
  assert.equal(site.photos.length, 7);
});

test('gallery uses responsive modern formats and preserves natural photo proportions', async () => {
  const component = await readFile('src/components/PhotoGrid.astro', 'utf8');
  assert.match(component, /type="image\/avif"/);
  assert.match(component, /srcset=/);
  assert.match(component, /loading="lazy"/);
  assert.match(component, /decoding="async"/);
  assert.match(component, /full\.width = preview\.width/);
  assert.match(
    component,
    /dialog\.addEventListener\('close', \(\) => opener\?\.focus\(\)\)/,
  );
  const css = await readFile('src/styles/artist.css', 'utf8');
  const imageRule = css.match(/\.photo-open img \{([^}]+)\}/)[1];
  assert.match(imageRule, /height: auto/);
  assert.doesNotMatch(imageRule, /object-fit: cover|aspect-ratio/);
  const homepage = await readFile('src/pages/index.astro', 'utf8');
  assert.match(homepage, /<PhotoGrid photos=\{site\.photos\.slice\(0, 4\)\}/);
});

test('appearance name is AXIS SQUARE and the October cancellation is retained', () => {
  assert.equal(
    site.events.find((event) => event.date === '2026-09-25').title,
    'AXIS SQUARE',
  );
  assert.ok(site.news.some((item) => item.text.includes('AXIS SQUARE')));
  assert.equal(
    site.events.find((event) => event.date === '2026-10-03').cancelled,
    true,
  );
});
