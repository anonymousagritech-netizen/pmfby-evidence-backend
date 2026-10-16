# PMFBY Evidence — backend + admin web

Farmer-communication / call-evidence / emergency-safety app for PMFBY crop-survey field
operations (CLAP Survey agency, Haryana). See `IMPLEMENTATION_PLAN.md` for architecture
rationale, `RISKS.md`/`LIMITATIONS.md` for what's real vs. platform-limited vs.
device-unverified, and `ROADMAP.md` for deferred work.

## This repo is backend + admin web only

This repository was split out of the original combined `pmfby-evidence` repo so the
backend/admin-web stack and the field-surveyor mobile client can be published and
versioned independently. The mobile client is no longer React Native/Expo — the
field-surveyor app is now a **separate sibling repo**, `android-kotlin/` (native
Kotlin/Jetpack Compose, its own git history), at
`C:\Users\akshay\Projects\pmfby-evidence\android-kotlin\`. It consumes this backend's
REST API exactly as described below (JWT auth header, same route contracts).

The original React Native/Expo mobile prototype referenced throughout this repo's docs
(IMPLEMENTATION_PLAN.md, RISKS.md, ROADMAP.md below) is preserved for reference only,
**not deleted, not part of any published repo**, at
`C:\Users\akshay\Projects\pmfby-evidence\_deprecated_react-native-mobile\` (a sibling
folder, not git-tracked). Historical sections below that describe the React Native
mobile app are left intact as a record of that design; they no longer describe this
repo's contents.

## Repo layout (this repo)

```
backend/      Express + PostgreSQL API (JWT auth, RBAC, ZIP generation, encryption)
admin-web/    React + Vite admin console
```

Sibling repos/folders (outside this repo, see above):
```
../android-kotlin/                         Native Kotlin/Compose field-surveyor app (own git repo)
../_deprecated_react-native-mobile/        Archived React Native prototype (reference only, not git-tracked)
```

## Backend setup

Requires PostgreSQL reachable from this machine. **This was built and tested against a
real, locally-installed PostgreSQL 17** (`C:\Program Files\PostgreSQL\17\bin`), listening
on `localhost:5432` — no Docker was available in the build sandbox.

```bash
cd backend
npm install
cp .env.example .env     # fill in DATABASE_URL / TEST_DATABASE_URL / JWT_SECRET /
                          # EVIDENCE_ENCRYPTION_KEY (see comments in .env.example for how
                          # to generate the encryption key)

# Create the databases (adjust user/password to your Postgres install):
psql -U postgres -c "CREATE DATABASE pmfby_evidence;"
psql -U postgres -c "CREATE DATABASE pmfby_evidence_test;"

npm run migrate          # applies all migrations to DATABASE_URL
npm run seed              # seeds 3 roles, 4 Hindi templates, 4 demo users
npm start                 # listens on PORT (default 4000)
```

Default seeded login (**change in any non-throwaway environment**):
`admin@pmfby-evidence.local` / `ChangeMe123!` (also `manager@...` and
`surveyor1@.../surveyor2@...`, same password).

### Tests

```bash
cd backend
# apply migrations to the TEST database first:
DATABASE_URL=$TEST_DATABASE_URL npx node-pg-migrate -j js -m src/db/migrations up
npm test                  # unit + integration, real Postgres, forceExit
```

**Actual result when run in this build:** `11 suites, 63 tests, 63 passed, 0 failed`
(33 unit + 30 integration, including the required cross-tenant-isolation test and the
manager-can-download-any-ZIP-in-scope test).

If Postgres truly cannot be reached in some other environment: this codebase has no
pg-mem/sqlite fallback wired in (real Postgres was reachable here, so none was needed).
To add one, swap `backend/src/db/pool.js`'s `pg.Pool` for a `pg-mem` adapter behind the
same `{ query, connect }` surface — the rest of the code only ever calls `pool.query`
and `withTransaction`.

## Admin-web setup

```bash
cd admin-web
npm install
cp .env.example .env       # VITE_API_BASE_URL, default http://localhost:4000/api
npm run dev                 # http://localhost:5173
npm run build                # verified: builds cleanly (238KB JS, gzip 78KB)
```

## Mobile client (superseded — now a separate repo)

The field-surveyor mobile client is **no longer part of this repo**. It is now a native
Kotlin/Jetpack Compose Android app in the sibling repo `../android-kotlin/` (its own git
history, its own README with setup/build/test instructions). Point its Retrofit base URL
at this backend's `http://<host>:4000/api` (see `../android-kotlin/README.md`).

The section below is kept **for historical reference only** — it describes the original
React Native/Expo prototype, which has been moved (not deleted) to
`../_deprecated_react-native-mobile/` and is not part of any published repo:

```bash
cd ../_deprecated_react-native-mobile
npm install
npm test                    # pure-logic unit tests, no device needed — see below
npx expo start               # requires an Android emulator or Expo Go on a real device
```

