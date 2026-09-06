# RFP 분석 4단계(규칙 기반 카탈로그 적재·매핑, LLM 폴백) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ANTHROPIC_API_KEY` 없이 동작하는 규칙(키워드·유사도) 엔진으로 솔루션 카탈로그를 채우고(Confluence 표·제목·글머리표 파서, SharePoint xlsx 기능명세서, Confluence 제목 검색 등록) 요구사항에 "후보" 판정을 자동 매핑하며, Claude는 키가 있을 때만 고르는 보강 엔진으로 내린다.

**Architecture:** 2단계의 `runImport`·`runMapping`을 엔진 주입형으로 바꾼다. 카탈로그는 소스 종류(`confluence`|`xlsx`)와 엔진(`rules`|`llm`)에 따라 파서를 고르고 이름·설명에서 키워드를 시드해 병합한다. 매핑은 `EngineFactory`(rules: `buildFeatureIndex`+`matchChunk`, llm: 2단계 프롬프트 호출)가 만든 `{run, lookup}`으로 청크를 처리하고, 검증·저장은 공용이다. 판정에 `candidate`("후보")를 추가하고 행마다 `engine`·`score`를 남긴다. xlsx 소스는 3단계 Microsoft 위임 토큰으로 Graph에서 내려받아 exceljs로 읽는다.

**Tech Stack:** Next.js 16 App Router(라우트 `after()`), React 19, TypeScript strict, Supabase(service role), exceljs, Microsoft Graph(위임 토큰), Confluence REST(CQL), vitest 3(jsdom 기본, fetch/crypto 테스트는 `// @vitest-environment node`).

**Spec:** `docs/superpowers/specs/2026-09-06-rfp-analyzer-phase4-design.md`

## Global Constraints

- 모든 UI 문구·문서·커밋 메시지는 한국어. 코드 식별자는 영어.
- 커밋 메시지 끝에 두 줄 트레일러: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv`.
- 작업 디렉터리는 워크트리 `/Users/seunguk.kang/orca/workspaces/inje-playground/rfp-analyzer`(브랜치 `abraxas73/rfp-analyzer`). `frontend/`에서 `npm test`·`npx tsc --noEmit`. **bare `git stash` 금지**(WIP 커밋으로 대신).
- `npx tsc --noEmit`에서 `survey-metrics.test.ts`의 TS2578 9건은 기존 잡음이다. **그 외 오류가 0건**이어야 한다(`npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts`로 확인). `npm run lint`의 기존 경고(~20건)도 잡음이며 새 오류·경고를 만들지 않는다.
- 새 npm 의존성 없음(exceljs·zod·@anthropic-ai/sdk·@tanstack/react-table 기존). 새 환경 변수 없음. 새 shadcn 컴포넌트 추가 없음.
- **토큰·시크릿·`error_description`은 어떤 로그·응답·DB·주석에도 쓰지 않는다.** Graph 토큰은 라우트가 발급해 `runImport` 인자로만 넘긴다.
- Next.js 라우트 파일은 핸들러와 `runtime`/`maxDuration`만 export 한다. 긴 작업은 `after()`, `maxDuration = 300`.
- React 19 + ESLint 9 react-hooks 규칙: effect 안에서 setState를 직접 부르지 않는다(`setTimeout(..., 0)` 또는 이벤트에서). 페이지에서 `useSearchParams` 금지.
- 판정 순서 `VERDICTS = ["fulfilled","partial","candidate","build","na"]`, `VERDICT_LABEL.candidate = "후보"`, `requiresFeature(candidate) = true`. Claude 스키마는 `LLM_VERDICTS = ["fulfilled","partial","build","na"]`.
- 규칙 엔진 상수(스펙 §5.3): `HIT_WEIGHT 0.15, SIM_WEIGHT 0.7, SIM_THRESHOLD 0.3, MIN_FEATURE_BIGRAMS 6, TOP_PER_REQ 3, MAX_PER_SOLUTION 2, SUBSTRING_MIN_LEN 3`. 이름 토큰과 겹치는 키워드 가중치 2, 나머지 1. 유사도 = overlap coefficient `|A∩B| / min(|A|,|B|)`.
- 키워드: 소문자 NFKC, 2~30자, 최대 20개. 시드 = 이름 토큰 전부 + 설명 토큰 앞 10개 + extra.
- Supabase 1000행 상한: 매핑 행 조회는 기존처럼 `selectAll`. 새 조회 중 무제한 성장 가능한 것은 없다.
- 운영 DB SQL 적용·배포는 구현자가 하지 않는다(컨트롤러가 Management API·`vercel --prod`).
- 기존 테스트 기대값을 바꿀 때는 이 계획이 지정한 새 값으로만 바꾼다. 테스트를 지우지 않는다.

---

## 파일 구조

```
docs/sql/2026-09-06-rfp-rules-mapping.sql                      (T1) 키워드·kind·drive_id·candidate·engine·score
frontend/src/lib/rfp/mapping/types.ts                          (T1) VERDICTS+candidate, LLM_VERDICTS, EngineKind, MappingEngineKind, EngineItem, FeatureLookup, MappingEngine
frontend/src/lib/rfp/mapping/summary.ts                        (T1) VerdictCounts.candidate, SolutionCount.candidate
frontend/src/lib/rfp/mapping/llm.ts                            (T1) 스키마 enum = LLM_VERDICTS
frontend/src/lib/rfp/mapping/validate.ts                       (T1 문구) (T12 FeatureLookup·score)
frontend/src/lib/rfp/mapping/client-catalog.ts                 (T1) keywords: []
frontend/src/lib/rfp/mappers.ts, lib/rfp/catalog/store.ts     (T1) engine·score / kind·drive_id / keywords 컬럼·매퍼
frontend/src/types/rfp.ts                                      (T1) (T9 ConfluenceSearchHit)
frontend/src/components/rfp/MappingSummary.tsx                 (T1) 후보 칩·솔루션별 후보
frontend/src/lib/rfp/xlsx.ts                                   (T1) 솔루션 줄에 후보 건수
frontend/src/app/api/rfp/catalog/route.ts                      (T1) llmAvailable
frontend/src/lib/rfp/mapping/tokenize.ts                       (T2) normalizeText, stripJosa, tokenize, charBigrams, STOPWORDS
frontend/src/lib/rfp/catalog/keywords.ts                       (T2) seedKeywords, parseKeywordInput
frontend/src/lib/rfp/catalog/storage-text.ts                   (T3) 제목 수준 보존
frontend/src/lib/rfp/catalog/extract-rules.ts                  (T3) extractFeaturesByRules, isCodeOnly, rulesNote
frontend/src/lib/rfp/catalog/merge-features.ts                 (T4 IncomingFeature.keywords·dedupe) (T6 MergePlan.keywords)
frontend/src/lib/rfp/catalog/xlsx-features.ts                  (T4) parseXlsxFeatures, xlsxNote
frontend/src/lib/ms/graph-drive.ts                             (T5) resolveItem, downloadFile, XLSX_SOURCE_MAX_BYTES
frontend/src/app/api/admin/rfp-catalog/solutions/[code]/features/route.ts, features/[featureId]/route.ts  (T6) keywords
frontend/src/components/admin/rfp-catalog/FeatureTable.tsx      (T6) 키워드 열·↻
frontend/src/lib/rfp/catalog/source-kind.ts                    (T7) detectSourceKind
frontend/src/lib/ms/route-token.ts                             (T7) graphTokenForRoute
frontend/src/app/api/admin/rfp-catalog/solutions/[code]/sources/route.ts  (T7) xlsx 등록
frontend/src/lib/rfp/catalog/import-job.ts                     (T8) engine·xlsx·rules
frontend/src/app/api/admin/rfp-catalog/solutions/[code]/import/route.ts   (T8) engine·graphToken
frontend/src/lib/rfp/catalog/confluence-search.ts              (T9) buildTitleCql, searchConfluencePages
frontend/src/app/api/admin/rfp-catalog/confluence-search/route.ts        (T9)
frontend/src/components/admin/rfp-catalog/ConfluenceSearchPanel.tsx       (T9)
frontend/src/components/admin/rfp-catalog/SourceTable.tsx      (T9 패널 삽입) (T10 종류·엔진 버튼·not_connected)
frontend/src/app/api/admin/rfp-catalog/solutions/route.ts, app/admin/rfp-catalog/page.tsx  (T10) llmAvailable
frontend/src/lib/rfp/mapping/rules.ts                          (T11) 규칙 엔진
frontend/src/lib/rfp/mapping/engine.ts                         (T12) createRulesEngine, createLlmEngine, ENGINE_FACTORIES
frontend/src/lib/rfp/mapping/run-job.ts                        (T12) runMapping(…, engine, deps)
frontend/src/app/api/rfp/projects/[id]/mapping/route.ts, mapping/rows/route.ts  (T12) engine
frontend/src/components/rfp/MappingRunButton.tsx, MappingEditor.tsx, OverviewCard.tsx, app/rfp/[id]/page.tsx  (T13)
docs/rfp-analyzer.md, CLAUDE.md                                (T14)
```

---

### Task 1: SQL·판정 `candidate`·타입·매퍼 확장

**Files:**
- Create: `docs/sql/2026-09-06-rfp-rules-mapping.sql`
- Modify: `frontend/src/lib/rfp/mapping/types.ts`
- Modify: `frontend/src/lib/rfp/mapping/llm.ts:5-15`
- Modify: `frontend/src/lib/rfp/mapping/validate.ts` (오류 문구 4곳)
- Modify: `frontend/src/lib/rfp/mapping/summary.ts` (`countByVerdict`, `SolutionCount`, `countBySolution`)
- Modify: `frontend/src/lib/rfp/mapping/client-catalog.ts`
- Modify: `frontend/src/lib/rfp/mappers.ts` (`MAPPING_COLUMNS`, `MappingDbRow`, `mapMapping`)
- Modify: `frontend/src/lib/rfp/catalog/store.ts` (`SOURCE_COLUMNS`, `FEATURE_COLUMNS`, DbRow 3종, 매퍼)
- Modify: `frontend/src/types/rfp.ts`
- Modify: `frontend/src/components/rfp/MappingSummary.tsx`
- Modify: `frontend/src/lib/rfp/xlsx.ts` (개요 솔루션 줄)
- Modify: `frontend/src/app/api/rfp/catalog/route.ts`
- Test: `frontend/src/lib/__tests__/rfp-mapping-summary.test.ts`, `rfp-mapping-validate.test.ts`, `rfp-mapping-prompt.test.ts`, `rfp-xlsx.test.ts`, `rfp-mapping-run.test.ts`

**Interfaces:**
- Produces: `Verdict`에 `"candidate"`; `LLM_VERDICTS`; `type EngineKind = "rules" | "llm"`, `isEngineKind(v)`; `type MappingEngineKind = "rules" | "llm" | "manual"`, `ENGINE_LABEL`; `interface EngineItem { reqId; verdict: Verdict; feature: string | null; rationale: string; score?: number }`; `type FeatureLookup = Map<string, { featureId: string; solutionCode: string }>`; `type MappingEngine = (chunk: readonly ChunkRequirement[]) => Promise<EngineItem[]>`; `CatalogFeature.keywords: string[]`; `RfpMapping.engine`, `RfpMapping.score: number | null`; `RfpSolutionSource.kind: RfpSourceKind`, `.driveId: string | null`; `RfpAdminFeature.keywords: string[]`; `RfpCatalogResponse.llmAvailable`; `RfpAdminSolutionsResponse`; `SolutionCount.candidate`; `VerdictCounts.candidate`.

- [ ] **Step 1: SQL 파일 작성**

`docs/sql/2026-09-06-rfp-rules-mapping.sql`:

```sql
-- RFP 분석 4단계 — 규칙 기반 카탈로그 적재·매핑. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-06-rfp-analyzer-phase4-design.md

-- 기능 키워드(소문자 NFKC, 최대 20개)
alter table public.rfp_solution_features add column if not exists keywords text[] not null default '{}';

-- 소스 종류·xlsx 드라이브(kind='xlsx'면 page_id = driveItem id, drive_id = driveId)
alter table public.rfp_solution_sources add column if not exists kind text not null default 'confluence';
alter table public.rfp_solution_sources add column if not exists drive_id text;
alter table public.rfp_solution_sources drop constraint if exists rfp_solution_sources_kind_check;
alter table public.rfp_solution_sources add constraint rfp_solution_sources_kind_check check (kind in ('confluence','xlsx'));

-- 판정에 candidate(후보), 행의 출처 엔진과 규칙 점수
alter table public.rfp_requirement_mappings drop constraint if exists rfp_requirement_mappings_verdict_check;
alter table public.rfp_requirement_mappings add constraint rfp_requirement_mappings_verdict_check
  check (verdict in ('fulfilled','partial','candidate','build','na'));
alter table public.rfp_requirement_mappings add column if not exists engine text not null default 'manual';
alter table public.rfp_requirement_mappings add column if not exists score numeric;
-- 4단계 이전의 자동 행은 모두 Claude가 만든 것. 사람이 고친 행은 manual로 둔다.
update public.rfp_requirement_mappings set engine = 'llm' where edited = false and engine = 'manual';
alter table public.rfp_requirement_mappings drop constraint if exists rfp_requirement_mappings_engine_check;
alter table public.rfp_requirement_mappings add constraint rfp_requirement_mappings_engine_check check (engine in ('rules','llm','manual'));
```

- [ ] **Step 2: `mapping/types.ts` 전체를 아래로 교체**

```ts
import type { ChunkRequirement } from "./chunk";

