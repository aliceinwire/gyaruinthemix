import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LANGUAGES,
  LANGUAGE_KEY,
  normalizeLanguage,
  preferredLanguage,
  createTranslator,
  message,
  number,
  verbatim,
  i18n,
} from '../public/game-test/src/i18n.js';
import {
  localizeText,
  localizeAttribute,
} from '../public/game-test/src/localized-ui.js';
import { getJourneyStage } from '../public/game-test/src/journey.js';
import { getStoryScene } from '../public/game-test/src/tour-story.js';
import {
  createState,
  exportCampaignSave,
} from '../public/game-test/src/simulation.js';
import { questionForStage } from '../public/game-test/src/questions.js';
import {
  SURVIVAL_UPGRADES,
  SURVIVAL_EVOLUTIONS,
  survivalOffers,
  survivalXpCost,
} from '../public/game-test/src/survival.js';
import { RUN_MOD_CATALOG } from '../public/game-test/src/run-build.js';

const directory = new URL('../public/game-test/locales/', import.meta.url);
const readCatalog = async (code) =>
  JSON.parse(await readFile(new URL(code + '.json', directory), 'utf8'));
const source = JSON.parse(
  await readFile(new URL('source.json', directory), 'utf8'),
);
const slots = (value) =>
  [...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();

test('all nine translated catalogs cover every source and preserve interpolation slots', async () => {
  assert.equal(new Set(source).size, source.length);
  for (const { code } of LANGUAGES.filter((item) => item.code !== 'ja')) {
    const catalog = await readCatalog(code);
    assert.deepEqual(Object.keys(catalog).sort(), [...source].sort(), code);
    for (const key of source) {
      assert.ok(catalog[key].trim(), `${code}: ${key}`);
      assert.deepEqual(slots(catalog[key]), slots(key), `${code}: ${key}`);
    }
  }
});

test('Japanese branding uses katakana and survives language switching', async () => {
  const translator = createTranslator({ loadCatalog: readCatalog });
  const branding = {
    'ギャルインザミックス / NIGHTFALL TOUR':
      'ギャルインザミックス / ナイトフォールツアー',
    'NIGHTFALL TOUR / 175 BPM': 'ナイトフォールツアー / 175 BPM',
    'NIGHTFALL TOUR': 'ナイトフォールツアー',
    'A GYARUINTHEMIX ROAD ROGUELITE':
      'ギャルインザミックスのロードローグライト',
    NIGHTFALL: 'ナイトフォール',
    TOUR: 'ツアー',
  };
  for (const code of ['ja', 'en', 'ja']) {
    await translator.setLanguage(code);
    const expected = code === 'ja' ? branding : await readCatalog(code);
    for (const key of Object.keys(branding))
      assert.equal(translator.t(key), expected[key]);
  }
});

test('every survival item and generated effect is translated, including phone and MD upgrades', async () => {
  const translator = createTranslator({ loadCatalog: readCatalog });
  const messages = new Set();
  for (const item of [
    ...SURVIVAL_UPGRADES,
    ...SURVIVAL_EVOLUTIONS,
    ...RUN_MOD_CATALOG,
  ]) {
    messages.add(item.name);
    if (item.description) messages.add(item.description);
  }
  const state = createState({ mode: 'survival', seed: 175 });
  for (let level = 0; level < 3; level++) {
    state.survival.upgrades = Object.fromEntries(
      SURVIVAL_UPGRADES.map((item) => [
        item.id,
        Math.max(item.id === 'heart' ? 1 : 0, level),
      ]),
    );
    state.survival.level =
      Object.values(state.survival.upgrades).reduce(
        (sum, value) => sum + value,
        0,
      ) - 1;
    state.survival.xp = survivalXpCost(state.survival.level);
    for (let seed = 1; seed <= 50; seed++) {
      state.seed = seed;
      for (const offer of survivalOffers(state)) messages.add(offer.synergy);
    }
  }
  for (const { code } of LANGUAGES.filter((item) => item.code !== 'ja')) {
    const catalog = await readCatalog(code);
    for (const item of [...SURVIVAL_UPGRADES, ...SURVIVAL_EVOLUTIONS]) {
      assert.ok(catalog[item.name], `${code}: ${item.name}`);
      if (item.description)
        assert.ok(catalog[item.description], `${code}: ${item.description}`);
    }
  }
  for (const code of ['en', 'it', 'es', 'fr', 'de', 'pt-BR']) {
    await translator.setLanguage(code);
    for (const value of messages)
      assert.doesNotMatch(
        translator.t(value),
        /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
        `${code}: ${value}`,
      );
  }
});

test('language preference accepts regional aliases and uses URL, saved choice, then browser', () => {
  for (const [input, expected] of [
    ['it-IT', 'it'],
    ['pt-PT', 'pt-BR'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh_Hans_CN', 'zh-Hans'],
    ['ko-KR', 'ko'],
    ['fr-CA', 'fr'],
    ['unknown', null],
  ])
    assert.equal(normalizeLanguage(input), expected);
  const storage = { getItem: () => 'it' };
  assert.equal(
    preferredLanguage({ search: '?lang=de-DE', storage, languages: ['en-US'] }),
    'de',
  );
  assert.equal(preferredLanguage({ storage, languages: ['en-US'] }), 'it');
  assert.equal(
    preferredLanguage({
      storage: {
        getItem() {
          throw Error();
        },
      },
      languages: ['xx', 'ko-KR'],
    }),
    'ko',
  );
  assert.equal(preferredLanguage(), 'ja');
});

test('composed source messages preserve whole phrases, names containing particles, and parameter order', async () => {
  const translator = createTranslator({ loadCatalog: readCatalog });
  await translator.setLanguage('en');
  assert.equal(
    translator.t('充電ルート · EV多め・長い道・コイン控えめ'),
    'Charging route · More EV stops · Longer road · Fewer coins',
  );
  assert.equal(
    translator.t('NIGHT 01 / 中野 / クラブへの道'),
    'NIGHT 01 / Nakano / Road to the club',
  );
  assert.equal(
    translator.t('ハートでフロアに誘お'),
    'Invite them to the dance floor',
  );
  assert.equal(
    translator.t(message('{0}で{1}', ['日本橋でんでん街', '充電してから出発'])),
    translator.t('日本橋でんでん街で充電してから出発'),
  );
  assert.equal(
    translator.t(message('{0} / {1}', ['中野', '充電ルート'])),
    'Nakano / Charging route',
  );
  assert.match(
    translator.t(
      '正解！新しいファンが増えたで 答えは「ギャルインザミックス」。うちらの音と平成ギャル、どこまで知ってる？',
    ),
    /^Correct! New fans joined us! The answer is/,
  );
  assert.equal(translator.t('  中野  '), '  Nakano  ');
  const canonical = String(message('{0} / {1}', ['中野', '充電ルート']));
  assert.equal(canonical, '中野 / 充電ルート');
  await translator.setLanguage('it');
  assert.equal(translator.t('Language'), 'Lingua');
  assert.equal(
    translator.t(message('{0} m', [number(1234, { useGrouping: true })])),
    '1.234 m',
  );
  assert.equal(
    translator.t(verbatim('ギャルインザミックス')),
    'ギャルインザミックス',
  );
  assert.equal(
    translator.t('ハートでフロアに誘お'),
    (await readCatalog('it'))['ハートでフロアに誘お'],
  );
});

test('all generated journey and story text translates without changing canonical data', async () => {
  const translator = createTranslator({ loadCatalog: readCatalog });
  const state = createState({ seed: 175 });
  const save = exportCampaignSave(state);
  const questions = Array.from({ length: 12 }, (_, index) =>
    questionForStage(index, 'scenic', 175),
  );
  const values = new Set();
  function collect(value) {
    if (
      typeof value === 'string' &&
      /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value)
    )
      values.add(value);
    else if (value && typeof value === 'object')
      Object.values(value).forEach(collect);
  }
  for (let routeIndex = 0; routeIndex < 12; routeIndex++) {
    collect(getJourneyStage(routeIndex));
    for (const trigger of [
      'opening',
      'departure',
      'arrival',
      'retry',
      'finale',
    ])
      collect(getStoryScene({ routeIndex, status: 'won' }, trigger));
  }
  for (const code of ['en', 'it', 'fr', 'de', 'es', 'pt-BR']) {
    await translator.setLanguage(code);
    for (const value of values)
      assert.doesNotMatch(
        translator.t(value),
        /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
        `${code}: ${value}`,
      );
  }
  assert.deepEqual(exportCampaignSave(state), save);
  assert.deepEqual(
    Array.from({ length: 12 }, (_, index) =>
      questionForStage(index, 'scenic', 175),
    ),
    questions,
  );
});

test('catalog failure keeps the active language; last requested locale wins; denied storage is harmless', async () => {
  const writes = [];
  const translator = createTranslator({
    loadCatalog: async (code) => {
      if (code === 'de') throw Error('offline');
      return readCatalog(code);
    },
    storage: {
      setItem(key, value) {
        writes.push([key, value]);
      },
    },
  });
  await translator.setLanguage('it');
  await assert.rejects(translator.setLanguage('de'), /offline/);
  assert.equal(translator.language, 'it');
  assert.deepEqual(writes, [[LANGUAGE_KEY, 'it']]);
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const race = createTranslator({
    loadCatalog: async (code) => {
      if (code === 'fr') await slow;
      return readCatalog(code);
    },
    storage: {
      setItem() {
        throw Error();
      },
    },
  });
  const oldRequest = race.setLanguage('fr');
  await race.setLanguage('it');
  release();
  assert.equal(await oldRequest, false);
  assert.equal(race.language, 'it');
  await assert.rejects(race.setLanguage('xx'), /Unsupported/);
});

test('language switches refresh existing labels without replacing controls, losing selections, or firing actions', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    json: () =>
      readCatalog(new URL(url).pathname.split('/').at(-1).replace('.json', '')),
  });
  try {
    const attributes = new Map();
    let writes = 0;
    const control = {
      isConnected: true,
      value: 'existing-choice',
      disabled: false,
      textContent: '',
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => {
        attributes.set(key, value);
        writes++;
      },
    };
    localizeText(control, message('{0} / {1}', ['中野', 'クラブへの道']));
    localizeAttribute(control, 'aria-label', 'Language');
    await i18n.setLanguage('it', { persist: false });
    assert.equal(control.textContent, 'Nakano / Strada per il club');
    assert.equal(attributes.get('aria-label'), 'Lingua');
    assert.equal(control.value, 'existing-choice');
    assert.equal(control.disabled, false);
    await i18n.setLanguage('ja', { persist: false });
    assert.equal(control.textContent, '中野 / クラブへの道');
    assert.equal(attributes.get('aria-label'), '言語');
    assert.equal(control.value, 'existing-choice');
    assert.ok(writes >= 3);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
