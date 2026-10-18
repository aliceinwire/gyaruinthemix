# Shared inventory and paid fan club (draft, sandbox first)

This implementation is **not deployed** and does not enable payments. Existing
Payment Links do not use the shared inventory ledger. Shared stock and fan-club
subscriptions require the API frontend build (`CHECKOUT_MODE=api`) and the
`checkout-api` profile in the existing `deploy/bouncer` deployment. Never enable
both external Payment Links and API sales for the same limited stock.

## Durable shared stock

Node 24's built-in SQLite stores reservations in `STATE_DIR/commerce.sqlite`.
Keep the existing `gyaruinthemix_webhook_state` volume, including WAL files. Use
local disk, not NFS. Back up using SQLite's backup API or stop the API before
copying the database and sidecars together. Never delete/reinitialize this volume
to fix stock or roll back a deployment. Keep one API replica (the observation
journal is single-process). Other services in the bouncer Compose file are unchanged.

`config/inventory.json` is a one-time bootstrap manifest, isolated by `test:public`,
`test:sandbox` and `live:public`. The only sample count is **10 sandbox keychains**.
It is not an assertion of live stock. All other counts are unset and fail closed.
Configure actual initial quantities before first startup. Changing the bootstrap
manifest after initialization fails startup, rather than silently resetting sales.

A checkout atomically reserves all requested units before contacting Stripe. Two
orders of three from ten leave four available. Concurrent last-unit requests
cannot both reserve it. Stripe quantities are fixed. Stock availability is returned
in the catalog without changing its price/catalog version. Final checkout always
rechecks stock, regardless of browser state.

Reservations are held through ambiguous network errors, process crashes, and
pending payments. Returning to the cancel page never releases inventory. Verified
Stripe Checkout expiration releases unpaid units; confirmed payment commits the
reservation exactly once. A minute-by-minute reconciliation retrieves current
Stripe state; webhook repeats do the same. Cards only are enabled. If a future
payment-method change introduces delayed failures, unresolved unpaid completion
stays held until an operator verifies the outcome; it is not blindly restocked.

Checkout uses Stripe's default 24-hour expiry. Retrying an unresolved create uses its original
persisted parameters and Stripe idempotency key for at most 23 hours. Older unknown
results require manual reconciliation because Stripe may forget keys after 24h.
Never create a replacement or release its units until Stripe has been checked and
any still-payable session is expired. The log event
`inventory_reconciliation_required` reports failed/review counts. This fail-closed
case favors no overselling over automatic availability. Reconcile unknown attempts
by matching their inventory metadata in Stripe; restore a matching session ID only
after verification and retain an audit of any manual database repair.

## Fan club setup

Defaults: disabled, ¥500 per month. Price is configured with a recurring Stripe
Price ID just like merchandise uses its own Price IDs:

- `STRIPE_PRICE_MEMBERSHIP`: active licensed monthly JPY Price, quantity one
- `MEMBERSHIP_AMOUNT_JPY=500`: expected price, change together with the new Price ID
- `MEMBERSHIP_PORTAL_URL`: Stripe-hosted portal login for the same test/live mode,
  with cancellation and payment-method updates enabled in Stripe
- `MEMBER_AUTH_ENABLED=false`, `MEMBERSHIP_ENABLED=false`: keep off until sandbox QA
- `MEMBERSHIP_DETAILS_REVIEWED=false`: explicitly review recurring billing terms,
  membership benefits, privacy, merchant details and cancellation before enabling
- `MEMBER_EMAIL_FROM`: verified sender/address in your mail provider
- `MEMBER_EMAIL_API_KEY_FILE`: protected Resend API key file, never source or .env
- `MEMBER_CONTENT_DIR`: private content directory, never `public`, `src`, `dist`

No keys or provider accounts are created by this change. Creating/configuring
provider credentials and enabling live billing require separate owner action.
The email provider receives the requested email address and one-time login link.
Disclose this provider in the site's privacy information before launch. Disable
email click tracking for login messages. HTTPS is required even for auth testing;
use an approved local HTTPS setup or sandbox staging domain.

