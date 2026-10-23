import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isSemanticVersion, releaseVersion } from '../src/data/release.mjs';

const gamePath = new URL('../public/game-test/index.html', import.meta.url);
const versionSpan =
  /<span data-release-version="[^"]*" translate="no">[^<]*<\/span>/g;

export function stampGameRelease(html, version) {
  if (!isSemanticVersion(version)) throw new Error('Invalid release version.');
  if ([...html.matchAll(versionSpan)].length !== 1) {
    throw new Error(
      'The game must have exactly one release version beside its credits.',
    );
  }
  return html.replace(
    versionSpan,
    `<span data-release-version="${version}" translate="no"> · v${version}</span>`,
  );
}

export async function syncGameRelease({ check = false, path = gamePath } = {}) {
  const current = await readFile(path, 'utf8');
  const stamped = stampGameRelease(current, releaseVersion);
  if (current === stamped) return;
  if (check)
    throw new Error('Game release version is stale. Run npm run version.');
  await writeFile(path, stamped);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await syncGameRelease({ check: process.argv.includes('--check') });
}
