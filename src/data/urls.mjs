// Public metadata is fixed at build time. API SITE_URL remains deployment-specific.
export const siteOrigin = 'https://gyaruinthemix.com';

// Checkout returns, the hidden sandbox and error pages must not be indexed.
export const publicPaths = [
  '/',
  '/about/',
  '/music/',
  '/live/',
  '/news/',
  '/fanclub/',
  '/shop/',
  '/contact/',
  '/legal/',
  '/privacy/',
];

export const canonicalUrl = (path) => new URL(path, siteOrigin).href;
