# Linux 설치본 게시·앱 업데이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linux(Ubuntu) INNOCREW 앱을 웹 `/apps`에서 내려받고, macOS·Windows처럼 앱 안 업데이트 띠로 새 `.deb`를 받아 서명 확인 → 관리자 인증 1회 → 설치 → 재실행한다.

**Architecture:** 서버는 기존 데스크톱 배포(`settings.desktop_app_release`·비공개 버킷 `desktop-releases`·`/api/desktop/*`)에 `linux` 플랫폼을 더한다. 앱은 기존 `DesktopUpdater` 상태 머신을 쓰고, Linux만 네이티브 채널 대신 Dart 설치기(`LinuxUpdateInstaller`: 내려받기 → `openssl` Ed25519 확인 → `pkexec apt-get install` → 재실행)를 주입한다. 빌드·서명은 GitHub Actions(`ubuntu-24.04`), 게시는 기존 `publish-desktop.mjs`.

**Tech Stack:** Next.js(App Router)·vitest, Flutter 3.47.7·Riverpod·`flutter_test`, bash·dpkg-deb, Node(`node:crypto` Ed25519), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-30-linux-desktop-distribution-design.md`

## Global Constraints

- 브랜치 `feat/linux-desktop-release`(PR #171 `feat/linux-desktop` 위). #171 머지 전에는 이 PR을 열지 않거나 #171을 기반으로 표시한다.
- 플랫폼 키 문자열: `linux`. 파일명 `INNOGRID-Linux-<version>_amd64.deb`, 버킷 경로 `linux/<version>/<파일명>`, `minimumOS` `24.04`.
- 패키지 이름 `innocrew`, 설치 위치 `/opt/innocrew`, 실행 `/usr/bin/innocrew`(#171 그대로).
- 업데이트 원본 주소는 고정 `https://innocrew.innogrid.com/api/desktop/update/artifact/linux/<version>` — 서버가 준 URL을 따라가지 않는다. 리다이렉트를 따라가지 않는다.
- 서명 확인 실패·길이 불일치·키 없음은 모두 설치하지 않는다(fail closed). 서명 확인 전에 설치 명령을 부르는 경로가 없어야 한다.
- 로그인 토큰은 HTTP 헤더로만. 로그·URL·명령줄 인자·파일·상태에 남기지 않는다.
- 관리자 권한 명령은 정확히 `pkexec /usr/bin/apt-get install -y <앱이 만든 임시 폴더 안 확인된 파일의 절대 경로>` 하나. 다운그레이드 옵션 없음.
- 공개 키 단일 출처 `mobile/desktop-update-public-keys.json`의 `linux`. 앱에는 빌드 때 `--dart-define=INNOCREW_LINUX_UPDATE_KEY=<base64 raw 32B>`로 넣는다. 값이 없으면 업데이트는 "서명 키 없음"으로 멈춘다. 비밀 키는 커밋하지 않는다.
- macOS·Windows 업데이트·게시 동작은 바꾸지 않는다. 기존 테스트가 그대로 통과해야 한다.
- 새 Dart·npm 의존성 추가 없음(서명 확인은 OS `openssl`).
- 주석·문서·UI 문구는 한국어, 짧은 문장(`CLAUDE.md` 글쓰기 규칙).
- 각 Task의 "Commit" 단계는 사용자 규칙상 파일 단위 `git add`(stage)까지만 하고 메시지는 초안으로 남긴다. 커밋·push·PR은 사용자가 요청할 때 한다(`git add -A`·`.` 금지).

## Review Focus

