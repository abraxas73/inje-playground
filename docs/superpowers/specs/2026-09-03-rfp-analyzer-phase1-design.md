# RFP 분석 — 1단계(업로드·등록·요구사항 표) 설계

> 2026-09-03 초안. 제안요청서(RFP) 파일을 올리면 프로젝트를 등록하고, 요구사항을 추출해 엑셀 형식의 상세 요구사항 표를 만들어 화면에서 편집·다운로드하는 사용자용 대메뉴.
> 전체 기능은 3단계로 나눈다. **이 문서는 1단계만** 다룬다. 2단계(솔루션 기능 카탈로그 + 요구사항별 당사 솔루션 매핑), 3단계(SharePoint 등록)는 별도 스펙.
> 샘플: `제안요청서.hwp`(한국석유공사 생성형 AI 플랫폼 구축, 1.2MB, 요구사항 124건), 분석 표 `(한국석유공사) …_요구사항 검토_v0.1_20260903_AI플랫폼팀.xlsx`(시트 19개).

## 1. 목표와 범위

**사용자 흐름(1단계)**
1. `/rfp`에서 hwp·hwpx·docx 파일을 올린다.
2. 서버가 파일을 파싱해 사업 개요(사업명·발주기관·사업기간·설계금액·입찰방법)를 뽑고, **이미 등록된 프로젝트인지 판단**한다. 중복이면 "이미 등록된 프로젝트"를 알리고 상세 화면으로 보낸다. 애매하면 사용자에게 확인한다.
3. 새 프로젝트를 등록하고 요구사항을 추출해 **상세 요구사항 표**를 만든다.
4. `/rfp/[id]`에서 개요와 요구사항 표를 보고 셀 단위로 편집하고, **샘플과 같은 시트 구성의 xlsx**를 내려받는다.

**1단계에 포함하지 않는 것**
- 요구사항 ↔ 당사 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit) 자동 매핑. 1단계의 "당사 솔루션" 열은 사람이 적는 자유 텍스트다.
- SharePoint(Teams) 등록.
- 배포용(암호화) HWP, 이미지로만 된 스캔 문서.

**브레인스토밍에서 확정한 결정**

| 결정 | 선택 |
|---|---|
| 단계 나누기 | 3단계(등록·표 → 솔루션 매핑 → SharePoint) |
| 요구사항 추출 | 표준 양식은 규칙, 비표준만 Claude API 폴백 |
| 접근 범위 | user 역할 이상 전사 공유. 삭제는 등록자·admin |
| 중복 판단 | 파일 해시 또는 정규화한 사업명+발주기관 일치 → 중복. 판단이 안 되면 사용자 확인 |
| 편집 그리드 | TanStack Table + 셀 인라인 편집(textarea) |
| 실행 위치 | **전부 Next.js**. HWP 파서는 `cfb` + Node zlib로 직접 작성(스파이크로 검증) |

## 2. 아키텍처

```
브라우저 /rfp ──① 서명 업로드 URL 요청──▶ POST /api/rfp/uploads
   │                                        (Storage 버킷 rfp, 경로 uploads/{uuid}/{원본명})
   ├──② 파일 PUT(브라우저→Storage 직접)
   └──③ POST /api/rfp/projects {storagePath, fileName, sizeBytes, force?}
             │ 파일 내려받기 → sha256 계산 → parse(hwp|hwpx|docx) → DocumentModel
             │ extractOverview → dedupe(해시·사업명+발주기관·유사도)
             ├─ 중복 → 200 {duplicate:true, projectId}
             ├─ 유사(확정 불가) & !force → 200 {needsConfirm:true, candidates[], overview}
             └─ 신규 → rfp_projects(extracting) + rfp_files insert → 201 {projectId}
                        after(): extractRequirements(standard | llm) → rfp_requirements → status ready|failed
브라우저 /rfp/[id] ──GET /api/rfp/projects/[id] 폴링(extracting 동안)──▶ 개요·표 렌더
                    ──PATCH /api/rfp/requirements/[requirementId]──▶ 셀 저장
                    ──GET /api/rfp/projects/[id]/xlsx──▶ exceljs 다운로드
```

