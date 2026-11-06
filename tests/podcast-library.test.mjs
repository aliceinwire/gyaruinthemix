import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
const { refreshPodcast } = await import(
  process.env.PODCAST_INDEX_MODULE || '../scripts/podcast-index.mjs'
);

// ID3v2.4 frames followed by silent 128 kbps MPEG-1 Layer III frames.
const size = (n) =>
  Buffer.from([n >>> 21, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
const frame = (id, data) =>
  Buffer.concat([Buffer.from(id), size(data.length), Buffer.alloc(2), data]);
const field = (id, text) => frame(id, Buffer.from('\x03' + text));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z1Dxn4GBgYGJAQoAJh8CegWQX6EAAAAASUVORK5CYII=',
  'base64',
);
const payload = Buffer.from('tEXtCreation Time\x001991:02:03 04:05:06');
const length = Buffer.alloc(4);
length.writeUInt32BE(payload.length - 4);
const checksum = Buffer.alloc(4);
checksum.writeUInt32BE(crc32(payload));
const datedPng = Buffer.concat([
  png.subarray(0, 33),
  length,
  payload,
  checksum,
  png.subarray(33),
]);

function mp3(frames = []) {
  const tags = Buffer.concat(frames);
  const silent = Buffer.alloc(417);
  silent.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat([
    Buffer.from('ID3\x04\x00\x00'),
    size(tags.length),
    tags,
    ...Array(50).fill(silent),
  ]);
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const opts = {
    source: join(dir, 'input'),
    cache: join(dir, 'cache'),
    pages: join(dir, 'pages'),
    site: join(dir, 'www'),
    settleMs: 0,
    now: Date.parse('2026-11-06T14:59:59Z'),
  };
  await mkdir(opts.source);
  for (const prefix of ['', 'en/']) {
    const target = join(opts.site, prefix, 'podcast');
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, 'index.html'),
      '<html><head><!--podcast-sharing--><!--/podcast-sharing--></head><body><!--podcast-latest-->landing<!--/podcast-latest--><!--podcast-list-->empty<!--/podcast-list--></body></html>',
    );
  }
  return {
    ...opts,
    read: (file) => readFile(join(opts.pages, 'current', file), 'utf8'),
  };
}

function assertShareImage(html, url) {
  const head = html.split('</head>')[0];
  for (const tag of ['property="og:image"', 'name="twitter:image"']) {
    assert.equal(head.split(tag).length, 2, 'one image per sharing protocol');
    assert.ok(head.includes(`${tag} content="${url}"`));
  }
}

