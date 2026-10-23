# 릴리스·서명 키 목록과 백업·이관 계획

INNOCREW 앱 5종(웹·iOS·Android·macOS·Windows)의 릴리스에 필요한 키는 지금 **운영자 Mac 한 대**에 모여 있다(2026-10-23 점검). 이 문서는 키마다 어디에 있는지, 잃으면 무엇이 멈추는지, 무엇을 어디에 백업할지를 적는다. **값은 여기 적지 않는다** — 이름·위치만.

## 1. 목록

| # | 키 | 위치(운영자 Mac) | 쓰는 곳 | 잃으면 | 대체 가능? |
|---|---|---|---|---|---|
| 1 | **데스크톱 업데이트 서명 키**(Ed25519, macOS·Windows 각 1) | Keychain 일반 암호 `com.innogrid.innocrew.desktop-update.ed25519`, 계정 `macos`/`windows` | `mobile/scripts/sign-desktop-update.mjs`(환경 변수 `INNOCREW_UPDATE_PRIVATE_KEY`가 있으면 그것을 씀) | **설치된 데스크톱 앱이 더 이상 자동 업데이트를 받지 못한다** — 앱에 박힌 공개키(macOS `mobile/macos/Runner/Configs/AppInfo.xcconfig` → `SUPublicEDKey`, Windows `mobile/windows/runner/CMakeLists.txt`)와 맞는 서명만 받기 때문. 새 키로 바꾸면 모든 사용자가 새 설치 파일을 손으로 받아야 함 | ✗ (가장 중요) |
| 2 | macOS Developer ID Application 인증서 + 개인 키 | Keychain(신원 `Developer ID Application: SeungUk Kang (LME2TNRC9G)`), 사본 `~/.private_keys/innocrew-macos/developer-id.{key,cer,csr}` | `mobile/scripts/release-macos.py`(`IDENTITY` 하드코딩) | macOS DMG 서명·공증 불가. Apple 계정에서 재발급은 되지만 **개인 명의** | △ 재발급(계정 소유자만) |
| 3 | App Store Connect API 키(.p8, Admin) | `~/.private_keys/AuthKey_<ID>.p8`, ID·발급자는 `mobile/.env.release` | iOS 업로드(altool), macOS 공증, 테스터 초대(`.claude/skills/innocrew-app-testers/asc.py`) | iOS 업로드·공증·테스터 처리 불가 | ○ ASC에서 새로 발급(Admin) |
| 4 | Android 업로드 키스토어 | `mobile/android/upload-keystore.jks` + `key.properties` | AAB 업로드 서명(앱 서명 키는 Google 생성 키) | Play 업로드 불가 — Play Console에서 업로드 키 재설정 요청(며칠) | △ 재설정 요청 |
| 5 | Google Play 서비스 계정 JSON | `.env.release`의 `PLAY_SERVICE_ACCOUNT_JSON` 경로(`~/.private_keys/play-release.json`) | `mobile/scripts/play-upload.py` | 내부 테스트 자동 출시 불가 | ○ Cloud 콘솔에서 새 키 |
| 6 | 웹·서버 비밀(Supabase service role, Anthropic, Microsoft 등) | Vercel 환경 변수(원본), 로컬 사본 `frontend/.env.local` | 웹 운영 | — Vercel에 원본이 있음 | ○ |
| 7 | Supabase Management API 토큰 | Keychain `Supabase CLI` | 운영 SQL 적용 | 운영 SQL 적용 불가 | ○ 재로그인 |

## 2. 백업(사용자가 직접 — 비밀은 에이전트가 옮기지 않는다)

회사 비밀번호 관리자(1Password 등)의 **공유 금고**에 아래를 넣는다. 우선순위는 1 → 2 → 4.

1. **업데이트 서명 키 2개** — 터미널에서 값을 클립보드로 옮겨 금고 항목(이름 예: `INNOCREW desktop update ed25519 (macos)`)에 붙여 넣는다. 화면에 출력하지 않는다.
   ```bash
   security find-generic-password -s com.innogrid.innocrew.desktop-update.ed25519 -a macos -w | pbcopy    # → 금고에 붙여 넣기
   security find-generic-password -s com.innogrid.innocrew.desktop-update.ed25519 -a windows -w | pbcopy  # → 금고에 붙여 넣기
   pbcopy < /dev/null   # 클립보드 비우기
   ```
2. **Developer ID** — 키체인 접근에서 인증서+개인 키를 `.p12`(암호 지정)로 내보내 금고에 첨부.
3. **Android 업로드 키스토어** — `upload-keystore.jks`와 `key.properties`의 암호를 금고에 첨부.
4. ASC .p8·Play JSON은 재발급이 가능하므로 선택(넣어 두면 교체 시간이 준다).

백업을 마치면 이 표 아래에 날짜와 금고 이름만 적는다.

| 날짜 | 백업한 항목 | 금고 |
|---|---|---|
| (미완) | | |

## 3. 이관 계획(운영자 교체·Mac 고장 시)

- **업데이트 서명**: 새 운영 환경에서는 Keychain 대신 환경 변수 `INNOCREW_UPDATE_PRIVATE_KEY`로 금고 값을 넣어 `sign-desktop-update.mjs`를 돌린다(스크립트가 이미 지원). 공개키는 바뀌지 않으니 기존 앱의 자동 업데이트가 이어진다.
- **macOS 서명**: 개인 명의 인증서라 계정 소유자가 바뀌면 재발급이 필요하다. 장기적으로 **회사(조직) Apple 개발자 계정**으로 옮기고 `release-macos.py`의 `IDENTITY`를 환경 변수로 받게 바꾼다(옮길 때 Team ID가 바뀌면 macOS 앱의 키체인 접근 그룹·공증 설정도 함께 점검).
- **Windows 코드 서명**은 아직 보류(`windows-signed.yml`) — 회사 인증서 신청은 비용 결정 뒤.
- **launchd 자동화 4개**(`docs/launchd-jobs.md`)는 운영자 Mac에서만 돈다. Mac을 바꾸면 런북대로 다시 설치한다. Mac이 꺼져 있으면 GitLab 집계·Claude 사용량 CSV·Teams 격언·시트 실행기가 멈춘다(웹은 영향 없음).