- **파일은 Storage로 직접 올린다.** Vercel 서버리스 함수의 요청 본문 상한(4.5MB)을 피하기 위해서다. 서버는 경로만 받아 service role로 내려받는다. 업로드 상한은 50MB.
- **추출은 응답 뒤에 이어서 실행한다.** `next/server`의 `after()`를 쓴다. 규칙 추출은 수 초, LLM 폴백은 길어서 라우트 `maxDuration = 300`. 화면은 상태를 3초 간격으로 폴링한다.
- **순수 로직은 `frontend/src/lib/rfp/`** 에 두고 전부 vitest 대상이다. 라우트는 얇게 유지한다.

```
frontend/src/lib/rfp/
  document-model.ts   DocumentModel·Block·Table·Cell 타입, 표 → 2차원 그리드 유틸
  parse-hwp.ts        HWP 5.x(OLE) 레코드 파서 → DocumentModel
  parse-hwpx.ts       HWPX(zip+XML) → DocumentModel
  parse-docx.ts       DOCX(zip+XML) → DocumentModel
  parse.ts            확장자·매직넘버로 분기, 암호화 문서 거부
  overview.ts         사업 개요 추출 + 정규화(normalizeName/normalizeAgency)
  dedupe.ts           중복·유사 판단(순수 함수, 후보 목록 입력)
  extract-standard.ts 표준 양식 판정·규칙 추출
  extract-llm.ts      Claude API 폴백(SDK 호출은 주입 가능하게)
  requirements.ts     Requirement 타입, 구분 코드 순서(SER…COR), ID 파싱
  xlsx.ts             exceljs 워크북 생성
frontend/src/app/api/rfp/…      라우트
frontend/src/app/rfp/…          화면
frontend/src/components/rfp/…   UploadDropzone, ProjectList, OverviewCard, RequirementsTable, ConfirmDuplicateDialog
frontend/src/types/rfp.ts       API 응답 타입
docs/sql/2026-09-03-rfp-analyzer.sql
```

## 3. 문서 모델과 파서

세 파서는 같은 **DocumentModel**을 낸다. 요구사항 추출·개요 추출은 이 모델만 본다.

```ts
type Block = Paragraph | Table;
interface Paragraph { type: "paragraph"; text: string }            // 줄바꿈은 \n 유지
interface Table { type: "table"; rows: number; cols: number; cells: Cell[] }
interface Cell { row: number; col: number; rowSpan: number; colSpan: number; text: string; tables: Table[] }
interface DocumentModel { format: "hwp" | "hwpx" | "docx"; blocks: Block[] }
```

셀 텍스트는 셀 안 문단을 `\n`으로 이었고, 셀 안에 중첩된 표는 `tables`에 따로 둔다(세부 내용 안의 소표를 텍스트로 펼칠 때 `[a | b | c]` 형태로 한 줄씩 붙인다. 샘플 xlsx의 INR-DTL-004가 이 형태다).

**HWP (`parse-hwp.ts`)** — 스파이크로 샘플 검증 완료(최상위 표 232개, 7행 요구사항 표 124개 = 총괄표 합계).
- `cfb`로 OLE 컨테이너를 열고 `FileHeader` 36바이트 오프셋의 플래그를 읽는다. bit0 압축, bit1 암호화, bit2 배포용. 암호화·배포용은 `UnsupportedDocumentError`.
- `BodyText/Section{n}`을 번호순으로 읽고 압축이면 `zlib.inflateRawSync`.
- 레코드 헤더 4바이트: tag 10비트, level 10비트, size 12비트(0xFFF면 뒤 4바이트가 size).
- 쓰는 태그: `PARA_TEXT(67)`, `CTRL_HEADER(71)`, `LIST_HEADER(72)`, `TABLE(77)`. 표는 `CTRL_HEADER`의 id가 `tbl `일 때 시작한다. `TABLE` 레코드에서 rows/cols, `LIST_HEADER`(표와 같은 level)에서 셀의 col·row·colSpan·rowSpan, 그보다 깊은 `PARA_TEXT`가 셀 텍스트다. **표는 레코드 level이 표 level보다 낮아질 때 끝난다**(셀 문단 헤더는 셀 헤더와 같은 level이므로 "같거나 낮을 때"로 하면 표를 일찍 닫는다 — 스파이크에서 겪은 버그).
- `PARA_TEXT` 문자 처리: 확장 컨트롤(1,2,3,11,12,14~18,21~23)과 인라인 컨트롤(4~9,19,20)은 16바이트 건너뛰기, 10은 `\n`, 13은 문단 끝, 24는 `-`, 30·31은 공백, 그 외 32 미만 무시.
- 머리말·꼬리말(`head`/`foot` 컨트롤)의 리스트 헤더는 표 level과 다르므로 셀로 잡히지 않는다.

