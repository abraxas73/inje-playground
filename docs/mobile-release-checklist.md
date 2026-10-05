# 모바일 앱 배포 — 운영자(강승욱) 할 일 체크리스트

2026-10-04 기준. 코드·서버 쪽은 끝났고, 아래는 **사람이 콘솔에서 해야 하는 일**만 모았다. 배경과 명령 설명은 런북 `docs/mobile-app.md` §배포(사내), 설계는 `docs/superpowers/specs/2026-10-04-mobile-release-design.md`.

## 이미 끝난 것(다시 할 필요 없음)
- [x] 웹 `/apps` 페이지·`GET /api/mobile/release` 운영 배포(`https://inje-playground.vercel.app/apps`)
- [x] Supabase 버킷 `mobile`(비공개 200MB) + 프로젝트 전역 파일 상한 200MB
- [x] Android 업로드 키스토어 생성(`mobile/android/upload-keystore.jks` + `key.properties`, gitignore)
- [x] **Android 1.0.0(빌드 1) 첫 릴리스 완료** — `/apps`에서 바로 받을 수 있음
- [x] 앱 아이콘(CI 가이드 `#006cdb` + CONNECTION 모티프), 앱 안 업데이트 배너·버튼, 릴리스 스크립트 `mobile/scripts/release-mobile.sh`
- [x] **1.1.0(빌드 3) 홈 브리핑 릴리스** — 2026-10-04 21:56: Android `/apps`·SharePoint `innogrid-app-1.1.0.apk`, iOS TestFlight 업로드(Delivery d263ecba…). 관리자 스위치는 `/admin/settings` "모바일 앱 — 홈 브리핑"
- [x] **1.1.1(빌드 4) 핫픽스 릴리스** — 2026-10-04 22:33: Android WebView 뒤로 가기 수정 + 브리핑 리뷰 반영(회의 판정·홈 탭 재수집·Teams 미연결). Android `/apps`·SharePoint `innogrid-app-1.1.1.apk`, iOS 업로드(Delivery ab68ea77…). **TestFlight 외부 그룹에는 최신 빌드(1.1.6 (9))를 쓴다**

## A. 지금 바로 (5분, Mac)
- [ ] **A1. 키스토어 백업** — 1Password에 항목 "이노그리드 앱 Android 업로드 키"를 만들고 두 파일을 첨부한다.
  - `~/Repos/inje-playground/mobile/android/upload-keystore.jks`
  - `~/Repos/inje-playground/mobile/android/key.properties` (비밀번호가 이 안에 있다)
  - 왜: 첫 APK가 이 키로 서명됐다. 잃으면 전 직원이 앱을 지우고 다시 설치해야 한다.
- [x] **A2. SharePoint 폴더 지정** — 2026-10-04 완료: Teams 사이트 `msteams_3713b0`의 `Shared Documents/Share` 폴더, `innogrid-app-1.0.0.apk` 업로드됨. 바꾸려면 아래 명령으로 다시 지정.
  - (원래 절차)  — SharePoint에서 APK 사본을 둘 폴더(예: 사내 공유 문서 → `앱`)를 열고 **링크 복사** → `cd ~/Repos/inje-playground && mobile/scripts/release-mobile.sh sharepoint-folder "<복사한 링크>"` → 이어서 지금 올라간 1.0.0을 바로 올리려면 `mobile/scripts/release-mobile.sh sharepoint` (파일명 `innogrid-app-1.0.0.apk`). 조건: 웹 설정의 Microsoft 계정 연결(이미 돼 있음)과 그 계정의 폴더 쓰기 권한.
- [ ] **A3. Teams 공지(Android 먼저 열어도 되면)** — 예시: `[이노그리드 앱] Android 먼저 배포합니다. 설치: https://inje-playground.vercel.app/apps (로그인 후 'APK 받기' → 알림에서 열기 → 설치). iPhone은 TestFlight 준비 중.`

## B. Apple — 한 번만 (약 30분 + 심사 대기 하루 안팎)
사용 계정: 개인 Apple Developer 계정(팀 `LME2TNRC9G`, 이 Mac에 Apple Distribution 인증서 있음).
**화면별 상세 안내(입력값·메뉴 경로·막힐 때): `docs/app-store-connect-guide.md`.**

- [x] **B1. 번들 ID 등록** — https://developer.apple.com/account → Certificates, Identifiers & Profiles → **Identifiers** → `+` → App IDs → App → Description `Innogrid App`, Bundle ID **Explicit** `com.innogrid.playground` → Register. 이미 목록에 있으면(Xcode가 기기 실행 때 등록했을 수 있음) 건너뛴다.
- [x] **B2. 앱 생성** — https://appstoreconnect.apple.com → 나의 앱 → `+` → 신규 앱: 플랫폼 iOS, 이름 `이노그리드`, 기본 언어 한국어, 번들 ID에서 B1 항목 선택, SKU `innogrid-app`, 사용자 액세스 전체 → 생성.
- [x] **B3. API 키** — App Store Connect → **사용자 및 액세스 → 통합(Integrations) → App Store Connect API → 팀 키**.
  - 먼저 목록의 **Key ID**를 이 Mac의 파일과 대조한다: `~/.private_keys/AuthKey_3F5XD4C5NC.p8`, `~/.private_keys/AuthKey_6VP5MG95MK.p8`, `~/private_keys/AuthKey_RQ5YYPVUX4.p8`. 일치하는 게 있고 역할이 App Manager 이상이면 그걸 쓴다(필요하면 `~/private_keys`의 파일을 `~/.private_keys/`로 옮긴다).
  - 없으면 `+` → 이름 `release-mobile`, 액세스 **App Manager** → 생성 → **API 키 다운로드(1회만 가능)** → 받은 `AuthKey_<KEY_ID>.p8`을 `~/.private_keys/`에 둔다.
  - 같은 페이지 상단의 **Issuer ID**를 복사한다.
