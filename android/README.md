# PleosFlows native Android vehicle prototype · 0.9.1-prototype (code 11)

This is a native Android Activity, **not a WebView or a screenshot of the browser simulation**. It connects to the same local PleosFlows unified workflow store as the operator console. The two APKs have intentionally different signal sources:

| Variant | Package | Signal source |
|---|---|---|
| `vehicleDebug` | `ai.pleosflows.vehicle` | Actual AAOS `CarPropertyManager` speed/gear reads + callbacks, and `CarUxRestrictionsManager` on a compatible Pleos emulator. No manual state controls. |
| `demoDebug` | `ai.pleosflows.vehicle.demo` | Explicit in-app developer fixtures. Always labelled SIMULATION; no car service connection. Never evidence that vehicle APIs worked. |

Both include an explicit `LOCAL_EMULATOR_ONLY=true` build configuration and refuse runtime connection outside an emulator hardware profile. This is a safety guard, not hardware attestation. The genuine AAOS adapter is separate from the local-only HTTP transport. An actual vehicle release requires an authorized compatible device/OEM permissions, approved app category/market review, production authentication and transport, and on-device lifecycle/UX testing; simply removing the guard does not complete that work.

Both are **local contest prototypes**, not production-ready or market-certified vehicle apps. They use the development server only at `http://127.0.0.1:3000` through `adb reverse`. Internet cleartext is denied except this loopback host. Client/session IDs and `source` are assertions, **not authentication or hardware attestation**. Do not expose the server or use real customer information.

## Executed status

The genuine Vehicle APK now installs and runs on the official Pleos API 34 ARM emulator on M3 Max. Actual fresh-install permission handling, repeated zero-speed/P/unrestricted AAOS reads, explicit native-to-server journey, Activity resume and server-loss locking were verified. Both APKs compile and pass 28 JVM tests per flavor; lint has zero errors and one OldTargetApi warning per flavor. Moving-state injection and real-car support remain unverified. See the [executed report](../docs/ANDROID_VERIFICATION.md) and actual PNG evidence.

## What the native app does

- Displays a uniquely assigned workflow with exact run/job/vehicle/trip/rule-version context; it never silently chooses the newest of ambiguous assignments.
- Requires connected, finite near-zero speed (`abs(m/s) <= 0.1`), P gear, unrestricted OS UX, and a fresh reading for each action. Unknown values, permission denial, disconnection and stale data fail closed.
- Dangerous property/UX callbacks immediately lock; a pending old poll cannot override a newer restrictive callback. Only a consistent read of all three inputs can unlock.
- Accept, depart, arrive and confirmed complete are **explicit parked operator commands**. Motion is a precondition, not evidence of departure/arrival/boarding/handover. Completion has a second confirmation.
- Persists each command before sending, reuses its exact idempotency key after uncertain transport, checks server version and keeps pending requests across Activity/process restarts. Lifecycle callbacks register/unregister/release the car service. The app must remain open; no foreground/background service is claimed.
- Uses the native bridge in `../docs/NATIVE_VEHICLE_BRIDGE.md`. The server rechecks fresh safety state and source/session binding. Native-bound runs cannot be advanced through the old web signal buttons.
- Keeps native ETA/location hidden. Only local notification records exist: no KakaoTalk, SMS, email, payment, door-control, navigation request or real GPS call.

## Build

Official prerequisites: Android SDK Platform 35 + Build Tools 35, JDK 17+, Gradle 8.10.2; minimum device API 28. The project uses AGP 8.8.2 / Kotlin 2.0.21 and the SDK-provided `android.car` library. **No proprietary VehicleSpeedListener is used:** Pleos removed it in Vehicle 2.3.1 and currently recommends the standard AAOS speed/gear APIs. No extra proprietary Vehicle SDK AAR is required for these reads.

Accept applicable Android/Pleos terms before obtaining their tools. No SDK/emulator binaries or private debug/ADB keys are included in this source bundle.

```sh
cd android
export JAVA_HOME=/path/to/jdk17
export ANDROID_HOME=/path/to/android-sdk
./gradlew :app:assembleVehicleDebug :app:assembleDemoDebug \
  :app:testVehicleDebugUnitTest :app:lintVehicleDebug
```

