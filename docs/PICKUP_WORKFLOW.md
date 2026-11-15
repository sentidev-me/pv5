> Historical v0.3 pickup-only guide. In v0.4 this screen is at `/pickup.html`; the main `/` screen is the new customer-communication workflow. Test counts below describe the old baseline.

# PleosFlows · One request, three connected roles

**Parent phone → manager desktop approval → vehicle display confirmation → parent result.**

The main screen is a guided, three-role hackathon demo. The underlying product remains an admin-authored workflow template platform; catalog, connector configuration and detailed execution traces are available in the secondary studio.

This local Korean prototype demonstrates a workflow product, not a replacement school messaging app. Administrators define the supplied template and its connector slots. Academy managers select it, bind fictional connection profiles, set narrower operating rules, and activate a versioned instance. The first executable template coordinates a pickup change.

## Run locally

Prerequisite: Node.js 22+ (tested on Node 24.19.0). Unzip the supplied source bundle, then:

```sh
cd pleosflows
npm start
```

Open **http://127.0.0.1:3000/pickup.html**. No npm install, external account, API key, payment, or internet connection is needed. `node server.mjs` also works directly.

```sh
npm test
```

**34 automated tests pass.** Server defaults to localhost. Do not expose it publicly: administrator/customer role switching has no authentication in this demo. `PORT` changes the port; `MOBFLOW_DATA_DIR` changes the persistent data directory. Use one process per data directory.

## Evaluate the demo in two minutes

1. Open the main screen. Three visually distinct surfaces show the same persistent run: a purple parent messaging phone, a blue manager desktop, and a dark wide vehicle display.
2. On a fresh installation, click **워크플로 선택하고 시작**, then **이 워크플로로 시연 시작**. This activates the administrator's pickup template with fictional connections and default rules. No external account is connected.
3. In the phone, edit the fictional message if desired and click **변경 요청 보내기**. The manager sees the requested location/time and policy checks. The vehicle keeps its existing stop.
4. In the manager screen, click **승인하고 차량에 전달**. This performs approval followed by dispatch; the vehicle shows the requested stop awaiting acknowledgment. If dispatch fails after approval, the UI retains that state and provides a retry button.
5. In the vehicle, click **경로 적용 확인**. Only this explicit simulated acknowledgment commits the route change and displays the parent result. Reload to verify persistence.

Try **실패 상황 테스트** instead of acknowledgment, or submit an unclear message and use the manager's information-check rejection. Neither branch changes the confirmed route. **처음부터 보기** starts a new presentation without deleting history; it is disabled while an approved/dispatched request is unresolved.

### Explore the platform behind the story

Use **워크플로 설정** for quick activation, or **관리자** / **템플릿 보기** to open `/studio.html`:

- **관리자 스튜디오**: inspect seven typed steps; edit the template name, step descriptions, or trigger/result connector and save a version. Slack, Discord, web input and generic HTTP support mock payloads only. KakaoTalk/Kids Note remain disabled and unverified.
- **템플릿 카탈로그**: choose the executable pickup template. Other cards are explicitly planned.
- **연결·규칙 설정**: bind fictional `DEMO_…` profiles to the administrator's connector slots, choose permitted fictional stops, and narrow the 15:00–16:30 time range. Human approval is mandatory.
- **워크플로 실행**: inspect trigger, interpretation, policy, approval, dispatch, acknowledgment, and result-preview data. Activated instances retain immutable template/configuration snapshots.

The studio's **역할 시연** link returns to the simplified main presentation.

## What is real in this prototype?

- Real local HTTP backend, persistent atomic storage and schema migration
- Real administrator template versioning and connector-slot selection
- Real customer activation, immutable snapshots, and rules enforced by the backend
- Real input validation, state transitions, durable idempotency, duplicate suppression, stale-version/route protection, and run/event traces
- Actual source and output connector selection changes the stored mock payload shape

## What is explicitly simulated or limited?

- The **AI/Agent-intended node has no LLM configured**. A conservative deterministic Korean parser is the labeled fallback. There are no model calls, agent reasoning, or autonomous tool decisions.
- Step instructions are reviewable metadata in this version. Editing them does not prompt a model or modify the parser’s code.
- This first executor supports one fixed, ordered seven-node contract. The admin editor cannot create arbitrary graphs, delete safety gates, install tools, or run arbitrary code.
- Slack/Discord/HTTP/web inputs and notifications are local fixtures/previews. No account is connected, no webhook endpoint accepts live third-party events, and no external message or HTTP request is sent.
- The vehicle is a local simulation. No Pleos SDK, emulator, Android build, or hardware API has been run.
- Only fictional people and places are accepted. Do not enter real children’s information or credentials.
- No measured travel time, traffic, live map routing, or other-rider impact is computed.

## Files

- `public/index.html`, `public/story.js`, `public/story.css`: guided three-role demonstration
- `public/studio.html`: secondary template and configuration workspace

- `public/builder.js`, `public/builder.css`: catalog, setup, admin editing, and visible node traces
- `public/app.js`, `public/styles.css`: run input, approvals, simulator, and results
- `templates.mjs`: validated template contract, versioning, activation rules, and trace derivation
- `workflow.mjs`: execution state machine, policy checks, snapshots, events, and persistence
- `connectors.mjs`: local mock adapter normalization and outbound preview formatting
- `pleos-adapter.mjs`: simulation-only adapter, maximum two navigation waypoints
- `server.mjs`: dependency-free Node HTTP API/static server
- `tests/backend.test.mjs`: 34 regression tests
- `docs/INTEGRATIONS.md`: actual vs future integration boundaries
- `docs/TESTING.md`: automated and browser verification record

## API

- `GET /api/health`, `GET /api/state`
- `POST /api/templates/pickup-change`: `{expectedVersion,title,description,nodes}`
- `POST /api/instances`: `{templateId,templateVersion,name,sourceConnector,connectionLabel,allowedDestinations,windowStart,windowEnd,idempotencyKey?}`
- `POST /api/requests`: `{instanceId,message,childId?:"demo-child-1",idempotencyKey?,externalMessageId?}`
- `POST /api/requests/:id/approve`: `{expectedVersion,idempotencyKey?}`
- `POST /api/requests/:id/reject`: `{expectedVersion,reason,idempotencyKey?}`
- `POST /api/requests/:id/dispatch`: `{expectedVersion,idempotencyKey?}`
- `POST /api/requests/:id/acknowledge`: `{expectedVersion,outcome:"executed"|"failed",reason?,idempotencyKey?}`

Requests require an activated instance. The customer cannot switch away from the administrator’s defined trigger connector. Failure/rejection requires a reason. HTTP 409 reports outdated versions or conflicting retry keys; policy blocks return 422.

## Persistence and execution boundaries

`data/store.json` is excluded from source control and created automatically. Writes use fsync and atomic rename. Corrupt storage fails closed without being overwritten. This remains a single-process JSON store, not a transactional distributed database.

```text
pending → approved → dispatched → executed
   │          │            └────→ failed
   └──────────┴────→ rejected
```

`executed` means **explicit simulated route-command execution acknowledgment only**. It never proves boarding, arrival, or guardian handover. Door events are never used as evidence of those states. The full itinerary stays on the server; the simulated navigation payload is capped at two waypoints.

## Repository status

The private `sentidev-me/pv5` repository was originally empty. A minimal README initialization established `main` and a feature-branch base. **This implementation is delivered as a local source bundle; uploading the full code to GitHub is still awaiting explicit approval.** No PR, merge, public deployment, or contest submission was performed.
