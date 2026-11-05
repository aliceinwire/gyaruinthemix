import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createPodcastFeed,
  podcastFeedUrl,
} from '../src/data/podcast-feed.mjs';
import { getPodcast } from '../src/data/podcast.mjs';
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

test('an empty feed is valid XML structure without fabricated episodes or contact details', () => {
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
  assert.doesNotMatch(xml, /<item>|itunes:owner|itunes:image|undefined/);
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

test('publishing requires real show artwork and an owner email', () => {
  for (const field of ['artworkUrl', 'ownerEmail']) {
    const input = data([episode()]);
    input.feed[field] = '';
    assert.throws(() => createPodcastFeed(input), /artworkUrl and ownerEmail/);
  }
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

test('production serves the static feed as revalidated RSS with the security headers intact', async () => {
  const nginx = await readFile('deploy/nginx.conf', 'utf8');
  const location = nginx
    .split('location = /podcast/rss.xml {')[1]
    .split('location /en/')[0];
  assert.match(location, /include \/etc\/nginx\/security-headers.conf;/);
  assert.match(location, /types \{ application\/rss\+xml xml; \}/);
  assert.match(location, /Cache-Control 'no-cache'/);
  assert.match(location, /try_files \$uri =404/);
});
