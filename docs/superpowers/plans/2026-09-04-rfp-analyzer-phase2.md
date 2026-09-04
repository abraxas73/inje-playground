# RFP 분석 2단계(솔루션 카탈로그 + 매핑) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어드민이 Confluence 페이지로 시드하는 솔루션 기능 카탈로그를 만들고, 프로젝트 상세 화면의 버튼으로 요구사항마다 당사 솔루션·기능·판정(충족/부분충족/설계·구축영역/해당없음)을 Claude가 일괄 매핑해 사람이 고칠 수 있게 하며, xlsx에 매핑 열·시트를 추가한다.

**Architecture:** 1단계와 같은 구조 — 순수 로직은 `frontend/src/lib/rfp/catalog/`(Confluence URL 파싱·본문 텍스트화·기능 추출·병합·가져오기 잡)과 `frontend/src/lib/rfp/mapping/`(프롬프트·청크·검증·요약·매핑 잡)에 두고 vitest로 검증한다. Claude·Confluence 호출은 함수 주입으로 모킹한다. 긴 작업(가져오기·매핑)은 `after()`로 응답 뒤 실행하고 상태 컬럼을 3초 폴링한다. 데이터는 `rfp_solutions`·`rfp_solution_sources`·`rfp_solution_features`·`rfp_requirement_mappings` 네 테이블과 `rfp_projects.mapping_*` 컬럼.

**Tech Stack:** Next.js 16.1.6 / React 19 / TypeScript strict / Tailwind 4 / shadcn(ui 폴더 기존 컴포넌트, `SearchableSelect`) / Supabase(service role) / `@anthropic-ai/sdk` + `zod` 4 / `@tanstack/react-table@8` / `exceljs` / vitest

**Spec:** `docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md`

## Global Constraints

- 모든 명령은 `frontend/` 안에서 실행한다(`cd frontend`). `node_modules`가 없으면 `npm install`을 먼저 한다.
- 화면 문구·커밋 메시지·주석은 한국어. 커밋 메시지 형식은 `feat(rfp): …`, `test(rfp): …`, `docs(rfp): …` 이고 마지막에 아래 두 줄을 붙인다.
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv
  ```
- `git stash`를 쓰지 않는다(공유 stash). 작업을 잠시 치울 일이 있으면 WIP 커밋.
- 테스트는 `frontend/src/lib/__tests__/rfp-*.test.ts`, 실행은 `npm test -- rfp-…`(vitest run). Anthropic SDK를 import하는 테스트와 `fetch`/`Response`를 쓰는 테스트는 첫 줄에 `// @vitest-environment node`.
- 판정 값은 `fulfilled | partial | build | na` 네 가지만. 표시 문자열은 `충족 | 부분충족 | 설계·구축영역 | 해당없음`, 매핑 없는 요구사항은 `미매핑`. 서버·화면·xlsx 모두 `lib/rfp/mapping/types.ts`의 상수를 쓴다.
- `fulfilled`/`partial` 행은 솔루션·기능이 필수이고 기능은 그 솔루션 것이어야 한다. `build`/`na` 행은 솔루션·기능이 null이고 요구사항당 하나만이며 `fulfilled`/`partial`과 함께 있을 수 없다.
- LLM은 `claude-opus-5`(env `RFP_LLM_MODEL`), `thinking: { type: "adaptive" }`, `client.messages.stream` + `finalMessage()`, 구조화 출력 `output_config.format = zodOutputFormat(schema)`. 매핑 시스템 프롬프트의 카탈로그 블록에는 `cache_control: { type: "ephemeral" }`. `stop_reason === "refusal"`은 오류.
- 프롬프트에는 UUID 대신 별칭 `S{n}`·`F{n}`을 쓰고 서버가 되돌린다.
- Confluence는 사용자가 준 URL을 요청하지 않는다. 페이지 id만 뽑아 `ATLASSIAN_SITE`의 REST(`/wiki/rest/api/content/{id}?expand=body.storage,version`)를 부른다. 호스트가 다르면 400.
- 긴 작업 라우트는 `export const runtime = "nodejs"; export const maxDuration = 300;`. `running`이 6분(`STALE_RUNNING_MS`) 넘으면 멈춘 것으로 보고 재실행을 허용한다.
- 인증: 어드민 라우트는 `requireAdmin()` + `adminClientOr500()`(`lib/claude-usage/require-admin.ts`), 사용자 라우트는 `requireUser()`(`lib/rfp/require-user.ts`). DB는 service role. RLS는 켜되 관리자 읽기 정책만(1단계와 동일).
- SQL 파일은 멱등(`if not exists`, `on conflict do nothing`, `drop … if exists` 후 생성). 운영 DB 적용은 컨트롤러가 Management API로 한다(구현자는 파일만 작성).
- 스펙과 다른 결정을 내려야 하면 멈추고 컨트롤러에게 묻는다.

---

## 파일 구조

| 경로 | 책임 |
|---|---|
| `docs/sql/2026-09-04-rfp-solution-mapping.sql` | 테이블 4개, `rfp_projects.mapping_*`, 시드 5건, 트리거, RLS |
| `frontend/src/lib/rfp/mapping/types.ts` | Verdict 상수·라벨, CatalogSolution/CatalogFeature/MappingRow 타입, `STALE_RUNNING_MS` |
| `frontend/src/types/rfp.ts` | API 응답 타입 확장(매핑·카탈로그·어드민) |
| `frontend/src/lib/rfp/catalog/confluence.ts` | env 설정, URL → 페이지 id, 페이지 REST 조회(fetch 주입) |
| `frontend/src/lib/rfp/catalog/storage-text.ts` | storage XHTML → 텍스트 |
| `frontend/src/lib/rfp/catalog/merge-features.ts` | 기능 이름 정규화, 청크 결과 중복 제거, DB 병합 계획 |
| `frontend/src/lib/rfp/catalog/extract-features.ts` | 기능 추출 스키마·청크 호출·SDK 호출 함수 |
| `frontend/src/lib/rfp/catalog/store.ts` | 카탈로그 DB 행 타입, `loadCatalog`, 어드민 응답 매퍼 |
| `frontend/src/lib/rfp/catalog/import-job.ts` | `runImport` — 소스별 가져오기 잡 |
| `frontend/src/lib/rfp/mapping/chunk.ts` | 20건 청크, 세부 내용 1500자 절단 |
| `frontend/src/lib/rfp/mapping/prompt.ts` | 규칙 프롬프트, 카탈로그 블록 + 별칭 표, 청크 메시지 |
| `frontend/src/lib/rfp/mapping/validate.ts` | LLM 출력 검증, 수동 편집 규칙 검증 |
| `frontend/src/lib/rfp/mapping/summary.ts` | 요약 문자열, 판정별·솔루션별 건수 |
| `frontend/src/lib/rfp/mapping/llm.ts` | 출력 스키마, SDK 호출 함수(캐싱) |
| `frontend/src/lib/rfp/mapping/run-job.ts` | 대상 선정, 동시 실행, `runMapping` |
| `frontend/src/lib/rfp/mappers.ts` | `PROJECT_COLUMNS`·`ProjectDbRow`·`mapProjectDetail` 확장, `mapMapping` |
| `frontend/src/app/api/admin/rfp-catalog/solutions/route.ts` | GET 목록(건수 포함), POST 추가 |
| `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/route.ts` | PATCH, DELETE(참조 있으면 409) |
| `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/sources/route.ts` | GET, POST(URL 검사) |
| `frontend/src/app/api/admin/rfp-catalog/sources/[sourceId]/route.ts` | DELETE |
| `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/import/route.ts` | POST 실행(after), GET 상태 |
| `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/features/route.ts` | GET(매핑 참조 수 포함), POST |
| `frontend/src/app/api/admin/rfp-catalog/features/[featureId]/route.ts` | PATCH(edited=true), DELETE(참조 있으면 409) |
| `frontend/src/app/api/rfp/catalog/route.ts` | GET 사용자용 카탈로그 |
| `frontend/src/app/api/rfp/projects/[id]/mapping/route.ts` | POST 실행(after), GET 매핑+상태 |
| `frontend/src/app/api/rfp/projects/[id]/mapping/rows/route.ts` | POST 행 추가 |
| `frontend/src/app/api/rfp/mappings/[mappingId]/route.ts` | PATCH, DELETE |
| `frontend/src/app/api/rfp/projects/[id]/route.ts` | 상세에 매핑 포함, status 폴링에 mapping_* |
| `frontend/src/app/api/rfp/projects/route.ts` | 목록 응답 `mappingStatus`(mappers 변경으로 자동) |
| `frontend/src/app/api/rfp/requirements/[requirementId]/route.ts` | `solution` 필드 거부 |
| `frontend/src/lib/rfp/xlsx.ts` | 매핑 열·개요 요약·마지막 시트 |
| `frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts` | 매핑·카탈로그 로드해 전달 |
| `frontend/src/app/admin/layout.tsx` | 메뉴 항목 추가 |
| `frontend/src/app/admin/rfp-catalog/page.tsx` | 어드민 카탈로그 화면 |
| `frontend/src/components/admin/rfp-catalog/SolutionList.tsx` | 솔루션 목록·추가·편집 |
| `frontend/src/components/admin/rfp-catalog/SourceTable.tsx` | 소스 URL 표·가져오기·폴링 |
| `frontend/src/components/admin/rfp-catalog/FeatureTable.tsx` | 기능 표 인라인 편집 |
| `frontend/src/components/rfp/MappingRunButton.tsx` | 매핑 실행 버튼 + 모드 다이얼로그 |
| `frontend/src/components/rfp/MappingSummary.tsx` | 판정별·솔루션별 건수 칩 |
| `frontend/src/components/rfp/MappingEditor.tsx` | 요구사항 하나의 매핑 행 편집 |
| `frontend/src/components/rfp/RequirementsTable.tsx` | 솔루션 열 읽기 전용, 행 펼침, 판정 필터 |
| `frontend/src/components/rfp/OverviewCard.tsx` | 매핑 상태 배지·버튼 |
| `frontend/src/components/rfp/ProjectList.tsx` | 매핑 상태 열 |
| `frontend/src/app/rfp/[id]/page.tsx` | 카탈로그 로드, 매핑 폴링 |
| `docs/rfp-analyzer.md`, `CLAUDE.md` | 런북·프로젝트 문서 |

---

### Task 1: SQL 마이그레이션 + 공용 타입

**Files:**
- Create: `docs/sql/2026-09-04-rfp-solution-mapping.sql`
- Create: `frontend/src/lib/rfp/mapping/types.ts`
- Modify: `frontend/src/types/rfp.ts`

**Interfaces:**
- Produces: `VERDICTS`, `Verdict`, `VERDICT_ORDER`, `VERDICT_LABEL`, `UNMAPPED_LABEL`, `isVerdict(v)`, `requiresFeature(v)`, `STALE_RUNNING_MS`, `CatalogFeature`, `CatalogSolution`, `MappingRow` (lib); `RfpMappingStatus`, `RfpMapping`, `RfpCatalogFeature`, `RfpCatalogSolution`, `RfpCatalogResponse`, `MappingResponse`, `RfpAdminSolution`, `RfpSolutionSource`, `RfpAdminFeature` (types). `RfpProjectSummary.mappingStatus`, `RfpProjectDetail.{mappingError,mappingWarnings,mappingAt,mappings}`, `StatusResponse.{mappingStatus,mappingError,mappingAt}`.

- [ ] **Step 1: SQL 파일 작성**

```sql
-- RFP 분석 2단계 — 솔루션 기능 카탈로그 + 요구사항 매핑. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md

create table if not exists public.rfp_solutions (
  code text primary key,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.rfp_solutions (code, name, sort_order) values
  ('secloudit', 'SECloudit', 1),
  ('devopsit', 'Devopsit', 2),
  ('aicubeit', 'AICubeit', 3),
  ('tabcloudit', 'TabCloudit', 4),
  ('openstackit', 'Openstackit', 5)
on conflict (code) do nothing;

create table if not exists public.rfp_solution_sources (
  id uuid primary key default gen_random_uuid(),
  solution_code text not null references public.rfp_solutions(code) on delete cascade,
  url text not null,
  page_id text not null,
  title text,
  page_version int,
  import_status text not null default 'idle' check (import_status in ('idle','running','ready','failed')),
  imported_at timestamptz,
  feature_count int not null default 0,
  error text,
  note text,
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
  evidence_url text,
  source_id uuid references public.rfp_solution_sources(id) on delete set null,
  is_active boolean not null default true,
  edited boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (solution_code, name_norm)
);
create index if not exists rfp_solution_features_solution_idx on public.rfp_solution_features (solution_code, sort_order);

create table if not exists public.rfp_requirement_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  requirement_id uuid not null references public.rfp_requirements(id) on delete cascade,
  solution_code text references public.rfp_solutions(code) on delete set null,
  feature_id uuid references public.rfp_solution_features(id) on delete set null,
  verdict text not null check (verdict in ('fulfilled','partial','build','na')),
  rationale text not null default '',
  evidence_url text,
  edited boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rfp_requirement_mappings_req_idx on public.rfp_requirement_mappings (project_id, requirement_id, sort_order);
create index if not exists rfp_requirement_mappings_feature_idx on public.rfp_requirement_mappings (feature_id);

alter table public.rfp_projects
  add column if not exists mapping_status text not null default 'none',
  add column if not exists mapping_error text,
  add column if not exists mapping_warnings jsonb not null default '[]'::jsonb,
  add column if not exists mapping_at timestamptz;
alter table public.rfp_projects drop constraint if exists rfp_projects_mapping_status_check;
alter table public.rfp_projects add constraint rfp_projects_mapping_status_check check (mapping_status in ('none','running','ready','failed'));

-- updated_at 자동 갱신(1단계 함수 재사용)
drop trigger if exists rfp_solutions_set_updated_at on public.rfp_solutions;
create trigger rfp_solutions_set_updated_at before update on public.rfp_solutions
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_solution_sources_set_updated_at on public.rfp_solution_sources;
create trigger rfp_solution_sources_set_updated_at before update on public.rfp_solution_sources
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_solution_features_set_updated_at on public.rfp_solution_features;
create trigger rfp_solution_features_set_updated_at before update on public.rfp_solution_features
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_requirement_mappings_set_updated_at on public.rfp_requirement_mappings;
create trigger rfp_requirement_mappings_set_updated_at before update on public.rfp_requirement_mappings
  for each row execute function public.rfp_set_updated_at();

-- RLS: 서버(service_role)만 읽고 쓴다. 관리자 세션 읽기만 진단용으로 허용(1단계와 동일).
do $$
declare t text;
begin
  foreach t in array array['rfp_solutions','rfp_solution_sources','rfp_solution_features','rfp_requirement_mappings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format('create policy %I_admin_read on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))', t, t);
  end loop;
end $$;
```

- [ ] **Step 2: `frontend/src/lib/rfp/mapping/types.ts` 작성**

```ts
/** 판정 4값. 서버·화면·xlsx가 모두 이 상수를 쓴다(스펙 §4.2). */
export const VERDICTS = ["fulfilled", "partial", "build", "na"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_ORDER: readonly Verdict[] = VERDICTS;
export const VERDICT_LABEL: Record<Verdict, string> = {
  fulfilled: "충족",
  partial: "부분충족",
  build: "설계·구축영역",
  na: "해당없음",
};
export const UNMAPPED_LABEL = "미매핑";

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

/** 충족·부분충족은 솔루션+기능 필수, 설계·구축영역·해당없음은 둘 다 null */
export function requiresFeature(v: Verdict): boolean {
  return v === "fulfilled" || v === "partial";
}

/** running 상태가 이만큼 지나면 after()가 죽은 것으로 보고 재실행을 허용한다(1단계 extracting과 같은 6분). */
export const STALE_RUNNING_MS = 6 * 60 * 1000;

export interface CatalogFeature {
  id: string;
  solutionCode: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  isActive: boolean;
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

/** 매핑 행(순수 함수 입력). API 응답 RfpMapping은 여기에 updatedAt·updatedBy를 더한 것. */
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

- [ ] **Step 3: `frontend/src/types/rfp.ts` 확장**

파일 맨 위에 import를 추가하고, 기존 인터페이스 세 개에 필드를 넣고, 새 타입을 끝에 붙인다.

```ts
// 맨 위
import type { MappingRow, Verdict } from "@/lib/rfp/mapping/types";

export type RfpMappingStatus = "none" | "running" | "ready" | "failed";
export type RfpVerdict = Verdict;
```

`RfpProjectSummary`에 `mappingStatus: RfpMappingStatus;` 를 `requirementCount` 뒤에 추가.

`RfpProjectDetail`에 `warnings: string[];` 뒤에 추가:
```ts
  mappingError: string | null;
  mappingWarnings: string[];
  mappingAt: string | null;
  mappings: RfpMapping[];
```

`StatusResponse`에 `extractionMethod` 뒤에 추가:
```ts
  mappingStatus: RfpMappingStatus;
  mappingError: string | null;
  mappingAt: string | null;
```

파일 끝에 추가:
```ts
export interface RfpMapping extends MappingRow {
  updatedAt: string;
  updatedBy: string | null;
}

/** GET /api/rfp/projects/[id]/mapping */
export interface MappingResponse {
  mappingStatus: RfpMappingStatus;
  mappingError: string | null;
  mappingWarnings: string[];
  mappingAt: string | null;
  mappings: RfpMapping[];
}

/** GET /api/rfp/catalog — 활성 솔루션, 기능은 비활성 포함(isActive로 구분) */
export interface RfpCatalogFeature {
  id: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  isActive: boolean;
}
export interface RfpCatalogSolution {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  features: RfpCatalogFeature[];
}
export interface RfpCatalogResponse {
  solutions: RfpCatalogSolution[];
}