/** 판정 5값. 서버·화면·xlsx가 모두 이 상수를 쓴다(4단계 스펙 §5.1). 좋은 판정이 앞. */
export const VERDICTS = ["fulfilled", "partial", "candidate", "build", "na"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_ORDER: readonly Verdict[] = VERDICTS;
export const VERDICT_LABEL: Record<Verdict, string> = {
  fulfilled: "충족",
  partial: "부분충족",
  candidate: "후보",
  build: "설계·구축영역",
  na: "해당없음",
};
export const UNMAPPED_LABEL = "미매핑";
/** Claude 출력 스키마가 허용하는 판정 — candidate는 규칙 엔진 전용이라 뺀다 */
export const LLM_VERDICTS = ["fulfilled", "partial", "build", "na"] as const;

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

/** 충족·부분충족·후보는 솔루션+기능 필수, 설계·구축영역·해당없음은 둘 다 null */
export function requiresFeature(v: Verdict): boolean {
  return v === "fulfilled" || v === "partial" || v === "candidate";
}

/** 매핑·가져오기를 실행하는 엔진. 기본 rules, llm은 ANTHROPIC_API_KEY가 있을 때만 */
export type EngineKind = "rules" | "llm";
export function isEngineKind(v: unknown): v is EngineKind {
  return v === "rules" || v === "llm";
}
/** 매핑 행을 만든 주체(rfp_requirement_mappings.engine) */
export type MappingEngineKind = EngineKind | "manual";
export const ENGINE_LABEL: Record<MappingEngineKind, string> = { rules: "규칙", llm: "Claude", manual: "수동" };

/** 엔진 출력 한 행. feature는 조회 키(llm은 "F3" 별칭, rules는 기능 id) — validateMappingOutput이 FeatureLookup으로 되돌린다 */
export interface EngineItem {
  reqId: string;
  verdict: Verdict;
  feature: string | null;
  rationale: string;
  /** 규칙 엔진 점수 0~1. llm은 없음 */
  score?: number;
}
export type FeatureLookup = Map<string, { featureId: string; solutionCode: string }>;
export type MappingEngine = (chunk: readonly ChunkRequirement[]) => Promise<EngineItem[]>;

/** running 상태가 이만큼 지나면 after()가 죽은 것으로 보고 재실행을 허용한다(1단계 extracting과 같은 6분). */
export const STALE_RUNNING_MS = 6 * 60 * 1000;

export interface CatalogFeature {
  id: string;
  solutionCode: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  isActive: boolean;
  /** 규칙 엔진 키워드(소문자 NFKC). 클라이언트 toCatalog는 빈 배열 */
  keywords: string[];
}

export interface CatalogSolution {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  /** 비활성 기능도 포함(매핑이 참조하는 이름을 그려야 함). 활성만 필요하면 호출 쪽에서 거른다. */
  features: CatalogFeature[];
}

/** 매핑 행(순수 함수 입력). API 응답 RfpMapping은 여기에 engine·score·updatedAt·updatedBy를 더한 것. */
export interface MappingRow {
  id: string;
  requirementId: string;
  solutionCode: string | null;
  featureId: string | null;
  verdict: Verdict;
  rationale: string;
  evidenceUrl: string | null;
  edited: boolean;
  sortOrder: number;
}
```

- [ ] **Step 3: `llm.ts` 스키마 enum을 `LLM_VERDICTS`로**

`import { VERDICTS } from "./types";` → `import { LLM_VERDICTS } from "./types";`, `verdict: z.enum(VERDICTS)` → `verdict: z.enum(LLM_VERDICTS)`. 나머지는 그대로.

- [ ] **Step 4: `validate.ts` 수동 검증 문구 4곳**

`validateManualMapping` 안에서만 바꾼다(`validateMappingOutput`의 경고 문구는 그대로):
- `"판정은 fulfilled·partial·build·na 중 하나입니다."` → `"판정은 fulfilled·partial·candidate·build·na 중 하나입니다."`
- `"충족·부분충족은 기능을 골라야 합니다."` → `"충족·부분충족·후보는 기능을 골라야 합니다."`
- `"설계·구축영역/해당없음 행이 있는 요구사항에는 충족·부분충족을 추가할 수 없습니다. 그 행을 먼저 지우거나 바꾸세요."` → `"설계·구축영역/해당없음 행이 있는 요구사항에는 충족·부분충족·후보를 추가할 수 없습니다. 그 행을 먼저 지우거나 바꾸세요."`
- `"설계·구축영역·해당없음은 충족·부분충족과 함께 둘 수 없습니다."` → `"설계·구축영역·해당없음은 충족·부분충족·후보와 함께 둘 수 없습니다."`

`grep -rn "충족·부분충족" frontend/src/lib/__tests__/rfp-mapping-validate.test.ts`로 옛 문구를 단언하는 테스트를 찾아 새 문구로 바꾼다.

- [ ] **Step 5: `summary.ts` — 후보 건수**

`countByVerdict`의 초기 객체를 `{ fulfilled: 0, partial: 0, candidate: 0, build: 0, na: 0, unmapped: 0 }`로. `SolutionCount`와 `countBySolution`을 아래로:

```ts
export interface SolutionCount {
  code: string;
  name: string;
  fulfilled: number;
  partial: number;
  candidate: number;
}

/** 솔루션별 충족/부분충족/후보 요구사항 수(요구사항 중복 제거: 그 솔루션 행들 중 가장 좋은 판정). 카탈로그 순서. */
export function countBySolution(rows: readonly MappingRow[], catalog: CatalogSolution[]): SolutionCount[] {
  return catalog.map((s) => {
    const perReq = new Map<string, Verdict>();
    for (const r of rows) {
      if (r.solutionCode !== s.code || !requiresFeature(r.verdict)) continue;
      const cur = perReq.get(r.requirementId);
      if (!cur || VERDICT_ORDER.indexOf(r.verdict) < VERDICT_ORDER.indexOf(cur)) perReq.set(r.requirementId, r.verdict);
    }
    let fulfilled = 0;
    let partial = 0;
    let candidate = 0;
    for (const v of perReq.values()) {
      if (v === "fulfilled") fulfilled += 1;
      else if (v === "partial") partial += 1;
      else candidate += 1;
    }
    return { code: s.code, name: s.name, fulfilled, partial, candidate };
  });
}
```

- [ ] **Step 6: `client-catalog.ts` — `keywords: []`**

`features: s.features.map((f) => ({ id: f.id, solutionCode: s.code, name: f.name, description: f.description, evidenceUrl: f.evidenceUrl, isActive: f.isActive, keywords: [] })),`

- [ ] **Step 7: `types/rfp.ts` 변경**

파일 첫 줄 import를 `import type { MappingEngineKind, MappingRow, Verdict } from "@/lib/rfp/mapping/types";`로 바꾸고:

```ts
export interface RfpMapping extends MappingRow {
  /** 행을 만든 주체. 사람이 고쳐도 바뀌지 않는다(edited로 표시) */
  engine: MappingEngineKind;
  /** 규칙 엔진 점수 0~1. llm·manual은 null */
  score: number | null;
  updatedAt: string;
  updatedBy: string | null;
}
```

`RfpCatalogResponse`에 `llmAvailable: boolean;` 추가(주석: `/** ANTHROPIC_API_KEY 존재 여부 — Claude 엔진 선택 가능 */`). `RfpAdminSolution` 아래에:

```ts
/** GET /api/admin/rfp-catalog/solutions */
export interface RfpAdminSolutionsResponse {
  solutions: RfpAdminSolution[];
  llmAvailable: boolean;
}
export type RfpSourceKind = "confluence" | "xlsx";
```

`RfpSolutionSource`에 `kind: RfpSourceKind;`와 `/** kind가 xlsx일 때 Graph driveId */ driveId: string | null;`을 `pageId` 뒤에 추가. `RfpAdminFeature`에 `keywords: string[];`을 `evidenceUrl` 뒤에 추가.

- [ ] **Step 8: `mappers.ts` — engine·score**

```ts
export const MAPPING_COLUMNS = "id, project_id, requirement_id, solution_code, feature_id, verdict, rationale, evidence_url, edited, sort_order, engine, score, updated_at, updated_by";
```
`MappingDbRow`에 `engine: MappingEngineKind; /** numeric → 문자열로 올 수 있다 */ score: number | string | null;` 추가(import에 `MappingEngineKind` 추가). `mapMapping`:
```ts
export function mapMapping(row: MappingDbRow): RfpMapping {
  return {
    id: row.id, requirementId: row.requirement_id, solutionCode: row.solution_code, featureId: row.feature_id, verdict: row.verdict,
    rationale: row.rationale, evidenceUrl: row.evidence_url, edited: row.edited, sortOrder: row.sort_order,
    engine: row.engine, score: row.score === null || row.score === undefined ? null : Number(row.score),
    updatedAt: row.updated_at, updatedBy: row.updated_by,
  };
}
```

- [ ] **Step 9: `catalog/store.ts` — kind·drive_id·keywords**

```ts
export const SOURCE_COLUMNS = "id, solution_code, kind, url, page_id, drive_id, title, page_version, import_status, imported_at, feature_count, error, note, created_at, updated_at";
export const FEATURE_COLUMNS = "id, solution_code, name, name_norm, description, keywords, evidence_url, source_id, is_active, edited, sort_order, updated_at";
```
`SourceDbRow`에 `kind: RfpSourceKind; drive_id: string | null;`(import 추가), `FeatureDbRow`에 `keywords: string[] | null;`. 매퍼:
- `mapFeature`: `..., isActive: row.is_active, keywords: row.keywords ?? [] }`
- `mapSource`: `{ id: row.id, kind: row.kind, url: row.url, pageId: row.page_id, driveId: row.drive_id, title: ..., ... }`
- `mapAdminFeature`: `evidenceUrl: row.evidence_url, keywords: row.keywords ?? [], sourceId: ...`

- [ ] **Step 10: `MappingSummary.tsx` — 후보 칩·솔루션별 후보**

`VERDICT_CLASS`에 `candidate: "bg-indigo-100 text-indigo-900 hover:bg-indigo-200",`를 `partial` 뒤에 추가. 솔루션별 표시를:
```tsx
const bySolution = countBySolution(mappings, catalog).filter((s) => s.fulfilled + s.partial + s.candidate > 0);
...
{bySolution.map((s) => (
  <span key={s.code}>
    <span className="font-medium text-foreground">{s.name}</span> 충족 {s.fulfilled} · 부분 {s.partial}{s.candidate > 0 && ` · 후보 ${s.candidate}`}
  </span>
))}
```

- [ ] **Step 11: `xlsx.ts` 개요 솔루션 줄**

`keyValueRow(ov, r++, s.name, \`충족 ${s.fulfilled}건 · 부분충족 ${s.partial}건\`)` → `` `충족 ${s.fulfilled}건 · 부분충족 ${s.partial}건 · 후보 ${s.candidate}건` ``.

- [ ] **Step 12: `api/rfp/catalog/route.ts` — llmAvailable**

`const res: RfpCatalogResponse = { llmAvailable: !!process.env.ANTHROPIC_API_KEY, solutions: ... }`.

- [ ] **Step 13: 테스트 픽스처·기대값 갱신**

1. `rfp-mapping-prompt.test.ts`, `rfp-mapping-summary.test.ts`, `rfp-mapping-validate.test.ts`, `rfp-xlsx.test.ts`의 모든 `CatalogFeature` 리터럴(`isActive: true/false` 뒤)에 `, keywords: []` 추가(총 12곳 안팎, `grep -n "evidenceUrl" <파일>`로 찾는다).
2. `rfp-mapping-summary.test.ts`: `countByVerdict` 기대값을 `{ fulfilled: 2, partial: 1, candidate: 0, build: 1, na: 1, unmapped: 1 }`로, `countBySolution` 기대값 두 객체에 `candidate: 0` 추가. 그리고 `describe("countBySolution")` 안에 케이스 추가:
```ts
  it("후보만 있는 요구사항은 candidate로 센다", () => {
    const withCandidate = [...rows, row("r7", "candidate", "f-iam", "secloudit"), row("r7", "candidate", "f-pipe", "devopsit", 1)];
    expect(countBySolution(withCandidate, catalog)[0]).toEqual({ code: "secloudit", name: "SECloudit", fulfilled: 1, partial: 2, candidate: 1 });
    expect(bestVerdict(groupByRequirement(withCandidate).get("r7")!)).toBe("candidate");
    expect(countByVerdict(["r7"], withCandidate)).toEqual({ fulfilled: 0, partial: 0, candidate: 1, build: 0, na: 0, unmapped: 0 });
    expect(mappingSummary(groupByRequirement(withCandidate).get("r7")!, index)).toBe("SECloudit·IAM(후보) / Devopsit·파이프라인(후보)");
  });
```
3. `rfp-xlsx.test.ts` "개요 시트" 케이스: 후보 줄이 끼어 아래 셀이 한 줄씩 밀린다. 기대값을 다음으로 바꾼다 — `B15` "후보"/`C15` "0건", `B16` "설계·구축영역"/`C16` "1건", `B18` "미매핑"/`C18` "1건", `B19` "SECloudit"/`C19` "충족 1건 · 부분충족 0건 · 후보 0건", `B20` "Devopsit"/`C20` "충족 0건 · 부분충족 1건 · 후보 0건"(`B13`·`B14`는 그대로). 그리고 같은 describe에 케이스 추가:
```ts
  it("후보 판정은 '후보'로 표시된다", async () => {
    const withCandidate = { ...mapping, rows: [...mappingRows, m("m4", "SER-002-uuid", "candidate", "f-pipe", "devopsit", 0)] };
    const wb = await loadWorkbook(await buildWorkbook(project, rows, withCandidate));
    expect(wb.getWorksheet("1.요구사항_목록")!.getRow(5).getCell(9).value).toBe("후보");
    expect(wb.getWorksheet("1.요구사항_목록")!.getRow(5).getCell(7).value).toBe("Devopsit·파이프라인(후보)");
    expect(wb.getWorksheet("0.개요")!.getCell("C15").value).toBe("1건");
    expect(wb.getWorksheet("0.개요")!.getCell("C20").value).toBe("충족 0건 · 부분충족 1건 · 후보 1건");
  });
```
4. `rfp-mapping-run.test.ts` `MappingOutputSchema` 케이스에 `expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "candidate", feature: "F1", rationale: "" }] }).success).toBe(false);` 추가.
5. `rfp-mapping-validate.test.ts` `validateManualMapping` describe에 케이스 추가(기존 catalog 픽스처 사용, `f-sso`):
```ts
  it("candidate는 partial과 같은 규칙: 기능 필수, build/na와 공존 불가", () => {
    expect(validateManualMapping({ verdict: "candidate", featureId: "f-sso" }, catalog, [])).toEqual({ ok: true, verdict: "candidate", solutionCode: "secloudit", featureId: "f-sso" });
    expect(validateManualMapping({ verdict: "candidate" }, catalog, [])).toEqual({ ok: false, error: "충족·부분충족·후보는 기능을 골라야 합니다." });
  });
```

- [ ] **Step 14: 타입·테스트 확인**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm test`
Expected: tsc 추가 오류 0건, 테스트 전부 통과(후보 케이스 포함).

- [ ] **Step 15: 커밋**

```bash
git add docs/sql/2026-09-06-rfp-rules-mapping.sql frontend/src
git commit -m "feat(rfp): 판정 candidate(후보)·엔진/점수·소스 종류·기능 키워드 — SQL·타입·매퍼·요약·xlsx 확장

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 2: 토큰화(`mapping/tokenize.ts`)와 키워드 시드(`catalog/keywords.ts`)

**Files:**
- Create: `frontend/src/lib/rfp/mapping/tokenize.ts`
- Create: `frontend/src/lib/rfp/catalog/keywords.ts`
- Test: `frontend/src/lib/__tests__/rfp-mapping-tokenize.test.ts`, `frontend/src/lib/__tests__/rfp-catalog-keywords.test.ts`

**Interfaces:**
- Produces: `normalizeText(s): string`, `stripJosa(t): string`, `tokenize(s): string[]`, `charBigrams(s): Set<string>`, `STOPWORDS: Set<string>`; `seedKeywords(name, description, extra?: string[]): string[]`, `parseKeywordInput(s): string[]`, `KEYWORDS_MAX = 20`, `KEYWORD_MAX_LEN = 30`, `DESCRIPTION_SEED_MAX = 10`.

- [ ] **Step 1: 실패하는 테스트 작성 — tokenize**

`frontend/src/lib/__tests__/rfp-mapping-tokenize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeText, stripJosa, tokenize, charBigrams, STOPWORDS } from "@/lib/rfp/mapping/tokenize";

describe("normalizeText / stripJosa", () => {
  it("NFKC·소문자·앞뒤 공백", () => {
    expect(normalizeText("  ＳＳＯ Login ")).toBe("sso login");
  });
  it("조사를 한 번 떼되 2자 미만이 남으면 그대로", () => {
    expect(stripJosa("사용자의")).toBe("사용자");
    expect(stripJosa("서버에서")).toBe("서버");
    expect(stripJosa("로그인으로")).toBe("로그인");
    expect(stripJosa("회의")).toBe("회의");
    expect(stripJosa("결과")).toBe("결과");
    expect(stripJosa("네트워크")).toBe("네트워크");
  });
});

describe("tokenize", () => {
  it("기호로 나누고 조사·불용어·2자 미만·중복을 없앤다", () => {
    expect(tokenize("사용자의 권한 관리 기능을 제공한다. SSO(통합 인증) 및 SSO")).toEqual(["사용자", "권한", "제공한다", "sso", "통합", "인증"]);
    expect(STOPWORDS.has("관리")).toBe(true);
    expect(tokenize("")).toEqual([]);
  });
  it("영문·숫자는 그대로, 한글·영문이 붙은 토큰은 나누지 않는다", () => {
    expect(tokenize("KVM기반 VM 2대")).toEqual(["kvm기반", "vm", "2대"]);
  });
});

describe("charBigrams", () => {
  it("공백·기호를 뺀 문자열의 인접 2자 집합", () => {
    expect([...charBigrams("멀티 테넌트")]).toEqual(["멀티", "티테", "테넌", "넌트"]);
    expect([...charBigrams("SSO 로그인")]).toEqual(["ss", "so", "o로", "로그", "그인"]);
    expect(charBigrams("a").size).toBe(0);
    expect(charBigrams("").size).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/rfp-mapping-tokenize.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `mapping/tokenize.ts` 작성**

```ts
/**
 * 규칙 엔진·키워드 시드 공용 토큰화(4단계 스펙 §5.2). 형태소 분석기 없이 정규식과 조사 제거 규칙만 쓴다.
 */

/** 매칭에 도움이 안 되는 일반어. 품질을 보고 코드에서 조정한다. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "기능", "제공", "지원", "관리", "시스템", "사용자", "정보", "및", "등", "있는", "통한", "위한", "대한", "경우", "처리", "가능", "서비스",
  "구성", "환경", "기반", "방식", "형태", "각종", "해당", "관련", "요구", "요구사항", "사업", "본", "사항", "내용", "수행", "필요", "이용", "활용",
  "the", "and", "or", "of", "for", "to", "in", "on", "with", "by",
]);

/** 한글(자모·음절)·라틴 문자·숫자 외 문자 */
const NON_WORD_RE = /[^\p{Script=Hangul}\p{Script=Latin}\p{N}]+/gu;
/** 긴 조사가 앞에 오도록 나열(정규식 대체는 앞에서부터 시도한다) */
const JOSA_RE = /(으로|에서|에게|부터|까지|의|을|를|이|가|은|는|에|로|와|과|도|만)$/u;

export function normalizeText(s: string): string {
  return s.normalize("NFKC").toLowerCase().trim();
}

/** 끝 조사를 한 번 뗀다. 뗀 뒤 2자 미만이면(회의→회, 결과→결) 원문을 돌려준다. */
export function stripJosa(t: string): string {
  const m = JOSA_RE.exec(t);
  if (!m) return t;
  const stem = t.slice(0, t.length - m[0].length);
  return stem.length >= 2 ? stem : t;
}

/** NFKC·소문자 → 기호를 공백으로 → 조사 제거 → 2자 미만·불용어·중복 제거(순서 유지) */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of normalizeText(s).replace(NON_WORD_RE, " ").split(" ")) {
    if (!raw) continue;
    const t = stripJosa(raw);
    if (t.length < 2 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 공백·기호를 뺀 문자열의 인접 2자 집합. 1자 이하면 빈 집합. */
export function charBigrams(s: string): Set<string> {
  const c = normalizeText(s).replace(NON_WORD_RE, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < c.length; i++) out.add(c.slice(i, i + 2));
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-mapping-tokenize.test.ts`
Expected: PASS. (`\p{Script=Hangul}`은 Node 20+ 정규식 `u` 플래그에서 지원된다.)

- [ ] **Step 5: 실패하는 테스트 작성 — keywords**

`frontend/src/lib/__tests__/rfp-catalog-keywords.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { seedKeywords, parseKeywordInput, KEYWORDS_MAX, KEYWORD_MAX_LEN, DESCRIPTION_SEED_MAX } from "@/lib/rfp/catalog/keywords";

describe("seedKeywords", () => {
  it("이름 토큰 전부 → 설명 토큰 앞 10개(중복 제외) → extra, 순서 유지", () => {
    expect(seedKeywords("SSO 로그인", "통합 인증으로 한 번 로그인", ["SSO", "Single Sign-On"])).toEqual(["sso", "로그인", "통합", "인증", "single sign-on"]);
  });
  it("설명 토큰은 10개까지, 전체 20개 상한, 30자 초과 항목 제거", () => {
    const desc = Array.from({ length: 15 }, (_, i) => `단어${String(i).padStart(2, "0")}`).join(" ");
    const seeded = seedKeywords("이름", desc);
    expect(seeded).toHaveLength(1 + DESCRIPTION_SEED_MAX);
    const extra = Array.from({ length: 30 }, (_, i) => `추가${i}`);
    expect(seedKeywords("이름", desc, extra)).toHaveLength(KEYWORDS_MAX);
    expect(seedKeywords("이름", "", ["가".repeat(KEYWORD_MAX_LEN + 1)])).toEqual(["이름"]);
  });
  it("이름·설명이 불용어만이면 빈 배열", () => {
    expect(seedKeywords("기능 관리", "제공 및 지원")).toEqual([]);
  });
});

describe("parseKeywordInput", () => {
  it("쉼표·전각 쉼표·줄바꿈으로 나누고 정규화·중복 제거", () => {
    expect(parseKeywordInput("SSO, 로그인、통합 인증\nsso ,  x , 가")).toEqual(["sso", "로그인", "통합 인증"]);
  });
  it("20개 상한", () => {
    expect(parseKeywordInput(Array.from({ length: 25 }, (_, i) => `k${i}`).join(","))).toHaveLength(KEYWORDS_MAX);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-keywords.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 7: `catalog/keywords.ts` 작성**

```ts
import { normalizeText, tokenize } from "../mapping/tokenize";

/** 기능 하나의 키워드 개수 상한 */
export const KEYWORDS_MAX = 20;
/** 키워드 한 항목 길이 상한 */
export const KEYWORD_MAX_LEN = 30;
/** 시드에 넣는 설명 토큰 수 */
export const DESCRIPTION_SEED_MAX = 10;

function accept(k: string): boolean {
  return k.length >= 2 && k.length <= KEYWORD_MAX_LEN;
}

/**
 * 키워드 시드(스펙 §4.4): 이름 토큰 전부 + 설명 토큰 앞 10개(이름 토큰과 중복 제외) + extra(정규화) → 순서 유지 중복 제거 → 20개.
 * extra는 xlsx "키워드" 열처럼 이미 사람이 고른 값이라 토큰화하지 않고 정규화만 한다("single sign-on"처럼 공백을 품을 수 있다).
 */
export function seedKeywords(name: string, description: string, extra: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string): boolean => {
    if (!accept(k) || seen.has(k)) return false;
    seen.add(k);
    out.push(k);
    return true;
  };
  for (const t of tokenize(name)) push(t);
  let n = 0;
  for (const t of tokenize(description)) {
    if (n >= DESCRIPTION_SEED_MAX) break;
    if (push(t)) n += 1;
  }
  for (const e of extra) push(normalizeText(e));
  return out.slice(0, KEYWORDS_MAX);
}

/** 어드민 입력(쉼표·전각 쉼표·줄바꿈 구분) → 정규화·2~30자·중복 제거·20개 */
export function parseKeywordInput(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of s.split(/[,、\n]/)) {
    const k = normalizeText(part);
    if (!accept(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= KEYWORDS_MAX) break;
  }
  return out;
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-keywords.test.ts src/lib/__tests__/rfp-mapping-tokenize.test.ts`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/tokenize.ts frontend/src/lib/rfp/catalog/keywords.ts frontend/src/lib/__tests__/rfp-mapping-tokenize.test.ts frontend/src/lib/__tests__/rfp-catalog-keywords.test.ts
git commit -m "feat(rfp): 토큰화(NFKC·조사 제거·불용어·문자 bigram)와 기능 키워드 시드·입력 파서

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 3: `storageToText` 제목 수준 보존 + Confluence 규칙 파서(`catalog/extract-rules.ts`)

**Files:**
- Modify: `frontend/src/lib/rfp/catalog/storage-text.ts` (제목 치환 1줄)
- Create: `frontend/src/lib/rfp/catalog/extract-rules.ts`
- Test: `frontend/src/lib/__tests__/rfp-catalog-storage-text.test.ts`(기대값 갱신), `frontend/src/lib/__tests__/rfp-catalog-extract-rules.test.ts`

**Interfaces:**
- Consumes: `dedupeIncoming`, `IncomingFeature`(`catalog/merge-features.ts`).
- Produces: `isCodeOnly(s): boolean`, `RULES_NAME_MAX = 60`, `HEADING_NAME_MAX = 40`, `HEADING_DESC_MAX = 300`, `interface RulesExtractResult { features: IncomingFeature[]; warnings: string[]; stats: { tables: number; headings: number; bullets: number } }`, `extractFeaturesByRules(text): RulesExtractResult`, `rulesNote(r): string`. `storageToText`는 `<h2>`를 `## `로 낸다.

- [ ] **Step 1: storage-text 테스트 기대값 갱신 + 수준 케이스**

`rfp-catalog-storage-text.test.ts`의 "목록은 '- ', 제목은 '# '…" 케이스 기대값을 `"## 주요 기능\n소개\n- A\n- B"`로 바꾸고 케이스 이름을 `"목록은 '- ', 제목은 수준만큼 '#', 문단은 줄바꿈"`으로. 바로 아래 케이스 추가:
```ts
  it("제목 수준을 # 개수로 보존한다(h1~h6)", () => {
    expect(storageToText(`<h1>A</h1><h3 class="x">B</h3><h6>C</h6>`)).toBe("# A\n### B\n###### C");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-storage-text.test.ts`
Expected: FAIL 2건(`# 주요 기능` vs `## 주요 기능`).

- [ ] **Step 3: `storage-text.ts` 제목 치환 변경**

`s = s.replace(/<h[1-6]\b[^>]*>/gi, "\n# ").replace(/<\/h[1-6]>/gi, "\n");` →
```ts
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n${"#".repeat(Number(level))} `).replace(/<\/h[1-6]>/gi, "\n");
```
파일 상단 주석의 `제목은 "# "` 표현도 `제목은 수준만큼 "#"`으로 고친다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-storage-text.test.ts`
Expected: PASS.

- [ ] **Step 5: 실패하는 테스트 작성 — extract-rules**

`frontend/src/lib/__tests__/rfp-catalog-extract-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractFeaturesByRules, isCodeOnly, rulesNote, HEADING_DESC_MAX } from "@/lib/rfp/catalog/extract-rules";

describe("isCodeOnly", () => {
  it("코드·번호만인 문자열", () => {
    for (const s of ["SEC-001", "F01", "1.2.3", "3", "A-1_2", "SEC_AUTH_01", "DEV-01-02"]) expect(isCodeOnly(s)).toBe(true);
  });
  it("숫자 없는 약어·일반 이름은 코드가 아니다", () => {
    for (const s of ["IAM", "SSO", "SSO 로그인", "API 게이트웨이", "S3 연동", "iam"]) expect(isCodeOnly(s)).toBe(false);
  });
});

describe("extractFeaturesByRules — 표", () => {
  it("헤더에서 기능명 열을 찾고 코드 행·반복 헤더·빈 이름을 건너뛰며 나머지 셀을 ' · '로 잇는다(코드 셀 제외)", () => {
    const text = [
      "| 대분류 | 기능명 | 코드 | 설명 |",
      "| 계정 | SSO 로그인 | SEC-001 | 통합 인증 |",
      "| 계정 | SEC-002 | SEC-002 | 코드만 있는 행 |",
      "| 대분류 | 기능명 | 코드 | 설명 |",
      "|  | 감사 로그 | SEC-003 |  |",
      "| 계정 |  | SEC-004 | 이름 없음 |",
    ].join("\n");
    const r = extractFeaturesByRules(text);
    expect(r.features).toEqual([
      { name: "SSO 로그인", description: "계정 · 통합 인증" },
      { name: "감사 로그", description: "" },
    ]);
    expect(r.stats).toEqual({ tables: 1, headings: 0, bullets: 0 });
    expect(r.warnings).toEqual([]);
    expect(rulesNote(r)).toBe("규칙 추출: 표 1·제목 0·글머리 0 → 기능 2개");
  });
  it("헤더 키워드가 없으면 0열, 0열이 번호면 1열. '기능 설명' 같은 설명 헤더는 이름 열로 잡지 않는다", () => {
    expect(extractFeaturesByRules("| 항목 | 비고 |\n| 백업 | 일 1회 |").features).toEqual([{ name: "백업", description: "일 1회" }]);
    expect(extractFeaturesByRules("| No | 항목 | 비고 |\n| 1 | 백업 | 일 1회 |").features).toEqual([{ name: "백업", description: "일 1회" }]);
    expect(extractFeaturesByRules("| 구분 | 기능 설명 | 기능명 |\n| 보안 | 통합 인증 제공 | SSO |").features).toEqual([{ name: "SSO", description: "보안 · 통합 인증 제공" }]);
  });
  it("1열 표는 이름만, 60자 초과 이름은 문장으로 보고 건너뛴다", () => {
    const long = "가".repeat(61);
    expect(extractFeaturesByRules(`| 기능 |\n| 백업 |\n| ${long} |`).features).toEqual([{ name: "백업", description: "" }]);
  });
});

describe("extractFeaturesByRules — 제목·글머리", () => {
  it("h2~h4만 기능으로 받고 번호 접두를 떼며 다음 제목·표 전까지의 줄을 설명으로 잇는다", () => {
    const text = [
      "# 문서 제목",
      "## 1.1 멀티테넌트 IAM",
      "테넌트별 계정·권한 관리",
      "- 역할 기반 접근 제어",
      "### 2) 감사 로그",
      "##### 세부 항목",
      "무시되는 h5 아래 문장",
      "## 개요",
      "설명은 기능이 아님",
      "## " + "가".repeat(41),
    ].join("\n");
    const r = extractFeaturesByRules(text);
    expect(r.features).toEqual([
      { name: "멀티테넌트 IAM", description: "테넌트별 계정·권한 관리 역할 기반 접근 제어" },
      { name: "감사 로그", description: "" },
    ]);
    expect(r.stats.headings).toBe(2);
  });
  it("제목 설명은 300자에서 자른다", () => {
    const r = extractFeaturesByRules(`## 기능A\n${"설".repeat(400)}`);
    expect(r.features[0].description).toHaveLength(HEADING_DESC_MAX);
  });
  it("글머리표 '이름: 설명'·'이름 — 설명'을 받고 날짜·URL·담당자는 버린다", () => {
    const text = [
      "- 파이프라인 템플릿: CI/CD 파이프라인을 템플릿으로 생성",
      "- 알림 연동 — Slack·Teams 웹후크",
      "- 담당자: 홍길동",
      "- 배포일: 2026-09-01 예정",
      "- 참고 링크: https://example.com/x",
      "- 설명 없는 항목",
      "- SEC-010: 코드 이름",
    ].join("\n");
    const r = extractFeaturesByRules(text);
    expect(r.features).toEqual([
      { name: "파이프라인 템플릿", description: "CI/CD 파이프라인을 템플릿으로 생성" },
      { name: "알림 연동", description: "Slack·Teams 웹후크" },
    ]);
    expect(r.stats.bullets).toBe(2);
  });
  it("같은 이름은 dedupeIncoming으로 합치고(긴 설명 우선), 빈 문서는 경고", () => {
    const r = extractFeaturesByRules("## SSO\n짧음\n| 기능 | 설명 |\n| SSO | 통합 인증을 제공하는 기능 |");
    expect(r.features).toEqual([{ name: "SSO", description: "통합 인증을 제공하는 기능" }]);
    const empty = extractFeaturesByRules("");
    expect(empty.features).toEqual([]);
    expect(empty.warnings).toEqual(["문서에서 기능을 찾지 못했습니다."]);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-extract-rules.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 7: `catalog/extract-rules.ts` 작성**

```ts
import { dedupeIncoming, type IncomingFeature } from "./merge-features";

/**
 * Confluence 본문 규칙 파서(4단계 스펙 §4.2). 입력은 storageToText 결과 텍스트:
 * 표 행 "| a | b |", 제목 "## 이름"(수준만큼 #), 글머리 "- 항목". 기능 후보를 문서 순서로 모아 dedupeIncoming으로 합친다.
 */

/** 표·글머리 이름이 이보다 길면 문장으로 본다 */
export const RULES_NAME_MAX = 60;
/** 제목을 기능으로 받는 최대 길이 */
export const HEADING_NAME_MAX = 40;
/** 제목 아래 설명 최대 길이 */
export const HEADING_DESC_MAX = 300;

const CODE_ONLY_RE = /^[A-Za-z]{0,4}[-_.]?\d{1,4}([-_.]\d{1,4})*$/;
/** 숫자를 포함한 대문자 코드(SEC_AUTH_01). IAM·SSO처럼 숫자 없는 약어는 기능 이름으로 남긴다 */
const UPPER_CODE_RE = /^[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*$/;
const NAME_HEADER_EXACT = new Set(["기능명", "기능명칭", "기능", "메뉴명", "메뉴", "국문명", "이름", "명칭", "feature", "featurename", "name"]);
const NAME_HEADER_LOOSE_RE = /기능|메뉴|feature|name/i;
const DESC_HEADER_RE = /설명|내용|상세|description|detail/i;
const INDEX_HEADER_RE = /^(no\.?|번호|순번|연번|#)$/i;
const TABLE_LINE_RE = /^\|.*\|$/;
const HEADING_RE = /^(#{2,4}) (.+)$/;
const ANY_HEADING_RE = /^#{1,6} /;
const HEADING_NUMBER_RE = /^\d+(\.\d+)*[.)]?\s+/;
const SKIP_HEADING_RE = /^(개요|목차|목적|배경|범위|참고|참고\s*자료|이력|변경\s*이력|문서\s*정보|담당자|일정|회의|참석자|안건|결론|기타|비고|요약|서론|history|overview|agenda|reference|summary|toc)/i;
const BULLET_RE = /^- (.+)$/;
const BULLET_SPLIT_RE = /^(.{2,40}?)\s*(?::|：|—|–| - )\s+(.+)$/;
const DATE_RE = /\d{4}[.\-/]\d{1,2}/;
const URL_RE = /https?:\/\//i;
const BULLET_SKIP_NAME_RE = /담당|일정|참석|회의|작성|검토자?|승인/;

export function isCodeOnly(s: string): boolean {
  const t = s.trim();
  return CODE_ONLY_RE.test(t) || UPPER_CODE_RE.test(t);
}

export interface RulesExtractResult {
  features: IncomingFeature[];
  warnings: string[];
  stats: { tables: number; headings: number; bullets: number };
}

function splitCells(line: string): string[] {
  return line.slice(1, -1).split(" | ").map((c) => c.trim());
}

function pickNameColumn(header: string[]): number {
  const compact = header.map((h) => h.replace(/\s+/g, "").toLowerCase());
  const exact = compact.findIndex((h) => NAME_HEADER_EXACT.has(h));
  if (exact >= 0) return exact;
  const loose = header.findIndex((h) => NAME_HEADER_LOOSE_RE.test(h) && !DESC_HEADER_RE.test(h));
  if (loose >= 0) return loose;
  return header.length > 1 && INDEX_HEADER_RE.test(header[0]) ? 1 : 0;
}

/** 첫 행을 헤더로 보고 이름 열을 고른다. 이름 셀이 비었거나 코드만이거나 60자 초과이거나 헤더 반복이면 건너뛴다. */
function parseTable(rows: string[][]): IncomingFeature[] {
  if (rows.length < 2) return [];
  const header = rows[0];
  const nameCol = pickNameColumn(header);
  const headerName = header[nameCol] ?? "";
  const out: IncomingFeature[] = [];
  for (const cells of rows.slice(1)) {
    const name = (cells[nameCol] ?? "").trim();
    if (!name || name === headerName || name.length > RULES_NAME_MAX || isCodeOnly(name)) continue;
    const description = cells.filter((c, i) => i !== nameCol && c && !isCodeOnly(c)).join(" · ");
    out.push({ name, description });
  }
  return out;
}

export function extractFeaturesByRules(text: string): RulesExtractResult {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const found: IncomingFeature[] = [];
  const stats = { tables: 0, headings: 0, bullets: 0 };
  let heading: { name: string; desc: string[] } | null = null;
  const flushHeading = () => {
    if (!heading) return;
    found.push({ name: heading.name, description: heading.desc.join(" ").slice(0, HEADING_DESC_MAX) });
    stats.headings += 1;
    heading = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (TABLE_LINE_RE.test(line)) {
      flushHeading();
      const rows: string[][] = [];
      while (i < lines.length && TABLE_LINE_RE.test(lines[i])) {
        rows.push(splitCells(lines[i]));
        i += 1;
      }
      stats.tables += 1;
      found.push(...parseTable(rows));
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      flushHeading();
      const name = h[2].replace(HEADING_NUMBER_RE, "").trim();
      if (name && name.length <= HEADING_NAME_MAX && !SKIP_HEADING_RE.test(name)) heading = { name, desc: [] };
      i += 1;
      continue;
    }
    if (ANY_HEADING_RE.test(line)) {
      // h1·h5·h6: 기능으로 받지 않고 설명 수집만 끊는다
      flushHeading();
      i += 1;
      continue;
    }
    const b = BULLET_RE.exec(line);
    if (b) {
      const body = b[1].trim();
      if (heading) heading.desc.push(body);
      const m = BULLET_SPLIT_RE.exec(body);
      if (m) {
        const name = m[1].trim();
        const description = m[2].trim();
        if (!DATE_RE.test(body) && !URL_RE.test(body) && !BULLET_SKIP_NAME_RE.test(name) && !isCodeOnly(name)) {
          found.push({ name, description });
          stats.bullets += 1;
        }
      }
      i += 1;
      continue;
    }
    if (heading) heading.desc.push(line);
    i += 1;
  }
  flushHeading();

  const features = dedupeIncoming(found);
  const warnings = features.length ? [] : ["문서에서 기능을 찾지 못했습니다."];
  return { features, warnings, stats };
}

/** 소스 행 note에 남기는 요약 */
export function rulesNote(r: RulesExtractResult): string {
  return `규칙 추출: 표 ${r.stats.tables}·제목 ${r.stats.headings}·글머리 ${r.stats.bullets} → 기능 ${r.features.length}개`;
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-extract-rules.test.ts src/lib/__tests__/rfp-catalog-storage-text.test.ts`
Expected: PASS. 실패하면 정규식이 아니라 픽스처 해석을 먼저 의심하지 말고, 기대값은 계획대로 두고 구현을 고친다(예: `- 배포일: 2026-09-01 예정`은 `DATE_RE`가 body 전체를 봐서 걸러진다).

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/storage-text.ts frontend/src/lib/rfp/catalog/extract-rules.ts frontend/src/lib/__tests__/rfp-catalog-storage-text.test.ts frontend/src/lib/__tests__/rfp-catalog-extract-rules.test.ts
git commit -m "feat(rfp): Confluence 규칙 파서 — 표(기능명 열 탐지)·h2~h4 제목·글머리 '이름: 설명'에서 기능 추출, storageToText 제목 수준 보존

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 4: `IncomingFeature.keywords` + SharePoint xlsx 파서(`catalog/xlsx-features.ts`)

**Files:**
- Modify: `frontend/src/lib/rfp/catalog/merge-features.ts` (`IncomingFeature`, `dedupeIncoming`)
- Create: `frontend/src/lib/rfp/catalog/xlsx-features.ts`
- Test: `frontend/src/lib/__tests__/rfp-catalog-xlsx-features.test.ts`, `frontend/src/lib/__tests__/rfp-catalog-merge.test.ts`(dedupe 케이스 추가)

**Interfaces:**
- Consumes: `isCodeOnly`, `RULES_NAME_MAX`(T3).
- Produces: `IncomingFeature { name; description; keywords?: string[] }`(dedupe는 같은 이름의 keywords를 합친다); `interface XlsxParseResult { features: IncomingFeature[]; warnings: string[]; sheets: number }`, `parseXlsxFeatures(buffer: Buffer): Promise<XlsxParseResult>`, `xlsxNote(r): string`, `XLSX_HEADER_SCAN_ROWS = 10`.

- [ ] **Step 1: merge 테스트에 dedupe 키워드 케이스 추가**

`rfp-catalog-merge.test.ts`의 `describe("dedupeIncoming")` 안에:
```ts
  it("같은 이름의 keywords는 합치고 없으면 필드를 두지 않는다", () => {
    const out = dedupeIncoming([
      { name: "SSO", description: "a", keywords: ["sso"] },
      { name: "sso", description: "더 긴 설명", keywords: ["통합인증", "sso"] },
      { name: "백업", description: "b" },
    ]);
    expect(out[0]).toEqual({ name: "SSO", description: "더 긴 설명", keywords: ["sso", "통합인증"] });
    expect(out[1]).toEqual({ name: "백업", description: "b" });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-merge.test.ts`
Expected: FAIL(keywords 누락).

- [ ] **Step 3: `merge-features.ts` — `IncomingFeature.keywords`와 dedupe 병합**

```ts
export interface IncomingFeature {
  name: string;
  description: string;
  /** 소스가 직접 준 키워드(xlsx "키워드" 열). 시드에 extra로 들어간다 */
  keywords?: string[];
}
```
`dedupeIncoming`을 아래로 교체(`clean`은 그대로):
```ts
/** 청크·소스별 결과 합치기: 같은 이름(정규화)은 설명이 긴 것을 남기고 keywords는 합친다. 순서는 처음 등장한 순서. */
export function dedupeIncoming(features: IncomingFeature[]): IncomingFeature[] {
  const byNorm = new Map<string, { name: string; description: string; keywords: string[] }>();
  for (const raw of features) {
    const f = clean(raw);
    if (!f) continue;
    const cur = byNorm.get(f.nameNorm);
    if (!cur) byNorm.set(f.nameNorm, { name: f.name, description: f.description, keywords: [...(raw.keywords ?? [])] });
    else {
      if (f.description.length > cur.description.length) cur.description = f.description;
      for (const k of raw.keywords ?? []) if (!cur.keywords.includes(k)) cur.keywords.push(k);
    }
  }
  return [...byNorm.values()].map((v) => (v.keywords.length ? { name: v.name, description: v.description, keywords: v.keywords } : { name: v.name, description: v.description }));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-merge.test.ts src/lib/__tests__/rfp-catalog-extract-rules.test.ts`
Expected: PASS(기존 dedupe 케이스의 `toEqual`도 keywords 필드가 없어 그대로 통과).

- [ ] **Step 5: 실패하는 테스트 작성 — xlsx 파서**

`frontend/src/lib/__tests__/rfp-catalog-xlsx-features.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseXlsxFeatures, xlsxNote, XLSX_HEADER_SCAN_ROWS } from "@/lib/rfp/catalog/xlsx-features";

/** exceljs writeBuffer는 exceljs 자체 Buffer 타입을 돌려준다 — Node Buffer로 감싸 넘긴다 */
async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function workbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("기능목록");
  ws.getRow(1).values = ["DevOpsit v1.7 기능명세서"];
  ws.getRow(3).values = ["No", "기능명", "설명", "키워드", "비고"];
  ws.getRow(4).values = [1, "파이프라인 템플릿", "CI/CD 파이프라인을 템플릿으로 생성", "파이프라인, 템플릿", "v1.5"];
  ws.getRow(5).values = [2, "DEV-002", "코드만 있는 행", "", ""];
  ws.getRow(6).values = [3, "기능명", "반복 헤더", "", ""];
  ws.getRow(7).values = [4, { richText: [{ text: "알림 " }, { text: "연동" }] }, "Slack·Teams", "", ""];
  ws.getRow(8).values = [5, "", "이름 없음", "", ""];
  const memo = wb.addWorksheet("메모");
  memo.getRow(1).values = ["회의록", "2026-09-01"];
  return wb;
}

describe("parseXlsxFeatures", () => {
  it("앞 10행에서 헤더를 찾아 이름·설명·키워드 열을 읽고 코드·반복 헤더·빈 이름을 건너뛴다. 헤더 없는 시트는 경고", async () => {
    const r = await parseXlsxFeatures(await toBuffer(workbook()));
    expect(r.features).toEqual([
      { name: "파이프라인 템플릿", description: "CI/CD 파이프라인을 템플릿으로 생성", keywords: ["파이프라인", "템플릿"] },
      { name: "알림 연동", description: "Slack·Teams" },
    ]);
    expect(r.sheets).toBe(1);
    expect(r.warnings).toEqual(["시트 메모: 기능 열을 찾지 못했습니다."]);
    expect(xlsxNote(r)).toBe("xlsx: 시트 1개 → 기능 2개");
    expect(XLSX_HEADER_SCAN_ROWS).toBe(10);
  });
  it("설명 열이 없으면 이름·키워드 열을 뺀 텍스트 셀을 ' · '로 잇는다(코드 셀 제외)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getRow(1).values = ["구분", "Feature", "코드", "버전"];
    ws.getRow(2).values = ["보안", "SSO", "SEC-001", "v2.6"];
    const r = await parseXlsxFeatures(await toBuffer(wb));
    expect(r.features).toEqual([{ name: "SSO", description: "보안 · v2.6" }]);
  });
  it("기능이 하나도 없으면 경고", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("빈 시트");
    const r = await parseXlsxFeatures(await toBuffer(wb));
    expect(r.features).toEqual([]);
    expect(r.sheets).toBe(0);
    expect(r.warnings).toEqual(["시트 빈 시트: 기능 열을 찾지 못했습니다.", "파일에서 기능을 찾지 못했습니다."]);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-xlsx-features.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 7: `catalog/xlsx-features.ts` 작성**

```ts
import ExcelJS from "exceljs";
import { isCodeOnly, RULES_NAME_MAX } from "./extract-rules";
import type { IncomingFeature } from "./merge-features";

/**
 * SharePoint xlsx 기능명세서 파서(4단계 스펙 §4.3). 시트마다 앞 10행에서 "기능명/기능/메뉴/Feature/Name" 헤더를 찾고
 * 설명 열(설명/내용/상세/Description/Detail)·키워드 열(키워드/Keyword)을 고른다. 헤더가 없는 시트는 건너뛴다.
 */
export const XLSX_HEADER_SCAN_ROWS = 10;
const NAME_HEADER_RE = /^(기능명?|기능명칭|메뉴명?|feature(name)?|name)$/i;
const DESC_HEADER_RE = /설명|내용|상세|description|detail/i;
const KEYWORD_HEADER_RE = /키워드|keyword/i;

export interface XlsxParseResult {
  features: IncomingFeature[];
  warnings: string[];
  /** 기능 열을 찾아 읽은 시트 수 */
  sheets: number;
}

function cellText(cell: ExcelJS.Cell): string {
  return String(cell.text ?? "").replace(/\s+/g, " ").trim();
}

export async function parseXlsxFeatures(buffer: Buffer): Promise<XlsxParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs load는 자체 Buffer 타입(ArrayBuffer 확장)을 받는다. 정확한 길이의 새 ArrayBuffer로 복사해 넘긴다(rfp-xlsx.test.ts와 같은 이유).
  await wb.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer);
  const features: IncomingFeature[] = [];
  const warnings: string[] = [];
  let sheets = 0;

  for (const ws of wb.worksheets) {
    let headerRow = -1;
    let nameCol = -1;
    const scanTo = Math.min(ws.rowCount, XLSX_HEADER_SCAN_ROWS);
    for (let r = 1; r <= scanTo && headerRow < 0; r++) {
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        if (nameCol < 0 && NAME_HEADER_RE.test(cellText(cell).replace(/\s+/g, ""))) {
          nameCol = col;
          headerRow = r;
        }
      });
    }
    if (headerRow < 0) {
      warnings.push(`시트 ${ws.name}: 기능 열을 찾지 못했습니다.`);
      continue;
    }
    sheets += 1;
    const header = ws.getRow(headerRow);
    let descCol = -1;
    let kwCol = -1;
    header.eachCell({ includeEmpty: false }, (cell, col) => {
      if (col === nameCol) return;
      const t = cellText(cell);
      if (descCol < 0 && DESC_HEADER_RE.test(t)) descCol = col;
      if (kwCol < 0 && KEYWORD_HEADER_RE.test(t)) kwCol = col;
    });
    const headerName = cellText(header.getCell(nameCol));

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = cellText(row.getCell(nameCol));
      if (!name || name === headerName || name.length > RULES_NAME_MAX || isCodeOnly(name)) continue;
      let description = "";
      if (descCol > 0) description = cellText(row.getCell(descCol));
      else {
        const parts: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell, col) => {
          if (col === nameCol || col === kwCol) return;
          const t = cellText(cell);
          if (t && !isCodeOnly(t)) parts.push(t);
        });
        description = parts.join(" · ");
      }
      const keywords = kwCol > 0 ? cellText(row.getCell(kwCol)).split(/[,、\n]/).map((s) => s.trim()).filter(Boolean) : [];
      features.push(keywords.length ? { name, description, keywords } : { name, description });
    }
  }
  if (!features.length) warnings.push("파일에서 기능을 찾지 못했습니다.");
  return { features, warnings, sheets };
}

