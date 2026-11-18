import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { podcastReleaseTime } from '../src/data/podcast.mjs';

const mediaTimeoutMs = 120_000;

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

function pictureFormat(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'png';
  if (['GIF89a', 'GIF87a'].includes(bytes.toString('ascii', 0, 6)))
    return 'gif';
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
}

async function cleanCover(directory, pictures = []) {
  if (!pictures.length) return;
  const candidates = pictures.toSorted(
    (a, b) =>
      Number(b.type === 'Cover (front)') - Number(a.type === 'Cover (front)'),
  );
  // Keep the pixel cache on the media volume, outside the web container's tmpfs.
  const stage = await mkdtemp(join(directory, '.cover-'));
  try {
    for (const { data } of candidates) {
      const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const format = pictureFormat(input);
      if (!format) continue;
      try {
        const bytes = execFileSync(
          'convert',
          [
            '-define',
            'jpeg:size=3000x3000',
            format + ':-[0]',
            '-auto-orient',
            '-colorspace',
            'sRGB',
            '-background',
            'white',
            '-alpha',
            'remove',
            '-alpha',
            'off',
            '-resize',
            '3000x3000',
            '-gravity',
            'center',
            '-extent',
            '3000x3000',
            '+repage',
            '-strip',
            '-type',
            'TrueColor',
            '-quality',
            '90',
            'jpeg:-',
          ],
          {
            input,
            env: {
              ...process.env,
              MAGICK_TEMPORARY_PATH: stage,
              MAGICK_MEMORY_LIMIT: '16MiB',
              MAGICK_MAP_LIMIT: '0',
              MAGICK_DISK_LIMIT: '768MiB',
              MAGICK_THREAD_LIMIT: '1',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 16 * 1024 * 1024,
            timeout: mediaTimeoutMs,
            killSignal: 'SIGKILL',
          },
        );
        return { extension: 'jpg', bytes };
      } catch (error) {
        if (error.code || error.signal) throw error;
        // A damaged front cover can coexist with another usable embedded picture.
      }
    }
    throw new Error('Could not convert the embedded podcast artwork');
  } finally {
    await rm(stage, { recursive: true, force: true });
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
  episode,
  common,
) {
  const midnight = podcastReleaseTime(episode.date);
  const cover = await cleanCover(directory, common.picture);
  const tag = publicTag(episode, cover, common, midnight);
  const temp = join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temp, 'wx');
  try {
    // Keep large pictures and the recording out of a second in-memory buffer.
    await file.writeFile(tag);
    // Copy complete MPEG frames, including the original Xing/LAME seek data.
    // The extractor reads and writes already-open files at their current offsets.
    execFileSync('mpg123-strip', [], {
      stdio: [sourceFd, file.fd, 'pipe'],
      timeout: mediaTimeoutMs,
      killSignal: 'SIGKILL',
    });
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
