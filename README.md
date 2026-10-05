# GYARUINTHEMIX official artist website, fan hub and store

The Japanese official DJ-unit website for ギャルインザミックス: artist identity, music, live/media listings, news, a public fan hub and merchandise, with an Astro build, nginx and Stripe-hosted Checkout. The default uses public Stripe Payment Links and stores no Stripe credentials; a Fastify custom-cart API is optional. The supplied logo is preserved. Photos are supplied project assets. No third-party analytics, card forms, database server, Redis or admin panel. GitHub CI publishes tested images for optional pull-based website updates on the VPS.

**Delivery state:** artist/fan pages and shop implemented; fan-club enrollment is not open and has no membership backend; products ship as `coming_soon`, prices unset and sales disabled. This is a deployable implementation, not a claim that your VPS, Stripe account or live shop has been configured. See `VALIDATION.md` for verification scope and release evidence. Complete the TEST-mode launch procedure before enabling live sales.

## Hidden sandbox shop

`/shop-test/` is a separate testing-only shop with sticker, towel, acrylic keychain and T-shirt. It has no navigation link or sitemap entry, and its index/success/cancel pages carry `noindex`. The URL is **not access control**: anyone who knows it can open it. Test pages clearly state that no real payment or shipment occurs. The T-shirt is a single test SKU with no size selector, and its logo image is a reference rather than a product photograph.

The ordinary `/shop/`, `config/products.json` and Payment Links settings remain unchanged. Sandbox definitions live only in `config/test-products.json`; no real Stripe IDs or invented display prices are committed. The test cart and checkout-attempt storage are isolated from the normal shop. The hidden page requires the existing **API web image and `checkout-api` profile**; a Payment Links-only deployment has no test checkout API.

To prepare it on the API deployment, add the following non-secret settings to the existing bouncer `.env`, preserving the other site settings:

```dotenv
STRIPE_MODE=test
SALES_ENABLED=false
TEST_SHOP_ENABLED=false
STRIPE_PRICE_STICKER=
STRIPE_PRICE_TOWEL=
STRIPE_PRICE_KEYCHAIN=
STRIPE_PRICE_TSHIRT=
STRIPE_SHIPPING_RATE_JP=
```

Fill the five IDs from the same Stripe sandbox as the existing `rk_test_` and webhook secret files. Each Price must be active, one-time, JPY, per-unit, a positive integer amount, inclusive-tax and attached to an active product. The shipping rate must be active, test-mode, fixed-amount JPY, inclusive-tax and a nonnegative integer amount; the configured rate applies once per checkout and delivery addresses are Japan-only. Verify the actual amounts and tax behavior in Stripe before enabling. Product `default_price` IDs alone do not prove those Price settings.

After the updated images **and Compose definition** are deliberately installed, set `TEST_SHOP_ENABLED=true` and recreate only the API service using the documented bouncer workflow. The image updater does not install Compose changes or apply `.env` changes on its own. Public `SALES_ENABLED` stays `false`; `STORE_DETAILS_REVIEWED` and `LIVE_MODE_ACK` do not need to change for this test-only shop. Set `TEST_SHOP_ENABLED=false` and recreate the API to close it again.

The API refuses startup if hidden tests are enabled with live mode, a non-test restricted key, enabled public sales, missing Price IDs, or invalid sandbox prices/shipping. The app independently checks the mode/key/sales boundary. `/api/test-shop/catalog` and `/api/test-shop/checkout` do not exist while disabled. Enabled tests never open `/api/checkout`; test sessions use `gyaruinthemix-test` metadata and return to `/shop-test/success/` or `/shop-test/cancel/`. The shared signed webhook accepts matching test events and records observations only; it does not fulfill orders. Visiting a success page is not payment evidence.

Verify after activation:

- `/api/catalog` still reports `salesEnabled: false`, and `/shop/` is still closed with its original three products.
- `/api/test-shop/catalog` reports `mode: test`, four available test products and the reviewed JPY shipping amount.
- Complete an authorized Stripe test checkout with test payment data, confirm its test-mode record and signed webhook observation in Stripe, then check cancellation/back navigation and separate carts.
- Turn the switch off and confirm the hidden API returns 404 while the ordinary site remains healthy.

### Returning from sandbox checkout

Sandbox checkout protocol v2 records the submitted cart snapshot and a browser-local attempt UUID. The API binds that UUID to the Checkout Session, and retrieves current session status before returning a hosted checkout URL or confirming payment. The status endpoint returns only test mode, session ID and `open` / `paid` / `pending` / `expired`; it never returns customer or payment details. The restricted key must allow Checkout Session retrieval as well as creation. A successful page visit alone is not payment proof.

After a verified paid result, an unchanged test bag is cleared and its retry attempt retired. If the bag was edited in another tab or since checkout, it is kept for review so newer additions are not deleted. Cancelled/open, pending, mismatched or unverifiable returns preserve the bag; expired sessions retire only the retry key. Retries check the saved session before following its URL. An old unknown attempt is not silently renewed beyond the idempotency window. If browser storage cannot retain the return receipt, the browser stays on the shop rather than losing its recovery information.

Attempts created before v2 lack a Session ID/proof and cannot be verified retrospectively. The test bag therefore asks the user to check Stripe, remove already-paid items, and explicitly acknowledge starting a new attempt. Old cached clients are rejected by the sandbox protocol gate and must reload. Public-shop cart behavior is unchanged. These checks use mocked Stripe methods in tests; no payment is made by the test suite.

## Your VPS: deploy only from ~/bouncer

[deploy/bouncer](deploy/bouncer/README.md) is the only deployment path. Install its [docker-compose.yml](deploy/bouncer/docker-compose.yml) as `~/bouncer/docker-compose.yml`, preserving the existing Compose project identity. It preserves the proxy, certificate companion, ZNC and Limnoria definitions and adds the static website. The API is behind the optional `checkout-api` profile. Put this repository at `~/bouncer/gyaruinthemix`, add [these settings](deploy/bouncer/.env.example) to `~/bouncer/.env`, and follow the [one-time setup and update instructions](deploy/bouncer/README.md). **No Stripe secret files are required for the default mode.**

After completing that setup and confirming that the published GHCR image is accessible, start only the website:

