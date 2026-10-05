# Privacy

Single source of truth for privacy **product behavior, consent UX and cross-cutting implementation rules** on mentorgamestudio.com. Telemetry event semantics live in [telemetry.md](telemetry.md); implementation work is tracked in [TODO.md](TODO.md).

> **Status:** target specification. The current shipped privacy UI predates the compact three-level control below. Until implementation catches up, privacy must fail closed: analytics remains opt-in and third-party media remains gated.

## 1. Privacy model

The privacy model has **two independent optional permissions**:

- **External media**
- **Anonymous analytics**

The primary visitor-facing control is a **progressive three-level preset ladder** for the three most useful combinations, with the two underlying permissions also available as individual choices.

| State | Concise copy | External media | Anonymous analytics | Primary preset |
|---|---|---:|---:|---:|
| **No optional services** | **Full privacy** | Off | Off | Yes |
| **External media** | **Essential visuals** | On | Off | Yes |
| **Site improvement** | **With analytics** | On | On | Yes |
| **Limited analytics** | **Without media** | Off | On | No |

The three primary presets are therefore:

`No optional services  <<  External media  <<  Site improvement`

The rightmost preset is intentionally the easiest one-click way to allow both optional features. The preset ladder is cumulative: moving right grants the permissions included in that preset; moving left revokes permissions above it.

**Limited analytics** is a valid granular choice, not a fourth primary preset. It is reached by enabling Anonymous analytics while leaving External media disabled. Analytics still runs, but external provider media does not load, so media-related behavior and playback information cannot be observed.

The individual External media and Anonymous analytics controls remain the source of truth. The three-level ladder is a convenience UI that sets those two permissions to common combinations; it does not remove the visitor's ability to choose them independently.

### Effective default vs explicit choice

Before the visitor answers, the **effective permissions are both Off**: no analytics and no third-party media may load. Internally this is still `unanswered`, not an invented refusal. Only an explicit selection is remembered.

This distinction matters for behavior only: an unanswered visitor may still receive the lightweight reminder described below, while an explicit **No optional services** choice is considered settled.

## 2. Persistent control

Privacy must remain reachable without becoming a persistent banner.

### Resting state

- Use a **small lock-icon button** in the top-right corner.
- Visually align it with the existing NavBar corner when the NavBar is present, but do **not** make its visibility depend on the NavBar.
- Host it in the top-level viewport/UI layer so it stays visible above views that hide or replace the NavBar, including Project Details and Skill Filtered View.
- It must remain above ordinary modal content and be independently interactive.
- Once the visitor has chosen a level, the normal resting state is the icon only.

### Attention while unanswered

While consent is unanswered:

- show a **thin privacy bar** at the top of the page, directly below the NavBar when present; when the NavBar is absent, anchor it to the top safe UI edge;
- keep it visually lightweight rather than using a modal or blocking banner;
- the lock button may have a subtle periodic **idle glint** to indicate that an action is available;
- respect `prefers-reduced-motion`: no repeating glint/attention animation when reduced motion is requested.

The unanswered bar is informational and selectable. It must never block use of the site.

## 3. Interaction behavior

### Hover / focus preview

Hovering the lock button with a pointer, or focusing it with keyboard navigation:

- gives it the same selectable glow/hover language as other site buttons;
- temporarily displays the privacy bar;
- shows the three-level switch and the current effective level;
- hides the temporary bar again when hover/focus leaves **unless the control has been pinned open**.

Hover alone never changes consent.

### Click / tap: pin open

Clicking the lock button pins the privacy bar open so it no longer disappears on unhover.

Touch devices have no hover, so a tap opens the pinned state directly.

A pinned bar closes when:

- a privacy level is explicitly selected;
- the visitor clicks/taps outside it;
- the visitor presses `Escape`;
- an explicit close affordance is used, if one is present.

Clicking inside the bar must not accidentally dismiss it.

### Three-state presets and individual choices

The primary control is a segmented three-state preset switch ordered left-to-right:

`No optional services  <<  External media  <<  Site improvement`

Use the concise supporting copy:

- **No optional services** — **Full privacy**
- **External media** — **Essential visuals**
- **Site improvement** — **With analytics**
- **Limited analytics** — **Without media**

Requirements:

- the current preset is unmistakable: filled/selected segment, not only a subtle color difference;
- each preset segment is directly selectable; no cycling is required;
- the rightmost preset grants both External media and analytics in one action;
- the two underlying permissions are also exposed as separate binary choices under an **Individual choices** or equivalent expandable area;
- changing a preset updates both individual choices;
- changing an individual choice updates the effective state immediately;
- when the combination is External media Off + Analytics On, no primary preset is selected and the current state is shown as **Limited analytics — Without media**;
- the selected/effective state must be understandable from text/iconography without relying on color alone;
- keyboard operation and visible focus are required.

The concise supporting copy may be shown beneath or adjacent to the labels when space allows. On narrow layouts, labels may wrap; the permission meaning must not become ambiguous.

## 4. Consent semantics

### External media

External media means any project content that contacts a third-party provider to render:

- gated: `youtube`, `linkedin-post`, `facebook-video`, `facebook-reel`, and future third-party embed kinds;
- never gated: self-hosted/local `image`, `gif`, `image-row`, `text`, and native self-hosted `video`.

Before External media is allowed:

- no provider iframe, player, API script or provider thumbnail may be requested;
- render a local placeholder plus an ordinary external link such as “Open on YouTube ↗”.

When External media becomes allowed, currently rendered and later-rendered embeds may load immediately.

