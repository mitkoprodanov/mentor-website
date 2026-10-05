# Privacy

Single source of truth for privacy **product behavior, consent UX and cross-cutting implementation rules** on mentorgamestudio.com. Telemetry event semantics live in [telemetry.md](telemetry.md); implementation work is tracked in [TODO.md](TODO.md).

> **Status:** target specification. The current shipped privacy UI predates the compact Privacy control below. Until implementation catches up, privacy must fail closed: analytics remains opt-in and third-party media remains gated.

## 1. Privacy model

The privacy model has **two independent optional permissions**:

- **External media**
- **Analytics**

The compact Privacy control exposes them together with an explicit no-consent choice:

| Control | Supporting text | External media | Analytics |
|---|---|---:|---:|
| **No optional services** | **Maximum privacy** | Off | Off |
| **External media** | **Essential visuals** | On | unchanged |
| **Analytics** | **Site improvement** | unchanged | On |

Interaction rules:

- selecting **No optional services** disables both External media and Analytics;
- selecting either External media or Analytics deselects No optional services;
- External media and Analytics are independent and may be enabled separately or together;
- disabling the last enabled optional service returns the control to No optional services.

### Effective default vs explicit choice

Before the visitor answers, both optional permissions are effectively Off: no analytics and no third-party media may load. Internally this is still `unanswered`, not an invented refusal. Only an explicit selection is remembered.

This distinction matters for behavior only: an unanswered visitor may still receive the lightweight reminder described below, while an explicit **No optional services** choice is considered settled.

## 2. Persistent control

Privacy must remain reachable without becoming a persistent banner.

### Resting state

- Use a **small lock-icon Privacy button** fixed to the **bottom-left corner of the viewport**.
- Keep it in the top-level viewport/UI layer, independent of the NavBar and document flow.
- It must remain visible, sharp and interactive above modal backdrops and blurred page layers, including Project Details and Skill Filtered View.
- Respect viewport safe-area insets and normal edge spacing.
- Once the visitor has made a privacy choice, the normal resting state is the lock button only.

### Attention while unanswered

While consent is unanswered:

- show the **thin Privacy bar floating along the bottom of the viewport**;
- keep it visually lightweight rather than using a modal or blocking banner;
- keep both the bar and Privacy button above modal backdrops and blurred page layers;
- the lock button may have a subtle periodic **idle glint** to indicate that an action is available;
- respect `prefers-reduced-motion`: no repeating glint/attention animation when reduced motion is requested.

The unanswered bar is informational and selectable. It must never block use of the site.

## 3. Interaction behavior

### Privacy bar placement

The Privacy bar is a **thin floating bottom bar anchored to the viewport**, not to the NavBar, document flow, current modal or page section.

Requirements:

- it stays at the bottom of the visible viewport while scrolling;
- it remains above modal backdrops and blurred background layers;
- opening or closing Project Details, Skill Filtered View or another modal does not close, re-parent, blur or disable the Privacy UI;
- it must not inherit modal blur, opacity, pointer blocking or stacking context;
- narrow/mobile layouts may wrap or compact the contents, but the bar should remain thin and non-blocking;
- respect bottom/left/right safe-area insets.

### Hover / focus preview

Hovering the lock button with a pointer, or focusing it with keyboard navigation:

- gives it the same selectable glow/hover language as other site buttons;
- temporarily displays the privacy bar;
- shows the compact Privacy control and the current effective choices;
- hides the temporary bar again when hover/focus leaves **unless the control has been pinned open**.

Hover alone never changes consent.

### Click / tap: pin open

Clicking the lock button pins the privacy bar open so it no longer disappears on unhover.

Touch devices have no hover, so a tap opens the pinned state directly.

A pinned bar closes when:

- the visitor clicks/taps outside it;
- the visitor presses `Escape`;
- the Privacy button is used again as an explicit close action, or another explicit close affordance is used.

Selecting External media or Analytics does not automatically close the bar, because the visitor may want to change both permissions.

Clicking inside the bar must not accidentally dismiss it.

### Privacy choices

The compact bar contains three selectable choices:

`No optional services   External media   Analytics`

