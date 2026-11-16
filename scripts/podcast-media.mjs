import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { podcastReleaseTime } from '../src/data/podcast.mjs';

sharp.cache(false);
sharp.concurrency(1);

// ID3v2.4 sizes are stored in four seven-bit bytes.
function tagSize(length) {
  if (length > 0x0fffffff) throw new Error('Podcast ID3 tag is too large');
  return Buffer.from([
    length >>> 21,
    (length >>> 14) & 127,
    (length >>> 7) & 127,
    length & 127,
  ]);
}

const byteLength = (parts) =>
  parts.reduce((length, part) => length + part.length, 0);
function frame(id, ...body) {
  return [Buffer.from(id), tagSize(byteLength(body)), Buffer.alloc(2), ...body];
}

async function cleanCover(cover) {
  if (!cover) return;
  try {
    // Keep the complete embedded picture, with a solid background for RSS.
    const bytes = await sharp(cover.bytes, { limitInputPixels: 32_000_000 })
      .rotate()
      .resize(2000, 2000, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 90 })
      .toBuffer();
    return { extension: 'jpg', bytes };
  } catch {
    console.warn('Omitting unreadable embedded podcast artwork');
  }
}

function publicTag(episode, cover, common, midnight) {
  const fields = {
    TIT2: episode.title,
    TPE1: common.artists?.join('\x00') || common.artist,
    TPE2: common.albumartist,
    TALB: common.album,
    TCOM: common.composer?.join('\x00'),
    TCOP: common.copyright,
    TRCK:
      common.track?.no &&
      [common.track.no, common.track.of].filter(Boolean).join('/'),
    TPOS:
      common.disk?.no &&
      [common.disk.no, common.disk.of].filter(Boolean).join('/'),
    TCON: episode.tags.join('\x00'),
    // ID3v2.4 specifies UTC with no zone suffix.
    TDRL: midnight.toISOString().slice(0, 19),
  };
  const parts = [];
  for (const [id, value] of Object.entries(fields)) {
    if (value) parts.push(...frame(id, Buffer.from('\x03' + value)));
  }
  if (episode.description)
    parts.push(
      ...frame('COMM', Buffer.from('\x03jpn\x00' + episode.description)),
    );
  if (cover) {
    const mime =
      'image/' + (cover.extension === 'jpg' ? 'jpeg' : cover.extension);
    parts.push(
      ...frame('APIC', Buffer.from(`\x03${mime}\x00\x03\x00`), cover.bytes),
    );
  }
  return [Buffer.from('ID3\x04\x00\x00'), tagSize(byteLength(parts)), ...parts];
}

export async function preparePodcastMedia(
  directory,
  key,
  sourceFd,
  result,
  common,
) {
  const midnight = podcastReleaseTime(result.episode.date);
  const cover = await cleanCover(result.cover);
  const tag = publicTag(result.episode, cover, common, midnight);
  const temp = join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temp, 'wx');
  try {
    // Keep large pictures and the recording out of a second in-memory buffer.
    await file.writeFile(tag);
    // Copy complete MPEG frames, including the original Xing/LAME seek data.
    // The extractor reads and writes already-open files at their current offsets.
    execFileSync('mpg123-strip', [], { stdio: [sourceFd, file.fd, 'pipe'] });
    const { size } = await file.stat();
    if (size <= byteLength(tag))
      throw new Error('No complete MP3 audio frames');
    await file.utimes(midnight, midnight);
    await rename(temp, join(directory, key));
    return { size, cover };
  } finally {
    await file.close();
    await rm(temp, { force: true });
  }
}
