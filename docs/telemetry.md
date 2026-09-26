# Mentor Game Studio Telemetry Specification

**Status:** Living V1 specification  
**Last design review:** 2026-09-24  
**Site:** mentorgamestudio.com  
**Repository:** mitkoprodanov/mentor-website

This document is the source of truth for custom telemetry on the Mentor Game Studio website. Update it when telemetry behavior, privacy rules, event semantics, storage, or implementation changes.

## Local development

Everything below runs on your machine against a **local** D1 database (`workers/telemetry/.wrangler/`, git-ignored). Helper: `scripts/telemetry.mjs`. Works in PowerShell, cmd, bash.

### One-time setup

```powershell
npm install
npm run telemetry:db:init     # applies migrations/*.sql to LOCAL D1
npm run telemetry:check       # readiness summary
```

`telemetry:dev` creates and maintains `workers/telemetry/.dev.vars` (git-ignored), setting `ALLOWED_ORIGINS` to the localhost and LAN Astro origins on port 4321. That is CORS configuration, not authentication. Setup succeeded when `npm run telemetry:db:check` prints `[ OK ]` for `sessions` and `events`.

### Every time I want to test

| | Command |
|---|---|
| Terminal 1 (Worker + local D1, `:8787`) | `npm run telemetry:dev` |
| Terminal 2 (Astro with telemetry ON, `:4321`) | `npm run dev:telemetry` |
| Open | <http://localhost:4321/> (use `localhost`, not another host or port) |

`dev:telemetry` runs `astro dev --host --force --port 4321` and sets `PUBLIC_TELEMETRY=1` and `PUBLIC_TELEMETRY_ENDPOINT` (to `http://<your LAN IP>:8787/v1/batch`, or `localhost` if there is no LAN address) itself; no environment variables to set. `--force` replaces an already-running Astro dev server and clears the content cache. Plain `npm run dev` still keeps telemetry off.

**From a phone (same Wi-Fi):** run the same two commands and open the `Phone (same Wi-Fi)` URL that `dev:telemetry` prints (e.g. `http://192.168.0.148:4321/`). `telemetry:dev` listens on all interfaces and adds your LAN origins to `ALLOWED_ORIGINS` in `.dev.vars` (it rewrites that one line at each start). If the phone cannot connect, allow inbound TCP 4321 and 8787 for the Private network in Windows Firewall. The LAN IP can change between sessions; restart both commands if it does.

### After a code change

- Astro code (pages, components, `src/lib/telemetry/`): hot-reloads. Reload the page for a fresh session (a reload is a new session; telemetry state is in memory only).
- Worker code (`workers/telemetry/src/`): Wrangler reloads automatically.
- Restart the Worker (Terminal 1) after editing `.dev.vars` or `wrangler.jsonc`.
- Restart Astro (Terminal 2) after editing `astro.config.mjs` or changing the endpoint/port.
- New migration in `migrations/`: `npm run telemetry:db:init` (applies only unapplied files).

### Check what happened

Events flush ~1.5 s after page load, every 20 s while visible, and when the tab is hidden or closed.

```powershell
npm run telemetry:sessions    # recent sessions (viewport, pointer, UTM, event count)
npm run telemetry:events      # recent events (id, session, elapsed_ms, type, target, properties)
npm run telemetry:viewport    # recent viewport_changed events with size + orientation
npm run telemetry:events -- --limit 100 --session 3fa9c1d2   # options for all three
```

Sessions are shown by their first 8 characters; `--session` takes any prefix. `--limit` is 1..500 (default 20).

### Start a clean test

```powershell
npm run telemetry:clear       # deletes LOCAL events, then sessions
```

Then reload/open <http://localhost:4321/> for a fresh session.

### Important safety

- **Guaranteed local:** every `telemetry:*` command and `dev:telemetry`. All D1 access goes through one function in `scripts/telemetry.mjs` that hard-codes `wrangler d1 execute --local` and rejects `--remote`, `--env`, `--config`, `--persist-to`; there is no flag or environment variable that switches to remote. `telemetry:dev` runs `wrangler dev --local --ip 0.0.0.0` (reachable from your local network, local D1 only). Options on `sessions`/`events`/`viewport` are limited to `--limit` and `--session`.
- **Remote/production (not part of this workflow):** `npm run worker:deploy` (deploys the Worker) and any manual `wrangler d1 ... --remote` command. Never run those from this section's commands.
- None of the convenience commands deploy or modify production D1. `worker:dev` is the older, unscripted way to start the Worker; prefer `telemetry:dev`.
- `telemetry:check` is read-only. If it reports a CORS 403, a Worker started before `.dev.vars` existed is still running: restart it.