1. **설치 직전 파일 상태**: 서명 확인을 통과한 바로 그 경로만 `pkexec`에 넘기는지 — Task 5 테스트 `install은 verify를 통과한 경로만 넘긴다`.
2. **pkexec 취소·거부(종료 코드 126·127)**: 오류가 아니라 "업데이트를 취소했습니다"로 끝나고 다시 시도할 수 있어야 한다 — Task 5 `pkexec 취소는 cancelled로 끝난다`, Task 6 `Linux 취소 뒤 다시 업데이트 버튼이 보인다`.
3. **릴리스 정보에 `bytes`가 없거나 내려받은 길이가 다를 때**: 설치하지 않는다 — Task 5 `길이가 다르면 verify·install을 부르지 않는다`.
4. **공개 키 dart-define 누락(개발 빌드)**: 띠에 업데이트 버튼을 띄우지 않고 "서명 키 없음" 안내 — Task 6 `Linux 키가 없으면 available 대신 error`.
5. **기존 macOS·Windows 경로**: `platform=linux` 추가가 appcast·파일명 검사를 느슨하게 만들지 않는지 — Task 1 `appcast는 linux를 거부한다`, `macos 산출물에 .deb 파일명은 거부`.

---

### Task 1: 서버 — 릴리스·내려받기·업데이트 API에 `linux`

**Files:**
- Modify: `frontend/src/lib/desktop/release.ts`, `frontend/src/lib/desktop/update-feed.ts`, `frontend/src/lib/desktop/update-request.ts`, `frontend/src/app/api/desktop/release/route.ts`, `frontend/src/app/api/desktop/download/[platform]/route.ts`, `frontend/src/app/api/desktop/update/appcast/route.ts`, `frontend/src/app/api/desktop/update-failure/route.ts`
- Test: `frontend/src/lib/__tests__/desktop-release-api.test.ts`, `desktop-release-list-api.test.ts`, `desktop-update-api.test.ts`, `desktop-update-failure-api.test.ts`

**Interfaces:**
- Produces: `DesktopPlatform = "macos" | "windows" | "linux"`; `DESKTOP_PLATFORMS = ["macos","windows","linux"] as const`; `desktopFilename(platform, version): string`(`INNOGRID-macOS-<v>.dmg` / `INNOGRID-Windows-<v>-Setup.exe` / `INNOGRID-Linux-<v>_amd64.deb`); `isDesktopPlatform(x: unknown): x is DesktopPlatform`.
- Linux 업데이트 실패 단계: `LINUX_FAILURE_REASONS = ["download","length","signature","auth","install","launch"]`. update-failure 본문은 기존 형식(`platform, version, reason, winError, attempts`) 그대로, `winError` 자리에 종료 코드(0~255).

- [ ] **Step 1: 실패 테스트 작성** — `parseDesktopRelease`가 `linux` 블록(`filename: "INNOGRID-Linux-1.8.0_amd64.deb"`, `path: "linux/1.8.0/INNOGRID-Linux-1.8.0_amd64.deb"`)을 읽는다; `macos` 블록에 `.deb` 파일명이면 버린다; `canAutoUpdate("linux", …)`가 `.deb`만 true; `GET /api/desktop/release?platform=linux&mode=automatic`이 `url: "https://innocrew.innogrid.com/api/desktop/update/artifact/linux/1.8.0"`·`update`·`bytes`를 준다; `/api/desktop/download/linux`가 서명 링크로 302; `/api/desktop/update/artifact/linux/1.8.0`이 허용된다; `appcast?platform=linux`는 400; update-failure `{platform:"linux", reason:"signature", winError:1, attempts:1}`은 200, `reason:"name"`(Windows 전용)은 400.
- [ ] **Step 2: 실패 확인** — Run: `cd frontend && npx vitest run src/lib/__tests__/desktop-release-api.test.ts src/lib/__tests__/desktop-release-list-api.test.ts src/lib/__tests__/desktop-update-api.test.ts src/lib/__tests__/desktop-update-failure-api.test.ts` / Expected: 새 linux 케이스 FAIL.
- [ ] **Step 3: 구현** — `release.ts`에 위 Produces를 두고 파싱·파일명 정규식을 `desktopFilename` 비교로 바꾼다. `update-feed.ts` `canAutoUpdate`는 `a.filename === desktopFilename(platform, a.version)`로. `update-request.ts`·release·download 라우트는 `isDesktopPlatform` 사용. appcast 라우트는 `macos|windows`만 계속 허용. update-failure는 플랫폼별 이유 집합(`windows`·`macos` 기존 `REASONS`, `linux`는 `LINUX_FAILURE_REASONS`, `winError` 0~255).
- [ ] **Step 4: 통과 확인** — Step 2 명령 + `npx vitest run src/lib/__tests__` 전체 / Expected: PASS, 기존 macOS·Windows 케이스 변화 없음.
- [ ] **Step 5: Commit** — `git add` 위 파일들 → `feat(desktop): 릴리스·내려받기·업데이트 API에 linux 플랫폼`.

