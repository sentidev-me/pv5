# PleosFlows v0.6: bounded mobility workflow studio

## Product boundary

This is a local-only, single-process demonstrator of reusable mobility workflow composition. It is not a generic IFTTT replacement, dynamic agent runtime, production iPaaS or deployed vehicle application. Existing communication, customer, pickup and vehicle screens remain separately accessible. No native SDK code is compiled, licensed, installed or invoked in this ZIP.

The differentiation being tested is **joining a vehicle-context event to a specific business job, then applying reliable execution policy**. Merely adding AI to an IFTTT-like product is not a unique claim.

## User roles

- Platform provider/admin supplies connector capabilities and two typed workflow contracts in `platform.mjs`. The admin page is an honest read-only contract viewer. Changing allowed capabilities is a code-and-test operation, not a simulated admin form.
- Business customer selects a contract, edits allowed fields and actions, saves a draft, and separately activates the exact version.
- A designated fictional operator or field role reviews and can edit the generated text before approval. This role comparison is a local demo guard, not real authentication or authorization.
- Output recipients are fictional local queues/rows. No real customers are addressed.

## Composition and actual execution

Six ordered bounded steps:

1. Trigger: Calendar visit schedule, or Discord/Slack delivery-change request.
2. Aggregate: Sheets customer/job fixture and Pleos-labelled synthetic vehicle context. Mandatory same-tenant and same-job checks; customer chooses jobId or customerId mapping and 30–300 second freshness.
3. Condition: configurable numeric metric, `lte`/`gte` operator and threshold. Visit supports ETA. Delivery supports delay or battery percentage. Values influence the branch; a failed condition produces no assistance or output.
4. Assistance: optional deterministic mock message/exception summary using joined fields. Disabling it uses a fixed template. Tone changes the generated text. No LLM call or natural-language inference occurs.
5. Approval policy: always require approval, or require it for customer/channel/data changes. Only internal Slack local records may proceed without a review when that explicit policy is selected. Mock AI has no approval authority.
6. Actions: only the selected allowed action set runs. Outputs are inspectable local records with connector, recipient label, message, status, attempt count, timestamp and idempotency key.

There are no arbitrary nodes, cycles, branches, custom JavaScript, unbounded tools or user-supplied plugin code. Unknown keys, connector IDs, unsupported combinations and action types are rejected by the backend validator, not simply hidden by UI. The advanced JSON editor invokes the same validator.

### Two materially different examples

| Example | Trigger | Condition | Assistance | Approval | Possible output |
| --- | --- | --- | --- | --- | --- |
| Visit notice | Calendar schedule | ETA <= configured minutes | Customer message | Field/operator | Customer queue + internal Slack, optional Discord |
| Delivery change review | Discord or Slack request | Delay >= configured minutes, or SOC <= configured percent | Exception summary | Operator | Sheets row + Discord, optional Slack |

Both use normalized source/time/tenant/job/customer events. The second includes a synthetic next-booking context of 20 minutes. Battery percentage is a warning input, not a range estimate or driveability decision. No vehicle commands or actual route changes are executed.

## AI transparency

The optional **AI draft preview** is an explicit intent selector mapped to a typed template. It can propose customer updates, internal-only notifications or delivery exceptions. The proposal is not silently saved or activated. A user must accept it into the draft, save, and activate separately.

The run's assistance step stores provider=`deterministic-mock`, actualLLM=`false` and hasExecutionAuthority=`false`. Its output uses the joined fictional customer, job and selected metric. These are constrained mocks intended to expose an eventual AI integration boundary, not evidence of model intelligence.

## Reliability and limits

- Draft versions use optimistic concurrency; activations copy the reviewed definition and graph plus a SHA-256 fingerprint.
- Runs copy the complete activation snapshot, so later edits never change a pending or finished run.
- All mutation APIs require idempotency keys. Exact duplicate requests replay the stored result; reused keys with changed payloads conflict.
- Data aggregation rejects mismatched business/job IDs, join mismatch, stale or future timestamps and unknown simulated vehicle state.
- Approval and retry recheck source freshness. Expired data must be rerun with a new event before review; rejection remains possible.
- Explicit failure injection is limited to a selected local action. Retry only changes failed records; successful outputs are never repeated.
- State is stored by atomic temporary-file rename. This is single-process file storage, not a distributed transaction system. Corrupt storage fails closed.
- The frontend retains current draft/run selection, review edits and pending mutation keys in session storage, bounds reads with a 7-second timeout, and preserves keys for uncertain retry across reload. Saved drafts and run records persist on the backend and can be reopened.

No production tenant authentication, entitlement enforcement, real identities, encrypted database, distributed queue, credential vault, background scheduling, webhook subscriptions, OAuth or network connector sends exist. Never expose the localhost server to public networks. Source defaults bind localhost; the HOST override is not a production deployment mechanism.

## Connector status model

The registry keeps these dimensions separate: `integrationLane`, descriptive documentation/access status, `connectionStatus: not-connected`, and `executionMode: local-simulation|catalog-only`.

- **OpenAPI targets:** Calendar, Sheets, Slack and Discord have official API documentation, but no accounts or subscriptions are connected.
- **Vehicle SDK:** Pleos Connect on-vehicle vehicle-state adapter slot. Its synthetic events do not come from a connected vehicle. FusedLocation is documented but access guidance still says Not Available Yet; ETA/arrival must remain explicitly simulated. On-vehicle SDK availability is not the same as the Europe-limited cloud Vehicle Data API. Fleet APIs are a separate agreement/access path.
- **Partnership/access review:** customer messaging channel (future Kakao AlimTalk dealer/template/consent work), KidsNote, and an unspecified school-bus service. KidsNote is catalog-only because public developer-access details are unverified. School-bus product/provider identity remains unresolved.
- **Future expansion:** payment request/approval/result events are only a disabled conceptual catalog item. No payment provider, account, partnership, transaction or payment feature is implied.

Calendar resource-change push is not a native event-start trigger; production start alerts need an application scheduler. Sheets row-change monitoring needs adapter polling or an appropriate Apps Script design; edit triggers do not run for all API/script writes. Slack input and message output need explicit APIs/scopes. Discord input requires commands/buttons/Gateway setup rather than reading private conversations.

## Files and navigation

- `/`: library, builder, runs, connector catalog, admin contract viewer (hash routes).
- `/communication.html`: retained customer-notification/tracking scenario.
- `/pickup.html`, `/studio.html`: retained pickup scenario and its older admin editor.
- `/vehicle.html`: separate vehicle-task web simulation, not navigation or native Pleos.
- `platform.mjs`: registry, contracts, validation, snapshot store and engine.
- `public/platform.js`, `public/platform.css`: workflow UI.
- `tests/platform.test.mjs`: focused API/engine/UI-source regressions.

See `TESTING.md` for the final verification record and the difference between automated checks, browser checks and untested integrations.
