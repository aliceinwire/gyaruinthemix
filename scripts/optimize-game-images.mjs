import sharp from 'sharp';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLUB_ART } from '../public/game/src/club-art.js';

const sourceRoot = fileURLToPath(new URL('../public/game/', import.meta.url));
const replacements = [
  ['src/club-art.js', '../assets/clubs/${venue.id}.png'],
  [
    'src/chana-weapons.js',
    '../assets/characters/motion/chana-weapon-poses.png',
  ],
];
const images = [
  ...CLUB_ART.map(({ id }) => ({
    path: `assets/clubs/${id}.png`,
    options: { nearLossless: true, quality: 60, effort: 6 },
  })),
  {
    path: 'assets/characters/motion/chana-weapon-poses.png',
    options: { lossless: true, effort: 6 },
  },
];

// Optimize the production copy. Keep the original PNGs available for editing
// and local development, and keep sprite dimensions and alpha unchanged.
export async function optimizeGameImages(outputRoot = resolve('dist/game')) {
  const modules = await Promise.all(
    replacements.map(async ([path, original]) => {
      const text = await readFile(join(outputRoot, path), 'utf8');
      const optimized = original.replace(/\.png$/, '.webp');
      if (!text.includes(original) && !text.includes(optimized)) {
        throw new Error(`Missing game image reference in ${path}: ${original}`);
      }
      return { path, text: text.replaceAll(original, optimized) };
    }),
  );
  const results = [];
  for (const { path, options } of images) {
    const input = await readFile(join(sourceRoot, path));
    const output = await sharp(input).webp(options).toBuffer();
    const target = join(outputRoot, path.replace(/\.png$/, '.webp'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, output);
    results.push({ path, before: input.length, after: output.length });
  }
  // Switch references only after every optimized image has been produced.
  for (const { path, text } of modules) {
    await writeFile(join(outputRoot, path), text);
  }
  for (const { path } of images) {
    await rm(join(outputRoot, path), { force: true });
  }
  return results;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const results = await optimizeGameImages();
  const before = results.reduce((sum, image) => sum + image.before, 0);
  const after = results.reduce((sum, image) => sum + image.after, 0);
  console.log(
    `Game artwork: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB (${Math.round((1 - after / before) * 100)}% smaller)`,
  );
}
