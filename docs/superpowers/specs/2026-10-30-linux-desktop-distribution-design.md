# Linux 데스크톱 앱 설치본 게시·앱 업데이트 설계

- 날짜: 2026-10-30
- 선행: PR #171(Linux 앱 지원 — `mobile/linux/`, WebKitGTK WebView, `scripts/build-linux-deb.sh`). 이 작업은 #171 위에 쌓는다(브랜치 `feat/linux-desktop-release`). #171이 먼저 머지되어야 한다.
- 관련: macOS·Windows 자동 업데이트 설계 `docs/superpowers/specs/2026-10-19-desktop-auto-update-design.md`, 검증 기록 `docs/desktop-auto-update-validation.md`, 런북 `docs/mobile-app.md` §Linux·§배포.

## 1. 왜

Linux(Ubuntu)를 쓰는 사내 직원도 INNOCREW 데스크톱 앱을 쓸 수 있게 되었다(#171). 그러나 지금은 `.deb`를 사람이 직접 건네야 하고, 새 버전이 나와도 사용자는 알 수 없다. macOS·Windows 직원이 겪는 것과 같은 흐름 — 웹 `/apps`에서 내려받아 설치하고, 이후에는 앱이 새 버전을 알려 주고 버튼 한 번으로 설치·재실행 — 을 Linux에도 제공한다.

## 2. 목표

1. **처음 설치**: 웹 `/apps`에 Linux 카드. 로그인한 사용자만 `.deb`를 받는다(macOS·Windows와 같은 `/api/desktop/download/[platform]`, 5분 서명 링크).
2. **앱 업데이트**: macOS·Windows와 같은 흐름.
   1. 앱 시작·로그인 사용자 변경 때 확인, 더보기 > 앱 버전 "업데이트 확인"으로 수동 확인.
   2. 새 버전이 있으면 화면 위 띠(`DesktopUpdateStrip`)에 "새 버전 X.Y.Z" + 업데이트 버튼.
   3. 버튼 → 앱이 로그인 토큰으로 **고정 주소**(`https://innocrew.innogrid.com/api/desktop/update/artifact/linux/<version>`)에서 `.deb`를 받는다. 서버가 준 URL을 따라가지 않는다.
   4. 받은 파일의 Ed25519 서명을 **앱에 내장한 Linux 공개 키**로 확인. 불일치·길이 불일치면 설치하지 않는다(fail closed).
   5. Ubuntu 관리자 인증 창(polkit, 비밀번호 1회)으로 설치 → 앱 재실행.
   6. 진행·실패는 같은 띠에, 실패 단계는 기존 `POST /api/desktop/update-failure`(감사 category `desktop`)로.
3. **설치 현황**: 웹 홈 설치 안내 카드(`DesktopAppCard`, `GET /api/desktop/presence`)와 관리자 사용자 목록의 설치 현황이 Linux 앱 로그인(`InnogridApp/<ver> (linux) …`)을 인식한다.
4. **릴리스**: Windows와 같은 틀. GitHub Actions 수동 워크플로가 빌드·서명하고, 운영자가 기존 `frontend/scripts/publish-desktop.mjs linux …`로 비공개 버킷에 올린 뒤 출력된 compare-and-set SQL을 적용한다.

## 3. 하지 않는 것(non-goals)

- apt 저장소, Snap 스토어(앱 센터) 등록, Flatpak — 사용자 결정(2026-10-30): 저장소·스토어 없이 `.deb` 파일만 배포.
- 비밀번호 없이 설치되는 업데이트(polkit 예외 규칙·setuid 도우미) — 사용자 결정: **업데이트 때 비밀번호 창 1회**. 권한 상승 통로를 만들지 않는다.
- 백그라운드 무인 설치. 설치는 사용자가 업데이트 버튼을 누를 때만(macOS·Windows와 같음).
- Ubuntu 24.04 미만 지원, arm64. 대시보드 기본 배치 변경(별도 판단, 이번 범위 아님).

## 4. 실패로 보는 것(anti-goals)

- 서명 확인 없이, 또는 서명 확인 전에 `.deb`를 설치하는 경로가 하나라도 있으면 실패다.
- 로그인 토큰이 로그·URL·명령줄 인자·파일에 남으면 실패다(기존 업데이터 원칙: "Credentials only cross … for the current authorized job").
- 관리자 권한으로 실행되는 단계가 사용자가 고를 수 있는 임의 파일 경로·인자를 받으면 실패다(단, 앱이 만든 임시 파일을 같은 사용자 권한 프로세스가 바꿔치기하는 위험은 5절 결정대로 범위 밖).
- macOS·Windows 업데이트·게시 동작이 바뀌면 실패다(기존 동작에 영향 없음).

## 5. 결정된 것

| 항목 | 결정 | 출처 |
|---|---|---|
| 배포 형식 | `.deb` 파일만(저장소·스토어 없음) | 사용자 |
| 업데이트 UX | macOS·Windows와 같은 띠·버튼·서명 확인·재실행 | 사용자 |
| 설치 권한 | 업데이트 때 관리자 인증(비밀번호) 1회 | 사용자 |
| 릴리스 | Actions에서 빌드·서명, 운영자가 게시 스크립트 실행 | 사용자 |
| 빌드 서버 | GitHub Actions `ubuntu-24.04` → 24.04·26.04 설치 가능(`t64` 의존 이름) | 내 결정 |
| 서명 키 | 플랫폼별 Ed25519 키, Linux 키 새로 생성. 기존 macOS·Windows 규칙대로 **원본은 Owner Mac 키체인**(`com.innogrid.innocrew.desktop-update.ed25519`, 계정 `linux`), GitHub 비밀값 `INNOCREW_LINUX_UPDATE_PRIVATE_KEY`는 사본(`provision-ci-update-key.mjs`로 올림). 공개 키는 `mobile/desktop-update-public-keys.json`의 `linux`와 앱 내장. 키를 잃으면 설치된 Linux 앱이 다음 업데이트를 확인하지 못해 전원 재설치가 필요하므로 원본을 지운다면 별도 보관 | 내 결정(기존 규칙) |
| 파일 바꿔치기 | 서명 확인(사용자 권한)과 root 설치 사이에 같은 사용자 권한의 악성 프로세스가 임시 파일을 바꾸는 위험은 막지 않는다 — root 소유 업데이트 도우미를 두지 않고 앱 코드만으로 구현. 알려진 제약으로 문서화 | 사용자 |
| 실기 업데이트 시험 | 스테이징이 없고 서버 주소가 고정이라, 업그레이드·서명 거부는 CI(root 설치 하네스·로컬 가짜 서버)에서 검증한다. 실기 "띠 → 비밀번호 → 재실행"은 첫 Linux 게시(X) 다음 정상 릴리스(X+1) 때 확인. 운영에 시험용 버전을 일부러 게시하지 않는다 | 내 결정(macOS·Windows 선례) |
| 파일명 | `INNOGRID-Linux-<version>_amd64.deb`(버킷 경로 `linux/<version>/<파일명>`). 기존 `INNOGRID-macOS-…`·`INNOGRID-Windows-…`와 맞춤. 패키지 이름(`innocrew`)·설치 위치(`/opt/innocrew`)는 #171 그대로 | 내 결정 |
| `minimumOS` | `24.04` | 내 결정 |

## 6. 바뀌는 곳

### 6.1 서버(frontend)
- `lib/desktop/release.ts`: `DesktopPlatform`에 `linux`, 파일명 규칙에 `.deb`(정확히 위 파일명 형식), `parseDesktopRelease`가 `linux` 블록을 읽는다.
- `app/api/desktop/release/route.ts`, `download/[platform]/route.ts`, `update/artifact/[platform]/[version]`·`lib/desktop/update-request.ts`·`update-failure`: `linux` 허용. Linux 앱은 appcast(Sparkle XML)를 쓰지 않으므로 `update/appcast`는 `linux`를 거부해도 된다 — 앱은 `GET /api/desktop/release?platform=linux&mode=automatic`의 `update`(build·edSignature·minimumOS)와 artifact 엔드포인트만 쓴다.
- `lib/desktop/presence.ts`: User-Agent 정규식·`appPlatform`·`Presence`에 `linux`. 브라우저 판별(`navigator.userAgent`의 `Linux`·`X11`, Android 제외)도 추가해 Linux 데스크톱 브라우저에서 설치 안내 카드가 뜨게 한다.
- `components/home/DesktopAppCard.tsx`, `app/apps/DesktopDownloads.tsx`, `app/admin/users/page.tsx`(설치 현황 열), `lib/audit-client.ts`, `lib/manual/sections.ts`: Linux 카드·문구. 설치 안내는 "받은 파일을 열면 앱 센터가 설치 창을 띄운다(비밀번호 입력), 또는 `sudo apt install ./파일.deb`", 지원 범위 "Ubuntu 24.04 이상(x86_64)".
- 감사 보존 SQL: `purge_audit_logs`가 남기는 플랫폼별 마지막 앱 로그인의 정규식(`docs/sql/2026-10-20-audit-retention-app-logins.sql` — `(ios|android|macos|windows)`)에 `linux`를 더하는 새 SQL 파일(`docs/sql/2026-10-30-audit-retention-linux.sql` 등). 없으면 Linux 로그인 기록이 100일 뒤 지워져 설치 안내 카드·관리자 설치 현황이 틀어진다.
- `frontend/scripts/lib/desktop-publication.mjs`·`publish-desktop.mjs`: `linux` 허용, 파일명·`minimumOS '24.04'` 검사. `publicationSQL`의 compare-and-set은 플랫폼 키만 바꾸므로 그대로.

### 6.2 앱(mobile)
- `lib/release/desktop_updater.dart`: `platform`에 `linux`. `start()`의 플랫폼 제한에 `linux`를 추가하고, Linux는 네이티브 채널 대신 Dart 구현(`LinuxUpdateInstaller` 등)을 탄다. #171에서 넣은 "Linux는 업데이터·설치본 안내 없음" 분기(`desktop_updater.dart`·`release_provider.dart`)를 걷어낸다.
- Linux 설치 단계(새 파일, 예: `lib/release/linux_update_installer.dart`):
  1. 앱 전용 임시 폴더(권한 0700)에 받는다. `Authorization: Bearer`, 리다이렉트 따라가지 않음, 길이·`content-length`를 릴리스 정보의 `bytes`와 대조.
  2. Ed25519 서명 확인(내장 공개 키). 구현 방식은 빌더 재량(7절).
  3. 설치: `pkexec /usr/bin/apt-get install -y <확인한 파일의 절대 경로>` 형태로 **고정된 명령**만 실행한다(다운그레이드 옵션은 주지 않는다 — 버전이 현재보다 높은지는 앱이 먼저 확인). 경로는 앱이 만든 임시 폴더 안 파일뿐이다. pkexec 창에서 취소하면 "업데이트를 취소했습니다" 띠, 오류는 실패 단계로 보고.
  4. 재실행: 새 프로세스를 띄우고 현재 프로세스를 끝낸다. 앱이 단일 인스턴스(#171)라 **현재 앱이 먼저 끝난 뒤** 새 앱이 시작되어야 한다(예: `setsid sh -c 'sleep 1; exec /usr/bin/innocrew'` 뒤 `exit`). 이전 PID 종료·새 PID 1개를 확인한다.
  5. 임시 파일 삭제.
- `mobile/desktop-update-public-keys.json`에 `linux` 키, 앱 내장 공개 키(macOS·Windows가 네이티브에 내장하는 것과 같은 값)를 Dart 상수로.
- 업데이트 띠·더보기 "업데이트 확인"은 기존 위젯을 그대로 쓴다.

### 6.3 패키지·빌드·릴리스
- `mobile/scripts/build-linux-deb.sh`: 산출 파일명을 `INNOGRID-Linux-<version>_amd64.deb`로. `Depends`에 서명 확인·설치에 쓰는 도구(예: `policykit-1`/`pkexec`, 선택한 서명 확인 방식에 필요한 것)를 명시.
- `mobile/scripts/sign-desktop-update.mjs`: `linux` 허용(`minimumOS '24.04'`). 비밀 키는 환경변수, 없으면 기존처럼 Owner Mac 키체인(계정 `linux`).
- `.github/workflows/linux-app.yml`(새): `workflow_dispatch`, `ubuntu-24.04`, Flutter 3.47.7, `flutter test`·`flutter analyze` → `build-linux-deb.sh` → `sign-desktop-update.mjs linux` → `actions/upload-artifact`(`.deb` + `.update.json`). Windows 워크플로처럼 서명된 업그레이드 검증 단계를 둔다: 컨테이너 안에서 이전 버전 설치 → 새 `.deb` 서명 확인 → 설치 → 버전 확인. 실제 pkexec 창은 CI에서 띄울 수 없으므로 설치 명령은 root로 직접 실행해 검증하고, pkexec 경로는 수동 체크리스트로 남긴다.
- `mobile/scripts/provision-update-key.swift`·`provision-ci-update-key.mjs`: `linux` 계정 허용(지금 `windows` 고정 부분 포함). Owner가 Mac에서 키 쌍을 만들어 키체인에 넣고, 공개 키를 `desktop-update-public-keys.json`에, 비밀 키를 GitHub 비밀값으로 올린다. 빌더는 이 절차와 스크립트만 준비하고, PR의 공개 키 값은 Owner가 만든 값으로 채운다.

### 6.4 문서
- 런북 `docs/mobile-app.md` §Linux·§배포, `docs/desktop-auto-update-validation.md`에 Linux 절, `.claude/rules/mobile.md`(#171에서 "자동 업데이트 없음"으로 적은 곳), 루트 `CLAUDE.md`의 데스크톱 API 설명에 `linux`.

## 6.5 알려진 제약(문서·PR 본문에 적는다)

- 업데이트 설치 때 Ubuntu 관리자 인증 창이 한 번 뜬다. 창 문구는 polkit 기본 문구(`/usr/bin/apt-get` 실행)다.
- 서명 확인과 root 설치 사이에 같은 사용자 권한의 악성 프로그램이 임시 파일을 바꾸면 막지 못한다(사용자 결정, 2026-10-30). 이미 사용자 권한을 뺏긴 PC라는 전제다.
- 첫 Linux 게시 이후 실제 업그레이드 확인은 다음 정상 릴리스 때 이뤄진다.

## 7. 빌더 재량

- Dart에서 Ed25519 확인 방법: 새 의존성(`cryptography` 등)을 들이는 대신 OS의 `openssl`(`pkeyutl -verify -rawin`)을 고정 인자로 쓰거나, 검증된 순수 Dart 구현을 고른다. 새 Dart 의존성은 규칙상 스펙 변경이므로 쓰면 PR 본문에 사유를 적는다. 어느 쪽이든 실패하면 설치하지 않는다.
- 업데이트 상태 머신·문구는 기존 `DesktopUpdater`를 최대한 재사용하고, 네이티브 채널 대신 Dart 설치기를 주입하는 구조(테스트에서 가짜 설치기로 대체)로 만든다.
- CI 업그레이드 검증의 구체 형태(Docker 컨테이너 등).

## 8. 테스트·검증

- frontend vitest: `release.ts`(linux 파싱·파일명 규칙), 다운로드·artifact·release API의 linux 허용과 기존 macos·windows 동작 유지, `presence.ts`(Linux UA·브라우저 판별), `desktop-publication`(linux 파일명·minimumOS·SQL).
- mobile `flutter test`: Linux 설치기(서명 불일치·길이 불일치·리다이렉트·pkexec 취소·성공 시 재실행 호출), `desktop_updater` linux 경로, 플랫폼 판별.
- CI(`linux-app.yml`): 컨테이너에서 이전 버전 설치 → 로컬 가짜 서버가 새 `.deb`·릴리스 정보를 제공 → 앱의 설치기 로직(또는 같은 검증 코드)으로 서명 확인 → root 설치 → 버전 확인. 서명이 틀린 파일·길이 불일치·리다이렉트 거부.
- 실기(Ubuntu 24.04 이상): 이 PR에서는 개발 빌드로 띠·확인·취소 동작과 pkexec 창 표시까지. 실제 게시본 간 업그레이드(X → X+1)는 첫 정상 릴리스 때 런북 체크리스트로 확인.

## 9. 프로젝트 Owner 할 일(이 작업 PR 본문에도 적는다)

1. #171 리뷰·머지(이 작업의 선행).
2. Owner Mac에서 Linux 업데이트 서명 키 쌍 생성(`provision-update-key.swift` 계정 `linux`) → 공개 키 값을 PR의 `desktop-update-public-keys.json`에 반영 → `provision-ci-update-key.mjs`로 비밀 키를 GitHub 비밀값 `INNOCREW_LINUX_UPDATE_PRIVATE_KEY`에 등록.
3. PR 머지 후 **프론트 먼저 배포**(앱이 `platform=linux`를 묻기 전에 서버가 받아야 한다), 감사 보존 SQL 적용.
4. `Linux app` 워크플로 실행 → 산출물 내려받기 → `publish-desktop.mjs linux <버전> <파일> none` → 출력 SQL 적용 → `/apps` Linux 카드에서 내려받기 확인.
5. 다음 Linux 릴리스(X+1) 때 Linux PC 한 대에서 "띠 → 업데이트 → 비밀번호 → 재실행"을 런북 체크리스트로 확인.
6. 이후 Linux 릴리스는 4만 반복.
