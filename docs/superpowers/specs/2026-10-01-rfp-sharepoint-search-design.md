# RFP 카탈로그 — SharePoint 검색·소스 등록 조사 및 후속 설계

> 조사일: 2026-10-01 · 상태: **보류 / 후속 검토**
>
> 사용자 결정: 조사 내용을 문서화하고 구현은 나중에 진행한다. 착수일·출시일은 미정이다.
> 이 문서는 제안 설계이며, 검색 기능 구현·Entra 설정 변경·DB 변경·운영 배포를 의미하지 않는다.

## 1. 현재 구현과 조사 결론

| 구분 | 현재 지원 |
|---|---|
| 카탈로그 소스 검색 | Confluence 검색만 지원 |
| SharePoint 카탈로그 소스 | xlsx 파일 링크 직접 등록 → 실행자의 Microsoft 위임 권한으로 다운로드 → 기능 추출 |
| 카탈로그 xlsx 제한 | 20MiB, 엑셀 기능명세서 파서 사용. Claude 보강은 현재 Confluence 소스에만 적용 |
| RFP 분석 원본 | 사용자가 hwp·hwpx·docx·xlsx·pdf 파일을 직접 업로드 |
| 분석 결과 저장 | 사용자의 SharePoint 폴더에 결과 xlsx 업로드 |
| Microsoft 연동 | 기존 Entra 앱, 사용자별 계정 연결·토큰 갱신·암호화 저장·Graph 다운로드 재사용 가능 |

**결론:** SharePoint 검색 → 자료 선택 → 소스 등록은 추가 구현이 필요하다. 기존 OAuth 요청에는 `Files.ReadWrite.All`과 `Sites.Read.All`이 포함되어 있다. Microsoft Graph 문서상 driveItem 검색에 사용 가능한 위임 권한이므로, 실제 동의와 토큰 발급까지 정상이라면 검색을 위해 별도 앱이나 추가 권한을 만들 필요는 없다.

**확인한 것:** 저장소 코드, Microsoft 공식 문서.
**아직 확인하지 않은 것:** 운영 Entra 권한 승인 상태, 연결 사용자 토큰의 실제 권한, 대상 사이트 정책, 운영 계정으로 검색·다운로드 성공 여부. 코드에 권한 이름이 있다는 사실만으로 운영 사용 가능 상태를 보장하지 않는다.

## 2. 제안 범위와 단계

| 단계 | 범위 | 처리 방식 |
|---|---|---|
| 1차 제안 | 관리자 카탈로그에서 SharePoint xlsx 검색·다중 선택·등록 | 기존 다운로드·엑셀 파서·기능 병합·원본 최신 여부 확인 재사용 |
| 2차 제안 | PDF·DOCX 제품 설명서·매뉴얼을 카탈로그 소스로 등록 | 문서 텍스트 추출 → Claude 기능 추출, 소스 형식·상태 관리 확장 |
| 별도 후속 | SharePoint 제안요청서를 RFP 프로젝트 원본으로 가져오기 | 공용 검색 모듈 → 기존 프로젝트 등록·중복 검사·요구사항 추출 연결 |

1차의 파일 크기 제한은 현재 xlsx 20MiB를 유지한다. PDF·DOCX의 크기·페이지·토큰 상한은 샘플 검증 후 정한다. 스캔 PDF OCR, PPTX/HWP 카탈로그 추출, 상시 자동 동기화, 앱 전용 권한으로 전사 수집은 이번 제안의 초기 범위에 포함하지 않는다.

## 3. 사용자 흐름 제안

1. 관리자 → RFP 솔루션 카탈로그 → 대상 솔루션 → `SharePoint에서 찾기`.
2. 관리자가 허용한 사이트·문서 라이브러리 중 검색 범위를 선택한다.
3. 검색어·파일 형식을 지정하고 검색한다. 기본 25건씩 페이지 처리한다.
4. 파일명, 저장 위치, 수정일, 크기, 등록 여부, 원본 열기 링크를 표시한다. 미지원 형식은 등록 불가 이유를 표시한다.
5. 여러 파일을 선택해 소스로 등록한다. 중복·권한 없음·삭제됨 등은 파일별 결과로 안내한다.
6. `가져오기`를 실행해 기능을 추출하고 기존 카탈로그에 병합한다. 사람이 편집한 기능은 보존한다.

검색 결과의 요약문은 미리보기에만 사용한다. 기능 추출은 실제 파일을 다운로드해 수행한다. 등록과 가져오기 상태를 구분하고, 가져오기 실패한 파일만 재시도할 수 있게 한다. 기존 링크 직접 등록도 유지한다.

## 4. 서버 구조 제안

### 검색

