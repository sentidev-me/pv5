# v0.7 company fleet and policy verification · 24 October 2026

## Automated verification

**247 / 247 tests pass: all 184 earlier tests, 51 new fleet/backend/HTTP tests, and 12 new actual-script/frontend render regressions. Zero failed, skipped or cancelled tests.** No dependencies, SDK, external account, LLM or vehicle hardware is involved.

New checks cover:
- One-company registry, organization / assigned-vehicle / own-trip isolation and disallowed cross-vehicle or historical-trip disclosure.
- Role-specific field ceilings, narrowed disclosure, denied control fields, cloned response objects and strict unknown-field/schema rejection.
- Independent read, destination request/operator approval and control simulation permissions; unknown capability, stale/future timestamp, unknown motion/UX, moving and restricted UX refusal.
- Immutable binding/policy/state snapshots and current restrictive policy rechecks before execution; approval revocation, policy-version and vehicle-version invalidation.
- Changed-policy/current-state masking of historical output; historical trip identity checked before returning cached results.
- Two-vehicle mixed outcomes, partial first-attempt adapter failure, selective failed-only retry and no repeated successful effects.
- Durable actor-scoped request keys, conflict detection, response-loss/restart replay, copied state, HTTP origin/body guards and concurrent transitions.
- Empty or malformed transition selectors cannot silently broaden a selective request into a batch.
- Actual frontend script tests (mock DOM/network, not a browser): scoped card rendering, explicit destination request/approval matrix, workflow-selection persistence, field editing, uncertain-response key retention, mixed statuses, and HTML escaping.

Shared-response isolation and historical-trip masking gaps discovered during this pass were fixed and have regression tests. JavaScript syntax checks pass. The final source ZIP is extracted into a clean directory and runs the same247-test suite, with no runtime stores, credentials or screenshots bundled.

## Actual browser verification

Verified in actual cloud Chromium against a restarted native-terminal Node server and isolated fictional storage:
- One customer-company console shows two vehicles with separate assigned fictional pupils and pickup/dropoff schedules.
- One shared read + simulated-lock binding produces independent results: vehicle101 read success / lock approval wait; vehicle102 first read failure / unknown-lock denial.
- Failed-only retry makes vehicle102 read attempt2 while vehicle101 stays attempt1. Denied lock never executes.
- Approval then revocation leaves zero lock attempts and no result; refresh preserves state.
- Parent view contains only vehicle101 and permitted fields. Removing ETA masks it in the vehicle and historical run views. Explicitly configuring ETA-only yields only the 3-minute field, not pupil/location/other fields.
- Inspecting vehicle102 as the parent returns a generic SCOPE_DENIED with no data.
- After the final source restart, approval at policy v3 followed by policy v4 before execution is denied with zero attempts and no result, while fresh state is only30seconds old.
- A new v4 request, separate approval and separate execution creates exactly one local lock-simulation record, explicitly marked network commands0 / no real vehicle or navigation confirmation.
- A parent can submit the own-trip destination request but sees no approval button; switching to the operator exposes approval. Approval and subsequent execution create only a local destination-request record, with navigation unchanged, and persist after reload.
- The parent’s historical mixed batch summary reflects only its visible read step, not a hidden control denial.
- The original visit studio still passes create → save v1 → activate → ETA3≤5 → approval → customer and Slack local records, each attempt1.
- Pretendard is loaded. At browser viewport1180px, document width1165px has no horizontal page overflow. The comparison matrix has its own bounded overflow container.

The final expiry/failed-refresh/old-role-clearing changes are covered by script regressions; their fresh source was reloaded for the final browser pass. No physical vehicle, OEM/SDK, emulator, mobile-device viewport or production login validation is claimed. Native captures are screenshots of the web prototype, not generated UI or an emulator.

## Boundaries