## 1. Goals

Telemetry should help answer:

- What content had a realistic opportunity to be seen?
- What retained active attention?
- What did visitors deliberately explore?
- Were Mitko, Ádám, or both meaningfully discovered?
- Which projects, skills, media, and Vision concepts attract exploration?
- Are Skills and Skill Filtered View understood and useful?
- Which journeys lead toward CV, LinkedIn, email, or other contact actions?
- Where does attention decay or a journey end?
- Are there plausible UX-confusion signals such as clicks on suggestive noninteractive elements?
- How do source/campaign, viewport, orientation, and input capability relate to these journeys?

Raw telemetry records objective observations and interactions. Interpretations such as "seen", "read", "engaged", "boring", "high intent", "duo discovery", and "drop-off" are derived later.

## 2. Privacy constraints

V1 is intentionally privacy-light.

- No analytics cookies.
- No persistent visitor identifier across visits.
- No fingerprinting.
- No session replay.
- No cross-site tracking.
- No intentional collection of names, email addresses, phone numbers, form contents, or other visitor PII.
- A random anonymous session ID exists only for the current browser visit.
- A returning visitor is a new anonymous session.
- Country may be added server-side from Cloudflare's coarse request metadata if retained; no precise location.
- Do not store raw IP addresses.
- Do not derive or store subjective intent in the browser.

A short public analytics/privacy statement should be added before production telemetry is enabled.

## 3. Infrastructure

Existing hosting remains unchanged:

GitHub repository -> GitHub Pages -> Astro static site

Custom telemetry:

Browser -> Cloudflare Worker `mentor-telemetry` -> D1 `mentor-telemetry-db`

The Worker is the only public telemetry API. D1 credentials are never exposed to the browser.

Cloudflare Web Analytics may additionally provide aggregate traffic/referrer/performance information. It is separate from semantic Worker/D1 telemetry.

## 4. UI/state model

### 4.1 Main surface

About/Intro, Timeline, and Contact are one continuous main surface. Scrolling between them does not create separate view instances.

Sections are exposure context, not application states:

- `about`
- `timeline`
- `contact`

Navbar is available.

### 4.2 Persistent Person cards

The two sticky Person cards are persistent person surfaces. They are not individually "opened".

In normal Timeline mode they can expose Skills. Near Contact they enter Contact mode: Skills cannot be opened; person actions such as CV and LinkedIn are available. This is not a separate Person view.

Do not emit `person_open` or `person_close`.

### 4.3 Skills overlay

The two cards form one paired Skills unit. Triggering either person's Skills reveals both people's Skills.

Desktop hover can reveal Skills transiently. Clicking Skills can lock the paired reveal. Touch opens/closes both cards together.

While Skills is active:

- underlying Timeline/main content is suspended for active-time and visibility accumulation;
- background page scrolling is frozen by the existing UI;
- Navbar remains available;
- Mitko and Ádám Skills exposure is measured separately even though both are presented together.

Important distinction:

- `trigger_person` says which side caused the transition.
- Visibility says which person's content actually received exposure.

### 4.4 Skill Filtered View

Selecting a linked skill opens a true blocking filtered-results view.

- Underlying main/Skills content is suspended.
- Navbar is unavailable.
- Results contain detailed ProjectDetail-style project content, not merely previews.
- Matching projects, experiences, and media are filtered using existing semantic tag IDs.

### 4.5 Project Detail

Project Details uses a blocking HTML dialog.

- Underlying surfaces are suspended.
- Navbar is unavailable.
- Project active time and selected child content visibility are measured.
- Canonical analytics project identity comes from project data, not presentation-specific modal IDs such as `tl-...`.

### 4.6 Restoration

Closing a blocking view restores the prior underlying UI state. It does not create a new Timeline visit.

## 5. Active time

Time accumulates only while all applicable conditions hold:

- document is visible;
- owning UI state is active;
- target is rendered and eligible;
- target meets the relevant geometric visibility threshold;
- target is not suspended by a blocking overlay/modal.