### Task 2: 웹 — 설치 현황·`/apps` Linux 카드·홈 안내·매뉴얼

**Files:**
- Modify: `frontend/src/lib/desktop/presence.ts`, `frontend/src/components/home/DesktopAppCard.tsx`, `frontend/src/app/apps/DesktopDownloads.tsx`, `frontend/src/app/admin/users/page.tsx`, `frontend/src/lib/manual/sections.ts`
- Create: `docs/sql/2026-10-30-audit-retention-linux.sql`
- Test: `frontend/src/lib/__tests__/desktop-presence.test.tsx`, `desktop-downloads.test.tsx`, `admin-users-page.test.tsx`, `manual.test.tsx`

**Interfaces:**
- Consumes: Task 1 `DesktopPlatform`·`DESKTOP_PLATFORMS`.
- Produces: `parseAppUa`가 `(linux)` 인식; `Presence`에 `linux`; `browserPlatform(ua, maxTouchPoints)`가 Android·ChromeOS(`CrOS`)를 빼고 `/Linux|X11/`이면 `"linux"`.

- [ ] **Step 1: 실패 테스트 작성** — `parseAppUa("InnogridApp/1.8.0 (linux) InnogridBuild/130")` → `{platform:"linux", version:"1.8.0", build:130}`; `presenceFromRows`에 linux 시각; `browserPlatform("Mozilla/5.0 (X11; Linux x86_64) …Chrome…")` → `"linux"`, Android UA·`CrOS` UA → `null`; `/apps`가 linux 릴리스가 있으면 "Linux" 카드와 `"Ubuntu 24.04 이상 · x86_64"` 설명·`sudo apt install ./INNOGRID-Linux-1.8.0_amd64.deb` 안내를 보인다; 관리자 사용자 목록 설치 현황 열에 `Linux`; 매뉴얼에 Linux 설치 절(id `linux-install`).
- [ ] **Step 2: 실패 확인** — Run: `cd frontend && npx vitest run src/lib/__tests__/desktop-presence.test.tsx src/lib/__tests__/desktop-downloads.test.tsx src/lib/__tests__/admin-users-page.test.tsx src/lib/__tests__/manual.test.tsx` / Expected: linux 케이스 FAIL.
- [ ] **Step 3: 구현** — 위 Produces. `DesktopAppCard`는 플랫폼 이름 `{macos:"Mac", windows:"Windows", linux:"Linux"}` 표로 바꾸고 Linux 보조 문구 `"받은 파일을 열면 앱 센터가 설치합니다(관리자 비밀번호 입력)"`. `DesktopDownloads`는 `DESKTOP_PLATFORMS`를 돌고 Linux 아이콘은 `Monitor`(lucide에 Tux 없음). 관리자 열 `{ key: "linux", label: "Linux" }`.
- [ ] **Step 4: SQL 작성** — `2026-10-30-audit-retention-linux.sql`: `docs/sql/2026-10-20-audit-retention-app-logins.sql`의 `purge_audit_logs` 정의를 복사해 정규식만 `(ios|android|macos|windows|linux)`로 바꾼 `create or replace function`. 파일 머리 주석에 "2026-10-20 파일의 함수를 대체, 적용은 Supabase SQL".
- [ ] **Step 5: 통과 확인** — Step 2 명령 + `npx vitest run` 전체·`npx tsc --noEmit` / Expected: PASS.
- [ ] **Step 6: Commit** — `feat(web): /apps Linux 카드·설치 현황·홈 안내에 Linux, 감사 보존 SQL`.

### Task 3: 게시·서명·키 준비 스크립트에 `linux`

**Files:**
- Modify: `frontend/scripts/lib/desktop-publication.mjs`, `mobile/scripts/sign-desktop-update.mjs`, `mobile/scripts/provision-update-key.swift`, `mobile/scripts/provision-ci-update-key.mjs`
- Test: `frontend/src/lib/__tests__/desktop-update-publication.test.ts`

