---
paths:
  - "mobile/**"
  - "frontend/src/app/api/mobile/**"
  - "frontend/src/app/auth/mobile/**"
  - "frontend/src/lib/mobile/**"
  - "frontend/src/lib/__tests__/mobile-*"
  - "docs/mobile-app.md"
---

# 모바일 앱(Flutter)

- 스펙 `docs/superpowers/specs/2026-10-03-mobile-app-design.md`, 계획 `docs/superpowers/plans/2026-10-03-mobile-app.md`, 런북 `docs/mobile-app.md`.
- 코드는 저장소 루트 `mobile/`(frontend와 같은 레벨). Flutter 3.44 stable, Android 8+/iOS 15+, 번들 ID `com.innogrid.playground`, 딥링크 `innogrid://login-callback`. 의존성은 pubspec의 11개 + dev `flutter_launcher_icons`(아이콘 생성 전용, 2026-10-04 배포 스펙)뿐(crypto는 아마란스 요청 서명용, flutter_secure_storage는 아마란스 자동 로그인 아이디·비밀번호 Keychain 저장용 — 2026-10-04 스펙으로 추가) — 추가는 스펙 변경으로.
- 하이브리드: 로그인·탭·뭐 먹지·사다리·커피 타임은 네이티브, 나머지는 WebView(`lib/web/`). 네이티브 API 호출은 `lib/api/client.dart`만 통해서(Bearer, 401 갱신 재시도 1회).
- 서버: `/api/*`는 `Authorization: Bearer`도 받는다(`createServerSupabase`·미들웨어 분기). `POST /api/mobile/login`(로그인 기록·역할·권한), `POST /api/mobile/web-token`(WebView용 일회용 magiclink 토큰), `/auth/mobile`(토큰 → 쿠키 세션 → next). WebView는 앱 세션을 복사하지 않는다(리프레시 회전 충돌).
- 토큰·세션 값은 로그·감사 detail·문서에 남기지 않는다. 감사 카테고리 `mobile`.
- 디자인: 토큰은 `lib/app/theme.dart`의 `Brand`, 공용 위젯은 `lib/app/brand.dart`(BrandHeader·BrandLogo·SquareIconButton·InitialBadge·PrimaryCta·GridBackdrop) — 새 화면은 이걸 쓰고 색을 직접 박지 않는다. 로고는 `assets/brand/*.png`(원본 frontend/public/logo.svg, 재생성 방법은 런북 §디자인). 시안: Claude Design 캔버스 "이노그리드 앱 디자인". AnimationController 등 Ticker는 `late final` 지연 생성 금지(initState에서 생성).
- 하단 바(`lib/app/tab_shell.dart`): 홈(`/home`, 웰컴 — 인사·오늘의 한 줄·바로 가기·사내 서비스) · 그룹 일상/AI/업무(웹 2단 메뉴의 1단, `catalog.dart`의 `pageGroups`·`visibleGroups` — 볼 페이지가 없는 그룹은 숨김) · 더보기(계정·관리). 그룹을 누르면 하위 메뉴가 바 위로 **부채꼴**(`fan_layout.dart` 순수 함수 — 경첩은 누른 탭, 잇는 선 없음, 반지름 96·간격 56·이웃 34° 이내·바 위 60px, 가장자리 탭은 안쪽으로 기움, 간격 미달이면 반지름 +140까지)로 펼쳐진다 — 항목마다 60ms 시간차(`FanMenu.interval`), 접힘은 reverse 역순. 네이티브 화면(뭐 먹지 1·사다리 2·커피 타임 3)은 셸 브랜치(`nativeBranch`), 나머지는 `/web`. 라우트 브랜치는 그대로 5개(home·food·ladder·team·more). 격언은 `lib/features/home/quotes.dart`(출처 확실한 것만), 공휴일은 `greeting.dart`의 양력 고정 목록.
- 아마란스 연동: `lib/gw/`(스펙 2026-10-04). GW 호출은 `GwClient.call/callForm`만 지나고, 토큰·세션 값·메일 제목은 로그·메시지에 찍지 않는다. 쓰기는 출퇴근 기록뿐(확인 다이얼로그·중복 가드·read-back), 메일 본문(`mail002A01`) 호출 금지. 서버 값은 `asStr/asBool/asInt`로만 읽고 메일함 seq는 상수 금지. 엔드포인트 출처 inno-creed(github.com/zilhak/inno-creed `docs/api-reference.md`). 하단 바 그룹 "아마란스"는 `catalog.dart` `appPages`(웹 카탈로그와 분리). 자동 로그인 비밀번호는 `flutter_secure_storage`에만(shared_preferences 금지), 로그인 페이지 JS는 `gw_login_js.dart`에 모은다. 게시판 `ViewPost`는 조회수를 올리므로 사용자가 글을 눌렀을 때만 부른다(목록 프리뷰로 미리 보이지 않게 자동 호출 금지).
- 배포(스펙 2026-10-04-mobile-release): 버전 출처는 `pubspec.yaml` `version: X.Y.Z+N` 하나 — 코드는 `Config.appVersion/appBuild`(`--dart-define`, 기본 `dev`/0 = 업데이트 확인 안 함). 릴리스는 `mobile/scripts/release-mobile.sh`로만(스토리지·`settings.mobile_release` 수동 편집 금지). `settings.mobile_release`는 플랫폼별 블록(`android`/`ios`) JSON, 읽기는 `GET /api/mobile/release`(user 이상, APK 600초 서명 URL). 웹 `/apps`는 카탈로그에 있지만 앱 Dart 카탈로그 `pages`에는 넣지 않는다. 아이콘은 CI 가이드 색(`#006cdb`)·모티프 — `Brand` 팔레트와 별개. `key.properties`·`*.jks`·`.env.release`는 gitignore, 비밀은 로그·문서에 남기지 않는다.
- 홈 브리핑(스펙 2026-10-04-mobile-briefing): 순수 로직은 `lib/briefing/briefing_model.dart`에만(위젯·네트워크 금지), 수집은 소스별 try/catch로 독립. Claude에는 `summaryPayload`(제목·이름·시각, 목록 ≤8, 문자열 ≤120)만 보내고 본문은 절대 넣지 않는다. 서버 `POST /api/mobile/briefing`은 payload를 저장·로그하지 않고 감사엔 건수만. 설정 `mobile_briefing_llm`(빈 값/`on`/`off`). Teams 멘션은 `GET /api/teams/mentions`(본문 전달만, 저장 금지).