These backend tests exercise the demo's role/scope projection and policy transitions. They are not proof of production authentication: actor selection is deliberately a local demo selector. No real company, pupil, vehicle, OEM/SDK capability, door command, navigation operation, external notification or service completion is tested or asserted. The same bounded contract is evaluated separately per vehicle; no transfer/reassignment/optimization is implemented. See [fleet boundaries](FLEET_POLICY.md).

---

# v0.6 platform verification · 24 October 2026

## Automated checks

**184 / 184 tests pass: 129 existing tests unchanged, plus 55 new bounded-platform and frontend regressions. Zero failures, skips or cancellations.** Run `npm test` with Node.js 22 or newer. No package installation is needed.

New coverage includes:
- Both typed contracts and six-stage graph construction; registry's unavailable partnership/payment candidates.
- Rejection of unknown templates, triggers, events, fields/code, arbitrary graphs, mappings, freshness ranges, metrics/operators, fractional thresholds, invalid AI settings, invalid approval roles, duplicate/empty/unsupported actions and vehicle-control actions.
- Three-source normalized event aggregation; tenant/job/mapping/freshness/unknown-state fail-closed checks.
- ETA, delay and simulated battery conditions changing execution; customerId and jobId mapping.
- Mock-AI on/off and tone changes; typed draft proposals do not save or activate.
- Always-review vs internal-only policy; inability to bypass customer-action review; wrong reviewer blocked; explicit rejection creates no outputs.
- Edited approval text feeding actual output records; Sheets action updates only a local review row, not actual delivery or route state.
- Selective failure/retry preserves successful outputs; a failed Sheets action leaves its row unchanged until retry.
- Freshness rechecked before approval and retry; an expired run can still be rejected.
- Durable replay/idempotency conflicts, immutable activation snapshots, optimistic version conflicts, storage restart, corruption fail-closed and copy isolation.
- HTTP round trip, validation status, origin guard, strict proposal schema, UI source boundaries and retained scenario paths.
- Actual frontend binding/session logic tests for immediate number/title commits, review-text/role preservation and persisted retry keys across reload (mock DOM, not pixel tests).

JavaScript syntax checks pass for server, engine and new frontend. Automated UI-source assertions do not replace browser checks. The existing legacy engine, communication, font/design and vehicle regression files are unchanged.

## Actual browser checks

Verified in actual dot cloud Chromium against the local native-terminal Node server, using fictional data only:

- Workflow library and builder load; save and activate are separate operations.
- Visit: Calendar/Sheets/vehicle-context fixture, ETA 3 <= 5, approval wait, edited message, then selected customer + Slack local records with zero external sends.
- Delivery: Discord/Sheets/vehicle-context fixture, delay 18 >= 10, operator approval, then the local Sheets row becomes `reviewed` and Discord records the result; actual route/delivery state remains unchanged.
- Injected first-attempt Sheets failure produces partial failure. Retry updates only Sheets (attempt 2); the successful Discord output remains attempt 1.
- Delivery delay 5 >= 10 is filtered before assistance/actions. A mapping-mismatch fixture is blocked before assistance/actions.
- Malformed JSON and an unsupported `customCode` field are rejected without replacing the prior valid configuration.
- Browser reload and native server restart preserve stored runs/results.
- Actual Pretendard loads. At innerWidth 1180, document scrollWidth is 1165, with no desktop horizontal overflow. Native screenshots are actual web-prototype views, not generated mockups or emulator screenshots.

A numeric-input direct-save bug found during this pass was corrected with immediate input-state commits and is covered by new frontend regression tests. A sticky side-panel overlap was removed. Final browser recheck passed: direct-save threshold 5→2 and title changes saved on the first click; browser reload confirmed the title, threshold 2 and freshness 300. Activating the revised version made the same ETA 3 fixture filter on 3≤2, while the prior v1 successful run remained unchanged. Scrolling to the bottom confirmed that the summary and event cards no longer overlap.