**Interfaces:**
- Produces: `preparePublication("linux", v, "INNOGRID-Linux-<v>_amd64.deb", body, update, key)` 허용(`minimumOS "24.04"`); `publicationSQL("linux", …)` 허용; `sign-desktop-update.mjs linux <file> <build>` → `<file>.update.json`; `provision-ci-update-key.mjs <platform>`(인자 없으면 기존처럼 `windows`) → GitHub 비밀값 `INNOCREW_<PLATFORM>_UPDATE_PRIVATE_KEY`.

- [ ] **Step 1: 실패 테스트 작성** — 기존 `requires platform-specific immutable artifact names and valid metadata` 옆에 linux 케이스: 올바른 파일명·`minimumOS "24.04"` 통과, `INNOGRID-Linux-1.8.0.deb`(아키텍처 없음)·`minimumOS "22.04"` 거부; `publicationSQL("linux", …)`가 `'{linux}'` 경로를 쓴다.
- [ ] **Step 2: 실패 확인** — Run: `cd frontend && npx vitest run src/lib/__tests__/desktop-update-publication.test.ts` / Expected: FAIL.
- [ ] **Step 3: 구현** — 세 스크립트의 플랫폼 목록·파일명·`minimumOS` 표에 linux. `provision-update-key.swift`는 `["macos","windows","linux"]`. `provision-ci-update-key.mjs`는 플랫폼 인자를 받아 `readPrivateKey(platform)`·`keys[platform]`·검사용 `minimumOS`를 플랫폼별로.
- [ ] **Step 4: 통과 확인** — Step 2 명령 / Expected: PASS. `node mobile/scripts/sign-desktop-update.mjs linux --check-key`는 키가 없으면 실패 메시지로 끝나는지만 확인(키는 Owner가 만든다).
- [ ] **Step 5: Commit** — `feat(desktop): 게시·서명·키 준비 스크립트에 linux`.

### Task 4: 앱 — 릴리스 정보에 `bytes`, Linux 공개 키 상수

**Files:**
- Modify: `mobile/lib/release/release_check.dart`
- Create: `mobile/lib/release/linux_update_key.dart`
- Test: `mobile/test/release/release_check_test.dart`, Create `mobile/test/release/linux_update_key_test.dart`

**Interfaces:**
- Produces: `DesktopReleaseInfo.bytes` (`int?`, 서버 `bytes`가 양의 정수일 때만); `const linuxUpdatePublicKey = String.fromEnvironment('INNOCREW_LINUX_UPDATE_KEY')`; `String? linuxUpdatePublicKeyPem(String rawBase64)` — 32바이트 raw가 아니면 null, 맞으면 SPKI(`302a300506032b6570032100` + raw) PEM.

- [ ] **Step 1: 실패 테스트 작성** — `parseDesktopRelease({... 'bytes': 11013142})?.bytes == 11013142`, `bytes: -1`·문자열이면 null; `linuxUpdatePublicKeyPem(<json의 windows 키>)`가 `-----BEGIN PUBLIC KEY-----`로 시작하고 `openssl pkey -pubin -noout`로 읽힌다(테스트는 `Platform.isLinux`일 때만 openssl 호출), 31바이트·비 base64는 null.
- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/release/release_check_test.dart test/release/linux_update_key_test.dart` / Expected: FAIL.
- [ ] **Step 3: 구현** — 위 Produces.
- [ ] **Step 4: 통과 확인** — Step 2 명령 / Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): 데스크톱 릴리스 정보 bytes·Linux 업데이트 공개 키`.

### Task 5: 앱 — `LinuxUpdateInstaller`(내려받기·서명 확인·설치·재실행)

**Files:**
- Create: `mobile/lib/release/linux_update_installer.dart`
- Test: Create `mobile/test/release/linux_update_installer_test.dart`

