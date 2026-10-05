# Google Play Console에서 할 일 — Android 내부 테스트

2026-10-05. 운영자가 **Play Console에서 직접 클릭해야 하는 일**만, 화면 순서대로 적었다. iPhone 쪽은 `docs/app-store-connect-guide.md`에 있다.
지금의 배포 경로는 **그대로 둔다**: `/apps` APK, SharePoint 사본(`innogrid-app-X.Y.Z.apk`), `release-mobile.sh android|all`. Play 내부 테스트는 **추가 경로**다.
Play 스토어로 설치하면 Play 프로텍트 경고가 뜨지 않고, 업데이트도 자동으로 된다.

## 0. 준비물
| 항목 | 값 |
|---|---|
| 개발자 계정 | 이미 있음(Play Console 로그인 가능) |
| 패키지 이름 | `com.innogrid.playground` — Play 전체에서 하나뿐이어야 한다(1단계에서 확인) |
| 올릴 파일 | **AAB**(앱 번들). APK는 Play에 새 앱으로 올릴 수 없다. `mobile/scripts/release-mobile.sh aab` → `mobile/build/innogrid-<버전>+<빌드>.aab` |
| 서명 키 | `mobile/android/upload-keystore.jks` + `key.properties`(비밀번호·alias) — 1Password "이노그리드 앱 Android 업로드 키"에 백업돼 있다 |
| 인증서 SHA-256 | `13:96:8D:49:BA:13:F8:FF:64:1D:25:FE:22:96:CF:55:D8:C1:A9:61:5A:EB:4F:15:4C:05:31:7A:C1:62:1D:C8` (지금 APK와 AAB가 같은 인증서 — 2026-10-05 확인) |
| 개인정보 처리방침 URL | `https://inje-playground.vercel.app/privacy` |
| 앱이 쓰는 권한 | 인터넷, 위치(뭐 먹지 — 주변 식당), 마이크(이노봇 🎤 말하기) |
| 테스터 | 최대 **100명**(지금 87명). 각자 **폰의 Play 스토어에 로그인된 Google 계정 이메일**이 필요하다(회사 Microsoft 메일은 Google 계정으로 만든 경우에만 된다) |

## 1. 앱 만들기 (play.google.com/console, 3분)
1. Play Console → **모든 앱** → **앱 만들기**.
2. 입력:
   - 앱 이름 `이노그리드`
   - 기본 언어 **한국어 – ko-KR**
   - **앱**, **무료**
   - 선언 두 개(개발자 프로그램 정책, 미국 수출 법규)에 체크
   - **앱 만들기**
3. 패키지 이름은 첫 AAB를 올리는 순간 정해진다(3단계). 이미 누가 쓰고 있으면 그때 오류가 난다 → 7단계 표 참고.

## 2. 앱 서명 방식 정하기 — **가장 중요한 선택**
Play는 올린 AAB를 다시 서명해서 배포한다(Play 앱 서명). 처음 한 번 **어떤 키로 서명할지** 고르는데, 나중에 바꿀 수 없다.

| 선택 | 결과 |
|---|---|
| **A. 지금 쓰는 키를 내보내 올리기 (추천)** — "Java 키 저장소에서 키 내보내기 및 업로드" | Play 빌드와 SharePoint·`/apps` APK의 서명이 **같다**. 어느 경로로 설치했든 서로 업데이트로 이어진다 |
| B. Google이 만든 키 사용(기본값) | 서명이 **달라진다**. SharePoint APK를 깐 사람은 앱을 **지우고**(로그인·설정 초기화) Play에서 다시 설치해야 한다. 이후 두 경로를 섞어 쓸 수 없다 |

A를 고르는 방법은 3단계 중간에 나오는 "앱 서명" 화면에서:
1. **"다른 앱 서명 키 사용"**(또는 "앱 서명 키 변경") → **"Java 키 저장소에서 내보내기 및 업로드"**를 고른다.
2. 화면이 주는 **PEPK 도구(`pepk.jar`)**와 **암호화 공개 키(`encryption_public_key.pem`)**를 내려받는다.
3. 화면에 나오는 명령을 그대로 복사한다. 경로만 바꿔 Mac 터미널에서 실행한다. 모양은 이렇다.
   ```
   cd ~/Repos/inje-playground/mobile/android
   java -jar ~/Downloads/pepk.jar --keystore=upload-keystore.jks --alias=<key.properties의 keyAlias> \
     --output=$HOME/Downloads/play-signing-key.zip --include-cert --rsa-aes-encryption \
     --encryption-key-path=$HOME/Downloads/encryption_public_key.pem
   ```
   - 비밀번호 두 번(키 저장소, 키)은 `key.properties`의 값을 **터미널에만** 입력한다. 채팅·문서에 붙이지 않는다.
   - 실행에는 Java가 필요하다. 없으면 Android Studio에 들어 있는 JDK를 쓴다: `"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java"`.
