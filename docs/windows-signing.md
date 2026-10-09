# TODO: Windows 코드 서명 도입

현재 배포된 1.4.6 Windows 설치 파일은 서명 전 내부 테스트 빌드다.
`Windows signed release` 워크플로는 Azure Artifact Signing Public Trust 설정이 완료된 후 사용한다.
아직 인증서 발급·회사 인증·실제 서명은 수행하지 않았다. 설정이 없거나 서명 검증에 실패하면 산출물을 게시하지 않는다.

## 상태와 재개 조건

- **상태: 보류 / TODO** — 2026-10-09 사용자 요청으로 문서화 후 진행을 멈춘다.
- 현재 Windows 1.4.6은 서명 전 내부 테스트 배포본이다. 사용자가 Windows 동작을 확인했으며, 최초 설치 경고 개선이 후속 과제다.
- 준비된 자동화는 초안이다. 실제 Windows 서명 실행·인증서 체인·타임스탬프 검증은 아직 수행하지 않았다. 일반 Windows 빌드 CI에서는 PowerShell 구문과 기존 설치 파일 생성을 검사한다.
- 사용자가 재개를 요청하고 기존 회사 인증서 또는 사용할 Azure 구독·비용 부담 주체가 확인되면 이어서 진행한다.
- 보류 중에는 유료 리소스 생성, 회사 인증 신청, 실제 서명, 서명본 배포를 진행하지 않는다.

## 실행 TODO

- [x] 기존 Windows 빌드·설치 파일 생성 절차 확인
- [x] Microsoft 공식 서명 지원·회사 인증·GitHub 연동 문서 조사 (2026-10-09 기준)
- [x] 자동 서명 워크플로 및 검증 스크립트 초안 준비
- [ ] 관리자: 기존 회사 코드 서명 인증서 유무·발급기관·보관 방식 확인
- [ ] 관리자: 기존 인증서 재사용 또는 Azure Artifact Signing 방식 결정
- [ ] Azure 선택 시 관리자: 사용할 구독·요금제·비용 부담 주체 확정
- [ ] Azure 선택 시 관리자: 법인 정보 및 회사 이메일 인증·추가 서류 제출, 회사 인증 완료
- [ ] Azure 선택 시: Public Trust 프로필·최소 권한·GitHub OIDC·환경 변수 구성
- [ ] 개발: 선택한 서명 방식에 맞춰 초안 검토·보완 및 Windows 환경에서 검증
- [ ] 개발: 새 버전으로 EXE/DLL 및 설치 프로그램 서명, 게시자·체인·타임스탬프·SHA-256 검증
- [ ] 관리자/테스터: 깨끗한 Windows 환경에서 설치·업데이트·실행·게시자 표시 확인
- [ ] 개발: 서명된 설치 파일 게시 및 다운로드 페이지 안내 문구 갱신

### 준비된 초안 위치

- `.github/workflows/windows-signed.yml`: main에서 수동 실행하는 Azure OIDC 서명 워크플로
- `mobile/scripts/build-windows.ps1`: 빌드와 패키징 단계를 분리하는 변경 초안
- `mobile/scripts/verify-windows-signatures.ps1`: 서명·게시자·타임스탬프 검사 초안

2026-10-10 요청에 따라 위 초안을 TODO 문서와 함께 저장소에 보관한다. 저장소 반영은 서명 서비스 활성화나 서명본 배포를 의미하지 않는다. 재개 시 서비스 지원 국가·가격·액션 버전과 CI 설정을 다시 확인한다.

## 관리자에게 필요한 정보와 작업