with supporting text:

- **No optional services** — **Maximum privacy**
- **External media** — **Essential visuals**
- **Analytics** — **Site improvement**

External media and Analytics behave as independent selectable options. No optional services represents neither being allowed and is mutually exclusive with them.

Requirements:

- the current state must be visually unmistakable without relying on color alone;
- External media and Analytics must visibly support simultaneous selection;
- selecting No optional services disables both optional services;
- selecting either optional service deselects No optional services;
- disabling the last enabled optional service returns to No optional services;
- keyboard operation and visible focus are required.

The bar may include one short explanation:

> Choose whether to load external media and allow anonymous usage analytics.

A **Details** control exposes the minimum additional information without making the main bar larger.

### Details

**External media**  
Loads embedded content from YouTube, Facebook and LinkedIn. Your browser connects to these providers when their content is displayed.

**Analytics**  
Collects anonymous usage data to understand how the site is used and improve it. No persistent visitor ID, cross-site tracking or session replay. Raw analytics data is retained for 90 days.

**Your choices**  
Your privacy choices are stored in this browser and can be changed at any time using Privacy.

The detailed privacy information may provide further technical information and links to relevant third-party privacy policies.

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

Production analytics starts **only** when Analytics is explicitly allowed or when a remembered analytics consent already exists.

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

All four combinations are valid:

| Effective state | Analytics key | External-media key |
|---|---|---|
| **No optional services** | `refuse` | `refuse` |
| **External media only** | `refuse` | `allow` |
| **Analytics only** | `allow` | `refuse` |
| **External media + Analytics** | `allow` | `allow` |

The UI derives its selected controls directly from these two permissions. There is no separate preset or privacy-level state.

Before any explicit answer, keys may remain unset while both optional services remain effectively disabled.

Do not auto-grant a permission during migration. Existing stored combinations remain valid and map directly to the two independent controls.

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

The privacy control must be architected as **top-level viewport UI**, outside page/modal containers and outside any ancestor that receives modal blur, transforms, opacity or pointer blocking.

The Privacy button and bar share the same top-level stacking layer and remain independently interactive above Project Details, Skill Filtered View, modal backdrops and other ordinary site UI. Modal/project/filter views must not own, duplicate, re-parent or visually suppress the Privacy UI.

## 9. Acceptance criteria for the compact redesign

- Fresh visitor: no analytics or provider requests occur before consent.
- Fresh visitor: both optional permissions are effectively disabled without treating silence as refusal.
- Fresh visitor: thin reminder bar is visible but non-blocking.
- Settled visitor: only the small bottom-left lock control remains at rest.
- Privacy button and bar remain reachable independently of the NavBar.
- Hover/focus previews the bar without changing state.
- Click/tap pins the bar; pointer leaving no longer closes it.
- Outside click, `Escape`, or explicit close dismisses it without changing consent.
- **No optional services — Maximum privacy** disables both optional permissions.
- **External media — Essential visuals** can be enabled independently.
- **Analytics — Site improvement** can be enabled independently.
- External media and Analytics can be enabled simultaneously.
- Selecting either optional service deselects No optional services.
- Selecting No optional services disables both optional services.
- Disabling the final enabled optional service returns to No optional services.
- Analytics without External media is valid; provider media remains unloaded and media-related behavior/playback telemetry is therefore unavailable.
- Selecting External media or Analytics does not automatically close a pinned bar.
- The selected states are visually obvious and keyboard accessible.
- Details are available without being required to understand the basic choice.
- Privacy choices can be changed or withdrawn at any time.
- Reduced-motion users do not receive repeating glint animation.
- The Privacy button is fixed to the bottom-left viewport corner.
- The Privacy bar opens as a thin floating bar along the bottom of the viewport.
- Both remain visible, sharp and interactive above Project Details, Skill Filtered View, modal backdrops and blurred page layers.
- Modal blur never affects the Privacy button or Privacy bar.
- Scrolling does not move the Privacy UI with document content.
- Opening or closing a modal does not close or reset the Privacy UI.
- Mobile safe-area insets are respected.
- Existing stored preferences are never broadened automatically during migration.
