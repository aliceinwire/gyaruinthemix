# Unlisted game testing page

The standalone game snapshot is served at `/game-test/`. It is absent from site navigation and the sitemap, and has a robots exclusion plus HTML and HTTP noindex/nofollow/noarchive directives. This is **unlisted, not authentication**: anyone with its URL can open it, and robots.txt itself reveals the path. No private music, keys, account credentials, or backend access is bundled.

The game runtime is vendored under `public/game-test/`, including its original license notice. `build-info.json` records the base source commit, runtime version and SHA-256 of the frozen snapshot manifest. The current graphics and gameplay snapshot has not been published to the game repository; the base commit does not include these changes. The snapshot hash covers every runtime file except build-info.json, using sorted UTF-8 lines containing each file SHA-256, two spaces, its game-relative path and a newline. There is no cross-repository build download or new deployment credential. Existing shop, fanclub, news, API and bilingual routes are unchanged.

The game uses only its built-in car radio, with same-origin scripts and same-origin/blob media. Frames are disabled. The website's global policy remains unchanged; browser autoplay restrictions and audio-service availability still apply.

## Current game: NIGHTFALL TOUR 5.1

The game remains an automatically driven, side-scrolling car tour. Arinee drives and Chana navigates, sends heart invitations and welcomes people who choose to respond. Twelve local roads connect six fictional club stops. Fifty authored scenes frame the journey as six soundcheck recordings for a final Kyoto mix, with rest and longer transfers between separate tour nights. The game does not portray Tokyo-to-Kansai travel as a short uninterrupted road, nor claim that its fictional clubs are real bookings.

At the start of a new tour, choose Heart Relay, Neon Guard or Bounce Rider. Run-only XP opens up to six paused drafts, each offering three choices from nine perks. Their effects change invitations, charging protection, flight and rush behavior; family synergies reward deliberate combinations. The existing workshop supplies nine separate modules with four installed slots and one purchase per stop. Related perk and workshop effects combine rather than silently making an overlapping purchase redundant. Route choices retain their recovery, income and travel-length tradeoffs.

Seeded road encounters include readable movement and guard phases, plus optional city headliner speaker signals. The HUD shows actionable resources, route progress and mastery; help and controls sit outside the active road. Story scenes and perk drafts pause play, and transitions clear held inputs. Auto-hearts, assist mode and reduced motion have their own persistent settings; reduced motion preserves static action feedback. Narrative memory and the departure checkpoint are stored separately from those preferences. Retry restores the start of the current road without duplicating failed-road earnings.

Original city, car and duo artwork is retained, including the corrected motion atlas, umbrellas and road textures. Completion points still unlock cars only for a new run; mid-tour workshop upgrades use coins. The final DJ performance retains its optional four-action encore after completion points are secured. One persistent radio and media element are shared by every scene.

The complete interface stays inside one viewport-sized cabinet. Connected map branches remain directly selectable; garage, customization and draft choices use pages or card navigation. The car radio is the sole music control, including volume and mute. The accidental instruction footer and external player integration are removed. Twenty-four seeded quiz questions include twenty-one about ギャルインザミックス and three about 平成ギャル culture, with no other-artist trivia. Each twelve-road tour draws eleven unit questions and one culture question without repeats, and shuffles answer positions.

Cruise speeds are 184 and 216 km/h, twice the previous pace, with a top rush of 356.4 km/h. Road lengths grow by 2.5 times, giving about 25% more driving time at the new pace. Charging zones, spacing and anticipation scale with speed. The original suit enemy is joined by advertising representatives, copy clerks, meeting hosts, deadline runners and approval gatekeepers. Six routine-themed hazards retain clear shooting or hover counters; the copy printer takes three hearts. Invited fans express photography, modeling, styling, DJ, television and event interests. Safe EV areas feature cats and four small keepsakes worth 75 score and 6 energy, once per pickup; flowers are photographed in place, and animals never become collision or projectile targets.

See [the change log](GAME-OVERHAUL-CHANGELOG.md) for the feature summary and [the research report](docs/game-design-research.md) for primary sources, source-to-implementation reasoning and evidence limits. The opening narrative choice changes later conversation, not gameplay rewards; mechanical choices happen in styles, drafts, the workshop and route selection.

## Optional audio

The code includes a default-off segmented-audio service and car-stereo controls. The car radio is the only music control; unavailable service leaves the game playable. No audio, packaged chunks or signing keys are included in Git or Docker images. The audio sidecar, route-scoped media policy and updater are integrated into the single bouncer deployment. Explicit operator activation is described in `deploy/bouncer/README.md#optional-game-audio`; no separate Compose or Nginx overlay is installed. The global security policy is unchanged.

## Verification

[GAME-OVERHAUL-TESTING.md](GAME-OVERHAUL-TESTING.md) is the verification record for the current rewrite: it separates completed checks, observed results and remaining limits. Historical test totals and earlier snapshot results are not evidence for the current runtime. Automated correctness checks do not establish subjective enjoyment or retention.

Keep the existing unit, browser, build and container CI gates. Container coverage includes the redirect, game HTML, linked assets, robots headers, isolated game audio policy, missing-asset 404 and unchanged homepage/sitemap before and after restart. Desktop and phone interactions, real provider playback and deployed behavior require their own checks; consult the verification record rather than assuming they passed.

## Deployment

Merge the reviewed PR into main only after all CI gates pass. The existing workflow then builds, tests and publishes the website Docker images. If the VPS updater has already been activated, it polls for the tested images every five minutes; this repository cannot establish its activation state. Otherwise the site operator runs the existing updater as documented in `deploy/bouncer/README.md`.

After rollout, verify `https://gyaruinthemix.com/game-test/build-info.json` matches the reviewed snapshot hash, `/game-test/` returns 200, assets load and the game starts. Test desktop and phone, car radio playback, and existing shop/fanclub routes. A merged PR or published image alone is not proof of a live deployment.

## Refreshing the game

Copy only the reviewed frozen runtime (`index.html`, `main.js`, `style.css`, `src/`, runtime image/JSON assets and `LICENSE-NOTICE.md`). Preserve the noindex meta tag and update build-info. Do not copy audio, secrets, tests, node_modules, output screenshots or private build notes. Run all checks again before publication.