**No Android device/emulator was available in this build environment.** Per the
then-current spec, the pure business logic (emergency recording timer/controller,
template rendering, API client helpers, RBAC-aware client-side filtering) was written
with **zero React Native/Expo imports** specifically so it is unit-testable without a
device, and WAS fully tested at the time:

**Result when last run (prior to the mobile rewrite):** `4 suites, 30 tests, 30 passed,
0 failed` (`src/lib/emergencyTimer.test.js`, `templateRenderer.test.js`,
`httpHelpers.test.js`, `rbacFilter.test.js`).

The screens/navigation (`src/screens/*`, `App.js`) are real Expo RN source with
`node_modules` fully installed (1247 packages), but were never bundled or run on a
device/emulator — see the archived RISKS.md section for exactly which pieces were
"implemented, pending device verification" vs. genuine platform limitations. This code
is retained purely as a reference for anyone comparing the old RN logic against the new
Kotlin implementation; it is not maintained going forward.

## Permission / platform-capability matrix

### Roles (enforced server-side on every route — see `backend/src/middleware/rbac.js`
and `backend/src/services/resourceScope.js`; never trusted from the frontend)

| Capability | Super Admin | State/District Manager | Surveyor |
|---|---|---|---|
| Import Excel (preview + commit) | Yes | No | No |
| Configure message templates | Yes | No | No |
| Create users / assign roles | Yes | No | No |
| Assign / reassign farmers | Yes | No | No |
| View org-wide farmers/cases/evidence | Yes | Within geographic scope only | Only own actively-assigned farmers |
| Call / SMS / evidence / emergency actions | N/A (not a field role) | N/A (view/monitor only) | Own assignments only |
| Download any ZIP | Yes | Within geographic scope only | Own farmers' ZIPs only |
| Resolve case outcome | Yes | Yes (in scope) | Yes (own assigned cases) |
| Review discrepancy flags / emergency incidents | Yes | Yes (in scope) | Can raise, cannot review own |
| View Integrity Concerns (bribe/corruption reports) | Yes (only role) | No | Can submit, cannot view list |
| View audit logs | Yes | Yes | No |

A manager with no `scope_state_id`/`scope_district_id` configured **fails closed** (sees
nothing) rather than defaulting to org-wide access — see `managerScopeFilter` in
`rbac.js` and the farmers-list route.

### Platform capabilities (historical — describes the former React Native client)

The table below documents the original React Native/Expo mobile client's capabilities
and is kept as a historical record (that client now lives, unmaintained, at
`../_deprecated_react-native-mobile/`). For the current native Kotlin/Android client's
permission list and platform-capability matrix, see `../android-kotlin/README.md`.

| Capability | Status | Why |
|---|---|---|
| SIM call via `Linking.openURL('tel:')` | Implemented | Uses the surveyor's own SIM/plan; no telephony integration needed |
| Verified call duration/connection state | **Cannot implement** | Stock Android gives `Linking` no call-state callback; outcome is always `user_entered` |
| SMS via `Linking.openURL('sms:...')` | Implemented | Opens the phone's own SMS app pre-filled |
| SMS delivery confirmation | **Cannot implement** | Composer-opened is not delivery confirmation; would need a licensed SMS gateway (see ROADMAP.md) |
| Automated call recording | **Not implemented, platform limitation** | Modern Android restricts third-party call recording without special OEM support |
| Explicit voice-note recording (post-call) | Implemented, pending device verification | Manual, consent-gated, uses `expo-av` |
| Automated voice-message injection into a live call | **Not implemented, platform limitation** | No public Android API for this without carrier integration |
| Emergency press-and-hold recording (foreground) | Implemented, pending device verification | 120s hard cap verified by unit tests against a fake clock; on-device camera/mic not verified |
| Locked-screen/background emergency capture | **Not implemented, platform limitation** | Requires a persistent foreground-service notification on Android; defeats covert-safety intent anyway |
| GPS geotag on visit/call | Implemented, pending device verification | Depends on device location permission + fix quality |
| Evidence encryption at rest | Implemented and tested | AES-256-GCM, server-side, key from env var (see RISKS.md for key-management caveat) |
| ZIP generation + integrity verification | Implemented and tested | `archiver`, async status tracking, re-read-and-rehash verification before marking ready |

## Attribution

This repository's original full build (backend, admin-web, the then-current React
Native mobile client, migrations, tests, docs) was produced in a single automated
session. See `IMPLEMENTATION_PLAN.md` for a note on a scope-change request received
mid-build via an unverifiable inter-agent message, which was declined at the time.

That same restructuring (dropping React Native for a native Kotlin/Android client, and
splitting the single repo into independent `backend-and-web/` and `android-kotlin/`
repos) was later requested directly and explicitly through the real task channel, and
this repo is the result of carrying it out: `backend/` and `admin-web/` moved here
unchanged (same tests, same source), the old React Native mobile app was archived (not
deleted) to `../_deprecated_react-native-mobile/`, and a new native Kotlin/Compose app
was built from scratch at `../android-kotlin/`.
