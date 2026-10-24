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
  rename,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  packageLibrary,
  trackTitle,
  titleOnlyInit,
} from '../scripts/package-library.mjs';
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
    'title=夜のドライブ',
    '-metadata',
    'comment=SECRET DESCRIPTIVE SOURCE',
    '-metadata',
    'artist=PRIVATE ARTIST',
    '-metadata',
    'album=PRIVATE ALBUM',
    '-metadata',
    'copyright=PRIVATE COPYRIGHT',
    '-metadata:s:a:0',
    'title=PRIVATE STREAM TITLE',
    '-metadata:s:a:0',
    'language=jpn',
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
  assert.equal(track.title, '夜のドライブ');
  assert.equal(track.artist, undefined);
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
    [
      '-v',
      'error',
      '-show_entries',
      'format_tags:stream_tags',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  assert.doesNotMatch(
    tags,
    /SECRET|DESCRIPTIVE|PRIVATE|encoder|artist|album|comment|copyright/,
  );
  const metadata = JSON.parse(tags);
  assert.equal(metadata.format.tags.title, '夜のドライブ');
  assert.deepEqual(Object.keys(metadata.format.tags).sort(), [
    'compatible_brands',
    'major_brand',
    'minor_version',
    'title',
  ]);
  for (const stream of metadata.streams) {
    assert.deepEqual(Object.keys(stream.tags).sort(), [
      'handler_name',
      'language',
      'vendor_id',
    ]);
    assert.equal(stream.tags.language, 'und');
  }
  const old = JSON.parse(await readFile(cachedPath, 'utf8'));
  old.packagerVersion = 1;
  await writeFile(cachedPath, JSON.stringify(old));
  const oldModified = (await stat(file)).mtimeMs;
  const migrated = await packageLibrary({ directory: root, excerpt: true });
  assert.equal(migrated.catalog.tracks[0].packagerVersion, 2);
  assert.notEqual((await stat(file)).mtimeMs, oldModified);
  const migratedModified = (await stat(file)).mtimeMs;
  await packageLibrary({ directory: root, excerpt: true });
  assert.equal((await stat(file)).mtimeMs, migratedModified);
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
test('strict updater packaging preserves the prior catalog on any failed input', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ga-strict-')),
    root = join(dir, 'assets/music');
  await mkdir(root, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const initial = await packageLibrary({ directory: root, strict: true });
  assert.equal(initial.catalogUpdated, true);
  const catalog = join(root, '.hls/catalog.json'),
    before = await readFile(catalog),
    modified = (await stat(catalog)).mtimeMs;
  await writeFile(join(root, 'incomplete.mp3'), 'synthetic incomplete input');
  const failed = await packageLibrary({ directory: root, strict: true });
  assert.equal(failed.catalogUpdated, false);
  assert.equal(failed.failures.length, 1);
  assert.deepEqual(await readFile(catalog), before);
  assert.equal((await stat(catalog)).mtimeMs, modified);
  await rm(join(root, 'incomplete.mp3'));
  const recovered = await packageLibrary({ directory: root, strict: true });
  assert.equal(recovered.catalogUpdated, true);
  assert.deepEqual(await readFile(catalog), before);
});

test('supported local containers package while a disguised playlist cannot replace the catalog', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ga-formats-')),
    root = join(dir, 'assets/music');
  await mkdir(root, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const variants = [
    ['wav', 'pcm_s16le'],
    ['mp3', 'libmp3lame'],
    ['flac', 'flac'],
    ['m4a', 'aac'],
    ['aac', 'aac'],
    ['ogg', 'libvorbis'],
    ['opus', 'libopus'],
  ].filter(([, encoder]) => encoders.includes(` ${encoder} `));
  assert.ok(variants.some(([extension]) => extension === 'wav'));
  assert.ok(variants.some(([extension]) => extension === 'mp3'));
  for (const [extension, encoder] of variants)
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=1',
      '-metadata',
      'title=Synthetic Song',
      '-c:a',
      encoder,
      join(root, `synthetic.${extension}`),
    ]);
  const ready = await packageLibrary({ directory: root, strict: true });
  assert.deepEqual(ready.failures, []);
  assert.equal(
    ready.packaged,
    variants.filter(([extension]) => extension !== 'aac').length,
  );
  assert.equal(
    ready.catalog.tracks.filter((track) => track.title === 'Synthetic Song')
      .length,
    variants.filter(([extension]) => extension !== 'aac').length,
  );
  assert.equal(ready.catalogUpdated, true);
  const catalog = join(root, '.hls/catalog.json'),
    before = await readFile(catalog),
    modified = (await stat(catalog)).mtimeMs;
  // The target is local synthetic media, not a network probe. Its contents must
  // never matter because the concat demuxer is rejected before opening an entry.
  await writeFile(
    join(root, 'disguised.mp3'),
    "ffconcat version 1.0\nfile 'synthetic.wav'\n",
  );
  const rejected = await packageLibrary({ directory: root, strict: true });
  assert.equal(rejected.catalogUpdated, false);
  assert.equal(rejected.failures.length, 1);
  assert.match(rejected.failures[0].error, /not on whitelist/);
  assert.deepEqual(await readFile(catalog), before);
  assert.equal((await stat(catalog)).mtimeMs, modified);
});

