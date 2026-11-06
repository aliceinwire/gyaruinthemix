import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getLocale, localizePath } from '../src/data/i18n.mjs';
import { canonicalUrl, publicPaths, siteOrigin } from '../src/data/urls.mjs';
import { releaseVersion } from '../src/data/release.mjs';
import { GET as getRobots } from '../src/pages/robots.txt.js';
import {
  createPodcastFeed,
  podcastFeedUrl,
} from '../src/data/podcast-feed.mjs';
import podcast from '../config/podcast.json' with { type: 'json' };
import { escapeMarkup, getPodcast, showArtwork } from '../src/data/podcast.mjs';

const read = (path) =>
  readFile(new URL(`../dist/${path}`, import.meta.url), 'utf8');
function assertReleaseFooter(html, path) {
  const versions = [...html.matchAll(/data-release-version="([^"]+)"/g)];
  assert.equal(versions.length, 1, `${path}: one release version`);
  assert.equal(versions[0][1], releaseVersion, `${path}: release version`);
  assert.ok(
    html.includes(`v${releaseVersion}</span>`),
    `${path}: visible version`,
  );
}
const siteImage = canonicalUrl('/assets/logo.webp');
const podcastImage = escapeMarkup(
  showArtwork(podcast.feed, getPodcast(podcast).episodes).social || siteImage,
);
for (const path of publicPaths) {
  const html = await read(`${path.slice(1)}index.html`);
  assert.doesNotMatch(html, /shop-test|test-store/);
  assertReleaseFooter(html, path);
  assert.ok(
    html.includes(`rel="canonical" href="${canonicalUrl(path)}"`),
    path,
  );
  assert.ok(
    html.includes(`property="og:url" content="${canonicalUrl(path)}"`),
    path,
  );
  const head = html.split('</head>')[0];
  const isPodcast = path.endsWith('/podcast/');
  const expectedImage = isPodcast ? podcastImage : siteImage;
  assert.deepEqual(
    [...head.matchAll(/property="og:image" content="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    [expectedImage],
    path,
  );
  if (isPodcast) {
    assert.deepEqual(
      [...head.matchAll(/name="twitter:image" content="([^"]+)"/g)].map(
        (match) => match[1],
      ),
      [expectedImage],
      path,
    );
  }
  assert.doesNotMatch(html, /name="robots" content="noindex/);
  assert.match(html, /name="robots" content="noarchive"/);
  assert.ok(
    html.includes(`<html lang="${getLocale(path)}"`),
    `${path}: document language`,
  );
  for (const locale of ['ja', 'en', 'x-default']) {
    assert.ok(
      html.includes(
        `rel="alternate" hreflang="${locale}" href="${canonicalUrl(localizePath(path, locale))}"`,
      ),
      `${path}: alternate ${locale}`,
    );
  }
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
    if (
      href.startsWith('/assets/') ||
      href.startsWith('/_astro/') ||
      href === '/favicon.svg'
    )
      continue;
    assert.ok(
      !href.includes('/game/') && !href.includes('/streaming-guidelines/'),
      `${path}: hidden test pages must stay undiscoverable`,
    );
    if (getLocale(path) === 'en' && !href.startsWith('/en/')) {
      assert.equal(
        href,
        localizePath(path, 'ja'),
        `${path}: untranslated internal link ${href}`,
      );
    }
  }
}
for (const path of [
  'streaming-guidelines/index.html',
  'en/streaming-guidelines/index.html',
  'shop/success/index.html',
  'shop/cancel/index.html',
  '404.html',
  'en/shop/success/index.html',
  'en/shop/cancel/index.html',
  'en/404/index.html',
]) {
  const html = await read(path);
  assertReleaseFooter(html, path);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.doesNotMatch(html, /rel="canonical"|property="og:url"/);
  assert.ok(html.includes(`<html lang="${getLocale('/' + path)}"`));
}
for (const locale of ['', 'en/']) {
  for (const page of ['', 'success/', 'cancel/']) {
    await assert.rejects(read(`${locale}shop-test/${page}index.html`), {
      code: 'ENOENT',
    });
  }
}
const sitemap = await read('sitemap.xml');
const podcastRss = await read('podcast/rss.xml');
assert.equal(podcastRss, createPodcastFeed(podcast));
for (const path of ['podcast/index.html', 'en/podcast/index.html']) {
  const html = await read(path);
  const head = html.split('</head>')[0];
  assert.ok(
    head.includes('type="application/rss+xml"'),
    `${path}: RSS discovery`,
  );
  assert.ok(
    head.includes(`href="${podcastFeedUrl}"`),
    `${path}: canonical RSS URL`,
  );
  assert.ok(
    html.split('</head>')[1].includes(`href="${podcastFeedUrl}"`),
    `${path}: visible RSS subscription`,
  );
  const recipient = html.match(/href="mailto:([^"]+)"/)?.[1];
  assert.ok(
    recipient &&
      podcastRss.includes(
        `<itunes:email>${escapeMarkup(decodeURIComponent(recipient))}</itunes:email>`,
      ),
    `${path}: listener email link matches the RSS contact`,
  );
}
assert.deepEqual(
  [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
  publicPaths.map(canonicalUrl),
);
assert.doesNotMatch(
  sitemap,
  /streaming-guidelines|shop-test|success|cancel|404|alicef\.me|localhost/,
);
assert.match(
  await read('robots.txt'),
  new RegExp(`Sitemap: ${siteOrigin.replaceAll('.', '\\.')}\/sitemap\\.xml`),
);
assert.equal(await read('robots.txt'), await getRobots().text());
assert.ok(
  (await readFile(new URL('../dist/assets/logo.webp', import.meta.url)))
    .length > 0,
);
console.log(
  `PASS canonical URLs, Open Graph, sitemap, robots and ${publicPaths.length} public pages; test shop removed and returns remain noindex`,
);

assert.match(
  await read('game/index.html'),
  /name="robots" content="noindex, nofollow, noarchive"/,
);
assertReleaseFooter(await read('game/index.html'), 'game/index.html');
assert.doesNotMatch(sitemap, /\/game(?:\/|["\s<>])/);
assert.match(await read('robots.txt'), /Disallow: \/game\//);
