import { siteOrigin } from '../data/urls.mjs';

export function GET() {
  // Allow crawlers to see noindex on sandbox/return pages; this is not access control.
  return new Response(
    `User-agent: archive.org_bot
User-agent: ia_archiver
User-agent: CCBot
User-agent: Arquivo-web-crawler
User-agent: Megalodon
Disallow: /

User-agent: *
Allow: /
Disallow: /api/
Disallow: /game/
Disallow: /game-test/

Sitemap: ${siteOrigin}/sitemap.xml
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
