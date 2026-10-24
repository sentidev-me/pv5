# Company vehicle console and policy control · v0.7

This is **one customer-company console**, initially a fictional academy with two vehicles. Vehicle 101 is assigned fictional pupil A / trip-101; vehicle 102 is assigned fictional pupil B / trip-102. Each card shows its permitted assignment, simulated attendance, pickup/dropoff schedule, bound workflow and latest status. It is not a global multi-company fleet-management center.

All people, children, vehicles, locations and timetables are fictional fixtures. The timetable and attendance labels do not establish actual arrival, boarding, handover or completion. No children are transferred between vehicles. There is no dispatch, reassignment or route optimization.

## Three distinct surfaces

- `/fleet.html#vehicles`: company-scoped registry, safe mock capability/state configuration and a shared bounded workflow binding.
- `/fleet.html#policy`: role/field/action matrix, configurable disclosure, and a backend policy explanation for an explicit vehicle/trip/action.
- `/fleet.html#runs`: independent vehicle/action decisions, separate approval and execution, simulated results, selective retry and traces.

These are also linked from the existing workflow studio. Visit/delivery workflows and all legacy screens remain separate executors. The new `bounded-fleet-v1` contract is a third bounded executor, not a claim that arbitrary existing graphs can run on hardware. The configurable stages are vehicle information read, destination-change request, and simulated door lock. All selected vehicles receive an immutable copy of the same action list; results remain independent.

## Disclosure and action boundaries

The fixed fictional actor directory is a **role-selection demonstration, not authentication**. Anyone with local app access can choose a demo actor, including an operator. Backend scope tests verify this demonstration's projection and state-transition behavior; they do not prove production identity or authorization security. Never expose the server publicly.

| Demo role | Scope | Read data | Destination request | Destination approval | Door lock |
|---|---|---|---|---|---|
| Company operator | Own organization | Configured fields | Separate approval | Operator only | Approval, then simulation only |
| Driver | Assigned vehicles only | Configured fields | Separate approval | Denied | Approval, then simulation only |
| Parent | Own pupil's current trip only | Configured own-trip fields | Separate approval | Denied | Denied |
| Customer | Own current trip only | Configured own-trip fields | Separate approval | Denied | Denied |

Field ceilings are enforced on the backend. Parents/customers cannot be granted battery or lock-state data. Operators can further narrow each role's fields or deny actions. Approval authority is fixed to organization operators, separately from request permission; this UI does not grant arbitrary approvers.

Read permission does not imply request, approval or control permission. Denied cross-organization, vehicle or trip queries return no vehicle fields. The parent/customer state endpoint excludes other vehicles, runs and outputs rather than hiding them only in the UI. Historical row trip identity is also checked before showing cached results. Non-initiators cannot inspect another role's control outputs when their policy denies that action.

## No platform authority is invented

The three capability values (`supported`, `unsupported`, `unknown`) describe only the mock adapter. They do not represent verified OEM, Pleos SDK or OS permissions. New fictional registrations start with unknown capabilities, unknown motion and unknown UX, so they cannot execute. Application policy can only restrict a capability, not create it.

Unknown capability, unknown vehicle/UX state, future timestamp or state older than 120 seconds denies execution. Non-read actions also require parked plus explicitly allowed UX, independently. Saving mock configuration refreshes its timestamp only when selected and increments its version. Reading a page does not refresh state. Displayed fields carry the underlying state expiry and are hidden after it passes, including historical outputs and inspector fields. A failed refresh masks cached disclosure; switching roles clears the previous role before the next response arrives. The screen is explicitly a recent-read snapshot: policy changes made in another view require refresh, and are always rechecked by backend execution.

Door lock never sends a command, mutates a physical vehicle, invokes a network endpoint, starts an SDK or claims actual lock confirmation. It creates a local simulation record. The underlying fixture's door state is not changed to imply a physical observation. Destination approval records a reviewed request only: no navigation route is changed and no receipt, acknowledgment or real application is claimed.