test('drop, retag and remove a real MP3 across both pages, artwork and the RSS', async (t) => {
  const f = await fixture(t);
  const name = '初回 #1 & ふたり.MP3';
  const path = join(f.source, name);
  const originalTag = Buffer.alloc(128);
  originalTag.write('TAG');
  originalTag.write('1988', 93);
  const apeValue = Buffer.from('2007-08-09T10:11:12');
  const apeKey = Buffer.from('Creation Date\0');
  const apeItem = Buffer.alloc(8);
  apeItem.writeUInt32LE(apeValue.length);
  const footer = Buffer.alloc(32);
  footer.write('APETAGEX');
  footer.writeUInt32LE(2000, 8);
  footer.writeUInt32LE(
    apeItem.length + apeKey.length + apeValue.length + footer.length,
    12,
  );
  footer.writeUInt32LE(1, 16);
  const audio = Buffer.concat([
    mp3([
      field('TIT2', 'ギャル <ふたり>'),
      field('TDRL', '1995-01-02T03:04:05'),
      field('TDRC', '2001-02-03T04:05:06'),
      field('TDTG', '2002-03-04T05:06:07'),
      field('TDEN', '2003-04-05T06:07:08'),
      field('TDOR', '2004-05-06T07:08:09'),
      field('TXXX', 'creation_time\x002005-06-07T08:09:10'),
      field('TPE1', 'DJありねぇ × DJちゃな'),
      frame('COMM', Buffer.from('\x03jpn\x00台本なし & ごはん')),
      field('TCON', 'Talk'),
      field('TXXX', 'TAGS\x00日常;東京;Talk;Podcast'),
      frame(
        'APIC',
        Buffer.concat([Buffer.from('\x03image/png\x00\x03\x00'), datedPng]),
      ),
    ]),
    apeItem,
    apeKey,
    apeValue,
    footer,
    originalTag,
  ]);
  await writeFile(path, audio);
  await refreshPodcast(f);
  const xml = await f.read('rss.xml');
  const guid = xml.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1];
  assert.ok(guid);
  assert.match(xml, /<title>ギャル &lt;ふたり&gt;<\/title>/);
  assert.match(xml, /<description>台本なし &amp; ごはん<\/description>/);
  assert.match(xml, /<category>東京<\/category>/);
  assert.match(xml, /<category>Podcast<\/category>/);
  assert.match(xml, /<itunes:duration>1<\/itunes:duration>/);
  assert.match(xml, /05 Nov 2026 15:00:00 GMT/);
  assert.ok(xml.includes(encodeURIComponent(name)));
  const publicFile = join(f.pages, 'current/audio', name);
  const sanitized = await readFile(publicFile);
  assert.deepEqual(await readFile(path), audio);
  assert.equal(
    (await stat(publicFile)).mtime.toISOString(),
    '2026-11-05T15:00:00.000Z',
  );
  assert.ok(xml.includes(`length="${sanitized.length}" type="audio/mpeg"`));
  assert.ok(sanitized.includes(Buffer.from('TDRL')));
  assert.ok(sanitized.includes(Buffer.from('2026-11-05T15:00:00')));
  assert.doesNotMatch(
    sanitized.toString('latin1'),
    /TDRC|TDTG|TDEN|TDOR|creation_time|1995-01|200[1-7]-|APETAGEX|1988|1991:02/,
  );
  for (const value of [
    'ギャル <ふたり>',
    'DJありねぇ × DJちゃな',
    '台本なし & ごはん',
    '東京',
    'image/png',
  ])
    assert.ok(sanitized.includes(Buffer.from(value)));
  assert.ok(sanitized.includes(mp3().subarray(10)), 'original MPEG frames');
  const cover = xml.match(
    /<itunes:image href="[^\"]*\/([0-9a-f]{64}\.png)"/,
  )?.[1];
  assert.ok(cover);
  const imageUrl = 'https://gyaruinthemix.com/podcast/artwork/' + cover;
  const [channel, item] = xml.split('<item>');
  assert.ok(channel.includes(`<itunes:image href="${imageUrl}"`));
  assert.ok(channel.includes(`<image><url>${imageUrl}</url>`));
  assert.ok(item.includes(`<itunes:image href="${imageUrl}"`));
  const publishedCover = await readFile(join(f.cache, 'artwork', cover));
  assert.ok(sanitized.includes(publishedCover));
  assert.deepEqual(
    publishedCover,
    png,
    'remove only the added picture metadata',
  );
  assert.ok(!publishedCover.includes(Buffer.from('1991:02')));
  for (const locale of ['ja', 'en']) {
    const html = await f.read(`${locale}.html`);
    assertShareImage(html, imageUrl);
    const player = html.match(/<audio\b[^>]*>[\s\S]*?<\/audio>/g) || [];
    assert.equal(player.length, 1);
    assert.match(player[0], /\bcontrols\b/);
    assert.match(player[0], /controlslist="nodownload"/);
    assert.match(player[0], /preload="none"/);
    assert.doesNotMatch(player[0], /\bautoplay\b/);
    assert.ok(
      player[0].includes(
        `src="/podcast/play/${encodeURIComponent(name.slice(0, -4))}/MP3" type="audio/mpeg"`,
      ),
    );
    const anchor = html.match(/<article[^>]+id="(episode-[^"]+)"/)[1];
    assert.ok(html.includes(`href="#${anchor}"`));
    assert.doesNotMatch(
      html,
      /\/podcast\/audio\/|音声ファイルを開く|Open audio file|<li>Podcast<\/li>|podcast-episode-actions/i,
    );
    for (const value of [
      cover,
      '日常',
      '台本なし &amp; ごはん',
      'ギャル &lt;ふたり&gt;',
    ])
      assert.ok(html.includes(value));
    assert.ok(
      html.includes(
        locale === 'en'
          ? 'Listen to the latest episode'
          : '最新エピソードを聴く',
      ),
    );
  }
  const first = await readlink(join(f.pages, 'current'));
  await refreshPodcast(f);
  assert.equal(await readlink(join(f.pages, 'current')), first);
  await writeFile(path, mp3([field('TIT2', '改題'), field('TDES', '第2稿')]));
  await refreshPodcast(f);
  const edited = await f.read('rss.xml');
  assert.ok(edited.includes(guid));
  assert.equal((edited.match(/<item>/g) || []).length, 1);
  assert.match(edited, /<title>改題<\/title>/);
  assert.doesNotMatch(edited, /<itunes:image|ごはん/);
  assert.match(await f.read('ja.html'), /第2稿/);
  for (const locale of ['ja', 'en'])
    assertShareImage(
      await f.read(`${locale}.html`),
      'https://gyaruinthemix.com/assets/logo.webp',
    );
  assert.deepEqual(await readdir(join(f.cache, 'artwork')), []);
  await rm(path);
  await refreshPodcast(f);
  await assert.rejects(readFile(publicFile), { code: 'ENOENT' });
  assert.deepEqual(await readdir(join(f.cache, 'audio')), []);
  assert.doesNotMatch(await f.read('rss.xml'), /<item>/);
  assert.match(await f.read('en.html'), /empty/);
  assert.doesNotMatch(await f.read('ja.html'), /<audio\b/);
});

