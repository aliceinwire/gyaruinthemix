import { escapeMarkup as esc } from './podcast.mjs';
import { translator } from './i18n.mjs';

export function latestLink(episode, locale) {
  const t = translator(locale);
  const label = episode
    ? t('最新エピソードを聴く', 'Listen to the latest episode')
    : t('配信情報を見る', 'Explore the podcast');
  return `<a class="button button-pink" href="${esc(episode?.url || '#episodes')}">${label} <span aria-hidden="true">${episode ? '↗' : '↓'}</span></a>`;
}

export function episodeList(episodes, locale) {
  const t = translator(locale);
  const dates = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  });
  const cards = episodes.map((episode, index) => {
    const { title, description, durationMinutes, artworkUrl, tags } = episode;
    const date = dates.format(new Date(`${episode.date}T00:00:00+09:00`));
    return `<li><article class="podcast-episode${index === 0 ? ' podcast-latest' : ''}" id="episode-${esc(episode.id)}">
      ${artworkUrl ? `<img class="podcast-episode-cover" src="${esc(artworkUrl)}" alt="" width="160" height="160" loading="lazy">` : ''}
      <div class="podcast-episode-meta">
        ${index === 0 ? `<span class="podcast-status">${t('最新エピソード', 'Latest episode')}</span>` : ''}
        <time datetime="${esc(episode.date)}">${date}</time>
        ${durationMinutes ? `<span>${t(`${durationMinutes}分`, `${durationMinutes} min`)}</span>` : ''}
      </div>
      <h3>${esc(title)}</h3>
      ${description ? `<p class="podcast-notes">${esc(description)}</p>` : ''}
      ${tags?.length ? `<ul class="podcast-tags" aria-label="${t('タグ', 'Tags')}">${tags.map((tag) => `<li>${esc(tag)}</li>`).join('')}</ul>` : ''}
      <div class="podcast-episode-actions"><a class="button" href="${esc(episode.url)}" aria-label="${esc(t(`${title}を聴く`, `Listen to ${title}`))}">${t('エピソードを聴く', 'Listen to episode')} <span aria-hidden="true">↗</span></a>
      ${episode.transcriptUrl ? `<a href="${esc(episode.transcriptUrl)}">${t('文字起こしを読む', 'Read transcript')}</a>` : ''}</div>
    </article></li>`;
  });
  return `<p class="podcast-order">${t('新しいエピソードから', 'Newest episodes first')}</p><ol class="podcast-episodes">${cards.join('')}</ol>`;
}

// The deployed scanner replaces only these two slots in each built Astro page.
export function fillPodcastSlot(page, name, content) {
  const start = `<!--podcast-${name}-->`;
  const end = `<!--/podcast-${name}-->`;
  const first = page.indexOf(start);
  const last = page.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Missing podcast ${name} slot`);
  return page.slice(0, first) + content + page.slice(last + end.length);
}