No mobile-device viewport, live API, actual LLM, vehicle or emulator validation is claimed. Source, browser and pure-engine checks are distinct kinds of evidence.

## Not implemented or tested

Actual LLM inference, natural-language agent planning, unrestricted DAGs, external connector sends, OAuth, webhook subscriptions, live GPS/traffic/ETA, Pleos SDK or emulator execution, vehicle control/navigation, payments, live customer data, production tenancy/authentication and distributed transaction durability. Platform admin contract changes are source-defined, not a writable admin UI.

---

# Verification record

## v0.5.0 vehicle workflow simulation · 24 October 2026

**129/129 automated tests pass** on Node 24.22.1: all 76 prior tests, 31 vehicle backend/HTTP tests, 14 vehicle pure-renderer/UI asset tests, and eight actual-script regressions using a mocked DOM/network and the real communication store. No dependencies, SDK installation or external services are involved. The renderer/source and mocked-script checks are not a real-browser automation claim. The script regressions reproduce superseded poll success/failure, interrupted preparation and lost create responses, restriction-driven confirmation cancellation, error recovery without stale confirmation revival, duplicate completion suppression, and cancel/reopen.

New guards cover independent parked/moving and simulated UX allowed/blocked/unknown conditions, explicit arrival versus completion, separate confirmation and non-real-world completion evidence, customer-sharing termination, no notification duplication, idempotent replay/restart, body/version/origin validation, expiry, HTTP concurrency, and locked legacy arrival/completion paths. Motion/UX fixtures do not refresh location or complete a job. UI regressions cover lack of moving controls, blocked/unknown UX, stale confirmation rendering, escaped labels, completion without location metrics, sharing-off/stale/expired wording, conceptual change boundaries, and local Pretendard/responsive/reduced-motion assets.

The actual web UI was inspected in cloud Chromium using an isolated local demo store at a managed 1180 × 757 viewport. Pretendard font status was loaded and the font check true; document scrollWidth equaled 1180, with no horizontal overflow. Three real browser captures show moving lock, parked arrival confirmation, and completed sharing with conceptual request boundaries. These are screenshots of the web prototype, not real-vehicle, Android, or emulator screens.

Actual-browser interaction checks passed for preparation → departure/moving lock → approaching → parked arrival → separate completion confirmation. Cancel/reopen works. Blocking simulated UX while parked hides arrival/completion controls and cancels a pending confirmation. In two tabs, changing the same run to moving removed the other tab's completion prompt after its ten-second read-only polling interval. Completion survived fresh reload; the same scoped customer link displayed sharing ended with no map/distance/ETA. Fresh scripts loaded successfully, with no application-origin errors observed; unrelated browser-extension metadata messages are excluded. Later frontend failure/retry changes are covered by script regressions, not claimed as real network fault injection in the browser.

The screenshots visibly separate the outside-screen simulation/observer controls from the vehicle concept. No map/navigation replacement, guaranteed split screen, overlay, or actual navigation focus transition is shown. The conceptual moving lock does not establish that MOBFLOW can run in the background or while driving. Real CarUxRestrictionsManager integration, category eligibility, OS/app lifecycle, safety, compatibility, mobile/device layout, and actual vehicle behavior remain untested.


## v0.4.1 visual redesign · 24 October 2026

**76/76 automated tests pass.** All 70 prior tests remain; six additional checks cover local font assets/license, all entry-point stylesheets, retained control semantics, simulated-map/closure behavior, responsive and keyboard CSS hooks, and correct HTTP font MIME. These are static/HTTP and logic checks, not a substitute for real-browser layout testing.

The white/blue communication screen was inspected in actual cloud Chromium at an approximately 1180-pixel viewport. The computed family is Pretendard, `document.fonts.status` is loaded, and `document.fonts.check('16px Pretendard')` is true. The bundled font is a genuine 2,057,688-byte WOFF2 from official Pretendard v1.3.9, not a local fallback declaration. The source bundle also includes the original license.

