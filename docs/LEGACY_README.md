## 기존 프로토타입 문서 (이전 범위 및 변경 이력)
# PleosFlows · v0.9.0 vehicle prototype

## 차량의 움직임을 업무의 흐름으로

**PV5 운영자를 위한 고객 안내·반복 업무 자동화 플랫폼**의 로컬 시뮬레이션입니다. 운영자가 정한 규칙을 차량 사건 → 고객 안내 → 완료·실행 이력으로 연결합니다.

PleosFlows is the user-selected product name (28 October 2026). This is an independent proposal prototype, **not an official Kia or Pleos product, partnership, or certification**. The name does not imply working Pleos SDK integration.

The v0.9.0 vehicle extension preserves existing web execution contracts and API routes and adds the opt-in native bridge. The preceding branding-only v0.8.1 release preserved the v0.8 contracts. Existing `MOBFLOW_DATA_DIR` and `mobflow-*` browser storage keys intentionally remain compatible; no migration or reset is required. See [branding and scope](docs/BRANDING.md).

## Native Android vehicle extension (v0.9.0)

The `android/` project builds two native APKs: real AAOS vehicle API path (`vehicleDebug`) and a separately labelled developer-input simulation (`demoDebug`). See [Android setup and limits](android/README.md).

This release adds the opt-in [native vehicle bridge](docs/NATIVE_VEHICLE_BRIDGE.md) to the same unified run store. Enable it with `PLEOSFLOWS_NATIVE_EMULATOR=1`; it accepts separately labelled AAOS or debug-fixture observations, requires fresh speed/P/UX safety state for explicit parked actions, and never infers completion from motion. Native provenance is not authentication and local notification records are not external sends. The original standalone browser flow below remains a simulation. Android build/installation/runtime results are recorded separately; the server tests do not establish emulator or real-car compatibility.

The full server suite currently passes **322 tests** (286 existing + 28 native bridge checks + 8 native-bound web UI checks). Native mode is local-emulator only; no production device identity, location/ETA integration, real business communication, or door/navigation command is added.

**Executed Android status:** genuine Vehicle 0.9.1-prototype/code 11 installs and runs on the official Pleos API 34 ARM emulator on M3 Max. Actual permission handling, stationary AAOS reads, same-run native/server journey and network-loss locking passed runtime tests. Both flavors pass 28 JVM tests and lint has zero errors / one OldTargetApi warning each. Moving-state injection and real-car support remain unverified. See [the executed report and actual screenshots](docs/ANDROID_VERIFICATION.md).

## Authoritative end-to-end workflow

Start with `/` (or `/unified.html`). This is the primary operational path, not a montage of independent labs:

1. Select a bounded **school or delivery template**, a fictional vehicle/trip/customer assignment, an approach threshold, notification stages and disclosure fields. **Save and activate** creates an immutable reviewed version.
2. **Dispatch** that version. The run permanently records `tenantId`, `jobId`, `vehicleId`, `tripId`, `customerId`, `workflowId`, `workflowVersion`, and `runId`.
3. Open the specific run's **driver link**. Accept its assignment while parked; inject vehicle signals only from the separately labeled observer simulation panel. Signals use `/api/unified/runs/:runId/events`. The driver is not required to manually send each notification.
4. Open the specific **customer link**. It never uses the newest run. The server intersects workflow disclosure fields, the dispatch-time fleet role policy, and the current fleet role policy. Restricting the fleet policy immediately removes fields from this endpoint; expanding it cannot silently broaden an old run. Distance requires the position disclosure permission.
5. The same run returns to the console with event, condition, action and completion audit records. Explicit parked completion ends sharing. Retry targets only a failed action.

**A practical demo:** create vehicle 101 workflow with ETA only and 3-minute approach condition → dispatch → driver accepts → observer departure → customer sees ETA 8 but no coordinates → observer ETA 2 triggers approach record → observer arrival → driver confirms handover → customer hides all live data → console shows the same run history. Create vehicle 102 concurrently and verify the links never switch runs.