Outputs: `app/build/outputs/apk/vehicle/debug/app-vehicle-debug.apk` and `app/build/outputs/apk/demo/debug/app-demo-debug.apk`. Gradle makes a **local development signing key**, not a release key. Protect it locally; do not submit a debug APK as a certified release.

## Run on the official Pleos emulator

Install the official API 34 Pleos Connect v2.1.0 system image matching the host (ARM64 on Apple Silicon; x86_64 on supported Intel/Linux hosts) through the official guide. Use a cold boot and 4 GB RAM. An ordinary Android phone image cannot verify Pleos/AAOS integration.

```sh
# Terminal 1, from the product root. Use a fresh test data folder.
PORT=3001 PLEOSFLOWS_NATIVE_EMULATOR=1 MOBFLOW_DATA_DIR=./native-test-data npm start

# Terminal 2: replace with the verified emulator serial; do not target a real vehicle.
adb devices -l
# First require boot_completed=1 and both services found; do not install into an incomplete boot.
adb -s emulator-5554 shell getprop sys.boot_completed
adb -s emulator-5554 shell service check package
adb -s emulator-5554 shell service check mount
adb -s emulator-5554 reverse tcp:3000 tcp:3001
adb -s emulator-5554 install -r android/app/build/outputs/apk/vehicle/debug/app-vehicle-debug.apk
adb -s emulator-5554 shell am start -n ai.pleosflows.vehicle/.MainActivity
```

Grant the requested speed-read permission in this isolated test emulator. Start in P/zero-speed/OS-unrestricted state. If there is no assigned run, the explicitly labelled **에뮬레이터 데모 업무 만들기** button creates a fictional workflow. Alternatively dispatch one unique vehicle-101 workflow in the web console before opening the app. These are alternative paths; multiple active assignments fail closed.

For vehicle-state injection use the official Pleos Virtual Console (forward port 8088 as its guide describes). Its inputs are simulator inputs, even though the APK receives them through real AAOS service APIs. This is **emulator API integration**, not real-car sensor validation. The OS may itself block a parked-only Activity while driving; the app does not declare `distractionOptimized` or bypass the restriction.

Exercise: parked assignment → accept → explicit depart → inject moving/D/restricted → verify lock → inject parked/P/unrestricted → explicit arrive → cancel completion → confirm completion. Inspect the **same runId** in the operator console. Native location/ETA must remain hidden. Then test permission denial, service/network loss, background/resume and restart, stale state, duplicate completion and conflicting version. Backend tests cover these server boundaries; they do not substitute for runtime tests.

## Verification and provenance

See `../docs/ANDROID_VERIFICATION.md` for the final executed outcome and limits. Build, lint, JVM tests, installed Activity, AAOS reads, injected-demo behavior and real-car validation are separate stages.

This work materialized and inspected the earlier `mobflow-pleos-sdk-source-preview.zip` v0. That draft was an uncompiled Activity-based **NaviHelper route-attempt experiment**, not the latest workflow UI. The new app carries forward its durable-journal/lifecycle intent, removes route requests from this workflow scope, updates branding and integrates the latest unified server. The immutable old preview is not silently relabelled as this executable.

Official sources consulted 2026-10-28:
- https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/vehicle-app-faq
- https://document.pleos.ai/en/docs/pleos-only/release-note/sdk-261015
- https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/driving-restriction-development-guide
- https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator
- https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/use-vehicle-emulator
- https://developer.android.com/reference/android/car/VehiclePropertyIds
- https://developer.android.com/reference/android/car/drivingstate/CarUxRestrictionsManager


## Actual Android UI tests

The `androidTest` sources use Android UIAutomator on the genuine Vehicle flavor only. Run the permission test on a fresh app installation with CAR_SPEED not yet granted. Run the journey test with no active assignment, or its one unique unadvanced fictional assignment; it deliberately asserts these preconditions. The network-loss test requires the host to stop only its test server after `NETWORK_READY`, and restore it afterward. Do not run these tests indiscriminately against user/production state or treat a failed precondition as an app success. Captures are written to this debug app's private `files` directory and can be exported using the standard debug `run-as` route on the matching AAOS user.

Pleos API 34 supplies the standard Car API through its boot Car APEX. The optional named `android.car` library plus explicit runtime class checks support this layout without weakening the Automotive feature requirement or replacing genuine observations. The final report distinguishes the stopped native flow from unverified moving-state tests.
