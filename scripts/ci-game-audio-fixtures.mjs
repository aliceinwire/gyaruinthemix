import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { packageLibrary } from '../game-audio/scripts/package-library.mjs';

// Public, deterministic fixture bytes. Never an operator or production key.
export const AUDIO_FIXTURE_KEY =
  'CI_ONLY_NOT_A_SECRET_SYNTHETIC_AUDIO_FIXTURE_2026';
export const AUDIO_FIXTURE_SOURCE = 'ci-synthetic-tone.wav';

export async function createGameAudioFixtures({ checkoutRoot, secretFile }) {
  assert.ok(isAbsolute(checkoutRoot) && checkoutRoot === resolve(checkoutRoot));
  assert.ok(isAbsolute(secretFile) && secretFile === resolve(secretFile));
  assert.ok(relative(checkoutRoot, secretFile).startsWith('../'));
  const library = join(checkoutRoot, 'assets/music');
  // Refuse to overwrite, read or reuse any existing library, even on CI.
  await mkdir(library);
  let keyCreated = false;
  const cleanup = async () => {
    await rm(library, { recursive: true, force: true });
    if (keyCreated) await rm(secretFile, { force: true });
  };
  try {
    await writeFile(secretFile, AUDIO_FIXTURE_KEY, { mode: 0o444, flag: 'wx' });
    keyCreated = true;
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=8',
        '-threads',
        '1',
        '-c:a',
        'pcm_s16le',
        join(library, AUDIO_FIXTURE_SOURCE),
      ],
      { timeout: 30000, stdio: 'pipe' },
    );
    const result = await packageLibrary({
      directory: library,
      maxFiles: 1,
      maxBytes: 2 * 1024 * 1024,
      maxSeconds: 10,
    });
    assert.equal(result.packaged, 1);
    assert.deepEqual(result.failures, []);
    // These are synthetic CI files only. Permit the fixed non-root container UID
    // to read them without changing the operator's production permission model.
    const makeReadable = async (path) => {
      await chmod(path, 0o755);
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) await makeReadable(file);
        else await chmod(file, 0o444);
      }
    };
    await makeReadable(library);
    return { library, catalog: result.catalog, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
