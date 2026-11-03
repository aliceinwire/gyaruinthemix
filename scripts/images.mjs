import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cachedImage } from './build-cache.mjs';

await mkdir('public/assets', { recursive: true });
for (const [source, name, width] of [
  ['gyaruinthemix_logo.PNG', 'logo', 1200],
  ['logo-seal-white.jpeg', 'logo-seal-white', 1254],
  ['logo-seal-collection.jpeg', 'logo-seal-collection', 1152],
  ['logo-seal-black.jpeg', 'logo-seal-black', 1254],
  ['keychain-product.webp', 'keychain-product', 1254],
  ['keychain-bag.webp', 'keychain-bag', 1254],
  ['keychain-styled.webp', 'keychain-styled', 1254],
  ['gyaruinthemix_artists_photo.JPG', 'artists', 900],
  ['portrait.jpeg', 'portrait', 1108],
  ['live.jpeg', 'live', 900],
  ['banner.jpeg', 'banner', 1536],
  ['duo-camera.jpeg', 'duo-camera', 1536],
  ['duo-clapperboard.jpeg', 'duo-clapperboard', 1536],
  ['duo-outing-wide.jpeg', 'duo-outing-wide', 1536],
  ['duo-outing-pose.jpeg', 'duo-outing-pose', 1152],
]) {
  for (const size of [Math.min(540, width), width]) {
    const suffix = size === width ? '' : '-small';
    const input = await readFile(`assets/originals/${source}`);
    const img = sharp(input)
      .rotate()
      .resize({ width: size, withoutEnlargement: true });
    for (const [format, options] of [
      ['webp', { quality: 82 }],
      ['avif', { quality: 58, effort: 4 }],
    ]) {
      const output = await cachedImage(
        input,
        {
          format,
          options,
          width: size,
          rotate: true,
          withoutEnlargement: true,
        },
        () => img.clone()[format](options).toBuffer(),
      );
      await writeFile(`public/assets/${name}${suffix}.${format}`, output);
    }
  }
}
