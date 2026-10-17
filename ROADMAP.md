# ROADMAP.md — Deferred / Future Work (backend + admin web repo)

**Gap-filling audit pass:** this repo was re-audited item-by-item against the full
product spec (roles/RBAC, Excel import + AI column mapping, mandatory outcome
resolution, field-reality/fraud handling items 1-8, SMS template wording, evidence/ZIP
structure, and every admin-web screen). Nearly everything was already implemented and
tested; the one confirmed real gap was **user account lifecycle management**
(deactivate/reactivate/soft-delete) — `POST /api/users` and `GET /api/users` already
existed, but there was no way to deactivate or remove a user short of touching the
database directly, and admin-web had no Users screen at all. Both were added in this
pass (`backend/src/routes/users.js` PATCH/DELETE, `admin-web/src/pages/UsersPage.jsx`,
6 new integration tests in `backend/tests/integration/users.test.js`) with a
no-self-lockout guard (an admin cannot deactivate or delete their own account) and an
immutable audit trail (soft-delete only; `audit_logs` rows for a deleted user's past
actions are preserved). Everything else below was already true before this pass and
remains accurately described.

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

## Village centroid data + village-based auto-assignment (this pass)

### Village centroid extraction — done, with one scoping decision
`backend/scripts/extract_village_centroids.js` streams the all-India village boundary
shapefile (`shapefile` + `proj4`, never buffers the 3.2GB .dbf) and writes
`backend/data/village_centroids.ndjson`: 653,587 villages with name, vlcode, gram
panchayat, block, subdistrict, district (both variants), state (both variants), and a
reprojected WGS84 centroid (LCC → EPSG:4326 verified against a known Chittoor, AP point
before the full run). 29 records (0.004%) were skipped as "out of India's lat/lon
bounds" — inspection shows these are all real villages in far-NE Arunachal Pradesh whose
longitude is ~97.00–97.07, just past the bounding box's 97.0 upper edge used as a sanity
check; a real fix would widen that box slightly, left as a known minor gap rather than
re-running the ~5 minute extraction for 29 rows.

