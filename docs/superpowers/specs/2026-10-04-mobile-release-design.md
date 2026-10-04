# 모바일 앱 사내 배포 설계

2026-10-04. 대상: `mobile/`(Flutter) + `frontend/`(배포 페이지·API). 런북 `docs/mobile-app.md`, 규칙 `.claude/rules/mobile.md`.

## 목표

이노그리드 구성원이 **로그인한 웹에서 받거나(Android APK) TestFlight 링크로(iOS)** 앱을 설치하고, 새 버전이 나오면 **앱 안에서 알고 한 번 눌러** 받을 수 있게 한다. 배포는 운영자 Mac에서 스크립트 한 번으로 끝낸다(프론트 `vercel --prod`와 같은 수동 패턴). 스토어 공개·CI·관리 UI는 만들지 않는다.

## 결정 사항(사용자 확정)

| 항목 | 결정 | 이유 |
|---|---|---|
| iOS 채널 | **TestFlight 외부 그룹 공개 링크** | UDID 수집 없음, 자동 업데이트. 첫 빌드만 Beta App Review. 빌드 90일 만료 → 분기 1회 재업로드 |
| Android 채널 | **웹 `/apps`에서 APK 직접 받기 + 앱 안 업데이트 버튼** | 계정·심사 없음. 자동 업데이트가 없으니 앱이 새 버전을 알려 준다 |
| Apple 계정 | 개인 유료 계정(팀 `LME2TNRC9G`, 이 Mac에 Apple Distribution 인증서 있음) | TestFlight 판매자명이 개인 이름으로 보이는 건 사내용이라 수용 |
| 업데이트 안내 | 시작 시 버전 확인 → 홈 배너 + 더보기 "앱 버전" 줄의 업데이트 버튼 | 강제 업데이트는 없음 |
| 저장소 | Supabase 스토리지 버킷 `mobile`(비공개) + `settings` 키 `mobile_release` | 로그인 뒤에만 받게 하고, APK 바이너리를 git에 넣지 않기 위해 |

## 구성 요소

### 1. 빌드·서명 설정(`mobile/`)

- **Android 서명**: `android/key.properties`(gitignore됨)가 있으면 `android/app/build.gradle.kts`가 `storeFile/storePassword/keyAlias/keyPassword`를 읽어 `release` 서명 설정을 만든다. 없으면 지금처럼 디버그 키로 떨어져 다른 개발자의 빌드는 안 깨진다. 키스토어는 `android/upload-keystore.jks`(gitignore됨), 별칭 `upload`, RSA 2048, 유효 10000일. **키스토어와 비밀번호는 1Password에 백업**한다 — 잃으면 서명이 바뀌어 전 직원이 앱을 지우고 다시 설치해야 한다.
- **iOS**: `ios/Runner/Info.plist`에 `ITSAppUsesNonExemptEncryption=false`(HTTPS만 써서 수출 규정 면제) — 업로드마다 뜨는 질문을 없앤다. 서명은 기존 자동 서명·팀 그대로.
- **버전 출처는 `pubspec.yaml`의 `version: X.Y.Z+N` 하나**. 올릴 때는 pubspec을 손으로 고친다. `lib/config.dart`의 하드코딩 `appVersion`은 다음으로 바뀐다:
  ```dart
  static const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: 'dev');
  static const appBuild = int.fromEnvironment('APP_BUILD', defaultValue: 0);
  ```
  릴리스 스크립트가 pubspec에서 읽어 `--dart-define`으로 넘긴다. define 없는 개발 빌드는 `dev`/0으로 보이고 **업데이트 확인을 건너뛴다**(0은 "모름"). User-Agent `InnogridApp/$appVersion`은 그대로(서버 UA 파서는 문자열이면 받는다).

### 2. 앱 아이콘(이노그리드 CI 가이드 적용)

