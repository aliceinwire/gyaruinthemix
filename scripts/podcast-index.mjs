import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseFile } from 'music-metadata';
import configuration from '../config/podcast.json' with { type: 'json' };
import { isCalendarDate, japanDate } from '../src/data/events.mjs';
import { createPodcastFeed } from '../src/data/podcast-feed.mjs';
import { getPodcast } from '../src/data/podcast.mjs';
import {
  episodeList,
  fillPodcastSlot,
  latestLink,
} from '../src/data/podcast-view.mjs';
import { canonicalUrl } from '../src/data/urls.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const fingerprint = (stat) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
const text = (value) =>
  typeof value === 'string'
    ? value
        .replace(
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu,
          '',
        )
        .trim()
    : '';

async function optional(read) {
  try {
    return await read;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function atomicWrite(path, data) {
  const next = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(next, data, { flag: 'wx' });
    await rename(next, path);
  } finally {
    await rm(next, { force: true });
  }
}

function artwork(pictures = []) {
  const candidates = [...pictures].sort(
    (a, b) =>
      Number(b.type === 'Cover (front)') - Number(a.type === 'Cover (front)'),
  );
  for (const { data } of candidates) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    let extension;
    if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
      extension = 'jpg';
    else if (
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    )
      extension = 'png';
    else if (['GIF89a', 'GIF87a'].includes(bytes.toString('ascii', 0, 6)))
      extension = 'gif';
    else if (
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    )
      extension = 'webp';
    if (extension) return { name: `${hash(bytes)}.${extension}`, bytes };
  }
}

function episodeFromTags(name, size, firstDate, metadata) {
  const { common, format, native } = metadata;
  if (!/^MPEG .+ Layer 3$/.test(format.codec || '') || !format.sampleRate)
    throw new Error('No MP3 audio frames');
  const frames = Object.values(native).flat();
  const custom = (pattern) =>
    frames
      .filter((tag) => pattern.test(tag.id))
      .flatMap((tag) => tag.value)
      .map(text)
      .filter(Boolean);
  const notes = [
    ...(common.description || []),
    ...(common.notes || []),
    ...custom(/^T(?:XXX|XX):(?:show[ _-]?notes|notes|description|comment)$/i),
    ...(common.comment || [])
      .filter((c) => !/^iTun/i.test(c.descriptor || c.description || ''))
      .map((c) => c.text),
  ]
    .map(text)
    .find(Boolean);
  const tags = [
    ...(common.genre || []),
    ...(common.keywords || []),
    ...(common.category || []),
    ...custom(/^T(?:XXX|XX):(?:tags?|keywords?|genre|category)$/i),
  ];
  const date =
    [common.releasedate, common.date]
      .map((s) => s?.slice(0, 10))
      .find(isCalendarDate) || firstDate;
  const url = canonicalUrl('/podcast/audio/' + encodeURIComponent(name));
  const cover = artwork(common.picture);
  const duration = Math.round(format.duration || 0);
  return {
    cover,
    episode: {
      id: 'mp3-' + hash(name).slice(0, 24),
      date,
      title: text(common.title) || text(name.slice(0, -4)) || 'MP3',
      description: notes || '',
      tags: [
        ...new Set(
          tags
            .flatMap((s) =>
              typeof s === 'string' ? s.split(/[,;、\u0000]/u) : [],
            )
            .map(text)
            .filter(Boolean),
        ),
      ],
      ...(cover && {
        artworkUrl: canonicalUrl('/podcast/artwork/' + cover.name),
      }),
      ...(Number.isSafeInteger(duration) &&
        duration > 0 && {
          durationSeconds: duration,
          durationMinutes: Math.max(1, Math.round(duration / 60)),
        }),
      audio: { url, length: size, type: 'audio/mpeg' },
      url,
    },
  };
}

async function readEpisode(path, name, stat, firstDate) {
  // Parse the already-open regular file, even if an uploader replaces its name.
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    if (fingerprint(await file.stat({ bigint: true })) !== fingerprint(stat))
      return;
    const metadata = await parseFile(`/proc/self/fd/${file.fd}`, {
      duration: true,
      maxMemoryAllocation: 16 * 1024 * 1024,
      maxMetadataEntries: 4096,
    });
    if (fingerprint(await lstat(path, { bigint: true })) !== fingerprint(stat))
      return;
    return episodeFromTags(name, Number(stat.size), firstDate, metadata);
  } finally {
    await file.close();
  }
}

