# Native vehicle app bridge · local emulator contract

This extension joins the Android app to the **same persisted unified execution** used by the latest PleosFlows console. It is not a second disconnected vehicle mock. The server is a development prototype: its client/source labels are **not authentication, device attestation or OEM permission**. Use fictional data and loopback only. Native build/runtime evidence is reported separately by the Android build; passing these server tests does not establish APK or emulator success.

## Run

```sh
PLEOSFLOWS_NATIVE_EMULATOR=1 MOBFLOW_DATA_DIR=./data-native npm start
# With the intended Android emulator selected:
adb -s <emulator-serial> reverse tcp:3000 tcp:3000
```

The server defaults to `127.0.0.1:3000`. Native mode rejects a nonloopback startup `HOST`, and every native request checks both its socket peer and Host header. Endpoints are disabled unless explicitly enabled. These checks limit accidental exposure; they are not a production trust boundary against other local processes. There is no bearer secret or generated credential in this bridge. `pleosflows-android`, session UUIDs and idempotency IDs are correlation values only.

## Assignment and provenance

`GET /api/native/assignment?vehicleId=vehicle-101&runId=<exact-run>` returns only that vehicle/run context. `runId` may be omitted only when one unique active run exists. Multiple runs return `ASSIGNMENT_AMBIGUOUS` rather than silently selecting the newest. A stored exact run remains selected after completion, revocation or expiry; it is never replaced implicitly.

`POST /api/native/fixture` is an explicit **fictional emulator demo creation**, not dispatch from a real company:

```json
{"vehicleId":"vehicle-101","source":"aaos","idempotencyKey":"unique-demo-request-id"}
```