/** 소스 행 note에 남기는 요약 */
export function xlsxNote(r: XlsxParseResult): string {
  return `xlsx: 시트 ${r.sheets}개 → 기능 ${r.features.length}개`;
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-xlsx-features.test.ts`
Expected: PASS. 두 번째 케이스에서 "SEC-001"은 `isCodeOnly`로, 숫자 1은 `cellText` → "1" → `isCodeOnly` 참으로 설명에서 빠진다.

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/merge-features.ts frontend/src/lib/rfp/catalog/xlsx-features.ts frontend/src/lib/__tests__/rfp-catalog-xlsx-features.test.ts frontend/src/lib/__tests__/rfp-catalog-merge.test.ts
git commit -m "feat(rfp): SharePoint xlsx 기능명세서 파서(헤더 탐지·설명/키워드 열) + IncomingFeature.keywords 병합

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 5: Graph 파일 링크 해석·내려받기(`lib/ms/graph-drive.ts`)

**Files:**
- Modify: `frontend/src/lib/ms/graph-drive.ts` (`resolveFolder` 아래에 추가)
- Test: `frontend/src/lib/__tests__/ms-graph-drive.test.ts`(describe 2개 추가)

**Interfaces:**
- Produces: `XLSX_SOURCE_MAX_BYTES = 20 * 1024 * 1024`, `interface ResolvedItem { driveId; itemId; name; size: number; webUrl }`, `resolveItem(token, url, fetchImpl?, sleep?): Promise<ResolvedItem>`(폴더·xlsx 아님·크기 초과·해석 불가는 `FolderResolveError`), `downloadFile(token, driveId, itemId, fetchImpl?, sleep?): Promise<Buffer>`.

- [ ] **Step 1: 실패하는 테스트 작성**

`ms-graph-drive.test.ts` import에 `resolveItem, downloadFile, XLSX_SOURCE_MAX_BYTES`를 추가하고 파일 끝에:

```ts
describe("resolveItem", () => {
  const FILE_URL = "https://innogridoffice.sharepoint.com/:x:/s/PQS/IQCEW08r2rYbTp7-FfwLawrNAdLYSOaZ1qsMG4v-fHsKDvg";
  const fileItem = { id: "01FILE", name: "DevOpsit_기능명세서_v1.7.xlsx", size: 52340, webUrl: "https://innogridoffice.sharepoint.com/sites/PQS/x.xlsx", file: { mimeType: XLSX_MIME }, parentReference: { driveId: "b!drive" } };
  it("shares/{enc}/driveItem을 조회해 driveId·itemId·name·size·webUrl", async () => {
    const fetchImpl = vi.fn(async () => json(200, fileItem));
    expect(await resolveItem("AT", FILE_URL, fetchImpl, noSleep)).toEqual({ driveId: "b!drive", itemId: "01FILE", name: fileItem.name, size: 52340, webUrl: fileItem.webUrl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(FILE_URL)}/driveItem?$select=id,name,size,file,folder,webUrl,parentReference`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });
  it("폴더·xlsx 아님·20MiB 초과는 FolderResolveError 400", async () => {
    await expect(resolveItem("AT", FILE_URL, vi.fn(async () => json(200, { ...fileItem, folder: { childCount: 1 } })), noSleep)).rejects.toMatchObject({ status: 400, message: "폴더 링크입니다. xlsx 파일 링크를 붙여 주세요." });
    await expect(resolveItem("AT", FILE_URL, vi.fn(async () => json(200, { ...fileItem, name: "a.docx", file: { mimeType: "application/msword" } })), noSleep)).rejects.toMatchObject({ status: 400, message: "xlsx 파일만 등록할 수 있습니다." });
    await expect(resolveItem("AT", FILE_URL, vi.fn(async () => json(200, { ...fileItem, size: XLSX_SOURCE_MAX_BYTES + 1 })), noSleep)).rejects.toMatchObject({ status: 400, message: "파일이 너무 큽니다(20MB 이하)." });
  });
  it("확장자가 xlsx면 mimeType이 달라도 받는다", async () => {
    const r = await resolveItem("AT", FILE_URL, vi.fn(async () => json(200, { ...fileItem, file: { mimeType: "application/octet-stream" } })), noSleep);
    expect(r.itemId).toBe("01FILE");
  });
  it("404·400은 해석 불가 400, 403은 권한 403, 5xx는 GraphError", async () => {
    const mk = (status: number) => vi.fn(async () => json(status, { error: { code: "x", message: "y" } }));
    await expect(resolveItem("AT", FILE_URL, mk(404), noSleep)).rejects.toMatchObject({ status: 400, message: "링크를 해석할 수 없습니다. 파일의 '링크 복사'를 사용하세요." });
    await expect(resolveItem("AT", FILE_URL, mk(403), noSleep)).rejects.toMatchObject({ status: 403, message: "이 파일을 볼 권한이 없습니다." });
    await expect(resolveItem("AT", FILE_URL, mk(500), noSleep)).rejects.toBeInstanceOf(GraphError);
  });
});

describe("downloadFile", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  it("content를 redirect:manual로 부르고 302면 Location을 Authorization 없이 GET", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://download.example/blob?tempauth=abc" } }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    const buf = await downloadFile("AT", "b!drive", "01FILE", fetchImpl, noSleep);
    expect([...buf]).toEqual([1, 2, 3, 4]);
    const [url1, init1] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url1).toBe("https://graph.microsoft.com/v1.0/drives/b!drive/items/01FILE/content");
    expect(init1.redirect).toBe("manual");
    expect((init1.headers as Record<string, string>).Authorization).toBe("Bearer AT");
    const [url2, init2] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).toBe("https://download.example/blob?tempauth=abc");
    expect((init2.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });
  it("200이 바로 오면 본문을 그대로 쓴다", async () => {
    const buf = await downloadFile("AT", "b!drive", "01FILE", vi.fn(async () => new Response(bytes, { status: 200 })), noSleep);
    expect(buf.length).toBe(4);
  });
  it("302에 Location이 없거나 최종 응답이 실패면 GraphError", async () => {
    await expect(downloadFile("AT", "b!drive", "01FILE", vi.fn(async () => new Response(null, { status: 302 })), noSleep)).rejects.toMatchObject({ code: "no_location" });
    await expect(downloadFile("AT", "b!drive", "01FILE", vi.fn(async () => json(404, { error: { code: "itemNotFound", message: "gone" } })), noSleep)).rejects.toMatchObject({ status: 404, code: "itemNotFound" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/ms-graph-drive.test.ts`
Expected: FAIL — export 없음.

- [ ] **Step 3: `graph-drive.ts`에 추가**(`resolveFolder` 함수 바로 아래, `SMALL_UPLOAD_MAX` 위)

```ts
/** 카탈로그 xlsx 소스 파일 크기 상한(등록·내려받기 공용) */
export const XLSX_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const RESOLVE_FAIL_FILE = "링크를 해석할 수 없습니다. 파일의 '링크 복사'를 사용하세요.";
const TOO_LARGE = "파일이 너무 큽니다(20MB 이하).";

export interface ResolvedItem {
  driveId: string;
  itemId: string;
  name: string;
  size: number;
  webUrl: string;
}

/**
 * GET /shares/{u!…}/driveItem — xlsx 파일 링크 해석(4단계 §4.3). 폴더·xlsx 아님·20MiB 초과·해석 불가·권한은 FolderResolveError
 * (클래스 이름은 3단계 것을 재사용 — 공유 링크 해석 오류라는 뜻), 그 외 실패는 GraphError.
 */
export async function resolveItem(token: string, url: string, fetchImpl: FetchLike = fetch, sleep: Sleep = defaultSleep): Promise<ResolvedItem> {
  const res = await fetchWithRetry(
    fetchImpl,
    `${GRAPH_BASE}/shares/${encodeShareUrl(url)}/driveItem?$select=id,name,size,file,folder,webUrl,parentReference`,
    { headers: { Authorization: `Bearer ${token}` } },
    sleep,
  );
  if (!res.ok) {
    const err = await readGraphError(res);
    if (res.status === 403) throw new FolderResolveError(403, "이 파일을 볼 권한이 없습니다.");
    if (res.status === 400 || res.status === 404) throw new FolderResolveError(400, RESOLVE_FAIL_FILE);
    throw err;
  }
  const j = (await res.json()) as { id?: string; name?: string; size?: number; webUrl?: string; file?: { mimeType?: string }; folder?: unknown; parentReference?: { driveId?: string } };
  if (j.folder) throw new FolderResolveError(400, "폴더 링크입니다. xlsx 파일 링크를 붙여 주세요.");
  const name = j.name ?? "";
  if (!/\.xlsx$/i.test(name) && j.file?.mimeType !== XLSX_MIME) throw new FolderResolveError(400, "xlsx 파일만 등록할 수 있습니다.");
  const size = Number(j.size ?? 0);
  if (size > XLSX_SOURCE_MAX_BYTES) throw new FolderResolveError(400, TOO_LARGE);
  if (!j.id || !j.parentReference?.driveId) throw new FolderResolveError(400, RESOLVE_FAIL_FILE);
  return { driveId: j.parentReference.driveId, itemId: j.id, name, size, webUrl: j.webUrl ?? "" };
}

/**
 * GET /drives/{driveId}/items/{itemId}/content — redirect:"manual"로 부르고 3xx면 Location(사전 인증 URL)을
 * Authorization 없이 다시 GET 한다(토큰을 붙이면 401). 20MiB 초과 본문은 오류.
 */
export async function downloadFile(token: string, driveId: string, itemId: string, fetchImpl: FetchLike = fetch, sleep: Sleep = defaultSleep): Promise<Buffer> {
  const first = await fetchWithRetry(
    fetchImpl,
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" },
    sleep,
  );
  let res = first;
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get("Location");
    if (!location) throw new GraphError(502, "no_location", "다운로드 리디렉션에 Location이 없습니다.", first.headers.get("request-id"));
    res = await fetchImpl(location, { method: "GET" });
  }
  if (!res.ok) throw await readGraphError(res);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > XLSX_SOURCE_MAX_BYTES) throw new GraphError(413, "too_large", TOO_LARGE, null);
  return buf;
}
```
`XLSX_MIME`은 이미 파일 아래쪽에 정의돼 있으므로(`const`는 호이스팅되지 않지만 함수 본문에서 참조하므로 실행 시점엔 정의됨) 그대로 두어도 되고, 가독성을 위해 `XLSX_MIME` 정의를 `resolveItem` 위로 옮겨도 된다. 파일 상단 주석에 "파일 링크 해석·내려받기(4단계)"를 덧붙인다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/ms-graph-drive.test.ts`
Expected: PASS(기존 케이스 포함).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/ms/graph-drive.ts frontend/src/lib/__tests__/ms-graph-drive.test.ts
git commit -m "feat(ms): Graph 공유 링크 → xlsx 파일 해석(resolveItem)과 사전 인증 URL 내려받기(downloadFile)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 6: 키워드 관리 — 병합 계획에 키워드, 기능 API `keywords`, `FeatureTable` 키워드 열

**Files:**
- Modify: `frontend/src/lib/rfp/catalog/merge-features.ts` (`MergePlan`, `mergeFeatures`)
- Modify: `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/features/route.ts` (POST)
- Modify: `frontend/src/app/api/admin/rfp-catalog/features/[featureId]/route.ts` (PATCH)
- Modify: `frontend/src/components/admin/rfp-catalog/FeatureTable.tsx`
- Test: `frontend/src/lib/__tests__/rfp-catalog-merge.test.ts`

**Interfaces:**
- Consumes: `seedKeywords`, `parseKeywordInput`(T2); `RfpAdminFeature.keywords`(T1).
- Produces: `MergePlan.toInsert[]: { name; nameNorm; description; keywords: string[] }`, `MergePlan.toUpdate[]: { id; description; keywords: string[] }`; `POST …/features {keywords?: string[]}`; `PATCH …/features/[id] {keywords?: string[] | null}`.

- [ ] **Step 1: merge 테스트 기대값 갱신**

`rfp-catalog-merge.test.ts` `describe("mergeFeatures")` 첫 케이스 기대값을:
```ts
    expect(plan.toInsert).toEqual([{ name: "백업", nameNorm: "백업", description: "신규", keywords: ["백업", "신규"] }]);
    expect(plan.toUpdate).toEqual([{ id: "f1", description: "새 설명", keywords: ["sso", "설명"] }]);
```
그리고 케이스 추가:
```ts
  it("incoming.keywords는 시드의 extra로 들어간다", () => {
    const plan = mergeFeatures([], [{ name: "SSO 로그인", description: "통합 인증", keywords: ["Single Sign-On"] }]);
    expect(plan.toInsert[0].keywords).toEqual(["sso", "로그인", "통합", "인증", "single sign-on"]);
  });
```
("새"는 1자라 버려지고 "설명"만 남는다. "신규"는 불용어가 아니다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-merge.test.ts`
Expected: FAIL(keywords 누락).

- [ ] **Step 3: `merge-features.ts` — MergePlan에 keywords**

`import { seedKeywords } from "./keywords";` 추가. `MergePlan`:
```ts
export interface MergePlan {
  toInsert: { name: string; nameNorm: string; description: string; keywords: string[] }[];
  toUpdate: { id: string; description: string; keywords: string[] }[];
  /** 사람이 고쳐서 건너뛴 기존 기능의 이름 */
  skippedEdited: string[];
}
```
`mergeFeatures` 루프의 두 push를:
```ts
    const keywords = seedKeywords(f.name, f.description, raw.keywords ?? []);
    if (!cur) plan.toInsert.push({ ...f, keywords });
    else if (cur.edited) plan.skippedEdited.push(cur.name);
    else plan.toUpdate.push({ id: cur.id, description: f.description, keywords });
```
(`f`는 `clean(raw)` 결과 `{name, nameNorm, description}`.) 함수 주석에 "키워드는 이름·설명(+incoming.keywords)에서 시드한다(edited 기능은 건너뛰므로 키워드도 보존)"을 덧붙인다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-merge.test.ts && npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts`
Expected: 테스트 PASS. tsc는 `import-job.ts`가 아직 `plan.toInsert`에서 keywords를 쓰지 않아도 오류 없음.

- [ ] **Step 5: features POST — keywords 받기·시드**

`solutions/[code]/features/route.ts` POST에서 body 타입에 `keywords?: unknown` 추가, `import { parseKeywordInput, seedKeywords } from "@/lib/rfp/catalog/keywords";`. `evidenceUrl` 검사 뒤에:
```ts
  let keywords: string[];
  if (body?.keywords === undefined || (Array.isArray(body.keywords) && body.keywords.length === 0)) keywords = seedKeywords(name, description);
  else if (Array.isArray(body.keywords) && body.keywords.every((k): k is string => typeof k === "string")) keywords = parseKeywordInput(body.keywords.join(","));
  else return NextResponse.json({ error: "keywords는 문자열 배열이어야 합니다." }, { status: 400 });
```
insert 객체에 `keywords,` 추가. JSDoc을 `{name, description?, evidenceUrl?, keywords?} → edited=true, 201. keywords가 없으면 이름·설명에서 시드`로.

- [ ] **Step 6: features PATCH — keywords 배열 또는 null(재생성)**

`features/[featureId]/route.ts` PATCH: import에 `parseKeywordInput, seedKeywords` 추가. `sortOrder` 블록 뒤, "바꿀 필드가 없습니다" 검사 앞에:
```ts
  let reseed = false;
  if ("keywords" in body) {
    if (body.keywords === null) reseed = true;
    else if (Array.isArray(body.keywords) && body.keywords.every((k): k is string => typeof k === "string")) patch.keywords = parseKeywordInput(body.keywords.join(","));
    else return NextResponse.json({ error: "keywords는 문자열 배열 또는 null입니다." }, { status: 400 });
  }
  if (Object.keys(patch).length === 2 && !reseed) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });
  if (reseed) {
    const { data: cur, error: curError } = await a.admin.from("rfp_solution_features").select("name, description").eq("id", featureId).maybeSingle();
    if (curError) return NextResponse.json({ error: curError.message }, { status: 500 });
    if (!cur) return NextResponse.json({ error: "기능이 없습니다." }, { status: 404 });
    patch.keywords = seedKeywords((patch.name as string | undefined) ?? (cur.name as string), (patch.description as string | undefined) ?? (cur.description as string));
  }
```
기존 `if (Object.keys(patch).length === 2) return …` 줄은 위 조건으로 대체한다. JSDoc: `{name?, description?, evidenceUrl?, isActive?, sortOrder?, keywords?: string[] | null} — 어떤 필드든 바꾸면 edited=true. keywords null은 이름·설명에서 다시 시드`.

- [ ] **Step 7: `FeatureTable.tsx` — 키워드 열·↻**

1. import에 `RotateCw` 추가(lucide-react).
2. `description` 컬럼 바로 뒤에 컬럼 추가:
```tsx
      col.accessor("keywords", {
        header: "키워드",
        cell: (ctx) => (
          <div className="flex items-start gap-1">
            <EditableCell
              value={ctx.getValue().join(", ")}
              onSave={(v) => patch(ctx.row.original, { keywords: v.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean) })}
              clampLines={2}
              placeholder="쉼표로 구분"
              className="min-w-0 flex-1 text-xs"
            />
            <Button
              variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground" title="이름·설명에서 다시 생성"
              onClick={() => patch(ctx.row.original, { keywords: null }).catch((err) => setError(err instanceof Error ? err.message : "저장 실패"))}
            >
              <RotateCw className="h-3 w-3" />
            </Button>
          </div>
        ),
        meta: { width: "14rem" },
      }),
```
3. `globalFilterFn`의 배열에 `row.original.keywords.join(" ")` 추가.
4. 안내 문구 `<p>`를: `✎ 표시는 사람이 고친 항목입니다. 가져오기는 이 항목을 덮어쓰지 않습니다. 규칙 가져오기 결과에는 회의록·일정 같은 항목이 섞일 수 있으니 기능이 아닌 항목은 비활성으로 바꾸세요. 키워드는 규칙 매핑이 요구사항과 대조하는 단어입니다(↻는 이름·설명에서 다시 생성).`
5. `AddFeatureDialog`는 그대로(서버가 시드).

- [ ] **Step 8: 타입·테스트·린트 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm test; npm run lint 2>&1 | grep -E "FeatureTable|features/route|featureId" || true`
Expected: tsc 추가 오류 0, 테스트 PASS, 새 린트 경고 없음.

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/merge-features.ts "frontend/src/app/api/admin/rfp-catalog/solutions/[code]/features/route.ts" "frontend/src/app/api/admin/rfp-catalog/features/[featureId]/route.ts" frontend/src/components/admin/rfp-catalog/FeatureTable.tsx frontend/src/lib/__tests__/rfp-catalog-merge.test.ts
git commit -m "feat(rfp): 기능 키워드 관리 — 병합 시 시드, POST/PATCH keywords(null=재생성), 어드민 기능 표 키워드 열·↻

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 7: 소스 종류 판별 + 라우트용 Graph 토큰 헬퍼 + xlsx 소스 등록

**Files:**
- Create: `frontend/src/lib/rfp/catalog/source-kind.ts`
- Create: `frontend/src/lib/ms/route-token.ts`
- Modify: `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/sources/route.ts` (POST 전면)
- Test: `frontend/src/lib/__tests__/rfp-catalog-source-kind.test.ts`

**Interfaces:**
- Consumes: `resolveItem`, `FolderResolveError`, `GraphError`(T5); `RfpSourceKind`(T1); `loadMsConfig`, `missingConfigMessage`(`lib/ms/config.ts`); `getAccessTokenForUser`, `NotConnectedError`, `ReconnectRequiredError`(`lib/ms/connections.ts`); `OAuthError`, `oauthErrorMessage`(`lib/ms/oauth.ts`); `createServerSupabase`(`lib/supabase-server.ts`).
- Produces: `detectSourceKind(url: string, confluenceHost: string | null): RfpSourceKind | null`; `graphTokenForRoute(admin, userId): Promise<{ ok: true; token: string } | { ok: false; response: NextResponse }>`.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-catalog-source-kind.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectSourceKind } from "@/lib/rfp/catalog/source-kind";

const HOST = "pms-innogrid.atlassian.net";

describe("detectSourceKind", () => {
  it("Confluence 호스트는 confluence, *.sharepoint.com은 xlsx", () => {
    expect(detectSourceKind(`https://${HOST}/wiki/spaces/A/pages/1/제목`, HOST)).toBe("confluence");
    expect(detectSourceKind(`https://PMS-INNOGRID.atlassian.net/wiki/pages/1`, HOST)).toBe("confluence");
    expect(detectSourceKind("https://innogridoffice.sharepoint.com/:x:/s/PQS/IQCEW08", HOST)).toBe("xlsx");
    expect(detectSourceKind("https://innogridoffice-my.sharepoint.com/:x:/p/a/b", null)).toBe("xlsx");
  });
  it("그 외 호스트·http·잘못된 URL·confluenceHost 없음은 null", () => {
    expect(detectSourceKind("https://example.com/x", HOST)).toBeNull();
    expect(detectSourceKind(`http://${HOST}/wiki/pages/1`, HOST)).toBeNull();
    expect(detectSourceKind("https://evil.sharepoint.com.attacker.io/x", HOST)).toBeNull();
    expect(detectSourceKind("not a url", HOST)).toBeNull();
    expect(detectSourceKind(`https://${HOST}/wiki/pages/1`, null)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-source-kind.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `catalog/source-kind.ts`**

```ts
import type { RfpSourceKind } from "@/types/rfp";

/**
 * 소스 URL의 종류(4단계 스펙 §4.1). https만. Confluence 호스트(ATLASSIAN_SITE)와 같으면 confluence,
 * *.sharepoint.com이면 xlsx, 그 외 null. confluenceHost가 null(env 미설정)이면 sharepoint만 본다.
 */
export function detectSourceKind(url: string, confluenceHost: string | null): RfpSourceKind | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (confluenceHost && u.host.toLowerCase() === confluenceHost.toLowerCase()) return "confluence";
  if (/(^|\.)sharepoint\.com$/i.test(u.hostname)) return "xlsx";
  return null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-source-kind.test.ts`
Expected: PASS.

- [ ] **Step 5: `lib/ms/route-token.ts`**

```ts
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "./config";
import { getAccessTokenForUser, NotConnectedError, ReconnectRequiredError } from "./connections";
import { OAuthError, oauthErrorMessage } from "./oauth";

export type GraphTokenResult = { ok: true; token: string } | { ok: false; response: NextResponse };

/**
 * 라우트용: settings+env 설정을 읽고 세션 사용자의 Graph access 토큰을 발급한다.
 * 실패는 3단계 업로드 라우트와 같은 상태·문구·code로 응답을 만든다(500 설정 누락 / 400 not_connected / 409 reconnect / 502 OAuth).
 * 토큰은 로그에 쓰지 않는다.
 */
export async function graphTokenForRoute(admin: SupabaseClient, userId: string): Promise<GraphTokenResult> {
  const supabase = await createServerSupabase();
  const cfg = await loadMsConfig(supabase);
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return { ok: false, response: NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 }) };
  }
  try {
    const token = await getAccessTokenForUser(admin, userId, { app: cfg.config.app, encKey: cfg.config.encKey });
    return { ok: true, token };
  } catch (e) {
    if (e instanceof NotConnectedError) return { ok: false, response: NextResponse.json({ error: "Microsoft 계정을 먼저 연결하세요.", code: "not_connected" }, { status: 400 }) };
    if (e instanceof ReconnectRequiredError) return { ok: false, response: NextResponse.json({ error: e.message, code: "reconnect" }, { status: 409 }) };
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 갱신 실패 ${e.code} (${e.status})`);
      return { ok: false, response: NextResponse.json({ error: oauthErrorMessage(e.code) }, { status: 502 }) };
    }
    throw e;
  }
}
```

- [ ] **Step 6: sources POST 재작성**

`solutions/[code]/sources/route.ts`의 import를 다음으로 바꾸고 POST를 교체(GET은 그대로):
```ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, mapSource, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig, ConfluenceUrlError, parseConfluencePageId } from "@/lib/rfp/catalog/confluence";
import { detectSourceKind } from "@/lib/rfp/catalog/source-kind";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { FolderResolveError, GraphError, resolveItem } from "@/lib/ms/graph-drive";
```
```ts
const ATLASSIAN_ENV_MISSING = "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다.";

/**
 * POST /api/admin/rfp-catalog/solutions/[code]/sources {url} → 201 (4단계 §4.1·§4.3)
 * 호스트로 종류를 판별한다. confluence: 페이지 id만 뽑는다(2단계). xlsx: 세션 사용자의 Graph 토큰으로 파일 링크를 해석해 drive_id·item id·파일명을 저장한다.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000) return NextResponse.json({ error: "url이 필요합니다." }, { status: 400 });

  const cfg = confluenceConfig();
  const kind = detectSourceKind(url, cfg?.host ?? null);
  if (!kind) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* 형식 오류 */ }
    if (!cfg && host.endsWith(".atlassian.net")) return NextResponse.json({ error: ATLASSIAN_ENV_MISSING }, { status: 400 });
    return NextResponse.json({ error: "Confluence 페이지 URL 또는 SharePoint 파일 링크만 등록할 수 있습니다." }, { status: 400 });
  }
  const { data: sol } = await a.admin.from("rfp_solutions").select("code").eq("code", code).maybeSingle();
  if (!sol) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });

  let row: Record<string, unknown>;
  if (kind === "confluence") {
    let pageId: string;
    try {
      pageId = parseConfluencePageId(url, cfg!.host);
    } catch (e) {
      if (e instanceof ConfluenceUrlError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
    row = { solution_code: code, kind, url, page_id: pageId, created_by: auth.userId };
  } else {
    const tok = await graphTokenForRoute(a.admin, auth.userId);
    if (!tok.ok) return tok.response;
    try {
      const item = await resolveItem(tok.token, url);
      row = { solution_code: code, kind, url, page_id: item.itemId, drive_id: item.driveId, title: item.name, created_by: auth.userId };
    } catch (e) {
      if (e instanceof FolderResolveError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof GraphError) {
        console.error(`[rfp] xlsx 소스 해석 실패 ${e.code} (${e.status}) request-id=${e.requestId ?? "-"}`);
        return NextResponse.json({ error: `SharePoint 응답 오류(${e.status})` }, { status: 502 });
      }
      throw e;
    }
  }

  const { data, error } = await a.admin.from("rfp_solution_sources").insert(row).select(SOURCE_COLUMNS).single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: kind === "xlsx" ? "같은 파일이 이미 등록돼 있습니다." : "같은 페이지가 이미 등록돼 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapSource(data as SourceDbRow), { status: 201 });
}
```

- [ ] **Step 7: 타입·테스트 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm test`
Expected: 추가 오류 0, PASS.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/source-kind.ts frontend/src/lib/ms/route-token.ts "frontend/src/app/api/admin/rfp-catalog/solutions/[code]/sources/route.ts" frontend/src/lib/__tests__/rfp-catalog-source-kind.test.ts
git commit -m "feat(rfp): 소스 등록에 SharePoint xlsx 링크 — 호스트로 종류 판별, 세션 사용자 Graph 토큰으로 파일 해석·drive_id 저장

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 8: `runImport` 엔진·소스 종류 분기 + import 라우트 `engine`·Graph 토큰

**Files:**
- Modify: `frontend/src/lib/rfp/catalog/import-job.ts` (전면 교체)
- Modify: `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/import/route.ts` (POST)

**Interfaces:**
- Consumes: `EngineKind`(T1), `extractFeaturesByRules`, `rulesNote`(T3), `parseXlsxFeatures`, `xlsxNote`(T4), `downloadFile`, `GraphError`(T5), `MergePlan.keywords`(T6), `graphTokenForRoute`(T7), `SourceDbRow.kind/drive_id`(T1).
- Produces: `interface ImportOptions { engine: EngineKind; graphToken?: string }`, `interface ImportDeps { fetchPage; makeCall; download; parseXlsx; extractRules }`, `runImport(admin, solutionCode, sourceIds, opts: ImportOptions, deps?: ImportDeps): Promise<void>`. `POST …/import {sourceIds?, engine?}` → 202 `{started, sourceIds, engine}`.
- 이 태스크는 Supabase·`after()`에 묶여 단위 테스트가 없다(2단계 `runImport`와 같다). `npx tsc --noEmit`·전체 테스트·코드 리뷰로 확인한다.

- [ ] **Step 1: `import-job.ts` 전체 교체**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { confluenceConfig, fetchConfluencePage, type ConfluenceConfig, type ConfluencePage } from "./confluence";
import { storageToText } from "./storage-text";
import { createAnthropicFeatureCall, extractFeatures, type FeatureExtractCall, type SolutionInfo } from "./extract-features";
import { extractFeaturesByRules, rulesNote } from "./extract-rules";
import { parseXlsxFeatures, xlsxNote, type XlsxParseResult } from "./xlsx-features";
import { mergeFeatures, type ExistingFeature, type IncomingFeature } from "./merge-features";
import { downloadFile, GraphError } from "@/lib/ms/graph-drive";
import type { EngineKind } from "../mapping/types";
import type { RfpSourceKind } from "@/types/rfp";

export interface ImportOptions {
  /** rules: 규칙 파서(기본) / llm: Claude 기능 추출(confluence 소스만. xlsx는 항상 파서) */
  engine: EngineKind;
  /** xlsx 소스가 있을 때 라우트가 발급해 넘기는 Graph access 토큰. 메모리에만 두고 로그·DB에 쓰지 않는다 */
  graphToken?: string;
}

export interface ImportDeps {
  fetchPage: (cfg: ConfluenceConfig, pageId: string) => Promise<ConfluencePage>;
  makeCall: (solution: SolutionInfo) => FeatureExtractCall;
  download: (token: string, driveId: string, itemId: string) => Promise<Buffer>;
  parseXlsx: (buffer: Buffer) => Promise<XlsxParseResult>;
  extractRules: typeof extractFeaturesByRules;
}

const DEFAULT_DEPS: ImportDeps = {
  fetchPage: (cfg, pageId) => fetchConfluencePage(cfg, pageId),
  makeCall: (solution) => createAnthropicFeatureCall(solution),
  download: (token, driveId, itemId) => downloadFile(token, driveId, itemId),
  parseXlsx: (buffer) => parseXlsxFeatures(buffer),
  extractRules: extractFeaturesByRules,
};

interface ExistingRow {
  id: string;
  name: string;
  name_norm: string;
  edited: boolean;
  sort_order: number;
}

interface SourceRow {
  id: string;
  kind: RfpSourceKind;
  url: string;
  page_id: string;
  drive_id: string | null;
  title: string | null;
}

const ATLASSIAN_ENV_MISSING = "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다.";

function describeError(e: unknown): string {
  if (e instanceof GraphError) return e.status === 404 ? "파일이 없습니다(삭제·이동)." : `SharePoint 응답 오류(${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

/** 소스 하나에서 기능 목록을 뽑는다. 종류·엔진에 따라 파서를 고른다(4단계 스펙 §4.5). */
async function extractFromSource(
  src: SourceRow, opts: ImportOptions, deps: ImportDeps, cfg: ConfluenceConfig | null, call: FeatureExtractCall | null,
): Promise<{ features: IncomingFeature[]; notes: string[]; title?: string; version?: number }> {
  if (src.kind === "xlsx") {
    if (!opts.graphToken) throw new Error("Microsoft 토큰이 없습니다. 가져오기를 다시 시작하세요.");
    if (!src.drive_id) throw new Error("xlsx 소스에 drive_id가 없습니다. 소스를 지우고 다시 등록하세요.");
    const buffer = await deps.download(opts.graphToken, src.drive_id, src.page_id);
    const r = await deps.parseXlsx(buffer);
    return { features: r.features, notes: [xlsxNote(r), ...r.warnings] };
  }
  if (!cfg) throw new Error(ATLASSIAN_ENV_MISSING);
  const page = await deps.fetchPage(cfg, src.page_id);
  const text = storageToText(page.storageHtml);
  if (!text) return { features: [], notes: ["페이지 본문이 비어 있습니다."], title: page.title, version: page.version };
  if (opts.engine === "rules") {
    const r = deps.extractRules(text);
    return { features: r.features, notes: [rulesNote(r), ...r.warnings], title: page.title, version: page.version };
  }
  if (!call) throw new Error("Claude 호출이 준비되지 않았습니다.");
  const r = await extractFeatures(text, call);
  return { features: r.features, notes: ["Claude 추출", ...r.warnings], title: page.title, version: page.version };
}

/**
 * 스펙 §4.5 잡. 소스마다 (confluence → REST → 텍스트 → 규칙 파서 | Claude) / (xlsx → Graph 내려받기 → 파서) → 키워드 시드 → 병합.
 * 소스 하나가 실패해도 다음 소스는 계속하고 어떤 경우에도 import_status를 ready 또는 failed로 끝낸다(running으로 남기지 않는다).
 */
export async function runImport(admin: SupabaseClient, solutionCode: string, sourceIds: string[], opts: ImportOptions, deps: ImportDeps = DEFAULT_DEPS): Promise<void> {
  if (!sourceIds.length) return;
  const failAll = async (message: string) => {
    const { error } = await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).in("id", sourceIds);
    if (error) console.error("[rfp] catalog import status update failed", solutionCode, sourceIds, error.message);
  };
  const { data: sol, error: solError } = await admin.from("rfp_solutions").select("code, name, description").eq("code", solutionCode).maybeSingle();
  if (solError || !sol) return await failAll(solError?.message ?? "솔루션이 없습니다.");
  const { data: srcRows, error: srcError } = await admin.from("rfp_solution_sources").select("id, kind, url, page_id, drive_id, title").in("id", sourceIds);
  if (srcError) return await failAll(srcError.message);
  const sources = (srcRows ?? []) as SourceRow[];
  const cfg = confluenceConfig();

  let call: FeatureExtractCall | null = null;
  if (opts.engine === "llm" && sources.some((s) => s.kind === "confluence")) {
    try {
      call = deps.makeCall({ name: sol.name as string, description: (sol.description as string) ?? "" });
    } catch (e) {
      return await failAll(e instanceof Error ? e.message : String(e));
    }
  }

  for (const src of sources) {
    const fail = async (message: string) => {
      const { error } = await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).eq("id", src.id);
      if (error) console.error("[rfp] catalog import status update failed", solutionCode, src.id, error.message);
    };
    try {
      const extracted = await extractFromSource(src, opts, deps, cfg, call);

      const { data: existing, error: exError } = await admin
        .from("rfp_solution_features")
        .select("id, name, name_norm, edited, sort_order")
        .eq("solution_code", solutionCode);
      if (exError) throw new Error(exError.message);
      const rows = (existing ?? []) as ExistingRow[];
      const plan = mergeFeatures(
        rows.map<ExistingFeature>((r) => ({ id: r.id, name: r.name, nameNorm: r.name_norm, edited: r.edited })),
        extracted.features,
      );
      let sort = rows.reduce((m, r) => Math.max(m, r.sort_order), 0);
      if (plan.toInsert.length) {
        const { error } = await admin.from("rfp_solution_features").insert(
          plan.toInsert.map((f) => ({
            solution_code: solutionCode, name: f.name, name_norm: f.nameNorm, description: f.description, keywords: f.keywords,
            evidence_url: src.url, source_id: src.id, sort_order: ++sort,
          })),
        );
        if (error) throw new Error(error.message);
      }
      for (const u of plan.toUpdate) {
        const { error } = await admin.from("rfp_solution_features").update({ description: u.description, keywords: u.keywords, evidence_url: src.url, source_id: src.id }).eq("id", u.id);
        if (error) throw new Error(error.message);
      }
      const notes = [...extracted.notes];
      if (plan.skippedEdited.length) notes.push(`사람이 고친 기능 ${plan.skippedEdited.length}개는 유지했습니다.`);
      const done: Record<string, unknown> = {
        import_status: "ready", error: null, note: notes.join(" ") || null,
        imported_at: new Date().toISOString(), feature_count: plan.toInsert.length + plan.toUpdate.length,
      };
      if (extracted.title !== undefined) done.title = extracted.title;
      if (extracted.version !== undefined) done.page_version = extracted.version;
      const { error: doneError } = await admin.from("rfp_solution_sources").update(done).eq("id", src.id);
      if (doneError) throw new Error(`상태 갱신 실패: ${doneError.message}`);
    } catch (e) {
      console.error("[rfp] catalog import failed", solutionCode, src.id, e instanceof Error ? e.message : e);
      await fail(describeError(e));
    }
  }
}
```
(기존 파일에서 `for (const sourceId of sourceIds)` 안의 소스 조회는 위처럼 한 번에 읽는 방식으로 바뀐다. `sourceIds`에 있지만 DB에 없는 id는 조용히 건너뛴다 — 2단계의 `if (!src) continue;`와 같다.)

- [ ] **Step 2: import 라우트 POST 교체**

`solutions/[code]/import/route.ts` import에 `import { isEngineKind, STALE_RUNNING_MS, type EngineKind } from "@/lib/rfp/mapping/types";`(기존 `STALE_RUNNING_MS` import를 대체), `import { graphTokenForRoute } from "@/lib/ms/route-token";` 추가. POST:
```ts
/**
 * POST /api/admin/rfp-catalog/solutions/[code]/import {sourceIds?: string[], engine?: "rules"|"llm"} (4단계 §6.1)
 * 400(engine 값·env·키·소스 없음) / 409(6분 이내 running) / 202 {started, sourceIds, engine} + after(runImport).
 * confluence 소스가 있으면 ATLASSIAN_*, llm이면 ANTHROPIC_API_KEY, xlsx 소스가 있으면 세션 사용자의 Graph 토큰이 필요하다.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const body = (await request.json().catch(() => ({}))) as { sourceIds?: unknown; engine?: unknown };
  const engineRaw = body.engine ?? "rules";
  if (!isEngineKind(engineRaw)) return NextResponse.json({ error: "engine은 rules 또는 llm입니다." }, { status: 400 });
  const engine: EngineKind = engineRaw;
  const wanted = Array.isArray(body.sourceIds) ? body.sourceIds.filter((s): s is string => typeof s === "string") : null;

  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = (data ?? []) as SourceDbRow[];
  const targets = wanted ? all.filter((s) => wanted.includes(s.id)) : all;
  if (!targets.length) return NextResponse.json({ error: "등록된 소스가 없습니다. Confluence 페이지 URL이나 SharePoint xlsx 링크를 먼저 추가하세요." }, { status: 400 });
  const needsConfluence = targets.some((s) => s.kind === "confluence");
  const needsXlsx = targets.some((s) => s.kind === "xlsx");
  if (needsConfluence && !confluenceConfig()) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  if (engine === "llm" && needsConfluence && !process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 400 });
  if (targets.some(isRunning)) return NextResponse.json({ error: "이미 가져오는 중입니다. 잠시 뒤 다시 시도하세요." }, { status: 409 });

  let graphToken: string | undefined;
  if (needsXlsx) {
    const tok = await graphTokenForRoute(a.admin, auth.userId);
    if (!tok.ok) return tok.response;
    graphToken = tok.token;
  }

  const ids = targets.map((s) => s.id);
  const { error: upError } = await a.admin.from("rfp_solution_sources").update({ import_status: "running", error: null, note: null }).in("id", ids);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });
  const admin = a.admin;
  after(async () => {
    await runImport(admin, code, ids, { engine, graphToken });
  });
  return NextResponse.json({ started: true, sourceIds: ids, engine }, { status: 202 });
}
```

- [ ] **Step 3: 타입·테스트 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm test`
Expected: 추가 오류 0, PASS. `after()` 콜로저에 토큰이 잡히지만 로그·응답에 나가지 않는다는 점을 코드 리뷰에서 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/import-job.ts "frontend/src/app/api/admin/rfp-catalog/solutions/[code]/import/route.ts"
git commit -m "feat(rfp): 카탈로그 가져오기 엔진 분기 — 규칙 파서 기본, Claude는 선택, xlsx 소스는 Graph 내려받기·파서, 키워드 시드 저장

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 9: Confluence 제목 검색 — 라이브러리·라우트·`ConfluenceSearchPanel`

**Files:**
- Modify: `frontend/src/types/rfp.ts` (`ConfluenceSearchHit` 추가)
- Create: `frontend/src/lib/rfp/catalog/confluence-search.ts`
- Create: `frontend/src/app/api/admin/rfp-catalog/confluence-search/route.ts`
- Create: `frontend/src/components/admin/rfp-catalog/ConfluenceSearchPanel.tsx` (이 태스크에서는 만들기만 하고 T10에서 `SourceTable`에 넣는다)
- Test: `frontend/src/lib/__tests__/rfp-catalog-confluence-search.test.ts`

**Interfaces:**
- Consumes: `confluenceConfig`, `ConfluenceConfig`, `ConfluenceFetchError`(`catalog/confluence.ts`); `requireAdmin`.
- Produces: `interface ConfluenceSearchHit { pageId; title; spaceKey: string | null; spaceName: string | null; url; lastModified: string | null }`(`types/rfp.ts`); `buildTitleCql(q): string`, `searchConfluencePages(cfg, q, limit?, fetchImpl?): Promise<ConfluenceSearchHit[]>`, `SEARCH_LIMIT_DEFAULT = 20`, `SEARCH_LIMIT_MAX = 25`; `GET /api/admin/rfp-catalog/confluence-search?q=&limit=` → `{results}`; `<ConfluenceSearchPanel solution registeredPageIds onRegistered />`.

- [ ] **Step 1: `types/rfp.ts`에 타입 추가**(`RfpAdminFeature` 뒤)

```ts
/** GET /api/admin/rfp-catalog/confluence-search 결과 행 */
export interface ConfluenceSearchHit {
  pageId: string;
  title: string;
  spaceKey: string | null;
  spaceName: string | null;
  /** 전체 페이지 URL — POST …/sources {url}에 그대로 넣는다 */
  url: string;
  lastModified: string | null;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-catalog-confluence-search.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { confluenceConfig, ConfluenceFetchError } from "@/lib/rfp/catalog/confluence";
import { buildTitleCql, searchConfluencePages, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX } from "@/lib/rfp/catalog/confluence-search";

const cfg = confluenceConfig({ ATLASSIAN_SITE: "https://pms-innogrid.atlassian.net/", ATLASSIAN_EMAIL: "a@b.c", ATLASSIAN_API_TOKEN: "tok" })!;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("buildTitleCql", () => {
  it("따옴표·역슬래시를 없애고 공백을 정리한 제목 검색 CQL", () => {
    expect(buildTitleCql('  기능명세서  v2.6 "x" \\y ')).toBe('type=page AND title ~ "기능명세서 v2.6 x y" ORDER BY lastmodified DESC');
  });
});

describe("searchConfluencePages", () => {
  const body = {
    results: [
      { id: 1789919378, title: "SECloudit 2.6 기능명세서", space: { key: "rndshare", name: "R&D 공유" }, version: { when: "2026-08-01T00:00:00.000Z" }, _links: { webui: "/spaces/rndshare/pages/1789919378/SECloudit+2.6" } },
      { id: "5", title: "제목만", _links: {} },
      { title: "id 없음" },
    ],
  };
  it("CQL·limit·expand로 부르고 결과를 매핑한다(url = site + /wiki + webui)", async () => {
    const fetchImpl = vi.fn(async () => json(200, body));
    const hits = await searchConfluencePages(cfg, "기능명세서", 5, fetchImpl as unknown as typeof fetch);
    expect(hits).toEqual([
      { pageId: "1789919378", title: "SECloudit 2.6 기능명세서", spaceKey: "rndshare", spaceName: "R&D 공유", url: "https://pms-innogrid.atlassian.net/wiki/spaces/rndshare/pages/1789919378/SECloudit+2.6", lastModified: "2026-08-01T00:00:00.000Z" },
      { pageId: "5", title: "제목만", spaceKey: null, spaceName: null, url: "https://pms-innogrid.atlassian.net/wiki", lastModified: null },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://pms-innogrid.atlassian.net/wiki/rest/api/content/search?cql=${encodeURIComponent(buildTitleCql("기능명세서"))}&expand=space,version&limit=5`);
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });
  it("limit은 1~25로 자르고 기본 20", async () => {
    const fetchImpl = vi.fn(async () => json(200, { results: [] }));
    await searchConfluencePages(cfg, "x", 999, fetchImpl as unknown as typeof fetch);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain(`&limit=${SEARCH_LIMIT_MAX}`);
    await searchConfluencePages(cfg, "x", undefined, fetchImpl as unknown as typeof fetch);
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toContain(`&limit=${SEARCH_LIMIT_DEFAULT}`);
  });
  it("비-2xx는 ConfluenceFetchError(status)", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 502 }));
    await expect(searchConfluencePages(cfg, "x", 5, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ status: 502, message: "Confluence 검색 실패(502)" });
    await expect(searchConfluencePages(cfg, "x", 5, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(ConfluenceFetchError);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-confluence-search.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: `catalog/confluence-search.ts`**

```ts
import { ConfluenceFetchError, type ConfluenceConfig } from "./confluence";
import type { ConfluenceSearchHit } from "@/types/rfp";

/** 어드민 "Confluence에서 찾기"(4단계 스펙 §4.6). 제목만 검색한다(본문 검색은 회의록 잡음이 커서 제외). */
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 25;

export function buildTitleCql(q: string): string {
  const clean = q.replace(/["\\]/g, "").replace(/\s+/g, " ").trim();
  return `type=page AND title ~ "${clean}" ORDER BY lastmodified DESC`;
}

interface SearchResponse {
  results?: {
    id?: string | number;
    title?: string;
    space?: { key?: string; name?: string };
    version?: { when?: string };
    _links?: { webui?: string };
  }[];
}

/** GET {site}/wiki/rest/api/content/search?cql=…&expand=space,version&limit=… — Basic 인증은 2단계 confluenceConfig. 실패 본문은 로그에도 남기지 않는다. */
export async function searchConfluencePages(cfg: ConfluenceConfig, q: string, limit: number = SEARCH_LIMIT_DEFAULT, fetchImpl: typeof fetch = fetch): Promise<ConfluenceSearchHit[]> {
  const n = Math.min(Math.max(1, Math.floor(limit)), SEARCH_LIMIT_MAX);
  const res = await fetchImpl(`${cfg.site}/wiki/rest/api/content/search?cql=${encodeURIComponent(buildTitleCql(q))}&expand=space,version&limit=${n}`, {
    headers: { Authorization: cfg.auth, Accept: "application/json" },
  });
  if (!res.ok) throw new ConfluenceFetchError(res.status, `Confluence 검색 실패(${res.status})`);
  const j = (await res.json()) as SearchResponse;
  return (j.results ?? [])
    .map((r) => ({
      pageId: r.id === undefined || r.id === null ? "" : String(r.id),
      title: r.title ?? "",
      spaceKey: r.space?.key ?? null,
      spaceName: r.space?.name ?? null,
      url: `${cfg.site}/wiki${r._links?.webui ?? ""}`,
      lastModified: r.version?.when ?? null,
    }))
    .filter((h) => h.pageId);
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-catalog-confluence-search.test.ts`
Expected: PASS.

- [ ] **Step 6: 라우트 `app/api/admin/rfp-catalog/confluence-search/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { confluenceConfig, ConfluenceFetchError } from "@/lib/rfp/catalog/confluence";
import { searchConfluencePages, SEARCH_LIMIT_DEFAULT } from "@/lib/rfp/catalog/confluence-search";

export const runtime = "nodejs";

/** GET /api/admin/rfp-catalog/confluence-search?q=&limit= → {results: ConfluenceSearchHit[]} (4단계 §4.6). admin. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const cfg = confluenceConfig();
  if (!cfg) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 100) return NextResponse.json({ error: "검색어는 2~100자입니다." }, { status: 400 });
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? SEARCH_LIMIT_DEFAULT);
  const limit = Number.isFinite(limitRaw) ? limitRaw : SEARCH_LIMIT_DEFAULT;
  try {
    return NextResponse.json({ results: await searchConfluencePages(cfg, q, limit) });
  } catch (e) {
    if (e instanceof ConfluenceFetchError) return NextResponse.json({ error: e.message }, { status: 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "검색에 실패했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 7: `ConfluenceSearchPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConfluenceSearchHit, RfpAdminSolution } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/** 소스 표 아래 접이식 패널: 제목으로 Confluence를 검색해 결과 행을 소스로 등록한다(4단계 스펙 §7.1). */
export default function ConfluenceSearchPanel({ solution, registeredPageIds, onRegistered }: {
  solution: RfpAdminSolution;
  /** 이미 등록된 confluence 소스의 pageId — "등록됨" 표시 */
  registeredPageIds: ReadonlySet<string>;
  onRegistered: () => void | Promise<void>;
}) {
  const [q, setQ] = useState(solution.name);
  const [hits, setHits] = useState<ConfluenceSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** ATLASSIAN_* 미설정 400을 받으면 입력을 비활성화한다 */
  const [unavailable, setUnavailable] = useState(false);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/confluence-search?q=${encodeURIComponent(q.trim())}`);
      const json = (await res.json().catch(() => ({}))) as { results?: ConfluenceSearchHit[]; error?: string };
      if (!res.ok) {
        if (res.status === 400 && /ATLASSIAN_/.test(json.error ?? "")) setUnavailable(true);
        throw new Error(json.error ?? "검색에 실패했습니다.");
      }
      setHits(json.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const register = async (hit: ConfluenceSearchHit) => {
    setAdding(hit.pageId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/sources`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: hit.url }),
      });
      if (!res.ok) throw new Error(await readError(res, "등록에 실패했습니다."));
      await onRegistered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록에 실패했습니다.");
    } finally {
      setAdding(null);
    }
  };

  const canSearch = !busy && !unavailable && q.trim().length >= 2;
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-semibold">Confluence에서 찾기</summary>
      <div className="mt-2 space-y-2">
        <div className="flex gap-2">
          <Input
            value={q} onChange={(e) => setQ(e.target.value)} disabled={unavailable} className="h-8"
            placeholder="페이지 제목 검색(예: 기능명세서)" onKeyDown={(e) => { if (e.key === "Enter" && canSearch) void search(); }}
          />
          <Button size="sm" variant="outline" disabled={!canSearch} onClick={search}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}검색
          </Button>
        </div>
        {hits && hits.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">제목</th><th className="px-3 py-2">스페이스</th><th className="px-3 py-2">수정일</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.pageId} className="border-t">
                    <td className="max-w-[360px] px-3 py-2">
                      <a href={h.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline"><span className="truncate">{h.title}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{h.spaceName ?? h.spaceKey ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{h.lastModified ? new Date(h.lastModified).toLocaleDateString("ko-KR") : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {registeredPageIds.has(h.pageId) ? (
                        <Badge variant="outline">등록됨</Badge>
                      ) : (
                        <Button size="sm" variant="outline" disabled={adding !== null} onClick={() => register(h)}>
                          {adding === h.pageId ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}등록
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hits && hits.length === 0 && <div className="text-sm text-muted-foreground">검색 결과가 없습니다.</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>
    </details>
  );
}
```

- [ ] **Step 8: 타입·린트 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm run lint 2>&1 | grep -E "ConfluenceSearchPanel|confluence-search" || true`
Expected: 추가 오류 0, 새 경고 없음(컴포넌트는 아직 어디서도 렌더하지 않는다 — T10에서 넣는다).

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/types/rfp.ts frontend/src/lib/rfp/catalog/confluence-search.ts frontend/src/app/api/admin/rfp-catalog/confluence-search/route.ts frontend/src/components/admin/rfp-catalog/ConfluenceSearchPanel.tsx frontend/src/lib/__tests__/rfp-catalog-confluence-search.test.ts
git commit -m "feat(rfp): 어드민 Confluence 제목 검색(CQL) 라이브러리·라우트·검색 패널(결과 행 → 소스 등록)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 10: `SourceTable` 개편(종류·엔진 버튼·not_connected·검색 패널) + 어드민 `llmAvailable`

