import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const outfile = process.argv[2];
const { metafile } = await build({
  entryPoints: ['scripts/podcast-index.mjs'],
  outfile,
  bundle: true,
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
for (const dir of [...packages].sort()) {
  const names = (await readdir(dir)).filter((name) =>
    /^(licen[sc]e|copying|notice)(\b|\.)/i.test(name),
  );
  if (!names.length) throw new Error(`Missing license for ${dir}`);
  for (const name of names.sort())
    notices.push(
      `${dir}: ${name}\n\n${await readFile(join(dir, name), 'utf8')}`,
    );
}
await writeFile(outfile + '.LICENSE.txt', notices.join('\n\n'));
