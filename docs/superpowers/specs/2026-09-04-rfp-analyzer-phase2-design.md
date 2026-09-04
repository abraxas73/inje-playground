# RFP 분석 — 2단계(솔루션 기능 카탈로그 + 요구사항 매핑) 설계

> 2026-09-04 초안. 1단계(`2026-09-03-rfp-analyzer-phase1-design.md`, PR #6 머지·배포 완료)가 만든 요구사항 표에 **당사 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit) 매핑**을 붙인다.
> 매핑의 기준이 되는 **솔루션 기능 카탈로그**는 어드민이 관리하고, 등록한 Confluence 페이지를 Claude가 읽어 기능 목록을 채운다(시드). 매핑은 프로젝트 상세 화면의 버튼으로 Claude가 일괄 실행하고, 사람이 행 단위로 고친다.
> 3단계(SharePoint 등록)는 별도 스펙.

## 1. 목표와 범위

**사용자 흐름(2단계)**
1. 어드민이 `/admin/rfp-catalog`에서 솔루션마다 Confluence 페이지 URL을 등록하고 "가져오기"를 누른다. 서버가 페이지 본문을 읽어 Claude로 기능 목록을 뽑아 카탈로그에 병합한다. 어드민은 기능 이름·설명·근거 URL을 표에서 직접 고치거나 추가·비활성화한다.
2. 사용자가 `/rfp/[id]`에서 "솔루션 매핑 실행"을 누른다. 서버가 카탈로그 전체를 프롬프트에 넣고 요구사항을 20건씩 Claude에 보내, 요구사항마다 **어느 솔루션의 어느 기능이 어느 정도 충족하는지**를 구조화해 저장한다.
3. 요구사항 표의 "솔루션" 열에 요약이 보이고, 행을 펼치면 매핑 행을 고치거나 추가·삭제한다. 사람이 고친 행은 다시 실행해도 보존된다.
4. xlsx에 매핑 열과 매핑 시트가 추가된다.

**2단계에 포함하지 않는 것**
- 요구사항별 Confluence 실시간 검색(회의록 노이즈가 커서 카탈로그를 먼저 만드는 방식으로 결정).
- Confluence 하위 페이지 자동 포함(URL 하나 = 페이지 하나. 필요하면 URL을 여러 개 등록).
- 매핑 결과의 자동 재실행(카탈로그가 바뀌어도 사용자가 버튼을 눌러야 갱신).
- SharePoint 등록(3단계).

**브레인스토밍에서 확정한 결정**

| 결정 | 선택 |
|---|---|
| 카탈로그 출처 | 어드민 관리 테이블 + Confluence 페이지 URL 시드(Claude가 기능 목록 정리). 사람이 고친 항목은 가져오기가 덮어쓰지 않음 |
| 매핑 구조 | 요구사항당 0~N행. 솔루션·기능·판정(충족/부분충족/설계·구축영역/해당없음)·설명·근거 URL·수정 여부 |
| 실행 시점 | 상세 화면의 "솔루션 매핑 실행" 버튼(수동). `after()`로 응답 뒤 실행, 3초 폴링 |
| 엔진 | Claude 일괄 매핑. 카탈로그 전체를 시스템 프롬프트에 넣고 프롬프트 캐싱, 요구사항 20건 청크 |
| 기존 `solution` 열 | 더는 편집하지 않음. 화면·xlsx의 "당사 솔루션"은 매핑에서 만든 요약 문자열 |

## 2. 아키텍처

```
어드민 /admin/rfp-catalog
  ├─ 솔루션 CRUD ─────────────▶ /api/admin/rfp-catalog/solutions[/code]
  ├─ 소스 URL 추가·삭제 ───────▶ /api/admin/rfp-catalog/solutions/[code]/sources, /sources/[id]
  ├─ "가져오기" ──────────────▶ POST /api/admin/rfp-catalog/solutions/[code]/import
  │      after(): 소스마다 Confluence REST(페이지 id) → storage XHTML → 텍스트 → 30k자 청크
  │                → Claude 구조화 출력 {features:[{name, description}]} → 이름 정규화 병합(edited 유지)
  │                → rfp_solution_sources.import_status ready|failed, page_version, imported_at
  └─ 기능 표 인라인 편집 ──────▶ /api/admin/rfp-catalog/solutions/[code]/features, /features/[id] (edited=true)

사용자 /rfp/[id]
  ├─ "솔루션 매핑 실행" ───────▶ POST /api/rfp/projects/[id]/mapping {mode, confirm?}
  │      mapping_status=running → after(): 카탈로그 로드 → 시스템 프롬프트(캐싱) → 대상 요구사항 20건 청크(동시 3)
  │                → Claude 구조화 출력 → 검증(별칭 → 실제 id, 판정 규칙) → 청크마다 즉시 저장(edited 행 보존)
  │                → mapping_status ready|failed, mapping_at, mapping_warnings
  ├─ 폴링 GET /api/rfp/projects/[id]?fields=status (mapping_status 포함) → 끝나면 GET …/mapping으로 행 갱신
  ├─ 행 펼침 편집 ─────────────▶ PATCH/DELETE /api/rfp/mappings/[id], POST /api/rfp/projects/[id]/mapping/rows
  ├─ 콤보박스 목록 ────────────▶ GET /api/rfp/catalog (활성 솔루션·기능, 비활성 기능은 isActive=false로 포함)
  └─ xlsx ────────────────────▶ GET /api/rfp/projects/[id]/xlsx (매핑 열·시트 추가)
```

- **순수 로직은 `frontend/src/lib/rfp/catalog/`·`frontend/src/lib/rfp/mapping/`** 에 두고 vitest 대상이다. Claude·Confluence 호출은 함수 주입으로 모킹한다(1단계 `extract-llm.ts`와 같은 방식).
- **긴 작업은 전부 `after()`**. 라우트 `maxDuration = 300`, `runtime = "nodejs"`. 상태 컬럼이 `running`인 채 6분이 지나면 멈춘 것으로 보고 다시 실행을 허용한다(1단계 `extracting`과 같은 규칙).
- **Confluence는 사용자가 준 URL을 그대로 요청하지 않는다.** URL에서 페이지 id만 뽑아 `ATLASSIAN_SITE`에 REST로 조회한다(SSRF 방지, 자격은 기존 `ATLASSIAN_*`).

```
frontend/src/lib/rfp/catalog/
  confluence.ts        parseConfluencePageId(url), fetchConfluencePage(id) → {title, version, storageHtml} (ATLASSIAN_* 자격, 주입 가능)
  storage-text.ts      storageToText(xhtml): 태그 제거, 표는 "| a | b |" 행, 목록은 "- ", 제목은 "# "
  extract-features.ts  FeatureOutputSchema, splitIntoChunks(재사용), extractFeatures(text, call), createAnthropicFeatureCall()
  merge-features.ts    normalizeFeatureName, mergeFeatures(existing, incoming) → {toInsert, toUpdate, skippedEdited}
  import-job.ts        runImport(admin, solutionCode, sourceIds): 소스마다 위 단계 실행, 상태 갱신
frontend/src/lib/rfp/mapping/
  types.ts             Verdict, VERDICT_LABEL, VERDICT_ORDER, MappingRow, CatalogSolution, CatalogFeature
  prompt.ts            buildCatalogPrompt(catalog) → {systemText, aliases}, buildChunkMessage(requirements)
  chunk.ts             chunkRequirements(rows, 20), truncateDetails(text, 1500)
  validate.ts          validateMappingOutput(out, chunk, aliases) → {rows, warnings}
  summary.ts           mappingSummary(rows, catalog), countByVerdict(reqs, rows), countBySolution(rows, catalog)
  llm.ts               MappingOutputSchema, createAnthropicMappingCall(systemText)
  run-job.ts           runMapping(admin, projectId, mode): 대상 선정 → 청크 → 호출(동시 3) → 검증 → 저장 → 상태
frontend/src/app/api/admin/rfp-catalog/…    어드민 라우트
frontend/src/app/api/rfp/catalog/route.ts    사용자용 카탈로그 조회
frontend/src/app/api/rfp/projects/[id]/mapping/route.ts, mapping/rows/route.ts, /api/rfp/mappings/[mappingId]/route.ts
frontend/src/app/admin/rfp-catalog/page.tsx
frontend/src/components/admin/rfp-catalog/   SolutionList, SourceTable, FeatureTable
frontend/src/components/rfp/                 MappingRunButton, MappingSummary, MappingEditor (+ RequirementsTable·OverviewCard·ProjectList 수정)
docs/sql/2026-09-04-rfp-solution-mapping.sql
```

## 3. 카탈로그

### 3.1 데이터 모델

```sql
create table if not exists public.rfp_solutions (
  code text primary key,                                   -- 'secloudit' (소문자 영숫자·하이픈, 변경 불가)
  name text not null,                                      -- 'SECloudit'
  description text not null default '',                   -- 프롬프트에 그대로 들어가는 한두 문단 소개
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.rfp_solutions (code, name, sort_order) values
  ('secloudit','SECloudit',1), ('devopsit','Devopsit',2), ('aicubeit','AICubeit',3), ('tabcloudit','TabCloudit',4), ('openstackit','Openstackit',5)
on conflict (code) do nothing;

create table if not exists public.rfp_solution_sources (
  id uuid primary key default gen_random_uuid(),
  solution_code text not null references public.rfp_solutions(code) on delete cascade,
  url text not null,
  page_id text not null,                                   -- URL에서 뽑은 Confluence 콘텐츠 id
  title text,
  page_version int,
  import_status text not null default 'idle' check (import_status in ('idle','running','ready','failed')),
  imported_at timestamptz,
  feature_count int not null default 0,                    -- 마지막 가져오기에서 추가·갱신한 기능 수
  error text,
  note text,                                               -- 가져오기 안내(예: 사람이 고친 기능 N개 유지)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (solution_code, page_id)
);

create table if not exists public.rfp_solution_features (
  id uuid primary key default gen_random_uuid(),
  solution_code text not null references public.rfp_solutions(code) on delete cascade,
  name text not null,
  name_norm text not null,
  description text not null default '',
  evidence_url text,                                       -- 근거 Confluence 페이지(가져오기 = 소스 URL)
  source_id uuid references public.rfp_solution_sources(id) on delete set null,
  is_active boolean not null default true,
  edited boolean not null default false,                   -- 사람이 고침 → 가져오기가 덮어쓰지 않음
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (solution_code, name_norm)
);
create index if not exists rfp_solution_features_solution_idx on public.rfp_solution_features (solution_code, sort_order);
```

- RLS는 1단계와 같다(켜고 관리자 읽기 정책만, 접근 제어는 라우트). `updated_at`은 기존 `rfp_set_updated_at` 트리거를 세 테이블에 붙인다.
- `code`는 만든 뒤 바꾸지 않는다(매핑 행·프롬프트 별칭이 참조). 이름·설명·활성·순서만 PATCH.
- **삭제 규칙**: 솔루션은 기능·매핑이 하나도 참조하지 않을 때만 DELETE(아니면 409 "비활성으로 바꾸세요"). 기능은 매핑이 참조하지 않을 때만 DELETE(아니면 409). FK `on delete set null`은 안전망일 뿐 정상 경로가 아니다.

### 3.2 Confluence 가져오기 (`catalog/confluence.ts`, `storage-text.ts`)

- **URL → 페이지 id** (`parseConfluencePageId`): 지원 형태는 `/wiki/spaces/{KEY}/pages/{id}[/{title}]`, `/wiki/pages/viewpage.action?pageId={id}`, `/wiki/pages/{id}`. 짧은 링크(`/wiki/x/…`)와 그 외는 400 "페이지 전체 URL을 넣어 주세요". URL 호스트가 `ATLASSIAN_SITE` 호스트와 다르면 400 "설정된 Confluence 사이트({host})의 페이지만 등록할 수 있습니다".
- **조회** (`fetchConfluencePage`): `GET {ATLASSIAN_SITE}/wiki/rest/api/content/{id}?expand=body.storage,version` — Basic 인증은 `work-metrics/confluence.ts`와 같은 `ATLASSIAN_EMAIL:ATLASSIAN_API_TOKEN`. 응답의 `title`, `version.number`, `body.storage.value`를 쓴다. 403/404는 `ConfluenceFetchError(status)`로 던져 소스 행 `error`에 "권한 없음(403)" / "페이지 없음(404)"으로 남긴다. `ATLASSIAN_*`가 비어 있으면 POST /import가 400 "ATLASSIAN_* 환경 변수가 설정되지 않았습니다".
- **XHTML → 텍스트** (`storageToText`): 정규식 기반(storage 포맷은 `ac:`·`ri:` 네임스페이스와 HTML 엔티티가 섞여 XML 파서가 자주 실패한다).
  1. `<ac:image>`·`<ri:*>`·`<ac:parameter>`·`<script>`·`<style>`은 내용까지 제거. 그 외 `ac:structured-macro`·`ac:rich-text-body`·`ac:plain-text-body`는 태그만 벗기고 내용은 남긴다(코드·expand·info 매크로 본문 보존).
  2. `<table>` 안의 `<tr>`은 한 줄 `| 셀 | 셀 |`, 셀 안 줄바꿈은 공백. `<li>`는 `- ` 접두, `<h1>`~`<h6>`는 `# ` 접두, `<p>`·`<br>`·`<div>`는 줄바꿈.
  3. 남은 태그 제거 → 엔티티 디코드(`&nbsp;` `&amp;` `&lt;` `&gt;` `&quot;` `&#39;` `&#x…;` `&#…;`) → 줄 안 연속 공백 정리, 빈 줄은 모두 제거(LLM 입력이라 단락 사이 빈 줄이 필요 없다).
- **기능 추출** (`extract-features.ts`): `splitIntoChunks(text, 30000)`(1단계 함수 재사용) → 청크마다 Claude 호출. 시스템 프롬프트에 솔루션 이름·설명을 넣고, 출력은 `{ features: [{ name: string, description: string }] }`(name ≤ 40자, description 1~3문장, 문서에 없는 기능은 만들지 말 것). 청크 결과는 `normalizeFeatureName` 기준으로 합치고 같은 이름은 설명이 긴 것을 남긴다. 모델·thinking·스트리밍·구조화 출력은 1단계 LLM 폴백과 같다(`claude-opus-5`, env `RFP_LLM_MODEL`, `thinking: {type:"adaptive"}`, `messages.stream` + `finalMessage()`, `zodOutputFormat`). `ANTHROPIC_API_KEY`가 없으면 POST /import가 400.
- **병합** (`merge-features.ts`): `normalizeFeatureName` = 1단계 `normalizeName`과 같은 규칙(NFKC → 소문자 → 공백·기호 제거, 괄호 안 내용 유지). 들어온 기능마다
  - 같은 솔루션에 같은 `name_norm`이 있고 `edited=false` → `description`·`evidence_url`(소스 URL)·`source_id` 갱신.
  - 있고 `edited=true` → 건너뜀(`skippedEdited`에 기록, 화면에 "사람이 고친 항목 N개는 유지").
  - 없으면 → 새 행(`sort_order`는 현재 최댓값 뒤로, `evidence_url` = 소스 URL, `source_id`).
  - 이전 가져오기에 있었지만 이번에 없는 기능은 **지우지 않는다**(어드민이 비활성화).
- **잡** (`import-job.ts`, `runImport`): 대상 소스를 `running`으로 바꾼 뒤 순서대로 처리한다. 소스 하나가 실패해도 다음 소스는 계속하고 실패한 소스만 `failed`+`error`. 성공 시 `ready`, `title`, `page_version`, `imported_at`, `feature_count`(추가+갱신), `note`("사람이 고친 기능 N개는 유지했습니다" 등 안내). 예외는 잡아 소스 행에 쓰고 절대 `running`으로 남기지 않는다.

## 4. 매핑

### 4.1 데이터 모델

```sql
create table if not exists public.rfp_requirement_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  requirement_id uuid not null references public.rfp_requirements(id) on delete cascade,
  solution_code text references public.rfp_solutions(code) on delete set null,
  feature_id uuid references public.rfp_solution_features(id) on delete set null,
  verdict text not null check (verdict in ('fulfilled','partial','build','na')),
  rationale text not null default '',
  evidence_url text,
  edited boolean not null default false,                   -- 사람이 만들거나 고친 행. 재실행 시 보존
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rfp_requirement_mappings_req_idx on public.rfp_requirement_mappings (project_id, requirement_id, sort_order);

alter table public.rfp_projects
  add column if not exists mapping_status text not null default 'none' check (mapping_status in ('none','running','ready','failed')),
  add column if not exists mapping_error text,
  add column if not exists mapping_warnings jsonb not null default '[]'::jsonb,
  add column if not exists mapping_at timestamptz;
```

- `mapping_at`은 마지막 실행이 끝난 시각. `mapping_status`가 `running`으로 바뀔 때 `updated_at`이 갱신되므로 6분 stale 판정은 `updated_at`을 본다(1단계와 동일).
- 이름은 저장하지 않고 카탈로그와 조인한다(카탈로그 이름을 고치면 매핑 표시도 따라온다).

### 4.2 판정 4값 (`mapping/types.ts`)

| `verdict` | 표시 | 뜻 | 솔루션·기능 | 요구사항당 행 수 |
|---|---|---|---|---|
| `fulfilled` | 충족 | 카탈로그 기능이 요구를 그대로 만족 | 둘 다 필수 | 여러 행 가능 |
| `partial` | 부분충족 | 기능이 일부만 만족하고 나머지는 설정·개발 필요 | 둘 다 필수 | 여러 행 가능 |
| `build` | 설계·구축영역 | 당사 솔루션 기능이 아닌 SI 설계·구축 작업(예: 데이터 이관, 기관 시스템 연계 개발) | 둘 다 null | 요구사항당 하나, 그리고 fulfilled/partial과 함께 있을 수 없음 |
| `na` | 해당없음 | 사업 관리·제약·산출물 등 솔루션과 무관 | 둘 다 null | 요구사항당 하나, 단독 |

`VERDICT_ORDER = ["fulfilled","partial","build","na"]`, `VERDICT_LABEL`은 위 표시 문자열. 서버(PATCH·POST·검증)와 화면이 같은 상수를 쓴다.

### 4.3 실행 흐름 (`mapping/run-job.ts`)

**요청** `POST /api/rfp/projects/[id]/mapping { mode: "all" | "missing", confirm?: boolean }`
- 400: 프로젝트 `status`가 `ready`가 아님 / 활성 솔루션에 활성 기능이 하나도 없음("카탈로그가 비어 있습니다. 관리자에게 문의하세요") / `ANTHROPIC_API_KEY` 없음.
- 409 `{running:true}`: `mapping_status='running'`이고 `updated_at`이 6분 이내.
- 409 `{needsConfirm:true, editedRequirements:N}`: `mode='all'`이고 `edited=true` 행이 있는데 `confirm`이 아님. 화면은 "N개 요구사항은 사람이 고친 매핑이 있어 건너뜁니다. 나머지를 다시 매핑할까요?"로 되묻고 `confirm:true`로 재요청.
- 202 `{started:true}`: `mapping_status='running'`, `mapping_error=null`로 바꾸고 `after(runMapping)`.

**대상 요구사항**
- `all`: `edited=true` 매핑 행이 하나도 없는 요구사항 전부. 그 요구사항들의 기존(`edited=false`) 행은 청크를 저장할 때 지운다.
- `missing`: 매핑 행이 하나도 없는 요구사항만(실패·중단 뒤 이어서 하기).
- 사람이 고친 행이 있는 요구사항은 프롬프트에도 넣지 않는다(토큰 절약 + 사람 판단과 LLM 판단이 섞이지 않게).

**프롬프트** (`mapping/prompt.ts`)
- 시스템 블록 1(고정): 역할("공공 정보화 사업 RFP 요구사항을 당사 솔루션 기능에 매핑하는 프리세일즈 분석가"), 판정 4값 정의(4.2 표의 뜻 그대로), 규칙(기능이 요구를 만족하면 해당 기능을 모두 나열, 억지로 맞추지 말고 없으면 build/na, `rationale`은 2문장 이내 한국어, 문서에 없는 기능 별칭을 만들지 말 것).
- 시스템 블록 2(카탈로그, `cache_control: {type:"ephemeral"}`): 솔루션마다
  ```
  ## S1. SECloudit
  {description}
  - F1 {기능명}: {설명}
  - F2 …
  ```
  **별칭**(`S{n}`·`F{n}`)을 쓰고 서버가 실제 `code`·`id`로 되돌린다. UUID를 프롬프트에 넣으면 토큰이 늘고 환각 ID가 생기기 쉽다. 별칭 표는 한 실행 안에서만 유효하다.
- 사용자 메시지(청크마다): 요구사항 20건을
  ```
  ### {reqId} {title}
  구분: {categoryName}
  정의: {definition}
  세부 내용: {details 앞 1500자, 잘렸으면 "…(이하 생략)"}
  ```
- 출력 스키마(`mapping/llm.ts`, zod): `{ mappings: [{ reqId: string, verdict: "fulfilled"|"partial"|"build"|"na", feature: string | null, rationale: string }] }`. `feature`는 `F{n}` 별칭, build/na는 null.
- 호출: `claude-opus-5`(env `RFP_LLM_MODEL`), `thinking: {type:"adaptive"}`, `output_config.effort: "medium"`(구현 시 SDK 타입으로 확인), `max_tokens 16000`, `messages.stream` + `finalMessage()`. 시스템 블록 2가 캐시 최소 길이(1,024토큰)보다 짧으면 캐싱만 안 될 뿐 동작은 같다.

**청크·동시성** (`mapping/chunk.ts`): 대상 요구사항을 표준 순서(`sortRequirements`)로 정렬해 20건씩 나눈다. 동시 3개까지 호출한다(124건 → 7청크 → 3라운드, Vercel 300초 안에 끝나도록). 청크 하나가 실패하면 그 청크만 `warnings`에 남기고 나머지는 계속한다. 모든 청크가 실패하면 `failed`.

**검증** (`mapping/validate.ts`, 순수 함수)
1. `reqId`가 청크에 없으면 버리고 경고 "청크에 없는 요구사항 ID {x}".
2. `fulfilled`/`partial`인데 `feature`가 null이거나 별칭 표에 없으면 버리고 경고 "{reqId}: 기능 별칭 불명 {f}".
3. `build`/`na`인데 `feature`가 있으면 feature를 버리고 행은 유지.
4. 같은 요구사항에 `fulfilled`/`partial` 행이 하나라도 있으면 `build`/`na` 행은 버린다. `build`와 `na`가 둘 다 있으면 `build`만 남긴다. 그 외 중복(같은 요구사항·같은 기능)은 먼저 나온 것만.
5. 요구사항당 최대 5행(넘치면 뒤를 버리고 경고).
6. 청크의 어떤 요구사항이 행을 하나도 못 받으면 "미매핑" 상태로 두고 경고 "{reqId}: 매핑 결과 없음"(빈 `na`를 만들어 넣지 않는다 — 사람이 봐야 하는 항목으로 남긴다).

**저장**: 청크 검증이 끝나는 즉시 그 청크 요구사항들의 `edited=false` 행을 지우고 새 행을 넣는다(잡이 중간에 죽어도 끝난 청크는 남고, `missing` 모드로 이어서 할 수 있다). 모든 청크가 끝나면 `mapping_status='ready'`, `mapping_at=now()`, `mapping_warnings`(청크 경고 합계, 최대 200개). 예외는 `failed` + `mapping_error`(500자).

**비용**: 카탈로그 ~15k자(한국어 ≈ 1만 토큰)는 캐시 읽기, 청크 입력 ~25k 토큰 × 7, 출력 20행 × ~120토큰. 프로젝트 1건 1달러 미만으로 추정. 상세 화면에 실행 시각과 함께 "이번 실행 청크 N개"만 보이고 비용은 표시하지 않는다.

### 4.4 요약 (`mapping/summary.ts`, 순수 함수 — 화면·xlsx 공용)

- `mappingSummary(rows, catalog)`: 요구사항 하나의 행들을 `sort_order` 순으로 `{솔루션명}·{기능명}({판정})`을 ` / `로 이어 만든다. `build` → `설계·구축영역`, `na` → `해당없음`, 행 없음 → 빈 문자열. 기능이 비활성이면 `{기능명}(비활성)`.
- `countByVerdict(requirements, rows)`: `{fulfilled, partial, build, na, unmapped}` — 요구사항 단위(한 요구사항에 fulfilled와 partial이 함께 있으면 더 좋은 쪽 하나로 센다: fulfilled > partial > build > na).
- `countBySolution(rows, catalog)`: 솔루션별 `{fulfilled, partial}` 행 수(요구사항 중복 제거).

## 5. API

인증: 어드민 라우트는 `requireAdmin()`, 사용자 라우트는 `requireUser()`(1단계). 모든 응답 키는 camelCase. `[code]`는 `rfp_solutions.code`, `[id]`는 uuid.

### 5.1 어드민 `/api/admin/rfp-catalog`

| 메서드·경로 | 요청 → 응답 |
|---|---|
| `GET /solutions` | `{solutions:[{code,name,description,isActive,sortOrder,featureCount,activeFeatureCount,sourceCount,updatedAt}]}` |
| `POST /solutions` | `{code,name,description?}` → 201. `code`는 `^[a-z0-9-]{2,30}$`, 중복 409 |
| `PATCH /solutions/[code]` | `{name?,description?,isActive?,sortOrder?}` → 갱신 행 |
| `DELETE /solutions/[code]` | 기능·매핑 참조가 있으면 409 "기능 N개·매핑 M건이 참조합니다. 비활성으로 바꾸세요", 없으면 204 |
| `GET /solutions/[code]/sources` | `{sources:[{id,url,pageId,title,pageVersion,importStatus,importedAt,featureCount,error,createdAt}]}` — 가져오기 폴링에도 사용 |
| `POST /solutions/[code]/sources` | `{url}` → URL 파싱·호스트 검사 → 201. 같은 페이지 중복 409 |
| `DELETE /sources/[id]` | 204. 그 소스에서 온 기능은 남고 `source_id`만 null |
| `POST /solutions/[code]/import` | `{sourceIds?: string[]}`(없으면 전체) → 400(env 없음·소스 없음) / 409(6분 이내 running) / 202 `{started:true, sourceIds}` + `after(runImport)`. `maxDuration = 300` |
| `GET /solutions/[code]/import` | `{running:boolean, sources:[…]}`(GET sources와 같은 행 + running 여부) |
| `GET /solutions/[code]/features` | `{features:[{id,name,description,evidenceUrl,sourceId,isActive,edited,sortOrder,updatedAt,mappingCount}]}` |
| `POST /solutions/[code]/features` | `{name,description?,evidenceUrl?}` → `edited=true`, 201. `name_norm` 중복 409 |
| `PATCH /features/[id]` | `{name?,description?,evidenceUrl?,isActive?,sortOrder?}` → `edited=true`(isActive·sortOrder만 바꿀 때도 true), `updated_by` |
| `DELETE /features/[id]` | 매핑 참조 있으면 409 "매핑 M건이 참조합니다. 비활성으로 바꾸세요", 없으면 204 |

### 5.2 사용자

| 메서드·경로 | 요청 → 응답 |
|---|---|
| `GET /api/rfp/catalog` | `{solutions:[{code,name,description,isActive,features:[{id,name,description,evidenceUrl,isActive}]}]}` — 활성 솔루션만, 기능은 비활성 포함(`isActive`로 구분; 매핑이 참조하는 이름을 그려야 함) |
| `GET /api/rfp/projects` | 1단계 응답에 `mappingStatus` 추가 |
| `GET /api/rfp/projects/[id]` | 1단계 응답에 `mappingStatus, mappingError, mappingWarnings, mappingAt, mappings: RfpMapping[]` 추가. `?fields=status`에도 `mappingStatus, mappingError, mappingAt` 포함 |
| `POST /api/rfp/projects/[id]/mapping` | 4.3 요청. `maxDuration = 300` |
| `GET /api/rfp/projects/[id]/mapping` | `{mappingStatus, mappingError, mappingWarnings, mappingAt, mappings}` — 실행이 끝난 뒤 행만 다시 받을 때 |
| `POST /api/rfp/projects/[id]/mapping/rows` | `{requirementId, solutionCode, featureId, verdict, rationale?, evidenceUrl?}` → 판정 규칙 검사(4.2: fulfilled/partial은 기능 필수이고 기능이 그 솔루션 것이어야 함, build/na는 둘 다 null로 강제, build/na는 요구사항당 하나) → `edited=true`, `sort_order` = 그 요구사항 최댓값+1, 201 |
| `PATCH /api/rfp/mappings/[mappingId]` | `{solutionCode?, featureId?, verdict?, rationale?, evidenceUrl?}` → 같은 규칙 검사 → `edited=true`, `updated_by` → 갱신 행 |
| `DELETE /api/rfp/mappings/[mappingId]` | 204 |
| `PATCH /api/rfp/requirements/[requirementId]` | 1단계 그대로이되 `solution` 필드는 받지 않는다(보내면 400 "solution은 매핑에서 관리합니다") |
| `GET /api/rfp/projects/[id]/xlsx` | §7 |

`RfpMapping` = `{id, requirementId, solutionCode, featureId, verdict, rationale, evidenceUrl, edited, sortOrder, updatedAt, updatedBy}`.

## 6. 화면

### 6.1 어드민 `/admin/rfp-catalog`
- `app/admin/layout.tsx` 메뉴에 `{ href: "/admin/rfp-catalog", label: "RFP 솔루션 카탈로그", icon: Layers }` 추가(조직/팀 아래).
- 좌우 2단. **왼쪽 `SolutionList`**: 솔루션 카드 목록(이름, 코드, 활성/비활성 배지, 기능 N개·활성 M개). 클릭해 선택. "솔루션 추가" 다이얼로그(코드·이름·설명). 선택한 솔루션의 이름·설명은 오른쪽 상단에서 `EditableCell`(1단계 컴포넌트)로 인라인 편집, 활성 토글, 삭제 버튼(409면 안내 토스트).
- **오른쪽 상단 `SourceTable`**: URL 입력 + "추가", 행: URL(링크)·제목·페이지 버전·상태 배지(idle/running/ready/failed)·마지막 가져온 시각·추가/갱신 기능 수·오류 문구·삭제. "가져오기(전체)" 버튼과 행별 "가져오기". running이면 3초 폴링(`GET …/import`), 끝나면 기능 표 다시 조회. `ATLASSIAN_*`·`ANTHROPIC_API_KEY` 미설정 400은 그대로 안내.
- **오른쪽 하단 `FeatureTable`**: TanStack Table, 열 = 순서(드래그 없음, 숫자 편집)·이름·설명·근거 URL·활성 토글·✎(edited)·매핑 참조 수·삭제. 이름·설명·근거 URL은 `EditableCell`. 검색 필터, "기능 추가" 다이얼로그. "사람이 고친 항목 N개는 가져오기가 덮어쓰지 않습니다" 안내.

### 6.2 프로젝트 상세 `/rfp/[id]`
- `OverviewCard`: "솔루션 매핑 실행" 버튼(`MappingRunButton`) + 매핑 상태 배지(없음/실행 중/완료/실패)와 `mapping_at`. `status !== "ready"`면 비활성. 처음(`mapping_status='none'`)이면 바로 `mode:"all"`. 이미 매핑이 있으면 다이얼로그: "전체 다시 매핑(사람이 고친 N개 요구사항은 유지)" / "미매핑 M건만". 실행 중 6분이 지나면(1단계 stale 규칙) 버튼이 다시 살아난다. `failed`면 `mapping_error`와 "미매핑만 이어서" 안내. `mapping_warnings`는 접이식 목록.
- 폴링: 기존 `?fields=status` 폴링이 `mappingStatus`도 보고, `running → ready|failed`로 바뀌면 `GET …/mapping`으로 행을 갱신한다.
- `MappingSummary`(표 위): 판정별 건수 칩(충족·부분충족·설계·구축영역·해당없음·미매핑 — `countByVerdict`) + 솔루션별 건수(`countBySolution`). 칩을 누르면 표를 그 판정으로 필터.
- `RequirementsTable`: "전체 목록" 탭의 "당사 솔루션" 열을 읽기 전용 `mappingSummary` 텍스트로 바꾼다(편집 불가, `solution` 필드 편집 제거). 모든 탭에서 행 앞 ▸ 아이콘 클릭 → `getExpandedRowModel`로 아래 행에 `MappingEditor`가 펼쳐진다. 판정 필터(칩)·텍스트 필터 함께 적용.
- `MappingEditor`(요구사항 하나): 매핑 행 목록. 행마다 솔루션 콤보(활성 솔루션) → 기능 콤보(그 솔루션의 활성 기능; 현재 값이 비활성이면 "(비활성)" 표시로 유지) → 판정 셀렉트 → 설명 textarea(자동 높이) → 근거 URL 입력 → 삭제. 판정을 build/na로 바꾸면 솔루션·기능 콤보가 비활성화되고 null로 저장. 변경은 필드별 blur 저장(PATCH), 실패 시 원값 복원 + 토스트. "행 추가"는 기본값 `{verdict:"partial"}`에 솔루션·기능을 고르면 POST. ✎ 아이콘으로 edited 표시, hover에 수정자·시각.
- `/rfp` 목록(`ProjectList`): "매핑" 열에 상태 배지.

## 7. xlsx (`xlsx.ts` 확장)

`buildWorkbook(project, rows, mapping?: { rows: RfpMapping[]; catalog })` — `mapping`이 없으면 1단계와 같은 결과(기존 테스트 유지).
- `1.요구사항_목록`: 6번째 "당사 솔루션" 열에 `mappingSummary` 문자열. 그 뒤 5열 추가 — 솔루션, 기능, 판정, 매핑 설명, 근거 URL(너비 14/24/10/50/40). 요구사항에 매핑이 여러 행이면 다섯 셀 모두 같은 순서로 줄바꿈(`\n`)해 넣는다(행 수는 요구사항 수 그대로). build/na는 솔루션·기능 칸 비움.
- 구분별 상세 시트: 1단계 7열 그대로. 번호도 그대로(`2.SER`…).
- 새 시트 **`{n}.솔루션_매핑`** — `n`은 마지막 상세 시트 다음 번호. 매핑 1행 = 연번·요구사항 구분·요구사항 ID·요구사항 명칭·솔루션·기능·판정·매핑 설명·근거 URL·수정 여부(✎ → "수정"). 미매핑 요구사항도 판정 "미매핑"으로 1행 넣어 빠짐없이 보이게 한다. 열 너비 5/18/14/36/14/26/10/50/40/8. 헤더·본문 스타일은 기존 `styleHeader`/`styleBody`.
- 설계 논의에서는 이 시트를 `2.솔루션_매핑`으로 두기로 했지만, 그러면 1단계 상세 시트 번호가 전부 밀려 팀 템플릿·기존 테스트와 어긋난다. **마지막 시트로 둔다**(구현 리뷰에서 조정, 사용자에게 보고).
- `0.개요`에 "3. 솔루션 매핑 요약" 블록: 실행 시각, 판정별 건수 5줄, 솔루션별 충족/부분충족 건수.

## 8. 오류 처리

| 상황 | 처리 |
|---|---|
| Confluence URL 형식 불일치·다른 호스트·짧은 링크 | `POST /sources` 400, 화면 즉시 안내 |
| Confluence 403/404/5xx | 그 소스만 `failed` + "권한 없음(403)" 등. 다른 소스는 계속 |
| 페이지 본문이 비었거나 기능 0개 | 소스 `ready`, `feature_count 0`, 화면에 "기능을 찾지 못했습니다" |
| `ATLASSIAN_*`·`ANTHROPIC_API_KEY` 없음 | 가져오기·매핑 POST 400, 문구에 변수명 |
| 카탈로그 비어 있음 | 매핑 POST 400 "카탈로그가 비어 있습니다" |
| 청크 일부 실패 | 나머지 진행, `mapping_warnings`에 "청크 k/N 실패: …", 상태 `ready`. 미매핑은 "미매핑만" 재실행으로 보완 |
| 전부 실패·예외 | `failed` + `mapping_error`. 프로젝트·기존 매핑은 그대로 |
| 잡이 300초 안에 안 끝남(after 종료) | `running`으로 남음 → 6분 뒤 버튼 활성, "미매핑만"으로 이어서 |
| 판정 규칙 위반(PATCH/POST) | 400, 문구 "충족·부분충족은 기능을 골라야 합니다" / "설계·구축영역·해당없음은 요구사항당 하나만" |
| 참조 있는 기능·솔루션 삭제 | 409, 비활성 안내 |
| 사용자가 카탈로그를 볼 수 없음 | `/api/rfp/catalog`는 user 이상 누구나 읽기(쓰기는 admin) |

## 9. 테스트 (vitest, `frontend/src/lib/__tests__/`)

- `rfp-catalog-confluence.test.ts`: URL 3형태 → 페이지 id, 짧은 링크·외부 호스트 거부.
- `rfp-catalog-storage-text.test.ts`: 표 → `| a | b |`, 목록 `- `, 제목 `# `, `ac:image`·`ri:` 제거, 매크로 본문 보존, 엔티티 디코드, 빈 줄 정리.
- `rfp-catalog-extract-features.test.ts`: 모킹 호출로 청크 2개 결과 병합(같은 이름은 긴 설명), 이름 40자 절단, 키 없음 `LlmUnavailableError`.
- `rfp-catalog-merge.test.ts`: 신규 추가·비편집 갱신·편집 유지(`skippedEdited`)·이전 항목 미삭제·`name_norm` 중복 없음.
- `rfp-mapping-prompt.test.ts`: 카탈로그 → 별칭 표(S/F 연번)와 시스템 텍스트(비활성 기능 제외), 청크 메시지 형식, 1500자 절단 표시, 20건 청크 수.
- `rfp-mapping-validate.test.ts`: 없는 reqId 제거, fulfilled 기능 없음 제거, build+fulfilled 공존 시 build 제거, build+na → build, 5행 상한, 미매핑 경고, 별칭 → 실제 id.
- `rfp-mapping-run.test.ts`: 가짜 Supabase 대신 순수 부분만 — 대상 선정(`all`은 edited 있는 요구사항 제외, `missing`은 행 없는 것만)과 청크 실패 시 경고·계속 진행을 함수로 분리해 검증.
- `rfp-mapping-summary.test.ts`: 요약 문자열(여러 행·build·na·비활성 기능), 판정별 건수(요구사항 단위 우선순위), 솔루션별 건수.
- `rfp-xlsx.test.ts` 확장: `mapping` 없이 1단계 결과 동일, 있으면 목록 11열·줄바꿈 셀, 마지막 시트 이름 `{n}.솔루션_매핑`과 행 수(미매핑 포함), 개요 "3. 솔루션 매핑 요약".
- 라우트·화면은 런북 수동 체크리스트(가져오기 → 기능 편집 → 매핑 실행 → 행 편집 → 재실행 보존 → xlsx).

## 10. 환경 변수·의존성·배포

- 기존 env 재사용: `ATLASSIAN_SITE`·`ATLASSIAN_EMAIL`·`ATLASSIAN_API_TOKEN`(Confluence 읽기), `ANTHROPIC_API_KEY`·`RFP_LLM_MODEL`(가져오기·매핑). **Vercel에 `ANTHROPIC_API_KEY`를 넣어야 2단계가 동작한다**(1단계 배포 때 미설정).
- 새 의존성 없음(`@anthropic-ai/sdk`·`zod`·`@tanstack/react-table`·`exceljs` 기존).
- SQL `docs/sql/2026-09-04-rfp-solution-mapping.sql`은 멱등(`if not exists`·`on conflict do nothing`)으로 작성하고 Management API로 운영 DB에 적용. 배포는 `git push` 후 `vercel --prod`.
- `CLAUDE.md`·`docs/rfp-analyzer.md`에 페이지·API·테이블·env를 추가한다.

## 11. 3단계 접점

- SharePoint 등록은 `GET …/xlsx` 버퍼를 그대로 올린다. 매핑 시트가 포함된 파일이 올라가므로 3단계에서 xlsx 구조를 바꿀 일은 없다.
- 카탈로그·매핑 테이블은 3단계와 무관하다.