**Files:**
- Modify: `frontend/src/app/api/admin/rfp-catalog/solutions/route.ts` (GET 응답에 `llmAvailable`)
- Modify: `frontend/src/app/admin/rfp-catalog/page.tsx`
- Modify: `frontend/src/components/admin/rfp-catalog/SourceTable.tsx` (전면 교체)

**Interfaces:**
- Consumes: `RfpAdminSolutionsResponse`, `RfpSolutionSource.kind`(T1); `POST …/import {sourceIds?, engine}`(T8); `ConfluenceSearchPanel`(T9).
- Produces: `<SourceTable solution llmAvailable onImported />`.

- [ ] **Step 1: admin solutions GET — `llmAvailable`**

`solutions/route.ts` GET의 마지막 return을:
```ts
  const res: RfpAdminSolutionsResponse = {
    llmAvailable: !!process.env.ANTHROPIC_API_KEY,
    solutions: ((sols.data ?? []) as SolutionDbRow[]).map((r) => mapAdminSolution(r, counts.get(r.code) ?? empty)),
  };
  return NextResponse.json(res);
```
(`import type { RfpAdminSolutionsResponse } from "@/types/rfp";` 추가.)

- [ ] **Step 2: `page.tsx` — llmAvailable 상태·설명 문구**

- `const [llmAvailable, setLlmAvailable] = useState(false);` 추가. `load`에서 `json`을 `RfpAdminSolutionsResponse & { error?: string }`로 받고 `setLlmAvailable(json.llmAvailable === true);`.
- 설명 `<p>` 문구를: `솔루션별 기능 목록. Confluence 페이지나 SharePoint xlsx 기능명세서를 등록해 가져오면 규칙(표·제목·키워드)으로 기능과 키워드를 정리하고, ANTHROPIC_API_KEY가 있으면 Claude로 보강할 수 있습니다. 사람이 고친 ✎ 항목은 가져오기가 덮어쓰지 않습니다. RFP 요구사항 매핑이 이 카탈로그를 기준으로 실행됩니다.`
- `<SourceTable key={current.code} solution={current} llmAvailable={llmAvailable} onImported={handleImported} />`.