4. 만든 `play-signing-key.zip`을 그 화면에 올리고 **저장**한다.
5. 업로드 키를 따로 등록하라는 칸은 비워 둔다. 같은 키가 업로드 키로도 쓰인다.
6. 확인: **설정 > 앱 무결성 > 앱 서명**의 "앱 서명 키 인증서" SHA-256이 0단계 값과 같아야 한다.

## 3. 내부 테스트 첫 버전 올리기 (10분)
1. Mac에서 AAB를 만든다. 업로드는 하지 않는 빌드 전용 명령이고, 테스트·분석을 먼저 돈다.
   ```
   cd ~/Repos/inje-playground && mobile/scripts/release-mobile.sh aab
   ```
   끝에 `mobile/build/innogrid-1.3.2+16.aab (56M)` 같은 경로가 찍힌다.
2. Play Console → 이노그리드 → 왼쪽 **테스트 및 출시 > 테스트 > 내부 테스트** → **새 버전 만들기**.
3. 처음이면 "앱 서명" 단계가 먼저 나온다 → 2단계 A대로 진행한다.
4. **App Bundle** 칸에 1의 `.aab`를 끌어다 놓는다. 업로드가 끝나면 버전 이름이 `16 (1.3.2)`처럼 자동으로 채워진다.
5. 출시 노트를 적는다. 예:
   ```
   <ko-KR>
   이노봇 🎤 말하기, 선택지 [실행], 🔊 읽어 주기
   </ko-KR>
   ```
6. **다음** → 오류·경고 목록을 확인한다.
   - "앱 콘텐츠" 관련 오류로 출시가 막히면 4단계를 먼저 채운다.
   - 경고(노란색)는 내부 테스트를 막지 않는다.
7. **저장** → **내부 테스트로 출시 시작**(또는 "출시 검토" → "출시"). 내부 테스트는 심사 대기가 없고, 보통 몇 분 안에 테스터에게 보인다.

## 4. 앱 콘텐츠 선언 (콘솔이 막는 것만, 10~20분)
왼쪽 **정책 및 프로그램 > 앱 콘텐츠**(또는 대시보드의 "앱 설정" 할 일). 내부 테스트에는 스토어 등록정보(설명·스크린샷)가 필요 없다. 콘솔이 "필수"로 표시하는 항목만 채운다.

| 항목 | 입력 |
|---|---|
| 개인정보처리방침 | `https://inje-playground.vercel.app/privacy` |
| 앱 액세스 | "일부 기능 제한"(로그인 필요) → 안내: "이노그리드 임직원 Microsoft 조직 계정으로만 로그인할 수 있는 사내 앱입니다." 리뷰용 계정을 묻는 칸은 내부 테스트 단계에선 비워 두고, 막히면 IT에 받은 리뷰 계정(App Store 가이드 3단계와 같은 계정)을 적는다 |
| 광고 | 광고 없음 |
| 콘텐츠 등급 | 설문 → 카테고리 "유틸리티·생산성·커뮤니케이션 등" → 폭력·성적 내용·도박 등 모두 "아니요" → 저장 → 등급 확인 |
| 타겟층 | 18세 이상만 |
| 데이터 보안 | 아래 표 |
| 정부 앱·금융 기능·건강 앱 | 해당 없음 |

데이터 보안은 정직하게 적는다. 애매하면 "수집함"으로 적는 쪽이 안전하다.