In the standalone browser flow, all signals, transport attempts and coordinates remain **local simulations**. That browser flow is not SDK/APK/emulator execution, a real Kakao message, live route, device authentication or production role authentication. The separately enabled native bridge is documented above. The customer link is a local demo scoped token, and the operator API is deliberately unauthenticated; **do not expose this server publicly or use real personal information**. The fleet policy is an application gate, not a grant of OEM/SDK permissions. No vehicle commands are sent.

### Scope and limits
- This primary path implements two bounded templates, not the full freeform studio or all connector integrations.
- `/workflow-lab.html`, `/communication.html`, `/vehicle.html`, `/customer.html`, `/studio.html`, `/pickup.html` retain legacy experiments for regression/reference. Their old run identifiers are not migrated into v0.8 runs. They are explicitly separate, not evidence of a unified workflow. Do not splice their actions into a v0.8 demo.
- `/fleet.html` retains advanced vehicle-control experiments. Its **role read/disclosure policy is shared with v0.8**, but its door-lock/destination approval batches are not part of v0.8 workflow execution.
- Use the exact v0.8 driver/customer URLs generated by the console for new recordings. Existing video v2 predates this integration and is not a proof of the new path.
- Workflow changes create new immutable versions; existing runs keep their selected rules. Changes to current role policy can restrict them immediately. Completion, revocation, 15-minute link expiry and 120-second telemetry staleness hide customer fields.
- Reload and process restart preserve canonical runs. Duplicate event IDs replay once; conflicting duplicate payloads are rejected. New telemetry events do not repeat an already recorded notification stage.

Run `npm test` and `npm start`. Tests include API routing, two simultaneous vehicles, policy intersection, threshold causality, snapshot immutability, terminal/stale masking, idempotency and failed-only retry. These are local checks, not native SDK or real-car certification.

---

## Earlier versions (preserved history)

# Earlier product iterations · current PleosFlows branding

A local Korean **B2B2C workflow prototype**. PleosFlows administrators supply bounded workflow templates and capabilities. Business/field users such as academy operators, visiting instructors and delivery drivers configure the allowed connections and rules. Their customers or parents receive only the relevant updates.

**v0.7 adds the company vehicle/policy console below; v0.6 supplies a bounded workflow studio with a reusable connector registry, normalized event aggregation, editable conditions/actions, mock AI assistance, separate approval policy and execution traces. The white/blue workspace and bundled Pretendard remain intact.**

- Business configuration controls whether simulated KakaoTalk notifications and location sharing run, when sharing starts, which information appears, and when notices are generated.
- A fictional field/vehicle event progresses the workflow. The customer gets only their own run's simulated position, remaining distance and ETA.
- Completion, stop or link expiry ends sharing. Stale location hides all location and ETA values instead of presenting them as current.

The new platform supplies **two bounded six-stage workflow contracts, not an arbitrary graph engine**. Customers can change the allowed input connector, mapping, freshness, condition, mock-AI use/tone, approval policy/role and action selection; these changes affect execution. The older customer communication and pickup executors remain separate, fully accessible scenarios rather than the product boundary.

## v0.7 company vehicles and policy control

Open `/fleet.html#vehicles` for **one fictional academy operating two vehicles**, each with a separate assigned fictional pupil, trip, pickup/dropoff schedule, attendance label, workflow and status. This is a customer-company console, not a global fleet control center.

- **정책 제어:** inspect and configure role-scoped fields; distinguish information read, destination-change request/approval and simulated door lock. Parents/customers receive only their own trip projection; drivers only assigned vehicles; operators only their organization.
- **우리 회사 차량:** register fictional vehicles, configure mock capability/state, and bind the same bounded vehicle-workflow to selected vehicles. No cross-vehicle pupil transfer, reassignment or route optimization.
- **차량별 실행 이력:** policy evaluation, operator approval and simulation are separate stages. Each vehicle/action has its own result, failure, idempotency and retry. Current restrictive policy, capability, freshness and approval versions are checked again before execution.
- On fresh data, run read + lock on both vehicles: vehicle101's read succeeds with lock approval pending; vehicle102's read fails once and lock is denied for unknown mock capability. Retry affects failed steps only.
- Role selection is **not production authentication**. Mock capability support is **not verified Pleos/OEM support**. Door lock records a local simulation only; a destination approval does not apply a navigation route. No actual command is sent or confirmed.

