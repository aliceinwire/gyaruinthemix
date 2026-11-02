import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

export async function fingerprint(paths, options = {}) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(options));
  async function visit(path) {
    const info = await stat(path);
    hash.update(path + '\0');
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name));
    } else hash.update(await readFile(path));
  }
  for (const path of [...paths].sort()) await visit(path);
  return hash.digest('hex');
}

export async function cachedImage(
  input,
  options,
  produce,
  directory = '.cache/images',
) {
  const key = createHash('sha256')
    .update(input)
    .update(JSON.stringify({ options, versions: sharp.versions }))
    .digest('hex');
  const path = join(directory, key);
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const result = await produce();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, result);
  return result;
}
