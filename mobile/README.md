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
실기 검증이 더 필요하다. 배포용 아이콘·서명·공증·설치/업데이트 경로가
아직 준비되지 않았으므로 이 빌드를 다른 Mac용 배포본으로 취급하지 않는다.
