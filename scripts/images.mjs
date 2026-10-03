import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

await mkdir('public/assets', { recursive: true });
for (const [source, name, width] of [
  ['gyaruinthemix_logo.PNG', 'logo', 1200],
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
    const img = sharp(`assets/originals/${source}`)
      .rotate()
      .resize({ width: size, withoutEnlargement: true });
    await img
      .clone()
      .webp({ quality: 82 })
      .toFile(`public/assets/${name}${suffix}.webp`);
    await img
      .clone()
      .avif({ quality: 58, effort: 4 })
      .toFile(`public/assets/${name}${suffix}.avif`);
  }
}
