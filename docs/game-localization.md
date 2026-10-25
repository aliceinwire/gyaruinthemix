# Game languages

The language selector is part of the game header and every reading/pause dialog. It supports Japanese, English, Italian, Spanish, French, German, Brazilian Portuguese, Korean, Simplified Chinese, and Traditional Chinese. Options use each language's own name.

An explicit `?lang=it` (or another supported language code) takes precedence over the saved preference and browser languages. Regional variants resolve to their supported language. Switching updates an existing `lang` parameter and saves only `gyaruinthemix-language-v1`. The tour, quiz seed, route choice, audio element, and journal stay in place. Storage or translation-load failures do not discard progress.

`public/game/locales/source.json` lists the canonical message keys. The nine full translation catalogs must contain every key with the same numbered placeholders. `ja.json` only overrides the original English radio and world labels. Names and song titles in quiz answers remain recognizable; live music metadata is displayed verbatim.

Game and save data remain canonical Japanese. `src/i18n.js` formats messages and loads only the English fallback and selected catalog from this site's static files. `src/localized-ui.js` retains a message's source and parameters on each UI binding. Changing languages refreshes those bindings without recreating controls, advancing dialogue, reshuffling questions, or restarting music. Canvas labels use the same translator.

Use `localizeText(node, source)`, `localizeAttribute(node, attribute, source)`, and `message('Coins: {0}', [amount])` for new display text. Keep IDs, URLs, gameplay comparisons, and save values out of translations. Mark music metadata with `verbatim(value)`. For composed legacy data, the translator recognizes catalog templates and explicit separators, with a bounded cache; prefer explicit `message` parameters for new UI.

Add every new message to the source list and each full catalog. Keep controls concise, preserve effect values and correct quiz answers, and review the fixed frame at narrow phone and short landscape sizes. The language picker belongs inside modal focus traps as well as the header.
