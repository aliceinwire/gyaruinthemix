import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createPodcastFeed,
  podcastFeedUrl,
} from '../src/data/podcast-feed.mjs';
import { getPodcast } from '../src/data/podcast.mjs';
import { sharingImageTags } from '../src/data/podcast-view.mjs';
import { GET } from '../src/pages/podcast/rss.xml.js';

const configuration = JSON.parse(await readFile('config/podcast.json', 'utf8'));
const episode = (overrides = {}) => ({
  id: 'first-conversation',
  published: true,
  date: '2026-11-05',
  title: { ja: '最初のトーク', en: 'Our first conversation' },
  description: { ja: 'ふたりで話す。', en: 'A conversation.' },
  audio: {
    url: 'https://example.com/first.mp3',
    length: 123456,
    type: 'audio/mpeg',
  },
  explicit: false,
  durationSeconds: 615,
  ...overrides,
});
const data = (episodes = []) => ({
  ...structuredClone(configuration),
  feed: {
    ...configuration.feed,
    artworkUrl: 'https://example.com/cover.jpg',
    ownerEmail: 'podcast@example.com',
  },
  episodes,
});

test('RSS endpoint matches the configured subscription URL and returns UTF-8 RSS', async () => {
  assert.equal(configuration.platforms.rss, podcastFeedUrl);
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('Content-Type'),
    'application/rss+xml; charset=utf-8',
  );
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  assert.equal(await response.text(), createPodcastFeed(configuration));
});

test('an empty feed includes the default contact and no invented artwork or episodes', () => {
  const input = data();
  input.feed.artworkUrl = '';
  input.feed.ownerEmail = '';
  const xml = createPodcastFeed(input);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2.0"/);
  assert.match(xml, /<language>ja<\/language>/);
  assert.match(
    xml,
    /<atom:link href="https:\/\/gyaruinthemix.com\/podcast\/rss.xml" rel="self" type="application\/rss\+xml"/,
  );
  assert.match(xml, /<itunes:email>arisut@riseup\.net<\/itunes:email>/);
  assert.doesNotMatch(xml, /<item>|itunes:image|undefined/);
});

test('the show category stays separate from episode tags and escapes RSS attributes', () => {
  assert.equal(configuration.feed.category, 'Comedy');
  const input = data();
  const library = [
    {
      ...episode(),
      title: 'Food talk',
      description: 'About food.',
      tags: ['Food'],
    },
  ];
  const [channel, item] = createPodcastFeed(input, library).split('<item>');
  assert.match(channel, /<itunes:category text="Comedy" \/>/);
  assert.doesNotMatch(channel, /<category>Food<\/category>/);
  assert.match(item, /<category>Food<\/category>/);
  assert.doesNotMatch(item, /<itunes:category/);
  input.feed.category = 'Society & Culture';
  assert.match(
    createPodcastFeed(input, library),
    /<itunes:category text="Society &amp; Culture" \/>/,
  );
});

test('show copyright is preserved, escaped and optional in RSS', () => {
  const notice = '© ギャルインザミックス - All Rights Reserved';
  assert.equal(configuration.feed.copyright, notice);
  assert.ok(
    createPodcastFeed(configuration).includes(
      `<copyright>${notice}</copyright>`,
    ),
  );
  const input = data([episode()]);
  input.feed.copyright = '© Hosts & <Guests> "Worldwide"';
  const [channel, item] = createPodcastFeed(input).split('<item>');
  assert.ok(
    channel.includes(
      '<copyright>© Hosts &amp; &lt;Guests&gt; &quot;Worldwide&quot;</copyright>',
    ),
  );
  assert.doesNotMatch(item, /<copyright>/);
  delete input.feed.copyright;
  assert.doesNotMatch(createPodcastFeed(input), /<copyright>/);
  for (const invalid of ['', ' ', 2026, null]) {
    input.feed.copyright = invalid;
    assert.throws(() => createPodcastFeed(input), /copyright is required/);
  }
});

test('published audio uses the same source on the website and in RSS', () => {
  const input = data([episode()]);
  assert.equal(getPodcast(input).episodes[0].url, input.episodes[0].audio.url);
  assert.equal(
    getPodcast(input, 'en').episodes[0].audio.url,
    input.episodes[0].audio.url,
  );
  const xml = createPodcastFeed(input);
  assert.match(
    xml,
    /<enclosure url="https:\/\/example.com\/first.mp3" length="123456" type="audio\/mpeg" \/>/,
  );
  assert.match(xml, /<itunes:duration>615<\/itunes:duration>/);
  assert.match(xml, /<pubDate>Wed, 04 Nov 2026 15:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<itunes:image href="https:\/\/example.com\/cover.jpg"/);
  assert.match(xml, /<itunes:email>podcast@example.com<\/itunes:email>/);
  assert.match(
    xml,
    /<link>https:\/\/gyaruinthemix.com\/podcast\/#episode-first-conversation<\/link>/,
  );
});

