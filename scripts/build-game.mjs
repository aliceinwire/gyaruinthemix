import { cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { optimizeGameImages } from './optimize-game-images.mjs';
import { syncGameRelease } from './release-version.mjs';

await rm('dist/game', { recursive: true, force: true });
const source = resolve('public/game');
await cp(source, 'dist/game', {
  recursive: true,
  filter: (path) => path !== `${source}/assets/music`,
});
await syncGameRelease({ path: resolve('dist/game/index.html') });
const artworkIndex = process.argv.indexOf('--artwork');
await optimizeGameImages(resolve('dist/game'), {
  artwork: artworkIndex === -1 ? undefined : process.argv[artworkIndex + 1],
});