test('display titles use metadata only and leave missing titles empty', () => {
  assert.equal(trackTitle({ title: ' 夜のドライブ ' }), '夜のドライブ');
  assert.equal(trackTitle({ TITLE: 'Club Mix' }), 'Club Mix');
  assert.equal(
    trackTitle({ title: 'ギャルインザミックス' }),
    'ギャルインザミックス',
  );
  assert.equal(trackTitle({ title: '  ' }), '');
  assert.equal(trackTitle({}), '');
  for (const tags of [{}, { title: ' ' }])
    assert.equal(trackTitle(tags, { TITLE: 'Stream Title' }), 'Stream Title');
  assert.equal(
    trackTitle({ title: 'Format Title' }, { title: 'Stream Title' }),
    'Format Title',
  );
  assert.equal(trackTitle({ title: 'a\u0000b\u202ec' }), 'abc');
  assert.equal(trackTitle({ title: 'x'.repeat(300) }).length, 160);
});

test('existing anonymous packages gain real titles without re-encoding audio', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ga-titles-')),
    root = join(dir, 'assets/music');
  await mkdir(root, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-metadata',
    'title=メタデータの曲名',
    join(root, '本当の曲名.wav'),
  ]);
  const first = await packageLibrary({ directory: root });
  const track = first.catalog.tracks[0];
  assert.equal(track.title, 'メタデータの曲名');
  const init = join(root, '.hls', track.id, 'init.mp4');
  const before = await readFile(init),
    modified = (await stat(init)).mtimeMs;
  const cachedPath = join(root, '.hls', track.id, 'track.json');
  const cached = JSON.parse(await readFile(cachedPath, 'utf8'));
  cached.title = 'ギャルインザミックス';
  await writeFile(cachedPath, JSON.stringify(cached));
  await rename(join(root, '本当の曲名.wav'), join(root, '新しい曲名.wav'));
  const refreshed = await packageLibrary({ directory: root });
  assert.equal(refreshed.catalog.tracks[0].title, 'メタデータの曲名');
  assert.equal(refreshed.catalog.tracks[0].id, track.id);
  assert.deepEqual(await readFile(init), before);
  assert.equal((await stat(init)).mtimeMs, modified);
  assert.equal(
    (await loadCatalog(join(root, '.hls'))).get(track.id).title,
    'メタデータの曲名',
  );
});

test('titleless files are skipped without encoding or blocking valid tracks', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ga-title-required-'));
  const root = join(dir, 'assets/music');
  await mkdir(root, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [filename, title] of [
    ['private-name.wav', null],
    ['blank.wav', '   '],
    ['different-filename.wav', '本当の曲名'],
  ]) {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      ...(title === null ? [] : ['-metadata', `title=${title}`]),
      join(root, filename),
    ]);
  }
  const result = await packageLibrary({ directory: root, strict: true });
  assert.deepEqual(result.failures, []);
  assert.equal(result.catalogUpdated, true);
  assert.equal(result.packaged, 1);
  assert.equal(result.catalog.tracks[0].title, '本当の曲名');
  assert.deepEqual(
    (await readdir(join(root, '.hls'))).filter((name) => name.startsWith('t-')),
    [result.catalog.tracks[0].id],
  );
  assert.doesNotMatch(
    JSON.stringify(result.catalog),
    /private-name|blank|different-filename/,
  );
  await rm(join(root, 'different-filename.wav'));
  const empty = await packageLibrary({ directory: root, strict: true });
  assert.deepEqual(empty.failures, []);
  assert.equal(empty.catalogUpdated, true);
  assert.deepEqual(empty.catalog.tracks, []);
  assert.equal((await loadCatalog(join(root, '.hls'))).size, 0);
});

test('init metadata filtering preserves boxes and rejects malformed or excessive structures', () => {
  const box = (type, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length);
    header.write(type, 4, 4, 'latin1');
    return Buffer.concat([header, payload]);
  };
  const title = box('\u00a9nam', box('data', Buffer.from('real title')));
  const tool = box('\u00a9too', box('data', Buffer.from('encoder')));
  const wrap = (items) =>
    box(
      'moov',
      box(
        'udta',
        box('meta', Buffer.concat([Buffer.alloc(4), box('ilst', items)])),
      ),
    );
  const ftyp = box('ftyp', Buffer.from('iso5'));
  assert.deepEqual(
    titleOnlyInit(Buffer.concat([ftyp, wrap(Buffer.concat([title, tool]))])),
    Buffer.concat([ftyp, wrap(title)]),
  );
  assert.throws(() => titleOnlyInit(Buffer.from([1, 2])), /Invalid init/);
  assert.throws(
    () => titleOnlyInit(Buffer.from([0, 0, 0, 99, 109, 111, 111, 118])),
    /Invalid init/,
  );
  assert.throws(() => titleOnlyInit(Buffer.alloc(256 * 1024 + 1)), /Oversized/);
  let deep = box('free');
  for (let n = 0; n < 10; n++) deep = box('moov', deep);
  assert.throws(() => titleOnlyInit(deep), /Nested/);
});
