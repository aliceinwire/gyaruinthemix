import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fingerprint } from './build-cache.mjs';

const mode = process.env.CHECKOUT_MODE || 'payment_links';
if (!['payment_links', 'api'].includes(mode))
  throw new Error('Invalid checkout mode');
const publicFiles = (await readdir('public'))
  .filter((name) => !['game', 'assets'].includes(name))
  .map((name) => `public/${name}`);
const key = await fingerprint(
  [
    'src',
    'config',
    'assets/originals',
    'package.json',
    'package-lock.json',
    'astro.config.mjs',
    'scripts/build-site.mjs',
    'scripts/build-cache.mjs',
    'scripts/images.mjs',
    ...publicFiles,
  ],
  { mode, node: process.versions.node },
);
const cached = `.cache/site/${mode}/${key}`;
await rm('dist', { recursive: true, force: true });
if (await stat(`${cached}/complete`).catch(() => null)) {
  await cp(`${cached}/dist`, 'dist', { recursive: true });
  console.log('Reused unchanged website output');
} else {
  if (!process.argv.includes('--skip-images'))
    execFileSync(process.execPath, ['scripts/images.mjs'], {
      stdio: 'inherit',
    });
  const publicDirectory = resolve('.cache/site-public');
  await rm(publicDirectory, { recursive: true, force: true });
  await mkdir(publicDirectory, { recursive: true });
  for (const path of [...publicFiles, 'public/assets'])
    await cp(path, `${publicDirectory}/${path.slice('public/'.length)}`, {
      recursive: true,
    });
  execFileSync(process.execPath, ['node_modules/.bin/astro', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, SITE_PUBLIC_DIR: publicDirectory },
  });
  await rm(`.cache/site/${mode}`, { recursive: true, force: true });
  await mkdir(cached, { recursive: true });
  await cp('dist', `${cached}/dist`, { recursive: true });
  await writeFile(`${cached}/complete`, key);
}
