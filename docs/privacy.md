# Privacy

Source of truth for **cross-cutting privacy decisions** on mentorgamestudio.com. Telemetry event semantics live in [telemetry.md](telemetry.md); this file owns consent, third-party content, retention and the visitor-facing statement. Update it in the same change as any behavior it describes.

> Status: implemented. (This file did not exist when the work was specified; it was written from that specification together with the implementation, so the decisions below are the ones actually shipped.)

## 1. Two independent choices

| | Anonymous analytics | External media |
|---|---|---|
| What | Custom Worker/D1 telemetry (telemetry.md) | Third-party embedded content: YouTube, LinkedIn, Facebook and any future provider embed |
| Default | **Off** in production until the visitor chooses `Allow analytics` | **Not loaded** until the visitor chooses `Allow external media` |
| Remembered | `allow`/`refuse` under its own key | `allow`/`refuse` under its own key |
| Withdraw | Privacy bar / Details → `Turn off` | Privacy bar / Details → `Turn off` |

The two are **completely independent**: granting or withdrawing one never changes, starts or stops the other, and neither value is ever sent to telemetry. Self-hosted/local media (image, GIF, image-row, text, native `video`) needs neither and is never gated.

## 2. Anonymous analytics consent

- Production telemetry starts **only** after `Allow analytics`. Ignoring the prompt means no consent. The site is fully usable while unanswered.
- The UI is deliberately small. In `consent` mode with analytics unanswered, the compact bar **opens by itself on load** (analytics row only: `Anonymous analytics — helps us understand how the portfolio is used. No ads or persistent visitor ID.` with `No thanks` / `Allow analytics` / `Details`); Details is never opened automatically and telemetry does not start until `Allow analytics`. `forced` and `off` modes never show this prompt. `No thanks` remembers a refusal; dismissing the bar decides nothing (analytics stays unset and off, the persistent `Privacy` control reopens it, and the bar appears again on the next visit).
- The persistent `Privacy` control (bottom-left edge) opens **that same bar** showing both independent choices (Anonymous analytics and External media), each adapted to its current state (`Currently on.` + `Turn off`, or `Currently off.` + `Allow ...`) — never the details directly. A first visit shows the analytics row only; activating a gated embed shows the External media row only. `Details` opens a short panel with both settings and controls plus a one-line summary of each (analytics kept up to 90 days, no persistent visitor identity; External media allows embeds from services such as YouTube and LinkedIn). Every way of closing is identical and closes the **whole** Privacy UI (bar and Details, never falling back from Details to the bar) without changing either choice: an outside pointer/tap (a capture-phase `pointerdown` with a `composedPath()` containment check, so it also works while the UI is hosted inside a project dialog), the `×`, and `Escape` (which closes Privacy only, never the project dialog beneath it). An outside click on a dialog backdrop closes Privacy but not the dialog. Focus returns to the `Privacy` control, or to the gated embed button that opened the External media prompt (not after an outside click, which keeps focus where the visitor clicked). Technical detail is intentionally not in the visitor UI (it lives here and in telemetry.md).
- **Before consent nothing telemetry-related exists**: no client is initialized, no session ID is generated (`crypto.randomUUID` is not called for telemetry), the UI-state coordinator is not created, no telemetry-only listener/observer is installed (they register through `telemetryControl.onStart`, which only runs while telemetry runs), nothing is queued and the Worker is never contacted. (The telemetry *code* is part of the page bundle, like any other script; it is inert.)
- **Allow**: telemetry starts at that moment with a brand-new anonymous session (`started_at` = the moment of consent; `elapsed_ms` counts from it). Nothing that happened earlier is reconstructed or backfilled. Campaign UTMs and the referrer are still read from the landing URL / `document.referrer` for that new session.
- **Withdrawal** (`Turn analytics off`) stops telemetry completely: every telemetry listener, timer and visibility observer is removed, the UI-state coordinator is destroyed, **unsent events are discarded (not flushed)**, and no further request is made. Turning it on again creates another fresh session. A visit that begins with a remembered refusal never starts.
- **Remembered preferences**: `localStorage` holds the literal string `allow` or `refuse` per category: `mgs_analytics_consent` (analytics, unchanged since it shipped, so existing choices stay valid) and `mgs_external_media_consent` (External media, implemented in `src/lib/externalMedia.ts` on the same `consent.ts` helpers). No visitor ID, timestamp or session reference; never sent to the Worker; never used for correlation; unknown/garbled values read as "unanswered". If storage is blocked the choice still applies to the current page load and Details says it could not be remembered. No cookies or `sessionStorage` are used.
- **Development modes** (one setting, resolved in one place: `src/lib/telemetry/config.ts`, build-time `PUBLIC_TELEMETRY_MODE=off | forced | consent`). **The real production site is always `consent`**: a production build on `mentorgamestudio.com` ignores the variable and any endpoint override. `forced` (analytics consent bypassed; `npm run dev:telemetry`) is a **local-development capability only**: it is honoured solely for a development build, and a production build asked for it resolves to `off`. Outside production a requested mode also needs an explicit *local* endpoint (localhost / loopback / private LAN), otherwise it resolves to `off`, so nothing can fall back to the production Worker. `astro build` refuses to run with the variable set. `consent` (`npm run dev:production-like`) exercises the real lifecycle of this section against the local Worker/D1; `off` (`npm run dev`) disables custom telemetry. **Third-party media permission (section 3) is never affected by the mode**: embeds are gated identically in all three. Commands and details: telemetry.md, "Development modes".