Page Visibility API pauses timing while the document is hidden. Focus may be used as supplementary information but is not an absolute requirement.

Five minutes in another browser tab must not become five minutes of project attention.

## 6. Visibility Matrix

Tracked content uses cumulative active visibility thresholds:

- `v50_ms`: time at >=50% visibility
- `v70_ms`: time at >=70%
- `v85_ms`: time at >=85%
- `v95_ms`: time at >=95%
- `max_visibility_ratio`

Thresholds are nested. If an element is 92% visible for four active seconds, v50/v70/v85 each gain four seconds and v95 gains zero.

95% is used instead of 100% to avoid subpixel/layout geometry making "fully visible" unrealistically fragile.

There is no universal "seen" threshold. Interpretation depends on content type.

### 6.1 Eligibility and occlusion

DOM intersection alone is insufficient. A target must belong to the active owning state. If Skills or a blocking modal suspends the Timeline, Timeline elements stop accumulating even if their DOM rectangles technically intersect the viewport.

V1 does not require a pixel-perfect arbitrary occlusion engine.

### 6.2 Oversized content

Large content may never reach 85% or 95%. Do not interpret zero high-threshold time as ignored. Coverage-based measurement is a possible future extension, not a V1 requirement.

## 7. Appearances

An appearance is one continuous opportunity to encounter a tracked target.

- Starts when target reaches >=50%.
- Continues while relevant.
- A dip below 50% shorter than approximately 300 ms does not split the appearance.
- Ends after more than ~300 ms continuously below 50%, or when its owning state closes/suspends.

The grace period only controls appearance identity. Visibility counters still reflect actual visibility and do not gain false time during the grace interval.

Each appearance receives a client-generated `appearance_id`. The same appearance may span multiple network flushes.

Scrolling away and later returning creates another appearance.

## 8. Visibility targets

V1 candidates:

### Main surface
- `vision_content`
- `vision_tooltip`
- `timeline_project`
- `contact`
- person-relevant Contact exposure where useful

Both the Vision content itself and individual Vision tooltip content are important targets.

### Skills
- `skills_person:mitko`
- `skills_person:adam`

### Detailed project surfaces
- `filtered_project`
- `project_experience`
- `project_text`
- `project_image`
- `project_video`

Instrument meaningful semantic content, not every descendant DOM element.

## 9. Video

Do not use 25/50/75/100 percent milestones.

Visibility Matrix information is more useful for this site, and known video duration belongs to content metadata rather than repeated telemetry.

Where playback state is technically available, additionally accumulate factual playback duration:

- `playing_ms`
- `playing_v50_ms`
- `playing_v70_ms`
- `playing_v85_ms`
- `playing_v95_ms`

`video_start` may be recorded when an explicit/observable playback start exists.

For external embeds, record only information exposed reliably by the provider/browser. Do not infer inaccessible iframe playback.

## 10. Semantic interactions

Current V1 vocabulary:

### Session/environment
- `session_start`
- `viewport_changed`

### Skills/state
- `skills_open`
- `skills_lock`
- `skills_unlock`
- `skills_close`
- `skill_filter_open`
- `skill_filter_close`
- `project_open`
- `project_close`

### Explicit interactions
- `nav_click`
- `skill_click`
- `cv_download`
- `linkedin_click`
- `contact_email_copy`
- `contact_email_open`
- `external_link_click`
- `video_start`
- `context_menu`
- `noninteractive_click`
- `repeated_noninteractive_click`

### Measurement
- `visibility_delta`

The vocabulary may be normalized during implementation if multiple names are better represented by one generic event + properties, but semantics must remain documented here.

## 11. Event semantics

### Skills

`skills_open` should include:
- `trigger_person: mitko | adam`
- `trigger_method: hover | mouse | touch | pen | keyboard` as actually knowable
- initial lock state

A deliberate desktop click that changes an already-hovered presentation into persistent locked state should be represented as a lock transition rather than a second open.

`skills_close` should record the actual code path, such as:
- `hover_leave`
- `explicit`
- `outside`
- `escape`
- `navigation`

Only include `trigger_person` when a person's control actually caused the close.

### Skills/tags

Existing canonical tag IDs from site data are the analytics `skill_id`. Do not invent a second ID system.

