# Project TODO

Lightweight tracker for noteworthy work discovered while developing/auditing the site —
especially things deliberately deferred rather than mixed into the current task.

Not a ticketing system: keep entries short, update status inline, delete when done or stale.

**Types:** Bug · Improvement · Idea · Audit · Cleanup · Research
**Status:** Open · In Progress · Done

---

## Open

### Production privacy + anonymous analytics consent gate
- **Type:** Improvement / Privacy
- **Status:** Open
- Implement the anonymous-analytics consent flow and persistent Privacy / Analytics control
  defined in `docs/privacy.md` §2. Production telemetry stays inactive before consent;
  explicit local `dev:telemetry` behavior remains available for testing.
- **Area:** telemetry bootstrap/config, privacy UI

### Gate third-party media behind contextual provider permission
- **Type:** Improvement / Privacy
- **Status:** Open
- Implement the provider-specific media permission model in `docs/privacy.md` §3: local
  placeholder + external navigation before permission, provider embed only after explicit
  contextual permission, and no coupling to analytics consent. Decide whether provider
  permission is one-shot or remembered per provider.
- **Area:** ProjectDetail.astro, projectModal.client.ts, privacy UI

### Telemetry privacy hardening before production
- **Type:** Improvement / Privacy
- **Status:** Open
- Implement the telemetry hardening in `docs/privacy.md` §§4–7: sanitized referrer,
  allowlisted public-campaign UTMs, Worker-side per-event property allowlists, automatic
  90-day raw retention, and the anonymous-visit identity boundary.
- **Area:** src/lib/telemetry/session.ts, workers/telemetry, D1/maintenance

### Public privacy / analytics explanation
- **Type:** Improvement / Privacy
- **Status:** Open
- Add the visitor-facing privacy information specified in `docs/privacy.md` §8 and keep it
  reachable from the persistent Privacy / Analytics control.
- **Area:** site privacy UI/content

### Rotate overlay: storage failure can trap "Continue anyway"
- **Type:** Bug
- **Status:** Open
- `rotateOverlay.client.ts` calls `sessionStorage.setItem(...)` in the "Continue anyway"
  click handler *before* `hide()`. If storage is blocked/unavailable (private mode, blocked
  site data) it throws, `hide()` never runs, and the portrait-phone overlay cannot be
  dismissed. `show()`/init read `sessionStorage` unguarded too. Fix on its own: wrap every
  storage access in try/catch and always hide. Once fixed, a failed dismissal could map
  cleanly onto `action_failed` (`action: rotate_overlay_dismiss`, `reason: storage_blocked`)
  — not done in Pass 4, which deliberately did not touch this flow.
- **Area:** src/scripts/rotateOverlay.client.ts

### Design `media_load_failed` for provider/content delivery failures
- **Type:** Improvement / future telemetry
- **Status:** Open
- Passive content/provider delivery failures are deliberately **not** `action_failed`
  (which is only for deliberate user actions our own code knows failed). Design a separate
  event that distinguishes them. Known cases: `loadYouTubeApi()` has no error path — a
  blocked `iframe_api` script (Brave/uBlock) leaves the promise pending forever and the
  YouTube frames as empty placeholders; YouTube IFrame API `onError` codes (2, 5, 100,
  101, 150); automatic native-video resume `play()` rejections (autoplay policy); the
  LinkedIn embed being blocked (currently only a CSS fallback, no JS signal). The
  loadYouTubeApi hang is also worth fixing on its own (`script.onerror` → reject).
- **Area:** src/scripts/projectModal.client.ts, telemetry

### Real-device verification for Pass 4
- **Type:** Research
- **Status:** Open
- Not verifiable in the desktop Browser pane: (1) iOS Safari tap behavior — pointer events
  should fire for taps on plain text where delegated `click` may not; (2) `contextmenu` on
  iOS long-press (expected: native callout, no page event) and Android long-press
  (expected: fires); (3) `PointerEvent.pointerType` on `contextmenu` in Firefox/Safari;
  (4) real middle-click on the CV link and `mailto:` (the pane cannot produce trusted
  middle-click input; `auxclick` was verified with dispatched events only); (5) touch
  burst radius (60 px) feel on a phone; (6) native `<video controls>` click retargeting.
- **Area:** telemetry (Pass 4)

### Remove or justify dead `PersonContactCard.astro`
- **Type:** Cleanup
- **Status:** Open
- `PersonContactCard.astro` was found to be unreferenced/unrendered during the Telemetry
  Pass 3 explicit-actions audit (only mentioned in comments elsewhere, never imported).
  Before deleting it, verify repository-wide that it is genuinely unused and not
  dynamically referenced. If unused, remove it in a future cleanup rather than carrying
  dead UI code. Not performed as part of that pass.
- **Area:** src/components/personal/PersonContactCard.astro

### Stale Timeline title "toggle" leftovers
- **Type:** Cleanup
- **Status:** Open
- The Timeline section title pill still carries the `title-toggle` class/CSS (including a
  hover "reel" animation and a comment saying "click me to swap") from a removed
  direction toggle; the pill is inert (`cursor: default`) but styled like a button. Either
  drop the leftovers or decide it should be interactive. Telemetry now records taps on it
  as `noninteractive_click` (`section_title`), which may inform that decision. Also
  `.node-hint` CSS in ProjectRow has no markup.
- **Area:** src/components/timeline/Timeline.astro, ProjectRow.astro

### Skill Filtered View renders no tag pills
- **Type:** Improvement / Audit
- **Status:** Open
- `FilterResults.astro` does not pass tags to `ProjectDetail`, so tag pills exist only in
  Project Detail modals. Pass 4 wired `tag_pill` for both (the identity plumbing is in
  `ProjectDetail`), but the filtered view currently has none. Decide whether filtered
  cards should show them.
- **Area:** src/components/projects/FilterResults.astro

### Audit image/GIF reserved layout space
- **Type:** Improvement/Audit
- **Status:** Open
- Images/GIFs currently do not appear to reserve their eventual layout dimensions before
  loading, unlike video/YouTube's known aspect-ratio area. Audit whether intrinsic
  dimensions/aspect-ratio containers should be provided to reduce layout shift and
  optionally improve the pre-load visual state. Separate from telemetry — the Visibility
  Matrix should continue measuring actual geometry. Not implemented yet.
- **Area:** image/GIF rendering components (timeline media?)

## Done

### Research outbound handoff measurement limits
- **Type:** Research
- **Status:** Done (Telemetry Pass 4)
- **Conclusion:** No reliable privacy-light browser signal proves what happens after a
  `mailto:` or external-navigation activation. Visibility/focus/page-lifecycle changes are
  confounded (background tabs, popup blockers, tab switching, `noopener`, no handler
  configured) and insufficient. Activation telemetry remains the reliable boundary
  (`contact_email_open` = mailto activation only; LinkedIn/outbound = navigation
  activation only). The concrete, actionable improvement — the middle-click (`auxclick`)
  undercount — was fixed in Pass 4. See docs/telemetry.md 17.9.

### Research native context-menu / copy-link observability
- **Type:** Research/Idea
- **Status:** Done (Telemetry Pass 4)
- **Conclusion:** `contextmenu` proves only that the menu was invoked; the chosen command
  and native "Copy Link Address" success are not observable, and must never be equated
  with a copy. Implemented as `context_menu` on meaningful semantic targets only. See
  docs/telemetry.md 17.9.
