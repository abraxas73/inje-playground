# 이노그리드 모바일 앱 (Flutter)

플레이그라운드(https://inje-playground.vercel.app)의 Android·iOS 클라이언트. 설계 `../docs/superpowers/specs/2026-10-03-mobile-app-design.md`, 런북 `../docs/mobile-app.md`.

- `flutter pub get && flutter run` · `flutter test` · `flutter analyze`
- 네이티브: 로그인·뭐 먹지·사다리·커피 타임·더보기. 그 외 기능은 WebView(`lib/web/`).
- API는 `lib/api/client.dart`(Bearer)만 통해서. 서버 주소 `--dart-define=API_BASE=`.

## macOS 개발 빌드

현재 데스크탑 개발은 macOS를 우선한다. `macos/` Runner의 최소 대상은
macOS 12이며, Flutter 3.44 / Xcode 27에서 디버그 빌드를 확인했다.

```sh
flutter pub get --enforce-lockfile
flutter run -d macos
flutter build macos --debug
```

실행 파일은 `build/macos/Build/Products/Debug/INNOGRID.app`이다.
기존 서버와 같은 로그인·API를 사용한다. `innogrid://login-callback`은
app_links/Supabase가 처리하며 Flutter 기본 딥링크 라우팅은 비활성화했다.
macOS 자동 로그인 정보는 앱 간 공유하지 않는 로컬 Keychain에 저장한다.

서비스 카드는 화면 폭에 따라 열 수를 늘리며 높이를 폭에 비례해 늘리지 않는다.
웹 화면에는 ⌘R(새로고침), ⌘[(뒤로 가기) 단축키를 등록했다.
모바일 릴리스 API의 TestFlight/Google Play 업데이트 안내는 macOS에서 표시하지 않는다.

확인한 항목: 디버그 빌드, 재시작 후 로그인 세션 유지, 홈 데이터 조회,
Jira 웹뷰 목록 열기와 홈 복귀. 단축키의 웹뷰 포커스별 동작, Microsoft/Jira
재연결 왕복, 아마란스 로그인, 파일 업로드/다운로드, 마이크·위치 권한은
실기 검증이 더 필요하다. 디버그 빌드는 다른 Mac용 배포본으로 취급하지 않는다. DMG 직접 배포는
아래 스크립트의 서명·공증·검증을 모두 통과한 산출물만 사용한다.
자동 업데이트 및 전체 기능의 인수 검증은 별도 작업이다.

macOS 웹뷰 파일 선택창은 플러그인의 공개 native API로 WKWebView를 가져와
NSOpenPanel을 연결한다. 기존 WKUIDelegate 콜백은 프록시가 전달한다.
RFP 화면에서 선택창 열기·취소 복귀를 확인했다. 실제 서버 업로드 완료는 별도 검증 대상이다.
브라우저 열기는 현재 경로를 유지하고 동일 오리진에 한해 일회용 웹 세션을 생성한다.
인증이 필요한 `/file`, `/xlsx` 다운로드도 이 경로를 사용한다.

## macOS DMG 직접 배포

```sh
python3 scripts/release-macos.py
```

로컬 Keychain의 `Developer ID Application` 인증서와 기존 `.env.release`의
ASC 키 설정을 사용한다. 비밀 키는 저장소에 포함하지 않는다. 스크립트는
Release 빌드 → 내부 바이너리와 앱 서명 → 앱 공증/티켓 첨부 → Gatekeeper 검사
→ DMG 생성/서명 → DMG 공증/티켓 첨부 → 무결성 검사를 수행한다.
공증이 Accepted가 아니면 중단하며, 서버 업로드나 외부 테스트 심사 제출은 하지 않는다.
결과는 `build/macos/distribution/INNOGRID-macOS-<version>.dmg`과 SHA-256 파일이다.

`./scripts/build-macos-preview.sh --preview`는 공증 전 로컬 QA용으로만 사용한다.
Xcode 27의 다중 `lipo -verify_arch` 오류는 Flutter assembly 단계에만 적용하는
`scripts/macos-toolchain/lipo`로 우회한다. 요청한 아키텍처 각각을 원래 lipo로
검증하며, 하나라도 없으면 빌드가 실패한다. 시스템 도구나 Flutter SDK는 수정하지 않는다.

### Windows 내부 테스트 설치 파일

Windows 10 1809 이상 / Windows 11 x64를 대상으로 한다. macOS에서 크로스 빌드하지 않고 `.github/workflows/windows-app.yml`의 Windows runner에서 빌드한다. 수동 빌드는 Flutter 3.44.0, Visual Studio 2022 C++ desktop workload, NuGet, Inno Setup 6 설치 후 `pwsh -File scripts/build-windows.ps1`로 실행한다.

산출물: `build/windows/distribution/INNOGRID-Windows-<version>-Setup.exe`와 SHA-256. 설치 프로그램은 사용자별 설치 및 `innogrid://` 로그인 콜백 주소를 등록한다. WebView2 Runtime이 필요하며, 미설치 시 앱 웹 화면에 설치 안내가 표시된다. 현재 Windows 설치 파일은 코드 서명 전 내부 테스트용이다.

Windows 웹 화면은 WebView2, macOS/iOS/Android는 기존 WebView 엔진을 사용한다. Windows 웹 프로필은 앱 실행·로그아웃마다 분리해 이전 사용자의 웹 인증 데이터를 재사용하지 않는다. 로그인을 포함한 실제 Windows 실행 검증은 별도 환경에서 진행한다. 확인 항목: 최초 설치/업데이트/삭제, Microsoft 로그인 앱 복귀(앱 실행 중/종료 중), Jira 재연결, 아마란스 연결·로그아웃·다른 사용자 전환, RFP 파일 선택·다운로드, Teams 입력, 마이크·위치 권한 및 실패 처리.

### TODO: Windows 코드 서명 (보류)

2026-10-09: Windows 동작은 사용자 확인 완료. 최초 설치 경고 개선을 위한 회사 명의 코드 서명은 후속 TODO로 보류한다. 관리자 준비사항, 인증·CI 설정, 서명 검증·재배포 체크리스트는 [Windows 코드 서명 TODO](../docs/windows-signing.md)에 정리했다. 현재 배포본은 서명 전 내부 테스트 빌드이며, 자동 서명 코드는 검증 전 초안이다.

### 웹 다운로드 게시

웹의 `/manual#desktop-install` → `/apps#desktop`에서 배포 파일을 제공한다. 사내 사용자 권한 확인 후 private `desktop-releases` 버킷의 5분 서명 링크를 발급한다. 파일 검증 해시도 다운로드 페이지에 표시한다.

`frontend` 디렉터리에서 `node --env-file=.env.local scripts/publish-desktop.mjs macos 1.4.5 /absolute/path/INNOGRID-macOS-1.4.5.dmg`를 실행한다. Windows는 첫 인자를 `windows`, 파일을 Setup.exe로 바꾼다. 게시 스크립트는 업로드 후 다시 다운로드해 SHA-256을 비교한 다음 배포 메타데이터를 갱신한다. 서명 키와 서비스 키는 배포 산출물·저장소에 포함하지 않는다.