This adds a third bounded vehicle contract, not an arbitrary graph executor or a bridge from the older visit/delivery runs to hardware. All earlier workflows remain available. See [company console and policy boundaries](docs/FLEET_POLICY.md).

## v0.6 workflow studio

Open `/workflow-lab.html` for the legacy workflow library. Select **방문 일정 안내** or **배송 변경 검토**, inspect or edit the six steps, save the draft, and separately activate that reviewed version. Then supply a simulated event.

1. **Visit:** Calendar schedule + Sheets customer row + simulated vehicle context → ETA condition → mock message draft → human review → selected customer/Slack/Discord local records.
2. **Delivery change:** Discord or Slack request + Sheets job row + simulated vehicle context → delay or battery threshold → mock exception summary → operator review → selected Sheets/Discord/Slack local records. A battery warning never establishes range, driveability or a route decision.

Try ETA 3 vs 8 with a 5-minute threshold; delivery delay 18 vs 5 with a 10-minute threshold; or battery 24 vs 80 with a 30% maximum. Select only internal Slack and the write-only approval policy to see an allowed internal-only local record without an approval wait. Customer/channel/data-write actions still require review.

- Library shows saved workflows and can reopen them. Saving does not activate. Editing never changes an earlier activation or run.
- Advanced JSON editing uses the same strict validator. Unknown nodes, fields, services, operators, arbitrary code and unsupported combinations are rejected.
- Event envelopes include source, type, timestamp, tenant, job and customer scope. Same-tenant/job, field join, freshness and known vehicle state are checked before assistance. Freshness is checked again before approval and retry.
- Mock AI uses deterministic typed intent mapping and string templates. It provides a reviewable structured draft/message; no LLM or natural-language inference is called. It cannot activate, approve or execute.
- Runs expose the exact activation snapshot, normalized inputs, condition branch, approval and action records. Retry touches failed actions only; stored idempotency keys prevent duplicated effects.
- All connector accounts are **not connected**. OpenAPI-documentation status, partnership candidates and future-payment concepts are explicitly separated. KidsNote, unspecified school-bus services and payments are disabled catalog entries.

See [bounded platform architecture](docs/PLATFORM_STUDIO.md). Platform contracts are supplied by code and shown read-only in the admin panel; changing their allowed capability sets requires a source edit and tests, not an admin UI action.

## v0.5 vehicle-workflow simulation

Open `/vehicle.html` or select **차량 업무 화면**. This is a web prototype, **not an installed Pleos app, emulator screenshot, or real-vehicle screen**.

- Parked task screen: next stop, the current customer, staged task confirmation, and customer-communication/share status. No business configuration forms or navigation map.
- Navigation stays a separate app. The moving-screen design locks PleosFlows task controls. It does not actually launch, switch, overlay or control a navigator, and it does not implement a background service.
- Manual motion and UX-restriction simulations are independent. Driver actions require both parked motion and explicitly allowed simulated UX. Unknown/restricted states fail closed. Actual deployment must use the platform's CarUxRestrictionsManager/active restrictions; zero speed or parked gear alone is not permission.
- Departure and approaching are separate mock events. Arrival is explicit. Completion requires another explicit confirmation; arrival, GPS, route acknowledgment, and request receipt do not complete the task.
- Completion creates only the configured simulated notification, ends sharing on the backend, and removes location/ETA from the customer projection. No real KakaoTalk delivery is claimed.
- **변경 요청 경계** is labeled a non-executing design example. Pickup approval, transmission, receipt, and real application are separate states. The separate pickup executor is not chained into this screen.

