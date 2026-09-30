# Mentor Game Studio Telemetry Specification

**Status:** Living V1 specification  
**Last design review:** 2026-10-01  
**Site:** mentorgamestudio.com  
**Repository:** mitkoprodanov/mentor-website

This document is the source of truth for custom telemetry semantics and implementation on the Mentor Game Studio website. Cross-cutting privacy and consent decisions live in `docs/privacy.md`; this document keeps only the telemetry-specific contract needed to implement them.

## Local development

Everything below runs on your machine against a **local** D1 database (`workers/telemetry/.wrangler/`, git-ignored). Helper: `scripts/telemetry.mjs`. Works in PowerShell, cmd, bash.

### One-time setup

```powershell
npm install
npm run telemetry:db:init     # applies migrations/*.sql to LOCAL D1
npm run telemetry:check       # readiness summary
```

`telemetry:dev` creates and maintains `workers/telemetry/.dev.vars` (git-ignored), setting `ALLOWED_ORIGINS` to the localhost and LAN Astro origins on port 4321. That is CORS configuration, not authentication. Setup succeeded when `npm run telemetry:db:check` prints `[ OK ]` for `sessions` and `events`.

### Privacy-mode development target

The privacy implementation should formalize telemetry startup as one explicit mode:

- `off` — telemetry disabled;
- `forced` — telemetry starts immediately and bypasses anonymous-analytics consent;
- `consent` — production-like behavior using the real analytics-consent UI.

Target command mapping:

| Command | Telemetry mode | Infrastructure | Purpose |
|---|---|---|---|
| `npm run dev` | `off` | none | ordinary site development |
| `npm run dev:telemetry` | `forced` | local Worker + local D1 | fast telemetry development |
| `npm run dev:production-like` | `consent` | local Worker + local D1 | test the real production privacy/consent flow |

Prefer a single explicit setting such as `PUBLIC_TELEMETRY_MODE=off|forced|consent`. Production must always resolve to `consent`; a local/debug setting must never accidentally force production analytics on.

The `forced` mode bypasses only custom anonymous-analytics consent. Third-party YouTube/Facebook/LinkedIn permission remains contextual in every mode.

**Implementation status:** `dev:production-like` and the explicit three-state mode are part of the privacy implementation TODO and may not exist yet. Until implemented, the current commands below describe the existing local workflow.

### Every time I want to test

| | Command |
|---|---|
| Terminal 1 (Worker + local D1, `:8787`) | `npm run telemetry:dev` |
| Terminal 2 (Astro with telemetry ON, `:4321`) | `npm run dev:telemetry` |
| Open | <http://localhost:4321/> (use `localhost`, not another host or port) |

`dev:telemetry` runs `astro dev --host --force --port 4321` and sets `PUBLIC_TELEMETRY=1` and `PUBLIC_TELEMETRY_ENDPOINT` (to `http://<your LAN IP>:8787/v1/batch`, or `localhost` if there is no LAN address) itself; no environment variables to set. `--force` replaces an already-running Astro dev server and clears the content cache. Plain `npm run dev` still keeps telemetry off.

`telemetry:dev` force-restarts the same way: if port 8787 is already in use (a Worker left running from before), it stops whatever local process is listening there first, then starts a fresh one — no more manually killing a stale Worker before re-running the command. This only ever targets the LOCAL port 8787 listener on your own machine.

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
npm run telemetry:events      # recent events (id, session, elapsed_ms, type, target, view, properties)
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

- **Guaranteed local:** every `telemetry:*` command and `dev:telemetry`. All D1 access goes through one function in `scripts/telemetry.mjs` that hard-codes `wrangler d1 execute --local` and rejects `--remote`, `--env`, `--config`, `--persist-to`; there is no flag or environment variable that switches to remote. `telemetry:dev` runs `wrangler dev --local --ip 0.0.0.0` (reachable from your local network, local D1 only), force-restarting a stale instance on port 8787 first if one is already there (only ever the local port-8787 listener — see "Every time I want to test" above). Options on `sessions`/`events`/`viewport` are limited to `--limit` and `--session`.
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

## 2. Privacy contract

Cross-cutting privacy and consent policy is defined in **`docs/privacy.md`** and is normative for telemetry. The telemetry-specific requirements are:

- Production custom telemetry is **off by default** and starts only after explicit anonymous-analytics consent.
- Before consent, do not create a telemetry session, attach telemetry-only measurement, queue events, or contact the Worker.
- Consent starts a fresh anonymous session from that point forward; never reconstruct/backfill pre-consent behavior.
- A consent preference may be remembered, but must never be used as a visitor identifier or telemetry correlation key. Withdrawal stops future collection.
- Session identity remains visit-only and memory-only. No persistent visitor identity, fingerprinting, session replay, cross-site tracking, raw-IP storage, or intentional PII collection.
- Sanitize referrer to useful scheme/host/path context and strip query/fragment. Keep only the explicit UTM allowlist (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) for public campaign/link attribution.
- Exact viewport/screen dimensions, pointer capabilities, country, visibility/journey measurements, and coarse click-burst diagnostics remain allowed when analytics consent is active, subject to the minimisation boundaries in `docs/privacy.md`.
- The Worker should enforce per-event property allowlists in addition to the closed event vocabulary.
- Raw production `sessions` and `events` expire automatically after **90 days**; longer-lived aggregates must not permit reconstruction of an individual visit.
- Third-party media permission is separate from analytics consent. Telemetry must not treat media permission as analytics consent or vice versa. Provider-loading rules are defined in `docs/privacy.md`.

Local development follows the `off | forced | consent` model described above and in `docs/privacy.md`. `forced` may bypass anonymous-analytics consent for local telemetry work; `consent` must exercise the real production consent lifecycle.

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

Desktop hover or keyboard focus can each reveal Skills transiently, independently of one another; either (or both) can be true at once, and the reveal only ends once neither remains. Clicking Skills can lock the paired reveal. Touch opens/closes both cards together.

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
- `max_visibility_ratio`: the maximum actual intersection ratio observed **while the target was eligible for visibility measurement** (see 6.1) — DEFINITIVE as of the increment in 17.3. Ratio observed while suspended, hidden, or disconnected must never raise it. It is not a "time" field and is not itself nested against the thresholds above, but it shares their eligibility gate.

Thresholds are nested. If an element is 92% visible for four active seconds, v50/v70/v85 each gain four seconds and v95 gains zero.

95% is used instead of 100% to avoid subpixel/layout geometry making "fully visible" unrealistically fragile.

There is no universal "seen" threshold. Interpretation depends on content type.

### 6.1 Eligibility and occlusion

DOM intersection alone is insufficient. A target is eligible only while ALL of:

- document is visible;
- target is rendered/connected;
- target's owning semantic surface is the current surface (not suspended by any other surface, blocking or not).

If Skills or a blocking modal suspends the Timeline, Timeline elements stop accumulating even if their DOM rectangles technically intersect the viewport — and, per the `max_visibility_ratio` change above, geometry observed during that suspension cannot raise the target's max ratio either.

V1 does not require a pixel-perfect arbitrary occlusion engine.

### 6.2 Oversized content

Large content may never reach 85% or 95%. Do not interpret zero high-threshold time as ignored. Coverage-based measurement is a possible future extension, not a V1 requirement.

**Audited (17.3 increment; do not classify a low `max_visibility_ratio` as poor attention without checking this first):**

