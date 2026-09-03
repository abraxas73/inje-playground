# RFP 분석 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제안요청서(hwp·hwpx·docx)를 올리면 프로젝트를 등록하고(중복 판단 포함) 요구사항을 추출해 화면에서 편집·xlsx 다운로드할 수 있는 `/rfp` 대메뉴를 만든다.

**Architecture:** 전부 Next.js 16 App Router. 순수 로직(파서 3종 → 공통 DocumentModel → 개요 추출·중복 판단·규칙/LLM 추출·xlsx)은 `frontend/src/lib/rfp/`에 두고 vitest로 검증한다. 파일은 브라우저가 Supabase Storage(`rfp` 버킷)에 서명 URL로 직접 올리고, API 라우트는 경로만 받아 파싱·등록하며 추출은 `after()`로 응답 뒤에 이어서 실행한다. 데이터는 `rfp_projects`·`rfp_files`·`rfp_requirements` 세 테이블.

**Tech Stack:** Next.js 16.1.6 / React 19 / TypeScript strict / Tailwind 4 / shadcn(ui 폴더 기존 컴포넌트) / Supabase(service role) / `cfb` + `node:zlib`(HWP) / `fflate` + `fast-xml-parser`(hwpx·docx) / `exceljs` / `@tanstack/react-table@8` / `@anthropic-ai/sdk` + `zod` / vitest

**Spec:** `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md`

## Global Constraints

- 모든 명령은 `frontend/` 안에서 실행한다(`cd frontend`). 이 worktree에는 `node_modules`가 없으므로 Task 1에서 `npm install`을 먼저 한다.
- 화면 문구·커밋 메시지·주석은 한국어. 커밋 메시지 형식은 `feat(rfp): …`, `test(rfp): …`, `docs(rfp): …` 이고 마지막에 아래 두 줄을 붙인다.
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv
  ```
- `git stash`를 쓰지 않는다(공유 stash). 작업을 잠시 치울 일이 있으면 WIP 커밋.
- 테스트는 `frontend/src/lib/__tests__/rfp-*.test.ts`, 실행은 `npm test -- rfp-…`(vitest run). 픽스처는 `frontend/src/lib/__tests__/fixtures/rfp/`.
- `@tanstack/react-table`은 **v8(`^8.21.3`)** 로 고정한다(v9는 API가 다르다). `@anthropic-ai/sdk`는 최신, `zod`는 4.x.
- LLM 모델은 `claude-opus-5`(env `RFP_LLM_MODEL`로 교체), `thinking: { type: "adaptive" }`, 스트리밍 + `finalMessage()`, `max_tokens: 64000`, 구조화 출력은 `output_config.format = zodOutputFormat(schema)`. 공개 입찰 문서 추출이라 refusal fallback 베타는 넣지 않고 `stop_reason === "refusal"`을 오류로 처리한다.
- Vercel 서버리스 요청 본문 상한(4.5MB) 때문에 파일은 브라우저 → Storage 직접 업로드. 업로드 상한 50MB(`MAX_UPLOAD_BYTES`). 등록·재추출 라우트는 `export const maxDuration = 300; export const runtime = "nodejs";`.
- 인증: `requireUser()`(user 또는 admin 역할)로 통과시키고 DB는 service role(`createAdminClient`)로 접근한다. RLS는 켜되 사용자 정책은 두지 않는다(기존 Claude 사용량 테이블과 같은 방식).
- 스펙과 다른 결정을 내려야 하면 멈추고 사용자에게 묻는다.

---

## 파일 구조

| 경로 | 책임 |
|---|---|
| `frontend/src/lib/rfp/document-model.ts` | DocumentModel 타입, 셀·표 유틸, `UnsupportedDocumentError` |
| `frontend/src/lib/rfp/parse-hwp.ts` | HWP 5.x OLE 레코드 파서 |
| `frontend/src/lib/rfp/xml-utils.ts` | fast-xml-parser preserveOrder 노드 탐색 유틸(hwpx·docx 공용) |
| `frontend/src/lib/rfp/parse-hwpx.ts` | HWPX(zip+OWPML) 파서 |
| `frontend/src/lib/rfp/parse-docx.ts` | DOCX(zip+WordprocessingML) 파서 |
| `frontend/src/lib/rfp/parse.ts` | 매직넘버·확장자 판별, 파서 분기, 업로드 제한 상수 |
| `frontend/src/lib/rfp/overview.ts` | 사업 개요 추출·정규화 |
| `frontend/src/lib/rfp/dedupe.ts` | 중복·유사 판단(순수) |
| `frontend/src/lib/rfp/requirements.ts` | Requirement 타입, 구분 코드 순서, ID 파싱, 시트명 |
| `frontend/src/lib/rfp/extract-standard.ts` | 표준 양식 판정·규칙 추출·총괄표 대조 |
| `frontend/src/lib/rfp/extract-llm.ts` | Claude 폴백(청크·스키마·병합), SDK 호출 주입 |
| `frontend/src/lib/rfp/xlsx.ts` | exceljs 워크북 생성·파일명 |
| `frontend/src/lib/rfp/require-user.ts` | user 이상 세션 확인 + admin 클라이언트 |
| `frontend/src/lib/rfp/pipeline.ts` | Storage 다운로드 → 파싱 → 개요 → 중복 → 등록 / 추출 실행(DB 접근) |
| `frontend/src/types/rfp.ts` | API 응답 타입(화면·라우트 공용) |
| `frontend/src/app/api/rfp/uploads/route.ts` | POST 서명 업로드 URL |
| `frontend/src/app/api/rfp/projects/route.ts` | GET 목록, POST 등록 |
| `frontend/src/app/api/rfp/projects/[id]/route.ts` | GET 상세, PATCH 개요, DELETE |
| `frontend/src/app/api/rfp/projects/[id]/reextract/route.ts` | POST 재추출 |
| `frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts` | GET xlsx |
| `frontend/src/app/api/rfp/projects/[id]/file/route.ts` | GET 원본 파일 서명 다운로드 URL |
| `frontend/src/app/api/rfp/projects/[id]/requirements/route.ts` | POST 행 추가 |
| `frontend/src/app/api/rfp/requirements/[requirementId]/route.ts` | PATCH 셀 편집, DELETE 행 삭제 |
| `frontend/src/lib/rfp/client-upload.ts` | 브라우저: sha256 → 서명 URL → 업로드 → 등록 요청 |
| `frontend/src/components/rfp/UploadDropzone.tsx` | 드롭존 + 진행 상태 |
| `frontend/src/components/rfp/ConfirmDuplicateDialog.tsx` | 유사 프로젝트 확인창 |
| `frontend/src/components/rfp/ProjectList.tsx` | 프로젝트 표 |
| `frontend/src/components/rfp/OverviewCard.tsx` | 개요 카드(인라인 편집, 상태, 버튼) |
| `frontend/src/components/rfp/EditableCell.tsx` | 셀 인라인 textarea 편집 |
| `frontend/src/components/rfp/RequirementsTable.tsx` | 탭 + TanStack Table |
| `frontend/src/app/rfp/page.tsx` | 목록·업로드 화면 |
| `frontend/src/app/rfp/[id]/page.tsx` | 상세 화면(폴링) |
| `docs/sql/2026-09-03-rfp-analyzer.sql` | 테이블·인덱스·트리거·RLS·버킷 |
| `docs/rfp-analyzer.md` | 런북(env·SQL·버킷·수동 체크리스트) |

---

### Task 1: 준비 — 의존성·픽스처·SQL·Storage 버킷

**Files:**
- Modify: `frontend/package.json` (의존성 추가는 npm이 함)
- Create: `frontend/src/lib/__tests__/fixtures/rfp/sample.hwp` (샘플 복사)
- Create: `docs/sql/2026-09-03-rfp-analyzer.sql`

**Interfaces:**
- Produces: 테이블 `rfp_projects`·`rfp_files`·`rfp_requirements`, Storage 버킷 `rfp`(private, 50MB). 컬럼 이름은 아래 SQL이 정본이며 Task 13·14의 라우트가 그대로 쓴다.

- [ ] **Step 1: node_modules 설치 및 새 의존성 추가**

```bash
cd frontend
npm install
npm install cfb fflate fast-xml-parser exceljs @tanstack/react-table@^8.21.3 @anthropic-ai/sdk zod
npm test 2>&1 | tail -5
```
Expected: 기존 테스트 전부 PASS(실패가 있으면 이 작업과 무관한지 확인하고 사용자에게 보고).

- [ ] **Step 2: 샘플 HWP를 테스트 픽스처로 복사**

```bash
mkdir -p frontend/src/lib/__tests__/fixtures/rfp
cp "/Users/seunguk.kang/Downloads/제안요청서.hwp" frontend/src/lib/__tests__/fixtures/rfp/sample.hwp
ls -la frontend/src/lib/__tests__/fixtures/rfp/
```
Expected: `sample.hwp` 1,208,320 bytes.

- [ ] **Step 3: SQL 파일 작성**

`docs/sql/2026-09-03-rfp-analyzer.sql`:

```sql
-- RFP 분석 1단계 — 프로젝트·원본 파일·요구사항 표. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md

create table if not exists public.rfp_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agency text,
  period text,
  budget text,
  bid_method text,
  extra jsonb not null default '{}'::jsonb,
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
create unique index if not exists rfp_projects_name_agency_uq
  on public.rfp_projects (name_norm, agency_norm) where agency_norm is not null;
create index if not exists rfp_projects_created_idx on public.rfp_projects (created_at desc);

create table if not exists public.rfp_files (
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
create index if not exists rfp_files_project_idx on public.rfp_files (project_id, created_at desc);

create table if not exists public.rfp_requirements (
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
  solution text not null default '',
  sort_order int not null,
  source jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, req_id)
);
create index if not exists rfp_requirements_project_idx on public.rfp_requirements (project_id, sort_order);

-- updated_at 자동 갱신
create or replace function public.rfp_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists rfp_projects_set_updated_at on public.rfp_projects;
create trigger rfp_projects_set_updated_at before update on public.rfp_projects
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_requirements_set_updated_at on public.rfp_requirements;
create trigger rfp_requirements_set_updated_at before update on public.rfp_requirements
  for each row execute function public.rfp_set_updated_at();

-- RLS: 서버(service_role)만 읽고 쓴다. 접근 제어는 API 라우트(requireUser)가 한다. 관리자 세션 읽기만 진단용으로 허용.
do $$
declare t text;
begin
  foreach t in array array['rfp_projects','rfp_files','rfp_requirements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format('create policy %I_admin_read on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))', t, t);
  end loop;
end $$;

-- Storage 버킷(private, 50MB). 브라우저는 서버가 발급한 서명 업로드 URL로만 올리고, 읽기는 서버가 서명 URL을 만든다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('rfp', 'rfp', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;
```

- [ ] **Step 4: SQL 실행**

Supabase MCP(`mcp__supabase__*`)가 인증돼 있으면 `execute_sql`로 위 파일을 실행한다. 인증이 안 되면 메모리 `supabase-sql-via-management-api.md`의 방법(CLI 키체인 토큰으로 Management API `POST /v1/projects/{ref}/database/query`)으로 실행한다. 실행 후 확인:

```sql
select table_name from information_schema.tables where table_schema='public' and table_name like 'rfp_%' order by 1;
select id, public, file_size_limit from storage.buckets where id = 'rfp';
```
Expected: `rfp_files, rfp_projects, rfp_requirements` 3행, 버킷 1행(`public = false`, `52428800`).

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add package.json package-lock.json src/lib/__tests__/fixtures/rfp/sample.hwp ../docs/sql/2026-09-03-rfp-analyzer.sql
git commit -m "chore(rfp): RFP 분석 의존성(cfb·fflate·fast-xml-parser·exceljs·tanstack-table v8·anthropic·zod)·샘플 HWP 픽스처·테이블/버킷 SQL

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 2: DocumentModel과 셀 유틸

**Files:**
- Create: `frontend/src/lib/rfp/document-model.ts`
- Test: `frontend/src/lib/__tests__/rfp-document-model.test.ts`

**Interfaces:**
- Produces:
  - 타입 `DocumentFormat = "hwp" | "hwpx" | "docx"`, `Paragraph { type:"paragraph"; text }`, `Cell { row; col; rowSpan; colSpan; text; tables: Table[] }`, `Table { type:"table"; rows; cols; cells: Cell[] }`, `Block = Paragraph | Table`, `DocumentModel { format; blocks: Block[] }`
  - `class UnsupportedDocumentError extends Error`
  - `normalizeLabel(s): string`, `cellAt(table, row, col): Cell | undefined`, `rightOf(table, cell): Cell | undefined`, `findLabelCell(table, labels: string[]): Cell | undefined`, `flattenCellText(cell): string`, `cellGrid(table): string[][]`, `tableText(table): string`, `documentText(doc): string`, `topLevelTables(doc): Table[]`, `paragraphTexts(doc): string[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-document-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  cellAt, rightOf, findLabelCell, flattenCellText, cellGrid, tableText, documentText, normalizeLabel,
  topLevelTables, paragraphTexts, type Table, type DocumentModel,
} from "@/lib/rfp/document-model";

/** 2x3 표. (0,0)은 세로 병합(rowSpan 2), (1,2)에 중첩 표 */
const nested: Table = {
  type: "table", rows: 1, cols: 2,
  cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "구분", tables: [] },
    { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "설명", tables: [] },
  ],
};
const table: Table = {
  type: "table", rows: 2, cols: 3,
  cells: [
    { row: 0, col: 0, rowSpan: 2, colSpan: 1, text: "요구사항\n상세설명", tables: [] },
    { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "정의", tables: [] },
    { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "AI 대화형 서비스 기본 기능", tables: [] },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "세부 내용", tables: [] },
    { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: "◦ 첫 줄\n - 둘째 줄", tables: [nested] },
  ],
};
const doc: DocumentModel = { format: "hwp", blocks: [{ type: "paragraph", text: " □ 사업명 : 테스트 사업" }, table, { type: "paragraph", text: "" }] };

describe("normalizeLabel", () => {
  it("공백·줄바꿈을 지우고 NFKC 정규화한다", () => {
    expect(normalizeLabel("요구사항\n상세설명")).toBe("요구사항상세설명");
    expect(normalizeLabel(" 세부  내용 ")).toBe("세부내용");
    expect(normalizeLabel("ＩＤ")).toBe("ID");
  });
});

describe("cellAt / rightOf / findLabelCell", () => {
  it("병합 셀이 덮는 위치를 찾는다", () => {
    expect(cellAt(table, 1, 0)?.text).toBe("요구사항\n상세설명");
    expect(cellAt(table, 1, 1)?.text).toBe("세부 내용");
    expect(cellAt(table, 2, 0)).toBeUndefined();
  });
  it("라벨 셀의 오른쪽 셀을 값으로 준다", () => {
    const label = findLabelCell(table, ["세부내용", "상세내용"])!;
    expect(label.text).toBe("세부 내용");
    expect(rightOf(table, label)?.text).toBe("◦ 첫 줄\n - 둘째 줄");
    expect(rightOf(table, cellAt(table, 0, 2)!)).toBeUndefined();
  });
  it("라벨이 없으면 undefined", () => {
    expect(findLabelCell(table, ["산출정보"])).toBeUndefined();
  });
});

describe("flattenCellText / cellGrid / tableText", () => {
  it("중첩 표를 [a | b] 줄로 펼친다", () => {
    expect(flattenCellText(cellAt(table, 1, 2)!)).toBe("◦ 첫 줄\n - 둘째 줄\n[구분 | 설명]");
  });
  it("그리드는 병합 셀 좌상단에만 텍스트를 둔다", () => {
    expect(cellGrid(table)).toEqual([
      ["요구사항\n상세설명", "정의", "AI 대화형 서비스 기본 기능"],
      ["", "세부 내용", "◦ 첫 줄\n - 둘째 줄"],
    ]);
    expect(tableText(nested)).toBe("| 구분 | 설명 |");
  });
});

