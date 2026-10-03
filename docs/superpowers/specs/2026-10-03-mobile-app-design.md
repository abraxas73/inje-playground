# 모바일 앱(Flutter) — 설계

> 2026-10-03. 이노크루가 폰(Android·iOS)에서 플레이그라운드 전체 기능을 쓰게 하는 Flutter 앱. **하이브리드**: 로그인·탭 메뉴와 일상 기능(뭐 먹지·사다리·커피 타임)은 네이티브 화면, 나머지 기능은 앱 안 WebView로 기존 웹을 그대로 연다. 네이티브 화면은 기존 `/api/*`를 Bearer 토큰으로 호출하고, WebView는 서버가 발급한 일회용 토큰으로 자기 세션을 만든다. 푸시 알림·스토어 배포는 다음 단계(§12).

## 1. 목적과 성공 기준

- **대상**: 로그인한 사내 사용자(user 이상). 모임 자리·이동 중에 폰으로 쓰고 싶은 사람.
- **성공 기준**: 앱에서 Microsoft 로그인을 한 번 하면 네이티브 화면과 WebView 화면이 모두 로그인 상태로 열리고, 뭐 먹지·사다리·커피 타임이 웹과 같은 데이터(즐겨찾기·이력·내 팀)를 공유한다. 폰에서 돌린 사다리·팀 나누기 결과가 웹 이력에 그대로 보인다.
- **확정된 값**: Flutter 3.44(stable) · 대상 Android 8.0(API 26)+ / iOS 15+ · 앱 이름 "이노그리드" · 번들/패키지 ID `com.innogrid.playground` · 딥링크 스킴 `innogrid://` · 로그인은 Microsoft(Azure)만(2026-10-02 기준 사용자 87명 전원 Azure, Google 0명) · WebView 세션용 일회용 토큰 유효 1시간·1회 · API 401 시 세션 갱신 후 재시도 1회 · 코드는 모노레포 `mobile/`.
- **비목표(이번 단계)**: 푸시 알림, 설문·사용량·성과의 네이티브 화면, 앱 전용 웹 레이아웃, 오프라인 동작, App Store/Play 배포, 지도 렌더링(웹과 같이 카카오맵 링크만).

## 2. 범위

포함:
1. Flutter 프로젝트 `mobile/` — 로그인, 탭 4개(뭐 먹지·사다리·커피 타임·더보기), WebView 화면, 로그아웃.
2. 네이티브 기능 3개 — 뭐 먹지(검색·즐겨찾기·추천·PAYCO), 사다리(생성·애니메이션·이력), 커피 타임(팀 나누기·출석·댓글·알림·이력).
3. 서버(Next.js) 추가 — Bearer 인증 분기, `POST /api/mobile/login`, `POST /api/mobile/web-token`, 페이지 `/auth/mobile`, Supabase 리디렉션 허용 목록.
4. 개발기 설치 절차(Android 디버그 APK, iOS 개인 서명).

제외(§12): 푸시, 추가 네이티브 화면, 스토어 배포, 앱 전용 웹 레이아웃, 생체 인증 잠금, 다크 모드 별도 디자인(Flutter 기본 테마 따름).

## 3. 현재 상태와 재사용하는 것

