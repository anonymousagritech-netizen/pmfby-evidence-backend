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

## Real-data validation pass (Haryana PMFBY sample, `NEW DATA.xlsx`)

A real production sample (Sheet1, 3192 rows) was run through the actual import
pipeline end-to-end (not just synthetic test data) and found four real bugs, all now
fixed and covered by `tests/integration/realDataImport.test.js` (built from the same
real column shapes/values, not the original file itself — too large/environment-
specific to commit as a fixture):

1. **Wrong worksheet silently imported.** `parseWorkbookBuffer` used
   `workbook.worksheets[0]`, assuming the first array entry is the real data sheet.
   This real file has a near-empty "Sheet2" (216 rows) that ExcelJS orders BEFORE
   "Sheet1" (3193 rows, the real data) in `worksheets` — `worksheets[0]` followed tab
   display order, not sheet id or row count, so the wrong sheet was imported with zero
   errors raised (a silent data-loss bug, not a crash). Fixed in
   `importService.js`'s new `pickWorksheet()`: prefer a sheet literally named "Sheet1"
   (case-insensitive), else fall back to whichever sheet has the most rows.
2. **camelCase real headers vs. the spec's `Docket_ID2`-style names.** Mostly already
   handled by `columnMapping.js`'s normalize-then-compare logic (strips
   non-alphanumeric + lowercases, so `docketID` and `Docket_ID2` normalize to the same
   string) — but `insuranceCompanyName` and `applicationSourceOrigin` fell through to
   fuzzy-or-no-match because the existing aliases (`insurancecompany`,
   `applicationsource`) were missing the real header's extra word. Added explicit
   aliases for both; both are now `exact` matches.
3. **GUID IDs.** `stateID`/`districtID`/`level4ID`-`level7ID` are GUIDs
   (`5C77DA4F-...`), not small integers. Already correctly handled —
   `STRING_ID_FIELDS` in `importService.js` was already keyed by the same field names
   these columns map to, so they were never coerced through `Number()`. Verified (not
   assumed) with a real-GUID round-trip test.
4. **`intimationAssignDeadline`'s real value is a status STRING ("Active"), not a
   date**, despite the column name and the original spec's assumption. Previously this
   went straight into a `date`-typed Postgres column and threw, which the per-row
   try/catch caught — but that meant the WHOLE row (farmer name, docket id, every other
   field) got marked `errored` and silently dropped, for a problem in one unrelated
   column. Fixed: `toDbValue()` now takes the destination column name, and for the
   five actual date columns (`date_of_incidence`, `farmer_intimation_date`,
   `sowing_date`, `survey_assigned_on`, `intimation_assign_deadline`), a value that
   doesn't parse as a real date becomes `NULL` instead of reaching the query. The rest
   of the row still imports correctly.