**Interfaces:**
- Consumes: Task 4 `DesktopReleaseInfo.bytes`, `linuxUpdatePublicKeyPem`.
- Produces:
  ```dart
  typedef LinuxUpdateProgress = void Function(String phase, double? progress); // 'downloading'|'verifying'|'installing'
  sealed class LinuxUpdateResult { } // LinuxUpdateDone, LinuxUpdateCancelled, LinuxUpdateFailed(String reason, int code)
  class LinuxUpdateInstaller {
    LinuxUpdateInstaller({required http.Client client, required ProcessRunner run, required Future<Directory> Function() workDir, required String publicKeyRaw, void Function()? exitApp});
    Future<LinuxUpdateResult> install({required String version, required int expectedBytes, required String edSignature, required String accessToken, required LinuxUpdateProgress onProgress});
    Future<void> cancel();
  }
  typedef ProcessRunner = Future<ProcessResult> Function(String exe, List<String> args);
  ```
  `reason`은 Task 1 `LINUX_FAILURE_REASONS` 값만.
- 동작: `workDir()`(기본 `$XDG_CACHE_HOME/INNOGRID/update` 또는 `~/.cache/INNOGRID/update`, 권한 0700, 이전 파일 삭제) 안 `INNOGRID-Linux-<version>_amd64.deb`로 받는다. 요청은 고정 주소, `Authorization: Bearer`, `followRedirects: false`, 상태 200 아니면 `download`. 받은 길이 ≠ `expectedBytes`면 `length`. 서명은 `<파일>.sig`(base64 디코드 64바이트)·`key.pem`(같은 폴더)을 쓰고 `openssl pkeyutl -verify -pubin -inkey key.pem -rawin -in <파일> -sigfile <파일>.sig`, 종료 0 아니면 `signature`. 설치 `pkexec /usr/bin/apt-get install -y <파일 절대 경로>`: 0 → 재실행, 126·127 → `LinuxUpdateCancelled`, 그 밖 → `install`. 재실행 `Process.start('/bin/sh', ['-c','sleep 1; exec /usr/bin/innocrew'], mode: detached)` 실패 → `launch`, 성공 → `exitApp()`. 끝나면(성공 제외) 임시 파일 삭제.

- [ ] **Step 1: 실패 테스트 작성** (가짜 `http.Client`·`ProcessRunner`)
  - `다운로드는 고정 주소에 Bearer로, 리다이렉트를 따르지 않는다` — 요청 URL `https://innocrew.innogrid.com/api/desktop/update/artifact/linux/1.8.0`, 헤더 `Authorization: Bearer t`, `followRedirects == false`; 302 응답이면 `LinuxUpdateFailed('download', 302)`.
  - `길이가 다르면 verify·install을 부르지 않는다` — 실행 기록에 `openssl`·`pkexec` 없음, 결과 `length`.
  - `서명이 틀리면 설치하지 않는다` — openssl 종료 1 → `signature`, `pkexec` 호출 없음.
  - `install은 verify를 통과한 경로만 넘긴다` — `pkexec` 인자가 정확히 `['/usr/bin/apt-get','install','-y', <verify에 쓴 -in 경로>]`.
  - `pkexec 취소는 cancelled로 끝난다` — 126·127 각각 `LinuxUpdateCancelled`, 임시 `.deb` 삭제됨.
  - `성공하면 재실행 후 exitApp` — `/bin/sh -c 'sleep 1; exec /usr/bin/innocrew'` 시작, `exitApp` 1회.
  - `키가 없으면 내려받지 않는다` — `publicKeyRaw: ''` → `LinuxUpdateFailed('signature', 0)`, HTTP 호출 없음.
  - `토큰은 어떤 실행 인자·파일에도 없다` — 모든 실행 인자와 작업 폴더 파일 내용에 `t` 토큰 문자열이 없음.
  - (Linux 호스트에서만) `실제 openssl로 서명 확인` — 테스트 안에서 `node:crypto` 대신 Dart에서 쓸 수 있는 고정 벡터(RFC 8032 테스트 벡터 1: 빈 메시지)로 통과·1바이트 바꾼 서명 거부.
- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/release/linux_update_installer_test.dart` / Expected: FAIL(파일 없음).
- [ ] **Step 3: 구현** — 위 Produces·동작. 진행률은 내려받기 바이트 비율, 검증·설치는 `null`.
- [ ] **Step 4: 통과 확인** — Step 2 명령 / Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): Linux 업데이트 설치기 — 고정 주소 내려받기·Ed25519 확인·pkexec 설치·재실행`.