describe("documentText / topLevelTables / paragraphTexts", () => {
  it("문단과 표를 문서 순서대로 텍스트로 만들고 빈 문단은 뺀다", () => {
    expect(documentText(doc).split("\n")[0]).toBe(" □ 사업명 : 테스트 사업");
    expect(documentText(doc)).toContain("| 요구사항 상세설명 | 정의 | AI 대화형 서비스 기본 기능 |");
    expect(topLevelTables(doc)).toHaveLength(1);
    expect(paragraphTexts(doc)).toEqual([" □ 사업명 : 테스트 사업", ""]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-document-model`
Expected: FAIL — `Cannot find module '@/lib/rfp/document-model'`

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/document-model.ts`:

```ts
/**
 * RFP 문서의 공통 모델. hwp·hwpx·docx 파서가 모두 이 형태를 내고, 개요·요구사항 추출은 이 모델만 본다.
 * 표는 셀 배열(위치·병합 정보 포함)로 두고, 셀 안의 중첩 표는 cell.tables에 따로 둔다.
 */
export type DocumentFormat = "hwp" | "hwpx" | "docx";

export interface Paragraph {
  type: "paragraph";
  /** 줄바꿈은 \n 유지 */
  text: string;
}

export interface Cell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** 셀 안 문단들을 \n으로 이은 텍스트 */
  text: string;
  /** 셀 안에 중첩된 표 */
  tables: Table[];
}

export interface Table {
  type: "table";
  rows: number;
  cols: number;
  cells: Cell[];
}

export type Block = Paragraph | Table;

export interface DocumentModel {
  format: DocumentFormat;
  blocks: Block[];
}

/** 지원하지 않는 형식(암호화·배포용 HWP, 확장자 불일치 등). 라우트는 415로 매핑한다. */
export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

/** 라벨 비교용 정규화: NFKC + 모든 공백·줄바꿈 제거 */
export function normalizeLabel(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

/** (row, col)을 덮는 셀(병합 범위 포함) */
export function cellAt(table: Table, row: number, col: number): Cell | undefined {
  return table.cells.find(
    (c) => row >= c.row && row < c.row + c.rowSpan && col >= c.col && col < c.col + c.colSpan,
  );
}

/** 같은 행에서 셀 바로 오른쪽에 있는 셀 */
export function rightOf(table: Table, cell: Cell): Cell | undefined {
  return cellAt(table, cell.row, cell.col + cell.colSpan);
}

/** 정규화한 텍스트가 라벨 중 하나와 같은 첫 셀 */
export function findLabelCell(table: Table, labels: string[]): Cell | undefined {
  const set = new Set(labels.map(normalizeLabel));
  return table.cells.find((c) => set.has(normalizeLabel(c.text)));
}

/** 셀 텍스트 뒤에 중첩 표를 `[a | b | c]` 줄로 붙인다(샘플 xlsx의 INR-DTL-004 표기와 같다). */
export function flattenCellText(cell: Cell): string {
  const parts: string[] = [cell.text.trim()];
  for (const t of cell.tables) {
    for (let r = 0; r < t.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < t.cols; c++) {
        const cc = cellAt(t, r, c);
        if (cc && cc.row === r && cc.col === c) row.push(flattenCellText(cc).replace(/\s*\n\s*/g, " "));
      }
      if (row.length) parts.push(`[${row.join(" | ")}]`);
    }
  }
  return parts.filter(Boolean).join("\n");
}

/** rows×cols 텍스트 그리드. 병합 셀은 좌상단에만 텍스트, 나머지는 "". */
export function cellGrid(table: Table): string[][] {
  const g: string[][] = Array.from({ length: table.rows }, () => Array<string>(table.cols).fill(""));
  for (const c of table.cells) {
    if (c.row < table.rows && c.col < table.cols) g[c.row][c.col] = c.text;
  }
  return g;
}

/** LLM 입력용 표 텍스트(마크다운 비슷한 한 줄 = 한 행) */
export function tableText(table: Table): string {
  return cellGrid(table)
    .map((r) => `| ${r.map((x) => x.replace(/\s*\n\s*/g, " ").trim()).join(" | ")} |`)
    .join("\n");
}

export function documentText(doc: DocumentModel): string {
  return doc.blocks
    .map((b) => (b.type === "paragraph" ? b.text : tableText(b)))
    .filter((s) => s.trim().length > 0)
    .join("\n");
}

export function topLevelTables(doc: DocumentModel): Table[] {
  return doc.blocks.filter((b): b is Table => b.type === "table");
}

export function paragraphTexts(doc: DocumentModel): string[] {
  return doc.blocks.filter((b): b is Paragraph => b.type === "paragraph").map((b) => b.text);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-document-model`
Expected: PASS (4 describe, 8 tests)

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/document-model.ts src/lib/__tests__/rfp-document-model.test.ts
git commit -m "feat(rfp): 문서 공통 모델(DocumentModel)과 셀·표 유틸

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 3: HWP 파서

**Files:**
- Create: `frontend/src/lib/rfp/parse-hwp.ts`
- Test: `frontend/src/lib/__tests__/rfp-parse-hwp.test.ts` (픽스처 `fixtures/rfp/sample.hwp`)

**Interfaces:**
- Consumes: Task 2의 타입·`UnsupportedDocumentError`
- Produces: `parseHwp(buf: Buffer): DocumentModel`, `decodeParaText(data: Buffer): string`

배경(스펙 §3): HWP 5.x는 OLE 복합문서. `FileHeader` 스트림 36바이트 오프셋의 uint32 플래그(bit0 압축, bit1 암호화, bit2 배포용). 본문은 `BodyText/Section{n}`(raw deflate). 레코드 헤더 4바이트 = tag(10비트) | level(10비트) | size(12비트, 0xFFF면 다음 4바이트가 size). 표는 `CTRL_HEADER(71)`의 id `"tbl "` → `TABLE(77)`(rows·cols) → `LIST_HEADER(72)`(셀, 표와 같은 level) → 셀 문단(`PARA_TEXT(67)`, 더 깊은 level). **셀 문단 헤더(66)는 셀 헤더와 같은 level**이므로 표 종료는 "레코드 level < 표 level"일 때만이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-parse-hwp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHwp, decodeParaText } from "@/lib/rfp/parse-hwp";
import { cellAt, findLabelCell, rightOf, topLevelTables, paragraphTexts, normalizeLabel } from "@/lib/rfp/document-model";
import { UnsupportedDocumentError } from "@/lib/rfp/document-model";

const sample = readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", import.meta.url)));

describe("decodeParaText", () => {
  it("일반 문자는 그대로, 줄바꿈(10)은 \\n, 문단 끝(13)은 제거, 확장 컨트롤(11)은 16바이트 건너뜀", () => {
    const buf = Buffer.alloc(2 * 4 + 16 + 2 * 2);
    buf.writeUInt16LE("가".charCodeAt(0), 0);
    buf.writeUInt16LE(10, 2);
    buf.writeUInt16LE("나".charCodeAt(0), 4);
    buf.writeUInt16LE(11, 6); // 확장 컨트롤 시작(뒤 14바이트 포함 총 16바이트)
    buf.writeUInt16LE("다".charCodeAt(0), 6 + 16);
    buf.writeUInt16LE(13, 8 + 16);
    expect(decodeParaText(buf)).toBe("가\n나다");
  });
});

describe("parseHwp(sample)", () => {
  const doc = parseHwp(sample);
  it("형식과 블록 수", () => {
    expect(doc.format).toBe("hwp");
    expect(topLevelTables(doc)).toHaveLength(232);
    expect(paragraphTexts(doc).length).toBeGreaterThan(900);
  });
  it("사업 개요 문단이 최상위 문단으로 나온다", () => {
    expect(paragraphTexts(doc).some((p) => p.includes("사업명 : 생성형 AI 플랫폼 구축 및 AX 개발 사업"))).toBe(true);
  });
  it("7행 요구사항 표가 124개이고 첫 표는 SER-001", () => {
    const req = topLevelTables(doc).filter((t) => t.rows === 7 && normalizeLabel(cellAt(t, 0, 0)?.text ?? "") === "요구사항분류");
    expect(req).toHaveLength(124);
    const first = req[0];
    expect(rightOf(first, findLabelCell(first, ["요구사항고유번호"])!)?.text).toBe("SER-001");
    expect(rightOf(first, findLabelCell(first, ["요구사항명칭"])!)?.text).toBe("AI 대화형 서비스");
    expect(rightOf(first, findLabelCell(first, ["정의"])!)?.text).toBe("AI 대화형 서비스 기본 기능");
  });
  it("병합 셀과 중첩 표가 보존된다", () => {
    const req = topLevelTables(doc).filter((t) => t.rows === 7 && normalizeLabel(cellAt(t, 0, 0)?.text ?? "") === "요구사항분류");
    const first = req[0];
    const label = findLabelCell(first, ["요구사항상세설명"])!;
    expect(label.rowSpan).toBe(2);
    const withNested = req.filter((t) => t.cells.some((c) => c.tables.length > 0));
    expect(withNested.length).toBeGreaterThan(0);
  });
  it("총괄표(19x4)에 요구사항수 합계 124가 있다", () => {
    const summary = topLevelTables(doc).find((t) => normalizeLabel(cellAt(t, 0, 0)?.text ?? "") === "요구사항구분");
    expect(summary).toBeDefined();
    expect(summary!.rows).toBe(19);
    expect(summary!.cells.some((c) => c.text.trim() === "124")).toBe(true);
  });
});

describe("parseHwp(잘못된 입력)", () => {
  it("OLE가 아니면 UnsupportedDocumentError", () => {
    expect(() => parseHwp(Buffer.from("not an ole file"))).toThrow(UnsupportedDocumentError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-parse-hwp`
Expected: FAIL — `Cannot find module '@/lib/rfp/parse-hwp'`

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/parse-hwp.ts`:

```ts
import CFB from "cfb";
import { inflateRawSync } from "node:zlib";
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel, type Table } from "./document-model";

/** HWP 5.x 레코드 태그(HWPTAG_BEGIN=16 기준) */
const TAG = { PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77 } as const;
/** 확장 컨트롤(뒤 14바이트에 컨트롤 정보) — 문자 8개(16바이트) 차지 */
const EXT_CTRL = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
/** 인라인 컨트롤 — 역시 16바이트 */
const INLINE_CTRL = new Set([4, 5, 6, 7, 8, 9, 19, 20]);

interface HwpRecord {
  tag: number;
  level: number;
  data: Buffer;
}

function* records(buf: Buffer): Generator<HwpRecord> {
  let off = 0;
  while (off + 4 <= buf.length) {
    const h = buf.readUInt32LE(off);
    off += 4;
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) {
      size = buf.readUInt32LE(off);
      off += 4;
    }
    yield { tag, level, data: buf.subarray(off, off + size) };
    off += size;
  }
}

/** PARA_TEXT(UTF-16LE + 컨트롤 문자) → 문자열 */
export function decodeParaText(data: Buffer): string {
  let s = "";
  for (let i = 0; i + 1 < data.length; ) {
    const c = data.readUInt16LE(i);
    if (EXT_CTRL.has(c) || INLINE_CTRL.has(c)) {
      i += 16;
      continue;
    }
    i += 2;
    if (c === 13) continue; // 문단 끝
    if (c === 10) {
      s += "\n";
      continue;
    }
    if (c === 24) {
      s += "-";
      continue;
    }
    if (c === 30 || c === 31) {
      s += " ";
      continue;
    }
    if (c < 32) continue;
    s += String.fromCharCode(c);
  }
  return s;
}

interface OpenTable {
  level: number;
  table: Table;
  cell: Cell | null;
}

function parseSection(buf: Buffer): Block[] {
  const blocks: Block[] = [];
  const stack: OpenTable[] = [];
  let pendingCtrl: string | null = null;

  for (const r of records(buf)) {
    // 표는 레코드 level이 표 level보다 낮아질 때 끝난다(셀 문단 헤더는 셀 헤더와 같은 level이므로 "<="로 하면 일찍 닫힌다)
    while (stack.length && r.level < stack[stack.length - 1].level) stack.pop();
    const top = stack[stack.length - 1];

    if (r.tag === TAG.CTRL_HEADER) {
      pendingCtrl = Buffer.from(r.data.subarray(0, 4)).reverse().toString("latin1");
    } else if (r.tag === TAG.TABLE && pendingCtrl === "tbl ") {
      const table: Table = { type: "table", rows: r.data.readUInt16LE(4), cols: r.data.readUInt16LE(6), cells: [] };
      if (top && top.cell) top.cell.tables.push(table);
      else blocks.push(table);
      stack.push({ level: r.level, table, cell: null });
      pendingCtrl = null;
    } else if (r.tag === TAG.LIST_HEADER) {
      if (top && r.level === top.level && r.data.length >= 14) {
        const cell: Cell = {
          col: r.data.readUInt16LE(6),
          row: r.data.readUInt16LE(8),
          colSpan: Math.max(1, r.data.readUInt16LE(10)),
          rowSpan: Math.max(1, r.data.readUInt16LE(12)),
          text: "",
          tables: [],
        };
        top.table.cells.push(cell);
        top.cell = cell;
      }
    } else if (r.tag === TAG.PARA_TEXT) {
      const t = decodeParaText(r.data);
      if (top && top.cell && r.level > top.level) top.cell.text = top.cell.text ? `${top.cell.text}\n${t}` : t;
      else if (!top) blocks.push({ type: "paragraph", text: t });
    }
  }
  return blocks;
}

/** HWP 5.x(OLE) → DocumentModel. 암호화·배포용 문서는 UnsupportedDocumentError. */
export function parseHwp(buf: Buffer): DocumentModel {
  let cfb: ReturnType<typeof CFB.read>;
  try {
    cfb = CFB.read(buf, { type: "buffer" });
  } catch {
    throw new UnsupportedDocumentError("HWP(OLE) 파일을 열 수 없습니다.");
  }
  const header = CFB.find(cfb, "/FileHeader");
  if (!header) throw new UnsupportedDocumentError("HWP FileHeader가 없습니다.");
  const hb = Buffer.from(header.content as Uint8Array);
  const signature = hb.subarray(0, 17).toString("latin1").replace(/\0.*$/, "");
  if (signature !== "HWP Document File") throw new UnsupportedDocumentError("HWP 5.x 문서가 아닙니다.");
  const flags = hb.readUInt32LE(36);
  if (flags & 2) throw new UnsupportedDocumentError("암호화된 HWP 문서는 지원하지 않습니다.");
  if (flags & 4) throw new UnsupportedDocumentError("배포용(읽기 전용) HWP 문서는 지원하지 않습니다.");
  const compressed = (flags & 1) !== 0;

  const sections = cfb.FullPaths
    .map((p, i) => ({ i, m: /BodyText\/Section(\d+)$/.exec(p) }))
    .filter((x): x is { i: number; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  if (!sections.length) throw new UnsupportedDocumentError("HWP 본문(BodyText)이 없습니다.");

  const blocks: Block[] = [];
  for (const s of sections) {
    let body = Buffer.from(cfb.FileIndex[s.i].content as Uint8Array);
    if (compressed) body = inflateRawSync(body);
    blocks.push(...parseSection(body));
  }
  return { format: "hwp", blocks };
}
```

`cfb`는 `types/index.d.ts`를 내장한다(`import CFB from "cfb"`는 `esModuleInterop`으로 동작). 만약 `tsc`가 `Could not find a declaration file`을 내면 `frontend/src/types/cfb.d.ts`에 아래를 추가한다.

```ts
declare module "cfb" {
  interface CFBEntry { name: string; type: number; content: Uint8Array | number[]; size: number }
  interface CFBContainer { FullPaths: string[]; FileIndex: CFBEntry[] }
  const CFB: {
    read(blob: Uint8Array | Buffer, opts: { type: "buffer" }): CFBContainer;
    find(cfb: CFBContainer, path: string): CFBEntry | null;
  };
  export default CFB;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-parse-hwp`
Expected: PASS. 실패하면 값을 임의로 맞추지 말고 원인을 본다(예: 표 232가 아니면 종료 조건 `<`가 `<=`로 잘못됐는지).

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/parse-hwp.ts src/lib/__tests__/rfp-parse-hwp.test.ts src/types/cfb.d.ts 2>/dev/null; git add src/lib/rfp/parse-hwp.ts src/lib/__tests__/rfp-parse-hwp.test.ts
git commit -m "feat(rfp): HWP 5.x 레코드 파서 — cfb+zlib, 표·병합 셀·중첩 표를 DocumentModel로

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 4: XML 유틸과 HWPX 파서

**Files:**
- Create: `frontend/src/lib/rfp/xml-utils.ts`
- Create: `frontend/src/lib/rfp/parse-hwpx.ts`
- Test: `frontend/src/lib/__tests__/rfp-parse-hwpx.test.ts`

**Interfaces:**
- Consumes: Task 2 타입
- Produces:
  - `xml-utils`: `type XmlNode = Record<string, unknown>`, `parseXml(xml): XmlNode[]`, `tagOf(node): string | null`, `childrenOf(node): XmlNode[]`, `attrsOf(node): Record<string,string>`, `findChild(node, tag): XmlNode | undefined`, `findChildren(node, tag): XmlNode[]`, `textOf(node): string`
  - `parse-hwpx`: `parseHwpx(buf: Buffer): DocumentModel`

배경: HWPX는 zip. 본문은 `Contents/section{n}.xml`(OWPML). `hs:sec` 아래 `hp:p`(문단) → `hp:run` → `hp:t`(텍스트, 안에 `hp:lineBreak`) 또는 `hp:tbl`(표, `rowCnt`·`colCnt`) → `hp:tr` → `hp:tc`(`hp:cellAddr colAddr rowAddr`, `hp:cellSpan colSpan rowSpan`, `hp:subList` 안에 `hp:p`). fast-xml-parser는 `preserveOrder: true`로 써서 문단·표 순서를 지킨다. preserveOrder 노드 형태는 `{ "hp:p": [자식…], ":@": {속성} }`, 텍스트 노드는 `{ "#text": "…" }`.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-parse-hwpx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseHwpx } from "@/lib/rfp/parse-hwpx";
import { parseXml, tagOf, childrenOf, attrsOf, findChild, findChildren, textOf } from "@/lib/rfp/xml-utils";
import { cellAt, topLevelTables, paragraphTexts, UnsupportedDocumentError } from "@/lib/rfp/document-model";

const SECTION = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t> □ 사업명 : 테스트 사업</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>첫 줄<hp:lineBreak/>둘째 줄</hp:t></hp:run></hp:p>
  <hp:p><hp:run>
    <hp:tbl rowCnt="2" colCnt="2">
      <hp:tr>
        <hp:tc><hp:subList><hp:p><hp:run><hp:t>요구사항 분류</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="2"/></hp:tc>
        <hp:tc><hp:subList><hp:p><hp:run><hp:t>서비스</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc><hp:subList>
          <hp:p><hp:run><hp:t>둘째 행</hp:t></hp:run></hp:p>
          <hp:p><hp:run><hp:tbl rowCnt="1" colCnt="1"><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>중첩</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
        </hp:subList><hp:cellAddr colAddr="1" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>
      </hp:tr>
    </hp:tbl>
  </hp:run></hp:p>
</hs:sec>`;

function hwpxZip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v);
  return Buffer.from(zipSync(entries));
}

describe("xml-utils", () => {
  it("preserveOrder 노드를 태그·자식·속성·텍스트로 읽는다", () => {
    const root = parseXml(`<a x="1"><b>hi</b><b>yo</b><c/></a>`);
    const a = root[0];
    expect(tagOf(a)).toBe("a");
    expect(attrsOf(a)).toEqual({ x: "1" });
    expect(findChildren(a, "b").map(textOf)).toEqual(["hi", "yo"]);
    expect(findChild(a, "c")).toBeDefined();
    expect(childrenOf(findChild(a, "c")!)).toEqual([]);
    expect(textOf(a)).toBe("hiyo");
  });
});

describe("parseHwpx", () => {
  const doc = parseHwpx(hwpxZip({ "Contents/content.hpf": "<opf:package/>", "Contents/section0.xml": SECTION }));
  it("문단과 줄바꿈", () => {
    expect(doc.format).toBe("hwpx");
    expect(paragraphTexts(doc)).toEqual([" □ 사업명 : 테스트 사업", "첫 줄\n둘째 줄"]);
  });
  it("표·병합·중첩 표", () => {
    const tables = topLevelTables(doc);
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect([t.rows, t.cols, t.cells.length]).toEqual([2, 2, 3]);
    expect(cellAt(t, 1, 0)?.text).toBe("요구사항 분류");
    expect(cellAt(t, 0, 0)?.rowSpan).toBe(2);
    const c11 = cellAt(t, 1, 1)!;
    expect(c11.text).toBe("둘째 행");
    expect(c11.tables).toHaveLength(1);
    expect(c11.tables[0].cells[0].text).toBe("중첩");
  });
  it("여러 섹션은 번호순으로 이어 붙인다", () => {
    const two = parseHwpx(hwpxZip({
      "Contents/section1.xml": SECTION.replace("테스트 사업", "둘째 섹션"),
      "Contents/section0.xml": SECTION,
    }));
    const names = paragraphTexts(two).filter((p) => p.includes("사업명"));
    expect(names[0]).toContain("테스트 사업");
    expect(names[1]).toContain("둘째 섹션");
  });
  it("본문이 없으면 UnsupportedDocumentError", () => {
    expect(() => parseHwpx(hwpxZip({ "mimetype": "application/hwp+zip" }))).toThrow(UnsupportedDocumentError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-parse-hwpx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: xml-utils 구현**

`frontend/src/lib/rfp/xml-utils.ts`:

```ts
import { XMLParser } from "fast-xml-parser";

/**
 * fast-xml-parser preserveOrder 노드.
 * 요소: { "<tag>": XmlNode[](자식), ":@"?: {속성} } / 텍스트: { "#text": string }
 */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

export function parseXml(xml: string): XmlNode[] {
  return parser.parse(xml) as XmlNode[];
}

export function tagOf(node: XmlNode): string | null {
  return Object.keys(node).find((k) => k !== ":@") ?? null;
}

export function childrenOf(node: XmlNode): XmlNode[] {
  const t = tagOf(node);
  if (!t) return [];
  const v = node[t];
  return Array.isArray(v) ? (v as XmlNode[]) : [];
}

export function attrsOf(node: XmlNode): Record<string, string> {
  const a = node[":@"];
  if (!a || typeof a !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) out[k] = String(v);
  return out;
}

export function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return childrenOf(node).find((c) => tagOf(c) === tag);
}

export function findChildren(node: XmlNode, tag: string): XmlNode[] {
  return childrenOf(node).filter((c) => tagOf(c) === tag);
}

/** 자손의 #text를 순서대로 이어 붙인 문자열 */
export function textOf(node: XmlNode): string {
  if ("#text" in node) return String(node["#text"]);
  return childrenOf(node).map(textOf).join("");
}
```

fast-xml-parser 5.x 기준. 옵션 이름이 맞지 않아 타입 오류가 나면 `frontend/node_modules/fast-xml-parser/src/fxp.d.ts`의 `X2jOptions`를 확인해 맞춘다.

- [ ] **Step 4: parse-hwpx 구현**

`frontend/src/lib/rfp/parse-hwpx.ts`:

```ts
import { unzipSync, strFromU8 } from "fflate";
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel, type Paragraph, type Table } from "./document-model";
import { parseXml, tagOf, childrenOf, attrsOf, findChild, findChildren, type XmlNode } from "./xml-utils";

/** hp:p 하나 → 문단 텍스트(비어 있지 않으면) + 그 안의 표들. 표는 앵커 문단 뒤에 온다(HWP 바이너리와 같은 순서). */
function paragraphBlocks(p: XmlNode): Block[] {
  const out: Block[] = [];
  const text = paragraphText(p);
  if (text.trim()) out.push({ type: "paragraph", text });
  for (const run of findChildren(p, "hp:run")) {
    for (const tbl of findChildren(run, "hp:tbl")) out.push(tableOf(tbl));
  }
  return out;
}

function paragraphText(p: XmlNode): string {
  let s = "";
  for (const run of findChildren(p, "hp:run")) {
    for (const t of findChildren(run, "hp:t")) {
      for (const ch of childrenOf(t)) {
        const tag = tagOf(ch);
        if (tag === "#text") s += String(ch["#text"]);
        else if (tag === "hp:lineBreak") s += "\n";
        else if (tag === "hp:tab") s += " ";
      }
    }
  }
  return s;
}

function tableOf(tbl: XmlNode): Table {
  const a = attrsOf(tbl);
  const cells: Cell[] = [];
  for (const tr of findChildren(tbl, "hp:tr")) {
    for (const tc of findChildren(tr, "hp:tc")) {
      const addrNode = findChild(tc, "hp:cellAddr");
      const spanNode = findChild(tc, "hp:cellSpan");
      const addr = addrNode ? attrsOf(addrNode) : {};
      const span = spanNode ? attrsOf(spanNode) : {};
      const sub = findChild(tc, "hp:subList");
      const inner: Block[] = sub ? findChildren(sub, "hp:p").flatMap(paragraphBlocks) : [];
      cells.push({
        row: Number(addr.rowAddr ?? 0),
        col: Number(addr.colAddr ?? 0),
        rowSpan: Math.max(1, Number(span.rowSpan ?? 1)),
        colSpan: Math.max(1, Number(span.colSpan ?? 1)),
        text: inner.filter((b): b is Paragraph => b.type === "paragraph").map((b) => b.text).join("\n"),
        tables: inner.filter((b): b is Table => b.type === "table"),
      });
    }
  }
  const rows = a.rowCnt ? Number(a.rowCnt) : Math.max(0, ...cells.map((c) => c.row + c.rowSpan));
  const cols = a.colCnt ? Number(a.colCnt) : Math.max(0, ...cells.map((c) => c.col + c.colSpan));
  return { type: "table", rows, cols, cells };
}

function sectionBlocks(root: XmlNode[]): Block[] {
  const sec = root.find((n) => tagOf(n) === "hs:sec") ?? root.find((n) => tagOf(n) !== "?xml");
  if (!sec) return [];
  return findChildren(sec, "hp:p").flatMap(paragraphBlocks);
}

/** HWPX(zip + OWPML) → DocumentModel */
export function parseHwpx(buf: Buffer): DocumentModel {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new UnsupportedDocumentError("HWPX(zip) 파일을 열 수 없습니다.");
  }
  const names = Object.keys(files)
    .map((n) => ({ n, m: /^Contents\/section(\d+)\.xml$/.exec(n) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  if (!names.length) throw new UnsupportedDocumentError("HWPX 본문(Contents/section*.xml)이 없습니다.");
  const blocks: Block[] = [];
  for (const { n } of names) blocks.push(...sectionBlocks(parseXml(strFromU8(files[n]))));
  return { format: "hwpx", blocks };
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npm test -- rfp-parse-hwpx`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
cd frontend && git add src/lib/rfp/xml-utils.ts src/lib/rfp/parse-hwpx.ts src/lib/__tests__/rfp-parse-hwpx.test.ts
git commit -m "feat(rfp): HWPX 파서(zip+OWPML)와 preserveOrder XML 유틸

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 5: DOCX 파서

**Files:**
- Create: `frontend/src/lib/rfp/parse-docx.ts`
- Test: `frontend/src/lib/__tests__/rfp-parse-docx.test.ts`

**Interfaces:**
- Consumes: Task 2 타입, Task 4 `xml-utils`
- Produces: `parseDocx(buf: Buffer): DocumentModel`

배경: `word/document.xml`의 `w:body` 아래 `w:p`(문단: `w:r` → `w:t` 텍스트, `w:br` 줄바꿈, `w:tab`)와 `w:tbl`(표). 열 수는 `w:tblGrid/w:gridCol` 개수. `w:tr` → `w:tc`. 병합: `w:tcPr/w:gridSpan w:val`(colSpan), `w:tcPr/w:vMerge w:val="restart"`가 세로 병합 시작, 값 없는 `w:vMerge`는 위 셀에 합쳐진다(셀을 만들지 않고 위 셀의 rowSpan을 늘림).

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-parse-docx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseDocx } from "@/lib/rfp/parse-docx";
import { cellAt, topLevelTables, paragraphTexts, UnsupportedDocumentError } from "@/lib/rfp/document-model";

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t xml:space="preserve"> □ 사업명 : 테스트 사업</w:t></w:r></w:p>
<w:p><w:r><w:t>첫 줄</w:t><w:br/><w:t>둘째 줄</w:t></w:r></w:p>
<w:tbl><w:tblGrid><w:gridCol w:w="1"/><w:gridCol w:w="1"/><w:gridCol w:w="1"/></w:tblGrid>
 <w:tr>
  <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>요구사항 분류</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>서비스</w:t></w:r></w:p></w:tc>
 </w:tr>
 <w:tr>
  <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
  <w:tc><w:p><w:r><w:t>정의</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t>값</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>중첩</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc>
 </w:tr>
</w:tbl>
<w:sectPr/></w:body></w:document>`;

function docxZip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v);
  return Buffer.from(zipSync(entries));
}

describe("parseDocx", () => {
  const doc = parseDocx(docxZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": DOCUMENT }));
  it("문단·공백 보존·줄바꿈", () => {
    expect(doc.format).toBe("docx");
    expect(paragraphTexts(doc)).toEqual([" □ 사업명 : 테스트 사업", "첫 줄\n둘째 줄"]);
  });
  it("표: gridSpan → colSpan, vMerge → rowSpan, 중첩 표", () => {
    const t = topLevelTables(doc)[0];
    expect([t.rows, t.cols, t.cells.length]).toEqual([2, 3, 4]);
    expect(cellAt(t, 0, 0)).toMatchObject({ row: 0, col: 0, rowSpan: 2, colSpan: 1, text: "요구사항 분류" });
    expect(cellAt(t, 0, 2)).toMatchObject({ row: 0, col: 1, colSpan: 2, text: "서비스" });
    expect(cellAt(t, 1, 1)?.text).toBe("정의");
    const c12 = cellAt(t, 1, 2)!;
    expect(c12.text).toBe("값");
    expect(c12.tables[0].cells[0].text).toBe("중첩");
  });
  it("word/document.xml이 없으면 UnsupportedDocumentError", () => {
    expect(() => parseDocx(docxZip({ "word/styles.xml": "<w:styles/>" }))).toThrow(UnsupportedDocumentError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-parse-docx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/parse-docx.ts`:

```ts
import { unzipSync, strFromU8 } from "fflate";
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel, type Paragraph, type Table } from "./document-model";
import { parseXml, tagOf, childrenOf, attrsOf, findChild, findChildren, textOf, type XmlNode } from "./xml-utils";

/** 문단 텍스트: w:t 텍스트, w:br/w:cr 줄바꿈, w:tab 공백. 하이퍼링크·변경추적 삽입 등은 안으로 들어간다. */
function paragraphText(p: XmlNode): string {
  let s = "";
  const walk = (n: XmlNode) => {
    for (const ch of childrenOf(n)) {
      const tag = tagOf(ch);
      if (tag === "w:t") s += textOf(ch);
      else if (tag === "w:br" || tag === "w:cr") s += "\n";
      else if (tag === "w:tab") s += " ";
      else if (tag === "w:r" || tag === "w:hyperlink" || tag === "w:smartTag" || tag === "w:ins" || tag === "w:sdt" || tag === "w:sdtContent" || tag === "w:fldSimple") walk(ch);
    }
  };
  walk(p);
  return s;
}

/** 컨테이너(w:body, w:tc, w:sdtContent) 안의 문단·표를 순서대로 */
function containerBlocks(container: XmlNode): Block[] {
  const out: Block[] = [];
  for (const ch of childrenOf(container)) {
    const tag = tagOf(ch);
    if (tag === "w:p") {
      const t = paragraphText(ch);
      if (t.trim()) out.push({ type: "paragraph", text: t });
    } else if (tag === "w:tbl") {
      out.push(tableOf(ch));
    } else if (tag === "w:sdt") {
      const content = findChild(ch, "w:sdtContent");
      if (content) out.push(...containerBlocks(content));
    }
  }
  return out;
}

function tableOf(tbl: XmlNode): Table {
  const grid = findChild(tbl, "w:tblGrid");
  const gridCols = grid ? findChildren(grid, "w:gridCol").length : 0;
  const cells: Cell[] = [];
  const trs = findChildren(tbl, "w:tr");
  trs.forEach((tr, r) => {
    let col = 0;
    for (const tc of findChildren(tr, "w:tc")) {
      const pr = findChild(tc, "w:tcPr");
      const spanNode = pr ? findChild(pr, "w:gridSpan") : undefined;
      const colSpan = Math.max(1, Number(spanNode ? attrsOf(spanNode)["w:val"] ?? 1 : 1) || 1);
      const vm = pr ? findChild(pr, "w:vMerge") : undefined;
      const vmVal = vm ? (attrsOf(vm)["w:val"] ?? "continue") : null;
      if (vmVal === "continue") {
        // 위 셀에 합쳐진 셀: 새 셀을 만들지 않고 위 셀의 rowSpan을 늘린다
        const above = cells.find((c) => c.col === col && c.row + c.rowSpan === r);
        if (above) above.rowSpan += 1;
      } else {
        const inner = containerBlocks(tc);
        cells.push({
          row: r,
          col,
          rowSpan: 1,
          colSpan,
          text: inner.filter((b): b is Paragraph => b.type === "paragraph").map((b) => b.text).join("\n"),
          tables: inner.filter((b): b is Table => b.type === "table"),
        });
      }
      col += colSpan;
    }
  });
  const cols = Math.max(gridCols, 0, ...cells.map((c) => c.col + c.colSpan));
  return { type: "table", rows: trs.length, cols, cells };
}

/** DOCX(zip + WordprocessingML) → DocumentModel */
export function parseDocx(buf: Buffer): DocumentModel {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new UnsupportedDocumentError("DOCX(zip) 파일을 열 수 없습니다.");
  }
  const xml = files["word/document.xml"];
  if (!xml) throw new UnsupportedDocumentError("DOCX 본문(word/document.xml)이 없습니다.");
  const root = parseXml(strFromU8(xml));
  const document = root.find((n) => tagOf(n) === "w:document");
  const body = document ? findChild(document, "w:body") : undefined;
  if (!body) throw new UnsupportedDocumentError("DOCX 본문(w:body)이 없습니다.");
  return { format: "docx", blocks: containerBlocks(body) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-parse-docx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/parse-docx.ts src/lib/__tests__/rfp-parse-docx.test.ts
git commit -m "feat(rfp): DOCX 파서 — gridSpan/vMerge 병합과 중첩 표 지원

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 6: 형식 판별과 파서 분기

**Files:**
- Create: `frontend/src/lib/rfp/parse.ts`
- Test: `frontend/src/lib/__tests__/rfp-parse.test.ts`

**Interfaces:**
- Consumes: Task 3·4·5 파서
- Produces: `ALLOWED_EXTENSIONS = ["hwp","hwpx","docx"] as const`, `MAX_UPLOAD_BYTES = 52428800`, `extensionOf(fileName): string`, `detectFormat(buf, fileName): DocumentFormat`, `parseDocument(buf, fileName): DocumentModel`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { detectFormat, parseDocument, extensionOf, ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/rfp/parse";
import { topLevelTables, UnsupportedDocumentError } from "@/lib/rfp/document-model";

const sample = readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", import.meta.url)));
const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

describe("extensionOf / 상수", () => {
  it("확장자는 소문자", () => {
    expect(extensionOf("제안요청서.HWPX")).toBe("hwpx");
    expect(extensionOf("a.b.docx")).toBe("docx");
    expect(extensionOf("noext")).toBe("");
    expect(ALLOWED_EXTENSIONS).toEqual(["hwp", "hwpx", "docx"]);
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("detectFormat", () => {
  it("OLE + .hwp → hwp, OLE + 다른 확장자 → 거부", () => {
    expect(detectFormat(sample, "제안요청서.hwp")).toBe("hwp");
    expect(() => detectFormat(sample, "제안요청서.doc")).toThrow(UnsupportedDocumentError);
  });
  it("zip 내용으로 hwpx/docx 구분", () => {
    expect(detectFormat(zip({ "Contents/content.hpf": "<p/>", "Contents/section0.xml": "<hs:sec/>" }), "a.hwpx")).toBe("hwpx");
    expect(detectFormat(zip({ "word/document.xml": "<w:document/>" }), "a.docx")).toBe("docx");
    expect(() => detectFormat(zip({ "xl/workbook.xml": "<x/>" }), "a.xlsx")).toThrow(UnsupportedDocumentError);
  });
  it("OLE도 zip도 아니면 거부", () => {
    expect(() => detectFormat(Buffer.from("plain text"), "a.hwp")).toThrow(UnsupportedDocumentError);
  });
});

describe("parseDocument", () => {
  it("샘플 hwp를 파싱한다", () => {
    const doc = parseDocument(sample, "제안요청서.hwp");
    expect(doc.format).toBe("hwp");
    expect(topLevelTables(doc)).toHaveLength(232);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-parse.test`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/parse.ts`:

```ts
import { unzipSync } from "fflate";
import { UnsupportedDocumentError, type DocumentFormat, type DocumentModel } from "./document-model";
import { parseHwp } from "./parse-hwp";
import { parseHwpx } from "./parse-hwpx";
import { parseDocx } from "./parse-docx";

export const ALLOWED_EXTENSIONS = ["hwp", "hwpx", "docx"] as const;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/** 매직넘버 + 확장자 + zip 내용으로 형식 판별. 맞지 않으면 UnsupportedDocumentError. */
export function detectFormat(buf: Buffer, fileName: string): DocumentFormat {
  const ext = extensionOf(fileName);
  const isOle = buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1;
  const isZip = buf.length >= 4 && buf.readUInt32BE(0) === 0x504b0304;
  if (isOle) {
    if (ext !== "hwp") throw new UnsupportedDocumentError("파일 내용은 HWP(OLE)인데 확장자가 다릅니다. .hwp 파일만 지원합니다.");
    return "hwp";
  }
  if (isZip) {
    let names: string[];
    try {
      names = Object.keys(unzipSync(new Uint8Array(buf)));
    } catch {
      throw new UnsupportedDocumentError("zip 파일을 열 수 없습니다.");
    }
    if (names.includes("Contents/content.hpf") || names.some((n) => /^Contents\/section\d+\.xml$/.test(n))) return "hwpx";
    if (names.includes("word/document.xml")) return "docx";
    throw new UnsupportedDocumentError("zip 안에 HWPX·DOCX 본문이 없습니다.");
  }
  throw new UnsupportedDocumentError("지원하지 않는 파일 형식입니다. hwp·hwpx·docx만 올릴 수 있습니다.");
}

export function parseDocument(buf: Buffer, fileName: string): DocumentModel {
  const format = detectFormat(buf, fileName);
  if (format === "hwp") return parseHwp(buf);
  if (format === "hwpx") return parseHwpx(buf);
  return parseDocx(buf);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-parse.test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/parse.ts src/lib/__tests__/rfp-parse.test.ts
git commit -m "feat(rfp): 파일 형식 판별(매직넘버·zip 내용)과 파서 분기

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 7: 사업 개요 추출과 정규화

**Files:**
- Create: `frontend/src/lib/rfp/overview.ts`
- Test: `frontend/src/lib/__tests__/rfp-overview.test.ts`

**Interfaces:**
- Consumes: Task 2 유틸
- Produces: `interface Overview { name: string|null; agency: string|null; period: string|null; budget: string|null; bidMethod: string|null; extra: Record<string,string> }`, `extractOverview(doc): Overview`, `normalizeName(s): string`, `nameCore(s): string`, `normalizeAgency(s): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-overview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractOverview, normalizeName, nameCore, normalizeAgency } from "@/lib/rfp/overview";
import { parseHwp } from "@/lib/rfp/parse-hwp";
import type { DocumentModel, Table } from "@/lib/rfp/document-model";

const p = (text: string) => ({ type: "paragraph" as const, text });

describe("extractOverview — 라벨 문단", () => {
  const doc: DocumentModel = { format: "hwp", blocks: [
    p("1. 일반사항"),
    p(" □ 사업명 : 생성형 AI 플랫폼 구축 및 AX 개발 사업"),
    p(" □ 사업기간 : 계약체결일로부터 12개월"),
    p(" □ 설계금액 : 13,225,835,150원 (VAT 포함)"),
    p(" □ 입찰 및 계약 방법"),
    p("  ◦ 일반경쟁입찰(협상에 의한 계약체결기준) / 차등점수제 적용"),
    p("    - ｢국가종합전자조달시스템 입찰참가자격 등록 규정｣에 따라 …"),
    p(" □ 한국석유공사(이하 “공사”)의 전사적 성과를 창출하고, 에너지 산업의 미래 가치 창출을 위한 공사 특화형 AI 도입 필요"),
  ] };
  const o = extractOverview(doc);
  it("사업명·기간·금액", () => {
    expect(o.name).toBe("생성형 AI 플랫폼 구축 및 AX 개발 사업");
    expect(o.period).toBe("계약체결일로부터 12개월");
    expect(o.budget).toBe("13,225,835,150원 (VAT 포함)");
  });
  it("값이 없는 라벨은 다음 문단을 값으로", () => {
    expect(o.bidMethod).toBe("일반경쟁입찰(협상에 의한 계약체결기준) / 차등점수제 적용");
  });
  it("발주기관은 '(이하' 패턴 폴백", () => {
    expect(o.agency).toBe("한국석유공사");
  });
});

describe("extractOverview — 라벨 표와 표지 인용", () => {
  const labelTable: Table = { type: "table", rows: 2, cols: 2, cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "발주기관", tables: [] },
    { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "한국석유공사(KNOC)", tables: [] },
    { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "사업 기간", tables: [] },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "12개월", tables: [] },
  ] };
  const cover: Table = { type: "table", rows: 1, cols: 1, cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "｢ 생성형 AI 플랫폼 구축 및 AX 개발 사업 ｣\n제 안 요 청 서", tables: [] },
  ] };
  it("2열 표의 왼쪽 라벨 → 오른쪽 값", () => {
    const o = extractOverview({ format: "docx", blocks: [labelTable] });
    expect(o.agency).toBe("한국석유공사(KNOC)");
    expect(o.period).toBe("12개월");
    expect(o.name).toBeNull();
  });
  it("사업명이 없으면 앞쪽 블록의 「…」 인용을 쓴다", () => {
    const o = extractOverview({ format: "hwp", blocks: [cover, p("본문")] });
    expect(o.name).toBe("생성형 AI 플랫폼 구축 및 AX 개발 사업");
  });
  it("아무것도 없으면 전부 null", () => {
    expect(extractOverview({ format: "hwp", blocks: [p("그냥 문장")] })).toEqual({ name: null, agency: null, period: null, budget: null, bidMethod: null, extra: {} });
  });
});

describe("extractOverview — 샘플 HWP", () => {
  const sample = readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", import.meta.url)));
  it("샘플에서 개요 5항목이 나온다", () => {
    const o = extractOverview(parseHwp(sample));
    expect(o.name).toBe("생성형 AI 플랫폼 구축 및 AX 개발 사업");
    expect(o.agency).toBe("한국석유공사");
    expect(o.period).toBe("계약체결일로부터 12개월");
    expect(o.budget).toBe("13,225,835,150원 (VAT 포함)");
    expect(o.bidMethod).toContain("일반경쟁입찰");
  });
});

describe("정규화", () => {
  it("normalizeName: 소문자·괄호 제거·공백·기호 제거", () => {
    expect(normalizeName("생성형 AI 플랫폼 구축 및 AX 개발 사업 (재공고)")).toBe("생성형ai플랫폼구축및ax개발사업");
    expect(normalizeName("「차세대 e-Learning」 사업")).toBe("차세대elearning사업");
  });
  it("nameCore: 재공고·긴급·차수 같은 접미 단어를 뗀다", () => {
    expect(nameCore("생성형 AI 플랫폼 구축 사업 재공고")).toBe(nameCore("생성형 AI 플랫폼 구축 사업"));
    expect(nameCore("정보시스템 구축 2차 긴급")).toBe("정보시스템구축");
  });
  it("normalizeAgency: 약칭·(이하 …)·법인 표기 제거", () => {
    expect(normalizeAgency("한국석유공사(KNOC)")).toBe("한국석유공사");
    expect(normalizeAgency("한국석유공사 (이하 “공사”)")).toBe("한국석유공사");
    expect(normalizeAgency("(주) 이노그리드")).toBe("이노그리드");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-overview`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/overview.ts`:

```ts
import { cellAt, paragraphTexts, rightOf, topLevelTables, type DocumentModel } from "./document-model";

export interface Overview {
  name: string | null;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  /** 라벨 문단 중 위 5개에 속하지 않는 것(2단계 이후 확장용). 1단계는 비워 둔다. */
  extra: Record<string, string>;
}

type Key = "name" | "agency" | "period" | "budget" | "bidMethod";

/** 라벨 정규식(공백 제거 전 원문에 적용, 앞뒤 공백 없는 라벨 문자열) */
const LABELS: { key: Key; re: RegExp }[] = [
  { key: "name", re: /^(?:사업\s*명|과업\s*명|용역\s*명|사업\s*명칭)$/ },
  { key: "period", re: /^(?:사업|용역|계약|과업|수행)\s*기간$/ },
  { key: "budget", re: /^(?:설계\s*금액|사업\s*금액|사업\s*예산|추정\s*가격|기초\s*금액|예산|총\s*사업비|사업비)$/ },
  { key: "bidMethod", re: /^(?:입찰\s*및\s*계약\s*방법|입찰\s*방법|계약\s*방법|입찰\s*방식|계약\s*방식|입찰\s*및\s*계약\s*방식)$/ },
  { key: "agency", re: /^(?:발주\s*기관|수요\s*기관|발주\s*처|주관\s*기관|발주\s*부서|계약\s*기관)$/ },
];
/** 문단 앞 글머리 기호 */
const BULLET = /^[\s□■○◦•\-·ㅇ●▪▶►※◇◆▷]+/;
/** "라벨 : 값" */
const LINE_RE = /^([^:：]{1,24}?)\s*[:：]\s*([\s\S]*)$/;
/** 발주기관 폴백: "한국석유공사(이하 “공사”)" */
const AGENCY_FALLBACK = /([가-힣A-Za-z0-9·]{2,30}?(?:공사|공단|청|부|처|원|진흥원|재단|위원회|특별시|광역시|특별자치시|특별자치도|시|군|구|도|대학교|대학|은행|센터|협회))\s*\(\s*이하\s*[“"'「]/;
/** 표지의 「사업명」·｢사업명｣·“사업명” */
const QUOTED_TITLE = /[「｢“"]\s*([^」｣”"]{4,80}?)\s*[」｣”"]/;

function clean(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function matchLabel(raw: string): Key | null {
  const label = raw.replace(BULLET, "").trim();
  return LABELS.find((l) => l.re.test(label))?.key ?? null;
}

/** 사업 개요 추출. 규칙 순서: 라벨 문단 → 라벨 표 → 발주기관 "(이하" 폴백 → 표지 인용 사업명. */
export function extractOverview(doc: DocumentModel): Overview {
  const out: Overview = { name: null, agency: null, period: null, budget: null, bidMethod: null, extra: {} };
  const paras = paragraphTexts(doc);

  // 1) 라벨 문단("□ 사업명 : 값" 또는 라벨만 있고 값은 다음 문단)
  for (let i = 0; i < paras.length; i++) {
    const line = paras[i].replace(BULLET, "").trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    const labelText = m ? m[1] : line;
    const key = matchLabel(labelText);
    if (!key || out[key]) continue;
    let value = m ? m[2].trim() : "";
    if (!value) {
      const next = paras[i + 1]?.replace(BULLET, "").trim() ?? "";
      if (next && !matchLabel(next.split(/[:：]/)[0])) value = next;
    }
    if (value) out[key] = clean(value);
  }

  // 2) 라벨 표(왼쪽 셀 라벨 → 오른쪽 셀 값)
  for (const t of topLevelTables(doc)) {
    if (t.cols < 2) continue;
    for (let r = 0; r < t.rows; r++) {
      const label = cellAt(t, r, 0);
      if (!label || label.row !== r) continue;
      const key = matchLabel(label.text);
      if (!key || out[key]) continue;
      const v = rightOf(t, label);
      if (v && v.text.trim()) out[key] = clean(v.text);
    }
  }

  // 3) 발주기관 폴백
  if (!out.agency) {
    for (const text of paras) {
      const m = AGENCY_FALLBACK.exec(text);
      if (m) {
        out.agency = m[1];
        break;
      }
    }
  }

  // 4) 사업명 폴백: 앞 8개 블록의 인용 제목
  if (!out.name) {
    outer: for (const b of doc.blocks.slice(0, 8)) {
      const texts = b.type === "paragraph" ? [b.text] : b.cells.map((c) => c.text);
      for (const t of texts) {
        const m = QUOTED_TITLE.exec(t);
        if (m) {
          out.name = clean(m[1]);
          break outer;
        }
      }
    }
  }
  return out;
}

/** 중복 비교용 사업명: NFKC·소문자·괄호(내용 포함)·공백·기호 제거 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, "")
    .replace(/[\s·・,./\\\-_—–「」｢｣『』"'“”‘’:;!?~<>〈〉《》]/g, "");
}

const NAME_NOISE = /(재\s*공고|긴급\s*공고|긴급|수정\s*공고|수정|변경\s*공고|변경|정정\s*공고|정정|재\s*입찰|\d+\s*차)/g;

/** 유사 판단용 사업명: 재공고·긴급·차수 같은 접미 단어를 떼고 정규화 */
export function nameCore(s: string): string {
  return normalizeName(s.replace(NAME_NOISE, " "));
}

/** 중복 비교용 발주기관: (이하 …)·약칭 괄호·법인 표기·공백·기호 제거 */
export function normalizeAgency(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(\s*이하[^)]*\)/g, "")
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/(주식회사|㈜|\(주\))/g, "")
    .replace(/[\s·・,./\-_"'“”‘’]/g, "");
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-overview`
Expected: PASS. 샘플 테스트에서 `bidMethod`가 다음 문단이 아니라 라벨 표에서 잡히는 등 어긋나면 규칙 순서가 아니라 데이터를 먼저 확인한다(`paragraphTexts` 출력에서 "입찰 및 계약 방법" 주변).

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/overview.ts src/lib/__tests__/rfp-overview.test.ts
git commit -m "feat(rfp): 사업 개요 추출(라벨 문단·라벨 표·발주기관 폴백·표지 인용)과 중복 비교용 정규화

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 8: 중복 판단

**Files:**
- Create: `frontend/src/lib/rfp/dedupe.ts`
- Test: `frontend/src/lib/__tests__/rfp-dedupe.test.ts`

**Interfaces:**
- Consumes: Task 7 `nameCore`
- Produces: `interface ExistingProject { id; name; agency: string|null; nameNorm; agencyNorm: string|null; fileHashes: string[]; createdAt: string }`, `interface DedupeInput { sha256; nameNorm; nameCore; agencyNorm: string|null }`, `type DedupeResult = {kind:"duplicate"; projectId; reason:"hash"|"name_agency"} | {kind:"needsConfirm"; candidates: ExistingProject[]} | {kind:"new"}`, `SIMILARITY_THRESHOLD = 0.85`, `bigramDice(a,b): number`, `decideDuplicate(input, existing): DedupeResult`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-dedupe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decideDuplicate, bigramDice, type ExistingProject } from "@/lib/rfp/dedupe";
import { normalizeName, nameCore, normalizeAgency } from "@/lib/rfp/overview";

const knoc: ExistingProject = {
  id: "p1", name: "생성형 AI 플랫폼 구축 및 AX 개발 사업", agency: "한국석유공사",
  nameNorm: normalizeName("생성형 AI 플랫폼 구축 및 AX 개발 사업"), agencyNorm: normalizeAgency("한국석유공사"),
  fileHashes: ["aaa"], createdAt: "2026-09-01T00:00:00Z",
};
const other: ExistingProject = {
  id: "p2", name: "차세대 인사시스템 구축", agency: "한국도로공사",
  nameNorm: normalizeName("차세대 인사시스템 구축"), agencyNorm: normalizeAgency("한국도로공사"),
  fileHashes: ["bbb"], createdAt: "2026-08-01T00:00:00Z",
};
const input = (name: string, agency: string | null, sha256 = "zzz") => ({
  sha256, nameNorm: normalizeName(name), nameCore: nameCore(name), agencyNorm: agency ? normalizeAgency(agency) : null,
});

describe("bigramDice", () => {
  it("같으면 1, 겹치는 바이그램이 없으면 0", () => {
    expect(bigramDice("abcd", "abcd")).toBe(1);
    expect(bigramDice("abcd", "wxyz")).toBe(0);
    expect(bigramDice("abcd", "abce")).toBeCloseTo(2 * 2 / 6, 5);
    expect(bigramDice("a", "a")).toBe(1);
    expect(bigramDice("a", "b")).toBe(0);
  });
});

describe("decideDuplicate", () => {
  it("파일 해시가 같으면 중복", () => {
    expect(decideDuplicate(input("완전히 다른 이름", "다른 기관", "aaa"), [knoc, other])).toEqual({ kind: "duplicate", projectId: "p1", reason: "hash" });
  });
  it("정규화한 사업명+발주기관이 같으면 중복(괄호·공백·재공고 아님)", () => {
    expect(decideDuplicate(input("생성형AI 플랫폼 구축 및 AX개발 사업", "한국석유공사(KNOC)"), [knoc, other])).toEqual({ kind: "duplicate", projectId: "p1", reason: "name_agency" });
  });
  it("사업명은 같은데 발주기관이 다르면 사용자 확인", () => {
    const r = decideDuplicate(input("생성형 AI 플랫폼 구축 및 AX 개발 사업", "한국가스공사"), [knoc, other]);
    expect(r.kind).toBe("needsConfirm");
    if (r.kind === "needsConfirm") expect(r.candidates.map((c) => c.id)).toEqual(["p1"]);
  });
  it("발주기관을 못 뽑았고 사업명이 같으면 사용자 확인", () => {
    expect(decideDuplicate(input("생성형 AI 플랫폼 구축 및 AX 개발 사업", null), [knoc, other]).kind).toBe("needsConfirm");
  });
  it("재공고처럼 접미 단어만 다르면 사용자 확인", () => {
    expect(decideDuplicate(input("생성형 AI 플랫폼 구축 및 AX 개발 사업 재공고", "한국석유공사"), [knoc, other]).kind).toBe("needsConfirm");
  });
  it("비슷하지 않으면 신규", () => {
    expect(decideDuplicate(input("스마트 항로표지 유지관리 용역", "해양수산부"), [knoc, other])).toEqual({ kind: "new" });
    expect(decideDuplicate(input("아무 사업", null), [])).toEqual({ kind: "new" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-dedupe`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/dedupe.ts`:

```ts
import { nameCore } from "./overview";

export interface ExistingProject {
  id: string;
  name: string;
  agency: string | null;
  nameNorm: string;
  agencyNorm: string | null;
  fileHashes: string[];
  createdAt: string;
}

export interface DedupeInput {
  sha256: string;
  nameNorm: string;
  nameCore: string;
  agencyNorm: string | null;
}

export type DedupeResult =
  | { kind: "duplicate"; projectId: string; reason: "hash" | "name_agency" }
  | { kind: "needsConfirm"; candidates: ExistingProject[] }
  | { kind: "new" };

export const SIMILARITY_THRESHOLD = 0.85;

/** 바이그램 Dice 계수(0~1). 정규화된 사업명끼리 비교한다. */
export function bigramDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/**
 * 스펙 §5. 해시 일치 또는 (사업명·발주기관 모두 있고) 둘 다 일치 → duplicate.
 * 발주기관이 없는데 사업명이 같거나, nameCore가 같거나, 사업명 유사도 ≥ 0.85 → needsConfirm. 그 외 new.
 */
export function decideDuplicate(input: DedupeInput, existing: ExistingProject[]): DedupeResult {
  const byHash = existing.find((p) => p.fileHashes.includes(input.sha256));
  if (byHash) return { kind: "duplicate", projectId: byHash.id, reason: "hash" };

  if (input.agencyNorm) {
    const exact = existing.find((p) => p.nameNorm === input.nameNorm && p.agencyNorm === input.agencyNorm);
    if (exact) return { kind: "duplicate", projectId: exact.id, reason: "name_agency" };
  }

  const candidates = existing.filter((p) => {
    if (!input.agencyNorm && p.nameNorm === input.nameNorm) return true;
    if (nameCore(p.name) === input.nameCore) return true;
    return bigramDice(p.nameNorm, input.nameNorm) >= SIMILARITY_THRESHOLD;
  });
  return candidates.length ? { kind: "needsConfirm", candidates } : { kind: "new" };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-dedupe`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/dedupe.ts src/lib/__tests__/rfp-dedupe.test.ts
git commit -m "feat(rfp): 중복 판단 — 해시·사업명+발주기관 일치는 중복, 유사하면 사용자 확인

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 9: Requirement 타입·구분 코드·ID 유틸

**Files:**
- Create: `frontend/src/lib/rfp/requirements.ts`
- Test: `frontend/src/lib/__tests__/rfp-requirements.test.ts`

**Interfaces:**
- Produces:
  - `type RequirementSource = { blockIndex: number } | { llm: true }`
  - `interface Requirement { categoryCode: string; categoryName: string; reqId: string; title: string; definition: string; details: string; deliverables: string; related: string; sortOrder: number; source: RequirementSource }`
  - `interface RequirementRow extends Requirement { id: string; solution: string; updatedAt?: string | null; updatedBy?: string | null }` (DB 행·xlsx 입력)
  - `STANDARD_CATEGORY_ORDER: readonly string[]`, `REQ_ID_RE`, `parseReqId(raw): {code; num} | null`, `orderCategoryCodes(codes): string[]`, `sheetNameFor(code, index): string`, `nextReqId(code, existingIds): string`, `categoryCodeFromName(name): string`, `sortRequirements<T extends { categoryCode: string; sortOrder: number }>(rows: T[]): T[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-requirements.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseReqId, orderCategoryCodes, sheetNameFor, nextReqId, categoryCodeFromName, sortRequirements,
  STANDARD_CATEGORY_ORDER, type Requirement,
} from "@/lib/rfp/requirements";

const req = (categoryCode: string, reqId: string, sortOrder: number): Requirement => ({
  categoryCode, categoryName: categoryCode, reqId, title: "", definition: "", details: "", deliverables: "", related: "", sortOrder, source: { blockIndex: sortOrder },
});

describe("parseReqId", () => {
  it("코드-숫자 형식을 읽고 공백·소문자를 정리한다", () => {
    expect(parseReqId("SER-001")).toEqual({ code: "SER", num: 1 });
    expect(parseReqId("INR-DTL-004")).toEqual({ code: "INR-DTL", num: 4 });
    expect(parseReqId(" ser-12 ")).toEqual({ code: "SER", num: 12 });
    expect(parseReqId("요구사항")).toBeNull();
    expect(parseReqId("SER001")).toBeNull();
    expect(parseReqId("")).toBeNull();
  });
});

describe("orderCategoryCodes / sheetNameFor", () => {
  it("표준 순서를 먼저, 그 외는 등장 순서", () => {
    expect(orderCategoryCodes(["COR", "XYZ", "SER", "INR-DTL", "ABC", "SER"])).toEqual(["SER", "INR-DTL", "COR", "XYZ", "ABC"]);
    expect(STANDARD_CATEGORY_ORDER[0]).toBe("SER");
    expect(STANDARD_CATEGORY_ORDER).toContain("INR-DTL");
  });
  it("시트명은 순번.코드(하이픈 제거)", () => {
    expect(sheetNameFor("SER", 2)).toBe("2.SER");
    expect(sheetNameFor("INR-DTL", 12)).toBe("12.INRDTL");
  });
});

describe("nextReqId", () => {
  it("같은 코드의 최대 번호 + 1, 3자리", () => {
    expect(nextReqId("SER", ["SER-001", "SER-004", "ASR-009"])).toBe("SER-005");
    expect(nextReqId("SEC", [])).toBe("SEC-001");
  });
});

describe("categoryCodeFromName", () => {
  it("구분명 키워드로 표준 코드를 고른다", () => {
    expect(categoryCodeFromName("서비스 요구사항")).toBe("SER");
    expect(categoryCodeFromName("AI 기반 솔루션 요구사항")).toBe("ASR");
    expect(categoryCodeFromName("데이터 플랫폼 요구사항")).toBe("DPR");
    expect(categoryCodeFromName("데이터 요구사항")).toBe("DAR");
    expect(categoryCodeFromName("인프라 상세 요구사항")).toBe("INR-DTL");
    expect(categoryCodeFromName("인프라 요구사항")).toBe("INR");
    expect(categoryCodeFromName("프로젝트지원 요구사항")).toBe("PSR");
    expect(categoryCodeFromName("제약사항")).toBe("COR");
    expect(categoryCodeFromName("알 수 없음")).toBe("REQ");
  });
});

describe("sortRequirements", () => {
  it("구분 표준 순서 → sortOrder", () => {
    const rows = [req("COR", "COR-001", 0), req("SER", "SER-002", 5), req("SER", "SER-001", 4), req("ZZZ", "ZZZ-001", 2)];
    expect(sortRequirements(rows).map((r) => r.reqId)).toEqual(["SER-001", "SER-002", "COR-001", "ZZZ-001"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-requirements`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/requirements.ts`:

```ts
/** 요구사항 한 건(추출 결과). DB 행은 RequirementRow. */
export type RequirementSource = { blockIndex: number } | { llm: true };

export interface Requirement {
  /** ID의 숫자 앞부분: SER, INR-DTL … */
  categoryCode: string;
  /** 요구사항 분류 원문: "서비스 요구사항" */
  categoryName: string;
  reqId: string;
  title: string;
  definition: string;
  details: string;
  deliverables: string;
  related: string;
  /** 문서 등장 순서 */
  sortOrder: number;
  source: RequirementSource;
}

export interface RequirementRow extends Requirement {
  id: string;
  /** 당사 솔루션(자유 텍스트, 2단계에서 구조화) */
  solution: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** 공공 SW 사업 표준 요구사항 분류 순서(샘플 xlsx의 시트 순서) */
export const STANDARD_CATEGORY_ORDER: readonly string[] = [
  "SER", "ASR", "FUR", "DAR", "SYS", "GOV", "QMR", "DPR", "INF", "INR", "INR-DTL", "PER", "TER", "SEC", "PMR", "PSR", "COR",
];

export const REQ_ID_RE = /^([A-Z]{2,5}(?:-[A-Z]{2,5})*)-(\d{2,4})$/;

export function parseReqId(raw: string): { code: string; num: number } | null {
  const id = raw.replace(/\s+/g, "").toUpperCase();
  const m = REQ_ID_RE.exec(id);
  return m ? { code: m[1], num: Number(m[2]) } : null;
}

/** 표준 순서에 있는 코드를 먼저, 나머지는 처음 등장한 순서로 */
export function orderCategoryCodes(codes: Iterable<string>): string[] {
  const seen = [...new Set(codes)];
  const std = STANDARD_CATEGORY_ORDER.filter((c) => seen.includes(c));
  const rest = seen.filter((c) => !STANDARD_CATEGORY_ORDER.includes(c));
  return [...std, ...rest];
}

/** xlsx 상세 시트 이름: "2.SER", "12.INRDTL" */
export function sheetNameFor(code: string, index: number): string {
  return `${index}.${code.replace(/-/g, "")}`;
}

/** 같은 코드의 최대 번호 + 1(3자리) */
export function nextReqId(code: string, existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const p = parseReqId(id);
    if (p && p.code === code) max = Math.max(max, p.num);
  }
  return `${code}-${String(max + 1).padStart(3, "0")}`;
}

/** 구분명 → 표준 코드(LLM 폴백에서 ID가 없을 때). 앞선 패턴이 우선(데이터 플랫폼 > 데이터, 인프라 상세 > 인프라). */
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/서비스/, "SER"],
  [/AI|인공지능|솔루션/i, "ASR"],
  [/데이터\s*플랫폼/, "DPR"],
  [/데이터/, "DAR"],
  [/인프라\s*상세/, "INR-DTL"],
  [/인프라|장비|하드웨어/, "INR"],
  [/거버넌스|PMO/, "GOV"],
  [/품질/, "QMR"],
  [/인터페이스|UI|UX/, "INF"],
  [/성능/, "PER"],
  [/테스트|시험/, "TER"],
  [/보안/, "SEC"],
  [/프로젝트\s*관리|사업\s*관리/, "PMR"],
  [/프로젝트\s*지원|사업\s*지원/, "PSR"],
  [/제약/, "COR"],
  [/시스템/, "SYS"],
  [/기능/, "FUR"],
];

export function categoryCodeFromName(name: string): string {
  for (const [re, code] of CATEGORY_KEYWORDS) if (re.test(name)) return code;
  return "REQ";
}

/** 화면·xlsx 정렬: 구분 표준 순서 → 문서 등장 순서. Requirement·RequirementRow·RfpRequirement 모두 받는다. */
export function sortRequirements<T extends { categoryCode: string; sortOrder: number }>(rows: T[]): T[] {
  const order = orderCategoryCodes(rows.map((r) => r.categoryCode));
  const rank = new Map(order.map((c, i) => [c, i]));
  return [...rows].sort((a, b) => (rank.get(a.categoryCode)! - rank.get(b.categoryCode)!) || a.sortOrder - b.sortOrder);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-requirements`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/requirements.ts src/lib/__tests__/rfp-requirements.test.ts
git commit -m "feat(rfp): Requirement 타입과 구분 코드 순서·ID 파싱·시트명 유틸

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 10: 표준 양식 판정과 규칙 추출

**Files:**
- Create: `frontend/src/lib/rfp/extract-standard.ts`
- Test: `frontend/src/lib/__tests__/rfp-extract-standard.test.ts`

**Interfaces:**
- Consumes: Task 2 유틸, Task 9 `parseReqId`·`Requirement`
- Produces: `interface ExtractionResult { requirements: Requirement[]; warnings: string[]; method: "standard" | "llm" }`, `isRequirementTable(t): boolean`, `isStandardFormat(doc): boolean`, `extractStandard(doc): ExtractionResult`, `readSummaryCounts(doc): Map<string, number> | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-extract-standard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHwp } from "@/lib/rfp/parse-hwp";
import { extractStandard, isStandardFormat, isRequirementTable, readSummaryCounts } from "@/lib/rfp/extract-standard";
import type { DocumentModel, Table } from "@/lib/rfp/document-model";

const sample = parseHwp(readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", import.meta.url))));

/** 스펙 §6.2 7행 3열 표준 표 */
function reqTable(id: string, opts: Partial<{ category: string; title: string; definition: string; details: string; deliverables: string; related: string }> = {}): Table {
  const c = (row: number, col: number, text: string, rowSpan = 1, colSpan = 1) => ({ row, col, rowSpan, colSpan, text, tables: [] });
  return { type: "table", rows: 7, cols: 3, cells: [
    c(0, 0, "요구사항 분류"), c(0, 1, opts.category ?? "서비스 요구사항", 1, 2),
    c(1, 0, "요구사항 고유번호"), c(1, 1, id, 1, 2),
    c(2, 0, "요구사항 명칭"), c(2, 1, opts.title ?? "제목", 1, 2),
    c(3, 0, "요구사항\n상세설명", 2), c(3, 1, "정의"), c(3, 2, opts.definition ?? "정의값"),
    c(4, 1, "세부 내용"), c(4, 2, opts.details ?? "◦ 세부"),
    c(5, 0, "산출정보"), c(5, 1, opts.deliverables ?? "", 1, 2),
    c(6, 0, "관련요구사항"), c(6, 1, opts.related ?? "", 1, 2),
  ] };
}

describe("isRequirementTable / isStandardFormat", () => {
  it("첫 셀 '요구사항 분류' + 고유번호·명칭 라벨이 있어야 표준 표", () => {
    expect(isRequirementTable(reqTable("SER-001"))).toBe(true);
    const listTable: Table = { type: "table", rows: 2, cols: 3, cells: [
      { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "구 분", tables: [] }, { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "요구사항 ID", tables: [] }, { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "명 칭", tables: [] },
    ] };
    expect(isRequirementTable(listTable)).toBe(false);
    expect(isStandardFormat({ format: "hwp", blocks: [{ type: "paragraph", text: "x" }] })).toBe(false);
    expect(isStandardFormat(sample)).toBe(true);
  });
});

describe("extractStandard — 합성 문서", () => {
  it("라벨 오른쪽 값을 필드로 읽고 구분 코드는 ID에서 만든다", () => {
    const doc: DocumentModel = { format: "hwp", blocks: [reqTable("SER-001", { title: "AI 대화형 서비스", related: "SER-003 : 대상 업무" }), reqTable("INR-DTL-002", { category: "인프라 상세 요구사항" })] };
    const r = extractStandard(doc);
    expect(r.method).toBe("standard");
    expect(r.requirements).toHaveLength(2);
    expect(r.requirements[0]).toMatchObject({ categoryCode: "SER", categoryName: "서비스 요구사항", reqId: "SER-001", title: "AI 대화형 서비스", definition: "정의값", details: "◦ 세부", deliverables: "", related: "SER-003 : 대상 업무", sortOrder: 0, source: { blockIndex: 0 } });
    expect(r.requirements[1]).toMatchObject({ categoryCode: "INR-DTL", reqId: "INR-DTL-002", source: { blockIndex: 1 } });
    expect(r.warnings).toEqual([]);
  });
  it("ID 형식이 아닌 표는 건너뛰고 경고, 중복 ID는 첫 것만", () => {
    const doc: DocumentModel = { format: "hwp", blocks: [reqTable("없음"), reqTable("SER-001"), reqTable("SER-001", { title: "둘째" })] };
    const r = extractStandard(doc);
    expect(r.requirements.map((q) => q.reqId)).toEqual(["SER-001"]);
    expect(r.requirements[0].title).toBe("제목");
    expect(r.warnings.some((w) => w.includes("ID 형식"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("중복"))).toBe(true);
  });
  it("총괄표 건수가 다르면 경고", () => {
    const summary: Table = { type: "table", rows: 3, cols: 3, cells: [
      { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "요구사항 구분", tables: [] }, { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "ID 부여규칙", tables: [] }, { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "요구사항수", tables: [] },
      { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "서비스 요구사항", tables: [] }, { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "SER-000", tables: [] }, { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: "3", tables: [] },
      { row: 2, col: 0, rowSpan: 1, colSpan: 1, text: "합 계", tables: [] }, { row: 2, col: 1, rowSpan: 1, colSpan: 1, text: "", tables: [] }, { row: 2, col: 2, rowSpan: 1, colSpan: 1, text: "3", tables: [] },
    ] };
    expect(readSummaryCounts({ format: "hwp", blocks: [summary] })).toEqual(new Map([["SER", 3]]));
    const r = extractStandard({ format: "hwp", blocks: [summary, reqTable("SER-001")] });
    expect(r.warnings).toEqual(["총괄표 SER 3건, 추출 1건"]);
  });
});

describe("extractStandard — 샘플 HWP", () => {
  const r = extractStandard(sample);
  it("124건, 경고 없음, 총괄표 합계 일치", () => {
    expect(r.requirements).toHaveLength(124);
    expect(r.warnings).toEqual([]);
    const counts = readSummaryCounts(sample)!;
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(124);
    expect(counts.get("INR-DTL")).toBe(4);
  });
  it("필드 값", () => {
    const ser1 = r.requirements.find((q) => q.reqId === "SER-001")!;
    expect(ser1).toMatchObject({ categoryCode: "SER", categoryName: "서비스 요구사항", title: "AI 대화형 서비스", definition: "AI 대화형 서비스 기본 기능" });
    expect(ser1.details).toContain("메시지 대화창 UI");
    expect(ser1.related).toContain("SER-003");
    const dtl4 = r.requirements.find((q) => q.reqId === "INR-DTL-004")!;
    expect(dtl4.details).toContain("[");
    expect(dtl4.deliverables).toContain("라이선스");
  });
  it("구분 코드 17개", () => {
    expect(new Set(r.requirements.map((q) => q.categoryCode)).size).toBe(17);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-extract-standard`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/extract-standard.ts`:

```ts
import { cellAt, findLabelCell, flattenCellText, normalizeLabel, rightOf, topLevelTables, type DocumentModel, type Table } from "./document-model";
import { parseReqId, type Requirement } from "./requirements";

export interface ExtractionResult {
  requirements: Requirement[];
  warnings: string[];
  method: "standard" | "llm";
}

/** 라벨 셀 후보(정규화 후 비교) */
const LABELS = {
  reqId: ["요구사항고유번호", "요구사항ID", "고유번호", "요구사항번호", "요구사항식별번호"],
  title: ["요구사항명칭", "요구사항명", "명칭"],
  definition: ["정의"],
  details: ["세부내용", "상세내용", "세부설명"],
  deliverables: ["산출정보", "산출물"],
  related: ["관련요구사항"],
} as const;

const FIRST_CELL = new Set(["요구사항분류", "요구사항구분"]);

function clean(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function valueOf(t: Table, labels: readonly string[]): string {
  const label = findLabelCell(t, labels);
  if (!label) return "";
  const v = rightOf(t, label);
  return v ? flattenCellText(v) : "";
}

/** 첫 셀이 "요구사항 분류/구분"이고 고유번호·명칭 라벨이 있는 표 */
export function isRequirementTable(t: Table): boolean {
  const first = cellAt(t, 0, 0);
  if (!first || !FIRST_CELL.has(normalizeLabel(first.text))) return false;
  return !!findLabelCell(t, LABELS.reqId) && !!findLabelCell(t, LABELS.title);
}

export function isStandardFormat(doc: DocumentModel): boolean {
  return topLevelTables(doc).some(isRequirementTable);
}

/** 총괄표(첫 셀 "요구사항 구분", "요구사항수" 열)에서 구분 코드별 건수. 없으면 null. */
export function readSummaryCounts(doc: DocumentModel): Map<string, number> | null {
  for (const t of topLevelTables(doc)) {
    const first = cellAt(t, 0, 0);
    if (!first || normalizeLabel(first.text) !== "요구사항구분") continue;
    let countCol = -1;
    let ruleCol = -1;
    for (let c = 0; c < t.cols; c++) {
      const h = normalizeLabel(cellAt(t, 0, c)?.text ?? "");
      if (h.includes("요구사항수") || h === "건수" || h === "수량") countCol = c;
      if (h.includes("부여규칙") || h.includes("ID")) ruleCol = c;
    }
    if (countCol < 0 || ruleCol < 0) continue;
    const map = new Map<string, number>();
    for (let r = 1; r < t.rows; r++) {
      const label = normalizeLabel(cellAt(t, r, 0)?.text ?? "");
      if (/^(합계|총계|계)/.test(label)) continue;
      const countText = (cellAt(t, r, countCol)?.text ?? "").trim();
      if (!countText) continue;
      const count = Number(countText.replace(/[^\d]/g, ""));
      const rule = (cellAt(t, r, ruleCol)?.text ?? "").replace(/\s+/g, "").toUpperCase();
      const m = /^([A-Z]{2,5}(?:-[A-Z]{2,5})*)-0+$/.exec(rule);
      if (!m || !Number.isFinite(count)) continue;
      map.set(m[1], (map.get(m[1]) ?? 0) + count);
    }
    return map.size ? map : null;
  }
  return null;
}

function compareWithSummary(doc: DocumentModel, requirements: Requirement[]): string[] {
  const summary = readSummaryCounts(doc);
  if (!summary) return [];
  const extracted = new Map<string, number>();
  for (const r of requirements) extracted.set(r.categoryCode, (extracted.get(r.categoryCode) ?? 0) + 1);
  const warnings: string[] = [];
  for (const [code, n] of summary) {
    const m = extracted.get(code) ?? 0;
    if (m !== n) warnings.push(`총괄표 ${code} ${n}건, 추출 ${m}건`);
  }
  for (const code of extracted.keys()) if (!summary.has(code)) warnings.push(`총괄표에 없는 구분 ${code} ${extracted.get(code)}건 추출`);
  return warnings;
}

/** 표준 양식(7행 표) 규칙 추출. 스펙 §6.2. */
export function extractStandard(doc: DocumentModel): ExtractionResult {
  const requirements: Requirement[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  doc.blocks.forEach((b, blockIndex) => {
    if (b.type !== "table" || !isRequirementTable(b)) return;
    const first = cellAt(b, 0, 0)!;
    const categoryCell = rightOf(b, first);
    const categoryName = clean(categoryCell ? flattenCellText(categoryCell) : "");

    const rawId = valueOf(b, LABELS.reqId);
    const parsed = parseReqId(rawId);
    if (!parsed) {
      warnings.push(`표 #${blockIndex}: 요구사항 ID 형식이 아니어서 건너뜀 ("${clean(rawId).slice(0, 30)}")`);
      return;
    }
    const reqId = rawId.replace(/\s+/g, "").toUpperCase();
    if (seen.has(reqId)) {
      warnings.push(`중복 요구사항 ID ${reqId}: 먼저 나온 표만 사용(표 #${blockIndex} 건너뜀)`);
      return;
    }
    seen.add(reqId);

    requirements.push({
      categoryCode: parsed.code,
      categoryName: categoryName || parsed.code,
      reqId,
      title: clean(valueOf(b, LABELS.title)),
      definition: valueOf(b, LABELS.definition).trim(),
      details: valueOf(b, LABELS.details).trim(),
      deliverables: valueOf(b, LABELS.deliverables).trim(),
      related: valueOf(b, LABELS.related).trim(),
      sortOrder: requirements.length,
      source: { blockIndex },
    });
  });

  warnings.push(...compareWithSummary(doc, requirements));
  return { requirements, warnings, method: "standard" };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-extract-standard`
Expected: PASS. 샘플에서 124가 아니면 어떤 표가 빠졌는지 `readSummaryCounts`와 코드별 건수를 비교해 원인을 찾는다(라벨 표기 차이일 가능성이 높다 — `LABELS`에 추가).

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/extract-standard.ts src/lib/__tests__/rfp-extract-standard.test.ts
git commit -m "feat(rfp): 표준 양식(7행 표) 판정·규칙 추출·총괄표 대조 — 샘플 124건 검증

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 11: LLM 폴백 추출

**Files:**
- Create: `frontend/src/lib/rfp/extract-llm.ts`
- Test: `frontend/src/lib/__tests__/rfp-extract-llm.test.ts`

**Interfaces:**
- Consumes: Task 2 `documentText`, Task 9 `parseReqId`·`categoryCodeFromName`·`Requirement`, Task 10 `ExtractionResult`
- Produces: `LlmOutputSchema`(zod), `type LlmOutput`, `type LlmExtractCall = (chunk: string) => Promise<LlmOutput>`, `class LlmUnavailableError extends Error`, `splitIntoChunks(text, maxChars = 30000): string[]`, `extractWithLlm(doc, call, opts?: { maxChars?: number }): Promise<ExtractionResult>`, `createAnthropicExtractCall(opts?: { apiKey?: string; model?: string }): LlmExtractCall`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-extract-llm.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { splitIntoChunks, extractWithLlm, createAnthropicExtractCall, LlmUnavailableError, LlmOutputSchema, type LlmOutput } from "@/lib/rfp/extract-llm";
import type { DocumentModel } from "@/lib/rfp/document-model";

afterEach(() => vi.unstubAllEnvs());

describe("splitIntoChunks", () => {
  it("짧은 문서는 청크 하나", () => {
    expect(splitIntoChunks("a\nb\nc")).toEqual(["a\nb\nc"]);
  });
  it("최대 길이를 넘지 않게 나누고 줄을 자르지 않는다", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `줄 ${i} ${"x".repeat(400)}`);
    const chunks = splitIntoChunks(lines.join("\n"), 10000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(10000);
    expect(chunks.join("\n").split("\n")).toHaveLength(100);
  });
  it("충분히 찼으면 '요구사항' 제목 줄에서 끊는다", () => {
    const body = Array.from({ length: 30 }, (_, i) => `내용 ${i} ${"y".repeat(100)}`).join("\n");
    const text = `${body}\n2. 기능 요구사항\n${body}`;
    const chunks = splitIntoChunks(text, 5000);
    expect(chunks[1].startsWith("2. 기능 요구사항")).toBe(true);
  });
});

describe("extractWithLlm", () => {
  const doc: DocumentModel = { format: "docx", blocks: [{ type: "paragraph", text: "1. 서비스 요구사항\n내용" }] };
  const item = (o: Partial<LlmOutput["requirements"][number]>) => ({
    categoryName: "서비스 요구사항", reqId: null, title: "", definition: "", details: "", deliverables: "", related: "", ...o,
  });
  it("청크마다 호출해 합치고, ID 없는 항목은 구분 코드로 번호를 붙인다", async () => {
    const call = vi.fn<(chunk: string) => Promise<LlmOutput>>()
      .mockResolvedValueOnce({ requirements: [item({ reqId: "SER-001", title: "대화형" }), item({ title: "특화 화면" })] })
      .mockResolvedValueOnce({ requirements: [item({ reqId: "ser-001", title: "중복" }), item({ categoryName: "보안 요구사항", title: "암호화" })] });
    const doc2: DocumentModel = { format: "docx", blocks: [{ type: "paragraph", text: "A".repeat(50) }, { type: "paragraph", text: "B".repeat(50) }] };
    const r = await extractWithLlm(doc2, call, { maxChars: 60 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.method).toBe("llm");
    expect(r.requirements.map((q) => q.reqId)).toEqual(["SER-001", "SER-002", "SEC-001"]);
    expect(r.requirements[1]).toMatchObject({ categoryCode: "SER", title: "특화 화면", sortOrder: 1, source: { llm: true } });
    expect(r.warnings.some((w) => w.includes("중복"))).toBe(true);
  });
  it("결과가 비면 경고", async () => {
    const r = await extractWithLlm(doc, async () => ({ requirements: [] }));
    expect(r.requirements).toEqual([]);
    expect(r.warnings).toEqual(["LLM이 요구사항을 하나도 찾지 못했습니다."]);
  });
  it("호출 실패는 청크 번호를 붙여 다시 던진다", async () => {
    await expect(extractWithLlm(doc, async () => { throw new Error("boom"); })).rejects.toThrow("LLM 추출 실패(청크 1/1): boom");
  });
});

describe("createAnthropicExtractCall", () => {
  it("API 키가 없으면 LlmUnavailableError", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => createAnthropicExtractCall()).toThrow(LlmUnavailableError);
  });
  it("키가 있으면 호출 함수를 만든다(네트워크는 쓰지 않음)", () => {
    expect(typeof createAnthropicExtractCall({ apiKey: "sk-test", model: "claude-opus-5" })).toBe("function");
  });
});

describe("LlmOutputSchema", () => {
  it("필드가 빠지면 거부", () => {
    expect(LlmOutputSchema.safeParse({ requirements: [{ title: "x" }] }).success).toBe(false);
    expect(LlmOutputSchema.safeParse({ requirements: [] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-extract-llm`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/extract-llm.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { documentText, type DocumentModel } from "./document-model";
import { categoryCodeFromName, parseReqId, type Requirement } from "./requirements";
import type { ExtractionResult } from "./extract-standard";

export const LlmRequirementSchema = z.object({
  categoryName: z.string(),
  reqId: z.string().nullable(),
  title: z.string(),
  definition: z.string(),
  details: z.string(),
  deliverables: z.string(),
  related: z.string(),
});
export const LlmOutputSchema = z.object({ requirements: z.array(LlmRequirementSchema) });
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

/** 청크 텍스트 → 구조화 결과. 테스트에서는 가짜 함수를 넣는다. */
export type LlmExtractCall = (chunk: string) => Promise<LlmOutput>;

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export const DEFAULT_LLM_MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `당신은 공공 정보화 사업 제안요청서(RFP)에서 요구사항을 추출하는 분석가입니다.
주어진 문서 조각에서 "요구사항" 항목을 모두 찾아 아래 필드로 정리합니다.
- categoryName: 요구사항 분류(예: 서비스 요구사항, 기능 요구사항, 보안 요구사항). 문서에 없으면 내용으로 판단합니다.
- reqId: 문서에 적힌 요구사항 ID(예: SER-001). 없으면 null.
- title: 요구사항 명칭.
- definition: 정의(한두 문장). 없으면 빈 문자열.
- details: 세부 내용. 문서의 문장·글머리 기호를 그대로 옮기고 요약하지 않습니다. 표는 "[a | b | c]" 줄로 씁니다.
- deliverables: 산출정보(산출물). 없으면 빈 문자열.
- related: 관련 요구사항 ID와 이름. 없으면 빈 문자열.
요구사항이 아닌 안내문·평가 방법·서식은 넣지 않습니다. 결과는 스키마에 맞는 JSON만 출력합니다.`;

/**
 * 문서 텍스트를 maxChars 이하 청크로 나눈다. 줄은 자르지 않고, 60% 이상 찼으면 "요구사항" 제목 줄에서 끊는다.
 */
export function splitIntoChunks(text: string, maxChars = 30000): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let len = 0;
  const flush = () => {
    if (cur.length) {
      chunks.push(cur.join("\n"));
      cur = [];
      len = 0;
    }
  };
  for (const line of text.split("\n")) {
    const isHeading = /요구사항/.test(line) && line.length < 60 && !line.startsWith("|");
    if ((isHeading && len > maxChars * 0.6) || (cur.length && len + line.length + 1 > maxChars)) flush();
    cur.push(line);
    len += line.length + 1;
  }
  flush();
  return chunks;
}

/** 표준 양식이 아닌 문서를 LLM으로 추출. 청크별 호출 → 병합(ID 중복은 먼저 나온 것) → ID 없는 항목은 구분 코드로 번호 부여. */
export async function extractWithLlm(doc: DocumentModel, call: LlmExtractCall, opts: { maxChars?: number } = {}): Promise<ExtractionResult> {
  const chunks = splitIntoChunks(documentText(doc), opts.maxChars);
  const requirements: Requirement[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const counters = new Map<string, number>();

  for (let i = 0; i < chunks.length; i++) {
    let out: LlmOutput;
    try {
      out = await call(chunks[i]);
    } catch (e) {
      throw new Error(`LLM 추출 실패(청크 ${i + 1}/${chunks.length}): ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const r of out.requirements) {
      const parsed = r.reqId ? parseReqId(r.reqId) : null;
      const code = parsed?.code ?? categoryCodeFromName(r.categoryName);
      let reqId = parsed ? r.reqId!.replace(/\s+/g, "").toUpperCase() : "";
      if (!reqId) {
        do {
          const n = (counters.get(code) ?? 0) + 1;
          counters.set(code, n);
          reqId = `${code}-${String(n).padStart(3, "0")}`;
        } while (seen.has(reqId));
      }
      if (seen.has(reqId)) {
        warnings.push(`중복 요구사항 ID ${reqId}: 먼저 나온 항목만 사용`);
        continue;
      }
      seen.add(reqId);
      requirements.push({
        categoryCode: code,
        categoryName: r.categoryName.trim() || code,
        reqId,
        title: r.title.trim(),
        definition: r.definition.trim(),
        details: r.details.trim(),
        deliverables: r.deliverables.trim(),
        related: r.related.trim(),
        sortOrder: requirements.length,
        source: { llm: true },
      });
    }
  }
  if (!requirements.length) warnings.push("LLM이 요구사항을 하나도 찾지 못했습니다.");
  return { requirements, warnings, method: "llm" };
}

/**
 * Anthropic SDK 호출 함수. 모델 claude-opus-5(env RFP_LLM_MODEL), adaptive thinking, 스트리밍 + finalMessage(),
 * 구조화 출력(output_config.format). 키가 없으면 LlmUnavailableError.
 */
export function createAnthropicExtractCall(opts: { apiKey?: string; model?: string } = {}): LlmExtractCall {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const model = opts.model ?? process.env.RFP_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const client = new Anthropic({ apiKey });
  return async (chunk) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `다음 제안요청서 본문에서 요구사항을 추출하세요.\n\n${chunk}` }],
      output_config: { format: zodOutputFormat(LlmOutputSchema) },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("모델이 요청을 거부했습니다.");
    if (msg.stop_reason === "max_tokens") throw new Error("출력이 max_tokens에 잘렸습니다. 청크를 줄이세요.");
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return LlmOutputSchema.parse(JSON.parse(text));
  };
}
```

SDK 타입이 `output_config`·`thinking` 형태에서 오류를 내면 `frontend/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`의 `MessageCreateParams`를 확인해 맞춘다(SDK 사용법은 `claude-api` 스킬 `typescript/claude-api/README.md`·`tool-use.md`가 정본).

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-extract-llm`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/extract-llm.ts src/lib/__tests__/rfp-extract-llm.test.ts
git commit -m "feat(rfp): 비표준 RFP용 Claude 폴백 추출 — 청크 분할·zod 구조화 출력·ID 병합

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 12: xlsx 생성

**Files:**
- Create: `frontend/src/lib/rfp/xlsx.ts`
- Test: `frontend/src/lib/__tests__/rfp-xlsx.test.ts`

**Interfaces:**
- Consumes: Task 9 `RequirementRow`·`orderCategoryCodes`·`sheetNameFor`·`sortRequirements`
- Produces: `interface XlsxProject { name; agency: string|null; period: string|null; budget: string|null; bidMethod: string|null; extra: Record<string,string> }`, `buildWorkbook(project, rows: RequirementRow[]): Promise<Buffer>`, `xlsxFileName(project, date?: Date): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/rfp-xlsx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook, xlsxFileName, type XlsxProject } from "@/lib/rfp/xlsx";
import type { RequirementRow } from "@/lib/rfp/requirements";

const project: XlsxProject = { name: "생성형 AI 플랫폼 구축 및 AX 개발 사업", agency: "한국석유공사", period: "12개월", budget: "13,225,835,150원", bidMethod: "일반경쟁입찰", extra: {} };
const row = (code: string, id: string, sortOrder: number, o: Partial<RequirementRow> = {}): RequirementRow => ({
  id: `${id}-uuid`, categoryCode: code, categoryName: code === "SER" ? "서비스 요구사항" : "인프라 상세 요구사항", reqId: id,
  title: `제목 ${id}`, definition: "정의", details: "◦ 세부\n - 둘째", deliverables: "", related: "", solution: "", sortOrder, source: { blockIndex: sortOrder }, ...o,
});
const rows = [row("INR-DTL", "INR-DTL-001", 2, { solution: "Openstackit" }), row("SER", "SER-002", 1), row("SER", "SER-001", 0)];

describe("buildWorkbook", () => {
  it("시트 구성·헤더·행·너비가 샘플과 같다", async () => {
    const buf = await buildWorkbook(project, rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL"]);

    const ov = wb.getWorksheet("0.개요")!;
    expect(String(ov.getCell("B2").value)).toContain("생성형 AI 플랫폼 구축 및 AX 개발 사업");
    expect(ov.getCell("B5").value).toBe("사업명");
    expect(ov.getCell("C5").value).toBe(project.name);
    expect(ov.getCell("B8").value).toBe("발주기관");
    expect(ov.getCell("C8").value).toBe("한국석유공사");

    const list = wb.getWorksheet("1.요구사항_목록")!;
    expect(String(list.getCell("A1").value)).toContain("전체 3건");
    expect(list.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션"]);
    expect(list.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "2.SER", ""]);
    expect(list.getRow(6).values).toEqual([undefined, 3, "인프라 상세 요구사항", "INR-DTL-001", "제목 INR-DTL-001", "3.INRDTL", "Openstackit"]);
    expect(list.getColumn(5).width).toBe(55);

    const ser = wb.getWorksheet("2.SER")!;
    expect(String(ser.getCell("A1").value)).toBe("[SER] 서비스 요구사항 — 상세 요구사항");
    expect(ser.getRow(3).values).toEqual([undefined, "연번", "요구사항\nID", "요구사항명", "정의", "세부 내용", "산출정보", "관련요구사항"]);
    expect(ser.getRow(5).getCell(2).value).toBe("SER-002");
    expect(ser.getRow(6).getCell(2).value).toBeNull();
    expect(ser.getColumn(5).width).toBe(85);
    expect(ser.getRow(4).getCell(5).alignment?.wrapText).toBe(true);
  });
  it("extra가 있으면 개요 시트에 '2. 기타'로 이어 붙인다", async () => {
    const buf = await buildWorkbook({ ...project, extra: { "추진 배경": "AI 도입 필요" } }, rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ov = wb.getWorksheet("0.개요")!;
    expect(ov.getCell("B11").value).toBe("2. 기타");
    expect(ov.getCell("B12").value).toBe("추진 배경");
    expect(ov.getCell("C12").value).toBe("AI 도입 필요");
  });
});

describe("xlsxFileName", () => {
  it("(발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx, 파일명 금지 문자는 _", () => {
    expect(xlsxFileName(project, new Date(2026, 8, 3))).toBe("(한국석유공사) 생성형 AI 플랫폼 구축 및 AX 개발 사업_요구사항 검토_20260903.xlsx");
    expect(xlsxFileName({ ...project, agency: null, name: "A/B: C" }, new Date(2026, 0, 5))).toBe("A_B_ C_요구사항 검토_20260105.xlsx");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm test -- rfp-xlsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/rfp/xlsx.ts`:

```ts
import ExcelJS from "exceljs";
import { orderCategoryCodes, sheetNameFor, sortRequirements, type RequirementRow } from "./requirements";

export interface XlsxProject {
  name: string;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  extra: Record<string, string>;
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

/** 샘플 xlsx와 같은 시트 구성: 0.개요 / 1.요구사항_목록(6열) / 구분별 상세(7열) */
export async function buildWorkbook(project: XlsxProject, rows: RequirementRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NHN Injeinc Workshop — RFP 분석";
  const sorted = sortRequirements(rows);
  const codes = orderCategoryCodes(sorted.map((r) => r.categoryCode));
  const sheetIndex = new Map(codes.map((c, i) => [c, i + 2]));

  // 0.개요
  const ov = wb.addWorksheet("0.개요");
  ov.getColumn("A").width = 3;
  ov.getColumn("B").width = 18;
  for (const col of ["C", "D", "E", "F", "G", "H"]) ov.getColumn(col).width = 16;
  ov.getCell("B2").value = `「${project.name}」 제안요청서 요구사항 분석`;
  ov.getCell("B2").font = { ...FONT, size: 14, bold: true };
  ov.getCell("B4").value = "1. 사업 개요 (일반사항)";
  ov.getCell("B4").font = { ...FONT, bold: true };
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
    ov.getCell(`B${r}`).value = "2. 기타";
    ov.getCell(`B${r}`).font = { ...FONT, bold: true };
    r += 1;
    for (const [k, v] of extras) keyValueRow(ov, r++, k, v);
  }

  // 1.요구사항_목록
  const list = wb.addWorksheet("1.요구사항_목록");
  [5, 22, 16, 38, 55, 30].forEach((w, i) => (list.getColumn(i + 1).width = w));
  list.getCell("A1").value = `요구사항 목록 총괄 (전체 ${sorted.length}건)`;
  list.getCell("A1").font = { ...FONT, size: 12, bold: true };
  list.getRow(3).values = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션"];
  styleHeader(list.getRow(3));
  sorted.forEach((q, i) => {
    const row = list.getRow(4 + i);
    row.values = [i + 1, q.categoryName, q.reqId, q.title, sheetNameFor(q.categoryCode, sheetIndex.get(q.categoryCode)!), q.solution];
    styleBody(row);
  });

  // 구분별 상세
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

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm test -- rfp-xlsx`
Expected: PASS. `row.values`는 배열 요소 0이 1열(A)이다(exceljs 규칙, 읽을 때는 index 0이 비어 `undefined`).

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/lib/rfp/xlsx.ts src/lib/__tests__/rfp-xlsx.test.ts
git commit -m "feat(rfp): 샘플과 같은 시트 구성의 xlsx 생성(0.개요·1.요구사항_목록·구분별 상세)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 13: API 타입·인증·파이프라인·업로드/등록 라우트

**Files:**
- Create: `frontend/src/types/rfp.ts`
- Create: `frontend/src/lib/rfp/require-user.ts`
- Create: `frontend/src/lib/rfp/mappers.ts`
- Create: `frontend/src/lib/rfp/creators.ts`
- Create: `frontend/src/lib/rfp/pipeline.ts`
- Create: `frontend/src/app/api/rfp/uploads/route.ts`
- Create: `frontend/src/app/api/rfp/projects/route.ts`

**Interfaces:**
- Consumes: Task 6 `parseDocument`·`detectFormat`·`ALLOWED_EXTENSIONS`·`MAX_UPLOAD_BYTES`·`extensionOf`, Task 7 `extractOverview`·`normalizeName`·`nameCore`·`normalizeAgency`, Task 8 `decideDuplicate`, Task 9 `sortRequirements`, Task 10 `extractStandard`·`isStandardFormat`, Task 11 `extractWithLlm`·`createAnthropicExtractCall`·`LlmUnavailableError`, 기존 `createServerSupabase`·`adminClientOr500`
- Produces:
  - `types/rfp.ts`: `RfpProjectStatus`, `RfpProjectSummary`, `RfpProjectDetail`, `RfpFile`, `RfpRequirement`, `RegisterResponse`, `UploadTicket`, `StatusResponse`
  - `require-user.ts`: `requireUser(): Promise<{ok:true; userId; role:"user"|"admin"; admin: SupabaseClient} | {ok:false; response}>`
  - `mappers.ts`: `PROJECT_COLUMNS`, `mapProjectSummary(row, creatorName)`, `mapProjectDetail(row, creatorName, files: FileDbRow[], requirements: RfpRequirement[])`, `mapRequirement(row)`, `toRequirementRow(row)`(xlsx용), `mapFile(row)`
  - `creators.ts`: `creatorNames(admin, userIds): Promise<Map<string, string | null>>`(user_profiles display_name → email)
  - `pipeline.ts`: `RFP_BUCKET = "rfp"`, `downloadFile(admin, path)`, `registerProject(admin, input): Promise<RegisterResult>`, `runExtraction(admin, projectId): Promise<void>`
  - 라우트: `POST /api/rfp/uploads`, `GET|POST /api/rfp/projects`

이 작업은 DB·Storage에 묶여 있어 단위 테스트가 없다. 검증은 `npx tsc --noEmit`과 `npm run lint`, 그리고 Task 15 이후 수동 확인이다.

- [ ] **Step 1: API 타입**

`frontend/src/types/rfp.ts`:

```ts
export type RfpProjectStatus = "extracting" | "ready" | "failed";
export type RfpExtractionMethod = "standard" | "llm";

export interface RfpProjectSummary {
  id: string;
  name: string;
  agency: string | null;
  status: RfpProjectStatus;
  extractionMethod: RfpExtractionMethod | null;
  requirementCount: number;
  createdBy: { id: string; name: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface RfpFile {
  id: string;
  originalFilename: string;
  format: "hwp" | "hwpx" | "docx";
  sizeBytes: number;
  createdAt: string;
}

export interface RfpRequirement {
  id: string;
  categoryCode: string;
  categoryName: string;
  reqId: string;
  title: string;
  definition: string;
  details: string;
  deliverables: string;
  related: string;
  solution: string;
  sortOrder: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface RfpProjectDetail extends RfpProjectSummary {
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  extra: Record<string, string>;
  error: string | null;
  warnings: string[];
  files: RfpFile[];
  requirements: RfpRequirement[];
}

/** GET /api/rfp/projects/[id]?fields=status */
export interface StatusResponse {
  status: RfpProjectStatus;
  error: string | null;
  requirementCount: number;
  extractionMethod: RfpExtractionMethod | null;
  updatedAt: string;
}

export interface UploadTicket {
  storagePath: string;
  token: string;
  signedUrl: string;
}

export type RegisterResponse =
  | { duplicate: true; projectId: string }
  | { needsConfirm: true; candidates: { id: string; name: string; agency: string | null; createdAt: string }[]; overview: { name: string; agency: string | null } }
  | { created: true; projectId: string };
```

- [ ] **Step 2: requireUser**

`frontend/src/lib/rfp/require-user.ts`:

```ts
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";

export type RfpCaller = { userId: string; role: "user" | "admin"; admin: SupabaseClient };

/** 세션 사용자가 user 이상인지 확인하고 service role 클라이언트를 함께 준다. 메시지 형식은 requireAdmin과 같다. */
export async function requireUser(): Promise<({ ok: true } & RfpCaller) | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  const role = profile?.role;
  if (role !== "user" && role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) };
  }
  const a = adminClientOr500();
  if (!a.ok) return a;
  return { ok: true, userId: user.id, role, admin: a.admin };
}
```

- [ ] **Step 3: DB 행 → API 타입 매퍼**

`frontend/src/lib/rfp/mappers.ts`:

```ts
import type { RfpFile, RfpProjectDetail, RfpProjectSummary, RfpRequirement } from "@/types/rfp";
import type { RequirementRow } from "./requirements";

export const PROJECT_COLUMNS =
  "id, name, agency, period, budget, bid_method, extra, status, extraction_method, error, warnings, requirement_count, created_by, created_at, updated_at";

/** rfp_projects 행(PROJECT_COLUMNS) */
export interface ProjectDbRow {
  id: string;
  name: string;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bid_method: string | null;
  extra: Record<string, string> | null;
  status: "extracting" | "ready" | "failed";
  extraction_method: "standard" | "llm" | null;
  error: string | null;
  warnings: unknown;
  requirement_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RequirementDbRow {
  id: string;
  category_code: string;
  category_name: string;
  req_id: string;
  title: string;
  definition: string;
  details: string;
  deliverables: string;
  related: string;
  solution: string;
  sort_order: number;
  source: unknown;
  updated_at: string;
  updated_by: string | null;
}

export interface FileDbRow {
  id: string;
  original_filename: string;
  format: "hwp" | "hwpx" | "docx";
  size_bytes: number;
  created_at: string;
}

export function mapProjectSummary(row: ProjectDbRow, creatorName: string | null): RfpProjectSummary {
  return {
    id: row.id,
    name: row.name,
    agency: row.agency,
    status: row.status,
    extractionMethod: row.extraction_method,
    requirementCount: row.requirement_count,
    createdBy: { id: row.created_by, name: creatorName },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFile(row: FileDbRow): RfpFile {
  return { id: row.id, originalFilename: row.original_filename, format: row.format, sizeBytes: Number(row.size_bytes), createdAt: row.created_at };
}

export function mapRequirement(row: RequirementDbRow): RfpRequirement {
  return {
    id: row.id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    reqId: row.req_id,
    title: row.title,
    definition: row.definition,
    details: row.details,
    deliverables: row.deliverables,
    related: row.related,
    solution: row.solution,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** xlsx 입력(RequirementRow) */
export function toRequirementRow(row: RequirementDbRow): RequirementRow {
  const source = (row.source && typeof row.source === "object" ? row.source : { blockIndex: -1 }) as RequirementRow["source"];
  return {
    id: row.id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    reqId: row.req_id,
    title: row.title,
    definition: row.definition,
    details: row.details,
    deliverables: row.deliverables,
    related: row.related,
    solution: row.solution,
    sortOrder: row.sort_order,
    source,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function mapProjectDetail(row: ProjectDbRow, creatorName: string | null, files: FileDbRow[], requirements: RfpRequirement[]): RfpProjectDetail {
  return {
    ...mapProjectSummary(row, creatorName),
    period: row.period,
    budget: row.budget,
    bidMethod: row.bid_method,
    extra: row.extra ?? {},
    error: row.error,
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    files: files.map(mapFile),
    requirements,
  };
}
```

- [ ] **Step 4: 파이프라인**

`frontend/src/lib/rfp/pipeline.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { UnsupportedDocumentError, type DocumentFormat, type DocumentModel } from "./document-model";
import { detectFormat, parseDocument } from "./parse";
import { extractOverview, nameCore, normalizeAgency, normalizeName, type Overview } from "./overview";
import { decideDuplicate, type ExistingProject } from "./dedupe";
import { extractStandard, isStandardFormat, type ExtractionResult } from "./extract-standard";
import { createAnthropicExtractCall, extractWithLlm, LlmUnavailableError } from "./extract-llm";

export const RFP_BUCKET = "rfp";

export async function downloadFile(admin: SupabaseClient, storagePath: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from(RFP_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`파일을 내려받을 수 없습니다: ${error?.message ?? storagePath}`);
  return Buffer.from(await data.arrayBuffer());
}

export interface RegisterInput {
  storagePath: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  force: boolean;
  userId: string;
}

export type RegisterResult =
  | { kind: "duplicate"; projectId: string }
  | { kind: "needsConfirm"; candidates: ExistingProject[]; overview: Overview & { name: string } }
  | { kind: "created"; projectId: string }
  | { kind: "error"; status: number; message: string };

/** 중복 판단용 기존 프로젝트 목록(프로젝트는 수백 건 이하라 1000행 상한 걱정 없음) */
async function loadExisting(admin: SupabaseClient): Promise<ExistingProject[]> {
  const { data: projects, error } = await admin.from("rfp_projects").select("id, name, agency, name_norm, agency_norm, created_at");
  if (error) throw new Error(error.message);
  const { data: files, error: fe } = await admin.from("rfp_files").select("project_id, sha256");
  if (fe) throw new Error(fe.message);
  const hashes = new Map<string, string[]>();
  for (const f of files ?? []) hashes.set(f.project_id, [...(hashes.get(f.project_id) ?? []), f.sha256]);
  return (projects ?? []).map((p) => ({
    id: p.id, name: p.name, agency: p.agency, nameNorm: p.name_norm, agencyNorm: p.agency_norm,
    fileHashes: hashes.get(p.id) ?? [], createdAt: p.created_at,
  }));
}

async function removeUpload(admin: SupabaseClient, storagePath: string) {
  await admin.storage.from(RFP_BUCKET).remove([storagePath]).catch(() => undefined);
}

/**
 * 스펙 §2·§5. 파일 내려받기 → 파싱 → 개요 → 중복 판단 → 프로젝트·파일 행 생성(status extracting).
 * 추출은 하지 않는다(라우트가 after()로 runExtraction을 호출).
 */
export async function registerProject(admin: SupabaseClient, input: RegisterInput): Promise<RegisterResult> {
  let buf: Buffer;
  try {
    buf = await downloadFile(admin, input.storagePath);
  } catch (e) {
    return { kind: "error", status: 400, message: e instanceof Error ? e.message : "파일을 내려받을 수 없습니다." };
  }

  let doc: DocumentModel;
  let format: DocumentFormat;
  try {
    format = detectFormat(buf, input.fileName);
    doc = parseDocument(buf, input.fileName);
  } catch (e) {
    await removeUpload(admin, input.storagePath);
    if (e instanceof UnsupportedDocumentError) return { kind: "error", status: 415, message: e.message };
    console.error("[rfp] parse failed", input.fileName, e);
    return { kind: "error", status: 400, message: "문서를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다." };
  }

  const overview = extractOverview(doc);
  const warnings: string[] = [];
  const name = overview.name ?? input.fileName.replace(/\.[^.]+$/, "");
  if (!overview.name) warnings.push("사업명을 문서에서 찾지 못해 파일명을 사용했습니다. 개요에서 수정하세요.");
  const nameNorm = normalizeName(name);
  const agencyNorm = overview.agency ? normalizeAgency(overview.agency) : null;

  const existing = await loadExisting(admin);
  const decision = decideDuplicate({ sha256: input.sha256, nameNorm, nameCore: nameCore(name), agencyNorm }, existing);
  if (decision.kind === "duplicate") {
    await removeUpload(admin, input.storagePath);
    return { kind: "duplicate", projectId: decision.projectId };
  }
  if (decision.kind === "needsConfirm" && !input.force) {
    return { kind: "needsConfirm", candidates: decision.candidates, overview: { ...overview, name } };
  }

  const { data: project, error } = await admin
    .from("rfp_projects")
    .insert({
      name, agency: overview.agency, period: overview.period, budget: overview.budget, bid_method: overview.bidMethod,
      extra: overview.extra, name_norm: nameNorm, agency_norm: agencyNorm, status: "extracting", warnings,
      created_by: input.userId, updated_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !project) {
    if (error?.code === "23505") {
      // 동시 등록 경쟁: 유니크 인덱스에 걸렸으면 그 프로젝트로 안내
      const { data: dup } = await admin.from("rfp_projects").select("id").eq("name_norm", nameNorm).eq("agency_norm", agencyNorm ?? "").maybeSingle();
      await removeUpload(admin, input.storagePath);
      if (dup) return { kind: "duplicate", projectId: dup.id };
    }
    return { kind: "error", status: 500, message: error?.message ?? "프로젝트 저장에 실패했습니다." };
  }

  const { error: fe } = await admin.from("rfp_files").insert({
    project_id: project.id, storage_path: input.storagePath, original_filename: input.fileName, format,
    size_bytes: input.sizeBytes, sha256: input.sha256, uploaded_by: input.userId,
  });
  if (fe) {
    await admin.from("rfp_projects").delete().eq("id", project.id);
    await removeUpload(admin, input.storagePath);
    if (fe.code === "23505") {
      const dup = existing.find((p) => p.fileHashes.includes(input.sha256));
      if (dup) return { kind: "duplicate", projectId: dup.id };
    }
    return { kind: "error", status: 500, message: fe.message };
  }
  return { kind: "created", projectId: project.id };
}

/**
 * 스펙 §6·§8. 원본을 다시 파싱해 요구사항을 추출하고 rfp_requirements를 교체한다.
 * 어떤 경우에도 status를 ready 또는 failed로 끝낸다.
 */
export async function runExtraction(admin: SupabaseClient, projectId: string): Promise<void> {
  const fail = async (message: string) => {
    await admin.from("rfp_projects").update({ status: "failed", error: message.slice(0, 500) }).eq("id", projectId);
  };
  try {
    const { data: file } = await admin
      .from("rfp_files")
      .select("storage_path, original_filename")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!file) return await fail("원본 파일이 없습니다.");

    const buf = await downloadFile(admin, file.storage_path);
    const doc = parseDocument(buf, file.original_filename);

    let result: ExtractionResult;
    if (isStandardFormat(doc)) {
      result = extractStandard(doc);
    } else {
      let call;
      try {
        call = createAnthropicExtractCall();
      } catch (e) {
        if (e instanceof LlmUnavailableError) return await fail(`표준 양식이 아니며 LLM 키가 설정되지 않았습니다(${e.message}).`);
        throw e;
      }
      result = await extractWithLlm(doc, call);
    }

    const { error: de } = await admin.from("rfp_requirements").delete().eq("project_id", projectId);
    if (de) throw new Error(de.message);
    const rows = result.requirements.map((r) => ({
      project_id: projectId, category_code: r.categoryCode, category_name: r.categoryName, req_id: r.reqId,
      title: r.title, definition: r.definition, details: r.details, deliverables: r.deliverables, related: r.related,
      sort_order: r.sortOrder, source: r.source,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from("rfp_requirements").insert(rows.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }

    const { data: proj } = await admin.from("rfp_projects").select("warnings").eq("id", projectId).single();
    const registerWarnings = (Array.isArray(proj?.warnings) ? (proj!.warnings as string[]) : []).filter((w) => w.startsWith("사업명을"));
    await admin
      .from("rfp_projects")
      .update({
        status: "ready", error: null, extraction_method: result.method,
        warnings: [...registerWarnings, ...result.warnings], requirement_count: result.requirements.length,
      })
      .eq("id", projectId);
  } catch (e) {
    console.error("[rfp] extraction failed", projectId, e);
    await fail(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 5: 업로드 URL 라우트**

`frontend/src/app/api/rfp/uploads/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, extensionOf } from "@/lib/rfp/parse";
import { RFP_BUCKET } from "@/lib/rfp/pipeline";
import type { UploadTicket } from "@/types/rfp";

export const runtime = "nodejs";

/**
 * POST /api/rfp/uploads {fileName, size} → 서명 업로드 URL(기본 유효 시간 안에 브라우저가 Storage로 직접 PUT).
 * Vercel 서버리스 함수의 요청 본문 상한(4.5MB)을 피하기 위해 파일은 서버를 거치지 않는다.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { fileName?: string; size?: number } | null;
  const fileName = body?.fileName?.trim();
  const size = Number(body?.size);
  if (!fileName || !Number.isFinite(size)) return NextResponse.json({ error: "fileName과 size가 필요합니다." }, { status: 400 });
  const ext = extensionOf(fileName);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return NextResponse.json({ error: "hwp·hwpx·docx 파일만 올릴 수 있습니다." }, { status: 400 });
  }
  if (size <= 0 || size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "파일은 50MB 이하여야 합니다." }, { status: 400 });

  // 경로에 원본 파일명을 쓰지 않는다(한글·특수문자 키 문제 회피). 원본명은 rfp_files.original_filename에 저장.
  const storagePath = `uploads/${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await auth.admin.storage.from(RFP_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return NextResponse.json({ error: `업로드 URL 생성에 실패했습니다: ${error?.message ?? ""}` }, { status: 500 });
  const ticket: UploadTicket = { storagePath, token: data.token, signedUrl: data.signedUrl };
  return NextResponse.json(ticket);
}
```

- [ ] **Step 6: 작성자 이름 조회 유틸**

`frontend/src/lib/rfp/creators.ts` (라우트 파일은 HTTP 메서드 외 export를 허용하지 않으므로 별도 모듈):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** user_id → 표시 이름(user_profiles.display_name, 없으면 email) */
export async function creatorNames(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!userIds.length) return map;
  const { data } = await admin.from("user_profiles").select("user_id, display_name, email").in("user_id", [...new Set(userIds)]);
  for (const p of data ?? []) map.set(p.user_id as string, (p.display_name as string | null) ?? (p.email as string | null) ?? null);
  return map;
}
```

- [ ] **Step 7: 목록·등록 라우트**

`frontend/src/app/api/rfp/projects/route.ts`:

```ts
import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { registerProject, runExtraction } from "@/lib/rfp/pipeline";
import { creatorNames } from "@/lib/rfp/creators";
import { PROJECT_COLUMNS, mapProjectSummary, type ProjectDbRow } from "@/lib/rfp/mappers";
import type { RegisterResponse } from "@/types/rfp";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/rfp/projects?q= — 사업명·발주기관 검색(JS 필터, 프로젝트는 수백 건 이하) */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const { data, error } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as ProjectDbRow[];
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.agency ?? "").toLowerCase().includes(q)) : rows;
  const names = await creatorNames(auth.admin, filtered.map((r) => r.created_by));
  return NextResponse.json({ projects: filtered.map((r) => mapProjectSummary(r, names.get(r.created_by) ?? null)) });
}

/**
 * POST /api/rfp/projects {storagePath, fileName, sha256, sizeBytes, force?}
 * 200 {duplicate} | 200 {needsConfirm, candidates, overview} | 201 {created, projectId}. 등록되면 after()로 추출 실행.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as
    | { storagePath?: string; fileName?: string; sha256?: string; sizeBytes?: number; force?: boolean }
    | null;
  const storagePath = body?.storagePath ?? "";
  const fileName = body?.fileName?.trim() ?? "";
  const sha256 = (body?.sha256 ?? "").toLowerCase();
  const sizeBytes = Number(body?.sizeBytes);
  if (!storagePath.startsWith("uploads/") || !fileName || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isFinite(sizeBytes)) {
    return NextResponse.json({ error: "storagePath, fileName, sha256, sizeBytes가 필요합니다." }, { status: 400 });
  }

  const result = await registerProject(auth.admin, { storagePath, fileName, sha256, sizeBytes, force: body?.force === true, userId: auth.userId });
  if (result.kind === "error") return NextResponse.json({ error: result.message }, { status: result.status });
  if (result.kind === "duplicate") {
    const res: RegisterResponse = { duplicate: true, projectId: result.projectId };
    return NextResponse.json(res);
  }
  if (result.kind === "needsConfirm") {
    const res: RegisterResponse = {
      needsConfirm: true,
      candidates: result.candidates.map((c) => ({ id: c.id, name: c.name, agency: c.agency, createdAt: c.createdAt })),
      overview: { name: result.overview.name, agency: result.overview.agency },
    };
    return NextResponse.json(res);
  }
  const admin = auth.admin;
  const projectId = result.projectId;
  after(async () => {
    await runExtraction(admin, projectId);
  });
  const res: RegisterResponse = { created: true, projectId };
  return NextResponse.json(res, { status: 201 });
}
```

- [ ] **Step 8: 타입 검사·린트**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/(lib/rfp|app/api/rfp|types/rfp)" ; npm run lint 2>&1 | tail -5
```
Expected: rfp 관련 오류 없음. 오류가 있으면 고친다(특히 `after` import, Supabase 타입 추론에서 `never`가 나오면 `.select(...)` 결과를 `as ProjectDbRow[]`처럼 단언).

- [ ] **Step 9: 커밋**

```bash
cd frontend && git add src/types/rfp.ts src/lib/rfp/require-user.ts src/lib/rfp/mappers.ts src/lib/rfp/pipeline.ts src/lib/rfp/creators.ts src/app/api/rfp/uploads src/app/api/rfp/projects/route.ts
git commit -m "feat(rfp): 업로드 URL·프로젝트 등록/목록 API — 파싱·개요·중복 판단 후 after()로 추출

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 14: 상세·편집·재추출·xlsx·요구사항 API

**Files:**
- Create: `frontend/src/app/api/rfp/projects/[id]/route.ts`
- Create: `frontend/src/app/api/rfp/projects/[id]/reextract/route.ts`
- Create: `frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts`
- Create: `frontend/src/app/api/rfp/projects/[id]/file/route.ts`
- Create: `frontend/src/app/api/rfp/projects/[id]/requirements/route.ts`
- Create: `frontend/src/app/api/rfp/requirements/[requirementId]/route.ts`

**Interfaces:**
- Consumes: Task 13 `requireUser`·매퍼·`runExtraction`·`RFP_BUCKET`·`creatorNames`, Task 9 `nextReqId`·`parseReqId`·`sortRequirements`, Task 12 `buildWorkbook`·`xlsxFileName`, Task 7 `normalizeName`·`normalizeAgency`
- Produces: 스펙 §8의 나머지 라우트. 응답 타입은 `types/rfp.ts`.

- [ ] **Step 1: 상세·개요 편집·삭제**

`frontend/src/app/api/rfp/projects/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { creatorNames } from "@/lib/rfp/creators";
import { PROJECT_COLUMNS, mapProjectDetail, mapRequirement, type FileDbRow, type ProjectDbRow, type RequirementDbRow } from "@/lib/rfp/mappers";
import { normalizeAgency, normalizeName } from "@/lib/rfp/overview";
import { sortRequirements } from "@/lib/rfp/requirements";
import { RFP_BUCKET } from "@/lib/rfp/pipeline";
import type { StatusResponse } from "@/types/rfp";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/rfp/projects/[id] — 상세. ?fields=status면 상태만(폴링용). */
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
    const res: StatusResponse = { status: row.status, error: row.error, requirementCount: row.requirement_count, extractionMethod: row.extraction_method, updatedAt: row.updated_at };
    return NextResponse.json(res);
  }

  const [{ data: files }, { data: reqs }, names] = await Promise.all([
    auth.admin.from("rfp_files").select("id, original_filename, format, size_bytes, created_at").eq("project_id", id).order("created_at", { ascending: false }),
    auth.admin.from("rfp_requirements").select("*").eq("project_id", id).order("sort_order", { ascending: true }),
    creatorNames(auth.admin, [row.created_by]),
  ]);
  // 요구사항은 프로젝트당 수백 건이라 Supabase 1000행 상한에 걸리지 않는다. 넘길 가능성이 생기면 selectAll(lib/work-metrics/common.ts)로 바꾼다.
  const requirements = sortRequirements(((reqs ?? []) as RequirementDbRow[]).map(mapRequirement));
  return NextResponse.json(mapProjectDetail(row, names.get(row.created_by) ?? null, (files ?? []) as FileDbRow[], requirements));
}

/** PATCH /api/rfp/projects/[id] {name?, agency?, period?, budget?, bidMethod?} — 개요 편집 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  const pick = (k: string): string | null | undefined => {
    if (!(k in body)) return undefined;
    const v = body[k];
    if (v === null) return null;
    if (typeof v !== "string") throw new Error(`${k}는 문자열이어야 합니다.`);
    if (v.length > 500) throw new Error(`${k}는 500자 이하여야 합니다.`);
    return v.trim();
  };
  let patch: Record<string, unknown>;
  try {
    const name = pick("name");
    const agency = pick("agency");
    patch = {
      ...(name !== undefined && { name, name_norm: normalizeName(name ?? "") }),
      ...(agency !== undefined && { agency, agency_norm: agency ? normalizeAgency(agency) : null }),
      ...(pick("period") !== undefined && { period: pick("period") }),
      ...(pick("budget") !== undefined && { budget: pick("budget") }),
      ...(pick("bidMethod") !== undefined && { bid_method: pick("bidMethod") }),
      updated_by: auth.userId,
    };
    if (name !== undefined && !name) throw new Error("사업명은 비울 수 없습니다.");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "잘못된 요청" }, { status: 400 });
  }
  const { data, error } = await auth.admin.from("rfp_projects").update(patch).eq("id", id).select(PROJECT_COLUMNS).maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 사업명·발주기관의 프로젝트가 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = data as ProjectDbRow;
  return NextResponse.json({ id: row.id, name: row.name, agency: row.agency, period: row.period, budget: row.budget, bidMethod: row.bid_method, updatedAt: row.updated_at });
}

/** DELETE /api/rfp/projects/[id] — 등록자 또는 admin. 파일·요구사항 함께 삭제. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: project } = await auth.admin.from("rfp_projects").select("id, created_by").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  if (auth.role !== "admin" && project.created_by !== auth.userId) {
    return NextResponse.json({ error: "등록자 또는 관리자만 삭제할 수 있습니다." }, { status: 403 });
  }
  const { data: files } = await auth.admin.from("rfp_files").select("storage_path").eq("project_id", id);
  const paths = (files ?? []).map((f) => f.storage_path as string);
  if (paths.length) await auth.admin.storage.from(RFP_BUCKET).remove(paths);
  const { error } = await auth.admin.from("rfp_projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: 재추출**

`frontend/src/app/api/rfp/projects/[id]/reextract/route.ts`:

```ts
import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { runExtraction } from "@/lib/rfp/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/rfp/projects/[id]/reextract {confirm?: boolean}
 * 편집된 행(updated_by not null)이 있고 confirm이 아니면 409 {needsConfirm, editedCount}. 아니면 extracting으로 되돌리고 after()로 추출.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  const { data: project } = await auth.admin.from("rfp_projects").select("id, status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  if (project.status === "extracting") return NextResponse.json({ error: "이미 추출 중입니다." }, { status: 409 });

  const { count } = await auth.admin.from("rfp_requirements").select("id", { count: "exact", head: true }).eq("project_id", id).not("updated_by", "is", null);
  if ((count ?? 0) > 0 && body.confirm !== true) {
    return NextResponse.json({ needsConfirm: true, editedCount: count }, { status: 409 });
  }
  await auth.admin.from("rfp_projects").update({ status: "extracting", error: null, updated_by: auth.userId }).eq("id", id);
  const admin = auth.admin;
  after(async () => {
    await runExtraction(admin, id);
  });
  return NextResponse.json({ status: "extracting" }, { status: 202 });
}
```

- [ ] **Step 3: xlsx 다운로드**

`frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { PROJECT_COLUMNS, toRequirementRow, type ProjectDbRow, type RequirementDbRow } from "@/lib/rfp/mappers";
import { buildWorkbook, xlsxFileName } from "@/lib/rfp/xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/rfp/projects/[id]/xlsx — 샘플과 같은 시트 구성의 엑셀 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: project } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const p = project as ProjectDbRow;
  const { data: reqs, error } = await auth.admin.from("rfp_requirements").select("*").eq("project_id", id).order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const xlsxProject = { name: p.name, agency: p.agency, period: p.period, budget: p.budget, bidMethod: p.bid_method, extra: p.extra ?? {} };
  const buf = await buildWorkbook(xlsxProject, ((reqs ?? []) as RequirementDbRow[]).map(toRequirementRow));
  const fileName = xlsxFileName(xlsxProject);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="requirements.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: 원본 파일 다운로드 URL**

`frontend/src/app/api/rfp/projects/[id]/file/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { RFP_BUCKET } from "@/lib/rfp/pipeline";

export const runtime = "nodejs";

/** GET /api/rfp/projects/[id]/file → {url} 최신 원본 파일의 서명 다운로드 URL(5분) */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: file } = await auth.admin
    .from("rfp_files")
    .select("storage_path, original_filename")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: "원본 파일이 없습니다." }, { status: 404 });
  const { data, error } = await auth.admin.storage.from(RFP_BUCKET).createSignedUrl(file.storage_path, 300, { download: file.original_filename });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "다운로드 URL 생성에 실패했습니다." }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
```

- [ ] **Step 5: 행 추가**

`frontend/src/app/api/rfp/projects/[id]/requirements/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { mapRequirement, type RequirementDbRow } from "@/lib/rfp/mappers";
import { nextReqId, parseReqId } from "@/lib/rfp/requirements";

export const runtime = "nodejs";

const TEXT_FIELDS = ["title", "definition", "details", "deliverables", "related", "solution"] as const;

/** POST /api/rfp/projects/[id]/requirements {categoryCode, categoryName, reqId?, title?, …} → 201 행 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const categoryCode = typeof body?.categoryCode === "string" ? body.categoryCode.trim().toUpperCase() : "";
  const categoryName = typeof body?.categoryName === "string" ? body.categoryName.trim() : "";
  if (!/^[A-Z]{2,5}(-[A-Z]{2,5})*$/.test(categoryCode) || !categoryName) {
    return NextResponse.json({ error: "categoryCode(예: SER)와 categoryName이 필요합니다." }, { status: 400 });
  }
  const { data: project } = await auth.admin.from("rfp_projects").select("id").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  const { data: existing } = await auth.admin.from("rfp_requirements").select("req_id, sort_order").eq("project_id", id);
  const ids = (existing ?? []).map((r) => r.req_id as string);
  let reqId = typeof body?.reqId === "string" ? body.reqId.replace(/\s+/g, "").toUpperCase() : "";
  if (reqId) {
    const parsed = parseReqId(reqId);
    if (!parsed) return NextResponse.json({ error: "요구사항 ID 형식은 SER-001 같은 코드-숫자입니다." }, { status: 400 });
    if (parsed.code !== categoryCode) return NextResponse.json({ error: "요구사항 ID의 코드가 구분 코드와 다릅니다." }, { status: 400 });
  } else {
    reqId = nextReqId(categoryCode, ids);
  }
  const maxSort = Math.max(-1, ...(existing ?? []).map((r) => Number(r.sort_order)));
  const texts: Record<string, string> = {};
  for (const f of TEXT_FIELDS) {
    const v = body?.[f];
    if (v !== undefined && typeof v !== "string") return NextResponse.json({ error: `${f}는 문자열이어야 합니다.` }, { status: 400 });
    texts[f] = typeof v === "string" ? v : "";
  }
  const { data, error } = await auth.admin
    .from("rfp_requirements")
    .insert({ project_id: id, category_code: categoryCode, category_name: categoryName, req_id: reqId, ...texts, sort_order: maxSort + 1, source: { manual: true }, updated_by: auth.userId })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `요구사항 ID ${reqId}가 이미 있습니다.` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { count } = await auth.admin.from("rfp_requirements").select("id", { count: "exact", head: true }).eq("project_id", id);
  await auth.admin.from("rfp_projects").update({ requirement_count: count ?? 0, updated_by: auth.userId }).eq("id", id);
  return NextResponse.json(mapRequirement(data as RequirementDbRow), { status: 201 });
}
```

- [ ] **Step 6: 셀 편집·행 삭제**

`frontend/src/app/api/rfp/requirements/[requirementId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { mapRequirement, type RequirementDbRow } from "@/lib/rfp/mappers";
import { parseReqId } from "@/lib/rfp/requirements";

export const runtime = "nodejs";

type Params = { params: Promise<{ requirementId: string }> };
const TEXT_FIELDS = ["title", "definition", "details", "deliverables", "related", "solution", "categoryName"] as const;
const COLUMN: Record<(typeof TEXT_FIELDS)[number], string> = {
  title: "title", definition: "definition", details: "details", deliverables: "deliverables", related: "related", solution: "solution", categoryName: "category_name",
};

/** PATCH /api/rfp/requirements/[requirementId] — 셀 단위 부분 갱신. reqId를 바꾸면 category_code도 따라간다. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { requirementId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_by: auth.userId };
  for (const f of TEXT_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (typeof v !== "string") return NextResponse.json({ error: `${f}는 문자열이어야 합니다.` }, { status: 400 });
    if (v.length > 20000) return NextResponse.json({ error: `${f}는 20000자 이하여야 합니다.` }, { status: 400 });
    patch[COLUMN[f]] = v;
  }
  if (typeof body.reqId === "string") {
    const reqId = body.reqId.replace(/\s+/g, "").toUpperCase();
    const parsed = parseReqId(reqId);
    if (!parsed) return NextResponse.json({ error: "요구사항 ID 형식은 SER-001 같은 코드-숫자입니다." }, { status: 400 });
    patch.req_id = reqId;
    patch.category_code = parsed.code;
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });

  const { data, error } = await auth.admin.from("rfp_requirements").update(patch).eq("id", requirementId).select("*").maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 요구사항 ID가 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });
  return NextResponse.json(mapRequirement(data as RequirementDbRow));
}

/** DELETE /api/rfp/requirements/[requirementId] → 204 (프로젝트 건수 갱신) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { requirementId } = await params;
  const { data: row } = await auth.admin.from("rfp_requirements").select("id, project_id").eq("id", requirementId).maybeSingle();
  if (!row) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });
  const { error } = await auth.admin.from("rfp_requirements").delete().eq("id", requirementId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { count } = await auth.admin.from("rfp_requirements").select("id", { count: "exact", head: true }).eq("project_id", row.project_id);
  await auth.admin.from("rfp_projects").update({ requirement_count: count ?? 0, updated_by: auth.userId }).eq("id", row.project_id);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 7: 타입 검사·린트**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/(lib/rfp|app/api/rfp|types/rfp)"; npm run lint 2>&1 | tail -5
```
Expected: rfp 관련 오류 없음.

- [ ] **Step 8: 커밋**

```bash
cd frontend && git add src/app/api/rfp
git commit -m "feat(rfp): 프로젝트 상세/개요 편집/삭제·재추출·xlsx·원본 다운로드·요구사항 행 추가/편집/삭제 API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 15: 내비·홈 카드·목록/업로드 화면

**Files:**
- Modify: `frontend/src/components/layout/Navigation.tsx:7,31-41` (아이콘 import, NAV_ITEMS)
- Modify: `frontend/src/lib/roles.ts:16-20` (ROLE_ACCESS)
- Modify: `frontend/src/app/page.tsx:5,9-60` (아이콘 import, FEATURES)
- Create: `frontend/src/lib/rfp/client-upload.ts`
- Create: `frontend/src/components/rfp/UploadDropzone.tsx`
- Create: `frontend/src/components/rfp/ConfirmDuplicateDialog.tsx`
- Create: `frontend/src/components/rfp/ProjectList.tsx`
- Create: `frontend/src/app/rfp/page.tsx`

**Interfaces:**
- Consumes: Task 13 API(`POST /api/rfp/uploads`, `GET|POST /api/rfp/projects`), `types/rfp.ts`, 기존 `createClient`(`@/lib/supabase`, 브라우저 anon 클라이언트), shadcn `Button`·`Input`·`Badge`·`Dialog`·`Alert`
- Produces: `uploadAndRegister(file, opts): Promise<{ response: RegisterResponse; ticket: UploadTicket; sha256: string }>`, `sha256Hex(file)`, 컴포넌트 3개, `/rfp` 화면

- [ ] **Step 1: 내비·역할·홈 카드**

`Navigation.tsx` 7행 import에 `FileSearch` 추가:
```ts
import { Dice5, LogOut, UtensilsCrossed, Coffee, Shield, User as UserIcon, Settings, BookOpen, ClipboardList, SquareTerminal, MessagesSquare, TrendingUp, FileSearch } from "lucide-react";
```
NAV_ITEMS에서 `/usage/perf` 줄 뒤, `/admin` 줄 앞에 추가:
```ts
  { href: "/rfp", label: "RFP 분석", icon: FileSearch, minRole: "user" },
```
`roles.ts` ROLE_ACCESS:
```ts
const ROLE_ACCESS: Record<UserRole, string[]> = {
  guest: ["/food", "/ladder", "/team", "/survey"],
  user: ["/food", "/ladder", "/team", "/guide", "/survey", "/rfp"],
  admin: ["/food", "/ladder", "/team", "/guide", "/survey", "/rfp", "/admin"],
};
```
`page.tsx` import에 `FileSearch` 추가하고 FEATURES의 `/survey` 항목 뒤에:
```ts
  {
    href: "/rfp",
    title: "RFP 분석",
    description: "제안요청서(hwp·hwpx·docx)를 올리면 사업 개요와 요구사항 표를 만들어 드립니다. 편집하고 엑셀로 내려받으세요.",
    icon: FileSearch,
    gradient: "from-violet-500 to-purple-600",
    bgAccent: "bg-violet-50",
    iconColor: "text-violet-600",
    delay: "delay-[475ms]",
  },
```
확인: `cd frontend && npx tsc --noEmit 2>&1 | grep -E "Navigation|roles|app/page" ; echo ok`

- [ ] **Step 2: 브라우저 업로드·등록 흐름**

`frontend/src/lib/rfp/client-upload.ts`:

```ts
import { createClient } from "@/lib/supabase";
import type { RegisterResponse, UploadTicket } from "@/types/rfp";

export type UploadPhase = "hashing" | "uploading" | "registering";
export const PHASE_LABEL: Record<UploadPhase, string> = { hashing: "파일 확인 중…", uploading: "업로드 중…", registering: "분석 중…" };

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RegisterOptions {
  force?: boolean;
  onPhase?: (phase: UploadPhase) => void;
  /** needsConfirm 뒤 "새로 등록"일 때: 이미 올린 파일을 다시 쓰기 위해 넘긴다 */
  ticket?: UploadTicket;
  sha256?: string;
}

export interface RegisterOutcome {
  response: RegisterResponse;
  ticket: UploadTicket;
  sha256: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? fallback;
}

/** sha256 → 서명 URL → Storage 직접 업로드 → 등록 요청. 스펙 §3 1~3단계. */
export async function uploadAndRegister(file: File, opts: RegisterOptions = {}): Promise<RegisterOutcome> {
  let sha256 = opts.sha256;
  let ticket = opts.ticket;
  if (!sha256) {
    opts.onPhase?.("hashing");
    sha256 = await sha256Hex(file);
  }
  if (!ticket) {
    opts.onPhase?.("uploading");
    const tr = await fetch("/api/rfp/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, size: file.size }),
    });
    if (!tr.ok) throw new Error(await readError(tr, "업로드 URL을 받지 못했습니다."));
    ticket = (await tr.json()) as UploadTicket;
    const supabase = createClient();
    const { error } = await supabase.storage.from("rfp").uploadToSignedUrl(ticket.storagePath, ticket.token, file, { contentType: "application/octet-stream" });
    if (error) throw new Error(`파일 업로드에 실패했습니다: ${error.message}`);
  }
  opts.onPhase?.("registering");
  const rr = await fetch("/api/rfp/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storagePath: ticket.storagePath, fileName: file.name, sha256, sizeBytes: file.size, force: opts.force === true }),
  });
  if (!rr.ok) throw new Error(await readError(rr, "등록에 실패했습니다."));
  return { response: (await rr.json()) as RegisterResponse, ticket, sha256 };
}
```

- [ ] **Step 3: 드롭존**

`frontend/src/components/rfp/UploadDropzone.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  busy: boolean;
  phaseLabel?: string;
  onFile: (file: File) => void;
}

export default function UploadDropzone({ busy, phaseLabel, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-busy={busy}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) pick(e.dataTransfer.files); }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
        over ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:bg-muted/40",
        busy && "cursor-wait opacity-70",
      )}
    >
      <input ref={inputRef} type="file" accept=".hwp,.hwpx,.docx" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
      <div className="font-medium">{busy ? phaseLabel ?? "처리 중…" : "제안요청서 파일을 여기에 놓거나 클릭해 선택하세요"}</div>
      <div className="text-xs text-muted-foreground">hwp · hwpx · docx, 50MB 이하. 올리면 프로젝트를 등록하고 요구사항을 추출합니다.</div>
    </div>
  );
}
```

- [ ] **Step 4: 유사 프로젝트 확인창**

`frontend/src/components/rfp/ConfirmDuplicateDialog.tsx`:

```tsx
"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface DuplicateCandidate { id: string; name: string; agency: string | null; createdAt: string }

interface Props {
  open: boolean;
  candidates: DuplicateCandidate[];
  overview: { name: string; agency: string | null } | null;
  busy: boolean;
  onRegisterNew: () => void;
  onOpenExisting: (id: string) => void;
  onCancel: () => void;
}

export default function ConfirmDuplicateDialog({ open, candidates, overview, busy, onRegisterNew, onOpenExisting, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>유사한 프로젝트가 있습니다</DialogTitle>
          <DialogDescription>
            올린 문서: <span className="font-medium text-foreground">{overview?.name ?? "-"}</span>
            {overview?.agency ? ` · ${overview.agency}` : " · 발주기관을 문서에서 찾지 못했습니다"}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.agency ?? "발주기관 미상"} · {new Date(c.createdAt).toLocaleDateString("ko-KR")} 등록</div>
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenExisting(c.id)}>기존으로 이동</Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>취소</Button>
          <Button disabled={busy} onClick={onRegisterNew}>새 프로젝트로 등록</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: 프로젝트 표**

`frontend/src/components/rfp/ProjectList.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RfpProjectStatus, RfpProjectSummary } from "@/types/rfp";

export function StatusBadge({ status }: { status: RfpProjectStatus }) {
  if (status === "extracting") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />추출 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">실패</Badge>;
  return <Badge>완료</Badge>;
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

- [ ] **Step 6: 목록·업로드 화면**

`frontend/src/app/rfp/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UploadDropzone from "@/components/rfp/UploadDropzone";
import ProjectList from "@/components/rfp/ProjectList";
import ConfirmDuplicateDialog, { type DuplicateCandidate } from "@/components/rfp/ConfirmDuplicateDialog";
import { uploadAndRegister, PHASE_LABEL, type UploadPhase } from "@/lib/rfp/client-upload";
import type { RfpProjectSummary, UploadTicket } from "@/types/rfp";

interface Pending { file: File; ticket: UploadTicket; sha256: string }

export default function RfpPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<RfpProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ candidates: DuplicateCandidate[]; overview: { name: string; agency: string | null }; pending: Pending } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rfp/projects${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (res.status === 401) { setMessage({ kind: "error", text: "로그인이 필요합니다." }); return; }
      if (res.status === 403) { setMessage({ kind: "error", text: "RFP 분석은 사용자 권한이 필요합니다. 관리자에게 요청하세요." }); return; }
      const json = (await res.json()) as { projects?: RfpProjectSummary[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "목록을 불러오지 못했습니다.");
      setProjects(json.projects ?? []);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "목록을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const handleOutcome = (file: File, outcome: Awaited<ReturnType<typeof uploadAndRegister>>) => {
    const r = outcome.response;
    if ("duplicate" in r) {
      setMessage({ kind: "info", text: "이미 등록된 프로젝트입니다. 상세 화면으로 이동합니다." });
      router.push(`/rfp/${r.projectId}`);
    } else if ("needsConfirm" in r) {
      setConfirm({ candidates: r.candidates, overview: r.overview, pending: { file, ticket: outcome.ticket, sha256: outcome.sha256 } });
    } else {
      router.push(`/rfp/${r.projectId}`);
    }
  };

  const handleFile = async (file: File) => {
    setMessage(null);
    setBusy(true);
    try {
      const outcome = await uploadAndRegister(file, { onPhase: setPhase });
      handleOutcome(file, outcome);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "업로드에 실패했습니다." });
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const registerNew = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const { file, ticket, sha256 } = confirm.pending;
      const outcome = await uploadAndRegister(file, { force: true, ticket, sha256, onPhase: setPhase });
      setConfirm(null);
      handleOutcome(file, outcome);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "등록에 실패했습니다." });
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <FileSearch className="h-7 w-7 text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold">RFP 분석</h1>
          <p className="text-sm text-muted-foreground">제안요청서를 올리면 프로젝트를 등록하고 요구사항 표를 만듭니다.</p>
        </div>
      </div>

      <UploadDropzone busy={busy} phaseLabel={phase ? PHASE_LABEL[phase] : undefined} onFile={handleFile} />

      {message && (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">프로젝트 <span className="text-sm font-normal text-muted-foreground">{projects.length}건</span></h2>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="사업명·발주기관 검색" className="max-w-xs" />
      </div>
      <ProjectList projects={projects} loading={loading} />

      <ConfirmDuplicateDialog
        open={!!confirm}
        candidates={confirm?.candidates ?? []}
        overview={confirm?.overview ?? null}
        busy={busy}
        onRegisterNew={registerNew}
        onOpenExisting={(id) => { setConfirm(null); router.push(`/rfp/${id}`); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
```

- [ ] **Step 7: 실행 확인**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "src/(app/rfp|components/rfp|lib/rfp)"; npm run lint 2>&1 | tail -3
./scripts/restart-frontend.sh
```
브라우저에서 `http://localhost:3003/rfp`(user 역할로 로그인): 내비에 "RFP 분석", 홈에 카드가 보이고, 샘플 `제안요청서.hwp`를 드롭하면 "파일 확인 중 → 업로드 중 → 분석 중"을 거쳐 `/rfp/{id}`로 이동한다(상세 화면은 Task 16에서 만들므로 지금은 404가 정상). `/api/rfp/projects` GET으로 `status`가 `ready`, `requirementCount` 124인지 확인한다. 같은 파일을 다시 올리면 "이미 등록된 프로젝트" 메시지 후 이동.

- [ ] **Step 8: 커밋**

```bash
cd frontend && git add src/components/layout/Navigation.tsx src/lib/roles.ts src/app/page.tsx src/lib/rfp/client-upload.ts src/components/rfp src/app/rfp/page.tsx
git commit -m "feat(rfp): RFP 분석 대메뉴·홈 카드·목록/업로드 화면(Storage 직접 업로드, 중복·유사 확인)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 16: 상세 화면 — 개요 카드·요구사항 표·편집

**Files:**
- Create: `frontend/src/components/rfp/EditableCell.tsx`
- Create: `frontend/src/components/rfp/OverviewCard.tsx`
- Create: `frontend/src/components/rfp/RequirementsTable.tsx`
- Create: `frontend/src/app/rfp/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 14 API, `types/rfp.ts`, Task 9 `orderCategoryCodes`·`sheetNameFor`·`STANDARD_CATEGORY_ORDER`, `@tanstack/react-table` v8(`useReactTable`, `getCoreRowModel`, `getSortedRowModel`, `getFilteredRowModel`, `flexRender`, `createColumnHelper`), shadcn `Tabs`·`Dialog`·`AlertDialog`·`Textarea`·`Input`·`Select`·`Badge`·`Button`·`Card`·`Alert`
- Produces: `/rfp/[id]` 화면

- [ ] **Step 1: 셀 인라인 편집 컴포넌트**

`frontend/src/components/rfp/EditableCell.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onSave: (next: string) => Promise<void>;
  /** 접힌 상태에서 보일 줄 수(0이면 접지 않음) */
  clampLines?: number;
  placeholder?: string;
  className?: string;
}

/** 클릭 → textarea, blur 또는 ⌘/Ctrl+Enter 저장, Esc 취소. 실패하면 원래 값으로 되돌리고 오류를 표시. */
export default function EditableCell({ value, onSave, clampLines = 3, placeholder = "비어 있음", className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.setSelectionRange(draft.length, draft.length); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    const rows = Math.min(20, Math.max(2, draft.split("\n").length + 1));
    return (
      <div className={className}>
        <Textarea
          ref={ref}
          value={draft}
          rows={rows}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); }
          }}
          className="min-w-[12rem] text-sm"
        />
        <div className="mt-1 text-[11px] text-muted-foreground">{saving ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />저장 중</span> : "⌘/Ctrl+Enter 저장 · Esc 취소"}</div>
      </div>
    );
  }

  const lines = value.split("\n").length;
  const clamp = clampLines > 0 && !expanded && lines > clampLines;
  return (
    <div className={cn("group cursor-text", className)} onClick={() => setEditing(true)} title="클릭해서 편집">
      <div className={cn("whitespace-pre-wrap break-words text-sm", clamp && "line-clamp-3", !value && "text-muted-foreground/60 italic")}>{value || placeholder}</div>
      {clampLines > 0 && lines > clampLines && (
        <button type="button" className="mt-0.5 text-[11px] text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
          {expanded ? "접기" : `더보기 (${lines}줄)`}
        </button>
      )}
      {error && <div className="mt-0.5 text-[11px] text-destructive">{error}</div>}
    </div>
  );
}
```

`Textarea`가 `ref`를 받지 않으면(shadcn 구버전) `components/ui/textarea.tsx`가 `React.forwardRef`인지 확인하고, 아니면 `ref` 대신 `autoFocus`를 쓴다.

- [ ] **Step 2: 개요 카드**

`frontend/src/components/rfp/OverviewCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Download, FileText, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import { StatusBadge } from "@/components/rfp/ProjectList";
import type { RfpProjectDetail } from "@/types/rfp";

interface Props {
  project: RfpProjectDetail;
  canDelete: boolean;
  onPatched: (patch: Partial<Pick<RfpProjectDetail, "name" | "agency" | "period" | "budget" | "bidMethod">>) => void;
  onReextract: () => Promise<void>;
  onDelete: () => Promise<void>;
}

const FIELDS: { key: "name" | "agency" | "period" | "budget" | "bidMethod"; label: string }[] = [
  { key: "name", label: "사업명" }, { key: "agency", label: "발주기관" }, { key: "period", label: "사업기간" }, { key: "budget", label: "설계금액" }, { key: "bidMethod", label: "입찰 및 계약방법" },
];

export default function OverviewCard({ project, canDelete, onPatched, onReextract, onDelete }: Props) {
  const [busy, setBusy] = useState<"reextract" | "delete" | "file" | null>(null);

  const save = (key: (typeof FIELDS)[number]["key"]) => async (next: string) => {
    const res = await fetch(`/api/rfp/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: next }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
    onPatched({ [key]: next || null } as Partial<RfpProjectDetail>);
  };

  const openFile = async () => {
    setBusy("file");
    try {
      const res = await fetch(`/api/rfp/projects/${project.id}/file`);
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "다운로드 URL을 받지 못했습니다.");
      window.open(json.url, "_blank", "noopener");
    } catch (e) {
      alert(e instanceof Error ? e.message : "다운로드 실패");
    } finally {
      setBusy(null);
    }
  };

  const file = project.files[0];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            <span className="break-keep">{project.name}</span>
            <StatusBadge status={project.status} />
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            요구사항 {project.requirementCount}건
            {project.extractionMethod && ` · ${project.extractionMethod === "standard" ? "표준 양식(규칙 추출)" : "LLM 추출"}`}
            {" · "}등록 {project.createdBy.name ?? "—"} · {new Date(project.createdAt).toLocaleString("ko-KR")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {file && <Button variant="outline" size="sm" disabled={busy === "file"} onClick={openFile}><FileText className="mr-1 h-4 w-4" />{file.originalFilename}</Button>}
          <Button size="sm" asChild disabled={project.status !== "ready"}>
            <a href={`/api/rfp/projects/${project.id}/xlsx`}><Download className="mr-1 h-4 w-4" />xlsx 다운로드</a>
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null || project.status === "extracting"} onClick={async () => { setBusy("reextract"); try { await onReextract(); } finally { setBusy(null); } }}>
            <RefreshCw className="mr-1 h-4 w-4" />재추출
          </Button>
          {canDelete && (
            <AlertDialog>
              <Button variant="destructive" size="sm" asChild disabled={busy !== null}>
                <AlertDialogTrigger><Trash2 className="mr-1 h-4 w-4" />삭제</AlertDialogTrigger>
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>프로젝트를 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>원본 파일과 요구사항 {project.requirementCount}건이 함께 지워지며 되돌릴 수 없습니다.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction onClick={async () => { setBusy("delete"); try { await onDelete(); } finally { setBusy(null); } }}>삭제</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-1"><EditableCell value={project[f.key] ?? ""} onSave={save(f.key)} clampLines={0} placeholder="클릭해서 입력" /></dd>
            </div>
          ))}
        </dl>
        {project.status === "failed" && project.error && (
          <Alert variant="destructive"><AlertDescription>추출 실패: {project.error} — 개요를 확인하고 "재추출"을 눌러 다시 시도하세요.</AlertDescription></Alert>
        )}
        {project.warnings.length > 0 && (
          <Alert><AlertDescription><ul className="list-disc pl-4">{project.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></AlertDescription></Alert>
        )}
      </CardContent>
    </Card>
  );
}
```

`Button asChild disabled`가 `<a>`에 적용되지 않으면 `pointer-events-none opacity-50` 클래스로 대신한다.

- [ ] **Step 3: 요구사항 표**

`frontend/src/components/rfp/RequirementsTable.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import { orderCategoryCodes, sheetNameFor } from "@/lib/rfp/requirements";
import type { RfpRequirement } from "@/types/rfp";

interface Props {
  projectId: string;
  requirements: RfpRequirement[];
  onChange: (next: RfpRequirement[]) => void;
}

type EditableField = "categoryName" | "reqId" | "title" | "definition" | "details" | "deliverables" | "related" | "solution";

async function patchRequirement(id: string, patch: Partial<Record<EditableField, string>>): Promise<RfpRequirement> {
  const res = await fetch(`/api/rfp/requirements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const json = (await res.json().catch(() => ({}))) as RfpRequirement & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
  return json;
}

export default function RequirementsTable({ projectId, requirements, onChange }: Props) {
  const codes = useMemo(() => orderCategoryCodes(requirements.map((r) => r.categoryCode)), [requirements]);
  const sheetIndex = useMemo(() => new Map(codes.map((c, i) => [c, i + 2])), [codes]);
  const categoryNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requirements) if (!m.has(r.categoryCode)) m.set(r.categoryCode, r.categoryName);
    return m;
  }, [requirements]);
  const [tab, setTab] = useState("all");
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<RfpRequirement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = (row: RfpRequirement, field: EditableField) => async (next: string) => {
    const updated = await patchRequirement(row.id, { [field]: next });
    onChange(requirements.map((r) => (r.id === row.id ? updated : r)));
  };

  const removeRow = async (row: RfpRequirement) => {
    const res = await fetch(`/api/rfp/requirements/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    onChange(requirements.filter((r) => r.id !== row.id));
  };

  const col = createColumnHelper<RfpRequirement>();
  const editable = (field: EditableField, header: string, opts: { clamp?: number; width?: string } = {}) =>
    col.accessor(field, {
      header,
      cell: (ctx) => <EditableCell value={ctx.getValue()} onSave={save(ctx.row.original, field)} clampLines={opts.clamp ?? 3} />,
      meta: { width: opts.width },
    });
  const actions = col.display({
    id: "actions",
    header: "",
    cell: (ctx) => <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="행 삭제" onClick={() => setDeleting(ctx.row.original)}><Trash2 className="h-4 w-4" /></Button>,
    meta: { width: "3rem" },
  });
  const seq = col.display({ id: "seq", header: "연번", cell: (ctx) => <span className="tabular-nums text-muted-foreground">{ctx.row.index + 1}</span>, meta: { width: "3.5rem" } });

  const allColumns = useMemo(() => [
    seq,
    editable("categoryName", "요구사항 구분", { clamp: 0, width: "11rem" }),
    editable("reqId", "요구사항 ID", { clamp: 0, width: "8rem" }),
    editable("title", "요구사항 명칭", { clamp: 0, width: "20rem" }),
    col.display({ id: "sheet", header: "상세 시트 위치", cell: (ctx) => <span className="text-muted-foreground">{sheetNameFor(ctx.row.original.categoryCode, sheetIndex.get(ctx.row.original.categoryCode) ?? 0)}</span>, meta: { width: "8rem" } }),
    editable("solution", "당사 솔루션", { clamp: 2, width: "14rem" }),
    actions,
  ], [sheetIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const detailColumns = useMemo(() => [
    seq,
    editable("reqId", "요구사항 ID", { clamp: 0, width: "8rem" }),
    editable("title", "요구사항명", { clamp: 0, width: "14rem" }),
    editable("definition", "정의", { clamp: 3, width: "14rem" }),
    editable("details", "세부 내용", { clamp: 3, width: "34rem" }),
    editable("deliverables", "산출정보", { clamp: 3, width: "10rem" }),
    editable("related", "관련요구사항", { clamp: 3, width: "14rem" }),
    actions,
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => (tab === "all" ? requirements : requirements.filter((r) => r.categoryCode === tab)), [requirements, tab]);
  const table = useReactTable({
    data,
    columns: tab === "all" ? allColumns : detailColumns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _id, value: string) => {
      const q = value.toLowerCase();
      const r = row.original;
      return [r.reqId, r.title, r.categoryName, r.definition, r.details, r.deliverables, r.related, r.solution].some((s) => s.toLowerCase().includes(q));
    },
  });

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
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ID·명칭·내용 검색" className="h-8 w-56" />
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
                      <th key={h.id} style={{ width: (h.column.columnDef.meta as { width?: string } | undefined)?.width }} className="px-2 py-2 align-middle">
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
                  <tr key={row.id} className="border-t align-top hover:bg-muted/20" title={row.original.updatedBy ? `수정 ${new Date(row.original.updatedAt).toLocaleString("ko-KR")}` : undefined}>
                    {row.getVisibleCells().map((cell) => <td key={cell.id} className="px-2 py-1.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                  </tr>
                ))}
                {table.getRowModel().rows.length === 0 && <tr><td colSpan={99} className="px-3 py-8 text-center text-muted-foreground">표시할 요구사항이 없습니다.</td></tr>}
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
            <AlertDialogDescription>{deleting?.title}</AlertDialogDescription>
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

function AddRowDialog({ open, onClose, projectId, codes, categoryNames, defaultCode, onCreated }: {
  open: boolean; onClose: () => void; projectId: string; codes: string[]; categoryNames: Map<string, string>; defaultCode: string; onCreated: (row: RfpRequirement) => void;
}) {
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState(categoryNames.get(defaultCode) ?? "");
  const [reqId, setReqId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/requirements`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryCode: code.trim().toUpperCase(), categoryName: name.trim() || code, reqId: reqId.trim() || undefined, title: title.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as RfpRequirement & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "추가에 실패했습니다.");
      onCreated(json);
      setReqId(""); setTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>요구사항 행 추가</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>구분 코드</Label>
            <Input list="rfp-codes" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); const n = categoryNames.get(e.target.value.toUpperCase()); if (n) setName(n); }} placeholder="SER" />
            <datalist id="rfp-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="grid gap-1"><Label>구분명</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="서비스 요구사항" /></div>
          <div className="grid gap-1"><Label>요구사항 ID <span className="text-xs text-muted-foreground">(비우면 다음 번호 자동)</span></Label><Input value={reqId} onChange={(e) => setReqId(e.target.value)} placeholder={`${code || "SER"}-0xx`} /></div>
          <div className="grid gap-1"><Label>요구사항 명칭</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>닫기</Button>
          <Button disabled={busy || !code.trim()} onClick={submit}>추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

TanStack `meta`에 `width`를 쓰려면 모듈 보강이 필요하다. `frontend/src/types/tanstack-table.d.ts`:
```ts
import "@tanstack/react-table";
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    width?: string;
  }
}
```

- [ ] **Step 4: 상세 페이지(폴링 포함)**

`frontend/src/app/rfp/[id]/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import OverviewCard from "@/components/rfp/OverviewCard";
import RequirementsTable from "@/components/rfp/RequirementsTable";
import { useUserRole } from "@/hooks/useUserRole";
import type { RfpProjectDetail, StatusResponse } from "@/types/rfp";

const POLL_MS = 3000;
const STUCK_MS = 3 * 60 * 1000;

export default function RfpProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isAdmin } = useUserRole();
  const [project, setProject] = useState<RfpProjectDetail | null>(null);
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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch("/api/users/role").then((r) => r.json()).then((j: { userId?: string }) => setMe(j.userId ?? null)).catch(() => undefined);
  }, []);

  // 추출 중이면 상태만 폴링, 끝나면 전체 재조회
  useEffect(() => {
    if (!project || project.status !== "extracting") return;
    const startedAt = new Date(project.updatedAt).getTime();
    const t = setInterval(async () => {
      const res = await fetch(`/api/rfp/projects/${id}?fields=status`);
      if (!res.ok) return;
      const s = (await res.json()) as StatusResponse;
      if (s.status !== "extracting") { await load(); return; }
      if (Date.now() - startedAt > STUCK_MS && !stuckRef.current) {
        stuckRef.current = true;
        setNotice("추출이 3분 넘게 진행 중입니다. 서버 시간 제한(5분)에 걸리면 실패로 표시되며, 그때 '재추출'로 다시 시도할 수 있습니다.");
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [project, id, load]);

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

  const remove = async () => {
    const res = await fetch(`/api/rfp/projects/${id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    router.push("/rfp");
  };

  if (error) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        <Button variant="outline" asChild><Link href="/rfp"><ArrowLeft className="mr-1 h-4 w-4" />목록으로</Link></Button>
      </div>
    );
  }
  if (!project) return <div className="p-10 text-center text-sm text-muted-foreground">불러오는 중…</div>;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
      <Link href="/rfp" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />RFP 분석 목록</Link>
      <OverviewCard
        project={project}
        canDelete={isAdmin || (!!me && me === project.createdBy.id)}
        onPatched={(patch) => setProject((p) => (p ? { ...p, ...patch } : p))}
        onReextract={reextract}
        onDelete={remove}
      />
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      {project.status === "extracting" ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">요구사항을 추출하고 있습니다… 표준 양식은 몇 초, LLM 추출은 수 분 걸릴 수 있습니다.</div>
      ) : (
        <RequirementsTable projectId={project.id} requirements={project.requirements} onChange={(next) => setProject((p) => (p ? { ...p, requirements: next, requirementCount: next.length } : p))} />
      )}
    </div>
  );
}
```

`/api/users/role`은 현재 `{ role }`만 내려준다. 삭제 버튼 노출(등록자 본인 판정)에 쓰도록 `frontend/src/app/api/users/role/route.ts`의 마지막 줄을 아래로 바꾼다(기존 `role` 필드는 유지, 비로그인은 `userId: null`).

```ts
  return NextResponse.json({ role: data?.role ?? "user", userId: user.id });
```
(비로그인 분기 `return NextResponse.json({ role: "guest" })`도 `{ role: "guest", userId: null }`로 바꾼다.)

- [ ] **Step 5: 실행 확인**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "src/(app/rfp|components/rfp|lib/rfp|types/)"; npm run lint 2>&1 | tail -3
./scripts/restart-frontend.sh
```
브라우저 `http://localhost:3003/rfp/{샘플 프로젝트 id}`:
- 개요 5항목이 보이고 사업명 셀을 클릭해 고치면 새로고침 후에도 유지된다.
- 탭 "전체 목록"에 124행, SER 탭 4행, INR-DTL 탭 4행. 세부 내용 셀은 3줄 접힘 + "더보기".
- 셀 편집 → blur 저장 → 새로고침 후 유지. 잘못된 ID(`abc`)로 바꾸면 오류 표시 후 원래 값으로 복귀.
- "행 추가"(SER, ID 비움) → `SER-005` 생성. 행 삭제 → 건수 감소.
- "재추출" → 편집한 행이 있으면 확인창, 확인 후 추출 중 → 완료(편집 사라짐).
- "xlsx 다운로드" → 파일명 `(한국석유공사) 생성형 AI 플랫폼 구축 및 AX 개발 사업_요구사항 검토_YYYYMMDD.xlsx`, 시트 19개.
- 원본 파일 버튼 → 새 탭에서 hwp 다운로드.

- [ ] **Step 6: 커밋**

```bash
cd frontend && git add src/components/rfp src/app/rfp src/types/tanstack-table.d.ts src/app/api/users/role/route.ts
git commit -m "feat(rfp): 프로젝트 상세 화면 — 개요 인라인 편집·TanStack 요구사항 표(탭·검색·셀 편집·행 추가/삭제)·재추출·xlsx

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 17: 런북·CLAUDE.md·최종 검증

**Files:**
- Create: `docs/rfp-analyzer.md`
- Modify: `CLAUDE.md` (App Router Pages, API Routes, Supabase Tables, Directory Layout, Environment Variables)

- [ ] **Step 1: 런북 작성**

`docs/rfp-analyzer.md`:

```markdown
# RFP 분석 런북

설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md` · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md`

## 구성
- 화면 `/rfp`(목록·업로드), `/rfp/[id]`(개요·요구사항 표). user 역할 이상.
- API `/api/rfp/*`. 파일은 브라우저가 Storage 버킷 `rfp`에 서명 URL로 직접 올린다(Vercel 4.5MB 제한 회피).
- 추출은 `after()`로 응답 뒤 실행(`maxDuration 300`). 표준 양식(첫 셀 "요구사항 분류"인 7행 표)은 규칙, 비표준만 Claude.
- 테이블 `rfp_projects`·`rfp_files`·`rfp_requirements` — SQL `docs/sql/2026-09-03-rfp-analyzer.sql`.

## 환경 변수
| 이름 | 용도 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 기존. DB·Storage 서버 접근 |
| `ANTHROPIC_API_KEY` | 비표준 RFP LLM 폴백. 없으면 표준 양식만 동작하고 비표준은 failed |
| `RFP_LLM_MODEL` | 기본 `claude-opus-5` |

## 최초 설치
1. SQL 실행(Supabase SQL Editor 또는 Management API) → 테이블 3개 + 버킷 `rfp`(private, 50MB).
2. Vercel env에 `ANTHROPIC_API_KEY` 추가(선택).
3. 배포: `git push` 후 `vercel --prod`(자동 배포 아님).

## 운영 메모
- 지원 형식: hwp(5.x, 암호화·배포용 제외), hwpx, docx. 스캔 이미지 문서는 요구사항이 나오지 않는다.
- 중복 판단: 파일 sha256 또는 정규화한 사업명+발주기관 일치. 유사하면 화면에서 사용자 확인.
- 유사 확인창에서 "취소"하면 Storage `uploads/…`에 고아 파일이 남는다. 주기적으로 `rfp_files.storage_path`에 없는 객체를 지운다(수동).
- 추출이 3분 넘게 `extracting`이면 화면이 안내한다. 5분(Vercel 제한) 뒤에도 그대로면 재추출.
- 요구사항은 프로젝트당 수백 건이라 Supabase 1000행 상한에 걸리지 않는다. 넘길 가능성이 생기면 `selectAll` 사용.

## 수동 회귀 체크리스트
1. user 계정으로 `/rfp` 진입, 내비·홈 카드 노출.
2. 샘플 `제안요청서.hwp` 업로드 → 상세 이동 → 완료, 124건, 경고 없음, 추출 방식 "표준 양식".
3. 같은 파일 재업로드 → "이미 등록된 프로젝트" → 상세 이동.
4. 사업명만 살짝 바꾼 hwpx/docx(있으면) 업로드 → 유사 확인창 → 새로 등록 / 기존 이동.
5. 개요 셀·요구사항 셀 편집 → 새로고침 후 유지. 잘못된 ID는 오류 후 복귀.
6. 행 추가(자동 번호)·삭제 → 건수 반영.
7. 재추출(편집 있음) → 확인창 → 완료 후 편집 사라짐.
8. xlsx 다운로드 → 시트 `0.개요, 1.요구사항_목록, 2.SER … 18.COR`.
9. 등록자 아닌 user로 삭제 버튼이 안 보이고, admin은 보임.
10. `.doc`·`.pdf`·60MB 파일은 업로드 단계에서 거부 메시지.

## 2·3단계 접점
- 2단계: `rfp_requirements.solution` → 구조화 테이블 + xlsx 목록 열 확장.
- 3단계: `GET /api/rfp/projects/[id]/xlsx` 버퍼를 Graph 드라이브 업로드로 전달.
```

- [ ] **Step 2: CLAUDE.md 갱신**

`CLAUDE.md`의 해당 절에 한 줄씩 추가한다(기존 서술 스타일 유지).
- App Router Pages: `- \`/rfp\`, \`/rfp/[id]\` — RFP 분석(user): 제안요청서(hwp·hwpx·docx) 업로드 → 프로젝트 등록(중복 판단) → 요구사항 표(TanStack Table 셀 편집·행 추가/삭제) → xlsx 다운로드. 런북 \`docs/rfp-analyzer.md\``
- API Routes: `- \`/api/rfp/{uploads,projects,projects/[id],projects/[id]/{reextract,xlsx,file,requirements},requirements/[requirementId]}\` — RFP 분석(user 이상, \`lib/rfp/require-user.ts\`). 파일은 Storage 버킷 \`rfp\`에 브라우저 직접 업로드, 추출은 \`after()\`(maxDuration 300)`
- Supabase Tables 절 추가: `### Supabase Tables (RFP 분석)` + `- \`rfp_projects\`(사업 개요·상태·정규화 키), \`rfp_files\`(원본, sha256 유니크), \`rfp_requirements\`(구분 코드·ID·7필드·solution) — SQL \`docs/sql/2026-09-03-rfp-analyzer.sql\``
- Key Patterns 절 추가: `**RFP 분석**: \`lib/rfp/\` — 파서 3종(\`parse-hwp.ts\` cfb+zlib 레코드 파서, \`parse-hwpx.ts\`, \`parse-docx.ts\`) → 공통 \`DocumentModel\` → \`overview.ts\`(개요·정규화) → \`dedupe.ts\` → \`extract-standard.ts\`(표준 7행 표 규칙) / \`extract-llm.ts\`(Claude 폴백) → \`xlsx.ts\`(exceljs). 라우트는 \`pipeline.ts\`의 \`registerProject\`·\`runExtraction\`만 호출.`
- Environment Variables: `- \`ANTHROPIC_API_KEY\`, \`RFP_LLM_MODEL\`(기본 claude-opus-5) — RFP 비표준 문서 LLM 폴백`
- Directory Layout components: `rfp/`(업로드·개요·요구사항 표), lib: `rfp/`, types: `rfp.ts`

- [ ] **Step 3: 전체 테스트·린트·빌드**

```bash
cd frontend && npm test 2>&1 | tail -8 && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -15
```
Expected: 테스트 전부 PASS(rfp 테스트 9개 파일 포함), lint 오류 0, build 성공(`/rfp`, `/rfp/[id]`, `/api/rfp/*` 라우트 출력).

- [ ] **Step 4: 수동 회귀 체크리스트 실행**

`docs/rfp-analyzer.md`의 체크리스트 10항목을 로컬(`./scripts/restart-frontend.sh`)에서 수행하고 결과를 커밋 메시지 본문에 남긴다. 실패 항목은 고친 뒤 다시 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add docs/rfp-analyzer.md CLAUDE.md
git commit -m "docs(rfp): RFP 분석 런북·CLAUDE.md 갱신 — 수동 회귀 10항목 확인

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

- [ ] **Step 6: 브랜치 마무리**

`superpowers:finishing-a-development-branch` 스킬로 정리한다. 이 저장소 흐름은 **커밋 → PR → main 머지 → `git push` 후 `vercel --prod` 수동 배포**이고, 배포 전 Vercel env에 `ANTHROPIC_API_KEY`(선택)를 넣고 프로덕션 Supabase에 SQL·버킷이 적용됐는지 확인한다.