test('untagged episodes publish with a stable date while hidden, partial, corrupt and linked files stay out', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, 'ひとやすみ.mp3'), mp3());
  await utimes(
    join(f.source, 'ひとやすみ.mp3'),
    new Date('1999-08-31T14:00:00Z'),
    new Date('1999-08-31T14:00:00Z'),
  );
  await writeFile(join(f.source, '.draft.mp3'), mp3());
  await writeFile(join(f.source, 'upload.mp3.part'), mp3());
  await writeFile(join(f.source, 'broken.mp3'), Buffer.from('broken'));
  await symlink(join(f.source, 'ひとやすみ.mp3'), join(f.source, 'linked.mp3'));
  await refreshPodcast({ ...f, now: Date.now(), settleMs: 60000 });
  assert.doesNotMatch(await f.read('rss.xml'), /<item>/);
  await refreshPodcast({ ...f, now: Date.parse('2025-02-28T15:00:00Z') });
  const first = await f.read('rss.xml');
  assert.equal((first.match(/<item>/g) || []).length, 1);
  assert.match(first, /<title>ひとやすみ<\/title>/);
  assert.doesNotMatch(first, /linked|draft|upload|broken/);
  const date = first.match(/<pubDate>.*?<\/pubDate>/)[0];
  assert.match(date, /28 Feb 2025/);
  assert.ok(
    (await f.read('ja.html')).includes(
      '<time datetime="2025-03-01">2025年3月1日</time>',
    ),
  );
  assert.ok(
    (await f.read('en.html')).includes(
      '<time datetime="2025-03-01">Mar 1, 2025</time>',
    ),
  );
  await writeFile(
    join(f.source, 'ひとやすみ.mp3'),
    mp3([field('TIT2', '新タイトル')]),
  );
  await rm(f.pages, { recursive: true });
  await refreshPodcast(f);
  assert.ok((await f.read('rss.xml')).includes(date));
});

