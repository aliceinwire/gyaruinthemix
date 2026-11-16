import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const outfile = process.argv[2];
const { metafile } = await build({
  entryPoints: ['scripts/podcast-index.mjs'],
  outfile,
  bundle: true,
  external: ['sharp'],
  platform: 'node',
  format: 'esm',
  target: 'node24',
  metafile: true,
  banner: {
    js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
const packages = new Set(
  Object.keys(metafile.inputs).flatMap((input) => {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    return match ? [match[1]] : [];
  }),
);
const notices = [];
// Native image bindings stay beside the bundle, including their licenses.
for (const name of [
  'sharp',
  'detect-libc',
  'semver',
  ...(await readdir('node_modules/@img')).map((name) => `@img/${name}`),
]) {
  const source = join('node_modules', name);
  await cp(source, join(dirname(outfile), 'node_modules', name), {
    recursive: true,
  });
  packages.add(source);
}
for (const dir of [...packages].sort()) {
  const names = (await readdir(dir)).filter((name) =>
    /^(licen[sc]e|copying|notice)(\b|\.)/i.test(name),
  );
  if (!names.length && dir.startsWith('node_modules/@img/sharp-libvips-')) {
    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    if (readme.includes('## Licensing')) names.push('README.md');
  }
  if (!names.length) throw new Error(`Missing license for ${dir}`);
  for (const name of names.sort())
    notices.push(
      `${dir}: ${name}\n\n${await readFile(join(dir, name), 'utf8')}`,
    );
}
await writeFile(outfile + '.LICENSE.txt', notices.join('\n\n'));
