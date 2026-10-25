/** Canonical game data stays Japanese. Only the presentation reads this module. */
export const LANGUAGE_KEY = 'gyaruinthemix-language-v1';
export const LANGUAGES = Object.freeze([
  { code: 'ja', name: '日本語' },
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'zh-Hant', name: '繁體中文' },
]);
const supported = new Set(LANGUAGES.map((item) => item.code));
export function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;
  const tag = value.trim().replaceAll('_', '-').toLowerCase();
  if (/^zh(?:-|$)/.test(tag))
    return /(?:hant|tw|hk|mo)(?:-|$)/.test(tag) ? 'zh-Hant' : 'zh-Hans';
  if (/^pt(?:-|$)/.test(tag)) return 'pt-BR';
  const base = tag.split('-')[0];
  return supported.has(base) ? base : null;
}
export function preferredLanguage({
  search = '',
  storage,
  languages = [],
} = {}) {
  const explicit = normalizeLanguage(new URLSearchParams(search).get('lang'));
  if (explicit) return explicit;
  try {
    const saved = normalizeLanguage(storage?.getItem(LANGUAGE_KEY));
    if (saved) return saved;
  } catch {}
  return languages.map(normalizeLanguage).find(Boolean) || 'ja';
}
const MESSAGE = Symbol('localized message');
const VERBATIM = Symbol('catalog metadata');
const NUMBER = Symbol('localized number');
export const number = (value, options = {}) => ({
  [NUMBER]: true,
  value,
  options,
  toString: () => String(value),
});
export const verbatim = (value) => ({
  [VERBATIM]: true,
  toString: () => String(value ?? ''),
});
/** Retain parameters so a visible message can change language without rerunning game logic. */
export function message(source, values = []) {
  return {
    [MESSAGE]: true,
    source,
    values,
    toString() {
      return source.replace(/\{(\d+)\}/g, (match, index) =>
        index in values ? String(values[index] ?? '') : match,
      );
    },
  };
}
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const placeholders = (value) =>
  [...value.matchAll(/\{(\d+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
function patternsFor(catalog) {
  return Object.keys(catalog)
    .filter((source) => /\{\d+\}/.test(source))
    .map((source) => {
      const parts = source.split(/\{\d+\}/),
        indices = [...source.matchAll(/\{(\d+)\}/g)].map((match) =>
          Number(match[1]),
        );
      return {
        source,
        indices,
        specificity: parts.join('').replace(/[\s/·:：]/g, '').length,
        expression: new RegExp(
          '^' +
            parts
              .map(escapePattern)
              .join(source === '{0}で{1}' ? '([\\s\\S]*)' : '([\\s\\S]*?)') +
            '$',
        ),
      };
    })
    .sort((a, b) => b.specificity - a.specificity);
}
export function createTranslator({
  loadCatalog = async (code) => {
    const response = await fetch(
      new URL(`../locales/${code}.json`, import.meta.url),
      { signal: globalThis.AbortSignal?.timeout?.(8000) },
    );
    if (!response.ok) throw new Error(`Language unavailable: ${code}`);
    return response.json();
  },
  storage,
} = {}) {
  const catalogs = new Map(),
    listeners = new Set(),
    cache = new Map(),
    numberFormats = new Map();
  let locale = 'ja',
    patterns = [],
    phrases = [],
    request = 0;
  async function load(code) {
    if (catalogs.has(code)) return catalogs.get(code);
    const pending = Promise.resolve()
      .then(() => loadCatalog(code))
      .then((catalog) => {
        if (!catalog || Array.isArray(catalog) || typeof catalog !== 'object')
          throw new Error('Invalid language catalog');
        for (const [source, value] of Object.entries(catalog)) {
          if (
            typeof value !== 'string' ||
            placeholders(source) !== placeholders(value)
          )
            throw new Error(`Invalid translation: ${source}`);
        }
        return Object.freeze(catalog);
      });
    catalogs.set(code, pending);
    try {
      const catalog = await pending;
      catalogs.set(code, catalog);
      return catalog;
    } catch (error) {
      catalogs.delete(code);
      throw error;
    }
  }
  function dictionary(code) {
    const value = catalogs.get(code);
    return value && typeof value.then !== 'function' ? value : {};
  }
  function translated(source) {
    return (
      dictionary(locale)[source] ??
      (locale === 'ja' ? source : (dictionary('en')[source] ?? source))
    );
  }
  function format(source, values, depth) {
    return translated(source).replace(/\{(\d+)\}/g, (match, index) =>
      index in values ? translate(values[index], depth + 1) : match,
    );
  }
  function formatNumber(value, options = {}) {
    const key = JSON.stringify(options);
    if (!numberFormats.has(key))
      numberFormats.set(
        key,
        new Intl.NumberFormat(locale, {
          useGrouping: false,
          maximumFractionDigits: 3,
          ...options,
        }),
      );
    return numberFormats.get(key).format(value);
  }
  function translate(value, depth = 0) {
    if (value?.[NUMBER]) return formatNumber(value.value, value.options);
    if (typeof value === 'number') return formatNumber(value);
    if (value?.[VERBATIM]) return String(value);
    if (value?.[MESSAGE]) return format(value.source, value.values, depth);
    const raw = String(value ?? '');
    if (!raw.trim() || depth > 12) return raw;
    if (cache.has(raw)) return cache.get(raw);
    const source = raw.trim();
    let output;
    if (
      Object.hasOwn(dictionary(locale), source) ||
      (locale !== 'ja' && Object.hasOwn(dictionary('en'), source))
    )
      output = translated(source);
    else if (locale === 'ja') output = source;
    else {
      for (const pattern of patterns) {
        const match = pattern.expression.exec(source);
        if (!match || match.slice(1).some((part) => part === source)) continue;
        if (
          pattern.specificity < 3 &&
          match
            .slice(1)
            .some(
              (part) =>
                /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(
                  part,
                ) && !Object.hasOwn(dictionary('en'), part.trim()),
            )
        )
          continue;
        const values = [];
        pattern.indices.forEach((index, capture) => {
          values[index] = match[capture + 1];
        });
        output = format(pattern.source, values, depth);
        break;
      }
      if (output === undefined) {
        // Composed catalog fields use these explicit separators. Never substitute inside words.
        const prefix = phrases.find(
          (phrase) =>
            source.startsWith(phrase) &&
            /[\s。、！!・：]/.test(
              source.slice(phrase.length, phrase.length + 1),
            ) &&
            !/^\s+[·/]/.test(source.slice(phrase.length)),
        );
        if (prefix)
          output =
            translated(prefix) +
            translate(source.slice(prefix.length), depth + 1);
        else {
          const separator = /(\s[·/]\s|\n|：|・)/.exec(source);
          if (separator) {
            const between = separator[0],
              index = separator.index;
            output =
              translate(source.slice(0, index), depth + 1) +
              (between === '：' ? ': ' : between === '・' ? ' · ' : between) +
              translate(source.slice(index + between.length), depth + 1);
          } else {
            const marked = source.match(/^(✓\s*|\d+\.\s+)(.+)$/);
            output = marked
              ? marked[1] + translate(marked[2], depth + 1)
              : source;
          }
        }
      }
    }
    const result =
      raw.slice(0, raw.indexOf(source)) +
      output +
      raw.slice(raw.indexOf(source) + source.length);
    if (cache.size >= 2048) cache.delete(cache.keys().next().value);
    cache.set(raw, result);
    return result;
  }
  return {
    t: translate,
    get language() {
      return locale;
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async setLanguage(value, { persist = true } = {}) {
      const code = normalizeLanguage(value);
      if (!code) throw new Error('Unsupported language');
      const currentRequest = ++request;
      const [english] = await Promise.all([load('en'), load(code)]);
      if (currentRequest !== request) return false;
      patterns = patternsFor(english);
      phrases = Object.keys(english)
        .filter((key) => !/\{\d+\}/.test(key) && key.length >= 2)
        .sort((a, b) => b.length - a.length);
      locale = code;
      cache.clear();
      numberFormats.clear();
      if (persist) {
        try {
          storage?.setItem(LANGUAGE_KEY, code);
        } catch {}
      }
      listeners.forEach((callback) => callback(code));
      return true;
    },
  };
}
let browserStorage;
try {
  browserStorage = globalThis.localStorage;
} catch {}
export const i18n = createTranslator({ storage: browserStorage });
export const t = (value) => i18n.t(value);
