import {
  escapeMarkup as xml,
  getPodcast,
  isFeedArtwork,
  podcastEmail,
  podcastReleaseTime,
  showArtwork,
} from './podcast.mjs';
import { canonicalUrl } from './urls.mjs';

export const podcastFeedUrl = canonicalUrl('/podcast/rss.xml');
const showUrl = canonicalUrl('/podcast/');

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Podcast feed ${field} is required`);
  return value;
}

export function createPodcastFeed(data, library = []) {
  const feed = data.feed;
  for (const field of [
    'title',
    'description',
    'author',
    'language',
    'category',
  ])
    requiredText(feed?.[field], field);
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(feed.language))
    throw new Error('Podcast feed language must be a language code');
  if (typeof feed.explicit !== 'boolean')
    throw new Error('Podcast feed explicit must be true or false');
  const email = podcastEmail(feed);

  const { episodes } = getPodcast(data, 'ja', library);
  const artwork = showArtwork(feed, episodes).feed;
  const published = new Map(
    data.episodes
      .filter((episode) => episode.published === true)
      .map((episode) => [episode.id, episode]),
  );
  const audioUrls = new Set();
  const items = episodes.map((episode) => {
    const source = published.get(episode.id) ?? episode;
    if (!episode.audio)
      throw new Error(
        `Podcast episode ${episode.id} needs audio.url, audio.length and audio.type for RSS`,
      );
    if (audioUrls.has(episode.audio.url))
      throw new Error('Podcast episodes must have unique audio URLs');
    audioUrls.add(episode.audio.url);
    if (typeof source.explicit !== 'boolean')
      throw new Error(
        `Podcast episode ${episode.id} needs an explicit true/false rating`,
      );
    if (
      source.durationSeconds !== undefined &&
      (!Number.isSafeInteger(source.durationSeconds) ||
        source.durationSeconds <= 0)
    )
      throw new Error('Podcast durationSeconds must be a positive integer');
    const permalink = `${showUrl}#episode-${episode.id}`;
    return `    <item>
      <title>${xml(episode.title)}</title>
      ${episode.description ? `<description>${xml(episode.description)}</description>` : ''}
      ${isFeedArtwork(episode.artworkUrl) ? `<itunes:image href="${xml(episode.artworkUrl)}" />` : ''}
      ${(episode.tags ?? []).map((tag) => `<category>${xml(tag)}</category>`).join('')}
      <link>${xml(permalink)}</link>
      <guid isPermaLink="false">${xml(permalink)}</guid>
      <pubDate>${podcastReleaseTime(episode.date).toUTCString()}</pubDate>
      <enclosure url="${xml(episode.audio.url)}" length="${episode.audio.length}" type="${episode.audio.type}" />
      <itunes:explicit>${source.explicit}</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>${source.durationSeconds === undefined ? '' : `\n      <itunes:duration>${source.durationSeconds}</itunes:duration>`}
    </item>`;
  });
  const explicit =
    feed.explicit ||
    episodes.some(
      (episode) => (published.get(episode.id) ?? episode).explicit === true,
    );

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(feed.title)}</title>
    <link>${showUrl}</link>
    <description>${xml(feed.description)}</description>
    <language>${xml(feed.language)}</language>
    <atom:link href="${podcastFeedUrl}" rel="self" type="application/rss+xml" />
    <itunes:author>${xml(feed.author)}</itunes:author>
    <itunes:category text="${xml(feed.category)}" />
    <itunes:explicit>${explicit}</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <itunes:owner><itunes:name>${xml(feed.author)}</itunes:name><itunes:email>${xml(email)}</itunes:email></itunes:owner>${
      artwork
        ? `
    <itunes:image href="${xml(artwork)}" />
    <image><url>${xml(artwork)}</url><title>${xml(feed.title)}</title><link>${showUrl}</link></image>`
        : ''
    }
${items.join('\n')}
  </channel>
</rss>
`;
}