### Task 6: 앱 — `DesktopUpdater` Linux 경로와 provider

**Files:**
- Modify: `mobile/lib/release/desktop_updater.dart`, `mobile/lib/release/release_provider.dart`
- Test: `mobile/test/release/desktop_updater_test.dart`, `mobile/test/release/release_provider_test.dart`

**Interfaces:**
- Consumes: Task 5 `LinuxUpdateInstaller`·`LinuxUpdateResult`, Task 4 `linuxUpdatePublicKey`.
- Produces: `DesktopUpdater(..., LinuxUpdateInstaller? linuxInstaller)`. `platform == 'linux'`이면 `start()`가 채널 대신 `linuxInstaller.install(...)`, 진행 콜백을 기존 `status` 처리와 같은 문구(`업데이트 다운로드 중…`·`설치 파일 검증 중…`·`설치 후 자동으로 다시 시작합니다…`)로, `LinuxUpdateCancelled` → `DesktopUpdateState(available, release, message: '업데이트를 취소했습니다.', visible: true)`, `LinuxUpdateFailed` → 기존 오류 문구 + `(오류 코드 <reason>-<code>)`, `reportFailure({'platform':'linux','version',..,'reason','winError':code,'attempts':1})`. `cancelForSignOut`·`dispose`는 `linuxInstaller.cancel()`.
- provider: `platform`을 `macos`/`windows`/`linux`로. Linux는 `linuxInstaller`를 만들어 주입. #171의 "Linux는 업데이터 없음" 분기(`desktop_updater.dart` provider·`release_provider.dart` `desktopReleaseProvider`)를 걷어낸다.

