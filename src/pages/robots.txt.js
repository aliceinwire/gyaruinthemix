import { siteOrigin } from '../data/urls.mjs';

export function GET() {
  // Allow crawlers to see noindex on sandbox/return pages; this is not access control.
  return new Response(
    `User-agent: archive.org_bot\nUser-agent: ia_archiver\nDisallow: /\n\nUser-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /game-test/\n\nSitemap: ${siteOrigin}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