On the bouncer API, the mail file defaults to `/app/state/member_email_api_key`
(owner UID 10001, mode 0600) and private content to `/app/state/member-content`.
These belong only to the API's existing persistent volume, not the web container.
Provision via the deployment operator's secure secret workflow, never paste a key
into logs or repository files. The API image uses Node's SQLite, no new runtime
package or database service is needed.

Grant the existing restricted Stripe key only the API permissions actually needed:
read Prices/Products, shipping rates, subscriptions and their current state; create
and read Checkout Sessions. Configure signed webhooks for Checkout completion,
expiration and async outcomes; customer subscription lifecycle; invoice paid,
payment success/failure/action required. Preserve existing webhook verification.
Test and live keys, events, inventory, accounts, cookies and subscription state are
separated. Do not change live account settings as part of sandbox QA.

### Accounts, access and cancellation

A member signs in by requesting an email link and explicitly confirming it. Tokens
are short-lived, single-use and stored only as hashes; session cookies are Secure,
HttpOnly and SameSite. Successful re-verification revokes older sessions and links.
The Checkout account comes only from that verified session, not a submitted email
or customer ID. The success URL is never proof of payment or membership.

Every private post/photo request retrieves current Stripe subscription state.
Access requires `active` and an unexpired paid billing period. Scheduled cancellation
keeps access through the paid period while Stripe reports active. Canceled,
past-due, unpaid, paused, trialing and incomplete subscriptions have no access;
Stripe/API errors fail closed. Existing subscriptions retain their historical
Price IDs when the new-member price changes. Billing management uses Stripe's
hosted login, which verifies the customer's email independently; no public endpoint
accepts arbitrary Stripe customer IDs.

The fanclub page remains a public sign-in/offer shell; its paid feed and image bytes
come from authenticated API endpoints. Existing promotional photos already public
on the site remain public. Copying those files into a private directory cannot
make previous public copies confidential. No invented blog posts or paid photos
are supplied. Use `private-content-example/README.md` for the private manifest.
Members can still save content they legitimately receive; access control is not DRM.

## Sandbox acceptance checklist

1. Leave live/public sales disabled. Configure a sandbox monthly Price (default
   ¥500), restricted key/webhook, verified email sender and matching portal login.
2. Verify an email login, expired/replayed link rejection, logout, and session expiry.
3. Verify subscription Checkout displays amount/month and explicit recurring consent.
4. Complete test payment; access appears only after current subscription verification.
   A fabricated success URL and an unpaid checkout must not grant access.
5. Check direct private photo URLs without a session, wrong mode, and expired or
   canceled subscription are blocked. Confirm no private bytes in the static build.
6. Test renewal failure, cancellation at period end, immediate cancellation, portal
   billing changes, duplicate/out-of-order webhooks, restarts and price changes.
7. Test sandbox keychains: 3 + 3 leaves 4, 5 rejected, final 4 sells out. Confirm
   expired Checkout releases stock but a cancel-page visit does not.
8. Before live activation, reconcile all outstanding legacy Payment Links/orders,
   set actual live stock, review privacy/legal terms, confirm backups and mail
   delivery, and obtain explicit approval. Merge is not deployment approval.

### Audited restocking (operator only)

Stop every API/worker and make a consistent backup first. Do not edit the original
bootstrap manifest after initialization. Against the existing database, run:

    node scripts/inventory-stock.mjs --db /absolute/path/commerce.sqlite --scope test:sandbox --sku keychain --add 10 --ack-offline-backup

Use `--set-total N` instead of `--add N` to set lifetime supply (sold + held +
available), not remaining availability. The command refuses a total below sold
and reserved units. It can initialize a new SKU, records prior/new totals in the
audit table and leaves reservations and ambiguous payments unchanged. Use the
correct test/live scope; this command does not touch Stripe. Resume the API only
after checking the printed counts. No restocking command has been run against
production as part of this draft.

Login links must be opened in the same browser that requested them. The request
sets a secure browser nonce; a link forwarded to another browser cannot switch
that browser into the sender's account. Request a new link if necessary.

Implementation references: [Stripe limited inventory](https://docs.stripe.com/payments/checkout/managing-limited-inventory),
[Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment),
[subscription item billing periods](https://docs.stripe.com/api/subscription_items/object),
and [Resend transactional email API](https://resend.com/docs/api-reference/emails/send-email).
