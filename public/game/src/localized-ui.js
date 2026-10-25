import { i18n, t, LANGUAGES, preferredLanguage } from './i18n.js';

const bindings = new Map(),
  markup = new WeakMap();
const textAttributes = [
  'aria-label',
  'aria-valuetext',
  'title',
  'alt',
  'placeholder',
];
let writes = 0;
function draw(node, key, source) {
  const value = t(source);
  if (key === '#text') {
    if (node.textContent !== value) node.textContent = value;
  } else if (node.getAttribute(key) !== value) node.setAttribute(key, value);
}
function bind(node, key, source) {
  if (!node) return;
  let fields = bindings.get(node);
  if (!fields) {
    fields = new Map();
    bindings.set(node, fields);
  }
  fields.set(key, source);
  draw(node, key, source);
  // Dynamic cards are replaced, whereas HUD bindings update in place.
  if (++writes % 256 === 0)
    queueMicrotask(() => {
      for (const element of bindings.keys())
        if (element.isConnected === false) bindings.delete(element);
    });
}
export function localizeText(node, source) {
  bind(node, '#text', source);
  return source;
}
export function localizeAttribute(node, key, source) {
  bind(node, key, source);
}
export function localizeTree(root) {
  if (
    !root ||
    (root.nodeType === 1 &&
      (['SCRIPT', 'STYLE'].includes(root.tagName) ||
        root.getAttribute('translate') === 'no'))
  )
    return;
  if (root.nodeType === 3) {
    if (root.textContent.trim() && !bindings.get(root)?.has('#text'))
      bind(root, '#text', root.textContent);
    return;
  }
  if (root.nodeType === 1)
    for (const key of textAttributes)
      if (root.hasAttribute(key) && !bindings.get(root)?.has(key))
        bind(root, key, root.getAttribute(key));
  if (bindings.get(root)?.has('#text')) return;
  for (const child of root.childNodes || []) localizeTree(child);
}
export function localizeHTML(node, source) {
  if (markup.get(node) === source) return;
  markup.set(node, source);
  node.innerHTML = source;
  localizeTree(node);
}
export function refreshTranslations() {
  for (const [node, fields] of bindings) {
    if (node.isConnected === false) {
      bindings.delete(node);
      continue;
    }
    for (const [key, source] of fields) draw(node, key, source);
  }
}
i18n.subscribe(refreshTranslations);
const failures = {
  ja: '翻訳を読み込めへんかった。もう一度選んでな。',
  en: 'Could not load this language. Please try again.',
  it: 'Impossibile caricare la lingua. Riprova.',
  es: 'No se pudo cargar el idioma. Inténtalo de nuevo.',
  fr: 'Impossible de charger la langue. Réessaie.',
  de: 'Sprache konnte nicht geladen werden. Bitte erneut versuchen.',
  'pt-BR': 'Não foi possível carregar o idioma. Tente de novo.',
  ko: '언어를 불러오지 못했어요. 다시 선택해 주세요.',
  'zh-Hans': '无法加载此语言，请重试。',
  'zh-Hant': '無法載入此語言，請重試。',
};
export async function initializeLanguage() {
  let storage;
  try {
    storage = globalThis.localStorage;
  } catch {}
  const preferred = preferredLanguage({
    search: globalThis.location?.search,
    storage,
    languages: globalThis.navigator?.languages || [],
  });
  try {
    await i18n.setLanguage(preferred, { persist: false });
  } catch {
    /* The original Japanese game remains playable if a catalog is unavailable. */
  }
}
/** Pickers are inside modal focus traps as well as the persistent header. */
export function installLanguageSelectors({
  root = document,
  onError = () => {},
} = {}) {
  const pickers = [];
  function picker(host, modal = false) {
    const label = root.createElement('label');
    label.className = `language-picker${modal ? ' language-picker-modal' : ''}`;
    const caption = root.createElement('span');
    caption.className = 'visually-hidden';
    localizeText(caption, 'Language');
    const select = root.createElement('select');
    select.dataset.languagePicker = '';
    select.setAttribute('translate', 'no');
    localizeAttribute(select, 'aria-label', 'Language');
    for (const language of LANGUAGES) {
      const option = root.createElement('option');
      option.value = language.code;
      option.textContent = language.name;
      option.lang = language.code;
      select.append(option);
    }
    select.value = i18n.language;
    select.addEventListener('change', async () => {
      const choice = select.value;
      pickers.forEach((control) => {
        control.disabled = true;
        control.setAttribute('aria-busy', 'true');
      });
      try {
        await i18n.setLanguage(choice);
        const url = new URL(globalThis.location.href);
        if (url.searchParams.has('lang')) {
          url.searchParams.set('lang', i18n.language);
          globalThis.history.replaceState(globalThis.history.state, '', url);
        }
      } catch {
        onError(failures[i18n.language]);
      } finally {
        pickers.forEach((control) => {
          control.value = i18n.language;
          control.disabled = false;
          control.removeAttribute('aria-busy');
        });
        select.focus({ preventScroll: true });
      }
    });
    label.append(caption, select);
    host.append(label);
    pickers.push(select);
  }
  picker(root.querySelector('.settings'));
  root.querySelectorAll('.modal-card').forEach((host) => picker(host, true));
  const update = (language) => {
    root.documentElement.lang = language;
    root.documentElement.dataset.language = language;
    pickers.forEach((select) => {
      select.value = language;
    });
  };
  i18n.subscribe(update);
  update(i18n.language);
  localizeTree(root.documentElement);
  root
    .querySelectorAll('[data-control]')
    .forEach((button) =>
      localizeAttribute(button, 'data-suggestion', 'いまココ'),
    );
  const description = root.querySelector('meta[name="description"]');
  if (description)
    localizeAttribute(description, 'content', description.content);
}
