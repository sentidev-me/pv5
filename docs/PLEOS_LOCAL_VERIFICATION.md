# PLEOS 로컬 실기 검증 · 2026-11-15

## 검증한 것
- Mac mini Apple M4, 공식 PLEOS Connect 2.1.0 ARM64 API 34 이미지.
- 공식 기기 프로필 `Pleos_Connect_v2_0`, **2560×1440 / 160dpi / RAM 4GB / Cold Boot**.
- 초기 일반 Automotive 1080×600 프로필에서 화면이 맞지 않았음. 공식 프로필로 새 AVD를 생성해 해결. 기존 일반 AVD는 사용하지 않는다.
- `vehicleDebug` APK: 실제 Android CarPropertyManager 속도·기어와 CarUxRestrictionsManager 경로. `demoDebug`가 아니다.
- JVM 단위시험 28/28, lint, APK 빌드 통과.
- 실제 에뮬레이터 UI: 권한 거부→잠금→허용→AAOS 연결/재개 테스트 통과.
- 실제 에뮬레이터 UI: 가상 업무 배정→사용자 승인→출발→도착→완료 취소→명시 완료→앱 재개 테스트 통과.
- 정차 상태 0.0km/h·P·OS 제한 없음. 화면과 버튼 잘림 없음 확인.

## 정확한 범위
실차 검증이 아니다. 차량 상태는 공식 에뮬레이터의 AAOS API에서 읽지만, 업무/고객/목적지는 가상 로컬 데이터다. 앱의 업무 출발 버튼은 차량 제어가 아니다. 실제 메신저 전송, LLM 호출, 내비 목적지 명령, GPS/ETA SDK 연동은 구현·검증하지 않았다. 새 Agent Studio의 승인 완료 실행을 실제 로컬 배정 API로 차량 앱에 전달하고, 실제 AAOS 안전 관측 및 운전자 승인·완료 상태를 같은 Studio 실행에 연결하는 end-to-end 로컬 브리지를 구현·검증했다. 외부 서비스 입력과 Agent는 여전히 모의다. 서버의 source=aaos 필드는 장치 인증이 아니라 클라이언트 진술이다.

## 실행
Android SDK: `$HOME/Library/Android/sdk`
JDK: `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`
AVD: `PleosFlows_Official_21`

터미널 1, 프로젝트 폴더:
```sh
PORT=3100 PLEOSFLOWS_NATIVE_EMULATOR=1 MOBFLOW_DATA_DIR=./native-verification-data node server.mjs
```
터미널 2:
```sh
export ANDROID_HOME=$HOME/Library/Android/sdk
$ANDROID_HOME/emulator/emulator -avd PleosFlows_Official_21 -no-snapshot -no-boot-anim -no-audio -memory 4096
```
터미널 3, 프로젝트 폴더:
```sh
ADB=$HOME/Library/Android/sdk/platform-tools/adb
$ADB reverse tcp:3000 tcp:3100
$ADB install -r android/app/build/outputs/apk/vehicle/debug/app-vehicle-debug.apk
$ADB shell am start -n ai.pleosflows.vehicle/.MainActivity
```
- Studio: http://127.0.0.1:3100/agent-studio.html
- SDK 관측: http://127.0.0.1:3100/sdk-proof.html (진행 중 업무를 읽는다. 완료된 업무는 `?runId=...`로 지정)
- 새로운 가상 업무: 차량 앱 `에뮬레이터 데모 업무 만들기`.
- PLEOS 화면은 2560×1440이므로 창을 축소해 보는 것은 정상. AVD 자체 해상도를 임의로 낮추지 않는다.

## 실기 테스트 재현
Gradle connected 테스트는 앱 설치/권한을 초기화한다. 권한 테스트를 먼저 실행하고 같은 설치에서 Journey를 실행해야 한다. 테스트 코드의 한글 OS 권한 UI는 현재 PLEOS 한국어 이미지에 맞춰져 있다.
```sh
ADB=$HOME/Library/Android/sdk/platform-tools/adb
$ADB install -r android/app/build/outputs/apk/androidTest/vehicle/debug/app-vehicle-debug-androidTest.apk
# 최초 설치에서만 NativeRuntimeSmokeTest (처음 권한이 없어야 한다)
$ADB shell am instrument -w -r -e class ai.pleosflows.vehicle.NativeRuntimeSmokeTest ai.pleosflows.vehicle.test/androidx.test.runner.AndroidJUnitRunner
$ADB shell am instrument -w -r -e class ai.pleosflows.vehicle.NativeJourneyTest ai.pleosflows.vehicle.test/androidx.test.runner.AndroidJUnitRunner
```

원본 오프라인 MacBook 작업을 덮어쓰지 않은 별도 복구/검증 프로젝트다. 공식 SDK 이미지, JDK, 설치 캐시, 비밀정보는 이 소스 배포물에 포함하지 않는다.

## Studio → PLEOS 실제 로컬 왕복
1. Studio에서 구성 저장·활성화 → 모의 이벤트 실행 → 문안 검토 승인.
2. ‘PLEOS 에뮬레이터에 업무 배정’을 누른다. 승인 전/이전 버전은 서버에서 차단한다.
3. 차량 앱이 배정을 읽고 AAOS 속도·기어·UX 제한을 서버로 관측한다.
4. 앱에서 배정 확인 → 출발 전 업무 시작 → 정차 후 도착 확인 → 인계 확인 후 완료. 각 단계 운전자 확인이 필수다.
5. Studio에 같은 platformRunId→vehicle runId의 상태가 되돌아온다. 완료 후 상태 관측은 종료되므로 STALE_VEHICLE_STATE는 마지막 관측의 유효기간 종료이며 실패한 완료가 아니다.

검증: HTTP 회귀시험325건 통과, NativeStudioBridgeTest 실제 PLEOS 실기1/1 통과. 승인 필수·동일 Studio 실행 중복 배정 방지·기존 활성 차량 업무 충돌 차단·서버 재시작 복원 확인. 외부 발송0건. 기존 bounded 업무 상태기계를 사용하며, 임의 그래프/LLM/내비 연동은 아니다.
