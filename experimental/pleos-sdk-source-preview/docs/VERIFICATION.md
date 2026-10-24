# Verification record · 2026-10-24

## Passed

- `node --test experimental/pleos-sdk-source-preview/tests/*.test.mjs`: **21/21 contract tests** against the current repository modules. The earlier standalone preview passed 97 tests (76 old baseline + 21 contract tests); that is historical and is not the current root web test count.
- `node --check experimental/pleos-sdk-source-preview/contract-server.mjs` and `node --check experimental/pleos-sdk-source-preview/pleos-bridge.mjs`.
- Contract tests cover default-off, explicit prior approval, exact versions, synthetic coordinates, waypoint overflow rejection, durable idempotency, single claim, no redispatch after timeout/restart, attempted call distinct from application, post-completion destination/ordered-waypoint matching, stale/mismatched/wrong-attempt/replayed events, terminal failure, cancellation boundaries, localhost/Host/Origin checks, and mutual exclusion with old simulated dispatch while a test is active.
- These tests inject fake callback events. No Node test calls the Pleos SDK.

## Not run / not established

- Kotlin compilation, Gradle dependency resolution, APK packaging/install, official emulator boot, NaviService initialization, real SDK callbacks or device/hardware compatibility.
- Native journal/outbox behavior under an actual Android process lifecycle.
- There is no `/pleos.html` UI in this repository preview. Its protocol harness serves no bundled browser assets. No native or bridge UI browser validation is claimed.
- Real GPS, real vehicle data, route application, child boarding, guardian handover, KakaoTalk delivery, production security or multi-process storage.

## Official source baseline

Accessed 2026-10-24:
- Official sample repository: https://github.com/Pleos-Playground/pleos-sample-navi-app ; inspected main commit `76ed592487a1eab7ba102b9d4b321705426886fe`.
- Import/dependency: https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/NaviHelper/importing-sdk
- Initialization callbacks: https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/initialization-and-release
- Route with waypoints: https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/NaviHelper/route-with-waypoints
- Up to two waypoints: https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/waypoint-settings
- Listener semantics: https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/event-listeners
- Permissions: https://document.pleos.ai/api-reference/connect-sdk-pleos/NaviHelper/declaring-permissions
- Release notes: https://document.pleos.ai/docs/pleos-only/release-note/sdk-261015
- Access/CRN: https://document.pleos.ai/en/docs/pleos-only/create-my-project

Important: NaviHelper 3.0.5 changed coordinate constructor order from longitude/latitude to latitude/longitude. This implementation uses named parameters. Older snippets in some translated documentation still use the prior positional order; do not copy them blindly.

## Remaining native-runtime risks

This is source-reviewed, not Android-tested. The SDK call currently runs on the Activity's main thread. If Binder itself blocks, the native UI and its Handler timeout can stall; the server still quarantines an in-flight job on expiration and does not redispatch. Actual SDK thread-affinity, lifecycle recovery and stall handling require emulator verification before treating this bridge as operational.

The declared app manifest is XML-parseable, but merged-manifest permissions have not been inspected because Gradle has not run. The official Maven POM was readable without credentials; this is metadata availability, not successful binary dependency resolution.