**HWPX (`parse-hwpx.ts`)** — zip을 `fflate`로 풀고 `Contents/section*.xml`을 `fast-xml-parser`(preserveOrder)로 읽는다. `hp:p`가 문단, `hp:tbl`이 표, `hp:tr`/`hp:tc`가 행·셀, `hp:cellAddr`(colAddr·rowAddr)·`hp:cellSpan`(colSpan·rowSpan)이 위치·병합. `hp:t`를 이어 텍스트로 만든다. `Contents/header.xml`은 보지 않는다.

**DOCX (`parse-docx.ts`)** — 같은 방식으로 `word/document.xml`을 읽는다. `w:p` 문단, `w:tbl` 표, `w:tr`/`w:tc`, 병합은 `w:gridSpan`(colSpan)과 `w:vMerge`(restart가 시작, 값 없는 vMerge는 위 셀에 합침). 텍스트는 `w:t`, 줄바꿈 `w:br`.

**분기 (`parse.ts`)** — 확장자와 매직넘버(`D0CF11E0` = OLE, `504B0304` = zip)를 함께 본다. zip이면 `Contents/content.hpf`(hwpx)와 `word/document.xml`(docx) 존재로 구분한다. 어긋나면 `UnsupportedDocumentError`.

## 4. 사업 개요 추출 (`overview.ts`)

출력: `{ name, agency, period, budget, bidMethod, extra: Record<string,string> }` (못 찾은 값은 null).

규칙은 순서대로 시도하고 먼저 맞는 것을 쓴다.
1. **라벨 문단**: 문단 텍스트가 `^[\s□■○◦•\-·]*(사업명|사업 명|과업명|용역명)\s*[:：]\s*(.+)$` 형태면 사업명. 같은 방식으로 `사업기간|용역기간|계약기간`, `설계금액|사업금액|사업예산|추정가격|기초금액`, `입찰 및 계약 방법|입찰방법|계약방법`, `발주기관|수요기관|발주처|주관기관`. 값이 비어 있고 다음 문단이 `◦`로 시작하면 다음 문단을 값으로 쓴다(샘플의 입찰방법).
2. **라벨 표**: 2열 표에서 왼쪽 셀이 위 라벨이면 오른쪽 셀이 값(hwp 표지·docx 양식).
3. **발주기관 폴백**: 라벨로 못 찾으면 본문에서 `([가-힣A-Za-z0-9·()]+?(?:공사|공단|청|부|처|원|진흥원|재단|위원회|특별시|광역시|시|군|구|도|대학교|대학|은행|센터|협회|공공기관))\s*\(\s*이하\s*[“"']` 패턴의 첫 매치. 샘플은 이 규칙으로 "한국석유공사".
4. **사업명 폴백**: 표지 표(첫 5개 블록 안)에서 `「…」`·`｢…｣`·`"…"`로 감싼 문구, 그다음 "제안요청서" 앞 문장.

정규화(`normalizeName`/`normalizeAgency`): NFKC → 소문자 → 공백·기호(`·()[]「」｢｣"'-_.,/`) 제거. **사업명은 괄호 문자만 지우고 괄호 안 내용은 남긴다**("(1단계)"·"(2단계)"처럼 괄호 내용만 다른 별개 사업이 하드 중복으로 합쳐지지 않게 — 2026-09-04 구현 리뷰에서 조정). 발주기관은 `(이하 …)`·영문 약칭 등 괄호와 그 안 내용을 제거한다. 사업명은 `재공고|긴급|수정|변경|정정` 같은 접미 단어를 떼어낸 `nameCore`도 함께 만든다(유사 판단용).

## 5. 중복 판단 (`dedupe.ts`)

입력: 새 파일의 `{ sha256, overview }`와 기존 프로젝트 목록 `{ id, name, agency, nameNorm, agencyNorm, fileHashes[] }`. 출력은 세 가지 중 하나.

