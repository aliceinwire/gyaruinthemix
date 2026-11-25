import data from '../../config/site.json';
import english from '../../config/site.en.json';
import { isCalendarDate, isEventTimestamp, japanDate } from './events.mjs';

// Editorial links are public, build-time data. Never put tokens or secrets here.
function safeLink(value, { local = false } = {}) {
  if (!value) return '';
  if (local && /^\/(?!\/)[a-z0-9/_-]*(?:#[a-z0-9-]+)?$/.test(value))
    return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password)
      return url.href;
  } catch {
    /* Invalid editorial links fail the build. */
  }
  throw new Error('Site links must use HTTPS without embedded credentials');
}

function trackWithLinks(track) {
  if (!track.release) return { ...track, url: safeLink(track.url) };
  const { slug, date, platforms } = track.release;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '') || !isCalendarDate(date))
    throw new Error('A release needs a stable slug and a release date');
  if (!platforms?.length || platforms.some(({ label, url }) => !label || !url))
    throw new Error('A release needs named music services with links');
  return {
    ...track,
    url: `/music/#${slug}`,
    release: {
      ...track.release,
      platforms: platforms.map(({ label, url }) => ({
        label,
        url: safeLink(url),
      })),
    },
  };
}

function validateSite(data) {
  if (data.fanClub.registrationOpen && !data.fanClub.joinUrl)
    throw new Error('Open fan-club registration requires a join URL');

  return {
    ...data,
    bookingUrl: safeLink(data.bookingUrl),
    soundcloudUrl: safeLink(data.soundcloudUrl),
    socials: data.socials.map((item) => ({ ...item, url: safeLink(item.url) })),
    fanClub: { ...data.fanClub, joinUrl: safeLink(data.fanClub.joinUrl) },
    tracks: data.tracks.map(trackWithLinks),
    events: data.events
      .filter((item) => item.published === true)
      .map((item) => {
        if (
          !isCalendarDate(item.date) ||
          (item.endDate !== undefined &&
            (!isCalendarDate(item.endDate) || item.endDate < item.date)) ||
          (item.startAt !== undefined &&
            (!isEventTimestamp(item.startAt) ||
              japanDate(new Date(item.startAt)) !== item.date)) ||
          (item.endAt !== undefined &&
            (!isEventTimestamp(item.endAt) ||
              japanDate(new Date(item.endAt)) < item.date ||
              (item.startAt &&
                Date.parse(item.endAt) <= Date.parse(item.startAt)))) ||
          !['live', 'media'].includes(item.category)
        )
          throw new Error(
            'Published events need valid calendar dates, ordered timezone-aware timestamps, and live/media category',
          );
        return { ...item, url: safeLink(item.url) };
      }),
    news: data.news.map((item) => ({
      ...item,
      url: safeLink(item.url, { local: true }),
    })),
  };
}

// Only editorial text can be overridden. Dates, destinations, images, and
// registration status always come from the canonical Japanese configuration.
function translateFields(original, translation, allowed) {
  for (const key of allowed) {
    if (Object.hasOwn(original, key) && !Object.hasOwn(translation, key))
      throw new Error(`Missing English editorial field: ${key}`);
  }
  for (const [key, value] of Object.entries(translation)) {
    if (!allowed.includes(key) || typeof value !== 'string')
      throw new Error(`Invalid English editorial field: ${key}`);
  }
  return { ...original, ...translation };
}

function translateItems(original, translations, fields) {
  if (original.length !== translations.length)
    throw new Error(
      'English editorial translations must match the source items',
    );
  return original.map((item, index) =>
    translateFields(item, translations[index], fields),
  );
}

export const site = validateSite(data);
const englishSite = validateSite({
  ...data,
  artist: {
    ...translateFields(data.artist, { aesthetic: english.artist.aesthetic }, [
      'aesthetic',
    ]),
    genres: translateItems(data.artist.genres, english.artist.genres, [
      'label',
    ]),
  },
  socials: translateItems(data.socials, english.socials, ['label']),
  fanClub: translateFields(data.fanClub, english.fanClub, [
    'joinLabel',
    'membershipNote',
  ]),
  tracks: translateItems(data.tracks, english.tracks, ['linkLabel']),
  events: translateItems(data.events, english.events, [
    'title',
    'venue',
    'timeLabel',
    'note',
    'linkLabel',
  ]),
  news: translateItems(data.news, english.news, ['category', 'title', 'text']),
  photos: translateItems(data.photos, english.photos, [
    'alt',
    'caption',
    'tag',
  ]),
});

export function getSite(locale = 'ja') {
  return locale === 'en' ? englishSite : site;
}
