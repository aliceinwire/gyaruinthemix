# Offline bilingual browser checks

This isolated package does not change application dependencies. Install the exact Playwright version and its Chromium browser, build the desired mode, then run from the repository root:

```sh
npm install --prefix tests/browser --ignore-scripts
npx --prefix tests/browser playwright install --with-deps chromium
CHECKOUT_MODE=payment_links npm run build
CHECKOUT_MODE=payment_links node tests/browser/check.mjs
# Repeat with CHECKOUT_MODE=api for the optional cart build.
```

The runner starts and stops a static-only server on `127.0.0.1:4331` for the current `dist`. The port must be free. It checks all English routes and representative Japanese routes at 320, 375, 768, 960, and 1440 pixels; verifies metadata, internal links, noindex, mobile menus, overflow, both language directions with query/hash preservation, gallery dialog keyboard/focus/repeated dismissal, lazy music-player creation/removal, and offline cart/error behavior.

All API requests are mocked. YouTube frames use a local HTML response and all other external requests are blocked and fail the test. No Stripe session or payment is created. Mock prices are fixture data only. The application’s separate unit tests cover payment protocol details and server-side return/locale handling.

Screenshots and `report.json` are written to `artifacts/browser/<mode>/`. CI must retain this directory even on failure. Screenshots require human visual review; passing automated checks is not a claim of pixel-perfect design review. Local execution may be blocked in restricted environments where Chromium cannot create sockets; CI is the supported execution path in that case.