| 결과 | 조건 | 서버 응답 / 화면 |
|---|---|---|
| `duplicate` | `sha256`이 기존 `rfp_files.sha256`과 같음, 또는 `nameNorm`·`agencyNorm`이 모두 있고 둘 다 같음 | `{duplicate:true, projectId}` → 토스트 "이미 등록된 프로젝트입니다" + `/rfp/[id]` 이동 |
| `needsConfirm` | 위가 아니고, `nameCore`가 같거나 `nameNorm` 유사도(bigram Dice) ≥ 0.85인 프로젝트가 있음. 또는 발주기관을 못 뽑았는데 `nameNorm`이 같은 프로젝트가 있음 | `{needsConfirm:true, candidates:[{id,name,agency,createdAt}], overview}` → 확인창 "유사한 프로젝트가 있습니다. 새로 등록 / 기존으로 이동". "새로 등록"은 `force:true`로 재요청 |
| `new` | 그 외 | 등록 진행 |

DB에도 `(name_norm, agency_norm)` 부분 유니크 인덱스(둘 다 not null일 때)를 둬 동시 등록 경쟁을 막는다. 유니크 위반이면 해당 프로젝트를 찾아 `duplicate`로 응답한다.

## 6. 요구사항 추출

### 6.1 Requirement 타입 (`requirements.ts`)

```ts
interface Requirement {
  categoryCode: string;   // "SER" | "ASR" | … | "INR-DTL" — ID에서 마지막 숫자 묶음 앞부분
  categoryName: string;   // "서비스 요구사항"
  reqId: string;          // "SER-001"
  title: string;          // 요구사항 명칭
  definition: string;     // 정의
  details: string;        // 세부 내용
  deliverables: string;   // 산출정보
  related: string;        // 관련요구사항
  sortOrder: number;      // 문서 등장 순서
  source: { blockIndex: number } | { llm: true };
}
```

구분 표시 순서는 공공 SW 표준 분류를 기본으로 두고(`SER ASR FUR DAR SYS GOV QMR DPR INF INR INR-DTL PER TER SEC PMR PSR COR`), 목록에 없는 코드는 등장 순서대로 뒤에 붙인다. 상세 시트 이름은 샘플처럼 `{순번}.{코드}`(INR-DTL은 `INRDTL`).

### 6.2 표준 양식 판정·규칙 추출 (`extract-standard.ts`)

- **판정**: 최상위 표 중 첫 셀(row 0, col 0)의 공백 제거 텍스트가 `요구사항분류`이고 라벨 셀 집합에 `요구사항고유번호`·`요구사항명칭`이 들어 있는 표가 1개 이상이면 표준.
- **추출**: 표마다 라벨 셀 → 값 셀 매핑. 값 셀은 같은 row에서 라벨 셀 오른쪽에 있는 첫 셀. 라벨 정규화 표:

| 라벨(공백 제거 후) | 필드 |
|---|---|
| `요구사항분류` | categoryName |
| `요구사항고유번호`, `요구사항ID`, `고유번호` | reqId |
| `요구사항명칭`, `요구사항명` | title |
| `정의` | definition (샘플은 "요구사항 상세설명" 셀 아래 "정의"·"세부 내용"이 하위 라벨) |
| `세부내용` | details |
| `산출정보`, `산출물` | deliverables |
| `관련요구사항` | related |

- 셀 안 중첩 표는 `[a | b | c]` 줄로 펼쳐 details 끝에 붙인다.
- `reqId`가 비었거나 `^[A-Z]{2,5}(-[A-Z]{2,5})*-\d{2,4}$`에 맞지 않으면 그 표는 건너뛰고 경고에 기록한다.
- **총괄표 대조**: 첫 셀이 `요구사항구분`이고 어느 행 첫 셀이 `요구사항수`인 표가 있으면 구분별 건수를 읽어 추출 결과와 비교한다. 다르면 `warnings`에 "총괄표 N건, 추출 M건 (구분 X)"을 남긴다. 실패가 아니라 경고다.
- 결과: `{ requirements, warnings, method: "standard" }`.

### 6.3 LLM 폴백 (`extract-llm.ts`)