**Scoping decision:** the resulting NDJSON is 150MB — well over the "ideally under
~50MB" git-friendliness target from the brief. It is kept on disk only
(`.gitignore`'d) rather than committed; only the small `village_centroids_summary.json`
sanity-check file is tracked. The backend's `villageLookupService.js` loads it lazily on
first use and degrades to empty results (no crash) if the file isn't present.

**Getting the file onto Render (resolved — option (c)):** `POST
/api/village-data/upload` (Super Admin only, audited as `upload_village_centroids`,
`backend/src/routes/villageData.js`) streams a multipart file straight to disk via
`multer.diskStorage` (never buffered fully in memory — matters at 150MB on a free-tier
instance), sanity-checks the first NDJSON line looks like a village record, then
atomically renames it over the live file and calls
`villageLookupService.resetCache()` so the next lookup picks it up without a restart.
`GET /api/village-data/status` reports whether a file is currently loaded and its size.
admin-web's Auto-Assign page has a small upload card for this. Chosen over the two
alternatives raised: (a) a Render persistent Disk needs a paid instance type — not
confirmed to be in play here; (b) routing through the existing evidence-file storage
abstraction would mean transparently AES-256-GCM-encrypting and decrypting 150MB of
public geographic reference data on every read, for no real benefit. The tradeoff with
(c): the file lives only on that Render instance's ephemeral disk, so **it must be
re-uploaded after every deploy that provisions a fresh instance/disk** (Render's free
web services don't guarantee disk persistence across deploys) — this is a manual step,
not automatic. If this becomes painful in practice, revisit with a real object-storage
backend (S3/MinIO, or a Render persistent Disk once/if the plan supports it).

### Village-based auto-assignment — backend done and tested; admin-web built out
Implemented per spec: `backend/src/services/autoAssignService.js` (pure, unit-tested
balancing/priority/ordering/fallback functions — 11 unit tests) +
`backend/src/services/villageLookupService.js` (exact/fuzzy name matching via
Levenshtein similarity, haversine nearest-neighbor) + `backend/src/routes/autoAssign.js`
(`POST /api/auto-assign/preview`, `POST /api/auto-assign/commit`, `GET
/api/auto-assign/runs`, `GET /api/auto-assign/villages/lookup`, `GET
/api/auto-assign/villages/nearby` — all Super Admin only except the two read-only
village lookups which Manager can also use; integration tests cover RBAC + the
preview-doesn't-write / commit-does-write distinction). Migration
`1700000009000_auto_assign.js` adds `users.home_district_ids` (text[], which districts a
surveyor is eligible for), `farmer_assignments.manual_override` (so the algorithm never
redistributes a manually-placed case), and `assignment_runs` (audit trail of every
preview/commit with full params + per-surveyor summary).

**admin-web, follow-up round — all four previously-deferred items now built:**
- **Leaflet map view** (`AutoAssignPage.jsx`, `react-leaflet` + free OSM tiles, no API
  key). `autoAssign.js`'s preview/commit responses now include `villageMarkers`: only
  the villages actually touched by that run (never all 653k), each with its assigned
  surveyor and a lat/lon from `villageLookupService`, colored per-surveyor on the map.
  Deliberately not clustered — the per-run set is small by construction (one village =
  one surveyor, one district-scoped run), so plotting it directly is the right call, not
  a shortcut.
  **Known limitation:** `survey_cases.district_id` is a source-system ID, not the
  district *name* the centroid lookup matches against (`district_h`); there's no
  ID→name mapping table yet, so village-name matching for markers is done without a
  district filter. This is best-effort and can occasionally pick the wrong same-named
  village in a different state. Fixing this properly needs a small `districts`
  reference table (ID → canonical name) — not built this pass; flagged here rather than
  silently shipped as if it were exact.
- **Surveyor home-district management UI**: `UsersPage.jsx` now has an inline
  chip-editor per surveyor row (add/remove district IDs into `home_district_ids` via
  `PATCH /api/users/:id`, which now accepts `homeDistrictIds`). Without this the
  auto-assign feature had no surveyors to assign to from the UI — now it does.
- **Village centroid file upload**: see the "Getting the file onto Render" note above.
- **Import-time fuzzy auto-correction**: `importService.applyVillageAutoCorrection()`
  runs on every imported row's `Level7_Name`/`District_Name` during commit. Exact
  matches pass through untouched; fuzzy matches ≥0.92 similarity are silently
  normalized to the canonical village spelling (recorded in that row's `rowLog` entry as
  `villageNote: {type: 'auto_corrected_village', from, to, confidence}`); matches in the
  0.82–0.92 band are left as-imported but flagged (`villageNote: {type:
  'village_needs_review', ...}`) for admin review rather than auto-changed, since an
  ambiguous auto-correction risks silently moving a case to the wrong village — this
  mirrors the exact/fuzzy-confidence tiering `columnMapping.js` already uses for Excel
  headers. If the centroid dataset isn't loaded, this degrades silently (never blocks or
  fails an import) — 6 unit tests cover all branches with a mocked lookup.
  **Not yet done:** admin-web's Import page doesn't surface `villageNote` entries from
  the row log in its UI yet (the data is there in `commitImport`'s response/row_log,
  just not rendered) — worth a small follow-up so "needs review" rows are actually
  visible to the admin instead of only living in the raw audit/import_batches data.

### Visual redesign — done (admin-web)
Replaced the flat navy/gray-on-white styling (`admin-web/src/index.css`) with a real
design system: navy kept as the brand/primary color, plus teal/violet/amber accents and
a dedicated red/amber/green P1/P2/P3 + status-badge palette (`--p1-*`/`--p2-*`/`--p3-*`
tokens), card shadows/depth (`--shadow-sm`/`--shadow-md`), and consistent spacing/type.
- **Dashboard** (`DashboardPage.jsx`): real stat cards (total cases, completed, pending,
  pending emergency reviews, pending discrepancy flags) and two dependency-free
  horizontal bar charts (cases by status, open cases by priority), backed by a new
  `GET /api/reports/dashboard-summary` endpoint (role-scoped the same way every other
  list endpoint is: surveyor sees their own assigned cases, manager their state/district,
  super_admin org-wide).
- **Data-grid tables**: a small reusable `DataTable` component (`components/DataTable.jsx`
  — no external table library, to keep the Render free static-tier bundle small;
  gzipped JS is ~129KB after adding Leaflet) with sortable columns, a search box, and
  pagination. Applied to Farmers &amp; Cases, Evidence Monitoring, ZIP Archives, Audit
  Logs, Users, and the Auto-Assign preview table. Farmers and Audit Logs now use **real
  server-side pagination** (`page`/`pageSize`/`total` query params added to
  `routes/farmers.js` and `routes/auditLogs.js`) rather than loading a capped list
  client-side; Evidence/ZIP Archives/Users still fetch a server-capped list (200-500
  rows, unchanged from before) and paginate/sort/search that capped set client-side —
  reasonable for current data volumes, but the same real-pagination treatment should be
  extended to them if those lists grow large in practice.
- Status/priority badges (`components/StatusBadge.jsx`) now use the shared red/amber/
  green token scheme everywhere instead of ad hoc inline classes.

### Village polygon boundaries (follow-up round)
Full village outline polygons, not just centroid points, per direct follow-up request.
`backend/scripts/extract_village_boundaries.js` streams the trimmed national boundary
shapefile (`National_Boundary.{shp,dbf}` — same geometries/objectid order as
`merged_villages`, confirmed on the first two records before running the full job, just
8 lean attribute columns instead of ~90 census fields), reprojects every ring vertex
with the exact same proj4 LCC definition already verified for the centroid extraction
(re-verified here too: Chittoor, AP's first ring vertex reprojects to the same
~13.11°N 79.19°E as its centroid), then simplifies each polygon with `@turf/simplify`
(Douglas-Peucker) before writing one NDJSON record per village to
`backend/data/village_boundaries.ndjson`.

**Simplification tolerance — chosen after measuring, not guessed.** A 2000-record
sample was extracted at two settings before committing to the full ~650k-village run:
0.0005° tolerance + 5-decimal coordinate precision projected to ~387MB all-India;
0.001° tolerance (~110m) + 4-decimal precision (~11m, plenty for a web outline)
projected to ~190-210MB. Went with the second. **Actual full-run result: 653,616
villages, 0 skipped, average vertex count per polygon cut from 51 to 11 (simplify +
rounding), final file 257MB** — somewhat above the sample's projection (sample
variance; a few states' villages have more complex/exclave-heavy shapes than the
sample happened to catch) but still the right tradeoff: most of that size is an
intrinsic floor (every polygon needs a minimum handful of vertices, times 650k+
records' worth of JSON overhead) rather than something a larger tolerance would
meaningfully shrink further — and it doesn't matter for git either way, since (like the
centroid file) this one isn't committed there. Verified before committing to the full
run: Chittoor, AP's `Cheruvu Mundara Khandriga` polygon (same village spot-checked for
the centroid extraction) reprojects to the same ~13.11°N 79.19°E neighborhood and its
ring closes correctly (5 points after simplification).