/** 어드민 /api/admin/rfp-catalog */
export interface RfpAdminSolution {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  featureCount: number;
  activeFeatureCount: number;
  sourceCount: number;
  updatedAt: string;
}
export type RfpImportStatus = "idle" | "running" | "ready" | "failed";
export interface RfpSolutionSource {
  id: string;
  url: string;
  pageId: string;
  title: string | null;
  pageVersion: number | null;
  importStatus: RfpImportStatus;
  importedAt: string | null;
  featureCount: number;
  error: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RfpAdminFeature {
  id: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  sourceId: string | null;
  isActive: boolean;
  edited: boolean;
  sortOrder: number;
  updatedAt: string;
  mappingCount: number;
}
```

- [ ] **Step 4: 타입 검사**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^$" | head -30`
Expected: `mappingStatus`가 없다는 오류가 `src/lib/rfp/mappers.ts`(mapProjectSummary·mapProjectDetail 반환값)와 `src/app/api/rfp/projects/[id]/route.ts`(StatusResponse)에서 난다. **이 두 파일은 Task 12에서 고친다.** 다른 파일에 오류가 없어야 한다. 그 오류만 남는지 확인하고 넘어간다.

- [ ] **Step 5: 커밋**

```bash
git add docs/sql/2026-09-04-rfp-solution-mapping.sql frontend/src/lib/rfp/mapping/types.ts frontend/src/types/rfp.ts
git commit -m "feat(rfp): 2단계 SQL(카탈로그·매핑 테이블·mapping_status)과 판정 상수·API 타입"
```

---

### Task 2: Confluence URL 파싱·페이지 조회

**Files:**
- Create: `frontend/src/lib/rfp/catalog/confluence.ts`
- Test: `frontend/src/lib/__tests__/rfp-catalog-confluence.test.ts`

**Interfaces:**
- Produces: `confluenceConfig(env?) → ConfluenceConfig | null` (`{site, host, auth}`), `parseConfluencePageId(url, expectedHost) → string` (throws `ConfluenceUrlError`), `fetchConfluencePage(cfg, pageId, fetchImpl?) → Promise<ConfluencePage>` (`{id, title, version, storageHtml}`, throws `ConfluenceFetchError{status}`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  confluenceConfig, parseConfluencePageId, fetchConfluencePage, ConfluenceUrlError, ConfluenceFetchError,
} from "@/lib/rfp/catalog/confluence";

const HOST = "nhnent.atlassian.net";
const ENV = { ATLASSIAN_SITE: `https://${HOST}/`, ATLASSIAN_EMAIL: "a@b.c", ATLASSIAN_API_TOKEN: "tok" } as NodeJS.ProcessEnv;

describe("confluenceConfig", () => {
  it("세 변수가 모두 있어야 하고 끝 슬래시를 떼고 host를 준다", () => {
    expect(confluenceConfig(ENV)).toMatchObject({ site: `https://${HOST}`, host: HOST });
    expect(confluenceConfig(ENV)!.auth).toMatch(/^Basic /);
    expect(confluenceConfig({ ATLASSIAN_SITE: `https://${HOST}` } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("parseConfluencePageId", () => {
  it("스페이스 경로·viewpage·pages 3형태에서 id를 뽑는다", () => {
    expect(parseConfluencePageId(`https://${HOST}/wiki/spaces/SEC/pages/123456/SECloudit+기능`, HOST)).toBe("123456");
    expect(parseConfluencePageId(`https://${HOST}/wiki/spaces/SEC/pages/123456`, HOST)).toBe("123456");
    expect(parseConfluencePageId(`https://${HOST}/wiki/pages/viewpage.action?pageId=987`, HOST)).toBe("987");
    expect(parseConfluencePageId(`  https://${HOST}/wiki/pages/555/  `, HOST)).toBe("555");
  });
  it("짧은 링크·다른 호스트·형식 불일치·URL 아님은 ConfluenceUrlError", () => {
    expect(() => parseConfluencePageId(`https://${HOST}/wiki/x/AbCd`, HOST)).toThrow(/짧은 링크/);
    expect(() => parseConfluencePageId("https://other.atlassian.net/wiki/spaces/A/pages/1", HOST)).toThrow(/설정된 Confluence 사이트\(nhnent\.atlassian\.net\)/);
    expect(() => parseConfluencePageId(`https://${HOST}/wiki/spaces/SEC/overview`, HOST)).toThrow(/전체 URL/);
    expect(() => parseConfluencePageId("not a url", HOST)).toThrow(ConfluenceUrlError);
  });
});

describe("fetchConfluencePage", () => {
  const cfg = confluenceConfig(ENV)!;
  it("id로 REST를 부르고 title·version·storage 본문을 돌려준다", async () => {
    let calledUrl = "";
    let authHeader = "";
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url);
      authHeader = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ id: "42", title: "기능 목록", version: { number: 7 }, body: { storage: { value: "<p>hi</p>" } } }), { status: 200 });
    }) as typeof fetch;
    await expect(fetchConfluencePage(cfg, "42", fetchImpl)).resolves.toEqual({ id: "42", title: "기능 목록", version: 7, storageHtml: "<p>hi</p>" });
    expect(calledUrl).toBe(`https://${HOST}/wiki/rest/api/content/42?expand=body.storage,version`);
    expect(authHeader).toBe(cfg.auth);
  });
  it("403·404·5xx는 ConfluenceFetchError와 한국어 문구", async () => {
    const mk = (status: number) => (async () => new Response("no", { status })) as typeof fetch;
    await expect(fetchConfluencePage(cfg, "1", mk(403))).rejects.toMatchObject({ status: 403, message: "권한 없음(403)" });
    await expect(fetchConfluencePage(cfg, "1", mk(404))).rejects.toMatchObject({ status: 404, message: "페이지 없음(404)" });
    await expect(fetchConfluencePage(cfg, "1", mk(500))).rejects.toBeInstanceOf(ConfluenceFetchError);
    await expect(fetchConfluencePage(cfg, "1", mk(500))).rejects.toThrow("Confluence 오류(500)");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-catalog-confluence`
Expected: FAIL — 모듈 `@/lib/rfp/catalog/confluence` 없음.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/rfp/catalog/confluence.ts
/**
 * Confluence Cloud 페이지 조회(스펙 §3.2). 사용자가 준 URL은 요청하지 않는다 — 페이지 id만 뽑아
 * ATLASSIAN_SITE의 REST를 부른다. 자격은 work-metrics/confluence.ts와 같은 ATLASSIAN_* Basic 인증.
 */
export interface ConfluenceConfig {
  /** 끝 슬래시 없는 사이트 URL: https://xxx.atlassian.net */
  site: string;
  /** URL 호스트 검사용: xxx.atlassian.net */
  host: string;
  /** "Basic base64(email:token)" */
  auth: string;
}

export function confluenceConfig(env: NodeJS.ProcessEnv = process.env): ConfluenceConfig | null {
  const site = (env.ATLASSIAN_SITE ?? "").trim().replace(/\/+$/, "");
  const email = (env.ATLASSIAN_EMAIL ?? "").trim();
  const token = (env.ATLASSIAN_API_TOKEN ?? "").trim();
  if (!site || !email || !token) return null;
  let host: string;
  try {
    host = new URL(site).host;
  } catch {
    return null;
  }
  return { site, host, auth: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
}

export class ConfluenceUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceUrlError";
  }
}

/**
 * 지원 URL: /wiki/spaces/{KEY}/pages/{id}[/{title}], /wiki/pages/{id}, /wiki/pages/viewpage.action?pageId={id}.
 * 짧은 링크(/wiki/x/…)와 다른 호스트는 거부한다.
 */
export function parseConfluencePageId(url: string, expectedHost: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new ConfluenceUrlError("올바른 URL이 아닙니다.");
  }
  if (u.host.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new ConfluenceUrlError(`설정된 Confluence 사이트(${expectedHost})의 페이지만 등록할 수 있습니다.`);
  }
  if (/^\/wiki\/x\//.test(u.pathname)) {
    throw new ConfluenceUrlError("짧은 링크(/wiki/x/…)는 지원하지 않습니다. 페이지 전체 URL을 넣어 주세요.");
  }
  const spaces = /^\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/|$)/.exec(u.pathname);
  if (spaces) return spaces[1];
  const pages = /^\/wiki\/pages\/(\d+)(?:\/|$)/.exec(u.pathname);
  if (pages) return pages[1];
  if (u.pathname === "/wiki/pages/viewpage.action") {
    const id = u.searchParams.get("pageId");
    if (id && /^\d+$/.test(id)) return id;
  }
  throw new ConfluenceUrlError("페이지 전체 URL을 넣어 주세요(예: https://…/wiki/spaces/KEY/pages/123456/제목).");
}

export class ConfluenceFetchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ConfluenceFetchError";
  }
}

export interface ConfluencePage {
  id: string;
  title: string;
  version: number;
  storageHtml: string;
}

interface ContentResponse {
  id?: string | number;
  title?: string;
  version?: { number?: number };
  body?: { storage?: { value?: string } };
}

/** GET {site}/wiki/rest/api/content/{id}?expand=body.storage,version — fetch는 테스트에서 주입 */
export async function fetchConfluencePage(cfg: ConfluenceConfig, pageId: string, fetchImpl: typeof fetch = fetch): Promise<ConfluencePage> {
  const res = await fetchImpl(`${cfg.site}/wiki/rest/api/content/${pageId}?expand=body.storage,version`, {
    headers: { Authorization: cfg.auth, Accept: "application/json" },
  });
  if (!res.ok) {
    const label = res.status === 403 ? "권한 없음(403)" : res.status === 404 ? "페이지 없음(404)" : `Confluence 오류(${res.status})`;
    throw new ConfluenceFetchError(res.status, label);
  }
  const j = (await res.json()) as ContentResponse;
  return {
    id: String(j.id ?? pageId),
    title: j.title ?? "",
    version: Number(j.version?.number ?? 0),
    storageHtml: j.body?.storage?.value ?? "",
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-catalog-confluence`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/confluence.ts frontend/src/lib/__tests__/rfp-catalog-confluence.test.ts
git commit -m "feat(rfp): Confluence URL → 페이지 id 파싱·REST 조회(호스트 검사, fetch 주입)"
```

---

### Task 3: storage XHTML → 텍스트

**Files:**
- Create: `frontend/src/lib/rfp/catalog/storage-text.ts`
- Test: `frontend/src/lib/__tests__/rfp-catalog-storage-text.test.ts`

**Interfaces:**
- Produces: `storageToText(xhtml: string): string`, `decodeEntities(s: string): string`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { storageToText, decodeEntities } from "@/lib/rfp/catalog/storage-text";

describe("decodeEntities", () => {
  it("이름·10진·16진 엔티티를 디코드하고 모르는 것은 남긴다", () => {
    expect(decodeEntities("a&nbsp;b &amp; &lt;x&gt; &quot;q&quot; &#39;s&#39; &#x41;&#66; &zzz;")).toBe("a b & <x> \"q\" 's' AB &zzz;");
  });
});

describe("storageToText", () => {
  it("표는 행마다 '| a | b |', 셀 안 줄바꿈은 공백", () => {
    const html = `<table><tbody><tr><th>기능</th><th>설명</th></tr><tr><td><p>SSO</p></td><td>통합<br/>인증</td></tr></tbody></table>`;
    expect(storageToText(html)).toBe("| 기능 | 설명 |\n| SSO | 통합 인증 |");
  });
  it("목록은 '- ', 제목은 '# ', 문단은 줄바꿈", () => {
    expect(storageToText(`<h2>주요 기능</h2><p>소개</p><ul><li>A</li><li><strong>B</strong></li></ul>`)).toBe("# 주요 기능\n소개\n- A\n- B");
  });
  it("이미지·ri·parameter는 내용까지 제거, 매크로 본문은 남기고 CDATA는 푼다", () => {
    const html = `<ac:image ac:width="300"><ri:attachment ri:filename="a.png" /></ac:image>` +
      `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>안내 본문</p></ac:rich-text-body></ac:structured-macro>` +
      `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[if (x < 1) y();]]></ac:plain-text-body></ac:structured-macro>`;
    expect(storageToText(html)).toBe("안내 본문\nif (x < 1) y();");
  });
  it("연속 공백은 하나로, 빈 줄은 모두 없앤다", () => {
    expect(storageToText(`<p>a&nbsp;&nbsp; b</p>\n\n\n<p></p><p></p><p>c</p>`)).toBe("a b\nc");
  });
  it("빈 입력은 빈 문자열", () => {
    expect(storageToText("")).toBe("");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-catalog-storage-text`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/rfp/catalog/storage-text.ts
/**
 * Confluence storage 포맷(XHTML + ac:/ri: 네임스페이스) → 평문(스펙 §3.2).
 * XML 파서 대신 정규식을 쓴다 — storage 본문은 HTML 엔티티와 닫히지 않은 태그가 섞여 파서가 자주 실패한다.
 */
const NAMED: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/** 내용까지 지우는 요소 */
const DROP = "ac:image|ri:[\\w-]+|ac:parameter|script|style";
/** 태그만 벗기고 줄바꿈으로 바꾸는 블록 요소 */
const BLOCK = "p|div|ul|ol|table|thead|tbody|tfoot|blockquote|pre|section|ac:structured-macro|ac:rich-text-body|ac:plain-text-body|ac:layout|ac:layout-section|ac:layout-cell";

export function storageToText(xhtml: string): string {
  let s = xhtml;
  // 1. 주석·CDATA·내용까지 지울 요소
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // CDATA에서 나온 "x < 1"처럼 태그가 아닌 '<'는 엔티티로 바꿔 stripTags가 삼키지 않게 한다
  s = s.replace(/<(?![a-zA-Z/!?])/g, "&lt;");
  s = s.replace(new RegExp(`<(${DROP})\\b[^>]*\\/>`, "gi"), "");
  s = s.replace(new RegExp(`<(${DROP})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), "");
  // 2. 표: 행마다 한 줄 "| a | b |"
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, inner: string) => {
    const cells = [...inner.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      stripTags(c[1].replace(/<br\s*\/?>/gi, " ")).replace(/\s+/g, " ").trim(),
    );
    return `\n| ${cells.join(" | ")} |\n`;
  });
  // 3. 블록 요소 → 줄바꿈·접두. 줄바꿈은 넉넉히 넣고 4단계에서 빈 줄을 모두 지운다(LLM 입력이라 단락 간 빈 줄은 필요 없다).
  s = s.replace(/<h[1-6]\b[^>]*>/gi, "\n# ").replace(/<\/h[1-6]>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(new RegExp(`<\\/?(${BLOCK})\\b[^>]*>`, "gi"), "\n");
  s = stripTags(s);
  s = decodeEntities(s);
  // 4. 공백 정리: 줄 안 연속 공백(nbsp 포함) → 하나, 빈 줄 제거
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-catalog-storage-text`
Expected: PASS (6 tests). 표 테스트에서 `<p>SSO</p>`가 셀 안에서 벗겨지고 `<br/>`가 공백이 되는지, 매크로 테스트에서 `# ` 접두가 붙지 않는지 확인한다. 블록 요소가 만든 빈 줄은 4단계 `filter(Boolean)`이 전부 지우므로 결과에 빈 줄이 없다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/storage-text.ts frontend/src/lib/__tests__/rfp-catalog-storage-text.test.ts
git commit -m "feat(rfp): Confluence storage XHTML → 텍스트(표 행 단위·목록·제목·매크로 본문 보존)"
```

---

### Task 4: 기능 이름 정규화·병합 계획

**Files:**
- Create: `frontend/src/lib/rfp/catalog/merge-features.ts`
- Test: `frontend/src/lib/__tests__/rfp-catalog-merge.test.ts`

**Interfaces:**
- Consumes: `normalizeName` from `@/lib/rfp/overview`(1단계).
- Produces: `FEATURE_NAME_MAX = 40`, `normalizeFeatureName(s)`, `IncomingFeature {name, description}`, `ExistingFeature {id, name, nameNorm, edited}`, `dedupeIncoming(features) → IncomingFeature[]`, `mergeFeatures(existing, incoming) → MergePlan {toInsert: {name,nameNorm,description}[], toUpdate: {id,description}[], skippedEdited: string[]}`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { normalizeFeatureName, dedupeIncoming, mergeFeatures, FEATURE_NAME_MAX, type ExistingFeature } from "@/lib/rfp/catalog/merge-features";

describe("normalizeFeatureName", () => {
  it("공백·기호·대소문자를 무시하고 괄호 안 내용은 남긴다", () => {
    expect(normalizeFeatureName("SSO (통합 인증)")).toBe(normalizeFeatureName("sso통합인증"));
    expect(normalizeFeatureName("멀티-테넌트 IAM")).toBe("멀티테넌트iam");
  });
});

describe("dedupeIncoming", () => {
  it("같은 이름은 설명이 긴 것을 남기고, 빈 이름은 버리고, 이름은 40자로 자른다", () => {
    const out = dedupeIncoming([
      { name: "SSO", description: "짧음" },
      { name: " sso ", description: "훨씬 더 긴 설명입니다" },
      { name: "", description: "x" },
      { name: "가".repeat(50), description: "d" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: "SSO", description: "훨씬 더 긴 설명입니다" });
    expect(out[1].name).toHaveLength(FEATURE_NAME_MAX);
  });
});

describe("mergeFeatures", () => {
  const existing: ExistingFeature[] = [
    { id: "f1", name: "SSO", nameNorm: "sso", edited: false },
    { id: "f2", name: "감사 로그", nameNorm: "감사로그", edited: true },
    { id: "f3", name: "예전 기능", nameNorm: "예전기능", edited: false },
  ];
  it("신규는 insert, 비편집 기존은 update, 편집된 기존은 skippedEdited, 이번에 없는 기존은 건드리지 않는다", () => {
    const plan = mergeFeatures(existing, [
      { name: "SSO", description: "새 설명" },
      { name: "감사로그", description: "덮어쓰기 시도" },
      { name: "백업", description: "신규" },
    ]);
    expect(plan.toInsert).toEqual([{ name: "백업", nameNorm: "백업", description: "신규" }]);
    expect(plan.toUpdate).toEqual([{ id: "f1", description: "새 설명" }]);
    expect(plan.skippedEdited).toEqual(["감사 로그"]);
  });
  it("들어온 목록 안의 중복은 한 번만 처리하고, 빈 이름은 건너뛴다", () => {
    const plan = mergeFeatures([], [{ name: "A", description: "1" }, { name: "a", description: "2" }, { name: "  ", description: "3" }]);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0].description).toBe("1");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-catalog-merge`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/rfp/catalog/merge-features.ts
import { normalizeName } from "../overview";

/** LLM 출력·수동 입력 모두 이 길이로 자른다 */
export const FEATURE_NAME_MAX = 40;

/** 1단계 사업명 정규화와 같은 규칙(NFKC → 소문자 → 공백·기호 제거, 괄호 안 내용은 유지) */
export function normalizeFeatureName(s: string): string {
  return normalizeName(s);
}

export interface IncomingFeature {
  name: string;
  description: string;
}

export interface ExistingFeature {
  id: string;
  name: string;
  nameNorm: string;
  edited: boolean;
}

export interface MergePlan {
  toInsert: { name: string; nameNorm: string; description: string }[];
  toUpdate: { id: string; description: string }[];
  /** 사람이 고쳐서 건너뛴 기존 기능의 이름 */
  skippedEdited: string[];
}

function clean(f: IncomingFeature): { name: string; nameNorm: string; description: string } | null {
  const name = f.name.trim().slice(0, FEATURE_NAME_MAX);
  if (!name) return null;
  const nameNorm = normalizeFeatureName(name);
  if (!nameNorm) return null;
  return { name, nameNorm, description: f.description.trim() };
}

/** 청크별 결과 합치기: 같은 이름(정규화)은 설명이 긴 것을 남긴다. 순서는 처음 등장한 순서. */
export function dedupeIncoming(features: IncomingFeature[]): IncomingFeature[] {
  const byNorm = new Map<string, { name: string; description: string }>();
  for (const raw of features) {
    const f = clean(raw);
    if (!f) continue;
    const cur = byNorm.get(f.nameNorm);
    if (!cur) byNorm.set(f.nameNorm, { name: f.name, description: f.description });
    else if (f.description.length > cur.description.length) cur.description = f.description;
  }
  return [...byNorm.values()];
}

/**
 * 스펙 §3.2 병합 규칙. 기존에 있고 edited=false → 설명 갱신, edited=true → 건너뜀, 없으면 추가.
 * 이번 결과에 없는 기존 기능은 지우지 않는다(어드민이 비활성화).
 */
export function mergeFeatures(existing: ExistingFeature[], incoming: IncomingFeature[]): MergePlan {
  const byNorm = new Map(existing.map((f) => [f.nameNorm, f]));
  const plan: MergePlan = { toInsert: [], toUpdate: [], skippedEdited: [] };
  const seen = new Set<string>();
  for (const raw of incoming) {
    const f = clean(raw);
    if (!f || seen.has(f.nameNorm)) continue;
    seen.add(f.nameNorm);
    const cur = byNorm.get(f.nameNorm);
    if (!cur) plan.toInsert.push(f);
    else if (cur.edited) plan.skippedEdited.push(cur.name);
    else plan.toUpdate.push({ id: cur.id, description: f.description });
  }
  return plan;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-catalog-merge`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/merge-features.ts frontend/src/lib/__tests__/rfp-catalog-merge.test.ts
git commit -m "feat(rfp): 카탈로그 기능 이름 정규화·청크 결과 중복 제거·DB 병합 계획(편집 항목 유지)"
```

---

### Task 5: Claude로 기능 목록 추출

**Files:**
- Create: `frontend/src/lib/rfp/catalog/extract-features.ts`
- Test: `frontend/src/lib/__tests__/rfp-catalog-extract-features.test.ts`

**Interfaces:**
- Consumes: `splitIntoChunks`, `LlmUnavailableError`, `DEFAULT_LLM_MODEL` from `@/lib/rfp/extract-llm`; `dedupeIncoming`, `IncomingFeature`, `FEATURE_NAME_MAX` from `./merge-features`.
- Produces: `FeatureOutputSchema`, `FeatureOutput`, `FeatureExtractCall = (chunk) => Promise<FeatureOutput>`, `SolutionInfo {name, description}`, `featureSystemPrompt(solution)`, `extractFeatures(text, call, opts?) → Promise<{features: IncomingFeature[]; warnings: string[]}>`, `createAnthropicFeatureCall(solution, opts?) → FeatureExtractCall`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { extractFeatures, featureSystemPrompt, createAnthropicFeatureCall, type FeatureExtractCall } from "@/lib/rfp/catalog/extract-features";
import { LlmUnavailableError } from "@/lib/rfp/extract-llm";

describe("featureSystemPrompt", () => {
  it("솔루션 이름·설명과 출력 규칙을 담는다", () => {
    const p = featureSystemPrompt({ name: "SECloudit", description: "멀티 클라우드 보안 플랫폼" });
    expect(p).toContain("SECloudit");
    expect(p).toContain("멀티 클라우드 보안 플랫폼");
    expect(p).toContain("40자");
  });
});

describe("extractFeatures", () => {
  it("청크마다 호출하고 결과를 이름 기준으로 합친다(긴 설명 우선)", async () => {
    const seen: string[] = [];
    const call: FeatureExtractCall = async (chunk) => {
      seen.push(chunk);
      return chunk.includes("둘째")
        ? { features: [{ name: "SSO", description: "훨씬 긴 설명" }, { name: "백업", description: "b" }] }
        : { features: [{ name: "SSO", description: "짧" }] };
    };
    const text = `${"첫째 줄 ".repeat(20)}\n${"둘째 줄 ".repeat(20)}`;
    const out = await extractFeatures(text, call, { maxChars: 120 });
    expect(seen).toHaveLength(2);
    expect(out.features).toEqual([{ name: "SSO", description: "훨씬 긴 설명" }, { name: "백업", description: "b" }]);
    expect(out.warnings).toEqual([]);
  });
  it("기능이 없으면 경고, 청크 실패는 번호를 붙여 던진다", async () => {
    const none = await extractFeatures("본문", async () => ({ features: [] }));
    expect(none.warnings).toEqual(["문서에서 기능을 찾지 못했습니다."]);
    await expect(extractFeatures("본문", async () => { throw new Error("boom"); })).rejects.toThrow("기능 추출 실패(청크 1/1): boom");
  });
});

describe("createAnthropicFeatureCall", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => { if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved; });
  it("키가 없으면 LlmUnavailableError", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => createAnthropicFeatureCall({ name: "X", description: "" })).toThrow(LlmUnavailableError);
  });
  it("키가 있으면 함수를 돌려준다(호출은 하지 않음)", () => {
    expect(typeof createAnthropicFeatureCall({ name: "X", description: "" }, { apiKey: "test-key" })).toBe("function");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-catalog-extract-features`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/rfp/catalog/extract-features.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_LLM_MODEL, LlmUnavailableError, splitIntoChunks } from "../extract-llm";
import { dedupeIncoming, FEATURE_NAME_MAX, type IncomingFeature } from "./merge-features";

export const FeatureOutputSchema = z.object({
  features: z.array(z.object({ name: z.string(), description: z.string() })),
});
export type FeatureOutput = z.infer<typeof FeatureOutputSchema>;

/** 청크 텍스트 → 기능 목록. 테스트에서는 가짜 함수를 넣는다. */
export type FeatureExtractCall = (chunk: string) => Promise<FeatureOutput>;

export interface SolutionInfo {
  name: string;
  description: string;
}

export function featureSystemPrompt(solution: SolutionInfo): string {
  return `당신은 당사 솔루션 "${solution.name}"의 제품 문서를 읽고 기능 목록을 정리하는 프리세일즈 분석가입니다.
솔루션 소개: ${solution.description || "(설명 없음)"}

주어진 문서 조각에서 이 솔루션이 제공하는 "기능"을 모두 찾아 아래 형식으로 정리합니다.
- name: 기능 이름. 40자 이내의 명사구(예: "멀티테넌트 IAM", "파이프라인 템플릿"). 문서의 용어를 그대로 씁니다.
- description: 그 기능이 무엇을 해 주는지 1~3문장. 고객 요구사항과 대조할 수 있게 구체적으로 씁니다.
문서에 없는 기능을 만들지 않습니다. 회의록·일정·담당자·이슈 같은 기능이 아닌 내용은 넣지 않습니다.
같은 기능이 여러 표현으로 나오면 하나로 합칩니다. 결과는 스키마에 맞는 JSON만 출력합니다.`;
}

/** 텍스트를 30,000자 청크로 나눠 호출하고 이름 기준으로 합친다(스펙 §3.2). 청크 하나가 실패하면 소스 전체 실패. */
export async function extractFeatures(
  text: string,
  call: FeatureExtractCall,
  opts: { maxChars?: number } = {},
): Promise<{ features: IncomingFeature[]; warnings: string[] }> {
  const chunks = splitIntoChunks(text, opts.maxChars ?? 30000);
  const all: IncomingFeature[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let out: FeatureOutput;
    try {
      out = await call(chunks[i]);
    } catch (e) {
      throw new Error(`기능 추출 실패(청크 ${i + 1}/${chunks.length}): ${e instanceof Error ? e.message : String(e)}`);
    }
    all.push(...out.features.map((f) => ({ name: f.name.slice(0, FEATURE_NAME_MAX), description: f.description })));
  }
  const features = dedupeIncoming(all);
  const warnings: string[] = [];
  if (!features.length) warnings.push("문서에서 기능을 찾지 못했습니다.");
  return { features, warnings };
}

/** Anthropic SDK 호출 함수(1단계 createAnthropicExtractCall과 같은 규약). 키가 없으면 LlmUnavailableError. */
export function createAnthropicFeatureCall(solution: SolutionInfo, opts: { apiKey?: string; model?: string } = {}): FeatureExtractCall {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const model = opts.model ?? process.env.RFP_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const client = new Anthropic({ apiKey });
  const system = featureSystemPrompt(solution);
  return async (chunk) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: `다음 제품 문서에서 기능 목록을 정리하세요.\n\n${chunk}` }],
      output_config: { format: zodOutputFormat(FeatureOutputSchema) },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("모델이 요청을 거부했습니다.");
    if (msg.stop_reason === "max_tokens") throw new Error("출력이 max_tokens에 잘렸습니다.");
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("");
    return FeatureOutputSchema.parse(JSON.parse(text));
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-catalog-extract-features`
Expected: PASS (5 tests). `maxChars: 120`으로 두 청크가 나오는지(첫째·둘째 줄이 각 ~100자) 확인. 안 나뉘면 `repeat` 수를 늘려 120자를 넘기게 조정한다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/extract-features.ts frontend/src/lib/__tests__/rfp-catalog-extract-features.test.ts
git commit -m "feat(rfp): Confluence 본문 → Claude 기능 목록 추출(청크·스키마·SDK 호출 주입)"
```

---

### Task 6: 카탈로그 저장소·가져오기 잡·어드민 솔루션/소스/가져오기 라우트

**Files:**
- Create: `frontend/src/lib/rfp/catalog/store.ts`
- Create: `frontend/src/lib/rfp/catalog/import-job.ts`
- Create: `frontend/src/app/api/admin/rfp-catalog/solutions/route.ts`
- Create: `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/route.ts`
- Create: `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/sources/route.ts`
- Create: `frontend/src/app/api/admin/rfp-catalog/sources/[sourceId]/route.ts`
- Create: `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/import/route.ts`

**Interfaces:**
- Consumes: Task 1 타입, Task 2 `confluenceConfig`·`parseConfluencePageId`·`fetchConfluencePage`·`ConfluenceUrlError`, Task 3 `storageToText`, Task 4 `mergeFeatures`, Task 5 `extractFeatures`·`createAnthropicFeatureCall`; `requireAdmin`·`adminClientOr500` from `@/lib/claude-usage/require-admin`.
- Produces: `SOLUTION_CODE_RE`, `SOLUTION_COLUMNS`/`SOURCE_COLUMNS`/`FEATURE_COLUMNS`, `SolutionDbRow`/`SourceDbRow`/`FeatureDbRow`, `mapFeature(row) → CatalogFeature`, `mapAdminSolution(row, counts)`, `mapSource(row)`, `mapAdminFeature(row, mappingCount)`, `loadCatalog(admin, {activeSolutionsOnly?}) → Promise<CatalogSolution[]>`, `runImport(admin, solutionCode, sourceIds, deps?)`.

- [ ] **Step 1: `store.ts` 작성**

```ts
// frontend/src/lib/rfp/catalog/store.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogFeature, CatalogSolution } from "../mapping/types";
import type { RfpAdminFeature, RfpAdminSolution, RfpImportStatus, RfpSolutionSource } from "@/types/rfp";

export const SOLUTION_CODE_RE = /^[a-z0-9-]{2,30}$/;

export const SOLUTION_COLUMNS = "code, name, description, is_active, sort_order, updated_at";
export const SOURCE_COLUMNS = "id, solution_code, url, page_id, title, page_version, import_status, imported_at, feature_count, error, note, created_at, updated_at";
export const FEATURE_COLUMNS = "id, solution_code, name, name_norm, description, evidence_url, source_id, is_active, edited, sort_order, updated_at";

export interface SolutionDbRow {
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  updated_at: string;
}

export interface SourceDbRow {
  id: string;
  solution_code: string;
  url: string;
  page_id: string;
  title: string | null;
  page_version: number | null;
  import_status: RfpImportStatus;
  imported_at: string | null;
  feature_count: number;
  error: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureDbRow {
  id: string;
  solution_code: string;
  name: string;
  name_norm: string;
  description: string;
  evidence_url: string | null;
  source_id: string | null;
  is_active: boolean;
  edited: boolean;
  sort_order: number;
  updated_at: string;
}

export function mapFeature(row: FeatureDbRow): CatalogFeature {
  return { id: row.id, solutionCode: row.solution_code, name: row.name, description: row.description, evidenceUrl: row.evidence_url, isActive: row.is_active };
}

export function mapAdminSolution(row: SolutionDbRow, counts: { total: number; active: number; sources: number }): RfpAdminSolution {
  return {
    code: row.code, name: row.name, description: row.description, isActive: row.is_active, sortOrder: row.sort_order,
    featureCount: counts.total, activeFeatureCount: counts.active, sourceCount: counts.sources, updatedAt: row.updated_at,
  };
}

export function mapSource(row: SourceDbRow): RfpSolutionSource {
  return {
    id: row.id, url: row.url, pageId: row.page_id, title: row.title, pageVersion: row.page_version, importStatus: row.import_status,
    importedAt: row.imported_at, featureCount: row.feature_count, error: row.error, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function mapAdminFeature(row: FeatureDbRow, mappingCount: number): RfpAdminFeature {
  return {
    id: row.id, name: row.name, description: row.description, evidenceUrl: row.evidence_url, sourceId: row.source_id,
    isActive: row.is_active, edited: row.edited, sortOrder: row.sort_order, updatedAt: row.updated_at, mappingCount,
  };
}

/**
 * 카탈로그 전체. 기능은 비활성 포함(매핑이 참조하는 이름을 그려야 함) — 활성만 필요하면 호출 쪽에서 거른다.
 * 솔루션 수 개 × 기능 수십 개라 Supabase 1000행 상한에 걸리지 않는다.
 */
export async function loadCatalog(admin: SupabaseClient, opts: { activeSolutionsOnly?: boolean } = {}): Promise<CatalogSolution[]> {
  const base = admin.from("rfp_solutions").select(SOLUTION_COLUMNS);
  const solutionsQuery = (opts.activeSolutionsOnly ? base.eq("is_active", true) : base).order("sort_order").order("code");
  const [sols, feats] = await Promise.all([
    solutionsQuery,
    admin.from("rfp_solution_features").select(FEATURE_COLUMNS).order("sort_order").order("name"),
  ]);
  if (sols.error) throw new Error(sols.error.message);
  if (feats.error) throw new Error(feats.error.message);
  const byCode = new Map<string, CatalogFeature[]>();
  for (const f of (feats.data ?? []) as FeatureDbRow[]) {
    const list = byCode.get(f.solution_code) ?? [];
    list.push(mapFeature(f));
    byCode.set(f.solution_code, list);
  }
  return ((sols.data ?? []) as SolutionDbRow[]).map((s) => ({
    code: s.code, name: s.name, description: s.description, isActive: s.is_active, sortOrder: s.sort_order, features: byCode.get(s.code) ?? [],
  }));
}
```

- [ ] **Step 2: `import-job.ts` 작성**

```ts
// frontend/src/lib/rfp/catalog/import-job.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { confluenceConfig, fetchConfluencePage, type ConfluenceConfig, type ConfluencePage } from "./confluence";
import { storageToText } from "./storage-text";
import { createAnthropicFeatureCall, extractFeatures, type FeatureExtractCall, type SolutionInfo } from "./extract-features";
import { mergeFeatures, type ExistingFeature } from "./merge-features";

export interface ImportDeps {
  fetchPage: (cfg: ConfluenceConfig, pageId: string) => Promise<ConfluencePage>;
  makeCall: (solution: SolutionInfo) => FeatureExtractCall;
}

const DEFAULT_DEPS: ImportDeps = {
  fetchPage: (cfg, pageId) => fetchConfluencePage(cfg, pageId),
  makeCall: (solution) => createAnthropicFeatureCall(solution),
};

interface ExistingRow {
  id: string;
  name: string;
  name_norm: string;
  edited: boolean;
  sort_order: number;
}

/**
 * 스펙 §3.2 잡. 소스마다 Confluence 조회 → 텍스트 → 기능 추출 → 병합. 소스 하나가 실패해도 다음 소스는 계속하고
 * 어떤 경우에도 import_status를 ready 또는 failed로 끝낸다(running으로 남기지 않는다).
 */
export async function runImport(admin: SupabaseClient, solutionCode: string, sourceIds: string[], deps: ImportDeps = DEFAULT_DEPS): Promise<void> {
  if (!sourceIds.length) return;
  const failAll = async (message: string) => {
    await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).in("id", sourceIds);
  };
  const cfg = confluenceConfig();
  if (!cfg) return await failAll("ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다.");
  const { data: sol, error: solError } = await admin.from("rfp_solutions").select("code, name, description").eq("code", solutionCode).maybeSingle();
  if (solError || !sol) return await failAll(solError?.message ?? "솔루션이 없습니다.");
  let call: FeatureExtractCall;
  try {
    call = deps.makeCall({ name: sol.name as string, description: (sol.description as string) ?? "" });
  } catch (e) {
    return await failAll(e instanceof Error ? e.message : String(e));
  }

  for (const sourceId of sourceIds) {
    const fail = async (message: string) => {
      await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).eq("id", sourceId);
    };
    try {
      const { data: src, error: srcError } = await admin.from("rfp_solution_sources").select("id, url, page_id").eq("id", sourceId).maybeSingle();
      if (srcError) throw new Error(srcError.message);
      if (!src) continue;
      const page = await deps.fetchPage(cfg, src.page_id as string);
      const text = storageToText(page.storageHtml);
      const extracted = text ? await extractFeatures(text, call) : { features: [], warnings: ["페이지 본문이 비어 있습니다."] };

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
            solution_code: solutionCode, name: f.name, name_norm: f.nameNorm, description: f.description,
            evidence_url: src.url as string, source_id: sourceId, sort_order: ++sort,
          })),
        );
        if (error) throw new Error(error.message);
      }
      for (const u of plan.toUpdate) {
        const { error } = await admin.from("rfp_solution_features").update({ description: u.description, evidence_url: src.url as string, source_id: sourceId }).eq("id", u.id);
        if (error) throw new Error(error.message);
      }
      const notes = [...extracted.warnings];
      if (plan.skippedEdited.length) notes.push(`사람이 고친 기능 ${plan.skippedEdited.length}개는 유지했습니다.`);
      await admin
        .from("rfp_solution_sources")
        .update({
          import_status: "ready", error: null, note: notes.join(" ") || null, title: page.title, page_version: page.version,
          imported_at: new Date().toISOString(), feature_count: plan.toInsert.length + plan.toUpdate.length,
        })
        .eq("id", sourceId);
    } catch (e) {
      console.error("[rfp] catalog import failed", solutionCode, sourceId, e);
      await fail(e instanceof Error ? e.message : String(e));
    }
  }
}
```

- [ ] **Step 3: `solutions/route.ts` (GET·POST)**

```ts
// frontend/src/app/api/admin/rfp-catalog/solutions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOLUTION_CODE_RE, SOLUTION_COLUMNS, mapAdminSolution, type SolutionDbRow } from "@/lib/rfp/catalog/store";

export const runtime = "nodejs";

type Counts = { total: number; active: number; sources: number };

/** GET /api/admin/rfp-catalog/solutions — 솔루션 목록 + 기능·활성 기능·소스 건수 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const [sols, feats, srcs] = await Promise.all([
    a.admin.from("rfp_solutions").select(SOLUTION_COLUMNS).order("sort_order").order("code"),
    a.admin.from("rfp_solution_features").select("solution_code, is_active"),
    a.admin.from("rfp_solution_sources").select("solution_code"),
  ]);
  for (const r of [sols, feats, srcs]) if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const counts = new Map<string, Counts>();
  const bump = (code: string): Counts => {
    let c = counts.get(code);
    if (!c) { c = { total: 0, active: 0, sources: 0 }; counts.set(code, c); }
    return c;
  };
  for (const f of (feats.data ?? []) as { solution_code: string; is_active: boolean }[]) {
    const c = bump(f.solution_code);
    c.total += 1;
    if (f.is_active) c.active += 1;
  }
  for (const s of (srcs.data ?? []) as { solution_code: string }[]) bump(s.solution_code).sources += 1;
  const empty: Counts = { total: 0, active: 0, sources: 0 };
  return NextResponse.json({ solutions: ((sols.data ?? []) as SolutionDbRow[]).map((r) => mapAdminSolution(r, counts.get(r.code) ?? empty)) });
}

/** POST /api/admin/rfp-catalog/solutions {code, name, description?} → 201 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const body = (await request.json().catch(() => null)) as { code?: unknown; name?: unknown; description?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!SOLUTION_CODE_RE.test(code)) return NextResponse.json({ error: "코드는 소문자 영숫자·하이픈 2~30자입니다." }, { status: 400 });
  if (!name || name.length > 100) return NextResponse.json({ error: "이름은 1~100자입니다." }, { status: 400 });
  if (description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
  const { data: last } = await a.admin.from("rfp_solutions").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await a.admin
    .from("rfp_solutions")
    .insert({ code, name, description, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1, updated_by: auth.userId })
    .select(SOLUTION_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 코드의 솔루션이 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapAdminSolution(data as SolutionDbRow, { total: 0, active: 0, sources: 0 }), { status: 201 });
}
```

- [ ] **Step 4: `solutions/[code]/route.ts` (PATCH·DELETE)**

```ts
// frontend/src/app/api/admin/rfp-catalog/solutions/[code]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOLUTION_CODE_RE, SOLUTION_COLUMNS, mapAdminSolution, type SolutionDbRow } from "@/lib/rfp/catalog/store";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** PATCH /api/admin/rfp-catalog/solutions/[code] {name?, description?, isActive?, sortOrder?} — code는 바꿀 수 없다 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  if (!SOLUTION_CODE_RE.test(code)) return NextResponse.json({ error: "잘못된 솔루션 코드입니다." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  const patch: Record<string, unknown> = { updated_by: auth.userId };
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) return NextResponse.json({ error: "이름은 1~100자입니다." }, { status: 400 });
    patch.name = body.name.trim();
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || body.description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
    patch.description = body.description.trim();
  }
  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "isActive는 불리언이어야 합니다." }, { status: 400 });
    patch.is_active = body.isActive;
  }
  if ("sortOrder" in body) {
    if (typeof body.sortOrder !== "number" || !Number.isInteger(body.sortOrder)) return NextResponse.json({ error: "sortOrder는 정수여야 합니다." }, { status: 400 });
    patch.sort_order = body.sortOrder;
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });
  const { data, error } = await a.admin.from("rfp_solutions").update(patch).eq("code", code).select(SOLUTION_COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  const [feats, srcs] = await Promise.all([
    a.admin.from("rfp_solution_features").select("is_active").eq("solution_code", code),
    a.admin.from("rfp_solution_sources").select("id", { count: "exact", head: true }).eq("solution_code", code),
  ]);
  const list = (feats.data ?? []) as { is_active: boolean }[];
  return NextResponse.json(mapAdminSolution(data as SolutionDbRow, { total: list.length, active: list.filter((f) => f.is_active).length, sources: srcs.count ?? 0 }));
}

/** DELETE /api/admin/rfp-catalog/solutions/[code] — 기능·매핑이 참조하면 409(비활성으로 바꾸라고 안내) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const [feats, maps] = await Promise.all([
    a.admin.from("rfp_solution_features").select("id", { count: "exact", head: true }).eq("solution_code", code),
    a.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("solution_code", code),
  ]);
  if (feats.error) return NextResponse.json({ error: feats.error.message }, { status: 500 });
  if (maps.error) return NextResponse.json({ error: maps.error.message }, { status: 500 });
  if ((feats.count ?? 0) > 0 || (maps.count ?? 0) > 0) {
    return NextResponse.json({ error: `기능 ${feats.count ?? 0}개·매핑 ${maps.count ?? 0}건이 참조합니다. 삭제 대신 비활성으로 바꾸세요.` }, { status: 409 });
  }
  const { data, error } = await a.admin.from("rfp_solutions").delete().eq("code", code).select("code").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: `solutions/[code]/sources/route.ts` (GET·POST)와 `sources/[sourceId]/route.ts` (DELETE)**

```ts
// frontend/src/app/api/admin/rfp-catalog/solutions/[code]/sources/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, mapSource, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig, ConfluenceUrlError, parseConfluencePageId } from "@/lib/rfp/catalog/confluence";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** GET /api/admin/rfp-catalog/solutions/[code]/sources — 가져오기 폴링에도 쓴다 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: ((data ?? []) as SourceDbRow[]).map(mapSource) });
}

/** POST /api/admin/rfp-catalog/solutions/[code]/sources {url} → 201. URL은 페이지 id만 뽑고 호스트를 검사한다(스펙 §3.2). */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const cfg = confluenceConfig();
  if (!cfg) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000) return NextResponse.json({ error: "url이 필요합니다." }, { status: 400 });
  let pageId: string;
  try {
    pageId = parseConfluencePageId(url, cfg.host);
  } catch (e) {
    if (e instanceof ConfluenceUrlError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const { data: sol } = await a.admin.from("rfp_solutions").select("code").eq("code", code).maybeSingle();
  if (!sol) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  const { data, error } = await a.admin
    .from("rfp_solution_sources")
    .insert({ solution_code: code, url, page_id: pageId, created_by: auth.userId })
    .select(SOURCE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 페이지가 이미 등록돼 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapSource(data as SourceDbRow), { status: 201 });
}
```

```ts
// frontend/src/app/api/admin/rfp-catalog/sources/[sourceId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";

export const runtime = "nodejs";

/** DELETE /api/admin/rfp-catalog/sources/[sourceId] → 204. 그 소스에서 온 기능은 남고 source_id만 null(FK set null). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { sourceId } = await params;
  const { data, error } = await a.admin.from("rfp_solution_sources").delete().eq("id", sourceId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "소스가 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 6: `solutions/[code]/import/route.ts` (POST·GET)**

```ts
// frontend/src/app/api/admin/rfp-catalog/solutions/[code]/import/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, mapSource, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig } from "@/lib/rfp/catalog/confluence";
import { runImport } from "@/lib/rfp/catalog/import-job";
import { STALE_RUNNING_MS } from "@/lib/rfp/mapping/types";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ code: string }> };

function isRunning(s: SourceDbRow): boolean {
  return s.import_status === "running" && Date.now() - Date.parse(s.updated_at) <= STALE_RUNNING_MS;
}

/** GET /api/admin/rfp-catalog/solutions/[code]/import — {running, sources} 폴링용 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as SourceDbRow[];
  return NextResponse.json({ running: rows.some(isRunning), sources: rows.map(mapSource) });
}

/**
 * POST /api/admin/rfp-catalog/solutions/[code]/import {sourceIds?: string[]}
 * 400(env·소스 없음) / 409(6분 이내 running) / 202 {started, sourceIds} + after(runImport)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  if (!confluenceConfig()) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { sourceIds?: unknown };
  const wanted = Array.isArray(body.sourceIds) ? body.sourceIds.filter((s): s is string => typeof s === "string") : null;

  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = (data ?? []) as SourceDbRow[];
  const targets = wanted ? all.filter((s) => wanted.includes(s.id)) : all;
  if (!targets.length) return NextResponse.json({ error: "등록된 소스가 없습니다. Confluence 페이지 URL을 먼저 추가하세요." }, { status: 400 });
  if (targets.some(isRunning)) return NextResponse.json({ error: "이미 가져오는 중입니다. 잠시 뒤 다시 시도하세요." }, { status: 409 });

  const ids = targets.map((s) => s.id);
  const { error: upError } = await a.admin.from("rfp_solution_sources").update({ import_status: "running", error: null, note: null }).in("id", ids);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });
  const admin = a.admin;
  after(async () => {
    await runImport(admin, code, ids);
  });
  return NextResponse.json({ started: true, sourceIds: ids }, { status: 202 });
}
```

- [ ] **Step 7: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "mappers.ts\|projects/\[id\]/route.ts" | head -20 && npm run lint -- src/lib/rfp/catalog src/app/api/admin/rfp-catalog`
Expected: Task 1에서 예고한 두 파일 외 오류 없음. lint 통과.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/rfp/catalog/store.ts frontend/src/lib/rfp/catalog/import-job.ts frontend/src/app/api/admin/rfp-catalog
git commit -m "feat(rfp): 카탈로그 저장소·Confluence 가져오기 잡·어드민 솔루션/소스/가져오기 API"
```

---

### Task 7: 어드민 기능 라우트 + 사용자용 카탈로그 조회

**Files:**
- Create: `frontend/src/app/api/admin/rfp-catalog/solutions/[code]/features/route.ts`
- Create: `frontend/src/app/api/admin/rfp-catalog/features/[featureId]/route.ts`
- Create: `frontend/src/app/api/rfp/catalog/route.ts`

**Interfaces:**
- Consumes: Task 6 `FEATURE_COLUMNS`·`mapAdminFeature`·`loadCatalog`·`FeatureDbRow`, Task 4 `normalizeFeatureName`·`FEATURE_NAME_MAX`, `selectAll` from `@/lib/work-metrics/common`, `requireUser`.
- Produces: 라우트만.

- [ ] **Step 1: `solutions/[code]/features/route.ts` (GET·POST)**

```ts
// frontend/src/app/api/admin/rfp-catalog/solutions/[code]/features/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { FEATURE_COLUMNS, mapAdminFeature, type FeatureDbRow } from "@/lib/rfp/catalog/store";
import { FEATURE_NAME_MAX, normalizeFeatureName } from "@/lib/rfp/catalog/merge-features";
import { selectAll } from "@/lib/work-metrics/common";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** GET /api/admin/rfp-catalog/solutions/[code]/features — 매핑 참조 수 포함(매핑은 프로젝트가 늘면 1000행을 넘을 수 있어 selectAll) */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const [feats, maps] = await Promise.all([
    a.admin.from("rfp_solution_features").select(FEATURE_COLUMNS).eq("solution_code", code).order("sort_order").order("name"),
    selectAll<{ feature_id: string | null }>(() => a.admin.from("rfp_requirement_mappings").select("feature_id", { count: "exact" }).eq("solution_code", code)),
  ]);
  if (feats.error) return NextResponse.json({ error: feats.error.message }, { status: 500 });
  if (maps.error) return NextResponse.json({ error: maps.error.message }, { status: 500 });
  const counts = new Map<string, number>();
  for (const m of maps.data) if (m.feature_id) counts.set(m.feature_id, (counts.get(m.feature_id) ?? 0) + 1);
  return NextResponse.json({ features: ((feats.data ?? []) as FeatureDbRow[]).map((f) => mapAdminFeature(f, counts.get(f.id) ?? 0)) });
}

/** POST /api/admin/rfp-catalog/solutions/[code]/features {name, description?, evidenceUrl?} → edited=true, 201 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown; evidenceUrl?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const evidenceUrl = typeof body?.evidenceUrl === "string" && body.evidenceUrl.trim() ? body.evidenceUrl.trim() : null;
  if (!name || name.length > FEATURE_NAME_MAX) return NextResponse.json({ error: `기능 이름은 1~${FEATURE_NAME_MAX}자입니다.` }, { status: 400 });
  if (description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
  if (evidenceUrl && evidenceUrl.length > 2000) return NextResponse.json({ error: "근거 URL이 너무 깁니다." }, { status: 400 });
  const { data: sol } = await a.admin.from("rfp_solutions").select("code").eq("code", code).maybeSingle();
  if (!sol) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  const { data: last } = await a.admin.from("rfp_solution_features").select("sort_order").eq("solution_code", code).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await a.admin
    .from("rfp_solution_features")
    .insert({
      solution_code: code, name, name_norm: normalizeFeatureName(name), description, evidence_url: evidenceUrl,
      edited: true, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1, updated_by: auth.userId,
    })
    .select(FEATURE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 이름의 기능이 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapAdminFeature(data as FeatureDbRow, 0), { status: 201 });
}
```

- [ ] **Step 2: `features/[featureId]/route.ts` (PATCH·DELETE)**

```ts
// frontend/src/app/api/admin/rfp-catalog/features/[featureId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { FEATURE_COLUMNS, mapAdminFeature, type FeatureDbRow } from "@/lib/rfp/catalog/store";
import { FEATURE_NAME_MAX, normalizeFeatureName } from "@/lib/rfp/catalog/merge-features";

export const runtime = "nodejs";
type Params = { params: Promise<{ featureId: string }> };

/** PATCH /api/admin/rfp-catalog/features/[featureId] {name?, description?, evidenceUrl?, isActive?, sortOrder?} — 어떤 필드든 바꾸면 edited=true */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { featureId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  const patch: Record<string, unknown> = { edited: true, updated_by: auth.userId };
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > FEATURE_NAME_MAX) {
      return NextResponse.json({ error: `기능 이름은 1~${FEATURE_NAME_MAX}자입니다.` }, { status: 400 });
    }
    patch.name = body.name.trim();
    patch.name_norm = normalizeFeatureName(body.name);
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || body.description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
    patch.description = body.description.trim();
  }
  if ("evidenceUrl" in body) {
    if (body.evidenceUrl !== null && typeof body.evidenceUrl !== "string") return NextResponse.json({ error: "evidenceUrl은 문자열 또는 null이어야 합니다." }, { status: 400 });
    const v = typeof body.evidenceUrl === "string" ? body.evidenceUrl.trim() : "";
    if (v.length > 2000) return NextResponse.json({ error: "근거 URL이 너무 깁니다." }, { status: 400 });
    patch.evidence_url = v || null;
  }
  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "isActive는 불리언이어야 합니다." }, { status: 400 });
    patch.is_active = body.isActive;
  }
  if ("sortOrder" in body) {
    if (typeof body.sortOrder !== "number" || !Number.isInteger(body.sortOrder)) return NextResponse.json({ error: "sortOrder는 정수여야 합니다." }, { status: 400 });
    patch.sort_order = body.sortOrder;
  }
  if (Object.keys(patch).length === 2) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });
  const { data, error } = await a.admin.from("rfp_solution_features").update(patch).eq("id", featureId).select(FEATURE_COLUMNS).maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 이름의 기능이 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "기능이 없습니다." }, { status: 404 });
  const { count } = await a.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("feature_id", featureId);
  return NextResponse.json(mapAdminFeature(data as FeatureDbRow, count ?? 0));
}

