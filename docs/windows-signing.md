# Windows 코드 서명 런북

**상태(2026-11-19):** Windows 1.7.99부터 모든 설치 파일을 **(주) 이노그리드**로 Authenticode 서명해 배포한다. 직원 PC(스마트 앱 컨트롤 켜짐)에서 설치·실행되는 것을 사용자가 확인했다.
**Windows 릴리스 때마다 이 절차로 서명한다. 서명 없는 설치 파일은 다시 게시하지 않는다.**

## 서명 정보

| 항목 | 값 |
| --- | --- |
| 서비스 | Azure Artifact Signing(옛 Trusted Signing), 구독 "이노그리드" |
| 엔드포인트 | `https://krc.codesigning.azure.net/` (Korea Central) |
| 서명 계정 / 인증서 프로필 | `innogrid` / `innogrid-public` (Public Trust, 회사 신원 확인 완료) |
| 게시자(Subject) | `CN=(주) 이노그리드, O=(주) 이노그리드, L=서울특별시 중구, S=Seoul, C=KR` |
| 체인 | (주) 이노그리드 → Microsoft ID Verified CS AOC CA 03 → Microsoft ID Verified Code Signing PCA 2021 → Microsoft Identity Verification Root CA 2020 |
| 타임스탬프 | `http://timestamp.acs.microsoft.com` (RFC 3161, SHA-256) |

인증서는 Azure가 사흘 단위로 새로 발급한다(만료일이 가까워 보여도 정상). 타임스탬프가 있어 만료 뒤에도 서명은 유효하다.

## 서명하는 파일 (셋 다 필요)

1. **앱 안쪽 EXE·DLL**(`INNOGRID.exe`, 플러그인 DLL, `WinSparkle.dll` 등 서명 없는 13개, Microsoft 서명 파일은 그대로) — 빠지면 실행할 때 스마트 앱 컨트롤이 막는다("app_links_plugin.dll … 잘못된 이미지", 1.7.97 이하).
2. **Inno Setup 임시 설치 엔진 사본·제거 프로그램**(`uninst.e32`) — **컴파일 도중 ISCC `SignTool`로만** 서명된다. 다 만든 설치 파일의 바깥 exe에만 나중에 서명하면 이 사본이 서명 없이 남아 설치 첫 단계에서 막힌다: *"Unable to execute file in the temporary directory. Setup aborted. Error 4551: 애플리케이션 제어 정책에서 이 파일을 차단했습니다"* (1.7.97·1.7.98, 2026-11-19).
3. **바깥 설치 파일** `INNOGRID-Windows-<ver>-Setup.exe` — 같은 ISCC `SignTool`이 서명.

그다음 **Ed25519 업데이트 서명**(`.update.json`, 앱 자동 업데이트가 확인)을 만든다. Authenticode가 파일 바이트를 바꾸므로 순서는 반드시 Authenticode → Ed25519.

## 실행 (경로 B — 지금 쓰는 방법)

관리자 OIDC 설정(경로 A)이 없어서, 운영자 Mac의 `az login` 접근 토큰(약 1시간)을 GitHub 비밀값 `AZURE_SIGNING_TOKEN`에 **잠깐** 넣고 CI가 서명한다. 한 명령으로:

```bash
# 사전: pubspec 버전 올림 → 커밋·push(main), 이 Mac에서 az login(만료 시 `! az login`)
mobile/scripts/release-windows-signed.sh          # 서명 빌드 → 비밀값 삭제 → 검증 → 게시
mobile/scripts/release-windows-signed.sh --no-publish   # 게시 없이 서명본만
```

스크립트가 하는 일:
1. main·origin/main 일치, `az login` 확인.
2. 토큰 남은 시간이 40분 미만이면 새 토큰이 나올 때까지 기다린다(az는 만료 5분 전부터만 새로 발급 — 비밀값은 작업 시작 때 읽히고 서명은 시작 후 약 15분에 돈다).
3. `gh secret set AZURE_SIGNING_TOKEN` → `gh workflow run "Windows app" -f sign=true` → 완료 대기 → **성공·실패와 상관없이 비밀값 삭제**(trap).
4. 산출물 받기 → 로그에 `Running Sign Tool jsign`(ISCC 서명)이 있는지, sha256, `osslsigncode`로 Microsoft 루트 기준 Authenticode·타임스탬프 검증.
5. `frontend/scripts/publish-desktop.mjs windows <ver> <file> <현재 게시 sha256>` → 나온 compare-and-set SQL을 Management API로 적용 → `settings.desktop_app_release.windows`의 sha256이 파일과 같은지 확인.

## CI 구성 (`.github/workflows/windows-app.yml`, 입력 `sign`)

