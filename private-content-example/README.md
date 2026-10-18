# Private member content

This directory is an empty schema example, not published member material. Copy it to a private persistent directory outside `public/`, `dist/`, and any web-server document root. Configure `MEMBER_CONTENT_DIR` to the copy. Never put member-only photos in the public asset tree. The authenticated API reads this directory; Astro must not import it.

`posts.json` contains `{ "posts": [] }`. Each post has string fields `id`, `title`, `body` (plain text), `publishedAt` (ISO date), and `assets` (an array). Each asset has `name` (a simple filename) and `alt` (plain text). Place referenced JPG, PNG, WebP, or AVIF files alongside `posts.json`. Nested paths, SVG, HTML, and symlinks escaping the directory are rejected. Only assets explicitly listed in the manifest can be fetched. No example posts or photos are fabricated.

All reads require a verified email session and a current paid entitlement. Use HTTPS. Passwordless email verification is both login and account recovery; redeeming a fresh link revokes previous sessions. Links expire in 15 minutes and are redeemed only by an explicit POST confirmation, not opening the URL.

Login links are bound to the browser that requested them with a separate HttpOnly nonce cookie. Open the email link in that same browser. A cross-device link fails safely; request a new link on the desired browser. This prevents an attacker from switching another person into the attacker’s account before checkout.
