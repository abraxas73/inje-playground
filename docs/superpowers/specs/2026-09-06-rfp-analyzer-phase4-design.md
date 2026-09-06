# RFP 분석 — 4단계(규칙 기반 카탈로그 적재·매핑, LLM 폴백) 설계

> 2026-09-06 초안. 2단계(`2026-09-04-rfp-analyzer-phase2-design.md`, PR #7)가 만든 카탈로그·매핑은 **Claude 호출이 필수**여서 `ANTHROPIC_API_KEY`가 없는 운영 환경에서는 가져오기·매핑이 모두 400으로 막힌다.
> 4단계는 **키 없이 동작하는 규칙(키워드) 엔진**을 기본으로 두고, Claude는 키가 있을 때만 고를 수 있는 보강 수단으로 내린다. 카탈로그 적재(Confluence 표·제목·글머리표 파싱, SharePoint xlsx 기능명세서 읽기, 키워드 시드)와 매핑(키워드 일치 + 문자 bigram 유사도 → "후보" 판정) 둘 다 규칙으로 한다.
> 3단계(SharePoint 등록, PR #8)가 만든 Microsoft 계정 연결·Graph 클라이언트를 xlsx 소스 읽기에 재사용한다.

## 1. 목표와 범위

**사용자 흐름(4단계)**
1. 어드민이 `/admin/rfp-catalog`에서 소스를 등록한다. 입력란 하나에 **Confluence 페이지 URL** 또는 **SharePoint xlsx 파일 링크**를 붙이면 서버가 호스트로 종류를 판별한다. "Confluence에서 찾기" 패널에서 제목으로 검색해 결과 행의 "등록"을 눌러도 된다.
2. "가져오기(규칙)"를 누르면 서버가 Confluence 본문의 표·제목·글머리표, xlsx의 기능·설명 열을 규칙으로 읽어 기능 목록을 만들고, 이름·설명에서 **키워드**를 시드해 카탈로그에 병합한다. 어드민은 기능 표에서 키워드를 직접 고친다. `ANTHROPIC_API_KEY`가 있으면 "Claude로 보강"(2단계 방식)도 고를 수 있다.
3. 사용자가 `/rfp/[id]`에서 "솔루션 매핑 실행"을 누르면 다이얼로그에서 엔진(규칙 기본 / Claude)과 모드(전체 / 미매핑)를 고른다. 규칙 엔진은 요구사항마다 키워드 일치·유사도 점수를 매겨 상위 후보를 **"후보"** 판정으로 저장한다.
4. 사람이 후보를 검토해 충족/부분충족 등으로 바꾸거나 지운다. 나중에 키가 들어오면 Claude 엔진으로 다시 실행해 규칙 후보를 교체할 수 있고, 사람이 고친 행은 어느 엔진이든 보존된다.

**4단계에 포함하지 않는 것**
- Jira 연동(검색·이슈 참조). 후속으로 남긴다.
- 임계값·가중치 튜닝 화면. 상수는 코드에 두고 필요하면 코드에서 바꾼다.
- 파일 직접 업로드로 카탈로그 적재(xlsx는 SharePoint 링크만).
- 요구사항 쪽 동의어 사전·형태소 분석기 도입. 토큰화는 정규식과 조사 제거 규칙만 쓴다.
- 규칙 엔진의 fulfilled/partial 판정. 규칙은 "후보"만 낸다(확정 판정은 사람 또는 Claude).

**브레인스토밍에서 확정한 결정**

| 결정 | 선택 |
|---|---|
| 범위 | 카탈로그 적재 + 매핑 모두 규칙 기반. LLM은 키가 있을 때만 고르는 보강 |
| 자동 매칭 판정 | 새 판정 `candidate`("후보") 추가. 규칙 엔진은 후보만 내고 사람이 확정 |
| 매칭 기준 | 기능별 키워드 목록(이름·설명에서 시드, 어드민 편집) + 문자 bigram 유사도 보조 |
| 카탈로그 소스 | Confluence 페이지(규칙 파서) + SharePoint xlsx 기능명세서(Graph 위임 토큰으로 내려받아 exceljs로 읽기) + 어드민 화면 Confluence 제목 검색으로 등록 |
| 엔진 선택 | 가져오기·매핑 모두 `engine: "rules" \| "llm"`, 기본 rules. llm은 키 없으면 400·화면 비활성 |
| 재실행 정합 | 모드 all은 `edited=false` 행만 교체(2단계 그대로) → Claude 재실행이 규칙 후보를 덮어쓰고, 사람이 확정한 행은 남는다 |

**설계 논의 대비 스펙에서 조정한 점**

| 논의 | 조정 | 이유 |
|---|---|---|
| 유사도 = bigram Jaccard | **overlap coefficient** `|A∩B| / min(|A|,|B|)` | 요구사항(수백 자)과 기능(수십~백 자) 길이 차가 커서 Jaccard는 0.05 안팎에 머물러 임계값 0.3이 사실상 죽는다. 기능 bigram이 요구사항에 얼마나 포함되는지를 재는 overlap이 의도에 맞다 |
| 제목 규칙 h2~h4 | `storageToText`가 제목 수준을 `#` 개수로 보존 | 지금은 h1~h6 모두 `# `로 바뀌어 수준을 알 수 없다. LLM 입력에도 무해하고 기존 테스트 기대값만 갱신 |
| 키워드 시드 갱신 | 가져오기(edited=false 기능)와 `PATCH {keywords:null}`(↻ 버튼)에서만 재생성. 이름·설명 PATCH는 키워드를 건드리지 않는다 | 숨은 자동 갱신보다 명시적 동작이 예측 가능 |
| xlsx 소스 식별 | `rfp_solution_sources.drive_id` 열 추가, `page_id` = driveItem id | driveItem id는 드라이브 안에서만 유일하므로 내려받기에 drive id가 필요 |
| 검증 입력 | `validateMappingOutput`의 세 번째 인자를 별칭 표 대신 **기능 조회 표**(`Map<key, {featureId, solutionCode}>`)로 일반화 | LLM은 `F{n}` 별칭, 규칙은 기능 id를 key로 넘긴다. 검증 로직은 그대로 |

## 2. 아키텍처

```
어드민 /admin/rfp-catalog
  ├─ 소스 등록(URL 하나) ──────▶ POST /api/admin/rfp-catalog/solutions/[code]/sources {url}
  │      호스트 판별: ATLASSIAN_SITE → confluence(2단계 그대로) / *.sharepoint.com → xlsx
  │      xlsx: 세션 사용자의 Graph 토큰 → shares/{u!}/driveItem 해석(파일·xlsx·20MiB 검사) → drive_id·page_id(item id)·title(파일명)
  ├─ Confluence 검색 ─────────▶ GET /api/admin/rfp-catalog/confluence-search?q= → CQL title ~ → 결과 → 행 "등록" = 위 POST
  ├─ "가져오기(규칙)" / "Claude로 보강" ─▶ POST …/import {sourceIds?, engine}
  │      after(): 소스마다
  │        confluence → REST 페이지 → storageToText → engine rules: extractFeaturesByRules / llm: extractFeatures(Claude)
  │        xlsx       → Graph 내려받기(요청 시 발급한 토큰) → parseXlsxFeatures(exceljs)   ※ 엔진 무관
  │        → 키워드 시드(seedKeywords) → mergeFeatures(edited 유지) → import_status ready|failed
  └─ 기능 표 키워드 편집 ───────▶ PATCH /api/admin/rfp-catalog/features/[id] {keywords: string[] | null}

사용자 /rfp/[id]
  ├─ "솔루션 매핑 실행" 다이얼로그(엔진·모드) ─▶ POST /api/rfp/projects/[id]/mapping {mode, engine, confirm?}
  │      after(runMapping): 카탈로그 → 엔진 팩토리(rules | llm) → 대상 요구사항 20건 청크(동시 3)
  │        rules: matchChunk(청크, 기능 인덱스) → 요구사항별 상위 3 후보(솔루션당 2) → verdict candidate, score
  │        llm  : 2단계 프롬프트·호출 그대로
  │        → validateMappingOutput(items, chunk, lookup) → 청크마다 저장(edited 행 보존, engine·score 기록)
  ├─ GET /api/rfp/catalog → {solutions, llmAvailable}
  └─ 행 펼침 편집: 후보 → 충족/부분충족/설계·구축영역/해당없음으로 확정(edited=true)
```

- 순수 로직은 `frontend/src/lib/rfp/catalog/`·`frontend/src/lib/rfp/mapping/`에 두고 vitest 대상이다. Graph·Confluence·Claude 호출은 함수 주입으로 모킹한다(2·3단계와 같은 방식).
- 긴 작업은 전부 `after()`, `maxDuration = 300`. 6분 stale 규칙은 2단계 그대로.
- **토큰은 로그·응답·DB에 쓰지 않는다.** xlsx 가져오기용 Graph 토큰은 라우트가 요청 시점에 발급해 `runImport` 인자로만 넘긴다(메모리에만 존재).

```
frontend/src/lib/rfp/catalog/
  source-kind.ts        detectSourceKind(url, confluenceHost) → "confluence" | "xlsx" | null
  extract-rules.ts      extractFeaturesByRules(text) → {features, warnings, stats}   ※ 입력은 storageToText 결과
  xlsx-features.ts      parseXlsxFeatures(buffer) → {features, warnings, sheets}
  keywords.ts           seedKeywords(name, description, extra?), parseKeywordInput(s), KEYWORDS_MAX
  confluence-search.ts  buildTitleCql(q), searchConfluencePages(cfg, q, limit, fetch) → ConfluenceSearchHit[]
  merge-features.ts     (확장) IncomingFeature.keywords?, MergePlan에 keywords
  import-job.ts         (확장) runImport(admin, code, sourceIds, {engine, graphToken?}, deps)
  storage-text.ts       (변경) 제목 수준 보존 "#"×level
frontend/src/lib/rfp/mapping/
  types.ts              (확장) VERDICTS에 candidate, LLM_VERDICTS, MappingEngineKind, ENGINE_LABEL, EngineItem, FeatureLookup, MappingEngine
  tokenize.ts           normalizeText, tokenize, charBigrams, STOPWORDS, stripJosa
  rules.ts              RULES 상수, buildFeatureIndex(catalog), scoreFeature(req, feat), matchChunk(chunk, index) → EngineItem[]
  engine.ts             EngineSetup, EngineFactory, EngineKind, createRulesEngine, createLlmEngine, ENGINE_FACTORIES
  validate.ts           (변경) 세 번째 인자 FeatureLookup, EngineItem.score 통과
  run-job.ts            (변경) runMapping(admin, projectId, mode, engine, deps)
  summary.ts            (확장) countBySolution에 candidate
frontend/src/lib/ms/graph-drive.ts   (확장) resolveItem(token, url), downloadFile(token, driveId, itemId)
frontend/src/app/api/admin/rfp-catalog/confluence-search/route.ts   신규
frontend/src/app/api/admin/rfp-catalog/solutions/[code]/{sources,import}/route.ts, features/[featureId]/route.ts, solutions/route.ts   변경
frontend/src/app/api/rfp/catalog/route.ts, projects/[id]/mapping/route.ts, projects/[id]/mapping/rows/route.ts   변경
frontend/src/components/admin/rfp-catalog/SourceTable.tsx, FeatureTable.tsx, ConfluenceSearchPanel.tsx(신규)
frontend/src/components/rfp/MappingRunButton.tsx, MappingEditor.tsx, MappingSummary.tsx, app/rfp/[id]/page.tsx
docs/sql/2026-09-06-rfp-rules-mapping.sql
```

## 3. 데이터 모델 (`docs/sql/2026-09-06-rfp-rules-mapping.sql`, 멱등)

```sql
-- 기능 키워드
alter table public.rfp_solution_features add column if not exists keywords text[] not null default '{}';

-- 소스 종류·xlsx 드라이브
alter table public.rfp_solution_sources add column if not exists kind text not null default 'confluence';
alter table public.rfp_solution_sources add column if not exists drive_id text;
alter table public.rfp_solution_sources drop constraint if exists rfp_solution_sources_kind_check;
alter table public.rfp_solution_sources add constraint rfp_solution_sources_kind_check check (kind in ('confluence','xlsx'));

-- 판정에 candidate, 행의 출처 엔진과 점수
alter table public.rfp_requirement_mappings drop constraint if exists rfp_requirement_mappings_verdict_check;
alter table public.rfp_requirement_mappings add constraint rfp_requirement_mappings_verdict_check
  check (verdict in ('fulfilled','partial','candidate','build','na'));
alter table public.rfp_requirement_mappings add column if not exists engine text not null default 'manual';
alter table public.rfp_requirement_mappings add column if not exists score numeric;
update public.rfp_requirement_mappings set engine = 'llm' where edited = false and engine = 'manual';   -- 4단계 이전 자동 행은 모두 Claude
alter table public.rfp_requirement_mappings drop constraint if exists rfp_requirement_mappings_engine_check;
alter table public.rfp_requirement_mappings add constraint rfp_requirement_mappings_engine_check check (engine in ('rules','llm','manual'));
```

- `keywords`: 소문자 NFKC 문자열 배열, 최대 20개, 항목 30자 이하. 시드와 어드민 편집이 같은 열을 쓴다.
- `kind='xlsx'`일 때 `page_id` = Graph driveItem id, `drive_id` = driveId, `url` = 사용자가 붙인 공유 링크 그대로, `title` = 파일명, `page_version` = null. 유니크 `(solution_code, page_id)`는 그대로 쓴다.
- `engine`: 행을 만든 주체. 사람이 PATCH해도 `engine`은 바꾸지 않고 `edited=true`로만 표시한다(화면: "자동(규칙) 0.42 ✎"). 수동 추가 행은 `manual`, `score` null.
- `score`: 규칙 엔진 점수 0~1(소수 2자리로 저장). llm·manual은 null.
- 기존 13개 소스 행은 기본값 `confluence`로 남는다. 기존 기능은 없으므로(운영 카탈로그 비어 있음) 키워드 백필은 하지 않는다. 있다면 규칙 가져오기가 `edited=false` 기능의 키워드를 다시 시드한다.

## 4. 카탈로그 적재

### 4.1 소스 종류 판별 (`catalog/source-kind.ts`)

`detectSourceKind(url, confluenceHost | null)`:
- URL 파싱 실패 또는 스킴이 `https:`가 아님 → `null`.
- 호스트가 `confluenceHost`(대소문자 무시)와 같으면 `"confluence"`.
- 호스트가 `/(^|\.)sharepoint\.com$/i`에 맞으면 `"xlsx"`.
- 그 외 `null` → 라우트 400 "Confluence 페이지 URL 또는 SharePoint 파일 링크만 등록할 수 있습니다."
- `confluenceHost`가 null(`ATLASSIAN_*` 미설정)이면 confluence 판별은 건너뛰고 sharepoint만 본다. Confluence URL을 넣었는데 env가 없으면 2단계 문구("ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다.") 400.

### 4.2 Confluence 규칙 파서 (`catalog/extract-rules.ts`)

입력은 `storageToText(xhtml)` 결과 텍스트다(표 행 `| a | b |`, 제목 `## `, 글머리 `- `). 출력 `{ features: IncomingFeature[]; warnings: string[]; stats: { tables, headings, bullets } }`. 문서 순서대로 모으고 마지막에 `dedupeIncoming`으로 합친다.

**표**(연속한 `|`로 시작하고 `|`로 끝나는 줄 묶음)
- 첫 행이 헤더. 셀은 ` | `로 나눈다(셀 안 `|`는 지원하지 않는다 — 문서에 드물다).
- 이름 열 = 헤더 셀이 `/기능\s*명|기능|메뉴|국문명|이름|명칭|feature|name/i`에 처음 맞는 열. 없으면 0열. 단 0열 헤더가 `/^(no\.?|번호|순번|연번|#)$/i`이면 1열.
- 설명 = 이름 열을 뺀 나머지 셀을 ` · `로 이은 문자열(빈 셀 제외).
- 건너뛰는 행: 헤더, 이름 셀 비어 있음, 이름 셀이 **코드만**(`isCodeOnly`: `/^[A-Za-z]{0,4}[-_.]?\d{1,4}([-_.]\d{1,4})*$/` 예 `SEC-001`·`F01`·`1.2.3`, 또는 숫자를 포함한 대문자 코드 `/^[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*$/` 예 `SEC_AUTH_01` — `IAM`·`SSO`처럼 숫자 없는 약어는 기능 이름으로 남긴다), 이름 셀 60자 초과(문장으로 본다), 이름 셀이 헤더와 같음(반복 헤더).
- 1열 표는 이름만 있는 기능으로 받는다(설명 빈 문자열).

**제목**(`/^(#{2,4}) (.+)$/`, 즉 h2~h4)
- 이름 = 제목 텍스트에서 앞 번호(`/^\d+(\.\d+)*[.)]?\s+/`)를 떼고 40자 이하일 때만.
- 건너뛰는 제목: `/^(개요|목차|목적|배경|범위|참고|참고\s*자료|이력|변경\s*이력|문서\s*정보|담당자|일정|회의|참석자|안건|결론|기타|비고|요약|서론|history|overview|agenda|reference|summary|toc)/i`.
- 설명 = 다음 제목 또는 표 시작 전까지의 줄(글머리 포함, `- ` 접두 제거)을 공백으로 이어 300자에서 자른다.

**글머리표**(`/^- (.+)$/`)
- 내용이 `/^(.{2,40}?)\s*(?::|：|—|–| - )\s+(.+)$/`에 맞으면 이름·설명으로 받는다.
- 건너뛰기: 이름이나 설명에 날짜(`/\d{4}[.\-/]\d{1,2}/`)·URL(`https?://`)이 있거나 이름이 `/담당|일정|참석|회의|작성|검토자?|승인/`에 맞음.

- 기능 0개면 `warnings`에 "문서에서 기능을 찾지 못했습니다.". 소스 `note`에는 "규칙 추출: 표 {tables}·제목 {headings}·글머리 {bullets} → 기능 {n}개"를 남긴다.
- 회의록성 잡음은 완전히 걸러지지 않는다. 어드민이 기능 표에서 비활성으로 정리하는 것을 전제로 하고 화면에 그 안내를 넣는다(§7.1).

### 4.3 SharePoint xlsx 소스

**등록**(`POST …/sources`, kind xlsx)
1. `loadMsConfig(createServerSupabase())` — 누락이면 500 `missingConfigMessage`(3단계와 같다).
2. `getAccessTokenForUser(admin, userId, {app, encKey})` — `NotConnectedError` → 400 `{error:"Microsoft 계정을 먼저 연결하세요.", code:"not_connected"}`, `ReconnectRequiredError` → 409 `{code:"reconnect"}`, `OAuthError` → 502(3단계 업로드 라우트와 같은 처리).
3. `resolveItem(token, url)`(`lib/ms/graph-drive.ts` 신규): `GET /shares/{u!…}/driveItem?$select=id,name,size,file,folder,webUrl,parentReference`. 폴더면 `FolderResolveError(400, "폴더 링크입니다. xlsx 파일 링크를 붙여 주세요.")`(클래스 이름은 3단계 것을 그대로 재사용 — 공유 링크 해석 오류라는 뜻), 파일명이 `.xlsx`로 끝나지 않고 `file.mimeType`도 `XLSX_MIME`이 아니면 400 "xlsx 파일만 등록할 수 있습니다.", `size > 20 MiB`(`XLSX_SOURCE_MAX_BYTES`) → 400 "파일이 너무 큽니다(20MB 이하).", 403·400·404 처리는 `resolveFolder`와 같다. 반환 `{driveId, itemId, name, size, webUrl}`.
4. insert `{kind:'xlsx', url, page_id: itemId, drive_id: driveId, title: name}`. 중복 409 "같은 파일이 이미 등록돼 있습니다."

**내려받기**(`downloadFile(token, driveId, itemId, fetchImpl, sleep)`)
- `GET {GRAPH_BASE}/drives/{driveId}/items/{itemId}/content`를 `redirect: "manual"`로 보낸다(`fetchWithRetry` 사용). 302/301이면 `Location`을 **Authorization 없이** GET해 `Buffer`로 돌려준다(사전 인증 URL에 토큰을 붙이면 401). 200이면 본문을 그대로 쓴다. 그 외는 `GraphError`.
- 본문이 20 MiB를 넘으면 오류 "파일이 너무 큽니다(20MB 이하)."

**파싱**(`catalog/xlsx-features.ts`, `parseXlsxFeatures(buffer)`)
- exceljs `Workbook.xlsx.load(buffer)`. 시트마다 앞 10행 안에서 **헤더 행**을 찾는다: 어떤 셀이 `/^(기능\s*명?|기능\s*명칭|메뉴\s*명?|feature|name)$/i`(공백 제거 후)에 맞는 첫 행. 없으면 그 시트는 건너뛰고 경고 "시트 {이름}: 기능 열을 찾지 못했습니다."
- 이름 열 = 그 셀. 설명 열 = 헤더에 `/설명|내용|상세|description|detail/i`에 맞는 첫 열(없으면 이름 열을 뺀 나머지 텍스트 셀을 ` · `로 이음). 키워드 열 = `/키워드|keyword/i`(선택, 쉼표·줄바꿈 구분 → `IncomingFeature.keywords`).
- 데이터 행: 헤더 다음 행부터. 셀 값은 `cell.text`(수식·리치텍스트 처리)를 trim. 이름이 비었거나 코드만(§4.2 `isCodeOnly` 공용)이거나 60자 초과면 건너뛴다. 이름이 헤더와 같으면(반복 헤더) 건너뛴다.
- 반환 `{ features, warnings, sheets: 읽은 시트 수 }`. 기능 0개면 "파일에서 기능을 찾지 못했습니다." 경고. `note`: "xlsx: 시트 {sheets}개 → 기능 {n}개".
- xlsx 소스는 엔진과 무관하게 항상 이 파서를 쓴다(`engine: "llm"`이어도). 가져오기 요약에 "xlsx 소스는 규칙으로 읽습니다"를 굳이 표시하지 않는다.

### 4.4 키워드 (`catalog/keywords.ts`)

- `seedKeywords(name, description, extra: string[] = []): string[]` — `tokenize(name)` 전부 + `tokenize(description)` 앞에서 10개(이름 토큰과 중복 제외) + `extra`(정규화) → 순서 유지 중복 제거 → `KEYWORDS_MAX = 20`개로 자른다. 각 항목 `KEYWORD_MAX_LEN = 30`자 초과는 버린다.
- `parseKeywordInput(s: string): string[]` — `,`·`、`·줄바꿈으로 나눔 → `normalizeText`(NFKC·소문자·앞뒤 공백) → 빈 값·2자 미만·30자 초과 제거 → 중복 제거 → 20개.
- 이름에서 나온 키워드는 저장 시 구분하지 않는다. 매칭 때 `tokenize(feature.name)`와 겹치는 키워드에 가중치 2를 준다(§5.3).

### 4.5 병합·잡 (`merge-features.ts`, `import-job.ts`)

- `IncomingFeature`에 `keywords?: string[]` 추가. `MergePlan.toInsert[]`·`toUpdate[]`에 `keywords: string[]`를 넣는다 = `seedKeywords(name, description, incoming.keywords ?? [])`. `edited=true` 기존 기능은 2단계처럼 건너뛴다(키워드도 보존).
- `runImport(admin, solutionCode, sourceIds, opts: { engine: "rules" | "llm"; graphToken?: string }, deps)`:
  - `deps`에 `fetchPage`(기존), `makeCall`(기존, llm일 때만 호출), `download: typeof downloadFile`, `parseXlsx: typeof parseXlsxFeatures`, `extractRules: typeof extractFeaturesByRules`.
  - `ATLASSIAN_*`는 대상 중 confluence 소스가 있을 때만 필수. `graphToken`은 xlsx 소스가 있을 때만 필수(없으면 그 소스만 `failed` "Microsoft 토큰이 없습니다" — 정상 경로에서는 라우트가 먼저 막는다).
  - 소스 종류·엔진에 따라 §4.2/§4.3/2단계 `extractFeatures` 중 하나로 `{features, warnings}`를 얻고, 이후 병합·상태 갱신은 2단계와 같다. insert/update에 `keywords`를 포함한다.
  - `note`는 파서 요약 + "사람이 고친 기능 N개는 유지했습니다."를 공백으로 잇는다.

### 4.6 Confluence 검색 (`catalog/confluence-search.ts`)

- `buildTitleCql(q)`: `q`에서 `"`·`\`를 제거하고 연속 공백을 하나로 → `type=page AND title ~ "{q}" ORDER BY lastmodified DESC`.
- `searchConfluencePages(cfg, q, limit, fetchImpl)`: `GET {site}/wiki/rest/api/content/search?cql={encoded}&expand=space,version&limit={limit}` Basic 인증(2단계 `confluenceConfig()`). 응답 `results[]` → `{ pageId: String(id), title, spaceKey: space.key, spaceName: space.name, url: site + "/wiki" + _links.webui, lastModified: version.when }`. 응답이 `ok`가 아니면 `ConfluenceFetchError(status, "Confluence 검색 실패({status})")`(본문은 로그에도 남기지 않는다).
- 라우트 `GET /api/admin/rfp-catalog/confluence-search?q=&limit=`: admin. `q` 2~100자 아니면 400 "검색어는 2~100자입니다.", `limit` 1~25 기본 20. env 없음 400(2단계 문구). 검색 실패 502. 응답 `{ results: ConfluenceSearchHit[] }`.

## 5. 매핑

### 5.1 판정 5값 (`mapping/types.ts`)

| `verdict` | 표시 | 뜻 | 솔루션·기능 | 요구사항당 행 수 |
|---|---|---|---|---|
| `fulfilled` | 충족 | (2단계와 같다) | 필수 | 여러 행 |
| `partial` | 부분충족 | (2단계와 같다) | 필수 | 여러 행 |
| **`candidate`** | **후보** | 규칙 엔진이 키워드·유사도로 고른 기능. 사람이 검토해 확정하기 전 상태 | 필수 | 여러 행 |
| `build` | 설계·구축영역 | (2단계와 같다) | null | 하나, 단독 |
| `na` | 해당없음 | (2단계와 같다) | null | 하나, 단독 |

- `VERDICTS = ["fulfilled","partial","candidate","build","na"]`, `VERDICT_ORDER`도 같은 순서(좋은 판정이 앞). `VERDICT_LABEL.candidate = "후보"`. `requiresFeature(candidate) = true`.
- `validateManualMapping`·`validateMappingOutput`의 규칙은 candidate를 partial과 똑같이 다룬다(기능 필수, build/na와 공존 불가, 같은 기능 중복 불가). 오류 문구의 "충족·부분충족"은 "충족·부분충족·후보"로 바꾼다.
- `bestVerdict`·`countByVerdict`는 `VERDICT_ORDER`를 그대로 따라 후보만 있는 요구사항은 "후보"로 센다. `VerdictCounts`에 `candidate` 키가 생긴다.
- `countBySolution` → `{code, name, fulfilled, partial, candidate}`. 요구사항 중복 제거 규칙은 같다(그 솔루션 행들 중 가장 좋은 판정 하나).
- `MappingEngineKind = "rules" | "llm" | "manual"`, `ENGINE_LABEL = { rules: "규칙", llm: "Claude", manual: "수동" }`.
- Claude 프롬프트(`MAPPING_RULES_PROMPT`)와 `MappingOutputSchema`는 candidate를 **내지 않는다**: 스키마 enum은 `types.ts`의 `LLM_VERDICTS = ["fulfilled","partial","build","na"]`로 고정한다. 구조화 출력이 enum을 강제하므로 candidate가 올 일은 없고, 온다면 zod 파싱이 실패해 그 청크가 실패 경고로 남는다(2단계 청크 실패 처리).

### 5.2 토큰화 (`mapping/tokenize.ts`)

- `normalizeText(s)`: NFKC → 소문자 → 앞뒤 공백 제거.
- `tokenize(s): string[]`: `normalizeText` → 한글·영숫자 외 문자를 공백으로 → 공백 분리 → `stripJosa` → 2자 미만 제거 → `STOPWORDS` 제거 → 순서 유지 중복 제거.
- `stripJosa(t)`: 끝이 `(으로|에서|에게|부터|까지|의|을|를|이|가|은|는|에|로|와|과|도|만)`이고 뗀 뒤 2자 이상이면 뗀다(한 번만).
- `STOPWORDS`(초기값, 상수): `기능 제공 지원 관리 시스템 사용자 정보 및 등 있는 통한 위한 대한 경우 처리 가능 서비스 구성 환경 기반 방식 형태 각종 해당 관련 요구 요구사항 사업 본 사항 내용 수행 필요 이용 활용 the and or of for to in on with by`. 매칭 품질을 보고 코드에서 조정한다.
- `charBigrams(s): Set<string>`: `normalizeText` 뒤 한글·영숫자만 남기고(공백 제거) 인접 2자 쌍의 집합. 길이 1 이하면 빈 집합.

### 5.3 규칙 엔진 (`mapping/rules.ts`)

```ts
export const RULES = { HIT_WEIGHT: 0.15, SIM_WEIGHT: 0.7, SIM_THRESHOLD: 0.3, MIN_FEATURE_BIGRAMS: 6, TOP_PER_REQ: 3, MAX_PER_SOLUTION: 2, SUBSTRING_MIN_LEN: 3 } as const;

export interface FeatureEntry { featureId; solutionCode; name; keywords: string[]; nameTokens: Set<string>; bigrams: Set<string> }
export function buildFeatureIndex(catalog: CatalogSolution[]): FeatureEntry[]        // 활성 솔루션의 활성 기능만. bigrams = charBigrams(name + " " + description)
export interface ScoreDetail { hits: string[]; hitWeight: number; sim: number; score: number }
export function scoreFeature(req: { tokens: Set<string>; normText: string; bigrams: Set<string> }, f: FeatureEntry): ScoreDetail
export function matchChunk(chunk: readonly ChunkRequirement[], index: FeatureEntry[]): EngineItem[]
```

- 요구사항 텍스트 = `title + " " + definition + " " + truncateDetails(details)`(2단계 1500자 절단 재사용). `tokens = new Set(tokenize(text))`, `normText = normalizeText(text)`(공백 포함), `bigrams = charBigrams(text)`.
- **키워드 일치**: 키워드 `k`(저장값, 이미 정규화)가 `tokens`에 있거나, `k.length ≥ 3`이고 `normText.replace(/\s+/g,"")`가 `k`(공백 제거)를 포함하면 히트. 가중치 = `f.nameTokens.has(k) ? 2 : 1`. `hitWeight` = 가중치 합, `hits` = 일치한 키워드(점수 큰 순, 최대 5개 표시).
- **유사도**: `f.bigrams.size < MIN_FEATURE_BIGRAMS`이면 `sim = 0`. 아니면 `sim = |f.bigrams ∩ req.bigrams| / min(|f.bigrams|, |req.bigrams|)`.
- **점수**: `score = min(1, HIT_WEIGHT × hitWeight + SIM_WEIGHT × sim)`, 소수 2자리 반올림.
- **후보 조건**: `hitWeight ≥ 1` 또는 `sim ≥ SIM_THRESHOLD`.
- 요구사항마다 후보를 점수 내림차순(동점이면 기능 이름 사전순)으로 정렬 → 같은 솔루션은 `MAX_PER_SOLUTION`개까지 → 앞에서 `TOP_PER_REQ`개.
- 결과 `EngineItem`: `{ reqId, verdict: "candidate", feature: featureId, rationale, score }`. `rationale` = `자동 매칭 — 일치 키워드: {hits를 ", "로} · 유사도 {sim.toFixed(2)}`; hits가 없으면 `자동 매칭 — 유사도 0.42`.
- 후보가 하나도 없는 요구사항은 행을 내지 않는다(검증이 "매핑 결과 없음"으로 경고하고 미매핑으로 둔다 — 2단계 규칙 6 그대로. build/na를 만들어 넣지 않는다).

### 5.4 엔진 주입 (`mapping/engine.ts`, `validate.ts`, `run-job.ts`)

```ts
// mapping/types.ts (validate·rules·engine이 함께 쓴다. 기존 LlmMappingItem은 EngineItem으로 이름을 바꾼다)
export interface EngineItem { reqId: string; verdict: Verdict; feature: string | null; rationale: string; score?: number }
export type MappingEngine = (chunk: readonly ChunkRequirement[]) => Promise<EngineItem[]>;
export type FeatureLookup = Map<string, { featureId: string; solutionCode: string }>;   // key: llm은 "F3" 별칭, rules는 기능 id
// mapping/engine.ts
export interface EngineSetup { run: MappingEngine; lookup: FeatureLookup }
export type EngineFactory = (catalog: CatalogSolution[]) => EngineSetup;   // llm은 키가 없으면 LlmUnavailableError를 던진다
export type EngineKind = "rules" | "llm";
export function createRulesEngine(catalog): EngineSetup   // index = buildFeatureIndex(catalog); lookup = index → Map(featureId → {featureId, solutionCode}); run = async (chunk) => matchChunk(chunk, index)
export function createLlmEngine(catalog): EngineSetup     // {systemText, aliases} = buildCatalogPrompt(catalog); call = createAnthropicMappingCall(systemText); run = async (chunk) => (await call(buildChunkMessage(chunk))).mappings; lookup = aliases.features
export const ENGINE_FACTORIES: Record<EngineKind, EngineFactory>
```

- `validateMappingOutput(items: EngineItem[], chunk, lookup: FeatureLookup)`: 기존 `aliases.features.get(alias.trim().toUpperCase())` 대신 `lookup.get(item.feature.trim())`을 쓴다(llm 팩토리가 별칭 키를 대문자로 저장하므로 대소문자 처리는 팩토리 안에서 한다 — `createLlmEngine.run`이 `feature`를 `trim().toUpperCase()`로 정리해 반환). `ValidatedRow`에 `score: number | null`을 통과시킨다(`item.score ?? null`, 범위 밖이면 null). 나머지 규칙 1~6은 그대로.
- `runMapping(admin, projectId, mode, engine: EngineKind, deps: { factories: Record<EngineKind, EngineFactory> } = { factories: ENGINE_FACTORIES })`:
  - `const setup = deps.factories[engine](catalog)` — `LlmUnavailableError`면 `failed` + 메시지(2단계와 같다). `setup.lookup.size === 0`이면 "카탈로그가 비어 있습니다".
  - 청크마다 `setup.run(chunk)` → `validateMappingOutput(items, chunk, setup.lookup)` → 삭제·삽입은 2단계 그대로에 `engine`, `score`를 넣는다.
  - `CONCURRENCY = 3`·청크 20건은 그대로(규칙 엔진은 CPU만 쓰지만 청크별 저장 단위를 같게 유지한다).
- 기존 `MappingDeps.makeCall`은 없어지고 `rfp-mapping-run.test.ts`의 순수 함수 테스트(`selectTargetRequirements`, `runWithConcurrency`, `summarizeChunkOutcomes`, `MappingOutputSchema`)는 그대로 둔다.

### 5.5 실행 요청 (`POST /api/rfp/projects/[id]/mapping`)

`{ mode?: "all" | "missing", engine?: "rules" | "llm", confirm?: boolean }` — `engine` 기본 `"rules"`, 그 외 값은 400 "engine은 rules 또는 llm입니다."
- `ANTHROPIC_API_KEY` 검사는 `engine === "llm"`일 때만(없으면 400, 2단계 문구).
- 카탈로그 비어 있음 검사는 `createRulesEngine(catalog).lookup.size === 0`으로 통일한다(활성 솔루션의 활성 기능 수 — 두 엔진의 대상 집합이 같다).
- 409 running / 409 needsConfirm / 202 `{started, mode, engine}`는 2단계와 같다. `after(runMapping(admin, id, mode, engine))`.

### 5.6 수동 행

- `POST …/mapping/rows` → `engine: "manual"`, `score: null`. `PATCH /api/rfp/mappings/[id]`는 `engine`·`score`를 바꾸지 않는다(사람이 후보를 충족으로 확정하면 `verdict=fulfilled, edited=true, engine=rules, score=0.42`로 남아 "규칙 후보를 사람이 확정"했음이 보인다).
- `MAPPING_COLUMNS`에 `engine, score` 추가. `mapMapping`이 `engine`, `score: Number|null`을 채운다. `RfpMapping`에 `engine: MappingEngineKind; score: number | null` 추가(`MappingRow`는 그대로 — 순수 함수·xlsx·테스트 픽스처는 바뀌지 않는다).

## 6. API

### 6.1 어드민 `/api/admin/rfp-catalog` (변경·추가만)

| 메서드·경로 | 요청 → 응답 |
|---|---|
| `GET /solutions` | 기존 응답에 최상위 `llmAvailable: boolean`(= `ANTHROPIC_API_KEY` 존재) 추가 |
| `POST /solutions/[code]/sources` | `{url}` → §4.1 종류 판별 → confluence: 2단계 그대로 / xlsx: §4.3 등록 → 201 `RfpSolutionSource`(`kind`, `driveId` 포함). 오류: 400 종류 불명·폴더·xlsx 아님·크기, 400 `{code:"not_connected"}`, 409 `{code:"reconnect"}`, 500 MS 설정 누락, 502 OAuth |
| `GET /solutions/[code]/sources`, `GET …/import` | 행에 `kind: "confluence" \| "xlsx"`, `driveId: string \| null` 추가 |
| `POST /solutions/[code]/import` | `{sourceIds?, engine?: "rules" \| "llm"}` 기본 rules. 대상에 confluence가 있으면 `ATLASSIAN_*` 검사, llm이면 `ANTHROPIC_API_KEY` 검사(없으면 400). 대상에 xlsx가 있으면 세션 사용자의 Graph 토큰을 §4.3 1~2와 같이 발급(실패 시 같은 400/409/500/502)해 `runImport(admin, code, ids, {engine, graphToken})`. 202 `{started, sourceIds, engine}` |
| `GET /solutions/[code]/features` | 행에 `keywords: string[]` 추가 |
| `POST /solutions/[code]/features` | `{name, description?, evidenceUrl?, keywords?: string[]}` — `keywords`가 없거나 빈 배열이면 `seedKeywords(name, description)`로 채운다. 배열이면 `parseKeywordInput(keywords.join(","))` 규칙으로 정리 |
| `PATCH /features/[id]` | `keywords?: string[] \| null` 추가. 배열 → 정리해 저장(`edited=true`), `null` → 현재 이름·설명으로 `seedKeywords` 재생성(`edited=true`). 배열이 아니고 null도 아니면 400 "keywords는 문자열 배열 또는 null입니다." 이름·설명만 바꿀 때는 `keywords`를 건드리지 않는다 |
| `GET /confluence-search?q=&limit=` | §4.6 → `{results: [{pageId, title, spaceKey, spaceName, url, lastModified}]}` |

### 6.2 사용자

| 메서드·경로 | 변경 |
|---|---|
| `GET /api/rfp/catalog` | 응답에 `llmAvailable: boolean` 추가. 기능 객체는 그대로(키워드는 내려주지 않는다). `toCatalog`는 `CatalogFeature.keywords`를 `[]`로 채운다 |
| `POST /api/rfp/projects/[id]/mapping` | §5.5 |
| `GET /api/rfp/projects/[id]/mapping`, `GET /api/rfp/projects/[id]` | 매핑 행에 `engine`, `score` |
| `POST /api/rfp/projects/[id]/mapping/rows`, `PATCH /api/rfp/mappings/[id]` | 판정에 `candidate` 허용(규칙은 partial과 같다). §5.6 |

`CatalogFeature`(서버 순수 타입)에 `keywords: string[]` 추가, `FEATURE_COLUMNS`에 `keywords`. `mapFeature`·`mapAdminFeature`가 채운다.

## 7. 화면

### 7.1 어드민 `/admin/rfp-catalog`

- 페이지 설명 문구: "솔루션별 기능 목록. Confluence 페이지나 SharePoint xlsx 기능명세서를 등록해 가져오면 규칙(표·제목·키워드)으로 기능과 키워드를 정리하고, ANTHROPIC_API_KEY가 있으면 Claude로 보강할 수 있습니다. 사람이 고친 ✎ 항목은 가져오기가 덮어쓰지 않습니다."
- **`SourceTable`**: 제목 "소스". 입력 placeholder "Confluence 페이지 URL 또는 SharePoint xlsx 파일 링크". 표에 "종류" 열(배지 `Confluence` / `xlsx`) 추가, "버전" 열은 xlsx면 "—". 버튼: "가져오기(규칙)"(기본, 아이콘 Download) + "Claude로 보강"(outline; `llmAvailable`이 false면 disabled, title "ANTHROPIC_API_KEY 미설정"). 행별 가져오기 아이콘은 규칙. 400 `code: "not_connected"`는 문구 뒤에 `/settings` 링크("Microsoft 계정 연결")를 붙인다. `llmAvailable`은 페이지가 `GET /solutions`에서 받아 props로 내린다.
- **`ConfluenceSearchPanel`**(SourceTable 아래, 접이식 `<details>` "Confluence에서 찾기"): 검색 입력(초기값 = 솔루션 이름) + "검색" → `GET /confluence-search` → 표(제목(링크)·스페이스·수정일·버튼). 이미 등록된 `pageId`(SourceTable의 confluence 소스 `pageId`와 비교)는 "등록됨" 배지, 아니면 "등록" 버튼 → `POST …/sources {url}` → 성공 시 SourceTable 재조회. 결과 0건 "검색 결과가 없습니다." 오류는 그대로 표시. `ATLASSIAN_*` 미설정 400이면 패널 안에 문구만 보이고 검색 입력은 비활성.
- **`FeatureTable`**: "설명" 뒤에 "키워드" 열(너비 14rem). 셀 = 키워드 칩 목록을 `EditableCell`(쉼표로 이은 문자열, `clampLines={2}`)로 편집 → `PATCH {keywords: parse}`. 셀 오른쪽 ↻ 아이콘(title "이름·설명에서 다시 생성") → `PATCH {keywords: null}`. 검색 필터에 키워드 포함. 표 위 안내 문구에 "규칙 가져오기 결과에는 회의록·일정 같은 항목이 섞일 수 있습니다. 기능이 아닌 항목은 비활성으로 바꾸세요."를 덧붙인다.

### 7.2 프로젝트 상세 `/rfp/[id]`

- 페이지가 `GET /api/rfp/catalog`의 `llmAvailable`을 상태로 들고 `OverviewCard → MappingRunButton`에 내린다. `runMapping(mode, engine)`이 `{mode, engine, confirm}`을 보낸다.
- **`MappingRunButton`**: 버튼은 이제 **항상 다이얼로그**를 연다(첫 실행 포함). 다이얼로그 위쪽에 엔진 선택(두 개의 토글 버튼, 새 shadcn 컴포넌트 없이): "규칙(키워드) — 기본"(설명 "카탈로그 키워드·유사도로 후보를 고릅니다. 키 없이 동작") / "Claude"(설명 "Claude가 충족·부분충족·설계·해당없음을 판정합니다"; `llmAvailable`이 false면 disabled + "ANTHROPIC_API_KEY 미설정"). 아래 모드 버튼은 2단계와 같되, 매핑이 하나도 없으면 "매핑 실행" 하나(mode all). 설명 문구의 "Claude가 만든 매핑은 새 결과로 교체됩니다"는 "자동으로 만든 매핑(규칙 후보·Claude)은 새 결과로 교체됩니다"로 바꾼다.
- **`MappingSummary`**: 칩에 "후보 N"(`VERDICT_CLASS.candidate = "bg-indigo-100 text-indigo-900 hover:bg-indigo-200"`). 솔루션별 건수 "충족 N · 부분 M · 후보 K"(0이면 후보 생략).
- **`MappingEditor`**: 판정 셀렉트에 후보 포함(`VERDICT_ORDER`). 행 헤더 오른쪽에 출처 표시: `engine === "rules"` → "자동(규칙) {score.toFixed(2)}", `llm` → "자동(Claude)", `manual` → 표시 없음; ✎는 그대로. 안내 문구 "설계·구축영역/해당없음을 고르면 바로 추가되고, 충족/부분충족/후보는 기능까지 고르면 추가됩니다."
- `RequirementsTable`·`ProjectList`는 `VerdictBadge`·`bestVerdict`를 통해 자동으로 후보를 보여준다(코드 변경 없음).

## 8. xlsx (`xlsx.ts`)

- 판정 열·매핑 시트·개요 건수는 `VERDICT_ORDER`·`VERDICT_LABEL`을 돌기 때문에 "후보"가 자동으로 들어간다. 개요 "3. 솔루션 매핑 요약"의 판정 건수는 6줄(충족·부분충족·후보·설계·구축영역·해당없음·미매핑), 솔루션별 줄은 "충족 N건 · 부분충족 M건 · 후보 K건".
- `mappingSummary`는 `SECloudit·IAM(후보)`를 만든다(변경 없음).
- 엔진·점수 열은 넣지 않는다.

## 9. 오류 처리

| 상황 | 처리 |
|---|---|
| URL이 Confluence도 SharePoint도 아님 | `POST /sources` 400 "Confluence 페이지 URL 또는 SharePoint 파일 링크만 등록할 수 있습니다." |
| xlsx 링크인데 Microsoft 미연결 | 400 `{code:"not_connected"}` → 화면 문구 + `/settings` 링크 |
| xlsx 링크가 폴더·xlsx 아님·20MiB 초과·권한 없음 | 400/403 문구(§4.3) |
| MS 설정 누락(`teams_*`·env) | 500 `missingConfigMessage` — 3단계와 같다 |
| 가져오기 중 Graph 내려받기 실패(404·423·5xx) | 그 소스만 `failed` + "SharePoint 응답 오류(NNN)" 또는 "파일이 없습니다(삭제·이동)"(404). 다른 소스 계속 |
| 규칙 파서가 기능 0개 | 소스 `ready`, `feature_count 0`, 경고 문구 |
| `engine: "llm"`인데 키 없음 | 가져오기·매핑 POST 400 "ANTHROPIC_API_KEY가 설정되지 않았습니다." 화면은 미리 비활성 |
| 규칙 매핑에서 후보 없는 요구사항 | 미매핑으로 남고 `mapping_warnings`에 "{reqId}: 매핑 결과 없음"(2단계와 같다). 요구사항 124건 중 다수가 미매핑이면 카탈로그 키워드를 보강하라는 안내는 런북에 |
| Confluence 검색 실패 | 502 "Confluence 검색 실패(NNN)"; 검색어 길이 400 |
| `keywords` 타입 오류 | 400 "keywords는 문자열 배열 또는 null입니다." |
| Claude 출력에 candidate | zod 스키마(`LLM_VERDICTS`)가 거부해 그 청크만 실패 경고로 남음. 구조화 출력이 enum을 강제하므로 실제로는 발생하지 않는다 |

## 10. 테스트 (vitest, `frontend/src/lib/__tests__/`)

- `rfp-mapping-tokenize.test.ts`: NFKC·소문자, 기호 분리, 조사 제거("사용자의" → "사용자", 2자 미만 남으면 유지), 불용어 제거, 2자 미만 제거, 중복 제거, `charBigrams`(공백 제거·집합·1자 이하 빈 집합).
- `rfp-catalog-keywords.test.ts`: `seedKeywords` 이름 토큰 우선·설명 10개·extra·중복 제거·20개 상한·30자 초과 제거; `parseKeywordInput` 구분자 3종·정규화·빈 값.
- `rfp-catalog-extract-rules.test.ts`: (a) 기능 코드 표 픽스처(`| 대분류 | 기능명 | 코드 | 설명 |`) → 이름 열 자동 선택, 코드 행·헤더 반복 제외, 설명 ` · ` 결합; (b) 헤더 키워드 없는 표 → 0열, `번호` 0열이면 1열; (c) 제목 `##`~`####`만, `#`·`#####` 제외, 번호 접두 제거, 40자 초과·불용 제목 제외, 설명 300자 절단; (d) 글머리 `이름: 설명`·`이름 — 설명`, 날짜·URL·담당자 제외; (e) 혼합 문서에서 `stats`와 `dedupeIncoming` 결과; (f) 빈 텍스트 → 경고.
- `rfp-catalog-storage-text.test.ts` 갱신: `<h2>` → `## `, `<h3>` → `### `(기존 `# ` 기대값 수정).
- `rfp-catalog-xlsx-features.test.ts`: exceljs로 워크북을 만들어 버퍼로 넘긴다(`rfp-xlsx.test.ts`와 같은 방식) — 3행 헤더 탐지, 설명·키워드 열, 헤더 없는 시트 건너뛰기 경고, 코드 행 제외, 여러 시트 합산, `cell.text` 리치텍스트.
- `rfp-catalog-merge.test.ts` 확장: `toInsert`·`toUpdate`에 키워드(시드 + incoming.keywords), edited 기능 키워드 보존.
- `rfp-catalog-source-kind.test.ts`: confluence 호스트·`*.sharepoint.com`·기타·http·잘못된 URL·confluenceHost null.
- `rfp-catalog-confluence-search.test.ts`: `buildTitleCql` 이스케이프(`"`·`\` 제거, 공백 정리), fetch 모킹으로 결과 매핑(`url = site + "/wiki" + webui`), 비-2xx → `ConfluenceFetchError(status)`.
- `ms-graph-drive.test.ts` 확장: `resolveItem` 폴더 → 400 문구, `.xlsx` 아님 → 400, 크기 초과 → 400, 정상 → `{driveId,itemId,name,size,webUrl}`; `downloadFile` 302 → Location을 Authorization 없이 GET, 200 직접 본문, 오류 → `GraphError`.
- `rfp-mapping-rules.test.ts`: 이름 키워드 가중치 2·설명 키워드 1, 부분 문자열 히트(3자 이상만), `sim` overlap과 `MIN_FEATURE_BIGRAMS` 미만 0, 점수 공식·1 상한·반올림, 후보 조건(히트 없음+sim 0.29 → 없음, sim 0.3 → 있음), 상위 3·솔루션당 2·동점 정렬, rationale 두 형식, 비활성 기능·비활성 솔루션 제외, 후보 없는 요구사항은 행 없음.
- `rfp-mapping-validate.test.ts` 확장: candidate가 기능 필수·build와 공존 불가·같은 기능 중복 제외, `FeatureLookup` 키 조회, `score` 통과·범위 밖 null; `validateManualMapping` candidate 허용.
- `rfp-mapping-summary.test.ts` 확장: `bestVerdict` 순서에 candidate, `countByVerdict.candidate`, `countBySolution.candidate`.
- `rfp-mapping-run.test.ts` 확장: `createRulesEngine` lookup 크기 = 활성 기능 수, `run`이 `matchChunk` 결과를 돌려줌; `createLlmEngine`이 키 없이 `LlmUnavailableError`.
- `rfp-xlsx.test.ts` 확장: candidate 행 → 판정 "후보", 개요 "후보 N건", 솔루션 줄 "후보 K건".
- 라우트·화면은 런북 수동 체크리스트 29~36(§11).

## 11. 환경 변수·배포·전환 순서

- **새 env 없음.** `ANTHROPIC_API_KEY`는 2·4단계에서 **선택**으로 바뀐다(없으면 규칙 엔진만). `ATLASSIAN_*`는 Confluence 소스·검색에, `MS_TOKEN_ENC_KEY`·`TEAMS_GRAPH_CLIENT_SECRET`·settings `teams_*`는 xlsx 소스에 필요(3단계에서 이미 설정).
- 새 의존성 없음(exceljs 기존).
- 배포 순서: ① `docs/sql/2026-09-06-rfp-rules-mapping.sql` Management API 적용 → ② `git push` 후 `vercel --prod`(워크트리는 `.vercel/project.json` 복사 확인) → ③ 어드민에서 등록된 소스 13건 "가져오기(규칙)" → ④ 기능 표에서 회의록성 항목 비활성·키워드 보강 → ⑤ DevOpsit·TabCloudit·Openstackit 기능명세서 xlsx 링크 3개 등록·가져오기(등록자 Microsoft 계정 연결 필요) → ⑥ 두 프로젝트에서 "규칙" 매핑 실행 → 후보 검토. 키가 들어오면 "Claude로 보강"·엔진 Claude로 재실행.
- **런북 `docs/rfp-analyzer.md`**: 구성에 4단계 문단, env 표의 `ANTHROPIC_API_KEY` 설명 수정, 최초 설치 9~10(SQL·전환), 운영 메모(규칙 상수·후보 검토·xlsx 소스 토큰은 가져오기 실행자 것·검색은 제목만), 수동 회귀 체크리스트 29~36:
  29. admin: 소스 입력에 SharePoint xlsx 링크 → 종류 `xlsx`·파일명 표시. Microsoft 미연결 계정으로는 400 문구 + "Microsoft 계정 연결" 링크. 폴더 링크는 "폴더 링크입니다" 400.
  30. "Confluence에서 찾기" → "기능명세서" 검색 → 결과 표 → "등록" → 소스 표에 추가되고 결과 행이 "등록됨"으로 바뀜.
  31. "가져오기(규칙)" → 완료 → 기능 표에 기능·키워드, 소스 메모 "규칙 추출: 표 N·제목 M·글머리 K → 기능 X개". 키 없으면 "Claude로 보강" 비활성(툴팁).
  32. 키워드 셀 편집(쉼표) → ✎ → 다시 가져오기 → 키워드 유지. ↻ → 이름·설명 기준으로 재생성(✎ 유지).
  33. 상세 → "솔루션 매핑 실행" → 다이얼로그 엔진 "규칙(키워드)" 기본, "Claude" 비활성(키 없음) → 실행 → 완료 → "후보 N" 칩, 행 펼침에 근거 "자동 매칭 — 일치 키워드: … · 유사도 0.xx"와 "자동(규칙) 0.xx".
  34. 후보 행 판정을 충족으로 변경 → ✎ + "자동(규칙)" 유지 → "전체 다시 매핑"(규칙) → 그 요구사항은 그대로, 다른 요구사항의 후보는 교체.
  35. xlsx 다운로드 → 판정 열 "후보", 개요 "후보 N건", 요약 "SECloudit·IAM(후보)". SharePoint 업로드 파일도 같다.
  36. (키 추가 후) "Claude로 보강"·엔진 "Claude" 활성 → 매핑 실행 → 후보가 충족/부분충족/설계·구축영역/해당없음으로 교체, ✎ 행은 유지, `engine=llm`.
- **`CLAUDE.md`**: `/admin/rfp-catalog` 설명(소스 2종·Confluence 검색·규칙/Claude 가져오기·키워드), 매핑 API `engine` 파라미터, 판정 5값, 새 라우트 `confluence-search`, SQL 파일, `ANTHROPIC_API_KEY` 선택 표기.

## 12. 후속 과제(범위 밖)

- Jira 검색·이슈 참조(예: 요구사항 ↔ 구현 이슈).
- 규칙 상수 튜닝 화면, 솔루션별 불용어.
- 카탈로그 기능 이름 동의어(예: IAM ↔ 계정 관리)를 키워드가 아닌 별도 사전으로.
- 요구사항 텍스트 형태소 분석(현재는 조사 제거 규칙만).
