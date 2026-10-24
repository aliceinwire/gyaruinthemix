/** Offline, serial packaging. Never run ffmpeg in the serving container. */
import {
  readdir,
  lstat,
  realpath,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const EXTENSIONS = /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i;
const BRAND = 'ギャルインザミックス';
const PACKAGER_VERSION = 3;
// Local extensions are not proof of container type. Refuse playlist/concat
// demuxers and network protocols, including playlists disguised as audio files.
const INPUT_OPTIONS = [
  '-protocol_whitelist',
  'file,pipe',
  '-format_whitelist',
  'mp3,wav,flac,mov,aac,ogg',
];
// Only the display title is public; other source tags and full paths stay private.
export function trackTitle(tags, streamTags) {
  const clean = (value) =>
    typeof value === 'string'
      ? value
          .replace(/[\p{Cc}\p{Cf}]/gu, '')
          .trim()
          .slice(0, 160)
      : '';
  for (const candidate of [tags, streamTags]) {
    const tagged = clean(
      Object.entries(candidate || {}).find(
        ([key]) => key.toLowerCase() === 'title',
      )?.[1],
    );
    if (tagged) return tagged;
  }
  return '';
}
// The HLS muxer may add an encoder tag even with metadata copying disabled.
// Keep only the title item in its MP4 metadata; media/container boxes stay intact.
export function titleOnlyInit(input) {
  if (input.length > 256 * 1024) throw new Error('Oversized init metadata.');
  function boxes(buffer, parent = '', depth = 0) {
    if (depth > 8) throw new Error('Nested init metadata.');
    const output = [];
    let offset = 0;
    while (offset < buffer.length) {
      if (buffer.length - offset < 8) throw new Error('Invalid init metadata.');
      const size = buffer.readUInt32BE(offset);
      if (size < 8 || offset + size > buffer.length)
        throw new Error('Invalid init box.');
      const type = buffer.toString('latin1', offset + 4, offset + 8);
      let payload = buffer.subarray(offset + 8, offset + size);
      offset += size;
      if (parent === 'ilst' && type !== '\u00a9nam') continue;
      if (['moov', 'udta', 'ilst'].includes(type))
        payload = boxes(payload, type, depth + 1);
      else if (type === 'meta') {
        if (payload.length < 4) throw new Error('Invalid init metadata.');
        payload = Buffer.concat([
          payload.subarray(0, 4),
          boxes(payload.subarray(4), type, depth + 1),
        ]);
      }
      const header = Buffer.alloc(8);
      header.writeUInt32BE(payload.length + 8);
      header.write(type, 4, 4, 'latin1');
      output.push(header, payload);
    }
    return Buffer.concat(output);
  }
  return boxes(input);
}
async function run(command, args, timeout = 1800000, cwd) {
  return new Promise((done, fail) => {
    const p = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (b) => {
      if (stdout.length < 1048576) stdout += b;
    });
    p.stderr.on('data', (b) => {
      if (stderr.length < 8192) stderr += b;
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      fail(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? done(stdout)
        : fail(new Error(`${command} failed (${code}): ${stderr.slice(-400)}`));
    });
  });
}
// Five measured band envelopes, 20 frames/second. No playable audio is retained.
async function packageSpectrum(source, directory, duration) {
  const edges = [45, 150, 500, 1600, 5000, 16000];
  const filters = ['[0:a:0]aresample=48000,asplit=5[b0][b1][b2][b3][b4]'];
  for (let band = 0; band < 5; band++)
    filters.push(
      `[b${band}]highpass=f=${edges[band]},lowpass=f=${edges[band + 1]},asetnsamples=n=2400:p=1,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=band-${band}.txt[o${band}]`,
    );
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      ...INPUT_OPTIONS,
      '-threads',
      '1',
      '-i',
      source,
      '-filter_complex_threads',
      '1',
      '-filter_complex',
      filters.join(';'),
      ...Array.from({ length: 5 }, (_, band) => ['-map', `[o${band}]`]).flat(),
      '-f',
      'null',
      '-',
    ],
    1800000,
    directory,
  );
  const limit = Math.ceil(duration * 20) + 2;
  const data = Buffer.alloc(8 + limit * 5);
  data.write('GEQ1');
  let frames;
  for (let band = 0; band < 5; band++) {
    const path = join(directory, `band-${band}.txt`);
    let count = 0;
    const lines = createInterface({
      input: createReadStream(path),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.startsWith('lavfi.astats.Overall.RMS_level=')) continue;
      if (count >= limit) throw new Error('Spectrum duration exceeds limit.');
      const db = Number(line.slice(line.indexOf('=') + 1));
      data[8 + count++ * 5 + band] = Number.isFinite(db)
        ? Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * 255)
        : 0;
    }
    if (!count || (frames !== undefined && frames !== count))
      throw new Error('Invalid spectrum frames.');
    frames = count;
    await rm(path);
  }
  data.writeUInt32LE(frames, 4);
  await writeFile(
    join(directory, 'spectrum.bin'),
    data.subarray(0, 8 + frames * 5),
    { mode: 0o640 },
  );
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function packageLibrary({
  directory = 'assets/music',
  maxFiles = 200,
  maxBytes = 2 * 1024 ** 3,
  maxSeconds = 7200,
  excerpt = false,
  strict = false,
} = {}) {
  const root = await realpath(resolve(directory));
  if (basename(root) !== 'music' || basename(resolve(root, '..')) !== 'assets')
    throw new Error('Private library must be named assets/music.');
  const out = join(root, '.hls');
  try {
    if ((await lstat(out)).isSymbolicLink())
      throw new Error('Output may not be a symlink.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await mkdir(out, { recursive: true, mode: 0o750 });
  const lock = join(out, '.packaging.lock');
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }).catch(
    (e) => {
      if (e.code === 'EEXIST')
        throw new Error(
          'Packaging is already running; inspect a stale lock before removing it.',
        );
      throw e;
    },
  );
  try {
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter(
        (e) => !e.name.startsWith('.') && e.isFile() && EXTENSIONS.test(e.name),
      )
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (entries.length > maxFiles)
      throw new Error(
        `Library exceeds ${maxFiles} supported files; nothing was changed.`,
      );
    const tracks = [],
      failures = [];
    for (const entry of entries) {
      let temporary;
      try {
        const source = join(root, entry.name),
          before = await lstat(source);
        if (
          !before.isFile() ||
          before.isSymbolicLink() ||
          before.size > maxBytes ||
          before.size === 0 ||
          (await realpath(source)) !== source
        )
          throw new Error('Unsafe or oversized input.');
        // Identity is audio content, never a descriptive source filename or embedded tag.
        const hash = await hashFile(source),
          id = `t-${hash.slice(0, 24)}`;
        if (tracks.some((t) => t.id === id)) continue;
        const info = JSON.parse(
          await run(
            'ffprobe',
            [
              ...INPUT_OPTIONS,
              '-v',
              'error',
              '-select_streams',
              'a:0',
              '-show_entries',
              'stream=codec_type:format=duration:format_tags=title:stream_tags=title',
              '-of',
              'json',
              source,
            ],
            30000,
          ),
        );
        const duration = Number(info.format?.duration);
        if (
          !info.streams?.length ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          duration > maxSeconds
        )
          throw new Error('Missing audio stream or duration exceeds limit.');
        const title = trackTitle(info.format?.tags, info.streams[0]?.tags);
        if (!title) continue;
        const target = join(out, id);
        let track;
        try {
          if (
            (await lstat(target)).isSymbolicLink() ||
            (await realpath(target)) !== target
          )
            throw new Error('Unsafe cached package.');
          const cached = JSON.parse(
            await readFile(join(target, 'track.json'), 'utf8'),
          );
          if (
            cached.id !== id ||
            cached.init !== 'init.mp4' ||
            !Array.isArray(cached.chunks) ||
            !cached.chunks.length ||
            cached.chunks.length > 1802 ||
            !Number.isFinite(cached.duration) ||
            cached.duration <= 0 ||
            cached.duration > 7201 ||
            cached.chunks.some(
              (c) =>
                !Number.isFinite(c.duration) ||
                c.duration <= 0 ||
                c.duration > 4.1,
            ) ||
            Math.abs(
              cached.duration -
                cached.chunks.reduce((n, c) => n + c.duration, 0),
            ) > 0.01
          )
            throw new Error('Invalid cached track.');
          const cachedFiles = new Set();
          for (const file of [
            cached.init,
            ...(cached.spectrum ? [cached.spectrum] : []),
            ...(cached.chunks || []).map((c) => c.file),
          ]) {
            if (
              cachedFiles.has(file) ||
              !/^(init\.mp4|seg-\d{5}\.m4s|spectrum\.bin)$/.test(file)
            )
              throw new Error('Invalid cached file.');
            cachedFiles.add(file);
            const stat = await lstat(join(target, file));
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              !stat.size ||
              stat.size > (file === 'spectrum.bin' ? 1024 * 1024 : 256 * 1024)
            )
              throw new Error('Invalid cached package.');
            if (file === 'spectrum.bin') {
              const bytes = await readFile(join(target, file));
              if (
                bytes.length < 13 ||
                bytes.toString('ascii', 0, 4) !== 'GEQ1' ||
                bytes.readUInt32LE(4) > 7201 * 20 ||
                bytes.length !== 8 + bytes.readUInt32LE(4) * 5
              )
                throw new Error('Invalid cached spectrum.');
            }
          }
          if (
            cached.sourceHash === hash &&
            cached.packagerVersion === PACKAGER_VERSION &&
            cached.spectrum === 'spectrum.bin' &&
            cached.excerpt === excerpt
          )
            track = cached;
        } catch {
          /* New, corrupt or changed package is rebuilt atomically below. */
        }
        if (!track) {
          temporary = join(out, `.building-${id}-${process.pid}`);
          await mkdir(temporary, { mode: 0o750 });
          await run('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            ...INPUT_OPTIONS,
            '-threads',
            '1',
            '-i',
            source,
            '-map',
            '0:a:0',
            '-vn',
            '-sn',
            '-dn',
            '-map_metadata',
            '-1',
            '-map_metadata:s:a',
            '-1',
            '-map_chapters',
            '-1',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-threads',
            '1',
            '-metadata',
            `title=${title}`,
            '-fflags',
            '+bitexact',
            '-flags:a',
            '+bitexact',
            '-f',
            'hls',
            '-hls_time',
            '4',
            '-hls_playlist_type',
            'vod',
            '-hls_segment_type',
            'fmp4',
            '-hls_fmp4_init_filename',
            'init.mp4',
            '-hls_segment_filename',
            join(temporary, 'seg-%05d.m4s'),
            join(temporary, 'index.m3u8'),
          ]);
          await packageSpectrum(source, temporary, duration);
          const initPath = join(temporary, 'init.mp4');
          await writeFile(initPath, titleOnlyInit(await readFile(initPath)));
          const after = await lstat(source);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
            throw new Error(
              'Source changed during packaging; retry after copy completes.',
            );
          const manifest = await readFile(
            join(temporary, 'index.m3u8'),
            'utf8',
          );
          const chunks = [
            ...manifest.matchAll(/#EXTINF:([\d.]+),[^\n]*\n(seg-\d{5}\.m4s)/g),
          ].map((m) => ({ file: m[2], duration: Number(m[1]) }));
          if (
            !chunks.length ||
            chunks.some((c) => c.duration <= 0 || c.duration > 4.1)
          )
            throw new Error('Unexpected segment duration.');
          track = {
            id,
            title,
            excerpt,
            duration: chunks.reduce((n, c) => n + c.duration, 0),
            sourceHash: hash,
            packagerVersion: PACKAGER_VERSION,
            init: 'init.mp4',
            spectrum: 'spectrum.bin',
            chunks,
          };
          await writeFile(
            join(temporary, 'track.json'),
            `${JSON.stringify(track, null, 2)}\n`,
            { mode: 0o640 },
          );
          try {
            await rename(temporary, target);
          } catch (e) {
            if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e;
            // Content-addressed replacement only; no source files are touched.
            const old = `${target}.old-${process.pid}`;
            await rename(target, old);
            await rename(temporary, target);
            await rm(old, { recursive: true, force: true });
          }
          temporary = undefined;
        }
        const after = await lstat(source);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          throw new Error(
            'Source changed during packaging; retry after copy completes.',
          );
        // Refresh titles even when older audio segments remain safely reusable.
        tracks.push({ ...track, title });
      } catch (e) {
        failures.push({ file: entry.name, error: e.message });
        if (temporary) await rm(temporary, { recursive: true, force: true });
      }
    }
    // Never retain removed source tracks in the new public catalog. Old content-addressed
    // packages may be pruned separately after existing playback sessions have drained.
    const catalog = {
      version: 1,
      brand: BRAND,
      tracks,
    };
    // The bouncer updater uses strict mode: incomplete/invalid drops must not
    // replace a live catalog before an update can safely proceed. Successfully
    // cached packages remain reusable on the next run, but are not published.
    if (strict && failures.length)
      return {
        directory: root,
        packaged: tracks.length,
        failures,
        catalog,
        catalogUpdated: false,
      };
    const tempCatalog = join(out, `.catalog-${process.pid}.json`);
    await writeFile(tempCatalog, `${JSON.stringify(catalog, null, 2)}\n`, {
      mode: 0o640,
    });
    await rename(tempCatalog, join(out, 'catalog.json'));
    return {
      directory: root,
      packaged: tracks.length,
      failures,
      catalog,
      catalogUpdated: true,
    };
  } finally {
    await rm(lock, { force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await packageLibrary({
    directory: process.argv[2] || 'assets/music',
    excerpt: process.argv.includes('--excerpt'),
    strict: process.argv.includes('--strict'),
  });
  console.log(
    JSON.stringify(
      {
        packaged: result.packaged,
        failures: result.failures,
        catalogUpdated: result.catalogUpdated,
      },
      null,
      2,
    ),
  );
  if (result.failures.length) process.exitCode = 1;
}
