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
| 로그아웃 → 다시 로그인하면 탭 화면이 `element._lifecycleState == _ElementLifecycle.inactive` 빨간 화면 | 사다리 화면의 AnimationController가 `late final` 지연 생성이라, 사다리를 안 만들고 화면이 정리될 때(로그아웃) dispose에서 처음 생성되며 "Looking up a deactivated widget's ancestor is unsafe" 예외 → 트리 정리가 중단되어 다음 셸 생성 때 GlobalKey 충돌(추정) | initState에서 생성하도록 수정(2026-10-03, 테스트 `test/ladder/ladder_screen_test.dart`). 재발하면 터미널에서 **가장 먼저** 찍힌 `EXCEPTION CAUGHT BY WIDGETS LIBRARY` 블록을 본다 — 빨간 화면의 단언은 결과이지 원인이 아니다 |
| iOS에서 Microsoft 로그인 뒤 `login.microsoftonline.com` 시트(마지막 "로그인 상태를 유지하시겠습니까?")가 안 닫히고 앱을 덮음 — 로그에는 `handle deeplink uri`가 찍힘 | supabase_flutter는 딥링크로 세션만 복구하고 인앱 Safari 시트(SFSafariViewController)는 닫지 않는다 | 앱이 `signedIn` 때 `closeInAppWebView()`로 시트를 닫는다(`lib/auth/session.dart`, 2026-10-03 반영). 그래도 남으면 X로 닫으면 이미 로그인된 상태 |

## 개발기 설치
### Android
```bash
cd mobile && flutter build apk --debug     # build/app/outputs/flutter-apk/app-debug.apk
adb install -r build/app/outputs/flutter-apk/app-debug.apk   # 또는 APK 파일 전달 → 알 수 없는 출처 허용 후 설치
```
### iOS(본인 기기, Personal Team)
1. `open mobile/ios/Runner.xcworkspace` → Runner 타깃 → Signing & Capabilities → Team: 본인 Apple ID(Personal Team). Bundle Identifier `com.innogrid.playground`가 Personal Team에서 충돌하면 `com.innogrid.playground.dev`로 바꿔 서명.
2. 기기 연결 → `flutter run -d <기기>` 또는 Xcode ▶. 처음엔 기기 설정 → 일반 → VPN 및 기기 관리에서 개발자 앱 신뢰.
3. Personal Team 서명은 7일마다 만료 — 재실행하면 갱신. 배포 방식이 정해지면 Apple Developer 계정 + TestFlight로 전환.
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