/** DELETE /api/admin/rfp-catalog/features/[featureId] — 매핑이 참조하면 409 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { featureId } = await params;
  const { count, error: countError } = await a.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("feature_id", featureId);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if ((count ?? 0) > 0) return NextResponse.json({ error: `매핑 ${count}건이 참조합니다. 삭제 대신 비활성으로 바꾸세요.` }, { status: 409 });
  const { data, error } = await a.admin.from("rfp_solution_features").delete().eq("id", featureId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "기능이 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: `api/rfp/catalog/route.ts` (GET, user 이상)**

```ts
// frontend/src/app/api/rfp/catalog/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import type { RfpCatalogResponse } from "@/types/rfp";

export const runtime = "nodejs";

/** GET /api/rfp/catalog — 활성 솔루션, 기능은 비활성 포함(isActive로 구분). 콤보박스·요약 렌더용. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    const catalog = await loadCatalog(auth.admin, { activeSolutionsOnly: true });
    const res: RfpCatalogResponse = {
      solutions: catalog.map((s) => ({
        code: s.code, name: s.name, description: s.description, isActive: s.isActive,
        features: s.features.map((f) => ({ id: f.id, name: f.name, description: f.description, evidenceUrl: f.evidenceUrl, isActive: f.isActive })),
      })),
    };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 4: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "mappers.ts\|projects/\[id\]/route.ts" | head -20 && npm run lint -- src/app/api/admin/rfp-catalog src/app/api/rfp/catalog`
Expected: 예고한 두 파일 외 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/admin/rfp-catalog frontend/src/app/api/rfp/catalog
git commit -m "feat(rfp): 어드민 기능 CRUD(edited 표시·참조 시 삭제 거부)와 사용자용 카탈로그 조회 API"
```

---

### Task 8: 매핑 청크·프롬프트 빌드

**Files:**
- Create: `frontend/src/lib/rfp/mapping/chunk.ts`
- Create: `frontend/src/lib/rfp/mapping/prompt.ts`
- Test: `frontend/src/lib/__tests__/rfp-mapping-prompt.test.ts`

**Interfaces:**
- Consumes: Task 1 `CatalogSolution`.
- Produces: `CHUNK_SIZE = 20`, `DETAILS_MAX_CHARS = 1500`, `ChunkRequirement {id, reqId, title, categoryName, definition, details}`, `truncateDetails(text, max?)`, `chunkRequirements<T>(rows, size?) → T[][]`; `CatalogAliases {solutions: Map<alias, code>, features: Map<alias, {featureId, solutionCode}>}`, `MAPPING_RULES_PROMPT`, `buildCatalogPrompt(catalog) → {systemText, aliases}`, `buildChunkMessage(reqs) → string`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { chunkRequirements, truncateDetails, CHUNK_SIZE, DETAILS_MAX_CHARS, type ChunkRequirement } from "@/lib/rfp/mapping/chunk";
import { buildCatalogPrompt, buildChunkMessage, MAPPING_RULES_PROMPT } from "@/lib/rfp/mapping/prompt";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";

const catalog: CatalogSolution[] = [
  {
    code: "secloudit", name: "SECloudit", description: "멀티 클라우드 보안", isActive: true, sortOrder: 1,
    features: [
      { id: "f-sso", solutionCode: "secloudit", name: "SSO", description: "통합 인증\n및 접근 제어", evidenceUrl: null, isActive: true },
      { id: "f-old", solutionCode: "secloudit", name: "옛기능", description: "", evidenceUrl: null, isActive: false },
    ],
  },
  { code: "devopsit", name: "Devopsit", description: "", isActive: false, sortOrder: 2, features: [{ id: "f-ci", solutionCode: "devopsit", name: "CI", description: "d", evidenceUrl: null, isActive: true }] },
  { code: "aicubeit", name: "AICubeit", description: "AI 플랫폼", isActive: true, sortOrder: 3, features: [] },
  {
    code: "openstackit", name: "Openstackit", description: "IaaS", isActive: true, sortOrder: 4,
    features: [{ id: "f-vm", solutionCode: "openstackit", name: "VM", description: "가상 머신", evidenceUrl: null, isActive: true }],
  },
];

describe("chunkRequirements / truncateDetails", () => {
  it("20건씩 나누고 빈 배열은 빈 결과", () => {
    const rows = Array.from({ length: 45 }, (_, i) => i);
    expect(chunkRequirements(rows).map((c) => c.length)).toEqual([20, 20, 5]);
    expect(CHUNK_SIZE).toBe(20);
    expect(chunkRequirements([])).toEqual([]);
    expect(chunkRequirements(rows, 30).map((c) => c.length)).toEqual([30, 15]);
  });
  it("세부 내용은 1500자에서 자르고 표시를 붙인다", () => {
    const long = "가".repeat(DETAILS_MAX_CHARS + 10);
    expect(truncateDetails(long)).toBe(`${"가".repeat(DETAILS_MAX_CHARS)}…(이하 생략)`);
    expect(truncateDetails("  짧다  ")).toBe("짧다");
  });
});

describe("buildCatalogPrompt", () => {
  it("활성 솔루션·활성 기능만 S/F 별칭으로 넣고, 기능 없는 솔루션은 건너뛴다", () => {
    const { systemText, aliases } = buildCatalogPrompt(catalog);
    expect([...aliases.solutions.entries()]).toEqual([["S1", "secloudit"], ["S2", "openstackit"]]);
    expect([...aliases.features.entries()]).toEqual([
      ["F1", { featureId: "f-sso", solutionCode: "secloudit" }],
      ["F2", { featureId: "f-vm", solutionCode: "openstackit" }],
    ]);
    expect(systemText).toContain("## S1. SECloudit\n멀티 클라우드 보안\n- F1 SSO: 통합 인증 및 접근 제어");
    expect(systemText).toContain("## S2. Openstackit");
    expect(systemText).not.toContain("Devopsit");
    expect(systemText).not.toContain("옛기능");
    expect(systemText).not.toContain("AICubeit");
  });
  it("규칙 프롬프트에 판정 4값과 별칭 규칙이 있다", () => {
    for (const v of ["fulfilled", "partial", "build", "na"]) expect(MAPPING_RULES_PROMPT).toContain(v);
    expect(MAPPING_RULES_PROMPT).toContain("F숫자");
  });
});

describe("buildChunkMessage", () => {
  it("요구사항마다 ID·명칭·구분·정의·세부 내용(절단)을 넣는다", () => {
    const reqs: ChunkRequirement[] = [
      { id: "r1", reqId: "SER-001", title: "포털 구축", categoryName: "서비스 요구사항", definition: "정의", details: "가".repeat(2000) },
      { id: "r2", reqId: "SEC-002", title: "암호화", categoryName: "보안 요구사항", definition: "", details: "" },
    ];
    const msg = buildChunkMessage(reqs);
    expect(msg).toContain("요구사항 2건");
    expect(msg).toContain("### SER-001 포털 구축\n구분: 서비스 요구사항\n정의: 정의\n세부 내용: " + "가".repeat(1500) + "…(이하 생략)");
    expect(msg).toContain("### SEC-002 암호화\n구분: 보안 요구사항\n정의: (없음)\n세부 내용: (없음)");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-mapping-prompt`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `chunk.ts` 구현**

```ts
// frontend/src/lib/rfp/mapping/chunk.ts
/** 청크당 요구사항 수(스펙 §4.3). 124건 → 7청크. */
export const CHUNK_SIZE = 20;
/** 프롬프트에 넣는 세부 내용 최대 길이 */
export const DETAILS_MAX_CHARS = 1500;

export interface ChunkRequirement {
  /** rfp_requirements.id */
  id: string;
  reqId: string;
  title: string;
  categoryName: string;
  definition: string;
  details: string;
}

export function truncateDetails(text: string, max = DETAILS_MAX_CHARS): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…(이하 생략)`;
}

export function chunkRequirements<T>(rows: readonly T[], size = CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error("청크 크기는 1 이상이어야 합니다.");
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
```

- [ ] **Step 4: `prompt.ts` 구현**