1. 기존 회사 코드 서명 인증서 또는 Azure 구독 유무를 확인한다. 기존 인증서가 있다면 발급기관과 보관 방식(HSM/클라우드/USB 토큰)을 확인하고 먼저 재사용 가능성을 검토한다. 개인키·비밀번호를 채팅이나 저장소에 올리지 않는다.
2. Azure를 사용할 경우 이노그리드가 비용을 부담할 구독을 선택한다. Microsoft 365 계정이 있다고 Azure 유료 구독이 자동으로 있는 것은 아니다. 리소스 생성·역할 할당이 가능한 관리자가 필요하다.
3. Artifact Signing 계정과 **Public / Organization** 신원 검증을 신청한다. 법인명·주소·웹사이트·담당자 회사 이메일을 법적 서류와 일치하게 기재한다. 인증 메일 수락과 Microsoft가 요구하는 추가 서류 제출은 회사 담당자가 진행한다. 최신 공식 문서는 한국 법인을 지원 대상으로 명시한다. 개인용 공개 인증은 한국 개인에게 제공되지 않는다.
4. 검증 완료 후 **Public Trust** 인증서 프로필을 만든다. Private Trust 또는 Public Trust Test 프로필은 일반 직원 PC 배포용으로 쓰지 않는다.
5. GitHub 연동용 Entra 애플리케이션/서비스 주체에 해당 인증서 프로필 범위의 **Artifact Signing Certificate Profile Signer** 권한만 부여한다. 장기 비밀번호 대신 GitHub OIDC를 사용한다.

계정 생성 시부터 과금되므로 구독·요금제 확인 후 생성한다. 인증 심사는 공식 안내상 1~20영업일이며 추가 서류에 따라 길어질 수 있다. 서명이 SmartScreen 경고의 즉시 해소를 보장하지는 않는다.

## CI 설정

GitHub repository: `abraxas73/inje-playground`
Environment: `windows-signing` (배포 가능 브랜치를 **main만**으로 제한)

Entra federated credential:
- Issuer: `https://token.actions.githubusercontent.com`
- Subject: `repo:abraxas73/inje-playground:environment:windows-signing`
- Audience: `api://AzureADTokenExchange`

Environment variables:

| 이름 | 값 |
| --- | --- |
| AZURE_CLIENT_ID | 연동 앱의 Application (client) ID |
| AZURE_TENANT_ID | 회사 Directory (tenant) ID |
| AZURE_SUBSCRIPTION_ID | 선택한 구독 ID |
| SIGNING_ENDPOINT | 생성한 계정 리전의 실제 endpoint (Korea Central 예: `https://krc.codesigning.azure.net`) |
| SIGNING_ACCOUNT | Artifact Signing 계정 이름 |
| SIGNING_PROFILE | Public Trust 인증서 프로필 이름 |
| WINDOWS_SIGNING_SUBJECT | 발급된 인증서의 정확한 Subject DN, 표시 순서 포함 |

설정이 끝나면 main에서 `Windows signed release`를 수동 실행한다.
빌드 → 서명 없는 EXE/DLL만 서명(기존 Microsoft 서명 보존) → 전체 서명 유효성 및 INNOGRID.exe 게시자·타임스탬프 검사 → 설치 파일 생성 → 설치 파일 서명 → 게시자·타임스탬프 검사 → 서명 후 SHA-256 생성 순서다.
Azure 로그인/서명 액션은 검토한 커밋에 고정했다. 실패 시 unsigned fallback이나 자동 게시를 하지 않는다.

## 첫 서명 배포

- 새 버전 번호로 빌드한다. 이미 게시된 1.4.6 파일을 같은 경로로 덮어쓰지 않는다.
- `INNOGRID-Windows-Signed` 산출물을 내려받아 서명·해시·설치·실행을 확인한다.
- 기존 `frontend/scripts/publish-desktop.mjs`로 새 버전을 게시한다.
- 웹 다운로드 카드의 '코드 서명 전 테스트 빌드' 문구도 실제 서명 검증 결과에 맞춰 변경한다. 서명 전 파일에 미리 '서명 완료'를 표시하지 않는다.
- 기존 `Windows app` 워크플로는 내부 테스트용 unsigned 빌드이며 자동 배포하지 않는다.

## 공식 자료

- https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- https://github.com/Azure/artifact-signing-action
- https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
