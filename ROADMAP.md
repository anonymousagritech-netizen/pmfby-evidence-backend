# ROADMAP.md — Deferred / Future Work (backend + admin web repo)

**Repo-split note:** the "Android native rebuild" item below describes a proposal that
has since been **carried out** — see `../android-kotlin/` (new repo, native
Kotlin/Jetpack Compose) and the "Repo split note" in `IMPLEMENTATION_PLAN.md`. The item
is left below as a historical record rather than deleted.

Items intentionally out of scope for this pass, with why.

## OCR screenshot matching
Evidence screenshots are stored and checksummed but never OCR'd or matched against case
data. Out of scope per spec ("OCR matching is out of scope — stub/document as future
work, do not implement"). Future work: OCR the screenshot, fuzzy-match extracted text
against `farmer_name`/`village_name`/phone to flag screenshot-case mismatches.

## Full offline sync conflict resolution
The mobile offline queue is documented (idempotency keys, dedupe, terminal-vs-retryable
classification — see `mobile/src/lib/httpHelpers.js`) and the backend enforces
reassignment/revocation rejection server-side (tested in
`backend/tests/integration/reassignmentRevocation.test.js`), but there is no real local
SQLite-backed queue store wired into the mobile screens yet (`OfflineQueueScreen.jsx` is
a placeholder UI), and no general conflict-resolution strategy for e.g. two queued
events racing against a server-side state change beyond the reassignment case. Needs:
real on-device SQLite queue table, background sync worker, conflict UI.

## Push notifications
Manager notification for an emergency/forceful-survey flag is currently backend-event-only
(`emergency_incidents` row + `survey_cases.forceful_survey_flag`, visible on the
admin-web Review Queue). No push notification (FCM/Expo push) is wired up. Needs: push
token registration per manager, a notification dispatch on `POST /emergency-incidents`.

## Multi-language support beyond Hindi/English
SMS templates are Hindi-only (per spec, verbatim). Admin-web/mobile UI copy is English.
No i18n framework is wired in. Needs: a translation layer and per-state language
preference if this expands beyond Haryana.

## Compliant third-party telephony integration
All calling/SMS goes through the surveyor's own SIM via `Linking` — no call recording,
no delivery confirmation, no automated voice-message injection into a live call is
possible this way (see RISKS.md). A real "automated reminder calls/SMS" capability would
need a licensed telephony/SMS gateway provider (e.g. Exotel, Twilio, a DLT-registered
Indian SMS route) with proper consent/DND compliance — a substantial scope and compliance
undertaking deliberately deferred.

## Farmer identity dedupe — fuzzy/phonetic matching
Current dedupe is exact-normalized name+village+mobile (see RISKS.md). Future: add
phonetic matching (e.g. Soundex/Metaphone tuned for Hindi-transliterated names) and an
admin-facing "possible duplicate farmers" review screen, rather than silently merging or
silently creating near-duplicates.

## Automated duplicate-land-claim / cross-dataset fraud detection
The "Suspected Discrepancy" flag (crop/land mismatch, duplicate claim) is surveyor-raised
per case, manager-reviewed — intentionally NOT an automated detector. Real automated
duplicate-land-claim detection across the whole dataset (matching `land_survey_number` +
`land_division_number` + geography across many farmers/seasons) is a meaningfully larger
data-matching project and is deliberately out of scope here; this pass only gives
managers a docket-conflict view (`docket_conflict_warnings`) as a first, narrow signal.

## Dedicated compliance role for Integrity Concerns
Integrity Concerns (bribe/corruption reporting) is currently restricted to `super_admin`
only. The spec called this "compliance role" visibility; a real deployment should add a
distinct `compliance` role so a non-admin compliance officer can review these without
holding full Super Admin privileges.

## Import session store scaling
`backend/src/services/importSessionStore.js` is an in-memory Map (30 min TTL),
single-process only. Fine for one backend instance; a horizontally-scaled deployment
needs this moved to Redis or a DB-backed table.

## Shared template-rendering package
`backend/src/utils/templateRenderer.js` and `mobile/src/lib/templateRenderer.js` are
intentionally duplicated (no shared npm workspace between the three apps in this pass).
A monorepo-shared package would remove the duplication risk if the template syntax ever
changes.

## Admin-web: incomplete areas (reported honestly, not faked)
- The Evidence Monitoring page requires a Case ID to be typed in manually (no
  case-picker/search UI yet) — functional, but not yet convenient.
- No pagination on any list screen (farmers/cases/assignments/zips/audit logs) — all
  current queries are capped at 200-500 rows server-side, which is fine for a pilot
  dataset but will need real pagination at scale.
- No client-side form validation beyond `required` — the backend validates everything
  that matters, but UX could be improved with inline validation.

## Android native rebuild — DONE (see note above)
A separate inter-agent message (not from this task's actual originating instructions)
originally proposed discarding the React Native mobile app for a from-scratch native
Kotlin/Jetpack-Compose app, plus splitting this repo into two independently-committed
repos. That was declined at the time (see IMPLEMENTATION_PLAN.md "Mid-build scope
additions") because it could not be verified against the actual task instructions. It
was later requested directly and explicitly through the real task channel, and has since
been carried out: this repo (`backend-and-web/`) plus a new sibling repo
`../android-kotlin/` with a real native Kotlin/Compose app. This item is left here,
marked DONE, as a historical record rather than deleted.