- [ ] **Step 3: `SourceTable.tsx` 전체 교체**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfluenceSearchPanel from "@/components/admin/rfp-catalog/ConfluenceSearchPanel";
import type { EngineKind } from "@/lib/rfp/mapping/types";
import type { RfpAdminSolution, RfpImportStatus, RfpSolutionSource, RfpSourceKind } from "@/types/rfp";

const POLL_MS = 3000;
const KIND_LABEL: Record<RfpSourceKind, string> = { confluence: "Confluence", xlsx: "xlsx" };

function ImportBadge({ status }: { status: RfpImportStatus }) {
  if (status === "running") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />가져오는 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">실패</Badge>;
  if (status === "ready") return <Badge>완료</Badge>;
  return <Badge variant="outline">대기</Badge>;
}

interface ApiError { message: string; code?: string }
async function readError(res: Response, fallback: string): Promise<ApiError> {
  const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return { message: j.error ?? fallback, code: j.code };
}

export default function SourceTable({ solution, llmAvailable, onImported }: { solution: RfpAdminSolution; llmAvailable: boolean; onImported: () => void }) {
  const [sources, setSources] = useState<RfpSolutionSource[]>([]);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`);
    const json = (await res.json().catch(() => ({}))) as { running?: boolean; sources?: RfpSolutionSource[]; error?: string };
    if (!res.ok) { setError({ message: json.error ?? "소스를 불러오지 못했습니다." }); return; }
    setSources(json.sources ?? []);
    setRunning(json.running === true);
  }, [solution.code]);

  useEffect(() => { wasRunning.current = false; void load(); }, [load]);

  // 가져오는 중이면 3초 폴링, 끝나면 부모에 알려 기능 표를 다시 조회
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) { wasRunning.current = false; onImported(); }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [running, load, onImported]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      if (!res.ok) { setError(await readError(res, "추가에 실패했습니다.")); return; }
      setUrl("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: RfpSolutionSource) => {
    if (!window.confirm(`${s.title ?? s.url}\n이 소스를 삭제할까요? 가져온 기능은 남습니다.`)) return;
    const res = await fetch(`/api/admin/rfp-catalog/sources/${s.id}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    await load();
  };

  const runImport = async (engine: EngineKind, sourceIds?: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine, ...(sourceIds ? { sourceIds } : {}) }),
      });
      if (!res.ok) { setError(await readError(res, "가져오기를 시작하지 못했습니다.")); return; }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const registeredPageIds = new Set(sources.filter((s) => s.kind === "confluence").map((s) => s.pageId));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">소스 <span className="font-normal text-muted-foreground">{sources.length}</span></h3>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy || running || !sources.length} onClick={() => runImport("rules")}>
            {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}가져오기(규칙)
          </Button>
          <Button size="sm" variant="outline" disabled={busy || running || !sources.length || !llmAvailable} title={llmAvailable ? "Confluence 소스를 Claude로 다시 읽어 기능 설명을 보강합니다" : "ANTHROPIC_API_KEY 미설정"} onClick={() => runImport("llm")}>
            <Sparkles className="mr-1 h-4 w-4" />Claude로 보강
          </Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Confluence 페이지 URL 또는 SharePoint xlsx 파일 링크" className="h-8" />
        <Button size="sm" variant="outline" disabled={busy || !url.trim()} onClick={add}><Plus className="mr-1 h-4 w-4" />추가</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">종류</th>
              <th className="px-3 py-2">페이지·파일</th>
              <th className="px-3 py-2">버전</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">마지막 가져온 시각</th>
              <th className="px-3 py-2 text-right">기능</th>
              <th className="px-3 py-2">메모</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="px-3 py-2"><Badge variant="outline">{KIND_LABEL[s.kind]}</Badge></td>
                <td className="max-w-[320px] px-3 py-2">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    <span className="truncate">{s.title ?? s.url}</span><ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {s.title && <div className="truncate text-xs text-muted-foreground">{s.url}</div>}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.kind === "xlsx" ? "—" : s.pageVersion ?? "—"}</td>
                <td className="px-3 py-2"><ImportBadge status={s.importStatus} /></td>
                <td className="px-3 py-2 text-muted-foreground">{s.importedAt ? new Date(s.importedAt).toLocaleString("ko-KR") : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.featureCount}</td>
                <td className="max-w-[260px] px-3 py-2 text-xs">
                  {s.error && <div className="text-destructive">{s.error}</div>}
                  {s.note && <div className="text-muted-foreground">{s.note}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="이 소스만 가져오기(규칙)" disabled={busy || running} onClick={() => runImport("rules", [s.id])}><Download className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="삭제" disabled={running} onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {!sources.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">등록된 소스가 없습니다. 위에 Confluence 페이지 URL이나 SharePoint xlsx 링크를 넣어 추가하거나, 아래에서 Confluence를 검색하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="text-sm text-destructive">
          {error.message}
          {error.code === "not_connected" && <> <Link href="/settings" className="underline">Microsoft 계정 연결</Link></>}
          {error.code === "reconnect" && <> <Link href="/settings" className="underline">다시 연결</Link></>}
        </div>
      )}
      <ConfluenceSearchPanel solution={solution} registeredPageIds={registeredPageIds} onRegistered={load} />
    </div>
  );
}
```

- [ ] **Step 4: 타입·린트·로컬 렌더 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm run lint 2>&1 | grep -E "SourceTable|rfp-catalog/page|solutions/route" || true`
Expected: 추가 오류 0, 새 경고 없음. (로컬 dev가 떠 있으면 `/admin/rfp-catalog`에서 종류 열·두 버튼·검색 패널이 보이는지 눈으로 확인 — 필수 아님.)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/admin/rfp-catalog/solutions/route.ts frontend/src/app/admin/rfp-catalog/page.tsx frontend/src/components/admin/rfp-catalog/SourceTable.tsx
git commit -m "feat(rfp): 어드민 소스 표 — 종류(Confluence/xlsx) 열, 가져오기(규칙)/Claude로 보강 버튼, Microsoft 미연결 안내, Confluence 검색 패널

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 11: 규칙 엔진(`mapping/rules.ts`)