- **인증**: 웹은 Supabase OAuth(`signInWithOAuth` google/azure) → `/auth/callback`에서 `exchangeCodeForSession` → `login_history` 기록(`logLogin`). 모든 `/api/*`는 **쿠키 세션**만 인증한다 — `createServerSupabase()`(`@supabase/ssr` + `cookies()`)와 미들웨어 `updateSession`(`lib/supabase-middleware.ts`: `/api`는 PUBLIC_PREFIXES에 있어 리다이렉트는 안 하지만 쿠키로 사용자·역할·페이지 권한을 검사). Bearer 경로는 없다. 새 사용자 프로필은 DB 트리거 `on_auth_user_created → handle_new_user`가 만들고 기본 역할은 `user`.
- **Supabase 인증 설정**(Management API `GET /v1/projects/avooqcxehfeurjhqqgui/config/auth`, 2026-10-03): `uri_allow_list = https://inje-playground.vercel.app/, http://localhost:3003/**` · 이메일 provider 켜짐(`generateLink` 사용 가능) · **리프레시 토큰 회전 켜짐, 재사용 간격 10초** · JWT 1시간. 회전 때문에 한 세션을 두 클라이언트(앱·WebView)가 나눠 쓰면 서로 갱신하다 세션 가족이 통째로 폐기될 수 있다 → WebView는 별도 세션(§5.3).
- **뭐 먹지**(`app/food/page.tsx`): 카카오 로컬 검색은 서버 프록시 `GET /api/food/search?x&y&radius&category_group_code&sub_category&detail_category&keyword&max_results`(키는 `settings.kakao_rest_api_key`, 서버 전용) → `KakaoPlace[]`(`types/food.ts`: id·place_name·category_name·phone·address_name·road_address_name·x·y·place_url·distance). 카테고리 `GET /api/food/categories?category_group_code[&sub_category]`, 주소 `GET /api/food/geocode?query`, 역지오코딩 `GET /api/food/reverse-geocode`, 즐겨찾기 `GET/POST/DELETE /api/food/favorites`(테이블 `food_favorites`), 추천 기록 `POST /api/food/decide`(`food_decisions`), PAYCO `POST /api/food/payco`. 위치·필터는 localStorage(`food-location`·`food-filters`). 지도는 그리지 않고 `place_url`을 새 탭으로 연다.
- **사다리**(`app/ladder/page.tsx`, `components/ladder/LadderCanvas.tsx`): 참가자는 내 팀(`GET /api/users/members` → `{name, email, external_id, dooray_member_id, is_card_holder, sort_order}[]`) + 직접 입력. `LadderData = {participants, results: {text, type}[], columns, rows, bridges: boolean[][]}`(`types/ladder.ts`). 저장 `POST /api/ladder-sessions {title, participants, results, bridges, bridgeDensity, mappings}`, 목록 `GET`, 수정 `PATCH`.
- **커피 타임**(`app/team/page.tsx`, `lib/team-divider.ts`, `types/team.ts`): `TeamConfig = {participants, teamCount, minPerTeam, maxPerTeam, cardHolders}` → `validateTeamConfig(config): string | null`, `divideTeams(config): {teams: {name, members}[]}`(순수 함수, vitest 있음). 저장 `POST /api/team-sessions {title, participants, teamCount, cardHolderDistribution, teams}`(`team_sessions`·`team_results`), 출석 `PATCH /api/team-attendance`, 댓글 `/api/team-comments`, 알림 `POST /api/team-notify`(서버가 Dooray/Teams provider 선택). 법카 보유자는 localStorage + 내 팀 `is_card_holder`로 초기화.
- **페이지 카탈로그**: `lib/page-access.ts`의 `PAGES`(key·href·label·group·minRole·hidden)와 `canUsePage(role, key, permissions)` — 더보기 목록이 같은 규칙을 쓴다.
- **개발 환경**(운영자 Mac, 2026-10-03): Flutter 3.44.0 stable(`~/development/flutter`), Xcode, Android Studio 설치. 디스크 여유 14GB.

## 4. 전체 구조

```
mobile/                      Flutter 앱(모노레포)
  lib/
    main.dart                Supabase 초기화, 라우터, 테마
    auth/                    세션 상태(Riverpod), 로그인 화면, /api/mobile/login 호출
    api/client.dart          Bearer 부착·401 갱신 재시도·오류 통일 — 모든 네이티브 호출은 이것만
    features/food|ladder|team/   models.dart(파싱) · repository.dart(API) · 화면·위젯 · (ladder) painter · (team) divider.dart
    more/                    더보기 목록(페이지 카탈로그 + 역할 필터)
    web/                     WebView 화면, 세션 부트스트랩(/api/mobile/web-token → /auth/mobile)
  test/                      순수 함수 단위 테스트 + 위젯 테스트 최소
frontend/                    서버 추가분(§5)
```