| 단계 | 비밀값 | 하는 일 |
| --- | --- | --- |
| Build application (unsigned, no secrets) | 없음 | main 확인, `build-windows.ps1 -Phase Build`, **`Set-Location $env:GITHUB_WORKSPACE`**(스크립트가 mobile/로 옮겨 둠), jsign 7.6 jar 받기(Maven Central, sha256은 워크플로에 고정), 서명 없는 EXE·DLL 목록 |
| Sign payload (token only here) | 토큰 | jsign `--storetype TRUSTEDSIGNING`으로 안쪽 파일 서명 |
| Package and sign installer (token only here) | 토큰 | `sign.cmd`(토큰은 `%AZ_TOKEN%`로 읽어 로그에 안 남음) 생성, `INNO_SIGN_CMD="cmd.exe /c <sign.cmd> $f"` → `build-windows.ps1 -Phase Package -RequireSignedPayload`(안쪽 서명·게시자 검사 후 ISCC `/DUseSignTool /Sjsign=…`) |
| Verify installer signature and hash signed bytes | 없음 | 게시자·타임스탬프 검사, 서명 후 sha256 |
| Sign final update artifact | Ed25519 키 | `-Phase Sign` |

관련 파일: `mobile/installer/windows.iss`(`#ifdef UseSignTool` → `SignTool=jsign`·`SignedUninstaller=yes`), `mobile/scripts/build-windows.ps1`(`INNO_SIGN_CMD`가 있으면 ISCC에 넘김), `mobile/scripts/verify-windows-signatures.ps1`.

## 함정

- **바깥 exe만 나중에 서명 금지** — Error 4551(위 2번). ISCC SignTool이 필수.
- **SignTool 명령에 따옴표를 넣지 않는다** — PowerShell이 네이티브 인자의 안쪽 `"`를 `\"`로 바꿔 `\D:\a\_temp\sign.cmd\`가 되고 "Error 2: The system cannot find the file specified". RUNNER_TEMP엔 공백이 없으니 `cmd.exe /c D:\a\_temp\sign.cmd $f`.
- **같은 버전 재게시 불가**(버킷 불변) — 서명을 다시 해야 하면 pubspec 버전을 올린다. 모바일 릴리스가 돌고 있을 때는 끝난 뒤에 올린다(빌드가 pubspec을 읽음).
- 로컬 검증은 macOS에 Microsoft 루트가 없어 그냥 하면 "unable to get local issuer certificate" — `-CAfile`에 Microsoft Identity Verification Root CA 2020을 준다(스크립트가 처리).
- 새 인증서라 SmartScreen·브라우저 다운로드 경고는 평판이 쌓일 때까지 뜰 수 있다(실행은 막지 않음). 스마트 앱 컨트롤 차단과는 별개.
- 스크립트에서 `gh run view --log | grep -q`처럼 파이프 앞쪽이 긴 출력이면 `set -o pipefail`에서 SIGPIPE로 실패한다 — 로그는 파일로 받아 검사한다(1.7.102에서 서명됐는데 "서명 로그 없음"으로 멈춤, 수동으로 검증·게시).
- `windows-app.yml`의 기본(`sign=false`) 빌드는 서명 없는 내부 확인용 — 게시하지 않는다.

## 경로 A (정식, 관리자 설정 필요)

`.github/workflows/windows-signed.yml`은 GitHub OIDC로 Azure에 로그인해 토큰 없이 서명하는 초안이다(아직 ISCC SignTool 반영 전 — 쓰려면 위 CI 구성처럼 바깥 exe 사후 서명을 SignTool로 바꿔야 한다). 필요한 것: Entra 앱 + federated credential(Issuer `https://token.actions.githubusercontent.com`, Subject `repo:abraxas73/inje-playground:environment:windows-signing`, Audience `api://AzureADTokenExchange`) + `innogrid-public` 범위 **Artifact Signing Certificate Profile Signer** 역할, GitHub 환경 `windows-signing`(main만)과 변수 `AZURE_CLIENT_ID`·`AZURE_TENANT_ID`·`AZURE_SUBSCRIPTION_ID`·`SIGNING_ENDPOINT`·`SIGNING_ACCOUNT`·`SIGNING_PROFILE`·`WINDOWS_SIGNING_SUBJECT`. 설정되면 경로 B(개인 토큰)를 걷어낸다.

## 이력

- 2026-10-09 보류(TODO), 초안 워크플로 보관.
- 2026-11-19 계정·프로필 정보 수령 → 로컬 jsign 시험 서명 성공 → 1.7.97(바깥 exe만, 로컬) → 1.7.98(안쪽 DLL까지, CI) → 둘 다 Error 4551 → **1.7.99 ISCC SignTool로 해결, 설치 확인**.
