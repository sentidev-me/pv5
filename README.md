# MOBFLOW · Configure the work. Keep customers informed.

A local Korean **B2B2C workflow prototype**. MOBFLOW administrators supply bounded workflow templates and capabilities. Business/field users such as academy operators, visiting instructors and delivery drivers configure the allowed connections and rules. Their customers or parents receive only the relevant updates.

**v0.5 adds a separate vehicle-workflow web simulation. v0.4.1's white/blue workspace and bundled Pretendard remain intact.**

- Business configuration controls whether simulated KakaoTalk notifications and location sharing run, when sharing starts, which information appears, and when notices are generated.
- A fictional field/vehicle event progresses the workflow. The customer gets only their own run's simulated position, remaining distance and ETA.
- Completion, stop or link expiry ends sharing. Stale location hides all location and ETA values instead of presenting them as current.

This is two supplied, fixed executors, **not an arbitrary workflow engine**. The customer-communication template has three role presets; they reuse the same capabilities, not three complete industry products. The original pickup-approval flow remains separately available and is not automatically chained to tracking.

## v0.5 vehicle-workflow simulation

Open `/vehicle.html` or select **차량 업무 화면**. This is a web prototype, **not an installed Pleos app, emulator screenshot, or real-vehicle screen**.

- Parked task screen: next stop, the current customer, staged task confirmation, and customer-communication/share status. No business configuration forms or navigation map.
- Navigation stays a separate app. The moving-screen design locks MOBFLOW task controls. It does not actually launch, switch, overlay or control a navigator, and it does not implement a background service.
- Manual motion and UX-restriction simulations are independent. Driver actions require both parked motion and explicitly allowed simulated UX. Unknown/restricted states fail closed. Actual deployment must use the platform's CarUxRestrictionsManager/active restrictions; zero speed or parked gear alone is not permission.
- Departure and approaching are separate mock events. Arrival is explicit. Completion requires another explicit confirmation; arrival, GPS, route acknowledgment, and request receipt do not complete the task.
- Completion creates only the configured simulated notification, ends sharing on the backend, and removes location/ETA from the customer projection. No real KakaoTalk delivery is claimed.
- **변경 요청 경계** is labeled a non-executing design example. Pickup approval, transmission, receipt, and real application are separate states. The separate pickup executor is not chained into this screen.

Try: **가상 업무 준비** → **출발 업무 시작** → outside-screen **도착 임박 이벤트** → **정차 모의** → **도착 확인** → **하차·인계 완료** → **완료 확인 · 공유 종료**. Toggle **UX 허용 모의** to lock parked controls independently. Demo preparation explicitly simulates parked motion and allowed UX; neither comes from vehicle sensors.

[Vehicle design and verification boundaries](docs/VEHICLE_VIEW.md) records what was built and what remains unverified. The separate [experimental Pleos SDK source preview](experimental/pleos-sdk-source-preview/README.md) is not invoked by this web demo. It has not been compiled or run on an emulator.

## v0.4.1 visual update

The existing interfaces now share a clean white/blue design: clear workspace navigation, neutral cards, blue actions, and responsive layouts. MOBFLOW remains its own brand; this is not a Coinbase product or integration. The communication settings, customer projection, pickup approvals, and versioned editor keep their previous behavior.

Pretendard Variable v1.3.9 is bundled locally in `public/fonts/`, with its SIL Open Font License and upstream source recorded alongside it. It genuinely loads from the local app; no CDN, font account, or network connection is required at runtime.

## Run locally

Node.js 22+ required; final checks used Node 24.22.1. No dependencies, installation, API keys, accounts or internet connection are required.

```sh
cd pv5
npm start
```

Open http://127.0.0.1:3000.

```sh
npm test
```

**129 automated tests pass.** See the verification record for the distinction between backend tests, mocked frontend regressions and real-browser checks.

The server binds to localhost by default. Do not expose it publicly: this demo has no real authentication, business tenancy or authorization. `PORT` changes the port; `MOBFLOW_DATA_DIR` changes the data directory. Use one process per data directory.

## Try the customer communication workflow

1. At `/`, select **학원 운영자**, **방문 강사** or **배송 기사**. Each uses a fixed fictional customer and destination.
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
- A general graph editor, dynamic AI agent or complete delivery-management product.

See [verification record](docs/TESTING.md) and [integration boundaries](docs/INTEGRATIONS.md). Browser captures are internal QA evidence and are not included in this source ZIP.

## API overview

Customer communication:
- `GET /api/communication`: provider template, role presets, saved settings and operator runs.
- `POST /api/communication/configurations`: validated settings. No credentials, live recipient or coordinates accepted.
- `POST /api/communication/runs`: create from a saved configuration/version.
- `POST /api/communication/runs/:id/{depart|advance|complete|stop|stale}`: requires expectedVersion; supports idempotencyKey.
- `POST /api/communication/runs/:id/{vehicle-motion|vehicle-ux|vehicle-depart|vehicle-approach|vehicle-arrive|vehicle-complete}`: versioned, idempotent simulation controls; motion/UX state does not refresh location. Completion requires `completionConfirmed: true`.
- `GET /api/customer-links/:token?customerId=...`: one run/recipient projection only; validates both before revealing any state. Expiry applies even on read-only GET.

Original pickup endpoints are unchanged; see the detailed pickup documentation.

## Storage and delivery

`data/store.json` stores the pickup executor; `data/communication.json` stores communication configurations/runs. Neither data file is in the bundle. Corrupt storage fails closed. These are local single-process stores, not a distributed database.

This repository contains the validated v0.5.0 web simulation at its root and a clearly separated experimental Pleos SDK source preview. The application has not been deployed, merged to `main`, or submitted to a contest. No production credentials or real customer data are included.
