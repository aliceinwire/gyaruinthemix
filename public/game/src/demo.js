/** Demo progress lives only in this page; normal saves are never read or written. */
export const DEMO_LAST_ROAD = 1;
export function isDemoSearch(search = '') {
  return new URLSearchParams(search).get('demo') === '1';
}
export function demoFinished(state) {
  return state?.status === 'won' && state.routeIndex >= DEMO_LAST_ROAD;
}
export function demoStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
  };
}
export function demoLink(enabled, language = 'ja') {
  const query = new URLSearchParams({ lang: language });
  if (enabled) query.set('demo', '1');
  return '/game/?' + query;
}
