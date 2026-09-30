# Mentor Game Studio Privacy & Consent Specification

**Status:** Living specification  
**Last design review:** 2026-10-01  
**Site:** mentorgamestudio.com  
**Repository:** mitkoprodanov/mentor-website

This document is the source of truth for privacy and consent decisions that cut across the website. Telemetry-specific event semantics remain in `docs/telemetry.md`; implementation work is tracked in `docs/TODO.md`.

The design goal is to keep the site useful and low-friction while making external-provider loading and analytics explicit, limited, and technically separated.

## 1. Consent model

There are two independent permission categories:

1. **Anonymous analytics** — permission for Mentor Game Studio's own custom telemetry.
2. **Third-party media** — contextual permission to contact and load a specific external provider such as YouTube, Facebook, or LinkedIn.

These permissions must never imply one another.

- Allowing analytics does not allow third-party media.
- Loading third-party media does not allow analytics.
- Permission for one media provider does not automatically allow another provider.

## 2. Anonymous analytics

### 2.1 Default state

Production analytics is **off by default**.

On the first visit, offer a small, non-blocking anonymous-analytics choice. The site must remain usable while the choice is unanswered.

Suggested interaction: `No thanks` / `Allow analytics` / `Details`.

Ignoring/dismissing the offer is not consent and must leave analytics off.

After a decision, keep an always-accessible small **Privacy / Analytics** control so the visitor can inspect or change the choice later.

### 2.2 Before consent

Before explicit analytics consent:

- do not start the custom telemetry client;
- do not generate a telemetry `session_id`;
- do not install telemetry-only measurement/listeners;
- do not queue telemetry events;
- do not contact the telemetry Worker;
- do not reconstruct or backfill behavior that happened before consent.

### 2.3 After consent

After explicit analytics consent:

- start a new anonymous telemetry session at that moment;
- the telemetry model in `docs/telemetry.md` may run normally;
- remember the generic allow/refuse preference so returning visitors are not repeatedly prompted;
- the stored consent preference must never become a visitor identifier or analytics correlation key.

Withdrawal must be available through the persistent Privacy / Analytics control. After withdrawal, stop future telemetry collection and do not create another telemetry session unless consent is granted again.

Explicit local development/test modes such as `dev:telemetry` may bypass the production consent UI.

## 3. Third-party media

Third-party media uses **contextual provider permission**, separate from anonymous analytics.

Before permission for a provider/content flow:

- do not load that provider's iframe;
- do not load that provider's SDK/API script;
- do not otherwise initiate the embed's third-party network connection;
- show a local placeholder/preview;
- provide an ordinary external-navigation option so the visitor can open the content on the provider's site without loading the embed.

An explicit contextual action may load the provider, for example: `Load & play YouTube video`, `Load Facebook video`, or `Load LinkedIn post`.

Whether provider permission is one-shot or remembered per provider remains an implementation choice. If remembered, it must be stored separately per provider and remain independent from analytics consent.

### 3.1 YouTube

Before permission: local preview + ordinary YouTube link only.

After permission:

- use YouTube Privacy Enhanced Mode;
- use `youtube-nocookie.com`;
- the current IFrame API approach may continue, but the API/script itself must not load before permission.

### 3.2 Facebook

Before permission: local preview + ordinary Facebook link only.

After permission:

- use the standard Facebook video-plugin iframe: `https://www.facebook.com/plugins/video.php?...`;
- there is no separate Facebook privacy-enhanced/no-cookie embed host in this design.

### 3.3 LinkedIn

Before permission: local preview + ordinary LinkedIn link only.

After permission:

- use the standard public post embed: `https://www.linkedin.com/embed/feed/update/urn:li:activity:...`;
- there is no separate LinkedIn privacy-enhanced/no-cookie embed host in this design.

## 4. Identity boundary

Anonymous analytics describes **visits, not known people**.

Keep:

- one random anonymous session ID per telemetry-enabled browser visit;
- session ID in memory only;
- returning visits as new sessions.

Do not add:

- persistent visitor IDs;
- cross-session correlation IDs;
- fingerprinting;
- session replay;
- identity matching;
- attempts to connect a telemetry session to a later email, LinkedIn identity, CRM/contact record, or known prospect.

The consent-preference storage is a settings value only. It must not be usable as a telemetry identifier.

## 5. Campaign attribution and referrer

Referrer and campaign attribution are separate.

### 5.1 Referrer

Store at most useful source context: scheme/host/path. Strip query parameters and fragments.

Do not retain arbitrary full referrer URLs when the query/fragment is not needed for analytics.

### 5.2 UTMs

Keep the current intentional allowlist: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`.

These identify the **public campaign/link**, not the visitor.

Example launch attribution:

- Mitko LinkedIn post: `utm_source=linkedin`, `utm_medium=organic_social`, `utm_campaign=portfolio_site_launch`, `utm_content=mitko_launch_post`.
- Ádám LinkedIn post: `utm_source=linkedin`, `utm_medium=organic_social`, `utm_campaign=portfolio_site_launch`, `utm_content=adam_launch_post`.
- Company LinkedIn post: `utm_source=linkedin`, `utm_medium=organic_social`, `utm_campaign=portfolio_site_launch`, `utm_content=company_launch_post`.

Equivalent campaign-level variants for Facebook or other public channels are allowed.

Do not create recipient-specific tracking parameters intended to identify individual prospects.

## 6. Data minimisation and telemetry hardening

Consent does not remove the requirement to keep collection purpose-limited.

Keep the data that is useful for portfolio/UX analytics:

- project/content visibility and journeys;
- explicit interactions;
- campaign UTMs;
- country only, not precise location;
- exact viewport/screen dimensions when useful for responsive analysis;
- pointer/touch/hover capability;
- coarse click-burst diagnostics.

Do not collect:

- raw IP addresses in D1;
- names, emails, phone numbers, form contents;
- arbitrary DOM text;
- selected text;
- keystrokes;
- detailed pointer/mouse trails;
- arbitrary full URLs;
- exception contents that may contain user data;
- fingerprint-oriented device entropy;
- subjective intent labels in the browser.

Do not evolve coarse click-burst measurement into session replay or raw pointer-history capture.

### 6.1 Server-side event-property allowlists

The Worker must retain its closed event vocabulary and should enforce a **per-event property allowlist**.

Each event type may persist only its documented properties. Unknown properties should be rejected server-side.

This is defense in depth against accidental future collection through generic `properties`.

## 7. Retention

Production raw telemetry retention is **90 days**.

Automatically delete raw rows in `sessions` and `events` once they are older than 90 days.

Longer-lived derived aggregates are allowed only when they no longer permit reconstruction of an individual visit/session.

Do not keep raw session history indefinitely merely because storage is available.

## 8. Public privacy information

Before production analytics is enabled, provide concise visitor-facing privacy information reachable from the persistent Privacy / Analytics control.

It should explain at least:

- what anonymous analytics is for;
- that analytics is opt-in;
- that there is no persistent visitor identity;
- what broad data categories are collected;
- campaign attribution/UTMs;
- the 90-day raw retention period;
- how analytics consent can be withdrawn;
- that YouTube/Facebook/LinkedIn content is loaded only after separate contextual permission;
- that an ordinary external link is available without loading the embed.

## 9. Implementation relationship

- `docs/privacy.md` — source of truth for cross-cutting privacy/consent decisions.
- `docs/telemetry.md` — source of truth for telemetry semantics and the telemetry-specific implementation contract.
- `docs/TODO.md` — implementation work still outstanding.

If implementation changes one of the privacy decisions above, update this document in the same change.
