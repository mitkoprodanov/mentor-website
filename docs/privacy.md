# Privacy

Single source of truth for privacy **product behavior, consent UX and cross-cutting implementation rules** on mentorgamestudio.com. Telemetry event semantics live in [telemetry.md](telemetry.md); implementation work is tracked in [TODO.md](TODO.md).

> **Status:** target specification. The current shipped privacy UI predates the compact Privacy control below. Until implementation catches up, privacy must fail closed: analytics remains opt-in and third-party media remains gated.

## 1. Privacy model

The privacy model has **two independent optional permissions**:

- **External media**
- **Anonymous analytics**

The compact Privacy control exposes them together with an explicit no-consent choice:

| Control | Supporting text | External media | Anonymous analytics |
|---|---|---:|---:|
| **No optional services** | **Maximum privacy** | Off | Off |
| **External media** | **Essential visuals** | On | unchanged |
| **Anonymous analytics** | **Site improvement** | unchanged | On |

Interaction rules:

- selecting **No optional services** disables both External media and Anonymous analytics;
- selecting either External media or Anonymous analytics deselects No optional services;
- External media and Anonymous analytics are independent and may be enabled separately or together;
- disabling the last enabled optional service returns the control to No optional services.

### Effective default vs explicit choice

Before the visitor answers, both optional permissions are effectively Off: no analytics and no third-party media may load. Internally this is still `unanswered`, not an invented refusal. Only an explicit selection is remembered.

This distinction matters for behavior only: an unanswered visitor may still receive the lightweight reminder described below, while an explicit **No optional services** choice is considered settled.

## 2. Persistent control

Privacy must remain reachable without becoming a persistent banner.

### Resting state

- Use a **small lock-icon Privacy button** fixed to the **bottom-left corner of the viewport**.
- The resting control is not a full circle: it is a compact corner-attached rounded tab emerging from the viewport edge, with only the exposed corner(s) rounded.
- Treat it like other ordinary site buttons: same hover language and a subtle idle glint.
- Keep it independent of the NavBar and document flow.
- It must remain visible, sharp and interactive above blurred page layers, including while Project Details or Skill Filtered View is open.
- When no native modal dialog is open, host it in the top-level viewport/UI layer.
- When a native `showModal()` dialog is open, the Privacy UI may be rendered or mirrored inside that active dialog's interactive subtree so it remains usable without closing or resetting the modal. This is the one allowed exception to top-level ownership.
- Respect viewport safe-area insets and normal edge spacing.
- Once the visitor has made a privacy choice, the normal resting state is the compact lock tab only.

### Attention while unanswered

While consent is unanswered:

- show the **thin Privacy bar floating along the bottom of the viewport**;
- keep it visually lightweight rather than using a modal or blocking banner;
- keep both the bar and Privacy button above blurred page layers and interactable in the current active UI layer;
- use the same subtle periodic **idle glint** as other attention-seeking site buttons;
- respect `prefers-reduced-motion`: no repeating glint/attention animation when reduced motion is requested.

The unanswered bar is informational and selectable. It must never block use of the site.

## 3. Interaction behavior

### Privacy bar placement

The Privacy bar is a **thin floating bottom bar anchored to the viewport**, not to the NavBar, document flow, current modal or page section.

Requirements:

- it stays at the bottom of the visible viewport while scrolling;
- it remains visually above blurred background layers;
- opening or closing Project Details, Skill Filtered View or another modal does not close, reset or change the Privacy choices;
- when a native modal `<dialog>` opened with `showModal()` is active, Privacy must be available from within that dialog's interactive subtree; ordinary `z-index` or an external popover must not be relied on to bypass modal inertness;
- moving the rendered Privacy surface between the normal viewport host and the active modal host must preserve the same consent state and open/pinned state;
- narrow/mobile layouts may wrap or compact the contents, but the bar should remain thin and non-blocking;
- respect bottom/left/right safe-area insets.

### Privacy over modal views

Project Details must remain open while Privacy is used.

When Privacy is opened over a native modal view:

- the underlying modal stays mounted, visible and at the same scroll/view state;
- Privacy becomes the active interaction surface without closing or recreating the modal;
- changing External media or Anonymous analytics applies immediately to the existing modal content;
- granting External media replaces eligible placeholders with embeds in place;
- revoking External media restores placeholders in place;
- closing Privacy returns interaction to the same modal state.

Because `showModal()` makes elements outside the dialog inert, do not solve this with `z-index` or a top-layer popover outside the dialog. Use the active dialog as the Privacy host while it is modal.

### Open, preview and pin behavior

The Privacy tab follows the site's ordinary button behavior:

- hover/focus applies the normal hover visuals and opens the bar in **preview** mode;
- leaving the tab/bar closes a preview-open bar;
- clicking/tapping the tab opens and **pins** the bar;
- the pinned state must be visibly reflected on the Privacy tab;
- clicking the tab again while pinned closes it;
- touch devices open directly into the pinned state.

A pinned bar also closes on outside click, `Escape`, or the explicit minimize control. The minimize control exists **only while the bar is pinned**; preview-open bars do not show it.

