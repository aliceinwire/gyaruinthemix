import { siteOrigin } from '../data/urls.mjs';

export function GET() {
  // Allow crawlers to see noindex on sandbox/return pages; this is not access control.
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteOrigin}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
