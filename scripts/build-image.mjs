import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { components, source } from './release-manifest.mjs';

export function buildImage(name, tag, revision) {
  assert.ok(components.includes(name));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const cache = resolve(root, '.cache/docker', name);
  const next = cache + '-next';
  mkdirSync(resolve(root, '.cache/docker'), { recursive: true });
  rmSync(next, { recursive: true, force: true });
  const recipe = name.startsWith('web')
    ? 'Dockerfile.web'
    : name === 'api'
      ? 'Dockerfile.api'
      : 'Dockerfile.game-audio';
  const args = [
    'buildx',
    'build',
    '--load',
    '--pull',
    '-f',
    recipe,
    '-t',
    tag,
    '--label',
    `org.opencontainers.image.source=${source}`,
    '--label',
    `org.opencontainers.image.revision=${revision}`,
    '--build-arg',
    `GYARUINTHEMIX_REVISION=${revision}`,
    '--cache-to',
    `type=local,dest=${next},mode=max`,
  ];
  if (existsSync(`${cache}/index.json`))
    args.push('--cache-from', `type=local,src=${cache}`);
  if (name.startsWith('web')) {
    const mode = name === 'web' ? 'payment_links' : 'api';
    args.push(
      '--build-arg',
      `CHECKOUT_MODE=${mode}`,
      '--label',
      `io.gyaruinthemix.checkout-mode=${mode}`,
    );
  }
  if (name === 'game-audio-packager') args.push('--target', 'packager');
  execFileSync('docker', [...args, '.'], { cwd: root, stdio: 'inherit' });
  rmSync(cache, { recursive: true, force: true });
  renameSync(next, cache);
}