async function publishPages(site, pages, library, key) {
  await mkdir(pages, { recursive: true });
  const current = join(pages, 'current');
  if ((await optional(readFile(join(current, 'key'), 'utf8'))) === key) return;
  const previous = await optional(readlink(current));
  const stage = await mkdtemp(join(pages, 'edition-'));
  const next = stage + '.link';
  try {
    for (const locale of ['ja', 'en']) {
      let page = await readFile(
        join(site, locale === 'ja' ? '' : 'en', 'podcast/index.html'),
        'utf8',
      );
      const { episodes } = getPodcast(configuration, locale, library);
      if (episodes.length) {
        page = fillPodcastSlot(page, 'latest', latestLink(episodes[0], locale));
        page = fillPodcastSlot(page, 'list', episodeList(episodes, locale));
      }
      await writeFile(join(stage, locale + '.html'), page);
    }
    await writeFile(
      join(stage, 'rss.xml'),
      createPodcastFeed(configuration, library),
    );
    await writeFile(join(stage, 'key'), key);
    await symlink(basename(stage), next);
    await rename(next, current);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    await rm(next, { force: true });
    throw error;
  }
  if (previous && /^edition-[a-zA-Z0-9]+$/.test(previous))
    await rm(join(pages, previous), { recursive: true, force: true });
}

export async function refreshPodcast({
  source,
  cache,
  pages,
  site,
  now = Date.now(),
  settleMs = 10_000,
}) {
  const covers = join(cache, 'artwork');
  await mkdir(covers, { recursive: true });
  const existingCovers = new Set(await readdir(covers));
  const stateFile = join(cache, 'index-v1.json');
  const saved = await optional(readFile(stateFile, 'utf8'));
  const old = new Map(JSON.parse(saved || '[]'));
  const entries = new Map();
  const files = (await readdir(source, { withFileTypes: true }))
    .filter(
      (f) =>
        f.isFile() &&
        !f.name.startsWith('.') &&
        !/[\x00-\x1f\x7f\\]/u.test(f.name) &&
        /\.mp3$/i.test(f.name),
    )
    .map((f) => f.name)
    .sort();
  for (const name of files) {
    const path = join(source, name);
    const before = await optional(lstat(path, { bigint: true }));
    if (!before?.isFile()) continue;
    const signature = fingerprint(before);
    const prior = old.get(name);
    if (
      (prior?.signature === signature &&
        (!prior.episode?.artworkUrl ||
          existingCovers.has(basename(prior.episode.artworkUrl)))) ||
      (settleMs > 0 && now - Number(before.ctimeMs) < settleMs)
    ) {
      if (prior) entries.set(name, prior);
      continue;
    }
    const firstDate =
      prior?.firstDate || japanDate(new Date(Number(before.mtimeMs)));
    let result;
    try {
      result = await readEpisode(path, name, before, firstDate);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ELOOP') continue;
      if (error.code && ['EIO', 'EMFILE'].includes(error.code)) throw error;
      console.warn(
        `Skipping podcast file ${JSON.stringify(name)}: ${error.message}`,
      );
      if (error.code !== 'EACCES' && error.code !== 'EPERM')
        entries.set(name, { signature, firstDate });
      continue;
    }
    if (!result) {
      if (prior) entries.set(name, prior);
      continue;
    }
    if (result.cover && !existingCovers.has(result.cover.name)) {
      await atomicWrite(join(covers, result.cover.name), result.cover.bytes);
      existingCovers.add(result.cover.name);
    }
    entries.set(name, { signature, firstDate, episode: result.episode });
  }
  const library = [...entries.values()].flatMap(({ episode }) =>
    episode ? [{ ...episode, explicit: configuration.feed.explicit }] : [],
  );
  const serialized = JSON.stringify([...entries]);
  await publishPages(site, pages, library, hash(serialized));
  if (serialized !== saved) await atomicWrite(stateFile, serialized);
  // An unreferenced episode cover should disappear when its source is removed.
  const activeArt = new Set(
    library.filter((e) => e.artworkUrl).map((e) => basename(e.artworkUrl)),
  );
  for (const name of existingCovers) {
    if (/^[a-f0-9]{64}\.(jpg|png|gif|webp)$/.test(name) && !activeArt.has(name))
      await rm(join(covers, name), { force: true });
  }
}

if (import.meta.main) {
  await refreshPodcast({
    source: '/podcast-source',
    cache: '/var/lib/podcast',
    pages: '/tmp/podcast-pages',
    site: '/usr/share/nginx/html',
  });
}