표준이 아닐 때만 실행한다. `claude-api` 스킬 기준을 따른다.
- SDK `@anthropic-ai/sdk`, 모델 `claude-opus-5`(env `RFP_LLM_MODEL`로 교체 가능), `thinking: {type:"adaptive"}`, 스트리밍 + `finalMessage()`, `max_tokens 64000`. 서버 측 refusal fallback(`fallbacks: "default"`)을 켠다.
- 문서 모델을 텍스트로 펴서(표는 `| a | b |` 마크다운) **섹션 단위로 나눈다**. 기준은 "요구사항" 제목 문단, 없으면 30,000자 단위. 청크마다 한 요청.
- 출력은 `output_config.format` JSON 스키마(structured outputs)로 `{ requirements: Requirement[] }`를 받는다. 필드는 6.1과 같고 `categoryCode`는 서버가 `reqId`에서 계산한다. `reqId`가 없는 항목은 구분 코드를 LLM이 준 `categoryName`의 영문 약칭으로 만들고 `{코드}-{연번}`을 부여한다.
- 청크 결과를 합쳐 `reqId` 중복은 먼저 나온 것을 남긴다.
- `ANTHROPIC_API_KEY`가 없으면 호출하지 않고 `failed` + "표준 양식이 아니며 LLM 키가 설정되지 않았습니다".
- SDK 클라이언트는 함수 인자로 주입해 테스트에서 모킹한다.

## 7. 데이터 모델 (`docs/sql/2026-09-03-rfp-analyzer.sql`)

```sql
create table public.rfp_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agency text,
  period text,
  budget text,
  bid_method text,
  extra jsonb not null default '{}'::jsonb,          -- 추진 배경·주요 내용 등 나머지 개요
  name_norm text not null,
  agency_norm text,
  status text not null check (status in ('extracting','ready','failed')),
  extraction_method text check (extraction_method in ('standard','llm')),
  error text,
  warnings jsonb not null default '[]'::jsonb,
  requirement_count int not null default 0,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rfp_projects_name_agency_uq on public.rfp_projects (name_norm, agency_norm) where agency_norm is not null;

create table public.rfp_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  format text not null check (format in ('hwp','hwpx','docx')),
  size_bytes bigint not null,
  sha256 text not null unique,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.rfp_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  category_code text not null,
  category_name text not null,
  req_id text not null,
  title text not null default '',
  definition text not null default '',
  details text not null default '',
  deliverables text not null default '',
  related text not null default '',
  solution text not null default '',                   -- 당사 솔루션(자유 텍스트, 2단계에서 구조화)
  sort_order int not null,
  source jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, req_id)
);
create index rfp_requirements_project_idx on public.rfp_requirements (project_id, sort_order);
```

- RLS는 켜고 정책은 두지 않는다(service role만 접근). 접근 제어는 API 라우트가 한다. 기존 Claude 사용량 테이블과 같은 방식.
- Storage 버킷 `rfp`(private). 경로 `uploads/{uuid}/{원본 파일명}`. 프로젝트 삭제 시 파일도 지운다.
- `updated_at`은 기존 테이블처럼 트리거로 갱신한다.

## 8. API

라우트의 `[id]`는 프로젝트 uuid, `[requirementId]`는 `rfp_requirements.id`(uuid)다. `SER-001` 같은 요구사항 ID는 본문 필드 `reqId`로만 다룬다.

인증은 `requireUser()`(새로 추가, `lib/rfp/require-user.ts`): 세션 사용자가 있고 `user_profiles.role`이 `user` 또는 `admin`이면 통과. 401/403 메시지는 `requireAdmin`과 같은 형식.