`skill_click` records deliberate selection. Non-clickable but plausibly interactive tags may use the conservative noninteractive-click mechanism.

### Projects

Use canonical project IDs from project/catalog data. DOM/modal IDs are presentation details.

A project interaction may include source context when the same project can meaningfully be reached through multiple surfaces, e.g. Timeline versus Skill Filtered View.

Do not duplicate static project-person relationships into every telemetry event; those belong to content data.

### Contact/person actions

`cv_download` and `linkedin_click` identify `person_id`. The CV component is effectively used on the persistent Person card; Contact mode modifies that card rather than creating a separate CV source.

Company contact:
- explicit copy button -> `contact_email_copy`
- mailto segment -> `contact_email_open`
- company LinkedIn -> corresponding explicit outbound interaction

A native context menu is only a weak `context_menu` signal. It must never be treated as proof that "Copy link address" was selected.

### Navbar

Targets:
- `about`
- `timeline`
- `contact`

`nav_click` should include meaningful origin context.

When on ordinary main surface:
- `origin_surface: main`
- `origin_section: about | timeline | contact`
- nearby/corresponding project ID only when reliably determinable and useful

When Skills is active:
- `origin_surface: skills`
- `skills_mode: hover | locked`

Do not turn normal scrolling among About/Timeline/Contact into separate application view states.

## 12. UX-confusion signals

Do not globally record arbitrary clicks.

A dead/noninteractive click is recorded only on explicitly classified semantic targets that plausibly look interactive.

Repeated heuristic:
- same semantic target;
- at least 3 clicks/taps;
- within approximately 2 seconds;
- no relevant state change.

Prefer one aggregated `repeated_noninteractive_click` containing target/count/interval rather than noisy raw click spam.

"Rage click" may be an analysis label, not the raw schema term.

## 13. Session context

Create once per anonymous visit:

- `session_id`
- `started_at`
- referrer
- UTM source
- UTM medium
- UTM campaign
- UTM content
- viewport width/height
- screen width/height
- primary pointer coarse capability
- primary pointer fine capability
- any-pointer coarse capability
- any-pointer fine capability
- hover capability
- touch capability
- `telemetry_version`
- `site_version`
- optional coarse country added server-side

Do not create a persistent returning-visitor identifier.

### 13.1 Viewport changes

Use `viewport_changed` rather than a separate `orientation_change` event.

The event records the new viewport width/height. Portrait versus landscape is derived from those dimensions, so orientation is not redundantly stored.

The purpose is broader than rotation: it can reveal meaningful resizing behavior such as a visitor enlarging/maximizing the browser to give the site more room, and lets analysis compare viewport use against the session's screen width/height.

Resize events can fire continuously while a window is dragged. Do not emit every browser resize event. Coalesce/rate-limit them to at most approximately one telemetry event every few seconds during active resizing, while preserving the final settled viewport size with a trailing emission. Ignore tiny/no-op dimension changes if they do not materially change the viewport.

#### Implemented behavior (`src/lib/telemetry/viewport.ts`, wired in `client.ts`)

- **Source**: `window.innerWidth` / `window.innerHeight` (rounded CSS px; values outside 1..20000 are ignored). Nothing else is read.
- **Payload**: `event_type: viewport_changed`, no target, `properties: {"viewport_width": <int>, "viewport_height": <int>}`. Created via the normal queue, so `event_id`, `occurred_at`, `elapsed_ms`, batching and retry are unchanged.
- **Baseline**: the last emitted size, initially the session row's viewport. Nothing is emitted on page load.
- **Coalescing**: every `resize` callback (re)starts a 500 ms settle timer (`SETTLE_MS`). When it fires (500 ms with no resize) the current size is measured and emitted (the trailing, settled emission).
- **Rate limiting**: during a continuous burst, one 5 s timer (`INTERMEDIATE_INTERVAL_MS`) started at the first resize of the burst emits the current size (if meaningful) and re-arms while resizing continues, so at most one intermediate event per 5 s plus the trailing one.
- **Noise threshold** (compared with the baseline, so slow drift accumulates rather than being lost): emit only if |Δwidth| >= 10 px or |Δheight| >= 10 px. On a coarse primary pointer (phones/tablets), a height-only change (|Δwidth| < 10 px) must be >= 120 px, to ignore mobile URL-bar show/hide (~50-100 px). Rotation, maximize/restore and deliberate desktop resizes exceed these. An on-screen keyboard (~250+ px height change) can still emit.
- **Lifecycle**: `client.ts` keeps its single `visibilitychange -> hidden` / `pagehide` listeners. Before a lifecycle flush it calls `ViewportTracker.finalize()`, which cancels pending timers, measures the current size and, if meaningful, queues `viewport_changed`; the existing lifecycle flush then sends it. There is no second lifecycle listener.