- 관리자 인증 후 기존 사용자별 Microsoft 토큰 발급 경로를 사용한다.
- Microsoft Graph `POST /v1.0/search/query`, `entityTypes: ["driveItem"]`으로 검색한다.
- KQL의 파일 형식·경로 조건으로 범위를 한정한다. 임의 KQL을 그대로 통과시키지 않고 입력을 이스케이프하며, 허용 경로 조건은 서버가 구성한다.
- 검색 범위와 결과의 실제 사이트·드라이브를 서버에서 검증한다. 검색어로 허용 범위를 넓힐 수 없어야 한다.
- 제안 API: `POST /api/admin/rfp-catalog/sharepoint-search`.
- 입력 예: 검색어, 등록된 검색 범위 ID, 파일 형식, 페이지 위치. 출력 예: 파일 메타데이터, 이미 등록된 소스 ID, 다음 페이지 여부.
- 토큰과 사전 인증 다운로드 URL을 클라이언트 응답·로그에 포함하지 않는다. 검색 결과를 사용자 간 공용 캐시에 저장하지 않는다.

### 등록

- 제안 API: `POST /api/admin/rfp-catalog/solutions/[code]/sources/sharepoint`.
- 입력은 선택한 `driveId + itemId` 목록으로 받고, 서버가 실행자의 권한으로 파일을 다시 조회한다.
- 실제 사이트·파일 형식·크기·접근 권한을 재검증한다. 클라이언트가 보낸 파일명·URL·검색 결과만으로 등록하지 않는다.
- 같은 솔루션 안에서 `driveId + itemId`를 중복 기준으로 사용한다. 다른 솔루션에서 같은 문서를 사용하는 것은 허용한다.
- 기존 URL 등록과 검색 등록은 공용 등록 함수를 사용한다. 검색 결과의 webUrl을 공유 링크 해석 API로 다시 넘기는 방식에 의존하지 않는다.

### 가져오기·원본 추적

- 가져오기를 실행한 사람의 Microsoft 권한으로 파일을 다운로드한다. 토큰 갱신·다운로드·기능 병합 로직은 재사용한다.
- 파일별 작업 상태와 실패 이유를 관리하고, 한 파일의 실패가 나머지를 취소하지 않도록 한다. 동시 실행 수와 재시도 횟수를 제한하고 Graph 429의 Retry-After를 따른다.
- 원본 URL, driveId/itemId, 수정 시각, 버전 식별자(eTag 등), 마지막 가져오기 시각을 관리한다.
- 1차는 기존 `kind=xlsx`, `drive_id`, 파일 item ID를 보관하는 기존 `page_id` 구조를 우선 재사용한다. 중복 제약과 실제 저장 경로는 착수 시 확인한다.
- PDF·DOCX 확장 시에는 공급자(SharePoint)와 파일 형식을 분리하는 모델을 검토한다. 기존 소스·기능 연결을 보존하는 마이그레이션을 별도로 설계한다.
- 장시간 문서 추출은 현재 서버 실행 제한에 맞춰 파일/청크 단위로 처리한다. 대량·예약 수집이 필요해지면 지속 가능한 작업 큐를 별도 검토한다.

## 5. Entra 및 운영 사전 조건

기존 Microsoft 연동 앱을 재사용하는 안이다. 다음 항목은 **확인 목록**이며 실제 운영 설정을 확인했다는 뜻은 아니다.

### API 권한과 동의

Entra 관리 센터 → 앱 등록 → 기존 Microsoft 연동 앱 → API 권한에서 확인한다.

| 코드에서 요청하는 권한 | 유형·목적 | 확인 사항 |
|---|---|---|
| `User.Read` | Delegated, 연결 계정 확인 | 기존 설정 유지 |
| `offline_access` | OAuth 범위, 갱신 토큰 발급 | 장기 연결·갱신 가능 여부 |
| `Files.ReadWrite.All` | Delegated, 기존 파일 읽기·결과 업로드 | Application 권한과 혼동하지 않고 승인 상태 확인 |
| `Sites.Read.All` | Delegated, SharePoint 읽기·검색 | 승인 상태와 실제 발급 권한 확인 |

Graph의 driveItem 검색 권한 표에는 `Files.Read.All`, `Files.ReadWrite.All`, `Sites.Read.All`, `Sites.ReadWrite.All`이 나열된다. 이 권한들을 모두 추가해야 한다는 의미는 아니다. 현재 권한으로 접근 가능하면 `Files.Read.All`을 중복 추가하지 않는다.

- 조직의 사용자 동의 정책상 필요한 경우 관리자가 동의한다. 모든 위임 권한에 관리자 동의가 무조건 필수인 것으로 가정하지 않는다.
- 이번 사용자 실행형 검색을 위해 Application 권한이나 `Sites.ReadWrite.All`을 추가하지 않는다.
- 권한 추가·동의 변경 시 앱에서 Microsoft 계정을 재연결하고, 실제 검색과 파일 다운로드를 모두 확인한다.
- 검색 범위를 특정 사이트로 제한하는 앱 설정은 토큰 자체의 권한을 줄이는 것은 아니다. Entra 차원에서 선택 사이트에만 권한을 부여해야 한다면 Selected 권한과 검색 API 호환성을 별도로 조사한다.

### 인증·접근 정책