The final Node server was restarted with the current source before actual-browser checks. All four views (communication, standalone customer, pickup, administrator studio) reported Pretendard as the computed family, font status loaded, and the 16px font check true. At browser innerWidth 1180, document scrollWidth was 1165 for communication/customer and 1180 for pickup/studio: no desktop horizontal overflow. The administrator logo and pickup map were rechecked in blue, with no old green/dark surfaces visible.

The current real UI was re-exercised through configuration → departure → approaching (450 m / 2 minutes) → arrival → completion. The same scoped customer link lost its map, distance and ETA after completion. The pickup request → manager approval → explicit vehicle acknowledgment → parent result sequence also passed. The administrator editor was visually checked; its immutable snapshot and editing behavior remain covered by the automated regressions. No app-script errors were observed in these checks; unrelated browser-extension metadata errors are not counted as application errors.

Six final real-browser screenshots are delivered separately from the source ZIP. Their narrow customer crops are not mobile viewport evidence. A real 390px viewport check could not be completed: the managed browser showed an organization-policy block when opening DevTools, and native maximize left its viewport at 1180px. The policy block was dismissed, not bypassed. Responsive CSS and its asset checks pass, but no mobile browser/device layout certification is claimed. No real integrations or additional workflow capabilities were introduced by the visual redesign.

## v0.4 verification · 24 October 2026

**70/70 automated tests pass: 34 existing pickup regressions, 29 communication backend checks, and 7 frontend logic regressions. Zero failed, skipped or cancelled tests.** Node 24.22.1; no package installation is required. The existing 34 pickup regressions remain unchanged, with additional communication backend and frontend logic tests.

New backend checks cover all three fictional business presets, sharing on/off, departure/approaching start rules, all eight position/distance/ETA field combinations, notification on/off and selected stages, wrong-customer and wrong-token links, completion/stop/expiry, stale data masking, duplicate/exactly-once notices, stale versions, immutable settings, persistence/restart, origin validation, and expiry on read-only HTTP GET without a mutation.

Frontend regression tests execute the actual communication script and customer renderer with a mocked DOM, fetch and timers. They cover activation/retry keys, repeated disconnect recovery, safety updates while controls have focus, disabled settings during an in-flight activation, ignoring older delayed responses, and a five-second deadline that masks data when a read hangs. They are not browser layout/accessibility tests.

### Actual dot cloud Chromium checks

Against the actual local Node server on 24 October 2026:

- Default school configuration activates; departure produces one simulated notice and shows 2.4 km / 8 minutes. Approaching changes this to 450 m / 2 minutes.
- Delivery preset with approaching-only sharing hides location at departure, then reveals it at approaching.
- Instructor preset with sharing and KakaoTalk off returns no customer location and creates zero simulated notifications.
- Position and distance off with ETA on shows only ETA and no map.
- Explicit stale-update test removes the map and metrics; the next simulated movement refreshes them.
- Arrival shows 0 m / 0 minutes; completion ends sharing and removes all movement information from the same link.
- Completed state and selected run survive browser reload.
- Standalone customer link shows completed/hidden state. Changing its customer scope to an incorrect fictional ID shows a generic error with no customer details.
- Stop ends sharing; direct reactivation of unchanged settings creates a fresh ready run with a different link and zero notices.
- Original pickup setup open/dismiss/reopen, activation, request, approval/dispatch, explicit acknowledgment and refresh pass.
- Original ambiguous request disables approval and can be rejected without vehicle dispatch. Explicit failed execution retains the previous confirmed stop.
- Main desktop layout was visually inspected at a 1180 CSS-pixel viewport. document scrollWidth was 1165, with no horizontal overflow. Real browser screenshots were captured for internal QA, not generated mockups.

### Not run / not claimed