- `timeline_project`: measured on a 390px-wide mobile viewport (the worst case — `.experience-row`/`.cards` collapse to a single column below 900px, stacking a shared project's two experience cards instead of showing them side by side), the tallest current row (`heroes6`, a two-person shared project) is ~374px — well inside any realistic phone viewport height. Not currently oversized. `ProjectDef.rowSpan`/`squareBottomRight`/`bridgeLeft` (see data/timeline.ts) exist specifically to let a future project card span multiple grid rows and grow much taller than a normal box, but no current entry sets `rowSpan` — if one does, that card could plausibly become genuinely unable to reach 95%/100% on common viewports.
- `skills_person` (`.side-panel-stack`): deliberately capped, on both desktop (`.side-panel { max-height: calc(100vh - 4.5rem) }`) and mobile (`.side-panel.is-open { max-height: calc(100dvh - 3.5rem) }`), so the instrumented box itself cannot grow past roughly one viewport height even when a person's tag content is taller (observed: Ádám's rendered skill list content is taller than Mitko's) — it scrolls internally (`overflow-y: auto`) instead. The box is not oversized; its available height is viewport-relative by design, which matters for future `max_attainable_ratio` work (below).
- `vision_content` / `vision_tooltip`: modest, non-scrolling, in-flow sizes; no clipping ancestor found. `vision_tooltip` panels are absolutely positioned flanking the sentence on wide screens (`.detail-left`/`.detail-right`), so their attainability is a function of total page width and the sentence's own centering, not vertical viewport size — not currently observed to be clipped, but a concrete example of why width matters too, not just height.
- No currently-instrumented target sits inside a smaller inner scroll container in its instrumented context. Skill Filtered View and Project Detail *do* introduce such containers (`.timeline-area` becomes `max-height: calc(100vh - 6rem); overflow-y: auto` while filtering), but content inside them is out of this increment's scope.
- **Future `max_attainable_ratio` note**: none of the above should be solved now, and it is not being added in this increment. When it is, it cannot be computed from raw viewport width/height alone — `skills_person`'s cap is viewport-relative but mediated through two ancestor rules (desktop vs. mobile/`dvh`) with different fixed offsets, and `vision_tooltip`'s constraint is about page width and sibling layout, not the target's own scroll ancestry. Any attainability model needs the complete relevant clipping/scrolling ancestor chain for each target, not just `window.innerHeight`/`innerWidth`.

**Audited (Telemetry Pass 1 increment; project_intro/project_content/filtered_project — measured live via the local dev server, 1280×720 viewport, the actual `.project-modal__panel`/`.timeline-area` scroll containers IntersectionObserver clips against):**

- `project_intro`: compact (title + optional logo + subtitle) in every rendering context — `.node` on the Timeline, `.project-modal__head` in Project Modal and Skill Filtered View. Not oversized anywhere observed.
- `project_content` (`content_type: experience`, the `.modal-exp` / `ExperienceCard` `.card` prose blocks): short paragraphs in the current content data. Not oversized with today's content, though — like any prose block — a future much longer experience description is a plausible future risk, the same caveat any text block carries.
- `project_content` (`content_type: image` / `gif` / `youtube` / `facebook-video` / `facebook-reel` / `image-row`): sized at 16:9 (video/embeds) or intrinsic aspect (images) within the gallery's ~950px inner width — comfortably under a full modal/filtered-view height in every case observed. Not oversized.
- `project_content` (`content_type: linkedin-post`) — **oversized at common viewport heights.** Its frame is `height: min(720px, 85vh)`; measured live (Kreator Studios' one LinkedIn post, the only current example) at a 720px-tall browser viewport, the whole `<figure>` (frame + caption + padding) is **660.7px tall**, while the *enclosing Project Modal's own* `max-height` (`min(900px, calc(100vh - 6rem))`) computes to only **624px** at that same viewport height — the content unit is taller than the container it must fit inside, before any of the header/tags/other gallery items above it are even accounted for. It therefore cannot reach 95% (or realistically 100%) on a browser roughly this tall or shorter; it becomes safely containable only once the viewport is tall enough that `min(900, vh−6rem)` clears figure-height + surrounding chrome (roughly 900–1000px+ of viewport height). Same conclusion applies inside Skill Filtered View's `.fr-card` (no tighter height cap there than the modal case).
- `filtered_project` — **structurally, often severely oversized.** Unlike every other target in this document, a `filtered_project`'s own bounding box is an ENTIRE project's detail — header, tags, every experience block, and its *whole* media gallery — rendered inside `.fr-card`, which sits inside `.timeline-area`'s `max-height: calc(100vh - 6rem); overflow-y: auto` scroll container. Measured live: Supernova (8 gallery items, the heaviest current project) renders **3062px** of content at a 720px viewport, against a `.timeline-area` visible height of ~624px there — under 20% of the card can ever be in view at once, so `max_visibility_ratio` cannot realistically exceed roughly that even scrolled to the most favorable position, and the appearance may frequently never even reach the 50% threshold needed to start being measured at all. This is **content-count-dependent, not universal**: League of Legends Universe (1 image) measured only 533px — comfortably fits a typical filtered-view viewport and is not oversized. Any project with a handful of media items (a normal, common case in this content model, not an edge case) is a plausible `filtered_project` oversized candidate.
- **Consequence for interpretation (raw-data note, not a fix):** a low `max_visibility_ratio` on `filtered_project` for a media-heavy project must not be read as "barely explored" — the visitor may have scrolled through and read the entire card via `.timeline-area`'s own internal scrolling (which the nested `project_intro`/`project_content` deltas for that same project *do* capture reliably, each individually sized well within the viewport) while the outer `filtered_project` wrapper itself structurally could never report a high ratio. This is the same "don't use one target's low ratio to infer the whole thing was ignored" caveat section 6.2 already gives `skills_person`/`timeline_project`, now sharper because the gap between "unavoidably low" and "actually seen" is larger here than anywhere else in the matrix.
- **Future `max_attainable_ratio` note (unchanged conclusion, reinforced):** `filtered_project` is the strongest evidence yet that this future model needs each target's real clipping/scrolling ancestor chain, not viewport dimensions alone — its attainable ceiling is a function of the *ratio* between its own (highly variable, content-dependent) height and a fixed scroll-container cap, not a fixed offset the way `skills_person`'s is.

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
- `vision_content` — Instrumented (17.3/17.4). DEFINITIVE scope: only the actual main-page Vision (the one `hero`-variant instance, rendered once in About.astro). See 17.4.
- `vision_tooltip` — Instrumented (17.4). One target per thought/tooltip; see 17.4 for IDs and trigger semantics.
- `timeline_project` — Instrumented (17.3). DEFINITIVE scope: **every genuine Timeline project preview**, named/boxed or not. The criterion is semantic — "is this a project preview presented to the visitor on the Timeline?" — never "does it have a modal, a name, or boxed styling". Concretely: every `ProjectDef` in `data/timeline.ts` renders exactly one preview row, via one of two component paths (`ProjectRow.astro` for `together` entries, `ApartBlock.astro`'s own inline row markup for `apart` entries — both instrumented identically), and both are instrumented unconditionally, including a company's sole, unnamed project (e.g. `ericsson-consulting`, which still renders its own row — company header + one experience card — just without the boxed/clickable styling that only a *named* project also gets). There are no current exclusions: every `ProjectDef` is a genuine preview. `target_id` is the canonical id (`project.modalId ?? project.id`) — the same one `project_open`/`project_close` already use — never a `tl-*` presentation id.
- `contact`
- person-relevant Contact exposure where useful

### Skills
- `skills_person:mitko` — Instrumented (17.3).
- `skills_person:adam` — Instrumented (17.3).

### Project presentation, intro, and content
- `filtered_project` — Instrumented (17.6).
- `project_intro` — Instrumented (17.6).
- `project_content` — Instrumented (17.6). Covers every discovered content unit type: `experience`, `image`, `gif`, `video`, `facebook-video`, `facebook-reel`, `youtube`, `linkedin-post`, `image-row`, `text` (see 17.6 for the full taxonomy and why this superseded the `project_experience`/`project_text`/`project_image`/`project_video` placeholders this section originally listed). The playable kinds (`video`, `gif`, `facebook-video`, `facebook-reel`, `youtube`) additionally accumulate the playable-exposure/known-playback families — see section 9 and 17.7.

Instrument meaningful semantic content, not every descendant DOM element.

## 9. Video and playable media

Do not use 25/50/75/100 percent milestones. Visibility Matrix information is more useful for this site, and known video duration belongs to content metadata rather than repeated telemetry.

**Implemented (Telemetry Pass 2 — see 17.7 for the full taxonomy, per-kind semantics, and live verification).** For every `project_content` media item that is genuinely playable, two additional measurement families run alongside the ordinary Visibility Matrix (section 6), sharing its accounting engine rather than a second one:

- **Playable exposure** — `playable_v50_ms` / `playable_v70_ms` / `playable_v85_ms` / `playable_v95_ms`: how long the item was exposed at each threshold in a state where it could meaningfully be watched or played. Does **not** assert playback occurred.
- **Known actual playback** — `playing_v50_ms` / `playing_v70_ms` / `playing_v85_ms` / `playing_v95_ms`: how long the item is *known* to have actually been playing while exposed at each threshold, only where real playback state is reliably observable.

Both families are strict subsets of the ordinary `v50-v95` family and of each other at every instant (`playing_vX <= playable_vX <= vX`), by construction of the accounting rather than a separate check. 50% is the baseline for both — below it, neither accumulates, even if a provider technically continues playing off-screen. No standalone `playable_ms`/`playing_ms` exist; 50% is already the minimum meaningful threshold, so an un-nested total would be redundant.

`video_start` is recorded at most once per appearance, only for a kind with real observable playback state, only at the instant `playing_v50` would actually start accruing (playing AND >=50% visible AND otherwise eligible) — never merely because media became visible, an iframe was created, autoplay was requested, or provider UI appeared. Start vs. resume within the same appearance is distinguished by the appearance boundary itself (docs section 7): a pause/resume that doesn't leave and re-enter the appearance never re-fires it.

For external embeds, record only information exposed reliably by the provider/browser. Do not infer inaccessible iframe playback — see 17.7 for exactly what each media kind can and cannot report, and the real Facebook lifecycle findings.

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
- `click_burst`
- `action_failed`

`repeated_noninteractive_click` was retired in Pass 4 (section 17.9): it is no longer in the vocabulary or the Worker allowlist. Historical rows, if any, are untouched and no migration was needed.

### Measurement
- `visibility_delta`

The vocabulary may be normalized during implementation if multiple names are better represented by one generic event + properties, but semantics must remain documented here.

## 11. Event semantics

### Skills

`skills_open` should include:
- `trigger_person: mitko | adam`
- `trigger_method: hover | focus | mouse | touch | pen | keyboard` as actually knowable
- initial lock state

Skills visibility is conceptually `hovered || focused || locked`: hover, keyboard focus and the explicit lock are independent reveal reasons, and more than one can hold the same presentation open at once (e.g. a card that is both hovered and keyboard-focused). `skills_open` fires on the closed → open transition regardless of which reason caused it; a reason joining an already-open presentation (hover arriving while it is open from focus, or vice versa) must not emit a second open. A deliberate desktop click that changes an already-hovered/focused presentation into persistent locked state should be represented as a lock transition rather than a second open.

`skills_close` should record the actual code path, such as:
- `hover_leave`
- `focus_leave`
- `explicit`
- `outside`
- `escape`
- `navigation`

`hover_leave` and `focus_leave` each clear only their own reveal reason — Skills stays open, unannounced, while hover, focus or lock still holds it, and closes only once none remain (so it stays open while hover leaves but focus remains, while focus leaves but hover remains, or while locked regardless of hover/focus). Any other reason is a deliberate close-everything signal. Unlocking (`skills_unlock`) behaves the same way: it only actually closes Skills if neither hover nor focus is still holding it open. Only include `trigger_person` when a person's control actually caused the close.

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

Implemented in Telemetry Pass 4 — full behavior in section 17.9.

- **Ordinary clicks are never sent.** There is no global click logging.
- `noninteractive_click` — one allowlisted noninteractive semantic element was activated. Means only that; never confusion.
- `click_burst` — a confirmed burst of >= 3 pointer activations close in time and space, anywhere on the page, whether or not the targets are interactive. Objective facts only.
- `context_menu` — the browser context menu was invoked over a meaningful semantic target. Never a copy/open/save.
- `action_failed` — one of our own deliberate user actions objectively failed.

"Rage click", "confused", "frustrated" and "intent" are analysis labels only, never raw schema terms. The earlier same-target `repeated_noninteractive_click` heuristic was replaced by `click_burst` (which has no same-target requirement).

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

  playable_v50_ms INTEGER,
  playable_v70_ms INTEGER,
  playable_v85_ms INTEGER,
  playable_v95_ms INTEGER,

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
- `playable_v*`/`playing_v*` are null for every event that isn't a `visibility_delta` on a playable-media `project_content` target — see section 17.7. A standalone (un-nested) `playable_ms`/`playing_ms` is deliberately never added: 50% is already the baseline threshold for both families, so an un-nested total would be redundant with `playable_v50_ms`/`playing_v50_ms`. Migration `0002_playable_media.sql` adds the `playable_v*` columns and drops the initial migration's speculative, never-populated standalone `playing_ms` column.
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

Source: `src/lib/telemetry/` (tests in `src/lib/telemetry/test/`, run with `npm run telemetry:test`). Entry point: `src/scripts/telemetry.client.ts`, loaded from `src/pages/index.astro`. Session creation, `session_start`, the queue, transport, lifecycle flushing and `viewport_changed` (section 13.1), the semantic state coordinator and its state-transition events (section 17.2), and the Visibility Matrix engine (section 17.3).

| File | Responsibility |
|------|----------------|
| `types.ts` | Wire types mirroring the Worker contract |
| `config.ts` | The single enablement decision (pure) |
| `session.ts` | Random ID, UTM parsing, session context |
| `queue.ts` | In-memory queue, event creation, `elapsed_ms` |
| `transport.ts` | Batching, single-flight flush, retry/backoff |
| `viewport.ts` | Resize coalescing / noise filtering for `viewport_changed` (pure, injected timers) |
| `uiEvents.ts` | Dependency-free contract between UI scripts and the coordinator (event names, detail types, `announce()`) |
| `state.ts` | Semantic state coordinator + `bindUiEvents()` (section 17.2) |
| `visibility.ts` | Visibility Matrix engine: appearance lifecycle + nested-threshold accounting (section 17.3) |
| `explicitEvents.ts` | Pure payload construction for explicit-action events — `nav_click`, `cv_download`, `linkedin_click`, `contact_email_copy`, `contact_email_open`, `external_link_click` (section 17.8) |
| `client.ts` | Browser wiring: session start, timers, page lifecycle, resize listener, the Visibility Matrix engine's materialize/pause/resume |
| `index.ts` | Public API: `initTelemetry()`, `telemetry.emit(type, opts)`, `telemetry.flush()`, `telemetry.observeVisibility(el, type, id)`, `semanticState` |

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

### 17.2 Implemented semantic state model and state-transition events (step 6)

Source: `src/lib/telemetry/state.ts` and `uiEvents.ts`; tests in `test/state.test.ts`. No visibility, appearance, Vision, Contact, navbar or noninteractive-click telemetry exists yet.

**Surfaces.** `main` | `skills` | `project_modal` | `skill_filtered`. About/Timeline/Contact scrolling is *not* a surface change; they are sections of `main`.

**Layers.** `main` is always present. Skills is an optional layer over it. A blocking view (Project Detail or Skill Filtered View) is an optional layer over both. The current surface is the topmost layer; everything beneath is *suspended*. Closing a blocking view restores what was beneath: `skills` if the Skills layer is still up (the real UI leaves Skills locked beneath the filtered view and it reappears when the filter closes), otherwise `main`. Restoration never emits a second `skills_open`.

**Reading state** (`import { semanticState } from '../lib/telemetry'`):

| Field | Meaning |
|---|---|
| `surface` | current surface |
| `projectId` | canonical project ID while `project_modal` |
| `skillId` | canonical skill/tag ID while `skill_filtered` |
| `skillsMode` | `locked` whenever the lock reveal reason is active, else `hover` (covers hover-only, focus-only, or both) whenever a Skills layer is up (also while suspended); else null |
| `viewInstanceId` | instance ID of the current blocking surface; null on `main` |
| `underlying` | `main` / `skills`: what the surface becomes if the current blocking view closes |
| `navbarAvailable` | true on `main` and `skills`; false on `project_modal` and `skill_filtered` |

`semanticState.isActive(owner)` is the question the visibility engine asks: a target is eligible only if its owning surface *is* the current surface. `subscribe(fn)` reports changes. State is tracked whenever `initTelemetry()` has run, even with telemetry disabled (emission is then a no-op); the coordinator only listens and never drives the UI.

**How the UI feeds it.** UI scripts announce transitions they have *already performed* as `document` CustomEvents (`ui:skills-open`, `ui:skills-lock`, `ui:skills-unlock`, `ui:skills-close`, `ui:skill-click`, `ui:filter-open`, `ui:filter-close`, `ui:project-open`, `ui:project-close`), the same pattern as `filter:opened`. The coordinator never polls DOM/CSS. Announcing cannot throw, and with no listener the UI behaves identically.

| UI code | Announces |
|---|---|
| `panelToggle.client.ts` card `pointerenter` (not already revealed) | `skills-open` (hover) |
| card `pointerleave`, pointer off both cards and focus not holding it open | `skills-close` `hover_leave` |
| `.person-bar-inner` `focusin` (not already revealed) | `skills-open` (focus) |
| `.person-bar-inner` `focusout` past its last element (`relatedTarget` outside the bar), not locked and not hovered | `skills-close` `focus_leave` |
| Skills button, desktop, becomes locked | `skills-open` locked (a lock if already hovered/focused open) |
| Skills button, desktop, unlocked again | `skills-unlock`; only also collapses/`skills-close` `explicit` if neither hover nor focus still holds it open |
| Skills button, touch | open (locked) / close `explicit` |
| skill tag or filter pill click (desktop; auto-locks) | `skills-lock` (`cause`: `skill_click` / `filter_pill`) |
| click outside the cards | `skills-close` `outside` (`navigation` if the click was in the navbar) |
| Escape (only when not locked) | `skills-close` `escape` |
| `tagFilter.client.ts` linked tag click | `skill-click`, then `filter-open` / `filter-close` |
| `tagFilter` filter cleared | `filter-close` with reason `chip`, `backdrop` (handed over by `filterModal`), `card_pill`, `escape`, `skill_toggle` |
| `tagFilter` direct swap to another skill (code path exists; currently unreachable because the skills panel is collapsed in the filtered view) | `filter-close` `skill_switch` + `filter-open` |
| `projectModal.client.ts` dialog `open` attribute (MutationObserver, the authoritative signal) | `project-open` / `project-close` |

**Events emitted.** All go through the normal queue (`telemetry.emit`); all pass the Worker's strict validator.

| Event | target | `view_instance_id` | properties |
|---|---|---|---|
| `skills_open` | none | new Skills instance | `trigger_person` (mitko/adam), `trigger_method` (hover/focus/mouse/touch/pen/keyboard), `locked` |
| `skills_lock` | none | Skills instance | optional `trigger_person`, `cause` |
| `skills_unlock` | none | Skills instance | optional `trigger_person`; also carries an immediate `skills_close` (`explicit`) if that was the last reveal reason |
| `skills_close` | none | Skills instance | `reason` (hover_leave / focus_leave / explicit / outside / escape / navigation), `locked` (was locked), `trigger_person` only for the explicit toggle |
| `skill_click` | `skill` : tag ID | current Skills instance if any | `trigger_person` (owner of the clicked card) |
| `skill_filter_open` | `skill` : tag ID | new filter instance | none |
| `skill_filter_close` | `skill` : tag ID | that filter instance | `reason` |
| `project_open` | `project` : canonical ID | new project instance | none |
| `project_close` | `project` : canonical ID | that project instance | `reason` (explicit / backdrop / cancel) |

Properties whose value the code cannot determine are omitted, never guessed. `trigger_person` on Skills means who caused the transition, not whose skills were viewed (both are always shown). Ordering within one click is by queue order; `elapsed_ms` can tie.

**Canonical IDs.** `project_id` is the project catalog key (`project.modalId ?? project.id`, matching `key` in `data/projectCatalog.ts`), emitted on the dialog as `data-project-id`. The `tl-...` modal ID is never used. `skill_id` is the WorkTag id (`data-tag-id`). IDs failing the Worker's `[A-Za-z0-9_.:-]{1,64}` rule are dropped before emitting (the surface still changes), because one invalid event would make the Worker reject its whole batch.

**`view_instance_id` lifecycle.** A fresh random ID (`randomId()`) per Skills opening, Project Detail opening and Skill Filtered View opening. It is constant for that instance, including Skills lock/unlock and all its close events, and changes on the next distinct opening (reopening the same project is a new instance). `main` has none: scrolling never creates one. Skills lock/unlock/close and `skill_click` carry the Skills instance so later visibility deltas and clicks group correctly.

**Nesting / suspension details.**
- Skills is announced only when actually presented. If the UI raises the Skills class while a blocking view is up (e.g. hovering a person card in a project dialog, where CSS keeps the panel collapsed), the layer is remembered silently; if it is still up when the blocking view closes, `skills_open` is emitted then; if it went away first, no open/close pair is emitted.
- A click that both dismisses Skills and opens a project ends the same way in either listener order: `project_modal`, then `main` on close.
- A blocking open while another blocking view is up closes the first (reason `superseded`); unreachable in the current UI.
- Duplicate callbacks (repeated `pointerenter`/`focusin`, a second outside-click with nothing open, repeated open/close) are ignored by state, so they emit nothing.
- Skills visibility is `hovered || focused || locked`, tracked as three independent reveal reasons rather than one mode. A reason joining an already-open presentation never emits a second `skills_open`; `hover_leave`/`focus_leave` each clear only their own reason and Skills closes (emitting `skills_close`) only once none remain — so it stays open, unannounced, across e.g. hover → focus → hover leaves → focus leaves, in either order, and across locking/unlocking while hover or focus also holds it open. This keeps the announced semantic state from disagreeing with the actual UI, which reveals Skills via CSS `:focus-within` independently of the hover/lock classes (see `panelToggle.client.ts`).

**Known limits / differences from the UI (reported, not redesigned).**
- Touch Skills opens `locked: true` (it persists until toggled or dismissed, like a lock).
- Project Detail's `cancel` reason comes from the dialog's native `cancel` event, so a mobile back gesture (or any other platform cancellation) that cancels the dialog is also `cancel` — deliberately not `escape`, since only the browser/platform cancellation is actually known, not which physical input triggered it.
- Section 11 lists close reason `outside`; the request for this step suggested `outside_click`. The documented name `outside` is used.
- Navbar clicks while Skills is up close Skills (the navbar click is also an outside click), reason `navigation`. `nav_click` is instrumented as of Telemetry Pass 3 (section 17.8) and reads `origin_surface`/`skills_mode` from this same coordinator, before the click's own `skills_close` (`navigation`) fires.
- Clicking a tag inside the Skills panel on desktop auto-locks it (existing UI behavior not previously documented); that is the `skills_lock` with `cause: skill_click`.
- Clicking the Skills toggle button itself can incidentally give it keyboard focus (Chromium does this on click; Firefox/Safari on macOS normally do not), which is then a genuine focus reveal reason like any other — so on Chromium, unlocking via a mouse click can leave Skills open (revealed by that residual button focus) until focus or hover actually leaves, matching what `:focus-within` shows. This is observed, not corrected, per the same "report the UI, don't drive it" rule the CSS focus behavior already gets everywhere else.

**Manual browser test** (local workflow above; `npm run telemetry:events` now also prints a `view` column, the first 8 chars of `view_instance_id`):
1. `npm run telemetry:clear`. Terminal 1: `npm run telemetry:dev`. Terminal 2: `npm run dev:telemetry`. Open <http://localhost:4321/> in a desktop browser and scroll into the Timeline so the person cards dock.
2. Hover a card, then move away: `skills_open` (hover, `locked:false`) then `skills_close` `hover_leave`.
3. Hover, click Skills (locks), click a skill tag, click the dimmed backdrop, click Skills again: `skills_open`, `skills_lock`, `skill_click`, `skill_filter_open`, `skill_filter_close` (`backdrop`), `skills_unlock`, `skills_close` (`explicit`). The Skills events and the click share one `view`; the filter has another.
4. Click a timeline project and close it with the ✕; reopen it and press Escape: `project_open` / `project_close` (`explicit`, then `cancel`) with the same `project:<id>` and different `view` values.
5. Keyboard only, mouse off both cards: Tab onto a card's Skills button: `skills_open` (`focus`, `locked:false`). Tab again into a skill tag inside it (still revealed, one `view`, no new event), then Shift+Tab back out past the Skills button entirely: `skills_close` (`focus_leave`).
6. Tab onto a card's Skills button (opens, `focus`), then also hover that same card (no 2nd `skills_open`), then move the pointer away (stays revealed — still focused, no event): only Shift+Tab out of the bar then actually closes it, `skills_close` (`focus_leave`). Reversed (hover first to open, then Tab into it, then move the pointer away first — stays revealed, still focused, no event — then Tab out last): closes on that last step instead, `skills_close` (`focus_leave`) again, since focus was what was still holding it open either way. Swap which one leaves last (Tab out first while still hovering, then move the pointer away) and the recorded reason swaps to `hover_leave` — whichever reason is still true right before the other one leaves is the one recorded on the close that actually happens.
7. Wait ~20 s (or switch tabs to force a flush), then `npm run telemetry:events -- --limit 40`. Repeat on a phone: Skills opens with `touch` and `locked:true`.

### 17.3 Implemented Visibility Matrix engine (step 7)

Source: `src/lib/telemetry/visibility.ts` (tests in `test/visibility.test.ts`). DOM wiring: `src/scripts/visibility.client.ts`, loaded from `src/pages/index.astro`. Public entry points on `telemetry` (`index.ts`; all silent no-ops until `initTelemetry()` has run or whenever telemetry is disabled): `observeVisibility(el, targetType, targetId)`, `setVisibilityTriggerContext(el, method)`, `endVisibilityAppearance(el)` (the latter two exist for `vision_tooltip` — see 17.4).

**Scope.** Four target types, matching section 8:

| `target_type` | Owning surface | DOM source | `target_id` | `view_instance_id` |
|---|---|---|---|---|
| `vision_content` | `main` | the one hero `Vision` instance (`About.astro`) — DEFINITIVE, see 17.4 | `vision` (stable, singular) | none (main never acquires one) |
| `vision_tooltip` | `main` | each thought's `.detail` panel (`Vision.astro`, hero instance only) — see 17.4 | the thought's own content id (`data/thoughts.ts`) | none |
| `timeline_project` | `main` | **every** `.project-row` (`ProjectRow.astro`, `together` entries) / `.track-row` (`ApartBlock.astro`, `apart` entries) — see the audit below | `project.modalId ?? project.id` — the same canonical id `project_open`/`project_close` already use (section 17.2) | none |
| `skills_person` | `skills` | each person's `.side-panel-stack` (`ScrollyRegion.astro`) — the actual skills-tag content, not the whole card | `mitko` / `adam` | the current Skills `view_instance_id` |

Owner is derived from `targetType` in code (`OWNER` map in `visibility.ts`), not read from the DOM — the markup only carries `data-visibility-target-type` / `data-visibility-target-id`. Registering an unrecognized `targetType` is a no-op (a deliberate scope guard). Everything else section 8 lists (`contact`, `filtered_project`, `project_experience`, `project_text`, `project_image`, `project_video`) is out of scope.

**Timeline project audit (this pass).** The first increment only instrumented `ProjectRow.astro`'s named/boxed rows, which covers `together` entries (Mentor/shared companies) but **completely missed `ApartBlock.astro`**, a second, independent rendering path with its own inline `.track-row` markup used for every `apart` entry (each person's own separate company/project — all of Mitko's and Ádám's solo/personal/Mentor-era work). That path is now instrumented identically. Both paths are also now unconditional on `project.name` (previously gated on it), because "has a name/modal/boxed styling" is presentation, not the definition of a project — the sole current example this matters for is `ericsson-consulting` (Mitko's 2007–2008 Ericsson Hungary consulting work), a genuine, single-project company whose project omits `name` (the UI folds the project preview into the company header instead of showing a separate title), but which still renders its own row (company header + one `ExperienceCard`) and is therefore a genuine preview. **Every one of the 16 current `ProjectDef` entries is a genuine Timeline project preview; there are no current exclusions.** `ProjectDef.rowSpan`/`modalId`/`noModal`/`squareBottomRight`/`bridgeLeft` (the split/spanning machinery referenced in code comments) are not exercised by any current entry — there is currently no split project with two DOM representations in the live data, though the engine still supports it (two DOM targets, one canonical id) for when one reappears.

**Two independent concerns.**

- **Appearance identity** (`startAppearance`/`endAppearance`) is driven purely by IntersectionObserver geometry (thresholds `[0, 0.5, 0.7, 0.85, 0.95, 1]`, `intersectionRatio` read directly) plus the 300 ms grace period (section 7) and one additional rule below. An appearance is "one continuous opportunity to encounter the target" — it does **not** end just because a blocking surface suspends counting, the same reasoning section 5/19 already give for a hidden tab: lost measurement opportunity, not evidence the visitor scrolled away.
- **Active-time accounting** (nested `v50`/`v70`/`v85`/`v95` counters, and — as of this pass — `max_visibility_ratio` too) only adds/raises while ALL of: the document is visible, the target is connected (`Element.isConnected`), and its owning surface is the current semantic surface (`semanticState`-equivalent check, cached internally). Suspending a target pauses counting without touching its appearance.

**Instance-boundary rule (the one addition beyond section 7).** A `skills_person` appearance is force-ended immediately when the current Skills `view_instance_id` changes away from the one it started under — even before geometry reflects it — because opening a blocking view (Project Detail / Skill Filtered View) over Skills, or Skills itself closing, must stop that accounting immediately, and "never let visibility deltas from one blocking view instance leak into another" (section 17.2) applies to visibility deltas exactly as it does to click/open/close events. In the real UI this is never a bare truncation: the `.side-panel-stack` CSS already collapses to `height: 0` (ratio 0) under `body[data-modal-people]` and revives when Skills is restored, so geometry independently backs up the same conclusion — the forced end just makes it immediate instead of waiting on that transition. `vision_content`, `vision_tooltip`, and `timeline_project` (owner `main`) have no view instance and are unaffected by this rule; suspending them (e.g. Skills opening over the Timeline) pauses counting on the *same* appearance, which resumes once `main` is current again.

**Timing/accounting boundaries.** Every place ratio, semantic state, or document visibility can change first calls an internal `account(target, now)` that adds elapsed time (since the target's last boundary) to whichever nested counters were eligible *before* the change, then moves the boundary to `now`. This is the single mechanism behind every boundary case: threshold/ratio changes, semantic transitions, document visibility changes, `materialize()`, and appearance end. Ratio and eligibility are safe to treat as constant across an elapsed span because this is the only place either can change.

**Appearance lifecycle.**
- Starts the first time geometry reaches `intersectionRatio >= 0.5`; gets a fresh `appearance_id` (`crypto`-backed random id; no CSPRNG means that encounter is silently left untracked, like the rest of telemetry).
- A dip below 50% arms a 300 ms grace timer. Recovering to >=50% before it fires cancels the timer and continues the *same* appearance; no time is added for the dip itself (grace preserves identity only, never visibility time — the counters simply see `ratio < 0.5` and add nothing).
- The timer firing (>300 ms continuously below 50%) ends the appearance: any unsent deltas are drained under the outgoing `appearance_id` first, then it is cleared. The next `>=0.5` crossing gets a new `appearance_id`.
- A target's own UI can also end its appearance immediately, bypassing geometry/grace entirely — `endVisibilityAppearance(el)` (used by `vision_tooltip`; see 17.4).
- `max_visibility_ratio` (**eligibility-aware as of this pass** — see section 6) is the running max `intersectionRatio` observed *while eligible* during the current appearance; it resets to 0 when a new appearance starts, and a ratio observed while suspended/hidden/disconnected is recorded on the target (accounting still needs the real current ratio once eligibility returns) but never raises this max.

**Document visibility.** `client.ts` calls `visibility.pause()` on `visibilitychange -> hidden` (accounts through the hide instant under the still-true visible flag, then flips it false) and `visibility.resume()` on `-> visible` (accounts the hidden span at zero under the still-false flag, then flips it true and moves every target's boundary to now). Neither call ends any appearance: a hide/show pair preserves the same appearance for the same DOM target and semantic view instance, exactly as section 7/19 already reason for a hidden tab being lost measurement opportunity rather than departure evidence.

**Flush integration (the "clean integration point").** `VisibilityMatrixEngine.materialize()` accounts elapsed time through now for every registered target and drains whatever is newly accumulated into the existing queue (via the same injected `emit` the rest of the client uses — no direct `fetch`, no retry/backoff logic in this file). `client.ts`'s `safeFlush(lifecycle)` calls it first, before `transport.flush()`, for every flush path: the periodic ~20 s timer, the `visibilitychange -> hidden` flush, and `pagehide`. This guarantees a delta produced between flushes is captured by the very next batch rather than left stranded past a flush that already ran. The documented hide sequence is: (1) `visibility.pause()` accounts through the hide instant and stops counting, (2) `safeFlush`'s own `materialize()` call drains whatever that just accounted, (3) `transport.flush({ lifecycle: true })` sends it.

**Semantic state-boundary flush (this pass).** Skills open/close, Project Detail open/close, and Skill Filtered View open/close all change `semanticState.surface`. The engine's own `onStateChange` (already subscribed to `semanticState` for eligibility) now, on every `surface` change: accounts every target under the OLD surface through the transition instant (unchanged — this was already correct); applies the instance-boundary rule; switches to the new surface; **drains every target's newly-unsent deltas; then calls the injected `requestFlush()`**, which `client.ts` wires to the same non-lifecycle `safeFlush(false)` the periodic timer uses (respecting backoff, using the existing queue/transport — never a direct `fetch`, and no new logic in any UI script). Concretely this means: opening a blocking surface drains and promptly flushes whatever `main` (or `skills`) had just measured; closing one drains and promptly flushes whatever the blocking surface itself had just measured. A transition with nothing newly accumulated (e.g. Skills locking/unlocking, which doesn't change `surface`; or two transitions back-to-back with no elapsed time between them) still calls `requestFlush()` — so the semantic transition event itself (`skills_open`, `project_close`, ...) is sent promptly too — but never drains a zero delta, so there is no duplicate/zero-time spam. Ordering note: `SemanticStateCoordinator` (17.2) already queues the transition event itself *before* calling `notify()` (which is what triggers `onStateChange`), so by the time `requestFlush()`'s `transport.flush()` call captures its batch, both that event and these deltas are already queued — the task's suggested "materialize, then queue the transition event, then flush" order is inverted relative to what section 17.2's existing emit-then-notify pattern does, but the actual guarantee (both are queued before the network call) holds regardless of which is queued microseconds earlier within the same synchronous turn; changing `state.ts`'s emit/notify order was not necessary and was not done.

**Delta semantics.** `visibility_delta` carries `target_type`, `target_id`, `appearance_id`, `view_instance_id` (only for `skills_person`, and always the instance the appearance *started* under, even if the live instance has since changed — so a late-draining delta still lands on the instance it actually measured), `v50_ms`/`v70_ms`/`v85_ms`/`v95_ms` as **deltas since the previous materialization** (never lifetime snapshots), `max_visibility_ratio` (not a delta — the current eligible running max), and an optional `properties.trigger_method` (only ever present for `vision_tooltip`; see 17.4). A drain is skipped entirely when it would add zero `v50_ms` (nested thresholds mean any real accounted time implies `v50_ms > 0`), so periodic materialization and state-boundary flushes alike never send zero-time noise.

**Testable seams.** `VisibilityMatrixEngine` takes an injected monotonic clock, `setTimer`/`clearTimer`, `newId`, `emit`, `getState`/`subscribe` (the same shape `semanticState` in `index.ts` exposes), an optional `requestFlush`, and an optional `observeElement` (defaults to a real `IntersectionObserver` at `[0, 0.5, 0.7, 0.85, 0.95, 1]`; tests inject a fake that drives ratios manually, with no DOM/layout engine involved).

**Known limits / assumptions (reported, not silently redefined).**
- Target connectivity (`Element.isConnected`) is checked at every ratio observation, but nothing observes DOM removal directly (no `MutationObserver`) — acceptable because none of the four target types are ever removed from the DOM in the current UI; a future target family that can unmount mid-session would need that added.
- The instance-boundary forced end for `skills_person` assumes the real `.side-panel-stack` CSS collapse always accompanies a Skills-instance change (verified by reading `ScrollyRegion.astro`), so a subsequent real re-appearance is never missed. The engine does not independently re-check geometry when eligibility is restored — appearance start is geometry-event-driven only, per section 7's wording ("Starts when target reaches >=50%").
- "Every genuine Timeline project preview registers correctly" (per-category coverage across Mentor/shared, Mitko-only, Ádám-only work) is verified live (17.5's manual verification), not by a `node:test` unit test — that claim is fundamentally about real Astro-rendered markup across both rendering paths, which the pure-engine unit tests (driven by fake elements) cannot exercise.

### 17.4 Implemented Vision tooltip visibility (step 8 completion)

Source: `src/scripts/vision.client.ts` (announces; stays dependency-free of telemetry, importing only `uiEvents.ts`, same as every other UI script) and `src/scripts/visibility.client.ts` (the only place that listens and drives the engine). Markup: `Vision.astro`'s `.detail` panels (the "tooltip" for each clickable thought-phrase).

**Scope — DEFINITIVE main Vision.** `vision_content` and `vision_tooltip` both refer *only* to the actual main-page Vision: the single `variant="hero"` instance rendered once in `About.astro`. The `preview` variant (`Vision.astro`'s other mode, embeddable inside a Timeline project card via `ProjectDef.showVision`) is not a second Vision occurrence — no current entry in `data/timeline.ts` sets `showVision` (it is currently dead code: the historical Together-Again/project-card Vision copy this once supported was removed from the site), and even if it were used again, it would be that project's own content, not the main Vision. Both target types are gated on `variant === 'hero'` in `Vision.astro`, not merely on "there happens to be only one instance" — so this remains correct even if `showVision` is ever reintroduced.

**Tooltip IDs.** Each of the six tooltips uses the corresponding thought's own stable content id from `data/thoughts.ts` (`in-sync`, `shipped-experiences`, `true-ownership`, `easy-integration`, `complete-development`, `built-to-scale`) — never the scope-prefixed DOM element id (`hero-detail-in-sync`) and never generated/positional/translated-text ids. These ids already existed in the content model for an unrelated reason (building the detail panel's element id and matching the description copy); no data-model change was needed.

**Eligibility.** `vision_tooltip` is owned by `main`, exactly like `vision_content`: it accumulates only while `main` is the current surface, pauses immediately when Skills/Project Detail/Skill Filtered View suspend it, and resumes on the same appearance once `main` is current again (main has no view-instance concept, so no forced end — same as `vision_content`/`timeline_project`).

**Appearance lifecycle — immediate end, not grace-based decay.** `vision.client.ts`'s `closeAll()`/`openDetail()` toggle the `hidden` attribute synchronously (no CSS transition on this element, unlike the Skills panel's animated reveal) — a genuinely discrete, UI-known "this tooltip just stopped being presented" moment. Rather than rely on IntersectionObserver eventually reporting the resulting ratio-0 and waiting out the 300 ms grace, `vision.client.ts` announces `ui:vision-tooltip-hide` (see `uiEvents.ts`) on every real open→closed transition, and `visibility.client.ts` resolves the tooltip id back to its DOM element and calls `engine.endAppearanceNow(el)`, which accounts elapsed time up to now and drains the final delta immediately. This was a deliberate choice beyond "obey the existing 300 ms semantics": an explicit, deliberate UI close is a known fact, not geometric ambiguity, so ending immediately (mirroring the `skills_person` instance-boundary rule) is more accurate than waiting — and it is also a defense against IntersectionObserver delivery itself being delayed or suspended in some hosting/embedding contexts (observed firsthand: a browser tab/pane that is occluded/not being composited can suspend all IntersectionObserver callback delivery, even for a plain, non-animated, on-screen element — see 17.5). `openDetail()`/`closeAll()` announce **only on a genuine closed→open / open→closed transition**, never on a redundant re-entry of an already-active part (e.g. `mouseenter` re-firing) — the existing DOM/animation-retrigger behavior for that case is untouched, but telemetry never sees a spurious flicker.

**Trigger method.** Recorded as `properties.trigger_method` on every `visibility_delta` of the appearance it belongs to (via `engine.setTriggerContext(el, method)`, called right when the UI shows the tooltip; consumed into the appearance when geometry confirms it, cleared when the appearance ends). Only values the DOM event actually exposes are ever used — nothing is guessed:
- `hover` — a hover-capable device's `mouseenter`.
- `focus` — the `focus` event opened it. This is deliberately used for BOTH real keyboard Tab focus and a touch tap's first-focus-before-click (browsers fire `focus` before `click` on first tap; `FocusEvent` carries no pointer-type information, so these two cases are genuinely indistinguishable here — recording `touch` for a plain `focus` event would be a guess, which section 17.4 (and the general telemetry principle) forbids).
- `click` — a `click` event opened it (the hover-device "click just ensures shown" path, or non-hover "tap the active part" path) and the browser did not report `pointerType: 'touch'` on that event.
- `touch` — a `click` event opened it and `(event as PointerEvent).pointerType === 'touch'` — a real, checkable signal (the same technique `panelToggle.client.ts`'s `clickMethod()` already uses for Skills), not an inference.

If a tooltip is opened by whatever caused a stray IntersectionObserver-only re-observation with no matching `ui:vision-tooltip-show` (shouldn't happen in the current UI, since geometry only ever changes as a direct result of the `hidden` toggle), no `trigger_method` is attached — properties are additive, never invented.

### 17.5 Manual verification (this pass)

Local workflow as in 17.1-17.2. Findings, real D1 rows unless noted:

- **Timeline coverage**: after the `ApartBlock.astro` fix, `document.querySelectorAll('[data-visibility-target-type="timeline_project"]')` returns all 16 current `ProjectDef` entries with correct canonical ids, including `ericsson-consulting` (the one unnamed project) — confirmed live in the rendered DOM.
- **Semantic state-boundary flush (goal 3) — confirmed live, precisely.** Drove the full boundary sequence from the task (Skills open → close → Project Detail open → close → Skills open → skill click → Skill Filtered View open → close) via real DOM interaction, with **no manual flush trigger** (no tab switch, no 20 s wait) between any of them. Every event — `skills_open`, `skills_close`, `project_open`, `project_close`, `skills_open`, `skill_click`, `skill_filter_open`, `skills_lock`, `skill_filter_close` — landed in local D1 within roughly a second of the interaction that caused it, each still in the exact order performed. This is direct, live confirmation that `requestFlush()` (wired to `client.ts`'s non-lifecycle `safeFlush(false)`) fires on every real surface transition and is not waiting on the periodic safety flush.
- **Vision tooltip UI wiring (goal 5) — confirmed live at the DOM/event level.** With listeners attached for `ui:vision-tooltip-show`/`-hide`, real DOM events produced exactly the expected announcements: hovering the first thought-phrase → `{tooltipId: 'in-sync', method: 'hover'}`; moving the pointer off the Vision root → `{tooltipId: 'in-sync'}` (hide); a plain `click` (no pointer type) on a second phrase → `{tooltipId: 'shipped-experiences', method: 'click'}` (not `'touch'`, correctly, since no pointer type was reported). Canonical ids are confirmed to be the thought content ids, not DOM ids.
- **`max_visibility_ratio` eligibility (goal 2) and the tooltip appearance/threshold pipeline downstream of geometry** were **not** re-confirmed with fresh live `visibility_delta` rows in this pass — see the concern below. They are covered by 15 new deterministic unit tests (`test/visibility.test.ts`) exercising the exact same code paths, and by this session's earlier live confirmation (same underlying `account()`/suspend/resume machinery, millisecond-exact: a `timeline_project` delta of `4397 ms` against an expected `19991 − 15595 = 4396 ms` eligible span across a Skills suspension).
- **Concern — this tool's Browser pane stopped delivering IntersectionObserver callbacks partway through this session.** Diagnosed directly: a bare, code-free `new IntersectionObserver(...)` attached to a genuinely on-screen, non-zero-size element delivered **zero** callbacks — not even the guaranteed initial one — while the desktop app's Browser pane was in its "currently hidden" (not composited) state, which is how it stayed for the remainder of this session (a state that comes from the app's own UI not currently displaying that pane to the user — it fluctuates over a long session and is outside the agent's control). This blocked fresh live proof of any *new* geometry-driven appearance start (including for the pre-existing `timeline_project`/`skills_person` targets, not just the new `vision_tooltip`/eligibility work) — it did not block anything that doesn't depend on a fresh IntersectionObserver delivery, which is why the semantic-boundary-flush and tooltip-announcement checks above still worked cleanly.
- Also observed: a stray, much older local session was still flushing in the background for most of this pass (its own `visibility_delta` rows for `kreator-project`/`biobot`/`mentor` at 600+ seconds of elapsed time appeared mixed into the raw event stream), and the Worker briefly logged a 409 and a 500 under the resulting concurrent-write load. This reads as a leftover browser tab/session from earlier in the overall working session — filtering by `session_id` isolated this pass's own data cleanly, and it is not related to the code changed here. Worth mentioning in case a stray tab against `localhost:4321` is still open.

### 17.6 Implemented project content visibility (Telemetry Pass 1)

Source: `src/lib/telemetry/visibility.ts` (engine extensions — `ObserveOptions`, `INSTANCED_SURFACES`, static `properties`), `src/scripts/visibility.client.ts` (reads the new `data-visibility-owner`/`data-visibility-content-type`/`data-visibility-person` attributes), `src/components/projects/ProjectDetail.astro` (`project_intro`/`project_content` on the shared header/gallery), `src/components/projects/ProjectModal.astro` and `FilterResults.astro` (pass `projectId`/`owner`; `filtered_project` on `.fr-card`), `src/components/timeline/ExperienceCard.astro`, `ProjectRow.astro`, `ApartBlock.astro` (`project_intro` on `.node`, `project_content` on the Timeline's own experience cards and each modal's `.modal-exp`), `src/data/media/types.ts` + every `src/data/media/*.ts` file (`ProjectMedia.id`). Tests: `src/lib/telemetry/test/visibility.test.ts` (11 new cases, see below).

**Goal.** Measure meaningful project content consistently wherever the same content appears: Timeline preview, Project Modal, and Skill Filtered View — without redesigning the Visibility Matrix (sections 6-7, 17.3) or the semantic state model (17.2).

**Discovered project content taxonomy.** The project/experience content model (`data/timeline.ts`, `data/projectCatalog.ts`, `data/media/*.ts`, `src/content/experiences/*.md`) has exactly two kinds of reusable content unit, both already existing before this pass:

1. **Experience/contribution** — one `ExperienceRef` (`{ person, slug, tagIds? }`) per person per project, `slug` resolving to a markdown entry in `src/content/experiences/`. Always belongs to exactly one person (`ref.person`); a shared project just has two `ExperienceRef`s, one per person, never a single dual-owned one.
2. **Media item** (`ProjectMedia`, `data/media/*.ts`) — one project-level gallery array, discriminated by `kind`. The complete discovered `kind` taxonomy in the actual data (not merely the type union — every value below has at least one real entry): `image`, `gif`, `video`\*, `facebook-video`, `facebook-reel`\*, `youtube`, `linkedin-post`, `image-row`, `text`. (`video` and `facebook-reel` are supported by the type/renderer but have no live data entry today — reported, not assumed absent from the taxonomy, since the renderer treats them identically to their sibling kinds it does have data for.) Each item optionally carries `person` (attribution) — when absent, the item is shared ("both"). An `image-row` is one semantic content unit (one caption, one `figure`) containing several images laid out as a composite row — the data model itself represents it as a single array entry with an `images: string[]` sub-list, not as independently addressable images, so it is measured as one unit, matching its actual content-model granularity (docs section 11).

The requested example list (`experience/contribution`, `text`, `text-media`, `image`, `video`, `image-row`) is a reasonable first approximation but not exact: **there is no literal `text-media` kind** in this codebase. Every non-`text` media kind already *is* "visual content with a caption" (a shot + `figcaption`), so `content_type` is simply the item's own `kind` rather than an invented coarser category — this is more precise (distinguishing `youtube` from `image` from `linkedin-post`, all real, meaningfully-different-to-measure kinds) and was chosen over inventing `text-media` for that reason.

**Rendering paths per content type.**

| Content | Timeline preview | Project Modal | Skill Filtered View | Component |
|---|---|---|---|---|
| Experience/contribution | `ExperienceCard.astro`'s `.card` (via `ProjectRow.astro`/`ApartBlock.astro`) | `.modal-exp` div (rendered directly by `ProjectRow.astro`/`ApartBlock.astro`, slotted into `ProjectModal.astro`) | `.modal-exp` div (rendered directly by `FilterResults.astro`, slotted into `ProjectDetail.astro`) | three separate call sites, same underlying rendered `<Content />` |
| Every media `kind` | *not rendered* — Timeline preview never shows the gallery | `ProjectDetail.astro`'s gallery `<figure>` (one branch per `kind`) | same `ProjectDetail.astro` gallery, different `owner` prop | one shared component |
| Project intro/header | `.node` (`ProjectRow.astro`/`ApartBlock.astro`) — title + short info blurb only | `.project-modal__head` (`ProjectDetail.astro`) — title + subtitle + optional logo | same `.project-modal__head` | `.node` and `.project-modal__head` are two different DOM structures, same underlying `project.name`/`project.info` strings |
| Whole project preview | `.project-row`/`.track-row` (`timeline_project`, pre-existing) | *(no whole-project target — `project_open`/`project_close` already identify the modal's lifetime, per the prompt's explicit instruction not to add one)* | `.fr-card` (`filtered_project`, new) | — |

**Which content appears where, and what's shared vs. reused.**

- Timeline preview shows: `timeline_project` (whole-row, pre-existing), `project_intro` (only for a *named* project — see below), `project_content` of `content_type: experience` only (never media — the gallery is Project-Modal/Filtered-View-only content).
- Project Modal shows: `project_intro`, `project_content` of every discovered content type (experience + all media kinds).
- Skill Filtered View shows: `filtered_project` (whole-card), `project_intro`, `project_content` of every discovered content type — the full detail, not a preview, per docs section 4.4.
- Reused across ALL THREE: nothing verbatim (Skill Filtered View and Project Modal both use `ProjectDetail.astro`, so their `project_intro`/`project_content` DOM structure is identical; Timeline's `project_intro`/experience `project_content` are a *different* DOM structure with the *same underlying data* and therefore the same canonical id — see "Cross-context canonical identity" below).
- Media galleries are **only** reused between Project Modal and Skill Filtered View (both via `ProjectDetail.astro`); Timeline never renders them, so no media `project_content` target ever has `owner: main`.

**Which content already had stable IDs; what was added.**

- Experience content already had a stable, unique id: `ExperienceRef.slug` (e.g. `mitko-heroes6`), used elsewhere for `getEntry('experiences', ref.slug)`. **No content-model change needed** — reused as-is.
- Media items had **no stable id at all** (bare array entries, previously addressed only by array index/`src`). **Added:** a required `id: string` field to `ProjectMedia` (`src/data/media/types.ts`), populated for every real entry across all 13 non-empty `src/data/media/*.ts` files (50 entries total) plus `placeholder.ts` (2 entries) — kebab-case, short, descriptive, and **project-prefixed** (e.g. `heroes6-combat-map`, `heroes6-tutorial`, `hod-photogrammetry`), globally unique by construction (no two projects share a prefix) and carrying **no person name/ownership** — ownership stays separate `properties` metadata (see below). `mentor.ts`/`mmo-rework.ts` have empty arrays and needed no changes. TypeScript made this field required, so a missing id on any future entry is a build-time error, not a silent telemetry gap. The two `PLACEHOLDER_MEDIA` entries (`placeholder.ts`) are the deliberate exception: `placeholder-image`/`placeholder-gif`, *not* prefixed, because that one array is reused as-is across every project with no media of its own — see "Final target types and canonical ID scheme" below for how they still get a correct, distinct id per project at render time.

**Final target types and canonical ID scheme.**

- `filtered_project` / `<project-id>` — whole-card presentation target in Skill Filtered View, mirroring `timeline_project`'s existing shape exactly (fixed owner `skill_filtered`, added to the engine's static `OWNER` map).
- `project_intro` / `<project-id>` — the shared title/blurb header. No content-id suffix (it's project-level, one per project, matching the prompt's `project_intro / heroes6` example precisely).
- `project_content` — every experience block and every media item, constructed *differently per content type* on purpose (docs section 17.6.1 explains why one scheme isn't forced onto both):
  - **Media**: the id is `ProjectMedia.id` **used directly, unmodified** — e.g. `heroes6-combat-map`. Since the id already carries its own project prefix (see above), no further prefixing happens at render time; `heroes6:heroes6-combat-map` would just repeat the same identity twice. The one exception is a `PLACEHOLDER_MEDIA` item, whose *generic* id (`placeholder-image`) is project-prefixed at render time (`<project-id>-placeholder-image`) precisely because it has no prefix of its own baked in — `ProjectDetail.astro`'s `mediaVisibilityAttrs()` decides this with one `m.id.startsWith(`${projectId}-`)` check, not a parallel construction path.
  - **Experience**: `<project-id>:<slug>` — e.g. `heroes6:mitko-heroes6`. `<project-id>` is the same canonical id `project_open`/`project_close`/`timeline_project`/`filtered_project` already use (`project.modalId ?? project.id`, i.e. `CatalogProject.key`); `<slug>` is `ExperienceRef.slug`, kept exactly as the existing stable scheme already has it (including the person's own name — see 17.6.1). The colon is a deliberate visual signal that this id is *joined from two parts at render time*, distinct from a media id's single pre-baked string.

`project_intro` and `project_content` are **context-dependent target types**: unlike every fixed-owner type before this pass, the exact same canonical content genuinely renders under three different surfaces depending on where a given DOM instance sits. `filtered_project` is not context-dependent (it only ever exists inside Skill Filtered View), so it got a normal fixed `OWNER` entry, matching `timeline_project`'s existing precedent (docs section 17.3) rather than the new mechanism.

#### 17.6.1 Canonical-ID cleanup (same pass, before commit)

A focused follow-up cleanup, done before committing Pass 1, on the canonical ID scheme above — no telemetry redesign, no new target types or fields.

**Four canonical project ids were shortened**, since their original form was a long, incidental slug rather than a deliberately concise identifier (`ProjectDef.id` in `data/timeline.ts`; propagates automatically everywhere the id is used — `timeline_project`/`project_open`/`project_close`/`filtered_project`/`project_intro`/`project_content`, `CatalogProject.key`, the `tl-<id>` DOM/modal id):

| Old project id | New | Rationale |
|---|---|---|
| `beasts-of-brawlia` | `bob` | already the project's own informal short name |
| `kreator-project` | `hod` | the project's real name is "Heart of Darkness"; `kreator-project` named it after the *studio*, not the game |
| `warhammer-mark-of-chaos` | `warhammer` | concise, still unambiguous (the only Warhammer project) |
| `imagic-labs-project` | `imagic` | drops the redundant `-project` suffix |

`mmo-rework` and `lol-universe` were explicitly left unchanged (already concise; the request's own examples of the target style). Every other project id was already concise and untouched.

**Repository-wide audit of the four old forms**, classified before changing anything:

- **Canonical project id (`ProjectDef.id`)** — the actual identity driving telemetry/DOM — renamed, all 4 (table above).
- **Company id (`CompanyDef.id`: `kreator-studios`, `imagic-labs`)** — a *different* entity (the employer/studio a project sits inside, used only for `data-company-id` layout-alignment selectors in `alignApartPairs.client.ts`), never part of the telemetry canonical-id scheme. **Left unchanged** — renaming it would only be churn; nothing reads it as project identity.
- **Experience slugs/filenames** (`adam-beasts-of-brawlia`, `adam-warhammer-mark-of-chaos`, `mitko-imagic-labs`, `mitko-kreator-studios`, and their `.md` files) — **left unchanged**, per the prompt's own carve-out for experience content: the slug *is* the content-collection filename (`getEntry('experiences', ref.slug)`), so changing it means renaming real files for zero telemetry benefit, and the person-name-first convention is inherent to experience identity, not the kind of "ownership encoded in content id" the cleanup targets (that rule is scoped to `ProjectMedia.id`).
- **Asset path** (`public/projects/warhammer-mark-of-chaos/warhammer.jpg`) — our own local static asset, referenced from exactly one place (`data/media/warhammer-mark-of-chaos.ts`) — **renamed** to `public/projects/warhammer/warhammer.jpg` for consistency; low-risk (we control both ends, not a third-party/external reference). `imagic-labs`'s asset directory (`public/projects/imagic-labs/`) was **not** touched — it matches the company id, not the old `imagic-labs-project` form actually being renamed.
- **Frontmatter `project:` field** in the 4 relevant experience `.md` files — informational only (`content.config.ts`'s `project: z.string()` is never read by any code; confirmed by search), already drifted out of sync with real project ids for several unrelated entries pre-existing this pass (e.g. `mitko-ericsson.md` says `project: ericsson`, not the real `ericsson-consulting`) — **updated anyway** for these 4, cheap and non-misleading, without attempting to fix the pre-existing unrelated drift (out of this pass's scope).
- **`docs/telemetry.md`'s own prose** — "Kreator Studios" (section 6.2, a human-readable company name in a sentence, not a code identifier) and a section 17.5 line recording a *historical* observation from an earlier pass's live session (`kreator-project` appeared in a stray browser tab's rows at that time) — both **left unchanged**: the first isn't an identifier at all, the second is a factual record of what was literally true then and would misrepresent history if silently rewritten.
- **Local git-ignored D1 database** (`workers/telemetry/.wrangler/`) — contains old-id rows from earlier manual verification sessions. **Left as-is** (git-ignored local dev data, not source; a `telemetry:clear` before the next manual test run naturally starts clean).
- **`.astro/data-store.json`** — Astro's own generated/git-ignored content cache. **Left as-is**; regenerates from source on next build/dev.

Re-searched after the above changes: no remaining occurrence of `beasts-of-brawlia`, `kreator-project`, `warhammer-mark-of-chaos`, or `imagic-labs-project` in any tracked source file — only the intentionally-retained ones listed above (company ids, experience slugs/filenames, the two documented prose mentions), confirmed by a fresh repository-wide search.

**All 50 real `ProjectMedia.id` values were normalized** to `<project-id>-<semantic-suffix>` (e.g. `heroes6-combat-map`, `mandragora-necromancer-boss`, `bob-gameplay`, `hod-photogrammetry`) — every one now carries its own project's prefix and **no person name**. Concretely this meant: adding the now-missing project prefix to every id (none had one before this cleanup — the original Pass 1 ids were bare, e.g. `combat-map`, and canonical identity came entirely from the runtime `${projectId}:${m.id}` join), and confirming none had ever included a person name (none did — ownership was already only ever in `properties.person`, not the id). The 2 `PLACEHOLDER_MEDIA` ids were deliberately left generic (see the canonical-ID-scheme bullets above for why, and how they still avoid cross-project collisions).

**`project_content` construction changed** to stop redundantly re-prefixing media ids that now already carry their project identity (`ProjectDetail.astro`'s `mediaVisibilityAttrs()` — see the canonical-ID-scheme bullets above for the exact rule and the placeholder exception). Experience construction is unchanged (`<project-id>:<slug>`) — a deliberate, reported decision, not an oversight, per the prompt's explicit permission to keep that scheme where it's already the better fit.

**Person/side ownership representation.** Carried as ordinary `visibility_delta.properties`, never folded into the canonical id (per the prompt's explicit instruction): `content_type` (the media `kind`, or literally `'experience'`) and `person` (`'mitko'` / `'adam'` / `'both'` — `'both'` for a media item with no `person` set; experience content is always exactly one of `'mitko'`/`'adam'`, never `'both'`, matching the data model's actual invariant). `project_intro` and `filtered_project` carry no person metadata — a project's overall side (`both`/`left`/`right`) is already derivable from `CatalogProject.side`/the experience-level `project_content` rows for that same `<project-id>`, so repeating it on the intro/whole-card target would be redundant with data the raw event stream already has via the join on `<project-id>`, not new information.

**Context-dependent ownership: the engine solution.** `VisibilityMatrixEngine.observe(el, targetType, targetId, options?)` gained a new optional third-parameter `ObserveOptions`: `{ owner?: Surface; properties?: Record<string, PropertyValue> }`. `owner`, when given, wins over the static `OWNER[targetType]` lookup; a type with neither is ignored (the existing scope-guard, unchanged). The owner is **supplied once, by the Astro component that renders that specific DOM instance, at render time** — `ExperienceCard.astro` always passes `owner: 'main'` (it only ever renders on the Timeline); `ProjectModal.astro` always passes `owner: 'project_modal'` into `ProjectDetail`; `FilterResults.astro` always passes `owner: 'skill_filtered'`. Nothing is inferred from DOM position/ancestry at runtime — `visibility.client.ts` just forwards whatever `data-visibility-owner` the markup already carries, converting an unrecognized/malformed value to "no override" rather than guessing. `properties` (the `content_type`/`person` metadata above) is carried the same way, as `data-visibility-content-type`/`data-visibility-person`, and is stored once per target (`Target.staticProperties`) and merged into every drained delta alongside the pre-existing per-appearance `triggerMethod` mechanism (`vision_tooltip`'s), which is untouched and independent.

**Instance-boundary rule, generalized.** Section 17.3's rule — an appearance on an instanced-owner target is force-ended the instant its surface's `view_instance_id` changes, even before geometry reflects it — was previously hardcoded to `owner === 'skills'`. This pass generalizes it to a small `INSTANCED_SURFACES = new Set(['skills', 'project_modal', 'skill_filtered'])`, used identically everywhere the old code special-cased `'skills'` (the forced-end check in `onStateChange`, and `appearanceInstanceId` assignment in `startAppearance`). This is the same mechanism, not a new one: it now also covers `project_intro`/`project_content` rendered inside a Project Modal or Skill Filtered View, and `filtered_project`. `main` remains deliberately absent — main-owned targets (Timeline's `project_intro`/`project_content`, `timeline_project`, `vision_content`, `vision_tooltip`) are only ever suspended by a surface change, never force-ended, exactly as before. All 93 pre-existing tests continued passing unmodified against this generalization, confirming it's behavior-preserving for every existing target.

**Timeline nested-content instrumentation.** `.node` (project_intro) and each `ExperienceCard`'s `.card` (project_content) are additional, independent targets layered on top of the pre-existing `.project-row`/`.track-row` (`timeline_project`) — never a replacement. All three register with the engine simultaneously and accumulate independently (docs section 6, "do not subtract child visibility from parent visibility") — confirmed live (see Manual verification below): a single scroll past Heroes VI's row produced `timeline_project:heroes6`, `project_intro:heroes6`, `project_content:heroes6:mitko-heroes6`, and `project_content:heroes6:adam-heroes6` in the same batch. `project_intro` only renders on the Timeline for a *named* project (`.node`'s existing render condition, unchanged) — an unnamed single-project company (Ericsson Hungary) still gets `timeline_project` and its experience's `project_content` (via `ExperienceCard`, which renders regardless of `project.name`), just no `project_intro`, since there is no title/blurb header box to measure there (confirmed live, see below) — this is a real, reported asymmetry in the content model, not an instrumentation gap: Ericsson's project simply has no reusable intro/header content on the Timeline.

**Project Modal instrumentation.** `ProjectDetail.astro` (shared by `ProjectModal.astro` and `FilterResults.astro`) now takes `projectId`/`owner` props and renders `data-visibility-*` attributes on `.project-modal__head` (`project_intro`) and every gallery `<figure>` (`project_content`, one branch per media `kind`, all covered via one shared attribute-building helper so no branch was missed). `ProjectRow.astro`/`ApartBlock.astro` render the matching `project_content` attributes directly on their own `.modal-exp` divs (owner `project_modal`) since those aren't part of `ProjectDetail.astro`. Closing the modal force-ends every `project_modal`-owned appearance immediately (the generalized instance-boundary rule) and Timeline's own `main`-owned copies resume accounting on their pre-existing, uninterrupted appearance — confirmed live.

**Skill Filtered View instrumentation.** `FilterResults.astro`'s `.fr-card` (one per `CatalogProject`, in catalog order) carries `filtered_project` (`target_id: lp.project.key`, the same canonical id used everywhere else); it passes `projectId={lp.project.key}` and `owner="skill_filtered"` into the same `ProjectDetail.astro`, so `project_intro`/`project_content` there are wired identically to the Project Modal case, just under a different owner. Its own `.modal-exp` divs get the same `project_content` treatment as `ProjectRow.astro`'s, owner `skill_filtered`. Every catalog project (all 16, including Ericsson Hungary) gets a `filtered_project` and a `project_intro` here — `ProjectDetail.astro`'s header always renders regardless of `project.name`, unlike the Timeline's `.node`, so Ericsson Hungary is the one project whose `project_intro` exists in Skill Filtered View/Project-Modal-shape but not on the Timeline (confirmed live: 15 Timeline `project_intro` instances vs. 16 in each of Project Modal's/Skill Filtered View's DOM, via a live DOM count during manual verification).

**skill → filtered view instance → project → content join path.** No new id or field was added for this — the existing `skill_filter_open`'s `view_instance_id` is already the unambiguous join key, confirmed live: `skill_click` (`properties.trigger_person`) → `skill_filter_open` (`target: skill:<id>`, a fresh `view_instance_id`, e.g. `6ac36a8d`) → every `filtered_project`/`project_intro`/`project_content` delta for a project shown in that filter result carries that *same* `view_instance_id` on every row. Reconstructing the chain is: find the `skill_filter_open` row for the `view_instance_id`, then every `visibility_delta` sharing that `view_instance_id` is content encountered inside that specific filtered-view opening — copying `skill_id` onto every visibility row would be strictly redundant with this join and was deliberately not done, per the prompt's own preference.

**Cross-context canonical identity — real examples (live D1 rows, local dev, re-verified after the 17.6.1 canonical-ID cleanup).** Heart of Darkness (`hod` — the renamed project, exercising both the id rename and the media/experience construction split in one session), opened in Project Modal then closed back to the Timeline:

```
target                                     view      properties
project_open  project:hod                  6f383259
project_intro:hod                          6f383259                                            <- Project Modal
project_content:hod:mitko-kreator-studios  6f383259  {"content_type":"experience","person":"mitko"}   (colon-joined: experience)
project_content:hod-photogrammetry         6f383259  {"content_type":"linkedin-post","person":"mitko"} (pre-baked: media, no colon)
project_close project:hod                  6f383259
timeline_project:hod                       (none)                                              <- back to Timeline, restored
project_intro:hod                          (none)                                              <- SAME target_id as inside the modal
project_content:hod:mitko-kreator-studios  (none)    {"content_type":"experience","person":"mitko"}
```

Same `target_id` throughout (`hod`, `hod:mitko-kreator-studios`, `hod-photogrammetry`); the *only* thing that changes is presence/value of `view_instance_id`, exactly the design goal — analysis can aggregate across contexts by `target_id` or split by `view_instance_id` presence/value. A second, independently-appeared instance of the same `target_id` under a different owner is a genuinely different `appearance_id` (confirmed by the "cross-context canonical identity" unit test), never conflated with the first. Note the two different `project_content` constructions side by side in the same real batch: the experience row keeps its colon-joined `<project-id>:<slug>` (slug unchanged, still names the person), the media row is `hod-photogrammetry` used as-is with no re-prefixing and no person in the id — exactly the 17.6.1 design.

**Manual local verification (this pass).** Local workflow as in 17.1-17.2 (`telemetry:clear`, `telemetry:dev`, `dev:telemetry`, `telemetry:events`). Real D1 rows confirmed:
- DOM wiring, page-wide: 16 `filtered_project`, 162 `project_content` (main 21 / project_modal 70 / skill_filtered 71 — arithmetic consistent: media-only content exists in modal/filtered, never main), 46 `project_intro` (main 15 / project_modal 15 / skill_filtered 16 — Ericsson Hungary is the one project present in the filtered/modal shape but absent from Timeline's `.node`, as designed).
- Timeline nested measurement: `timeline_project`, `project_intro`, `project_content` (both people's experience) for Heroes VI all present simultaneously in one batch while scrolled into view, plus the unnamed Ericsson Hungary project showing `timeline_project` + its one `project_content` but correctly no `project_intro`.
- Project Modal: real rows for Mitko-owned (`mitko-heroes6`, `content_type: experience`), Ádám-owned (`adam-heroes6`), and shared (`content_type: youtube`/`text`, `person: both`) content, plus the cross-context identity example above; close-immediately-restores confirmed (Timeline's copies resumed accounting on the very next batch after `project_close`, no gap in canonical identity).
- Skill Filtered View: clicked a linked skill tag (`board-game-design`) on a real Skills panel reveal → `skill_click` → `skill_filter_open` (fresh `view_instance_id`) → scrolled `.timeline-area` → real rows for `filtered_project:biobot`, `project_intro:biobot`, `project_content:biobot:adam-biobot` (experience), `project_content:biobot-cards`/`biobot-place`/`biobot-tableau` (`content_type: image`, `person: adam`) all sharing that filter's `view_instance_id` → `skill_filter_close` (`reason: escape`) drained the same targets one final time at the close boundary, exactly like the existing Project-Detail-close pattern.
- One project in this pass's filtered results (Hypha, the other `board-game-design` match) never crossed the 50% threshold during the scripted scroll and so produced no rows — an artifact of this manual pass's scroll timing, not a code defect (Biobot, scrolled more slowly, worked cleanly).

**Content/rendering NOT instrumented, and why.**
- Timeline's own `ExperienceCard` "Showcase" embed (the collapsible inline YouTube/image preview some cards offer) — not one of the discovered `ProjectMedia` content types; it's an interaction affordance on top of the experience card, not separate reusable project content, and instrumenting it wasn't requested by any goal in this pass.
- Composite-layout internals (individual `<img>` children inside an `image-row`'s frame, the tag `<li>` pills, the external link chip) — containers/decorative per docs section 11, not independently meaningful content.
- Video playback timing, `max_attainable_ratio`, Contact/CV/LinkedIn/email/navbar telemetry, noninteractive-click telemetry, and any derived seen/read/engaged metric — explicitly out of scope for this pass per the prompt; untouched.

**Tests.** 11 new deterministic cases added to `src/lib/telemetry/test/visibility.test.ts` (104 total, all passing): `filtered_project` fixed-owner registration and its instance-boundary close; the context-dependent scope guard (registering `project_intro`/`project_content` with no `owner` is ignored, matching the pre-existing scope-guard test's pattern); `project_intro` under an explicit `owner: 'main'`; `project_content` inside Project Modal and inside Skill Filtered View, each showing the generalized instance-boundary force-end with real `content_type`/`person` properties attached; static properties repeated across multiple drains of the same appearance (not just the first); a shared (`person: 'both'`) media item's ownership living in properties, never the canonical id; the cross-context canonical identity scenario (two DOM elements, one `main`-owned and one `project_modal`-owned, same `target_id`, independent appearances, each eligible only under its own surface); and a `project_content` delta (with `content_type`/`person` properties) passing the real Worker validator. `npm run telemetry:test` (104/104), `npm run worker:test` (19/19, unchanged — no Worker/schema changes were needed since `target_type`/`target_id`/`properties` validation was already fully generic), `npm run worker:typecheck` (clean), `npm run build` (clean) all pass; `npx astro check` shows the same 2 pre-existing, unrelated errors (`alignApartPairs.client.ts`, `syncApartHeights.client.ts`) as before this pass, confirmed via `git stash` comparison.

### 17.7 Playable-media exposure and known playback (Telemetry Pass 2)

**Goal.** Extend the Visibility Matrix with two parallel measurement families — playable exposure and known actual playback — for every genuinely playable `project_content` media unit, without redesigning the matrix itself (sections 6-7, 17.3) or the semantic state model (17.2). See section 9 for the field-level summary; this subsection is the full audit, design, and verification record.

**Audited playable-media lifecycle, per discovered kind** (`src/components/projects/ProjectDetail.astro` for rendering, `src/scripts/projectModal.client.ts` for the actual runtime lifecycle):

- **`video` (native `<video controls autoplay muted loop playsinline preload="auto">`, `src/components/projects/ProjectDetail.astro`).** Autoplay, muted, looped. Real, reliable playback state via standard `HTMLMediaElement` events (`playing`/`pause`/`ended`) — these fire identically whether the visitor used the element's own controls or the scroll-visibility feature below called `.pause()`/`.play()` on it, since both are the same underlying API. A separate scroll-visibility observer (`initVisibilityPause`, 50% hide / 65% show hysteresis, its own `IntersectionObserver` distinct from the Visibility Matrix's) auto-pauses/-resumes it below/above that band, but only ever by calling the real `.pause()`/`.play()` — never by destroying or replacing the element. The `<video>` element itself persists in the DOM for the page's lifetime once rendered; it is not destroyed/recreated on Project Modal close, reopen, or Skill Filtered View toggling. Playback position is fully preserved across pause/resume (native `.pause()` never resets `currentTime`). **Finding, not fixed (out of this pass's scope):** nothing explicitly stops a native video when its owning Project Modal or Skill Filtered View closes — unlike YouTube (`pauseYouTube`) and Facebook (`stopFacebook`), there is no equivalent native-video stop call in `projectModal.client.ts`'s close path. In practice this cannot leak into `playing_v*`/`video_start`, because the Visibility Matrix's own instance-boundary/surface-suspension rule (section 17.3, generalized in 17.6) already gates all three families on the same eligibility used for ordinary `v*` — once the owning surface is no longer current, no time accrues regardless of whether the element is still literally decoding frames in the background. **No live data entry exists for `kind: 'video'` today** (same as reported in 17.6) — verified by design/unit tests (`src/lib/telemetry/test/visibility.test.ts`) and by the shared code path already proven live via YouTube below (identical `account()`/`drain()` machinery), not by a live D1 row for this exact kind.
- **`youtube` (YouTube IFrame Player API, lazily constructed on first activation).** Autoplay (`autoplay: 1, mute: 1`) via `playerVars`. Real, reliable playback state via the API's own `onStateChange` (`PlayerState.PLAYING`/`PAUSED`/`ENDED`) — the same event this file's existing `[start, end]` segment-looping logic already consumes, so this pass adds no new dependency on provider behavior, only new listeners on an already-trusted channel. The player/iframe is constructed once per frame and **reused** on every subsequent open of the same modal/panel (`ytPlayers` `WeakMap`) — not destroyed/recreated — but **playback position is NOT preserved across a reopen**: the reuse branch (`activateYouTube`'s `existing` case) unconditionally calls `seekTo(start, true)` before `playVideo()`, so a revisit always restarts from the configured `start` (or 0), even though the underlying DOM/player object is the same instance. Same-surface scroll-visibility pause/resume (50%/65% hysteresis, same shared observer as native video) uses the real API (`pauseVideo`/`playVideo`), so `playing_v*` tracks it correctly with no extra gating needed. **Genuine "not yet live" window:** between a modal/panel opening (Visibility Matrix eligibility can already be true) and the IFrame API script + player finishing construction — `activateYouTube` is `async`, and on the very first use on a page the API script itself must load over the network — the mount is just a placeholder `<div>`, not yet a real embed. `onReady` is the real, observable moment this ends.
- **`facebook-video` / `facebook-reel` (Facebook's video plugin iframe, both kinds render identically via the same plugin — only the badge differs).** **No autoplay** — confirmed live (see Manual verification below): the embed shows Facebook's own paused-state UI with a play button; playback only starts if the visitor clicks it. **No JS/postMessage API of any kind** — this is the one kind where actual playback state is structurally opaque and unobservable from our code, confirmed both by the pre-existing code comment (`initFacebook`, which documents that several prior attempts at scroll-based pause/resume all failed for exactly this reason) and by this pass's own audit finding no event/API surface to attach to. **What actually happens around the "boundary":** contrary to the brief's own recollection that Facebook embeds "may be stopped/recreated around the visibility boundary, possibly returning unstarted/reset after leaving and re-entering the viewport" — audited and live-verified (see below) to be **false** for *scroll* position. `initVisibilityPause`'s scroll-driven pause/resume (the mechanism that does exactly this for native video/YouTube) explicitly excludes Facebook frames by selector (`VISIBILITY_MEDIA_SELECTOR = '.shot-frame--native-video, .shot-frame--youtube'`) — a Facebook iframe's `src` is untouched by scrolling within an already-open view, confirmed live: scrolled an activated, visible Facebook video fully out of the Project Modal's own internal scroll area and back, with the iframe `src` unchanged (still the real, non-blank URL) throughout. The iframe **is** genuinely destroyed/recreated, but only at a different boundary than scroll: **`about:blank`↔real-src, once per modal/panel open/close cycle** (`initFacebook` blanks every Facebook iframe at page load; `activateFacebook` restores the real `src` when its Project Modal/Skill Filtered View opens; `stopFacebook` blanks it again on close) — `about:blank` (not merely hiding it) is used specifically because a hidden-but-still-`src`'d iframe keeps playing audio. Reopening the same modal is therefore a genuine fresh load (new `src` assignment) with no state carried over — any prior playback position or paused/started state is lost, exactly matching the pass 1 instance-boundary rule already forcing a new appearance at that same moment. **Technically verified vs. merely visually suggested:** the "no autoplay" and "opaque, no scroll-pause" findings are both technically verified (iframe `src` inspected directly, live D1 rows confirmed below); "the plugin has no JS API" is verified by the absence of any provider script/postMessage channel in the existing code and by this pass's own search — not something further SDK integration was attempted to disprove, per the prompt's explicit instruction not to add one.
- **`gif` (a plain `<img loading="lazy" decoding="async">`, badged "GIF").** No control surface of any kind — once rendered and decoded, the browser animates it continuously with no play/pause distinction exposed to JS, and no way to query "is it currently animating." Not a provider embed, so there is no destroy/recreate lifecycle to audit; the only genuinely uncertain state is whether the image has **loaded** yet (`loading="lazy"`), audited and live-tested this pass — see below for a live-encountered load-timing nuance. `PLACEHOLDER_MEDIA`'s `placeholder-gif` (`data/media/placeholder.ts`) is the only `gif` entry in the current content model; it is used by the site's fallback (`project.media ?? PLACEHOLDER_MEDIA`), which is genuinely reached only when a `ProjectDef` supplies no `media` field at all — every one of the 15 currently clickable/modal-bearing projects supplies its own `media` array (verified live: `document.querySelectorAll('[data-project-open]')` returns exactly 15 entries), so **no `gif` item is reachable through today's live UI** (the one project with no `media` field, the unnamed Ericsson Hungary entry, has no clickable modal trigger at all per the 17.6 finding). Confirmed by design/unit tests and a temporary, reverted-before-finishing content edit (see Manual verification).

**Differences between Timeline, Project Modal, and Skill Filtered View.** Unchanged from 17.6: the media gallery (every playable kind) renders **only** inside `ProjectDetail.astro`, i.e. only in Project Modal and Skill Filtered View — the Timeline preview never shows it. `project_content` for media is therefore never `owner: 'main'`; only the (non-playable) `experience` content type appears on the Timeline. This pass adds no new surface, so playable-media geometry/threshold semantics are identical to every other `project_content` target — same eligibility, same instance-boundary force-end on modal/filter close (17.6).

**What "playable" means, per kind (the final implemented semantics).** A target is classified playable at all only via an explicit `playableKind` supplied by the renderer from the media item's own `kind` (`ProjectDetail.astro`'s `PLAYABLE_KIND` map) — never inferred from `content_type` string matching inside the engine, and never assumed from filename/type alone:

| `ProjectMedia.kind` | `playableKind` | Playable requires (beyond ordinary Visibility Matrix eligibility + >=threshold) | Known playing? |
|---|---|---|---|
| `video` | `native-video` | nothing extra — the element is never destroyed/replaced while connected | Yes — real `playing`/`pause`/`ended` events |
| `youtube` | `youtube` | not suspended — suspended from registration until the IFrame API's `onReady` fires | Yes — real `onStateChange` (`PLAYING`/`PAUSED`/`ENDED`) |
| `facebook-video` / `facebook-reel` | `facebook` | not suspended — suspended from registration until `activateFacebook` restores the real `src`, re-suspended by `stopFacebook` | **Never** — opaque, no API |
| `gif` | `gif` | not suspended — suspended from registration until the `<img>` has loaded (`img.complete`, or its `load` event) | **Never** — no play/pause concept |
| `image`, `image-row`, `linkedin-post`, `text`, and all `experience` content | *(none)* | not playable media at all — no `playable_v*`/`playing_v*` fields ever appear on these targets' deltas | — |

The "not suspended" column is the engine's `playableSuspended` flag (`VisibilityMatrixEngine.setPlayableSuspended`), a dynamic, externally-driven piece of Target state — analogous to `ratio` — gating `playable_v*` (and transitively `playing_v*`) in the exact same per-threshold accounting loop that already computes ordinary `v*` (`account()` in `src/lib/telemetry/visibility.ts`), rather than a second engine. `native-video` deliberately tracks no "not yet ready" state (a documented, accepted limitation, not an oversight): its assets are small, local, `preload="auto"` clips that load near-instantly, and the genuinely important gap this mechanism exists to close — an opaque provider whose iframe is deliberately blanked, or a lazily-loaded asset that hasn't rendered any pixels yet — doesn't apply to it the way it does to Facebook/YouTube/GIF.

**Playing semantics — the final implemented rule.** `playing_v*` accumulates only for `native-video`/`youtube` (`PLAYING_OBSERVABLE` in `visibility.ts`), gated by a second dynamic flag, `playingActive`, set exclusively by real provider/media events via `setPlaying(el, boolean)` — never by visibility, an iframe existing, an autoplay attribute, or a thumbnail/play-button being visible. `playing_vX <= playable_vX <= vX` holds by construction: all three are accumulated in one shared per-threshold loop, each successive family gated by one additional, narrower condition than the last, evaluated over the identical elapsed span. Facebook and GIF never call `setPlaying` at all, so their deltas never carry `playing_v*` fields (omitted entirely, not sent as zero) — and `setPlaying`/`video_start` are hard no-ops for any `playableKind` outside `PLAYING_OBSERVABLE`, so even a hypothetical future miswiring couldn't fabricate playback for an opaque kind.

**`video_start` — final semantics.** Emitted by the engine itself (it is the only place that reliably knows the current `appearance_id`), at most once per appearance, the instant all of: real `playingActive`, not suspended, >=50% visible, and otherwise eligible — i.e. exactly the instant `playing_v50` begins accruing for that appearance. Reused per-appearance state (`videoStartEmitted`, reset on appearance start/end, unlike `playableSuspended`/`playingActive` which reflect real external state and persist across appearance boundaries) distinguishes a genuine start from a pause/resume within the same appearance without inventing an autoplay-vs-user-started signal neither provider can objectively give — confirmed live (see below): pausing and resuming a real YouTube clip did not re-fire `video_start`, and no `trigger`/`autoplay` property is ever attached (verified by unit test: `video_start`'s `properties` carry only the target's existing static metadata, e.g. `content_type`/`person`, never anything invented about how playback began).

**Canonical identity and appearances (docs sections 10, 11 — unchanged, reused as-is).** Playable/playing accounting rides the exact same canonical `project_content` id and the exact same appearance as the ordinary visibility deltas for that content encounter — no second appearance id, no second canonical id. A `filtered_project`/`project_modal` instance-boundary close force-ends the appearance (17.6), which zeroes every family's cumulative/sent counters together; nothing from one instance can leak `playable_v*`/`playing_v*` (or ordinary `v*`) into the next, confirmed by both unit test and, for the Facebook/YouTube case specifically, by the provider's own real destroy/recreate (Facebook) or seek-to-start (YouTube) behavior lining up with the same boundary.

**Boundary accounting.** Every state-affecting call (`onRatio`, `onStateChange`, `pause`/`resume`, `setPlayableSuspended`, `setPlaying`) accounts elapsed time under the OLD state first via the existing `account()` boundary before applying the change — the same discipline sections 6-7/17.3 already established for ordinary `v*`, now shared by all three families in the same call. Verified by unit test for every boundary the prompt enumerates: sub-50%↔>=50% crossings, each threshold crossing (50/70/85/95), playback start/pause/resume/end, document hidden/shown, semantic suspension/restoration, Project Modal close, view-instance changes, and materialize/flush (no double-counting, no zero-delta spam — see Tests below).

**Schema/files changed.**
- `src/lib/telemetry/visibility.ts` — `PlayableKind` type, `PLAYING_OBSERVABLE`, `ObserveOptions.playableKind`, `Target.playableKind`/`playableSuspended`/`playingActive`/`videoStartEmitted`/`playableCumulative`/`playableSent`/`playingCumulative`/`playingSent`, `setPlayableSuspended()`, `setPlaying()`, `maybeStartVideo()`, extended `account()`/`drain()`, `VideoStartEmitOptions`, extended `VisibilityEmitOptions`/`VisibilityDeps.emit` (overloaded for `video_start`).
- `src/lib/telemetry/{types.ts,queue.ts,client.ts,index.ts}` — wire types and the public `setVisibilityPlayableSuspended`/`setVisibilityPlaying` API, following the exact existing pattern of `setVisibilityTriggerContext`/`endVisibilityAppearance`.
- `src/scripts/visibility.client.ts` — reads `data-visibility-playable-kind`; marks `facebook`/`youtube` suspended at registration (mirroring the real DOM's own blanked-iframe/not-yet-constructed-player state at that same moment) and wires the GIF `<img>` load gate directly (no `projectModal.client.ts` involvement needed for GIF).
- `src/scripts/projectModal.client.ts` — `initNativeVideoPlayback()` (real `playing`/`pause`/`ended` listeners); YouTube `onReady`/`onStateChange` now also call `setVisibilityPlayableSuspended`/`setVisibilityPlaying`; `activateFacebook`/`stopFacebook` now also call `setVisibilityPlayableSuspended`.
- `src/components/projects/ProjectDetail.astro` — `PLAYABLE_KIND` map, `data-visibility-playable-kind` attribute in `mediaVisibilityAttrs()`.
- `workers/telemetry/src/{validate.ts,index.ts}` — `playable_v50_ms..v95_ms` added (own nested-threshold check, own `EVENT_KEYS`/`MEASUREMENT_KEYS` entries); standalone `playing_ms` removed (was already present from the initial migration, speculative, never populated by any client — confirmed by search — and explicitly excluded from this pass's final field list).
- `migrations/0002_playable_media.sql` — adds the four `playable_v*` columns, drops `playing_ms`. Applied cleanly to local D1 (`ALTER TABLE ... ADD/DROP COLUMN` both work against a `STRICT` table on this D1/SQLite version — confirmed live, see Tests).

**Explicitly not built.** No second visibility/geometry engine (the existing `IntersectionObserver`-backed engine is extended, not duplicated). No Facebook SDK/script integration (opaque stays opaque; `playable_v*` alone is the correct, honest measurement for it). No `max_attainable_ratio`. No 25/50/75/100 completion milestones, watched percentage, or any inferred/guessed playback. No client-side ratio calculations (`playing_v85_ms / playable_v85_ms` etc. are a later, off-device analysis step per the prompt). No engagement/intent labels.

**Tests.** 18 new deterministic cases in `src/lib/telemetry/test/visibility.test.ts` (122 total, all passing) — the test rig's `emit` now tags each captured event with its `type` (`deltas()`/`videoStarts()` filters added) so a test can assert against interleaved `visibility_delta`/`video_start` events precisely. Coverage: playable begins only >=50% (native-video); playable/playing nesting across all four thresholds (gif for playable-only, youtube for both); a below-50% target never starts an appearance at all (zero of everything); opaque-provider suspension (facebook) blocks `playable_v*` while ordinary `v*` keeps accumulating, and `playing_v*` is never sent; GIF load-gating (suspended until `setPlayableSuspended(el, false)`, mirroring the real `load` event); visible-but-not-yet-playing accumulates `playable_v*` but not `playing_v*`, with no `video_start`; `video_start` fires exactly once per appearance and pause/resume within the same appearance never re-fires it; playing below 50% contributes zero (no appearance to attach it to at all); `ended` stops `playing_v*` like `pause`; YouTube's not-ready-yet suspension window nests correctly with real threshold crossings, and `video_start` carries the same static properties as `visibility_delta`; `video_start` never invents an autoplay/user-started distinction; `setPlaying` is a hard no-op for facebook/gif; document-hidden and semantic-suspension (Skills over main) both contribute zero across all three families and resume correctly, staying the same appearance throughout; a Project Modal instance-boundary close stops all three families immediately; no zero-delta spam when toggling suspended/playing below 50%; `materialize()` sends only newly-accumulated `playable_v*`/`playing_v*` each time, never the cumulative total; cross-context canonical identity (same `target_id`, Timeline vs. Project Modal, independent playing accounting per DOM instance); and a real `project_content` `visibility_delta` (with `playable_v*`/`playing_v*`) plus its `video_start` both passing the real Worker validator. `npm run telemetry:test` (122/122), `npm run worker:test` (19/19, extended with playable-family nested-threshold and only-on-`visibility_delta` cases), `npx tsc --noEmit -p .` (clean besides the 2 pre-existing, unrelated errors already noted in 17.6), `npx tsc -p workers/telemetry` (clean), `npm run build` (clean), `npx astro check` (same 2 pre-existing errors, confirmed unrelated to this pass — a stray premature block-comment closure this pass twice introduced via a literal `*/` inside `/** ... */` prose, in `visibility.ts` and `ProjectDetail.astro`, was caught and fixed by exactly this typecheck step before it reached the test suite).

**Manual local verification (this pass).** Local workflow as in 17.1-17.2/17.5 (`telemetry:clear`, `telemetry:dev`, `dev:telemetry`, direct `wrangler d1 execute --local` queries for the new columns, since `scripts/telemetry.mjs events` doesn't print measurement columns — consistent with it also not printing `v50_ms` etc. today). Real, controlled local D1 rows:

- **YouTube (Heroes VI, `heroes6-tutorial`).** Opened the Project Modal, scrolled the clip into view, let it autoplay and play for ~30s real time. Live rows: `video_start` at `elapsed_ms: 28552` with `properties: {"content_type":"youtube","person":"both"}` and every measurement column `NULL` (correctly not stored on a non-`visibility_delta` event); two subsequent `visibility_delta` rows with `v50_ms == playable_v50_ms == playing_v50_ms` exactly (`12254` then `19991`, cumulative-then-delta as expected) and `v95_ms/playable_v95_ms/playing_v95_ms: 0` throughout (the gallery item never reached 95% visible in this viewport — consistent with 6.2's general oversized-content caveat, not a defect) — i.e. this clip was visible, playable, and actually playing for the *entire* measured span, exactly matching what was observed on screen (continuous autoplay, no pause).
- **Facebook (`around`, `around-trailer`).** Confirmed **no autoplay** (a real play-button overlay shown, per Facebook's own paused UI). Confirmed the iframe `src` is the real, non-blank URL immediately once the modal opens (`activateFacebook` ran), and **stays that exact URL** even after scrolling the item fully out of the Project Modal's own internal scroll area and back — direct, live disproof of the brief's own recollection that Facebook embeds reset around a scroll-visibility boundary; the actual reset boundary is modal/panel open↔close, not scroll position (see the per-kind audit above). Live rows across three `visibility_delta`s spanning a real ~35s dwell with genuine scrolling in between: `v50_ms == playable_v50_ms` exactly in every row (`12354`/`20000`/`7140`, the middle one a full periodic-flush-interval `20000`), `v95_ms == playable_v95_ms == 0` throughout (never reached 95% in this viewport), and `playing_v50_ms: NULL` in every row — no `video_start` row exists for this target at all. This is the live, technically-verified confirmation of "playable_v* alone, never playing_v*, for an opaque provider."
- **GIF (`placeholder-gif`, via `PLACEHOLDER_MEDIA`).** Not reachable through today's live UI (see the per-kind audit above — no current project both uses the fallback and has a clickable modal). Verified instead with a temporary, in-session-only `gif` entry added to an existing project's media file (`data/media/hypha.ts`), confirmed correctly wired (`data-visibility-playable-kind="gif"`, `data-visibility-content-type="gif"`), then **reverted before this pass finished** (never left in the working tree). Live DOM inspection during this temporary test additionally surfaced a real interaction worth recording: **a `gif`/`image` item's `<img>` has no reserved layout box before it loads** (`.shot-frame img { width:100%; height:auto }`, no `aspect-ratio` — unlike the video/YouTube frames, which do reserve `16/9`) — an unloaded image can render at a collapsed near-zero height, which could in principle interact with the browser's own native `loading="lazy"` proximity heuristic (a separate mechanism from the Visibility Matrix's own `IntersectionObserver`). This session's Browser-pane tool also independently exhibited its own previously-documented IntersectionObserver-delivery/pane-compositing flakiness (17.5's "Concern" note) during this specific check, affecting a plain, pre-existing `image` item identically to the temporary `gif` one — so the collapsed-height observation is reported as a real, worth-knowing content-model interaction, while the *load never completing* observation in that moment is attributed to the tool environment, not to this pass's code, consistent with 17.5's own precedent for the same tool limitation. The suspend-until-loaded logic itself (`playableSuspended` starting `true`, cleared on `img.complete`/`load`) is fully covered by deterministic unit tests exercising the identical `setPlayableSuspended` code path proven live via Facebook above.
- **Native `<video>`.** No live data entry exists to test end-to-end (same absence noted for 17.6's media-taxonomy audit). Not exercised live this pass; covered by unit tests against the identical shared engine machinery already proven live via YouTube (same `account()`/`drain()`/`setPlaying`/`maybeStartVideo` code, gated by the same `PLAYING_OBSERVABLE` set) and by direct source-level reading of `HTMLMediaElement`'s real event guarantees.
- **Schema.** `npm run telemetry:db:init` applied `0002_playable_media.sql` cleanly against the existing local D1; `sqlite_master` inspection afterward confirmed `playing_ms` is gone and the four `playable_v*` columns are present, confirming this D1/SQLite version supports both `ALTER TABLE ... ADD COLUMN` and `... DROP COLUMN` against a `STRICT` table.

**Provider limitations / unresolved observations (raw-data notes, not defects).**
- Facebook playback is, and will remain, permanently unknown at the individual-session level — `playable_v*` is the honest ceiling of what this site can ever know about a Facebook embed without integrating Facebook's own SDK (explicitly out of scope). Do not read a high `playable_v95_ms` on a Facebook item as evidence of engagement; it is exposure only.
- A native `<video>`'s continuing to decode/play in the background after its owning Project Modal closes (the finding above) is a real, minor site behavior (harmless — muted, and telemetry does not leak time from it either way) worth a future look if ever revisited, but is not a telemetry defect and was left alone per this pass's scope (don't fix product behavior, audit and instrument it as it actually is).
- The collapsed-pre-load-height interaction between `image`/`gif` items and native `loading="lazy"` (noted above) is a genuine, if narrow, structural observation about the content model's CSS, not something this pass changes — flagged for whoever next touches gallery layout or lazy-loading behavior.

### 17.8 Implemented explicit-action events (Telemetry Pass 3)

**Goal.** Instrument the six explicit-action events section 10 already named but left unimplemented: `nav_click`, `cv_download`, `linkedin_click`, `contact_email_copy`, `contact_email_open`, `external_link_click`. No new Worker/schema work was needed — all six were already in `EVENT_TYPES` (`workers/telemetry/src/validate.ts`) and the generic `target_type`/`target_id`/`properties` validation already covers every shape used here.

**Audit of the real action paths (done before writing any listener).**

- **Navbar** (`NavBar.astro` + `navScroll.client.ts`) — one authoritative handler: a single `click` listener on `.navbar` that intercepts only `href="#about|#timeline|#contact"` and calls `event.preventDefault()` before smooth-scrolling. Every other link (there are none today) falls through to the browser's native jump untouched. This is the instrumentation point — no second/generic listener was added.
- **Navbar availability** — unchanged, confirmed by reading (not by adding new checks): `main`/`skills` leave `.navbar` (`z-index: 10`, fixed) on top and clickable. Project Modal is a native `<dialog>` opened via `showModal()`, which renders in the browser's top layer above any fixed `z-index`, so the navbar is structurally unreachable while it's open. Skill Filtered View promotes `.person-bar`/`.filter-results` to `position: fixed` at `z-index: 27` (`ScrollyRegion.astro`), above the navbar's `10`. Neither required a code change; both already made "unavailable" true before this pass.
- **Sticky Person cards** (`ScrollyRegion.astro`'s `.side-panel[data-person]`) — CV download (`CvDownloadLink.astro`'s `.cv-download`) and, in Contact mode only, person LinkedIn (`.side-panel-linkedin .linkedin-pill`, crossfaded in over the Skills toggle at the same position — confirmed in CSS: `.side-panel-linkedin { opacity: 0; pointer-events: none }` until `body.contact-mode`, and hidden again under `body.filter-active`). Both are plain, always-in-DOM anchors with **no existing JS attached at all** — `explicitActions.client.ts` (new) is the first script to listen on them.
- **Company Contact card** (`CompanyContactCard.astro`) — a split "email pill" (`.email-copy-btn` clipboard copy + `.email-mailto-link` mailto) plus a separate LinkedIn pill (`ExternalLink`, marked `.company-linkedin-link` this pass so its own script can select it precisely without also matching the split email pill's outer wrapper `div.contact-pill`). The copy button already had its own click handler (with a `// Future telemetry hook: contact_email_copy` comment marking exactly this point) — extended in place rather than duplicated elsewhere.
- **Other meaningful external links** — audited every `target="_blank"` anchor site-wide. Two, both in `ProjectDetail.astro` (shared by Project Modal and Skill Filtered View): the project's official-site chip (`.project-link-chip`, from `ProjectDef.url`) and the LinkedIn-post embed's blocked-tracker fallback (`.shot-linkedin__fallback`, shown only when the LinkedIn iframe itself fails to load). Both marked with `data-external-link-type`/`data-project-id` rather than hardcoded per-selector JS, so a future instrumented link needs no script change. `PersonContactCard.astro` (a `mailto:` link + its own `CvDownloadLink`/`ExternalLink` usage) is **dead code** — never imported/rendered anywhere (`Contact.astro` renders only `<CompanyContactCard />`); confirmed by a repository-wide reference search before deciding not to instrument it.
- **Skills availability by state** — read, not changed: Skills remains a `main`/`skills`-owned reveal (docs section 4.3); Project Modal and Skill Filtered View strip the cards to "name + role... no Skills/CV/LinkedIn buttons... nothing clickable" (`ScrollyRegion.astro`'s own comment, `body.filter-active` rules), so CV/LinkedIn/Skills genuinely cannot be activated from those states — no extra guard needed in the new listeners.
- **Main-page section/navigation behavior** — About/Timeline/Contact remain one continuous `main` surface (docs section 4.1); the only existing "which section" signals are `personPhotos.client.ts`'s `body.cards-arrived` (About → Timeline hand-off, scroll-driven) and `contactMode.client.ts`'s `body.contact-mode` (IntersectionObserver on `#contact`). `nav_click`'s `origin_section` reuses exactly these two classes rather than adding a third, competing "current section" observer.

**Event vocabulary implemented (all six; see also section 11).**

| Event | target_type / target_id | properties |
|---|---|---|
| `nav_click` | *(none — the destination is a UI label, not a content entity)* | `target` (about/timeline/contact), `origin_surface` (main/skills), `origin_section` (main only), `skills_mode` (skills only), `pointer_type` |
| `cv_download` | `person` / `mitko`\|`adam` | `pointer_type` |
| `linkedin_click` | `person` / `mitko`\|`adam`, or `company` / `mentor-game-studio` | `pointer_type` |
| `contact_email_copy` | `company` / `mentor-game-studio` | *(none — identity alone says what happened, docs section 12)* |
| `contact_email_open` | `company` / `mentor-game-studio` | `pointer_type` |
| `external_link_click` | `project` / `<project-id>`, when the destination has one | `destination_type` (`official_site` \| `linkedin_post_fallback`), `pointer_type` |

`STUDIO_CONTACT.id` (`'mentor-game-studio'`, new field on `data/contact.ts`) is a telemetry-only identity, deliberately distinct from any `ProjectDef`/`CompanyDef` id in `data/timeline.ts` (e.g. the unrelated `mentor` *project* id) — there was no existing "the studio, as a contactable entity" id to reuse.

**Payload construction is pure and unit-tested** (`src/lib/telemetry/explicitEvents.ts`, `test/explicitEvents.test.ts`) — the same split as `state.ts`/`visibility.ts` already established: a `build*` function validates its inputs against the same enums/regexes the Worker enforces and returns `null` (never emit) when identity isn't recognized, so DOM wiring code just collects inputs and calls these; nothing about *whether* to emit is decided in a `.client.ts` file. `pointerTypeOf()` mirrors `panelToggle.client.ts`'s existing `clickMethod()` technique: only a real `PointerEvent.pointerType` of `mouse`/`touch`/`pen` is ever recorded; a keyboard-activated `click` reports `pointerType: ''`, which is correctly *omitted*, never guessed as `'keyboard'` (docs section 8).

**Navbar (`nav_click`) — origin context, precisely.** `navScroll.client.ts`'s click handler reads `semanticState.get()` and the two body classes above **before** it mutates anything (in particular, before it sets `body.contact-mode` to the *destination* state) — otherwise a click landing on `#contact` would read its own destination as its origin. `origin_surface`/`skills_mode` come from the exact same coordinator `skills_open`/`skills_lock` already use (section 17.2), not a parallel read of the DOM. If `semanticState.get().surface` is ever `project_modal`/`skill_filtered` (structurally shouldn't happen — the navbar is unreachable then, per the audit above), `buildNavClick` rejects the surface as unrecognized and no event is emitted, rather than mislabeling it as `main`.

**CV download / person LinkedIn / generic external links (`explicitActions.client.ts`, new).** A dedicated telemetry-wiring script — the same role `visibility.client.ts` already plays for the Visibility Matrix — not a generic document click listener: each of its three `querySelectorAll` calls names one specific, enumerated selector (`.cv-download`, `.side-panel-linkedin .linkedin-pill`, `[data-external-link-type]`), and every other click on the page is untouched. Person identity reuses `panelToggle.client.ts`'s own `personOf()` convention (`el.closest('.side-panel')?.dataset.person`) rather than inventing a second identity scheme. All three targets are static at page load (every Project Modal/Skill Filtered View card is pre-rendered; nothing is created dynamically — confirmed by reading `projectModal.client.ts`'s `showModal()` wiring), so a one-time scan at module load is sufficient, the same assumption `visibility.client.ts` already makes.

**Company email/LinkedIn (`CompanyContactCard.astro`'s own script, extended).** `contact_email_copy` fires only from inside the success continuation of `navigator.clipboard.writeText().then(...)`, or after `legacyCopy()`'s `document.execCommand('copy')` **actually returns `true`** — the pre-existing fallback ignored that return value and always reported success; it now genuinely gates telemetry (and only telemetry — the existing checkmark/UI feedback, `markCopied()`, still runs on every path exactly as before, per the task's explicit "preserve the existing checkmark/UI behavior"). `contact_email_open` (the `.email-mailto-link` segment) and `linkedin_click` (`.company-linkedin-link`, newly marked so it can't be confused with the split email pill's own wrapper `div.contact-pill`) are new listeners beside it. No email address is ever placed in `properties` — event identity alone says what happened (docs section 12); confirmed with a live D1 scan (below) that no stored Pass 3 event contains `@` or a URL.

**`telemetry.flush()` before real outbound navigation (docs section 14).** `linkedin_click` and `external_link_click` call `void telemetry.flush()` right after emitting (a `target="_blank"` navigation could otherwise outlive the periodic 20 s timer on a fast bounce). `contact_email_open` does not — a `mailto:` hand-off to the OS mail client doesn't unload the page the way an actual navigation can. `cv_download` (a same-page `download`) and `contact_email_copy` (no navigation at all) don't either. `nav_click` is in-page and unaffected.

**Interaction/trigger metadata actually used.** Only `pointer_type` (`mouse`/`touch`/`pen`, from the real `click`/`PointerEvent`), on every event in this pass except `contact_email_copy` (deliberately bare — docs section 12's "properties are additive facts", and clipboard success/failure is already the whole story). No keyboard-vs-mouse inference beyond what `pointerTypeOf()` already reports as `undefined` — consistent with docs section 8's "do not infer 'mouse user'".

**Chronology — real examples (live D1 rows, local dev, this pass).** Three full journeys, unedited (only the properties column shown):

```
elapsed_ms  event_type           properties
15516       nav_click            {"target":"timeline","origin_surface":"main","origin_section":"about","pointer_type":"mouse"}
30402       nav_click            {"target":"contact","origin_surface":"main","origin_section":"timeline","pointer_type":"mouse"}
45980       contact_email_copy   (target: company:mentor-game-studio)
```

```
elapsed_ms  event_type           properties
102312      skills_open          {"trigger_person":"mitko","trigger_method":"hover","locked":false}
102317      cv_download          (target: person:mitko)
110184      linkedin_click       (target: person:adam)
117775      contact_email_open   (target: company:mentor-game-studio)
121219      linkedin_click       (target: company:mentor-game-studio)
```

```
elapsed_ms  event_type           properties
59842       skills_open          {"trigger_person":"mitko","trigger_method":"hover","locked":false}
59844       skills_lock          {"trigger_person":"mitko"}
77793       nav_click            {"target":"contact","origin_surface":"skills","skills_mode":"locked","pointer_type":"mouse"}
77794       skills_close         {"reason":"navigation","locked":true}
```

The third example is the exact "Skills exploration → `nav_click` from Skills, locked" chronology the task asked to be reconstructable: `nav_click` captured `origin_surface: "skills"`/`skills_mode: "locked"` **before** the click's own outside-click listener closed Skills a millisecond later (`skills_close reason: "navigation"`) — both queued in the same synchronous turn and flushed together by the existing semantic-state-boundary flush (section 17.3), with no manual flush trigger and no 20 s wait. None of the three examples contain a derived intent label — only raw facts, per docs section 10.

**Manual local verification (this pass).** Local workflow as in 17.1–17.2 (`telemetry:clear`, `telemetry:dev`, `dev:telemetry`), driven via this tool's built-in Browser pane against real rendered markup:

- **A. `main`/`timeline` → navbar Contact → company email copy** — confirmed live exactly as the first chronology example above; `contact_email_copy` carries only `target_type: "company", target_id: "mentor-game-studio"`, no `properties`.
- **B. CV download** — Mitko's `.cv-download` (inside the Contact-mode sticky card) produced `cv_download` with `target_id: "mitko"`.
- **C. Skills open → navbar Contact → Skills context + chronology** — confirmed live exactly as the third chronology example above, including the `skills_close (navigation)` ordering.
- **D. Person LinkedIn activation** — Ádám's `.linkedin-pill` produced `linkedin_click` with `target_id: "adam"` (the Browser pane blocked the resulting new-tab open, which is the tool's own new-tab policy, not a code path this pass touches — the click handler had already run and queued the event before that block).
- **E. Company email mailto, not confused with copy** — `.email-mailto-link` produced `contact_email_open` (`target_type: "company"`), a distinct event from `contact_email_copy`, confirmed side by side in the same session.
- **F. Representative external link** — Might & Magic: Heroes VI's official-site chip (`ProjectDef.url`) produced `external_link_click` with `target_type: "project", target_id: "heroes6", properties: {"destination_type":"official_site","pointer_type":"mouse"}`. The other wired destination (`linkedin_post_fallback`, on `.shot-linkedin__fallback`) shares the exact same `buildExternalLinkClick` code path and `data-external-link-type` mechanism — not separately live-fired this pass (in this dev environment the LinkedIn iframe itself loaded successfully, so its fallback anchor stayed behind the opaque iframe, unreachable — which is the *correct*, intended real-world behavior, not a gap).
- Also confirmed: company LinkedIn (`.company-linkedin-link`) produced `linkedin_click` with `target_type: "company"`, sharing the event with the person case but never emitting a duplicate `external_link_click` for the same click (docs section 7's "choose the more specific event").
- **No accidental duplicate specific + generic outbound events.** Every LinkedIn click (person and company) in the D1 rows produced exactly one event, `linkedin_click` — never also `external_link_click`.
- **No PII stored.** A live scan of every Pass 3 event this session (`properties LIKE '%@%' OR properties LIKE '%http%'`) returned zero rows.
- **Tool-environment note, reported per the existing 17.5 precedent:** the Browser pane briefly reported `window.innerWidth`/`innerHeight` as `0` and produced an inconsistent `contact-mode` reading while its own compositing was in the "hidden" state this session (`tabs_context` explicitly said so) — the same class of pane-compositing limitation 17.5 already documented for `IntersectionObserver`. Resizing the emulated viewport (which also re-fronts compositing) resolved it; not a defect in this pass's code, and every chronology example above was captured after that recovery, at a real, non-zero viewport size.

**Tests.** 19 new deterministic cases in `src/lib/telemetry/test/explicitEvents.test.ts` (141 total in `telemetry:test`, all passing): `pointerTypeOf`'s keyboard/synthetic (`''`) case is `undefined`, never guessed; `nav_click`'s main-vs-skills property shape (never both `origin_section` and `skills_mode` on the same event); unknown target/surface/section/mode is dropped or rejected, never invented; `cv_download`/`linkedin_click` reject an unrecognized person id even when it matches the generic id pattern; `linkedin_click`'s person/company split; `contact_email_copy` never carries an email address; `contact_email_open`/`external_link_click` carry `pointer_type` only when known; `external_link_click` rejects an unwired `destination_type`; and one batch containing all six event types passes the real Worker validator (`validateBatch`) unmodified. `npm run telemetry:test` (141/141), `npm run worker:test` (19/19, unchanged — no Worker/schema change was needed), `npx tsc --noEmit -p .` and `npx astro check` show the same 2 pre-existing, unrelated errors already noted in 17.6/17.7 (`alignApartPairs.client.ts`, `syncApartHeights.client.ts`), `npm run build` clean.

**Explicitly not built this pass** (per the task's own exclusions): context-menu telemetry, dead/noninteractive-click and repeated-click heuristics, any generic global click listener, session-end inference, derived intent, `max_attainable_ratio`, dashboards/analysis queries, and no change to playable-media/provider behavior beyond this pass's own scope.

### 17.9 Implemented UX interaction signals (Telemetry Pass 4)

**Goal.** Add objective interaction signals without global click logging: `noninteractive_click`, `click_burst`, `context_menu`, `action_failed`; fix the middle-click (`auxclick`) undercount; retire `repeated_noninteractive_click`. Raw telemetry records what the browser/UI did; "rage click", "confusion", "frustration" and "intent" are derived later, never emitted.

| File | Responsibility |
|------|----------------|
| `pointerGesture.ts` | `ActivationFilter`: turns `pointerdown`/`pointerup` into an "activation" (pure) |
| `clickBurst.ts` | `BurstDetector`: in-memory burst state machine (pure; injected timers/emit) |
| `interactionResolver.ts` | Semantic identity, region, interactive classification, allowlists (duck-typed `ElementLike`, no DOM needed) |
| `interactions.ts` | The one shared capture-phase listener set + payload builders; wired from `client.ts` |
| `actionFlows.ts` | Pure copy / project-open flows that decide success vs failure once |
| `explicitEvents.ts` | Also: `buildActionFailed`, `isLinkActivation`, `onLinkActivation` (auxclick) |

#### Activation detection (input to bursts and `noninteractive_click`)

`pointerdown` + `pointerup`, **not `click`**, observed on `window` in the **capture phase** with `{capture: true, passive: true}`; nothing calls `preventDefault`/`stopPropagation`. Capture matters because `vision.client.ts` calls `stopPropagation()` on Vision part clicks, which a bubble listener would never see. Pointer events (unlike `click` on plain text under delegated listeners in iOS Safari — **verify on a real iPhone**) are dispatched for every tap. An activation is one **trusted, primary** press/release (`isTrusted`, `isPrimary`, `button === 0`; Ctrl+click on a mouse is excluded as a macOS context-menu gesture) whose down→up travel is **<= 10 CSS px** (the audited threshold; not adjusted). `pointercancel` (scroll takeover, long-press) drops the press. Keyboard-generated clicks, synthetic events, secondary/middle buttons, drags, text-selection drags and scrolls therefore never count.

#### `click_burst`

Ordinary activations stay in a small in-memory candidate and are **never sent**. Constants live in `BURST` (`clickBurst.ts`):

| Rule | Value |
|---|---|
| Confirmed | >= 3 qualifying activations |
| Gap | consecutive activations <= 1000 ms apart (3 clicks can span ~2 s) |
| Spatial (**detection**) | every activation within a radius of the **first** activation (anchored — no drift chaining): **40 CSS px** for `pointerType` other than touch, **60 CSS px** for `touch`; pointer information comes from the event itself, nothing is inferred; `clientX/Y` are CSS px so high-DPI needs no adjustment |
| Termination | 1000 ms idle; an activation outside the radius (it terminates the burst and seeds a new candidate); hard caps of 10 s or 30 activations; lifecycle finalisation |
| Merge / cooldown | Bursts are never merged; no cooldown needed because each burst is emitted once, at finalisation |
| Per-session cap | `MAX_PER_SESSION = 25` emitted bursts |

**Triple-click text-selection suppression.** A burst that is exactly 3 activations, with every activation within <= 8 px of the first, lasting <= 600 ms, and where **every** activation landed on noninteractive, non-affordance content where text selection is plausible (not an image/video, not a control, not an allowlisted affordance) is dropped. It is deliberately narrow: 4+ activations, slower, wider, or any control/affordance hit are not suppressed. This suppresses only the obvious native triple-click-selection false positive; tests pin both sides.

**Event.** Emitted at burst END/finalisation with the ordinary `elapsed_ms` (the end time) — the emitter is not modified. Columns: `target_type`/`target_id` only when every semantically-resolved activation resolves to the same target; `view_instance_id` from the state at the burst's first activation (the capture-phase `pointerup` runs before UI click handlers, so this is the surface the burst began in). Properties:

| Property | Meaning |
|---|---|
| `start_elapsed_ms`, `duration_ms`, `click_count` | timing and count (start of the burst on the session timeline; correlate with other events by chronology) |
| `region` | closed enum, taken from the burst's first activation: `navbar`, `about`, `timeline`, `contact`, `person_bar`, `project_modal`, `skill_filtered`, `rotate_overlay`, `other` |
| `distinct_targets` | number of distinct resolved semantic targets (0 = none resolved) |
| `unresolved_clicks` | activations with no semantic identity |
| `target_class` | `interactive`, `noninteractive` or `mixed` |
| `center_x_ratio`, `center_y_ratio` | the arithmetic **centroid** of all the burst's activations, in viewport CSS px, as viewport ratios quantised to 2 decimals |
| `spread_px` | the maximum Euclidean distance from that **centroid** to any activation in the burst, rounded |
| `pointer_type` | only a real `mouse`/`touch`/`pen` value from the first activation |

**Detection vs. reporting are deliberately separate.** *Detection* (which activations belong to a burst) is anchored to the FIRST activation with the 40/60 px radius above and is unaffected by reporting. *Reporting* summarises the finished burst by its centroid and `spread_px`, so `(center_x_ratio, center_y_ratio)` plus `spread_px` describe a circle that contains every recorded activation. This is a spatial summary only — not evidence of which element the visitor meant to hit (use the semantic fields for that). Not used: distance from the first activation, bounding-box width, pairwise maximum, medoid. The earlier `x_ratio`/`y_ratio` names (a mean, with `spread_px` measured from the first click) are retired; historical local rows need no migration, and these are ordinary flat scalar properties so no schema or Worker change was required.

No existing action-event names are copied into the burst. Correlation is by chronology (`start_elapsed_ms`, the row's `elapsed_ms`, `view_instance_id`). A burst on a real control legitimately coexists with its own explicit/state events. Never stored: text, HTML, selectors, class lists, URLs, input values.

**Lifecycle finalisation (never lose a confirmed burst on exit).** A burst is confirmed at its third activation; it does not need its idle timer to survive exit. `client.ts`'s `safeFlush(lifecycle=true)` — the single existing path used by both `visibilitychange`→hidden and `pagehide` — now runs, in order: (1) `visibility.materialize()` (visibility already paused/accounted by the hidden handler), (2) `interactions.finalizeConfirmed()` (emits an already-confirmed burst with the count so far, clears its timer; **an unconfirmed 1–2 activation candidate is dropped, never promoted**), (3) viewport finalisation, (4) `transport.flush({lifecycle: true})` — the existing `keepalive` fetch. No new unload transport and no synchronous networking. `finalizeConfirmed()` is idempotent, so hidden + pagehide, or a late idle timer, never double-emit; periodic and state-boundary flushes (`lifecycle=false`) never finalise a burst. Browser/process termination can never be absolutely guaranteed. A regression test asserts that ordering in `client.ts`. Individual `noninteractive_click`/`context_menu` events are queued immediately and ride the ordinary flush independently.

**Cross-origin iframe limitation (accepted).** Clicks inside cross-origin provider iframes — the YouTube players/embeds, Facebook video/reel plugins and the LinkedIn post embed — are invisible to the parent page (no click/pointer events reach the document; they also do not reach the site's own click-outside handlers). Weak proxies such as `window` `blur` or focus changes are deliberately **not** used. A burst crossing into an iframe may be under-counted.

#### Semantic resolver and classification (`interactionResolver.ts`)

*Identity (innermost wins, only existing stable attributes):* `data-tag-id` → `skill`; `data-thought-id` → `vision_tooltip`; `data-visibility-target-type/-id` (`timeline_project`, `project_intro`, `project_content`, `filtered_project`, `skills_person`, `vision_*`); the CV / person LinkedIn controls → `person`; company LinkedIn, company email copy/mailto → `company:mentor-game-studio`; `data-external-link-type` + `data-project-id` → `project`; navbar links → `navbar:<about|timeline|contact>`; the open dialog's `data-project-id` → `project`; `data-person` → `person`; `data-company-id` → `company`. Presentation ids (`tl-*`) are never used. All ids must match the Worker's `[A-Za-z0-9_.:-]{1,64}`.

*Region:* closed enum above, from region containers (`.navbar`, `#rotate-overlay`, `dialog[data-project-modal]`, `#person-bar`, `#filter-results`, then `#contact`/`#timeline`/`#about`), falling back to `semanticState.surface` for modal/filter backdrops.

*Interactive vs noninteractive (`target_class`):* an activation is **interactive** if it hit `a[href]`, `button`, form controls, `summary`, `label`, `iframe`/`embed`/`object`, `video`/`audio` with `controls`, an element with an interactive `role` or a non-negative `tabindex`, or a known delegated/dismiss surface (`.filter-backdrop`, `.person-backdrop`, the `<dialog>` element itself = its backdrop). Otherwise it is noninteractive. **This describes whether the activation hit DOM controls / known actionable surfaces — NOT that the visitor's intended action happened or succeeded.** There is no listener introspection; a future `<div>` with a delegated handler would need adding to the known-surface list.

#### `noninteractive_click`

Deliberately **allowlisted**, emitted immediately (not at burst end) for one qualifying activation. Means only: *the visitor activated an allowlisted noninteractive semantic element*. `target_type`/`target_id` = the element's canonical identity; `view_instance_id` when a blocking surface is current; properties `element` (closed enum), `project_id` (only for surfaces where several projects share one view, i.e. Skill Filtered View), `pointer_type` when known. Never emitted when the activation hit a control.

| `element` | Target | Detection |
|---|---|---|
| `tag_pill` | `skill:<WorkTag id>` | project-modal tag pill (`<li data-tag-id>`, now rendered from canonical ids, never labels) |
| `unlinked_skill_tag` | `skill:<WorkTag id>` | non-button tag inside `.side-panel` (see the note below) |
| `gallery_media` | `project_content:<media id>` | inside `.shot-frame` of an `image`/`gif`/`image-row` item (not captions, not video/provider frames) |
| `filtered_card` | `filtered_project:<key>` | Skill Filtered View card box, header/title, and spacing containers — not prose, media or the project link chip |
| `person_card` | `person:<id>` | sticky-card body, **touch only**, never a control or the Skills content |
| `section_title` | `section:timeline\|contact` | `data-section-title` pills |
| `partner_logo` | `partner_logo:<logo id>` | reusable `data-partner-logo="<logo id>"` marker on a rendered logo (`ProjectDetail`'s logo and the Timeline `node-logo`); the canonical **logo id** from the logo registry (`data/logos.ts`), never a project id, path, filename or URL. Project context (`project_id` property, `view_instance_id`) stays separately recoverable. |
| `static_project_card` | `timeline_project:<id>` | the unnamed, non-clickable Timeline card (currently Ericsson Hungary): card box / content wrapper only, via `data-static-card` |

Not instrumented: prose/body text, decorative timeline geometry/whitespace, backdrops (they have dismissal semantics), interactive video/provider iframes. Person-photo hit testing (`pointer-events: none`) was not changed. **Logo identity.** Logos are their own resource (`src/data/logos.ts`): `LogoId` → `LogoDef {id, src, previewWidth?, detailWidth?}`, and a `ProjectDef`/`CompanyDef` optionally references one with `logoId` (explicit only — a project never inherits its company's logo). The same logo can be shared by many projects/companies without duplicating its asset config, and its id is the telemetry identity (`partner_logo/<logo id>`), so the same logo shown by different projects is one target. `lol-universe` maps to `logoId: 'riot-games'` with exactly the sizes it previously carried inline (80 px preview, 130 px modal header). Company logos (Black Hole, Primal, Flying Wild Hog — `company.logoId`) render beside the company name in the company box header via `CompanyLogo.astro`, on a light plate (dark-on-transparent artwork), a black plate (white-on-transparent artwork) or none (artwork with its own black background), as declared per logo by `LogoDef.plate`; they are noninteractive and use the same `partner_logo` telemetry identity. The Primal and Flying Wild Hog files were trimmed of their transparent padding.

**Unlinked Skills tags:** a production build enumerates 34 canonical tags rendered as 50 linked buttons across the two people and **zero** unlinked spans today, so `unlinked_skill_tag` is future-proofing; the `Tag.astro` span now carries `data-tag-id` like the button. **Note:** the Skill Filtered View renders no tag pills (`FilterResults` does not pass tags), so `tag_pill` currently only occurs in Project Detail modals.

#### `context_menu`

One shared capture listener; emits only when a meaningful semantic target resolves: company email (copy button / mailto / pill), CV, LinkedIn (person and company), project official-site / LinkedIn-fallback link (`destination_type`), skill tag, and gallery/embedded media frames (`content_type`). Arbitrary prose/body/background never emits. It means **only** that the browser context menu was invoked over the target — never Copy, Copy Link Address, Open in New Tab, Save Image or any other command; native Copy Link Address success is not observable by the page. `pointer_type` only when the event actually exposes it (a keyboard-invoked or unsupported case stays unknown). Platform limits: iOS Safari long-press shows a native callout without a page-visible `contextmenu` (**verify on a device**); Android Chrome long-press does fire it; `pointerType` on `contextmenu` is Chromium-tested only.

#### `action_failed`

A deliberate user action our own code attempted and objectively knows FINALLY failed. `properties.action` + `properties.reason` are closed enums (`ACTION_FAILURE_REASONS`, `explicitEvents.ts`); no exception messages; target is the action's own identity.

| action | reasons | notes |
|---|---|---|
| `contact_email_copy` | `clipboard_denied` (`NotAllowedError`/`SecurityError`), `clipboard_unavailable` (no API and the fallback failed), `copy_failed` | Emitted only when **every** mechanism failed; a rejected async API rescued by the `execCommand` fallback is a success. `contact_email_copy` (success) and `action_failed` never both fire. |
| `project_open` | `dialog_not_found`, `dialog_open_error` (`showModal()` threw) | target `project:<canonical id from the enclosing Timeline row>`; an already-open dialog is not a failure |

**Copy UI fix.** The copied checkmark previously appeared even if every copy mechanism failed. It now runs only from the final success outcome (`copyWithFeedback`); a failure shows a brief non-celebratory shake (`.is-copy-failed`) and an explanatory `aria-label`, and never the checkmark.

**Not `action_failed`:** provider/passive-media failures (a blocked YouTube API script, YouTube provider errors, automatic native-video resume rejection, blocked LinkedIn embed) — see the `media_load_failed` TODO; and anything downstream and unknowable (email actually sent, LinkedIn contact happening, a destination page loading, a CV being read). The rotate overlay's `sessionStorage` failure (a bug tracked in `docs/TODO.md`) would map to a future `action_failed` `rotate_overlay_dismiss` / `storage_blocked` once that flow is fixed on its own; nothing was changed there in this pass. This is not generic exception reporting.

#### `auxclick` (middle-click) fix

The Pass 3 handlers listened only to `click`; a middle-click on a link fires `auxclick` (and no `click`), so CV, LinkedIn (person and company), official-site/LinkedIn-fallback and `mailto:` activations were undercounted. `onLinkActivation` now registers both events on those links; `isLinkActivation` accepts `click` and `auxclick` **only for button 1**, so other auxiliary buttons never count, and one physical activation maps to exactly one event (a middle-click never fires `click`). Native navigation/new-tab behavior is untouched (no `preventDefault`), `pointer_type` stays objective (undefined when the event has none), and left-click behavior is unchanged. `mailto:` was included because middle-clicking a `mailto:` anchor performs its link activation (**verify per browser/OS**). Not applicable: the copy button (a `<button>`), navbar links (in-page navigation would only open a second site instance).

#### Research conclusions (closed)

- **Outbound handoff.** No reliable privacy-light browser signal proves what happens after a `mailto:` or external-navigation activation. `visibilitychange`, focus/blur and page lifecycle changes are all confounded (background-tab opens, popup blockers, the user switching tabs, `rel=noopener`, no handler configured) and are insufficient. Activation telemetry remains the reliable boundary; `contact_email_open` = mailto activation only, LinkedIn/outbound clicks = navigation activation only. The concrete actionable improvement — the middle-click undercount — is fixed above.
- **Native context menu / Copy Link Address.** `contextmenu` proves only menu invocation; the resulting command (and the success of Copy Link Address) is unobservable. Never equate `context_menu` with a copy.

#### Tests and manual verification

`test/pass4.test.ts` (61 cases, including burst centroid/spread) and `test/logos.test.ts` (10 cases: registry, company/project references, shared logo, `lol-universe` mapping, canonical logo telemetry id) covers activation filtering, all burst thresholds/anchoring/caps/suppression, lifecycle finalisation (hidden, pagehide, both, 1–2 activations, ordering in `client.ts`), payload shape, the resolver and allowlist per category, context menu, copy/project-open flows, auxclick, and Worker validation of every new event. `workers/telemetry/test/worker.test.ts` adds the vocabulary test (new events accepted, `repeated_noninteractive_click` rejected). Local D1 journeys (real trusted pointer input in the Browser pane): modal tag pill → `noninteractive_click`; 4 rapid activations on prose → one `click_burst`; 4 rapid Skills-toggle activations → `skills_lock/unlock` events + one interactive `click_burst`; 3 activations then hidden+pagehide → one confirmed `click_burst` finalised ~45 ms after it began; right-click on the official-site chip → `context_menu`; real copy → `contact_email_copy` + checkmark, simulated total failure → `action_failed clipboard_denied`, no checkmark; missing dialog → `action_failed project_open`. Middle-click could not be produced as trusted input in the Browser pane, so `auxclick` button 1 / 2 and `click` were dispatched synthetically on the link (one event for button 1, none for 2, one for `click`).

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
- watch-through ratio for observable playable media, e.g. `playing_v85_ms / playable_v85_ms` per `project_content` appearance (section 17.7) — how much of strong playable exposure was actually spent playing, for `native-video`/`youtube` only; for opaque providers (`facebook`) `playable_v*` alone remains the useful signal and must not be confused with, or averaged together with, known playback

Do not store these labels client-side. Definitions can evolve without changing historical raw data.

## 19. Exit/drop-off

Do not depend on a guaranteed `session_end`.

Use chronology and the last meaningful state/action/visibility evidence. Page-hidden events primarily pause timing and opportunistically flush data; hidden does not automatically mean the visitor permanently left.

## 20. Deferred / deliberately excluded from V1

- persistent visitor identity
- cross-session behavior
- analytics cookies or persistent telemetry identifiers (a minimal first-party preference may remember consent choices but must not identify/correlate visitors)
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
6. Add semantic state coordinator. (Done: section 17.2.)
7. Add Visibility Matrix engine and appearance tracking. (Done: section 17.3 — engine, semantic state-boundary flush, eligibility-aware `max_visibility_ratio`, full Timeline preview coverage, `vision_content`/`vision_tooltip`/`timeline_project`/`skills_person`.)
8. Instrument Vision. (Done: section 17.4 — `vision_content` scope made definitive, `vision_tooltip` added with canonical ids/trigger method/immediate-end semantics.)
9. Instrument Skills/person exposure. (Done as part of step 7: `skills_person`.)
10. Instrument Timeline project previews. (Done as part of step 7: `timeline_project`.)
11. Instrument Project Detail and Filtered View through shared ProjectDetail semantics. (Done as of Telemetry Pass 1: section 17.6 — `project_intro`, `project_content` (every discovered content type), `filtered_project`, context-dependent ownership, generalized instance-boundary rule. Pass 2 remains: video/media playback-specific behavior beyond ordinary visibility.)
12. Instrument Contact/CV/LinkedIn/email/navbar interactions. (Done: section 17.8 — `nav_click`, `cv_download`, `linkedin_click`, `contact_email_copy`, `contact_email_open`, `external_link_click`.)
13. Add video playback-duration enrichment where reliably available.
14. Add conservative noninteractive/repeated-click signals. (Done: section 17.9 — `noninteractive_click`, `click_burst`, `context_menu`, `action_failed`; `repeated_noninteractive_click` retired.)
15. Validate suspension, hidden-tab timing, batching, retries, and mobile/pointer behavior.
16. Implement the production analytics-consent requirements from `docs/privacy.md` (including the persistent Privacy / Analytics withdrawal control).
17. Implement telemetry privacy hardening required by `docs/privacy.md`: sanitized referrer, per-event Worker property allowlists, and automatic 90-day raw-data retention.
18. Verify third-party media consent remains independent from telemetry; provider-loading behavior itself is specified in `docs/privacy.md`.
19. Add the public privacy/analytics information required by `docs/privacy.md`.
20. Enable production telemetry only after the applicable privacy/consent work is complete.

## 22. Change discipline

When implementation or product behavior changes:

1. update this document in the same change when telemetry semantics/implementation change, and update `docs/privacy.md` when a cross-cutting privacy/consent decision changes;
2. distinguish raw facts from derived interpretations;
3. prefer stable content IDs over DOM/presentation IDs;
4. avoid adding fields merely because they are easy to collect;
5. do not weaken privacy constraints without an explicit design decision;
6. bump `telemetry_version` when a schema/semantic change makes old and new data meaningfully incompatible.