| 메서드·경로 | 역할 | 요청 → 응답 |
|---|---|---|
| `POST /api/rfp/uploads` | 서명 업로드 URL | `{fileName, size}` → 확장자·크기 검사 → `{storagePath, signedUrl, token}` (`createSignedUploadUrl`, 5분) |
| `POST /api/rfp/projects` | 등록 | `{storagePath, fileName, sizeBytes, force?}`(sha256은 서버가 파일 바이트로 계산) → 파싱·개요·중복 판단 → `200 {duplicate}` / `200 {needsConfirm, candidates, overview}` / `201 {projectId}`. 파싱 실패 400·415, 이후 `after()`로 추출. `maxDuration = 300` |
| `GET /api/rfp/projects` | 목록 | `?q=` 사업명·발주기관 검색 → `{projects:[{id,name,agency,status,requirementCount,createdBy:{name},createdAt}]}` |
| `GET /api/rfp/projects/[id]` | 상세 | `{project, files, requirements}` (폴링에도 사용, `?fields=status`면 상태만) |
| `PATCH /api/rfp/projects/[id]` | 개요 편집 | `{name?, agency?, period?, budget?, bidMethod?}` → 정규화 갱신, 유니크 위반은 409 |
| `DELETE /api/rfp/projects/[id]` | 삭제 | 등록자·admin만. 파일·요구사항 함께 삭제 |
| `POST /api/rfp/projects/[id]/reextract` | 재추출 | 기존 요구사항 삭제 후 `extracting`으로 되돌리고 `after()`로 다시 추출 |
| `GET /api/rfp/projects/[id]/xlsx` | 다운로드 | exceljs 버퍼, `Content-Disposition` 파일명 `(발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx` |
| `POST /api/rfp/projects/[id]/requirements` | 행 추가 | `{categoryCode, categoryName, reqId, …}` → 201. `reqId` 중복 409 |
| `PATCH /api/rfp/requirements/[requirementId]` | 셀 편집 | 필드 부분 갱신, `updated_by` 기록 → 갱신된 행 |
| `DELETE /api/rfp/requirements/[requirementId]` | 행 삭제 | 204 |

`after()` 안의 추출 함수는 프로젝트 상태를 반드시 `ready` 또는 `failed`로 끝낸다. 예외를 잡아 `failed` + 메시지를 쓰고, 3분 넘게 `extracting`인 프로젝트는 상세 화면이 "시간 초과, 재추출" 안내를 보인다.

## 9. 화면

- **내비·홈**: `Navigation.tsx` NAV_ITEMS에 `{ href: "/rfp", label: "RFP 분석", icon: FileSearch, minRole: "user" }`. `roles.ts`의 user·admin 허용 경로에 `/rfp` 추가. 홈 FEATURES에 카드 "RFP 분석 — 제안요청서를 올리면 요구사항 표를 만들어 드립니다".
- **`/rfp`**: 드롭존(hwp·hwpx·docx, 50MB) + 프로젝트 표(사업명, 발주기관, 요구사항 수, 상태 배지, 등록자, 등록일, 검색). 업로드 진행은 "업로드 중 → 분석 중" 두 단계로 표시. 중복이면 토스트 후 이동, 유사면 `ConfirmDuplicateDialog`.
- **`/rfp/[id]`**:
  - `OverviewCard`: 사업명·발주기관·사업기간·설계금액·입찰방법을 클릭해 인라인 편집. 상태 배지, 요구사항 건수, 추출 방식(규칙/LLM), 경고 목록, 원본 파일명(다운로드 서명 URL), "재추출"·"xlsx 다운로드"·"삭제" 버튼.
  - `RequirementsTable`: 탭 "전체 목록"(연번, 구분, ID, 명칭, 상세 시트, 당사 솔루션) + 구분별 탭(연번, ID, 요구사항명, 정의, 세부 내용, 산출정보, 관련요구사항). TanStack Table로 정렬·텍스트 필터. 셀 클릭 → textarea(자동 높이) → blur 또는 ⌘/Ctrl+Enter로 저장, Esc 취소. 저장 중 스피너, 실패 시 원래 값 복원 + 토스트. 긴 셀은 3줄까지 보이고 "더보기".
  - 행 추가(구분 선택 → 다음 번호 제안), 행 삭제(확인). 행 hover에 수정자·시각.
  - `extracting`이면 스켈레톤 + 3초 폴링. `failed`면 오류 메시지와 재추출 버튼.
- 모든 문구는 한국어. 기존 shadcn 컴포넌트(Card, Table, Dialog, Tabs, Badge, Button, Textarea) 사용.

## 10. xlsx (`xlsx.ts`)

