# Pleos emulator test setup

Native source has not been compiled or executed. Follow this only after the developer accepts the applicable terms. No SDK binaries or copied licenses are bundled.

## Required terms and tools

1. Pleos SDK License Agreement is supplied in the official system-image manifest: https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml . Installing/using the SDK constitutes agreement under §2.2. Development is restricted to compatible Pleos/CRP implementations; SDK redistribution and reverse engineering are restricted. Do not bundle downloaded SDK binaries in this source archive.
2. Android SDK terms: https://developer.android.com/studio/terms . Install Android Studio from its official source and accept the terms yourself or explicitly authorize installation under them.
3. JDK 17+, Gradle 8.10.2, Android SDK platform 35 and matching Android build tools. The native project uses AGP 8.8.2 and Kotlin 2.0.21. No wrapper JAR is bundled; use a trusted Gradle installation or Android Studio.
4. The public Maven repository is https://nexus-playground.pleos.ai/repository/maven-releases/ . Official sample documentation says no repository token is needed. Do not add credentials to source files.

## Build (not yet performed)

```sh
cd experimental/pleos-sdk-source-preview/android
# local.properties should contain sdk.dir=/absolute/path/to/your/android-sdk
# or set ANDROID_HOME to that existing SDK.
gradle --version
gradle :app:assembleDebug
```

Expected APK path from the preview directory: `android/app/build/outputs/apk/debug/app-debug.apk`. This path is a build instruction, not an existing artifact. A full build must resolve the actual SDK and transitive dependencies and may expose further API/runtime compatibility issues.

## Official Pleos emulator

Official installation instructions: https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator

Use Android Studio SDK Update Sites:
- Linux/Windows: https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml
- macOS ARM: https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-arm64-sys-img.xml

Select the Pleos Connect 2.1.0 API 34 image and automotive device. Official guidance uses cold boot and 4 GB RAM. The Linux image manifest lists 4,087,751,964 compressed bytes. CRN is not required for emulator 2.1.0+ per the project-setup docs. NaviHelper and Vehicle State are listed ready to use; other SDKs can require separate access. None of this proves support on an arbitrary production vehicle, including any PV5.

The emulator must have Pleos NaviService and a compatible default navigation application. A normal Android phone/emulator without those services cannot satisfy this adapter. No account, microphone, location, vehicle-control, or security-setting permission is requested by this test app; it declares only internet plus NAVI_ROUTE/NAVI_ROUTE_SEARCH.

## Isolated protocol harness (not the v0.5 web app)

The repository root web app does not import or enable this bridge. The old v0.4.1 web copy and `/pleos.html` were intentionally omitted to avoid confusing the validated v0.5 UI with experimental SDK work.

From the repository root, the synthetic contract tests can run without SDK installation:

```sh
node --test experimental/pleos-sdk-source-preview/tests/*.test.mjs
```

After SDK licensing, build and emulator setup are separately approved and completed, a developer can run the opt-in protocol harness:

```sh
MOBFLOW_PLEOS_EMULATOR=1 node experimental/pleos-sdk-source-preview/contract-server.mjs
```

This isolated local server intentionally serves no browser UI. It uses separate `experimental/pleos-sdk-source-preview/data/` storage by default. Do not point it at the root app's live data directory. Stop the root web server first, because both default to port 3000; the native source uses a fixed localhost port 3000.

The API contract and synthetic fixture setup are exercised in `tests/pleos-bridge.test.mjs`. A developer must explicitly create and approve a fictional pickup request and enqueue it through the harness before the native app can consume it. This is not a ready-to-use browser workflow or integration with `/vehicle.html`.

Only after native build and emulator verification, the intended tunnel/install commands are:

```sh
adb -s <verified-emulator-serial> reverse tcp:3000 tcp:3000
adb -s <verified-emulator-serial> install experimental/pleos-sdk-source-preview/android/app/build/outputs/apk/debug/app-debug.apk
adb -s <verified-emulator-serial> shell am start -n ai.mobflow.bridge/.MainActivity
```

Do not run these commands against an unverified physical device. The app uses only http://127.0.0.1:3000 through adb reverse. It refuses common non-emulator build fingerprints; this guard is not a security guarantee. The native Activity must stay open. Its retry button resends journaled HTTP reports, never an uncertain `requestRouteWithWaypoints` call. A queued job can be cancelled only before Android claims it; no remote navigation cancellation is claimed.

## Known current blockers

The dot cloud environment inspected on 2026-10-24 has Java 21 runtime, but no javac, Gradle, Android SDK, adb or emulator. `/dev/kvm` is absent, so hardware-accelerated Linux Android emulation is unavailable there. SDK licensing approval is pending. No installation, native build, emulator launch or hardware test has been performed. A CPU-only software emulator might still be attempted after setup if supported, but it is not promised to boot or be usable.