**Storage/serving strategy:** `backend/src/services/boundaryLookupService.js` mirrors
`villageLookupService.js`'s lazy-load pattern, but indexes by district AND by
(district, village) so two request shapes stay cheap: "every boundary in district X"
(`GET /api/boundaries/by-district`) and "exactly these villages" (`POST
/api/boundaries/by-villages`, fed the village list straight off an auto-assign
preview/commit response) — the latter is what the Auto-Assign map actually uses, so a
browser never downloads more than the handful of villages in the current run, let alone
all-India data. Both endpoints are Manager/Super-Admin gated.

**Upload mechanism:** `POST /api/boundaries/upload` — identical pattern to
`POST /api/village-data/upload` (Super Admin only, audited as
`upload_village_boundaries`, multer disk-streamed, atomic rename, cache reset via
`boundaryLookup.resetCache()`), exposed on the Auto-Assign page via the same
`DataUploadCard` component the centroid upload now also uses (de-duplicated into one
reusable component). **Same post-deploy requirement as the centroid file**: this data
isn't in git, so it must be uploaded to each fresh Render instance/disk after deploy —
documented once, applies to both files.

**Map changes:** `autoAssign.js`'s preview/commit responses now also return
`villagePolygons` (same village set as the existing `villageMarkers`, but with
simplified polygon/multipolygon geometry instead of a single lat/lon) alongside the
existing points. The Auto-Assign page map has a toggle — "Village outlines" (default)
renders actual filled/outlined polygons via `react-leaflet`'s `Polygon`, "Points" keeps
the original circle-marker view — both colored per assigned surveyor from the same
palette. If no boundary file is loaded (or a specific village has no polygon match), the
page falls back to telling the admin to try the Points view rather than showing a blank
map.

**Known limitation carried over:** the same `district_id`-vs-district-NAME mismatch
noted for centroid markers applies here (`survey_cases.district_id` is a source-system
ID; this dataset's `district` field is a name) — `boundaryLookupService.getByVillageRefs`
tries a district-qualified lookup first, falls back to a village-name-only scan across
all districts when that misses. The name-only fallback is a linear scan over the whole
in-memory index, which is fine for the handful of villages in one auto-assign run but
would not be an appropriate way to serve a whole-district bulk request — that path
(`by-district`) looks up by name directly without the scan.
