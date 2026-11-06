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
import { basename, join, resolve } from 'node:path';
import { preparePodcastMedia } from './podcast-media.mjs';
import { parseFile } from 'music-metadata';
import configuration from '../config/podcast.json' with { type: 'json' };
import { isCalendarDate, japanDate } from '../src/data/events.mjs';
import { createPodcastFeed } from '../src/data/podcast-feed.mjs';
import { getPodcast } from '../src/data/podcast.mjs';
import {
  episodeList,
  fillPodcastSlot,
  latestLink,
  sharingImageTags,
} from '../src/data/podcast-view.mjs';
import { canonicalUrl } from '../src/data/urls.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const uploadId = (name) => 'mp3-' + hash(name).slice(0, 24);
const fingerprint = (stat) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

function cachedCalendarDate(value) {
  if (typeof value !== 'string') return;
  // Older web images could write the English month/day/year fallback to the cache.
  const iso = value.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2');
  return isCalendarDate(iso) ? iso : undefined;
}

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
    if (extension) return { extension, bytes };
  }
}

function episodeFromTags(name, url, date, metadata) {
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
  const cover = artwork(common.picture);
  const duration = Math.round(format.duration || 0);
  return {
    cover,
    episode: {
      id: uploadId(name),
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
      ...(Number.isSafeInteger(duration) &&
        duration > 0 && {
          durationSeconds: duration,
          durationMinutes: Math.max(1, Math.round(duration / 60)),
        }),
      audio: { url, type: 'audio/mpeg' },
      url,
    },
  };
}

async function readEpisode(path, name, stat, url, date, mediaDir, mediaKey) {
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
    const result = episodeFromTags(name, url, date, metadata);
    try {
      const media = await preparePodcastMedia(
        mediaDir,
        mediaKey,
        file.fd,
        result,
        metadata.common,
      );
      result.episode.audio.length = media.size;
      result.cover = media.cover;
    } catch (error) {
      console.warn(
        `Retrying podcast file ${JSON.stringify(name)} on the next scan: ${error.message}`,
      );
      return;
    }
    if (fingerprint(await lstat(path, { bigint: true })) !== fingerprint(stat))
      return;
    return result;
  } finally {
    await file.close();
  }
}