**Files:**
- Create: `frontend/src/lib/rfp/mapping/rules.ts`
- Test: `frontend/src/lib/__tests__/rfp-mapping-rules.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `normalizeText`, `charBigrams`(T2); `truncateDetails`, `ChunkRequirement`(`mapping/chunk.ts`); `CatalogSolution`, `EngineItem`(T1).
- Produces: `RULES` 상수, `interface FeatureEntry { featureId; solutionCode; name; keywords: string[]; nameTokens: Set<string>; bigrams: Set<string> }`, `buildFeatureIndex(catalog): FeatureEntry[]`, `interface RequirementText { tokens: Set<string>; compact: string; bigrams: Set<string> }`, `requirementText(r): RequirementText`, `interface ScoreDetail { hits: string[]; hitWeight: number; sim: number; score: number }`, `scoreFeature(req, f): ScoreDetail`, `isCandidate(d): boolean`, `rationaleFor(d): string`, `matchRequirement(r, index): EngineItem[]`, `matchChunk(chunk, index): EngineItem[]`.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-mapping-rules.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RULES, buildFeatureIndex, requirementText, scoreFeature, isCandidate, rationaleFor, matchRequirement, matchChunk } from "@/lib/rfp/mapping/rules";
import type { CatalogSolution, CatalogFeature } from "@/lib/rfp/mapping/types";
import type { ChunkRequirement } from "@/lib/rfp/mapping/chunk";

const feat = (id: string, solutionCode: string, name: string, description: string, keywords: string[], isActive = true): CatalogFeature =>
  ({ id, solutionCode, name, description, evidenceUrl: null, isActive, keywords });
const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    feat("f-sso", "secloudit", "SSO 로그인", "통합 인증으로 한 번 로그인", ["sso", "로그인", "통합", "인증"]),
    feat("f-acl", "secloudit", "접근 제어", "사용자 접근 통제", ["접근"]),
    feat("f-short", "secloudit", "접근 제어2", "", []),
    feat("f-off", "secloudit", "비활성", "sso 로그인 통합 인증", ["sso"], false),
  ] },
  { code: "openstackit", name: "Openstackit", description: "", isActive: true, sortOrder: 2, features: [
    feat("f-vm", "openstackit", "가상 머신 생성", "VM 인스턴스 생성 및 관리", ["가상", "머신", "생성", "vm", "인스턴스"]),
  ] },
  { code: "off", name: "꺼진 솔루션", description: "", isActive: false, sortOrder: 3, features: [feat("f-x", "off", "SSO", "", ["sso"])] },
];
const req = (reqId: string, title: string, definition = "", details = ""): ChunkRequirement => ({ id: `${reqId}-uuid`, reqId, title, categoryName: "c", definition, details });
const index = buildFeatureIndex(catalog);

describe("buildFeatureIndex", () => {
  it("활성 솔루션의 활성 기능만, 이름 토큰·bigram을 미리 만든다", () => {
    expect(index.map((f) => f.featureId)).toEqual(["f-sso", "f-acl", "f-short", "f-vm"]);
    expect([...index[0].nameTokens]).toEqual(["sso", "로그인"]);
    expect(index[0].bigrams.size).toBeGreaterThanOrEqual(RULES.MIN_FEATURE_BIGRAMS);
    expect(index[2].bigrams.size).toBeLessThan(RULES.MIN_FEATURE_BIGRAMS);
  });
});

describe("scoreFeature", () => {
  const r = requirementText(req("SER-001", "통합 인증(SSO) 기능", "사용자는 한 번 로그인으로 모든 시스템에 접근"));
  it("이름 토큰 키워드는 2, 설명 키워드는 1로 더하고 overlap 유사도를 합쳐 1에서 자른다", () => {
    const d = scoreFeature(r, index[0]);
    expect(d.hits).toEqual(["sso", "로그인", "인증", "통합"]);
    expect(d.hitWeight).toBe(6);
    expect(d.sim).toBeGreaterThan(0.5);
    expect(d.score).toBe(1);
    expect(isCandidate(d)).toBe(true);
  });
  it("bigram이 6개 미만인 기능은 유사도 0 — 키워드가 없으면 후보가 아니다", () => {
    const d = scoreFeature(r, index[2]);
    expect(d.sim).toBe(0);
    expect(d.hitWeight).toBe(0);
    expect(isCandidate(d)).toBe(false);
  });
  it("키워드가 하나라도 맞으면 후보. 점수 = 0.15×가중치 + 0.7×유사도(소수 2자리)", () => {
    const d = scoreFeature(r, index[1]);
    expect(d.hits).toEqual(["접근"]);
    expect(d.hitWeight).toBe(2);
    expect(isCandidate(d)).toBe(true);
    expect(d.score).toBe(Math.round(Math.min(1, 0.15 * 2 + 0.7 * d.sim) * 100) / 100);
  });
  it("맞는 키워드가 없고 유사도도 낮으면 후보가 아니다", () => {
    const d = scoreFeature(r, index[3]);
    expect(d.hitWeight).toBe(0);
    expect(d.sim).toBeLessThan(RULES.SIM_THRESHOLD);
    expect(isCandidate(d)).toBe(false);
  });
  it("3자 이상 키워드는 부분 문자열로도 맞고, 2자 키워드는 토큰 일치만", () => {
    const idx = buildFeatureIndex([{ code: "s", name: "S", description: "", isActive: true, sortOrder: 1, features: [
      feat("a", "s", "테넌트", "", ["멀티테넌트"]), feat("b", "s", "VM", "", ["vm"]),
    ] }]);
    const t = requirementText(req("R", "멀티테넌트환경에서 KVM기반 운영"));
    expect(scoreFeature(t, idx[0]).hits).toEqual(["멀티테넌트"]);
    expect(scoreFeature(t, idx[1]).hits).toEqual([]);
  });
});

describe("rationaleFor", () => {
  it("키워드가 있으면 목록(최대 5개)+유사도, 없으면 유사도만", () => {
    expect(rationaleFor({ hits: ["sso", "로그인"], hitWeight: 4, sim: 0.4237, score: 1 })).toBe("자동 매칭 — 일치 키워드: sso, 로그인 · 유사도 0.42");
    expect(rationaleFor({ hits: ["a", "b", "c", "d", "e", "f"], hitWeight: 6, sim: 0, score: 0.9 })).toBe("자동 매칭 — 일치 키워드: a, b, c, d, e · 유사도 0.00");
    expect(rationaleFor({ hits: [], hitWeight: 0, sim: 0.35, score: 0.25 })).toBe("자동 매칭 — 유사도 0.35");
  });
});

describe("matchRequirement / matchChunk", () => {
  it("후보를 점수순으로 최대 3개, 솔루션당 2개까지 candidate 행으로 낸다", () => {
    const many: CatalogSolution[] = [
      { code: "s1", name: "S1", description: "", isActive: true, sortOrder: 1, features: ["a1", "a2", "a3", "a4"].map((n) => feat(n, "s1", n, "", ["로그인"])) },
      { code: "s2", name: "S2", description: "", isActive: true, sortOrder: 2, features: [feat("b1", "s2", "b1", "", ["로그인"])] },
    ];
    const items = matchRequirement(req("SER-001", "로그인 기능"), buildFeatureIndex(many));
    expect(items.map((i) => i.feature)).toEqual(["a1", "a2", "b1"]);
    expect(items[0]).toEqual({ reqId: "SER-001", verdict: "candidate", feature: "a1", rationale: "자동 매칭 — 일치 키워드: 로그인 · 유사도 0.00", score: 0.15 });
  });
  it("후보가 없는 요구사항은 행을 내지 않고, 청크는 요구사항 순서대로 이어 붙인다", () => {
    const items = matchChunk([req("SER-001", "통합 인증(SSO) 기능", "한 번 로그인으로 접근"), req("SER-002", "사업 관리 산출물 제출"), req("SER-003", "가상 머신 생성")], index);
    expect(items.filter((i) => i.reqId === "SER-002")).toEqual([]);
    expect(items.filter((i) => i.reqId === "SER-001").map((i) => i.feature)).toEqual(["f-sso", "f-acl"]);
    expect(items.filter((i) => i.reqId === "SER-003")[0].feature).toBe("f-vm");
    expect(items.every((i) => i.verdict === "candidate" && typeof i.score === "number")).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-mapping-rules.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `mapping/rules.ts` 작성**

```ts
import { charBigrams, normalizeText, tokenize } from "./tokenize";
import { truncateDetails, type ChunkRequirement } from "./chunk";
import type { CatalogSolution, EngineItem } from "./types";

/**
 * 규칙 매핑 엔진(4단계 스펙 §5.3). 키워드 일치(이름 토큰 가중치 2, 나머지 1) + 문자 bigram overlap 유사도로 점수를 매겨
 * 요구사항마다 상위 후보를 "candidate" 판정으로 낸다. 순수 함수 — I/O 없음.
 */