- 패키지: `supabase_flutter`(인증·세션 저장·갱신), `webview_flutter`(+android/wkwebview), `go_router`, `flutter_riverpod`, `geolocator`, `url_launcher`, `shared_preferences`, `http`, `file_picker`(Android WebView 파일 업로드 — `webview_flutter_android`의 `setOnShowFileSelector`가 선택기를 제공하지 않아 필요, 2026-10-03 계획 단계에서 추가). 이 외 추가 금지(필요하면 설계 변경으로).
- 화면 이동: `/login`, `/`(탭 셸), `/web?path=<경로>`. 탭은 `IndexedStack`으로 상태 유지.
- 상태: 세션(로그인 사용자·역할·권한)은 앱 전역 provider 하나. 기능별 상태는 그 기능 폴더 안에만.
- 기기 저장(`shared_preferences`): 뭐 먹지 위치·필터, 법카 보유자 명단 — 웹 localStorage와 같은 역할, 기기별이며 웹과 동기화하지 않는다(웹도 그렇다).

## 5. 인증

### 5.1 앱 로그인
- `Supabase.initialize(url, anonKey)` 후 `auth.signInWithOAuth(OAuthProvider.azure, redirectTo: 'innogrid://login-callback', scopes: 'email openid profile')`. 시스템 인증 시트(iOS ASWebAuthenticationSession / Android Custom Tabs)로 열리고 딥링크로 돌아온다. Azure 앱 등록은 변경 없음(리디렉션은 Supabase 콜백 그대로).
- Supabase `uri_allow_list`에 `innogrid://login-callback` 추가 — Management API `PATCH /v1/projects/<ref>/config/auth`(CLI 키체인 토큰, 기존 값 뒤에 덧붙임).
- Android: `AndroidManifest.xml`에 `innogrid` 스킴 intent-filter. iOS: `Info.plist` `CFBundleURLSchemes`.
- 세션은 `supabase_flutter`가 기기 안전 저장소에 두고 자동 갱신한다. 앱 시작 시 세션이 있으면 `/`로, 없으면 `/login`.

### 5.2 로그인 기록과 역할
- 로그인 성공 직후 앱이 `POST /api/mobile/login`(Bearer) 호출. 서버는 `requireUser` 대신 **역할 무관**으로 사용자를 확인하고(guest도 기록은 남긴다) `logLogin(supabase, request, {userId, userEmail})`로 `login_history`에 남기며(Audit 로그 kind `login`과 동일 집계, `user_agent`로 앱 구분) `{ role, permissions }`를 돌려준다. `permissions`는 미들웨어가 쓰는 것과 같은 `user_page_access`(없으면 `{}`).
- 역할이 `guest`면 "사용자 권한이 필요합니다" 안내 화면만(웹의 `/access-denied`에 해당). admin은 더보기에 관리자 항목이 보인다.
- 세션 갱신 실패·로그아웃 → `/login`. 로그아웃은 `auth.signOut()` + WebView 쿠키 전부 삭제(`WebViewCookieManager.clearCookies`).

### 5.3 네이티브 화면 → API (Bearer)
- `api/client.dart`: 모든 요청에 `Authorization: Bearer <currentSession.accessToken>`, `User-Agent: InnogridApp/<버전> (<platform>)`. 응답 401 → `auth.refreshSession()` 후 **1회** 재시도, 또 401이면 세션 종료 → `/login`. 그 외 오류는 `{error}` 본문을 메시지로.
- 서버 변경 ①: `lib/supabase-server.ts` `createServerSupabase()` — `headers()`에 `authorization: Bearer …`가 있으면 `createServerClient(url, anon, { global: { headers: { Authorization } }, cookies: { getAll: () => [], setAll: () => {} } })`를 돌려준다. `getUser()`는 지금처럼 Supabase에 토큰을 검증한다. 쿠키 경로는 그대로.
- 서버 변경 ②: `lib/supabase-middleware.ts` `updateSession` — `/api/*` 요청에 Bearer가 있으면 같은 방식으로 클라이언트를 만들고 쿠키 갱신(`setAll`)은 건너뛴다. 역할·권한 검사는 기존 코드 그대로 탄다.
- 그 밖의 라우트는 수정하지 않는다 — 기존 `getUser()`·`requireUser()`·`requireAdmin()`이 그대로 동작한다.