## 14. Transport and batching

Use DELTAS, not snapshots/upserts.

The browser accumulates counters in memory. It does not send a request every second.

Flush:
- meaningful state boundaries;
- Project Detail close;
- Skills close/state boundary as useful;
- Skill Filter close;
- viewport changes, rate-limited/coalesced;
- before external navigation where practical;
- periodic safety flush around 20 active seconds;
- opportunistically on `visibilitychange -> hidden` / `pagehide` using `sendBeacon` or `fetch(..., {keepalive:true})`.

Do not rely on unload.

Periodic flushes do not split appearances. `appearance_id` links delta batches.

Example:

At 20 seconds:
- v50 +12000
- v70 +9000
- v85 +6000
- v95 +3000

At 40 seconds send only newly accumulated values:
- v50 +7000
- v70 +5000
- v85 +2000
- v95 +0

## 15. Proposed D1 schema

Keep storage generic and append-oriented.

### `sessions`

One row per anonymous visit.

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  viewport_width INTEGER,
  viewport_height INTEGER,
  screen_width INTEGER,
  screen_height INTEGER,
  primary_pointer_coarse INTEGER NOT NULL CHECK (primary_pointer_coarse IN (0, 1)),
  primary_pointer_fine INTEGER NOT NULL CHECK (primary_pointer_fine IN (0, 1)),
  any_pointer_coarse INTEGER NOT NULL CHECK (any_pointer_coarse IN (0, 1)),
  any_pointer_fine INTEGER NOT NULL CHECK (any_pointer_fine IN (0, 1)),
  hover_capable INTEGER NOT NULL CHECK (hover_capable IN (0, 1)),
  touch_capable INTEGER NOT NULL CHECK (touch_capable IN (0, 1)),
  country TEXT,
  telemetry_version INTEGER NOT NULL,
  site_version TEXT
) STRICT;

CREATE INDEX idx_sessions_started_at ON sessions(started_at);
```

### `events`

Append-only semantic events and visibility/playback deltas.

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,

  target_type TEXT,
  target_id TEXT,

  appearance_id TEXT,
  view_instance_id TEXT,

  v50_ms INTEGER,
  v70_ms INTEGER,
  v85_ms INTEGER,
  v95_ms INTEGER,
  max_visibility_ratio REAL,

  playing_ms INTEGER,
  playing_v50_ms INTEGER,
  playing_v70_ms INTEGER,
  playing_v85_ms INTEGER,
  playing_v95_ms INTEGER,

  properties TEXT,

  telemetry_version INTEGER NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  UNIQUE(session_id, event_id)
) STRICT;

CREATE INDEX idx_events_session_elapsed
  ON events(session_id, elapsed_ms);

```

Notes:
- Tables are `STRICT` so D1/SQLite rejects values outside the declared storage classes.
- Initial orientation is deliberately not stored: it is derived from viewport width/height.
- Screen width/height are retained so analysis can compare the page viewport with the available device screen area.
- Pointer capabilities are represented as booleans rather than one categorical field because hybrid devices can expose multiple pointer capabilities simultaneously.
- `event_id` is client-generated and makes retries idempotent.
- `elapsed_ms` provides robust within-session chronology.
- For explicit pointer-driven interactions, `properties.pointer_type` may record `mouse`, `touch`, or `pen` when exposed by the actual PointerEvent. Keyboard-triggered actions are represented by their trigger method rather than pretending they have a pointer type.
- `occurred_at` is useful wall-clock context but should not replace elapsed chronology.
- `properties` is JSON text for sparse event-specific facts such as trigger method, trigger person, origin section, skill ID, close method, or pointer type.
- Frequently queried stable measurements get real columns rather than being buried in JSON.
- Null means "not applicable", not zero.
- Do not create one table per feature.
- Start with minimal indexes. `UNIQUE(session_id, event_id)` provides idempotency indexing; `idx_events_session_elapsed` supports the core per-session chronology query. Add further indexes only after real query patterns justify their write/storage cost.

