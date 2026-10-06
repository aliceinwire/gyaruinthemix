import { localizePath } from '../data/i18n.mjs';
import { canonicalUrl, publicPaths } from '../data/urls.mjs';

export function GET() {
  const entries = publicPaths
    .map(
      (path) =>
        `  <url><loc>${canonicalUrl(path)}</loc>${['ja', 'en', 'x-default'].map((locale) => `<xhtml:link rel="alternate" hreflang="${locale}" href="${canonicalUrl(localizePath(path, locale))}" />`).join('')}</url>`,
    )
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
}
