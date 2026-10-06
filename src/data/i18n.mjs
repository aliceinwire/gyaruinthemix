// Japanese is the default. Only the explicit /en route tree selects English.
export const locales = ['ja', 'en'];
export const getLocale = (pathname = '/') =>
  /^\/en(?:\/|$)/.test(pathname) ? 'en' : 'ja';
export const translator = (locale) => (ja, en) => (locale === 'en' ? en : ja);

// Localize site routes only; leave assets, API endpoints and external links alone.
// Query strings and fragments are preserved, including checkout return receipts.
export function localizePath(path, locale) {
  if (typeof path !== 'string' || !/^\/(?!\/)/.test(path)) return path;
  const match = path.match(/^([^?#]*)(.*)$/);
  const original = match[1];
  if (/^\/(?:assets|_astro|api)(?:\/|$)/.test(original)) return path;
  let base = original.replace(/^\/en(?=\/|$)/, '') || '/';
  if (base === '/404/' || base === '/404.html')
    base = locale === 'en' ? '/404/' : '/404.html';
  return `${locale === 'en' ? '/en' : ''}${base}${match[2]}`;
}