```ts
// frontend/src/lib/rfp/mapping/prompt.ts
import type { CatalogSolution } from "./types";
import { truncateDetails, type ChunkRequirement } from "./chunk";

/** 프롬프트 별칭 → 실제 id. 한 실행 안에서만 유효(스펙 §4.3). */
export interface CatalogAliases {
  /** "S1" → 솔루션 code */
  solutions: Map<string, string>;
  /** "F3" → 기능 id와 그 솔루션 code */
  features: Map<string, { featureId: string; solutionCode: string }>;
}

/** 시스템 블록 1(고정, 캐싱 대상 아님) */
export const MAPPING_RULES_PROMPT = `당신은 공공 정보화 사업 제안요청서(RFP)의 요구사항을 당사 솔루션 기능에 매핑하는 프리세일즈 분석가입니다.
카탈로그(시스템 메시지의 두 번째 블록)에는 솔루션(S1, S2 …)과 그 기능(F1, F2 …)이 별칭과 함께 나열돼 있습니다.
요구사항마다 아래 판정 중 하나 이상을 내립니다.
- fulfilled(충족): 카탈로그의 기능이 요구를 그대로 만족한다. feature에 그 기능 별칭을 씁니다.
- partial(부분충족): 기능이 요구의 일부만 만족하고 나머지는 설정·개발이 필요하다. feature 필수.
- build(설계·구축영역): 당사 솔루션 기능이 아닌 SI 설계·구축 작업이다(데이터 이관, 기관 시스템 연계 개발 등). feature는 null.
- na(해당없음): 사업 관리·제약 조건·산출물·교육 등 솔루션과 무관하다. feature는 null.
규칙:
1. 요구를 만족하는 기능이 여러 개면 각각 한 행씩 모두 나열합니다(fulfilled/partial은 여러 행 가능).
2. build/na는 요구사항당 한 행만, 그리고 fulfilled/partial과 함께 쓰지 않습니다.
3. 억지로 맞추지 않습니다. 맞는 기능이 없으면 build 또는 na입니다.
4. feature에는 카탈로그에 있는 별칭(F숫자)만 씁니다. 없는 별칭을 만들지 않습니다.
5. rationale은 왜 그 판정인지 한국어 2문장 이내로 씁니다.
6. 입력에 있는 모든 요구사항에 대해 최소 한 행을 냅니다. reqId는 입력에 적힌 그대로 씁니다.
결과는 스키마에 맞는 JSON만 출력합니다.`;

/**
 * 시스템 블록 2(카탈로그, cache_control 대상). 활성 솔루션의 활성 기능만 넣고 S/F 별칭 표를 만든다.
 * 활성 기능이 하나도 없는 솔루션은 fulfilled/partial 대상이 될 수 없으므로 넣지 않는다.
 */
export function buildCatalogPrompt(catalog: CatalogSolution[]): { systemText: string; aliases: CatalogAliases } {
  const aliases: CatalogAliases = { solutions: new Map(), features: new Map() };
  const lines: string[] = ["# 당사 솔루션 카탈로그"];
  let s = 0;
  let f = 0;
  for (const sol of catalog) {
    if (!sol.isActive) continue;
    const active = sol.features.filter((x) => x.isActive);
    if (!active.length) continue;
    s += 1;
    const sAlias = `S${s}`;
    aliases.solutions.set(sAlias, sol.code);
    lines.push("", `## ${sAlias}. ${sol.name}`, sol.description.trim() || "(설명 없음)");
    for (const feat of active) {
      f += 1;
      const fAlias = `F${f}`;
      aliases.features.set(fAlias, { featureId: feat.id, solutionCode: sol.code });
      lines.push(`- ${fAlias} ${feat.name}: ${feat.description.trim().replace(/\s+/g, " ") || "(설명 없음)"}`);
    }
  }
  return { systemText: lines.join("\n"), aliases };
}

/** 청크 하나의 사용자 메시지 */
export function buildChunkMessage(reqs: readonly ChunkRequirement[]): string {
  const parts = reqs.map((r) =>
    [
      `### ${r.reqId} ${r.title.trim()}`,
      `구분: ${r.categoryName.trim()}`,
      `정의: ${r.definition.trim() || "(없음)"}`,
      `세부 내용: ${truncateDetails(r.details) || "(없음)"}`,
    ].join("\n"),
  );
  return `다음 요구사항 ${reqs.length}건을 카탈로그 기능에 매핑하세요.\n\n${parts.join("\n\n")}`;
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npm test -- rfp-mapping-prompt`
Expected: PASS (5 tests)

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/chunk.ts frontend/src/lib/rfp/mapping/prompt.ts frontend/src/lib/__tests__/rfp-mapping-prompt.test.ts
git commit -m "feat(rfp): 매핑 프롬프트(규칙·카탈로그 S/F 별칭)와 20건 청크·1500자 절단"
```

---

### Task 9: LLM 출력 검증·수동 편집 규칙

**Files:**
- Create: `frontend/src/lib/rfp/mapping/validate.ts`
- Test: `frontend/src/lib/__tests__/rfp-mapping-validate.test.ts`

**Interfaces:**
- Consumes: Task 1 `Verdict`·`isVerdict`·`requiresFeature`·`MappingRow`·`CatalogSolution`, Task 8 `CatalogAliases`·`ChunkRequirement`.
- Produces: `MAX_ROWS_PER_REQUIREMENT = 5`, `LlmMappingItem {reqId, verdict, feature, rationale}`, `ValidatedRow {requirementId, solutionCode, featureId, verdict, rationale, sortOrder}`, `validateMappingOutput(items, chunk, aliases) → {rows, warnings, unmapped}`, `validateManualMapping(input, catalog, siblings) → {ok:true, verdict, solutionCode, featureId} | {ok:false, error}`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { validateMappingOutput, validateManualMapping, MAX_ROWS_PER_REQUIREMENT, type LlmMappingItem } from "@/lib/rfp/mapping/validate";
import type { CatalogAliases } from "@/lib/rfp/mapping/prompt";
import type { ChunkRequirement } from "@/lib/rfp/mapping/chunk";
import type { CatalogSolution, MappingRow } from "@/lib/rfp/mapping/types";

const chunk: ChunkRequirement[] = [
  { id: "r1", reqId: "SER-001", title: "a", categoryName: "c", definition: "", details: "" },
  { id: "r2", reqId: "SER-002", title: "b", categoryName: "c", definition: "", details: "" },
  { id: "r3", reqId: "SEC-001", title: "c", categoryName: "c", definition: "", details: "" },
];
const aliases: CatalogAliases = {
  solutions: new Map([["S1", "secloudit"], ["S2", "devopsit"]]),
  features: new Map([
    ["F1", { featureId: "f-sso", solutionCode: "secloudit" }],
    ["F2", { featureId: "f-audit", solutionCode: "secloudit" }],
    ["F3", { featureId: "f-ci", solutionCode: "devopsit" }],
  ]),
};
const item = (reqId: string, verdict: LlmMappingItem["verdict"], feature: string | null, rationale = "r"): LlmMappingItem => ({ reqId, verdict, feature, rationale });

describe("validateMappingOutput", () => {
  it("별칭을 실제 id로 되돌리고 sortOrder를 매긴다", () => {
    const v = validateMappingOutput([item("SER-001", "fulfilled", "F1"), item("SER-001", "partial", "f3 "), item("SER-002", "na", null), item("SEC-001", "build", "F2")], chunk, aliases);
    expect(v.rows).toEqual([
      { requirementId: "r1", solutionCode: "secloudit", featureId: "f-sso", verdict: "fulfilled", rationale: "r", sortOrder: 0 },
      { requirementId: "r1", solutionCode: "devopsit", featureId: "f-ci", verdict: "partial", rationale: "r", sortOrder: 1 },
      { requirementId: "r2", solutionCode: null, featureId: null, verdict: "na", rationale: "r", sortOrder: 0 },
      { requirementId: "r3", solutionCode: null, featureId: null, verdict: "build", rationale: "r", sortOrder: 0 },
    ]);
    expect(v.warnings).toEqual([]);
    expect(v.unmapped).toEqual([]);
  });
  it("없는 reqId·불명 별칭·기능 없는 fulfilled는 버리고 경고", () => {
    const v = validateMappingOutput([item("XXX-999", "na", null), item("SER-001", "fulfilled", "F9"), item("SER-001", "partial", null), item("SER-002", "na", null)], chunk, aliases);
    expect(v.rows.map((r) => r.requirementId)).toEqual(["r2"]);
    expect(v.warnings).toEqual(["청크에 없는 요구사항 ID XXX-999", "SER-001: 기능 별칭 불명 F9", "SER-001: 기능 별칭 불명 null", "SER-001: 매핑 결과 없음", "SEC-001: 매핑 결과 없음"]);
    expect(v.unmapped).toEqual(["SER-001", "SEC-001"]);
  });
  it("fulfilled와 함께 나온 build/na는 버리고, build+na는 build만, 같은 기능 중복은 먼저 나온 것", () => {
    const v = validateMappingOutput([
      item("SER-001", "fulfilled", "F1", "첫"), item("SER-001", "na", null), item("SER-001", "fulfilled", "F1", "둘"),
      item("SER-002", "na", null), item("SER-002", "build", null), item("SER-002", "na", null),
      item("SEC-001", "partial", "F2"),
    ], chunk, aliases);
    expect(v.rows.filter((r) => r.requirementId === "r1")).toEqual([{ requirementId: "r1", solutionCode: "secloudit", featureId: "f-sso", verdict: "fulfilled", rationale: "첫", sortOrder: 0 }]);
    expect(v.rows.filter((r) => r.requirementId === "r2").map((r) => r.verdict)).toEqual(["build"]);
    expect(v.warnings).toContain("SER-001: 충족/부분충족과 함께 나온 설계·구축영역/해당없음 1행 제외");
  });
  it("요구사항당 5행 상한", () => {
    const many: CatalogAliases = { solutions: new Map([["S1", "s"]]), features: new Map(Array.from({ length: 7 }, (_, i) => [`F${i + 1}`, { featureId: `f${i + 1}`, solutionCode: "s" }])) };
    const v = validateMappingOutput(Array.from({ length: 7 }, (_, i) => item("SER-001", "fulfilled", `F${i + 1}`)), chunk.slice(0, 1), many);
    expect(v.rows).toHaveLength(MAX_ROWS_PER_REQUIREMENT);
    expect(v.warnings).toEqual(["SER-001: 매핑 7행 중 5행만 사용"]);
  });
});

describe("validateManualMapping", () => {
  const catalog: CatalogSolution[] = [
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [{ id: "f-sso", solutionCode: "secloudit", name: "SSO", description: "", evidenceUrl: null, isActive: true }] },
    { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [{ id: "f-ci", solutionCode: "devopsit", name: "CI", description: "", evidenceUrl: null, isActive: true }] },
  ];
  const row = (verdict: MappingRow["verdict"], featureId: string | null): MappingRow => ({ id: "m", requirementId: "r1", solutionCode: featureId ? "secloudit" : null, featureId, verdict, rationale: "", evidenceUrl: null, edited: true, sortOrder: 0 });
  it("충족·부분충족은 기능 필수, 기능의 솔루션을 채워 준다", () => {
    expect(validateManualMapping({ verdict: "fulfilled", featureId: "f-sso" }, catalog, [])).toEqual({ ok: true, verdict: "fulfilled", solutionCode: "secloudit", featureId: "f-sso" });
    expect(validateManualMapping({ verdict: "partial", featureId: null }, catalog, [])).toEqual({ ok: false, error: "충족·부분충족은 기능을 골라야 합니다." });
    expect(validateManualMapping({ verdict: "partial", featureId: "nope" }, catalog, [])).toMatchObject({ ok: false, error: "카탈로그에 없는 기능입니다." });
    expect(validateManualMapping({ verdict: "partial", solutionCode: "devopsit", featureId: "f-sso" }, catalog, [])).toMatchObject({ ok: false, error: "기능이 선택한 솔루션의 것이 아닙니다." });
  });
  it("build/na는 솔루션·기능 null, 요구사항당 하나, 충족·부분충족과 공존 불가", () => {
    expect(validateManualMapping({ verdict: "build", solutionCode: "secloudit", featureId: "f-sso" }, catalog, [])).toEqual({ ok: true, verdict: "build", solutionCode: null, featureId: null });
    expect(validateManualMapping({ verdict: "na" }, catalog, [row("build", null)])).toEqual({ ok: false, error: "설계·구축영역·해당없음은 요구사항당 하나만 둘 수 있습니다." });
    expect(validateManualMapping({ verdict: "na" }, catalog, [row("fulfilled", "f-sso")])).toEqual({ ok: false, error: "설계·구축영역·해당없음은 충족·부분충족과 함께 둘 수 없습니다." });
    expect(validateManualMapping({ verdict: "fulfilled", featureId: "f-ci" }, catalog, [row("na", null)])).toMatchObject({ ok: false, error: expect.stringContaining("먼저 지우거나") });
    expect(validateManualMapping({ verdict: "fulfilled", featureId: "f-sso" }, catalog, [row("partial", "f-sso")])).toEqual({ ok: false, error: "같은 기능이 이미 매핑돼 있습니다." });
    expect(validateManualMapping({ verdict: "maybe" }, catalog, [])).toEqual({ ok: false, error: "판정은 fulfilled·partial·build·na 중 하나입니다." });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-mapping-validate`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/rfp/mapping/validate.ts
import { isVerdict, requiresFeature, type CatalogSolution, type MappingRow, type Verdict } from "./types";
import type { CatalogAliases } from "./prompt";
import type { ChunkRequirement } from "./chunk";

export const MAX_ROWS_PER_REQUIREMENT = 5;

/** LLM 출력 한 행(별칭 상태) */
export interface LlmMappingItem {
  reqId: string;
  verdict: Verdict;
  feature: string | null;
  rationale: string;
}

/** 검증을 통과해 DB에 넣을 행 */
export interface ValidatedRow {
  requirementId: string;
  solutionCode: string | null;
  featureId: string | null;
  verdict: Verdict;
  rationale: string;
  sortOrder: number;
}

export interface ValidationResult {
  rows: ValidatedRow[];
  warnings: string[];
  /** 행을 하나도 못 받은 요구사항의 reqId */
  unmapped: string[];
}

interface Candidate {
  verdict: Verdict;
  solutionCode: string | null;
  featureId: string | null;
  rationale: string;
}

/** 스펙 §4.3 검증 1~6. 순수 함수. */
export function validateMappingOutput(items: LlmMappingItem[], chunk: readonly ChunkRequirement[], aliases: CatalogAliases): ValidationResult {
  const byReqId = new Map(chunk.map((r) => [r.reqId.replace(/\s+/g, "").toUpperCase(), r]));
  const warnings: string[] = [];
  const unmapped: string[] = [];
  const cands = new Map<string, Candidate[]>();

  for (const it of items) {
    const req = byReqId.get(it.reqId.replace(/\s+/g, "").toUpperCase());
    if (!req) {
      warnings.push(`청크에 없는 요구사항 ID ${it.reqId}`);
      continue;
    }
    if (!isVerdict(it.verdict)) {
      warnings.push(`${req.reqId}: 알 수 없는 판정 ${String(it.verdict)}`);
      continue;
    }
    let solutionCode: string | null = null;
    let featureId: string | null = null;
    if (requiresFeature(it.verdict)) {
      const f = it.feature ? aliases.features.get(it.feature.trim().toUpperCase()) : undefined;
      if (!f) {
        warnings.push(`${req.reqId}: 기능 별칭 불명 ${it.feature ?? "null"}`);
        continue;
      }
      solutionCode = f.solutionCode;
      featureId = f.featureId;
    }
    // build/na에 feature가 붙어 있으면 feature만 버리고 행은 유지(규칙 3)
    const list = cands.get(req.id) ?? [];
    list.push({ verdict: it.verdict, solutionCode, featureId, rationale: it.rationale.trim() });
    cands.set(req.id, list);
  }

  const rows: ValidatedRow[] = [];
  for (const req of chunk) {
    let list = cands.get(req.id) ?? [];
    if (list.some((c) => requiresFeature(c.verdict))) {
      const dropped = list.filter((c) => !requiresFeature(c.verdict)).length;
      if (dropped) warnings.push(`${req.reqId}: 충족/부분충족과 함께 나온 설계·구축영역/해당없음 ${dropped}행 제외`);
      const seen = new Set<string>();
      list = list.filter((c) => {
        if (!requiresFeature(c.verdict) || seen.has(c.featureId!)) return false;
        seen.add(c.featureId!);
        return true;
      });
    } else if (list.length > 1) {
      // build와 na가 섞이면 build만, 같은 판정이 여럿이면 첫 행(규칙 4)
      list = [list.find((c) => c.verdict === "build") ?? list[0]];
    }
    if (list.length > MAX_ROWS_PER_REQUIREMENT) {
      warnings.push(`${req.reqId}: 매핑 ${list.length}행 중 ${MAX_ROWS_PER_REQUIREMENT}행만 사용`);
      list = list.slice(0, MAX_ROWS_PER_REQUIREMENT);
    }
    if (!list.length) {
      unmapped.push(req.reqId);
      warnings.push(`${req.reqId}: 매핑 결과 없음`);
      continue;
    }
    list.forEach((c, i) => rows.push({ requirementId: req.id, solutionCode: c.solutionCode, featureId: c.featureId, verdict: c.verdict, rationale: c.rationale, sortOrder: i }));
  }
  return { rows, warnings, unmapped };
}

export interface ManualMappingInput {
  verdict: unknown;
  solutionCode?: unknown;
  featureId?: unknown;
}

export type ManualCheck =
  | { ok: true; verdict: Verdict; solutionCode: string | null; featureId: string | null }
  | { ok: false; error: string };

/**
 * 스펙 §4.2 규칙을 PATCH/POST 입력에 적용한다. siblings는 같은 요구사항의 다른 행(수정 중인 자기 행은 제외).
 * 충족·부분충족은 기능 필수이고 기능의 솔루션으로 solutionCode를 채운다. build/na는 둘 다 null.
 */
export function validateManualMapping(input: ManualMappingInput, catalog: CatalogSolution[], siblings: readonly MappingRow[]): ManualCheck {
  if (!isVerdict(input.verdict)) return { ok: false, error: "판정은 fulfilled·partial·build·na 중 하나입니다." };
  const verdict = input.verdict;
  if (requiresFeature(verdict)) {
    const featureId = typeof input.featureId === "string" ? input.featureId : "";
    if (!featureId) return { ok: false, error: "충족·부분충족은 기능을 골라야 합니다." };
    const owner = catalog.find((s) => s.features.some((f) => f.id === featureId));
    if (!owner) return { ok: false, error: "카탈로그에 없는 기능입니다." };
    if (typeof input.solutionCode === "string" && input.solutionCode && input.solutionCode !== owner.code) {
      return { ok: false, error: "기능이 선택한 솔루션의 것이 아닙니다." };
    }
    if (siblings.some((s) => !requiresFeature(s.verdict))) {
      return { ok: false, error: "설계·구축영역/해당없음 행이 있는 요구사항에는 충족·부분충족을 추가할 수 없습니다. 그 행을 먼저 지우거나 바꾸세요." };
    }
    if (siblings.some((s) => s.featureId === featureId)) return { ok: false, error: "같은 기능이 이미 매핑돼 있습니다." };
    return { ok: true, verdict, solutionCode: owner.code, featureId };
  }
  if (siblings.length) {
    return {
      ok: false,
      error: siblings.some((s) => requiresFeature(s.verdict))
        ? "설계·구축영역·해당없음은 충족·부분충족과 함께 둘 수 없습니다."
        : "설계·구축영역·해당없음은 요구사항당 하나만 둘 수 있습니다.",
    };
  }
  return { ok: true, verdict, solutionCode: null, featureId: null };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-mapping-validate`
Expected: PASS (6 tests). 두 번째 테스트의 경고 순서(입력 순서 → 요구사항 순서)가 기대값과 같은지 확인.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/validate.ts frontend/src/lib/__tests__/rfp-mapping-validate.test.ts
git commit -m "feat(rfp): 매핑 LLM 출력 검증(별칭 복원·판정 규칙·5행 상한)과 수동 편집 규칙"
```

---

### Task 10: 매핑 요약·건수(화면·xlsx 공용)

**Files:**
- Create: `frontend/src/lib/rfp/mapping/summary.ts`
- Test: `frontend/src/lib/__tests__/rfp-mapping-summary.test.ts`

**Interfaces:**
- Consumes: Task 1 타입·상수.
- Produces: `CatalogIndex {solutionName: Map<code,name>, feature: Map<id, CatalogFeature>}`, `indexCatalog(catalog)`, `groupByRequirement<T extends MappingRow>(rows: T[]) → Map<requirementId, T[]>`, `describeMapping(row, index) → string`, `mappingSummary(rows, index) → string`, `bestVerdict(rows) → Verdict | null`, `VerdictCounts = Record<Verdict | "unmapped", number>`, `countByVerdict(requirementIds, rows)`, `SolutionCount {code, name, fulfilled, partial}`, `countBySolution(rows, catalog)`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { indexCatalog, groupByRequirement, mappingSummary, bestVerdict, countByVerdict, countBySolution } from "@/lib/rfp/mapping/summary";
import type { CatalogSolution, MappingRow } from "@/lib/rfp/mapping/types";

const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    { id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: null, isActive: true },
    { id: "f-old", solutionCode: "secloudit", name: "옛기능", description: "", evidenceUrl: null, isActive: false },
  ] },
  { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [
    { id: "f-pipe", solutionCode: "devopsit", name: "파이프라인", description: "", evidenceUrl: null, isActive: true },
  ] },
];
let n = 0;
const row = (requirementId: string, verdict: MappingRow["verdict"], featureId: string | null, solutionCode: string | null, sortOrder = 0): MappingRow =>
  ({ id: `m${++n}`, requirementId, verdict, featureId, solutionCode, rationale: "", evidenceUrl: null, edited: false, sortOrder });
const rows: MappingRow[] = [
  row("r1", "partial", "f-pipe", "devopsit", 1),
  row("r1", "fulfilled", "f-iam", "secloudit", 0),
  row("r2", "build", null, null),
  row("r3", "na", null, null),
  row("r4", "partial", "f-old", "secloudit"),
  row("r5", "partial", "f-iam", "secloudit"),
  row("r5", "fulfilled", "f-pipe", "devopsit", 1),
];
const index = indexCatalog(catalog);

describe("mappingSummary", () => {
  it("sortOrder 순으로 '솔루션·기능(판정)'을 ' / '로 잇고 build/na는 라벨만", () => {
    const g = groupByRequirement(rows);
    expect(mappingSummary(g.get("r1")!, index)).toBe("SECloudit·IAM(충족) / Devopsit·파이프라인(부분충족)");
    expect(mappingSummary(g.get("r2")!, index)).toBe("설계·구축영역");
    expect(mappingSummary(g.get("r3")!, index)).toBe("해당없음");
    expect(mappingSummary([], index)).toBe("");
  });
  it("비활성 기능은 [비활성], 카탈로그에서 사라진 기능은 (삭제된 기능)", () => {
    expect(mappingSummary(groupByRequirement(rows).get("r4")!, index)).toBe("SECloudit·옛기능[비활성](부분충족)");
    expect(mappingSummary([row("r9", "fulfilled", "gone", "secloudit")], index)).toBe("SECloudit·(삭제된 기능)(충족)");
  });
});

describe("bestVerdict / countByVerdict", () => {
  it("요구사항 단위로 fulfilled > partial > build > na, 없으면 unmapped", () => {
    expect(bestVerdict(groupByRequirement(rows).get("r1")!)).toBe("fulfilled");
    expect(bestVerdict([])).toBeNull();
    expect(countByVerdict(["r1", "r2", "r3", "r4", "r5", "r6"], rows)).toEqual({ fulfilled: 2, partial: 1, build: 1, na: 1, unmapped: 1 });
  });
});

describe("countBySolution", () => {
  it("솔루션마다 요구사항 단위로 충족/부분충족을 세고 카탈로그 순서를 지킨다", () => {
    expect(countBySolution(rows, catalog)).toEqual([
      { code: "secloudit", name: "SECloudit", fulfilled: 1, partial: 2 },
      { code: "devopsit", name: "Devopsit", fulfilled: 1, partial: 1 },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-mapping-summary`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/rfp/mapping/summary.ts
import { requiresFeature, VERDICT_LABEL, VERDICT_ORDER, type CatalogFeature, type CatalogSolution, type MappingRow, type Verdict } from "./types";

export interface CatalogIndex {
  solutionName: Map<string, string>;
  feature: Map<string, CatalogFeature>;
}

export function indexCatalog(catalog: CatalogSolution[]): CatalogIndex {
  const solutionName = new Map<string, string>();
  const feature = new Map<string, CatalogFeature>();
  for (const s of catalog) {
    solutionName.set(s.code, s.name);
    for (const f of s.features) feature.set(f.id, f);
  }
  return { solutionName, feature };
}

/** requirementId → 행(sortOrder 순). 제네릭이라 RfpMapping[]을 넣으면 RfpMapping[]을 돌려준다. */
export function groupByRequirement<T extends MappingRow>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.requirementId) ?? [];
    list.push(r);
    m.set(r.requirementId, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return m;
}

/** 한 행의 표시 문자열: "SECloudit·IAM(충족)" / "설계·구축영역" / "해당없음" */
export function describeMapping(row: MappingRow, index: CatalogIndex): string {
  if (!requiresFeature(row.verdict)) return VERDICT_LABEL[row.verdict];
  const solution = (row.solutionCode && index.solutionName.get(row.solutionCode)) ?? row.solutionCode ?? "?";
  const f = row.featureId ? index.feature.get(row.featureId) : undefined;
  const featureName = f ? `${f.name}${f.isActive ? "" : "[비활성]"}` : "(삭제된 기능)";
  return `${solution}·${featureName}(${VERDICT_LABEL[row.verdict]})`;
}

/** 요구사항 하나의 행들을 " / "로 이은 요약(화면 "당사 솔루션" 열·xlsx 공용) */
export function mappingSummary(rows: readonly MappingRow[], index: CatalogIndex): string {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => describeMapping(r, index)).join(" / ");
}

/** fulfilled > partial > build > na. 행이 없으면 null. */
export function bestVerdict(rows: readonly MappingRow[]): Verdict | null {
  let best: Verdict | null = null;
  for (const r of rows) if (best === null || VERDICT_ORDER.indexOf(r.verdict) < VERDICT_ORDER.indexOf(best)) best = r.verdict;
  return best;
}

export type VerdictCounts = Record<Verdict | "unmapped", number>;

/** 요구사항 단위 건수. 한 요구사항은 가장 좋은 판정 하나로만 센다. */
export function countByVerdict(requirementIds: readonly string[], rows: readonly MappingRow[]): VerdictCounts {
  const counts: VerdictCounts = { fulfilled: 0, partial: 0, build: 0, na: 0, unmapped: 0 };
  const groups = groupByRequirement(rows);
  for (const id of requirementIds) {
    const best = bestVerdict(groups.get(id) ?? []);
    counts[best ?? "unmapped"] += 1;
  }
  return counts;
}

export interface SolutionCount {
  code: string;
  name: string;
  fulfilled: number;
  partial: number;
}

/** 솔루션별 충족/부분충족 요구사항 수(요구사항 중복 제거: 그 솔루션 행들 중 가장 좋은 판정). 카탈로그 순서. */
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
    for (const v of perReq.values()) if (v === "fulfilled") fulfilled += 1; else partial += 1;
    return { code: s.code, name: s.name, fulfilled, partial };
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-mapping-summary`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/summary.ts frontend/src/lib/__tests__/rfp-mapping-summary.test.ts
git commit -m "feat(rfp): 매핑 요약 문자열·판정별/솔루션별 건수(화면·xlsx 공용 순수 함수)"
```

---

### Task 11: Claude 매핑 호출·매핑 잡

**Files:**
- Create: `frontend/src/lib/rfp/mapping/llm.ts`
- Create: `frontend/src/lib/rfp/mapping/run-job.ts`
- Test: `frontend/src/lib/__tests__/rfp-mapping-run.test.ts`

**Interfaces:**
- Consumes: Task 1·8·9·10, Task 6 `loadCatalog`, 1단계 `sortRequirements`(`@/lib/rfp/requirements`), `LlmUnavailableError`·`DEFAULT_LLM_MODEL`(`@/lib/rfp/extract-llm`).
- Produces: `MappingOutputSchema`, `MappingOutput`, `MappingCall = (userMessage) => Promise<MappingOutput>`, `createAnthropicMappingCall(catalogText, opts?)`; `MappingMode = "all" | "missing"`, `CONCURRENCY = 3`, `selectTargetRequirements(requirements, mappings, mode)`, `runWithConcurrency(items, limit, fn) → PromiseSettledResult[]`, `ChunkOutcome {warnings, rows}`, `summarizeChunkOutcomes(results) → {warnings, succeeded, failed, rows}`, `runMapping(admin, projectId, mode, deps?)`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { selectTargetRequirements, runWithConcurrency, summarizeChunkOutcomes, CONCURRENCY } from "@/lib/rfp/mapping/run-job";
import { MappingOutputSchema } from "@/lib/rfp/mapping/llm";

describe("selectTargetRequirements", () => {
  const reqs = [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }];
  const mappings = [
    { requirementId: "r1", edited: false },
    { requirementId: "r2", edited: true }, { requirementId: "r2", edited: false },
    { requirementId: "r3", edited: false },
  ];
  it("all: 사람이 고친 행이 있는 요구사항만 제외", () => {
    expect(selectTargetRequirements(reqs, mappings, "all").map((r) => r.id)).toEqual(["r1", "r3", "r4"]);
  });
  it("missing: 행이 하나도 없는 요구사항만", () => {
    expect(selectTargetRequirements(reqs, mappings, "missing").map((r) => r.id)).toEqual(["r4"]);
  });
});

describe("runWithConcurrency", () => {
  it("동시 실행 수를 제한하고 입력 순서대로 결과를 돌려주며 실패를 잡는다", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await runWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, i) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      active -= 1;
      if (i === 3) throw new Error("boom");
      return ms * 2;
    });
    expect(maxActive).toBe(2);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : `err:${(r.reason as Error).message}`))).toEqual([60, 20, 40, "err:boom", 30]);
    expect(CONCURRENCY).toBe(3);
  });
  it("빈 입력은 빈 결과", async () => {
    expect(await runWithConcurrency([], 3, async () => 1)).toEqual([]);
  });
});

