# Android verification · 2026-10-28

## Final result

**Native source and two debug APKs built; Android installation/execution remains unverified.** This cloud environment could not complete a usable official Pleos Android boot. It is not evidence of an app crash, and it is not proof that the app will run successfully on a supported emulator or real car.

| Check | Executed result |
|---|---|
| Vehicle + DEMO debug APK assembly | PASS · version `0.9.0-prototype`, code `10` |
| Android JVM unit tests | PASS · 28 distinct tests (12 safety + 16 freshness), 28 per flavor / 56 executions, 0 failures or skips |
| Android lint | PASS · both flavors, 0 errors / 0 warnings |
| APK signatures / declared manifests | PASS · local development v2 signature; vehicle `ai.pleosflows.vehicle`, DEMO `ai.pleosflows.vehicle.demo`; min 28 / target 35 |
| Server / native bridge / native-bound web checks | PASS · 322/322 (286 prior + 28 bridge + 8 web checks) |
| Clean source ZIP extraction | PASS · 322 server tests; fresh vehicle APK assembly + 28 JVM tests |
| APK installation | NOT PASSED · earlier build of this same version failed before APK acceptance in incomplete Android PackageInstaller |
| Activity launch / native UI / permission / lifecycle tests | NOT VERIFIED |
| AAOS callbacks and same-run native→server→customer journey | NOT VERIFIED |
| Real vehicle / Kia PV5 compatibility | NOT TESTED; current debug configuration intentionally blocks non-emulator runtime |

JVM tests cover pure safety/freshness logic, not Activity lifecycle, Binder, Android networking, callback delivery or UI rendering. Server tests do not prove Android execution. The final APKs were rebuilt after the unsuccessful installation attempt; no successful final-APK install is claimed. There are no native app screenshots or fabricated runtime captures in this bundle.

## What actually happened

1. Official Pleos Connect v2.1.0 API 34 x86_64 image was downloaded from the official feed. Archive size **4,087,751,964 bytes**, SHA-1 `b4f858d5bcc6c71506d7edfc872bcb9e5a11acaa` matched before extraction. Image binaries were not modified.
2. Host acceleration check returned `KVM requires a CPU that supports vmx or svm`; `/dev/kvm` and CPU virtualization flags were absent. Software-only execution was attempted without changing host security.
3. First substantial boot used 4 GB / 2 cores. It reached authorized ADB, PackageManager and ActivityManager, but storage/mount initialization was incomplete and `sys.boot_completed` was empty. The actual install attempt returned `StorageManager.getVolumes()` null from Android `PackageInstallerService`. See `apk-vehicle-install.log`.
4. At **17:35 UTC** the Android framework watchdog killed `system_server` after the main thread was blocked for 145 seconds in `FontManagerService` / `SystemFonts` / `Font$Builder`. Repeated vendor HAL aborts were also logged. See `framework-watchdog-excerpt.txt`. Guest log time is UTC+09:00; 02:35 on Oct 29 equals 17:35 UTC on Oct 28.
5. A materially different retry began **17:39:35 UTC**: fresh AVD, official `Pleos_Connect_v2_0` device profile (display name v2.1.0), 4 GB, one core, cold/wiped data, 1280×720 display. It reached authorized ADB at roughly six minutes. At roughly 13 minutes, boot completion was still empty, vendor services were repeatedly restarting, and a package-service query did not return. Interrupting that hung ADB call also ended its owning isolated execution session at approximately **17:53 UTC**. The kernel log ends near 818 seconds. **A second watchdog crash was not observed and is not claimed.**
6. No equivalent third boot was started. The available environment lacked the needed acceleration; the confirmed first framework failure and incomplete second attempt did not justify endless identical retries or weakening Android watchdog/security.

The missing acceleration is an observed environment constraint and a plausible contributor to the very slow boot; it is **not a proven exclusive root cause** of every vendor/framework failure. Use the saved logs when validating on a supported machine.

`emulator-*.redacted.log` preserve the boot diagnostics with the local ADB public-key values omitted. Private signing/ADB keys are never included. Separate browser visual QA also could not run: sandbox Chromium failed its process-singleton socket, so the eight native-bound web tests are code/HTTP tests, not screenshot proof.

## Provenance, tools and authority

- Baseline: Library prototype v9, app 0.8.1, 286 Node tests. Earlier native source-preview v0 was materialized and inspected: an uncompiled NaviHelper Activity experiment, not an installed workflow app. Its historical identity is preserved separately.
- New server package: 0.9.0. Native declared version: 0.9.0-prototype, code 10. **Installed version: none verified.**
- Android SDK Platform 35 / Build Tools 35.0.0, JDK 17, Gradle 8.10.2 (wrapper SHA-256 pinned), AGP 8.8.2, Kotlin 2.0.21, emulator 37.2.12.
- Genuine AAOS `android.car` source path: speed/gear property reads+callbacks and OS UX restrictions. No removed proprietary VehicleSpeedListener, door control, FusedLocation or NaviHelper request.
- User explicitly approved the [Android SDK terms](https://developer.android.com/studio/terms) and [Pleos SDK license in its official system-image feed](https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml) on 2026-10-28 before tools/image installation. No additional account/market terms were accepted.
- Local development debug signing and ADB keys were created only in isolated cloud tooling, outside the source ZIP and APK deliverable directory. No production credentials, account login, real-device pairing, publication, external messages or public server deployment.
- SDK/emulator binaries, AVD data, keystores, ADB credentials, local SDK paths and build caches are **excluded** from the source ZIP. APKs contain their normal public signing certificate, not a private signing key.

## Next supported validation step — not yet performed

Use an authorized developer machine with working VM acceleration and the [official Pleos emulator setup](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator). Linux x86_64 needs usable KVM; use the [Android acceleration guide](https://developer.android.com/studio/run/emulator-acceleration) to verify the chosen host, not to weaken this cloud sandbox. Select the Pleos v2.1.0 profile/API 34 image, 4 GB RAM and cold boot. macOS uses the separate official ARM64 image; do not transplant this x86_64 image to an incompatible architecture.

Before installing, require `adb -s emulator-5554 shell getprop sys.boot_completed` to return `1`, and both `service check package` and `service check mount` to report a found service. Confirm the serial and image fingerprint identify only the intended local emulator. Then follow `android/README.md`: start the loopback server, `adb reverse`, install, grant speed permission through the emulator, launch and exercise the documented parked/moving/unknown/restricted/stale/lifecycle/retry cases. Capture the exact APK hash, real AAOS log events and the same runId on native/operator/customer/audit views.

Real-car deployment is a separate gate: authorized compatible hardware/OEM permissions, app-category/market approval, secure production authentication/transport and vehicle lifecycle/UX testing. Merely removing `LOCAL_EMULATOR_ONLY` does not establish support.