## 3. External media (third-party embeds)

- **One permission, not per provider or per item.** `Allow external media` enables every supported third-party embed (YouTube, LinkedIn, Facebook, and future ones). It is independent of anonymous analytics and of the telemetry mode; it behaves identically in `off`, `forced` and `consent`.
- **The boundary is "contacts a third-party provider", never the media format.** Every media kind is classified in one place, `MEDIA_KIND_PRIVACY` / `requiresExternalMediaConsent(kind)` in `src/lib/embeds.ts` (a `Record` over all kinds, so a new kind cannot be added without a decision; a test pins it):
  - **local, no consent, never gated:** `image`, `gif`, `image-row`, `text`, and self-hosted native `video` (served from our own origin; native video plays regardless of analytics and External media).
  - **external, needs External media:** `youtube`, `linkedin-post`, `facebook-video`, `facebook-reel` (Facebook stays supported and gated even though no project currently uses it).
- **Before permission** nothing is requested from any provider: no iframe, player, API script or thumbnail. Each embed shows a local placeholder (our own styling) and an ordinary external link (`Open on YouTube ↗` / `Open on LinkedIn ↗` / `Open on Facebook ↗`) that works without permission.
- **Activating a placeholder** does not load just that item: it opens the External media choice in the Privacy bar (`Not now` / `Allow external media`). While a project dialog is open the bar is hosted inside the dialog so it stays usable.
- **After `Allow external media`** the choice is remembered; every currently rendered embed loads immediately, embeds rendered later (another project, filter results) load as they open, and future page loads load them automatically while the choice stays `allow`.
- **Revocation** (`Turn off`): every embed returns to its placeholder, provider iframes are removed and YouTube players are destroyed (the mount is restored), and nothing reloads until External media is allowed again. Requests already made cannot be undone, and an already-downloaded YouTube IFrame API script simply stays idle.
- **YouTube**: every player iframe is created by us on the privacy-enhanced host, `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&origin=...` (the single builder is `youtubeEmbedUrl` in `src/lib/embeds.ts`; a test rejects any `youtube.com/embed/` player URL in source and in the built output), and the IFrame API is attached to that existing iframe for playback-state telemetry and segment looping. The API loader itself is the official `https://www.youtube.com/iframe_api` (plus the `www-widgetapi.js` it pulls in from `youtube.com`): that is a script, not a player, and is requested only after External media is allowed (lazily, on the first video). Before permission there are no YouTube requests at all. If autoplay is refused the player waits for Play; if the API script is blocked the placeholder is restored. The dormant experience-card showcase path follows the same rule (plain link until External media is allowed, then the same nocookie builder).
- **Facebook**: the standard `https://www.facebook.com/plugins/video.php?...` iframe. **LinkedIn**: `https://www.linkedin.com/embed/feed/update/urn:li:activity:...`.
- URL builders and the classification live in `src/lib/embeds.ts`, the permission in `src/lib/externalMedia.ts`, the load/revoke logic (`activateExternalMedia` / `revokeExternalMedia`) in `src/scripts/projectModal.client.ts`.

