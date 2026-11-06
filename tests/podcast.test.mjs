import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getPodcast } from '../src/data/podcast.mjs';
import { episodeList, latestLink } from '../src/data/podcast-view.mjs';

const configuration = JSON.parse(
  await readFile(new URL('../config/podcast.json', import.meta.url), 'utf8'),
);
const episode = (overrides = {}) => ({
  id: 'first-conversation',
  published: true,
  date: '2026-11-03',
  title: { ja: '最初のトーク', en: 'Our first conversation' },
  description: { ja: 'ふたりの自己紹介。', en: 'Meet the two hosts.' },
  url: 'https://example.com/episodes/first',
  durationMinutes: 25,
  ...overrides,
});
const data = (episodes = [], platforms = {}) => ({ platforms, episodes });

test('the podcast configuration validates in both languages', () => {
  for (const locale of ['ja', 'en']) {
    const result = getPodcast(configuration, locale);
    assert.ok(Array.isArray(result.episodes));
    assert.ok(Array.isArray(result.platforms));
  }
});

test('an empty show has no fabricated episodes or listening links', () => {
  assert.deepEqual(
    getPodcast(data([], { spotify: '', applePodcasts: '', rss: '' })),
    { episodes: [], platforms: [] },
  );
});

test('only configured platforms become links, including before the first episode', () => {
  const result = getPodcast(
    data([], {
      spotify: 'https://open.spotify.com/show/example',
      applePodcasts: '',
      rss: 'https://example.com/feed.xml',
    }),
  );
  assert.deepEqual(result.platforms, [
    {
      id: 'spotify',
      label: 'Spotify',
      url: 'https://open.spotify.com/show/example',
    },
    { id: 'rss', label: 'RSS', url: 'https://example.com/feed.xml' },
  ]);
  assert.deepEqual(result.episodes, []);
});

test('incomplete drafts stay private and published episodes are newest first without mutating input', () => {
  const input = data([
    episode({ id: 'older', date: '2026-10-30' }),
    { published: false, title: 'Private draft' },
    { published: 'true', title: 'Unapproved draft' },
    episode({ id: 'newer', date: '2026-11-02' }),
  ]);
  const original = structuredClone(input);
  const result = getPodcast(input);
  assert.deepEqual(
    result.episodes.map(({ id }) => id),
    ['newer', 'older'],
  );
  assert.equal(result.episodes[0].title, '最初のトーク');
  assert.doesNotMatch(JSON.stringify(result), /Private draft|Unapproved draft/);
  assert.deepEqual(input, original);
});

test('English localizes text and preserves dates, destinations and durations', () => {
  const input = data([
    episode({ transcriptUrl: 'https://example.com/transcript' }),
  ]);
  const ja = getPodcast(input).episodes[0];
  const en = getPodcast(input, 'en').episodes[0];
  assert.equal(en.title, 'Our first conversation');
  assert.equal(en.description, 'Meet the two hosts.');
  for (const key of ['id', 'date', 'url', 'durationMinutes', 'transcriptUrl'])
    assert.equal(en[key], ja[key]);
  assert.deepEqual(getPodcast(input, 'unknown'), getPodcast(input));
});

test('optional duration and transcript can be omitted', () => {
  const result = getPodcast(data([episode({ durationMinutes: undefined })]));
  assert.equal(result.episodes[0].durationMinutes, undefined);
  assert.equal(result.episodes[0].transcriptUrl, '');
});

test('episode players use the hosted enclosure and retain separate listening and transcript links', () => {
  const audio = {
    url: 'https://gyaruinthemix.com/podcast/audio/track.m4a',
    type: 'audio/mp4',
    length: 1200,
  };
  const input = episode({
    audio,
    transcriptUrl: 'https://example.com/transcript',
  });
  const [entry] = getPodcast(data([input])).episodes;
  const card = episodeList([entry], 'en');
  assert.match(
    card,
    /<source src="\/podcast\/audio\/track\.m4a" type="audio\/mp4"/,
  );
  assert.ok(
    card.includes(`href="${input.url}"`) &&
      card.includes(`href="${input.transcriptUrl}"`),
  );
  assert.ok(latestLink(entry, 'en').includes(`href="#episode-${entry.id}"`));

  for (const attached of [
    undefined,
    { ...audio, url: 'https://example.com/remote.m4a' },
  ]) {
    const [external] = getPodcast(
      data([episode({ audio: attached })]),
    ).episodes;
    assert.doesNotMatch(episodeList([external], 'en'), /<audio\b/);
    assert.ok(latestLink(external, 'en').includes(`href="${external.url}"`));
  }
});

test('unsafe listening, platform and transcript URLs cannot be published', () => {
  for (const url of [
    'javascript:alert(1)',
    '//example.com/podcast',
    'http://example.com/podcast',
    'https://user:password@example.com/podcast',
    'not a URL',
  ]) {
    assert.throws(() => getPodcast(data([], { spotify: url })), /HTTPS/);
    assert.throws(() => getPodcast(data([episode({ url })])), /HTTPS/);
    assert.throws(
      () => getPodcast(data([episode({ transcriptUrl: url })])),
      /HTTPS/,
    );
  }
  assert.throws(
    () => getPodcast(data([episode({ url: '' })])),
    /listening URL/,
  );
});

test('published episodes require valid dates, stable unique IDs and positive durations', () => {
  for (const date of ['2026-02-30', 'tomorrow', '2026-13-01', ''])
    assert.throws(() => getPodcast(data([episode({ date })])), /valid date/);
  for (const id of ['', '../first', 'First Episode', undefined])
    assert.throws(
      () => getPodcast(data([episode({ id })])),
      /unique stable IDs/,
    );
  assert.throws(
    () => getPodcast(data([episode(), episode()])),
    /unique stable IDs/,
  );
  for (const durationMinutes of [0, -1, 1.5, '25'])
    assert.throws(
      () => getPodcast(data([episode({ durationMinutes })])),
      /positive integer/,
    );
});

test('published episodes require both translations instead of mixing languages', () => {
  for (const field of ['title', 'description']) {
    for (const value of [{ ja: '日本語' }, { ja: '日本語', en: ' ' }, 'text'])
      assert.throws(
        () => getPodcast(data([episode({ [field]: value })])),
        /Japanese and English/,
      );
  }
});