test('show and episode descriptions are available to RSS, iTunes and rich-text readers', () => {
  const input = data([episode()]);
  const [channel, item] = createPodcastFeed(input).split('<item>');
  assert.match(
    channel,
    /xmlns:content="http:\/\/purl.org\/rss\/1.0\/modules\/content\/"/,
  );
  assert.ok(
    channel.includes(`<description>${input.feed.description}</description>`),
  );
  assert.ok(
    channel.includes(
      `<itunes:summary>${input.feed.description}</itunes:summary>`,
    ),
  );
  assert.match(item, /<description>ふたりで話す。<\/description>/);
  assert.match(item, /<itunes:summary>ふたりで話す。<\/itunes:summary>/);
  assert.match(
    item,
    /<content:encoded>&lt;p&gt;ふたりで話す。&lt;\/p&gt;<\/content:encoded>/,
  );
});

test('uploaded episodes keep embedded notes and otherwise get a real description without new episodes', () => {
  const input = structuredClone(configuration);
  const id = 'mp3-d3e83899fd3eca99ceea7cd3';
  const uploaded = {
    id,
    title: 'Episode one',
    date: '2026-11-12',
    description: '',
    audio: {
      url: 'https://example.com/one.mp3',
      length: 100,
      type: 'audio/mpeg',
    },
    artworkUrl: 'https://example.com/embedded.jpg',
    explicit: false,
  };
  assert.equal(getPodcast(input).episodes.length, 0);
  for (const locale of ['ja', 'en']) {
    const result = getPodcast(input, locale, [uploaded]);
    assert.equal(result.episodes.length, 1);
    assert.equal(result.episodes[0].id, id);
    assert.equal(
      result.episodes[0].description,
      input.episodeDescriptions[id][locale],
    );
    assert.equal(result.episodes[0].artworkUrl, uploaded.artworkUrl);
  }
  const [channel, item] = createPodcastFeed(input, [uploaded]).split('<item>');
  assert.ok(channel.includes(input.feed.artworkUrl));
  assert.ok(!channel.includes(uploaded.artworkUrl));
  assert.ok(item.includes(uploaded.artworkUrl));
  assert.ok(item.includes(input.episodeDescriptions[id].ja));
  uploaded.description = 'New notes from the MP3';
  assert.equal(
    getPodcast(input, 'ja', [uploaded]).episodes[0].description,
    uploaded.description,
  );
  for (const empty of ['', '  ', 'Podcast']) {
    const other = { ...uploaded, id: 'new-upload', description: empty };
    assert.equal(
      getPodcast(input, 'ja', [other]).episodes[0].description,
      input.feed.description,
    );
    assert.equal(
      getPodcast(input, 'en', [other]).episodes[0].description,
      input.feed.descriptionEn,
    );
  }
  assert.equal(input.episodes.length, 0);
});

test('RSS is newest first, excludes incomplete drafts and does not mutate its input', () => {
  const input = data([
    episode({ id: 'older', date: '2026-10-01' }),
    { published: false, title: 'Private draft', audio: { url: 'invalid' } },
    { published: 'true', title: 'Not approved' },
    episode({
      id: 'newer',
      title: { ja: '新しいトーク', en: 'New' },
      audio: {
        url: 'https://example.com/new.m4a',
        length: 54321,
        type: 'audio/mp4',
      },
    }),
  ]);
  const original = structuredClone(input);
  const xml = createPodcastFeed(input);
  assert.ok(xml.indexOf('#episode-newer') < xml.indexOf('#episode-older'));
  assert.equal((xml.match(/<item>/g) || []).length, 2);
  assert.doesNotMatch(xml, /Private draft|Not approved/);
  assert.deepEqual(input, original);
});

test('stable GUIDs survive title, date and audio URL corrections', () => {
  const original = data([episode()]);
  const changed = data([
    episode({
      date: '2026-11-06',
      title: { ja: '修正', en: 'Corrected' },
      audio: {
        url: 'https://example.com/corrected.mp3',
        length: 999,
        type: 'audio/mpeg',
      },
    }),
  ]);
  const guid = (input) =>
    createPodcastFeed(input).match(
      /<guid isPermaLink="false">([^<]+)<\/guid>/,
    )[1];
  assert.equal(guid(original), guid(changed));
});

