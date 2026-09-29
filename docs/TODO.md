# Project TODO

Lightweight tracker for noteworthy work discovered while developing/auditing the site —
especially things deliberately deferred rather than mixed into the current task.

Not a ticketing system: keep entries short, update status inline, delete when done or stale.

**Types:** Bug · Improvement · Idea · Audit · Cleanup · Research
**Status:** Open · In Progress · Done

---

## Open

### Remove or justify dead `PersonContactCard.astro`
- **Type:** Cleanup
- **Status:** Open
- `PersonContactCard.astro` was found to be unreferenced/unrendered during the Telemetry
  Pass 3 explicit-actions audit (only mentioned in comments elsewhere, never imported).
  Before deleting it, verify repository-wide that it is genuinely unused and not
  dynamically referenced. If unused, remove it in a future cleanup rather than carrying
  dead UI code. Not performed as part of that pass.
- **Area:** src/components/personal/PersonContactCard.astro

### Research native context-menu / copy-link observability
- **Type:** Research/Idea
- **Status:** Open
- Native browser "Copy Link Address" success is not observable by the page. Research
  whether any useful, privacy-light signal around context-menu use on meaningful links is
  worth recording. `contextmenu` can at most prove the context menu was opened on a
  semantic target; it must NOT be interpreted as a successful copy. Overlaps with the
  planned UX/confusion telemetry pass (`context_menu`, `noninteractive_click`,
  `repeated_noninteractive_click` — docs/telemetry.md section 12) — evaluate there rather
  than implementing now.
- **Area:** telemetry (UX-confusion signals pass)

### Research outbound handoff measurement limits
- **Type:** Research
- **Status:** Open
- We can observe activation of `mailto:` and external links (`contact_email_open`,
  `linkedin_click`, `external_link_click`) but not what happens after control leaves the
  site. Confirm whether there are any lightweight, privacy-compatible browser signals
  worth using to improve handoff measurement without external provider integrations,
  cookies, fingerprinting, or speculative inference. Preserve the rule that
  `contact_email_open` means mailto activation only, never email composition/send.
  Preserve the rule that LinkedIn/outbound clicks mean navigation activation only, never
  successful contact/action on the destination. If there is no reliable additional
  signal, document that conclusion here and close this item rather than inventing
  telemetry.
- **Area:** telemetry (contact/outbound events)

### Audit image/GIF reserved layout space
- **Type:** Improvement/Audit
- **Status:** Open
- Images/GIFs currently do not appear to reserve their eventual layout dimensions before
  loading, unlike video/YouTube's known aspect-ratio area. Audit whether intrinsic
  dimensions/aspect-ratio containers should be provided to reduce layout shift and
  optionally improve the pre-load visual state. Separate from telemetry — the Visibility
  Matrix should continue measuring actual geometry. Not implemented yet.
- **Area:** image/GIF rendering components (timeline media?)
