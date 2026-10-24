# Experimental Pleos SDK source preview

**Kotlin is uncompiled. No APK, Pleos emulator, live SDK callback, or real vehicle has been tested. SDK installation/license approval remains pending.**

This directory is separate from the validated v0.5.0 web simulation in the repository root. The root server does not import it, expose `/api/pleos`, or integrate it with `/vehicle.html`. No old web application copy or `/pleos.html` is included.

## Included

- `android/`: source-only Kotlin adapter targeting official `ai.pleos.playground:NaviHelper:3.0.5`, with build configuration and manifest/XML. No SDK binaries, wrapper JAR, APK, or credentials.
- `pleos-bridge.mjs`: default-off, local-only transport/event contract. It reuses the root workflow error type; it does not alter the root web server.
- `contract-server.mjs`: isolated protocol test harness using the current root workflow modules. It has separate default storage and no browser assets. It is not the v0.5 web application.
- `tests/pleos-bridge.test.mjs`: 21 synthetic contract tests, separate from the root 129 web tests.
- `docs/SDK-SETUP.md` and `docs/VERIFICATION.md`: setup requirements, evidence, and untested boundaries.

## Verify without installing SDKs

From the repository root:

```sh
npm test
node --test experimental/pleos-sdk-source-preview/tests/*.test.mjs
```

These Node tests inject fake callbacks. They do not compile Kotlin, download the SDK, launch Android, or prove SDK compatibility. The earlier 97-test standalone artifact used an older web baseline; it is not copied here and is not the current aggregate.

## Deliberate boundaries

- One synthetic approved pickup request, one destination, at most two waypoints, and one in-flight SDK attempt. Unsupported waypoint counts are rejected.
- No automatic SDK retry after timeout, restart, or uncertain results. Callback sequencing and destination/ordered-waypoint read-back do not prove causality or real route application.
- `routeApplied`, `causalityVerified`, `vehicleVerified`, `boardingConfirmed`, and `handoverConfirmed` remain false. SDK reports do not silently commit the original mock pickup route.
- Coordinates are public-landmark-area fixtures, not real customers, children, or GPS. Customer sharing and KakaoTalk remain separate simulations.
- Native code is an Activity-bound debug tool, not a background service or a production navigation-coexistence implementation. No navigation overlay or automatic screen switching is implemented.
- Loopback and an intended adb reverse tunnel only. The local protocol is not authenticated/attested; do not expose it publicly or use it on a real vehicle.
- No SDK terms have been accepted, SDKs installed, builds run, app deployed, or contest entry submitted by adding these sources.

See [verification](docs/VERIFICATION.md) before relying on this preview.