Try: **가상 업무 준비** → **출발 업무 시작** → outside-screen **도착 임박 이벤트** → **정차 모의** → **도착 확인** → **하차·인계 완료** → **완료 확인 · 공유 종료**. Toggle **UX 허용 모의** to lock parked controls independently. Demo preparation explicitly simulates parked motion and allowed UX; neither comes from vehicle sensors.

[Vehicle design and verification boundaries](docs/VEHICLE_VIEW.md) records what was built and what remains unverified. The separately delivered SDK source preview is not bundled or invoked by this web demo.

## v0.4.1 visual update

The existing interfaces now share a clean white/blue design: clear workspace navigation, neutral cards, blue actions, and responsive layouts. PleosFlows remains its own brand; this is not a Coinbase product or integration. The communication settings, customer projection, pickup approvals, and versioned editor keep their previous behavior.

Pretendard Variable v1.3.9 is bundled locally in `public/fonts/`, with its SIL Open Font License and upstream source recorded alongside it. It genuinely loads from the local app; no CDN, font account, or network connection is required at runtime.

## Run locally

Node.js 22+ required; final checks used Node 24.22.1. No dependencies, installation, API keys, accounts or internet connection are required.

```sh
cd pleosflows
npm start
```

Open http://127.0.0.1:3000.

```sh
npm test
```

**247 automated tests pass** (184 earlier regressions + 51 fleet policy/backend checks + 12 fleet frontend regressions). See the verification record for the distinction between backend tests, mocked frontend regressions and real-browser checks.

The server binds to localhost by default. Do not expose it publicly: this demo has no real authentication, business tenancy or authorization. `PORT` changes the port; `MOBFLOW_DATA_DIR` changes the data directory. Use one process per data directory.

## Try the customer communication workflow

1. At `/communication.html`, select **학원 운영자**, **방문 강사** or **배송 기사**. Each uses a fixed fictional customer and destination.
2. Choose **카카오톡 알림**, **위치 공유 링크**, sharing start (**출발** / **도착 임박**), individual position/distance/ETA fields, notice stages and link lifetime.
3. Click **설정 적용하고 시연 준비**. This saves an immutable configuration and creates a run. Changes made afterward apply only to a new run.
4. Click the field screen's **출발 이벤트 시뮬레이션**. Continue through approaching and arrival. These are manual simulated events, not GPS observations.
5. Open **고객 전용 링크 미리보기** to inspect the isolated customer view. It receives a separate scoped response, not the entire operator state.
6. Click **업무 완료하고 공유 종료**. The same customer link no longer returns position, distance or ETA.

Also try:
- Sharing off: no coordinates, distance or ETA are returned at any stage.
- KakaoTalk off: no simulated notification is created.
- Approaching-only sharing: departure does not disclose location; approaching does.
- Current position off, ETA on: the customer sees only the chosen fields.
- **업데이트 지연 테스트**: masks stale position and ETA until a fresh simulated movement. A real 120-second inactivity limit also applies.
- Stop, refresh and repeated clicks: state persists and version/idempotency checks prevent duplicate stage notifications.
- Wrong customer ID in a link: returns a generic not-found result, without another customer's details.

The default UI intentionally preselects illustrative simulated features for a quick demo; nothing runs before activation. API defaults are sharing off and KakaoTalk off. Link lifetime starts at run creation, not departure, and is 5–60 minutes. The link and all values are local demo artifacts, not production authentication or live tracking.

## Existing pickup workflow

Open `/pickup.html` or select **픽업 승인**. The existing parent request → manager approval → vehicle dispatch → explicit simulated route acknowledgment → parent result flow is retained.

- Approval alone does not change the confirmed route.
- Failure and rejection preserve the confirmed route.
- Only explicit simulated acknowledgment commits a change.
- Route acknowledgment is not arrival, boarding, handover or service-completion evidence.
- `/studio.html` retains the pickup template's versioned administrator editor, configuration and execution traces.

