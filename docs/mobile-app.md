# 모바일 앱(Flutter) 런북

## 구성
- `mobile/` Flutter 앱(Android·iOS). 운영 서버 `https://inje-playground.vercel.app`를 그대로 쓴다(`--dart-define=API_BASE=` 로 교체).
- 로그인: Supabase Microsoft OAuth → `innogrid://login-callback`(Supabase uri_allow_list에 등록, 2026-10-03). Azure 앱 등록은 변경 없음.
- 네이티브 화면은 `/api/*`를 Bearer로 호출. WebView는 `POST /api/mobile/web-token` → `/auth/mobile?next=…#token=…`으로 자기 세션을 만든다.

## 디자인
시안은 Claude Design 캔버스 "이노그리드 앱 디자인"(https://claude.ai/artifact/DHctJG13TJTaZpeo4CbZsS — 비공개, 소유자만 열람). 방향은 "네이비 위의 이노그리드 블루": 웹 CI 블루(#0441FF)는 그대로, 로그인·요약 카드는 딥 네이비(#0B1A3A), 화면 바탕 #F4F6FB에 흰 카드(16px)·알약형 버튼·칩·탭. 토큰은 `mobile/lib/app/theme.dart`의 `Brand`, 공용 위젯(`BrandHeader` 머리·`BrandLogo`·`SquareIconButton`·`InitialBadge`·`PrimaryCta`·`GridBackdrop`)은 `lib/app/brand.dart` — 새 화면은 이걸 쓰고 색을 직접 박지 않는다. 로고 PNG(`assets/brand/logo_dark.png`·`logo_white.png`, 1320×177 투명)는 `frontend/public/logo.svg`를 Quick Look(`qlmanage -t -s 1328 -o <dir> logo.svg`)으로 뜬 뒤 밝기→알파로 바꿔 만든 것(flutter_svg 의존성은 안 넣음) — 로고가 바뀌면 같은 방법으로 다시 만든다. 글꼴은 OS 기본 고딕(iOS Apple SD Gothic Neo·Android Noto Sans CJK).

로그인 없이 화면을 확인하려면: 위젯 테스트에서 `apiClientProvider`를 MockClient로, `authClientProvider`를 FakeAuth로 바꿔 화면을 띄우고 `FontLoader`로 `/System/Library/Fonts/Supplemental/AppleGothic.ttf`를 심은 뒤(`appTheme(fontFamily:)`) `matchesGoldenFile` + `flutter test --update-goldens`로 PNG를 뜬다(2026-10-03 시안 반영 때 사용, 테스트 파일은 커밋하지 않음). 테스트 글꼴이 없는 아이콘·일부 라벨은 네모로 나오는 게 정상.

홈(웰컴) 탭(2026-10-03): 로그인 직후 첫 화면은 `/home`. 시간대·날짜 인사는 `mobile/lib/features/home/greeting.dart`(`greetingFor` 순수 함수 — 공휴일은 양력 고정 8개만, 설·추석은 제외), "오늘의 한 줄"은 `quotes.dart`의 격언 40개를 날짜(연중 일수)로 골라 같은 날은 모두 같은 글(Teams 08:00 격언은 `claude -p` 생성이라 공유하지 않음 — 공유하려면 저장소가 필요). 이름은 `/api/mobile/login`의 `name`(user_profiles.display_name → Azure full_name). 바로 가기 3개(네이티브 탭) + 사내 서비스 카드(`lib/more/service_grid.dart`, 더보기에서 옮김 — 더보기는 프로필·관리자·계정·로그아웃만). 웹 카탈로그(`lib/page-access.ts`)에 페이지가 늘면 `lib/more/catalog.dart`와 `service_grid.dart`의 아이콘·설명도 같이 늘린다(2026-10-03 Teams 채팅 `teams_chat` 추가).

하단 바 2단 메뉴(2026-10-04, 사용자 요청 "웹처럼 2단 메뉴로, 그룹을 누르면 하위 메뉴가 부채꼴로"): `mobile/lib/app/tab_shell.dart`. 바는 홈 · 일상 · AI · 업무 · 더보기(그룹은 웹 `PAGE_GROUPS`와 같은 id, 라벨만 짧게 — `lib/more/catalog.dart`의 `pageGroups`, 볼 수 있는 페이지가 없는 그룹은 웹처럼 숨긴다). 그룹을 누르면 본문 위에 네이비 스크림이 깔리고 하위 메뉴가 누른 탭(경첩)에서 부채꼴로 펼쳐진다(흰 원 46px 아이콘 + 라벨 10px 최대 2줄, 보고 있는 네이티브 화면은 블루 테두리; 탭과 항목을 잇는 살 선은 2026-10-04 사용자 요청으로 뺐다). 애니메이션은 셸의 AnimationController 하나로, 항목 i는 `Interval(i·60ms, +220ms, easeOutBack)` 구간에서만 움직여 왼쪽부터 하나씩 스르륵 펼쳐지고(5개 460ms), 접힘은 같은 컨트롤러 reverse(0.7배)라 마지막 항목부터 역순으로 접힌다 — 접히는 동안 항목 탭은 무시, 다른 그룹을 누르면 바로 그 그룹을 펼친다(`orCancel`). 좌표는 `lib/app/fan_layout.dart`의 순수 함수 — 기본 반지름 96, 이웃 각도 최대 34°(항목이 적으면 좁은 부채), 90° 중심, 항목 중심은 바에서 60px 이상 위, 가장자리 탭은 항목이 화면 밖으로 안 나가게 안쪽으로 기운 부채가 되고, 이웃 간격(56px)이 안 나오면 반지름을 10씩 키운다(+140 상한 — 390px 폭에서 일상 4개·AI 3개는 96, 업무 5개는 126; 그룹에 항목이 더 늘면 두 줄 반지름 등으로 손봐야 한다). "너무 퍼지지 않게, 간격 좁게"가 사용자 요구라 숫자를 키울 때는 확인하고 바꾼다. 항목을 고르면 네이티브(뭐 먹지·사다리·커피 타임)는 탭 브랜치로, 나머지는 WebView로 열고 접힌다. 같은 그룹 다시 누름·바깥 터치·Android 뒤로가기로 접힌다. 라우트 브랜치는 그대로 5개(home·food·ladder·team·more)라 `/food` 등 딥링크·`context.go`는 그대로 동작한다. 테스트 `test/app/fan_layout_test.dart`(기하)·`test/app/tab_shell_test.dart`(펼침·이동·숨김). 로그인 없이 모양을 보려면 런북 §디자인의 골든 PNG 방법.

## 아마란스(그룹웨어) 연동 (2026-10-04)

설계 `docs/superpowers/specs/2026-10-04-amaranth-app-integration-design.md`, 계획 `docs/superpowers/plans/2026-10-04-amaranth-app-integration.md`. 사용자가 더보기 → 계정 → "아마란스"(또는 홈 카드 "연결하기", 하단 바 그룹 아마란스의 아무 항목)에서 WebView로 gw.innogrid.com에 로그인하면 `document.cookie`의 `oAuthToken`·`signKey`(없으면 `BIZCUBE_AT`/`HK`)를 읽어 `gw050A02`로 검증(이름·이메일·근태 코드 확보)하고 기기(shared_preferences, Supabase 세션과 같은 저장소)에 저장한다. 그 뒤 앱이 **직접** GW API를 부른다 — 서버 미경유, MCP(inno-creed) 불필요. 코드 `mobile/lib/gw/`: 서명 `gw_sign.dart`(골든 테스트 값은 inno-creed `sign.rs`에서), 관문 `gw_client.dart`(`call`/`callForm`만, 401 → `needsRelogin`, 세션 10분 캐시), 기능 `gw_api.dart`(결재·근태·일정·회의실·메일, 캘린더 10분·회의실 30분·INBOX seq 캐시)·정제 `gw_models.dart`, 입구 `gw_gate.dart`(미연결/재연결 안내), 화면 `approvals_screen` `attendance_screen` `today_screen` `mail_screen`, 홈 카드 `gw_today_card.dart`, 연결 `gw_connect_screen.dart`. 하단 바에 웹에 없는 앱 전용 그룹 "아마란스"가 추가돼 6칸(`catalog.dart`의 `appPages` — 사내 서비스 카드에는 섞이지 않는다). 엔드포인트·필드·함정의 출처는 https://github.com/zilhak/inno-creed (`docs/api-reference.md`). 쓰기는 출퇴근 기록 하나(확인 다이얼로그 → 기록 전 가드 → 기록 호출이 실패해도 read-back으로 판정). 메일 본문(`mail002A01`)은 열지 않는다(서버가 읽음 처리). '오늘'은 기기 시간대가 아니라 KST(`kstNow()`). 만료(401) 뒤에는 `gwClientProvider`가 null이라 요청이 나가지 않는다. 토큰 만료 주기는 미측정(세션 쿠키, 최소 며칠). 리뷰(2026-10-04, 별도 리뷰어) 7건 반영: 병렬 401 ref 해제, 기록 실패 시 read-back 생략, KST, 연결 화면 dispose 뒤 setState, 깨진 쿠키 디코딩, 메일 화면 ParallelWaitError 노출, 만료 토큰 재요청.

**연결 화면(2026-10-04 2차)**: 로그인 페이지의 `<meta viewport>`가 `width=1280` 고정이라 폰에서 작게 보여 페이지 로드마다 `viewportFixJs`로 `device-width`를 끼운다(페이지는 390px에서도 안 깨지는 유동 레이아웃 — Playwright 실측). 쿠키 감지는 `onPageFinished`만으로는 SPA 라우팅을 못 잡아 `onUrlChange` + 1초 폴링으로 하고, 잡히는 즉시 검증·저장 후 **자동으로 닫는다**(아마란스 메인은 보여 주지 않음). **자동 로그인**: 더보기 → 아마란스 시트에서 아이디·비밀번호를 저장하면(iOS Keychain · Android Keystore, `flutter_secure_storage`, 키 `gw.loginId`/`gw.loginPw`) 연결 화면이 WebView를 가린 채 `#reqLoginId` → "다음" → `#reqLoginPw` → "로그인"을 React 네이티브 setter + input 이벤트로 채운다(`gw_login_js.dart`, 판단은 순수 함수 `decideFill`). 오류 문구·OTP(인증수단 선택, `input.number`) 화면·저장 정보 없음이면 WebView를 드러내 사람이 잇는다("직접 로그인" 버튼도 있음). 로그인 DOM이 바뀌면 `probeJs`/`fillJs`의 선택자부터 본다.

**게시판·날짜 이동(2026-10-04 3차)**: `board_screen.dart` — 전 게시판 공지·새 글 집계(`ViewBoardNewAndNoticeArtList`, noticeYn Y, 20건씩 더 보기, 통합검색 searchTotal) → 본문·댓글(`ViewPost`, ⚠️ 조회수 증가 — 글을 눌렀을 때만). 첨부는 개수만(내려받기는 아마란스에서). 홈에 "공지사항" 카드(`gw_notices_card.dart`, 최신 3건, 누르면 `/gw/board?art=`로 바로 본문). 일정·회의실 화면(`today_screen.dart`)은 ‹ › 날짜 이동·날짜 선택·"오늘" 버튼(두 구역이 같은 날짜). 부채꼴 그룹 아마란스는 미결 결재·출퇴근·일정·메일·게시판 5항목.

| 증상 | 확인 | 조치 |
|---|---|---|
| 게시판 목록이 비거나 특정 게시판만 안 보임 | 이 API는 전 게시판 **공지·새 글 집계**라 게시판별 필터(`searchBoard`)가 무시된다(inno-creed 실측) | 게시판별 목록은 `ViewBoardArtList`의 "게시판 코드"가 필요해 미구현 — 라이브 캡처 뒤 추가 |
| 자동 로그인이 "직접 로그인하세요"로 빠짐 | 배너의 아마란스 오류 문구(비밀번호 불일치 등) 또는 OTP 화면 | 비밀번호를 시트에서 다시 저장. OTP가 켜진 계정은 자동 로그인이 거기까지만 된다 |
| 자동 로그인이 멈춰 있음(패널만 돌고 있음) | 로그인 페이지 선택자 변경(`#reqLoginId`/`#reqLoginPw`/`button[type=submit]` 텍스트 "다음"·"로그인") | "직접 로그인"으로 전환해 연결하고, 선택자를 `gw_login_js.dart`에서 갱신 |
| 연결 화면에서 로그인했는데 연결이 안 됨 | 쿠키 이름이 `oAuthToken`/`signKey`(또는 `BIZCUBE_AT`/`HK`)인지, HttpOnly로 바뀌지 않았는지(PC Chrome DevTools → Application → Cookies) | 오른쪽 위 "쿠키 지우고 로그인"으로 재시도. 이름이 바뀌었으면 `parseGwCookies` 수정 |
| 모든 화면이 "다시 연결" | 토큰 만료(HTTP 401, resultCode 140/112). 만료 주기는 아직 미측정 | 다시 연결. 자주 나면 만료 주기를 기록해 선제 안내 검토 |
| 특정 화면만 오류(resultCode≠0 메시지) | 서버 `resultMsg`가 그대로 보인다 — 엔드포인트·필드가 바뀌었을 수 있음 | inno-creed 최신 소스와 비교 후 `gw_api.dart` 수정 |
| "그룹웨어에 연결할 수 없습니다 (XxxException)" | 네트워크·타임아웃(15초). 괄호 안은 원인 종류 | 사내망/VPN 확인. 테스트에서 나오면 `http.Response(String)`이 한글을 latin1로 인코딩하는 함정 — `Response.bytes(utf8)` 사용 |
| 출퇴근 "반영이 확인되지 않았습니다" | read-back(`getTodayComeLeaveInfo`)에 comeTm/leaveTm 없음 | 아마란스에서 직접 확인 — 응답 successCount는 믿지 않는다 |

앱 WebView 안의 웹 페이지(2026-10-03): 루트 레이아웃(`frontend/src/app/layout.tsx`)이 요청 UA로 앱을 판별해(`isInnogridAppUA`) 웹 헤더·하단 탭을 그리지 않고(`Navigation chromeless` — 접근 권한 검사는 그대로) `<body data-app="1">`을 단다. 앱 전용 스타일이 필요하면 `[data-app]` 선택자. 표는 좁은 화면에서 열을 짜부라뜨리지 말고 `min-w` + 가로 스크롤(내 덱 표가 글자 단위로 깨진 사례).

## 사내망이 필요한 기능 안내
- 사내망(VPN)이 필요한 사용자 기능은 **Dooray에서 가져오기**(멤버 소스 `dooray` 모드일 때 사다리·팀 페이지 버튼)뿐이다 — 브라우저가 Dooray API를 직접 호출하며 Innogrid Chrome 확장(CORS)도 필요하다.
- 앱 WebView(User-Agent `InnogridApp/…`)에서는 `DoorayImportButton`이 직접 호출을 건너뛰고 저장된 명단(`dooray_members` 캐시)만 쓰며 "사내 VPN이 연결된 PC 웹에서 가져오세요"를 안내한다(`lib/mobile/app-ua.ts`). 설정의 내 팀 카드도 같은 안내를 보인다.
- 네이티브 사다리·커피 타임은 내 팀이 비어 있으면 안내 카드(설정에서 구성 → WebView `/settings`, Dooray는 PC 웹)를 보인다. 운영 멤버 소스는 `users`(앱 사용자 명단)라 평소엔 Dooray 버튼이 보이지 않는다.
- GitLab 집계·조직도 동기화는 운영자 Mac의 로컬 작업이라 앱과 무관하다(런북 `docs/launchd-jobs.md`).

## 서버 쪽 확인
- `login_history`에 앱 로그인이 남는다(user_agent `InnogridApp/…`). Audit 로그 → 로그인 성공으로 집계.
- 감사 `모바일 웹 세션 발급`(category mobile) — 토큰은 기록하지 않는다.

## 문제 해결
| 증상 | 원인 | 조치 |
|---|---|---|
| 로그인 후 앱으로 안 돌아옴 | 딥링크 미등록 | Supabase 인증 설정 `uri_allow_list`에 `innogrid://login-callback`, Android intent-filter·iOS CFBundleURLTypes 확인 |
| 네이티브 화면 401 반복 | 토큰 만료·갱신 실패 | 앱이 로그인 화면으로 보낸다. 재로그인 |
| WebView가 로그인 페이지로 튕김 | 웹 토큰 발급 실패(guest·서비스 키) | `/api/mobile/web-token` 응답 확인. guest는 WebView를 열 수 없다 |
| iOS 빌드 `Target Integrity … IPHONEOS_DEPLOYMENT_TARGET is set to 13.0, but … 15.0 to 27.0.x` | 플러그인 Pod이 iOS 11~14를 선언, Xcode 27은 15.0+만 허용 | `ios/Podfile` post_install이 모든 Pod을 15.0으로 올린다(2026-10-03 반영). 그래도 나오면 `flutter clean` 후 다시 실행 |
| iOS 빌드 `Flutter.framework/Flutter does not contain architectures "arm64 x86_64"` (lipo -info는 둘 다 보여 줌) | Xcode 27 `lipo -verify_arch`가 아키텍처 2개를 받지 못함(Flutter 3.44 도구 결함) | 시뮬레이터는 **기기를 지정해** `flutter run -d <시뮬레이터 UDID>`로 실행(ARCHS 하나만 넘어감). 일반 `flutter build ios --simulator`는 두 아키텍처라 실패한다. Flutter 업그레이드로 해결될 수 있음 |
| 앱 안 WebView에 "세션 토큰이 없습니다. 앱에서 다시 열어 주세요." — 나갔다 다시 들어가면 됨 | `/auth/mobile`이 `useSearchParams`를 effect 의존성으로 썼는데, Next가 `history.replaceState`(조각 제거)를 가로채 라우터를 갱신하며 새 searchParams 객체를 주어 effect가 다시 돌고 "토큰 없음"으로 덮어씀. verifyOtp는 뒤에서 성공해 쿠키가 생겼기 때문에 재진입은 됐다 | 2026-10-03 수정: `window.location`에서 직접 읽고 1회만 실행, 토큰이 없으면 오류 대신 next로 보냄(쿠키 있으면 열리고 없으면 /login → 앱 재부트스트랩). 앱 새로고침 버튼은 `/auth/mobile`에서 재부트스트랩. 테스트 `mobile-auth-page.test.tsx` |
| WebView를 열면 "페이지를 불러오지 못했습니다"가 잠깐 떴다가 정상 표시 | /login 리디렉션을 가로채(`NavigationDecision.prevent`) 부트스트랩 URL을 다시 로드할 때 WKWebView가 취소된 내비게이션을 오류로 보고(NSURLErrorCancelled -999·Frame load interrupted 102) | 2026-10-04 수정: `isIgnorableWebError`로 거르고, 나머지 오류도 700ms 안에 새 로드(`onPageStarted`)가 시작되면 버린다(`_loadSeq`). 머리 제목은 제목 전까지 "로딩 중…" |
| 로그아웃 → 다시 로그인하면 탭 화면이 `element._lifecycleState == _ElementLifecycle.inactive` 빨간 화면 | 사다리 화면의 AnimationController가 `late final` 지연 생성이라, 사다리를 안 만들고 화면이 정리될 때(로그아웃) dispose에서 처음 생성되며 "Looking up a deactivated widget's ancestor is unsafe" 예외 → 트리 정리가 중단되어 다음 셸 생성 때 GlobalKey 충돌(추정) | initState에서 생성하도록 수정(2026-10-03, 테스트 `test/ladder/ladder_screen_test.dart`). 재발하면 터미널에서 **가장 먼저** 찍힌 `EXCEPTION CAUGHT BY WIDGETS LIBRARY` 블록을 본다 — 빨간 화면의 단언은 결과이지 원인이 아니다 |
| iOS에서 Microsoft 로그인 뒤 `login.microsoftonline.com` 시트(마지막 "로그인 상태를 유지하시겠습니까?")가 안 닫히고 앱을 덮음 — 로그에는 `handle deeplink uri`가 찍힘 | supabase_flutter는 딥링크로 세션만 복구하고 인앱 Safari 시트(SFSafariViewController)는 닫지 않는다 | 앱이 `signedIn` 때 `closeInAppWebView()`로 시트를 닫는다(`lib/auth/session.dart`, 2026-10-03 반영). 그래도 남으면 X로 닫으면 이미 로그인된 상태 |
| `release-mobile.sh`가 "작업 트리가 깨끗하지 않습니다"로 멈춤 | 릴리스는 커밋된 상태에서 재현 가능해야 한다 | 커밋하거나 `--allow-dirty` |
| `release-mobile.sh android`가 "이미 있습니다"로 멈춤 | 같은 `+N` 빌드의 APK가 버킷에 있고 설정도 그걸 가리킴 | pubspec의 `+N`을 올린다(앱은 이 숫자로 새 버전을 판단). APK만 있고 설정이 안 가리키면(지난 실행이 설정 쓰기에서 실패) 스크립트가 빌드·업로드를 건너뛰고 설정만 다시 쓴다 |
| `release-mobile.sh` 업로드가 "업로드 실패 (HTTP 413…)" 또는 오래 멈춤 | APK가 프로젝트 전역 파일 상한을 넘음(초기 50MB) | Supabase 대시보드 Storage 설정 또는 Management API로 `fileSizeLimit`을 올린다(2026-10-04 200MB). 10MB 조각으로 업로드 속도를 먼저 확인 |
| Android에서 APK 설치 시 "앱이 설치되지 않았습니다" / 서명 불일치 | 기존 설치와 서명 키가 다름(디버그 빌드 위에 릴리스, 또는 키스토어 분실) | 기존 앱 삭제 후 설치. 키스토어는 1Password 백업본을 `mobile/android/`에 복원 |

## 배포(사내) (2026-10-04)
**운영자가 직접 할 일(App Store Connect·백업·공지)만 모은 체크리스트: `docs/mobile-release-checklist.md`.** 스펙 `docs/superpowers/specs/2026-10-04-mobile-release-design.md`. iOS는 **TestFlight 외부 그룹 공개 링크**(개인 Apple 계정, 팀 `LME2TNRC9G`), Android는 **웹 `/apps`에서 APK 직접 받기**(로그인 필요, 비공개 버킷 `mobile`의 600초 서명 URL). 릴리스 메타데이터는 `settings` 키 `mobile_release`(문자열 JSON: `notes`·`testflightUrl`·`android{version,build,apkPath,releasedAt}`·`ios{version,build,releasedAt}`) 하나, 읽는 API는 `GET /api/mobile/release`(user 이상). 앱은 시작 때 이 API로 자기 플랫폼 빌드 번호를 비교해 홈 배너·더보기 "앱 버전" 줄에 업데이트 버튼을 보여 준다(개발 빌드 `dev`/0은 확인 안 함). 쓰는 쪽은 `mobile/scripts/release-mobile.sh`뿐.

### 최초 1회 준비
1. **Android 키스토어**: `mobile/android/upload-keystore.jks` + `key.properties`(둘 다 gitignore). 2026-10-04 생성(별칭 `upload`, RSA 2048, 10000일). **두 파일을 1Password에 백업** — 잃으면 서명이 바뀌어 전 직원이 앱을 지우고 다시 설치해야 한다. 새 Mac에서는 두 파일을 같은 자리에 복원하면 된다(없으면 디버그 키로 빌드돼 기존 설치 위에 업데이트가 안 된다). `key.properties` 형식(4줄): `storePassword=…` `keyPassword=…` `keyAlias=upload` `storeFile=../upload-keystore.jks`(`android/app` 기준 경로).
2. **App Store Connect**: 번들 ID `com.innogrid.playground` 등록 → 앱 "이노그리드" 생성 → TestFlight 테스트 정보(연락처, **심사용 로그인 계정** — 앱이 Microsoft 로그인만 받으므로 테넌트에 심사용 계정 1개를 IT에 요청하거나 심사 노트에 사내 전용임을 적는다) → 외부 테스터 그룹 "이노그리드 구성원" 생성 → **공개 링크 켜기** → 그 링크를 첫 iOS 릴리스 때 `--testflight-url`로 넘긴다.
3. **App Store Connect API 키**: Users and Access → Integrations → App Store Connect API에서 키(역할 App Manager) 발급, `.p8`을 `~/.private_keys/AuthKey_<KEY_ID>.p8`에 두고 `mobile/.env.release`(gitignore)에 `ASC_KEY_ID=…`, `ASC_ISSUER_ID=…`.
4. Supabase 버킷 `mobile`은 `docs/sql/2026-10-04-mobile-release.sql`로 만들었다(2026-10-04 적용).
5. **SharePoint 사본 폴더**(사용자 요청 2026-10-04 "빌드된 APK는 SharePoint에 올리자, 버전 번호 붙여서"): SharePoint에서 APK를 둘 폴더의 링크를 복사해 `mobile/scripts/release-mobile.sh sharepoint-folder <링크>`로 한 번 저장한다(settings `mobile_sharepoint_folder`). 이후 `android`/`all` 릴리스 끝에 서버(`POST /api/mobile/release/sharepoint`, `CRON_SECRET` + `mobile/.env.release`의 `OPERATOR_EMAIL` — 그 관리자의 Microsoft 연결로 올림)가 스토리지의 APK를 읽어 **`innogrid-app-<major.minor.patch>.apk`** 로 올린다(같은 버전은 덮어씀, SharePoint 버전 이력 보존). 실패해도 릴리스는 끝나며 `release-mobile.sh sharepoint`로 다시 올린다. 링크는 `mobile_release.android.sharepointUrl`에 남는다(웹 `/apps`에는 안 보여 줌 — 배포 경로는 여전히 `/apps`의 APK 받기). 프로젝트 **전역** 파일 상한(Storage 설정 `fileSizeLimit`)이 50MB라 59MB APK가 거부돼 Management API(`PATCH /v1/projects/<ref>/config/storage {"fileSizeLimit":209715200}`)로 200MB로 올렸다 — 버킷 상한은 전역 상한을 넘을 수 없다.

### 매 릴리스
1. `mobile/pubspec.yaml`의 `version: X.Y.Z+N`을 올린다(빌드 번호 `+N`은 항상 증가 — 앱은 이 숫자로 새 버전을 판단한다). 커밋.
2. `mobile/scripts/release-mobile.sh all --notes "변경 요약"`. TestFlight 공개 링크는 심사 승인 뒤에 생기므로 빌드와 따로 `release-mobile.sh link --testflight-url <공개 링크>`로 저장한다(이후 릴리스에는 다시 줄 필요 없음). `android`/`ios`만도 된다. `--dry-run`으로 단계만 볼 수 있다. 스크립트가 `flutter test`·`analyze`를 먼저 돌리고, 같은 빌드 번호의 APK가 이미 있으면 멈춘다.
3. iOS: App Store Connect → TestFlight에서 빌드 처리(≈10분) 후 외부 그룹에 추가(첫 빌드는 Beta App Review, 보통 하루 안팎). 이후 빌드는 그룹에 추가만 하면 된다. 스크립트가 업로드 직후 `mobile_release.ios`를 쓰므로 **그룹에 추가하기 전까지 iOS 앱 배너가 먼저 뜰 수 있다** — TestFlight가 자동 갱신하므로 무해하고, 늦추고 싶으면 `ios`는 그룹 추가 직후 돌린다.
4. Android는 끝에 SharePoint 사본(`innogrid-app-X.Y.Z.apk`)이 자동으로 올라간다 — 출력의 "링크:" 줄이 그 주소다. 실패 문구가 보이면 `release-mobile.sh sharepoint`.
5. Teams 공지: 스크립트가 마지막에 문구 예시를 출력한다. 설치·업데이트 안내는 항상 `https://inje-playground.vercel.app/apps`.

### 운영 주의
- TestFlight 빌드는 **90일 만료** — 분기마다 한 번은 빌드 번호를 올려 다시 올린다(만료되면 앱이 열리지 않는다).
- Android는 자동 업데이트가 없다. 앱 배너의 "업데이트"가 브라우저로 APK를 받고 알림에서 설치한다. 회사 MDM이 사이드로딩을 막으면 Google Play 비공개 트랙으로 가야 한다(비범위). 유니버설 APK 한 장(≈59MB).
- 아이콘은 이노그리드 CI 가이드(`https://www.innogrid.com/download/ci/Innogrid_CI_Guide.pdf`, 전용색 Background `#006cdb`, 그래픽 모티프 CONNECTION)로 만들었다. 원본 `assets/brand/app_icon.png`·`app_icon_fg.png`(1024, Flutter 골든 렌더 — 재생성 코드는 계획 문서 `docs/superpowers/plans/2026-10-04-mobile-release.md` Task 5 Step 4의 일회용 테스트, 저장소에는 없음). 바뀌면 `dart run flutter_launcher_icons` — 이 도구가 `ios/Runner.xcodeproj/project.pbxproj`의 `ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS`를 `AppIcon`으로 잘못 바꾸므로 `git checkout -- mobile/ios/Runner.xcodeproj/project.pbxproj`로 되돌린다.
- 릴리스 APK 서명 확인은 `apksigner verify --print-certs`(Android SDK build-tools). `keytool -printcert -jarfile`은 v2/v3 서명만 있는 APK에서 아무것도 안 보여 준다.
- `altool`은 Xcode `ContentDelivery.framework`에 있다(`xcrun altool --version`). 없으면 Transporter 앱(`/Applications/Transporter.app`)으로 IPA를 수동 업로드하고 `settings.mobile_release.ios`는 스크립트 `ios --dry-run` 출력을 참고해 손으로 갱신한다.

## 개발기 설치
### Android
```bash
cd mobile && flutter build apk --debug     # build/app/outputs/flutter-apk/app-debug.apk
adb install -r build/app/outputs/flutter-apk/app-debug.apk   # 또는 APK 파일 전달 → 알 수 없는 출처 허용 후 설치
```
### iOS(본인 기기, Personal Team)
1. `open mobile/ios/Runner.xcworkspace` → Runner 타깃 → Signing & Capabilities → Team: 본인 Apple ID(Personal Team). Bundle Identifier `com.innogrid.playground`가 Personal Team에서 충돌하면 `com.innogrid.playground.dev`로 바꿔 서명.
2. 기기 연결 → `flutter run -d <기기>` 또는 Xcode ▶. 처음엔 기기 설정 → 일반 → VPN 및 기기 관리에서 개발자 앱 신뢰.
3. Personal Team 서명은 7일마다 만료 — 재실행하면 갱신. 구성원 배포는 §배포(TestFlight)로 한다.
### iOS 시뮬레이터
`open -a Simulator` → `flutter devices`로 UDID 확인 → `flutter run -d <UDID>`. 첫 빌드는 pod install 포함 1분 안팎(2026-10-03 실측 36초). 2026-10-03 iPhone 17 Pro 시뮬레이터에서 로그인 화면까지 확인. 시뮬레이터는 기본 위치가 없어 '현재 위치'가 10초 뒤 시간 초과로 끝난다 — Simulator 메뉴 **Features → Location → Custom Location…**(예: 37.4021, 127.1077 판교) 또는 Apple을 고르거나, 앱에서 '주소 변경'으로 지정.
### 서버 주소 바꾸기
`flutter run --dart-define=API_BASE=http://<Mac IP>:3003`(로컬 프론트, 같은 Wi-Fi). Supabase 리디렉션은 운영과 같아 로그인은 그대로 된다.

## 실기기 체크리스트
- [ ] Microsoft 로그인 → 앱 복귀 → 탭 표시, `login_history`에 `InnogridApp/…` 1건
- [ ] 뭐 먹지: 현재 위치 → 검색 → 즐겨찾기 ↔ 웹 `/food` 동기화 → 카카오맵 열림 → 오늘 뭐 먹지 결정
- [ ] 사다리: 생성 → 한 명 추적 → 전체 공개 → 저장 → 웹 이력
- [ ] 커피 타임: 나누기 → 저장 → 알리기 → 이력 출석 토글 → 웹 반영
- [ ] 더보기 → PPT 만들기(WebView) → 처음 1회 `/auth/mobile` 거쳐 열림 → 다른 항목은 바로 열림 → 다운로드는 시스템 브라우저
- [ ] 로그아웃 → 로그인 화면, 다시 WebView 열면 세션 부트스트랩부터
- [ ] guest 계정: 안내 화면만, WebView 토큰 403
- [ ] 1시간 이상 지난 뒤 콜드 스타트 → 스플래시 → 자동 갱신 → 탭 표시(로그인 화면 아님); 이어서 로그아웃 → 재로그인하면 바로 탭으로
- [ ] iOS WebView: 세션 만료를 재현(앱 데이터 삭제 후 WebView 열기 등)했을 때 두 번째 `/login` 튕김에서 오류 화면 + "다시 시도"로 멈추는지(무한 반복 금지)
- [ ] 사다리·커피 타임 설정 화면에 내 팀 칩이 보이고, 커피 타임은 전원 기본 참석·서버 법카 표시가 반영되는지
