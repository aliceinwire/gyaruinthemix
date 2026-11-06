import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDeUAAAAASUVORK5CYII=',
  'base64',
);
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
  const audio = mp3([
    field('TIT2', 'ギャル <ふたり>'),
    field('TDRL', '2026-11-06'),
    frame('COMM', Buffer.from('\x03jpn\x00台本なし & ごはん')),
    field('TCON', 'Talk'),
    field('TXXX', 'TAGS\x00日常;東京;Talk;Podcast'),
    frame(
      'APIC',
      Buffer.concat([Buffer.from('\x03image/png\x00\x03\x00'), png]),
    ),
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
  assert.ok(xml.includes(`length="${audio.length}" type="audio/mpeg"`));
  const cover = xml.match(
    /<itunes:image href="[^\"]*\/([0-9a-f]{64}\.png)"/,
  )?.[1];
  assert.ok(cover);
  const imageUrl = 'https://gyaruinthemix.com/podcast/artwork/' + cover;
  const [channel, item] = xml.split('<item>');
  assert.ok(channel.includes(`<itunes:image href="${imageUrl}"`));
  assert.ok(channel.includes(`<image><url>${imageUrl}</url>`));
  assert.ok(item.includes(`<itunes:image href="${imageUrl}"`));
  assert.deepEqual(await readFile(join(f.cache, 'artwork', cover)), png);
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
  assert.doesNotMatch(await f.read('rss.xml'), /<item>/);
  assert.match(await f.read('en.html'), /empty/);
  assert.doesNotMatch(await f.read('ja.html'), /<audio\b/);
});

test('untagged episodes publish with a stable date while hidden, partial, corrupt and linked files stay out', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, 'ひとやすみ.mp3'), mp3());
  await utimes(
    join(f.source, 'ひとやすみ.mp3'),
    new Date('2025-02-28T15:00:00Z'),
    new Date('2025-02-28T15:00:00Z'),
  );
  await writeFile(join(f.source, '.draft.mp3'), mp3());
  await writeFile(join(f.source, 'upload.mp3.part'), mp3());
  await writeFile(join(f.source, 'broken.mp3'), Buffer.from('broken'));
  await symlink(join(f.source, 'ひとやすみ.mp3'), join(f.source, 'linked.mp3'));
  await refreshPodcast({ ...f, settleMs: 60000 });
  assert.doesNotMatch(await f.read('rss.xml'), /<item>/);
  await refreshPodcast(f);
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