**Critical algorithm fix — TAT basis.** The user confirmed directly: "TAT day is 10
days from ASSIGNMENT." `autoAssignService.computePriority` (and the priority/P1-P2-P3
split built on it) previously computed the deadline from `farmer_intimation_date`,
which is wrong. Fixed to use `survey_assigned_on` as the basis in every caller:
`routes/autoAssign.js`'s `loadCasesAndSurveyors` now selects `survey_assigned_on AS
assigned_on` (and no longer requires `farmer_intimation_date IS NOT NULL` for a case to
be eligible, since that field is no longer load-bearing for this calculation). For a
case that has never been assigned (`survey_assigned_on IS NULL` — true for every
case freshly imported, since the source Excel's own `ASSIGN` column, see below, is the
not-yet-automated manual step), `runAutoAssignPure` falls back to treating **this run's
`reportDate` as the assignment moment** — i.e. a never-assigned case starts counting
TAT from the moment the admin actually runs auto-assign, not from some earlier
undefined date. This was a judgment call the brief explicitly asked for: `survey_assigned_on`
is authoritative when present (an existing agency assignment carried over from import),
and "this run IS the assignment" when it's the case's first assignment. Covered by two
new dedicated unit tests proving priority tracks `assignedOn` and completely ignores
`intimationDate`, plus the integration test's cases, which deliberately set very
different (irrelevant) intimation dates on each case to prove the point.

**New fields captured, not previously in schema** (migration
`1700000010000_import_fidelity_fixes.js`, `survey_cases` table): `case_latitude`/
`case_longitude` (per-case GPS from the source system — e.g. farm/incident location;
kept explicitly distinct from `call_events.geo_lat/geo_lon`, which is the surveyor's
own live geotag captured at an actual contact attempt, never backfilled from import)
and `source_is_farmer_present`/`source_villager_relation`/`source_villager_name`/
`source_villager_mobile`.

**Decision: villager/is-farmer-present fields do NOT auto-populate `call_events`'
"Person Contacted" fields.** The brief asked to consider this. Chose not to, and stored
them as `source_*` reference columns on `survey_cases` instead, for two reasons: (a)
`call_events.person_contacted_*` is documented and built specifically to record what
actually happened at a real contact attempt made through this app — conflating it with
whatever the source system had on file at import time would make that field lie about
provenance (a manager reading "person contacted: Suresh (Neighbor)" on a call record
should be able to trust that's who the surveyor actually spoke to, not stale import
data); (b) the source data for this is unreliable in practice — in the sample, 3190 of
3192 rows have these fields entirely null, and `isFarmerPresent` is "No" even on rows
with no witness name recorded, suggesting it's inconsistently filled upstream. The
surveyor can still see the source values (surfaced as reference-only, not pre-filled
into any outcome field) if a case-detail view is extended to show them — not yet wired
into the mobile app UI, left as a follow-up.

**Not mapped/captured this pass** (real columns with no current app field, left
unmapped rather than guessed at): `level4Code`-`level7Code` (short numeric codes
alongside the GUID IDs — genuinely different from `level*ID`, not conflated, just not
stored anywhere yet since nothing currently reads them), and a large block of real
survey-outcome-detail columns (`affectedAreaPercentage`, `cropLossPercentage`,
`surveyCauseOfLoss`, `surveyCropCondition`, `harvestDate`, IC/Deputy-Director approval
fields, etc.) that describe survey outcomes richer than this app's current
`contact_status` state machine models. Capturing these properly is a real, separate
schema-design pass (not a quick column-add) and was out of scope for a correctness-bug
pass — flagged here rather than silently dropped.

**Sanity-checked, no issue found:** `surveyStatus`'s real value ("Survey Agency
Assigned") stores fine — `survey_status` is a free-text column with no enum constraint
anywhere in the backend, so this and any other real status string round-trip correctly.

**The `ASSIGN` column** is blank in the real source file — confirmed as the column the
agency fills in manually today; auto-assign is meant to replace it, so nothing in the
import path requires it to be populated. The Excel export of an auto-assign run (see
below) produces its own `ASSIGN` column (holding the assigned surveyor's name) for
exactly this reason — familiar to anyone used to the manual spreadsheet workflow.

## Auto-Assign: Excel export + bulk cross-surveyor transfer

**Excel download** (`POST /api/auto-assign/export`, Super Admin only, audited as
`auto_assign_export`): takes the same params body as preview/commit (the algorithm is
deterministic, so re-running it with identical params reproduces identical
placements — this endpoint never writes anything) and streams back a generated
`.xlsx` via `autoAssignExportService.js` (ExcelJS — already a dependency for the import
side, no new package needed): an "Assigned Cases" sheet (one row per case: docket id,
farmer name, district, village, priority, days remaining, TAT deadline, an `ASSIGN`
column holding the surveyor's name, and their mobile), a "Surveyor Summary" sheet
(name, mobile, district/village counts, total/P1/P2/P3, under-minimum flag), and an
"Unassigned" sheet only when there are unassigned cases. A "Download Excel" button on
the Auto-Assign admin-web page sits next to Preview/Commit.

**Bulk cross-surveyor transfer** (`POST /api/assignments/bulk-transfer`, Super Admin
only): moves a block of farmers' active assignment to one destination surveyor in a
single transaction and a single audit log row (not N individual entries). Built by
extracting the actual reassign step out of `assignFarmer` into `reassignFarmerTx(client,
...)` so both the single-case path and `bulkReassignFarmers` share the exact same
logic and the exact same emergency-incident safety gate — not a parallel
reimplementation of it. A farmer blocked by that gate is skipped and reported back in
`blocked` rather than aborting the whole batch (one stuck case shouldn't block
rebalancing the rest). On the Auto-Assign page, each per-surveyor row in the breakdown
table has a checkbox; selecting one or more and picking a destination surveyor from the
dropdown runs the transfer via `assignedFarmerIdsBySurveyor`, a new field on the
preview/commit response mapping each surveyor to the farmer IDs they were assigned in
that run.

## Bulk surveyor import (real data: `Surveyor_Details.xlsx`, 84,252 rows)

Replaces one-by-one manual surveyor account creation. `src/services/surveyorImportService.js`
+ `POST /api/users/bulk-import/preview` and `/commit` (Super Admin only), an admin-web
card on the Users page (preview → commit, same two-step pattern as the main Excel
Import page).

**Real-file result** (run against the actual source file, not a synthetic fixture):
84,252 data rows → **123 unique surveyors** (by mobile) → **121 created**, 2 skipped
(no usable status anywhere for that mobile), **4 status conflicts** flagged as
data-quality warnings (all resolved to the last status value seen in file order, all
happened to resolve to "Active"). Every created account got a synthetic login email
(`{mobile}@pmfby-evidence.local`), a real per-account generated password (never the
shared seed password), and `force_password_change = true`.

**Dedupe key: mobile, not name.** The real file repeats the same surveyor once per
district/village they cover (one surveyor had ~760 rows). Grouped by
`surveyorMobile` (normalized from Excel's numeric cell type without introducing
scientific notation or losing precision), with every `districtName` seen for that
mobile aggregated into `home_district_ids` — richer than the single-surveyor
chip-editor UI built in an earlier pass, which still works for manual touch-ups
afterward.

**Status-driven lifecycle, explicit-only.** `Active` creates (if new) or
reactivates/updates district list (if existing); `Inactive` deactivates
(`is_active = false`, reusing the exact same column/semantics as the existing manual
deactivate flow — reversible, history preserved); `Delete` soft-deletes (reusing the
existing `deleted_at` soft-delete). **Judgment call, as asked**: a mobile number that
simply disappears from a later upload (not mentioned at all) is left completely
untouched — no deactivation, no deletion. Only an explicit status value in the file
drives a lifecycle change. Chosen over "absence means remove" because a partial or
accidentally-truncated re-upload (a real risk with an 80k+ row file re-exported daily)
would otherwise silently lock out every surveyor missing from that one bad file — far
more dangerous than occasionally leaving a genuinely-departed surveyor's account active
a little longer than ideal (and the Inactive/Delete path is right there for whoever
actually removes them from the roster). A row with no usable status value at all
(blank, or unrecognized text) is also never defaulted to Active or Inactive — it's
skipped and counted separately (`skippedNoStatus`) rather than guessed at.

**Conflicting status values across a mobile's duplicate rows** (4 of the 123 real
surveyors had both "Active" and "Inactive" rows — likely different district rows
captured at different times within the same export) are resolved to the LAST value
encountered in file row order (treated as the most recent/authoritative) and always
surfaced as a named warning in the import summary (mobile, name, every distinct status
value seen, what it resolved to) — never silently picked.

**Login credential gap.** This app's login has always required an email; this real
data has only a mobile number. Rather than block the whole feature on redesigning
login, bulk-created accounts get a synthetic email (`{mobile}@pmfby-evidence.local`,
matching the existing seed-data domain convention) and a real per-account random
password (`crypto.randomBytes`, never the shared `TestPass123!`-style seed password —
that would be a genuine security problem at 80k-surveyor scale). Added a minimal
force-password-change mechanism to make the credential gap actually usable rather than
a dead end: `users.force_password_change` (migration `1700000011000`), surfaced on
login/`/me` responses, plus a new minimal `POST /api/auth/change-password` endpoint
that clears the flag. **Not yet wired into admin-web's own login screen** — the flag
is returned by the API, but there's no forced-reset screen in the React app yet that
reads it and redirects; that's the next step before this is usable by an actual
bulk-imported surveyor logging in for the first time, flagged here rather than silently
left half-done.

**Auditing**: one batch-summary `audit_logs` row per import run (action
`bulk_import_surveyors`), not one row per surveyor — 123 individual audit rows per
daily re-upload would swamp the audit log for every other feature in the app. The full
per-mobile change list (every create/reactivate/deactivate/delete decision, keyed by
mobile) is preserved in that one row's `metadata.changeLog`, so nothing is actually
lost — it's just not its own top-level row.

Tests: 7 unit (dedupe/district-aggregation/status-conflict-resolution/mobile
normalization) + 10 integration (RBAC, create-on-Active, Active→Inactive and
Inactive→Delete re-upload transitions, a deactivated bulk-imported surveyor provably
cannot log in AND cannot pass the `authenticate` middleware's fresh is_active check
even with a pre-existing token, the disappearing-mobile-is-untouched rule, unknown-
mobile Delete as a safe no-op, no-status rows skipped, conflict-warning content, and
the single-batch-audit-row guarantee).
