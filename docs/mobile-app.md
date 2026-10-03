# 모바일 앱(Flutter) 런북

## 구성
- `mobile/` Flutter 앱(Android·iOS). 운영 서버 `https://inje-playground.vercel.app`를 그대로 쓴다(`--dart-define=API_BASE=` 로 교체).
- 로그인: Supabase Microsoft OAuth → `innogrid://login-callback`(Supabase uri_allow_list에 등록, 2026-10-03). Azure 앱 등록은 변경 없음.
- 네이티브 화면은 `/api/*`를 Bearer로 호출. WebView는 `POST /api/mobile/web-token` → `/auth/mobile?next=…#token=…`으로 자기 세션을 만든다.

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
`open -a Simulator` → `flutter devices`로 UDID 확인 → `flutter run -d <UDID>`. 첫 빌드는 pod install 포함 1분 안팎(2026-10-03 실측 36초). 2026-10-03 iPhone 17 Pro 시뮬레이터에서 로그인 화면까지 확인.
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