- [x] **B4. `.env.release` 작성** — `~/Repos/inje-playground/mobile/.env.release`(gitignore됨, 저장소에 안 올라감):
  ```
  ASC_KEY_ID=여기에_Key_ID
  ASC_ISSUER_ID=여기에_Issuer_ID
  ```
  확인: `cd ~/Repos/inje-playground && mobile/scripts/release-mobile.sh ios --dry-run --allow-dirty` → 단계가 쭉 찍히고 오류 없이 끝나야 한다.
- [ ] **B5. 심사용 로그인 계정** — 앱이 Microsoft 조직 로그인만 받으므로 Beta App Review용 계정이 필요하다. IT에 테넌트 계정 1개(예: `appreview@innogrid.com`, 심사 기간 MFA 예외)를 요청한다. 받은 뒤 그 계정으로 웹 `https://inje-playground.vercel.app`에 한 번 로그인하고 `/admin/users`에서 역할이 **user**인지 확인한다(guest면 앱 메뉴가 거의 안 보인다).
- [x] **B6. 첫 iOS 업로드** — 2026-10-04 20:11 완료(`1.0.0 (1)`, Delivery UUID b1b0e8e0…). 아래는 다음 릴리스 때 참고.
  - (원래 절차)  — 작업 트리가 깨끗한 상태에서:
  ```
  cd ~/Repos/inje-playground && mobile/scripts/release-mobile.sh ios --notes "첫 사내 배포"
  ```
  빌드 + 업로드 10분 안팎. Xcode 서명 오류가 나면 `open mobile/ios/Runner.xcworkspace` → Runner → Signing & Capabilities → Team이 `LME2TNRC9G`(Automatic)인지 본다.
- [ ] **B7. TestFlight 그룹·심사 제출 — 최신 빌드 1.1.6 (9)를 그룹에 추가** — App Store Connect → INNOGRID → **TestFlight** 탭. (이전 빌드는 건너뛰고 최신 1.1.6 (9)를 쓴다.)
  1. 빌드가 "처리 중"에서 벗어날 때까지 기다린다(≈10분, 메일도 온다).
  2. **외부 테스트** → `+` → 그룹 이름 `이노그리드 구성원` → 생성.
  3. 그룹 → **빌드 추가** → 방금 빌드 선택.
  4. **테스트 정보**: 베타 앱 설명 `이노그리드 구성원 전용 사내 앱`, 피드백 이메일(본인), 연락처(본인 이름·전화·이메일), **로그인 필요** 체크 → B5 계정 ID·비밀번호, 메모 `사내 구성원 전용. Microsoft 조직 계정으로만 로그인합니다. 외부 사용자 기능 없음.`
  5. 제출 → 첫 빌드는 **Beta App Review**(보통 하루 안팎). 승인 메일을 기다린다.
- [ ] **B8. 공개 링크 켜고 저장** — 승인 뒤 그룹 `이노그리드 구성원` → **공개 링크 활성화** → 링크 복사(`https://testflight.apple.com/join/XXXXXXXX`) → 저장:
  ```
  cd ~/Repos/inje-playground && mobile/scripts/release-mobile.sh link --testflight-url https://testflight.apple.com/join/XXXXXXXX
  ```
  이 순간부터 웹 `/apps`의 "TestFlight에서 열기" 버튼과 iOS 앱 배너가 켜진다.
- [ ] **B9. Teams 공지(iPhone)** — `iPhone: App Store에서 TestFlight 설치 → https://inje-playground.vercel.app/apps 에서 'TestFlight에서 열기'`.

## C. 매 릴리스 (5~15분)
- [ ] `mobile/pubspec.yaml`의 `version: X.Y.Z+N`에서 **`+N`을 1 올리고** 커밋·푸시.
- [ ] `mobile/scripts/release-mobile.sh all --notes "변경 요약"` (Android만/iOS만이면 `android`/`ios`).
- [ ] iOS는 App Store Connect → TestFlight → 그룹 `이노그리드 구성원` → 빌드 추가(두 번째부터는 심사 없음). 추가 전까지 iOS 앱 배너가 먼저 뜰 수 있지만 TestFlight가 자동 갱신하므로 무해.
- [ ] Android는 SharePoint 사본(`innogrid-app-X.Y.Z.apk`)이 자동으로 올라간다. "실패"가 보이면 `mobile/scripts/release-mobile.sh sharepoint`.
- [ ] 스크립트가 마지막에 출력한 공지 문구를 Teams에 올린다.

## D. 분기마다
- [ ] TestFlight 빌드는 **90일 만료** — 만료 전에 `+N`을 올려 `release-mobile.sh ios` 한 번(그룹 추가 포함). 만료되면 iPhone에서 앱이 열리지 않는다.

## E. 결정이 필요한 것(급하지 않음)
- [ ] 앱 UI 팔레트(`#0B1A3A` 네이비·`#0441FF` 블루)를 CI 전용색(`#002447`·`#006cdb`)으로 맞출지. 아이콘은 이미 CI 색이다.
- [ ] 회사 MDM이 Android 사이드로딩을 막는 기기가 있으면 Google Play 비공개 트랙 검토(현재 비범위).