It uses existing bounded school/delivery templates, canonical immutable workflow snapshots, the same run store and notification policy. Repeating the exact key yields the same workflow and run. It binds the fixed non-authenticating client label `pleosflows-android`. Sources are `aaos` (the app's platform observation path) or `debug-fixture` (explicitly simulated app input); they cannot be switched on the run. An existing console run is bound on its first valid native observation. Binding clears any prior web-simulated location/ETA and blocks legacy simulated mutation paths. The operator may still revoke the run.

Vehicle 101 uses fictional school context and vehicle 102 fictional delivery context. `destinationIsFixture: true` and `customerLabel` must remain visible as demonstration context; no destination coordinates or real-person information are inferred. Existing runs retain the unified 15-minute expiry. Create a new demo explicitly after terminal/expired work.

## Observation

`POST /api/native/state`:

```json
{
  "runId":"<exact-run>", "clientId":"pleosflows-android",
  "sessionId":"foreground-session-uuid", "sequence":1,
  "source":"aaos", "connected":true, "speedMps":0,
  "gear":"P", "uxRestricted":false, "observedAt":1793200000000
}
```

- All fields are required. `speedMps` and `uxRestricted` may be JSON null; gear may be `unknown`. Unknown means locked, never an implicit parked default.
- `observedAt` is the actual observation epoch in milliseconds, not the time an old queued upload is retried. Reject observations older than 10 seconds or more than 2 seconds in the future.
- Sequence increases within a foreground session. First sequence after a new session or server restart is 1. A duplicate identical observation replays without refreshing freshness. Changed duplicates and out-of-order sequence/timestamps fail.
- A new session retires the old one and may not carry an older observation. Retired-session uploads cannot overwrite the current state. Following `SESSION_START_REQUIRED`, establish a new session with sequence 1; do not repeatedly upload an old high sequence.
- Observation memory is intentionally not restored after a server restart. Safe state must be re-established by a fresh observation.
- The app must stop SDK subscriptions on lifecycle stop and report disconnection where possible. A missing heartbeat expires after at most 10 seconds. The server cannot itself prove a callback was genuine; source is explicitly a client assertion.

**Observation never advances a workflow state, sets an arrival, completes a service, emits a departure notification, or invents ETA/position.** It is only a precondition for a separate operator command. A parked signal alone is not workflow completion.

## Explicit commands

`POST /api/native/runs/<exact-run>/commands`:

```json
{
  "clientId":"pleosflows-android", "sessionId":"foreground-session-uuid",
  "expectedVersion":2, "idempotencyKey":"unique-command-request-id",
  "action":"accept"
}
```

Commands are `accept` (assigned → ready), `depart` (ready → departed), `arrive` (departed/approaching → arrived), and `complete` (arrived → completed). Completion additionally requires `"completionConfirmed": true`. Departure is an explicitly confirmed workflow transition while still safely parked; it does not assert physical motion. Arrival is an operator assertion, not a GPS/geofence result. Completion remains an operator assertion and is **not verified boarding, delivery or handover evidence**.

Every new command requires:

1. Active, nonrevoked, nonexpired exact run and matching client binding.
2. Current run `expectedVersion`.
3. Current observation session matching the command session.
4. Connected observation fresh by both received and observed time (≤10 seconds).
5. Absolute speed ≤0.1 m/s, gear P, and `uxRestricted: false`, independently.

The UI must also lock itself immediately; server enforcement is not a substitute for Android driving restrictions. Permissions, vehicle category policy, OS display blocking, physical vehicle validation and distraction testing are separate.

## Retry and persistence

Commands compare a canonical request fingerprint and persist the command key in the same atomic unified-store transaction as its state transition, notification record and audit entry. The same request can be retried after an uncertain HTTP result without repeating work. A committed request replays even after telemetry becomes stale or the run completes. A reused key with changed payload returns `IDEMPOTENCY_CONFLICT`.

Failed preconditions do not consume the key. A version/session/precondition rejection is a definite rejection, not evidence the command executed. After such a rejection, refresh state and require the user to review any new command; do not silently change/reissue the old request with a new key. Persist one pending command in the app, not an unconstrained offline queue of driving actions.

Atomic rename is a single-process prototype mechanism, not a distributed transaction system. Run one process per data directory. No Android observation freshness is inferred from a persisted prior run's `motion`/`ux` display fields.

## Response contract

All successful native endpoints return:

- `mode: local-emulator-not-authentication`, `replayed`, `serverTime`.
- `assignment`: run/job/vehicle/trip IDs, immutable workflow version, title/template, state, current command version, expiry, source, fictional customer/destination labels, next action, audit timeline and local notice summary; null when no assignment.
- `vehicleState`: `safe`, reason, source and current observation fields when available.
- `allowedActions`: current state's next action only when safe and active; otherwise empty.
- `limitations`: authentication/externalMessages/realVehicleVerified/locationOrEtaFromSdk false; sourceIsClientAssertion/foregroundOnly true.

No customer bearer URL/token is returned to the Android bridge. Native location/ETA is not implemented; customer live fields remain hidden. Existing policy-gated notification stages create local records only with `networkSent: false`; no KakaoTalk, Slack, SMS or other external transport is called.

## Server verification

`npm test` passed **322 tests** on this extension (286 existing + 28 native backend + 8 native-bound web UI). `tests/native-vehicle.test.mjs` covers exact-run context, ambiguity, fixture replay, source binding, all independent unsafe locks, observation age/future time, dedupe/collision/order/session retirement, restart fail-closed behavior, explicit completion, version conflicts, uncertain command replay, legacy bypass prevention, live policy denial, malformed inputs, debug provenance, and HTTP opt-in/Host/origin boundaries. This is backend evidence, not Android or real-car certification.

## Native-bound browser views

Operator and driver views label the persisted AAOS-emulator or debug-fixture source without treating it as device attestation or current connectivity. Driver accept/complete and observer simulation controls are absent for bound runs, and delegated stale-button events are rejected client-side in addition to authoritative server guards. Operator revoke and exact-run read-only audit remain. Failed native notice records do not expose the legacy retry path. The customer endpoint is still scoped and does not expose native binding metadata; its view states the native ETA/location limitation without fetching operator data or inventing source provenance.

Eight additional VM/actual-backend-fixture UI regressions pass. These are not pixel tests or native runtime evidence. Live browser visual QA of this change was blocked by the execution sandbox: the isolated test server was unreachable from the separate browser; a same-call headless attempt then failed before page open because Chromium could not create its process-singleton socket (Operation not permitted). The test server was stopped. No screenshot or pixel validation is claimed.
