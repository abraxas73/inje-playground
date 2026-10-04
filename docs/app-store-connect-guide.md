# App Store Connect에서 할 일 — iPhone 사내 배포(TestFlight 공개 링크)

2026-10-04. 운영자(강승욱)가 Apple 쪽 콘솔에서 **직접 클릭해야 하는 일**만, 화면 순서대로. 전체 할 일 목록은 `docs/mobile-release-checklist.md`, 명령·배경은 `docs/mobile-app.md` §배포.

## 0. 준비물(이미 있는 것)
| 항목 | 값 |
|---|---|
| Apple 계정 | 개인 유료 Apple Developer 계정, 팀 ID `LME2TNRC9G` (이 Mac에 **Apple Distribution** 인증서 있음 — 서명 걱정 없음) |
| 번들 ID | `com.innogrid.playground` |
| 앱 이름 | `이노그리드` (App Store 전역에서 이름이 겹치면 `이노그리드 앱`) |
| 수출 규정 | 앱에 `ITSAppUsesNonExemptEncryption=false`가 들어 있어 업로드마다 묻지 않는다 |
| 개인정보 처리방침 URL | `https://inje-playground.vercel.app/privacy` (외부 테스트 정보에 적는 용도) |
| 심사용 로그인 계정 | **아직 없음** — 3단계에서 IT에 요청(앱이 Microsoft 조직 로그인만 받는다) |

이 Mac의 App Store Connect API 키 후보: `~/.private_keys/AuthKey_3F5XD4C5NC.p8`, `~/.private_keys/AuthKey_6VP5MG95MK.p8`, `~/private_keys/AuthKey_RQ5YYPVUX4.p8` — 4단계에서 Key ID를 대조한다.

## 1. 번들 ID 등록 (developer.apple.com, 2분)
1. https://developer.apple.com/account → **Certificates, Identifiers & Profiles** → 왼쪽 **Identifiers**.
2. 목록에 `com.innogrid.playground`가 이미 있으면(Xcode가 기기 실행 때 `XC com innogrid playground`로 만들었을 수 있음) 이 단계는 끝.
3. 없으면 `+` → **App IDs** → Continue → **App** → Continue → Description `Innogrid App`, Bundle ID **Explicit** `com.innogrid.playground` → Capabilities는 아무것도 켜지 않음 → Continue → **Register**.

## 2. 앱 만들기 (appstoreconnect.apple.com, 3분)
1. https://appstoreconnect.apple.com → **나의 앱** → 왼쪽 위 `+` → **신규 앱**.
2. 플랫폼 **iOS** 체크, 이름 `이노그리드`(겹치면 `이노그리드 앱`), 기본 언어 **한국어**, 번들 ID에서 `Innogrid App - com.innogrid.playground` 선택, SKU `innogrid-app`, 사용자 액세스 **전체 액세스** → **생성**.
3. 생성된 앱의 **App 정보**는 지금 손대지 않아도 된다(스토어 공개를 안 하므로 스크린샷·설명·가격 불필요).

## 3. 심사용 계정 요청 (IT, 하루 전에 미리)
외부 테스터 그룹의 **첫 빌드**는 Beta App Review를 받는데, 리뷰어가 앱을 열어 로그인해 본다. 앱은 Microsoft 조직 계정만 받으므로:
1. IT에 테넌트 계정 1개 요청 — 예: `appreview@innogrid.com`, 심사 기간(1~2주) MFA·조건부 접근 예외, 비밀번호 고정.
2. 받은 계정으로 PC 브라우저에서 `https://inje-playground.vercel.app`에 한 번 로그인한다(처음 로그인 때 프로필이 만들어진다).
3. 관리자로 `/admin/users`에 들어가 그 계정의 역할이 **user**인지 확인한다(guest면 메뉴가 거의 안 보여 리뷰어가 "앱이 비었다"고 볼 수 있다).