- 인증 플랫폼: 기존 서버 OAuth 콜백에 맞는 **Web** 설정 재사용.
- 운영 리디렉션 URI: `https://inje-playground.vercel.app/api/ms/callback`.
- 로컬 개발이 필요하면 해당 개발 오리진의 `/api/ms/callback`도 등록하고 `MS_ALLOWED_ORIGINS`와 일치시킨다. 임의 Preview 도메인을 자동 허용하지 않는다.
- 사용자 할당이 필요한 Enterprise application이면 사용할 계정/그룹을 할당한다.
- 대상 사용자의 SharePoint 읽기 권한, 조건부 액세스, 다운로드 제한 정책, 클라이언트 시크릿 만료 여부를 확인한다.
- SharePoint 조직 계정을 기준으로 검증한다. 개인 Microsoft 계정 검색은 이 설계의 대상이 아니다.

### 서버 설정

| 저장 위치 | 기존 설정 |
|---|---|
| 앱 settings | `teams_tenant_id`, `teams_graph_client_id` |
| 서버 환경 변수 | `TEAMS_GRAPH_CLIENT_SECRET`, `MS_TOKEN_ENC_KEY`, `MS_ALLOWED_ORIGINS` |
| Claude 문서 기능 추출 시 | `ANTHROPIC_API_KEY`, 선택적 `RFP_LLM_MODEL` |

1차 xlsx 검색·규칙 파서에는 Claude 키가 필요하지 않다. 비밀 값은 문서·PR·감사 로그에 기록하지 않는다.

## 6. 자료 공유 범위와 미결정 사항

**원본을 읽을 권한과 추출된 카탈로그를 열람할 권한은 다르다.** 검색·다운로드는 실행자 권한을 따르지만, 가져온 기능 설명은 현재 앱의 공용 카탈로그에 저장된다. 원본 권한이 나중에 회수돼도 저장된 설명이 자동 삭제되거나 접근 제한되는 구조가 아니다. 공개 RFP 공유 결과에 기능 설명·근거 문장이 포함될 수 있는 경로도 착수 시 점검한다.

권장 초기 정책은 회사 공용 제품 자료 사이트·라이브러리만 검색·등록 대상으로 허용하고, 관리자만 등록·가져오기를 실행하는 것이다. 이는 제안이며 아직 확정된 운영 정책은 아니다. 개인 자료까지 허용하려면 소스별 가시성, 권한 재검증, 파생 기능과 공유 결과의 접근 제어를 먼저 설계해야 한다.

착수 시 확정할 사항:

- 허용할 사이트·문서 라이브러리 URL과 해당 자료의 앱 내 재공유 허용 범위
- 1차 xlsx만 지원할지, PDF·DOCX도 최초 배포에 포함할지
- 대표 기능명세서와 제품 문서, 검증할 Microsoft 계정
- Entra 위임 권한 동의 상태와 실제 토큰으로 검색·다운로드한 결과
- 파일 수·크기·페이지·추출 비용 제한, 원본 변경 시 수동 재가져오기 정책
- SharePoint 검색 인덱스 반영 지연/검색 제외 정책으로 결과가 없는 경우의 안내와 직접 링크 등록 대안

## 7. 착수 시 검증 기준

- 허용 라이브러리의 xlsx를 검색·다중 선택·등록·가져오기해 기능 추출과 RFP 매핑까지 연결된다.
- 미연결·동의 누락·토큰 만료는 계정 연결/재연결 안내로 구분된다.
- 다른 사용자의 검색 결과나 토큰이 섞이지 않는다.
- 검색 범위 우회, 임의 driveId/itemId 제출, 원본 권한 회수 시 등록/다운로드가 차단된다.
- 폴더·미지원 형식·크기 초과·삭제된 파일·중복 등록을 각각 처리한다.
- 원본 수정 시 갱신 필요가 표시되고, 재가져오기해도 사람이 수정한 기능은 보존된다.
- Graph 일시 오류·429·파일별 부분 실패 후 재시도가 가능하다.
- 원본 자료에서 추출한 정보의 공용 카탈로그·공유 결과 노출이 확정된 운영 정책과 일치한다.

## 8. 근거

### 저장소 구현

- [OAuth 권한·토큰 교환](../../../frontend/src/lib/ms/oauth.ts)
- [Microsoft 연동 설정](../../../frontend/src/lib/ms/config.ts)
- [Graph 파일 조회·다운로드](../../../frontend/src/lib/ms/graph-drive.ts)
- [카탈로그 소스 등록 API](../../../frontend/src/app/api/admin/rfp-catalog/solutions/[code]/sources/route.ts)
- [카탈로그 가져오기 작업](../../../frontend/src/lib/rfp/catalog/import-job.ts)
- [기존 RFP 운영 문서](../../rfp-analyzer.md)

### Microsoft 공식 문서 — 2026-10-01 조사

- [Search API 권한·지원 리소스](https://learn.microsoft.com/en-us/graph/api/resources/search-api-overview?view=graph-rest-1.0)
- [searchEntity: query — v1.0](https://learn.microsoft.com/en-us/graph/api/search-query?view=graph-rest-1.0)
- [OneDrive·SharePoint 검색과 KQL 경로·형식 필터](https://learn.microsoft.com/en-us/graph/search-concept-files)
- [Entra 리디렉션 URI 규칙](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)

구현 재개 시 API 지원 범위와 테넌트 정책을 다시 확인한다.