- 근거: 이노그리드 CI 디자인 가이드라인 ver 0.1(2021-10-08, https://www.innogrid.com/download/ci/Innogrid_CI_Guide.pdf). **워드마크만 있고 심볼 마크는 없다.** 전용 색상: Logo Color `#002447`, Background Color `#006cdb`, Point `#00a2ff`·`#00ccff`·`#13defc`. 금지: 로고 변형·회전·테두리·그림자·전용색 외 색, 배경과 구분되지 않는 조합. 그래픽 모티프(면형: SHARING 링·EXPANSION 별·CONNECTION 점 8개 링·PROGRESS 계단·FLEXIBILITY 꺾쇠·INTEGRATION 육각형)는 "보조적 수단"이며, 응용 예시가 바로 **브랜드 블루 타일 위 흰 모티프**다.
- 아이콘: 가로 7.5:1 워드마크는 48~60px 아이콘에서 읽히지 않고 세로로 쌓거나 줄이는 건 금지규정(변형)에 걸리므로, **Background Color `#006cdb` 바탕 + 흰 CONNECTION 모티프**(그래픽_응용 타일 그대로)로 한다. 홈 화면 이름이 "이노그리드"라 글자는 넣지 않는다. 1024 기준 모티프 지름 560(55%), 점 반지름 56, 점 중심 반지름 224 — Android 적응형 아이콘 안전 영역(지름 676) 안.
- 원본 두 장을 `assets/brand/`에 둔다: `app_icon.png`(1024×1024 불투명, 바탕 + 모티프), `app_icon_fg.png`(1024×1024 투명 + 흰 모티프). 이미지 도구 없이 **Flutter 골든 렌더(CustomPaint, 일회용 테스트)** 로 뽑는다.
- `flutter_launcher_icons`를 **dev 의존성**으로 추가(런타임 영향 없음)하고 pubspec에 설정: iOS 전 크기(`remove_alpha_ios: true`), Android 레거시 + 적응형(`adaptive_icon_background: "#006cdb"`, `adaptive_icon_foreground: assets/brand/app_icon_fg.png`). 모티프나 색이 바뀌면 원본을 다시 뽑고 `dart run flutter_launcher_icons`를 다시 돌린다. 이것이 pubspec 의존성 11개 규칙의 예외(스펙 변경)다.
- 앱 UI 팔레트(`Brand.navy #0B1A3A`·`Brand.blue #0441FF`, Claude Design 시안)는 이번에 바꾸지 않는다. CI 색(#002447·#006cdb)으로 맞출지는 별도 결정.

### 3. 릴리스 저장소·메타데이터(Supabase)

- 버킷 `mobile`: 비공개, 파일 크기 상한 200MB. 경로 `android/innogrid-<version>+<build>.apk`. 쓰기는 service role(릴리스 스크립트)만, 읽기는 서버가 만든 서명 URL(600초, `download` 파일명 지정)만. SQL은 `docs/sql/2026-10-04-mobile-release.sql`(ppt 버킷과 같은 꼴).
- `settings` 키 `mobile_release`(전역 설정, 문자열 JSON):
  ```json
  {
    "notes": "게시판 읽기 · 홈 공지 · 일정 날짜 이동",
    "testflightUrl": "https://testflight.apple.com/join/XXXXXXXX",
    "android": { "version": "1.0.0", "build": 1, "apkPath": "android/innogrid-1.0.0+1.apk", "releasedAt": "2026-10-04T06:00:00Z" },
    "ios": { "version": "1.0.0", "build": 1, "releasedAt": "2026-10-04T06:30:00Z" }
  }
  ```
  플랫폼별로 따로 두는 이유: Android만 또는 iOS만 다시 올리는 날이 있어 빌드 번호가 갈릴 수 있다. 스크립트는 자기가 올린 플랫폼 블록과 `notes`(주어졌을 때)·`testflightUrl`(주어졌을 때)만 갈아 끼우고 나머지는 보존한다.

### 4. API `GET /api/mobile/release`(`frontend/src/app/api/mobile/release/route.ts`)

- 인증: `requireUser()`(user 이상, 쿠키·Bearer 모두). guest·비로그인은 401/403.
- 응답(200, `Cache-Control: no-store`):
  ```json
  {
    "notes": "…",
    "ios":     { "version": "1.0.0", "build": 1, "releasedAt": "…", "url": "https://testflight.apple.com/join/…" },
    "android": { "version": "1.0.0", "build": 1, "releasedAt": "…", "url": "<APK 서명 URL, 600초>" }
  }
  ```
  설정이 없거나 깨졌으면 `{ "notes": "", "ios": null, "android": null }`. iOS 블록은 있는데 `testflightUrl`이 비면 `url`은 `null`. 서명 URL 발급 실패는 `android.url = null`로 내리고 200을 유지한다(버전 안내는 되게).
- 순수 로직은 `frontend/src/lib/mobile/release.ts`: `parseMobileRelease(raw: string | undefined): MobileRelease`(관대한 파싱 — 잘못된 JSON·형식이면 빈 값, `build`는 양의 정수만), `releaseResponse(rel, apkUrl: string | null)`.

### 5. 웹 페이지 `/apps` "모바일 앱"(`frontend/src/app/apps/page.tsx`)

- 카탈로그 `lib/page-access.ts`에 `{ key: "apps", href: "/apps", label: "모바일 앱", group: "daily", minRole: "user" }` 추가 → 메뉴·홈 카드·`/admin/page-permissions`·미들웨어 검사에 자동 반영. **앱의 Dart 카탈로그(`catalog.dart` `pages`)에는 넣지 않는다**(앱 안에서 앱 설치 페이지를 보여 줄 이유가 없다).
- 내용: 카드 셋.
  - **iPhone**: "1) App Store에서 TestFlight 설치 2) 아래 버튼 → TestFlight에서 설치. 새 버전은 자동으로 받습니다." + `TestFlight에서 열기` 버튼(`ios.url`, 없으면 "준비 중" 비활성).
  - **Android**: "1) APK 받기 2) 알림에서 열기 → 'Chrome에서 알 수 없는 앱 설치 허용' 3) 설치. 새 버전은 앱이 알려 줍니다." + `APK 받기 (vX.Y.Z)` 버튼 → `window.location.assign(android.url)`(서명 URL이 `Content-Disposition: attachment`라 바로 내려받힘). 없으면 비활성.
  - **현재 버전**: 플랫폼별 버전·빌드·배포일 + `notes`.
- 미들웨어·역할 검사는 카탈로그가 처리하므로 페이지는 기존 클라이언트 페이지 관례(`"use client"`, shadcn Card/Button)만 따른다. 응답 실패 시 "버전 정보를 불러오지 못했습니다 · 다시 시도".

### 6. 앱 안 업데이트(`mobile/lib/release/`)

- `release_check.dart`(순수):
  ```dart
  class ReleaseInfo { final String version; final int build; final String? url; }
  ReleaseInfo? parseRelease(dynamic json, {required bool android}); // 자기 플랫폼 블록만, 형식 틀리면 null
  bool hasUpdate(ReleaseInfo? r, int appBuild) => appBuild > 0 && r != null && r.build > appBuild;
  ```
- `release_provider.dart`: `releaseProvider = FutureProvider<ReleaseInfo?>` — `apiClientProvider.getJson('/api/mobile/release')` 1회(앱 프로세스당), 플랫폼은 `defaultTargetPlatform`(테스트에서 바꿀 수 있음). 모든 실패는 `null`(조용히 — 업데이트 확인은 부가 기능이라 오류 UI 없음, 로그에 토큰·URL 안 남김).
- `update_banner.dart`: `UpdateBanner` — `hasUpdate`일 때만 홈 로고 아래에 한 줄 카드 "새 버전 X.Y.Z이 있어요 · **업데이트**". 누르면 `url_launcher`로 `url`을 **외부 앱**(Android: 브라우저 → 다운로드 → 알림에서 설치, iOS: TestFlight)으로 연다. `url`이 없으면 버튼 대신 "웹 /apps에서 받으세요".
- 더보기(`more_screen.dart`) "앱 버전" 줄: 값은 `1.0.0 (1)`(`appBuild`가 0이면 `dev`). 새 버전이 있으면 trailing에 `업데이트` TextButton(같은 동작). 사용자가 명시적으로 요청한 버튼.
- 앱이 APK를 직접 설치하는 기능(REQUEST_INSTALL_PACKAGES·FileProvider)은 넣지 않는다.

### 7. 릴리스 스크립트 `mobile/scripts/release-mobile.sh`

```
release-mobile.sh (android|ios|all) [--notes "…"] [--testflight-url URL] [--dry-run] [--allow-dirty]
```
1. 저장소 루트 확인, `git status --porcelain`이 비어 있지 않으면 중단(`--allow-dirty`로 예외).
2. 환경: `frontend/.env.local`에서 `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`, `mobile/.env.release`(gitignore)에서 `ASC_KEY_ID`·`ASC_ISSUER_ID`. iOS일 때만 후자 필수. 값은 절대 출력하지 않는다.
3. `flutter test`·`flutter analyze` 게이트(실패 시 중단).
4. pubspec에서 `version` 파싱 → `VERSION`·`BUILD`.
5. **android**: 스토리지에 같은 `apkPath`가 이미 있으면 중단("pubspec 빌드 번호를 올리세요"). `flutter build apk --release --dart-define=APP_VERSION=$VERSION --dart-define=APP_BUILD=$BUILD` → `curl`로 스토리지 업로드(`Content-Type: application/vnd.android.package-archive`) → `settings.mobile_release` 읽기·병합(python3 한 줄)·upsert.
6. **ios**: `flutter build ipa --release --dart-define=…`(기본 export = App Store Connect) → `xcrun altool --upload-app --type ios --file build/ios/ipa/*.ipa --apiKey $ASC_KEY_ID --apiIssuer $ASC_ISSUER_ID`(.p8는 `~/.private_keys/AuthKey_<KEY_ID>.p8`) → `mobile_release.ios` 갱신(+ `--testflight-url` 주어지면 저장).
7. 끝에 다음 할 일 출력: App Store Connect 처리 대기(≈10분) → 외부 그룹에 빌드 추가, Android는 `/apps`에서 바로 받힘, Teams 공지 문구 예시.
- `--dry-run`은 빌드·업로드 없이 각 단계와 쓸 값(비밀 제외)만 출력한다.
- 자동 버전 올리기·CI·Fastlane은 없다.

### 8. 문서·규칙

- 런북 `docs/mobile-app.md`: "배포" 절(최초 1회 준비: 키스토어·ASC 앱 등록·외부 그룹·공개 링크·API 키·`.env.release` / 매 릴리스: pubspec 버전 올리기 → 스크립트 → ASC에서 그룹에 추가 → 공지 / 90일 만료·키스토어 분실·MDM 사이드로딩 차단 대응)과 트러블슈팅 행.
- `.claude/rules/mobile.md`: 의존성 수 갱신(dev 1 추가), 버전은 pubspec만, 릴리스 스크립트 외 수동 업로드 금지, `mobile_release` 키 형식, 아이콘 재생성 방법.
- 메모리 `mobile-app-status.md` 갱신.

## 사용자가 직접 할 일(코드 밖)

1. App Store Connect: 번들 ID `com.innogrid.playground` 등록 → 앱 "이노그리드" 생성(SKU 임의) → TestFlight 테스트 정보(연락처, **심사용 로그인 계정**) → 외부 테스터 그룹 "이노그리드 구성원" + 공개 링크 켜기 → 링크를 `--testflight-url`로 전달.
2. App Store Connect API 키: `~/.private_keys`의 .p8 세 개 중 이 팀 것의 Key ID·Issuer ID를 `mobile/.env.release`에 적는다(없으면 Users and Access → Integrations에서 발급, 역할 App Manager).
3. 키스토어·비밀번호 1Password 백업.
4. 첫 iOS 빌드 업로드 뒤 Beta App Review 제출(외부 그룹에 처음 추가할 때 자동 제출). 앱이 Microsoft 로그인만 받으므로 **테넌트에 심사용 계정 1개**를 IT에 요청하거나, 심사 노트에 사내 전용임과 로그인 불가 사유를 적는다 — 이 스펙에서 가장 큰 외부 리스크.
5. 프론트 배포(`frontend/`에서 `vercel --prod`)는 구현자가 한다. Supabase 버킷 SQL 적용도 구현자가 한다.

## 오류 처리·보안

- service role 키는 운영자 Mac의 `frontend/.env.local`에만 있고 스크립트가 읽기만 한다. 출력·로그에 키·토큰·서명 URL을 찍지 않는다.
- API는 user 이상만. 서명 URL 600초. 버킷 비공개(익명 읽기 없음).
- 앱의 업데이트 확인 실패는 조용히 무시(기능 저하 없음). 웹 페이지는 오류 문구와 재시도.
- 키스토어·`key.properties`·`.env.release`는 gitignore. 커밋 전 `git status`로 확인한다.

## 테스트

- 프론트(vitest, `src/lib/__tests__/`): `mobile-release.test.ts`(파싱 — 정상·빈 값·깨진 JSON·음수 빌드·플랫폼 한쪽만; 응답 변환 — url null 규칙), `mobile-release-api.test.ts`(401·403·200 모양, 서명 URL 실패 시 `android.url=null`), `apps-page.test.tsx`(버튼 활성/비활성·안내 문구·오류 재시도).
- Flutter(`test/release/`): `release_check_test.dart`(parseRelease 플랫폼 선택·형식 오류, hasUpdate — appBuild 0이면 false, 같으면 false, 크면 true), `update_banner_test.dart`(업데이트 있을 때만 보임, url 없으면 안내 문구), `more_screen` 버전 줄(`1.0.0 (1)`·`dev`·업데이트 버튼). 기존 138개 유지.
- 스크립트: `--dry-run` 수동 확인. 자동 테스트 없음.

## 비범위

Google Play·App Store 공개, 앱 안 자체 설치, 관리자 릴리스 UI, CI/Fastlane, 자동 버전 올리기, 강제 업데이트, 릴리스 노트 이력 보관(`notes`는 최신 한 건), Android `split-per-abi`(APK 한 장).
