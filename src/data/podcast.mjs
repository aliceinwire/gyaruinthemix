import { isCalendarDate } from './events.mjs';

const platformLabels = {
  spotify: 'Spotify',
  applePodcasts: 'Apple Podcasts',
  rss: 'RSS',
};

export function podcastEmail(feed) {
  const configured = feed.ownerEmail ?? '';
  if (typeof configured === 'string') {
    const email = configured.trim() || 'arisut@riseup.net';
    if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) return email;
  }
  throw new Error('Podcast feed ownerEmail must be a valid email address');
}

export function httpsLink(value, field) {
  if (value === undefined || value === '') return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password)
      return url.href;
  } catch {
    // Invalid destinations must not become public listening links.
  }
  throw new Error(`Podcast ${field} must use HTTPS without credentials`);
}

function artworkLink(value) {
  const url = httpsLink(value ?? '', 'artwork URL');
  if (!url) return '';
  const { pathname, hash } = new URL(url);
  if (hash || !/\.(?:jpe?g|png|gif|webp)$/i.test(pathname))
    throw new Error('Podcast artwork must be a direct image URL');
  return url;
}

export function isFeedArtwork(url) {
  return Boolean(url && /\.(?:jpe?g|png)$/i.test(new URL(url).pathname));
}

// Episodes are already filtered and sorted newest first by getPodcast().
export function showArtwork(feed, episodes) {
  const fixed = artworkLink(feed.artworkUrl);
  if (fixed) {
    if (!isFeedArtwork(fixed))
      throw new Error('Podcast show artwork must be a direct PNG or JPEG URL');
    return { feed: fixed, social: fixed };
  }
  const covers = episodes
    .map((episode) => artworkLink(episode.artworkUrl))
    .filter(Boolean);
  return { feed: covers.find(isFeedArtwork) || '', social: covers[0] || '' };
}

export function escapeMarkup(value) {
  const text = String(value);
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(
      text,
    )
  )
    throw new Error('Podcast feed text contains an invalid XML character');
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character],
  );
}

function episodeAudio(audio) {
  if (audio === undefined) return undefined;
  const url = httpsLink(audio?.url, 'audio URL');
  if (!url || new URL(url).hash)
    throw new Error(
      'Podcast audio needs a direct HTTPS file URL without a fragment',
    );
  if (!Number.isSafeInteger(audio.length) || audio.length <= 0)
    throw new Error(
      'Podcast audio length must be its positive integer byte size',
    );
  if (!['audio/mpeg', 'audio/mp4'].includes(audio.type))
    throw new Error(
      'Podcast audio type must be audio/mpeg (MP3) or audio/mp4 (M4A)',
    );
  return { url, length: audio.length, type: audio.type };
}

function localizedText(value, field, locale) {
  for (const language of ['ja', 'en']) {
    if (typeof value?.[language] !== 'string' || !value[language].trim())
      throw new Error(`Podcast ${field} needs Japanese and English text`);
  }
  return value[locale === 'en' ? 'en' : 'ja'];
}

// Episodes use stable IDs, an explicit published flag, a YYYY-MM-DD date,
// bilingual title/description, a listening URL, and optional durationMinutes
// and transcriptUrl. Drafts may be incomplete and never reach the page.
export function getPodcast(data, locale = 'ja', library = []) {
  const platforms = Object.entries(platformLabels)
    .map(([id, label]) => ({
      id,
      label,
      url: httpsLink(data.platforms[id], `${id} URL`),
    }))
    .filter((platform) => platform.url);
  const ids = new Set();
  const embeddedCovers = new Map(
    library.map((episode) => [episode.audio.url, episode.artworkUrl]),
  );
  const episodes = data.episodes
    .filter((episode) => episode.published === true)
    .map((episode) => {
      if (
        typeof episode.id !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(episode.id) ||
        ids.has(episode.id)
      )
        throw new Error('Published podcast episodes need unique stable IDs');
      ids.add(episode.id);
      if (!isCalendarDate(episode.date))
        throw new Error('Published podcast episodes need a valid date');
      if (
        episode.durationMinutes !== undefined &&
        (!Number.isInteger(episode.durationMinutes) ||
          episode.durationMinutes <= 0)
      )
        throw new Error('Podcast durationMinutes must be a positive integer');
      const audio = episodeAudio(episode.audio);
      const artworkUrl =
        artworkLink(episode.artworkUrl) || embeddedCovers.get(audio?.url);
      const url = httpsLink(episode.url, 'episode URL') || audio?.url;
      if (!url)
        throw new Error('Published podcast episodes need a listening URL');
      return {
        id: episode.id,
        date: episode.date,
        title: localizedText(episode.title, 'title', locale),
        description: localizedText(episode.description, 'description', locale),
        durationMinutes: episode.durationMinutes,
        url,
        transcriptUrl: httpsLink(episode.transcriptUrl, 'transcript URL'),
        ...(artworkUrl && { artworkUrl }),
        ...(audio ? { audio } : {}),
      };
    });
  // An existing editorial entry (including a draft) owns its ID and audio URL.
  const configuredIds = new Set(data.episodes.map((entry) => entry.id));
  const configuredUrls = new Set(
    data.episodes.map((entry) => entry.audio?.url),
  );
  for (const episode of library) {
    if (
      !configuredIds.has(episode.id) &&
      !configuredUrls.has(episode.audio.url)
    )
      episodes.push(episode);
  }
  episodes.sort((a, b) => b.date.localeCompare(a.date));
  return { platforms, episodes };
}