async function publishPages(site, pages, config, mediaDir, published, key) {
  await mkdir(pages, { recursive: true });
  const current = join(pages, 'current');
  if ((await optional(readFile(join(current, 'key'), 'utf8'))) === key) return;
  const previous = await optional(readlink(current));
  const stage = await mkdtemp(join(pages, 'edition-'));
  const next = stage + '.link';
  try {
    const library = published.map(([, entry]) => ({
      ...entry.episode,
      explicit: config.feed.explicit,
    }));
    const audio = join(stage, 'audio');
    await mkdir(audio);
    const publicDates = new Map(
      getPodcast(config, 'ja', library).episodes.map((episode) => [
        episode.audio?.url,
        episode.date,
      ]),
    );
    for (const [name, entry] of published) {
      const day = publicDates.get(entry.episode.audio.url);
      if (!day) continue;
      if (day !== entry.episode.date)
        throw new Error('Updated podcast media is not ready');
      await symlink(resolve(mediaDir, entry.media), join(audio, name));
    }
    for (const locale of ['ja', 'en']) {
      let page = await readFile(
        join(site, locale === 'ja' ? '' : 'en', 'podcast/index.html'),
        'utf8',
      );
      const { episodes } = getPodcast(config, locale, library);
      page = fillPodcastSlot(
        page,
        'sharing',
        sharingImageTags(config.feed, episodes, locale),
      );
      if (episodes.length) {
        page = fillPodcastSlot(page, 'latest', latestLink(episodes[0], locale));
        page = fillPodcastSlot(page, 'list', episodeList(episodes, locale));
      }
      await writeFile(join(stage, locale + '.html'), page);
    }
    await writeFile(join(stage, 'rss.xml'), createPodcastFeed(config, library));
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
  config = configuration,
  now = Date.now(),
  settleMs = 10_000,
}) {
  const mediaDir = join(cache, 'audio');
  await mkdir(mediaDir, { recursive: true });
  const existingMedia = new Set();
  for (const file of await readdir(mediaDir, { withFileTypes: true })) {
    if (file.isFile() && /^[a-f0-9]{64}\.mp3$/.test(file.name))
      existingMedia.add(file.name);
    // The production scanner holds the volume lock. A temp file here survived an interruption.
    else if (/^\.[a-f0-9-]{36}\.tmp$/.test(file.name))
      await rm(join(mediaDir, file.name), { force: true });
  }
  const configuredDates = new Map(
    config.episodes
      .filter((e) => e.published && e.audio)
      .map((e) => [e.audio.url, e.date]),
  );
  const drafts = new Set(
    config.episodes
      .filter((e) => !e.published)
      .flatMap((e) => [e.id, e.audio?.url]),
  );
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
    const url = canonicalUrl('/podcast/audio/' + encodeURIComponent(name));
    if (drafts.has(url) || drafts.has(uploadId(name))) {
      if (prior?.episode) entries.set(name, prior);
      continue;
    }
    // Older indexes recorded the publicly announced day in episode.date.
    const firstDate =
      (prior?.media && cachedCalendarDate(prior.firstDate)) ||
      cachedCalendarDate(prior?.episode?.date) ||
      (prior?.episode && cachedCalendarDate(prior.firstDate)) ||
      japanDate(new Date(now));
    const date = configuredDates.get(url) ?? firstDate;
    if (!isCalendarDate(date)) throw new Error('Invalid podcast release date');
    const media =
      hash(JSON.stringify(['release-v1', name, signature, date])) + '.mp3';
    const reusable =
      prior?.media === media &&
      existingMedia.has(media) &&
      (!prior.episode.artworkUrl ||
        existingCovers.has(basename(prior.episode.artworkUrl)));
    if (
      reusable ||
      (prior?.signature === signature && prior.skipped) ||
      (settleMs > 0 && now - Number(before.ctimeMs) < settleMs)
    ) {
      if (prior) entries.set(name, prior);
      continue;
    }
    let result;
    try {
      result = await readEpisode(
        path,
        name,
        before,
        url,
        date,
        mediaDir,
        media,
      );
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ELOOP') continue;
      if (error.code && ['EIO', 'EMFILE'].includes(error.code)) throw error;
      console.warn(
        `Skipping podcast file ${JSON.stringify(name)}: ${error.message}`,
      );
      if (prior?.episode) entries.set(name, prior);
      else if (error.code !== 'EACCES' && error.code !== 'EPERM')
        entries.set(name, { signature, skipped: true });
      continue;
    }
    if (!result) {
      if (prior) entries.set(name, prior);
      continue;
    }
    if (result.cover) {
      const { bytes, extension } = result.cover;
      const coverName = `${hash(bytes)}.${extension}`;
      if (!existingCovers.has(coverName)) {
        await atomicWrite(join(covers, coverName), bytes);
        existingCovers.add(coverName);
      }
      result.episode.artworkUrl = canonicalUrl('/podcast/artwork/' + coverName);
    }
    existingMedia.add(media);
    entries.set(name, { signature, firstDate, media, episode: result.episode });
  }
  const published = [...entries].filter(
    ([, entry]) => entry.episode && existingMedia.has(entry.media),
  );
  const serialized = JSON.stringify([...entries]);
  await publishPages(
    site,
    pages,
    config,
    mediaDir,
    published,
    hash(
      JSON.stringify(config) +
        '\n' +
        serialized +
        '\n' +
        JSON.stringify(published.map(([, entry]) => entry.media)),
    ),
  );
  if (serialized !== saved) await atomicWrite(stateFile, serialized);
  const activeMedia = new Set(published.map(([, entry]) => entry.media));
  for (const name of existingMedia) {
    if (!activeMedia.has(name)) await rm(join(mediaDir, name), { force: true });
  }
  // An unreferenced episode cover should disappear when its source is removed.
  const artworkPrefix = canonicalUrl('/podcast/artwork/');
  const activeArt = new Set(
    [
      config.feed.artworkUrl,
      ...published.map(([, entry]) => entry.episode.artworkUrl),
      ...config.episodes
        .filter((episode) => episode.published === true)
        .map((episode) => episode.artworkUrl),
    ]
      .filter((url) => url?.startsWith(artworkPrefix))
      .map((url) => basename(new URL(url).pathname)),
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