exceljs로 샘플과 같은 구조를 만든다.
- `0.개요`: 제목 행(`「사업명」 제안요청서 요구사항 분석`), "1. 사업 개요 (일반사항)" 아래 사업명·사업기간·설계금액·발주기관·입찰 및 계약방법 key-value(B열 라벨, C~H 병합 값). `extra`에 값이 있으면 "2. 추진 배경" 이하로 이어 붙인다.
- `1.요구사항_목록`: 1행 제목(`요구사항 목록 총괄 (전체 N건)`), 3행 헤더(연번, 요구사항 구분, 요구사항 ID, 요구사항 명칭, 상세 시트 위치, 당사 솔루션), 열 너비 5/22/16/38/55/30.
- 구분별 시트 `{순번}.{코드}`: 1행 제목(`[코드] 구분명 — 상세 요구사항`), 3행 헤더(연번, 요구사항\nID, 요구사항명, 정의, 세부 내용, 산출정보, 관련요구사항), 열 너비 5/12/24/26/85/20/32, 세부 내용·관련요구사항은 `wrapText`, 상단 정렬.
- 헤더는 굵게 + 회색 배경 + 얇은 테두리. 폰트 "맑은 고딕" 10.
- 순수 함수 `buildWorkbook(project, requirements): Promise<Buffer>`로 두고 시트 이름·헤더·행 수를 테스트한다.

## 11. 오류 처리

| 상황 | 처리 |
|---|---|
| 확장자·매직넘버 불일치, 50MB 초과 | `POST /uploads` 400. 화면 즉시 안내 |
| 암호화·배포용 HWP | `POST /projects` 415 "암호화(배포용) 문서는 지원하지 않습니다". 프로젝트 생성 안 함, 업로드 파일 삭제 |
| 파싱 예외 | 400 "문서를 읽을 수 없습니다" + 로그. 프로젝트 생성 안 함 |
| 개요에서 사업명을 못 뽑음 | 파일명(확장자 제외)을 사업명으로 쓰고 `warnings`에 기록. 상세 화면에서 수정 유도 |
| 추출 실패(LLM 오류·키 없음·타임아웃) | 프로젝트는 남기고 `failed` + 메시지. 재추출 가능 |
| 총괄표와 건수 불일치 | `warnings`, 성공 처리 |
| 셀 저장 실패 | 셀 값 복원 + 토스트 |
| 동시 등록 유니크 위반 | 기존 프로젝트로 `duplicate` 응답 |

## 12. 테스트 (vitest, `frontend/src/lib/__tests__/rfp-*.test.ts`)

- `rfp-parse-hwp`: 샘플 `제안요청서.hwp`를 `src/lib/__tests__/fixtures/rfp/sample.hwp`로 저장(공개 입찰 문서, 1.2MB). 최상위 표 232개, 7행 표 124개, 첫 표 텍스트, 병합 셀(rowSpan) 값, 암호화 플래그 거부.
- `rfp-parse-hwpx` / `rfp-parse-docx`: 테스트에서 zip+XML을 직접 만들어 문단·표·병합을 확인(`fflate`로 생성).
- `rfp-overview`: 샘플 문단 배열로 사업명·기간·금액·입찰방법·발주기관, 정규화, `nameCore`.
- `rfp-dedupe`: 해시 일치, 정규화 일치, 유사(재공고), 발주기관 없음, 신규.
- `rfp-extract-standard`: 샘플 모델로 124건, 구분 코드, INR-DTL, 총괄표 대조 경고, 잘못된 ID 건너뛰기.
- `rfp-extract-llm`: 모킹된 클라이언트로 청크 분할, 스키마 파싱, 키 없음 처리.
- `rfp-xlsx`: 시트 이름 순서, 헤더, 행 수, 열 너비.
- 라우트·화면은 수동 확인(체크리스트를 계획에 포함).

## 13. 환경 변수·의존성·배포

- 새 env: `ANTHROPIC_API_KEY`(LLM 폴백, 없어도 표준 양식은 동작), `RFP_LLM_MODEL`(기본 `claude-opus-5`). Storage는 기존 `SUPABASE_SERVICE_ROLE_KEY`.
- 새 의존성: `cfb`, `fflate`, `fast-xml-parser`, `exceljs`, `@tanstack/react-table`, `@anthropic-ai/sdk`.
- SQL은 Supabase MCP 또는 Management API로 실행하고 Storage 버킷 `rfp`를 만든다. 배포는 `git push` 후 `vercel --prod`.

## 14. 2·3단계 접점

- 2단계는 `rfp_requirements.solution`을 구조화 테이블(`rfp_requirement_solutions`: 솔루션명·충족 기능·근거 링크·판정)로 확장하고, xlsx 목록 시트에 열을 덧붙인다. 1단계 xlsx의 "당사 솔루션" 열 위치를 그대로 쓴다.
- 3단계는 `GET …/xlsx`가 만드는 버퍼를 그대로 Graph 드라이브 업로드에 넘긴다.
