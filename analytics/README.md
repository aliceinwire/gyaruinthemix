# Private site analytics

The web image includes a password-protected dashboard at `/analytics/`. It shows
estimated daily visitors, popular pages, traffic-source categories, device shares,
daily trends, and errors on tracked pages. Select 7, 30, or 90 days, refresh the
counts, or export daily CSV. Dates use Asia/Tokyo.

Collection is disabled by default. It runs inside the existing web container with
Node's built-in SQLite support; it needs no extra container, subscription, visitor
JavaScript, cookies, or browser storage. The checkout API is not required.

## Enable on the existing bouncer stack

After deploying a web image containing this feature:

1. Add the following entries to the **existing** `gyaruinthemix-web` service in
   `~/bouncer/docker-compose.yml`. Keep its other configuration and services.

   ```yaml
   environment:
     ANALYTICS_ENABLED: ${ANALYTICS_ENABLED:-false}
     ANALYTICS_PROXY_HOST: ${ANALYTICS_PROXY_HOST:-proxy}
   volumes:
     - gyaruinthemix_analytics_state:/var/lib/analytics
   ```

   Also declare `gyaruinthemix_analytics_state:` under the top-level `volumes:`.
   These entries are already present in this repository's Compose template.

2. Confirm the existing proxy overwrites `X-Real-IP` with a validated visitor
   address. The standard nginx-proxy template sets it to `$remote_addr`. Set
   `ANALYTICS_PROXY_HOST` to that proxy's Docker DNS service name (normally `proxy`).
   If another CDN or proxy sits in front, its real-client configuration must also
   be correct or visitors will be grouped under that upstream's addresses. The
   dashboard reports missing address coverage; it cannot detect a misconfigured
   upstream that forwards a valid but incorrect address. Do not publish port 8080
   directly or broaden trust to a whole private network.

3. Provision the dashboard password in the named volume from `~/bouncer`:

   ```sh
   docker compose run --rm --no-deps --entrypoint node gyaruinthemix-web /opt/analytics/setup.mjs
   ```

   Save the generated password in your password manager. The username is `admin`.
   The password is generated locally and only its SHA-256 digest is stored. Running
   the command again rotates the password; restart the service afterwards.

4. Set `ANALYTICS_ENABLED=true` in `~/bouncer/.env`, then recreate just the web
   service using the same deployed image:

   ```sh
   docker compose up -d --no-deps --no-build --pull never gyaruinthemix-web
   ```

   Open `https://gyaruinthemix.com/analytics/` over HTTPS and sign in. The existing
   web memory limit also covers analytics; monitor it alongside podcast indexing.
   Existing image-only updates retain the Compose configuration and named volume.

Set `ANALYTICS_ENABLED=false` and recreate the web service to stop collection and
close the dashboard. Retained data stays in the named volume. Back it up with the
web service stopped; keep the password file private. Remove the analytics volume
only when intentionally deleting the retained history.

## Counting and privacy

- Only fixed public page paths, their English versions, and `/game/` are counted.
  Assets, API calls, checkout returns, redirects, and the dashboard are excluded.
  Known bot user agents are excluded; this is an estimate, not bot-proof tracking.
- Page requests are successful GET responses (200/304). Cached views may be absent;
  reloads add requests. Errors on those same tracked paths are separate.
- Visitor estimates use the forwarded IP **only** when the socket peer matches the
  selected proxy's resolved address. Proxy DNS is refreshed every minute. Untrusted
  or missing client addresses never become visitor identities.
- A random daily salt hashes the address, browser family, and device category.
  Repeat requests on the same day deduplicate across pages. A returning person is
  counted again on another day. Period totals sum daily estimates; they are not
  unique people across a week or month. Shared networks can undercount and changes
  of network or browser can overcount.
- Address fields travel only from nginx to a loopback UDP collector, where they
  are hashed. They are never written to the analytics database or stdout logs.
  Raw user-agent strings, full referrers, queries, and request bodies are not sent
  to the collector. The existing sanitized operational log is unchanged.
- Daily counts and daily hashes are retained for 90 days. Old daily salts are
  discarded. The password, daily salt, and aggregates persist across restarts.
- The first period is partial. There is no historical backfill from the old logs.
  Loopback UDP is best-effort; restarts, overload, or collector failures may lose
  requests. These counts are for site trends, not billing or audience certification.
- The HTML, assets, and JSON all require authentication and return `no-store` and
  `noindex`. Bypass any outer-proxy/CDN cache for `/analytics` and `/analytics/*`.

Sources are categories of referring websites, not proof of social-app visits.
Apps and browsers can hide referrers; internal navigation can also appear as
Direct / unknown. No music-platform plays, podcast listeners, purchases, or
outbound clicks are inferred from page requests.
