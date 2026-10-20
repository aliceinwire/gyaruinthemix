import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { packageLibrary } from '../scripts/package-library.mjs';
import { loadCatalog } from '../server/app.mjs';
test('library discovery is bounded, deterministic, continuous and isolates corrupt files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ga-pack-')),
    root = join(dir, 'assets/music');
  await mkdir(root, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=12',
    '-metadata',
    'title=SECRET DESCRIPTIVE SOURCE',
    '-c:a',
    'pcm_s16le',
    join(root, 'a.wav'),
  ]);
  await writeFile(join(root, 'b.mp3'), 'corrupt input');
  await writeFile(join(root, '.hidden.wav'), 'hidden');
  await symlink(join(root, 'a.wav'), join(root, 'c.wav'));
  const result = await packageLibrary({ directory: root, excerpt: true });
  assert.equal(result.packaged, 1);
  assert.equal(result.failures.length, 1);
  const track = result.catalog.tracks[0];
  assert.equal(track.chunks.length, 4);
  assert.ok(track.chunks.every((c) => c.duration <= 4.1));
  assert.ok(Math.abs(track.duration - 12) < 0.05);
  assert.doesNotMatch(
    JSON.stringify(result.catalog),
    /SECRET|DESCRIPTIVE|a\.wav/,
  );
  assert.equal((await loadCatalog(join(root, '.hls'))).size, 1);
  const file = join(root, '.hls', track.id, 'init.mp4'),
    mtime = (await stat(file)).mtimeMs;
  await packageLibrary({ directory: root, excerpt: true });
  assert.equal(
    (await stat(file)).mtimeMs,
    mtime,
    'unchanged input is not transcoded twice',
  );
  const cachedPath = join(root, '.hls', track.id, 'track.json');
  const invalid = JSON.parse(await readFile(cachedPath, 'utf8'));
  invalid.duration = 0;
  await writeFile(cachedPath, JSON.stringify(invalid));
  const repaired = await packageLibrary({ directory: root, excerpt: true });
  assert.ok(repaired.catalog.tracks[0].duration > 12);
  const decoded = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      join(root, '.hls', track.id, 'index.m3u8'),
      '-f',
      'f32le',
      '-ac',
      '1',
      '-',
    ],
    { maxBuffer: 8e6 },
  );
  assert.ok(decoded.byteLength / 4 >= 12 * 48000);
  const tags = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  assert.doesNotMatch(tags, /SECRET|DESCRIPTIVE/);
  await rm(join(root, 'a.wav'));
  const removed = await packageLibrary({ directory: root });
  assert.equal(removed.packaged, 0);
  assert.equal((await loadCatalog(join(root, '.hls'))).size, 0);
});
test('refuses non-library source and symlink output directory', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ga-safety-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(packageLibrary({ directory: dir }), /assets\/music/);
  const root = join(dir, 'assets/music');
  await mkdir(root, { recursive: true });
  await symlink('/tmp', join(root, '.hls'));
  await assert.rejects(packageLibrary({ directory: root }), /symlink/);
});