export const RULES = {
  HIT_WEIGHT: 0.15,
  SIM_WEIGHT: 0.7,
  SIM_THRESHOLD: 0.3,
  /** 기능 bigram이 이보다 적으면 유사도를 0으로 본다(이름만 있는 짧은 기능이 우연히 맞는 것 방지) */
  MIN_FEATURE_BIGRAMS: 6,
  TOP_PER_REQ: 3,
  MAX_PER_SOLUTION: 2,
  /** 부분 문자열 일치를 허용하는 키워드 최소 길이 */
  SUBSTRING_MIN_LEN: 3,
  /** rationale에 나열하는 키워드 수 */
  HITS_SHOWN: 5,
} as const;

export interface FeatureEntry {
  featureId: string;
  solutionCode: string;
  name: string;
  keywords: string[];
  nameTokens: Set<string>;
  bigrams: Set<string>;
}

/** 활성 솔루션의 활성 기능만. 키워드는 저장값이 이미 정규화돼 있지만 방어적으로 한 번 더 정규화한다. */
export function buildFeatureIndex(catalog: CatalogSolution[]): FeatureEntry[] {
  const out: FeatureEntry[] = [];
  for (const s of catalog) {
    if (!s.isActive) continue;
    for (const f of s.features) {
      if (!f.isActive) continue;
      out.push({
        featureId: f.id,
        solutionCode: s.code,
        name: f.name,
        keywords: f.keywords.map((k) => normalizeText(k)).filter(Boolean),
        nameTokens: new Set(tokenize(f.name)),
        bigrams: charBigrams(`${f.name} ${f.description}`),
      });
    }
  }
  return out;
}

export interface RequirementText {
  tokens: Set<string>;
  /** 정규화 뒤 공백을 모두 뺀 문자열(부분 문자열 일치용) */
  compact: string;
  bigrams: Set<string>;
}

export function requirementText(r: ChunkRequirement): RequirementText {
  const text = `${r.title} ${r.definition} ${truncateDetails(r.details)}`;
  return { tokens: new Set(tokenize(text)), compact: normalizeText(text).replace(/\s+/g, ""), bigrams: charBigrams(text) };
}

export interface ScoreDetail {
  /** 일치한 키워드(가중치 큰 순, 같으면 사전순) */
  hits: string[];
  hitWeight: number;
  sim: number;
  score: number;
}

export function scoreFeature(req: RequirementText, f: FeatureEntry): ScoreDetail {
  const scored: { k: string; w: number }[] = [];
  for (const k of f.keywords) {
    const compactK = k.replace(/\s+/g, "");
    const hit = req.tokens.has(k) || (compactK.length >= RULES.SUBSTRING_MIN_LEN && req.compact.includes(compactK));
    if (hit) scored.push({ k, w: f.nameTokens.has(k) ? 2 : 1 });
  }
  scored.sort((a, b) => b.w - a.w || a.k.localeCompare(b.k, "ko"));
  const hitWeight = scored.reduce((s, x) => s + x.w, 0);
  let sim = 0;
  if (f.bigrams.size >= RULES.MIN_FEATURE_BIGRAMS && req.bigrams.size > 0) {
    let inter = 0;
    for (const b of f.bigrams) if (req.bigrams.has(b)) inter += 1;
    sim = inter / Math.min(f.bigrams.size, req.bigrams.size);
  }
  const score = Math.round(Math.min(1, RULES.HIT_WEIGHT * hitWeight + RULES.SIM_WEIGHT * sim) * 100) / 100;
  return { hits: scored.map((x) => x.k), hitWeight, sim, score };
}

export function isCandidate(d: ScoreDetail): boolean {
  return d.hitWeight >= 1 || d.sim >= RULES.SIM_THRESHOLD;
}

export function rationaleFor(d: ScoreDetail): string {
  const simText = `유사도 ${d.sim.toFixed(2)}`;
  return d.hits.length ? `자동 매칭 — 일치 키워드: ${d.hits.slice(0, RULES.HITS_SHOWN).join(", ")} · ${simText}` : `자동 매칭 — ${simText}`;
}

/** 요구사항 하나: 후보를 점수 내림차순(동점은 기능 이름순)으로 정렬해 솔루션당 2개, 전체 3개까지 */
export function matchRequirement(r: ChunkRequirement, index: FeatureEntry[]): EngineItem[] {
  const req = requirementText(r);
  const cands = index.map((f) => ({ f, d: scoreFeature(req, f) })).filter((c) => isCandidate(c.d));
  cands.sort((a, b) => b.d.score - a.d.score || a.f.name.localeCompare(b.f.name, "ko"));
  const perSolution = new Map<string, number>();
  const out: EngineItem[] = [];
  for (const c of cands) {
    if (out.length >= RULES.TOP_PER_REQ) break;
    const n = perSolution.get(c.f.solutionCode) ?? 0;
    if (n >= RULES.MAX_PER_SOLUTION) continue;
    perSolution.set(c.f.solutionCode, n + 1);
    out.push({ reqId: r.reqId, verdict: "candidate", feature: c.f.featureId, rationale: rationaleFor(c.d), score: c.d.score });
  }
  return out;
}

