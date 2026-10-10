# 모바일 앱(Flutter) 런북

## 구성
- `mobile/` Flutter 앱(Android·iOS). 운영 서버 `https://inje-playground.vercel.app`를 그대로 쓴다(`--dart-define=API_BASE=` 로 교체).
- 로그인: Supabase Microsoft OAuth → `innogrid://login-callback`(Supabase uri_allow_list에 등록, 2026-10-03). Azure 앱 등록은 변경 없음.
- 네이티브 화면은 `/api/*`를 Bearer로 호출. WebView는 `POST /api/mobile/web-token` → `/auth/mobile?next=…#token=…`으로 자기 세션을 만든다.

## 디자인
시안은 Claude Design 캔버스 "이노그리드 앱 디자인"(https://claude.ai/artifact/DHctJG13TJTaZpeo4CbZsS — 비공개, 소유자만 열람). 방향은 "네이비 위의 이노그리드 블루": 웹 CI 블루(#0441FF)는 그대로, 로그인·요약 카드는 딥 네이비(#0B1A3A), 화면 바탕 #F4F6FB에 흰 카드(16px)·알약형 버튼·칩·탭. 토큰은 `mobile/lib/app/theme.dart`의 `Brand`, 공용 위젯(`BrandHeader` 머리·`BrandLogo`·`SquareIconButton`·`InitialBadge`·`PrimaryCta`·`GridBackdrop`)은 `lib/app/brand.dart` — 새 화면은 이걸 쓰고 색을 직접 박지 않는다. 로고 PNG(`assets/brand/logo_dark.png`·`logo_white.png`, 1320×177 투명)는 `frontend/public/logo.svg`를 Quick Look(`qlmanage -t -s 1328 -o <dir> logo.svg`)으로 뜬 뒤 밝기→알파로 바꿔 만든 것(flutter_svg 의존성은 안 넣음) — 로고가 바뀌면 같은 방법으로 다시 만든다. 글꼴은 OS 기본 고딕(iOS Apple SD Gothic Neo·Android Noto Sans CJK).

로그인 없이 화면을 확인하려면: 위젯 테스트에서 `apiClientProvider`를 MockClient로, `authClientProvider`를 FakeAuth로 바꿔 화면을 띄우고 `FontLoader`로 `/System/Library/Fonts/Supplemental/AppleGothic.ttf`를 심은 뒤(`appTheme(fontFamily:)`) `matchesGoldenFile` + `flutter test --update-goldens`로 PNG를 뜬다(2026-10-03 시안 반영 때 사용, 테스트 파일은 커밋하지 않음). 테스트 글꼴이 없는 아이콘·일부 라벨은 네모로 나오는 게 정상.

홈(웰컴) 탭(2026-10-03): 로그인 직후 첫 화면은 `/home`. 시간대·날짜 인사는 `mobile/lib/features/home/greeting.dart`(`greetingFor` 순수 함수 — 공휴일은 양력 고정 8개만, 설·추석은 제외), "오늘의 한 줄"은 `quotes.dart`의 격언 40개를 날짜(연중 일수)로 골라 같은 날은 모두 같은 글(Teams 08:00 격언은 `claude -p` 생성이라 공유하지 않음 — 공유하려면 저장소가 필요). 이름은 `/api/mobile/login`의 `name`(user_profiles.display_name → Azure full_name). 바로 가기 3개(네이티브 탭) + 사내 서비스 카드(`lib/more/service_grid.dart`, 더보기에서 옮김 — 더보기는 프로필·관리자·계정·로그아웃만). 웹 카탈로그(`lib/page-access.ts`)에 페이지가 늘면 `lib/more/catalog.dart`와 `service_grid.dart`의 아이콘·설명도 같이 늘린다(2026-10-03 Teams 채팅 `teams_chat` 추가).

하단 바 2단 메뉴(2026-10-04, 사용자 요청 "웹처럼 2단 메뉴로"; 처음엔 부채꼴이었으나 항목이 8개로 늘자 겹쳐 2026-10-10 바 위 한두 줄 격자로 바꿈 — `lib/app/menu_layout.dart` `rowLayout`: 한 줄 최대 5개·중앙 정렬, 6개부터 두 줄 균등 분배, 아래 줄 원 중심 바 위 72px·줄 간격 90; 아래의 부채꼴·반지름 설명은 역사): `mobile/lib/app/tab_shell.dart`. 바는 홈 · 일상 · AI · 업무 · 더보기(그룹은 웹 `PAGE_GROUPS`와 같은 id, 라벨만 짧게 — `lib/more/catalog.dart`의 `pageGroups`, 볼 수 있는 페이지가 없는 그룹은 웹처럼 숨긴다). 그룹을 누르면 본문 위에 네이비 스크림이 깔리고 하위 메뉴가 누른 탭(경첩)에서 부채꼴로 펼쳐진다(흰 원 46px 아이콘 + 라벨 10px 최대 2줄, 보고 있는 네이티브 화면은 블루 테두리; 탭과 항목을 잇는 살 선은 2026-10-04 사용자 요청으로 뺐다). 애니메이션은 셸의 AnimationController 하나로, 항목 i는 `Interval(i·60ms, +220ms, easeOutBack)` 구간에서만 움직여 왼쪽부터 하나씩 스르륵 펼쳐지고(5개 460ms), 접힘은 같은 컨트롤러 reverse(0.7배)라 마지막 항목부터 역순으로 접힌다 — 접히는 동안 항목 탭은 무시, 다른 그룹을 누르면 바로 그 그룹을 펼친다(`orCancel`). 좌표는 `lib/app/fan_layout.dart`의 순수 함수 — 기본 반지름 96, 이웃 각도 최대 34°(항목이 적으면 좁은 부채), 90° 중심, 항목 중심은 바에서 60px 이상 위, 가장자리 탭은 항목이 화면 밖으로 안 나가게 안쪽으로 기운 부채가 되고, 이웃 간격(56px)이 안 나오면 반지름을 10씩 키운다(+140 상한 — 390px 폭에서 일상 4개·AI 3개는 96, 업무 5개는 126; 그룹에 항목이 더 늘면 두 줄 반지름 등으로 손봐야 한다). "너무 퍼지지 않게, 간격 좁게"가 사용자 요구라 숫자를 키울 때는 확인하고 바꾼다. 항목을 고르면 네이티브(뭐 먹지·사다리·커피 타임)는 탭 브랜치로, 나머지는 WebView로 열고 접힌다. 같은 그룹 다시 누름·바깥 터치·Android 뒤로가기로 접힌다. 라우트 브랜치는 그대로 5개(home·food·ladder·team·more)라 `/food` 등 딥링크·`context.go`는 그대로 동작한다. 테스트 `test/app/fan_layout_test.dart`(기하)·`test/app/tab_shell_test.dart`(펼침·이동·숨김). 로그인 없이 모양을 보려면 런북 §디자인의 골든 PNG 방법.

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
| iOS 업로드는 성공했는데 App Store Connect에 빌드가 안 생기고 메일 `ITMS-90129: The bundle uses a bundle name or display name that is already taken` | 바이너리의 `CFBundleName`/`CFBundleDisplayName`이 App Store의 다른 앱 이름과 겹침. 2026-10-04 실측: Flutter 기본 `CFBundleName=playground`가 원인(표시 이름 `이노그리드`는 무관) | `Info.plist`의 `CFBundleName`을 App Store Connect 앱 이름(`INNOGRID`)으로 맞추고 `+N` 올려 재업로드. 처리 상태는 App Store Connect API `/v1/builds`로 확인할 수 있다(ES256 JWT, `.env.release`의 키) |
| `release-mobile.sh`가 "작업 트리가 깨끗하지 않습니다"로 멈춤 | 릴리스는 커밋된 상태에서 재현 가능해야 한다 | 커밋하거나 `--allow-dirty` |
| `release-mobile.sh android`가 "이미 있습니다"로 멈춤 | 같은 `+N` 빌드의 APK가 버킷에 있고 설정도 그걸 가리킴 | pubspec의 `+N`을 올린다(앱은 이 숫자로 새 버전을 판단). APK만 있고 설정이 안 가리키면(지난 실행이 설정 쓰기에서 실패) 스크립트가 빌드·업로드를 건너뛰고 설정만 다시 쓴다 |
| `release-mobile.sh` 업로드가 "업로드 실패 (HTTP 413…)" 또는 오래 멈춤 | APK가 프로젝트 전역 파일 상한을 넘음(초기 50MB) | Supabase 대시보드 Storage 설정 또는 Management API로 `fileSizeLimit`을 올린다(2026-10-04 200MB). 10MB 조각으로 업로드 속도를 먼저 확인 |
| `release-mobile.sh`가 `flutter test`에서 `No space left on device`(errno 28)로 죽음 | 디스크 가득 참. 2026-10-04 실측: 미사용 시뮬레이터 런타임(`/Library/Developer/CoreSimulator/Volumes`, 런타임당 ≈22GB)·Antigravity 브라우저 녹화(`~/.gemini/*/browser_recordings`)·uv 캐시(`~/.cache/uv`)가 각각 수십 GB | `df -h /System/Volumes/Data`로 확인 → `xcrun simctl runtime list`에서 기기 없는 런타임을 `xcrun simctl runtime delete <UUID>`(현재 시뮬레이터가 쓰는 버전은 남김), `rm -rf mobile/build ~/Library/Developer/Xcode/DerivedData`, `uv cache clean`(Serena MCP가 잠금을 쥐면 `~/.cache/uv/archive-v0`의 실행 중 항목만 빼고 지움). `~/Library/Developer/CoreDevice/DeviceFS`는 시뮬레이터 파일시스템의 가상 마운트라 `du`에 중복 집계될 뿐 실제 용량이 아니다. iOS 빌드엔 최소 10GB 여유 |
| Android에서 APK 설치 시 "앱이 설치되지 않았습니다" / 서명 불일치 | 기존 설치와 서명 키가 다름(디버그 빌드 위에 릴리스, 또는 키스토어 분실) | 기존 앱 삭제 후 설치. 키스토어는 1Password 백업본을 `mobile/android/`에 복원 |
| 홈 "데일리 브리핑" 카드가 안 보임 | 설정 off, 서버 `ANTHROPIC_API_KEY` 없음, 또는 오늘 이미 실패해 조용히 격언 유지 | `/admin/settings` 스위치·Vercel env 확인 → 브리핑 카드의 새로고침 버튼을 누르면 최신 업무 데이터를 수집해 다시 생성. 감사 로그 "모바일 브리핑 생성"이 없으면 서버까지 못 간 것(앱 로그인·네트워크) |
| "데일리 브리핑"(옛 이름 오늘의 한 마디)이 "강승"처럼 중간에 잘림(1.1.2 이전) | Sonnet 5.5는 생각이 기본으로 켜져 있어 `max_tokens` 400을 생각이 먼저 씀 | 서버가 `thinking: {type: "between_tools"}`로 생각을 끄고(이 모델은 `disabled`를 거부), `max_tokens`로 잘리면 502로 버린다. 앱 1.1.3은 캐시 키를 v2로 바꿔 잘린 문장을 한 번 버린다 |
| 팀원 연차가 "오늘 일정"에 내 일정처럼 보임 | 아마란스가 `delYn='Y'`(mine)를 팀원 근태에도 준다 | 제목·캘린더명 키워드로 분류한다(`absenceKind`). 새 표현(예: "휴무")이 보이면 `_absenceWords`에 추가 |
| Android에서 WebView 화면(설정 등)에 들어간 뒤 ←로 못 나감(같은 페이지가 다시 뜨거나 로그인 페이지가 보임) | 첫 로드(`/settings` → 307 `/login`)를 가로채도 Android WebView는 `/login`을 히스토리에 남겨 `canGoBack()`이 true — `goBack()`은 그 유령 항목을 실제로 연다(iOS WKWebView는 안 남김). `goBack`은 `onNavigationRequest`를 거치지 않는다 | `WebScreen`이 뒤로 가기 직후 `onPageStarted`가 `/login`·`/auth/mobile`(`isSessionBoundary`)이면 화면을 닫는다(`BackTracker`, 1.1.1). 재현은 가짜 서버 + `lib/_probe_main.dart`식 프로브(런북 §실기기 체크리스트 참고) |
| 비서가 "아마란스가 연결되어 있지 않습니다" | 앱 아마란스 미연결·만료 | 더보기 > 아마란스에서 연결. Teams 도구만은 동작 |
| 비서 "오늘 비서 사용 한도를 넘었습니다" | `assistant_daily_turns` 상한(감사 로그 "비서 턴" 건수) | 관리자 설정에서 상한 조정 |
| 비서가 사람을 엉뚱하게 초대 | 동명이인 | 카드의 참석자는 조직도 실명(부서)으로 나온다 — 부서를 확인하고 "고쳐 줘" |
| 🎤를 눌러도 "마이크·음성 인식 권한이 필요합니다" | 권한 거부 또는 기기에 음성 인식기 없음 | 휴대폰 설정 > 앱 > 이노그리드 > 마이크(iOS는 음성 인식도) 허용 |
| 🔊 목소리가 기계적 | 기본(압축) 한국어 음성만 설치됨 | 앱이 띄우는 안내대로 유나(향상됨/프리미엄) 또는 Google 고품질 한국어 음성 설치 |
| 🔊를 눌러도 소리가 안 남(재생 아이콘은 잠깐 나왔다 사라짐) | iOS: 1.3.0은 기본 오디오 세션(무음 스위치를 따름, 🎤 뒤 음성 인식이 세션을 끔) — 1.3.1부터 읽을 때마다 재생 카테고리(spokenAudio·duckOthers)로 켬. Android: 한국어 TTS 음성 미설치 | 1.3.1 이상으로 업데이트, 미디어 볼륨 확인. Android는 설정 > 텍스트 음성 변환에서 한국어 음성 설치 |
| 이노봇 버튼이 안 보임 | 관리자가 비서를 꺼 둠(첫 응답 `{enabled:false}` 뒤 그 실행 동안 숨김) | `/admin/settings` 비서 스위치 확인 후 앱 재시작 |

## 홈 브리핑 (2026-10-04)
스펙 `docs/superpowers/specs/2026-10-04-mobile-briefing-design.md`. 홈 탭 = 오늘의 브리핑: 인사말 → 오늘의 한 줄(격언, 그대로) → **데일리 브리핑** 카드(Claude Sonnet 5.5 2~3문장, **앱 시작 시와 매일 한국 시간 07:00**에 생성 — 백그라운드에서 07:00을 넘기면 복귀 때 갱신, 카드의 새로고침 버튼으로 최신 업무 데이터를 수집해 강제 재생성 가능. 일반 당겨서 새로고침·탭 재터치는 같은 브리핑 시간대의 문장을 재사용. 시작 직후엔 오늘 저장된 직전 문장(`briefing.summary.v2`)을 먼저 보여 줌. 실패하면 직전 문장을 유지하고 수동 새로고침 시 오류 안내. 격언 "오늘의 한 줄"은 날짜로 골라 하루 1회만 바뀜) → **지금 필요한 것**(규칙: 90분 안 회의 → 안 읽음·2일 이상 결재 → Teams 답장 대기 → 오늘 안 읽은 메일 → 09:30 이후 출근 미기록 → 새 공지, 최대 4) → 오늘 일정(내일 N건) → **팀원/센터원 부재**(아마란스 조직도 `gw102A02.atNm`의 현재 근태 태그 원문. 팀원·팀장은 소속 부서만, 센터장은 소속 센터와 하위 부서 포함. 기본 목록은 본인·다른 조직 제외. **전체 토글**을 켜면 같은 회사의 모든 부서 부재자를 조회하며 끄면 소속 범위로 복귀. 부재자가 없어도 토글 표시. 전체 전환은 데일리 브리핑 요약 범위에 영향 없음. 매 새로고침에 재조회하며 실패하면 재시도 표시, 캘린더로 대체하지 않음) → 결재 3 → 메일 3 → Teams 3 → 공지 3 → 바로 가기. 코드 `mobile/lib/briefing/`(순수 `briefing_model.dart`, 수집 `briefing_provider.dart`, 요약 `summary_provider.dart`, 위젯 `briefing_sections.dart`).
- 서버: `POST /api/mobile/briefing`(제목 수준 payload ≤16KB → 서버가 다시 자름 → Claude, 감사엔 건수만; settings `mobile_briefing_llm=off` 또는 `ANTHROPIC_API_KEY` 없음이면 `{enabled:false}`), `GET /api/teams/mentions?days=2`(기존 Microsoft 연결, 그룹은 내 이름(Graph displayName·메일 로컬파트·앱 표시 이름) 멘션, 1:1은 전부, 내가 그 뒤에 답했으면 제외). 관리자: `/admin/settings` "모바일 앱 — 홈 브리핑" 스위치. 모델은 env `MOBILE_BRIEFING_MODEL`(기본 `claude-sonnet-5-5`).
- 소스 하나가 실패해도 나머지는 보이고 그 섹션만 "다시 시도". Teams 401/403은 오류가 아니라 미연결(섹션 숨김). 수집은 홈을 열 때·홈 탭 재터치·당겨서 새로고침(`BriefingNotifier.refresh` — 첫 로딩 중이면 이름만 반영하고 중복 수집 없음).

## 출근 Teams 알림 (2026-10-05)
출퇴근 화면의 **출근 기록** 확인창에서 내 Teams 채팅방(그룹·1:1, `GET /api/teams/chat` — 본인 Microsoft 위임 토큰)을 한 번 골라 두면, "Teams에 알리기" 스위치(기억됨)와 **추가 문구(선택)** 입력이 나온다. 출근이 실제로 기록됐을 때만(`PunchResult.ok && !already`) `POST /api/teams/chat/messages`로 "9시 23분 출근했습니다."(정각은 "10시 출근했습니다.") + 추가 문구를 내 이름으로 보낸다. 전송 실패는 기록에 영향 없이 안내 문구만. 설정은 기기 SharedPreferences(`clockin.teams.*`)에만. 코드 `mobile/lib/gw/clockin_notify.dart`. 퇴근은 대상 아님(사용자 결정). 출근 기록 뒤에는 홈 브리핑을 다시 수집하고 데일리 브리핑도 한 번 다시 만든다(출근 안내 문장이 남지 않게).
- 데일리 브리핑 지침: 평일·휴일 아님·출근 기록 없음이면 첫 문장에서 출근 기록을 남기라고 알린다(`briefingSystemPrompt`). 같은 조건(`clockInPending`)이면 브리핑 카드에 "출퇴근 바로 가기" 버튼(앱 안 `/gw/attendance`)이 붙는다.

## 비서 이노봇 (2026-10-05)
스펙 `docs/superpowers/specs/2026-10-05-mobile-assistant-design.md`. 모든 탭 오른쪽 아래 이노봇(길게 눌러 위아래 이동) → 대화 시트. 서버 `POST /api/assistant/turn`은 Claude(Sonnet 5.5, `thinking: between_tools`, 도구 37개) 한 번 호출을 중계만 하고(대화 저장 없음, 감사엔 도구 이름만), 앱 `lib/assistant/assistant_session.dart`가 턴 루프를 돈다. 아마란스 도구는 앱이 `GwClient`로 직접(`gw_assistant_api.dart` — inno-creed 실측 payload), Teams·Confluence·SharePoint 도구는 `POST /api/assistant/execute`(각각 Teams 채팅·Confluence·SharePoint 페이지 권한 필요).
- 등급(`assistant_tools.dart` = 서버 `TOOL_TIERS`): 조회 즉시 · 쓰기 확인 카드 · 메일 발송은 경고 · `undo_last`는 실행 기록(`assistant.journal`, 20건, 24시간 안)에서 반대 작업 카드. **카드 문장은 모델이 쓴 이름이 아니라 앱이 조회한 실제 대상**(참석자 조직도 이름(부서), 회의실 이름, 예약·일정 제목, Teams 채팅방 이름)으로 만들고, 조회되지 않으면 카드 없이 모델에 오류로 돌려준다. 앞 작업이 실패하면 뒤 작업은 실행하지 않는다.
- 메일 본문은 같은 요청의 목록·검색 muid만 5통, 8,000자. 메일 발송이 시간 초과면 "보낸편지함 확인" 안내(자동 재시도 없음). 일정 등록은 `mailSend: N`, 예약 참석자는 본인. 점심 13:00–14:00과 오늘 지난 시각은 빈 회의실에서 뺀다.
- **우리 팀·캘린더**: `my_team`(조직도에서 내 부서 전원, 나 제외)로 "우리팀 전원"을 참석자로, `create_event`의 `calendar_id`(list_calendars의 mcalSeq)로 공유 캘린더(예: 이노그리드)에 등록 — 카드에 "캘린더 <이름>"이 실제 조회 값으로 나오고, 볼 수 없는 캘린더면 카드 없이 오류. 쓰기 권한이 없는 캘린더는 그룹웨어가 거절한다(앞의 예약은 실행된 채 일정만 실패로 안내).
- **선택지**: 대안이 여러 개면(빈 회의실 여러 곳 등) 모델이 `offer_choices`로 최대 4개를 내고, 앱은 선택지마다 실제 대상으로 만든 카드에 [실행]을 단다 — 누른 선택지만 실행. 대안이 하나면 기존 확인 카드, 정보가 모자라면 되묻기.
- **말하기·읽어 주기**: 입력칸 옆 🎤(기기 음성 인식 — 인식이 끝났을 때 "~줘·~주세요·~실행"으로 끝나면 바로 보내고, 아니면 이어서 듣다가 2초 동안 새 말이 없으면 보냄, `isCommandEnd`), 봇 답 끝 🔊(기기 TTS, 누를 때만). 음성은 설치된 한국어 중 가장 좋은 것을 자동 선택(`pickKoreanVoice` — iOS 프리미엄 > 향상 > 기본, Android very high > high, 같으면 오프라인). 기본 음성뿐이면 🔊를 처음 누를 때(앱 실행당 한 번) 설치 안내: iOS 설정 > 손쉬운 사용 > 읽기 및 말하기 > 음성 > 한국어 > 유나(향상됨/프리미엄), Android 텍스트 음성 변환 > Google 엔진 > 음성 데이터 설치 > 한국어. 내려받으면 다음 🔊부터 바로 그 음성(고품질을 찾을 때까지 매번 다시 고름). 서버 TTS(Supertonic 3, 약 400MB ONNX)는 검토 후 보류. 코드 `assistant_voice.dart`(`VoiceInput`·`Speaker` 인터페이스 — 테스트는 Provider로 가짜). 권한 문구는 Info.plist·AndroidManifest.
- 관리자: `/admin/settings` "모바일 앱 — 비서(이노봇)" 스위치·사용자당 하루 턴 상한(기본 200, KST 하루, 설정·건수 조회 오류면 503으로 닫힘). 요청 하나는 보통 3~5턴, 한 번에 최대 10턴. 꺼져 있으면 앱 버튼이 숨는다.

## 더보기 프로필·Microsoft 연결 (2026-10-07)
- 더보기 머리에는 아마란스 조직도 이름 → 앱 계정 이름 순으로 표시한다. 이메일은 아래 줄에 유지한다.
- 아바타는 연결된 Microsoft 계정의 사진을 사용한다(`GET /api/users/profile/photo`, Graph `/me/photos/96x96/$value`). 미연결·사진 없음·조회 실패 시 이름의 첫 글자를 표시한다. 서버는 현재 사용자만 조회하며 사진·토큰을 공유 캐시에 저장하지 않는다.
- 앱 설정의 Microsoft 연결은 외부 브라우저에 일회용 웹 세션을 만든 뒤 시작한다. 인증 시작과 콜백이 같은 브라우저에서 이어지며 성공하면 앱 딥링크로 자동 복귀를 요청한다(iOS의 앱 열기 확인이 표시될 수 있음). 브라우저가 이동을 막으면 완료 화면의 앱으로 돌아가기 버튼을 사용한다. 앱에 돌아오면 연결 상태를 갱신한다. 콜백의 세션 사용자·서명된 state 일치 검사는 유지한다.
- 사용자 설정에서 Dooray 연동·Dooray 본인 인증 카드를 제거했다.

## 배포(사내) (2026-10-04)
- **Google Play 내부 테스트 + 서명 통일(2026-10-06)**: `release-mobile.sh android|all`이 AAB → Play 내부 테스트 자동 출시(`play-upload.py`, 서비스 계정 `PLAY_SERVICE_ACCOUNT_JSON`) → **Play가 Google 앱 서명 키로 만든 universal APK를 받아 `/apps`·SharePoint에 배포**(어느 경로로 깔든 서로 업데이트). 1.3.3 이하 로컬 키 APK 설치자는 1.3.4로 한 번 재설치. flutter 출력은 `mobile/build/release-<버전>.log`로(실패 시에만 끝부분 표시 — flutter_tts의 SwiftPM·KGP 안내 경고는 최신 4.2.5에서도 나오며 무해). 화면별 안내 `docs/play-console-guide.md`.
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
3. iOS: 빌드 처리 완료 후 **내부 테스트만 진행**한다(2026-10-07 운영자 지시). 외부 테스트 심사 제출은 운영자가 명시적으로 요청할 때만 한다. 외부 그룹 추가나 심사 제출을 업로드 후 자동 후속 작업으로 실행하지 않는다.
4. Android는 끝에 SharePoint 사본(`innogrid-app-X.Y.Z.apk`)이 자동으로 올라간다 — 출력의 "링크:" 줄이 그 주소다. 실패 문구가 보이면 `release-mobile.sh sharepoint`.
5. Teams 공지: 스크립트가 마지막에 문구 예시를 출력한다. 설치·업데이트 안내는 항상 `https://inje-playground.vercel.app/apps`.

### 운영 주의
- TestFlight 빌드는 **90일 만료** — 분기마다 한 번은 빌드 번호를 올려 다시 올린다(만료되면 앱이 열리지 않는다).
- Android는 자동 업데이트가 없다. 앱 배너의 "업데이트"가 브라우저로 APK를 받고 알림에서 설치한다. 회사 MDM이 사이드로딩을 막으면 Google Play 비공개 트랙으로 가야 한다(비범위). 유니버설 APK 한 장(≈59MB).
- 아이콘은 이노봇 캐릭터(`assets/brand/innobot.png`, 이노그리드 홍보 페이지)를 바탕 `#6268FF`(SECloudit BI "iT" 바탕색, 앱 안 이노봇 버튼과 같은 `Brand.botViolet`) 위에 올린 것(2026-10-05, 이전 CI `#006cdb` 아이콘 대체). 원본 `assets/brand/app_icon.png`(1024, 불투명, 캐릭터 폭 72%)·`app_icon_fg.png`(1024, 투명, 적응형 안전 영역에 맞춰 폭 50%) — innobot.png를 bbox로 자르고 LANCZOS로 키워 PIL로 합성. 바뀌면 `dart run flutter_launcher_icons` — 이 도구가 `ios/Runner.xcodeproj/project.pbxproj`의 `ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS`를 `AppIcon`으로 잘못 바꾸므로 `git checkout -- mobile/ios/Runner.xcodeproj/project.pbxproj`로 되돌린다.
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

### 데일리 브리핑 자동 갱신

앱 실행 시 생성하고, 앱을 켜 둔 경우 한국 시간 오전 7시에 업무 데이터를 다시 수집하여 브리핑을 갱신한다. 백그라운드에서 이 시점을 넘긴 경우 앱 복귀 때 갱신한다. 운영체제가 앱 실행을 중지한 동안의 정시 백그라운드 실행은 보장하지 않는다. 카드의 새로고침 버튼은 당일 생성 여부와 무관하게 재생성하며, 처리 중에는 중복 입력을 막고 실패하면 직전 문장을 유지하며 재시도를 안내한다.

## Jira Atlassian 로그인 연결 (1.4.1)

설정 → Jira 계정 → ‘Atlassian으로 연결’에서 회사 계정으로 로그인하고 회사 사이트 권한에 동의한다. 개인 API 토큰은 사용하지 않는다. 기존 개인 토큰 연결은 한 번 OAuth로 다시 연결해야 한다. 앱은 외부 브라우저에 일회용 웹 세션을 만든 뒤 인증하고 고정 앱 딥링크로 복귀한다. iOS 앱 열기 확인이 표시될 수 있다.

관리자 최초 설정: Atlassian Developer Console에서 OAuth 2.0 앱(Resource-level)을 등록하고 콜백 `https://inje-playground.vercel.app/api/jira/callback`, Jira 클래식 권한 `read:jira-user`, `read:jira-work`, `write:jira-work` 및 Personal data reporting API의 `report:personal-data`를 추가한다. 회사 직원도 연결할 수 있도록 Distribution Sharing을 활성화한다. Vercel 서버 환경 변수 `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, 선택적 `JIRA_REDIRECT_URI`를 설정한다. 요청은 `offline_access`를 포함하여 회전형 갱신 토큰을 받는다. 암호화 키는 `JIRA_TOKEN_ENC_KEY` 또는 기존 `MS_TOKEN_ENC_KEY`에서 Jira OAuth 전용 키를 파생한다. 시크릿은 사용자 설정 API나 클라이언트에 제공하지 않는다.

허용 사이트는 `https://pms-innogrid.atlassian.net`으로 고정하며 accessible-resources에서 회사 사이트와 동의 범위를 확인하고 회사 이메일을 검증한다. OAuth state는 서명·만료·현재 사용자·HttpOnly 브라우저 쿠키를 확인한다. 액세스·갱신 토큰은 서버 전용 `jira_connections`에 암호화하고 DB 임대 잠금으로 동시 회전을 막는다. 연결 해제·재연결 중 이전 갱신 응답이 연결을 복구하거나 덮어쓰지 못하도록 조건부 갱신한다.

업무 → Jira에서 본인 담당 이슈를 필터·페이지별로 조회하고 상세 설명·댓글을 확인한다. 상태 변경·댓글은 확인 후 본인 권한으로 실행하며 필수 필드가 있는 전환은 원문에서 처리한다. 변경 응답이 끊기면 자동 재시도하지 않는다.

데일리 브리핑 카드 안에서 요약문 아래에 본인 담당 미완료·진행 중 이슈 최대 5개를 업무·상태·상세 링크 표로 표시한다. 업무가 없거나 미연결·조회 실패이면 Jira 부분을 숨긴다. 웹 홈은 기존 별도 카드 위치를 유지하되 표시할 업무가 있을 때만 보인다. 설정·이슈 화면에서 복귀하면 갱신한다. Jira는 AI 요약문에 중복 언급하지 않는다.

개인정보 보고는 `/api/cron/jira-privacy`(CRON_SECRET 전용)에서 6시간마다 최대 90개 대상의 보고 시점을 확인하며, 계정별 기본 7일 또는 Atlassian `Cycle-Period`를 따른다. `closed`·`updated` 응답이면 오래된 연결 정보를 삭제하여 다음 연결에서 재동의하게 한다. 429는 `Retry-After` 이후로 미룬다. 갱신 권한이 철회되면 해당 연결 정보를 삭제한다.

## Confluence 연동 (2026-10-10)

Jira와 **같은 Atlassian 연결·토큰**(`jira_connections`, 같은 사이트 pms-innogrid)을 쓴다. 연결 때 받은 권한은 `jira_connections.scopes`(마이그레이션 `20261010030000_atlassian_connection_scopes.sql`)에 남고, Confluence 기능은 이 목록에 Confluence 권한이 있을 때만 쓴다(없으면 "다시 연결해 권한 추가" 안내). 공용 `ATLASSIAN_*` 계정은 쓰지 않는다(본인에게 보이는 문서만).

관리자 최초 설정(순서 중요): ① Atlassian Developer Console → 같은 OAuth 앱 → Permissions → **Confluence API** 추가 → 클래식 권한 `read:confluence-content.all`, `read:confluence-content.summary`, `read:confluence-space.summary`, `search:confluence`, `write:confluence-content` + 세분화(Granular) 권한 `read:page:confluence`, `write:page:confluence`, `read:blogpost:confluence` 선택(2026-10-10 등록 완료). 검색은 v1 search(클래식), 페이지 읽기·만들기는 v2 `/wiki/api/v2/pages`(세분화) — 개인 OAuth에서 v1 content·space는 410 Gone, v2는 클래식 권한을 받지 않는다(401). 공간 id는 그 공간 페이지 검색의 `content.space.id`. ② 그다음 Vercel 환경 변수 `CONFLUENCE_ENABLED=true` → 재배포. ①보다 ②를 먼저 하면 로그인 요청에 등록되지 않은 권한이 들어가 **Jira 연결까지 실패**한다. ③ 사용자는 설정 → Atlassian 계정에서 한 번 ‘다시 연결’.

기능(`lib/confluence/`, API `/api/confluence/{search,feed,spaces,pages,pages/[id],weekly-report}`, 페이지 키 `confluence`):
- 웹 `/confluence`: 나를 멘션·지켜보는 문서(14일)·내가 편집 + 검색. `/confluence/new` 회의록 틀, `/confluence/weekly` 주간보고 초안(이번 주 Jira 담당·내가 쓴 문서 + 메모 → Claude Sonnet 5.5 초안, 키 없으면 틀만, `CONFLUENCE_WEEKLY_MODEL`로 모델 변경). 공간·상위 페이지는 브라우저에 기억. 본문은 마크다운 → storage(`markdownToStorage`).
- 웹 홈: 나를 멘션한 문서 카드(있을 때만). 앱 홈: 브리핑 아래 'Confluence 멘션' 섹션(최대 3, 누르면 원문).
- 이노봇: `confluence_search`·`confluence_read`·`confluence_feed`·`confluence_spaces`(읽기)·`confluence_create_page`(쓰기 — 앱이 서버에서 실제 공간 이름을 다시 조회해 확인 카드). 규칙 9·10(문서 답 + 링크, 회의록 구성).
- PPT 만들기: 웹 주소 원고가 회사 Confluence 페이지면 본인 권한으로 REST에서 본문을 읽는다(`lib/confluence/ppt-source.ts`).

### 인증 후 앱 복귀 경로
Jira/Microsoft 연결 완료 URL(`innogrid://login-callback`)은 화면 경로가 아니다. iOS `FlutterDeepLinkingEnabled=false`, Android `flutter_deeplinking_enabled=false`를 유지해 Supabase의 app_links 처리와 Flutter 기본 라우터 처리가 중복되지 않게 한다. 로그인 콜백은 Supabase가 처리하고 계정 연결 복귀는 기존 WebScreen이 resumed에서 상태를 새로 읽는다. 검증 시 앱 실행 중 및 종료 상태에서 `xcrun simctl openurl <UDID> 'innogrid://login-callback/?jira_connected=1'`로 오류 화면이 뜨지 않는지 확인한다.

### Android 업데이트 링크 (2026-10-07)

앱 업데이트 배너·더보기 및 웹 `/apps`의 Android 설치 버튼은 `https://play.google.com/apps/internaltest/4701070333674267983`(Google Play 내부 테스트)로 이동한다. API에서 링크를 내려주므로 기존 설치 앱에도 서버 배포만으로 적용된다. APK·SharePoint 사본 업로드는 릴리스 백업용으로 유지하며 업데이트 버튼은 해당 파일로 연결하지 않는다.

### 앱 사용 신청

웹 `/settings#app-request`에서 플랫폼별 스토어 이메일을 신청하고 처리 상태를 확인한다. 관리자는 `/admin/app-requests`에서 상태·플랫폼별 조회 및 처리 중/등록 완료/반려 처리와 사용자 안내를 저장한다. 스토어 등록·초대는 콘솔에서 별도 진행하며 외부 심사는 자동 제출하지 않는다.

`mobile_app_requests`는 사용자·플랫폼별 한 행이며 revision 조건부 갱신으로 동시 처리 충돌을 막는다. 처리 중인 신청은 사용자 수정 불가, 이메일 변경·반려 후 재신청은 신청 대기로 초기화된다. RLS 활성화 및 anon/authenticated 직접 접근 차단, 서버 API에서 세션 소유권·관리자 권한을 확인한다. 마이그레이션 `20261007232109_mobile_app_requests.sql`. 기존 앱 설정은 웹 화면이므로 앱 재빌드 없이 적용된다.

## SharePoint 문서 연동 (2026-10-10, 1.5.0)

RFP 업로드·Teams 채팅과 **같은 Microsoft 연결**(`ms_connections`, `graphTokenForRoute`)을 쓴다. 이미 받은 위임 권한 `Files.ReadWrite.All`·`Sites.Read.All`로 전부 되므로 콘솔 권한 추가·관리자 동의·재연결이 없다. 본인에게 보이는 문서만 다루고 본문·토큰은 저장·로그하지 않는다(즐겨찾기는 링크만 `user_settings.sharepoint_favorites`).

기능(`lib/sharepoint/`, API `/api/sharepoint/{feed,search,favorites}`, 페이지 키 `sharepoint`):
- 웹 `/sharepoint`: 즐겨찾기(목록 ★ 또는 링크 붙여 넣기, 최대 30, 폴더도 됨) · 자주 쓰는 문서(`/me/insights/used`) · 나와 공유(`insights/shared`) · 주변에서 많이 보는(`insights/trending`) · 검색(`POST /search/query`, driveItem). 인사이트를 끈 테넌트(403·404)면 used는 `/me/drive/recent`로 갈음하고(`source: "recent"`, 화면에 안내) shared·trending은 `unavailable`.
- 웹 홈: 즐겨찾기 + 자주 쓰는 문서 카드(최대 6, 있을 때만). 앱 홈: 브리핑 아래 '자주 쓰는 SharePoint 문서'(최대 3, 누르면 SharePoint 앱·브라우저). 앱 수집은 400·401·403·404·409·500을 "표시 안 함"으로.
- 이노봇: `sharepoint_search`·`sharepoint_recent(used|shared|trending|recent)`·`sharepoint_read`(모두 읽기 — docx·pdf·hwp·hwpx·xlsx·md·txt·html은 내려받아 RFP 파서, pptx는 Graph `@microsoft.graph.downloadUrl`을 ppt-service `/extract`에 넘겨 장표 텍스트, 20MiB·2만 자). 규칙 11(파일은 SharePoint, 위키는 Confluence, 답 끝에 파일 이름·링크).
- PPT 만들기: 웹 주소 원고가 `*.sharepoint.com` 링크면 본인 권한으로 내려받아 `ppt` 버킷 `source/<uuid>.<ext>`에 두고 업로드 원고와 같은 흐름(`lib/sharepoint/ppt-source.ts`; pptx는 PPT 원고). 같은 작업에서 `SOURCE_PATH_RE`에 html·htm이 빠져 HTML 업로드 원고가 덱 만들기에서 거절되던 버그를 고쳤다.

Graph 메모: 검색 hit는 `fields`에 file·folder를 넣어도 폴더에 `folder` 파셋이 없고 `file` 키가 온다(실측) — `folder` 파셋이 없으면 확장자 없는 이름을 폴더로 본다(폴더도 결과에 남겨 즐겨찾기 가능, 파일 먼저). 검색 hit·recent의 `remoteItem`(다른 드라이브 항목)은 그쪽 id·driveId를 쓴다. 인사이트 `resourceReference.id`는 `drives/{driveId}/items/{id}` 꼴만 문서(웹 링크는 제외). 위치 표시는 `resourceVisualization.containerDisplayName` 또는 webUrl 경로에서 `sites`·`Shared Documents`를 뺀 "사이트 › 폴더".

## 아마란스 메신저 멘션 알림 (2026-10-10, 1.5.2)

메신저 자체 API는 없지만(런북 §비서·메모리 참고) 아마란스 **알림센터**에는 메신저 **알파멘션**이 올라온다. 앱은 같은 서명 호출로 `POST /event/event02A01`(header `{groupSeq, empSeq}`, body `reqType 2 · reqSubType N · eventType TALK · searchType received · timeStamp`)을 불러 `GwTalkAlert`(방·보낸 사람·본문(멘션 표식 `|>@empseq=…,name=…@<|` → `@이름`)·읽음·roomId·chatId)로 만든다(`lib/gw/talk_alerts.dart`, `GwTalkApi.talkAlerts`).
- **한계(실측)**: 한 달 알림 780건 중 TALK은 멘션 1건, `mentionYn=N` 조회 0건 → 일반 채팅은 안 올라온다. 실시간은 웹이 MQTT(`/gw/gw015A41` 접속 정보, `wss://host:18085/mqtt`, 토픽 `/{groupSeq}/{empSeq}`)를 쓰지만 앱은 폴링으로 충분.
- 홈 브리핑: '메신저 멘션 N' 섹션(안 읽은 건 굵게, 최대 3) + Claude 브리핑 payload `talkMentions`(안 읽은 것 5개, 본문 80자).
- **데스크탑(macOS·Windows) OS 알림**: `talk_notifications.dart` — 아마란스가 연결돼 있으면 60초마다 확인해 새 멘션만 `flutter_local_notifications`로 띄운다(첫 실행은 기준만 잡고 과거 건은 알리지 않음, 기준은 shared_preferences `talk_alert_seen`). Windows는 `appUserModelId Innogrid.INNOGRID`. Android 빌드는 core library desugaring을 켜야 한다(`build.gradle.kts`).
- **메신저 열기(흉내)**: 알림·섹션을 누르면 `messenger_open.dart` — macOS `open -b com.douzone.amaranth10beta`(설치된 AmaranthMessenger를 앞으로), Windows 설치 폴더의 `AmaranthMessenger*.exe` 실행, iOS `Amaranth10://`·Android `com.douzone.app.amaranth10://`(웹 번들의 모바일 열기 스킴), 실패하면 그룹웨어 웹. 특정 대화방 딥링크는 없다 — Mac 메신저(Electron, `com.douzone.amaranth10beta`)는 URL 스킴 미등록, 웹의 메신저 팝업(`/#popup?menuGubun=MSG&seq=3&d=<AES-CBC 키 "1023497555960596">`)은 이 테넌트에서 빈 화면.

## Claude 커넥터(아마란스 MCP) (2026-10-10)

목적: inno-creed 바이너리를 대체한다. claude.ai 조직 커넥터 **"INNOGRID 아마란스"**(URL `https://innocrew.innogrid.com/api/mcp`)로 Claude(웹·Desktop·모바일·Claude Code)가 각자 아마란스(메일·일정·결재·조직도 등)를 부른다. 스펙 `docs/superpowers/specs/2026-10-10-desktop-mcp-connector-design.md`.

**구조**: claude.ai → `/api/mcp`(Streamable HTTP, 무상태 JSON-RPC) → Supabase `mcp_calls`(RLS·Realtime, SQL `docs/sql/2026-10-10-mcp-calls.sql`) → 데스크탑 앱 `lib/mcp/` McpWorker(클레임 → 실행 → 결과 저장) → `GwClient` → 아마란스. 아마란스 세션·크레덴셜은 앱 안에만 있다.

**인증**: Supabase OAuth 2.1 서버 + 동적 클라이언트 등록(DCR). 동의 화면은 `/oauth/consent`(user 이상, 미로그인은 로그인 후 복귀). DCR로 누구나 클라이언트를 등록할 수 있으므로 동의 화면은 돌아갈 주소(redirect_uri)가 `claude.ai`·`claude.com`(하위 도메인 포함, https) 또는 루프백(localhost·127.0.0.1·[::1])일 때만 [허용]을 열고, 그 밖의 주소는 거부 문구를 보인다(`lib/mcp/consent.ts` `redirectAllowed`; Claude가 다른 콜백 도메인을 쓰면 목록 갱신). 접근 범위 요약("아마란스 … 읽고 쓸 수 있습니다")을 항상 표시한다. 메타데이터 `/.well-known/oauth-protected-resource`.

### 운영 절차
1. **관리자(1회)**: Supabase 대시보드 OAuth 서버 켜기 · Authorization path `/oauth/consent` · DCR 켜기.
2. **조직 Owner(1회)**: claude.ai 관리자 설정 > 커넥터 > 추가 > 사용자 지정 > 웹 → URL 등록 → "지금 로그인" · "자동으로 등록". 2단계 "추가" 버튼이 화면 아래라 스크롤해야 보인다.
3. **사용자**: 앱(macOS·Windows) 설치·로그인·아마란스 연결 → claude.ai 맞춤 설정 > 커넥터 > 내 항목 > 연결 → 허용. Claude Code는 `claude mcp list`에 "claude.ai INNOGRID 아마란스"로 자동 등록된다(루프백 콜백 불필요).

### 도구
inno-creed 2.2.0과 같은 57개 이름·스키마(`frontend/src/lib/mcp/tools.json`). 응답 형식은 `mobile/test/mcp/fixtures/expected`와 일치해야 한다. 실측 캡처를 못 한 도구(현재 `download_body_image` — 인라인 이미지 메일이 없어 미실측, 앱 구현은 있음. 결재 상신·취소·임시 삭제는 2026-10-10 외근 양식으로 실측해 1.6.1부터 제공; 결재자 객체는 서버 A05 형식(`org_div:"m"`·`org_id` 등 28키)이어야 등록되므로 앱이 정규화한다)는 `frontend/src/lib/mcp/protocol.ts`의 `WITHHELD_TOOLS`에 두어 `tools/list`에서 빼고 `tools/call`도 -32602로 거부한다. 캡처·구현이 끝나면 그 집합에서 지우면 된다.

**파일 경계(macOS·Windows 공통)**: 내려받기 도구의 `out_path`가 `~/Downloads`(Windows `%USERPROFILE%\Downloads`) 밖이면 쓰지 않고 `~/Downloads/<파일명>`으로 저장해 `savedPath`로 알린다(같은 이름이 있으면 `이름 (1).ext`). 첨부 업로드의 로컬 경로도 Downloads 아래만 읽는다(밖이면 "Downloads 폴더에 두고 다시"로 거절). macOS는 샌드박스가 같은 경계를 강제하고, Windows는 앱이 같은 규칙을 적용한다 — Claude가 유도한 임의 파일 읽기·쓰기를 막기 위한 것. `send_mail`에 `attachments`를 주면 거절한다(미실측·되돌릴 수 없음): 첨부 메일은 `save_mail_draft`(첨부 업로드 실측) → `send_mail_from_draft` 순서로 보낸다.

### 오류 문구
| 상황 | 안내 |
|---|---|
| 앱 미실행(10초 미클레임) | "데스크탑 앱이 실행 중이 아닙니다…" |
| 110초 시간 초과 | 시간 초과 안내 |
| 아마란스 미연결 | 앱에서 아마란스 연결 안내 |
| 분당 60건 초과 | 호출 상한 안내 |

### 보안
- 크레덴셜은 앱 밖으로 나가지 않는다. 중계 행은 응답 후 삭제, 남은 행은 10분 크론(`/api/cron/mcp-purge`)이 정리.
- 감사 로그엔 `{tool, ms, ok}`만(인자·결과 없음).
- 쓰기 도구도 항상 노출한다 — Claude의 도구 승인 프롬프트가 관문(이노봇 같은 앱 확인 카드는 없음).

### 실측 메모
inno-creed 호출은 mitmproxy + `HTTPS_PROXY`로 캡처했다(rustls-platform-verifier라 키체인에 CA를 신뢰시키면 통과). 픽스처 `mobile/test/mcp/fixtures/captured`(개인정보 가림).

### 문제 해결
| 증상 | 확인 |
|---|---|
| 커넥터 등록 시 "Couldn't reach" | `/api/mcp` 401 응답에 `WWW-Authenticate`(resource_metadata)가 있는지 |
| 동의 화면이 홈으로 감 | guest 역할(user 이상만 허용) |
| 동의 화면에 "허용할 수 없습니다"가 보임 | 돌아갈 주소가 Claude·루프백이 아님(피싱 링크 의심 — 링크 출처를 관리자에게) |
| Claude가 "앱이 실행 중이 아닙니다"라고 함 | 데스크탑 앱이 꺼짐·다른 계정 로그인·더보기 > Claude 커넥터 "요청 받기" 꺼짐·모바일만 켜 둠 |
| 앱이 켜져 있는데 "미실행" 안내 | 더보기 > Claude 커넥터 스위치·앱 로그인·`mcp_calls` Realtime publication |
| 연결은 되는데 도구가 실패 | 앱의 아마란스 연결(재로그인) 상태 |