### 5.4 WebView 세션(별도 세션, 일회용 토큰)
- 앱 세션을 WebView에 복사하지 않는다(§3 리프레시 회전). WebView는 자기 쿠키 세션을 가진다.
- WebView 화면을 열 때 쿠키에 Supabase 세션이 없으면(첫 진입·만료):
  1. 앱이 `POST /api/mobile/web-token`(Bearer) → 서버가 service role로 `auth.admin.generateLink({ type: 'magiclink', email })`의 `properties.hashed_token`을 돌려준다. **메일은 보내지 않는다.** 응답 `{ tokenHash }`. 감사 로그에는 토큰을 남기지 않는다(행동 "모바일 웹 세션 발급"만).
  2. WebView가 `https://inje-playground.vercel.app/auth/mobile?next=<경로>#token=<tokenHash>`를 연다. 이 페이지(클라이언트 컴포넌트, 공개 경로 — PUBLIC_PREFIXES의 `/auth` 아래)는 URL 조각에서 토큰을 읽어 브라우저 Supabase 클라이언트로 `auth.verifyOtp({ token_hash, type: 'email' })`(generateLink magiclink의 hashed_token은 type `email`로 검증한다) → 쿠키 세션 생성 → `router.replace(next)`. 토큰은 조각(`#`)으로만 전달해 서버 로그·Referer·감사 기록에 남지 않는다. `next`는 같은 오리진 경로만 허용(`/`로 시작, `//` 금지).
  3. 이후 WebView 쿠키는 웹과 똑같이 미들웨어가 갱신한다. 세션 유무는 앱이 WebView 쿠키 중 `sb-*-auth-token` 존재로 판단하고, 없으면 1~2를 반복한다.
- 이 방식은 앱 세션과 독립된 세션 가족이라 회전 충돌이 없고, 토큰은 1회·1시간이라 유출 피해가 제한된다. 로그인 기록은 §5.2에서 이미 남겼으므로 `/auth/mobile`은 `login_history`를 또 쓰지 않는다.

## 6. 네이티브 화면

### 6.1 뭐 먹지
- 진입: 저장된 위치가 있으면 그것, 없으면 `geolocator`로 현재 위치(권한 요청 → 거부·실패 시 주소 검색 유도) → `reverse-geocode`로 주소 표시. 위치 변경은 주소 검색(`geocode`) 또는 "현재 위치".
- 필터: 카테고리(전체/음식점 FD6/카페 CE7) → 세부 → 상세(`categories`), 반경(300·500·1000·2000m), 개수(30·60·100), 키워드. 기기 저장.
- 검색 결과: 거리순 목록(이름·카테고리·거리·주소·전화). 항목 탭 → 카카오맵 `place_url`을 `url_launcher`(외부). 전화 탭 → 전화 앱. 하트 → 즐겨찾기 POST/DELETE.
- 즐겨찾기 탭(세그먼트): `favorites` 목록, 삭제.
- PAYCO: 키워드로 `payco` 검색 결과를 별도 섹션에(웹과 같은 입력·출력).
- "오늘 뭐 먹지": 현재 조건으로 검색 → 무작위 1곳 → 결과 카드 → "다시" / "결정"(`decide` POST, 웹 모달과 같은 본문) / "팀에 알리기"(웹 모달이 쓰는 알림 API 그대로).