test('text and attribute values are escaped without treating descriptions as XML', () => {
  const input = data([
    episode({
      title: { ja: '会話 & <トーク> "今日"', en: 'Talk' },
      description: { ja: "'話' ]]> & <item>𠮷</item>", en: 'Talk' },
      audio: {
        url: 'https://example.com/first.mp3?a=1&b=2',
        length: 50,
        type: 'audio/mpeg',
      },
    }),
  ]);
  input.feed.title = 'A & B';
  const xml = createPodcastFeed(input);
  assert.match(xml, /会話 &amp; &lt;トーク&gt; &quot;今日&quot;/);
  assert.match(xml, /&apos;話&apos; ]]&gt; &amp; &lt;item&gt;𠮷&lt;\/item&gt;/);
  assert.match(xml, /first.mp3\?a=1&amp;b=2/);
  assert.equal((xml.match(/<item>/g) || []).length, 1);
  input.feed.description = 'Invalid\u0000text';
  assert.throws(() => createPodcastFeed(input), /invalid XML character/);
});

test('the owner email defaults for existing configurations and permits an override', () => {
  for (const unset of [undefined, '', '  ']) {
    const input = data([episode()]);
    input.feed.ownerEmail = unset;
    const xml = createPodcastFeed(input);
    assert.match(xml, /<itunes:email>arisut@riseup\.net<\/itunes:email>/);
    assert.equal((xml.match(/<itunes:owner>/g) || []).length, 1);
  }
  const xml = createPodcastFeed(data([episode()]));
  assert.match(xml, /<itunes:email>podcast@example\.com<\/itunes:email>/);
  assert.doesNotMatch(xml, /arisut@riseup/);
});

test('invalid show metadata is rejected', () => {
  for (const [field, value] of [
    ['ownerEmail', 'not-an-email'],
    ['artworkUrl', 'https://example.com/cover.webp'],
    ['artworkUrl', 'javascript:alert(1)'],
    ['title', ''],
    ['language', 'Japanese'],
    ['explicit', 'false'],
  ]) {
    const input = data();
    input.feed[field] = value;
    assert.throws(() => createPodcastFeed(input));
  }
});

test('show previews select published covers by date and respect a pinned cover', () => {
  function uploaded(id, date, artworkUrl) {
    const url = 'https://example.com/' + id + '.mp3';
    return {
      id,
      date,
      artworkUrl,
      title: id,
      description: '',
      url,
      audio: { url, length: 100, type: 'audio/mpeg' },
      explicit: false,
    };
  }
  const jpeg = 'https://example.com/square.JPEG?x=1&y=2';
  const webp = 'https://example.com/new.webp';
  const library = [
    uploaded('older', '2026-10-01', 'https://example.com/old.png'),
    uploaded('newest', '2026-11-06'),
    uploaded('square', '2026-11-01', jpeg),
    uploaded('web', '2026-11-04', webp),
    uploaded('draft', '2026-11-07', 'https://example.com/private.png'),
  ];
  const input = data([{ id: 'draft', published: false }]);
  input.feed.artworkUrl = '';
  const episodes = getPodcast(input, 'ja', library).episodes;
  const channel = () => createPodcastFeed(input, library).split('<item>')[0];
  const escapedJpeg = jpeg.replace('&', '&amp;');
  assert.ok(channel().includes(`<itunes:image href="${escapedJpeg}"`));
  assert.ok(channel().includes(`<image><url>${escapedJpeg}</url>`));
  const tags = sharingImageTags(input.feed, episodes, 'ja');
  assert.ok(tags.includes(`property="og:image" content="${webp}"`));
  assert.ok(tags.includes(`name="twitter:image" content="${webp}"`));
  assert.doesNotMatch(
    createPodcastFeed(input, library),
    /private\.png|new\.webp/,
  );

  const fixed = 'https://example.com/show.png';
  input.feed.artworkUrl = fixed;
  assert.ok(channel().includes(`<itunes:image href="${fixed}"`));
  assert.ok(
    sharingImageTags(input.feed, episodes, 'en').includes(
      `name="twitter:image" content="${fixed}"`,
    ),
  );
  assert.ok(
    createPodcastFeed(input, library)
      .split('<item>')
      .slice(1)
      .some((item) => item.includes(`<itunes:image href="${escapedJpeg}"`)),
  );
});

