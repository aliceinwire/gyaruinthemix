import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

// Public, deterministic fixture bytes. Never an operator or production key.
export const AUDIO_FIXTURE_KEY =
  'CI_ONLY_NOT_A_SECRET_SYNTHETIC_AUDIO_FIXTURE_2026';
export const AUDIO_FIXTURE_SOURCE = 'ci-synthetic-tone.wav';

// Creating PCM samples needs no host encoder. All actual packaging runs in the
// exact release packager image, through the real bouncer updater's confinement.
export function syntheticWave(seconds = 8) {
  assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= 12);
  const sampleRate = 48000;
  const dataSize = seconds * sampleRate * 2;
  const wave = Buffer.alloc(44 + dataSize);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + dataSize, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataSize, 40);
  for (let sample = 0; sample < seconds * sampleRate; sample++)
    wave.writeInt16LE(
      Math.round(8192 * Math.sin((2 * Math.PI * 440 * sample) / sampleRate)),
      44 + sample * 2,
    );
  return wave;
}

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
    await writeFile(join(library, AUDIO_FIXTURE_SOURCE), syntheticWave(), {
      mode: 0o640,
      flag: 'wx',
    });
    return { library, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