test('migrates localized dates in the persistent podcast index without moving a published episode', async (t) => {
  const f = await fixture(t);
  const path = join(f.source, 'episode.mp3');
  await writeFile(path, mp3([field('TDRL', '2026-04-07')]));
  await refreshPodcast(f);
  const cacheFile = join(f.cache, 'index-v1.json');
  const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
  const record = cache[0][1];
  delete record.media;
  record.episode.date = '2026-04-07';
  record.firstDate = '11/06/2025';
  await writeFile(cacheFile, JSON.stringify(cache));
  await refreshPodcast(f);
  assert.match(
    await f.read('rss.xml'),
    /<pubDate>Mon, 06 Apr 2026 15:00:00 GMT<\/pubDate>/,
  );

  record.episode.date = '11/06/2025';
  await writeFile(cacheFile, JSON.stringify(cache));
  await rm(f.pages, { recursive: true });
  await refreshPodcast(f);
  const repaired = JSON.parse(await readFile(cacheFile, 'utf8'))[0][1];
  assert.equal(repaired.firstDate, '2025-11-06');
  assert.equal(repaired.episode.date, '2025-11-06');
  const rss = await f.read('rss.xml');
  const pubDate = '<pubDate>Wed, 05 Nov 2025 15:00:00 GMT</pubDate>';
  assert.ok(rss.includes(pubDate));
  const guid = rss.match(/<guid[^>]*>.*?<\/guid>/)[0];
  await writeFile(path, mp3([field('TIT2', 'New title')]));
  await refreshPodcast(f);
  const retagged = await f.read('rss.xml');
  assert.ok(retagged.includes(guid) && retagged.includes(pubDate));
});

test('curated publication day controls the MP3, RSS size and later date corrections', async (t) => {
  const f = await fixture(t);
  const name = 'curated.mp3';
  const url = 'https://gyaruinthemix.com/podcast/audio/' + name;
  const episode = {
    id: 'curated',
    published: true,
    explicit: false,
    date: '2024-03-01',
    title: { ja: '収録', en: 'Talk' },
    description: { ja: '感想', en: 'Notes' },
    audio: { url, type: 'audio/mpeg', length: 999 },
  };
  const config = {
    feed: {
      title: 'Show',
      description: 'Talk',
      author: 'Hosts',
      language: 'ja',
      category: 'Music',
      explicit: false,
    },
    platforms: {},
    episodes: [episode],
  };
  await writeFile(join(f.source, name), mp3([field('TDRC', '1999-11-12')]));
  const publicFile = join(f.pages, 'current/audio', name);
  for (const [date, midnight] of [
    ['2024-03-01', '2024-02-29T15:00:00'],
    ['2026-01-01', '2025-12-31T15:00:00'],
  ]) {
    episode.date = date;
    await refreshPodcast({ ...f, config });
    const bytes = await readFile(publicFile);
    assert.ok(bytes.includes(Buffer.from(midnight)));
    const timestamp = new Date(midnight + 'Z');
    assert.equal((await stat(publicFile)).mtimeMs, +timestamp);
    const rss = await f.read('rss.xml');
    assert.ok(rss.includes(`<pubDate>${timestamp.toUTCString()}</pubDate>`));
    assert.ok(rss.includes(`url="${url}" length="${bytes.length}"`));
    assert.equal((rss.match(/<item>/g) || []).length, 1);
  }
  await rm(await readlink(publicFile));
  await refreshPodcast({ ...f, config });
  assert.ok(
    (await readFile(publicFile)).includes(Buffer.from('2025-12-31T15:00:00')),
  );
  episode.published = false;
  await refreshPodcast({ ...f, config });
  await assert.rejects(readFile(publicFile), { code: 'ENOENT' });
  assert.doesNotMatch(await f.read('rss.xml'), /<item>/);
  const hidden = 'still-a-draft.mp3';
  config.episodes.push({
    published: false,
    audio: { url: url.replace(name, hidden) },
  });
  await writeFile(join(f.source, hidden), mp3());
  await refreshPodcast({ ...f, config });
  await assert.rejects(readFile(join(f.pages, 'current/audio', hidden)), {
    code: 'ENOENT',
  });
  config.episodes.pop();
  await refreshPodcast({
    ...f,
    config,
    now: Date.parse('2027-04-01T15:00:00Z'),
  });
  assert.ok(
    (await readFile(join(f.pages, 'current/audio', hidden))).includes(
      Buffer.from('2027-04-01T15:00:00'),
    ),
  );
});