### 6.2 사다리
- 참가자: 내 팀 체크리스트(`/api/users/members`) + 직접 입력 칩. 결과: 텍스트·종류(당첨/꽝/일반) 입력, 참가자 수와 같아야 함(웹과 같은 검증).
- 생성: 다리 밀도(낮음/보통/높음)로 `bridges` 생성 — 같은 행에 인접 다리가 없도록 하는 규칙을 웹 `LadderCanvas`와 동일하게 Dart로 옮긴다(`ladder/generator.dart`, 단위 테스트: 인접 다리 금지·열/행 수·경로 추적이 전단사).
- 애니메이션: `CustomPainter`로 사다리를 그리고, 참가자 탭 → 그 경로 추적(한 명씩), "전체 공개" → 모두. 추적 결과 `mappings`.
- 저장: 전체 공개 시 `POST /api/ladder-sessions`(웹과 같은 본문) → 웹 이력에서 열린다. 이력 탭: `GET` 목록 → 상세(참가자·결과 매핑).

### 6.3 커피 타임
- 참가자: 내 팀 체크리스트(출석 체크 겸함) + 직접 입력. 법카 보유자 토글(초기값 `is_card_holder`, 기기 저장).
- 설정: 팀 수, 최소·최대 인원, "법카 보유자 분산" 스위치. 검증은 `team/divider.dart`의 `validateTeamConfig`(웹 `lib/team-divider.ts`를 그대로 옮김; 웹 vitest 케이스를 Dart 테스트로 동일하게 가져온다).
- 나누기: `divideTeams` → 팀 카드 목록(법카 보유자 표시). "다시 섞기" / "저장"(`POST /api/team-sessions`) / "알리기"(`POST /api/team-notify`, 성공·경고 메시지 그대로 표시).
- 이력 탭: `GET /api/team-sessions` → 상세(팀·출석 토글 `PATCH /api/team-attendance`·댓글 `/api/team-comments`).

### 6.4 더보기
- 항목은 웹 `PAGES`와 같은 목록을 Dart 상수로 둔다(key·href·label·group·minRole·hidden). `hidden` 제외, `minRole`·`permissions`(§5.2)로 걸러서 그룹별 섹션(일상/AI/업무). admin이면 관리자 섹션(`/admin/*` 13개 항목)과 설정(`/settings`) 추가. 항목 탭 → `/web?path=<href>`.
- 하단에 사용자 이메일·역할·로그아웃·앱 버전.

## 7. WebView 화면

- `webview_flutter`로 `https://inje-playground.vercel.app<path>`를 연다(§5.4 부트스트랩 선행). 상단 바: 제목(페이지 `<title>`)·새로고침·"브라우저로 열기". 뒤로 가기: WebView `canGoBack`이면 `goBack`, 아니면 화면 닫기.
- 내비게이션 가로채기: 같은 오리진은 WebView 안, 다른 도메인(카카오맵·Dooray·SharePoint·Teams·Supabase Storage 서명 URL 등)은 `url_launcher`로 시스템 브라우저. 다운로드(`Content-Disposition` 또는 `.pptx/.xlsx/.pdf` 경로)도 시스템 브라우저로 넘겨 OS가 받는다.
- 파일 업로드: iOS는 WKWebView 기본 동작, Android는 `webview_flutter_android`의 `setOnShowFileSelector`로 시스템 파일 선택기 연결.
- User-Agent에 `InnogridApp/<버전>` 덧붙임(이번 단계에서 웹은 이 값을 쓰지 않는다; §12).
- 로그인 페이지(`/login`)로 리다이렉트되는 것이 감지되면(=WebView 세션 없음·만료) 부트스트랩을 다시 돈다. 두 번 연속 실패하면 오류 상태 + 재시도 버튼.

## 8. 서버 변경 요약(`frontend/`)

