# PleosFlows · Agent Workflow × PLEOS

외부 서비스의 모의 이벤트를 검토·승인한 뒤 PLEOS 에뮬레이터 차량 앱의 실제 로컬 업무로 연결하는 프로토타입입니다. PV5 전용 제품이 아닙니다. 공식 현대/Kia/PLEOS 제품·인증·파트너십을 의미하지 않습니다.

## 2026-11-15 검증된 제출 범위
- 웹 Studio: 모의 Calendar/Slack 입력 → 규칙 기반 Agent 문안 → 담당자 승인 → 실제 로컬 차량 배정.
- 공식 PLEOS Connect 2.1.0 / API34 ARM64 / **2560×1440,160dpi,RAM4GB,Cold Boot**, Mac mini M4.
- 앱: 실제 AAOS 속도·기어·UX 제한 읽기 → 운전자 명시 승인·완료 → 같은 실행 상태를 Studio에 회신.
- 외부 Calendar·Slack API, 실제 LLM, 내비 목적지 명령, GPS/ETA 및 실차 연동은 미구현/미검증. 외부 메시지는 전송하지 않음.
- HTTP 회귀325건, Android JVM28건, lint 통과. 공식 에뮬레이터의 Studio 왕복 실기 테스트 통과.
- 비디버그 별도 서명 release APK 설치·AAOS 연결·배정·출발·도착·명시 완료 UI 실행 검증 완료. production 인증이 없는 loopback 에뮬레이터 전용 프로토타입이며 실차에서 실행하지 않음.

## 실행과 APK
- Node: `PORT=3100 PLEOSFLOWS_NATIVE_EMULATOR=1 MOBFLOW_DATA_DIR=./data node server.mjs`
- 웹: `http://127.0.0.1:3100/agent-studio.html`
- `adb reverse tcp:3000 tcp:3100` 후 `adb install apk/PleosFlows_PleosFlows_release.apk`
- release package: `ai.pleosflows.vehicle.contest`
- 실행: `adb shell am start -n ai.pleosflows.vehicle.contest/ai.pleosflows.vehicle.MainActivity`
- SDK 및 에뮬레이터는 공식 배포처에서 별도 설치. 이미지·서명키·계정 비밀정보는 이 저장소에 포함하지 않음.
- 자세한 설정/검증/제약: [로컬 검증](docs/PLEOS_LOCAL_VERIFICATION.md)

## 공모전용 vehicleRelease APK (2026-11-15)

`android/app/build/outputs/apk/vehicle/release/app-vehicle-release.apk`는 별도의 로컬 공모전 서명키로 서명한 **비디버그 release 빌드**입니다. 버전 `0.9.1-prototype` / versionCode `11`, 패키지 `ai.pleosflows.vehicle.contest`, minSDK 28 / targetSDK 35입니다. 이 빌드는 여전히 **로컬 에뮬레이터 전용 프로토타입**이며, release라는 이름이 실차 배포 인증이나 외부 서비스 연동 완료를 뜻하지 않습니다.

- 빌드·lint·release 단위시험 28건 통과.
- APK Signature Scheme v2 및 zipalign 검사 통과.
- 독립 contest 키 사용. Android debug 키를 사용하지 않았습니다.
- 키 파일, 비밀번호, SDK 시스템 이미지 및 설치 캐시는 소스/제출 ZIP에 포함하지 않습니다.
- 실제 release APK 설치·권한 허용·AAOS 신호 읽기 및 배정 확인→출발→도착→완료 UI 검증도 통과했습니다.

서명된 release 재빌드(기존 로컬 서명 속성 파일을 지정):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export PLEOS_SIGNING_PROPERTIES=/path/outside/source/contest.properties
cd android
./gradlew :app:assembleVehicleRelease :app:testVehicleReleaseUnitTest :app:lintVehicleRelease
```

서명 속성 파일은 `storeFile`, `storePassword`, `keyAlias`, `keyPassword`를 포함하는 Java properties 파일입니다. 실제 값은 저장소에 커밋하지 마세요. `PLEOS_SIGNING_PROPERTIES`가 없으면 release 출력은 서명되지 않으므로 설치용 APK로 제출하면 안 됩니다.

기존 debug 앱(`ai.pleosflows.vehicle`)의 데이터를 보존하기 위해 release에는 `.contest` 패키지 접미사를 적용했습니다. 시험용 release 패키지는 `ai.pleosflows.vehicle.contest`이며 두 앱을 함께 설치할 수 있습니다. 동일 차량의 관측 세션이 충돌하지 않도록 실제 시험은 한 앱씩 순서대로 실행하세요. release 실행 컴포넌트는 `ai.pleosflows.vehicle.contest/ai.pleosflows.vehicle.MainActivity`입니다.

공식 시험 환경: PLEOS Connect **2.1.0 ARM64 API 34**, 공식 `Pleos_Connect_v2_0` 프로필 **2560×1440 /160dpi /4GB RAM /Cold Boot**. 로컬 서버 및 `adb reverse tcp:3000 tcp:3100` 연결 방법은 `docs/PLEOS_LOCAL_VERIFICATION.md`를 따릅니다.