## 4. API 키 — 스크립트가 업로드할 때 쓴다 (5분)
1. App Store Connect → 오른쪽 위 계정 → **사용자 및 액세스** → 상단 **통합(Integrations)** 탭 → **App Store Connect API** → **팀 키(Team Keys)**.
   - 처음이면 "액세스 요청(Request Access)" 버튼이 먼저 뜬다 → 약관 동의 → 몇 분 뒤 다시.
2. 목록의 **Key ID**를 0단계의 세 파일 이름과 대조한다. 일치하는 키가 있고 역할이 **App Manager** 이상이면 그걸 쓴다(파일이 `~/private_keys`에 있으면 `~/.private_keys/`로 옮긴다).
3. 없으면 `+`(키 생성) → 이름 `release-mobile`, 액세스 **App Manager** → 생성 → **API 키 다운로드**. **다운로드는 딱 한 번만 가능**하다 — `AuthKey_<KEY_ID>.p8`을 `~/.private_keys/`에 둔다.
4. 같은 페이지 상단의 **Issuer ID**(UUID)를 복사한다.
5. `~/Repos/inje-playground/mobile/.env.release`에 적는다(이미 `OPERATOR_EMAIL=` 줄이 있다; 이 파일은 git에 안 올라간다):
   ```
   OPERATOR_EMAIL=seunguk.kang@innogrid.com
   ASC_KEY_ID=여기에_Key_ID
   ASC_ISSUER_ID=여기에_Issuer_ID
   ```
6. 확인: `cd ~/Repos/inje-playground && mobile/scripts/release-mobile.sh ios --dry-run --allow-dirty` → "버전 … dry-run"부터 "다음 할 일"까지 오류 없이 찍히면 된다.

## 5. 첫 빌드 업로드 (Mac, 10~15분)
```
cd ~/Repos/inje-playground && git status --short   # 비어 있어야 한다(아니면 커밋)
mobile/scripts/release-mobile.sh ios --notes "첫 사내 배포"
```
- 스크립트가 테스트 → `flutter build ipa` → `xcrun altool --upload-app`을 돌린다. 끝에 "Delivery UUID" 또는 "완료"가 보이면 성공.
- 서명 오류가 나면 `open mobile/ios/Runner.xcworkspace` → Runner 타깃 → **Signing & Capabilities** → Team `LME2TNRC9G`, Automatically manage signing 체크 → 다시 실행.
- 터미널에서 `mobile/scripts/asc-builds.sh`를 치면 App Store Connect API로 빌드 목록·처리 상태(`PROCESSING`→`VALID`)를 바로 볼 수 있다(앱 레코드·빌드 0개면 "아직 없음").
- App Store Connect → 이노그리드 → **TestFlight** 탭 → iOS 빌드 목록에 `1.0.0 (N)`이 **처리 중**으로 나타난다. 10~30분 뒤 "빌드 처리 완료" 메일이 온다. 수출 규정 경고(노란 느낌표)는 뜨지 않아야 한다(뜨면 `Info.plist`의 `ITSAppUsesNonExemptEncryption` 확인).

## 6. TestFlight 테스트 정보 (3분)
TestFlight 탭 → 왼쪽 **일반 정보 → 테스트 정보**:
| 항목 | 입력 |
|---|---|
| 베타 앱 설명 | `이노그리드 구성원 전용 사내 앱. 뭐 먹지·사다리·커피 타임·그룹웨어(아마란스) 요약을 제공합니다.` |
| 피드백 이메일 | 본인 이메일 |
| 마케팅 URL | 비움 |
| 개인정보 처리방침 URL | `https://inje-playground.vercel.app/privacy` |
| **베타 앱 심사 정보** — 연락처 | 본인 이름·전화·이메일 |
| **로그인 필요** | 체크 → 사용자 이름·비밀번호에 3단계 심사용 계정 |
| 메모 | `사내 구성원 전용 앱입니다. 로그인은 Microsoft 조직 계정(innogrid.com)으로만 됩니다. 제공한 계정으로 로그인하면 홈·뭐 먹지·사다리·커피 타임을 쓸 수 있습니다. 외부 사용자 기능·결제 없음.` |

