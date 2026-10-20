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
import { createHash } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const EXTENSIONS = /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i;
const BRAND = 'ギャルインザミックス';
async function run(command, args, timeout = 1800000) {
  return new Promise((done, fail) => {
    const p = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
            ...(cached.chunks || []).map((c) => c.file),
          ]) {
            if (
              cachedFiles.has(file) ||
              !/^(init\.mp4|seg-\d{5}\.m4s)$/.test(file)
            )
              throw new Error('Invalid cached file.');
            cachedFiles.add(file);
            const stat = await lstat(join(target, file));
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              !stat.size ||
              stat.size > 256 * 1024
            )
              throw new Error('Invalid cached package.');
          }
          if (
            cached.sourceHash === hash &&
            cached.packagerVersion === 1 &&
            cached.excerpt === excerpt
          )
            track = cached;
        } catch {
          /* New, corrupt or changed package is rebuilt atomically below. */
        }
        if (!track) {
          const info = JSON.parse(
            await run(
              'ffprobe',
              [
                '-v',
                'error',
                '-select_streams',
                'a:0',
                '-show_entries',
                'stream=codec_type:format=duration',
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
          temporary = join(out, `.building-${id}-${process.pid}`);
          await mkdir(temporary, { mode: 0o750 });
          await run('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
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
            `title=${BRAND}`,
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
            title: BRAND,
            excerpt,
            duration: chunks.reduce((n, c) => n + c.duration, 0),
            sourceHash: hash,
            packagerVersion: 1,
            init: 'init.mp4',
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
        tracks.push(track);
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
      tracks: tracks.map((t, i) => ({
        ...t,
        title: `${BRAND} ${String(i + 1).padStart(2, '0')}`,
      })),
    };
    const tempCatalog = join(out, `.catalog-${process.pid}.json`);
    await writeFile(tempCatalog, `${JSON.stringify(catalog, null, 2)}\n`, {
      mode: 0o640,
    });
    await rename(tempCatalog, join(out, 'catalog.json'));
    return { directory: root, packaged: tracks.length, failures, catalog };
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
  });
  console.log(
    JSON.stringify(
      { packaged: result.packaged, failures: result.failures },
      null,
      2,
    ),
  );
  if (result.failures.length) process.exitCode = 1;
}
