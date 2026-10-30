import { localizePath } from './i18n.mjs';
// Public metadata is fixed at build time. API SITE_URL remains deployment-specific.
export const siteOrigin = 'https://gyaruinthemix.com';

// Checkout returns, game-only streaming rules, the sandbox and errors stay unindexed.
export const defaultPublicPaths = [
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

export const publicPaths = [
  ...defaultPublicPaths,
  ...defaultPublicPaths.map((path) => localizePath(path, 'en')),
];

export const canonicalUrl = (path) => new URL(path, siteOrigin).href;