- [ ] **Step 1: 실패 테스트 작성** — `Linux는 채널 대신 설치기를 부른다`(가짜 설치기 호출 1회, 인자 version·expectedBytes·edSignature·토큰); `Linux 취소 뒤 다시 업데이트 버튼이 보인다`(phase available, message '업데이트를 취소했습니다.'); `Linux 실패는 update-failure로 보고`(platform linux, reason signature); `Linux 키가 없으면 available 대신 error`(`linuxUpdatePublicKey` 대신 주입한 빈 키 → `check(manual:true)`가 '자동 업데이트용 서명 키가 없습니다…'); `desktopReleaseProvider는 Linux에서 platform=linux를 묻는다`(debugDefaultTargetPlatformOverride linux). 기존 macOS·Windows 테스트는 그대로.
- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/release/` / Expected: 새 케이스 FAIL.
- [ ] **Step 3: 구현** — 위 Produces. 키 확인은 `check()`에서 `platform == 'linux' && linuxPublicKeyRaw.isEmpty`일 때(`DesktopUpdater`에 `String linuxPublicKeyRaw = linuxUpdatePublicKey` 매개변수로 주입 가능하게).
- [ ] **Step 4: 통과 확인** — `cd mobile && flutter test && flutter analyze` / Expected: 전체 PASS, 문제 없음.
- [ ] **Step 5: Commit** — `feat(mobile): Linux 앱 업데이트 — 띠·확인·설치기 연결`.

### Task 7: 패키지·CI·문서

**Files:**
- Modify: `mobile/scripts/build-linux-deb.sh`, `docs/mobile-app.md`(§Linux·§배포), `docs/desktop-auto-update-validation.md`, `.claude/rules/mobile.md`, `CLAUDE.md`(데스크톱 API 줄)
- Create: `.github/workflows/linux-app.yml`, `mobile/scripts/test-linux-deb-upgrade.sh`

**Interfaces:**
- Consumes: Task 3 `sign-desktop-update.mjs linux`, Task 4 dart-define 이름 `INNOCREW_LINUX_UPDATE_KEY`.
- Produces: `build-linux-deb.sh` 산출 `build/linux/deb/INNOGRID-Linux-<version>_amd64.deb`, 빌드 인자에 `--dart-define=INNOCREW_LINUX_UPDATE_KEY=<json의 linux, 없으면 빈 값>`, `Depends`에 `openssl, pkexec`(dpkg-shlibdeps 결과 뒤에 덧붙임). `test-linux-deb-upgrade.sh <deb>`: `ubuntu:24.04` 컨테이너에서 같은 `.deb`의 control `Version`만 낮춘 사본(`dpkg-deb -R`→수정→`-b`) 설치 → 실제 `.deb`로 `apt-get install -y` → `dpkg -s innocrew` 버전·`/opt/innocrew/playground` 존재 확인, 그리고 `<deb>.update.json`의 서명을 Task 5와 같은 `openssl pkeyutl` 명령으로 확인(통과)·1바이트 바꾼 사본 거부.

- [ ] **Step 1: 스크립트 수정·작성** — 위 Produces.
- [ ] **Step 2: 로컬 확인** — Run: `cd mobile && ./scripts/build-linux-deb.sh` → 파일명·`dpkg-deb -f … Depends`에 `openssl`·`pkexec` 확인. 서명 단계는 임시 키(테스트용, 커밋 안 함)로 `INNOCREW_UPDATE_PRIVATE_KEY=<임시> node scripts/sign-desktop-update.mjs …`가 아니라, 키가 없으면 `test-linux-deb-upgrade.sh`의 업그레이드 부분만 실행(`SKIP_SIGNATURE=1`). Docker가 없으면 이 단계는 CI에서 확인한다고 기록.
- [ ] **Step 3: 워크플로 작성** — `linux-app.yml`: `workflow_dispatch`, `runs-on: ubuntu-24.04`, `subosito/flutter-action@v2`(3.47.7), apt 빌드 도구(#171 런북 목록 + `dpkg-dev`), `flutter test`·`flutter analyze`, `build-linux-deb.sh`, `INNOCREW_UPDATE_PRIVATE_KEY: ${{ secrets.INNOCREW_LINUX_UPDATE_PRIVATE_KEY }}`로 `node mobile/scripts/sign-desktop-update.mjs linux <deb> <build>`, `test-linux-deb-upgrade.sh`, `actions/upload-artifact@v4` 이름 `INNOGRID-Linux`(`.deb`·`.update.json`).
- [ ] **Step 4: 문서** — 런북 §Linux: 업데이트 흐름·비밀번호 1회·알려진 제약(스펙 6.5)·Owner 절차(스펙 9)·실기 체크리스트(X→X+1). 검증 문서에 Linux 절(CI 범위와 남은 실기 항목). 규칙 `mobile.md`의 "자동 업데이트 없음"을 바꾼다. `CLAUDE.md` 데스크톱 API 줄에 `linux`·`.deb`.
- [ ] **Step 5: 확인** — `bash -n mobile/scripts/*.sh`, `npx --yes actionlint .github/workflows/linux-app.yml`(없으면 YAML 문법만) / Expected: 오류 없음.
- [ ] **Step 6: Commit** — `feat(desktop): Linux 빌드·서명 워크플로와 업그레이드 검증, 런북`.

### Task 8: 전체 검증·PR

- [ ] **Step 1** — `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`, `cd mobile && flutter test && flutter analyze` / Expected: 모두 통과.
- [ ] **Step 2** — 실기(Ubuntu 26.04, 개발 빌드에 임시 키 dart-define): 업데이트 띠가 뜨는 조건은 운영 데이터가 필요하므로, 가짜 서버 대신 `DesktopUpdater` 수동 확인(`업데이트 확인`)이 "서명 키 없음"/"최신 버전"을 보이는지만 확인. pkexec 창은 `pkexec /usr/bin/true`로 문구 확인. 결과를 PR 본문 검증 절에.
- [ ] **Step 3** — 띄운 임시 프로세스 종료, `git status`로 `analysis_options.yaml` 등 도구가 고친 파일 되돌림.
- [ ] **Step 4** — 사용자 확인 후 포크(`fork` 원격)에 push, `abraxas73/inje-playground`에 PR(base `main`, #171 머지 뒤 또는 "#171 기반" 명시). 본문에 스펙 9절 **프로젝트 Owner 할 일**과 6.5절 알려진 제약.