```bash
cd ~/bouncer
docker compose pull gyaruinthemix-web
docker compose up -d --no-deps --no-build --pull never --wait gyaruinthemix-web
```

The website adds no host ports and uses the existing bouncer project. Website operations name only `gyaruinthemix-web` and, when enabled, `gyaruinthemix-api`; do not run an unscoped `up`, build or restart against the shared stack. The 1 GB VPS pulls prebuilt images rather than building the application.

The optional updater checks GHCR every five minutes through **either the existing cron service (including OpenRC hosts) or a systemd user timer**. Choose one scheduler using the [bouncer activation guide](deploy/bouncer/README.md#3-activate-automatic-checks-once). Only successful CI for a trusted `main` push in `aliceinwire/gyaruinthemix` can publish release images. The updater pulls without building, checks health and attempts rollback if a release fails. A failed release is remembered and requires `--retry` to attempt again. This is **image updating only**: Compose, updater, cron/systemd and other deployment/configuration changes still require deliberate manual review and installation. Nothing has been enabled or deployed to the VPS by this source change.

## Checkout without keeping Stripe keys

The default `CHECKOUT_MODE=payment_links` builds a static shop with ordinary purchase links to Stripe. Create those links in the Stripe Dashboard, add each public URL and matching actual JPY price to `config/products.json`, and review/enable TEST sales in `config/payment-links.json`. See [the complete key-free setup and TEST procedure](deploy/PAYMENT-LINKS.md).

- One nginx process; no Node backend, API credentials, local payment records or webhook secrets.
- Purchase a predefined product or bundle, with quantities/options configured in Stripe. A flexible website cart requires the optional API mode.
- No JavaScript is needed for purchase links. No card information passes through this site.
- No prices or working links have been invented; unconfigured products stay disabled.
- Site prices and Stripe settings must be reviewed together. Stripe Payment Links can offer localized currency through Adaptive Pricing; choose API mode if checkout must always be strictly JPY.

For local development: `npm ci`, `npm run images`, then `npm run dev`. No Stripe setup is needed just to view the artist website. Default Docker build: `docker build -f Dockerfile.web -t gyaruinthemix-web:local .`. Production health: `/web-health`; `/api/*` returns 404 in this mode.

## Optional custom-cart API mode

Only follow the API-specific sections below if you want the multi-product cart. In `~/bouncer/.env`, set **both** `CHECKOUT_MODE=api` and `COMPOSE_PROFILES=checkout-api`, select `GYARUINTHEMIX_WEB_IMAGE=ghcr.io/aliceinwire/gyaruinthemix-web-api:main`, and set `GYARUINTHEMIX_API_IMAGE=ghcr.io/aliceinwire/gyaruinthemix-api:main`. Configure its two secret files using a restricted API key and Stripe settings before starting it. See the [bouncer guide](deploy/bouncer/README.md) for the complete mode-switch procedure. Local Astro development needs `CHECKOUT_MODE=api npm run dev`; the API uses `npm run dev:api`. The frontend and nginx routing mode are fixed at image build time; changing only the runtime mode does not change the selected image.

The [Payment Links guide](deploy/PAYMENT-LINKS.md) covers default deployment, shipping, smoke checks, live configuration, updates, pausing sales, rollback, backups and migration away from an already-running API. The numbered API instructions below describe the optional custom cart, not requirements for the default website.

## Artist website and fan club

The homepage introduces DJありねぇ + DJちゃな first. Merch is one destination in the wider artist website. The design uses the supplied logo and photos with a Heisei gyaru direction: pink, black, chrome type, hearts, original vector leopard accents and photo-scrapbook layouts. No imagery, code, text or branding was copied from other artists.

| Route                             | Content                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `/`                               | Duo identity, news, music, appearances, fan club, then merch                  |
| `/about/`                         | Duo profile and booking/contact link                                          |
| `/music/`                         | Track list and configured listening links                                     |
| `/live/`                          | Upcoming DJ/media schedules, past appearances and cancellation notices        |
| `/news/`                          | Editorial announcements                                                       |
| `/contact/`                       | Booking and inquiries through the official Instagram DM account               |
| `/fanclub/`                       | Public photo scrapbook with accessible enlargement, membership status and FAQ |
| `/shop/`                          | Merchandise gallery and hosted purchase links (optional cart)                 |
| `/shop/success/`, `/shop/cancel/` | Cosmetic return pages                                                         |
| `/legal/`, `/privacy/`            | Seller and privacy information                                                |

`config/site.json` is the single public editorial configuration. It is bundled into the **static build**, so never put credentials or private member content in it. Rebuild the web image after changing it. `src/data/site.mjs` validates outgoing links and publishes only explicitly approved events. Artist pages work with the API offline; catalog requests begin on shop pages or when opening the bag. No extra process or container was added.

### Music, social links and booking

The supplied project context identifies four track titles. Titles alone do not imply a public release. Add an actual official HTTPS listening URL to a track's `url` when ready; until then it has no fake play button. Set `linkLabel` to the listening action; it is included in the accessible name of each arrow link. No embedded players or third-party scripts load automatically. `socials` contains the unit's official Instagram and the two member accounts. `bookingUrl` currently points to the unit's official `@gyaruinthemix` Instagram; `/contact/` explains how to send a DM and what booking details to include. No contact form or email address has been invented. Keep `socials` as objects with `label` and official HTTPS `url`, and verify ownership before changing these links. Empty optional music links remain hidden.

### Publish an appearance

`events` includes the supplied August and September 2026 appearances and the October 3 appearance cancellation. Add reviewed items using this structure, substituting actual values:

```json
{
  "published": false,
  "category": "live",
  "date": "2026-12-31",
  "title": "REPLACE_WITH_CONFIRMED_EVENT",
  "venue": "REPLACE_WITH_VENUE",
  "timeLabel": "REPLACE_WITH_VERIFIED_JST_TIME",
  "note": "",
  "url": "",
  "cancelled": false
}
```

This is a **disabled example**, not a claimed booking. Change `published` only after confirming the event, date, venue, ticket link and publication approval. Use `media` for TV/radio/press. `timeLabel` is explicitly editorial: for an overnight set, state both the event date and actual next-day date/time in Japanese. Keep cancellation notices visible with `cancelled: true`; the template suppresses their ticket link.

The homepage shows upcoming appearances only. `/live/` separates upcoming DJ/media appearances, cancellation notices and past appearances. Upcoming entries sort by date earliest first; past entries sort newest first. `src/data/events.mjs` supplies the shared classification used in the static build and in the browser. When JavaScript is enabled, `src/scripts/events.mjs` refreshes the existing rendered lists on page load, page return and tab reactivation, then schedules refreshes at intervals of up to one minute and around event-end/Japan-midnight boundaries. An older build can therefore move finished appearances into the archive without a server request or rebuild. With JavaScript disabled, grouping remains the build-time snapshot; publish a fresh image when that fallback needs updating. Changes to event content itself always require rebuilding/redeploying.

Use actual Japan-calendar `date` values. For precise timing, add timezone-aware `startAt` and `endAt` values, such as `2026-09-30T01:59:00+09:00` and `2026-09-30T02:29:00+09:00`. `startAt` must fall on `date` in Japan; when both timestamps are supplied, `endAt` must follow `startAt`. A non-cancelled appearance is classified as past from its exact `endAt`; the browser schedules a refresh across that boundary while the page remains open. Without `endAt`, it stays upcoming through its entire Japan calendar day, or through `endDate` (YYYY-MM-DD) when an overnight/multiday appearance has a known final date but no precise ending time. Do not infer precise timestamps from ambiguous overnight DJ labels.

The MBS broadcast is dated **September 30, 2026, 1:59–2:29 JST**, with exact `startAt`/`endAt` values. Its display also retains the broadcast-day notation「9月29日深夜25:59〜26:29」and its ABEMA episode link. It is archived from September 30 at 2:29 JST. Cancellation notices always remain separate, even after their date passes: the October 3 notice concerns this unit's appearance, not cancellation of an entire event, and has no ticket link. This scheduling behavior needs no backend process or database.

News accepts `category`, `title`, `text`, an optional `date`, and a local or HTTPS `url`. Text is escaped by Astro, not injected as HTML.

### Fan-club launch boundary

The delivered fan hub works now as a public photo and news destination. **It does not create accounts, save email addresses, charge membership fees or grant members-only access.** `fanClub.registrationOpen` defaults to `false`. No membership name, price, benefit or third-party provider has been invented.

When you choose your membership model and an existing external community/membership service:

1. Configure the actual HTTPS `fanClub.joinUrl` and a clear `joinLabel`.
2. Replace `membershipNote` with the true membership conditions; update the privacy and legal pages for that service.
3. Verify the destination, signup, consent, account recovery and cancellation flow on that service.
4. Set `registrationOpen: true`, build and review the fan page. An open registration flag without a URL fails the build.

The join action is an ordinary outgoing link; no provider widget, API key or user information is sent by this website. This keeps the VPS small. A self-hosted paid club is a separate implementation requiring a chosen pricing/benefit model, persistent membership records, authentication, authorization, subscription lifecycle webhooks, account recovery and cancellation. Never hide supposedly private content only with CSS or client-side JavaScript, and never reuse the one-time merchandise checkout as a subscription system.

Photos in `photos` are public, supplied images. Original uploads remain in `assets/originals`; only optimized derivatives are published. Do not put unapproved or members-only photos in this configuration. The photo viewer uses native modal focus handling, Escape and focus restoration. Registration remains pending until configured.

## Architecture

**Default:** existing HTTPS proxy → static nginx site → browser follows a public Payment Link → Stripe-hosted checkout. Stripe Dashboard is the order record; fulfillment is manual. Only nginx runs in the new application. No key, webhook, database or payment volume is required. The bouncer file uses the existing proxy network; no new public ports are bound.

**Optional API mode:**

- Existing HTTPS proxy → web container `:8080` → static files or `/api/*` → API `:3000` → Stripe.
- Browser receives a Stripe-hosted Checkout URL and navigates to it. No Stripe.js or publishable key is needed.
- Stripe sends signed webhooks to the same origin's `/api/stripe/webhook`.
- `GET /api/catalog` is the one additional route: it publishes verified JPY prices, availability, shipping and a catalog version. This avoids two independently maintained price lists. Static HTML displays no invented amount.
- `POST /api/checkout` accepts only product slugs, integer quantities and that version. Prices and shipping come exclusively from server-configured Stripe IDs. Unknown fields, duplicate products and stale catalogs are rejected. Maximum 5 per current product, 20 total, 10 distinct items; each product may set a lower cap.
- `GET /api/health` checks process/journal health without calling Stripe. Startup verifies the catalog when sales are enabled; catalog results are cached for 60 seconds. An unavailable Stripe catalog fails closed, never serves stale prices.
- A tiny append-only journal in one named volume suppresses repeat payment observations, including across container restarts. Stripe is the authoritative order and transaction record. **There is no automated fulfillment.**

## Directory structure

| Path                                                 | Purpose                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/pages`, `src/layouts`, `src/components`         | Static Astro pages and reusable product cards                              |
| `src/scripts`                                        | Cart, local storage and same-origin API calls                              |
| `src/styles/global.css`, `src/styles/artist.css`     | Responsive pink/black/chrome visual design                                 |
| `config/site.json`, `src/data/site.mjs`              | Public artist, music, news, schedule, fan-club and social content          |
| `config/products.json`                               | Product content, availability, quantity limits and environment-key mapping |
| `config/payment-links.json`, `src/data/checkout.mjs` | Public Payment Links mode, TEST/live gates and build validation            |
| `config/store.json`                                  | Seller, shipping, return and contact information to complete               |
| `assets/originals`                                   | Unmodified supplied logo/photos selected for this site                     |
| `scripts/images.mjs`                                 | Metadata-stripped WebP/AVIF derivatives; originals unchanged               |
| `api`                                                | Config validation, Stripe catalog, Checkout, webhooks and journal          |
| `tests`                                              | Offline tests; all Stripe network methods stubbed                          |
| `deploy`                                             | nginx configuration, security headers and Payment Links instructions       |
| `deploy/bouncer`                                     | Only deployment: existing bouncer stack, image updater and scheduler setup |
| `scripts/preflight.sh`, `scripts/smoke.mjs`          | Read-only VPS inspection and HTTPS checks                                  |
| `scripts/setup-secret.sh`                            | Hidden-input secret creation/rotation                                      |

## 1. Optional API: local development / TEST setup

Use Node 24 and npm. `npm ci` uses the committed lockfile. Never use live keys for development.

```bash
cp .env.example .env
chmod 600 .env
npm ci
npm test
npm run lint
CHECKOUT_MODE=api npm run build
```

The build needs no Stripe key or network access to Stripe. `npm run images` generates assets for development. Production serves `dist/`; it never runs Astro's development server.

In Stripe, select a **sandbox / test environment**. Create a store-specific **restricted** key (`rk_test_...`) using the minimal permissions in [SECURITY.md](SECURITY.md#stripe-dashboard-setup). Unrestricted `sk_...` keys are rejected. Enter it without putting it into command arguments, shell history or `.env`:

```bash
bash scripts/setup-secret.sh stripe_secret_key --local
```

Install the Stripe CLI using [Stripe's official instructions](https://docs.stripe.com/stripe-cli). In another terminal:

```bash
stripe login
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed --forward-to http://127.0.0.1:3000/api/stripe/webhook
```

Enter the listener's `whsec_...` secret using:

```bash
bash scripts/setup-secret.sh stripe_webhook_secret --local
npm run dev:api
```

Keep the listener and API running. In another terminal:

```bash
CHECKOUT_MODE=api npm run dev
```

Open `http://localhost:4321`. Keep this origin exactly aligned with `SITE_URL` in `.env`; changing localhost to 127.0.0.1 is a different origin. Astro proxies `/api` to the local API. Both default to loopback. The harmless `terminal.local` allowed hostname exists only for development preview compatibility.

Initially the gallery and empty cart work but products cannot be purchased. To exercise the cart and payment flow, configure TEST products and shipping below, set selected products to `available`, and set `SALES_ENABLED=true` and `STORE_DETAILS_REVIEWED=true` after reviewing the test storefront. Restart the API and dev server. The site displays a TEST-shop notice. Do not send this test store to customers as an active shop.

For offline UI development, `npm run test:ui-api` may replace `npm run dev:api`. It uses clearly synthetic prices, never contacts Stripe, and deliberately returns an error when proceeding to payment; it is excluded from production images. Do not run both API processes on port 3000.

`stripe trigger checkout.session.completed` can confirm delivery/signature handling, but its generic fixture lacks `metadata.store=gyaruinthemix` and is deliberately acknowledged without payment processing. A complete checkout created by this application is required to test the accepted-payment path. Unit tests cover delayed-payment event variants; v1 offers cards only.

### GitHub Actions testing and image publication

[CI](https://github.com/aliceinwire/gyaruinthemix/actions/workflows/ci.yml) runs on `main` pushes and pull requests; manual validation does not publish a release. It uses GitHub-hosted Ubuntu runners and Node 24. Actions are pinned to commit hashes; review pins when upgrading them.

- **Secret scanning:** checksum-pinned Gitleaks scans the fetched Git history, including removed credentials, and tests staged scans/commit hooks with synthetic fixtures. Output is redacted. Install the local hook using `npm run security:hooks` after the [scanner setup](SECURITY.md#secret-scanning-before-commits-and-in-ci).
- **Tests, lint and static build:** installs the lockfile with `npm ci`, checks lint/formatting and script syntax, runs the offline unit suite, then generates the Astro site and optimized images.
- **Key-free bouncer integration:** validates the default single web service without Stripe secret files, synthetic public links, assets/headers, API isolation and restart recovery.
- **Optional API bouncer integration:** builds API-mode images, validates the same deployment file, checks container hardening, routes/headers, closed checkout, signed/invalid webhook handling and duplicate-event persistence after restart.

The isolated runner tests compare the original bouncer definitions and exercise only the added website services. The proxy, companion, ZNC and Limnoria are not built or started by those tests. Test-only HTTP bindings belong to the disposable runner; the production file adds no host ports. `scripts/ci-smoke.mjs` is for that fixture; use `npm run smoke -- https://YOUR_REAL_DOMAIN` for target-host checks.

Only a trusted push to `main` in `aliceinwire/gyaruinthemix`, after the required checks succeed, can publish these GHCR packages:

- `ghcr.io/aliceinwire/gyaruinthemix-web`: Payment Links frontend
- `ghcr.io/aliceinwire/gyaruinthemix-web-api`: API-mode frontend
- `ghcr.io/aliceinwire/gyaruinthemix-api`: optional backend

Each uses `main` and `sha-<full commit hash>` tags with source/revision labels. Pull requests and manual validation do not publish images. Only the publishing job has package-write permission; it uses GitHub's built-in token. **No new GitHub/VPS/SSH secrets or Stripe credentials are needed.** The owner must make the packages publicly readable after the first trusted publish, then install and opt into the [VPS image updater](deploy/bouncer/README.md). Do not put Stripe credentials into CI. API fixtures keep sales disabled and never contact Stripe; synthetic public Payment Links are never opened by the checks.

Branch protection, GHCR visibility and the VPS scheduler are owner configuration, not automatically activated by editing this repository. Require the validation jobs shown in the current workflow before merging. See `VALIDATION.md` and the exact commit's Actions result for what has actually passed. A green CI run does not prove a real Stripe TEST checkout, public HTTPS or continued operation of existing VPS services.

## 2. Optional API: Products, prices, shipping and seller content

### Stripe prices

1. In the correct Stripe test environment, create each actual merchandise product in the Product catalog.
2. Add a **one-time, fixed, per-unit JPY price**, with **tax included**. Use your actual price; this repository supplies none. Do not create a recurring, tiered, custom-amount or multi-currency price for this integration.
3. Copy the Price ID (`price_...`, not `prod_...`) into `.env`, e.g. `STRIPE_PRICE_STICKER`, `STRIPE_PRICE_TOWEL`, `STRIPE_PRICE_KEYCHAIN`.
4. The API retrieves each Price and expanded Product. It requires both to be active, JPY, the correct test/live mode, integer amount and inclusive tax behavior. Both the browser display and billing refer to the same Price.
5. Create a fixed **JPY shipping rate** in Stripe using your actual postage policy, with inclusive tax behavior, and put its `shr_...` ID in `STRIPE_SHIPPING_RATE_JP`. An explicitly configured zero-cost rate is supported if you choose free shipping. An empty value never silently means free shipping.
6. Set products you are ready to offer to `"availability": "available"` in `config/products.json`. Other supported values: `coming_soon`, `sold_out`.

Shipping addresses are collected on Stripe; `allowed_countries` is hardcoded to `['JP']`. There is one configured domestic rate per order. No worldwide shipping, automatic tax, coupons, adaptive currency conversion or regional/weight-based rate logic is enabled. Subtotal and shipping are shown separately in the cart; Stripe displays the final total. Enable Stripe's customer receipt emails in its Dashboard. This code does not send emails itself.

### Site content before selling

Complete `config/store.json` with the actual seller, business contact, address/phone disclosure, dispatch estimate, shipping costs, payment timing, returns and privacy contact. Review the legal/privacy pages for your actual operations and applicable requirements. No names, home addresses, return policy or shipping promise have been invented. The startup flag `STORE_DETAILS_REVIEWED=true` is an explicit operator acknowledgement; live sales also reject empty store fields.

The three current card images are clearly labeled **design references, not product photographs**. Before making a product available, upload its actual image and correct `image`, `imageAlt`, `imageLabel`, description, specifications and any size/variant details. Remove/update the launch-preparation text in the homepage/shop when going on sale. The checkout and catalog logic requires no code copied per product.

To add a product, add a unique slug and content record, choose its `priceEnv` name and quantity cap, add that environment mapping to the environment examples and the API environment section in `deploy/bouncer/docker-compose.yml`, configure its Stripe Price, rebuild **both** images, and test it. A T-shirt's sizes should be separate explicit SKU slugs/Price mappings; don't sell an ambiguous size. The current catalog has no inventory reservation system: do not promise scarce stock or unlimited stock tracking. Availability is an operator-controlled switch. Use a transactional inventory system before selling strict limited quantities automatically.

Prices are fetched, not hardcoded. To change a price, create a new Stripe Price, update the relevant ID and recreate only the API. A browser with an old catalog gets HTTP 409 and must review it again. An already-created Checkout Session can retain its previous price until it expires; expire outstanding sessions in Stripe when needed. In-flight orders still require handling.

## 3. Optional API: Secrets on the VPS

Read [SECURITY.md](SECURITY.md) for restricted-key permissions, Stripe access policies, Dashboard passkeys, commit/CI scanning and rotation/incident procedures. Existing unrestricted-key deployments must migrate before upgrading. The default Payment Links mode still needs no keys.

`.env` contains **non-secret configuration only**. Secret source files are ignored by Git, excluded from image build contexts and mounted only into the API as:

- `/run/secrets/stripe_secret_key`
- `/run/secrets/stripe_webhook_secret`

From `~/bouncer/gyaruinthemix`, create them with hidden input:

```bash
bash scripts/setup-secret.sh stripe_secret_key --docker
bash scripts/setup-secret.sh stripe_webhook_secret --docker
```

The script uses `umask 077`, a 0700 parent, numeric group **10001** and file mode **0440**. It may use `sudo chgrp` to grant the API's GID read access. Never use `chmod 644` or commit these files. The example placeholders `rk_test_...` and `whsec_...` are not usable credentials.

Docker Compose implements file-backed secrets as read-only bind mounts; its `uid/gid/mode` secret fields do **not** remap host-file ownership. That is why the script sets the source file permissions. Rootless Docker/user-namespace remapping needs corresponding mapped host IDs; verify readability with your actual deployment before starting sales. Do not disable user namespaces or widen file access to work around it.

Secrets are not automatically encrypted on the VPS. Protect the host and encrypted backups. Rotate a secret with the same script, then, from `~/bouncer`, run `docker compose up -d --no-deps --no-build --pull never --force-recreate --wait gyaruinthemix-api`; an atomic host-file replacement does not update an existing bind mount's inode. Do not paste keys into chat, issue trackers, build arguments, environment logs or GitHub Actions.

## 4. Inspect the VPS first (no mutations)

Follow the [bouncer preflight and deployment steps](deploy/bouncer/README.md). ZNC, Limnoria, the proxy Dockerfile and the 10G upload setting remain unchanged. The supplied file does not establish running image versions, network membership or free memory. After preparing `~/bouncer/.env`, run from the checkout on the target VPS:

```bash
cd ~/bouncer/gyaruinthemix
bash scripts/preflight.sh ~/bouncer
```

The optional argument is the **bouncer directory**, not a proxy name. Inspect Docker context, existing container IDs/start times, Compose ownership, networks, listeners and memory before installation. Never operate on an unintended Docker daemon. Review resolved configuration with `docker compose config` from `~/bouncer`; retain the existing project identity. Record working ZNC and Limnoria connections so they can be checked again after the website changes.

### Resource plan to review before starting

| Resource            | Added website resources                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| Compose services    | `gyaruinthemix-web`; optional `gyaruinthemix-api`                       |
| Images              | Published GHCR frontend and, for API mode, backend                      |
| Network             | Website network `gyaruinthemix`; API stays off the shared proxy network |
| Existing network    | Web joins the existing `proxy-tier` network (`nginx-proxy`)             |
| Volume              | `gyaruinthemix_webhook_state`, optional API observation journal only    |
| Host ports          | None added by either website service                                    |
| Internal ports      | nginx 8080, API 3000                                                    |
| Files               | Website source, bouncer `.env`, opt-in updater; API-only secret files   |
| Unrelated workloads | Website commands never target them or delete their networks/volumes     |

Network/volume names are Compose keys; Docker resource names depend on the **existing bouncer project**. Discover them through Compose instead of assuming fixed container or volume names.

The 64 MiB nginx / 192 MiB Node memory limits are **provisional caps**, not measured idle usage. Node heap cap is 112 MiB, leaving headroom for buffers/native allocations. Inspect `free -m` and `docker stats` before accepting these caps; preserve host, proxy and IRC headroom. The VPS pulls CI-built images; do not build Astro on a loaded 1 GB server. Build-time memory is not constrained by service `mem_limit`. No swap/firewall/host configuration changes are performed by this project.

## 5. Domain, proxy and TLS

The public canonical domain is **https://gyaruinthemix.com**. `src/data/urls.mjs` drives Astro's site URL, canonical/Open Graph metadata, `robots.txt` and the sitemap. Its explicit public-page list excludes hidden sandbox pages, checkout returns and errors, which remain `noindex`. Update that list when adding an indexable page. These URLs are built into both frontend image modes; local development and the API's runtime `SITE_URL` remain separate.

To move the existing `gyaruinthemix.alicef.me` deployment, use the [staged domain migration guide](deploy/bouncer/DOMAIN-MIGRATION.md). It covers DNS/TLS, optional routing aliases, origin-scoped carts, pending sandbox sessions and the existing Stripe webhook destination. Merging a code change does not perform that migration or install an old-domain redirect.

For a new installation, set `STORE_DOMAIN=gyaruinthemix.com` and `LETSENCRYPT_EMAIL` in `~/bouncer/.env`, using a new hostname rather than `znc.alicef.me`. The bouncer file derives the API's `SITE_URL=https://STORE_DOMAIN` and uses the stack's existing `proxy-tier`/`nginx-proxy` network. Update DNS using the existing provider. Preserve Cloudflare if present; it is not a requirement. If using it, require strict HTTPS to the existing origin, bypass caching/challenges for `/api/*`, and do not log/cache Checkout responses or webhook payloads.

The existing proxy and certificate companion use `VIRTUAL_HOST`, `VIRTUAL_PORT=8080`, `LETSENCRYPT_HOST` and `LETSENCRYPT_EMAIL`. The website gains no public port, Docker socket or certificate mount. The companion manages the new certificate and the proxy's established routing. Inspect their actual health before deployment; do not restart or recreate the shared proxy to troubleshoot the website blindly. If the supplied stack does not match the target, stop and review its configuration before proceeding.

The public HTTP hostname must redirect to HTTPS at the existing edge. Forward every `/api/*` request to the store; preserve body bytes and `Stripe-Signature`. Do not apply browser login/CAPTCHA challenges to the webhook route. No CORS configuration is needed because the website and API share one origin.

Default rate limiting trusts no client forwarding headers: nginx overwrites `X-Store-Client-IP` with its socket peer, and Fastify ignores `X-Forwarded-For`. Behind a shared proxy, the default checkout budget of 10/minute may therefore be shared by all customers. For per-customer limiting, after inspection configure nginx `set_real_ip_from` with **only the actual trusted proxy address/CIDR**, and `real_ip_header X-Real-IP`, with the outer proxy overwriting that header with a validated client address. Rebuild web and prove spoofed headers cannot change rate-limit identity. Never trust all private networks or arbitrary forwarded headers. There is no IP-based webhook rate limit that could reject legitimate Stripe retry bursts; body size/timeouts and edge protections bound resource use.

## 6. Optional API: first TEST-mode deployment

Production images contain source, locked `npm ci` dependencies and prebuilt static files. Review Docker base-image and dependency updates deliberately; retain image digests or full-commit release tags for rollback. CI publishes tested application images; the VPS does not build them.

In `~/bouncer/.env`, set `CHECKOUT_MODE=api`, `COMPOSE_PROFILES=checkout-api`, `GYARUINTHEMIX_WEB_IMAGE=ghcr.io/aliceinwire/gyaruinthemix-web-api:main` and `GYARUINTHEMIX_API_IMAGE=ghcr.io/aliceinwire/gyaruinthemix-api:main`. For a pinned release, use matching `sha-<full commit hash>` tags for both images. Confirm package access and follow the [bouncer guide](deploy/bouncer/README.md) before enabling the optional updater.

After preflight, configure a restricted TEST key, TEST Price IDs, TEST shipping rate, test webhook endpoint and correct HTTPS domain. Use the endpoint's **own** signing secret. The local Stripe CLI secret and a Dashboard webhook secret are different. Register a snapshot webhook destination for exactly:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

Destination: `https://gyaruinthemix.com/api/stripe/webhook` after completing the domain cutover. Match the event API version to the pinned SDK's API version; obtain it without credentials using `node --input-type=module -e 'import Stripe from "stripe"; console.log(Stripe.API_VERSION)'` on the development machine. When updating Stripe SDK/API versions, rerun tests and test delivery before release.

After configuring API mode, review the complete shared stack without starting it:

```bash
cd ~/bouncer
docker compose config --quiet
docker compose config --services
```

The resolved stack must retain the original services and include the two website services, with API-only secrets, the correct website hostname, expected images/limits and **no new website host port bindings**. Keep sales disabled until configuration and TEST review are complete. `.env` must contain no secret values.

Only after review, pull and start the two website services:

```bash
cd ~/bouncer
docker compose pull gyaruinthemix-web gyaruinthemix-api
docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 90 gyaruinthemix-api gyaruinthemix-web
docker compose ps gyaruinthemix-web gyaruinthemix-api
docker compose logs --tail=50 gyaruinthemix-api
docker compose stats --no-stream gyaruinthemix-web gyaruinthemix-api
```

No command should build/recreate the proxy, companion, ZNC or Limnoria. Do not use unscoped stack operations, `--remove-orphans`, `down -v`, `docker system prune`, `docker volume prune` or other blanket cleanup. Confirm mode/image alignment and complete the smoke procedure before enabling scheduled updates.

## 7. Optional API: Required production smoke procedure (TEST mode)

All Docker commands in the remaining operating procedures run from `~/bouncer`. Pause the optional image-update scheduler (cron or systemd) before manual maintenance or mode changes, then resume it only after review, as described in the [bouncer guide](deploy/bouncer/README.md).

Run `npm run smoke -- https://YOUR_REAL_DOMAIN` from the build/development machine. It checks all pages, linked assets, security headers, health, catalog TEST mode and invalid-webhook rejection. It makes no Checkout Session and no payment.

Then manually prove the remaining flow:

1. View homepage, shop and about on iPhone-sized and desktop screens; check photo loading, focus, cart quantity/remove/subtotal and refresh persistence. Prices must match Stripe TEST Prices and the real configured shipping policy.
2. Add a product and proceed. Confirm the page is Stripe-hosted and explicitly in test mode, JPY, Japan-only shipping, correct items, quantities, shipping and total. Use Stripe's [documented test payment details](https://docs.stripe.com/testing), never a real card.
3. Use Stripe's Back control first: it returns to `/shop/cancel/` with cart intact. Start again, complete a **TEST** payment and confirm the success return. Open `/shop/success/` directly too: it must not change any payment or trigger fulfillment. The cart is deliberately not automatically cleared by this cosmetic page.
4. In Stripe TEST Dashboard verify the actual paid session and successful webhook delivery. Check one structured `payment_received` observation in API logs. Do not rely on the success page.
5. Resend the same webhook in Stripe; it must return 200 without another payment observation. Resend after restarting only the store API (`docker compose restart gyaruinthemix-api`), then repeat. Check the journal volume persists.
6. Test `/api/stripe/webhook` with an invalid signature (the smoke script does this); expect 400. Delayed events are covered by unit tests; when enabling delayed methods later, additionally test their real lifecycle with Stripe fixtures tailored to this store.
7. `docker compose restart gyaruinthemix-web gyaruinthemix-api`; verify health and new requests recover. nginx re-resolves the API service name after container replacement. `restart: unless-stopped` applies to engine/process restarts, not just an unhealthy healthcheck; Docker does not auto-restart a still-running unhealthy process.
8. Confirm current Docker stats fit the VPS. Recheck the **same existing ZNC container ID/start time** and actual working IRC connection. This task must not have restarted it or changed its ports/network/configuration. Confirm other original workloads remain healthy.

Record the date, image tags and outcomes. **Do not proceed to live until every applicable check passes.** No real-money test is required or authorized by this procedure.

## 8. Optional API: Deliberate LIVE transition (future, gated)

This section documents the eventual switch; it does not imply that the TEST flow passed or authorize a real purchase. After the completed TEST sign-off:

1. Finish Stripe account activation, real seller/returns/privacy details, real product images/specifications and fulfillment arrangements. Validate every amount and shipment term.
2. Recreate products/prices/shipping in the LIVE account; test IDs are not live IDs. Create a separate LIVE webhook destination and use its signing secret.
3. Set `SALES_ENABLED=false` and recreate only API during configuration. Keep test and live keys in separately protected locations if retaining both; only the selected files are mounted. Never switch modes automatically.
4. Create a restricted LIVE key with the verified permissions and an access policy; rotate the mounted files using the hidden-input script. Update `~/bouncer/.env` with LIVE Price/shipping IDs, `STRIPE_MODE=live`, `STORE_DETAILS_REVIEWED=true`, and `LIVE_MODE_ACK=I_HAVE_COMPLETED_TEST_CHECKOUT`; verify the HTTPS `SITE_URL` derived from `STORE_DOMAIN`.
5. With all content reviewed, set `SALES_ENABLED=true`; validate `docker compose config --quiet` and run `docker compose up -d --no-deps --no-build --pull never --force-recreate --wait gyaruinthemix-api`. Rebuild/redeploy web too if content changed. Verify live catalog amounts, mode and health. Do not perform a real-money transaction unless explicitly authorized.

The app rejects a key prefix/mode mismatch, missing shipping, bad Price configuration and missing live acknowledgement. Test/live webhook modes are checked too. Configure monitoring via your existing infrastructure; no new monitoring service is installed.

## 9. Optional API: Updates, rollback and backups

Normal image updates use the opt-in [bouncer updater](deploy/bouncer/README.md): it pulls published images, targets only the configured website services and waits for health. Failed health triggers a rollback attempt to the previous images. Failed release IDs are retained so the next scheduled check does not loop on the same release; use `--retry` only after diagnosing the failure. Check its logs and the resulting service health, including after a rollback attempt.

Before manual configuration work or rollback, pause the scheduler using the bouncer guide. Save the previous full-commit image references and non-secret configuration. To select a known-good release, set `GYARUINTHEMIX_WEB_IMAGE` and `GYARUINTHEMIX_API_IMAGE` to the matching `sha-<full commit hash>` tags, using the API-mode frontend package. Pull those references, review `docker compose config --quiet`, and recreate only `gyaruinthemix-api` and `gyaruinthemix-web` with `--no-deps --no-build --pull never --wait`. Keep the scheduler paused while investigating; pinned release references intentionally stop the updater. Restore matching `main` references and resume scheduling only after resolving the failure.

Source/configuration changes are not installed by the updater: manually review and copy changes to Compose, updater, cron/systemd configuration and environment settings, and release images after public JSON changes. Restore matching public content/Price mappings only after checking current Stripe settings. Preserve the journal and current valid secrets; never roll back to a revoked or leaked key. There are no database migrations. Do not delete the journal to fix deployment errors.

Back up source in your own Git repository, bouncer `.env`, the journal and secrets separately. Secrets/backups must be encrypted with tightly controlled access. Keep supplied originals in the source archive; generated derivatives are reproducible. Stripe remains the authoritative transaction record and customer/address store. An observation log is not an order ledger.

A consistent journal snapshot briefly stops **only this API**, with Stripe retries expected. Pause the scheduler and confirm no update is still running first. Run this subshell from `~/bouncer` while API mode is enabled:

```bash
(
  set -eu
  umask 077
  mkdir -p backups
  chmod 700 backups
  # Keep backups/ out of any deployment-local Git repository.
  api_id=$(docker compose ps -q gyaruinthemix-api)
  test -n "$api_id"
  backup="backups/webhook-events-$(date -u +%Y%m%dT%H%M%SZ).ndjson"
  trap 'docker compose start gyaruinthemix-api' EXIT
  trap 'exit 1' HUP INT TERM
  docker compose stop gyaruinthemix-api
  docker cp "$api_id:/app/state/webhook-events.ndjson" "$backup"
  chmod 600 "$backup"
)
docker compose ps gyaruinthemix-api
```

The exit trap attempts to restart API even if the copy fails; verify health and act on any restart failure before resuming scheduled updates. An initialized empty journal is a valid backup. To restore, stop only `gyaruinthemix-api`, copy the validated snapshot back into its journal volume, preserve owner 10001:10001 and mode 0600, then start it and verify health. Use recent data: rolling the journal backward can allow previously observed events to appear again. Never use this manual copy mechanism after introducing transactional fulfillment.

The journal fails closed at 100,000 unique observations / 32 MiB input to bound memory and disk use. No automatic expiry weakens duplicate protection. Monitor size and health; migrate deliberately before capacity. A torn final write causes startup failure for operator recovery: preserve the file, reconcile affected Stripe sessions and restore/repair only after review. Do not simply truncate it and assume no event was observed.

## 10. Security and operating assumptions

Default Payment Links mode serves static files with the same security headers/container hardening, has no API routes or app secrets, and keeps payment processing in Stripe. The following API controls apply only when the optional backend is enabled.

- Two non-root containers, read-only roots, dropped capabilities, `no-new-privileges`, bounded tmpfs/PIDs/CPU/memory, no Docker socket, host network, privileged mode or repository bind mount. Only the API can read secrets and its journal volume.
- Port 8080 is internal HTTP behind existing HTTPS termination. HSTS is one year for this hostname only, no automatic preload/includeSubDomains. Host ports 80/443 are untouched.
- CSP permits local assets/scripts and navigation to Stripe. No inline scripts/styles, external fonts or analytics are required in production. Stripe redirection does not require iframe/Stripe.js permissions. Development's injected tooling is not representative of production CSP.
- Strict body schemas, 8 KiB Checkout body, 256 KiB raw webhook body, network timeouts, origin validation and Checkout rate limiting. Origin checking limits browser abuse, not malicious non-browser clients; rate limits are defense in depth.
- Checkout retries reuse a browser attempt UUID and a cart/catalog-derived Stripe idempotency key. Stable request parameters avoid accidental changes on retries. This is not account-level order deduplication: separate devices/tabs/attempts can intentionally create separate purchases. Checkout Session URLs are returned only in no-store responses, never written to application logs or local storage.
- Webhook signature validation uses the **unparsed Buffer** and Stripe's timestamp verification. Unsupported events and other-store sessions are acknowledged without processing. `completed` plus `unpaid` records only pending; paid information is required for a received-payment observation. Late failed/pending notifications cannot regress a recorded paid state.
- The journal serializes concurrent claims, fsyncs before emitting a safe log, and deduplicates both event ID and session/outcome. It is single-instance only: **do not scale API**. A crash after journal commit but before log emission can lose a log line; Stripe still retains the order. This is an explicit log-only tradeoff, not an exactly-once fulfillment guarantee.
- Before automatic fulfillment, add transactional storage (e.g. SQLite with durable unique constraints for a single VPS, or an appropriate external database), an order state machine, verified session retrieval/line items, transactional outbox/retries, per-session fulfillment keys, inventory reservations if needed, reconciliation and access-controlled PII retention. Never bolt shipment/email side effects onto the current log callback.
- Mark manual fulfillment in Stripe Dashboard using an agreed per-session order workflow; never fulfill twice from log lines. Browser success URLs never authorize shipping.
- Restricted `rk_...` keys are required; production rejects unsafe secret-file permissions. Stripe permissions and access policies still require Dashboard configuration; see `SECURITY.md`.
- File secrets protect against accidental frontend/build exposure; a compromised VPS, Docker administrator or API process can still access its required secrets. Restrict host access, patch maintained dependencies/images and use appropriate Stripe account permissions.
- nginx logs status/method/duration without IP/query/body; API logs safe event IDs/types/session IDs and generic failures, never entire Stripe objects, keys, addresses or error stacks. IDs are still operational data: retain logs only as needed. Docker logs rotate at 3 × 5 MiB per service.

## 11. Troubleshooting

For default-mode issues, see [Payment Links troubleshooting](deploy/PAYMENT-LINKS.md#troubleshooting). The table below is for optional API mode.

| Symptom                                  | Check / resolution                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API startup fails                        | Secret format/readability, key mode, HTTPS origin, live acknowledgement, Price/shipping validation, store details, journal permission/corruption/capacity. Generic logs deliberately omit sensitive paths/messages. |
| Secret permission denied                 | Check `stat -c '%a %u %g %n' secrets/stripe_secret_key secrets/stripe_webhook_secret`; rootful expected 440 and group 10001. Account for userns mappings. Do not print file contents.                               |
| Web 502 or API unhealthy                 | `docker compose ps gyaruinthemix-web gyaruinthemix-api`, safe API logs, resource pressure and journal health. Confirm private service DNS and proxy network. No API host port is required.                          |
| Webhook 400                              | Correct endpoint-specific secret and mode, unmodified raw body, forwarding headers, clock synchronization, no CDN challenge/HTML rewrite. Do not log payloads to debug.                                             |
| Generic Stripe fixture ignored           | Store metadata filter; complete a Checkout Session through the application.                                                                                                                                         |
| Product disabled                         | Catalog availability, sales flag, active JPY inclusive Price, correctly mapped Price ID and shipping rate.                                                                                                          |
| 403 Checkout                             | Browser origin must exactly equal `SITE_URL`; use the configured HTTPS hostname.                                                                                                                                    |
| 409 Checkout                             | Catalog changed; updated prices are shown, review before retry.                                                                                                                                                     |
| 429 for several shoppers                 | Shared proxy IP budget; configure narrowly trusted real-IP handling after inspecting the proxy.                                                                                                                     |
| Returning from Stripe retains cart       | Intentional; success URL is not evidence of payment. Check Stripe before starting another purchase.                                                                                                                 |
| Port conflict                            | Neither website service publishes host ports. Check the existing proxy and resolved configuration; never stop an unrelated listener.                                                                                |
| 1 GB VPS runs out of memory during build | Pull the published GHCR images; do not build on the VPS. Do not squeeze the Node runtime cap until requests become unreliable.                                                                                      |
| Need to pause orders                     | Set sales false and recreate only API. Existing Checkout Sessions remain payable until expired in Stripe; handle or expire them deliberately.                                                                       |

## Official references

Implementation references: [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create), [webhook raw-body signature verification](https://docs.stripe.com/webhooks/signature), [fulfillment guidance](https://docs.stripe.com/checkout/fulfillment), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [Compose services and file-secret ownership limitations](https://docs.docker.com/reference/compose-file/services/#secrets).
