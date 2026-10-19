# Unlisted game testing page

The standalone game snapshot is served at `/game-test/`. It is absent from site navigation and the sitemap, and has a robots exclusion plus HTML and HTTP noindex/nofollow/noarchive directives. This is **unlisted, not authentication**: anyone with its URL can open it, and robots.txt itself reveals the path. No private music, keys, account credentials, or backend access is bundled.

The game runtime is vendored under `public/game-test/`, including its original license notice. `build-info.json` records the exact source repository commit. There is no cross-repository build download or new deployment credential. Existing shop, fanclub, news, API and bilingual routes are unchanged.

Only this route permits SoundCloud scripts and frames from `https://w.soundcloud.com`. All other security directives and the website's global policy remain unchanged. The public SoundCloud profile provides streaming music through its official widget; browser autoplay restrictions and provider availability still apply.

## Validation

- `npm run lint`
- `npm test`
- `npm run test:deployment`
- `npm run build`
- Existing browser and container CI gates, in both checkout modes

Container CI checks the redirect, game HTML, linked assets, robots headers, isolated SoundCloud policy, missing-asset 404 and unchanged homepage/sitemap before and after restart.

## Deployment

Merge the reviewed PR into main only after all CI gates pass. The existing workflow then builds, tests and publishes the website Docker images. If the VPS updater has already been activated, it polls for the tested images every five minutes; this repository cannot establish its activation state. Otherwise the site operator runs the existing updater as documented in `deploy/bouncer/README.md`.

After rollout, verify `https://gyaruinthemix.com/game-test/build-info.json` matches the source commit, `/game-test/` returns 200, assets load and the game starts. Test desktop and phone, official SoundCloud playback, and existing shop/fanclub routes. A merged PR or published image alone is not proof of a live deployment.

## Refreshing the game

Copy only the reviewed frozen runtime (`index.html`, `main.js`, `style.css`, `src/`, runtime image/JSON assets and `LICENSE-NOTICE.md`). Preserve the noindex meta tag and update build-info. Do not copy audio, secrets, tests, node_modules, output screenshots or private build notes. Run all checks again before publication.