| 데이터 | 수집 | 목적 | 비고 |
|---|---|---|---|
| 이름·이메일 주소 | 예 | 계정 관리·앱 기능 | Microsoft 로그인 프로필 |
| 대략적·정확한 위치 | 예(앱 사용 중에만) | 앱 기능 | 뭐 먹지 주변 식당. 서버에 저장 안 함 |
| 오디오(음성) | 기기 음성 인식 엔진이 처리 | 앱 기능 | 앱은 녹음을 저장·전송하지 않는다. 단, OS 인식기가 Google 서버를 쓸 수 있으니 "수집함·일시 처리"로 적는다 |
| 앱 활동(앱 안 메시지·검색) | 예 | 앱 기능 | 이노봇 대화는 Claude 중계만, 서버에 저장 안 함 |
| 암호화 전송 | 예 | — | HTTPS |
| 데이터 삭제 요청 | 가능 | — | 관리자 `/admin/users`에서 삭제 |

## 5. 테스터 넣고 초대하기 (5분 + 테스터 각자 2분)
1. **내부 테스트 > 테스터** 탭 → **이메일 목록 만들기** → 이름 `이노그리드 구성원` → 이메일을 붙여 넣는다. 쉼표나 줄바꿈으로 구분하고, CSV 업로드도 된다 → 저장.
2. 같은 탭의 **피드백 URL 또는 이메일**에 운영자 메일을 적는다.
3. 아래쪽 **테스터 참여 방법 > 웹에서 참여 링크 복사**. 형태는 `https://play.google.com/apps/internaltest/…`이다.
4. 테스터에게 Teams로 보낼 안내:
   > 폰에서 아래 링크를 여세요(Play 스토어에 로그인된 Google 계정 = 제출한 이메일). "테스터 되기" → "Google Play에서 다운로드" → 설치.
   > 이미 SharePoint·웹(/apps)에서 받은 앱이 있으면 지우지 말고 그대로 "업데이트"를 누르세요.
5. SharePoint APK를 이미 설치한 사람:
   - 2단계에서 A를 골랐다면 Play에서 **업데이트**로 이어진다. 단, Play에 올린 빌드 번호가 설치된 것과 같거나 높아야 한다.
   - B를 골랐다면 "앱 설치 안 됨" 또는 "충돌"이 뜬다. 그러면 앱을 지우고 Play에서 설치한다.

## 6. 이후 업데이트 루틴
1. 평소처럼 pubspec `version: X.Y.Z+N`을 올리고 `mobile/scripts/release-mobile.sh all --notes "…"`를 실행한다. `/apps`, SharePoint, iOS는 **지금과 동일**하다.
2. 이어서 `mobile/scripts/release-mobile.sh aab`를 실행하고 Play Console → 내부 테스트 → **새 버전 만들기** → AAB 올리기 → 출시. 테스터 폰은 Play 자동 업데이트로 받는다.
3. 빌드 번호(+N)는 APK와 Play가 같이 쓴다. Play는 **이전에 Play에 올린 번호보다 큰 번호**만 받는다. 매 릴리스마다 +N을 올리므로 따로 신경 쓸 일은 없다.

## 6-A. 자동 업로드 설정 (한 번, 15분) — 이후 `release-mobile.sh android|all`이 Play에도 올린다
TestFlight처럼 스크립트가 AAB를 만들어 **내부 테스트 트랙에 바로 출시**한다(Google Play Developer API, 서비스 계정). `/apps`·SharePoint는 그대로이고 그 뒤에 Play가 붙는다. 키가 없으면 Play 단계만 건너뛴다.
1. https://console.cloud.google.com → 위쪽 프로젝트 선택 → **새 프로젝트** `innogrid-play`(이미 쓰는 프로젝트가 있으면 그걸 써도 된다).
2. **API 및 서비스 → 라이브러리** → `Google Play Android Developer API` 검색 → **사용**.
3. **IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기** → 이름 `play-release` → 역할은 비워 두고 **완료**.
4. 만든 계정 → **키** 탭 → **키 추가 → 새 키 만들기 → JSON** → 내려받은 파일을 `~/.private_keys/play-release.json`으로 옮긴다(`chmod 600`). **git·채팅·문서에 붙이지 않는다.**
   - 조직 정책 때문에 "서비스 계정 키 생성이 사용 중지됨"이 뜨면 Google Workspace/Cloud 관리자에게 이 프로젝트만 예외를 요청한다.
5. Play Console → **사용자 및 권한 → 새 사용자 초대** → 이메일에 서비스 계정 주소(`play-release@<프로젝트>.iam.gserviceaccount.com`) → **앱 권한 → 앱 추가 → 이노그리드** → 권한 **"테스트 트랙에 앱 출시"**(+ "앱 정보 보기") → 초대.
6. `mobile/.env.release`에 한 줄 추가:
   ```
   PLAY_SERVICE_ACCOUNT_JSON=~/.private_keys/play-release.json
   ```