## Immutable decisions and execution rechecks

A saved binding has a fixed action list, vehicle list and version. A new batch stores that binding, the initiating role, organization policy and per-vehicle state snapshots. Later editing cannot alter them. The public response exposes snapshot version references, not unrestricted snapshot data.

1. Policy evaluation creates allowed, approval-needed or denied steps. Evaluation does not execute.
2. An operator approves one exact vehicle/action. Approval itself does not execute either.
3. An explicit simulation step rechecks scope, the original and current policy, current capability, freshness, motion/UX, trip identity and approval versions.
4. Any policy or vehicle version change invalidates a previously granted approval, even if the new setting seems more permissive. Revoked approvals cannot be reused. Start a new batch after reviewing changed state.
5. Successful steps create only local records. Traces distinguish policy, request recording, approval, execution recheck, simulated adapter failure and local result.
6. Retry only attempts failed steps. Successfully stored steps never execute again. Each vehicle/action maintains its own attempt count and output. Durable actor-scoped idempotency keys prevent replayed API mutations from duplicating records, including after restart.
7. Reading historical outputs uses the intersection of original and current field policies and current scope/freshness. Tightening policy masks previously visible data; relaxing it does not reveal fields absent from the original result.

## Reproduce the mixed two-vehicle demonstration

On fresh storage, select the default operator in `/fleet.html#vehicles`. Both vehicles are selected, with vehicle read and simulated door lock.

1. Save the connection and click “차량별 정책 평가”. No adapter action has run yet.
2. Click “허용·승인된 단계 모의 실행”.
   - Vehicle 101: permitted read produces scoped mock fields; lock still needs approval.
   - Vehicle 102: read has a deliberately simulated first-attempt failure; lock is denied because its mock capability is unknown.
3. Inspect each action's trace. These mixed states belong to the same bounded workflow and different vehicles/actions.
4. Approve only vehicle 101's lock. It remains approved-but-not-executed until the separate simulation button is clicked. Revocation is available before simulation.
5. Retry failed steps: only vehicle 102's failed read succeeds; vehicle 101 results are not duplicated and the denied lock remains denied.

After 120 seconds, renew the two mock states before creating a fresh demonstration. State renewal changes versions and intentionally invalidates old pending approvals. Alternatively, restart against a new temporary data directory for a clean demo. Never delete user runtime data automatically to reset a demonstration.

Try the parent role: only vehicle101/trip101 and allowed own-trip fields are returned. Inspect vehicle102 or trip102 to see a server-enforced denial. Change the parent's fields as the operator and inspect again to see actual projection changes. Try unknown capability, unknown motion, restricted UX, stale state, policy changes after approval, approval revocation, duplicate clicks and refresh.

## Local API

All mutation bodies require a fixed `actorId`, durable `idempotencyKey` and only the documented fields. Unknown fields are rejected. Actor IDs are selectable demo identities, not credentials.

- `GET /api/fleet?actorId=...`: scoped registry, policy, bindings and batch projections.
- `POST /api/fleet/inspect`: read-only explain result for actorId, vehicleId, action, optional tripId. Does not need an idempotency key.
- `POST /api/fleet/policy`: operator, expectedVersion and bounded role rules.
- `POST /api/fleet/vehicles`: operator; register a fictional, initially unknown-state vehicle.
- `POST /api/fleet/configure`: operator; vehicleId, expectedVersion and bounded capabilities/motion/UX/fresh/failOnce settings.
- `POST /api/fleet/bindings`: operator or assigned driver; vehicleIds and bounded actions.
- `POST /api/fleet/runs`: bindingId, or one scoped vehicleId and action.
- `POST /api/fleet/runs/:id/{approve|revoke|execute|retry}`: expectedVersion. Approval and revocation additionally require exact rowId and stepAction.

`data/fleet.json` is an atomic local single-process store and is excluded from the source ZIP. No real accounts, OAuth, credentials, external sends, vehicle network, SDK installation or legal acceptance is part of this update.