Selecting External media or Anonymous analytics does not close the bar, because the visitor may want to change both permissions. Clicking inside the bar must not accidentally dismiss it.

### Privacy bar layout and choices

When opening and closing, the Privacy bar should visibly originate from the bottom-left Privacy tab and scale/reveal primarily **horizontally to the right**. The transition should feel fast and direct, similar to the Skills UI. Reveal the contents once there is enough room for them; do not animate the bar to the full viewport width merely for effect. On desktop, the open bar should stop at the width required by its contents plus normal spacing.

Keep the bar in this order:

1. the Privacy tab;
2. the short framing sentence;
3. privacy choices;
4. **Details**;
5. when pinned only, a narrow full-height **minimize** button at the far right using a `<` icon rather than an `X`.

The minimize control should read as collapsing the pinned bar, occupy the full bar height, and be only as wide as necessary. It is hidden in preview mode.

The choices are:

- standalone rounded control: **No optional services** — **Maximum privacy**;
- one shared rounded control to its right containing two independently selectable halves:
  - **External media** — **Essential visuals**
  - **Anonymous analytics** — **Site improvement**

The External media / Anonymous analytics group uses one common rounded outer border and a straight divider between its two halves. This must visually communicate that the two services are related optional choices but can be set independently.

No optional services represents neither optional service being allowed and is mutually exclusive with either half.

Requirements:

- the current state must be visually unmistakable without relying on color alone;
- External media and Anonymous analytics must visibly support simultaneous selection;
- selecting No optional services disables both optional services;
- selecting either optional service deselects No optional services;
- disabling the last enabled optional service returns to No optional services;
- keyboard operation and visible focus are required.

Keep one short framing sentence in the bar:

> Privacy settings for optional site services.

A **Details** control exposes the minimum additional information without enlarging the primary choice area.

### Details

**External media**  
Loads embedded content from YouTube, Facebook and LinkedIn. Your browser connects to these providers when their content is displayed.

**Anonymous analytics**  
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

Production analytics starts **only** when Anonymous analytics is explicitly allowed or when a remembered analytics consent already exists.

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

Privacy state and behavior must be owned by **top-level site UI**, not by individual modal implementations.

Rendering has two allowed hosts:

- the normal top-level viewport host when no native modal dialog is active;
- the currently active native modal dialog when `showModal()` would otherwise make the external Privacy UI inert.

Both hosts must render the same Privacy state and behavior. Modal/project/filter views must not duplicate consent logic or create their own privacy state. Switching hosts must not close, reset or recreate either Privacy or the underlying modal.

## 9. Acceptance criteria for the compact redesign

- Fresh visitor: no analytics or provider requests occur before consent.
- Fresh visitor: both optional permissions are effectively disabled without treating silence as refusal.
- Fresh visitor: thin reminder bar is visible but non-blocking.
- Settled visitor: only the compact bottom-left lock tab remains at rest.
- Privacy button and bar remain reachable independently of the NavBar.
- Hover/focus previews the bar without changing consent; leaving closes it unless pinned.
- Click/tap pins the bar and visibly marks the Privacy tab as pinned; clicking it again closes it.
- Outside click, `Escape`, or explicit close dismisses it without changing consent.
- **No optional services — Maximum privacy** disables both optional permissions.
- **External media — Essential visuals** can be enabled independently.
- **Anonymous analytics — Site improvement** can be enabled independently.
- External media and Anonymous analytics can be enabled simultaneously.
- Selecting either optional service deselects No optional services.
- Selecting No optional services disables both optional services.
- Disabling the final enabled optional service returns to No optional services.
- Anonymous analytics without External media is valid; provider media remains unloaded and media-related behavior/playback telemetry is therefore unavailable.
- Selecting External media or Anonymous analytics does not automatically close a pinned bar.
- The bar opens and closes with a fast horizontal scale/reveal originating from the bottom-left Privacy tab, similar in pace to Skills.
- On desktop, the bar grows only as wide as needed for its contents; it does not expand to the full viewport width for animation.
- The visual order is Privacy tab → framing sentence → choices → Details → minimize when pinned.
- External media and Anonymous analytics share one rounded outer border with a straight divider and remain independently selectable.
- The far-right close affordance is a narrow full-height `<` minimize button, shown only while pinned and never in preview mode.
- The selected states are visually obvious and keyboard accessible.
- Details are available without being required to understand the basic choice.
- Privacy choices can be changed or withdrawn at any time.
- Reduced-motion users do not receive repeating glint animation.
- The Privacy button is fixed to the bottom-left viewport corner.
- The Privacy bar opens as a thin floating bar along the bottom of the viewport.
- Privacy remains visible, sharp and interactive while Project Details or Skill Filtered View is open.
- Native modal inertness is handled by rendering Privacy inside the active modal when required; ordinary `z-index` is not treated as sufficient.
- Modal blur never affects the Privacy button or Privacy bar.
- Scrolling does not move the Privacy UI with document content.
- Opening or closing a modal does not reset Privacy state.
- Opening Privacy does not close, recreate or change the scroll/view state of Project Details.
- Granting or revoking External media while Project Details is open updates eligible content in place.
- Mobile safe-area insets are respected.
- Existing stored preferences are never broadened automatically during migration.
