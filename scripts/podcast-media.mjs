import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { podcastReleaseTime } from '../src/data/podcast.mjs';

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

function cleanCover(cover) {
  if (!cover) return;
  // Rebuild pixels so the embedded picture cannot carry EXIF, XMP or PNG times.
  const jpeg = cover.extension === 'jpg';
  const codec = jpeg ? 'mjpeg' : 'png';
  // prettier-ignore
  const args = [
    '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1',
    '-f', 'image2pipe', '-protocol_whitelist', 'pipe', '-max_pixels', '20000000', '-i', 'pipe:0',
    '-frames:v', '1', '-vf', 'sidedata=mode=delete', '-map_metadata', '-1', '-c:v', codec, '-threads:v', '1',
    ...(jpeg ? ['-q:v', '2'] : []), '-fflags', '+bitexact', '-f', 'image2pipe', 'pipe:1',
  ];
  let bytes;
  try {
    bytes = execFileSync('ffmpeg', args, {
      input: cover.bytes,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (error.code && error.code !== 'ENOBUFS') throw error;
    console.warn('Omitting unreadable embedded podcast artwork');
    return;
  }
  if (!bytes.length) return;
  return { extension: jpeg ? 'jpg' : 'png', bytes };
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
    const mime = cover.extension === 'jpg' ? 'image/jpeg' : 'image/png';
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
  const cover = cleanCover(result.cover);
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