## 7. 외부 테스터 그룹 만들고 심사 제출 (5분 + 심사 하루 안팎)
1. TestFlight 탭 → 왼쪽 **외부 테스트** 옆 `+` → 그룹 이름 `이노그리드 구성원` → 생성.
2. 그룹 화면 → **빌드** 탭 → `+` → 처리 완료된 `1.0.0 (1)` 선택 → 다음.
3. **테스트할 내용**: `첫 사내 배포 — 뭐 먹지·사다리·커피 타임·아마란스(미결 결재·출퇴근·일정·메일·게시판)` → 제출.
4. 상태가 **심사 대기 중 → 심사 중 → 테스트 준비 완료(승인)** 로 바뀐다. 보통 24~48시간. 거절 메일이 오면 대부분 로그인 문제 → 3단계 계정·메모를 보완해 다시 제출.
5. 테스터 개별 초대는 하지 않는다(공개 링크를 쓴다).

## 8. 공개 링크 켜고 저장 (2분)
1. 승인 뒤 그룹 `이노그리드 구성원` → **테스터** 탭 → **공개 링크 활성화** → 테스터 한도는 기본값(최대 10,000) 그대로 → 링크 복사 (`https://testflight.apple.com/join/XXXXXXXX`).
2. Mac에서 저장:
   ```
   cd ~/Repos/inje-playground && mobile/scripts/release-mobile.sh link --testflight-url https://testflight.apple.com/join/XXXXXXXX
   ```
   이 순간부터 웹 `https://inje-playground.vercel.app/apps`의 "TestFlight에서 열기" 버튼과 iOS 앱 안 배너 링크가 켜진다.
3. Teams 공지: `iPhone: App Store에서 TestFlight 앱 설치 → https://inje-playground.vercel.app/apps 에서 'TestFlight에서 열기' → 설치`.

## 9. 다음 빌드부터 (매번 3분)
1. Mac: `pubspec.yaml`의 `+N` 올리고 커밋 → `mobile/scripts/release-mobile.sh all --notes "…"` (또는 `ios`).
2. App Store Connect → TestFlight → 처리 완료 기다림 → 그룹 `이노그리드 구성원` → 빌드 `+` → 새 빌드 추가 → "테스트할 내용" → **저장**. 두 번째 빌드부터는 보통 심사 없이 바로 배포된다(기능이 크게 바뀌면 다시 심사될 수 있음).
3. 테스터의 TestFlight 앱이 자동으로 업데이트한다(TestFlight 설정 "자동 업데이트" 기본 켜짐).

## 10. 잊으면 안 되는 것
- **빌드 90일 만료**: 그룹에 마지막으로 추가한 빌드가 90일이 지나면 모든 iPhone에서 앱이 열리지 않는다. 분기마다 한 번은 `+N` 올려 다시 올린다. App Store Connect가 만료 2주 전쯤 메일을 보낸다.
- **개발자 멤버십 연 갱신($99)**: 만료되면 TestFlight 배포가 멈춘다. developer.apple.com → Membership에서 만료일 확인.
- **약관 갱신**: Apple이 Program License Agreement를 바꾸면 Account Holder가 developer.apple.com에서 동의할 때까지 업로드가 "Unable to authenticate"류 오류로 실패한다 → 동의 후 재실행.
- 업로드 뒤 "ITMS-90xxx … Missing Push Notification Entitlement" 같은 **경고 메일**은 무시해도 된다(푸시 안 씀). **오류** 메일(Invalid Binary)만 조치.
- `ITMS-90129 … bundle name or display name that is already taken`: 바이너리의 `CFBundleName`/`CFBundleDisplayName`이 App Store의 다른 앱 이름과 겹친 것(2026-10-04 Flutter 기본 `playground`로 1회 발생 → `INNOGRID`로 고침). 빌드는 등록되지 않으므로 이름을 고치고 `+N` 올려 재업로드.
- 외부 그룹에 추가하기 전까지 iOS 앱 배너가 먼저 "새 버전"을 띄울 수 있다(스크립트가 업로드 직후 버전을 기록). TestFlight가 자동 갱신하므로 무해.