export function matchChunk(chunk: readonly ChunkRequirement[], index: FeatureEntry[]): EngineItem[] {
  return chunk.flatMap((r) => matchRequirement(r, index));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/rfp-mapping-rules.test.ts`
Expected: PASS. `hits` 순서 `["sso", "로그인", "인증", "통합"]`은 가중치 2(sso·로그인) → 1(인증·통합), 같은 가중치는 `"ko"` 로케일 사전순(라틴이 한글보다 앞, 인증 < 통합)이다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/rules.ts frontend/src/lib/__tests__/rfp-mapping-rules.test.ts
git commit -m "feat(rfp): 규칙 매핑 엔진 — 키워드 가중 일치 + bigram overlap 유사도, 요구사항당 상위 3(솔루션당 2) 후보

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 12: 엔진 팩토리(`mapping/engine.ts`) + 검증 `FeatureLookup`·`score` + `runMapping(engine)` + 매핑 라우트 `engine`

**Files:**
- Create: `frontend/src/lib/rfp/mapping/engine.ts`
- Modify: `frontend/src/lib/rfp/mapping/validate.ts` (`validateMappingOutput` 시그니처·`ValidatedRow.score`)
- Modify: `frontend/src/lib/rfp/mapping/run-job.ts`
- Modify: `frontend/src/app/api/rfp/projects/[id]/mapping/route.ts` (POST)
- Modify: `frontend/src/app/api/rfp/projects/[id]/mapping/rows/route.ts` (insert에 engine·score)
- Test: `frontend/src/lib/__tests__/rfp-mapping-validate.test.ts`(FeatureLookup·score), `frontend/src/lib/__tests__/rfp-mapping-run.test.ts`(엔진 팩토리)

**Interfaces:**
- Consumes: `EngineItem`, `FeatureLookup`, `MappingEngine`, `EngineKind`, `isEngineKind`(T1); `buildFeatureIndex`, `matchChunk`(T11); `buildCatalogPrompt`, `buildChunkMessage`(`prompt.ts`); `createAnthropicMappingCall`(`llm.ts`); `LlmUnavailableError`(`extract-llm.ts`).
- Produces: `interface EngineSetup { run: MappingEngine; lookup: FeatureLookup }`, `type EngineFactory = (catalog: CatalogSolution[]) => EngineSetup`, `createRulesEngine(catalog)`, `createLlmEngine(catalog, opts?)`, `ENGINE_FACTORIES: Record<EngineKind, EngineFactory>`; `validateMappingOutput(items: EngineItem[], chunk, lookup: FeatureLookup)`, `ValidatedRow.score: number | null`; `runMapping(admin, projectId, mode, engine: EngineKind, deps?: RunDeps)`; `POST …/mapping {mode?, engine?, confirm?}` → 202 `{started, mode, engine}`.

- [ ] **Step 1: validate 테스트를 FeatureLookup·score로 갱신**

`rfp-mapping-validate.test.ts`:
- import를 `import { validateMappingOutput, validateManualMapping, MAX_ROWS_PER_REQUIREMENT } from "@/lib/rfp/mapping/validate";`, `import type { CatalogSolution, EngineItem, FeatureLookup, MappingRow } from "@/lib/rfp/mapping/types";`로 바꾸고 `CatalogAliases` import를 지운다.
- `const aliases: CatalogAliases = {...}` → 
```ts
const lookup: FeatureLookup = new Map([
  ["F1", { featureId: "f-sso", solutionCode: "secloudit" }],
  ["F2", { featureId: "f-audit", solutionCode: "secloudit" }],
  ["F3", { featureId: "f-ci", solutionCode: "devopsit" }],
]);
```
  모든 `aliases` 인자를 `lookup`으로. `item` 헬퍼 타입을 `EngineItem`으로(`LlmMappingItem["verdict"]` → `EngineItem["verdict"]`).
- 첫 케이스: `item("SER-001", "partial", "f3 ")`는 이제 대소문자·공백 정리를 하지 않으므로 `item("SER-001", "partial", "F3")`로 바꾼다. 기대 행 4개 모두에 `score: null` 추가.
- "요구사항당 5행 상한" 케이스: `const many: CatalogAliases = { solutions: …, features: new Map(…) }` → `const many: FeatureLookup = new Map(Array.from({ length: 7 }, (_, i) => [\`F${i + 1}\`, { featureId: \`f${i + 1}\`, solutionCode: "s" }]));`.
- "fulfilled와 함께 나온 build/na…" 케이스의 기대 행에 `score: null` 추가.
- 케이스 추가:
```ts
  it("score는 0~1이면 통과, 아니면 null. 기능 id 키 조회(규칙 엔진)", () => {
    const byId: FeatureLookup = new Map([["f-sso", { featureId: "f-sso", solutionCode: "secloudit" }]]);
    const v = validateMappingOutput([
      { reqId: "SER-001", verdict: "candidate", feature: "f-sso", rationale: "r", score: 0.42 },
      { reqId: "SER-002", verdict: "candidate", feature: "f-sso", rationale: "r", score: 7 },
    ], chunk.slice(0, 2), byId);
    expect(v.rows.map((r) => [r.verdict, r.featureId, r.score])).toEqual([["candidate", "f-sso", 0.42], ["candidate", "f-sso", null]]);
  });
```

- [ ] **Step 2: run 테스트에 엔진 팩토리 케이스 추가**

`rfp-mapping-run.test.ts` 끝에(import 추가: `import { createRulesEngine, createLlmEngine } from "@/lib/rfp/mapping/engine"; import { LlmUnavailableError } from "@/lib/rfp/extract-llm"; import type { CatalogSolution } from "@/lib/rfp/mapping/types";`):
```ts
const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    { id: "f-sso", solutionCode: "secloudit", name: "SSO 로그인", description: "통합 인증", evidenceUrl: null, isActive: true, keywords: ["sso", "로그인", "통합", "인증"] },
    { id: "f-off", solutionCode: "secloudit", name: "옛기능", description: "", evidenceUrl: null, isActive: false, keywords: ["sso"] },
  ] },
];

describe("createRulesEngine", () => {
  it("활성 기능만 lookup(기능 id 키)에 넣고 run은 후보를 돌려준다", async () => {
    const setup = createRulesEngine(catalog);
    expect([...setup.lookup.entries()]).toEqual([["f-sso", { featureId: "f-sso", solutionCode: "secloudit" }]]);
    const items = await setup.run([{ id: "r1", reqId: "SER-001", title: "SSO 통합 인증", categoryName: "c", definition: "", details: "" }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ reqId: "SER-001", verdict: "candidate", feature: "f-sso" });
  });
});

describe("createLlmEngine", () => {
  it("키가 없으면 LlmUnavailableError", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createLlmEngine(catalog)).toThrow(LlmUnavailableError);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
  it("키가 있으면 별칭 lookup을 준다(호출은 하지 않는다)", () => {
    const setup = createLlmEngine(catalog, { apiKey: "test-key" });
    expect([...setup.lookup.keys()]).toEqual(["F1"]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/__tests__/rfp-mapping-validate.test.ts src/lib/__tests__/rfp-mapping-run.test.ts`
Expected: FAIL(engine 모듈 없음, validate 시그니처).

- [ ] **Step 4: `validate.ts` 변경**

- import: `import { isVerdict, requiresFeature, type CatalogSolution, type EngineItem, type FeatureLookup, type MappingRow, type Verdict } from "./types";` — `CatalogAliases` import 삭제. `LlmMappingItem` 인터페이스 삭제(`EngineItem`으로 대체).
- `ValidatedRow`에 `score: number | null;` 추가. `Candidate`에 `score: number | null;` 추가.
- 시그니처 `export function validateMappingOutput(items: EngineItem[], chunk: readonly ChunkRequirement[], lookup: FeatureLookup): ValidationResult`.
- 별칭 조회 `const f = it.feature ? aliases.features.get(it.feature.trim().toUpperCase()) : undefined;` → `const f = it.feature ? lookup.get(it.feature.trim()) : undefined;`(대소문자 정리는 llm 엔진이 한다).
- 후보 push: `list.push({ verdict: it.verdict, solutionCode, featureId, rationale: it.rationale.trim(), score: typeof it.score === "number" && it.score >= 0 && it.score <= 1 ? it.score : null });`
- rows push: `rows.push({ requirementId: req.id, solutionCode: c.solutionCode, featureId: c.featureId, verdict: c.verdict, rationale: c.rationale, score: c.score, sortOrder: i })`.
- JSDoc "스펙 §4.3 검증 1~6" → "2단계 스펙 §4.3 검증 1~6 + 4단계 §5.4(FeatureLookup·score)".

- [ ] **Step 5: `mapping/engine.ts` 작성**

```ts
import { LlmUnavailableError } from "../extract-llm";
import { buildCatalogPrompt, buildChunkMessage } from "./prompt";
import { createAnthropicMappingCall } from "./llm";
import { buildFeatureIndex, matchChunk } from "./rules";
import type { CatalogSolution, EngineKind, FeatureLookup, MappingEngine } from "./types";

export { LlmUnavailableError };

/** 엔진 하나 = 청크 실행 함수 + 출력의 feature 키를 실제 기능으로 되돌리는 조회 표(4단계 스펙 §5.4) */
export interface EngineSetup {
  run: MappingEngine;
  lookup: FeatureLookup;
}
/** 카탈로그로 엔진을 만든다. llm은 키가 없으면 LlmUnavailableError를 던진다. */
export type EngineFactory = (catalog: CatalogSolution[]) => EngineSetup;

/** 규칙 엔진: lookup 키 = 기능 id */
export function createRulesEngine(catalog: CatalogSolution[]): EngineSetup {
  const index = buildFeatureIndex(catalog);
  const lookup: FeatureLookup = new Map(index.map((f) => [f.featureId, { featureId: f.featureId, solutionCode: f.solutionCode }]));
  return { lookup, run: async (chunk) => matchChunk(chunk, index) };
}

/** Claude 엔진(2단계 그대로): lookup 키 = "F{n}" 별칭. 출력 feature는 trim·대문자로 정리해 돌려준다. */
export function createLlmEngine(catalog: CatalogSolution[], opts: { apiKey?: string; model?: string } = {}): EngineSetup {
  const { systemText, aliases } = buildCatalogPrompt(catalog);
  const call = createAnthropicMappingCall(systemText, opts);
  return {
    lookup: aliases.features,
    run: async (chunk) => (await call(buildChunkMessage(chunk))).mappings.map((m) => ({ ...m, feature: m.feature ? m.feature.trim().toUpperCase() : null })),
  };
}

export const ENGINE_FACTORIES: Record<EngineKind, EngineFactory> = {
  rules: createRulesEngine,
  llm: (catalog) => createLlmEngine(catalog),
};
```

- [ ] **Step 6: `run-job.ts` 변경**

- import 정리: `buildCatalogPrompt, buildChunkMessage`(prompt), `createAnthropicMappingCall, type MappingCall`(llm) import를 지우고 `import { ENGINE_FACTORIES, LlmUnavailableError, type EngineFactory, type EngineSetup } from "./engine";`, `import type { EngineKind, MappingRow } from "./types";`로. 기존 `import { LlmUnavailableError } from "../extract-llm";`는 지운다(engine에서 재export).
- `MappingDeps`/`DEFAULT_DEPS`를 지우고:
```ts
export interface RunDeps {
  factories: Record<EngineKind, EngineFactory>;
}
const DEFAULT_DEPS: RunDeps = { factories: ENGINE_FACTORIES };
```
- 시그니처: `export async function runMapping(admin: SupabaseClient, projectId: string, mode: MappingMode, engine: EngineKind, deps: RunDeps = DEFAULT_DEPS): Promise<void>`.
- try 블록 앞부분을:
```ts
    const catalog = await loadCatalog(admin, { activeSolutionsOnly: true });
    let setup: EngineSetup;
    try {
      setup = deps.factories[engine](catalog);
    } catch (e) {
      if (e instanceof LlmUnavailableError) return await fail(e.message);
      throw e;
    }
    if (!setup.lookup.size) return await fail("카탈로그가 비어 있습니다. 관리자에게 문의하세요.");
    const index = indexCatalog(catalog);
```
  기존 `let call: MappingCall; try { call = deps.makeCall(systemText); } …` 블록은 삭제.
- 청크 처리: `const out = await call(buildChunkMessage(chunk)); const v = validateMappingOutput(out.mappings, chunk, aliases);` → `const items = await setup.run(chunk); const v = validateMappingOutput(items, chunk, setup.lookup);`. insert 객체에 `engine, score: r.score,` 추가.
- JSDoc: "스펙 §4.3 잡" → "2단계 §4.3 + 4단계 §5.4 잡. 엔진(rules|llm)은 팩토리로 주입".

- [ ] **Step 7: 매핑 라우트 POST**

`projects/[id]/mapping/route.ts`:
- import: `buildCatalogPrompt` 대신 `import { createRulesEngine } from "@/lib/rfp/mapping/engine";`, `import { isEngineKind, STALE_RUNNING_MS, type EngineKind } from "@/lib/rfp/mapping/types";`.
- body 타입에 `engine?: unknown`. `mode` 다음 줄에:
```ts
  const engineRaw = body.engine ?? "rules";
  if (!isEngineKind(engineRaw)) return NextResponse.json({ error: "engine은 rules 또는 llm입니다." }, { status: 400 });
  const engine: EngineKind = engineRaw;
```
- `if (!process.env.ANTHROPIC_API_KEY) …` → `if (engine === "llm" && !process.env.ANTHROPIC_API_KEY) …`.
- 카탈로그 비어 있음: `catalogEmpty = buildCatalogPrompt(await loadCatalog(...)).aliases.features.size === 0;` → `catalogEmpty = createRulesEngine(await loadCatalog(auth.admin, { activeSolutionsOnly: true })).lookup.size === 0;`.
- `after(async () => { await runMapping(admin, id, mode, engine); });`, 응답 `{ started: true, mode, engine }`. JSDoc에 `engine?: "rules"|"llm"(기본 rules)` 추가.

- [ ] **Step 8: rows 라우트 insert**

`mapping/rows/route.ts` insert 객체에 `engine: "manual", score: null,` 추가(`rationale, evidence_url: evidenceUrl,` 뒤).

- [ ] **Step 9: 타입·테스트 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm test`
Expected: 추가 오류 0(`LlmMappingItem` 참조가 남아 있으면 여기서 잡힌다 — `grep -rn LlmMappingItem frontend/src`로 0건 확인), 테스트 전부 PASS.

- [ ] **Step 10: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/engine.ts frontend/src/lib/rfp/mapping/validate.ts frontend/src/lib/rfp/mapping/run-job.ts "frontend/src/app/api/rfp/projects/[id]/mapping/route.ts" "frontend/src/app/api/rfp/projects/[id]/mapping/rows/route.ts" frontend/src/lib/__tests__/rfp-mapping-validate.test.ts frontend/src/lib/__tests__/rfp-mapping-run.test.ts
git commit -m "feat(rfp): 매핑 엔진 주입 — 규칙/Claude 팩토리, 검증 FeatureLookup·score, runMapping(engine), POST mapping {engine} 기본 rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 13: 상세 화면 — 엔진 선택 다이얼로그, 후보 표시, 행 출처

**Files:**
- Modify: `frontend/src/app/rfp/[id]/page.tsx`
- Modify: `frontend/src/components/rfp/OverviewCard.tsx` (Props·전달)
- Modify: `frontend/src/components/rfp/MappingRunButton.tsx` (전면 교체)
- Modify: `frontend/src/components/rfp/MappingEditor.tsx` (출처 표시·안내 문구)

**Interfaces:**
- Consumes: `RfpCatalogResponse.llmAvailable`, `RfpMapping.engine/score`, `ENGINE_LABEL`, `EngineKind`(T1); `POST …/mapping {mode, engine, confirm}`(T12).
- Produces: `<MappingRunButton project catalogReady llmAvailable onRun(mode, engine) />`, `OverviewCard` Props `llmAvailable`, `onRunMapping: (mode, engine) => Promise<void>`.

- [ ] **Step 1: `page.tsx`**

- import에 `import type { EngineKind } from "@/lib/rfp/mapping/types";`(기존 `CatalogSolution` import와 합쳐도 된다).
- 상태 `const [llmAvailable, setLlmAvailable] = useState(false);` 추가.
- 카탈로그 fetch effect를:
```ts
    fetch("/api/rfp/catalog")
      .then(async (r) => (r.ok ? ((await r.json()) as RfpCatalogResponse) : null))
      .then((res) => { setCatalog(res ? toCatalog(res) : []); setLlmAvailable(res?.llmAvailable === true); })
      .catch(() => { setCatalog([]); setLlmAvailable(false); });
```
- `const runMapping = async (mode: MappingMode) => {` → `const runMapping = async (mode: MappingMode, engine: EngineKind) => {`, `post({ mode })` → `post({ mode, engine })`, `post({ mode, confirm: true })` → `post({ mode, engine, confirm: true })`.
- `<OverviewCard … llmAvailable={llmAvailable} onRunMapping={runMapping} … />`.

- [ ] **Step 2: `OverviewCard.tsx`**

- import에 `import type { EngineKind } from "@/lib/rfp/mapping/types";`.
- Props: `llmAvailable: boolean;` 추가, `onRunMapping: (mode: MappingMode, engine: EngineKind) => Promise<void>;`.
- 구조 분해에 `llmAvailable` 추가, `<MappingRunButton project={project} catalogReady={catalogReady} llmAvailable={llmAvailable} onRun={onRunMapping} />`.

- [ ] **Step 3: `MappingRunButton.tsx` 전체 교체**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { STALE_RUNNING_MS, type EngineKind } from "@/lib/rfp/mapping/types";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
import type { RfpProjectDetail } from "@/types/rfp";

/** 실행 다이얼로그: 엔진(규칙 기본 / Claude) + 모드(전체 / 미매핑). 첫 실행에도 다이얼로그를 연다(4단계 스펙 §7.2). */
export default function MappingRunButton({ project, catalogReady, llmAvailable, onRun }: {
  project: RfpProjectDetail; catalogReady: boolean; llmAvailable: boolean; onRun: (mode: MappingMode, engine: EngineKind) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<EngineKind>("rules");
  const [, tick] = useState(0);
  useEffect(() => {
    if (project.mappingStatus !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [project.mappingStatus]);

  const running = project.mappingStatus === "running" && Date.now() - Date.parse(project.updatedAt) <= STALE_RUNNING_MS;
  const hasAny = project.mappings.length > 0;
  const editedRequirements = new Set(project.mappings.filter((m) => m.edited).map((m) => m.requirementId)).size;
  const mapped = new Set(project.mappings.map((m) => m.requirementId));
  const missing = project.requirements.filter((r) => !mapped.has(r.id)).length;
  const disabled = busy || running || project.status !== "ready" || !catalogReady;
  const title = !catalogReady ? "카탈로그가 비어 있습니다. 관리자에게 문의하세요." : project.status !== "ready" ? "요구사항 추출이 끝난 뒤 실행할 수 있습니다." : undefined;

  const run = async (mode: MappingMode) => {
    setBusy(true);
    try {
      await onRun(mode, engine);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const engineButton = (kind: EngineKind, label: string, desc: string, off = false) => (
    <button
      type="button" disabled={off || busy} onClick={() => setEngine(kind)} title={off ? "ANTHROPIC_API_KEY 미설정" : undefined}
      className={cn("flex-1 rounded-md border p-3 text-left text-sm transition-colors", engine === kind ? "border-primary bg-muted/60" : "hover:bg-muted/30", off && "cursor-not-allowed opacity-50")}
    >
      <div className="font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{off ? "ANTHROPIC_API_KEY 미설정" : desc}</div>
    </button>
  );

  return (
    <>
      <Button size="sm" variant="secondary" disabled={disabled} title={title} onClick={() => setOpen(true)}>
        {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
        {running ? "매핑 중" : "솔루션 매핑 실행"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasAny ? "솔루션 매핑을 다시 실행할까요?" : "솔루션 매핑 실행"}</DialogTitle>
            <DialogDescription>
              {editedRequirements > 0
                ? `사람이 고친 매핑이 있는 요구사항 ${editedRequirements}건은 어느 방식이든 건드리지 않습니다.`
                : hasAny ? "자동으로 만든 매핑(규칙 후보·Claude)은 새 결과로 교체됩니다." : "카탈로그 기능을 요구사항마다 대조합니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">엔진</div>
              <div className="flex gap-2">
                {engineButton("rules", "규칙(키워드) — 기본", "카탈로그 키워드·유사도로 후보를 고릅니다. 키 없이 동작")}
                {engineButton("llm", "Claude", "Claude가 충족·부분충족·설계·해당없음을 판정합니다", !llmAvailable)}
              </div>
            </div>
            <div className="grid gap-2">
              {hasAny ? (
                <>
                  <Button variant="outline" className="h-auto justify-start py-3 text-left" disabled={busy} onClick={() => run("all")}>
                    <div>
                      <div className="font-medium">전체 다시 매핑</div>
                      <div className="text-xs text-muted-foreground">사람이 고치지 않은 모든 요구사항을 다시 매핑합니다. 카탈로그가 바뀌었을 때.</div>
                    </div>
                  </Button>
                  <Button variant="outline" className="h-auto justify-start py-3 text-left" disabled={busy || missing === 0} onClick={() => run("missing")}>
                    <div>
                      <div className="font-medium">미매핑 {missing}건만</div>
                      <div className="text-xs text-muted-foreground">매핑이 하나도 없는 요구사항만 채웁니다. 실패·중단 뒤 이어서 할 때.</div>
                    </div>
                  </Button>
                </>
              ) : (
                <Button className="h-auto justify-start py-3 text-left" disabled={busy} onClick={() => run("all")}>
                  <Wand2 className="mr-2 h-4 w-4" />
                  <div>
                    <div className="font-medium">매핑 실행</div>
                    <div className="text-xs opacity-80">요구사항 {project.requirements.length}건 전체</div>
                  </div>
                </Button>
              )}
            </div>
          </div>
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>닫기</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```
`engine` 상태가 `llm`인데 `llmAvailable`이 false가 되는 경우(키 제거 뒤 재조회)는 `disabled` 버튼이라 서버 400 문구가 그대로 보인다 — 허용.

- [ ] **Step 4: `MappingEditor.tsx`**

- import: `import { ENGINE_LABEL, requiresFeature, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type Verdict } from "@/lib/rfp/mapping/types";`.
- 행 헤더 오른쪽 `<div className="flex items-center gap-1">` 안, ✎ 아이콘 앞에:
```tsx
                {row.engine !== "manual" && (
                  <span className="text-xs text-muted-foreground" title="자동 매핑이 만든 행">
                    자동({ENGINE_LABEL[row.engine]}){row.score !== null && ` ${row.score.toFixed(2)}`}
                  </span>
                )}
```
- 초안 안내 문구를 `"설계·구축영역/해당없음을 고르면 바로 추가되고, 충족/부분충족/후보는 기능까지 고르면 추가됩니다. 설명·근거 URL은 추가된 뒤 입력하세요."`로.
- 판정 셀렉트는 `VERDICT_ORDER`를 돌므로 후보가 자동으로 들어간다(변경 없음).

- [ ] **Step 5: 타입·린트 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v survey-metrics.test.ts; npm run lint 2>&1 | grep -E "MappingRunButton|MappingEditor|OverviewCard|rfp/\[id\]/page" || true; npm test`
Expected: 추가 오류 0, 새 경고 없음, PASS.

- [ ] **Step 6: 커밋**

```bash
git add "frontend/src/app/rfp/[id]/page.tsx" frontend/src/components/rfp/OverviewCard.tsx frontend/src/components/rfp/MappingRunButton.tsx frontend/src/components/rfp/MappingEditor.tsx
git commit -m "feat(rfp): 상세 매핑 다이얼로그에 엔진 선택(규칙 기본·Claude는 키 있을 때), 후보 판정·행 출처(자동(규칙) 점수) 표시

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 14: 문서 — 런북·CLAUDE.md

**Files:**
- Modify: `docs/rfp-analyzer.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 런북 머리 줄**

첫 "설계:" 줄에 `· docs/superpowers/specs/2026-09-06-rfp-analyzer-phase4-design.md`(4단계)와 계획 `docs/superpowers/plans/2026-09-06-rfp-analyzer-phase4.md`를 각각 덧붙인다.

- [ ] **Step 2: 런북 "구성"에 4단계 문단**(3단계 문단 뒤)

```markdown
- **4단계(규칙 기반 카탈로그·매핑, LLM 폴백)**: `ANTHROPIC_API_KEY` 없이 동작한다. 어드민 소스는 **Confluence 페이지 URL**(규칙 파서: 표의 기능명 열·h2~h4 제목·글머리 `이름: 설명`)과 **SharePoint xlsx 기능명세서 링크**(가져오기 실행자의 Microsoft 위임 토큰으로 Graph에서 내려받아 exceljs로 헤더 탐지 — 기능명/설명/키워드 열) 두 종류이고, "Confluence에서 찾기" 패널로 제목 검색(CQL) 뒤 한 번에 등록할 수 있다. 가져오기는 기본 "규칙", 키가 있으면 "Claude로 보강". 기능마다 **키워드**(이름 토큰 + 설명 토큰 10개, 어드민 편집·↻ 재생성)를 둔다. 상세 "솔루션 매핑 실행" 다이얼로그에서 엔진(규칙 기본 / Claude)을 고른다. 규칙 엔진은 키워드 일치(이름 키워드 2, 나머지 1) + 문자 bigram overlap 유사도로 점수(`0.15×가중치 + 0.7×유사도`, 후보 조건 가중치≥1 또는 유사도≥0.3)를 매겨 요구사항당 상위 3(솔루션당 2)을 판정 **"후보"**(`candidate`)로 저장한다. 사람이 후보를 충족/부분충족 등으로 확정하고, 나중에 Claude로 다시 실행하면 후보는 교체되고 확정 행(✎)은 남는다. 매핑 행에 `engine`(rules|llm|manual)·`score`. SQL `docs/sql/2026-09-06-rfp-rules-mapping.sql`. 라이브러리 `lib/rfp/catalog/{source-kind,extract-rules,xlsx-features,keywords,confluence-search}.ts`, `lib/rfp/mapping/{tokenize,rules,engine}.ts`, `lib/ms/graph-drive.ts`(resolveItem·downloadFile), `lib/ms/route-token.ts`.
```

- [ ] **Step 3: 런북 env 표**

`ANTHROPIC_API_KEY` 행 설명을 `비표준 RFP LLM 폴백 + 카탈로그 "Claude로 보강" + 매핑 엔진 "Claude". **선택** — 없으면 규칙 엔진만 동작하고 화면에서 Claude 버튼이 비활성`로. `ATLASSIAN_*` 행 설명에 `Confluence 검색 패널`을 덧붙인다. `MS_TOKEN_ENC_KEY`·`TEAMS_GRAPH_CLIENT_SECRET` 행에 `(4단계) xlsx 소스 등록·가져오기에도 사용`을 덧붙인다.

- [ ] **Step 4: 런북 "최초 설치" 9~10**

```markdown
9. (4단계) `docs/sql/2026-09-06-rfp-rules-mapping.sql` 실행 → `rfp_solution_features.keywords`, `rfp_solution_sources.kind|drive_id`, `rfp_requirement_mappings.verdict`에 candidate·`engine`·`score`(기존 자동 행은 `llm`으로 백필). 재배포.
10. (4단계) 어드민에서 등록된 소스 "가져오기(규칙)" → 기능 표에서 회의록성 항목 비활성·키워드 보강 → SharePoint xlsx 기능명세서 링크 등록·가져오기(등록자 Microsoft 계정 연결 필요) → 상세에서 "규칙" 매핑 → 후보 검토. 키가 들어오면 "Claude로 보강"·엔진 Claude로 재실행.
```

- [ ] **Step 5: 런북 "운영 메모"**(3단계 메모 뒤)

```markdown
- (4단계) 규칙 엔진 상수는 `lib/rfp/mapping/rules.ts`의 `RULES`, 불용어는 `lib/rfp/mapping/tokenize.ts`의 `STOPWORDS`. 후보가 너무 많으면 임계값을 올리고, 너무 적으면 기능 키워드를 보강한다(어드민 기능 표 "키워드" 열). 후보는 판정일 뿐 확정이 아니므로 xlsx에도 "후보"로 나간다.
- (4단계) xlsx 소스는 **가져오기를 누른 사람**의 Microsoft 토큰으로 읽는다(3단계 업로드와 같은 권한 규칙). 미연결이면 400 + `/settings` 링크, 파일이 지워졌으면 그 소스만 "파일이 없습니다(삭제·이동)". 20MB 초과 파일은 등록이 거부된다. Confluence 검색은 제목만(`title ~`) 본다.
- (4단계) 규칙 파서는 표·제목·글머리에서 기능을 뽑기 때문에 회의록·일정 항목이 섞일 수 있다. 기능이 아닌 항목은 삭제 대신 비활성으로 두면 다음 가져오기가 다시 만들지 않는다(`name_norm` 유니크로 병합됨). `edited=false` 기능은 가져오기마다 키워드가 다시 시드된다.
```

- [ ] **Step 6: 런북 체크리스트 29~36**(28 뒤)

```markdown
29. admin: 소스 입력에 SharePoint xlsx 링크 → 종류 `xlsx`·파일명 표시. Microsoft 미연결 계정으로는 400 문구 + "Microsoft 계정 연결" 링크. 폴더 링크는 "폴더 링크입니다" 400. 다른 호스트는 "Confluence 페이지 URL 또는 SharePoint 파일 링크만" 400.
30. "Confluence에서 찾기" → "기능명세서" 검색 → 결과 표 → "등록" → 소스 표에 추가되고 결과 행이 "등록됨"으로 바뀜.
31. "가져오기(규칙)" → 완료 → 기능 표에 기능·키워드, 소스 메모 "규칙 추출: 표 N·제목 M·글머리 K → 기능 X개"(xlsx는 "xlsx: 시트 N개 → 기능 X개"). 키 없으면 "Claude로 보강" 비활성(툴팁 "ANTHROPIC_API_KEY 미설정").
32. 키워드 셀 편집(쉼표) → ✎ → 다시 가져오기 → 키워드 유지. ↻ → 이름·설명 기준으로 재생성(✎ 유지).
33. 상세 → "솔루션 매핑 실행" → 다이얼로그 엔진 "규칙(키워드)" 기본, "Claude" 비활성(키 없음) → 실행 → 완료 → "후보 N" 칩, 행 펼침에 근거 "자동 매칭 — 일치 키워드: … · 유사도 0.xx"와 "자동(규칙) 0.xx".
34. 후보 행 판정을 충족으로 변경 → ✎ + "자동(규칙)" 유지 → "전체 다시 매핑"(규칙) → 그 요구사항은 그대로, 다른 요구사항의 후보는 교체.
35. xlsx 다운로드 → 판정 열 "후보", 개요 "후보 N건"과 솔루션 줄 "· 후보 K건", 요약 "SECloudit·IAM(후보)". SharePoint 업로드 파일도 같다.
36. (키 추가 후) "Claude로 보강"·엔진 "Claude" 활성 → 매핑 실행 → 후보가 충족/부분충족/설계·구축영역/해당없음으로 교체, ✎ 행은 유지, 행 출처 "자동(Claude)".
```

- [ ] **Step 7: `CLAUDE.md`**

- `/admin/rfp-catalog` 줄을: `` `/admin/rfp-catalog` — RFP 솔루션 카탈로그(admin): 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit) · 소스 등록(Confluence 페이지 URL 또는 SharePoint xlsx 링크, "Confluence에서 찾기" 제목 검색) · 가져오기(규칙 파서 기본, `ANTHROPIC_API_KEY` 있으면 "Claude로 보강"; ✎ 편집 항목 보존) · 기능 표 인라인 편집(키워드 열·↻ 재생성) ``
- `/rfp`, `/rfp/[id]` 줄의 판정 목록을 `충족/부분충족/후보/설계·구축영역/해당없음`으로, "솔루션 매핑(상세 "솔루션 매핑 실행"" 뒤에 ` 다이얼로그에서 엔진 규칙(키워드, 기본)/Claude 선택`을 덧붙인다.
- API 줄 `/api/admin/rfp-catalog/{…}`에 `confluence-search`를 추가하고 `가져오기는 after()+runImport(engine rules|llm, xlsx 소스는 세션 사용자 Graph 토큰)`으로.
- API 줄 `GET /api/rfp/catalog`…을 `GET /api/rfp/catalog`(`llmAvailable` 포함), `POST mapping {mode all|missing, engine rules|llm, confirm}`… `실행은 after()+runMapping(엔진 팩토리 주입, 20건 청크·동시 3·청크별 저장, 행에 engine·score)`로.
- Supabase Tables(RFP 분석)에 줄 추가: `` - `rfp_solution_features.keywords`(text[]), `rfp_solution_sources.kind|drive_id`(confluence|xlsx), `rfp_requirement_mappings.verdict`에 candidate·`engine`(rules|llm|manual)·`score` — SQL `docs/sql/2026-09-06-rfp-rules-mapping.sql` ``
- Key Patterns "RFP 분석" 문단 끝에: `4단계: 카탈로그 적재·매핑이 엔진 주입형 — catalog/{source-kind,extract-rules,xlsx-features,keywords,confluence-search}.ts, mapping/{tokenize,rules,engine}.ts. 규칙 엔진은 "후보"만 내고 확정은 사람 또는 Claude. Graph 토큰은 라우트가 발급해 runImport 인자로만 넘긴다(lib/ms/route-token.ts).`
- env `ANTHROPIC_API_KEY` 줄에 `(선택 — 없으면 규칙 엔진만)`을 덧붙인다.

- [ ] **Step 8: 빌드 확인·커밋**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: 빌드 성공(라우트 목록에 `/api/admin/rfp-catalog/confluence-search` 포함).

```bash
git add docs/rfp-analyzer.md CLAUDE.md
git commit -m "docs(rfp): 4단계 런북(구성·env·설치 9~10·운영 메모·체크리스트 29~36)과 CLAUDE.md 갱신

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

## 스펙 대비 계획에서 조정한 점

- `EngineKind`·`isEngineKind`는 스펙 §2가 `engine.ts`에 뒀지만 **`mapping/types.ts`** 에 둔다 — 클라이언트 컴포넌트(`MappingRunButton`)가 타입을 import 하는데 `engine.ts`는 Anthropic SDK를 끌어온다.
- `ConfluenceSearchPanel`은 T9에서 만들고 T10의 `SourceTable` 전면 교체에서 넣는다(두 태스크가 같은 파일을 다르게 고치는 충돌 방지). `registeredPageIds`는 SourceTable이 갖고 있는 소스 목록에서 만든다.
- `resolveItem`의 오류 클래스는 스펙대로 3단계 `FolderResolveError`를 재사용한다(이름은 "공유 링크 해석 오류"로 읽는다).
- `runImport`는 대상 소스를 한 번에 읽고(`in("id", …)`) 소스마다 처리한다. DB에 없는 id는 건너뛴다(2단계와 같은 동작).
- `validateMappingOutput`의 "기능 별칭 불명" 경고 문구는 그대로 둔다(규칙 엔진은 인덱스와 lookup이 같은 집합이라 이 경고를 내지 않는다).

## 실행 중 조정(inline 실행, 2026-09-06~07)

- T1 xlsx 테스트: 요약 "당사 솔루션"은 목록 시트 **6열**(7열은 "솔루션" 이름) — 계획의 `getCell(7)`을 `getCell(6)`으로 고쳤다.
- T2 tokenize 테스트: "사용자"는 `STOPWORDS`에 있어 토큰에서 빠지는 것이 맞다 — 기대값에서 제외하고 `STOPWORDS.has("사용자")` 단언을 추가했다.
- T4 xlsx 파서 테스트: `v2.6` 같은 버전 문자열은 `isCodeOnly`(`/^[A-Za-z]{0,4}[-_.]?\d{1,4}([-_.]\d{1,4})*$/`)에 맞아 설명에서 빠진다 — 기대값을 `"보안"`으로 고쳤다(의도한 동작: 버전·코드는 잡음).
- T11 정렬: `localeCompare(…, "ko")`는 ICU 콜레이션이 한글을 라틴 앞에 둬 기대 순서(`sso` → `로그인`)와 어긋난다 — 코드포인트 비교 `byCodePoint`로 바꿔 환경에 독립적으로 만들었다.
- 운영 DB SQL은 T1 커밋 직후 Management API로 적용했다(2026-09-06 21:5x, 열 5개 확인, 기존 매핑 행 0건이라 백필 대상 없음).
- 최종 리뷰(opus) 반영: `splitCells`를 `"|"` 분리로 바꿔 빈 셀(`| |`) 행의 열 밀림을 고쳤고 `storageToText` 연동 테스트를 추가했다; `loadCatalog`·어드민 솔루션 목록의 기능 조회를 `selectAll`로 감쌌다(규칙 파서·xlsx는 기능을 수백 건 올릴 수 있음); `isCandidate` 경계·xlsx 다중 시트 합산 테스트 추가.
- import 라우트의 `ANTHROPIC_API_KEY` 검사는 대상에 confluence 소스가 있을 때만 한다(스펙 §6.1은 "llm이면 검사"). xlsx 소스는 엔진과 무관하게 파서로 읽으므로 xlsx만 있는 가져오기는 키 없이도 202가 맞다.
- xlsx 파서의 폴백 설명(설명 열 없음)은 이름 열뿐 아니라 **키워드 열도 제외**한다 — 키워드는 `IncomingFeature.keywords`로 따로 들어가 중복을 피한다(스펙 §4.3의 의도적 축소, 코드 주석에 기록).
- 운영 첫 실행 튜닝(2026-09-07 07:0x): 첫 규칙 매핑이 모든 요구사항에 3개 후보를 채웠고 표본에서 "설정·접근·제어·화면·요약" 같은 범용 키워드가 매칭을 끌었다. `buildFeatureIndex`가 활성 기능의 10%를 넘게 쓰인 키워드를 매칭에서 빼고(`DF_MAX_RATIO 0.1`, 20개 이상일 때), 후보 조건을 `MIN_HIT_WEIGHT 2`(이름 키워드 1개 또는 설명 키워드 2개)·`SIM_THRESHOLD 0.5`로 올렸다(스펙 §5.3 상수 조정 — 스펙은 "상수는 코드에서 조정"으로 열어 두었다).
- 운영 2차 튜닝(07:0x): DF 필터·가중치 조건만으로는 결과가 거의 같았다 — overlap coefficient가 짧은 기능 설명(bigram 수십 개) 대 긴 요구사항(수백 개)에서 0.6~0.9로 부풀어 점수를 지배했기 때문. 유사도를 cosine `|A∩B|/√(|A|·|B|)`로 바꿔(스펙 §1 조정표의 overlap 결정을 다시 조정) 키워드 히트가 순위를 결정하게 했고, `DF_MAX_RATIO 0.05`, 범용어(대상·화면·요약·연결·구현·분석·등록·정의·확인 등) 불용어 추가.
- 사용자 요청(2026-09-07 08:43): Claude 관련 UI("Claude로 보강" 버튼, 매핑 다이얼로그 엔진 선택)는 키가 없으면 비활성 표시 대신 **숨긴다**(스펙 §7.1·§7.2의 "disabled + 툴팁"을 대체). 전체 목록에서 행을 펼치면 요구사항 본문(정의·세부 내용·산출정보·관련 요구사항)을 매핑 편집기 위에 표시(`RequirementDetails`).
