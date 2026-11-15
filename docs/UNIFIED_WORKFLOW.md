# PleosFlows · v0.8 unified execution contract

This is a local-only bounded workflow, not production authentication, a native SDK build, a connector deployment or a freeform graph engine.

## Canonical record

The console, driver and customer pages all use one persisted execution in `unified.json`. Its context is immutable after dispatch:

- tenantId = org-a
- jobId and runId (unique per dispatch)
- vehicleId, tripId and customerId (one of two fictional assignments)
- workflowId + workflowVersion + workflowSnapshot
- dispatch-time role policy snapshot

Customer URLs bind a random demo token to exactly this run and its customer; driver URLs include exactly this run ID. No view selects the latest run as a substitute. A wrong customer ID returns a generic 404.

## Lifecycle

Operator: template/configure → save and activate immutable version → dispatch.
Driver: accept assigned work in fresh parked simulation state.
Observer only: inject departed / telemetry / arrived / stale vehicle events.
Engine: evaluate threshold and shared disclosure policy → local notice action → audit.
Driver: explicitly confirm completion after fresh parked arrival.
Customer: completion, expiry, stale data and revocation all hide live fields.

Events are simulated but processed through the authoritative server path. The standalone browser event endpoint remains simulated. The opt-in [native emulator bridge](NATIVE_VEHICLE_BRIDGE.md) binds the same run to a separately labelled AAOS/debug source, stores no GPS/ETA, and uses observation only as a precondition for explicit parked commands. Native-bound runs reject these browser simulation mutations. This local bridge is not authenticated device telemetry or real-vehicle validation.

## Policy source

`fleet.disclosurePolicy()` is used for customer reads and notification actions. It combines organization/vehicle/trip scope and the current fleet role policy with the dispatch-time policy. Workflow-selected fields further restrict the output. Position permission also gates distance. A policy update cannot silently expand an existing run beyond its original snapshot, but can remove its access immediately.

The legacy fleet simulator's own fixture freshness does not govern unified telemetry; unified runs enforce their authoritative 120-second freshness. SDK capability/permission remains unverified and is never granted by application policy.

## Idempotency and failure

- Mutations require idempotencyKey and compare a canonical payload fingerprint.
- Vehicle events require eventId; duplicate identical events replay without new effects, changed duplicates conflict.
- Each notification stage is recorded at most once per run, including subsequent telemetry.
- Failed-only retry rechecks current policy, run activity and freshness. Successful actions are not replayed.
- HTTP uncertainty keeps the pending key/event ID in the client session until a definite response. Client fetch timeout bounds hanging requests.
- Data is written by atomic rename. Restart reconstructs the same run and token. This prototype is single-process, not a multi-node distributed transaction engine.

## What is intentionally not integrated

The old freeform-looking bounded studio, pickup workflow, communication demo and fleet command batches remain reference labs. Existing laboratory runs are not imported or silently presented as unified runs. Advanced door-lock and destination-approval demos have no physical command path. These limits are visible in the UI and README. The default console and all newly generated driver/customer links use the unified path.

## Verification

`npm test` includes the prior regression suites and `tests/unified.test.mjs`. The latter covers same-run causality, policy/field restriction, snapshot immutability, two-vehicle isolation, threshold-dependent action selection, explicit completion, expiry/stale/revoke masking, restart, duplicate event/dispatch, action-specific retry, policy denial and input validation. `tests/unified-ui.test.mjs`, when present, covers client contracts and failure handling; it is not native rendering certification. Browser checks and video are separate artifacts.

## Native working extension verification

The working extension adds 28 backend tests and 8 native-bound web UI tests (322 total) and additive command `version` fields. Build, installation, actual AAOS callbacks and emulator rendering require their own evidence; backend test success does not establish them. See `NATIVE_VEHICLE_BRIDGE.md`.
