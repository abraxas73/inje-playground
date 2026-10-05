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
- 코드는 저장소 루트 `mobile/`(frontend와 같은 레벨). Flutter 3.44 stable, Android 8+/iOS 15+, 번들 ID `com.innogrid.playground`, 딥링크 `innogrid://login-callback`. 의존성은 pubspec의 14개(flutter SDK 제외) + dev `flutter_launcher_icons`(아이콘 생성 전용, 2026-10-04 배포 스펙)뿐(crypto는 아마란스 요청 서명용, flutter_secure_storage는 아마란스 자동 로그인 아이디·비밀번호 Keychain 저장용 — 2026-10-04 스펙으로 추가, speech_to_text·flutter_tts는 이노봇 말하기·읽어 주기 — 2026-10-05 비서 스펙 추가 절) — 추가는 스펙 변경으로.
- 하이브리드: 로그인·탭·뭐 먹지·사다리·커피 타임은 네이티브, 나머지는 WebView(`lib/web/`). 네이티브 API 호출은 `lib/api/client.dart`만 통해서(Bearer, 401 갱신 재시도 1회). WebView 뒤로 가기: Android는 가로챈 첫 내비게이션(`/login`)을 히스토리에 남기므로 `canGoBack()`만 믿지 말고, 뒤로 간 직후 `onPageStarted`가 세션 시작점(`isSessionBoundary`)이면 화면을 닫는다(`goBack`은 `onNavigationRequest`를 안 거친다).
- 서버: `/api/*`는 `Authorization: Bearer`도 받는다(`createServerSupabase`·미들웨어 분기). `POST /api/mobile/login`(로그인 기록·역할·권한), `POST /api/mobile/web-token`(WebView용 일회용 magiclink 토큰), `/auth/mobile`(토큰 → 쿠키 세션 → next). WebView는 앱 세션을 복사하지 않는다(리프레시 회전 충돌).
- 토큰·세션 값은 로그·감사 detail·문서에 남기지 않는다. 감사 카테고리 `mobile`.
- 디자인: 토큰은 `lib/app/theme.dart`의 `Brand`, 공용 위젯은 `lib/app/brand.dart`(BrandHeader·BrandLogo·SquareIconButton·InitialBadge·PrimaryCta·GridBackdrop) — 새 화면은 이걸 쓰고 색을 직접 박지 않는다. 로고는 `assets/brand/*.png`(원본 frontend/public/logo.svg, 재생성 방법은 런북 §디자인). 시안: Claude Design 캔버스 "이노그리드 앱 디자인". AnimationController 등 Ticker는 `late final` 지연 생성 금지(initState에서 생성).
- 하단 바(`lib/app/tab_shell.dart`): 홈(`/home`, 웰컴 — 인사·오늘의 한 줄·바로 가기·사내 서비스) · 그룹 일상/AI/업무(웹 2단 메뉴의 1단, `catalog.dart`의 `pageGroups`·`visibleGroups` — 볼 페이지가 없는 그룹은 숨김) · 더보기(계정·관리). 그룹을 누르면 하위 메뉴가 바 위로 **부채꼴**(`fan_layout.dart` 순수 함수 — 경첩은 누른 탭, 잇는 선 없음, 반지름 96·간격 56·이웃 34° 이내·바 위 60px, 가장자리 탭은 안쪽으로 기움, 간격 미달이면 반지름 +140까지)로 펼쳐진다 — 항목마다 60ms 시간차(`FanMenu.interval`), 접힘은 reverse 역순. 네이티브 화면(뭐 먹지 1·사다리 2·커피 타임 3)은 셸 브랜치(`nativeBranch`), 나머지는 `/web`. 라우트 브랜치는 그대로 5개(home·food·ladder·team·more). 격언은 `lib/features/home/quotes.dart`(출처 확실한 것만), 공휴일은 `greeting.dart`의 양력 고정 목록.
- 아마란스 연동: `lib/gw/`(스펙 2026-10-04). GW 호출은 `GwClient.call/callForm`만 지나고, 토큰·세션 값·메일 제목은 로그·메시지에 찍지 않는다. 쓰기는 출퇴근 기록(확인 다이얼로그·중복 가드·read-back) + 비서 확인 카드를 거친 작업뿐, 메일 본문(`mail002A01`)은 비서가 사용자 요청으로 읽을 때만(같은 요청의 목록·검색 muid, 5통). 서버 값은 `asStr/asBool/asInt`로만 읽고 메일함 seq는 상수 금지. 엔드포인트 출처 inno-creed(github.com/zilhak/inno-creed `docs/api-reference.md`). 하단 바 그룹 "아마란스"는 `catalog.dart` `appPages`(웹 카탈로그와 분리). 자동 로그인 비밀번호는 `flutter_secure_storage`에만(shared_preferences 금지), 로그인 페이지 JS는 `gw_login_js.dart`에 모은다. 게시판 `ViewPost`는 조회수를 올리므로 사용자가 글을 눌렀을 때만 부른다(목록 프리뷰로 미리 보이지 않게 자동 호출 금지).
- 배포(스펙 2026-10-04-mobile-release): 버전 출처는 `pubspec.yaml` `version: X.Y.Z+N` 하나 — 코드는 `Config.appVersion/appBuild`(`--dart-define`, 기본 `dev`/0 = 업데이트 확인 안 함). 릴리스는 `mobile/scripts/release-mobile.sh`로만(스토리지·`settings.mobile_release` 수동 편집 금지). Google Play 내부 테스트는 `release-mobile.sh android|all`이 AAB를 빌드해 내부 테스트 트랙에 자동 출시(`play-upload.py`, 서비스 계정 키 `PLAY_SERVICE_ACCOUNT_JSON` — 없으면 Android 릴리스를 시작하지 않음, 재시도 `release-mobile.sh play`). 앱 서명 키는 Google 생성 키이고 `/apps`·SharePoint도 Play가 만든 Google 서명 universal APK를 배포해 서명을 통일한다(로컬 키 APK 배포 금지, `docs/play-console-guide.md` §6-B). `settings.mobile_release`는 플랫폼별 블록(`android`/`ios`) JSON, 읽기는 `GET /api/mobile/release`(user 이상, APK 600초 서명 URL). 웹 `/apps`는 카탈로그에 있지만 앱 Dart 카탈로그 `pages`에는 넣지 않는다. 아이콘은 이노봇 캐릭터 + 바탕 `#6268FF`(SECloudit BI "iT" 색, `Brand.botViolet`과 같음, 2026-10-05) — 앱 안 이노봇 버튼도 같은 바탕. `key.properties`·`*.jks`·`.env.release`는 gitignore, 비밀은 로그·문서에 남기지 않는다.
- 홈 브리핑(스펙 2026-10-04-mobile-briefing): 순수 로직은 `lib/briefing/briefing_model.dart`에만(위젯·네트워크 금지), 수집은 소스별 try/catch로 독립. Claude에는 `summaryPayload`(제목·이름·시각, 목록 ≤8, 문자열 ≤120)만 보내고 본문은 절대 넣지 않는다. 서버 `POST /api/mobile/briefing`은 payload를 저장·로그하지 않고 감사엔 건수만. 설정 `mobile_briefing_llm`(빈 값/`on`/`off`). Teams 멘션은 `GET /api/teams/mentions`(본문 전달만, 저장 금지).
- 비서 이노봇(스펙 2026-10-05-mobile-assistant): 도구 등급은 앱 `assistant_tools.dart`와 서버 `lib/assistant/tools.ts`가 같은 29개 이름을 고정(양쪽 테스트). 쓰기는 앱 확인 카드 없이 실행하지 않고, 카드는 모델이 쓴 라벨이 아니라 조회한 실제 대상으로 만든다. 서버는 무상태 중계(대화·인자·결과 저장·로그 금지, 감사엔 도구 이름만). Claude 호출은 `between_tools`·4096·비스트리밍. (`offer_choices` 등급 choice — 선택지 [실행]이 확인, 선택지 안 호출도 같은 해석으로 실제 대상 확인). 음성은 `assistant_voice.dart` 인터페이스로만, 자동 TTS 금지(🔊를 누를 때만).