This schema is V1 proposed/frozen-for-implementation; change it here if implementation uncovers a concrete reason.

## 16. Worker API

V1 needs a small batch endpoint, for example:

`POST /v1/batch`

Request concept:

```json
{
  "session": {
    "session_id": "...",
    "started_at": "...",
    "telemetry_version": 1
  },
  "events": [
    {
      "event_id": "...",
      "occurred_at": "...",
      "elapsed_ms": 12345,
      "event_type": "visibility_delta",
      "target_type": "timeline_project",
      "target_id": "heroes6",
      "appearance_id": "...",
      "v50_ms": 5000,
      "v70_ms": 4200,
      "v85_ms": 3100,
      "v95_ms": 1000,
      "max_visibility_ratio": 0.97
    }
  ]
}
```

The first batch may create the session; later batches may include only `session_id` plus events, depending on client implementation. Re-sending session creation must be harmless.

Worker responsibilities:
- allow only the production site origin(s) plus explicit development/test origins if enabled;
- accept POST only for ingestion;
- enforce JSON/body size limits;
- validate schema and bounded string lengths;
- validate enums where practical;
- reject negative durations and invalid ratios;
- cap unreasonable delta values;
- ignore/reject unknown dangerous fields rather than blindly storing arbitrary request data;
- add trusted server-side fields such as coarse country if used;
- use prepared D1 statements;
- insert events idempotently using `event_id`;
- return minimal responses;
- never return stored telemetry to public clients.

### 16.1 Implemented V1 contract

Source: `workers/telemetry/` (`src/index.ts` handler, `src/validate.ts` validation, `test/` tests). Config: `workers/telemetry/wrangler.jsonc` (Worker `mentor-telemetry`, D1 binding `DB` -> `mentor-telemetry-db`). The Astro site stays on GitHub Pages; the Worker is deployed separately with Wrangler.

**Routing/CORS**
- Only `POST /v1/batch` (and its `OPTIONS` preflight); other paths 404, other methods 405.
- A request whose `Origin` is present and not allowed gets 403 with no CORS headers. Allowed: `https://mentorgamestudio.com`, plus origins listed in the optional `ALLOWED_ORIGINS` Worker variable (comma-separated; unset in production).
- Requests with no `Origin` header (non-browser clients) are not rejected by CORS. CORS is not authentication; validation and size limits apply to every request.
- Request `Content-Type` must be `application/json` (so `sendBeacon` must send a `Blob` of that type, which triggers a preflight).

**Limits**: body <= 64 KiB; <= 100 events per batch; `elapsed_ms` <= 24 h; each delta (`v*_ms`, `playing*_ms`) <= 10 min; viewport/screen dimensions <= 20000; `referrer` truncated to 512 chars and UTM values to 128 (free-form context is truncated rather than rejected); `properties` <= 2 KiB and 20 keys.

**Session** (`session_id` and `telemetry_version` = 1 always required)
- Creation batch: includes `started_at` and all capability booleans (strict JSON booleans, stored as 0/1). Optional: referrer, UTM fields, viewport/screen dimensions, `site_version`. Stored with `INSERT OR IGNORE`, so re-sending is harmless (first write wins).
- Follow-up batch: only `session_id` + `telemetry_version`, plus events. Events for a session that was never created return 409 `unknown_session`.
- `country` is never accepted from the client; it is set from Cloudflare's `request.cf.country` (`XX`/`T1` become null). Raw IPs are never read or stored.

**Events**
- `event_id`, `occurred_at` (ISO 8601), `elapsed_ms`, and `event_type` (must be in the section 10 vocabulary; adding a type requires a Worker change) are required. IDs (`session_id`, `event_id`, `appearance_id`, `view_instance_id`) match `[A-Za-z0-9_-]{8,64}`.
- `target_type` (`[a-z][a-z0-9_]*`) and `target_id` (`[A-Za-z0-9_.:-]{1,64}`) must be provided together, and are required on `visibility_delta`.
- Visibility and playback fields are only accepted on `visibility_delta`. Nested thresholds must not increase (`v50 >= v70 >= v85 >= v95`; `playing_ms >= playing_v50 >= ...`). `max_visibility_ratio` is 0..1.
- `properties` is a flat object with `[a-z][a-z0-9_]*` keys and string/number/boolean/null values, stored as JSON text.
- Unknown fields anywhere are rejected (400), never stored.
- The event `telemetry_version` column is taken from the session's version.

