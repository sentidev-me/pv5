# Connector and vehicle boundaries

## v0.4 customer communication capability

The second supplied template uses `communication.mjs`. Its KakaoTalk adapter is strictly an in-process simulated-notification record. It does not use, verify or claim access to KakaoTalk APIs, account permissions or business-message contracts. The original pickup editor still disables KakaoTalk as a live/inbound connector.

Business users can configure sharing start, fields, TTL and notice stages. These settings actually govern backend projections and event records. Position is a fictional local grid and distance/ETA are static fixtures, not geographical data or routing estimates. No geolocation, external map tile, messaging, HTTP dispatch or vehicle API is called. Completion/stop/expiry removes location from customer responses; 120-second staleness masks it until a new simulated movement.

One link identifies one fictional run and customer. Wrong customer scope fails closed, but this is not production authentication: operator APIs are still unauthenticated on localhost. Do not deploy publicly. The communication and pickup executors remain separate demonstrations; an automatic cross-workflow link is not implemented.


## Original pickup implementation: local fixtures only

The administrator’s per-node connector selector controls only an in-process mock adapter. Customers bind a fictional profile to those defined slots. It does not receive authentic Slack/Discord events. The backend stores a source identity with the request, normalizes its text into the same workflow, and constructs an outbound payload preview for every status change. Intermediate previews explicitly describe intermediate states. Only an explicit successful acknowledgment produces a successful execution result; failure and rejection remain separate.

`connectors.mjs` accepts only `demo-web`, `slack-demo`, `discord-demo`, and `http-demo`. It has no network client, credential handler, SDK, webhook endpoint, or send method. Placeholder recipients are fictional. Discord previews disable mentions, and Slack content is plain text. Preview payloads are never delivered.

## Future Slack adapter (not implemented)

One possible integration is a slash command for inbound requests and an Incoming Webhook or an authorized bot API for outbound status. A live implementation needs:

1. Explicitly authorized installation and carefully scoped permissions
2. Server-side secret storage; no token or webhook URL in browser code, localStorage, screenshots, or logs
3. Signature verification over the original raw request body, timestamp freshness validation, and workspace/app/channel/user allowlists
4. Prompt acknowledgment to Slack, followed by queued durable workflow processing
5. Provider event IDs for deduplication; stable request/command correlation and retry/outbox handling
6. Explicit authorization for the real recipient and content before live delivery
7. A hard separation from mock routes so a demo event cannot bypass verification

Official references:
- [Slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/)
- [Verifying Slack requests](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Incoming Webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)

Discord is currently another mock output shape, not a live implementation. A real Discord adapter requires its own verified event/interaction authentication, permissions, consent, and delivery design.

Kids Note, calendars, and existing school/shuttle applications are future research targets. No supported API, partnership, account access, or live connectivity is claimed.

## Pleos / NaviHelper boundary

`simulateDispatch({requestId, itinerary})` creates a local simulation receipt and sends nothing to a vehicle. The full itinerary remains in server state. `MAX_WAYPOINTS = 2` caps the projected navigation payload; this is a design constraint supplied for the prototype, not a claim that compatibility was verified with hardware.

Receipt acceptance is distinct from execution. The simulated vehicle screen explicitly acknowledges `executed` or `failed`. Only successful acknowledgment replaces the confirmed server-side itinerary. Boarding and handover stay `not_confirmed` in both cases.

Before a real adapter: verify supported SDK versions and permissions, actual NaviHelper route contracts, callback semantics, vehicle-side authentication, request correlation, expiration, recovery after disconnection, more-than-two-stop advancement, and operator override. Never map a door-open/close event directly to child boarding or guardian handover.

## Production work deliberately excluded

Authentication and role authorization, verified guardian-child relationships, location/privacy consent, safe stop geofences, real route-impact estimation, multi-tenant isolation, retention/deletion policy, transactional database, outbox delivery, tamper-evident audit, monitoring, timeout reconciliation, and vehicle safety validation remain future work.

## Template platform layer (v0.2)

Administrators edit the supplied seven-node definition and choose supported mock connectors for trigger and notification nodes. Customers bind fictional connection labels and narrower rules to those pre-defined slots. Activation stores a template/configuration snapshot; each run retains it. Later admin edits create a new version without mutating prior instances or runs.

The interpretation node declares an AI-intended capability, `llmConfigured:false`, and `executionMode:'deterministic-demo'`. It does not call an LLM. Its instruction field is display-only metadata. A real agent execution provider would need a separately configured server-side model, typed tool registry, validated structured outputs, per-tool permissions, traceable actions, timeout/retry semantics, and preserved approval boundaries. No arbitrary graph execution is claimed by this first fixed-contract executor.

HTTP mock previews contain a placeholder target; they cannot be used to make arbitrary network requests. In the pickup editor, KakaoTalk and Kids Note remain unverified future examples, disabled. The separate communication workflow adds a clearly labeled KakaoTalk simulation only.

## Pleos emulator availability vs actual integration

The prior documentation review recorded Android Studio SDK Update Site emulator images for Mac ARM and Windows/Linux, including 2.1.0/API 34. Vehicle State and NaviHelper are listed as ready to use without an SDK request; the documented emulator 2.1.0+ flow does not require CRN. Other APIs may have separate access requirements. These are documentation findings, not results from this prototype.

- [SDK/emulator setup](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)
- [SDK access and project setup](https://document.pleos.ai/en/docs/pleos-only/create-my-project)
- [Vehicle emulator and Virtual Console](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/use-vehicle-emulator)

A first actual integration test requires a separate Android/Gradle project, installation of the supported emulator/runtime, verified SDK imports and NaviHelper method contracts, and an observed real API result. The Virtual Console documentation describes simulated vehicle events using an adb-forwarded 8088 port. None of those installation/build/API/adb actions has been performed here. No claim of a blocked or unavailable public SDK should be inferred from the fact that this web prototype has not connected it.
