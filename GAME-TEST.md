# Unlisted game testing page

The standalone game snapshot is served at `/game-test/`. It is absent from site navigation and the sitemap, and has a robots exclusion plus HTML and HTTP noindex/nofollow/noarchive directives. This is **unlisted, not authentication**: anyone with its URL can open it, and robots.txt itself reveals the path. No private music, keys, account credentials, or backend access is bundled.

The game runtime is vendored under `public/game-test/`, including its original license notice. `build-info.json` records the base source commit and the SHA-256 of the immutable tested snapshot manifest. The current graphics and gameplay snapshot has not been published to the game repository; the base commit does not include these changes. The snapshot hash covers every runtime file except build-info.json, using sorted UTF-8 lines containing each file SHA-256, two spaces, its game-relative path and a newline. There is no cross-repository build download or new deployment credential. Existing shop, fanclub, news, API and bilingual routes are unchanged.

Only this route permits SoundCloud scripts and frames from `https://w.soundcloud.com`. All other security directives and the website's global policy remain unchanged. The public SoundCloud profile provides streaming music through its official widget; browser autoplay restrictions and provider availability still apply.

## Current game changes

The twelve-road tour now includes readable encounter behaviors, four-slot current-car builds, seeded route goals, an updated HUD and workshop, keyboard-accessible auto-hearts, safer charging inputs and an optional four-action DJ encore. Original city, car and duo artwork is retained, including the corrected motion atlas, umbrellas and road textures. Completion points still unlock cars only for a new run; mid-tour upgrades use coins.

## Optional audio

The code includes a default-off segmented-audio service and car-stereo controls. Existing SoundCloud playback remains the default. No audio, packaged chunks or signing keys are included in Git or Docker images. The optional Compose and Nginx files are not activated by this change; activation requires a separately approved deployment and the route-scoped media policy described in game-audio/README.md. The global security policy is unchanged.

## Validation

- `npm run lint`
- `npm test`
- `npm run test:deployment`
- `npm run build`
- Existing browser and container CI gates, in both checkout modes
- The added five game unit suites run against the vendored runtime under npm test.
- The subpath browser suite retains mobile widths, map nodes, customization, rain, CSP and music-panel checks; it adds assist keyboard traversal, bounded frame metrics and fixture-backed workshop replacement/reload coverage.

The standalone source passed 256 unit/integration tests. Independent deterministic samples covered 655 tour attempts, all 264 family/hover-first tours clearing, 9,000 seeded plans, and retry/reward ledgers. These simulations do not establish subjective fun or device behavior. Native Canvas frames were inspected, but local Chromium startup and remote preview reachability were blocked. Actual desktop/mobile browser layout, real SoundCloud playback and browser timings remain release gates, not claimed results.

Container CI checks the redirect, game HTML, linked assets, robots headers, isolated SoundCloud policy, missing-asset 404 and unchanged homepage/sitemap before and after restart.

## Deployment

Merge the reviewed PR into main only after all CI gates pass. The existing workflow then builds, tests and publishes the website Docker images. If the VPS updater has already been activated, it polls for the tested images every five minutes; this repository cannot establish its activation state. Otherwise the site operator runs the existing updater as documented in `deploy/bouncer/README.md`.

After rollout, verify `https://gyaruinthemix.com/game-test/build-info.json` matches the reviewed snapshot hash, `/game-test/` returns 200, assets load and the game starts. Test desktop and phone, official SoundCloud playback, and existing shop/fanclub routes. A merged PR or published image alone is not proof of a live deployment.

## Refreshing the game

Copy only the reviewed frozen runtime (`index.html`, `main.js`, `style.css`, `src/`, runtime image/JSON assets and `LICENSE-NOTICE.md`). Preserve the noindex meta tag and update build-info. Do not copy audio, secrets, tests, node_modules, output screenshots or private build notes. Run all checks again before publication.
