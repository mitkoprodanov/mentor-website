# Privacy

Single source of truth for privacy **product behavior, consent UX and cross-cutting implementation rules** on mentorgamestudio.com. Telemetry event semantics live in [telemetry.md](telemetry.md); implementation work is tracked in [TODO.md](TODO.md).

> **Status:** target specification. The current shipped privacy UI predates the compact three-level control below. Until implementation catches up, privacy must fail closed: analytics remains opt-in and third-party media remains gated.

## 1. Privacy model

The visitor-facing model is a **progressive three-level permission ladder**:

| Level | Visible label | External media | Anonymous analytics |
|---|---|---:|---:|
| 0 | **No optional services** | Off | Off |
| 1 | **External media** | On | Off |
| 2 | **Site improvement** | On | On |

Suggested explanatory copy:

- **No optional services** — no third-party embeds and no analytics.
- **External media** — load external media for richer project visuals.
- **Site improvement** — external media plus anonymous analytics to help improve the site.

The rightmost level is intentionally the easiest one-click way to allow both optional features.

The ladder is cumulative. Moving right grants the permissions included in that level. Moving left revokes permissions above the selected level.

### Effective default vs explicit choice

Before the visitor answers, the **effective level is 0**: no analytics and no third-party media may load. Internally this is still `unanswered`, not an invented refusal. Only an explicit selection is remembered.

This distinction matters for behavior only: an unanswered visitor may still receive the lightweight reminder described below, while an explicit level-0 choice is considered settled.

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

### Three-state switch

The primary control is a segmented three-state switch ordered left-to-right:

`No optional services  <<  External media  <<  Site improvement`

Requirements:

- the current level is unmistakable: filled/selected segment, not only a subtle color difference;
- the current state remains visible whenever the bar is shown;
- each segment is directly selectable; no cycling is required;
- the rightmost segment grants both External media and analytics in one action;
- the selected state must be understandable from text/iconography without relying on color alone;
- keyboard operation and visible focus are required.

The full descriptive text may be shown beneath or adjacent to the compact labels when space allows. On narrow layouts, labels may wrap or use short headings plus one-line descriptions; the permission meaning must not become ambiguous.

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

Production analytics starts **only** when level 2 is explicitly selected or when a remembered analytics consent already exists.

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

The three-level UI maps to them as follows:

| Level | Analytics key | External-media key |
|---|---|---|
| 0 | `refuse` | `refuse` |
| 1 | `refuse` | `allow` |
| 2 | `allow` | `allow` |

Before any explicit answer, keys may remain unset; effective behavior is still level 0.

Do not auto-grant a permission during migration. A legacy `analytics=allow, external=refuse` combination is therefore preserved as-is until the visitor makes a new selection. If encountered, the UI may show it as a temporary **Custom: analytics only** state rather than falsely displaying one of the three ladder levels. The next explicit selection collapses it into levels 0–2.

If storage is unavailable, the selected level applies for the current page load and the UI should state briefly that the preference could not be remembered.

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
- Level 0 disables both optional categories.
- Level 1 enables External media only.
- Level 2 enables External media and analytics together.
- Moving from level 2 to 1 stops analytics but leaves External media enabled.
- Moving from level 2 or 1 to 0 revokes both.
- Current level is visually obvious and keyboard accessible.
- Reduced-motion users do not receive repeating glint animation.
- The control remains above Project Details and Skill Filtered View.
- Existing stored preferences are never broadened automatically during migration.