[Detailed pickup documentation](docs/PICKUP_WORKFLOW.md) describes that separate executor. Its older test count is the 34-test baseline, not the current aggregate. The new communication template is supplied read-only at v1; its allowed business settings are executable, but administrators cannot add arbitrary nodes or custom code.

## What is implemented, simulated and untested?

Implemented locally:
- Persistent atomic JSON stores, versioned template/configuration snapshots, validated state transitions.
- Customer-scoped link projections; closure, expiry and stale-data masking enforced by the backend.
- Reusable notification/sharing settings, exactly-once simulated stage notices, idempotent retry keys and optimistic versions.
- Role-specific settings, field execution and customer-link UI, plus original pickup approval safeguards.

Explicitly simulated:
- KakaoTalk messages are local records. No external message is sent; no Kakao account is connected.
- Position uses a fictional 0–100 grid, not geographic coordinates. Distance and ETA are fixed illustrative stage fixtures: 2.4 km / 8 minutes → 450 m / 2 minutes → 0 m / 0 minutes.
- Movement, arrival and completion are button-driven simulation events. They do not prove real-world arrival, service completion, boarding or handover.
- The old pickup parser remains a conservative deterministic Korean parser, not an LLM.

Not implemented or tested:
- Real geolocation collection, live maps, routing, traffic, real recipient identity, KakaoTalk authorization/API delivery, Pleos SDK/emulator/hardware, production tenancy/security or multi-process storage.
- An unrestricted graph editor, dynamic autonomous AI agent or complete delivery-management product. The v0.6 bounded composition does not imply those capabilities.

See [verification record](docs/TESTING.md) and [integration boundaries](docs/INTEGRATIONS.md). Browser captures are internal QA evidence and are not included in this source ZIP.

## API overview

Bounded platform:
- `GET /api/platform`: registry, contracts, saved drafts, activation snapshots and local run history.
- `POST /api/platform/validate`: strict typed definition validation.
- `POST /api/platform/propose`: deterministic intent-to-definition draft, not an LLM.
- `POST /api/platform/drafts`: save a validated draft; updates require expectedVersion.
- `POST /api/platform/activate`: activate the exact reviewed draft version.
- `POST /api/platform/runs`: start a local mock event bundle against an activation snapshot.
- `POST /api/platform/runs/:id/{approve|reject|retry}`: separate policy transition with expectedVersion and idempotencyKey.

Mutation requests use durable idempotency keys. No endpoint accepts account credentials, arbitrary event payloads, real recipients or live coordinates.


Customer communication:
- `GET /api/communication`: provider template, role presets, saved settings and operator runs.
- `POST /api/communication/configurations`: validated settings. No credentials, live recipient or coordinates accepted.
- `POST /api/communication/runs`: create from a saved configuration/version.
- `POST /api/communication/runs/:id/{depart|advance|complete|stop|stale}`: requires expectedVersion; supports idempotencyKey.
- `POST /api/communication/runs/:id/{vehicle-motion|vehicle-ux|vehicle-depart|vehicle-approach|vehicle-arrive|vehicle-complete}`: versioned, idempotent simulation controls; motion/UX state does not refresh location. Completion requires `completionConfirmed: true`.
- `GET /api/customer-links/:token?customerId=...`: one run/recipient projection only; validates both before revealing any state. Expiry applies even on read-only GET.

Original pickup endpoints are unchanged; see the detailed pickup documentation.

## Storage and delivery

`data/fleet.json` stores the scoped vehicle policy simulator; `data/platform.json` stores workflow drafts, activation snapshots, runs and idempotency results; `data/store.json` stores the pickup executor; `data/communication.json` stores communication configurations/runs. Runtime data files are not in the bundle. Corrupt storage fails closed. These are local single-process stores, not a distributed database.

Source files are provided as a local ZIP. The source ZIP is a local deliverable. Main-branch publication is handled and verified separately under the user’s explicit request; this ZIP itself is not evidence of a push. No deployment or contest submission is performed by the demo. No production credentials or real customer data are included.