**Writes**: one D1 `batch()` (a single transaction) of prepared statements: optional session insert, then `INSERT OR IGNORE` per event, so retries never duplicate rows (`UNIQUE(session_id, event_id)`). Duplicate `event_id`s within one batch are rejected as a client bug.

**Responses**: `200 {"ok":true}` on success; errors are `{"error":"<code>","detail":"<field: reason>"}` (`detail` only for payload validation) with 400/403/404/405/409/413/415/500. All responses are `Cache-Control: no-store`. Stored telemetry is never returned.

**Local development**: the Worker runs locally with local D1 via `npm run telemetry:dev`; see "Local development" at the top of this document. Browser telemetry stays disabled in plain `npm run dev` (see 17.1); `npm run dev:telemetry` enables it against the local Worker.

A separate public read/query API is not required for V1. Analysis can initially use D1 SQL/Cloudflare tooling.

## 17. Client architecture

Keep telemetry isolated, e.g.:

```text
src/lib/telemetry/
  index.ts
  session.ts
  state.ts
  visibility.ts
  events.ts
  transport.ts
  types.ts
```

Exact filenames may change, but responsibilities should remain separated.

Principles:
- no scattered direct Cloudflare `fetch` calls from feature components;
- UI code emits semantic transitions/interactions;
- telemetry listens/records them;
- reuse the site's existing semantic custom-event hierarchy rather than building a parallel CSS observer;
- telemetry-facing state coordinator knows whether Main, Skills, Skill Filter, or Project Detail currently owns attention;
- visibility engine asks the coordinator whether a target is eligible;
- content components provide stable semantic IDs/data attributes;
- production telemetry ON only after validation;
- local development OFF by default;
- explicit test/debug mode available.

Existing events such as `filter:willopen`, `filter:opened`, `filter:closed`, `filter:change`, and `filter:unlocked` are a useful integration pattern.


### 17.1 Implemented client foundation (step 4)

Source: `src/lib/telemetry/` (tests in `src/lib/telemetry/test/`, run with `npm run telemetry:test`). Entry point: `src/scripts/telemetry.client.ts`, loaded from `src/pages/index.astro`. Only session creation, `session_start`, the queue, transport, lifecycle flushing and `viewport_changed` (section 13.1) exist; no feature instrumentation or visibility engine yet.

| File | Responsibility |
|------|----------------|
| `types.ts` | Wire types mirroring the Worker contract |
| `config.ts` | The single enablement decision (pure) |
| `session.ts` | Random ID, UTM parsing, session context |
| `queue.ts` | In-memory queue, event creation, `elapsed_ms` |
| `transport.ts` | Batching, single-flight flush, retry/backoff |
| `viewport.ts` | Resize coalescing / noise filtering for `viewport_changed` (pure, injected timers) |
| `client.ts` | Browser wiring: session start, timers, page lifecycle, resize listener |
| `index.ts` | Public API: `initTelemetry()`, `telemetry.emit(type, opts)`, `telemetry.flush()` |

**Session**: created once per page load, in memory only (no cookies, `localStorage`, `sessionStorage`). `session_id` is `crypto.randomUUID()` (hex from `getRandomValues` fallback; telemetry stays off if neither exists). A reload or return visit is a new session. Context fields are exactly those in section 13; capability fields are real booleans (`(pointer|any-pointer): coarse|fine`, `(hover: hover)`, `touch_capable = maxTouchPoints > 0 || 'ontouchstart' in window`). Only the four documented UTM parameters are read from the landing URL; the referrer is `document.referrer`. The current page URL is never sent. No User-Agent is collected.

**Events**: `event_id` is generated when the event is created and never regenerated. `elapsed_ms` = `performance.now()` since session start (`session_start` is 0); `occurred_at` is the ISO wall-clock time.

