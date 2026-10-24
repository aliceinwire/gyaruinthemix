import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizeGameImages } from '../scripts/optimize-game-images.mjs';

const source = fileURLToPath(new URL('../public/game-test/', import.meta.url));
async function outputFixture(t) {
  const output = await mkdtemp(join(tmpdir(), 'gyaru-game-images-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await mkdir(join(output, 'src'));
  for (const name of ['club-art.js', 'chana-weapons.js']) {
    await copyFile(join(source, 'src', name), join(output, 'src', name));
  }
  return output;
}

test('production art shrinks without resizing, blurring outlines or changing sprite alpha', async (t) => {
  const output = await outputFixture(t);
  const paths = [
    ...['nakano', 'shinjuku', 'shibuya', 'asakusa', 'osaka', 'kyoto'].map(
      (city) => `assets/clubs/${city}.png`,
    ),
    'assets/characters/motion/chana-weapon-poses.png',
  ];
  for (const path of paths) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await copyFile(join(source, path), join(output, path));
  }
  const results = await optimizeGameImages(output);
  assert.deepEqual(
    results.map(({ path }) => path),
    paths,
  );
  for (const { path, before, after } of results) {
    assert.ok(after < before, `${path} must use fewer bytes`);
    const png = await readFile(join(source, path));
    const webp = await readFile(join(output, path.replace(/\.png$/, '.webp')));
    assert.equal((await sharp(webp).metadata()).format, 'webp');
    const a = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const b = await sharp(webp)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual(
      [b.info.width, b.info.height],
      [a.info.width, a.info.height],
    );
    assert.equal(b.data.length, a.data.length);
    let colorError = 0,
      alphaError = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      alphaError = Math.max(
        alphaError,
        Math.abs(a.data[i + 3] - b.data[i + 3]),
      );
      if (a.data[i + 3] === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        colorError = Math.max(
          colorError,
          Math.abs(a.data[i + channel] - b.data[i + channel]),
        );
      }
    }
    assert.equal(alphaError, 0, 'Every alpha value is preserved');
    assert.ok(
      colorError <= (path.includes('/clubs/') ? 2 : 0),
      `${path}: color error ${colorError}`,
    );
    await assert.rejects(access(join(output, path)), { code: 'ENOENT' });
    assert.deepEqual(
      await readFile(join(source, path)),
      png,
      'Source artwork stays unchanged',
    );
  }
  assert.match(
    await readFile(join(output, 'src/club-art.js'), 'utf8'),
    /\$\{venue\.id\}\.webp/,
  );
  assert.match(
    await readFile(join(output, 'src/chana-weapons.js'), 'utf8'),
    /chana-weapon-poses\.webp/,
  );
});

test('an unexpected image reference fails the build before changing its artwork', async (t) => {
  const output = await outputFixture(t);
  await writeFile(
    join(output, 'src/chana-weapons.js'),
    'export const moved = true;\n',
  );
  await assert.rejects(
    optimizeGameImages(output),
    /Missing game image reference/,
  );
  await assert.rejects(access(join(output, 'assets')), { code: 'ENOENT' });
});