describe("summarizeChunkOutcomes", () => {
  it("성공 청크의 경고를 모으고 실패 청크는 번호를 붙인다", () => {
    const s = summarizeChunkOutcomes([
      { status: "fulfilled", value: { warnings: ["a"], rows: 10 } },
      { status: "rejected", reason: new Error("timeout") },
      { status: "fulfilled", value: { warnings: [], rows: 7 } },
    ]);
    expect(s).toEqual({ warnings: ["a", "청크 2/3 실패: timeout"], succeeded: 2, failed: 1, rows: 17 });
  });
});

describe("MappingOutputSchema", () => {
  it("판정 enum·nullable feature를 검사한다", () => {
    expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "na", feature: null, rationale: "" }] }).success).toBe(true);
    expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "maybe", feature: null, rationale: "" }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-mapping-run`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `llm.ts` 구현**

```ts
// frontend/src/lib/rfp/mapping/llm.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_LLM_MODEL, LlmUnavailableError } from "../extract-llm";
import { VERDICTS } from "./types";
import { MAPPING_RULES_PROMPT } from "./prompt";

export const MappingOutputSchema = z.object({
  mappings: z.array(
    z.object({
      reqId: z.string(),
      verdict: z.enum(VERDICTS),
      /** F{n} 별칭. build/na는 null */
      feature: z.string().nullable(),
      rationale: z.string(),
    }),
  ),
});
export type MappingOutput = z.infer<typeof MappingOutputSchema>;

/** 청크 사용자 메시지 → 구조화 출력. 테스트에서는 가짜 함수를 넣는다. */
export type MappingCall = (userMessage: string) => Promise<MappingOutput>;

/**
 * Anthropic SDK 호출 함수. 시스템 블록 1 = 규칙(고정), 블록 2 = 카탈로그(cache_control ephemeral).
 * 모델 claude-opus-5(env RFP_LLM_MODEL), adaptive thinking, 스트리밍 + finalMessage(), zod 구조화 출력.
 * 키가 없으면 LlmUnavailableError.
 */
export function createAnthropicMappingCall(catalogText: string, opts: { apiKey?: string; model?: string } = {}): MappingCall {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const model = opts.model ?? process.env.RFP_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const client = new Anthropic({ apiKey });
  return async (userMessage) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        { type: "text", text: MAPPING_RULES_PROMPT },
        { type: "text", text: catalogText, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(MappingOutputSchema) },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("모델이 요청을 거부했습니다.");
    if (msg.stop_reason === "max_tokens") throw new Error("출력이 max_tokens에 잘렸습니다. 청크를 줄이세요.");
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("");
    return MappingOutputSchema.parse(JSON.parse(text));
  };
}
```

스펙 §4.3의 `effort: "medium"`: `output_config`에 `effort` 필드가 SDK 타입(`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`의 `OutputConfig`)에 있으면 `output_config: { format: …, effort: "medium" }`로 넣는다. 없으면 넣지 않고 보고서에 "effort 미지원 버전"이라고 적는다. 타입 단언으로 우회하지 않는다.

- [ ] **Step 4: `run-job.ts` 구현**

```ts
// frontend/src/lib/rfp/mapping/run-job.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { sortRequirements } from "../requirements";
import { LlmUnavailableError } from "../extract-llm";
import { loadCatalog } from "../catalog/store";
import type { MappingRow } from "./types";
import { buildCatalogPrompt, buildChunkMessage } from "./prompt";
import { chunkRequirements, type ChunkRequirement } from "./chunk";
import { validateMappingOutput } from "./validate";
import { indexCatalog } from "./summary";
import { createAnthropicMappingCall, type MappingCall } from "./llm";

export type MappingMode = "all" | "missing";
/** 동시에 보내는 청크 수. 124건(7청크) → 3라운드로 Vercel 300초 안에 끝나게. */
export const CONCURRENCY = 3;

/** all: edited 행이 있는 요구사항만 제외 / missing: 행이 하나도 없는 요구사항만(스펙 §4.3). */
export function selectTargetRequirements<T extends { id: string }>(
  requirements: readonly T[],
  mappings: readonly Pick<MappingRow, "requirementId" | "edited">[],
  mode: MappingMode,
): T[] {
  const has = new Set<string>();
  const edited = new Set<string>();
  for (const m of mappings) {
    has.add(m.requirementId);
    if (m.edited) edited.add(m.requirementId);
  }
  return requirements.filter((r) => (mode === "missing" ? !has.has(r.id) : !edited.has(r.id)));
}

/** 동시 limit개까지 실행. 결과는 입력 순서대로 PromiseSettledResult(실패도 잡아서 돌려준다). */
export async function runWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export interface ChunkOutcome {
  warnings: string[];
  rows: number;
}

export function summarizeChunkOutcomes(results: readonly PromiseSettledResult<ChunkOutcome>[]): { warnings: string[]; succeeded: number; failed: number; rows: number } {
  const out = { warnings: [] as string[], succeeded: 0, failed: 0, rows: 0 };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      out.succeeded += 1;
      out.rows += r.value.rows;
      out.warnings.push(...r.value.warnings);
    } else {
      out.failed += 1;
      out.warnings.push(`청크 ${i + 1}/${results.length} 실패: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });
  return out;
}

interface ReqRow {
  id: string;
  req_id: string;
  title: string;
  category_code: string;
  category_name: string;
  definition: string;
  details: string;
  sort_order: number;
}

export interface MappingDeps {
  makeCall: (catalogText: string) => MappingCall;
}
const DEFAULT_DEPS: MappingDeps = { makeCall: (t) => createAnthropicMappingCall(t) };

/**
 * 스펙 §4.3 잡. 카탈로그 → 대상 선정 → 20건 청크(동시 3) → 검증 → 청크마다 즉시 저장(edited 행 보존) → ready|failed.
 * 어떤 경우에도 mapping_status를 running으로 남기지 않는다.
 */
export async function runMapping(admin: SupabaseClient, projectId: string, mode: MappingMode, deps: MappingDeps = DEFAULT_DEPS): Promise<void> {
  // supabase-js는 DB 오류를 throw하지 않고 error로 돌려준다. 종료 상태 갱신이 실패하면 running으로 남으므로 반드시 검사한다(Task 6 리뷰 지적과 같은 규칙).
  const fail = async (message: string) => {
    const { error } = await admin.from("rfp_projects").update({ mapping_status: "failed", mapping_error: message.slice(0, 500) }).eq("id", projectId);
    if (error) console.error("[rfp] mapping status update failed", projectId, error.message);
  };
  const ready = async (warnings: string[]) => {
    const { error } = await admin
      .from("rfp_projects")
      .update({ mapping_status: "ready", mapping_error: null, mapping_at: new Date().toISOString(), mapping_warnings: warnings.slice(0, 200) })
      .eq("id", projectId);
    if (error) await fail(`상태 갱신 실패: ${error.message}`);
  };
  try {
    const catalog = await loadCatalog(admin, { activeSolutionsOnly: true });
    const { systemText, aliases } = buildCatalogPrompt(catalog);
    if (!aliases.features.size) return await fail("카탈로그가 비어 있습니다. 관리자에게 문의하세요.");
    const index = indexCatalog(catalog);

    const [reqRes, mapRes] = await Promise.all([
      admin.from("rfp_requirements").select("id, req_id, title, category_code, category_name, definition, details, sort_order").eq("project_id", projectId),
      admin.from("rfp_requirement_mappings").select("requirement_id, edited").eq("project_id", projectId),
    ]);
    if (reqRes.error) throw new Error(reqRes.error.message);
    if (mapRes.error) throw new Error(mapRes.error.message);
    // 요구사항 수백 건 × 최대 5행이라 1000행 상한에 걸리지 않는다.
    const requirements = (reqRes.data ?? []) as ReqRow[];
    const existing = ((mapRes.data ?? []) as { requirement_id: string; edited: boolean }[]).map((m) => ({ requirementId: m.requirement_id, edited: m.edited }));
    const targets = selectTargetRequirements(requirements, existing, mode);
    if (!targets.length) return await ready(["매핑할 요구사항이 없습니다(모두 사람이 검토했거나 이미 매핑됨)."]);

    const sorted = sortRequirements(targets.map((r) => ({ ...r, categoryCode: r.category_code, sortOrder: r.sort_order })));
    const chunks = chunkRequirements(
      sorted.map<ChunkRequirement>((r) => ({ id: r.id, reqId: r.req_id, title: r.title, categoryName: r.category_name, definition: r.definition, details: r.details })),
    );

    let call: MappingCall;
    try {
      call = deps.makeCall(systemText);
    } catch (e) {
      if (e instanceof LlmUnavailableError) return await fail(e.message);
      throw e;
    }

    const results = await runWithConcurrency(chunks, CONCURRENCY, async (chunk): Promise<ChunkOutcome> => {
      const out = await call(buildChunkMessage(chunk));
      const v = validateMappingOutput(out.mappings, chunk, aliases);
      const ids = chunk.map((r) => r.id);
      const { error: de } = await admin.from("rfp_requirement_mappings").delete().eq("project_id", projectId).eq("edited", false).in("requirement_id", ids);
      if (de) throw new Error(de.message);
      if (v.rows.length) {
        const { error: ie } = await admin.from("rfp_requirement_mappings").insert(
          v.rows.map((r) => ({
            project_id: projectId, requirement_id: r.requirementId, solution_code: r.solutionCode, feature_id: r.featureId, verdict: r.verdict,
            rationale: r.rationale, evidence_url: r.featureId ? (index.feature.get(r.featureId)?.evidenceUrl ?? null) : null, edited: false, sort_order: r.sortOrder,
          })),
        );
        if (ie) throw new Error(ie.message);
      }
      return { warnings: v.warnings, rows: v.rows.length };
    });
    const summary = summarizeChunkOutcomes(results);
    if (summary.succeeded === 0) return await fail(`모든 청크가 실패했습니다. ${summary.warnings[0] ?? ""}`.trim());
    await ready(summary.warnings);
  } catch (e) {
    console.error("[rfp] mapping failed", projectId, e);
    await fail(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npm test -- rfp-mapping-run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "mappers.ts\|projects/\[id\]/route.ts" | head -20`
Expected: PASS (6 tests). tsc는 예고한 두 파일 외 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/llm.ts frontend/src/lib/rfp/mapping/run-job.ts frontend/src/lib/__tests__/rfp-mapping-run.test.ts
git commit -m "feat(rfp): Claude 매핑 호출(카탈로그 캐싱)과 매핑 잡(대상 선정·동시 3·청크별 저장·edited 보존)"
```

---

### Task 12: 매핑 API + 상세·목록·요구사항 라우트 확장

**Files:**
- Modify: `frontend/src/lib/rfp/mappers.ts`
- Modify: `frontend/src/app/api/rfp/projects/[id]/route.ts` (GET)
- Modify: `frontend/src/app/api/rfp/requirements/[requirementId]/route.ts` (PATCH)
- Create: `frontend/src/app/api/rfp/projects/[id]/mapping/route.ts`
- Create: `frontend/src/app/api/rfp/projects/[id]/mapping/rows/route.ts`
- Create: `frontend/src/app/api/rfp/mappings/[mappingId]/route.ts`

**Interfaces:**
- Consumes: Task 1 타입·`STALE_RUNNING_MS`, Task 6 `loadCatalog`, Task 8 `buildCatalogPrompt`, Task 9 `validateManualMapping`, Task 11 `runMapping`·`MappingMode`, 1단계 `requireUser`·`creatorNames`·`sortRequirements`.
- Produces: `PROJECT_COLUMNS`(mapping_* 포함), `ProjectDbRow.mapping_*`, `MAPPING_COLUMNS`, `MappingDbRow`, `mapMapping(row) → RfpMapping`, `mapProjectDetail(row, creatorName, files, requirements, mappings)`.

- [ ] **Step 1: `mappers.ts` 확장**

`PROJECT_COLUMNS`를 다음으로 바꾼다.
```ts
export const PROJECT_COLUMNS =
  "id, name, agency, period, budget, bid_method, extra, status, extraction_method, error, warnings, requirement_count, created_by, created_at, updated_at, mapping_status, mapping_error, mapping_warnings, mapping_at";
```

`ProjectDbRow`에 필드 추가(`updated_at` 뒤):
```ts
  mapping_status: "none" | "running" | "ready" | "failed";
  mapping_error: string | null;
  mapping_warnings: unknown;
  mapping_at: string | null;
```

import 줄을 바꾼다.
```ts
import type { RfpFile, RfpMapping, RfpProjectDetail, RfpProjectSummary, RfpRequirement } from "@/types/rfp";
import type { Verdict } from "./mapping/types";
import type { RequirementRow } from "./requirements";
```

`FileDbRow` 뒤에 추가:
```ts
export const MAPPING_COLUMNS = "id, project_id, requirement_id, solution_code, feature_id, verdict, rationale, evidence_url, edited, sort_order, updated_at, updated_by";

export interface MappingDbRow {
  id: string;
  project_id: string;
  requirement_id: string;
  solution_code: string | null;
  feature_id: string | null;
  verdict: Verdict;
  rationale: string;
  evidence_url: string | null;
  edited: boolean;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

export function mapMapping(row: MappingDbRow): RfpMapping {
  return {
    id: row.id, requirementId: row.requirement_id, solutionCode: row.solution_code, featureId: row.feature_id, verdict: row.verdict,
    rationale: row.rationale, evidenceUrl: row.evidence_url, edited: row.edited, sortOrder: row.sort_order, updatedAt: row.updated_at, updatedBy: row.updated_by,
  };
}
```

`mapProjectSummary` 반환 객체에 `mappingStatus: row.mapping_status,`를 `requirementCount` 뒤에 추가.

`mapProjectDetail`을 다음으로 바꾼다.
```ts
export function mapProjectDetail(row: ProjectDbRow, creatorName: string | null, files: FileDbRow[], requirements: RfpRequirement[], mappings: RfpMapping[]): RfpProjectDetail {
  return {
    ...mapProjectSummary(row, creatorName),
    period: row.period,
    budget: row.budget,
    bidMethod: row.bid_method,
    extra: row.extra ?? {},
    error: row.error,
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    mappingError: row.mapping_error,
    mappingWarnings: Array.isArray(row.mapping_warnings) ? (row.mapping_warnings as string[]) : [],
    mappingAt: row.mapping_at,
    files: files.map(mapFile),
    requirements,
    mappings,
  };
}
```

- [ ] **Step 2: 상세 라우트 GET 수정 (`projects/[id]/route.ts`)**

import에 `MAPPING_COLUMNS, mapMapping, type MappingDbRow`를 추가하고 GET 본문을 다음으로 바꾼다(PATCH·DELETE는 그대로).
```ts
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });
  const { data: project, error } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = project as ProjectDbRow;

  if (request.nextUrl.searchParams.get("fields") === "status") {
    const res: StatusResponse = {
      status: row.status, error: row.error, requirementCount: row.requirement_count, extractionMethod: row.extraction_method, updatedAt: row.updated_at,
      mappingStatus: row.mapping_status, mappingError: row.mapping_error, mappingAt: row.mapping_at,
    };
    return NextResponse.json(res);
  }

  const [filesRes, reqsRes, mapsRes, names] = await Promise.all([
    auth.admin.from("rfp_files").select("id, original_filename, format, size_bytes, created_at").eq("project_id", id).order("created_at", { ascending: false }),
    auth.admin.from("rfp_requirements").select("*").eq("project_id", id).order("sort_order", { ascending: true }),
    auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("project_id", id).order("sort_order", { ascending: true }),
    creatorNames(auth.admin, row.created_by ? [row.created_by] : []),
  ]);
  if (filesRes.error) return NextResponse.json({ error: filesRes.error.message }, { status: 500 });
  if (reqsRes.error) return NextResponse.json({ error: reqsRes.error.message }, { status: 500 });
  if (mapsRes.error) return NextResponse.json({ error: mapsRes.error.message }, { status: 500 });
  // 요구사항은 프로젝트당 수백 건, 매핑은 요구사항당 최대 5행이라 Supabase 1000행 상한에 걸리지 않는다. 넘길 가능성이 생기면 selectAll(lib/work-metrics/common.ts)로 바꾼다.
  const requirements = sortRequirements(((reqsRes.data ?? []) as RequirementDbRow[]).map(mapRequirement));
  const mappings = ((mapsRes.data ?? []) as MappingDbRow[]).map(mapMapping);
  const creatorName = row.created_by ? names.get(row.created_by) ?? null : null;
  return NextResponse.json(mapProjectDetail(row, creatorName, (filesRes.data ?? []) as FileDbRow[], requirements, mappings));
}
```

- [ ] **Step 3: 요구사항 PATCH에서 `solution` 거부 (`requirements/[requirementId]/route.ts`)**

`TEXT_FIELDS`와 `COLUMN`에서 `solution`을 빼고, 본문 검사 직후(`if (!body) …` 다음 줄)에 추가:
```ts
  if ("solution" in body) return NextResponse.json({ error: "solution은 매핑에서 관리합니다. 요구사항 행을 펼쳐 매핑을 편집하세요." }, { status: 400 });
```
```ts
const TEXT_FIELDS = ["title", "definition", "details", "deliverables", "related", "categoryName"] as const;
const COLUMN: Record<(typeof TEXT_FIELDS)[number], string> = {
  title: "title", definition: "definition", details: "details", deliverables: "deliverables", related: "related", categoryName: "category_name",
};
```

- [ ] **Step 4: `projects/[id]/mapping/route.ts` (GET·POST)**

```ts
// frontend/src/app/api/rfp/projects/[id]/mapping/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { buildCatalogPrompt } from "@/lib/rfp/mapping/prompt";
import { runMapping, type MappingMode } from "@/lib/rfp/mapping/run-job";
import { STALE_RUNNING_MS } from "@/lib/rfp/mapping/types";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow, type ProjectDbRow } from "@/lib/rfp/mappers";
import type { MappingResponse, RfpMapping } from "@/types/rfp";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };

const COLUMNS = "id, status, mapping_status, mapping_error, mapping_warnings, mapping_at, updated_at";
type Row = Pick<ProjectDbRow, "id" | "status" | "mapping_status" | "mapping_error" | "mapping_warnings" | "mapping_at" | "updated_at">;

async function loadMappings(admin: SupabaseClient, projectId: string): Promise<RfpMapping[]> {
  const { data, error } = await admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("project_id", projectId).order("sort_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as MappingDbRow[]).map(mapMapping);
}

/** GET /api/rfp/projects/[id]/mapping — 매핑 행 + 상태(실행이 끝난 뒤 행만 다시 받을 때) */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data, error } = await auth.admin.from("rfp_projects").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = data as Row;
  try {
    const res: MappingResponse = {
      mappingStatus: row.mapping_status, mappingError: row.mapping_error,
      mappingWarnings: Array.isArray(row.mapping_warnings) ? (row.mapping_warnings as string[]) : [],
      mappingAt: row.mapping_at, mappings: await loadMappings(auth.admin, id),
    };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "매핑을 불러오지 못했습니다." }, { status: 500 });
  }
}

/**
 * POST /api/rfp/projects/[id]/mapping {mode?: "all"|"missing", confirm?: boolean}  (스펙 §4.3)
 * 400(추출 미완·키 없음·카탈로그 비어 있음) / 409 {running} / 409 {needsConfirm, editedRequirements} / 202 {started, mode}
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown; confirm?: unknown };
  const mode: MappingMode = body.mode === "missing" ? "missing" : "all";

  const { data, error } = await auth.admin.from("rfp_projects").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = data as Row;
  if (row.status !== "ready") return NextResponse.json({ error: "요구사항 추출이 끝난 뒤 매핑할 수 있습니다." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 400 });
  if (row.mapping_status === "running" && Date.now() - Date.parse(row.updated_at) <= STALE_RUNNING_MS) {
    return NextResponse.json({ running: true, error: "이미 매핑 중입니다." }, { status: 409 });
  }

  let catalogEmpty: boolean;
  try {
    catalogEmpty = buildCatalogPrompt(await loadCatalog(auth.admin, { activeSolutionsOnly: true })).aliases.features.size === 0;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
  }
  if (catalogEmpty) return NextResponse.json({ error: "카탈로그가 비어 있습니다. 관리자에게 문의하세요." }, { status: 400 });

  if (mode === "all") {
    const { data: edited, error: editedError } = await auth.admin.from("rfp_requirement_mappings").select("requirement_id").eq("project_id", id).eq("edited", true);
    if (editedError) return NextResponse.json({ error: editedError.message }, { status: 500 });
    const n = new Set(((edited ?? []) as { requirement_id: string }[]).map((m) => m.requirement_id)).size;
    if (n > 0 && body.confirm !== true) return NextResponse.json({ needsConfirm: true, editedRequirements: n }, { status: 409 });
  }

  const { error: upError } = await auth.admin.from("rfp_projects").update({ mapping_status: "running", mapping_error: null, updated_by: auth.userId }).eq("id", id);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });
  const admin = auth.admin;
  after(async () => {
    await runMapping(admin, id, mode);
  });
  return NextResponse.json({ started: true, mode }, { status: 202 });
}
```

- [ ] **Step 5: `projects/[id]/mapping/rows/route.ts` (POST)**

```ts
// frontend/src/app/api/rfp/projects/[id]/mapping/rows/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { validateManualMapping } from "@/lib/rfp/mapping/validate";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** POST /api/rfp/projects/[id]/mapping/rows {requirementId, solutionCode?, featureId?, verdict, rationale?, evidenceUrl?} → edited=true, 201 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.requirementId !== "string") return NextResponse.json({ error: "requirementId가 필요합니다." }, { status: 400 });
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  const evidenceUrl = typeof body.evidenceUrl === "string" && body.evidenceUrl.trim() ? body.evidenceUrl.trim() : null;
  if (rationale.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
  if (evidenceUrl && evidenceUrl.length > 2000) return NextResponse.json({ error: "근거 URL이 너무 깁니다." }, { status: 400 });

  const { data: req } = await auth.admin.from("rfp_requirements").select("id, project_id").eq("id", body.requirementId).maybeSingle();
  if (!req || req.project_id !== id) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });

  const [catalog, siblingsRes] = await Promise.all([
    loadCatalog(auth.admin, { activeSolutionsOnly: true }),
    auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("requirement_id", req.id).order("sort_order"),
  ]);
  if (siblingsRes.error) return NextResponse.json({ error: siblingsRes.error.message }, { status: 500 });
  const siblings = ((siblingsRes.data ?? []) as MappingDbRow[]).map(mapMapping);
  const check = validateManualMapping({ verdict: body.verdict, solutionCode: body.solutionCode, featureId: body.featureId }, catalog, siblings);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
  const { data, error } = await auth.admin
    .from("rfp_requirement_mappings")
    .insert({
      project_id: id, requirement_id: req.id, solution_code: check.solutionCode, feature_id: check.featureId, verdict: check.verdict,
      rationale, evidence_url: evidenceUrl, edited: true, sort_order: sortOrder, updated_by: auth.userId,
    })
    .select(MAPPING_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mapMapping(data as MappingDbRow), { status: 201 });
}
```

- [ ] **Step 6: `mappings/[mappingId]/route.ts` (PATCH·DELETE)**

```ts
// frontend/src/app/api/rfp/mappings/[mappingId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { validateManualMapping } from "@/lib/rfp/mapping/validate";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";

export const runtime = "nodejs";
type Params = { params: Promise<{ mappingId: string }> };

/** PATCH /api/rfp/mappings/[mappingId] {solutionCode?, featureId?, verdict?, rationale?, evidenceUrl?} → 규칙 검사 → edited=true */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { mappingId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });

  const { data: cur, error: curError } = await auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("id", mappingId).maybeSingle();
  if (curError) return NextResponse.json({ error: curError.message }, { status: 500 });
  if (!cur) return NextResponse.json({ error: "매핑이 없습니다." }, { status: 404 });
  const row = cur as MappingDbRow;

  const patch: Record<string, unknown> = { edited: true, updated_by: auth.userId };
  if ("rationale" in body) {
    if (typeof body.rationale !== "string" || body.rationale.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하의 문자열이어야 합니다." }, { status: 400 });
    patch.rationale = body.rationale.trim();
  }
  if ("evidenceUrl" in body) {
    if (body.evidenceUrl !== null && typeof body.evidenceUrl !== "string") return NextResponse.json({ error: "evidenceUrl은 문자열 또는 null이어야 합니다." }, { status: 400 });
    const v = typeof body.evidenceUrl === "string" ? body.evidenceUrl.trim() : "";
    if (v.length > 2000) return NextResponse.json({ error: "근거 URL이 너무 깁니다." }, { status: 400 });
    patch.evidence_url = v || null;
  }
  const touchesRule = "verdict" in body || "solutionCode" in body || "featureId" in body;
  if (touchesRule) {
    const [catalog, siblingsRes] = await Promise.all([
      loadCatalog(auth.admin, { activeSolutionsOnly: true }),
      auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("requirement_id", row.requirement_id).neq("id", mappingId),
    ]);
    if (siblingsRes.error) return NextResponse.json({ error: siblingsRes.error.message }, { status: 500 });
    const check = validateManualMapping(
      {
        verdict: "verdict" in body ? body.verdict : row.verdict,
        solutionCode: "solutionCode" in body ? body.solutionCode : row.solution_code,
        featureId: "featureId" in body ? body.featureId : row.feature_id,
      },
      catalog,
      ((siblingsRes.data ?? []) as MappingDbRow[]).map(mapMapping),
    );
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    patch.verdict = check.verdict;
    patch.solution_code = check.solutionCode;
    patch.feature_id = check.featureId;
  }
  if (Object.keys(patch).length === 2) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });

  const { data, error } = await auth.admin.from("rfp_requirement_mappings").update(patch).eq("id", mappingId).select(MAPPING_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mapMapping(data as MappingDbRow));
}