| 항목 | 내용 |
|---|---|
| `lib/supabase-server.ts` | Bearer 헤더 분기(§5.3) |
| `lib/supabase-middleware.ts` | `/api/*` Bearer 분기, 쿠키 갱신 생략(§5.3) |
| `POST /api/mobile/login` | 로그인 기록 + `{role, permissions}`(§5.2) |
| `POST /api/mobile/web-token` | `generateLink(magiclink)` → `{tokenHash}`(§5.4), `requireUser`(guest 거부) |
| `app/auth/mobile/page.tsx` | 조각 토큰으로 `verifyOtp` → 쿠키 → `next` 이동(§5.4) |
| Supabase 설정 | `uri_allow_list` += `innogrid://login-callback` |
| 문서 | `CLAUDE.md`(모바일 섹션·API 2개), `.claude/rules/mobile.md`(paths `mobile/**`, `frontend/src/app/api/mobile/**`), 런북 `docs/mobile-app.md` |

웹 기존 동작은 바뀌지 않는다(쿠키 경로 그대로, 새 라우트만 추가).

## 9. 오류 처리

- 인증: 갱신 실패·401 재시도 실패 → 세션 종료·로그인 화면·사유 한 줄. guest → 안내 화면. OAuth 취소 → 로그인 화면 그대로(오류 아님).
- 네트워크·서버: 화면별 오류 상태(메시지 + 재시도). `{error}` 본문 메시지를 그대로 보여 준다(웹과 같은 문구).
- 위치: 권한 거부 → "주소로 찾기" 유도, 위치 서비스 꺼짐 → 설정 열기 버튼(`geolocator.openLocationSettings`).
- WebView: 부트스트랩 실패(토큰 발급 실패·verifyOtp 실패) → 오류 상태·재시도. 네트워크 오류 페이지는 WebView 기본 오류 대신 앱 오류 상태로 바꿔 그린다.
- 입력 검증 메시지는 웹과 동일 문구(사다리 "참가자와 결과 수가 같아야 합니다", 팀 `validateTeamConfig` 반환값).

## 10. 테스트

- **Dart 단위**: `features/*/models.dart` 파싱(샘플 JSON), `ladder/generator.dart`(인접 다리 금지·전단사 경로), `team/divider.dart`(웹 vitest 케이스 이식: 인원 부족·초과·법카 분산), `more/catalog.dart`(역할·권한 필터), `api/client.dart`(401 → 갱신 → 재시도 1회, 두 번째 401은 로그아웃 — fake http·fake auth).
- **위젯**: 로그인 화면 렌더, 탭 전환, 더보기 목록 역할별 항목.
- **서버 vitest**: Bearer 분기(토큰 있으면 쿠키 무시), `/api/mobile/login` 응답·guest 허용, `/api/mobile/web-token` guest 403·토큰 반환 형태, `/auth/mobile`의 `next` 검증(외부 URL 거부).
- **실기기**: Android 에뮬레이터/기기, iOS 시뮬레이터(OAuth 딥링크는 실기기에서 확인). 체크리스트는 런북에.

## 11. 개발기 설치

- Android: `flutter build apk --debug` → APK 전달·설치(알 수 없는 출처 허용). 운영 서버(`https://inje-playground.vercel.app`)를 그대로 쓴다(`--dart-define=API_BASE=` 로 로컬 서버 지정 가능).
- iOS: Xcode에서 개인 팀(Personal Team) 서명으로 본인 기기에 설치(7일마다 재서명). 배포 방식이 정해지면 Apple Developer 계정 + TestFlight로 전환(§12).

## 12. 다음 단계 후보(이번 범위 밖)

푸시 알림(FCM/APNs·토큰 테이블·서버 발송 — 인사·부고·PPT 완료), 설문·사용량·성과 네이티브 화면, 앱 전용 웹 레이아웃(User-Agent `InnogridApp`로 상단 메뉴 숨김), 생체 인증 잠금, TestFlight/Play 내부 테스트 배포, 스토어 공개(개인정보처리방침·심사 대응).