7. 확인: `mobile/scripts/release-mobile.sh play` — "올림: versionCode N", "내부 테스트 트랙에 출시됨"이 보이면 끝. 이미 Play에 올린 번호면 "version code … already used" 오류 → pubspec +N을 올려 다음 릴리스 때.
   - 권한이 반영되는 데 수 분~하루 걸릴 수 있다(403 "The caller does not have permission"이면 잠시 뒤 다시).

## 6-B. 앱 서명 — Google 생성 키로 통일 (2026-10-06 결정 B)
- 첫 버전 업로드 때 서명 선택 화면이 나오지 않아 Google이 앱 서명 키를 만들었다(SHA-256 `18:6D:B8:8B:…:48:9D`). 업로드 키는 우리 키(`13:96:8D:…:1D:C8`).
- 키를 바꾸지 않고(결정 B) **`/apps`·SharePoint도 Google이 서명한 universal APK를 배포**한다 — `release-mobile.sh android|all`이 AAB를 Play에 올린 뒤 Play가 만든 APK(`generatedApks`)를 받아 스토리지·SharePoint에 올린다. 그래서 Play·`/apps`·SharePoint 어느 경로로 설치해도 서로 업데이트된다.
- **1.3.3 이하(우리 업로드 키로 서명한 APK)를 설치한 사람은 1.3.4로 넘어갈 때 한 번 앱을 지우고 다시 설치**해야 한다(로그인·설정 초기화). 이후로는 계속 업데이트로 이어진다.
- 서비스 계정 키(§6-A)가 없으면 스크립트는 예전처럼 로컬 키 APK를 올리고 "서명이 달라 서로 업데이트되지 않음" 경고를 낸다.
- 사이드로드(웹·SharePoint) 설치의 Play 프로텍트 경고는 Play 등록 앱과 같은 서명이라 줄 수 있지만 보장되지 않는다. 경고 없이 받으려면 Play 내부 테스트 링크로 설치한다.

## 7. 자주 막히는 곳
| 증상 | 원인 | 조치 |
|---|---|---|
| AAB 업로드 시 "이 패키지 이름은 이미 사용 중" | 다른 개발자가 `com.innogrid.playground`를 등록함 | 패키지 이름을 바꿔야 한다(예 `com.innogrid.app`). 앱 코드·딥링크·서명 영향이 있으니 개발 쪽에 요청 |
| "디버그 모드로 서명된 APK/번들" | `key.properties` 없이 빌드됨 | `mobile/android/key.properties`·`upload-keystore.jks`를 1Password에서 복원한 뒤 `release-mobile.sh aab` 다시 실행(스크립트가 파일이 없으면 미리 막는다) |
| "버전 코드 N은 이미 사용됨" | 같은 +N을 Play에 두 번 올림 | pubspec +N을 올리고 다시 빌드 |
| "업로드 키가 잘못됨"(인증서 SHA 불일치) | 2단계에서 등록한 키와 다른 키로 서명 | 0단계 SHA-256과 `keytool -printcert -jarfile mobile/build/innogrid-….aab` 결과를 비교한다 |
| 테스터가 링크를 열면 "앱을 찾을 수 없음" | ① Play 스토어 계정이 목록 이메일과 다름 ② 출시 직후 전파 중 | ① 폰 Play 스토어 오른쪽 위 계정 확인·전환 ② 10~30분 뒤 다시 |
| 출시 버튼이 비활성 | 4단계 필수 선언 누락 | 대시보드 "앱 설정" 할 일에서 빨간 항목부터 채운다 |
| "대상 API 수준" 경고 | Play 최소 targetSdk 정책이 매년 8월에 오름 | 내부 테스트는 막히지 않는다. Flutter 업그레이드 때 함께 해결(`targetSdk = flutter.targetSdkVersion`) |
| 개인 개발자 계정 "비공개 테스트 12명·14일" 안내 | 2023-11 이후 만든 **개인** 계정이 **프로덕션 공개** 전에 거쳐야 하는 조건 | **내부 테스트와 무관**하다. 스토어 공개는 하지 않으므로 무시해도 된다 |
