# RISKS.md / LIMITATIONS.md (backend + admin web repo)

**Repo-split note:** this file predates the split of the original combined repo into
`backend-and-web/` (this repo) and `../android-kotlin/` (new native Kotlin mobile
client, replacing the React Native app described below). The backend/admin-web
sections below are still current. The "Mobile toolchain" and other React-Native-specific
sections describe the archived prototype at `../_deprecated_react-native-mobile/` and no
longer describe a maintained client — see `../android-kotlin/README.md` for the current
mobile client's own risks/limitations.

Plain statement of what is real, what is a platform limitation, and what is implemented
but unverified on a real device (none was available in this build environment).

## Call recording
**Not implemented as automatic cellular call recording.** Modern Android (10+)
restricts third-party apps from recording the in-call audio stream without special
OEM/manufacturer support that cannot be relied on generically. What IS implemented:
an explicitly-initiated "voice note" fallback (`POST /api/call-recordings`) — the
surveyor manually taps "Record voice note" after a call, with an on-screen consent
notice required before upload (`consentAcknowledged` is enforced server-side). This is
**implemented, pending device verification** (upload/encryption/playback-restriction
logic is unit/integration tested server-side; the actual on-device `expo-av` recording
flow has not been run on a real device).

## Missed-call voice message injection
**Not implemented.** Automated injection of a pre-recorded voice message into a *live*
cellular call is not possible through any public Android API without carrier/telephony
integration (see ROADMAP.md). What IS implemented: local playback preview of an
admin-managed template (logged as a `call_recordings` row with
`kind=voice_message_playback`, template id, and duration) — a callback-action aid for the
surveyor, not an automated in-call injection.

## SMS delivery confirmation
**Not implemented, and never will be via this flow.** `Linking.openURL('sms:...')` only
opens the phone's own SMS app with the text pre-filled — the backend has no way to know
if the surveyor actually pressed send, or if the carrier delivered it. `message_events`
status is only ever `drafted` or `opened_composer`, never `sent`/`delivered`. This is a
deliberate, permanent limitation of the "use the surveyor's own SIM/apps" approach (vs.
a compliant third-party SMS gateway — see ROADMAP.md).

## Emergency mode — locked-screen/background capture
**Not implemented, platform limitation.** Recording only happens while the Emergency
screen is open in the foreground, started by an explicit press-and-hold. Android (and
Expo's managed workflow in particular) does not support covert background/locked-screen
audio+video capture without a persistent foreground-service notification visible to the
user — which would also defeat the purpose of covert safety recording. The 120-second
hard cap, press-and-hold confirmation, cancel/stop controls, and the timer/controller
state machine are all implemented and unit tested
(`mobile/src/lib/emergencyTimer.test.js`, 9 tests) against a fake clock — this logic is
real and verified. The on-device camera/mic recording calls themselves
(`expo-camera`/`expo-av`) are wired in `EmergencyScreen.jsx` but are **implemented,
pending device verification**.

## Call outcome accuracy
`call_events.outcome_source` is hard-coded to `'user_entered'` everywhere in the backend
(see `backend/src/routes/callEvents.js`) and can never be set to anything implying
API/telephony verification. `Linking.openURL('tel:...')` on stock Android gives the app
no callback about call duration, whether it connected, or how it ended — all outcome data
is the surveyor's own self-report.

## Geotagging accuracy
GPS geotag capture (`geo_lat`/`geo_lon`/`geo_accuracy_m` on `call_events`) depends on the
device's location permission and GPS/network fix quality; `geo_accuracy_m` is stored
precisely so a manager can judge a low-accuracy fix, but no minimum-accuracy gate is
enforced in this pass. **Implemented, pending device verification.**

## Farmer identity dedupe
Dedup by `name + village + mobile` (`backend/src/services/farmerDedupe.js`) is a
heuristic, not a guarantee. Two different farmers with the same name in the same village
and no mobile on file will be merged. This is documented in code and flagged as a
ROADMAP item (fuzzy/phonetic matching) rather than silently assumed correct.

## Mobile toolchain in this sandbox
This build environment has no Android device or emulator. The pure business-logic
modules (`mobile/src/lib/*.js` — emergency timer, template renderer, HTTP helpers, RBAC
filter) have **zero React Native/Expo imports** specifically so they could be unit
tested with plain Jest in this environment (30/30 passing, real run, see root README for
the exact command). The screens/navigation (`mobile/src/screens/*`, `App.js`) are real
Expo RN source with `node_modules` installed, but have not been bundled/run on a device
or emulator — treat them as **implemented, pending device verification**, not as proven
working UI.

## Encryption key management
`EVIDENCE_ENCRYPTION_KEY` (AES-256-GCM key, base64, 32 bytes) is read from an environment
variable — a "secure key store abstraction" stand-in for this pass. A real deployment
needs a proper KMS/HSM-backed key and rotation story; any client-held secrets on mobile
should use `expo-secure-store` (listed as a dependency, used for the JWT/session, not yet
used for any client-side encryption key because none is needed in this pass's design —
encryption happens server-side on upload).

## Import column mapping
The fuzzy-matching column mapper (`backend/src/services/columnMapping.js`) uses
Levenshtein distance with a generous threshold against a fixed alias list. It is good
enough to catch common header renames (`village_name` → `Level7_Name`) but is not a
general NLP/ML classifier — an admin must always review and can override the proposed
mapping before committing (enforced by the two-step preview/commit API; nothing commits
without an explicit admin-confirmed mapping).
