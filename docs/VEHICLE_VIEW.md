# Vehicle workflow web simulation · v0.5.0

## Product boundary

MOBFLOW is a separate job/workflow app, not a navigation replacement. The intended value is reducing repeated phone checks and manual customer-status messages around a job, while keeping explicit handover/completion decisions with the operator. This is a product hypothesis, not a proven productivity or driving-safety result. A phone app could perform the same workflow; the potential vehicle benefit is relevant parked-context access in the vehicle and eventual authorized vehicle events, neither of which proves lower distraction without testing.

The demo displays a conceptual lock state while moving, not a genuine OS transition to navigation. The observer panel is explicitly outside the vehicle screen and is not an overlay. No guaranteed split screen, foreground steal, background service, push notification, route change, real GPS, or real messaging is implemented. No SDK binaries are installed or invoked.

## Explicit state and evidence

`vehicleSimulation.motion` is `parked`, `moving`, or absent/unknown. `vehicleSimulation.uxRestriction` is `allowed`, `blocked`, or `unknown`. These are separate manual lab fixtures, not sensor or OS outputs. Changing either one increments the run version and records an event but never refreshes location, emits a customer-stage notification, confirms arrival, or completes the job.

- `vehicle-depart`: requires parked + allowed; ready → departed and changes only simulated motion to moving.
- `vehicle-approach`: an event injected by the outside-screen simulation controller; departed → approaching. No driver control is exposed in the moving vehicle panel.
- `vehicle-arrive`: requires parked + allowed + approaching; creates an arrival stage, not service completion.
- `vehicle-complete`: requires parked + allowed + arrived + `completionConfirmed: true`; records explicitly simulated evidence (`realWorldVerified: false`), closes sharing, and emits a configured local-only completion notice once.
- Unknown/restricted UX and moving motion independently lock critical vehicle actions. Legacy arrival/completion APIs also honor active simulation locks. A legacy operator completion remains an explicit operator button, not the vehicle's two-step confirmation, and is not real-world evidence.
- Stale versions, idempotent retries, terminal runs, and expiration use the existing communication executor. Two fixed executors remain separate.

Change-request states shown by **변경 요청 경계** are non-executing design examples. Approved, sent/received, and actual application verification are not interchangeable. Route receipt/acknowledgment is not boarding, handover, arrival, or service-completion evidence.

## Official platform constraints considered

Read on 2026-10-24; these documents do not validate this prototype:

- Pleos app windows may vary by vehicle and screen, and are managed by the OS/user, not a guaranteed navigation-plus-MOBFLOW arrangement: https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/app-structure-screen-model
- Actual UX restrictions must be obtained from CarUxRestrictionsManager and its active flags/callbacks, not inferred solely from parked/moving state: https://document.pleos.ai/docs/pleos-only/vehicle-app-developer-guide/driving-restriction-development-guide
- Category policy/Distraction Optimized eligibility must be reviewed; a business-workflow app is not automatically permitted while driving: https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/app-category

## Verification

Backend state/HTTP guards and pure-renderer UI regressions are checked by Node tests. They are not actual CarUxRestrictions, IVI compatibility, Android lifecycle/background, driving-distraction, or handover-proof tests. Browser QA results are recorded in TESTING.md. The bundled font is the same genuine locally served Pretendard Variable v1.3.9.