## 4. Telemetry privacy boundaries (unchanged, restated)

Never added: persistent analytics visitor IDs, fingerprinting, raw IP storage (country only, from Cloudflare metadata), session replay, raw mouse/pointer trails, arbitrary DOM/text capture, form-content capture, identity matching with emails/LinkedIn/contacts, new third-party analytics services.

Kept once consent exists: exact viewport/screen dimensions, pointer capabilities, country, visibility telemetry, journeys, UTMs and coarse click-burst diagnostics.

### 4.1 Referrer

`document.referrer` is sanitized **before** it enters telemetry (client) and again in the Worker: scheme + host + path are kept, the query string, fragment and any credentials are stripped. Unparseable or non-`http(s)` values are dropped. Stored in `sessions.referrer`.

### 4.2 Campaign attribution

Exactly four explicit, separate fields, read once per page load and stored on the session only: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (lowercase `[a-z0-9_-]{1,40}` or omitted). Example: `linkedin / organic_social / portfolio_site_launch / mitko_launch_post`. No arbitrary query-parameter collection and no recipient-specific visitor tracking. See telemetry.md section 13.2.

### 4.3 Event properties

The Worker's closed event vocabulary is backed by an explicit per-event property schema (`EVENT_PROPERTIES` in `workers/telemetry/src/validate.ts`, telemetry.md section 14.1). Undeclared properties are rejected, not persisted. String values must be short identifier tokens (`[A-Za-z0-9_.:-]{1,64}`), never free text or URLs.

## 5. Retention

Raw production `sessions` and `events` are deleted **90 days after the session started**. A Cloudflare Cron Trigger (`17 3 * * *`, daily, in `workers/telemetry/wrangler.jsonc`) runs `scheduled()` which calls `purgeExpired` (`workers/telemetry/src/retention.ts`): one D1 batch deleting events, then sessions, with `started_at < now − 90 days` (canonical UTC ISO text, lexically comparable; a session exactly 90 days old is kept until the next run). Locally: `npm run telemetry:prune [-- --days N --dry-run]` runs the same SQL against the **local** database only; `wrangler dev --test-scheduled` can trigger the handler. Long-lived aggregate reporting is out of scope.

## 6. Visitor-facing statement

The bar and `Details` panel in `src/components/PrivacyConsent.astro` (behaviour: `src/scripts/privacyConsent.client.ts`) are the visitor-facing statement. They stay concise and must remain true to sections 2-5: two independent optional choices; analytics is anonymous, without a persistent visitor identity, kept up to 90 days; External media lets embeds from services such as YouTube and LinkedIn load; how to change either. The fuller explanation (what is measured, campaign UTMs, collection mechanics) is documentation, not visitor UI; there is no separate public privacy page yet.

## 7. Remaining decisions

- Per-provider External media permission (intentionally not built: one category covers all providers).
- Whether withdrawal should also offer a "delete my data" path — impossible by design, since sessions are anonymous and unlinked to the visitor.
- A storage-event sync so withdrawing in one tab stops telemetry already running in another tab (currently takes effect on that tab's next load).
- `media_load_failed` telemetry (see TODO.md).
