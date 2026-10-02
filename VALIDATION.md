# Validation scope and release evidence

`deploy/bouncer` is the only deployment. The default is `payment_links`: one static nginx website service, no Stripe credentials, no enabled API profile, no webhook listener and no cart JavaScript on the rendered site. Optional API mode selects the API frontend image and `checkout-api` profile. Products remain unavailable and sales disabled until reviewed configuration is deliberately supplied.

A list of checks is not a claim that a release passed them. Use the [CI workflow](https://github.com/aliceinwire/gyaruinthemix/actions/workflows/ci.yml) result for the **exact release commit**, plus recorded target-host smoke results. Historical test counts, old dependency audits and earlier pipeline runs do not verify the current deployment or release.

## Checks performed during this change

- Local ESLint/Prettier checks passed against the updated source.
- All 15 offline Python deployment tests passed, including shared-service byte preservation, scoped image activation, revision/source/mode guards, health rollback, interrupted recovery, rejected-release retries and overlap prevention.
- Shell syntax checks, systemd unit verification and `git diff --check` passed.
- No Docker daemon is available in the editing environment. Actual Compose builds/startup/restart and registry publication must be verified in the exact-commit GitHub Actions run. No host scheduler, public HTTPS or live VPS operation was tested here.

## Repository and CI checks

The current workflow is intended to gate release publication on:

- Locked dependency installation, ESLint/Prettier, script syntax, offline unit tests and an Astro production build with optimized assets.
- Checksum-pinned Gitleaks detection/redaction regression tests and a scan of the complete fetched Git history. No real credentials are used in fixtures.
- Default bouncer website startup without any Stripe secret files or an enabled API profile; synthetic Payment Links, assets, security headers, health, API 404 behavior and restart recovery.
- Optional API bouncer startup, container hardening, private API routing, closed checkout, valid/invalid signed webhook handling and duplicate-observation persistence across restart.
- Preservation of the supplied proxy, certificate companion, ZNC and Limnoria definitions. Isolated CI starts only the website services; it never builds or starts those original workloads.
- Updater safety and release selection checks. Offline mocks can verify command scope and failure handling; they do not establish live registry, Docker or systemd behavior on the VPS.

API unit coverage includes strict request types, duplicate cart lines, origin checks, stale catalogs, Stripe retry idempotency, currency/tax/mode checks, restricted keys, secret-file protections, setup-script failure safety, concurrent webhook delivery, journal state transitions, restart persistence and journal failure behavior. Stripe network methods are stubbed; these tests do not validate the owner's Stripe permissions or account settings.

Builds validate public content and safe outgoing URLs; the key-free shop cannot authenticate to Stripe to verify link ownership, price/shipping configuration or active status. `configurationReviewed` records a human review, not automated Stripe validation.

## Publication and updater boundary

Only a trusted `main` push in `aliceinwire/gyaruinthemix` may publish after the workflow's required checks succeed. Pull requests and manual validation do not publish. The packages are:

- `ghcr.io/aliceinwire/gyaruinthemix-web` for Payment Links
- `ghcr.io/aliceinwire/gyaruinthemix-web-api` for API-mode web
- `ghcr.io/aliceinwire/gyaruinthemix-api` for the optional API

Releases have `main` and `sha-<full commit hash>` tags and source/revision labels. Record resolved image digests as release evidence; version tags alone are not immutable. The publishing job uses GitHub's built-in token, with no new SSH/deploy secrets. Making the packages public after the first trusted publish is an owner step.

The VPS updater is an opt-in Python 3 script run by a cron job or systemd user timer every five minutes. It pulls without builds, recreates only the configured website services with `--no-deps --no-build --pull never --wait`, and attempts rollback on failed health. It persists failed release IDs and requires an explicit `--retry` to reattempt them. Its health check does not prove checkout correctness or image safety. The updater never installs configuration, Compose, updater or scheduler changes; those remain manual.

The source changes do not mean images have been published, package visibility changed, the scheduler installed/enabled or a VPS deployment completed. Record those as separate operations only after verifying them.

## Target-host and Stripe checks still required

Follow [bouncer installation and operations](deploy/bouncer/README.md), then the applicable [Payment Links TEST procedure](deploy/PAYMENT-LINKS.md#test-smoke-procedure) or [API TEST procedure](README.md#7-optional-api-required-production-smoke-procedure-test-mode).

- Inspect the actual Docker context, Compose project identity, existing listeners/network, image architecture, proxy health and free memory. The configuration does not prove that the target matches it.
- Verify public DNS/TLS, HTTP-to-HTTPS redirect, served headers, artist/shop pages, optimized assets, mobile/keyboard behavior and health endpoints.
- Record original ZNC/Limnoria container IDs/start times and working connections before and after website operations. Isolated CI cannot prove those services stayed healthy on the real VPS.
- Prove anonymous GHCR pulls after package visibility setup, the scheduler's activation/persistence, a successful image update and its logs. Test controlled failure/rollback safely before relying on unattended deployment. Verify rollback failures are visible and know how to pause/retry.
- In API mode, verify target-host secret permissions/user-namespace mappings, restricted-key permissions, outbound access policy, webhook destination/signing secret and journal ownership/persistence. Keep API single-instance.
- Complete an actual Stripe **TEST** hosted checkout in the owner's account, including correct items, prices, tax, Japan-only delivery, quantities and shipping total. Verify the paid transaction in Stripe. API mode additionally needs real signed webhook delivery/retry. No real-money test is implied or authorized.
- Confirm cancellation/return behavior and that visiting a success page directly creates no payment or shipment. The success page is not payment evidence.
- Exercise actual desktop/mobile browsers; a responsive Chromium frame is not evidence of physical iPhone/Safari coverage. The optional browser-native bag tool is nonessential and needs its own supported-browser test.

No VPS services or Stripe/Dashboard settings were configured by this source work. No actual Stripe TEST or LIVE payment has been claimed. Membership registration stays disabled pending a real provider/model and approved terms; the public fan hub does not implement authentication or paid entitlements.

## Resource and configuration assumptions

| Website service                | Internal port | Added host ports | Provisional memory cap | Writable state                      |
| ------------------------------ | ------------- | ---------------- | ---------------------- | ----------------------------------- |
| `gyaruinthemix-web`            | 8080          | None             | 64 MiB                 | 16 MiB tmpfs                        |
| `gyaruinthemix-api` (optional) | 3000          | None             | 192 MiB                | 8 MiB tmpfs and observation journal |

Only web joins the existing `proxy-tier` network (`nginx-proxy`). The website network key is `gyaruinthemix`; its journal volume key is `gyaruinthemix_webhook_state`. Actual Docker names depend on the existing bouncer project. The API has no host listener or proxy-network membership. The existing shared proxy's ports are unchanged. Limits are caps, not measured idle usage; do not build the application on the constrained VPS.

Before selling, supply real domain/DNS and seller/contact/shipping/returns/privacy details, actual product specifications/images/availability, and matching Stripe TEST then LIVE configuration. Official listening/social/booking links and membership enrollment remain editorial owner choices. Never invent prices, bookings, releases or membership benefits. Editorial content changes when a new image is built and deployed. Appearance groups are initially rendered at build time and refreshed in the browser using their explicit timezone-aware ending times; the updater does not rebuild content on a clock.

## Fulfillment and recovery boundary

Stripe is the authoritative order record. The optional API journal fsyncs event/session observation keys before a safe structured log, preventing duplicate observations across normal retries and restarts. A crash after journal commit but before log emission can lose the log line. There is no automated shipping/email fulfillment or exactly-once external-side-effect guarantee. Reconcile orders in Stripe, not browser success pages or logs.

Preserve the journal through updates and rollback; back it up with only the API paused and verify restart afterward. The journal is bounded, single-instance state and fails closed on corruption/capacity problems. Do not delete/truncate it to make a deployment pass. Transactional order storage, a state machine/outbox and reconciliation are required before automated fulfillment. Preserve current valid secrets; never restore revoked/leaked credentials during rollback.