When it is revoked, provider embeds are removed/restored to local placeholders. Already-made network requests cannot be undone.

The media-kind classification remains centralized in `src/lib/embeds.ts` through `MEDIA_KIND_PRIVACY` / `requiresExternalMediaConsent(kind)`.

### Anonymous analytics

Production analytics starts **only** when Anonymous analytics is explicitly allowed, either through the **Site improvement** preset, through **Limited analytics**, or through the individual Analytics choice, or when a remembered analytics consent already exists.

Before consent:

- no telemetry client lifecycle starts;
- no telemetry session ID is generated;
- no telemetry-only listeners/observers are registered;
- no events are queued;
- the telemetry Worker is not contacted.

Granting analytics starts a **new anonymous session at that moment**. Earlier activity is not reconstructed or backfilled.

Revoking analytics:

- removes telemetry listeners/timers/observers;
- destroys telemetry UI-state coordination;
- discards unsent events rather than flushing them;
- makes no final telemetry request;
- starts a fresh session if analytics is later enabled again.

The production telemetry mode remains consent-gated. Development mode behavior is defined in [telemetry.md](telemetry.md); development settings must never bypass production consent.

## 5. Storage and migration

Keep the existing category keys so previously stored choices remain readable:

- `mgs_analytics_consent = allow | refuse`
- `mgs_external_media_consent = allow | refuse`

The presets and valid effective states map to them as follows:

| State | Analytics key | External-media key |
|---|---|---|
| **No optional services — Full privacy** | `refuse` | `refuse` |
| **External media — Essential visuals** | `refuse` | `allow` |
| **Site improvement — With analytics** | `allow` | `allow` |
| **Limited analytics — Without media** | `allow` | `refuse` |

Before any explicit answer, keys may remain unset; effective behavior is still both permissions Off.

Do not auto-grant a permission during migration. A legacy `analytics=allow, external=refuse` combination is preserved as the valid **Limited analytics — Without media** state rather than being collapsed into one of the three presets.

If storage is unavailable, the selected permissions apply for the current page load and the UI should state briefly that the preference could not be remembered.

No cookies, `sessionStorage`, persistent visitor IDs, consent timestamps or telemetry-linked identifiers are required.

## 6. Privacy boundaries

Never add without revisiting this document:

- persistent analytics visitor IDs or fingerprinting;
- raw IP storage (country-only Cloudflare metadata is permitted);
- session replay;
- raw pointer/mouse trails;
- arbitrary DOM/text or form-content capture;
- identity matching against email, LinkedIn, contact data or external accounts;
- a new third-party analytics service.

Once analytics is allowed, the current telemetry system may keep the explicitly documented anonymous event/session data in [telemetry.md](telemetry.md), including viewport/device capability data, journeys, visibility signals, public campaign UTMs and coarse interaction diagnostics.

### Referrer

Sanitize `document.referrer` before telemetry ingestion and again in the Worker. Keep scheme + host + path; strip query, fragment and credentials. Drop invalid/non-HTTP(S) values.

### Campaign attribution

Only the four explicit session fields are permitted:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`

Do not collect arbitrary query parameters or recipient-specific identifiers.

### Event properties

Telemetry event properties remain closed-schema and Worker-validated. Undeclared properties are rejected; telemetry must not become a free-text capture channel.

## 7. Retention

Raw production `sessions` and `events` are retained for **90 days from session start** and then deleted by the existing daily Cloudflare Cron retention job.

Long-lived aggregate reporting, if added later, requires a separate documented privacy decision.

## 8. Implementation ownership

Primary implementation locations:

- `src/components/PrivacyConsent.astro` — visible control/bar
- `src/scripts/privacyConsent.client.ts` — interaction, open/pin/close behavior
- `src/lib/externalMedia.ts` — External media preference
- `src/lib/embeds.ts` — privacy classification and embed URL construction
- `src/lib/telemetry/config.ts` — telemetry mode resolution
- telemetry lifecycle/client files documented in [telemetry.md](telemetry.md)
- `src/scripts/projectModal.client.ts` — load/revoke external embeds

The privacy control should be architected as **top-level site UI**, not as modal-owned UI. Modal/project/filter views may coexist beneath it, but should not need their own privacy copy or consent implementation.

## 9. Acceptance criteria for the compact redesign

- Fresh visitor: no analytics or provider requests occur before selection.
- Fresh visitor: thin reminder bar is visible but non-blocking.
- Settled visitor: only the small top-right lock control remains at rest.
- Lock remains reachable when the NavBar disappears.
- Hover/focus previews the bar without changing state.
- Click/tap pins the bar; pointer leaving no longer closes it.
- Outside click, `Escape`, or explicit close dismisses it without changing consent.
- **No optional services — Full privacy** disables both optional categories.
- **External media — Essential visuals** enables External media only.
- **Site improvement — With analytics** enables External media and analytics together.
- **Limited analytics — Without media** enables analytics while External media remains disabled.
- The three primary presets update the two independent permissions correctly.
- The individual External media and Anonymous analytics choices can be changed independently.
- Moving from Site improvement to External media stops analytics but leaves External media enabled.
- Moving to No optional services revokes both.
- Limited analytics does not load provider media and therefore cannot collect media-related behavior/playback telemetry.
- Current preset/effective state is visually obvious and keyboard accessible.
- Reduced-motion users do not receive repeating glint animation.
- The control remains above Project Details and Skill Filtered View.
- Existing stored preferences are never broadened automatically during migration.
