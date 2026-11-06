import { escapeMarkup as esc, showArtwork } from './podcast.mjs';
import { translator } from './i18n.mjs';
import { canonicalUrl, siteOrigin } from './urls.mjs';

export function sharingImageTags(feed, episodes, locale) {
  const t = translator(locale);
  const { social } = showArtwork(feed, episodes);
  const image = esc(social || canonicalUrl('/assets/logo.webp'));
  const alt = social
    ? t(
        'ギャルインザミックスのポッドキャストのジャケット',
        'GYARUINTHEMIX podcast cover',
      )
    : t('ギャルインザミックスのロゴ', 'GYARUINTHEMIX logo');
  return `<meta property="og:image" content="${image}">
    <meta property="og:image:alt" content="${esc(alt)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:image" content="${image}">
    <meta name="twitter:image:alt" content="${esc(alt)}">`;
}

function playerSource(episode) {
  if (!episode?.audio) return '';
  const url = new URL(episode.audio.url);
  // The website serves its own enclosures. Off-site listening links still open normally.
  if (url.origin !== siteOrigin) return '';
  return url.pathname.replace(/^\/+/, '/') + url.search;
}

export function latestLink(episode, locale) {
  const t = translator(locale);
  const label = episode
    ? t('最新エピソードを聴く', 'Listen to the latest episode')
    : t('配信情報を見る', 'Explore the podcast');
  const inline = Boolean(playerSource(episode));
  const href = inline ? `#episode-${episode.id}` : episode?.url || '#episodes';
  return `<a class="button button-pink" href="${esc(href)}"${inline ? ' data-play-latest' : ''}>${label} <span aria-hidden="true">${episode && !inline ? '↗' : '↓'}</span></a>`;
}

export function episodeList(episodes, locale) {
  const t = translator(locale);
  const englishDates = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  });
  const cards = episodes.map((episode, index) => {
    const { title, description, durationMinutes, artworkUrl, tags } = episode;
    const [year, month, day] = episode.date.split('-').map(Number);
    const date = t(
      `${year}年${month}月${day}日`,
      englishDates.format(new Date(`${episode.date}T00:00:00+09:00`)),
    );
    const source = playerSource(episode);
    const directAudio = source && episode.url === episode.audio.url;
    const listenLabel = directAudio
      ? t('音声ファイルを開く', 'Open audio file')
      : t('エピソードを聴く', 'Listen to episode');
    return `<li><article class="podcast-episode${index === 0 ? ' podcast-latest' : ''}" id="episode-${esc(episode.id)}">
      ${artworkUrl ? `<img class="podcast-episode-cover" src="${esc(artworkUrl)}" alt="" width="160" height="160" loading="lazy">` : ''}
      <div class="podcast-episode-meta">
        ${index === 0 ? `<span class="podcast-status">${t('最新エピソード', 'Latest episode')}</span>` : ''}
        <time datetime="${esc(episode.date)}">${date}</time>
        ${durationMinutes ? `<span>${t(`${durationMinutes}分`, `${durationMinutes} min`)}</span>` : ''}
      </div>
      <h3>${esc(title)}</h3>
      ${source ? `<audio class="podcast-player" controls preload="none" aria-label="${esc(t(`${title}を再生`, `Play ${title}`))}"><source src="${esc(source)}" type="${esc(episode.audio.type)}"></audio>` : ''}
      ${description ? `<p class="podcast-notes">${esc(description)}</p>` : ''}
      ${tags?.length ? `<ul class="podcast-tags" aria-label="${t('タグ', 'Tags')}">${tags.map((tag) => `<li>${esc(tag)}</li>`).join('')}</ul>` : ''}
      <div class="podcast-episode-actions"><a class="${source ? 'text-link' : 'button'}" href="${esc(episode.url)}" aria-label="${esc(`${listenLabel} · ${title}`)}">${listenLabel} <span aria-hidden="true">↗</span></a>
      ${episode.transcriptUrl ? `<a href="${esc(episode.transcriptUrl)}">${t('文字起こしを読む', 'Read transcript')}</a>` : ''}</div>
    </article></li>`;
  });
  return `<p class="podcast-order">${t('新しいエピソードから', 'Newest episodes first')}</p><ol class="podcast-episodes">${cards.join('')}</ol>`;
}

// Replace a marked region in the built page before serving it to browsers and crawlers.
export function fillPodcastSlot(page, name, content) {
  const start = `<!--podcast-${name}-->`;
  const end = `<!--/podcast-${name}-->`;
  const first = page.indexOf(start);
  const last = page.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Missing podcast ${name} slot`);
  return page.slice(0, first) + content + page.slice(last + end.length);
}
