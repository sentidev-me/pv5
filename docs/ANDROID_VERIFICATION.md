# Android verification · Mac ARM validation · 2026-10-29/30 UTC

## Verified result

The genuine Vehicle APK **0.9.1-prototype, version code 11** installed and ran on the official Pleos Connect v2.1.0 API 34 ARM emulator on an authorized M3 Max Mac. These are native Activity screenshots and actual AAOS service reads, not a browser mock or DEMO signal controls.

| Check | Executed outcome |
|---|---|
| Official Pleos ARM image | Download size 4,669,762,816 bytes; SHA-1 `24d28eb2f18eba5e87c861a7eb2bdccebb049419` matched current official feed; image revision 2 |
| Hardware acceleration | Hypervisor.Framework available on Apple M3 Max / 36 GB RAM |
| Android runtime | Emulator 37.2.13 ARM64; Pleos API 34; `sys.boot_completed=1`; package and mount services found; hardware `ranchu` |
| Genuine APK | Installed successfully; native Activity launched and requested CAR_SPEED |
| Native AAOS read | Repeated `AAOS_READ speedMps=0.0 gear=P uxRestricted=false` entries from the genuine adapter |
| Actual permission UI | Fresh-install denial locked controls; retry/allow and Activity resume passed one UIAutomator test |
| Actual same-run journey | Parked explicit assignment/accept/depart/arrive/cancel-complete/confirm-complete/resume passed one UIAutomator test |
| Actual server-loss UI | One UIAutomator test passed: stopping only the local server disabled the new command button |
| Server restart | Same assigned test run persisted; before a new observation, `safe:false`, `NO_VEHICLE_STATE`, and no allowed actions |
| Android unit tests | 28 distinct tests per flavor, 56 executions, zero failures/skips |
| Lint | Both flavors: zero errors, one `OldTargetApi` warning each; target SDK 35 intentionally retained |
| Server regressions | 322 tests passed |
| DEMO APK | Builds and passes unit/lint checks; no DEMO runtime substituted for genuine Vehicle evidence |
| Moving/restricted-state injection | NOT VERIFIED: official Virtual Console reports `emulator_inactive`, bridge/DDS not ready; Android car shell help rejected with non-user-build requirement |
| Real car / OEM certification | NOT TESTED; emulator-only runtime gate remains enabled |

## Compatibility correction

The original code-10 APK required a named `android.car` shared library. This official Pleos ARM image has the public `android.car.Car`, `VehicleGear`, `VehiclePropertyIds`, `CarPropertyManager`, and `CarUxRestrictionsManager` classes on its boot class path in `/apex/com.android.car.framework/javalib/android.car-module.jar`; it does not register the named `android.car` shared library. The separately registered `ai.pleos.playground.car` jar contains vendor identifiers, not a replacement implementation of these standard classes.

Version code 11 keeps the required Automotive hardware feature, makes the named shared library optional for loading on images that provide it, and checks actual public class availability before constructing the genuine adapter. Missing classes leave the app locked. No mock adapter, fake sensor state, privileged grant, platform binary modification or relaxed freshness policy was introduced.

## Same-run native, server and customer evidence

Verified completed run: `eb03878f-8f8e-401b-ab87-bb39fed58f89`, source `aaos`.

The native UI explicitly accepted the assignment, started work while parked, confirmed arrival while parked, cancelled completion once, and then confirmed handover completion. These are operator assertions on fictional emulator data, not physical departure, GPS arrival or verified boarding/handover.

The same server run contains `native_accept`, `native_depart`, `native_arrive`, and `native_complete` audit records. Departure and completion records have `networkSent:false` (local simulated notification records). Customer sharing remains `hidden`, telemetry is null, and native location/ETA is not implemented. Activity resume retained the same completed run.

A separate network-loss test used run `d05f9b8a-a522-48dd-bd3d-dca1fef9cfcd`. The UI disabled the assignment command when the local server stopped. After server restart, this run remained assigned but had no current vehicle observation and no allowed actions. No command or completion was invented during the outage. A later cold boot and reinstall of the final APK preserved this same unadvanced run; the explicit genuine UI journey then passed again and completed it. Final-byte run evidence is included separately.

## Actual captures and logs

The source bundle includes selected actual emulator PNG captures under `docs/android-mac-evidence/`, plus sanitized test logs, same-run evidence and a SHA-256 manifest. The full guest display includes the Pleos shell and native app; it contains fictional test labels only. No desktop personal content is captured. Screenshots are not generated illustrations.

The OS permission dialog calls its permission group location information. The app requests `android.car.permission.CAR_SPEED`, `CAR_POWERTRAIN`, and network access; it does not request GPS/location permissions. The denial capture shows the genuine app locked with the speed permission absent.

The first journey test attempt created its fixture but asserted safety before the next asynchronous observation; the test was corrected to await that observation and the same unadvanced fictional assignment passed the rerun. A later replay of the fresh-install permission test after prior grants did not reproduce its initial-dialog precondition and failed; the original successful fresh-install capture and log are retained. This is not reported as another successful permission test. The evidence-copy utility is not counted as a product/runtime test.

## Remaining boundaries

Default stationary AAOS reads and the native/server parked workflow are verified. Changes in speed, gear and OS driving restrictions through the official Virtual Console are not verified. The console's HTTP inputs returned `emulator_inactive` and DDS readiness was false. A read-only `cmd car_service help` attempt was explicitly rejected on this user build. No root, non-user conversion, property injection bypass, security weakening or fake callback was used. Pure safety/freshness tests and backend boundary tests passed, but do not replace missing moving-state runtime proof.

The app is foreground-only. No production credentials, external customer messages, market submission, real-car pairing or Git publication occurred. SDK binaries, AVD contents, debug/ADB keys, runtime SDK jars, caches and machine-specific paths are excluded from the source deliverable.

## Host and terms

MacBook Pro Mac15,10, M3 Max, 36 GB RAM, macOS 26.6.2. Android Studio 2024.1 was retained; JDK 17.0.11 bundled with Studio built the APKs. Official command-line tools 23.0 and official ARM64 Emulator 37.2.13 were installed. The SDK manager initially selected an Intel Emulator 37.2.12 package; it was replaced with the verified official ARM64 package, whose SHA-1 is `6c5e61b873e11c7d1d08683bea089f762baee070`. Existing user AVDs were preserved; only dedicated `PleosFlows_API34_ARM` was created.

The user approved this Mac installation, the official Pleos SDK license (feed license last updated January 2, 2024), and the Android SDK terms before installation. No additional account or market agreement was accepted. Existing unrelated Docker port 3000 was preserved; the test server used loopback port 3001 and the emulator reverse mapping used guest 3000 to host 3001.

The earlier unsuccessful cloud x86_64 validation is preserved separately in [the historical cloud report](ANDROID_CLOUD_VERIFICATION_2026-10-28.md). It is not the final Mac runtime outcome.

Official references: [Pleos emulator setup](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator), [Virtual Console setup](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/use-vehicle-emulator), [Pleos speed-reading FAQ](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/vehicle-app-faq).