**Queue / flush / retry**:
- Events accumulate in memory (hard cap 500; when full, newly emitted events are dropped so recorded chronology is preserved; debug mode warns once). Batches are at most 100 events / 48 KiB.
- The first batch carries the full session context (`INSERT OR IGNORE` server-side); it is resent in full until a 2xx acknowledges it, after which batches carry only `session_id` + `telemetry_version`.
- One request in flight at a time; a flush requested meanwhile runs once afterwards. Flushes never send when nothing is queued. Success removes exactly the sent events. Network error / 5xx / 408 / 429: events stay queued with the same IDs; exponential backoff 30 s, 60 s, ... capped at 5 min, applied to non-lifecycle flushes only. 409 `unknown_session`: full context is resent. Other 4xx: that batch is dropped (it can never succeed and would block the queue).
- `credentials: 'omit'`; `Content-Type: application/json`.

**Lifecycle**: a flush ~1.5 s after start (so short visits still record the session), a 20 s periodic flush only while the document is visible (no timer while hidden), a flush on `visibilitychange` -> hidden, and on `pagehide`. Lifecycle flushes use `fetch(..., {keepalive: true})` and ignore backoff. `sendBeacon` and `unload` are not used.

**Enablement** (`config.ts`, the only place this is decided): on when the build is a production build AND `location.hostname === 'mentorgamestudio.com'`; otherwise off (so `astro dev` and `astro preview` on localhost send nothing). Deliberate local override: build-time `PUBLIC_TELEMETRY=1` (also turns on console diagnostics), optionally with `PUBLIC_TELEMETRY_ENDPOINT` (e.g. `http://localhost:8787/v1/batch`). `npm run dev:telemetry` sets both for you; the dev origin is in the local Worker's git-ignored `.dev.vars` `ALLOWED_ORIGINS`. `?telemetry_debug` adds console diagnostics on an already-enabled site but never enables telemetry.

**`site_version`**: short (7-char) commit SHA, injected at build by `astro.config.mjs` (`GITHUB_SHA` in the GitHub Pages workflow, else `git rev-parse`, else `dev`).

**Failure behavior**: all client entry points are wrapped; failures are silent (debug logging only).

## 18. Derived analysis (not browser events)

Examples:

- meaningful Vision exposure
- tooltip exploration rate
- project preview -> detail conversion
- skill -> filtered-project exploration
- person focus: Mitko / Ádám / duo / neither
- exploration depth
- active attention by content
- attention decay by project/content position
- contact-intent progression
- last meaningful state/content before disappearance
- campaign/source quality
- UX-confusion aggregates

Do not store these labels client-side. Definitions can evolve without changing historical raw data.

## 19. Exit/drop-off

Do not depend on a guaranteed `session_end`.

Use chronology and the last meaningful state/action/visibility evidence. Page-hidden events primarily pause timing and opportunistically flush data; hidden does not automatically mean the visitor permanently left.

## 20. Deferred / deliberately excluded from V1

- persistent visitor identity
- cross-session behavior
- cookies for custom telemetry
- session replay
- fingerprinting
- exact geographic location
- arbitrary click tracking
- universal "read" claims
- video percent milestones
- exact video-seconds-watched reconstruction
- pixel-perfect arbitrary occlusion detection
- oversized-content coverage metric
- custom analytics dashboard
- complex browser-side intent scoring

## 21. Implementation sequence

1. Commit this specification.
2. Create D1 tables/indexes.
3. Implement Worker `/v1/batch` validation + idempotent inserts.
4. Implement minimal client session + transport. (Done: section 17.1.)
5. Prove end-to-end pipeline with a few explicit events.
6. Add semantic state coordinator.
7. Add Visibility Matrix engine and appearance tracking.
8. Instrument Vision.
9. Instrument Skills/person exposure.
10. Instrument Timeline project previews.
11. Instrument Project Detail and Filtered View through shared ProjectDetail semantics.
12. Instrument Contact/CV/LinkedIn/email/navbar interactions.
13. Add video playback-duration enrichment where reliably available.
14. Add conservative noninteractive/repeated-click signals.
15. Validate suspension, hidden-tab timing, batching, retries, and mobile/pointer behavior.
16. Add public privacy/analytics statement.
17. Enable production telemetry.

## 22. Change discipline

When implementation or product behavior changes:

1. update this document in the same change;
2. distinguish raw facts from derived interpretations;
3. prefer stable content IDs over DOM/presentation IDs;
4. avoid adding fields merely because they are easy to collect;
5. do not weaken privacy constraints without an explicit design decision;
6. bump `telemetry_version` when a schema/semantic change makes old and new data meaningfully incompatible.