/** DELETE /api/rfp/mappings/[mappingId] → 204 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { mappingId } = await params;
  const { data, error } = await auth.admin.from("rfp_requirement_mappings").delete().eq("id", mappingId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "매핑이 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 7: 타입·린트·기존 테스트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint -- src/app/api/rfp src/lib/rfp && npm test -- rfp-`
Expected: tsc 오류 0(Task 1에서 예고한 두 파일 포함 전부 해소), lint 통과, 기존 1단계 테스트 + 2단계 테스트 모두 PASS. **`xlsx.test.ts`는 아직 1단계 그대로여야 한다**(Task 13에서 확장).

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/rfp/mappers.ts "frontend/src/app/api/rfp/projects/[id]/route.ts" "frontend/src/app/api/rfp/requirements/[requirementId]/route.ts" "frontend/src/app/api/rfp/projects/[id]/mapping" "frontend/src/app/api/rfp/mappings"
git commit -m "feat(rfp): 매핑 실행/조회/행 편집 API, 상세·status에 매핑 포함, 요구사항 PATCH의 solution 거부"
```

---

### Task 13: xlsx에 매핑 열·개요 요약·매핑 시트

**Files:**
- Modify: `frontend/src/lib/rfp/xlsx.ts` (전체 교체)
- Modify: `frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts`
- Test: `frontend/src/lib/__tests__/rfp-xlsx.test.ts` (확장)

**Interfaces:**
- Consumes: Task 1 타입·`VERDICT_LABEL`·`VERDICT_ORDER`·`UNMAPPED_LABEL`·`requiresFeature`, Task 10 `indexCatalog`·`groupByRequirement`·`mappingSummary`·`countByVerdict`·`countBySolution`, Task 12 `MAPPING_COLUMNS`·`mapMapping`, Task 6 `loadCatalog`.
- Produces: `XlsxMapping {rows: MappingRow[]; catalog: CatalogSolution[]; mappingAt: string | null}`, `buildWorkbook(project, rows, mapping?)`(mapping 없으면 1단계와 동일 결과).

- [ ] **Step 1: 테스트 확장 — `rfp-xlsx.test.ts` 끝에 describe 추가**

```ts
import { VERDICT_LABEL } from "@/lib/rfp/mapping/types";
import type { CatalogSolution, MappingRow } from "@/lib/rfp/mapping/types";
// (위 두 줄은 파일 상단 import 블록에 넣는다)

describe("buildWorkbook + mapping", () => {
  const catalog: CatalogSolution[] = [
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [{ id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: "https://c/iam", isActive: true }] },
    { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [{ id: "f-pipe", solutionCode: "devopsit", name: "파이프라인", description: "", evidenceUrl: null, isActive: true }] },
  ];
  const m = (id: string, requirementId: string, verdict: MappingRow["verdict"], featureId: string | null, solutionCode: string | null, sortOrder: number, edited = false): MappingRow =>
    ({ id, requirementId, verdict, featureId, solutionCode, rationale: `이유 ${id}`, evidenceUrl: featureId === "f-iam" ? "https://c/iam" : null, edited, sortOrder });
  const mappingRows: MappingRow[] = [
    m("m1", "SER-001-uuid", "fulfilled", "f-iam", "secloudit", 0, true),
    m("m2", "SER-001-uuid", "partial", "f-pipe", "devopsit", 1),
    m("m3", "INR-DTL-001-uuid", "build", null, null, 0),
  ];
  const mapping = { rows: mappingRows, catalog, mappingAt: "2026-09-04T01:23:00.000Z" };

  it("목록 시트에 요약 + 5열, 여러 매핑은 셀 안 줄바꿈, 미매핑은 '미매핑'", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    const list = wb.getWorksheet("1.요구사항_목록")!;
    expect(list.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션", "솔루션", "기능", "판정", "매핑 설명", "근거 URL"]);
    expect(list.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "2.SER", "SECloudit·IAM(충족) / Devopsit·파이프라인(부분충족)", "SECloudit\nDevopsit", "IAM\n파이프라인", "충족\n부분충족", "이유 m1\n이유 m2", "https://c/iam\n"]);
    expect(list.getRow(5).getCell(7).value).toBe("");
    expect(list.getRow(5).getCell(10).value).toBe("미매핑");
    expect(list.getRow(6).getCell(7).value).toBe(VERDICT_LABEL.build);
    expect(list.getRow(6).getCell(8).value).toBe("");
    expect(list.getColumn(11).width).toBe(40);
  });
  it("상세 시트 번호는 그대로이고 마지막에 '{n}.솔루션_매핑' 시트가 붙는다(미매핑 포함, 수정 표시)", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL", "4.솔루션_매핑"]);
    const ms = wb.getWorksheet("4.솔루션_매핑")!;
    expect(ms.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "솔루션", "기능", "판정", "매핑 설명", "근거 URL", "수정"]);
    expect(ms.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "SECloudit", "IAM", "충족", "이유 m1", "https://c/iam", "수정"]);
    expect(ms.getRow(5).values).toEqual([undefined, 2, "서비스 요구사항", "SER-001", "제목 SER-001", "Devopsit", "파이프라인", "부분충족", "이유 m2", "", ""]);
    expect(ms.getRow(6).values).toEqual([undefined, 3, "서비스 요구사항", "SER-002", "제목 SER-002", "", "", "미매핑", "", "", ""]);
    expect(ms.getRow(7).values).toEqual([undefined, 4, "인프라 상세 요구사항", "INR-DTL-001", "제목 INR-DTL-001", "", "", "설계·구축영역", "이유 m3", "", ""]);
    expect(ms.getRow(8).getCell(3).value).toBeNull();
  });
  it("개요 시트에 '3. 솔루션 매핑 요약' 블록", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    const ov = wb.getWorksheet("0.개요")!;
    expect(ov.getCell("B11").value).toBe("3. 솔루션 매핑 요약");
    expect(ov.getCell("B12").value).toBe("실행 시각");
    expect(ov.getCell("B13").value).toBe("충족");
    expect(ov.getCell("C13").value).toBe("1건");
    expect(ov.getCell("B14").value).toBe("부분충족");
    expect(ov.getCell("C14").value).toBe("0건");
    expect(ov.getCell("B15").value).toBe("설계·구축영역");
    expect(ov.getCell("C15").value).toBe("1건");
    expect(ov.getCell("B17").value).toBe("미매핑");
    expect(ov.getCell("C17").value).toBe("1건");
    expect(ov.getCell("B18").value).toBe("SECloudit");
    expect(ov.getCell("C18").value).toBe("충족 1건 · 부분충족 0건");
    expect(ov.getCell("B19").value).toBe("Devopsit");
    expect(ov.getCell("C19").value).toBe("충족 0건 · 부분충족 1건");
  });
  it("mapping을 주지 않으면 1단계와 같은 시트·열", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL"]);
    expect(wb.getWorksheet("1.요구사항_목록")!.getRow(3).cellCount).toBe(6);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-xlsx`
Expected: 새 describe 4개 중 3개 FAIL(`buildWorkbook`가 세 번째 인자를 무시), 기존 테스트 PASS.

- [ ] **Step 3: `xlsx.ts` 전체 교체**

```ts
// frontend/src/lib/rfp/xlsx.ts
import ExcelJS from "exceljs";
import { orderCategoryCodes, sheetNameFor, sortRequirements, type RequirementRow } from "./requirements";
import { requiresFeature, UNMAPPED_LABEL, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type MappingRow } from "./mapping/types";
import { countBySolution, countByVerdict, groupByRequirement, indexCatalog, mappingSummary, type CatalogIndex } from "./mapping/summary";

export interface XlsxProject {
  name: string;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  extra: Record<string, string>;
}

/** 2단계 매핑 입력. 없으면 1단계와 같은 워크북. */
export interface XlsxMapping {
  rows: MappingRow[];
  catalog: CatalogSolution[];
  mappingAt: string | null;
}

const FONT: Partial<ExcelJS.Font> = { name: "맑은 고딕", size: 10 };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
const THIN: Partial<ExcelJS.Border> = { style: "thin" };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { ...FONT, bold: true };
    c.fill = HEADER_FILL;
    c.border = BORDER;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function styleBody(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = FONT;
    c.border = BORDER;
    c.alignment = { vertical: "top", wrapText: true };
  });
}

/** 개요 시트의 "라벨 | 값(C~H 병합)" 한 줄 */
function keyValueRow(ws: ExcelJS.Worksheet, r: number, key: string, value: string) {
  ws.getCell(`B${r}`).value = key;
  ws.getCell(`C${r}`).value = value;
  ws.mergeCells(`C${r}:H${r}`);
  for (const col of ["B", "C"]) {
    const c = ws.getCell(`${col}${r}`);
    c.font = col === "B" ? { ...FONT, bold: true } : FONT;
    c.border = BORDER;
    c.alignment = { vertical: "top", wrapText: true };
  }
  ws.getCell(`B${r}`).fill = HEADER_FILL;
}

function sectionTitle(ws: ExcelJS.Worksheet, r: number, title: string) {
  ws.getCell(`B${r}`).value = title;
  ws.getCell(`B${r}`).font = { ...FONT, bold: true };
}

/** 매핑 한 행의 솔루션·기능 이름(build/na는 빈 문자열) */
function names(row: MappingRow, index: CatalogIndex): { solution: string; feature: string } {
  if (!requiresFeature(row.verdict)) return { solution: "", feature: "" };
  const f = row.featureId ? index.feature.get(row.featureId) : undefined;
  return {
    solution: (row.solutionCode && index.solutionName.get(row.solutionCode)) ?? row.solutionCode ?? "",
    feature: f ? `${f.name}${f.isActive ? "" : "[비활성]"}` : "(삭제된 기능)",
  };
}

function formatKst(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "—";
}

/**
 * 시트 구성: 0.개요 / 1.요구사항_목록(6열, 매핑 있으면 +5열) / 구분별 상세(7열) / (매핑 있으면) {n}.솔루션_매핑
 * 매핑 시트를 마지막에 두는 이유: 1단계 상세 시트 번호(2.SER…)를 바꾸지 않기 위해(스펙 §7).
 */
export async function buildWorkbook(project: XlsxProject, rows: RequirementRow[], mapping?: XlsxMapping): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NHN Injeinc Workshop — RFP 분석";
  const sorted = sortRequirements(rows);
  const codes = orderCategoryCodes(sorted.map((r) => r.categoryCode));
  const sheetIndex = new Map(codes.map((c, i) => [c, i + 2]));
  const index = mapping ? indexCatalog(mapping.catalog) : null;
  const groups = mapping ? groupByRequirement(mapping.rows) : new Map<string, MappingRow[]>();

  // 0.개요
  const ov = wb.addWorksheet("0.개요");
  ov.getColumn("A").width = 3;
  ov.getColumn("B").width = 18;
  for (const col of ["C", "D", "E", "F", "G", "H"]) ov.getColumn(col).width = 16;
  ov.getCell("B2").value = `「${project.name}」 제안요청서 요구사항 분석`;
  ov.getCell("B2").font = { ...FONT, size: 14, bold: true };
  sectionTitle(ov, 4, "1. 사업 개요 (일반사항)");
  const items: [string, string | null][] = [
    ["사업명", project.name],
    ["사업기간", project.period],
    ["설계금액", project.budget],
    ["발주기관", project.agency],
    ["입찰 및 계약방법", project.bidMethod],
  ];
  let r = 5;
  for (const [k, v] of items) keyValueRow(ov, r++, k, v ?? "");
  const extras = Object.entries(project.extra);
  if (extras.length) {
    r += 1;
    sectionTitle(ov, r, "2. 기타");
    r += 1;
    for (const [k, v] of extras) keyValueRow(ov, r++, k, v);
  }
  if (mapping && index) {
    r += 1;
    sectionTitle(ov, r, "3. 솔루션 매핑 요약");
    r += 1;
    keyValueRow(ov, r++, "실행 시각", formatKst(mapping.mappingAt));
    const counts = countByVerdict(sorted.map((q) => q.id), mapping.rows);
    for (const v of VERDICT_ORDER) keyValueRow(ov, r++, VERDICT_LABEL[v], `${counts[v]}건`);
    keyValueRow(ov, r++, UNMAPPED_LABEL, `${counts.unmapped}건`);
    for (const s of countBySolution(mapping.rows, mapping.catalog)) keyValueRow(ov, r++, s.name, `충족 ${s.fulfilled}건 · 부분충족 ${s.partial}건`);
  }

  // 1.요구사항_목록
  const list = wb.addWorksheet("1.요구사항_목록");
  const listWidths = mapping ? [5, 22, 16, 38, 55, 30, 14, 24, 10, 50, 40] : [5, 22, 16, 38, 55, 30];
  listWidths.forEach((w, i) => (list.getColumn(i + 1).width = w));
  list.getCell("A1").value = `요구사항 목록 총괄 (전체 ${sorted.length}건)`;
  list.getCell("A1").font = { ...FONT, size: 12, bold: true };
  const listHeader = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션"];
  if (mapping) listHeader.push("솔루션", "기능", "판정", "매핑 설명", "근거 URL");
  list.getRow(3).values = listHeader;
  styleHeader(list.getRow(3));
  sorted.forEach((q, i) => {
    const row = list.getRow(4 + i);
    const sheet = sheetNameFor(q.categoryCode, sheetIndex.get(q.categoryCode)!);
    if (mapping && index) {
      const g = groups.get(q.id) ?? [];
      const nm = g.map((m) => names(m, index));
      row.values = [
        i + 1, q.categoryName, q.reqId, q.title, sheet, mappingSummary(g, index),
        nm.map((n) => n.solution).join("\n"),
        nm.map((n) => n.feature).join("\n"),
        g.length ? g.map((m) => VERDICT_LABEL[m.verdict]).join("\n") : UNMAPPED_LABEL,
        g.map((m) => m.rationale).join("\n"),
        g.map((m) => m.evidenceUrl ?? "").join("\n"),
      ];
    } else {
      row.values = [i + 1, q.categoryName, q.reqId, q.title, sheet, q.solution];
    }
    styleBody(row);
  });

  // 구분별 상세(1단계 그대로)
  for (const code of codes) {
    const ws = wb.addWorksheet(sheetNameFor(code, sheetIndex.get(code)!));
    [5, 12, 24, 26, 85, 20, 32].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const inCode = sorted.filter((q) => q.categoryCode === code);
    ws.getCell("A1").value = `[${code}] ${inCode[0].categoryName} — 상세 요구사항`;
    ws.getCell("A1").font = { ...FONT, size: 12, bold: true };
    ws.getRow(3).values = ["연번", "요구사항\nID", "요구사항명", "정의", "세부 내용", "산출정보", "관련요구사항"];
    styleHeader(ws.getRow(3));
    inCode.forEach((q, i) => {
      const row = ws.getRow(4 + i);
      row.values = [i + 1, q.reqId, q.title, q.definition, q.details, q.deliverables, q.related];
      styleBody(row);
    });
  }

  // {n}.솔루션_매핑 — 매핑 1행 = 1줄, 미매핑 요구사항도 1줄
  if (mapping && index) {
    const ms = wb.addWorksheet(`${codes.length + 2}.솔루션_매핑`);
    [5, 18, 14, 36, 14, 26, 10, 50, 40, 8].forEach((w, i) => (ms.getColumn(i + 1).width = w));
    ms.getCell("A1").value = `솔루션 매핑 (요구사항 ${sorted.length}건, 매핑 ${mapping.rows.length}행)`;
    ms.getCell("A1").font = { ...FONT, size: 12, bold: true };
    ms.getRow(3).values = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "솔루션", "기능", "판정", "매핑 설명", "근거 URL", "수정"];
    styleHeader(ms.getRow(3));
    let n = 0;
    for (const q of sorted) {
      const g = groups.get(q.id) ?? [];
      if (!g.length) {
        const row = ms.getRow(4 + n);
        row.values = [++n, q.categoryName, q.reqId, q.title, "", "", UNMAPPED_LABEL, "", "", ""];
        styleBody(row);
        continue;
      }
      for (const m of g) {
        const nm = names(m, index);
        const row = ms.getRow(4 + n);
        row.values = [++n, q.categoryName, q.reqId, q.title, nm.solution, nm.feature, VERDICT_LABEL[m.verdict], m.rationale, m.evidenceUrl ?? "", m.edited ? "수정" : ""];
        styleBody(row);
      }
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** "(발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx" — 파일명 금지 문자는 _ */
export function xlsxFileName(project: XlsxProject, date = new Date()): string {
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const prefix = project.agency ? `(${safe(project.agency)}) ` : "";
  return `${prefix}${safe(project.name)}_요구사항 검토_${ymd}.xlsx`;
}
```

- [ ] **Step 4: xlsx 라우트에 매핑·카탈로그 전달**

`frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts`의 import에 `MAPPING_COLUMNS, mapMapping, type MappingDbRow`(`@/lib/rfp/mappers`)와 `loadCatalog`(`@/lib/rfp/catalog/store`), `type XlsxMapping`(`@/lib/rfp/xlsx`)을 추가하고, `buildWorkbook` 호출 부분을 다음으로 바꾼다.
```ts
  let mapping: XlsxMapping | undefined;
  if (p.mapping_status !== "none") {
    const [mapsRes, catalog] = await Promise.all([
      auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("project_id", id).order("sort_order"),
      loadCatalog(auth.admin),
    ]);
    if (mapsRes.error) return NextResponse.json({ error: mapsRes.error.message }, { status: 500 });
    mapping = { rows: ((mapsRes.data ?? []) as MappingDbRow[]).map(mapMapping), catalog, mappingAt: p.mapping_at };
  }
  const xlsxProject = { name: p.name, agency: p.agency, period: p.period, budget: p.budget, bidMethod: p.bid_method, extra: p.extra ?? {} };
  const buf = await buildWorkbook(xlsxProject, ((reqs ?? []) as RequirementDbRow[]).map(toRequirementRow), mapping);
```
카탈로그는 비활성 솔루션까지 전부 읽는다(`loadCatalog(auth.admin)`) — 매핑이 참조하는 이름을 그려야 하기 때문.

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npm test -- rfp-xlsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS(기존 3 + 새 4). 개요 행 번호(B11~B19)는 `extra`가 비어 있을 때 기준이다 — 기존 "2. 기타" 테스트는 `extra`가 있을 때 B11에 "2. 기타"가 오므로 서로 충돌하지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/rfp/xlsx.ts "frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts" frontend/src/lib/__tests__/rfp-xlsx.test.ts
git commit -m "feat(rfp): xlsx에 매핑 열(목록 +5열)·개요 매핑 요약·마지막 시트 {n}.솔루션_매핑"
```

---

### Task 14: 어드민 카탈로그 화면 `/admin/rfp-catalog`

**Files:**
- Modify: `frontend/src/app/admin/layout.tsx` (메뉴 항목)
- Create: `frontend/src/app/admin/rfp-catalog/page.tsx`
- Create: `frontend/src/components/admin/rfp-catalog/SolutionList.tsx`
- Create: `frontend/src/components/admin/rfp-catalog/SourceTable.tsx`
- Create: `frontend/src/components/admin/rfp-catalog/FeatureTable.tsx`

**Interfaces:**
- Consumes: Task 6·7 어드민 API, Task 1 `RfpAdminSolution`·`RfpSolutionSource`·`RfpAdminFeature`, 1단계 `EditableCell`(`@/components/rfp/EditableCell`), shadcn `Badge`·`Button`·`Input`·`Label`·`Dialog`·`AlertDialog`·`Switch`·`Alert`.
- Produces: 화면만. `SolutionList.tsx`는 `default SolutionList`와 named `SolutionHeader`를 export.

- [ ] **Step 1: 메뉴 항목**

`frontend/src/app/admin/layout.tsx`의 lucide import에 `Layers`를 추가하고 `ADMIN_NAV` 마지막(조직/팀 뒤)에 넣는다.
```ts
  { href: "/admin/rfp-catalog", label: "RFP 솔루션 카탈로그", icon: Layers },
```

- [ ] **Step 2: `page.tsx`**

```tsx
// frontend/src/app/admin/rfp-catalog/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import SolutionList, { SolutionHeader } from "@/components/admin/rfp-catalog/SolutionList";
import SourceTable from "@/components/admin/rfp-catalog/SourceTable";
import FeatureTable from "@/components/admin/rfp-catalog/FeatureTable";
import type { RfpAdminSolution } from "@/types/rfp";

export default function RfpCatalogPage() {
  const [solutions, setSolutions] = useState<RfpAdminSolution[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 가져오기가 끝나면 +1 → 기능 표가 다시 조회한다 */
  const [featureVersion, setFeatureVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/rfp-catalog/solutions");
      const json = (await res.json()) as { solutions?: RfpAdminSolution[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const list = json.solutions ?? [];
      setSolutions(list);
      setSelected((cur) => (cur && list.some((s) => s.code === cur) ? cur : list[0]?.code ?? null));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "솔루션 목록을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = solutions.find((s) => s.code === selected) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Layers className="h-5 w-5" />RFP 솔루션 카탈로그</h1>
        <p className="text-sm text-muted-foreground">솔루션별 기능 목록. Confluence 페이지를 등록해 가져오면 Claude가 기능을 정리하고, 사람이 고친 항목은 다음 가져오기가 덮어쓰지 않습니다. RFP 요구사항 매핑이 이 카탈로그를 기준으로 실행됩니다.</p>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SolutionList solutions={solutions} selected={selected} onSelect={setSelected} onChanged={load} />
        {current ? (
          <div className="min-w-0 space-y-4">
            <SolutionHeader solution={current} onChanged={load} onDeleted={() => { setSelected(null); void load(); }} />
            <SourceTable solution={current} onImported={() => { setFeatureVersion((v) => v + 1); void load(); }} />
            <FeatureTable solution={current} refreshKey={featureVersion} onChanged={load} />
          </div>
        ) : (
          <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">솔루션을 선택하거나 추가하세요.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `SolutionList.tsx`**

```tsx
// frontend/src/components/admin/rfp-catalog/SolutionList.tsx
"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import { cn } from "@/lib/utils";
import type { RfpAdminSolution } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function SolutionList({ solutions, selected, onSelect, onChanged }: {
  solutions: RfpAdminSolution[]; selected: string | null; onSelect: (code: string) => void; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rfp-catalog/solutions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim(), name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      const created = (await res.json()) as RfpAdminSolution;
      setAdding(false);
      setCode(""); setName(""); setDescription("");
      onChanged();
      onSelect(created.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">솔루션 <span className="font-normal text-muted-foreground">{solutions.length}</span></h2>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />추가</Button>
      </div>
      <ul className="space-y-1">
        {solutions.map((s) => (
          <li key={s.code}>
            <button
              type="button"
              onClick={() => onSelect(s.code)}
              className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40", selected === s.code && "border-primary bg-muted/60")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("font-medium", !s.isActive && "text-muted-foreground line-through")}>{s.name}</span>
                {!s.isActive && <Badge variant="outline">비활성</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.code} · 기능 {s.featureCount}개(활성 {s.activeFeatureCount}) · 소스 {s.sourceCount}</div>
            </button>
          </li>
        ))}
        {!solutions.length && <li className="py-6 text-center text-sm text-muted-foreground">솔루션이 없습니다.</li>}
      </ul>

      <Dialog open={adding} onOpenChange={(o) => !o && !busy && setAdding(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>솔루션 추가</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>코드 <span className="text-xs text-muted-foreground">(소문자 영숫자·하이픈, 만든 뒤 변경 불가)</span></Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="secloudit" />
            </div>
            <div className="grid gap-1"><Label>이름</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="SECloudit" /></div>
            <div className="grid gap-1">
              <Label>설명 <span className="text-xs text-muted-foreground">(매핑 프롬프트에 그대로 들어갑니다)</span></Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setAdding(false)}>닫기</Button>
            <Button disabled={busy || !code.trim() || !name.trim()} onClick={submit}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 선택한 솔루션의 이름·설명 인라인 편집, 활성 토글, 삭제 */
export function SolutionHeader({ solution, onChanged, onDeleted }: { solution: RfpAdminSolution; onChanged: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readError(res, "저장에 실패했습니다."));
    onChanged();
  };
  const remove = async () => {
    setError(null);
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    onDeleted();
  };
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-xs text-muted-foreground">{solution.code}</div>
          <EditableCell value={solution.name} onSave={(v) => patch({ name: v })} clampLines={0} className="text-lg font-semibold" />
          <EditableCell value={solution.description} onSave={(v) => patch({ description: v })} clampLines={3} placeholder="솔루션 설명(매핑 프롬프트에 사용) — 클릭해서 입력" />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={solution.isActive} onCheckedChange={(v) => patch({ isActive: v }).catch((e) => setError(e instanceof Error ? e.message : "저장 실패"))} />
            {solution.isActive ? "활성" : "비활성"}
          </label>
          <AlertDialog>
            <Button variant="destructive" size="sm" asChild>
              <AlertDialogTrigger><Trash2 className="mr-1 h-4 w-4" />삭제</AlertDialogTrigger>
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{solution.name} 솔루션을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>기능이나 매핑이 참조하는 솔루션은 삭제되지 않습니다. 그때는 비활성으로 바꾸세요.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: `SourceTable.tsx`**

```tsx
// frontend/src/components/admin/rfp-catalog/SourceTable.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RfpAdminSolution, RfpImportStatus, RfpSolutionSource } from "@/types/rfp";

const POLL_MS = 3000;

function ImportBadge({ status }: { status: RfpImportStatus }) {
  if (status === "running") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />가져오는 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">실패</Badge>;
  if (status === "ready") return <Badge>완료</Badge>;
  return <Badge variant="outline">대기</Badge>;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function SourceTable({ solution, onImported }: { solution: RfpAdminSolution; onImported: () => void }) {
  const [sources, setSources] = useState<RfpSolutionSource[]>([]);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`);
    const json = (await res.json().catch(() => ({}))) as { running?: boolean; sources?: RfpSolutionSource[]; error?: string };
    if (!res.ok) { setError(json.error ?? "소스를 불러오지 못했습니다."); return; }
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
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      setUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
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

  const runImport = async (sourceIds?: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sourceIds ? { sourceIds } : {}) });
      if (!res.ok) throw new Error(await readError(res, "가져오기를 시작하지 못했습니다."));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "가져오기를 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Confluence 소스 <span className="font-normal text-muted-foreground">{sources.length}</span></h3>
        <Button size="sm" disabled={busy || running || !sources.length} onClick={() => runImport()}>
          {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}전체 가져오기
        </Button>
      </div>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://….atlassian.net/wiki/spaces/KEY/pages/123456/제목" className="h-8" />
        <Button size="sm" variant="outline" disabled={busy || !url.trim()} onClick={add}><Plus className="mr-1 h-4 w-4" />추가</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">페이지</th>
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
                <td className="max-w-[320px] px-3 py-2">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    <span className="truncate">{s.title ?? s.url}</span><ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {s.title && <div className="truncate text-xs text-muted-foreground">{s.url}</div>}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.pageVersion ?? "—"}</td>
                <td className="px-3 py-2"><ImportBadge status={s.importStatus} /></td>
                <td className="px-3 py-2 text-muted-foreground">{s.importedAt ? new Date(s.importedAt).toLocaleString("ko-KR") : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.featureCount}</td>
                <td className="max-w-[260px] px-3 py-2 text-xs">
                  {s.error && <div className="text-destructive">{s.error}</div>}
                  {s.note && <div className="text-muted-foreground">{s.note}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="이 소스만 가져오기" disabled={busy || running} onClick={() => runImport([s.id])}><Download className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="삭제" disabled={running} onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {!sources.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">등록된 페이지가 없습니다. 위에 Confluence 페이지 URL을 넣어 추가하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 5: `FeatureTable.tsx`**

```tsx
// frontend/src/components/admin/rfp-catalog/FeatureTable.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import EditableCell from "@/components/rfp/EditableCell";
import type { RfpAdminFeature, RfpAdminSolution } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function FeatureTable({ solution, refreshKey, onChanged }: { solution: RfpAdminSolution; refreshKey: number; onChanged: () => void }) {
  const [features, setFeatures] = useState<RfpAdminFeature[]>([]);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/features`);
    const json = (await res.json().catch(() => ({}))) as { features?: RfpAdminFeature[]; error?: string };
    if (!res.ok) { setError(json.error ?? "기능을 불러오지 못했습니다."); return; }
    setFeatures(json.features ?? []);
  }, [solution.code]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const patch = useCallback(async (row: RfpAdminFeature, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/rfp-catalog/features/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readError(res, "저장에 실패했습니다."));
    const updated = (await res.json()) as RfpAdminFeature;
    setFeatures((cur) => cur.map((f) => (f.id === row.id ? updated : f)));
    onChanged();
  }, [onChanged]);

  const remove = async (row: RfpAdminFeature) => {
    if (!window.confirm(`기능 "${row.name}"을(를) 삭제할까요? 매핑이 참조하면 삭제되지 않습니다.`)) return;
    setError(null);
    const res = await fetch(`/api/admin/rfp-catalog/features/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    setFeatures((cur) => cur.filter((f) => f.id !== row.id));
    onChanged();
  };

  // patch가 바뀔 때마다 컬럼을 다시 만든다(그렇지 않으면 편집 콜백이 옛 행을 캡처한다 — 1단계 RequirementsTable과 같은 이유)
  const columns = useMemo(() => {
    const col = createColumnHelper<RfpAdminFeature>();
    return [
      col.accessor("sortOrder", {
        header: "순서",
        cell: (ctx) => (
          <Input
            type="number"
            defaultValue={ctx.getValue()}
            className="h-7 w-16 px-1 text-xs"
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== ctx.getValue()) patch(ctx.row.original, { sortOrder: n }).catch((err) => setError(err instanceof Error ? err.message : "저장 실패")); }}
          />
        ),
        meta: { width: "4.5rem" },
      }),
      col.accessor("name", {
        header: "기능",
        cell: (ctx) => (
          <div className="flex items-start gap-1">
            <EditableCell value={ctx.getValue()} onSave={(v) => patch(ctx.row.original, { name: v })} clampLines={0} className="min-w-0 flex-1 font-medium" />
            {ctx.row.original.edited && <Pencil className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" aria-label="사람이 고친 항목" />}
          </div>
        ),
        meta: { width: "14rem" },
      }),
      col.accessor("description", { header: "설명", cell: (ctx) => <EditableCell value={ctx.getValue()} onSave={(v) => patch(ctx.row.original, { description: v })} clampLines={3} /> }),
      col.accessor("evidenceUrl", {
        header: "근거 URL",
        cell: (ctx) => (
          <div className="flex items-start gap-1">
            <EditableCell value={ctx.getValue() ?? ""} onSave={(v) => patch(ctx.row.original, { evidenceUrl: v || null })} clampLines={1} placeholder="URL" className="min-w-0 flex-1 text-xs" />
            {ctx.getValue() && <a href={ctx.getValue()!} target="_blank" rel="noopener noreferrer" className="mt-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" /></a>}
          </div>
        ),
        meta: { width: "14rem" },
      }),
      col.accessor("isActive", {
        header: "활성",
        cell: (ctx) => <Switch checked={ctx.getValue()} onCheckedChange={(v) => patch(ctx.row.original, { isActive: v }).catch((err) => setError(err instanceof Error ? err.message : "저장 실패"))} />,
        meta: { width: "4rem" },
      }),
      col.accessor("mappingCount", { header: "매핑", cell: (ctx) => <span className="tabular-nums text-muted-foreground">{ctx.getValue()}</span>, meta: { width: "3.5rem" } }),
      col.display({
        id: "actions", header: "",
        cell: (ctx) => <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="삭제" onClick={() => remove(ctx.row.original)}><Trash2 className="h-4 w-4" /></Button>,
        meta: { width: "3rem" },
      }),
    ];
  }, [patch]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data: features,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (r) => r.id,
    globalFilterFn: (row, _id, value: string) => {
      const q = value.toLowerCase();
      return [row.original.name, row.original.description, row.original.evidenceUrl ?? ""].some((s) => s.toLowerCase().includes(q));
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">기능 <span className="font-normal text-muted-foreground">{features.length}</span></h3>
        <div className="flex items-center gap-2">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름·설명 검색" className="h-8 w-48" />
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />기능 추가</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">✎ 표시는 사람이 고친 항목입니다. 가져오기는 이 항목을 덮어쓰지 않습니다. 매핑이 참조하는 기능은 삭제 대신 비활성으로 바꾸세요.</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} style={{ width: h.column.columnDef.meta?.width }} className="px-2 py-2 align-middle">
                    {h.column.getCanSort() ? (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}<ArrowUpDown className="h-3 w-3" />
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t align-top hover:bg-muted/20">
                {row.getVisibleCells().map((cell) => <td key={cell.id} className="px-2 py-1.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
              </tr>
            ))}
            {!table.getRowModel().rows.length && <tr><td colSpan={99} className="px-3 py-8 text-center text-muted-foreground">기능이 없습니다. Confluence 소스를 가져오거나 직접 추가하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <AddFeatureDialog open={adding} onClose={() => setAdding(false)} solutionCode={solution.code} onCreated={(f) => { setFeatures((cur) => [...cur, f]); setAdding(false); onChanged(); }} />
    </div>
  );
}

function AddFeatureDialog({ open, onClose, solutionCode, onCreated }: { open: boolean; onClose: () => void; solutionCode: string; onCreated: (f: RfpAdminFeature) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solutionCode}/features`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description: description.trim(), evidenceUrl: evidenceUrl.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      onCreated((await res.json()) as RfpAdminFeature);
      setName(""); setDescription(""); setEvidenceUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>기능 추가</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>기능 이름 <span className="text-xs text-muted-foreground">(40자 이내)</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1"><Label>설명</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
          <div className="grid gap-1"><Label>근거 URL</Label><Input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://…" /></div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>닫기</Button>
          <Button disabled={busy || !name.trim()} onClick={submit}>추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint -- src/app/admin src/components/admin/rfp-catalog`
Expected: 오류 없음. `h.column.columnDef.meta?.width`는 1단계 `types/tanstack-table.d.ts`의 `ColumnMeta.width` 확장으로 타입이 맞는다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/app/admin/layout.tsx frontend/src/app/admin/rfp-catalog frontend/src/components/admin/rfp-catalog
git commit -m "feat(rfp): 어드민 RFP 솔루션 카탈로그 화면 — 솔루션 목록·Confluence 소스 가져오기(폴링)·기능 표 인라인 편집"
```

---

### Task 15: 프로젝트 상세·목록 화면에 매핑 붙이기

**Files:**
- Create: `frontend/src/lib/rfp/mapping/client-catalog.ts`
- Create: `frontend/src/components/rfp/MappingRunButton.tsx`
- Create: `frontend/src/components/rfp/MappingSummary.tsx`
- Create: `frontend/src/components/rfp/MappingEditor.tsx`
- Modify: `frontend/src/components/rfp/RequirementsTable.tsx` (전체 교체)
- Modify: `frontend/src/components/rfp/OverviewCard.tsx`
- Modify: `frontend/src/components/rfp/ProjectList.tsx` (전체 교체)
- Modify: `frontend/src/app/rfp/[id]/page.tsx` (전체 교체)

**Interfaces:**
- Consumes: Task 1 타입·상수, Task 10 요약 함수, Task 12 API, `SearchableSelect`(`@/components/shared/SearchableSelect`), shadcn `Select`·`Textarea`·`Input`·`Badge`·`Dialog`.
- Produces: `toCatalog(res: RfpCatalogResponse) → CatalogSolution[]`; `MappingStatusBadge`(ProjectList에서 export); `RequirementsTable` props `{projectId, requirements, mappings, catalog, verdictFilter, onChange, onMappingsChange}`; `OverviewCard` props에 `catalogReady`·`onRunMapping` 추가.

- [ ] **Step 1: `client-catalog.ts`**

```ts
// frontend/src/lib/rfp/mapping/client-catalog.ts
import type { RfpCatalogResponse } from "@/types/rfp";
import type { CatalogSolution } from "./types";

/** GET /api/rfp/catalog 응답 → 순수 함수(summary.ts)가 쓰는 CatalogSolution[] */
export function toCatalog(res: RfpCatalogResponse): CatalogSolution[] {
  return res.solutions.map((s, i) => ({
    code: s.code, name: s.name, description: s.description, isActive: s.isActive, sortOrder: i,
    features: s.features.map((f) => ({ id: f.id, solutionCode: s.code, name: f.name, description: f.description, evidenceUrl: f.evidenceUrl, isActive: f.isActive })),
  }));
}
```

- [ ] **Step 2: `MappingRunButton.tsx`**

```tsx
// frontend/src/components/rfp/MappingRunButton.tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STALE_RUNNING_MS } from "@/lib/rfp/mapping/types";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
import type { RfpProjectDetail } from "@/types/rfp";

export default function MappingRunButton({ project, catalogReady, onRun }: { project: RfpProjectDetail; catalogReady: boolean; onRun: (mode: MappingMode) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
      await onRun(mode);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" disabled={disabled} title={title} onClick={() => (hasAny ? setOpen(true) : run("all"))}>
        {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
        {running ? "매핑 중" : "솔루션 매핑 실행"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>솔루션 매핑을 다시 실행할까요?</DialogTitle>
            <DialogDescription>
              {editedRequirements > 0
                ? `사람이 고친 매핑이 있는 요구사항 ${editedRequirements}건은 어느 방식이든 건드리지 않습니다.`
                : "Claude가 만든 매핑은 새 결과로 교체됩니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
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
          </div>
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>닫기</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: `MappingSummary.tsx`**

```tsx
// frontend/src/components/rfp/MappingSummary.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { UNMAPPED_LABEL, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type MappingRow, type Verdict } from "@/lib/rfp/mapping/types";
import { countBySolution, countByVerdict } from "@/lib/rfp/mapping/summary";

export type VerdictFilter = Verdict | "unmapped" | null;

const VERDICT_CLASS: Record<Verdict | "unmapped", string> = {
  fulfilled: "bg-emerald-100 text-emerald-900 hover:bg-emerald-200",
  partial: "bg-amber-100 text-amber-900 hover:bg-amber-200",
  build: "bg-sky-100 text-sky-900 hover:bg-sky-200",
  na: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  unmapped: "bg-rose-100 text-rose-900 hover:bg-rose-200",
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict | "unmapped"; className?: string }) {
  return <Badge variant="outline" className={cn("border-transparent", VERDICT_CLASS[verdict], className)}>{verdict === "unmapped" ? UNMAPPED_LABEL : VERDICT_LABEL[verdict]}</Badge>;
}

/** 표 위 요약: 판정별 건수 칩(클릭 → 필터) + 솔루션별 건수 */
export default function MappingSummary({ requirementIds, mappings, catalog, filter, onFilter }: {
  requirementIds: string[]; mappings: MappingRow[]; catalog: CatalogSolution[]; filter: VerdictFilter; onFilter: (f: VerdictFilter) => void;
}) {
  const counts = countByVerdict(requirementIds, mappings);
  const bySolution = countBySolution(mappings, catalog).filter((s) => s.fulfilled + s.partial > 0);
  const keys: (Verdict | "unmapped")[] = [...VERDICT_ORDER, "unmapped"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => onFilter(filter === k ? null : k)} className={cn("rounded-full ring-offset-background transition", filter === k && "ring-2 ring-ring ring-offset-1")} title="클릭하면 표를 이 판정으로 걸러 봅니다">
            <span className={cn("inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium", VERDICT_CLASS[k])}>
              {k === "unmapped" ? UNMAPPED_LABEL : VERDICT_LABEL[k]}<span className="tabular-nums">{counts[k]}</span>
            </span>
          </button>
        ))}
      </div>
      {bySolution.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {bySolution.map((s) => <span key={s.code}><span className="font-medium text-foreground">{s.name}</span> 충족 {s.fulfilled} · 부분 {s.partial}</span>)}
        </div>
      )}
    </div>
  );
}
```

`VerdictBadge`는 판정 하나를 표시하는 용도(RequirementsTable "당사 솔루션" 열)로만 쓴다. 칩은 위처럼 `<span>`으로 직접 그린다.

- [ ] **Step 4: `MappingEditor.tsx`**

```tsx
// frontend/src/components/rfp/MappingEditor.tsx
"use client";

import { useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchableSelect, { type SearchableOption } from "@/components/shared/SearchableSelect";
import { requiresFeature, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type Verdict } from "@/lib/rfp/mapping/types";
import type { RfpMapping, RfpRequirement } from "@/types/rfp";

interface Props {
  projectId: string;
  requirement: RfpRequirement;
  rows: RfpMapping[];
  catalog: CatalogSolution[];
  /** 이 요구사항의 행이 바뀌면 전체 목록에서 교체할 수 있게 새 행 목록을 준다 */
  onChange: (rows: RfpMapping[]) => void;
}

/** 규칙 필드(판정·솔루션·기능) 중 아직 저장 못 한 선택 — 충족/부분충족인데 기능을 아직 안 골랐을 때 */
interface Pending { verdict: Verdict; solutionCode: string | null; featureId: string | null }

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function MappingEditor({ projectId, requirement, rows, catalog, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [draft, setDraft] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const solutionOptions: SearchableOption[] = catalog.filter((s) => s.isActive).map((s) => ({ value: s.code, label: s.name }));
  const featureOptions = (solutionCode: string | null, currentFeatureId: string | null): SearchableOption[] => {
    const sol = catalog.find((s) => s.code === solutionCode);
    if (!sol) return [];
    return sol.features
      .filter((f) => f.isActive || f.id === currentFeatureId)
      .map((f) => ({ value: f.id, label: f.isActive ? f.name : `${f.name} (비활성)`, hint: f.description.slice(0, 40) }));
  };

  const replaceRow = (updated: RfpMapping) => onChange(rows.map((r) => (r.id === updated.id ? updated : r)));

  const patch = async (row: RfpMapping, body: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(`/api/rfp/mappings/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readError(res, "저장에 실패했습니다."));
    replaceRow((await res.json()) as RfpMapping);
  };

  /** 판정·솔루션·기능 변경. 충족/부분충족인데 기능이 없으면 저장하지 않고 pending에 둔다. */
  const changeRule = async (row: RfpMapping, next: Partial<Pending>) => {
    const cur: Pending = pending[row.id] ?? { verdict: row.verdict, solutionCode: row.solutionCode, featureId: row.featureId };
    const merged: Pending = { ...cur, ...next };
    if (next.solutionCode !== undefined && next.solutionCode !== cur.solutionCode) merged.featureId = null;
    if (!requiresFeature(merged.verdict)) { merged.solutionCode = null; merged.featureId = null; }
    if (requiresFeature(merged.verdict) && !merged.featureId) { setPending((p) => ({ ...p, [row.id]: merged })); return; }
    try {
      await patch(row, merged);
      setPending((p) => { const rest = { ...p }; delete rest[row.id]; return rest; });
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    }
  };

  const changeText = async (row: RfpMapping, field: "rationale" | "evidenceUrl", value: string) => {
    if ((row[field] ?? "") === value) return;
    try {
      await patch(row, { [field]: field === "evidenceUrl" ? value || null : value });
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    }
  };

  const remove = async (row: RfpMapping) => {
    setError(null);
    const res = await fetch(`/api/rfp/mappings/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    onChange(rows.filter((r) => r.id !== row.id));
  };

  /** 새 행: 판정이 build/na이거나 기능까지 골랐을 때 POST */
  const changeDraft = async (next: Partial<Pending>) => {
    const cur: Pending = draft ?? { verdict: "partial", solutionCode: null, featureId: null };
    const merged: Pending = { ...cur, ...next };
    if (next.solutionCode !== undefined && next.solutionCode !== cur.solutionCode) merged.featureId = null;
    if (!requiresFeature(merged.verdict)) { merged.solutionCode = null; merged.featureId = null; }
    if (requiresFeature(merged.verdict) && !merged.featureId) { setDraft(merged); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/mapping/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirementId: requirement.id, ...merged }),
      });
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      onChange([...rows, (await res.json()) as RfpMapping]);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const ruleRow = (value: Pending, onRule: (next: Partial<Pending>) => void, keyPrefix: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.verdict} onValueChange={(v) => onRule({ verdict: v as Verdict })}>
        <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{VERDICT_ORDER.map((v) => <SelectItem key={`${keyPrefix}-${v}`} value={v}>{VERDICT_LABEL[v]}</SelectItem>)}</SelectContent>
      </Select>
      <SearchableSelect value={value.solutionCode ?? ""} onChange={(v) => onRule({ solutionCode: v })} options={solutionOptions} placeholder="솔루션" className={`w-40 ${requiresFeature(value.verdict) ? "" : "pointer-events-none opacity-50"}`} />
      <SearchableSelect value={value.featureId ?? ""} onChange={(v) => onRule({ featureId: v })} options={featureOptions(value.solutionCode, value.featureId)} placeholder={value.solutionCode ? "기능" : "솔루션 먼저"} emptyText="활성 기능이 없습니다" className={`w-56 ${requiresFeature(value.verdict) ? "" : "pointer-events-none opacity-50"}`} />
      {requiresFeature(value.verdict) && !value.featureId && <span className="text-xs text-amber-700">기능을 고르면 저장됩니다</span>}
    </div>
  );

  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">{requirement.reqId} 솔루션 매핑 {sorted.length}행</div>
        <Button size="sm" variant="outline" disabled={busy || draft !== null} onClick={() => setDraft({ verdict: "partial", solutionCode: null, featureId: null })}><Plus className="mr-1 h-4 w-4" />행 추가</Button>
      </div>
      {sorted.map((row) => {
        const value = pending[row.id] ?? { verdict: row.verdict, solutionCode: row.solutionCode, featureId: row.featureId };
        return (
          <div key={row.id} className="space-y-2 rounded-md border bg-background p-3" title={row.updatedBy ? `수정 ${new Date(row.updatedAt).toLocaleString("ko-KR")}` : undefined}>
            <div className="flex items-start justify-between gap-2">
              {ruleRow(value, (next) => changeRule(row, next), row.id)}
              <div className="flex items-center gap-1">
                {row.edited && <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-label="사람이 고친 행" />}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="행 삭제" onClick={() => remove(row)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <Textarea defaultValue={row.rationale} rows={2} placeholder="설명(왜 이 판정인지)" className="min-h-0 text-sm" onBlur={(e) => changeText(row, "rationale", e.target.value.trim())} />
            <div className="flex items-center gap-1">
              <Input defaultValue={row.evidenceUrl ?? ""} placeholder="근거 URL" className="h-8 text-xs" onBlur={(e) => changeText(row, "evidenceUrl", e.target.value.trim())} />
              {row.evidenceUrl && <a href={row.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-4 w-4" /></a>}
            </div>
          </div>
        );
      })}
      {draft && (
        <div className="space-y-2 rounded-md border border-dashed bg-background p-3">
          <div className="flex items-start justify-between gap-2">
            {ruleRow(draft, changeDraft, "draft")}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>취소</Button>
          </div>
          <div className="text-xs text-muted-foreground">설계·구축영역/해당없음을 고르면 바로 추가되고, 충족/부분충족은 기능까지 고르면 추가됩니다. 설명·근거 URL은 추가된 뒤 입력하세요.</div>
        </div>
      )}
      {!sorted.length && !draft && <div className="text-sm text-muted-foreground">매핑이 없습니다(미매핑). &quot;행 추가&quot;로 직접 매핑하거나 개요의 &quot;솔루션 매핑 실행&quot;을 누르세요.</div>}
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 5: `RequirementsTable.tsx` 전체 교체**

1단계 파일을 아래로 바꾼다. 달라진 점: props에 `mappings`·`catalog`·`verdictFilter`·`onMappingsChange`, "당사 솔루션" 열이 읽기 전용 요약, 행 앞 펼침 열, 펼친 행 아래 `MappingEditor`, 판정 필터, `getRowId`.

```tsx
// frontend/src/components/rfp/RequirementsTable.tsx
"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import {
  createColumnHelper, flexRender, getCoreRowModel, getExpandedRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ExpandedState, type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import MappingEditor from "@/components/rfp/MappingEditor";
import { VerdictBadge, type VerdictFilter } from "@/components/rfp/MappingSummary";
import { orderCategoryCodes, sheetNameFor } from "@/lib/rfp/requirements";
import { bestVerdict, groupByRequirement, indexCatalog, mappingSummary } from "@/lib/rfp/mapping/summary";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";
import type { RfpMapping, RfpRequirement } from "@/types/rfp";

interface Props {
  projectId: string;
  requirements: RfpRequirement[];
  mappings: RfpMapping[];
  catalog: CatalogSolution[];
  verdictFilter: VerdictFilter;
  onChange: (next: RfpRequirement[]) => void;
  onMappingsChange: (next: RfpMapping[]) => void;
}

type EditableField = "categoryName" | "reqId" | "title" | "definition" | "details" | "deliverables" | "related";

async function patchRequirement(id: string, patch: Partial<Record<EditableField, string>>): Promise<RfpRequirement> {
  const res = await fetch(`/api/rfp/requirements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const json = (await res.json().catch(() => ({}))) as RfpRequirement & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
  return json;
}

export default function RequirementsTable({ projectId, requirements, mappings, catalog, verdictFilter, onChange, onMappingsChange }: Props) {
  const codes = useMemo(() => orderCategoryCodes(requirements.map((r) => r.categoryCode)), [requirements]);
  const sheetIndex = useMemo(() => new Map(codes.map((c, i) => [c, i + 2])), [codes]);
  const categoryNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requirements) if (!m.has(r.categoryCode)) m.set(r.categoryCode, r.categoryName);
    return m;
  }, [requirements]);
  const index = useMemo(() => indexCatalog(catalog), [catalog]);
  const groups = useMemo(() => groupByRequirement(mappings), [mappings]);
  const [tab, setTab] = useState("all");
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<RfpRequirement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback((row: RfpRequirement, field: EditableField) => async (next: string) => {
    const updated = await patchRequirement(row.id, { [field]: next });
    onChange(requirements.map((r) => (r.id === row.id ? updated : r)));
  }, [requirements, onChange]);

  const removeRow = async (row: RfpRequirement) => {
    const res = await fetch(`/api/rfp/requirements/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    onChange(requirements.filter((r) => r.id !== row.id));
    onMappingsChange(mappings.filter((m) => m.requirementId !== row.id));
  };

  /** 요구사항 하나의 매핑 행이 바뀌면 전체 목록에서 그 요구사항 행만 교체 */
  const replaceMappingsFor = useCallback((requirementId: string, rows: RfpMapping[]) => {
    onMappingsChange([...mappings.filter((m) => m.requirementId !== requirementId), ...rows]);
  }, [mappings, onMappingsChange]);

  // save·groups·index가 바뀔 때마다 컬럼을 다시 만든다(편집 콜백이 옛 requirements를 캡처하지 않게 — 1단계와 같은 이유)
  const { allColumns, detailColumns } = useMemo(() => {
    const col = createColumnHelper<RfpRequirement>();
    const editable = (field: EditableField, header: string, opts: { clamp?: number; width?: string } = {}) =>
      col.accessor(field, {
        header,
        cell: (ctx) => <EditableCell value={ctx.getValue()} onSave={save(ctx.row.original, field)} clampLines={opts.clamp ?? 3} />,
        meta: { width: opts.width },
      });
    const expander = col.display({
      id: "expand",
      header: "",
      cell: (ctx) => (
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="솔루션 매핑 펼치기" onClick={ctx.row.getToggleExpandedHandler()}>
          {ctx.row.getIsExpanded() ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      ),
      meta: { width: "2rem" },
    });
    const actions = col.display({
      id: "actions",
      header: "",
      cell: (ctx) => <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="행 삭제" onClick={() => setDeleting(ctx.row.original)}><Trash2 className="h-4 w-4" /></Button>,
      meta: { width: "3rem" },
    });
    const seq = col.display({ id: "seq", header: "연번", cell: (ctx) => <span className="tabular-nums text-muted-foreground">{ctx.row.index + 1}</span>, meta: { width: "3.5rem" } });
    const solution = col.display({
      id: "solution",
      header: "당사 솔루션",
      cell: (ctx) => {
        const g = groups.get(ctx.row.original.id) ?? [];
        const best = bestVerdict(g);
        return (
          <div className="space-y-1">
            <VerdictBadge verdict={best ?? "unmapped"} />
            {g.length > 0 && <div className="line-clamp-2 text-xs text-muted-foreground">{mappingSummary(g, index)}</div>}
          </div>
        );
      },
      meta: { width: "16rem" },
    });

    return {
      allColumns: [
        expander,
        seq,
        editable("categoryName", "요구사항 구분", { clamp: 0, width: "11rem" }),
        editable("reqId", "요구사항 ID", { clamp: 0, width: "8rem" }),
        editable("title", "요구사항 명칭", { clamp: 0, width: "20rem" }),
        col.display({ id: "sheet", header: "상세 시트 위치", cell: (ctx) => <span className="text-muted-foreground">{sheetNameFor(ctx.row.original.categoryCode, sheetIndex.get(ctx.row.original.categoryCode) ?? 0)}</span>, meta: { width: "8rem" } }),
        solution,
        actions,
      ],
      detailColumns: [
        expander,
        seq,
        editable("reqId", "요구사항 ID", { clamp: 0, width: "8rem" }),
        editable("title", "요구사항명", { clamp: 0, width: "14rem" }),
        editable("definition", "정의", { clamp: 3, width: "14rem" }),
        editable("details", "세부 내용", { clamp: 3, width: "30rem" }),
        editable("deliverables", "산출정보", { clamp: 3, width: "10rem" }),
        editable("related", "관련요구사항", { clamp: 3, width: "12rem" }),
        solution,
        actions,
      ],
    };
  }, [save, sheetIndex, groups, index]);

  const data = useMemo(() => {
    const byTab = tab === "all" ? requirements : requirements.filter((r) => r.categoryCode === tab);
    if (!verdictFilter) return byTab;
    return byTab.filter((r) => (bestVerdict(groups.get(r.id) ?? []) ?? "unmapped") === verdictFilter);
  }, [requirements, tab, verdictFilter, groups]);

  const table = useReactTable({
    data,
    columns: tab === "all" ? allColumns : detailColumns,
    state: { sorting, globalFilter: filter, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onExpandedChange: setExpanded,
    getRowId: (r) => r.id,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    globalFilterFn: (row, _id, value: string) => {
      const q = value.toLowerCase();
      const r = row.original;
      const summary = mappingSummary(groups.get(r.id) ?? [], index);
      return [r.reqId, r.title, r.categoryName, r.definition, r.details, r.deliverables, r.related, summary].some((s) => s.toLowerCase().includes(q));
    },
  });
  const colCount = (tab === "all" ? allColumns : detailColumns).length;

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all">전체 목록 <span className="ml-1 text-xs text-muted-foreground">{requirements.length}</span></TabsTrigger>
            {codes.map((c) => (
              <TabsTrigger key={c} value={c}>{c} <span className="ml-1 text-xs text-muted-foreground">{requirements.filter((r) => r.categoryCode === c).length}</span></TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ID·명칭·내용·솔루션 검색" className="h-8 w-56" />
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />행 추가</Button>
          </div>
        </div>
        <TabsContent value={tab} forceMount className="mt-3">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} style={{ width: h.column.columnDef.meta?.width }} className="px-2 py-2 align-middle">
                        {h.column.getCanSort() ? (
                          <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}<ArrowUpDown className="h-3 w-3" />
                          </button>
                        ) : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t align-top hover:bg-muted/20" title={row.original.updatedBy ? `수정 ${new Date(row.original.updatedAt).toLocaleString("ko-KR")}` : undefined}>
                      {row.getVisibleCells().map((cell) => <td key={cell.id} className="px-2 py-1.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                    </tr>
                    {row.getIsExpanded() && (
                      <tr className="border-t bg-muted/10">
                        <td colSpan={colCount} className="px-3 py-2">
                          <MappingEditor
                            projectId={projectId}
                            requirement={row.original}
                            rows={groups.get(row.original.id) ?? []}
                            catalog={catalog}
                            onChange={(rows) => replaceMappingsFor(row.original.id, rows)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {table.getRowModel().rows.length === 0 && <tr><td colSpan={colCount} className="px-3 py-8 text-center text-muted-foreground">표시할 요구사항이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
      {error && <div className="text-sm text-destructive">{error}</div>}

      <AddRowDialog
        open={adding}
        onClose={() => setAdding(false)}
        projectId={projectId}
        codes={codes}
        categoryNames={categoryNames}
        defaultCode={tab === "all" ? codes[0] ?? "SER" : tab}
        onCreated={(row) => { onChange([...requirements, row]); setAdding(false); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>요구사항 {deleting?.reqId}을(를) 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.title} — 이 요구사항의 솔루션 매핑도 함께 지워집니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (deleting) await removeRow(deleting); setDeleting(null); }}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

`AddRowDialog` 함수는 1단계 파일의 것을 **그대로** 파일 끝에 남긴다(변경 없음).

- [ ] **Step 6: `OverviewCard.tsx` 수정**

1. import 추가:
```ts
import MappingRunButton from "@/components/rfp/MappingRunButton";
import { MappingStatusBadge } from "@/components/rfp/ProjectList";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
```
2. `Props`에 두 줄 추가:
```ts
  catalogReady: boolean;
  onRunMapping: (mode: MappingMode) => Promise<void>;
```
   함수 시그니처도 `{ project, canDelete, catalogReady, onPatched, onReextract, onRunMapping, onDelete }`로.
3. `CardTitle` 안 `<StatusBadge status={project.status} />` 뒤에 `<MappingStatusBadge status={project.mappingStatus} />` 추가.
4. 헤더 설명 줄(`요구사항 N건 …`) 끝에 매핑 시각 추가:
```tsx
            {project.mappingAt && ` · 매핑 ${new Date(project.mappingAt).toLocaleString("ko-KR")}`}
```
5. 버튼 묶음에서 xlsx 버튼 앞에 `<MappingRunButton project={project} catalogReady={catalogReady} onRun={onRunMapping} />` 추가.
6. `CardContent` 끝(warnings Alert 뒤)에 추가:
```tsx
        {project.mappingStatus === "failed" && project.mappingError && (
          <Alert variant="destructive"><AlertDescription>솔루션 매핑 실패: {project.mappingError} — &quot;솔루션 매핑 실행 → 미매핑만&quot;으로 이어서 할 수 있습니다.</AlertDescription></Alert>
        )}
        {project.mappingWarnings.length > 0 && (
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">매핑 경고 {project.mappingWarnings.length}건</summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">{project.mappingWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
```

- [ ] **Step 7: `ProjectList.tsx` 전체 교체**

```tsx
// frontend/src/components/rfp/ProjectList.tsx
"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RfpMappingStatus, RfpProjectStatus, RfpProjectSummary } from "@/types/rfp";

export function StatusBadge({ status }: { status: RfpProjectStatus }) {
  if (status === "extracting") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />추출 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">실패</Badge>;
  return <Badge>완료</Badge>;
}

export function MappingStatusBadge({ status }: { status: RfpMappingStatus }) {
  if (status === "running") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />매핑 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">매핑 실패</Badge>;
  if (status === "ready") return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">매핑 완료</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">매핑 없음</Badge>;
}

export default function ProjectList({ projects, loading }: { projects: RfpProjectSummary[]; loading: boolean }) {
  if (loading) return <div className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</div>;
  if (!projects.length) return <div className="py-10 text-center text-sm text-muted-foreground">등록된 프로젝트가 없습니다. 위에서 제안요청서를 올려 시작하세요.</div>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">사업명</th>
            <th className="px-3 py-2">발주기관</th>
            <th className="px-3 py-2 text-right">요구사항</th>
            <th className="px-3 py-2">상태</th>
            <th className="px-3 py-2">매핑</th>
            <th className="px-3 py-2">등록자</th>
            <th className="px-3 py-2">등록일</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-t hover:bg-muted/30">
              <td className="px-3 py-2"><Link href={`/rfp/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
              <td className="px-3 py-2 text-muted-foreground">{p.agency ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.requirementCount}</td>
              <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
              <td className="px-3 py-2"><MappingStatusBadge status={p.mappingStatus} /></td>
              <td className="px-3 py-2 text-muted-foreground">{p.createdBy.name ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("ko-KR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: `app/rfp/[id]/page.tsx` 전체 교체**

```tsx
// frontend/src/app/rfp/[id]/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import OverviewCard from "@/components/rfp/OverviewCard";
import RequirementsTable from "@/components/rfp/RequirementsTable";
import MappingSummary, { type VerdictFilter } from "@/components/rfp/MappingSummary";
import { useUserRole } from "@/hooks/useUserRole";
import { toCatalog } from "@/lib/rfp/mapping/client-catalog";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
import type { MappingResponse, RfpCatalogResponse, RfpProjectDetail, StatusResponse } from "@/types/rfp";

const POLL_MS = 3000;
const STUCK_MS = 3 * 60 * 1000;

export default function RfpProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isAdmin } = useUserRole();
  const [project, setProject] = useState<RfpProjectDetail | null>(null);
  const [catalog, setCatalog] = useState<CatalogSolution[]>([]);
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const stuckRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rfp/projects/${id}`);
    if (res.status === 404) { setError("프로젝트가 없습니다."); return; }
    const json = (await res.json()) as RfpProjectDetail & { error?: string };
    if (!res.ok) { setError(json.error ?? "불러오지 못했습니다."); return; }
    setProject(json);
  }, [id]);

  const loadMappings = useCallback(async () => {
    const res = await fetch(`/api/rfp/projects/${id}/mapping`);
    if (!res.ok) return;
    const m = (await res.json()) as MappingResponse;
    setProject((p) => (p ? { ...p, mappingStatus: m.mappingStatus, mappingError: m.mappingError, mappingWarnings: m.mappingWarnings, mappingAt: m.mappingAt, mappings: m.mappings } : p));
  }, [id]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    fetch("/api/users/role").then((r) => r.json()).then((j: { userId?: string }) => setMe(j.userId ?? null)).catch(() => undefined);
    fetch("/api/rfp/catalog").then(async (r) => (r.ok ? toCatalog((await r.json()) as RfpCatalogResponse) : [])).then(setCatalog).catch(() => setCatalog([]));
  }, []);

  // 추출 중이거나 매핑 중이면 상태만 폴링, 끝나면 재조회(추출은 전체, 매핑은 매핑만)
  useEffect(() => {
    if (!project) return;
    const extracting = project.status === "extracting";
    const mapping = project.mappingStatus === "running";
    if (!extracting && !mapping) return;
    const startedAt = new Date(project.updatedAt).getTime();
    const t = setInterval(async () => {
      const res = await fetch(`/api/rfp/projects/${id}?fields=status`);
      if (!res.ok) return;
      const s = (await res.json()) as StatusResponse;
      if (extracting && s.status !== "extracting") { await load(); return; }
      if (mapping && s.mappingStatus !== "running") { await loadMappings(); return; }
      if (Date.now() - startedAt > STUCK_MS && !stuckRef.current) {
        stuckRef.current = true;
        setNotice(extracting
          ? "추출이 3분 넘게 진행 중입니다. 서버 시간 제한(5분)에 걸리면 실패로 표시되며, 그때 '재추출'로 다시 시도할 수 있습니다."
          : "매핑이 3분 넘게 진행 중입니다. 서버 시간 제한(5분)에 걸리면 끝난 청크까지만 저장되며, 6분 뒤 '솔루션 매핑 실행 → 미매핑만'으로 이어서 할 수 있습니다.");
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [project, id, load, loadMappings]);

  const reextract = async () => {
    setNotice(null);
    let res = await fetch(`/api/rfp/projects/${id}/reextract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 409) {
      const j = (await res.json()) as { needsConfirm?: boolean; editedCount?: number; error?: string };
      if (!j.needsConfirm) { setError(j.error ?? "재추출할 수 없습니다."); return; }
      if (!window.confirm(`편집한 요구사항 ${j.editedCount}건이 원본 추출 결과로 덮어써집니다. 계속할까요?`)) return;
      res = await fetch(`/api/rfp/projects/${id}/reextract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    }
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "재추출 요청에 실패했습니다."); return; }
    stuckRef.current = false;
    await load();
  };

  const runMapping = async (mode: MappingMode) => {
    setNotice(null);
    setError(null);
    const post = (body: object) => fetch(`/api/rfp/projects/${id}/mapping`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let res = await post({ mode });
    if (res.status === 409) {
      const j = (await res.json()) as { needsConfirm?: boolean; editedRequirements?: number; running?: boolean; error?: string };
      if (j.running) { setNotice(j.error ?? "이미 매핑 중입니다."); await loadMappings(); return; }
      if (!j.needsConfirm) { setError(j.error ?? "매핑을 시작할 수 없습니다."); return; }
      if (!window.confirm(`사람이 고친 매핑이 있는 요구사항 ${j.editedRequirements}건은 건너뛰고 나머지를 다시 매핑합니다. 계속할까요?`)) return;
      res = await post({ mode, confirm: true });
    }
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "매핑 요청에 실패했습니다."); return; }
    stuckRef.current = false;
    setProject((p) => (p ? { ...p, mappingStatus: "running", mappingError: null, updatedAt: new Date().toISOString() } : p));
  };

  const remove = async () => {
    const res = await fetch(`/api/rfp/projects/${id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    router.push("/rfp");
  };

  if (error && !project) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        <Button variant="outline" asChild><Link href="/rfp"><ArrowLeft className="mr-1 h-4 w-4" />목록으로</Link></Button>
      </div>
    );
  }
  if (!project) return <div className="p-10 text-center text-sm text-muted-foreground">불러오는 중…</div>;

  const catalogReady = catalog.some((s) => s.isActive && s.features.some((f) => f.isActive));

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
      <Link href="/rfp" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />RFP 분석 목록</Link>
      <OverviewCard
        project={project}
        canDelete={isAdmin || (me !== null && me === project.createdBy.id)}
        catalogReady={catalogReady}
        onPatched={(patch) => setProject((p) => (p ? { ...p, ...patch } : p))}
        onReextract={reextract}
        onRunMapping={runMapping}
        onDelete={remove}
      />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      {project.status === "extracting" ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">요구사항을 추출하고 있습니다… 표준 양식은 몇 초, LLM 추출은 수 분 걸릴 수 있습니다.</div>
      ) : (
        <>
          <MappingSummary
            requirementIds={project.requirements.map((r) => r.id)}
            mappings={project.mappings}
            catalog={catalog}
            filter={verdictFilter}
            onFilter={setVerdictFilter}
          />
          <RequirementsTable
            projectId={project.id}
            requirements={project.requirements}
            mappings={project.mappings}
            catalog={catalog}
            verdictFilter={verdictFilter}
            onChange={(next) => setProject((p) => (p ? { ...p, requirements: next, requirementCount: next.length } : p))}
            onMappingsChange={(next) => setProject((p) => (p ? { ...p, mappings: next } : p))}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 9: 타입·린트·전체 테스트·빌드**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npm test -- rfp- && npm run build`
Expected: 모두 통과. lint에서 `react-hooks/exhaustive-deps` 경고가 나면 의존성을 실제로 맞추되, `FeatureTable`의 컬럼 useMemo처럼 의도적으로 `remove`를 빼는 곳만 `eslint-disable-line`으로 남기고 이유를 주석에 쓴다.

- [ ] **Step 10: 수동 확인(dev 서버)**

`cd frontend && NODE_OPTIONS=--max-http-header-size=131072 npm run dev -- -p 3003` 후 컨트롤러가 브라우저로 확인한다(구현자는 빌드까지). 확인 항목은 Task 16 런북 체크리스트 11~20.

- [ ] **Step 11: 커밋**

```bash
git add frontend/src/lib/rfp/mapping/client-catalog.ts frontend/src/components/rfp "frontend/src/app/rfp/[id]/page.tsx"
git commit -m "feat(rfp): 상세 화면 솔루션 매핑 — 실행 버튼(전체/미매핑)·판정 요약 칩·행 펼침 매핑 편집·목록 매핑 상태"
```

---

### Task 16: 문서(런북·CLAUDE.md)

**Files:**
- Modify: `docs/rfp-analyzer.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 런북 `docs/rfp-analyzer.md` 갱신**

맨 위 설계·계획 줄을 다음으로 바꾼다.
```markdown
설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md`(1단계) · `docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md`(2단계) · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md` · `docs/superpowers/plans/2026-09-04-rfp-analyzer-phase2.md`
```

"## 구성" 끝에 추가:
```markdown
- **2단계(솔루션 매핑)**: 어드민 `/admin/rfp-catalog`에서 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit 시드)마다 Confluence 페이지 URL을 등록해 "가져오기" → 서버가 페이지 id로 REST 조회 → Claude가 기능 목록 정리 → 카탈로그 병합(사람이 고친 ✎ 항목은 덮어쓰지 않음). 상세 화면 "솔루션 매핑 실행" → `after()`에서 카탈로그를 시스템 프롬프트(캐싱)로 넣고 요구사항 20건씩(동시 3) Claude 호출 → 요구사항별 0~N행(솔루션·기능·판정 충족/부분충족/설계·구축영역/해당없음·설명·근거 URL). 사람이 고친 행(✎)이 있는 요구사항은 재실행에서 제외. 테이블 `rfp_solutions`·`rfp_solution_sources`·`rfp_solution_features`·`rfp_requirement_mappings` + `rfp_projects.mapping_*` — SQL `docs/sql/2026-09-04-rfp-solution-mapping.sql`.
```

"## 환경 변수" 표에 행 추가:
```markdown
| `ATLASSIAN_SITE`·`ATLASSIAN_EMAIL`·`ATLASSIAN_API_TOKEN` | 기존(성과 지표와 공유). 카탈로그 Confluence 가져오기. 없으면 가져오기 400 |
```
`ANTHROPIC_API_KEY` 행 설명을 `비표준 RFP LLM 폴백 + 2단계 카탈로그 가져오기·솔루션 매핑. 없으면 표준 양식 추출만 동작` 으로 바꾼다.

"## 최초 설치"에 항목 추가:
```markdown
4. (2단계) `docs/sql/2026-09-04-rfp-solution-mapping.sql` 실행 → 테이블 4개 + 시드 5건. Vercel env에 `ANTHROPIC_API_KEY`가 있어야 가져오기·매핑이 동작한다.
5. (2단계) 어드민 `/admin/rfp-catalog`에서 솔루션별 Confluence 페이지 URL 등록 → 가져오기 → 기능 표 검토(이름·설명 정리, 회의록성 항목 비활성).
```

"## 운영 메모" 끝에 추가:
```markdown
- 매핑 프롬프트에는 UUID 대신 `S{n}`/`F{n}` 별칭을 쓰고 서버가 되돌린다. 없는 별칭·청크에 없는 ID는 버리고 `mapping_warnings`에 남는다.
- 매핑은 청크마다 즉시 저장한다. `running`이 6분 넘으면(after()가 300초 제한에 죽었다고 보고) 버튼이 다시 살아나며 "미매핑만"으로 이어서 할 수 있다. 가져오기도 소스 단위로 같은 규칙.
- 카탈로그 기능·솔루션은 매핑이 참조하면 삭제(409) 대신 비활성으로 바꾼다. 비활성 기능은 콤보에서 사라지지만 기존 매핑 표시는 `[비활성]`으로 남는다.
- Confluence URL은 `ATLASSIAN_SITE` 호스트의 `/wiki/spaces/{KEY}/pages/{id}`·`/wiki/pages/viewpage.action?pageId=`·`/wiki/pages/{id}`만 받는다. 짧은 링크(`/wiki/x/…`)는 페이지를 열어 전체 URL을 복사한다.
- xlsx: `1.요구사항_목록`에 매핑 5열(솔루션·기능·판정·매핑 설명·근거 URL, 여러 행은 셀 안 줄바꿈), `0.개요`에 "3. 솔루션 매핑 요약", 마지막 시트 `{n}.솔루션_매핑`(매핑 1행 = 1줄, 미매핑 포함, 수정 표시). 상세 시트 번호는 1단계 그대로.
- 비용 감: 카탈로그 ~1만 토큰 캐시 + 청크 7회(124건). 프로젝트당 1달러 미만 추정. 상세 화면에는 비용을 표시하지 않는다.
```

"## 수동 회귀 체크리스트" 끝에 추가:
```markdown
11. admin으로 `/admin/rfp-catalog` 진입 → 5개 솔루션 보임 → SECloudit 선택 → 설명 인라인 편집 → 새로고침 후 유지.
12. Confluence 페이지 URL 추가(다른 호스트·`/x/` 링크는 400 문구) → "전체 가져오기" → 상태 "가져오는 중" → 완료 → 기능 표에 항목, 소스 행에 제목·버전·기능 수.
13. 기능 이름 수정(✎ 표시) → 다시 가져오기 → 수정한 이름 유지, 소스 메모 "사람이 고친 기능 N개는 유지".
14. 기능 비활성 토글 → 상세 화면 콤보에서 사라짐. 매핑이 참조하는 기능 삭제 → 409 안내.
15. 샘플 프로젝트 상세 → "솔루션 매핑 실행" → 배지 "매핑 중" → 완료 → 판정 칩 건수 합 = 요구사항 수, 목록 "매핑 완료".
16. 행 펼침 → 판정 변경·기능 변경·설명 입력 → 새로고침 후 유지, ✎ 표시. build/na로 바꾸면 솔루션·기능 비활성화.
17. 행 추가(부분충족 → 솔루션 → 기능 고르면 추가) → 같은 기능 중복 추가 시 400 문구. build 행이 있는 요구사항에 충족 추가 시 400 문구.
18. "솔루션 매핑 실행" 다시 → 다이얼로그 "전체 다시 매핑 / 미매핑 N건만" → 전체 → 확인창(사람이 고친 요구사항 건너뜀) → 완료 후 ✎ 행 그대로.
19. 판정 칩 클릭 → 표 필터, 다시 클릭 → 해제. 검색에 솔루션명 입력 → 매핑 요약으로도 걸러짐.
20. xlsx 다운로드 → 목록 시트 11열, 마지막 시트 `19.솔루션_매핑`(샘플은 상세 17개), 개요 "3. 솔루션 매핑 요약".
```

"## 2·3단계 접점" 절을 다음으로 바꾼다.
```markdown
## 3단계 접점
- 3단계(SharePoint): `GET /api/rfp/projects/[id]/xlsx` 버퍼(매핑 시트 포함)를 Graph 드라이브 업로드로 전달. 2단계 테이블은 3단계와 무관.
```

- [ ] **Step 2: `CLAUDE.md` 갱신**

1. App Router Pages의 `/rfp` 항목 뒤에 추가:
```markdown
- `/admin/rfp-catalog` — RFP 솔루션 카탈로그(admin): 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit) · Confluence 소스 URL 등록/가져오기(Claude 기능 추출, ✎ 편집 항목 보존) · 기능 표 인라인 편집
```
   `/rfp` 항목 설명 끝에 ` → 솔루션 매핑(상세 "솔루션 매핑 실행", 요구사항별 판정 충족/부분충족/설계·구축영역/해당없음, 행 펼침 편집)` 추가.
2. API Routes의 `/api/rfp/…` 항목 뒤에 추가:
```markdown
- `/api/admin/rfp-catalog/{solutions,solutions/[code],solutions/[code]/{sources,import,features},sources/[sourceId],features/[featureId]}` — 카탈로그 관리(admin). 가져오기는 `after()`+`runImport`
- `GET /api/rfp/catalog`, `/api/rfp/projects/[id]/mapping`(GET·POST {mode all|missing, confirm}), `POST /api/rfp/projects/[id]/mapping/rows`, `/api/rfp/mappings/[mappingId]`(PATCH·DELETE) — 솔루션 매핑(user 이상). 실행은 `after()`+`runMapping`(20건 청크·동시 3·청크별 저장)
```
3. Supabase Tables (RFP 분석) 줄에 추가:
```markdown
- `rfp_solutions`, `rfp_solution_sources`(Confluence 페이지·import_status), `rfp_solution_features`(name_norm 유니크·edited), `rfp_requirement_mappings`(요구사항별 0~N행·verdict·edited), `rfp_projects.mapping_status|mapping_error|mapping_warnings|mapping_at` — SQL `docs/sql/2026-09-04-rfp-solution-mapping.sql`
```
4. Key Patterns의 **RFP 분석** 문단 끝에 추가:
```markdown
 2단계: `lib/rfp/catalog/`(Confluence URL→페이지 id·storage XHTML→텍스트·Claude 기능 추출·이름 정규화 병합·`runImport`) · `lib/rfp/mapping/`(판정 상수 `types.ts`·S/F 별칭 프롬프트·20건 청크·출력 검증·요약/건수·`runMapping`). 라우트는 `runImport`·`runMapping`만 호출. `rfp_requirements.solution`은 더는 편집하지 않고 화면·xlsx의 "당사 솔루션"은 `mappingSummary`로 만든다.
```
5. Environment Variables의 `ANTHROPIC_API_KEY` 줄 설명을 `RFP 비표준 문서 LLM 폴백 + 카탈로그 기능 추출 + 솔루션 매핑`으로 바꾸고, `ATLASSIAN_*`가 카탈로그 Confluence 가져오기에도 쓰인다는 한 줄을 추가.
6. Directory Layout `components/`에 `admin/rfp-catalog/`(솔루션·소스·기능 표), `lib/`의 `rfp/` 설명에 `catalog/·mapping/`를 추가.

- [ ] **Step 3: 커밋**

```bash
git add docs/rfp-analyzer.md CLAUDE.md
git commit -m "docs(rfp): 2단계 런북(구성·env·설치·운영 메모·체크리스트 11~20)과 CLAUDE.md 갱신"
```

---

## 셀프 리뷰 메모(계획 작성자)

- 스펙 §3.1 `rfp_solution_sources`에 없던 `note` 컬럼을 추가했다(가져오기 안내 문구 "사람이 고친 기능 N개는 유지"를 `error`와 분리해 두기 위해). 스펙 §3.2의 "화면에 '사람이 고친 항목 N개는 유지'" 요구를 만족시키는 최소 변경이다.
- 스펙 §5.2 `GET /api/rfp/projects/[id]/mapping`과 상세 GET의 `mappings`가 중복되지만 스펙대로 둘 다 둔다(초기 로드는 상세, 실행 완료 후 갱신은 mapping GET).
- `effort: "medium"`은 SDK 타입에 있을 때만 넣는다(Task 11 Step 3 메모). 없으면 생략하고 보고.
- 스펙 §6.2의 "행 클릭 시 펼침"은 행 전체 클릭이 셀 편집과 충돌하므로 행 앞 ▸ 버튼으로 펼친다(스펙 본문도 ▸ 아이콘으로 적혀 있다).
