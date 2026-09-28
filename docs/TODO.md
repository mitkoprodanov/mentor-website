# Project TODO

Lightweight tracker for noteworthy work discovered while developing/auditing the site —
especially things deliberately deferred rather than mixed into the current task.

Not a ticketing system: keep entries short, update status inline, delete when done or stale.

**Types:** Bug · Improvement · Idea · Audit
**Status:** Open · In Progress · Done

---

## Open

### Audit image/GIF reserved layout space
- **Type:** Improvement/Audit
- **Status:** Open
- Images/GIFs currently do not appear to reserve their eventual layout dimensions before
  loading, unlike video/YouTube's known aspect-ratio area. Audit whether intrinsic
  dimensions/aspect-ratio containers should be provided to reduce layout shift and
  optionally improve the pre-load visual state. Separate from telemetry — the Visibility
  Matrix should continue measuring actual geometry. Not implemented yet.
- **Area:** image/GIF rendering components (timeline media?)