test('a curated entry for an uploaded MP3 inherits its cover and keeps its existing GUID', () => {
  const manual = episode();
  const input = data([manual]);
  input.feed.artworkUrl = '';
  const library = [
    {
      id: 'mp3-source',
      audio: manual.audio,
      artworkUrl: 'https://example.com/embedded.png',
    },
  ];
  const xml = createPodcastFeed(input, library);
  assert.equal((xml.match(/<item>/g) || []).length, 1);
  assert.equal(
    (
      xml.match(
        /<itunes:image href="https:\/\/example\.com\/embedded\.png"/g,
      ) || []
    ).length,
    2,
  );
  assert.match(
    xml,
    /<guid isPermaLink="false">[^<]*#episode-first-conversation<\/guid>/,
  );
});

test('link-only episodes cannot silently disappear from the feed', () => {
  assert.throws(
    () =>
      createPodcastFeed(
        data([
          episode({ audio: undefined, url: 'https://example.com/listen' }),
        ]),
      ),
    /needs audio.url, audio.length and audio.type/,
  );
});

test('duplicate media URLs, missing content ratings and inaccurate duration values are rejected', () => {
  assert.throws(
    () => createPodcastFeed(data([episode(), episode({ id: 'second' })])),
    /unique audio URLs/,
  );
  for (const explicit of [undefined, 'false', 0])
    assert.throws(
      () => createPodcastFeed(data([episode({ explicit })])),
      /explicit true\/false/,
    );
  for (const durationSeconds of [0, -1, 1.5, '615'])
    assert.throws(
      () => createPodcastFeed(data([episode({ durationSeconds })])),
      /durationSeconds/,
    );
  const xml = createPodcastFeed(
    data([episode({ durationSeconds: undefined, durationMinutes: 10 })]),
  );
  assert.doesNotMatch(xml, /itunes:duration/);
});

test('unsafe URLs and invalid enclosure sizes or MIME types fail before publication', () => {
  for (const url of [
    'http://example.com/a.mp3',
    'https://user:pass@example.com/a.mp3',
    'https://example.com/a.mp3#fragment',
    '',
  ])
    assert.throws(() =>
      createPodcastFeed(
        data([episode({ audio: { ...episode().audio, url } })]),
      ),
    );
  for (const length of [0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () =>
        createPodcastFeed(
          data([episode({ audio: { ...episode().audio, length } })]),
        ),
      /byte size/,
    );
  for (const type of ['text/html', 'application/vnd.apple.mpegurl', undefined])
    assert.throws(
      () =>
        createPodcastFeed(
          data([episode({ audio: { ...episode().audio, type } })]),
        ),
      /audio type/,
    );
});

test('an explicit episode marks the channel explicit without changing other episode ratings', () => {
  const xml = createPodcastFeed(data([episode({ explicit: true })]));
  assert.equal(
    (xml.match(/<itunes:explicit>true<\/itunes:explicit>/g) || []).length,
    2,
  );
  const clean = createPodcastFeed(data([episode()]));
  assert.equal(
    (clean.match(/<itunes:explicit>false<\/itunes:explicit>/g) || []).length,
    2,
  );
});

test('production prefers the live feed and falls back to revalidated static RSS', async () => {
  const nginx = await readFile('deploy/nginx.conf', 'utf8');
  const location = nginx
    .split('location = /podcast/rss.xml {')[1]
    .split('location /en/')[0];
  assert.match(location, /include \/etc\/nginx\/security-headers.conf;/);
  assert.match(location, /types \{ application\/rss\+xml xml; \}/);
  assert.match(location, /Cache-Control 'no-cache'/);
  assert.match(location, /try_files \/\.podcast-live\/rss\.xml \$uri =404/);
});

test('both uploaded media routes resolve through the published podcast edition', async () => {
  const nginx = await readFile('deploy/nginx.conf', 'utf8');
  for (const [route, filename] of [
    ['play', '$1.$2'],
    ['audio', '$1'],
  ]) {
    const location = nginx
      .split(`location ~ "^/podcast/${route}/`)[1]
      .split('\n    }')[0];
    assert.ok(
      location.includes(`alias /tmp/podcast-pages/current/audio/${filename};`),
    );
    assert.ok(location.includes('if_modified_since off;'));
  }
  assert.doesNotMatch(nginx, /alias \/podcast-source/);
});