- Live GPS, geographic routing, traffic estimation, real KakaoTalk delivery, LLM, Pleos SDK/emulator/hardware, real customer identity, production authorization or deployment.
- A real mobile-device browser or exhaustive accessibility audit. Responsive CSS exists but is not a device-certification claim.
- Waiting 5–60 minutes in the browser to validate TTL: expiry was verified in automated direct-clock and HTTP tests, not by claiming an elapsed-time browser test.
- The complete old studio editor was not re-exercised in the browser this update; its original API regressions passed, and its prior browser record is retained below.

The two demonstration executors remain separate. Passing tests do not establish a production-security, real-vehicle or service-safety certification.

## Historical v0.3 automated baseline

**34/34 tests pass** with Node 24.19.0. Run `npm test`. No dependencies or network are required.

The tests cover parsing and Korean negation/intent safeguards; invalid inputs; policy/rejection/failure branches; stale approvals and routes; concurrent approved requests; durable idempotency; duplicate suppression; immutable snapshots; atomic storage/restart; corruption fail-closed behavior; two-waypoint adapter limits; HTTP APIs, origin/traversal/body validation and split UTF-8 input; mock connector payloads and mention suppression.

Nine additional platform tests cover catalog visibility and disabled planned templates; template editing/version conflicts; required seven-node tool contract; mandatory approval; customer connector-slot binding and narrower rules; required activation; snapshot isolation after admin edits; different inbound/outbound connectors; HTTP-only mock payloads; activation idempotency; legacy-state migration; persisted run traces; and new HTTP endpoints.

## Three-role presentation verification, 19 October 2026

Against the actual local Node server, the revised main screen was tested through:

- Parent phone submission appearing in the manager desktop while the vehicle retained its previous stop.
- One manager action performing approval then dispatch, followed by a separate explicit vehicle acknowledgment and parent success result.
- Browser reload preserving the selected completed run and its shared state.
- Ambiguous input disabling approval; rejection displayed a parent request for clarification and no vehicle dispatch.
- Explicit failed vehicle execution displaying failure in all roles, with the previous confirmed route preserved.
- Quick-setup open/close and activation of a new versioned instance.
- Fresh-tab recovery of an outstanding vehicle dispatch; activation blocked while that confirmation is pending. Completing the acknowledgment in the new tab updates the original tab after reload.
- Repeated demos selecting a destination different from the current confirmed stop, rather than resetting or inventing a baseline route.

## Template studio verification, 19 October 2026

Using the actual UI against a local Node server:

- Opened the customer catalog and administrator editor.
- Edited template title and selected HTTP mock output while keeping Slack mock input; saved version 2.
- Selected the template from the customer catalog; verified fixed administrator-defined connector slots.
- Bound a fictional DEMO profile and activated the workflow.
- Submitted a fixture into the activated instance and inspected its seven-step trace.
- Approved, separately dispatched, explicitly acknowledged success, and inspected persisted results/step output.
- Earlier runtime tests also checked duplicate submission, policy-blocked ambiguous input, rejection reason, explicit failed execution, outbound mock failure payload, browser reload, and server restart.
- At a 1180-pixel browser viewport there was no horizontal page overflow. Other responsive breakpoints are implemented but not claimed as device-tested.

Screenshots are separate private review deliverables, not included in the source ZIP.

No real LLM, external messaging account, HTTP integration endpoint, Pleos SDK, emulator, Android project, or vehicle hardware was tested.

## Final repository integration checks · v0.7.0

The publication snapshot preserves the separately isolated experimental Pleos source preview from the existing main branch. Final independent checks pass: `npm test` (**247/247**) and `node --test experimental/pleos-sdk-source-preview/tests/*.test.mjs` (**21/21**), with no failures, skips or cancellations. All JavaScript/ES module syntax checks pass. The protocol tests use fake callbacks; Kotlin/Gradle/SDK compilation, emulator execution and real vehicles remain untested. No native binaries, runtime data, credentials or duplicate old web application are included.
