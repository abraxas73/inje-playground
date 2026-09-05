# RFP 분석 3단계(SharePoint 등록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 Microsoft 계정을 한 번 연결하고, 프로젝트마다 SharePoint 폴더 링크를 지정하면, 1·2단계가 만드는 요구사항 검토 xlsx를 그 폴더에 올리고(같은 날은 덮어쓰기) 이력을 남기며 Teams 채널에 링크를 알린다.

**Architecture:** 1·2단계와 같은 구조 — 순수 로직은 `frontend/src/lib/ms/`(AES-GCM 암호화·HMAC state, OAuth 토큰 교환/갱신, 연결 저장·access 토큰 캐시, Graph shares 해석·드라이브 업로드, 리디렉션 오리진 검사)와 `frontend/src/lib/rfp/sharepoint.ts`(공용 워크북 빌더, 업로드 절차, 알림 문구)에 두고 vitest로 검증한다. Azure·Graph 호출은 `fetch` 주입으로 모킹한다. 라우트는 얇게 `/api/ms/{connect,callback,connection}`, `/api/rfp/projects/[id]/sharepoint{,/folder,/upload}`. 데이터는 `ms_connections`(사용자별 refresh 토큰 암호문), `rfp_projects.sharepoint_folder`(jsonb), `rfp_sharepoint_uploads`(이력).

**Tech Stack:** Next.js 16.1.6 / React 19 / TypeScript strict / Tailwind 4 / shadcn(ui 폴더 기존 컴포넌트) / Supabase(service role) / Node `crypto`(AES-256-GCM, HMAC-SHA256) / Microsoft Identity Platform v2.0 + Microsoft Graph v1.0 / `exceljs`(기존) / vitest

**Spec:** `docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md`

## Global Constraints

- 모든 명령은 `frontend/` 안에서 실행한다(`cd frontend`). `node_modules`가 없으면 `npm install`을 먼저 한다.
- 화면 문구·커밋 메시지·주석은 한국어. 커밋 메시지 형식은 `feat(rfp): …`, `feat(ms): …`, `test(ms): …`, `docs(rfp): …` 이고 마지막에 아래 두 줄을 붙인다.
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv
  ```
- `git stash`를 쓰지 않는다(공유 stash). 작업을 잠시 치울 일이 있으면 WIP 커밋.
- 테스트는 `frontend/src/lib/__tests__/ms-*.test.ts`·`rfp-*.test.ts`, 실행은 `npm test -- ms-…`(vitest run). Node `crypto`·`fetch`/`Response`를 쓰는 테스트는 첫 줄에 `// @vitest-environment node`.
- **토큰(access·refresh)·클라이언트 시크릿·`Authorization` 헤더 값은 어떤 로그·응답·클라이언트 코드에도 쓰지 않는다.** 오류 로그에는 오류 코드·HTTP 상태·`request-id`만 남긴다. Azure `error_description`은 서버 로그에만 남기고 클라이언트에는 코드 기반 한국어 문구(`oauthErrorMessage`)만 준다.
- refresh 토큰은 `MS_TOKEN_ENC_KEY`(64자 hex = 32바이트)로 AES-256-GCM 암호화해 `v1.{iv}.{tag}.{cipher}`(각 base64url, iv 12B, tag 16B) 형식으로 저장한다. state는 HMAC-SHA256 서명(`base64url(json).base64url(hmac)`) + 10분 만기 + 세션 사용자 일치.
- Microsoft 위임 스코프는 정확히 `offline_access User.Read Files.ReadWrite.All Sites.Read.All` 네 개(`MS_SCOPES`). 앱 권한을 쓰지 않는다.
- Entra 앱 설정은 기존 것 재사용: settings `teams_tenant_id`·`teams_graph_client_id`, env `TEAMS_GRAPH_CLIENT_SECRET`. 누락은 500 응답 문구에 항목명(`Microsoft 연동 설정이 누락되었습니다: …`).
- 리디렉션 URI는 `${origin}/api/ms/callback`이고 `origin`은 env `MS_ALLOWED_ORIGINS`(쉼표 구분, 기본 `https://inje-playground.vercel.app,http://localhost:3003`)에 있는 값만 허용(아니면 400 "허용되지 않은 오리진입니다."). `returnTo`는 `/`로 시작하고 `//`·`://`·`\`를 포함하지 않는 같은 오리진 경로만, 기본 `/settings`.
- 파일명 날짜는 KST(`Asia/Seoul`) 기준 `YYYYMMDD`. xlsx 다운로드와 SharePoint 업로드는 **같은 함수**(`buildProjectWorkbook`)로 같은 바이트·같은 파일명을 만든다. 업로드는 `@microsoft.graph.conflictBehavior=replace`(같은 날 덮어쓰기). 4MiB 미만은 단순 PUT, 이상은 업로드 세션 + 10MiB 청크.
- Graph 429·503은 `Retry-After`(없으면 2초, 최대 5초) 뒤 1회 재시도. 오류는 `GraphError { status, code, message, requestId }`로 정규화.
- 인증: 사용자 라우트는 모두 `requireUser()`(`lib/rfp/require-user.ts`, user 이상). DB 쓰기는 `auth.admin`(service role). settings·Notifier는 세션 클라이언트(`createServerSupabase()`)로 읽는다(기존 `/api/teams/members`·`/api/guide/chat` 관례). RLS는 켜되 `rfp_sharepoint_uploads`는 관리자 읽기 정책만, **`ms_connections`는 정책 없음**(service role만).
- 응답 키는 camelCase. 오류 응답은 `{ error: string, code?: "no_folder" | "not_connected" | "reconnect" }`.
- SQL 파일은 멱등(`if not exists`, `drop … if exists` 후 생성). 운영 DB 적용은 컨트롤러가 Management API로 한다(구현자는 파일만 작성). **Task 1 완료 직후 컨트롤러가 SQL을 적용해야 이후 태스크의 수동 확인이 가능하다.**
- 스펙과 다른 결정을 내려야 하면 멈추고 컨트롤러에게 묻는다.

---

## 파일 구조

| 경로 | 책임 |
|---|---|
| `docs/sql/2026-09-05-rfp-sharepoint.sql` | `ms_connections`, `rfp_projects.sharepoint_folder`, `rfp_sharepoint_uploads`, 트리거, RLS |
| `frontend/src/types/ms.ts` | `MsConnectionStatus` |
| `frontend/src/types/rfp.ts` | `SharepointFolder`, `RfpSharepointUpload`, `SharepointResponse`, `SharepointErrorCode`, `UploadResponse`, `RfpProjectDetail.sharepoint` |
| `frontend/src/lib/rfp/mappers.ts` | `PROJECT_COLUMNS`에 `sharepoint_folder`, `parseSharepointFolder`, `SHAREPOINT_UPLOAD_COLUMNS`·`SharepointUploadDbRow`·`mapSharepointUpload`, `mapProjectDetail` 6번째 인자 |
| `frontend/src/lib/ms/crypto.ts` | `parseEncKey`, `encryptSecret`/`decryptSecret`, `signState`/`verifyState`, `newNonce`, `STATE_TTL_S` |
| `frontend/src/lib/ms/oauth.ts` | `MS_SCOPES`, `MsAppConfig`, `OAuthError`, `oauthErrorMessage`, `buildAuthorizeUrl`, `exchangeCode`, `refreshAccessToken`, `fetchMe` |
| `frontend/src/lib/ms/config.ts` | settings+env → `MsRuntimeConfig {app, encKey}`, 누락 항목명, `loadMsConfig(supabase)` |
| `frontend/src/lib/ms/origin.ts` | `resolveRedirectOrigin`, `sanitizeReturnTo`, `appendQuery` |
| `frontend/src/lib/ms/connections.ts` | `getConnectionStatus`, `saveConnection`, `deleteConnection`, `getAccessTokenForUser`(5분 캐시), `NotConnectedError`, `ReconnectRequiredError` |
| `frontend/src/lib/ms/graph-drive.ts` | `encodeShareUrl`, `resolveFolder`, `uploadFile`(small/large), `fetchWithRetry`, `GraphError`, `FolderResolveError` |
| `frontend/src/lib/rfp/xlsx.ts` | `kstYmd`, `xlsxFileName` KST 날짜 |
| `frontend/src/lib/rfp/sharepoint.ts` | `buildProjectWorkbook`(xlsx 라우트와 공용), `buildUploadNotice`, `mapGraphUploadError`, `uploadProjectXlsx`, `loadUploads`, `SharepointFlowError` |
| `frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts` | `buildProjectWorkbook` 호출로 축소 |
| `frontend/src/app/api/ms/connect/route.ts` | GET → Azure authorize 302 |
| `frontend/src/app/api/ms/callback/route.ts` | GET → state 검증·코드 교환·저장 → returnTo 302 |
| `frontend/src/app/api/ms/connection/route.ts` | GET 상태, DELETE 해제 |
| `frontend/src/app/api/rfp/projects/[id]/sharepoint/route.ts` | GET 폴더·마지막 업로드·이력 20 |
| `frontend/src/app/api/rfp/projects/[id]/sharepoint/folder/route.ts` | PUT 링크 해석·저장, DELETE 해제 |
| `frontend/src/app/api/rfp/projects/[id]/sharepoint/upload/route.ts` | POST 업로드 |
| `frontend/src/app/api/rfp/projects/[id]/route.ts` | 상세 응답에 `sharepoint: {folder, lastUpload}` |
| `frontend/src/hooks/useMsCallbackQuery.ts` | `?ms_connected=1`·`?ms_error=` 읽고 쿼리 제거 |
| `frontend/src/components/settings/MicrosoftAccountCard.tsx` | `/settings` Microsoft 계정 카드, `connectUrl()` |
| `frontend/src/app/settings/page.tsx` | 카드 삽입 |
| `frontend/src/components/rfp/SharePointSection.tsx` | 상세 SharePoint 섹션(폴더·업로드·이력) |
| `frontend/src/app/rfp/[id]/page.tsx` | 섹션 삽입 |
| `docs/rfp-analyzer.md`, `docs/teams-integration.md`, `CLAUDE.md` | 런북·위임 권한 절·프로젝트 지침 |

---

### Task 1: SQL 마이그레이션 + 타입 + 매퍼

**Files:**
- Create: `docs/sql/2026-09-05-rfp-sharepoint.sql`
- Create: `frontend/src/types/ms.ts`
- Modify: `frontend/src/types/rfp.ts`
- Modify: `frontend/src/lib/rfp/mappers.ts`
- Test: `frontend/src/lib/__tests__/rfp-sharepoint-mappers.test.ts`

**Interfaces:**
- Produces: `MsConnectionStatus`(types/ms); `SharepointFolder`, `RfpSharepointUpload`, `SharepointResponse`, `SharepointErrorCode`, `UploadResponse`, `RfpProjectDetail.sharepoint`(types/rfp); `PROJECT_COLUMNS`(+`sharepoint_folder`), `ProjectDbRow.sharepoint_folder: unknown`, `parseSharepointFolder(v: unknown): SharepointFolder | null`, `SHAREPOINT_UPLOAD_COLUMNS`, `SharepointUploadDbRow`, `mapSharepointUpload(row, uploaderName): RfpSharepointUpload`, `mapProjectDetail(row, creatorName, files, requirements, mappings, lastUpload: RfpSharepointUpload | null = null)`(mappers).
- 기존 호출자(`app/api/rfp/projects/[id]/route.ts`의 `mapProjectDetail(row, creatorName, files, requirements, mappings)`)는 6번째 인자 기본값 덕에 그대로 컴파일된다. Task 9에서 실제 `lastUpload`를 넘긴다.

- [ ] **Step 1: SQL 파일 작성**

```sql
-- RFP 분석 3단계 — SharePoint 등록. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md

-- 사용자별 Microsoft 계정 연결(refresh 토큰은 AES-256-GCM 암호문 v1.iv.tag.cipher). 사용자당 1행.
create table if not exists public.ms_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_upn text,
  account_name text,
  refresh_token_enc text not null,
  scopes text not null,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
drop trigger if exists ms_connections_set_updated_at on public.ms_connections;
create trigger ms_connections_set_updated_at before update on public.ms_connections
  for each row execute function public.rfp_set_updated_at();

-- 프로젝트별 업로드 대상 폴더 {url, driveId, itemId, name, webUrl, setBy, setAt}
alter table public.rfp_projects add column if not exists sharepoint_folder jsonb;

-- 업로드 이력(매 업로드 1행; 같은 날 덮어쓰기여도 남는다)
create table if not exists public.rfp_sharepoint_uploads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  drive_id text not null,
  item_id text not null,
  file_name text not null,
  web_url text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rfp_sharepoint_uploads_project_idx on public.rfp_sharepoint_uploads (project_id, created_at desc);

-- RLS: ms_connections는 토큰 컬럼 보호를 위해 정책 없이 켠다(service role만 접근).
alter table public.ms_connections enable row level security;
drop policy if exists ms_connections_admin_read on public.ms_connections;

-- rfp_sharepoint_uploads는 1·2단계와 같이 관리자 세션 읽기만 진단용으로 허용.
alter table public.rfp_sharepoint_uploads enable row level security;
drop policy if exists rfp_sharepoint_uploads_admin_read on public.rfp_sharepoint_uploads;
create policy rfp_sharepoint_uploads_admin_read on public.rfp_sharepoint_uploads for select to authenticated
  using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'));
```

- [ ] **Step 2: `frontend/src/types/ms.ts` 작성**

```ts
/** GET /api/ms/connection — 토큰은 절대 포함하지 않는다 */
export type MsConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      accountUpn: string | null;
      accountName: string | null;
      connectedAt: string;
      lastUsedAt: string | null;
      /** refresh 실패 코드(invalid_grant 등)·"decrypt". 있으면 화면은 "다시 연결" 안내 */
      lastError: string | null;
      scopes: string[];
    };
```

- [ ] **Step 3: `frontend/src/types/rfp.ts` 확장**

`RfpProjectDetail` 인터페이스에 필드를 추가하고, 파일 끝에 3단계 타입을 붙인다.

```ts
// RfpProjectDetail 안, `requirements: RfpRequirement[];` 다음 줄에 추가:
  /** 3단계 — 상세 초기 표시용. 이력 전체는 GET …/sharepoint */
  sharepoint: { folder: SharepointFolder | null; lastUpload: RfpSharepointUpload | null };
```

```ts
// 파일 끝에 추가
/** 3단계 — rfp_projects.sharepoint_folder(jsonb) */
export interface SharepointFolder {
  url: string;
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
  setBy: string | null;
  setAt: string;
}

export interface RfpSharepointUpload {
  id: string;
  fileName: string;
  webUrl: string;
  sizeBytes: number;
  uploadedBy: { id: string | null; name: string | null };
  createdAt: string;
}

/** GET /api/rfp/projects/[id]/sharepoint */
export interface SharepointResponse {
  folder: SharepointFolder | null;
  lastUpload: RfpSharepointUpload | null;
  uploads: RfpSharepointUpload[];
}

/** folder PUT·upload POST 오류 응답의 code — 화면이 버튼(연결/재연결/폴더 지정)을 고르는 기준 */
export type SharepointErrorCode = "no_folder" | "not_connected" | "reconnect";

/** POST /api/rfp/projects/[id]/sharepoint/upload */
export interface UploadResponse {
  upload: RfpSharepointUpload;
  /** Teams 채널 알림 전송 여부. false이고 notifyError가 없으면 웹후크 미설정 */
  notified: boolean;
  notifyError?: string;
}
```

- [ ] **Step 4: 실패하는 테스트 작성 — `frontend/src/lib/__tests__/rfp-sharepoint-mappers.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseSharepointFolder, mapSharepointUpload, PROJECT_COLUMNS, type SharepointUploadDbRow } from "@/lib/rfp/mappers";

const folder = { url: "https://x.sharepoint.com/sites/A/Shared%20Documents/RFP", driveId: "b!drive", itemId: "01ITEM", name: "RFP", webUrl: "https://x.sharepoint.com/sites/A/Shared%20Documents/RFP", setBy: "u-1", setAt: "2026-09-05T01:00:00.000Z" };

describe("parseSharepointFolder", () => {
  it("필수 문자열 필드가 모두 있으면 그대로, setBy는 null 허용", () => {
    expect(parseSharepointFolder(folder)).toEqual(folder);
    expect(parseSharepointFolder({ ...folder, setBy: null })).toEqual({ ...folder, setBy: null });
  });
  it("null·문자열·필드 누락·타입 불일치는 null", () => {
    expect(parseSharepointFolder(null)).toBeNull();
    expect(parseSharepointFolder("{}")).toBeNull();
    const { itemId: _omit, ...missing } = folder;
    expect(parseSharepointFolder(missing)).toBeNull();
    expect(parseSharepointFolder({ ...folder, driveId: 3 })).toBeNull();
  });
});

describe("mapSharepointUpload", () => {
  it("snake→camel, size_bytes 문자열도 숫자로, 업로더 이름을 붙인다", () => {
    const row = { id: "up-1", project_id: "p-1", drive_id: "b!d", item_id: "01I", file_name: "a.xlsx", web_url: "https://x/a.xlsx", size_bytes: "12345" as unknown as number, uploaded_by: "u-1", created_at: "2026-09-05T02:00:00.000Z" } satisfies SharepointUploadDbRow;
    expect(mapSharepointUpload(row, "강승욱")).toEqual({ id: "up-1", fileName: "a.xlsx", webUrl: "https://x/a.xlsx", sizeBytes: 12345, uploadedBy: { id: "u-1", name: "강승욱" }, createdAt: "2026-09-05T02:00:00.000Z" });
    expect(mapSharepointUpload({ ...row, uploaded_by: null }, null).uploadedBy).toEqual({ id: null, name: null });
  });
});

it("PROJECT_COLUMNS에 sharepoint_folder가 들어간다", () => {
  expect(PROJECT_COLUMNS.split(",").map((s) => s.trim())).toContain("sharepoint_folder");
});
```

- [ ] **Step 5: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test -- rfp-sharepoint-mappers`
Expected: FAIL — `parseSharepointFolder`·`mapSharepointUpload` export 없음.

- [ ] **Step 6: `frontend/src/lib/rfp/mappers.ts` 수정**

import 줄을 바꾸고, `PROJECT_COLUMNS`·`ProjectDbRow`에 컬럼을 더하고, 업로드 매퍼와 `mapProjectDetail` 6번째 인자를 추가한다.

```ts
// 1) import 교체
import type { RfpFile, RfpMapping, RfpProjectDetail, RfpProjectSummary, RfpRequirement, RfpSharepointUpload, SharepointFolder } from "@/types/rfp";
```

```ts
// 2) PROJECT_COLUMNS 끝에 sharepoint_folder
export const PROJECT_COLUMNS =
  "id, name, agency, period, budget, bid_method, extra, status, extraction_method, error, warnings, requirement_count, created_by, created_at, updated_at, mapping_status, mapping_error, mapping_warnings, mapping_at, sharepoint_folder";
```

```ts
// 3) ProjectDbRow 마지막 필드(mapping_at) 다음에
  /** 3단계 — jsonb. parseSharepointFolder로 읽는다 */
  sharepoint_folder: unknown;
```

```ts
// 4) mapMapping 함수 위(MappingDbRow 다음)에 추가
export const SHAREPOINT_UPLOAD_COLUMNS = "id, project_id, drive_id, item_id, file_name, web_url, size_bytes, uploaded_by, created_at";

export interface SharepointUploadDbRow {
  id: string;
  project_id: string;
  drive_id: string;
  item_id: string;
  file_name: string;
  web_url: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

/** rfp_projects.sharepoint_folder(jsonb) → 타입. 필수 문자열 필드가 하나라도 없으면 null(지정 안 됨으로 취급). */
export function parseSharepointFolder(v: unknown): SharepointFolder | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  const url = str("url"), driveId = str("driveId"), itemId = str("itemId"), name = str("name"), webUrl = str("webUrl"), setAt = str("setAt");
  if (url === null || driveId === null || itemId === null || name === null || webUrl === null || setAt === null) return null;
  return { url, driveId, itemId, name, webUrl, setBy: str("setBy"), setAt };
}

export function mapSharepointUpload(row: SharepointUploadDbRow, uploaderName: string | null): RfpSharepointUpload {
  return {
    id: row.id, fileName: row.file_name, webUrl: row.web_url, sizeBytes: Number(row.size_bytes),
    uploadedBy: { id: row.uploaded_by, name: row.uploaded_by ? uploaderName : null }, createdAt: row.created_at,
  };
}
```

```ts
// 5) mapProjectDetail 교체
export function mapProjectDetail(
  row: ProjectDbRow, creatorName: string | null, files: FileDbRow[], requirements: RfpRequirement[], mappings: RfpMapping[],
  lastUpload: RfpSharepointUpload | null = null,
): RfpProjectDetail {
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
    sharepoint: { folder: parseSharepointFolder(row.sharepoint_folder), lastUpload },
  };
}
```

- [ ] **Step 7: 테스트·타입·린트 통과 확인**

Run: `cd frontend && npm test -- rfp-sharepoint-mappers && npx tsc --noEmit -p . && npm run lint`
Expected: 4 tests PASS, tsc 오류 없음, lint 오류 없음. (`PROJECT_COLUMNS`를 쓰는 라우트는 DB에 컬럼이 생기기 전까지 런타임 조회가 실패하므로, 컨트롤러가 이 태스크 직후 SQL을 적용한다.)

- [ ] **Step 8: 커밋**

```bash
git add docs/sql/2026-09-05-rfp-sharepoint.sql frontend/src/types/ms.ts frontend/src/types/rfp.ts frontend/src/lib/rfp/mappers.ts frontend/src/lib/__tests__/rfp-sharepoint-mappers.test.ts
git commit -m "feat(rfp): 3단계 SQL(ms_connections·sharepoint_folder·rfp_sharepoint_uploads)과 SharePoint 타입·매퍼

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 2: 토큰 암호화·state 서명 (`lib/ms/crypto.ts`)

**Files:**
- Create: `frontend/src/lib/ms/crypto.ts`
- Test: `frontend/src/lib/__tests__/ms-crypto.test.ts`

**Interfaces:**
- Produces: `ENC_KEY_ENV = "MS_TOKEN_ENC_KEY"`, `STATE_TTL_S = 600`, `parseEncKey(hex: string | undefined): Buffer | null`, `encryptSecret(plain: string, key: Buffer): string`, `decryptSecret(token: string, key: Buffer): string`(실패 시 `Error("토큰 복호화 실패")`), `StatePayload { u: string; n: string; r: string; e: number }`(e = 만기 epoch 초), `signState(payload: StatePayload, key: Buffer): string`, `verifyState(token: string, key: Buffer, nowMs = Date.now()): StatePayload | null`, `newNonce(): string`.

- [ ] **Step 1: 실패하는 테스트 작성 — `frontend/src/lib/__tests__/ms-crypto.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseEncKey, encryptSecret, decryptSecret, signState, verifyState, newNonce, STATE_TTL_S } from "@/lib/ms/crypto";

const KEY_HEX = "0123456789abcdef".repeat(4); // 64자
const key = parseEncKey(KEY_HEX)!;
const other = parseEncKey("f".repeat(64))!;

describe("parseEncKey", () => {
  it("64자 hex만 32바이트 키로 받는다(공백 허용, 대문자 허용)", () => {
    expect(key).toHaveLength(32);
    expect(parseEncKey(` ${KEY_HEX.toUpperCase()} `)).toHaveLength(32);
    expect(parseEncKey(undefined)).toBeNull();
    expect(parseEncKey("abc")).toBeNull();
    expect(parseEncKey("g".repeat(64))).toBeNull();
    expect(parseEncKey("0".repeat(63))).toBeNull();
  });
});

describe("encryptSecret/decryptSecret", () => {
  it("왕복하고, 형식은 v1.iv.tag.cipher(base64url)이며 매번 iv가 다르다", () => {
    const a = encryptSecret("0.AXoA-refresh-token-값", key);
    const b = encryptSecret("0.AXoA-refresh-token-값", key);
    expect(a).not.toBe(b);
    const parts = a.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1], "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64url")).toHaveLength(16);
    expect(a).not.toMatch(/[+/=]/);
    expect(decryptSecret(a, key)).toBe("0.AXoA-refresh-token-값");
    expect(decryptSecret(b, key)).toBe("0.AXoA-refresh-token-값");
  });
  it("다른 키·변조된 태그·변조된 본문·잘못된 형식은 '토큰 복호화 실패'", () => {
    const tok = encryptSecret("secret", key);
    expect(() => decryptSecret(tok, other)).toThrow("토큰 복호화 실패");
    const [v, iv, tag, enc] = tok.split(".");
    const flip = (s: string) => Buffer.from(s, "base64url").map((b, i) => (i === 0 ? b ^ 0xff : b));
    expect(() => decryptSecret([v, iv, Buffer.from(flip(tag)).toString("base64url"), enc].join("."), key)).toThrow("토큰 복호화 실패");
    expect(() => decryptSecret([v, iv, tag, Buffer.from(flip(enc)).toString("base64url")].join("."), key)).toThrow("토큰 복호화 실패");
    expect(() => decryptSecret("v2.a.b.c", key)).toThrow("토큰 복호화 실패");
    expect(() => decryptSecret("garbage", key)).toThrow("토큰 복호화 실패");
  });
});

describe("signState/verifyState", () => {
  const now = 1_800_000_000_000; // ms
  const payload = { u: "user-1", n: newNonce(), r: "/rfp/abc", e: Math.floor(now / 1000) + STATE_TTL_S };
  it("서명 왕복 — payload를 그대로 돌려주고 URL 안전 문자만 쓴다", () => {
    const tok = signState(payload, key);
    expect(tok).not.toMatch(/[+/=]/);
    expect(tok.split(".")).toHaveLength(2);
    expect(verifyState(tok, key, now)).toEqual(payload);
    expect(STATE_TTL_S).toBe(600);
  });
  it("만기가 지나면 null", () => {
    const tok = signState(payload, key);
    expect(verifyState(tok, key, payload.e * 1000)).toBeNull();
    expect(verifyState(tok, key, payload.e * 1000 - 1)).toEqual(payload);
  });
  it("변조·다른 키·형식 오류는 null", () => {
    const tok = signState(payload, key);
    const [body, sig] = tok.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...payload, u: "user-2" })).toString("base64url");
    expect(verifyState(`${tampered}.${sig}`, key, now)).toBeNull();
    expect(verifyState(tok, other, now)).toBeNull();
    expect(verifyState(body, key, now)).toBeNull();
    expect(verifyState(`${body}.${sig}.x`, key, now)).toBeNull();
    expect(verifyState("", key, now)).toBeNull();
  });
  it("필드 타입이 어긋난 payload는 서명이 맞아도 null", () => {
    const bad = signState({ u: "user-1", n: "n", r: "/settings", e: "soon" as unknown as number }, key);
    expect(verifyState(bad, key, now)).toBeNull();
  });
  it("newNonce는 16바이트 base64url(22자)이고 매번 다르다", () => {
    const a = newNonce();
    expect(a).toHaveLength(22);
    expect(a).not.toBe(newNonce());
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test -- ms-crypto`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `frontend/src/lib/ms/crypto.ts` 작성**

```ts
/**
 * Microsoft 연결용 비밀 보호(스펙 §3.2).
 * - refresh 토큰: AES-256-GCM, 형식 v1.{iv}.{tag}.{cipher}(각 base64url, iv 12B, tag 16B)
 * - OAuth state: HMAC-SHA256 서명 base64url(json).base64url(hmac), 만기(e, epoch 초) 포함
 * 키는 env MS_TOKEN_ENC_KEY(64자 hex). HMAC 키는 sha256("state:" + hex)로 파생한다.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ENC_KEY_ENV = "MS_TOKEN_ENC_KEY";
/** state 만기(초) — connect 라우트가 e = now + STATE_TTL_S 로 만든다 */
export const STATE_TTL_S = 600;

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DECRYPT_FAIL = "토큰 복호화 실패";

/** env의 64자 hex → 32바이트 키. 없거나 형식이 다르면 null(호출자가 설정 누락으로 처리). */
export function parseEncKey(hex: string | undefined): Buffer | null {
  const s = (hex ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(s)) return null;
  return Buffer.from(s, "hex");
}

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64u(iv), b64u(cipher.getAuthTag()), b64u(enc)].join(".");
}

export function decryptSecret(token: string, key: Buffer): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error(DECRYPT_FAIL);
  try {
    const iv = unb64u(parts[1]);
    const tag = unb64u(parts[2]);
    const enc = unb64u(parts[3]);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error(DECRYPT_FAIL);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(DECRYPT_FAIL);
  }
}

/** OAuth state 본문: u 세션 사용자 id, n 난수, r returnTo 경로, e 만기(epoch 초) */
export interface StatePayload {
  u: string;
  n: string;
  r: string;
  e: number;
}

function stateKey(key: Buffer): Buffer {
  return createHash("sha256").update(`state:${key.toString("hex")}`).digest();
}

function hmac(body: string, key: Buffer): Buffer {
  return createHmac("sha256", stateKey(key)).update(body).digest();
}

export function signState(payload: StatePayload, key: Buffer): string {
  const body = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${b64u(hmac(body, key))}`;
}

/** 서명·형식·만기를 검사해 payload를 돌려준다. 어느 하나라도 어긋나면 null. 사용자 일치(u)는 라우트가 확인한다. */
export function verifyState(token: string, key: Buffer, nowMs: number = Date.now()): StatePayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const sig = unb64u(token.slice(dot + 1));
  const expected = hmac(body, key);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unb64u(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { u, n, r, e } = parsed as Record<string, unknown>;
  if (typeof u !== "string" || typeof n !== "string" || typeof r !== "string" || typeof e !== "number") return null;
  if (e * 1000 <= nowMs) return null;
  return { u, n, r, e };
}

/** 16바이트 난수 base64url(22자) */
export function newNonce(): string {
  return b64u(randomBytes(16));
}
```

- [ ] **Step 4: 테스트·타입 통과 확인**

Run: `cd frontend && npm test -- ms-crypto && npx tsc --noEmit -p .`
Expected: 8 tests PASS, tsc 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/ms/crypto.ts frontend/src/lib/__tests__/ms-crypto.test.ts
git commit -m "feat(ms): refresh 토큰 AES-256-GCM 암복호화와 OAuth state HMAC 서명·검증

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---
### Task 3: OAuth 클라이언트·설정 로더·리디렉션 오리진 (`lib/ms/oauth.ts`, `config.ts`, `origin.ts`)

**Files:**
- Create: `frontend/src/lib/ms/oauth.ts`
- Create: `frontend/src/lib/ms/config.ts`
- Create: `frontend/src/lib/ms/origin.ts`
- Test: `frontend/src/lib/__tests__/ms-oauth.test.ts`, `frontend/src/lib/__tests__/ms-origin.test.ts`

**Interfaces:**
- Consumes: `parseEncKey`, `ENC_KEY_ENV`(Task 2); `FetchLike`(`@/lib/notify/types`); `GRAPH_BASE`(`@/lib/teams-graph`); `loadSettings`, `ServerSupabase`(`@/lib/settings-server`).
- Produces (oauth): `MS_SCOPES`, `MsAppConfig { tenantId; clientId; clientSecret }`, `OAuthError(code, description, status)`, `oauthErrorMessage(code): string`, `buildAuthorizeUrl({tenantId, clientId, redirectUri, state}): string`, `TokenResult { accessToken; refreshToken: string | null; expiresIn: number; scope: string }`, `exchangeCode(cfg, {code, redirectUri}, fetchImpl?)`, `refreshAccessToken(cfg, refreshToken, fetchImpl?)`, `MsMe { id; userPrincipalName; displayName; mail: string | null }`, `fetchMe(accessToken, fetchImpl?)`.
- Produces (config): `MS_SETTING_KEYS`, `MsRuntimeConfig { app: MsAppConfig; encKey: Buffer }`, `MsConfigResult`, `resolveMsConfig(settings, env)`, `loadMsConfig(supabase, env?)`, `missingConfigMessage(missing)`.
- Produces (origin): `DEFAULT_ALLOWED_ORIGINS`, `DEFAULT_RETURN_TO = "/settings"`, `allowedOrigins(env?)`, `requestOrigin(req: { nextUrl: { origin: string }; headers: { get(name: string): string | null } }): string`(프록시 뒤 `x-forwarded-proto`/`x-forwarded-host` 우선), `resolveRedirectOrigin(requestOrigin, env?): string | null`, `sanitizeReturnTo(v): string`, `appendQuery(path, key, value): string`.

- [ ] **Step 1: 실패하는 테스트 작성 — `frontend/src/lib/__tests__/ms-oauth.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { MS_SCOPES, OAuthError, oauthErrorMessage, buildAuthorizeUrl, exchangeCode, refreshAccessToken, fetchMe, type MsAppConfig } from "@/lib/ms/oauth";
import { resolveMsConfig, missingConfigMessage, MS_SETTING_KEYS } from "@/lib/ms/config";

const cfg: MsAppConfig = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret" };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("buildAuthorizeUrl", () => {
  it("v2.0 authorize 엔드포인트에 스코프 4개·state·redirect_uri·prompt=select_account", () => {
    const u = new URL(buildAuthorizeUrl({ tenantId: "tenant-1", clientId: "client-1", redirectUri: "http://localhost:3003/api/ms/callback", state: "abc.def" }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize");
    expect(u.searchParams.get("client_id")).toBe("client-1");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("response_mode")).toBe("query");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3003/api/ms/callback");
    expect(u.searchParams.get("scope")).toBe("offline_access User.Read Files.ReadWrite.All Sites.Read.All");
    expect(u.searchParams.get("state")).toBe("abc.def");
    expect(u.searchParams.get("prompt")).toBe("select_account");
    expect([...MS_SCOPES]).toEqual(["offline_access", "User.Read", "Files.ReadWrite.All", "Sites.Read.All"]);
  });
});

describe("exchangeCode", () => {
  it("authorization_code 본문을 x-www-form-urlencoded로 보내고 토큰을 파싱한다", async () => {
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT", refresh_token: "RT", expires_in: 3599, scope: "Files.ReadWrite.All Sites.Read.All User.Read" }));
    const r = await exchangeCode(cfg, { code: "CODE", redirectUri: "http://localhost:3003/api/ms/callback" }, fetchImpl);
    expect(r).toEqual({ accessToken: "AT", refreshToken: "RT", expiresIn: 3599, scope: "Files.ReadWrite.All Sites.Read.All User.Read" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const p = new URLSearchParams(init.body as string);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("CODE");
    expect(p.get("redirect_uri")).toBe("http://localhost:3003/api/ms/callback");
    expect(p.get("client_id")).toBe("client-1");
    expect(p.get("client_secret")).toBe("s3cret");
    expect(p.get("scope")).toBe("offline_access User.Read Files.ReadWrite.All Sites.Read.All");
  });
  it("오류 응답은 OAuthError(code, description, status)", async () => {
    const fetchImpl = vi.fn(async () => json(400, { error: "invalid_grant", error_description: "AADSTS70000: The provided value for the 'code' parameter is not valid." }));
    const err = await exchangeCode(cfg, { code: "x", redirectUri: "http://localhost:3003/api/ms/callback" }, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err).toMatchObject({ code: "invalid_grant", status: 400 });
    expect((err as OAuthError).description).toContain("AADSTS70000");
  });
  it("JSON이 아닌 오류 본문은 http_{status} 코드", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>gateway</html>", { status: 502 }));
    await expect(exchangeCode(cfg, { code: "x", redirectUri: "r" }, fetchImpl)).rejects.toMatchObject({ code: "http_502", status: 502 });
  });
  it("access_token이 없는 200 응답은 invalid_response", async () => {
    const fetchImpl = vi.fn(async () => json(200, { token_type: "Bearer" }));
    await expect(exchangeCode(cfg, { code: "x", redirectUri: "r" }, fetchImpl)).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("refreshAccessToken", () => {
  it("refresh_token 본문을 보내고, 응답에 refresh_token이 없으면 null", async () => {
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT2", expires_in: "3600" }));
    const r = await refreshAccessToken(cfg, "RT-old", fetchImpl);
    expect(r).toEqual({ accessToken: "AT2", refreshToken: null, expiresIn: 3600, scope: "" });
    const p = new URLSearchParams((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(p.get("grant_type")).toBe("refresh_token");
    expect(p.get("refresh_token")).toBe("RT-old");
    expect(p.get("scope")).toBe("offline_access User.Read Files.ReadWrite.All Sites.Read.All");
  });
});

describe("fetchMe", () => {
  it("GET /me?$select=… 에 Bearer를 붙이고 UPN·이름·mail을 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => json(200, { id: "oid-1", userPrincipalName: "kang@innogrid.com", displayName: "강승욱", mail: null }));
    expect(await fetchMe("AT", fetchImpl)).toEqual({ id: "oid-1", userPrincipalName: "kang@innogrid.com", displayName: "강승욱", mail: null });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,displayName,mail");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });
  it("실패는 OAuthError(me_failed)", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: { code: "InvalidAuthenticationToken" } }));
    await expect(fetchMe("AT", fetchImpl)).rejects.toMatchObject({ code: "me_failed", status: 401 });
  });
});

describe("oauthErrorMessage", () => {
  it("코드별 한국어 문구, 모르는 코드는 코드를 그대로 보여준다", () => {
    expect(oauthErrorMessage("access_denied")).toBe("연결이 취소되었습니다.");
    expect(oauthErrorMessage("invalid_grant")).toBe("연결이 만료되었습니다. 다시 연결하세요.");
    expect(oauthErrorMessage("interaction_required")).toBe("연결이 만료되었습니다. 다시 연결하세요.");
    expect(oauthErrorMessage("invalid_client")).toContain("클라이언트 ID·시크릿");
    expect(oauthErrorMessage("temporarily_unavailable")).toBe("Microsoft 로그인 오류(temporarily_unavailable)");
  });
});

describe("resolveMsConfig", () => {
  const settings = { teams_tenant_id: "tenant-1", teams_graph_client_id: "client-1" };
  const env = { TEAMS_GRAPH_CLIENT_SECRET: "s3cret", MS_TOKEN_ENC_KEY: "ab".repeat(32) };
  it("settings 2개 + env 2개가 모두 있으면 app·encKey", () => {
    const r = resolveMsConfig(settings, env);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.app).toEqual({ tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret" });
      expect(r.config.encKey).toHaveLength(32);
    }
    expect([...MS_SETTING_KEYS]).toEqual(["teams_tenant_id", "teams_graph_client_id"]);
  });
  it("누락 항목명을 순서대로 모으고, 형식이 틀린 키도 누락으로 본다", () => {
    expect(resolveMsConfig({}, {})).toEqual({ ok: false, missing: ["teams_tenant_id", "teams_graph_client_id", "env TEAMS_GRAPH_CLIENT_SECRET", "env MS_TOKEN_ENC_KEY"] });
    expect(resolveMsConfig(settings, { ...env, MS_TOKEN_ENC_KEY: "short" })).toEqual({ ok: false, missing: ["env MS_TOKEN_ENC_KEY"] });
    expect(resolveMsConfig({ ...settings, teams_tenant_id: "  " }, env)).toEqual({ ok: false, missing: ["teams_tenant_id"] });
    expect(missingConfigMessage(["env MS_TOKEN_ENC_KEY"])).toBe("Microsoft 연동 설정이 누락되었습니다: env MS_TOKEN_ENC_KEY");
  });
});
```

- [ ] **Step 2: 실패하는 테스트 작성 — `frontend/src/lib/__tests__/ms-origin.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_RETURN_TO, allowedOrigins, requestOrigin, resolveRedirectOrigin, sanitizeReturnTo, appendQuery } from "@/lib/ms/origin";

describe("requestOrigin", () => {
  const req = (origin: string, headers: Record<string, string>) => ({ nextUrl: { origin }, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } });
  it("x-forwarded-proto/host가 둘 다 있으면 그것을(첫 값), 아니면 nextUrl.origin", () => {
    expect(requestOrigin(req("http://localhost:3003", {}))).toBe("http://localhost:3003");
    expect(requestOrigin(req("http://10.0.0.1:3000", { "x-forwarded-proto": "https", "x-forwarded-host": "inje-playground.vercel.app" }))).toBe("https://inje-playground.vercel.app");
    expect(requestOrigin(req("http://10.0.0.1:3000", { "x-forwarded-proto": "https, http", "x-forwarded-host": "a.example, b.example" }))).toBe("https://a.example");
    expect(requestOrigin(req("http://localhost:3003", { "x-forwarded-host": "evil.example" }))).toBe("http://localhost:3003");
  });
});

describe("allowedOrigins / resolveRedirectOrigin", () => {
  it("env가 없으면 운영 도메인 + localhost:3003", () => {
    expect(allowedOrigins({})).toEqual(["https://inje-playground.vercel.app", "http://localhost:3003"]);
    expect(DEFAULT_ALLOWED_ORIGINS).toEqual(["https://inje-playground.vercel.app", "http://localhost:3003"]);
  });
  it("env는 쉼표 구분, 공백·끝 슬래시 정리", () => {
    expect(allowedOrigins({ MS_ALLOWED_ORIGINS: " https://a.example/ , http://localhost:3000 ,, " })).toEqual(["https://a.example", "http://localhost:3000"]);
  });
  it("허용 목록에 있는 오리진만 통과(끝 슬래시 무시), 나머지는 null", () => {
    expect(resolveRedirectOrigin("http://localhost:3003", {})).toBe("http://localhost:3003");
    expect(resolveRedirectOrigin("https://inje-playground.vercel.app/", {})).toBe("https://inje-playground.vercel.app");
    expect(resolveRedirectOrigin("https://inje-playground-git-x.vercel.app", {})).toBeNull();
    expect(resolveRedirectOrigin("http://localhost:3000", {})).toBeNull();
    expect(resolveRedirectOrigin("http://localhost:3000", { MS_ALLOWED_ORIGINS: "http://localhost:3000" })).toBe("http://localhost:3000");
  });
});

describe("sanitizeReturnTo", () => {
  it("같은 오리진 경로만 받고 나머지는 /settings", () => {
    expect(DEFAULT_RETURN_TO).toBe("/settings");
    expect(sanitizeReturnTo("/rfp/abc?tab=1")).toBe("/rfp/abc?tab=1");
    expect(sanitizeReturnTo("/settings")).toBe("/settings");
    expect(sanitizeReturnTo(undefined)).toBe("/settings");
    expect(sanitizeReturnTo(null)).toBe("/settings");
    expect(sanitizeReturnTo("")).toBe("/settings");
    expect(sanitizeReturnTo("//evil.example/x")).toBe("/settings");
    expect(sanitizeReturnTo("https://evil.example/x")).toBe("/settings");
    expect(sanitizeReturnTo("/a\\b")).toBe("/settings");
    expect(sanitizeReturnTo("/x?u=https://evil")).toBe("/settings");
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/settings");
    expect(sanitizeReturnTo("/" + "a".repeat(500))).toBe("/settings");
  });
});

describe("appendQuery", () => {
  it("?와 &를 골라 붙이고 값은 인코딩한다", () => {
    expect(appendQuery("/settings", "ms_connected", "1")).toBe("/settings?ms_connected=1");
    expect(appendQuery("/rfp/x?tab=1", "ms_error", "연결이 취소되었습니다.")).toBe("/rfp/x?tab=1&ms_error=%EC%97%B0%EA%B2%B0%EC%9D%B4%20%EC%B7%A8%EC%86%8C%EB%90%98%EC%97%88%EC%8A%B5%EB%8B%88%EB%8B%A4.");
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test -- ms-oauth ms-origin`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: `frontend/src/lib/ms/oauth.ts` 작성**

```ts
/**
 * Microsoft Identity Platform v2.0 — 위임(authorization code) 흐름(스펙 §3.1). 서버 전용.
 * 토큰·시크릿은 절대 로그에 남기지 않는다. 오류는 OAuthError(code)로 정규화하고 클라이언트에는 oauthErrorMessage(code)만 준다.
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";

export const MS_SCOPES = ["offline_access", "User.Read", "Files.ReadWrite.All", "Sites.Read.All"] as const;
const SCOPE = MS_SCOPES.join(" ");
const LOGIN_BASE = "https://login.microsoftonline.com";

export interface MsAppConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    /** Azure error_description — 서버 로그 전용 */
    public readonly description: string,
    public readonly status: number,
  ) {
    super(`${code}: ${description}`);
    this.name = "OAuthError";
  }
}

/** 클라이언트에 보여줄 한국어 문구(스펙 §9) */
export function oauthErrorMessage(code: string): string {
  switch (code) {
    case "access_denied":
      return "연결이 취소되었습니다.";
    case "invalid_grant":
    case "interaction_required":
    case "consent_required":
      return "연결이 만료되었습니다. 다시 연결하세요.";
    case "invalid_client":
    case "unauthorized_client":
      return "앱 등록 설정이 잘못되었습니다(클라이언트 ID·시크릿). 관리자에게 문의하세요.";
    default:
      return `Microsoft 로그인 오류(${code})`;
  }
}

export function buildAuthorizeUrl(p: { tenantId: string; clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    response_mode: "query",
    scope: SCOPE,
    state: p.state,
    prompt: "select_account",
  });
  return `${LOGIN_BASE}/${encodeURIComponent(p.tenantId)}/oauth2/v2.0/authorize?${q.toString()}`;
}

export interface TokenResult {
  accessToken: string;
  /** offline_access 미동의 등으로 없을 수 있다 */
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

async function postToken(cfg: MsAppConfig, params: Record<string, string>, fetchImpl: FetchLike): Promise<TokenResult> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  const res = await fetchImpl(`${LOGIN_BASE}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 게이트웨이 오류 등 JSON이 아닌 본문 — 빈 객체로 두고 아래에서 http_{status}로 처리
  }
  if (!res.ok) {
    const code = typeof j.error === "string" ? j.error : `http_${res.status}`;
    const description = typeof j.error_description === "string" ? j.error_description : text.slice(0, 500);
    throw new OAuthError(code, description, res.status);
  }
  if (typeof j.access_token !== "string") throw new OAuthError("invalid_response", "토큰 응답에 access_token이 없습니다.", res.status);
  const expiresRaw = Number(j.expires_in);
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null,
    expiresIn: Number.isFinite(expiresRaw) && expiresRaw > 0 ? expiresRaw : 3600,
    scope: typeof j.scope === "string" ? j.scope : "",
  };
}

export function exchangeCode(cfg: MsAppConfig, p: { code: string; redirectUri: string }, fetchImpl: FetchLike = fetch): Promise<TokenResult> {
  return postToken(cfg, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, scope: SCOPE }, fetchImpl);
}

export function refreshAccessToken(cfg: MsAppConfig, refreshToken: string, fetchImpl: FetchLike = fetch): Promise<TokenResult> {
  return postToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPE }, fetchImpl);
}

export interface MsMe {
  id: string;
  userPrincipalName: string;
  displayName: string;
  mail: string | null;
}

export async function fetchMe(accessToken: string, fetchImpl: FetchLike = fetch): Promise<MsMe> {
  const res = await fetchImpl(`${GRAPH_BASE}/me?$select=id,userPrincipalName,displayName,mail`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new OAuthError("me_failed", `GET /me ${res.status}`, res.status);
  const j = (await res.json()) as Record<string, unknown>;
  return {
    id: String(j.id ?? ""),
    userPrincipalName: String(j.userPrincipalName ?? ""),
    displayName: String(j.displayName ?? ""),
    mail: typeof j.mail === "string" && j.mail ? j.mail : null,
  };
}
```

- [ ] **Step 5: `frontend/src/lib/ms/config.ts` 작성**

```ts
/**
 * Microsoft 연동 런타임 설정 — Entra 앱은 Teams 멤버 조회와 같은 것을 재사용한다(스펙 §2).
 * settings: teams_tenant_id·teams_graph_client_id / env: TEAMS_GRAPH_CLIENT_SECRET·MS_TOKEN_ENC_KEY
 */
import { loadSettings, type ServerSupabase } from "@/lib/settings-server";
import { ENC_KEY_ENV, parseEncKey } from "./crypto";
import type { MsAppConfig } from "./oauth";

export const MS_SETTING_KEYS = ["teams_tenant_id", "teams_graph_client_id"] as const;

export interface MsRuntimeConfig {
  app: MsAppConfig;
  encKey: Buffer;
}

export type MsConfigResult = { ok: true; config: MsRuntimeConfig } | { ok: false; missing: string[] };

/** 순수: settings 맵 + env → 설정 또는 누락 항목명 목록(순서 고정) */
export function resolveMsConfig(settings: Record<string, string | undefined>, env: Record<string, string | undefined>): MsConfigResult {
  const missing: string[] = [];
  const tenantId = settings.teams_tenant_id?.trim() ?? "";
  if (!tenantId) missing.push("teams_tenant_id");
  const clientId = settings.teams_graph_client_id?.trim() ?? "";
  if (!clientId) missing.push("teams_graph_client_id");
  const clientSecret = env.TEAMS_GRAPH_CLIENT_SECRET?.trim() ?? "";
  if (!clientSecret) missing.push("env TEAMS_GRAPH_CLIENT_SECRET");
  const encKey = parseEncKey(env[ENC_KEY_ENV]);
  if (!encKey) missing.push(`env ${ENC_KEY_ENV}`);
  if (missing.length > 0 || !encKey) return { ok: false, missing };
  return { ok: true, config: { app: { tenantId, clientId, clientSecret }, encKey } };
}

/** 서버 전용: settings 테이블(세션 클라이언트) + process.env */
export async function loadMsConfig(supabase: ServerSupabase, env: Record<string, string | undefined> = process.env): Promise<MsConfigResult> {
  return resolveMsConfig(await loadSettings(supabase, MS_SETTING_KEYS), env);
}

export function missingConfigMessage(missing: string[]): string {
  return `Microsoft 연동 설정이 누락되었습니다: ${missing.join(", ")}`;
}
```

- [ ] **Step 6: `frontend/src/lib/ms/origin.ts` 작성**

```ts
/**
 * OAuth 리디렉션 안전장치(스펙 §3.1·§12).
 * redirect_uri의 오리진은 허용 목록(env MS_ALLOWED_ORIGINS)에 있는 값만, returnTo는 같은 오리진 경로만.
 */
export const DEFAULT_ALLOWED_ORIGINS = ["https://inje-playground.vercel.app", "http://localhost:3003"];
export const DEFAULT_RETURN_TO = "/settings";
const RETURN_TO_MAX = 500;

const stripSlash = (s: string) => s.trim().replace(/\/+$/, "");

export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.MS_ALLOWED_ORIGINS?.trim();
  if (!raw) return [...DEFAULT_ALLOWED_ORIGINS];
  return raw.split(",").map(stripSlash).filter(Boolean);
}

/** 프록시(Vercel) 뒤에서는 x-forwarded-proto/x-forwarded-host(첫 값)가 실제 접속 오리진. 둘 중 하나라도 없으면 nextUrl.origin */
export function requestOrigin(req: { nextUrl: { origin: string }; headers: { get(name: string): string | null } }): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return proto && host ? `${proto}://${host}` : req.nextUrl.origin;
}

/** 접속 오리진이 허용 목록에 있으면 끝 슬래시를 뗀 값, 아니면 null */
export function resolveRedirectOrigin(requestOrigin: string, env: Record<string, string | undefined> = process.env): string | null {
  const origin = stripSlash(requestOrigin);
  return allowedOrigins(env).includes(origin) ? origin : null;
}

/** "/"로 시작하는 같은 오리진 경로만. "//"·"://"·백슬래시·개행·500자 초과는 기본값 */
export function sanitizeReturnTo(v: string | null | undefined): string {
  if (!v) return DEFAULT_RETURN_TO;
  if (v.length > RETURN_TO_MAX) return DEFAULT_RETURN_TO;
  if (!v.startsWith("/") || v.startsWith("//")) return DEFAULT_RETURN_TO;
  if (v.includes("://") || /[\\\r\n]/.test(v)) return DEFAULT_RETURN_TO;
  return v;
}

export function appendQuery(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
```

- [ ] **Step 7: 테스트·타입·린트 통과 확인**

Run: `cd frontend && npm test -- ms-oauth ms-origin && npx tsc --noEmit -p . && npm run lint`
Expected: ms-oauth 11 tests, ms-origin 6 tests PASS. tsc·lint 오류 없음.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/ms/oauth.ts frontend/src/lib/ms/config.ts frontend/src/lib/ms/origin.ts frontend/src/lib/__tests__/ms-oauth.test.ts frontend/src/lib/__tests__/ms-origin.test.ts
git commit -m "feat(ms): 위임 OAuth 클라이언트(authorize URL·코드 교환·갱신·/me), 설정 로더, 리디렉션 오리진·returnTo 검사

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 4: 연결 저장소·access 토큰 발급 (`lib/ms/connections.ts`)

**Files:**
- Create: `frontend/src/lib/ms/connections.ts`
- Test: `frontend/src/lib/__tests__/ms-connections.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret`(Task 2); `OAuthError`, `refreshAccessToken`, `MsAppConfig`(Task 3); `MsConnectionStatus`(Task 1); `FetchLike`.
- Produces: `NotConnectedError`, `ReconnectRequiredError(reason)`, `RECONNECT_CODES`, `TOKEN_CACHE_MAX_MS = 300_000`, `getConnectionStatus(admin, userId): Promise<MsConnectionStatus>`, `saveConnection(admin, encKey, {userId, refreshToken, accountUpn, accountName, scopes}): Promise<void>`, `deleteConnection(admin, userId): Promise<void>`, `TokenDeps { app; encKey; fetchImpl?; now?: () => number }`, `getAccessTokenForUser(admin, userId, deps): Promise<string>`, `_resetMsTokenCache()`.
- DB 접근 형태(가짜 admin이 흉내 내는 체인): `admin.from("ms_connections").select(cols).eq("user_id", id).maybeSingle()`, `.upsert(row, { onConflict: "user_id" })`, `.update(patch).eq("user_id", id)`, `.delete().eq("user_id", id)`.

- [ ] **Step 1: 실패하는 테스트 작성 — `frontend/src/lib/__tests__/ms-connections.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEncKey, encryptSecret, decryptSecret } from "@/lib/ms/crypto";
import { OAuthError, type MsAppConfig } from "@/lib/ms/oauth";
import {
  getConnectionStatus, saveConnection, deleteConnection, getAccessTokenForUser, _resetMsTokenCache,
  NotConnectedError, ReconnectRequiredError, TOKEN_CACHE_MAX_MS,
} from "@/lib/ms/connections";

const key = parseEncKey("ab".repeat(32))!;
const app: MsAppConfig = { tenantId: "t", clientId: "c", clientSecret: "s" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** ms_connections 한 행을 메모리에 두고 select/upsert/update/delete 체인을 흉내 낸다 */
function fakeAdmin(initial: Record<string, unknown> | null) {
  const state = { row: initial, updates: [] as Record<string, unknown>[], upserts: [] as { row: Record<string, unknown>; opts: unknown }[], deletes: 0, selects: 0 };
  const from = (table: string) => {
    if (table !== "ms_connections") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => { state.selects += 1; return { data: state.row, error: null }; } }) }),
      upsert: async (row: Record<string, unknown>, opts: unknown) => { state.upserts.push({ row, opts }); state.row = { ...(state.row ?? {}), ...row }; return { error: null }; },
      update: (patch: Record<string, unknown>) => ({ eq: async () => { state.updates.push(patch); if (state.row) state.row = { ...state.row, ...patch }; return { error: null }; } }),
      delete: () => ({ eq: async () => { state.deletes += 1; state.row = null; return { error: null }; } }),
    };
  };
  return { admin: { from } as unknown as SupabaseClient, state };
}

const connectedRow = (refreshToken = "RT-1") => ({
  user_id: "u-1", account_upn: "kang@innogrid.com", account_name: "강승욱", refresh_token_enc: encryptSecret(refreshToken, key),
  scopes: "offline_access User.Read Files.ReadWrite.All Sites.Read.All", connected_at: "2026-09-05T01:00:00.000Z", last_used_at: null, last_error: null, updated_at: "2026-09-05T01:00:00.000Z",
});

beforeEach(() => _resetMsTokenCache());

describe("getConnectionStatus", () => {
  it("행이 없으면 {connected:false}, 있으면 토큰 없이 상태만", async () => {
    expect(await getConnectionStatus(fakeAdmin(null).admin, "u-1")).toEqual({ connected: false });
    const s = await getConnectionStatus(fakeAdmin(connectedRow()).admin, "u-1");
    expect(s).toEqual({ connected: true, accountUpn: "kang@innogrid.com", accountName: "강승욱", connectedAt: "2026-09-05T01:00:00.000Z", lastUsedAt: null, lastError: null, scopes: ["offline_access", "User.Read", "Files.ReadWrite.All", "Sites.Read.All"] });
    expect(JSON.stringify(s)).not.toContain("refresh");
  });
});

describe("saveConnection / deleteConnection", () => {
  it("refresh 토큰을 암호화해 user_id 기준 upsert하고 last_error를 지운다", async () => {
    const { admin, state } = fakeAdmin(null);
    await saveConnection(admin, key, { userId: "u-1", refreshToken: "RT-new", accountUpn: "a@b.c", accountName: "A", scopes: "x y" });
    expect(state.upserts).toHaveLength(1);
    const { row, opts } = state.upserts[0];
    expect(opts).toEqual({ onConflict: "user_id" });
    expect(row).toMatchObject({ user_id: "u-1", account_upn: "a@b.c", account_name: "A", scopes: "x y", last_error: null, last_used_at: null });
    expect(typeof row.connected_at).toBe("string");
    expect(row.refresh_token_enc).not.toContain("RT-new");
    expect(decryptSecret(row.refresh_token_enc as string, key)).toBe("RT-new");
  });
  it("삭제 후에는 캐시도 비워져 다음 호출이 NotConnectedError", async () => {
    const { admin, state } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT", expires_in: 3600 }));
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl })).toBe("AT");
    await deleteConnection(admin, "u-1");
    expect(state.deletes).toBe(1);
    await expect(getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl })).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe("getAccessTokenForUser", () => {
  it("미연결이면 NotConnectedError, fetch는 부르지 않는다", async () => {
    const fetchImpl = vi.fn();
    await expect(getAccessTokenForUser(fakeAdmin(null).admin, "u-1", { app, encKey: key, fetchImpl })).rejects.toBeInstanceOf(NotConnectedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refresh로 access 토큰을 받고 last_used_at을 기록하며, 두 번째 호출은 캐시(fetch 1회)", async () => {
    const { admin, state } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT-1", expires_in: 3600 }));
    let t = 1_800_000_000_000;
    const now = () => t;
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now })).toBe("AT-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.get("refresh_token")).toBe("RT-1");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toEqual({ last_used_at: new Date(t).toISOString(), last_error: null });
    t += TOKEN_CACHE_MAX_MS - 1;
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now })).toBe("AT-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(state.updates).toHaveLength(1);
    // 5분이 지나면 다시 발급
    t += 2;
    fetchImpl.mockResolvedValueOnce(json(200, { access_token: "AT-2", expires_in: 3600 }));
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now })).toBe("AT-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("짧은 expires_in은 만기 60초 전까지만 캐시한다", async () => {
    const { admin } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT-1", expires_in: 120 }));
    let t = 1_800_000_000_000;
    const now = () => t;
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now });
    t += 59_000;
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 2_000;
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("응답에 새 refresh_token이 있으면 재암호화해 교체 저장한다", async () => {
    const { admin, state } = fakeAdmin(connectedRow("RT-1"));
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT", refresh_token: "RT-2", expires_in: 3600 }));
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl });
    const patch = state.updates[0];
    expect(typeof patch.refresh_token_enc).toBe("string");
    expect(decryptSecret(patch.refresh_token_enc as string, key)).toBe("RT-2");
    expect(patch.refresh_token_enc).not.toContain("RT-2");
  });
  it("invalid_grant·interaction_required·consent_required는 last_error 기록 후 ReconnectRequiredError", async () => {
    for (const code of ["invalid_grant", "interaction_required", "consent_required"]) {
      _resetMsTokenCache();
      const { admin, state } = fakeAdmin(connectedRow());
      const fetchImpl = vi.fn(async () => json(400, { error: code, error_description: "AADSTS50173" }));
      const err = await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl }).catch((e) => e);
      expect(err).toBeInstanceOf(ReconnectRequiredError);
      expect((err as ReconnectRequiredError).reason).toBe(code);
      expect(state.updates).toEqual([{ last_error: code }]);
    }
  });
  it("그 외 OAuthError는 그대로 던지고 last_error를 건드리지 않는다", async () => {
    const { admin, state } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(503, { error: "temporarily_unavailable", error_description: "retry" }));
    await expect(getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl })).rejects.toBeInstanceOf(OAuthError);
    expect(state.updates).toEqual([]);
  });
  it("복호화 실패(키 교체 등)는 last_error=decrypt + ReconnectRequiredError, fetch는 부르지 않는다", async () => {
    const { admin, state } = fakeAdmin({ ...connectedRow(), refresh_token_enc: encryptSecret("RT", parseEncKey("cd".repeat(32))!) });
    const fetchImpl = vi.fn();
    const err = await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ReconnectRequiredError);
    expect((err as ReconnectRequiredError).reason).toBe("decrypt");
    expect(state.updates).toEqual([{ last_error: "decrypt" }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test -- ms-connections`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `frontend/src/lib/ms/connections.ts` 작성**

```ts
/**
 * 사용자별 Microsoft 계정 연결(ms_connections)과 access 토큰 발급(스펙 §3.2).
 * refresh 토큰은 암호문으로만 저장·조회하고, access 토큰은 서버 메모리에 최대 5분 캐시한다.
 * 이 모듈은 토큰을 반환만 하며 로그에 쓰지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchLike } from "@/lib/notify/types";
import type { MsConnectionStatus } from "@/types/ms";
import { decryptSecret, encryptSecret } from "./crypto";
import { OAuthError, refreshAccessToken, type MsAppConfig } from "./oauth";

export class NotConnectedError extends Error {
  constructor() {
    super("Microsoft 계정이 연결되지 않았습니다.");
    this.name = "NotConnectedError";
  }
}

/** refresh 토큰이 더는 유효하지 않아(또는 복호화 불가) 사용자가 다시 연결해야 한다 */
export class ReconnectRequiredError extends Error {
  constructor(public readonly reason: string) {
    super("연결이 만료되었습니다. 다시 연결하세요.");
    this.name = "ReconnectRequiredError";
  }
}

/** 이 코드들은 refresh 토큰 자체가 죽은 것이라 재연결 안내로 바꾼다. 그 외(네트워크·5xx)는 그대로 던진다 */
export const RECONNECT_CODES = new Set(["invalid_grant", "interaction_required", "consent_required"]);

export const TOKEN_CACHE_MAX_MS = 5 * 60_000;
const TOKEN_SKEW_MS = 60_000;
const TABLE = "ms_connections";
const STATUS_COLUMNS = "user_id, account_upn, account_name, scopes, connected_at, last_used_at, last_error";

interface StatusRow {
  user_id: string;
  account_upn: string | null;
  account_name: string | null;
  scopes: string;
  connected_at: string;
  last_used_at: string | null;
  last_error: string | null;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

/** 테스트용 */
export function _resetMsTokenCache() {
  tokenCache.clear();
}

export async function getConnectionStatus(admin: SupabaseClient, userId: string): Promise<MsConnectionStatus> {
  const { data, error } = await admin.from(TABLE).select(STATUS_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`ms_connections 조회 실패: ${error.message}`);
  if (!data) return { connected: false };
  const r = data as StatusRow;
  return {
    connected: true,
    accountUpn: r.account_upn,
    accountName: r.account_name,
    connectedAt: r.connected_at,
    lastUsedAt: r.last_used_at,
    lastError: r.last_error,
    scopes: r.scopes.split(" ").filter(Boolean),
  };
}

export async function saveConnection(
  admin: SupabaseClient,
  encKey: Buffer,
  c: { userId: string; refreshToken: string; accountUpn: string | null; accountName: string | null; scopes: string },
): Promise<void> {
  const { error } = await admin.from(TABLE).upsert(
    {
      user_id: c.userId,
      refresh_token_enc: encryptSecret(c.refreshToken, encKey),
      account_upn: c.accountUpn,
      account_name: c.accountName,
      scopes: c.scopes,
      connected_at: new Date().toISOString(),
      last_used_at: null,
      last_error: null,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`ms_connections 저장 실패: ${error.message}`);
  tokenCache.delete(c.userId);
}

export async function deleteConnection(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from(TABLE).delete().eq("user_id", userId);
  if (error) throw new Error(`ms_connections 삭제 실패: ${error.message}`);
  tokenCache.delete(userId);
}

export interface TokenDeps {
  app: MsAppConfig;
  encKey: Buffer;
  fetchImpl?: FetchLike;
  now?: () => number;
}

async function markError(admin: SupabaseClient, userId: string, code: string): Promise<void> {
  const { error } = await admin.from(TABLE).update({ last_error: code }).eq("user_id", userId);
  if (error) console.error("[ms] ms_connections last_error 기록 실패:", error.message);
}

/**
 * 사용자 위임 access 토큰. 순서: 행 없음 → NotConnectedError / 캐시 히트 → 반환 / refresh 발급 → 캐시·last_used_at·(새 refresh면 교체).
 * invalid_grant 계열·복호화 실패는 last_error를 남기고 ReconnectRequiredError.
 */
export async function getAccessTokenForUser(admin: SupabaseClient, userId: string, deps: TokenDeps): Promise<string> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const { data, error } = await admin.from(TABLE).select("refresh_token_enc").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`ms_connections 조회 실패: ${error.message}`);
  if (!data) throw new NotConnectedError();

  const cached = tokenCache.get(userId);
  if (cached && cached.exp > now()) return cached.token;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret((data as { refresh_token_enc: string }).refresh_token_enc, deps.encKey);
  } catch {
    await markError(admin, userId, "decrypt");
    throw new ReconnectRequiredError("decrypt");
  }

  let tok;
  try {
    tok = await refreshAccessToken(deps.app, refreshToken, fetchImpl);
  } catch (e) {
    if (e instanceof OAuthError && RECONNECT_CODES.has(e.code)) {
      await markError(admin, userId, e.code);
      throw new ReconnectRequiredError(e.code);
    }
    throw e;
  }

  const ttl = Math.max(0, Math.min(tok.expiresIn * 1000 - TOKEN_SKEW_MS, TOKEN_CACHE_MAX_MS));
  tokenCache.set(userId, { token: tok.accessToken, exp: now() + ttl });

  const patch: Record<string, unknown> = { last_used_at: new Date(now()).toISOString(), last_error: null };
  if (tok.refreshToken && tok.refreshToken !== refreshToken) patch.refresh_token_enc = encryptSecret(tok.refreshToken, deps.encKey);
  const { error: upErr } = await admin.from(TABLE).update(patch).eq("user_id", userId);
  if (upErr) console.error("[ms] ms_connections 갱신 실패:", upErr.message); // 토큰은 이미 받았으니 진행

  return tok.accessToken;
}
```

- [ ] **Step 4: 테스트·타입·린트 통과 확인**

Run: `cd frontend && npm test -- ms-connections && npx tsc --noEmit -p . && npm run lint`
Expected: 10 tests PASS. tsc·lint 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/ms/connections.ts frontend/src/lib/__tests__/ms-connections.test.ts
git commit -m "feat(ms): ms_connections 저장·해제·상태와 refresh 기반 access 토큰 발급(5분 캐시, 재연결 오류 분류)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 5: Graph 드라이브 — 공유 링크 해석·업로드 (`lib/ms/graph-drive.ts`)

**Files:**
- Create: `frontend/src/lib/ms/graph-drive.ts`
- Test: `frontend/src/lib/__tests__/ms-graph-drive.test.ts`

**Interfaces:**
- Consumes: `GRAPH_BASE`(`@/lib/teams-graph`), `FetchLike`.
- Produces: `GraphError(status, code, message, requestId)`, `FolderResolveError(status, message)`, `encodeShareUrl(url): string`, `RETRY_STATUSES`, `retryDelayMs(retryAfter: string | null): number`, `Sleep`, `fetchWithRetry(fetchImpl, url, init, sleep?)`, `ResolvedFolder { driveId; itemId; name; webUrl }`, `resolveFolder(token, url, fetchImpl?, sleep?)`, `SMALL_UPLOAD_MAX = 4 MiB`, `CHUNK_SIZE = 10 MiB`, `XLSX_MIME`, `UploadTarget { driveId; itemId; fileName; buffer: Buffer; contentType? }`, `UploadedItem { id; name; webUrl; size }`, `uploadFile(token, target, fetchImpl?, sleep?)`.

- [ ] **Step 1: 실패하는 테스트 작성 — `frontend/src/lib/__tests__/ms-graph-drive.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  encodeShareUrl, resolveFolder, uploadFile, fetchWithRetry, retryDelayMs, GraphError, FolderResolveError, SMALL_UPLOAD_MAX, CHUNK_SIZE, XLSX_MIME,
} from "@/lib/ms/graph-drive";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const noSleep = vi.fn(async () => undefined);
const FOLDER_URL = "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026/%EC%A0%9C%EC%95%88";
const folderItem = { id: "01ITEM", name: "제안", webUrl: FOLDER_URL, folder: { childCount: 3 }, parentReference: { driveId: "b!drive" } };
const target = { driveId: "b!drive", itemId: "01ITEM", fileName: "(한국석유공사) 사업_요구사항 검토_20260905.xlsx" };

describe("encodeShareUrl", () => {
  it("u! + base64url(패딩 없음, +/ 대신 -_)", () => {
    expect(encodeShareUrl(FOLDER_URL)).toBe("u!aHR0cHM6Ly9pbm5vZ3JpZC5zaGFyZXBvaW50LmNvbS9zaXRlcy9SRlAvU2hhcmVkJTIwRG9jdW1lbnRzLzIwMjYvJUVDJUEwJTlDJUVDJTk1JTg4");
    expect(encodeShareUrl("https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1")).toBe("u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx");
    expect(encodeShareUrl("https://a/b?c=d&e=f/g+h")).not.toMatch(/[+/=]/);
  });
});

describe("retryDelayMs / fetchWithRetry", () => {
  it("Retry-After 없으면 2초, 있으면 초 단위, 최대 5초", () => {
    expect(retryDelayMs(null)).toBe(2000);
    expect(retryDelayMs("1")).toBe(1000);
    expect(retryDelayMs("10")).toBe(5000);
    expect(retryDelayMs("abc")).toBe(2000);
    expect(retryDelayMs("0")).toBe(2000);
  });
  it("429·503은 한 번만 재시도하고, 다른 상태는 바로 돌려준다", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "1" } })).mockResolvedValueOnce(json(200, { ok: 1 }));
    const res = await fetchWithRetry(fetchImpl, "https://g/x", { method: "GET" }, sleep);
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);

    const twice = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const res2 = await fetchWithRetry(twice, "https://g/x", {}, sleep);
    expect(res2.status).toBe(503);
    expect(twice).toHaveBeenCalledTimes(2);

    const once = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await fetchWithRetry(once, "https://g/x", {}, sleep);
    expect(once).toHaveBeenCalledTimes(1);
  });
});

describe("resolveFolder", () => {
  it("shares/{enc}/driveItem을 Bearer로 조회해 driveId·itemId·name·webUrl", async () => {
    const fetchImpl = vi.fn(async () => json(200, folderItem));
    expect(await resolveFolder("AT", FOLDER_URL, fetchImpl, noSleep)).toEqual({ driveId: "b!drive", itemId: "01ITEM", name: "제안", webUrl: FOLDER_URL });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(FOLDER_URL)}/driveItem?$select=id,name,webUrl,folder,parentReference`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });
  it("folder 패싯이 없으면(파일 링크) FolderResolveError 400", async () => {
    const { folder: _f, ...file } = folderItem;
    const fetchImpl = vi.fn(async () => json(200, { ...file, file: { mimeType: "x" } }));
    await expect(resolveFolder("AT", FOLDER_URL, fetchImpl, noSleep)).rejects.toMatchObject({ status: 400, message: "폴더 링크가 아닙니다. 파일이 아닌 폴더의 링크를 붙여 주세요." });
  });
  it("404·400은 '링크를 해석할 수 없습니다', 403은 '볼 권한이 없습니다'", async () => {
    const mk = (status: number) => vi.fn(async () => json(status, { error: { code: "itemNotFound", message: "x" } }));
    await expect(resolveFolder("AT", FOLDER_URL, mk(404), noSleep)).rejects.toMatchObject({ status: 400, message: "링크를 해석할 수 없습니다. 폴더의 '링크 복사'를 사용하세요." });
    await expect(resolveFolder("AT", FOLDER_URL, mk(400), noSleep)).rejects.toBeInstanceOf(FolderResolveError);
    await expect(resolveFolder("AT", FOLDER_URL, mk(403), noSleep)).rejects.toMatchObject({ status: 403, message: "이 폴더를 볼 권한이 없습니다." });
  });
  it("5xx는 GraphError(status, code, requestId)", async () => {
    const fetchImpl = vi.fn(async () => json(500, { error: { code: "generalException", message: "boom" } }, { "request-id": "req-1" }));
    const err = await resolveFolder("AT", FOLDER_URL, fetchImpl, noSleep).catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err).toMatchObject({ status: 500, code: "generalException", message: "boom", requestId: "req-1" });
  });
});

describe("uploadFile", () => {
  const item = { id: "01FILE", name: target.fileName, webUrl: "https://innogrid.sharepoint.com/sites/RFP/x.xlsx", size: 1234 };
  it("4MiB 미만은 :/content?conflictBehavior=replace 로 단순 PUT", async () => {
    const buffer = Buffer.alloc(SMALL_UPLOAD_MAX - 1, 1);
    const fetchImpl = vi.fn(async () => json(201, item));
    expect(await uploadFile("AT", { ...target, buffer }, fetchImpl, noSleep)).toEqual(item);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.microsoft.com/v1.0/drives/b!drive/items/01ITEM:/${encodeURIComponent(target.fileName)}:/content?@microsoft.graph.conflictBehavior=replace`);
    expect(init.method).toBe("PUT");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer AT");
    expect(h["Content-Type"]).toBe(XLSX_MIME);
    expect((init.body as Uint8Array).byteLength).toBe(SMALL_UPLOAD_MAX - 1);
  });
  it("4MiB 이상은 업로드 세션 + 10MiB 청크(25MiB → 10/10/5), 청크 PUT에는 Authorization 없음", async () => {
    const total = 25 * 1024 * 1024;
    const buffer = Buffer.alloc(total, 2);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { uploadUrl: "https://up.sharepoint.com/session/abc" }))
      .mockResolvedValueOnce(json(202, { nextExpectedRanges: ["10485760-"] }))
      .mockResolvedValueOnce(json(202, { nextExpectedRanges: ["20971520-"] }))
      .mockResolvedValueOnce(json(201, item));
    expect(await uploadFile("AT", { ...target, buffer }, fetchImpl, noSleep)).toEqual(item);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [sessUrl, sessInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(sessUrl).toBe(`https://graph.microsoft.com/v1.0/drives/b!drive/items/01ITEM:/${encodeURIComponent(target.fileName)}:/createUploadSession`);
    expect(sessInit.method).toBe("POST");
    expect(JSON.parse(sessInit.body as string)).toEqual({ item: { "@microsoft.graph.conflictBehavior": "replace", name: target.fileName } });
    const ranges = fetchImpl.mock.calls.slice(1).map((c) => (c as [string, RequestInit])[1]);
    expect(fetchImpl.mock.calls.slice(1).every((c) => (c as [string])[0] === "https://up.sharepoint.com/session/abc")).toBe(true);
    expect(ranges.map((r) => (r.headers as Record<string, string>)["Content-Range"])).toEqual([`bytes 0-10485759/${total}`, `bytes 10485760-20971519/${total}`, `bytes 20971520-26214399/${total}`]);
    expect(ranges.map((r) => (r.body as Uint8Array).byteLength)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 5 * 1024 * 1024]);
    expect(ranges.every((r) => !(r.headers as Record<string, string>).Authorization)).toBe(true);
  });
  it("정확히 4MiB는 세션 경로(세션 1 + 청크 1)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, { uploadUrl: "https://up/s" })).mockResolvedValueOnce(json(201, item));
    await uploadFile("AT", { ...target, buffer: Buffer.alloc(SMALL_UPLOAD_MAX) }, fetchImpl, noSleep);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("423(잠김)·403은 GraphError로 상태·코드를 보존한다", async () => {
    const fetchImpl = vi.fn(async () => json(423, { error: { code: "resourceLocked", message: "locked" } }, { "request-id": "r-2" }));
    await expect(uploadFile("AT", { ...target, buffer: Buffer.alloc(10) }, fetchImpl, noSleep)).rejects.toMatchObject({ status: 423, code: "resourceLocked", requestId: "r-2" });
  });
  it("세션 응답에 uploadUrl이 없으면 GraphError(no_upload_url)", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    await expect(uploadFile("AT", { ...target, buffer: Buffer.alloc(SMALL_UPLOAD_MAX) }, fetchImpl, noSleep)).rejects.toMatchObject({ code: "no_upload_url" });
  });
  it("429는 Retry-After 뒤 한 번 재시도해 성공하면 정상 반환", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "3" } })).mockResolvedValueOnce(json(201, item));
    expect(await uploadFile("AT", { ...target, buffer: Buffer.alloc(10) }, fetchImpl, sleep)).toEqual(item);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test -- ms-graph-drive`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `frontend/src/lib/ms/graph-drive.ts` 작성**

```ts
/**
 * Microsoft Graph 드라이브(위임 토큰) — 공유 링크 → 폴더 해석, 파일 업로드(스펙 §4·§5.2).
 * 4MiB 미만은 단순 PUT(conflictBehavior=replace), 이상은 업로드 세션 + 10MiB 청크.
 * 429·503은 Retry-After(기본 2초, 최대 5초) 뒤 1회 재시도. 토큰은 로그에 쓰지 않는다.
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Graph 응답 request-id 헤더 — 지원 문의용, 로그에 남긴다 */
    public readonly requestId: string | null,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

/** 사용자에게 그대로 보여줄 폴더 링크 오류(400 형식/파일 링크/해석 불가, 403 권한) */
export class FolderResolveError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "FolderResolveError";
  }
}

/** shares API 규격: "u!" + base64url(url) — 패딩 제거, + → -, / → _ */
export function encodeShareUrl(url: string): string {
  return "u!" + Buffer.from(url, "utf8").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function readGraphError(res: Response): Promise<GraphError> {
  const requestId = res.headers.get("request-id");
  let code = `http_${res.status}`;
  let message = `Graph ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    if (j.error?.code) code = j.error.code;
    if (j.error?.message) message = j.error.message;
  } catch {
    // 본문 없음
  }
  return new GraphError(res.status, code, message, requestId);
}

export type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RETRY_STATUSES = new Set([429, 503]);

export function retryDelayMs(retryAfter: string | null): number {
  const s = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(s) || s <= 0) return 2000;
  return Math.min(s, 5) * 1000;
}

/** 429·503이면 Retry-After 뒤 같은 요청을 한 번 더 보낸다(두 번째 응답을 그대로 돌려준다) */
export async function fetchWithRetry(fetchImpl: FetchLike, url: string, init: RequestInit, sleep: Sleep = defaultSleep): Promise<Response> {
  const first = await fetchImpl(url, init);
  if (!RETRY_STATUSES.has(first.status)) return first;
  await sleep(retryDelayMs(first.headers.get("Retry-After")));
  return fetchImpl(url, init);
}

export interface ResolvedFolder {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
}

const RESOLVE_FAIL = "링크를 해석할 수 없습니다. 폴더의 '링크 복사'를 사용하세요.";

/** GET /shares/{u!…}/driveItem — 폴더가 아니면·해석 불가·권한 없음은 FolderResolveError, 그 외 실패는 GraphError */
export async function resolveFolder(token: string, url: string, fetchImpl: FetchLike = fetch, sleep: Sleep = defaultSleep): Promise<ResolvedFolder> {
  const res = await fetchWithRetry(
    fetchImpl,
    `${GRAPH_BASE}/shares/${encodeShareUrl(url)}/driveItem?$select=id,name,webUrl,folder,parentReference`,
    { headers: { Authorization: `Bearer ${token}` } },
    sleep,
  );
  if (!res.ok) {
    const err = await readGraphError(res);
    if (res.status === 403) throw new FolderResolveError(403, "이 폴더를 볼 권한이 없습니다.");
    if (res.status === 400 || res.status === 404) throw new FolderResolveError(400, RESOLVE_FAIL);
    throw err;
  }
  const j = (await res.json()) as { id?: string; name?: string; webUrl?: string; folder?: unknown; parentReference?: { driveId?: string } };
  if (!j.folder) throw new FolderResolveError(400, "폴더 링크가 아닙니다. 파일이 아닌 폴더의 링크를 붙여 주세요.");
  if (!j.id || !j.parentReference?.driveId) throw new FolderResolveError(400, RESOLVE_FAIL);
  return { driveId: j.parentReference.driveId, itemId: j.id, name: j.name ?? "", webUrl: j.webUrl ?? "" };
}

export const SMALL_UPLOAD_MAX = 4 * 1024 * 1024;
export const CHUNK_SIZE = 10 * 1024 * 1024;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface UploadTarget {
  driveId: string;
  itemId: string;
  fileName: string;
  buffer: Buffer;
  contentType?: string;
}

export interface UploadedItem {
  id: string;
  name: string;
  webUrl: string;
  size: number;
}

function itemUrl(t: UploadTarget, suffix: string): string {
  return `${GRAPH_BASE}/drives/${encodeURIComponent(t.driveId)}/items/${encodeURIComponent(t.itemId)}:/${encodeURIComponent(t.fileName)}:/${suffix}`;
}

function toItem(j: Record<string, unknown>): UploadedItem {
  return { id: String(j.id ?? ""), name: String(j.name ?? ""), webUrl: String(j.webUrl ?? ""), size: Number(j.size ?? 0) };
}

/** 폴더(driveId/itemId) 아래에 fileName으로 올린다. 같은 이름은 덮어쓴다(SharePoint 버전 이력 보존). */
export async function uploadFile(token: string, t: UploadTarget, fetchImpl: FetchLike = fetch, sleep: Sleep = defaultSleep): Promise<UploadedItem> {
  const auth = { Authorization: `Bearer ${token}` };
  const contentType = t.contentType ?? XLSX_MIME;

  if (t.buffer.length < SMALL_UPLOAD_MAX) {
    const res = await fetchWithRetry(
      fetchImpl,
      itemUrl(t, "content?@microsoft.graph.conflictBehavior=replace"),
      { method: "PUT", headers: { ...auth, "Content-Type": contentType }, body: new Uint8Array(t.buffer) },
      sleep,
    );
    if (!res.ok) throw await readGraphError(res);
    return toItem((await res.json()) as Record<string, unknown>);
  }

  const sess = await fetchWithRetry(
    fetchImpl,
    itemUrl(t, "createUploadSession"),
    { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace", name: t.fileName } }) },
    sleep,
  );
  if (!sess.ok) throw await readGraphError(sess);
  const { uploadUrl } = (await sess.json()) as { uploadUrl?: string };
  if (!uploadUrl) throw new GraphError(502, "no_upload_url", "업로드 세션 응답에 uploadUrl이 없습니다.", sess.headers.get("request-id"));

  const total = t.buffer.length;
  let last: Response | null = null;
  for (let start = 0; start < total; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, total) - 1;
    // uploadUrl은 사전 인증된 URL — Authorization을 붙이면 401이 난다(Graph 규격)
    last = await fetchWithRetry(
      fetchImpl,
      uploadUrl,
      { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end}/${total}` }, body: new Uint8Array(t.buffer.subarray(start, end + 1)) },
      sleep,
    );
    if (!last.ok) throw await readGraphError(last);
  }
  if (!last || (last.status !== 200 && last.status !== 201)) {
    throw new GraphError(last?.status ?? 502, "incomplete", "업로드 세션이 완료되지 않았습니다.", last?.headers.get("request-id") ?? null);
  }
  return toItem((await last.json()) as Record<string, unknown>);
}
```

- [ ] **Step 4: 테스트·타입·린트 통과 확인**

Run: `cd frontend && npm test -- ms-graph-drive && npx tsc --noEmit -p . && npm run lint`
Expected: 13 tests PASS. tsc·lint 오류 없음. (25MiB 버퍼 테스트는 수 초 걸릴 수 있다.)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/ms/graph-drive.ts frontend/src/lib/__tests__/ms-graph-drive.test.ts
git commit -m "feat(ms): Graph shares 링크 → 폴더 해석, 드라이브 업로드(4MiB 단순 PUT·세션 10MiB 청크·replace), 429/503 재시도

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---
### Task 6: 공용 워크북 빌더 + 파일명 KST 날짜 (`lib/rfp/sharepoint.ts`, `xlsx.ts`, xlsx 라우트)

**Files:**
- Modify: `frontend/src/lib/rfp/xlsx.ts:200-206` (`xlsxFileName`)
- Create: `frontend/src/lib/rfp/sharepoint.ts` (이 태스크에서는 `buildProjectWorkbook`만; Task 7이 업로드 절차를 덧붙인다)
- Modify: `frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts` (본문을 `buildProjectWorkbook` 호출로 축소)
- Test: `frontend/src/lib/__tests__/rfp-xlsx.test.ts` (`xlsxFileName` describe에 KST 케이스 추가)

**Interfaces:**
- Consumes: `buildWorkbook`, `xlsxFileName`, `XlsxProject`, `XlsxMapping`(xlsx.ts); `PROJECT_COLUMNS`, `ProjectDbRow`, `MAPPING_COLUMNS`, `mapMapping`, `toRequirementRow`, `MappingDbRow`, `RequirementDbRow`(mappers); `loadCatalog`(`./catalog/store`); `selectAll`(`../work-metrics/common`).
- Produces: `kstYmd(date: Date): string`(xlsx.ts), `buildProjectWorkbook(admin: SupabaseClient, project: ProjectDbRow, now: Date = new Date()): Promise<{ buffer: Buffer; fileName: string }>`(sharepoint.ts). DB 오류·카탈로그 오류는 `Error`로 던진다(라우트가 500).
- 스펙 §5.1의 반환 필드 `project`는 두지 않는다 — 호출자가 이미 `ProjectDbRow`를 갖고 있어 중복이다(업로드 절차는 status·sharepoint_folder 검사에 그 행을 그대로 쓴다).

- [ ] **Step 1: 실패하는 테스트 추가 — `frontend/src/lib/__tests__/rfp-xlsx.test.ts`의 `describe("xlsxFileName")` 안에 케이스 추가**

```ts
  it("날짜는 KST 기준 — UTC 15:30은 KST 다음날 00:30", () => {
    expect(xlsxFileName({ ...project, agency: null, name: "A" }, new Date("2026-09-03T15:30:00Z"))).toBe("A_요구사항 검토_20260904.xlsx");
    expect(xlsxFileName({ ...project, agency: null, name: "A" }, new Date("2026-09-03T14:59:59Z"))).toBe("A_요구사항 검토_20260903.xlsx");
    expect(kstYmd(new Date("2026-12-31T15:00:00Z"))).toBe("20270101");
  });
```

import 줄을 `import { buildWorkbook, kstYmd, xlsxFileName, type XlsxProject } from "@/lib/rfp/xlsx";` 로 바꾼다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test -- rfp-xlsx`
Expected: FAIL — `kstYmd` export 없음(그리고 UTC 환경이라면 20260903 ≠ 20260904).

- [ ] **Step 3: `frontend/src/lib/rfp/xlsx.ts`의 `xlsxFileName`을 KST로**

기존 `xlsxFileName` 함수를 아래 두 함수로 교체한다.

```ts
/** KST(Asia/Seoul) 기준 YYYYMMDD. Vercel은 UTC라 서버 로컬 날짜를 쓰면 밤 시간대에 하루 어긋난다(3단계 스펙 §5.2). */
export function kstYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}${pick("month")}${pick("day")}`;
}

/** "(발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx" — 파일명 금지 문자는 _, 날짜는 KST */
export function xlsxFileName(project: XlsxProject, date = new Date()): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const prefix = project.agency ? `(${safe(project.agency)}) ` : "";
  return `${prefix}${safe(project.name)}_요구사항 검토_${kstYmd(date)}.xlsx`;
}
```

- [ ] **Step 4: `frontend/src/lib/rfp/sharepoint.ts` 작성(공용 빌더)**

```ts
/**
 * 3단계 — SharePoint 등록(스펙 §5). xlsx 다운로드 라우트와 SharePoint 업로드가 같은 buildProjectWorkbook을 써서
 * 같은 바이트·같은 파일명을 만든다. 순수 로직은 fetch/토큰/빌더 주입으로 테스트한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCatalog } from "./catalog/store";
import { MAPPING_COLUMNS, mapMapping, toRequirementRow, type MappingDbRow, type ProjectDbRow, type RequirementDbRow } from "./mappers";
import { buildWorkbook, xlsxFileName, type XlsxMapping, type XlsxProject } from "./xlsx";
import { selectAll } from "../work-metrics/common";

/** 프로젝트 행 → 요구사항·매핑·카탈로그를 읽어 워크북 버퍼와 파일명(KST 날짜). 실패는 Error(라우트가 500). */
export async function buildProjectWorkbook(admin: SupabaseClient, project: ProjectDbRow, now: Date = new Date()): Promise<{ buffer: Buffer; fileName: string }> {
  const { data: reqs, error } = await admin.from("rfp_requirements").select("*").eq("project_id", project.id).order("sort_order");
  if (error) throw new Error(error.message);

  const mapsRes = await selectAll<MappingDbRow>(() =>
    admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS, { count: "exact" }).eq("project_id", project.id).order("sort_order").order("id"),
  );
  if (mapsRes.error) throw new Error(mapsRes.error.message);

  // 매핑 행이 있거나 매핑을 한 번이라도 실행했으면(수동 행만 있어도) 매핑 열·시트를 넣는다(2단계 최종 리뷰 반영).
  let mapping: XlsxMapping | undefined;
  if (mapsRes.data.length > 0 || project.mapping_status !== "none") {
    const catalog = await loadCatalog(admin);
    mapping = { rows: mapsRes.data.map(mapMapping), catalog, mappingAt: project.mapping_at };
  }

  const xlsxProject: XlsxProject = { name: project.name, agency: project.agency, period: project.period, budget: project.budget, bidMethod: project.bid_method, extra: project.extra ?? {} };
  const buffer = await buildWorkbook(xlsxProject, ((reqs ?? []) as RequirementDbRow[]).map(toRequirementRow), mapping);
  return { buffer, fileName: xlsxFileName(xlsxProject, now) };
}
```

- [ ] **Step 5: `frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts` 전체 교체**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { PROJECT_COLUMNS, type ProjectDbRow } from "@/lib/rfp/mappers";
import { buildProjectWorkbook } from "@/lib/rfp/sharepoint";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/rfp/projects/[id]/xlsx — 샘플과 같은 시트 구성의 엑셀. SharePoint 업로드(3단계)와 같은 buildProjectWorkbook을 쓴다. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: project, error } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  let built: { buffer: Buffer; fileName: string };
  try {
    built = await buildProjectWorkbook(auth.admin, project as ProjectDbRow);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "엑셀을 만들지 못했습니다." }, { status: 500 });
  }
  return new NextResponse(new Uint8Array(built.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="requirements.xlsx"; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 6: 테스트·타입·린트 통과 확인**

Run: `cd frontend && npm test -- rfp-xlsx && npx tsc --noEmit -p . && npm run lint`
Expected: rfp-xlsx 8 tests PASS(기존 7 + KST 1). tsc·lint 오류 없음.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/rfp/xlsx.ts frontend/src/lib/rfp/sharepoint.ts "frontend/src/app/api/rfp/projects/[id]/xlsx/route.ts" frontend/src/lib/__tests__/rfp-xlsx.test.ts
git commit -m "refactor(rfp): xlsx 라우트 본문을 buildProjectWorkbook으로 분리(SharePoint 업로드 공용), 파일명 날짜를 KST로

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 7: 업로드 절차·알림 문구·이력 조회 (`lib/rfp/sharepoint.ts` 확장)

**Files:**
- Modify: `frontend/src/lib/rfp/sharepoint.ts` (Task 6 파일에 추가)
- Test: `frontend/src/lib/__tests__/rfp-sharepoint.test.ts`

**Interfaces:**
- Consumes: `getAccessTokenForUser`, `NotConnectedError`, `ReconnectRequiredError`(Task 4); `uploadFile`, `GraphError`, `UploadedItem`(Task 5); `MsAppConfig`(Task 3); `parseSharepointFolder`, `SHAREPOINT_UPLOAD_COLUMNS`, `SharepointUploadDbRow`, `mapSharepointUpload`, `PROJECT_COLUMNS`, `ProjectDbRow`(Task 1); `creatorNames`(`./creators`); `Notifier`, `ChannelMessage`, `FetchLike`(`@/lib/notify/types`); `RfpSharepointUpload`, `SharepointErrorCode`, `UploadResponse`(types/rfp).
- Produces: `SharepointFlowError(status, message, code?)`, `buildUploadNotice({projectName, userName, folderName, fileName, webUrl}): ChannelMessage`, `mapGraphUploadError(e: unknown): SharepointFlowError`, `UploadFlowDeps`, `uploadProjectXlsx(admin, projectId, userId, deps): Promise<UploadResponse>`, `loadUploads(admin, projectId, limit = 20): Promise<RfpSharepointUpload[]>`.
- DB 접근 형태(가짜 admin이 흉내 내는 체인): `admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle()`, `admin.from("rfp_sharepoint_uploads").insert(row).select(SHAREPOINT_UPLOAD_COLUMNS).single()`, `admin.from("rfp_sharepoint_uploads").select(cols).eq("project_id", id).order("created_at", { ascending: false }).limit(n)`.

- [ ] **Step 1: 실패하는 테스트 작성 — `frontend/src/lib/__tests__/rfp-sharepoint.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildUploadNotice, mapGraphUploadError, uploadProjectXlsx, SharepointFlowError, type UploadFlowDeps } from "@/lib/rfp/sharepoint";
import { GraphError } from "@/lib/ms/graph-drive";
import { NotConnectedError, ReconnectRequiredError } from "@/lib/ms/connections";
import type { Notifier } from "@/lib/notify/types";
import type { ProjectDbRow } from "@/lib/rfp/mappers";

const folder = { url: "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026", driveId: "b!drive", itemId: "01ITEM", name: "2026", webUrl: "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026", setBy: "u-9", setAt: "2026-09-05T01:00:00.000Z" };
const project: ProjectDbRow = {
  id: "p-1", name: "생성형 AI 플랫폼 구축", agency: "한국석유공사", period: null, budget: null, bid_method: null, extra: {}, status: "ready", extraction_method: "standard", error: null, warnings: [],
  requirement_count: 3, created_by: "u-9", created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", mapping_status: "ready", mapping_error: null, mapping_warnings: [], mapping_at: null, sharepoint_folder: folder,
};
const FILE = "(한국석유공사) 생성형 AI 플랫폼 구축_요구사항 검토_20260905.xlsx";
const item = { id: "01FILE", name: FILE, webUrl: "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026/x.xlsx", size: 4 };

function fakeAdmin(row: ProjectDbRow | null) {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      if (table === "rfp_projects") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) };
      if (table === "rfp_sharepoint_uploads") {
        return {
          insert: (r: Record<string, unknown>) => {
            inserted.push(r);
            return { select: () => ({ single: async () => ({ data: { id: "up-1", ...r, created_at: "2026-09-05T03:00:00.000Z" }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
  return { admin, inserted };
}

function fakeNotifier(configured: boolean, result: { ok: boolean; error?: string } = { ok: true }) {
  const sendChannel = vi.fn(async () => result);
  const notifier = { provider: "teams", channelConfigured: configured, directConfigured: false, sendChannel, sendDirect: vi.fn() } as unknown as Notifier;
  return { notifier, sendChannel };
}

function deps(over: Partial<UploadFlowDeps> = {}): UploadFlowDeps {
  return {
    app: { tenantId: "t", clientId: "c", clientSecret: "s" },
    encKey: Buffer.alloc(32, 1),
    userName: "강승욱",
    notifier: fakeNotifier(true).notifier,
    getToken: vi.fn(async () => "AT"),
    build: vi.fn(async () => ({ buffer: Buffer.from("xlsx"), fileName: FILE })),
    upload: vi.fn(async () => item),
    ...over,
  };
}

describe("buildUploadNotice", () => {
  it("제목 'RFP 분석', 본문 [RFP] … — 사용자 · 폴더 / 파일명 / URL", () => {
    expect(buildUploadNotice({ projectName: "생성형 AI 플랫폼 구축", userName: "강승욱", folderName: "2026", fileName: FILE, webUrl: item.webUrl })).toEqual({
      title: "RFP 분석",
      text: `[RFP] 생성형 AI 플랫폼 구축 요구사항 검토 파일을 SharePoint에 올렸습니다 — 강승욱 · 2026\n${FILE}\n${item.webUrl}`,
    });
  });
});

describe("mapGraphUploadError", () => {
  const g = (status: number) => new GraphError(status, "code", "msg", "req");
  it("403·404·423·그 외 Graph·비Graph 오류를 스펙 §9 문구로", () => {
    expect(mapGraphUploadError(g(403))).toMatchObject({ status: 403, message: "이 폴더에 쓸 권한이 없습니다." });
    expect(mapGraphUploadError(g(404))).toMatchObject({ status: 404, message: "폴더가 없습니다(삭제·이동). 링크를 다시 지정하세요." });
    expect(mapGraphUploadError(g(423))).toMatchObject({ status: 409, message: "파일이 열려 있어 덮어쓸 수 없습니다. 잠시 뒤 다시 시도하세요." });
    expect(mapGraphUploadError(g(500))).toMatchObject({ status: 502, message: "SharePoint 응답 오류(500)" });
    expect(mapGraphUploadError(g(429))).toMatchObject({ status: 502, message: "SharePoint 응답 오류(429)" });
    expect(mapGraphUploadError(new Error("socket hang up"))).toMatchObject({ status: 502, message: "socket hang up" });
    expect(mapGraphUploadError(g(403))).toBeInstanceOf(SharepointFlowError);
  });
});

describe("uploadProjectXlsx", () => {
  it("프로젝트 없음 404, 추출 미완 400, 폴더 없음 400 no_folder — 토큰·빌드는 부르지 않는다", async () => {
    const d = deps();
    await expect(uploadProjectXlsx(fakeAdmin(null).admin, "p-x", "u-1", d)).rejects.toMatchObject({ status: 404 });
    await expect(uploadProjectXlsx(fakeAdmin({ ...project, status: "extracting" }).admin, "p-1", "u-1", d)).rejects.toMatchObject({ status: 400, message: "요구사항 추출이 끝난 뒤 업로드할 수 있습니다." });
    await expect(uploadProjectXlsx(fakeAdmin({ ...project, sharepoint_folder: null }).admin, "p-1", "u-1", d)).rejects.toMatchObject({ status: 400, code: "no_folder" });
    expect(d.getToken).not.toHaveBeenCalled();
    expect(d.build).not.toHaveBeenCalled();
  });
  it("미연결 400 not_connected, 재연결 필요 409 reconnect", async () => {
    await expect(uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ getToken: vi.fn(async () => { throw new NotConnectedError(); }) }))).rejects.toMatchObject({ status: 400, code: "not_connected" });
    await expect(uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ getToken: vi.fn(async () => { throw new ReconnectRequiredError("invalid_grant"); }) }))).rejects.toMatchObject({ status: 409, code: "reconnect" });
  });
  it("성공: 토큰 → 빌드 → 폴더에 업로드 → 이력 insert → 알림, 응답 {upload, notified:true}", async () => {
    const { admin, inserted } = fakeAdmin(project);
    const { notifier, sendChannel } = fakeNotifier(true);
    const d = deps({ notifier, now: () => new Date("2026-09-05T03:00:00Z") });
    const res = await uploadProjectXlsx(admin, "p-1", "u-1", d);
    expect(d.getToken).toHaveBeenCalledWith(admin, "u-1", { app: d.app, encKey: d.encKey, fetchImpl: undefined });
    expect(d.build).toHaveBeenCalledWith(admin, project, new Date("2026-09-05T03:00:00Z"));
    expect(d.upload).toHaveBeenCalledTimes(1);
    const [token, target] = (d.upload as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { driveId: string; itemId: string; fileName: string; buffer: Buffer }];
    expect(token).toBe("AT");
    expect(target).toMatchObject({ driveId: "b!drive", itemId: "01ITEM", fileName: FILE });
    expect(target.buffer.toString()).toBe("xlsx");
    expect(inserted).toEqual([{ project_id: "p-1", drive_id: "b!drive", item_id: "01FILE", file_name: FILE, web_url: item.webUrl, size_bytes: 4, uploaded_by: "u-1" }]);
    expect(res).toEqual({ upload: { id: "up-1", fileName: FILE, webUrl: item.webUrl, sizeBytes: 4, uploadedBy: { id: "u-1", name: "강승욱" }, createdAt: "2026-09-05T03:00:00.000Z" }, notified: true });
    expect(sendChannel).toHaveBeenCalledWith(buildUploadNotice({ projectName: project.name, userName: "강승욱", folderName: "2026", fileName: FILE, webUrl: item.webUrl }));
  });
  it("웹후크 미설정이면 알림을 부르지 않고 notified:false(notifyError 없음)", async () => {
    const { notifier, sendChannel } = fakeNotifier(false);
    const res = await uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ notifier }));
    expect(res.notified).toBe(false);
    expect("notifyError" in res).toBe(false);
    expect(sendChannel).not.toHaveBeenCalled();
  });
  it("알림 실패는 업로드 성공에 영향 없이 notified:false + notifyError", async () => {
    const { notifier } = fakeNotifier(true, { ok: false, error: "teams hook: 500 boom" });
    const res = await uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ notifier }));
    expect(res).toMatchObject({ notified: false, notifyError: "teams hook: 500 boom" });
    expect(res.upload.fileName).toBe(FILE);
  });
  it("Graph 업로드 실패는 §9 문구로 바뀌고 이력은 남지 않는다", async () => {
    const { admin, inserted } = fakeAdmin(project);
    const upload = vi.fn(async () => { throw new GraphError(423, "resourceLocked", "locked", "r-1"); });
    await expect(uploadProjectXlsx(admin, "p-1", "u-1", deps({ upload }))).rejects.toMatchObject({ status: 409, message: "파일이 열려 있어 덮어쓸 수 없습니다. 잠시 뒤 다시 시도하세요." });
    expect(inserted).toEqual([]);
  });
  it("Graph가 이름·크기를 비워 보내면 파일명·버퍼 길이로 채운다", async () => {
    const a = fakeAdmin(project);
    await uploadProjectXlsx(a.admin, "p-1", "u-1", deps({ upload: vi.fn(async () => ({ ...item, name: "", size: 0 })) }));
    expect(a.inserted[0]).toMatchObject({ file_name: FILE, size_bytes: 4 });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test -- rfp-sharepoint.test`
Expected: FAIL — `buildUploadNotice` 등 export 없음.

- [ ] **Step 3: `frontend/src/lib/rfp/sharepoint.ts`에 업로드 절차 추가**

파일 상단 import를 아래로 바꾸고(Task 6 import 포함), `buildProjectWorkbook` 아래에 이어서 붙인다.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessTokenForUser, NotConnectedError, ReconnectRequiredError } from "@/lib/ms/connections";
import { GraphError, uploadFile, type UploadedItem } from "@/lib/ms/graph-drive";
import type { MsAppConfig } from "@/lib/ms/oauth";
import type { ChannelMessage, FetchLike, Notifier } from "@/lib/notify/types";
import type { RfpSharepointUpload, SharepointErrorCode, UploadResponse } from "@/types/rfp";
import { loadCatalog } from "./catalog/store";
import { creatorNames } from "./creators";
import {
  MAPPING_COLUMNS, PROJECT_COLUMNS, SHAREPOINT_UPLOAD_COLUMNS, mapMapping, mapSharepointUpload, parseSharepointFolder, toRequirementRow,
  type MappingDbRow, type ProjectDbRow, type RequirementDbRow, type SharepointUploadDbRow,
} from "./mappers";
import { buildWorkbook, xlsxFileName, type XlsxMapping, type XlsxProject } from "./xlsx";
import { selectAll } from "../work-metrics/common";
```

```ts
/** 라우트가 그대로 상태·문구·code로 응답하는 오류(스펙 §7·§9) */
export class SharepointFlowError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: SharepointErrorCode) {
    super(message);
    this.name = "SharepointFlowError";
  }
}

/** Teams 채널 알림 문구(스펙 §5.2 6) */
export function buildUploadNotice(p: { projectName: string; userName: string; folderName: string; fileName: string; webUrl: string }): ChannelMessage {
  return {
    title: "RFP 분석",
    text: `[RFP] ${p.projectName} 요구사항 검토 파일을 SharePoint에 올렸습니다 — ${p.userName} · ${p.folderName}\n${p.fileName}\n${p.webUrl}`,
  };
}

/** Graph 업로드 실패 → 스펙 §9 상태·문구 */
export function mapGraphUploadError(e: unknown): SharepointFlowError {
  if (e instanceof GraphError) {
    if (e.status === 403) return new SharepointFlowError(403, "이 폴더에 쓸 권한이 없습니다.");
    if (e.status === 404) return new SharepointFlowError(404, "폴더가 없습니다(삭제·이동). 링크를 다시 지정하세요.");
    if (e.status === 423) return new SharepointFlowError(409, "파일이 열려 있어 덮어쓸 수 없습니다. 잠시 뒤 다시 시도하세요.");
    return new SharepointFlowError(502, `SharePoint 응답 오류(${e.status})`);
  }
  return new SharepointFlowError(502, e instanceof Error ? e.message : "SharePoint 업로드 실패");
}

export interface UploadFlowDeps {
  app: MsAppConfig;
  encKey: Buffer;
  notifier: Notifier;
  /** 알림 문구·이력 표시용 업로더 이름 */
  userName: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** 테스트 주입용 — 기본은 실제 구현 */
  getToken?: typeof getAccessTokenForUser;
  build?: typeof buildProjectWorkbook;
  upload?: typeof uploadFile;
}

/**
 * 업로드 절차(스펙 §5.2): 프로젝트 검사 → 사용자 토큰 → 워크북 → Graph 업로드(replace) → 이력 insert → Teams 알림(실패해도 성공).
 * 사용자에게 보여줄 실패는 SharepointFlowError, 그 외(OAuthError·DB 오류)는 그대로 던진다.
 */
export async function uploadProjectXlsx(admin: SupabaseClient, projectId: string, userId: string, deps: UploadFlowDeps): Promise<UploadResponse> {
  const getToken = deps.getToken ?? getAccessTokenForUser;
  const build = deps.build ?? buildProjectWorkbook;
  const upload = deps.upload ?? uploadFile;
  const now = deps.now ?? (() => new Date());

  const { data, error } = await admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new SharepointFlowError(404, "프로젝트가 없습니다.");
  const row = data as ProjectDbRow;
  if (row.status !== "ready") throw new SharepointFlowError(400, "요구사항 추출이 끝난 뒤 업로드할 수 있습니다.");
  const folder = parseSharepointFolder(row.sharepoint_folder);
  if (!folder) throw new SharepointFlowError(400, "SharePoint 폴더가 지정되지 않았습니다.", "no_folder");

  let token: string;
  try {
    token = await getToken(admin, userId, { app: deps.app, encKey: deps.encKey, fetchImpl: deps.fetchImpl });
  } catch (e) {
    if (e instanceof NotConnectedError) throw new SharepointFlowError(400, e.message, "not_connected");
    if (e instanceof ReconnectRequiredError) throw new SharepointFlowError(409, e.message, "reconnect");
    throw e;
  }

  const { buffer, fileName } = await build(admin, row, now());

  let item: UploadedItem;
  try {
    item = await upload(token, { driveId: folder.driveId, itemId: folder.itemId, fileName, buffer }, deps.fetchImpl ?? fetch);
  } catch (e) {
    if (e instanceof GraphError) console.error(`[rfp] SharePoint 업로드 실패 project=${projectId} status=${e.status} code=${e.code} request-id=${e.requestId ?? "-"}`);
    throw mapGraphUploadError(e);
  }

  const { data: ins, error: insErr } = await admin
    .from("rfp_sharepoint_uploads")
    .insert({ project_id: projectId, drive_id: folder.driveId, item_id: item.id, file_name: item.name || fileName, web_url: item.webUrl, size_bytes: item.size || buffer.length, uploaded_by: userId })
    .select(SHAREPOINT_UPLOAD_COLUMNS)
    .single();
  if (insErr) throw new Error(`업로드 이력 저장 실패: ${insErr.message}`);
  const uploadRow = mapSharepointUpload(ins as SharepointUploadDbRow, deps.userName);

  let notified = false;
  let notifyError: string | undefined;
  if (deps.notifier.channelConfigured) {
    const r = await deps.notifier.sendChannel(buildUploadNotice({ projectName: row.name, userName: deps.userName, folderName: folder.name, fileName: uploadRow.fileName, webUrl: uploadRow.webUrl }));
    if (r.ok) notified = true;
    else notifyError = r.error ?? "알림 실패";
  }
  return notifyError ? { upload: uploadRow, notified, notifyError } : { upload: uploadRow, notified };
}

/** 최근 업로드 이력(최신순). 업로더 이름은 user_profiles에서 붙인다. */
export async function loadUploads(admin: SupabaseClient, projectId: string, limit = 20): Promise<RfpSharepointUpload[]> {
  const { data, error } = await admin.from("rfp_sharepoint_uploads").select(SHAREPOINT_UPLOAD_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SharepointUploadDbRow[];
  const names = await creatorNames(admin, rows.map((r) => r.uploaded_by).filter((v): v is string => !!v));
  return rows.map((r) => mapSharepointUpload(r, r.uploaded_by ? names.get(r.uploaded_by) ?? null : null));
}
```

- [ ] **Step 4: 테스트·타입·린트 통과 확인**

Run: `cd frontend && npm test -- rfp-sharepoint && npx tsc --noEmit -p . && npm run lint`
Expected: rfp-sharepoint.test 9 tests + rfp-sharepoint-mappers 4 tests PASS. tsc·lint 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/rfp/sharepoint.ts frontend/src/lib/__tests__/rfp-sharepoint.test.ts
git commit -m "feat(rfp): SharePoint 업로드 절차(검사→토큰→워크북→Graph replace→이력→Teams 알림)와 이력 조회

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---
### Task 8: Microsoft 연결 라우트 (`/api/ms/{connect,callback,connection}`)

**Files:**
- Create: `frontend/src/app/api/ms/connect/route.ts`
- Create: `frontend/src/app/api/ms/callback/route.ts`
- Create: `frontend/src/app/api/ms/connection/route.ts`

**Interfaces:**
- Consumes: `requireUser`(`@/lib/rfp/require-user`), `createServerSupabase`(`@/lib/supabase-server`), `loadMsConfig`·`missingConfigMessage`(Task 3 config), `signState`·`verifyState`·`newNonce`·`STATE_TTL_S`(Task 2), `buildAuthorizeUrl`·`exchangeCode`·`fetchMe`·`OAuthError`·`oauthErrorMessage`·`MS_SCOPES`(Task 3 oauth), `requestOrigin`·`resolveRedirectOrigin`·`sanitizeReturnTo`·`appendQuery`(Task 3 origin), `saveConnection`·`getConnectionStatus`·`deleteConnection`(Task 4).
- Produces: HTTP 계약(스펙 §7) — `GET /api/ms/connect?returnTo=` 302 / 400 오리진 / 500 설정; `GET /api/ms/callback?code&state[&error]` 302 `returnTo?ms_connected=1` 또는 `returnTo?ms_error=<문구>`; `GET /api/ms/connection` → `MsConnectionStatus`; `DELETE /api/ms/connection` → 204.
- Next.js route 파일은 `GET`·`DELETE`·`runtime` 같은 정해진 이름만 export할 수 있다(그 외 export는 빌드 타입 오류). 상수는 파일 안에 `const`로 둔다.

- [ ] **Step 1: `frontend/src/app/api/ms/connect/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { newNonce, signState, STATE_TTL_S } from "@/lib/ms/crypto";
import { buildAuthorizeUrl } from "@/lib/ms/oauth";
import { requestOrigin, resolveRedirectOrigin, sanitizeReturnTo } from "@/lib/ms/origin";

export const runtime = "nodejs";

/**
 * GET /api/ms/connect?returnTo=/settings — 세션 사용자·returnTo·만기를 담은 state를 서명해 Azure authorize로 302 (스펙 §3.1).
 * 400 허용되지 않은 오리진 / 500 설정 누락(항목명 포함).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const origin = resolveRedirectOrigin(requestOrigin(request));
  if (!origin) return NextResponse.json({ error: "허용되지 않은 오리진입니다." }, { status: 400 });

  const cfg = await loadMsConfig(await createServerSupabase());
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }

  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const state = signState({ u: auth.userId, n: newNonce(), r: returnTo, e: Math.floor(Date.now() / 1000) + STATE_TTL_S }, cfg.config.encKey);
  const url = buildAuthorizeUrl({ tenantId: cfg.config.app.tenantId, clientId: cfg.config.app.clientId, redirectUri: `${origin}/api/ms/callback`, state });
  return NextResponse.redirect(url, 302);
}
```

- [ ] **Step 2: `frontend/src/app/api/ms/callback/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { verifyState } from "@/lib/ms/crypto";
import { exchangeCode, fetchMe, MS_SCOPES, OAuthError, oauthErrorMessage } from "@/lib/ms/oauth";
import { appendQuery, requestOrigin, resolveRedirectOrigin, sanitizeReturnTo } from "@/lib/ms/origin";
import { saveConnection } from "@/lib/ms/connections";

export const runtime = "nodejs";

const EXPIRED = "연결 요청이 만료되었습니다. 다시 시도하세요.";

/**
 * GET /api/ms/callback?code&state[&error&error_description] — Azure에서 돌아오는 곳(스펙 §3.1).
 * 성공: returnTo?ms_connected=1 / 실패: returnTo?ms_error=<한국어 문구>. 토큰·error_description은 응답에 싣지 않는다.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const origin = resolveRedirectOrigin(requestOrigin(request));
  if (!origin) return NextResponse.json({ error: "허용되지 않은 오리진입니다." }, { status: 400 });

  const cfg = await loadMsConfig(await createServerSupabase());
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }
  const { app, encKey } = cfg.config;
  const q = request.nextUrl.searchParams;
  const back = (path: string, key: "ms_connected" | "ms_error", value: string) => NextResponse.redirect(`${origin}${appendQuery(path, key, value)}`, 302);

  // state: 서명·만기·세션 사용자 일치. 어긋나면 returnTo를 믿을 수 없으니 기본(/settings)으로 보낸다.
  const state = verifyState(q.get("state") ?? "", encKey);
  if (!state || state.u !== auth.userId) return back(sanitizeReturnTo(null), "ms_error", EXPIRED);
  const returnTo = sanitizeReturnTo(state.r);

  const azureError = q.get("error");
  if (azureError) {
    console.warn(`[ms] authorize 거부 ${azureError}: ${q.get("error_description") ?? ""}`);
    return back(returnTo, "ms_error", oauthErrorMessage(azureError));
  }
  const code = q.get("code");
  if (!code) return back(returnTo, "ms_error", "인증 코드가 없습니다. 다시 시도하세요.");

  try {
    const tok = await exchangeCode(app, { code, redirectUri: `${origin}/api/ms/callback` });
    if (!tok.refreshToken) return back(returnTo, "ms_error", "오프라인 접근 권한이 필요합니다. 동의 화면에서 모든 권한을 허용하세요.");
    const me = await fetchMe(tok.accessToken);
    await saveConnection(auth.admin, encKey, {
      userId: auth.userId,
      refreshToken: tok.refreshToken,
      accountUpn: me.userPrincipalName || me.mail,
      accountName: me.displayName || null,
      scopes: tok.scope || MS_SCOPES.join(" "),
    });
    return back(returnTo, "ms_connected", "1");
  } catch (e) {
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 교환 실패 ${e.code} (${e.status}): ${e.description}`);
      return back(returnTo, "ms_error", oauthErrorMessage(e.code));
    }
    console.error("[ms] 연결 저장 실패:", e instanceof Error ? e.message : e);
    return back(returnTo, "ms_error", "연결 정보를 저장하지 못했습니다. 다시 시도하세요.");
  }
}
```

- [ ] **Step 3: `frontend/src/app/api/ms/connection/route.ts` 작성**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { deleteConnection, getConnectionStatus } from "@/lib/ms/connections";

export const runtime = "nodejs";

/** GET /api/ms/connection — 내 Microsoft 계정 연결 상태(토큰 제외) */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getConnectionStatus(auth.admin, auth.userId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "연결 상태를 불러오지 못했습니다." }, { status: 500 });
  }
}

/** DELETE /api/ms/connection — 연결 해제(행 삭제 + 토큰 캐시 제거). 프로젝트 폴더 설정·업로드 이력은 남는다. */
export async function DELETE() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    await deleteConnection(auth.admin, auth.userId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "연결을 해제하지 못했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 4: 타입·린트·전체 테스트 통과 확인**

Run: `cd frontend && npx tsc --noEmit -p . && npm run lint && npm test`
Expected: 오류 없음, 전체 테스트 PASS(라우트는 단위 테스트 대상이 아니다).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/ms
git commit -m "feat(ms): Microsoft 계정 연결 라우트 — authorize 302, 콜백(state 검증·코드 교환·저장), 상태 조회·해제

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 9: 프로젝트 SharePoint 라우트 + 상세 응답 확장

**Files:**
- Create: `frontend/src/app/api/rfp/projects/[id]/sharepoint/route.ts`
- Create: `frontend/src/app/api/rfp/projects/[id]/sharepoint/folder/route.ts`
- Create: `frontend/src/app/api/rfp/projects/[id]/sharepoint/upload/route.ts`
- Modify: `frontend/src/app/api/rfp/projects/[id]/route.ts` (GET 상세에 `sharepoint.lastUpload`)

**Interfaces:**
- Consumes: `requireUser`, `createServerSupabase`, `getNotifier`(`@/lib/notify`), `creatorNames`(`@/lib/rfp/creators`), `loadMsConfig`·`missingConfigMessage`(Task 3), `getAccessTokenForUser`·`NotConnectedError`·`ReconnectRequiredError`(Task 4), `resolveFolder`·`FolderResolveError`·`GraphError`(Task 5), `OAuthError`·`oauthErrorMessage`(Task 3), `uploadProjectXlsx`·`loadUploads`·`SharepointFlowError`(Task 7), `parseSharepointFolder`(Task 1), `SharepointFolder`·`SharepointResponse`(types/rfp).
- Produces: HTTP 계약(스펙 §7) — `GET …/sharepoint` → `SharepointResponse`; `PUT …/sharepoint/folder {url}` → `{folder}` / 400(형식·폴더 아님·해석 실패·`not_connected`) / 403 / 409(`reconnect`) / 502; `DELETE …/sharepoint/folder` → 204; `POST …/sharepoint/upload` → `UploadResponse` / 400·403·404·409·502; 상세 GET `sharepoint: {folder, lastUpload}`.

- [ ] **Step 1: `frontend/src/app/api/rfp/projects/[id]/sharepoint/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { parseSharepointFolder } from "@/lib/rfp/mappers";
import { loadUploads } from "@/lib/rfp/sharepoint";
import type { SharepointResponse } from "@/types/rfp";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/rfp/projects/[id]/sharepoint — 폴더 설정 + 마지막 업로드 + 이력 20건 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });

  const { data: project, error } = await auth.admin.from("rfp_projects").select("id, sharepoint_folder").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  try {
    const uploads = await loadUploads(auth.admin, id, 20);
    const res: SharepointResponse = { folder: parseSharepointFolder(project.sharepoint_folder), lastUpload: uploads[0] ?? null, uploads };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "업로드 이력을 불러오지 못했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 2: `frontend/src/app/api/rfp/projects/[id]/sharepoint/folder/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { getAccessTokenForUser, NotConnectedError, ReconnectRequiredError } from "@/lib/ms/connections";
import { FolderResolveError, GraphError, resolveFolder, type ResolvedFolder } from "@/lib/ms/graph-drive";
import { OAuthError, oauthErrorMessage } from "@/lib/ms/oauth";
import type { SharepointFolder } from "@/types/rfp";

export const runtime = "nodejs";
export const maxDuration = 30;
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/rfp/projects/[id]/sharepoint/folder {url} — 폴더 링크를 Graph shares로 해석해 프로젝트에 저장(스펙 §4).
 * 400 형식·파일 링크·해석 실패·{code:not_connected} / 403 볼 권한 없음 / 409 {code:reconnect} / 502 Graph 오류
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000 || !/^https:\/\//i.test(url)) {
    return NextResponse.json({ error: "https로 시작하는 폴더 링크를 붙여 주세요(2000자 이하)." }, { status: 400 });
  }

  const { data: project, error } = await auth.admin.from("rfp_projects").select("id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  const cfg = await loadMsConfig(await createServerSupabase());
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }

  let token: string;
  try {
    token = await getAccessTokenForUser(auth.admin, auth.userId, { app: cfg.config.app, encKey: cfg.config.encKey });
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ error: e.message, code: "not_connected" }, { status: 400 });
    if (e instanceof ReconnectRequiredError) return NextResponse.json({ error: e.message, code: "reconnect" }, { status: 409 });
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 갱신 실패 ${e.code} (${e.status}): ${e.description}`);
      return NextResponse.json({ error: oauthErrorMessage(e.code) }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "토큰을 발급하지 못했습니다." }, { status: 500 });
  }

  let resolved: ResolvedFolder;
  try {
    resolved = await resolveFolder(token, url);
  } catch (e) {
    if (e instanceof FolderResolveError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof GraphError) {
      console.error(`[ms] 폴더 해석 실패 status=${e.status} code=${e.code} request-id=${e.requestId ?? "-"}`);
      return NextResponse.json({ error: `SharePoint 응답 오류(${e.status})` }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "폴더를 해석하지 못했습니다." }, { status: 500 });
  }

  const folder: SharepointFolder = { url, driveId: resolved.driveId, itemId: resolved.itemId, name: resolved.name, webUrl: resolved.webUrl, setBy: auth.userId, setAt: new Date().toISOString() };
  const { error: upErr } = await auth.admin.from("rfp_projects").update({ sharepoint_folder: folder, updated_by: auth.userId }).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ folder });
}

/** DELETE /api/rfp/projects/[id]/sharepoint/folder — 폴더 지정 해제(이력은 남는다) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });
  const { data, error } = await auth.admin.from("rfp_projects").update({ sharepoint_folder: null, updated_by: auth.userId }).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: `frontend/src/app/api/rfp/projects/[id]/sharepoint/upload/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { getNotifier } from "@/lib/notify";
import { creatorNames } from "@/lib/rfp/creators";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { OAuthError, oauthErrorMessage } from "@/lib/ms/oauth";
import { SharepointFlowError, uploadProjectXlsx } from "@/lib/rfp/sharepoint";

export const runtime = "nodejs";
export const maxDuration = 60;
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/rfp/projects/[id]/sharepoint/upload — xlsx를 지정 폴더에 올리고 이력·알림(스펙 §5.2).
 * 200 {upload, notified, notifyError?} / 400 {code:no_folder|not_connected}·status / 403 / 404 / 409 {code:reconnect}·잠김 / 502
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });

  const supabase = await createServerSupabase();
  const cfg = await loadMsConfig(supabase);
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }
  const [notifier, names] = await Promise.all([getNotifier(supabase, "notify"), creatorNames(auth.admin, [auth.userId])]);
  const userName = names.get(auth.userId) ?? "사용자";

  try {
    const res = await uploadProjectXlsx(auth.admin, id, auth.userId, { app: cfg.config.app, encKey: cfg.config.encKey, notifier, userName });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof SharepointFlowError) return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status });
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 갱신 실패 ${e.code} (${e.status}): ${e.description}`);
      return NextResponse.json({ error: oauthErrorMessage(e.code) }, { status: 502 });
    }
    console.error("[rfp] SharePoint 업로드 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "업로드에 실패했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 4: 상세 GET에 `lastUpload` 붙이기 — `frontend/src/app/api/rfp/projects/[id]/route.ts`**

import 두 줄을 추가한다.

```ts
import { loadUploads } from "@/lib/rfp/sharepoint";
import type { RfpSharepointUpload, StatusResponse } from "@/types/rfp";
```
(기존 `import type { StatusResponse } from "@/types/rfp";` 줄은 위 줄로 교체.)

`Promise.all` 블록과 반환을 아래로 바꾼다.

```ts
  const [filesRes, reqsRes, mapsRes, names, lastRes] = await Promise.all([
    auth.admin.from("rfp_files").select("id, original_filename, format, size_bytes, created_at").eq("project_id", id).order("created_at", { ascending: false }),
    auth.admin.from("rfp_requirements").select("*").eq("project_id", id).order("sort_order", { ascending: true }),
    selectAll<MappingDbRow>(() =>
      auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS, { count: "exact" }).eq("project_id", id).order("sort_order", { ascending: true }).order("id"),
    ),
    creatorNames(auth.admin, row.created_by ? [row.created_by] : []),
    // 3단계: 마지막 업로드 1건(초기 표시용). 이력 전체는 GET …/sharepoint
    loadUploads(auth.admin, id, 1)
      .then((uploads): { data: RfpSharepointUpload[]; error: string | null } => ({ data: uploads, error: null }))
      .catch((e: unknown): { data: RfpSharepointUpload[]; error: string | null } => ({ data: [], error: e instanceof Error ? e.message : "업로드 이력 조회 실패" })),
  ]);
  if (filesRes.error) return NextResponse.json({ error: filesRes.error.message }, { status: 500 });
  if (reqsRes.error) return NextResponse.json({ error: reqsRes.error.message }, { status: 500 });
  if (mapsRes.error) return NextResponse.json({ error: mapsRes.error.message }, { status: 500 });
  if (lastRes.error) return NextResponse.json({ error: lastRes.error }, { status: 500 });
  // 요구사항은 프로젝트당 수백 건이라 1000행 상한에 걸리지 않지만, 매핑은 수동 추가 행에 상한이 없어 selectAll로 끝까지 읽는다.
  const requirements = sortRequirements(((reqsRes.data ?? []) as RequirementDbRow[]).map(mapRequirement));
  const mappings = mapsRes.data.map(mapMapping);
  const creatorName = row.created_by ? names.get(row.created_by) ?? null : null;
  return NextResponse.json(mapProjectDetail(row, creatorName, (filesRes.data ?? []) as FileDbRow[], requirements, mappings, lastRes.data[0] ?? null));
```

- [ ] **Step 5: 타입·린트·전체 테스트 통과 확인**

Run: `cd frontend && npx tsc --noEmit -p . && npm run lint && npm test`
Expected: 오류 없음, 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add "frontend/src/app/api/rfp/projects/[id]/sharepoint" "frontend/src/app/api/rfp/projects/[id]/route.ts"
git commit -m "feat(rfp): 프로젝트 SharePoint 라우트(폴더 지정/해제·업로드·이력)와 상세 응답 sharepoint 필드

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---
### Task 10: `/settings` Microsoft 계정 카드

**Files:**
- Create: `frontend/src/hooks/useMsCallbackQuery.ts`
- Create: `frontend/src/components/settings/MicrosoftAccountCard.tsx`
- Modify: `frontend/src/app/settings/page.tsx` (import 1줄 + 카드 1줄)

**Interfaces:**
- Consumes: `MsConnectionStatus`(Task 1), `GET/DELETE /api/ms/connection`, `GET /api/ms/connect?returnTo=`(Task 8), shadcn `Card`·`Button`·`Badge`·`Alert`·`AlertDialog`, lucide `Cloud`·`Link2`·`Unlink`·`RefreshCw`·`Loader2`.
- Produces: `useMsCallbackQuery({ onConnected?, onError? })`(hooks) — `?ms_connected=1`·`?ms_error=문구`를 마운트 뒤 한 번 읽어 콜백을 부르고 주소에서 지운다; `connectUrl(returnTo: string): string`(MicrosoftAccountCard의 named export, Task 11이 재사용); `MicrosoftAccountCard`(default export).
- 날짜 표시는 기존 화면 관례대로 `new Date(iso).toLocaleString("ko-KR")` 인라인.
- `useSearchParams`는 정적 프리렌더 페이지에서 Suspense 경계를 요구해(빌드 오류) 쓰지 않는다. `window.location.search`를 마운트 뒤 `setTimeout(…, 0)` 안에서 읽는다(기존 `app/rfp/[id]/page.tsx`가 `setTimeout(load, 0)`을 쓰는 것과 같은 이유 — effect 본문에서 직접 setState하지 않는다).

- [ ] **Step 1: `frontend/src/hooks/useMsCallbackQuery.ts` 작성**

```ts
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export interface MsCallbackHandlers {
  onConnected?: () => void;
  onError?: (message: string) => void;
}

/**
 * /api/ms/callback이 붙여 돌려보내는 ?ms_connected=1 · ?ms_error=<문구> 를 마운트 뒤 한 번 읽어 콜백을 부르고, 주소에서 지운다.
 * useSearchParams는 정적 페이지에서 Suspense 경계를 요구하므로 window.location을 쓴다. 한 번 처리한 뒤에는(router.replace가 끝나기 전 재렌더가 있어도) 다시 부르지 않는다.
 */
export function useMsCallbackQuery(handlers: MsCallbackHandlers): void {
  const router = useRouter();
  const handlersRef = useRef<MsCallbackHandlers>(handlers);
  const doneRef = useRef(false);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const t = setTimeout(() => {
      if (doneRef.current) return;
      const sp = new URLSearchParams(window.location.search);
      const connected = sp.get("ms_connected") === "1";
      const error = sp.get("ms_error");
      if (!connected && !error) return;
      doneRef.current = true;
      if (connected) handlersRef.current.onConnected?.();
      if (error) handlersRef.current.onError?.(error);
      sp.delete("ms_connected");
      sp.delete("ms_error");
      const qs = sp.toString();
      router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }, 0);
    return () => clearTimeout(t);
  }, [router]);
}
```

- [ ] **Step 2: `frontend/src/components/settings/MicrosoftAccountCard.tsx` 작성**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useMsCallbackQuery } from "@/hooks/useMsCallbackQuery";
import type { MsConnectionStatus } from "@/types/ms";

/** Microsoft 계정 연결 시작 URL — 연결이 끝나면 returnTo(같은 오리진 경로)로 돌아온다 */
export function connectUrl(returnTo: string): string {
  return `/api/ms/connect?returnTo=${encodeURIComponent(returnTo)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/** 개인 설정: SharePoint 업로드에 쓰는 Microsoft 계정 연결 상태·연결·해제 */
export default function MicrosoftAccountCard() {
  const [status, setStatus] = useState<MsConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ms/connection");
      if (!res.ok) throw new Error(await readError(res, "연결 상태를 불러오지 못했습니다."));
      setStatus((await res.json()) as MsConnectionStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결 상태를 불러오지 못했습니다.");
      setStatus({ connected: false });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useMsCallbackQuery({
    onConnected: () => {
      setNotice("Microsoft 계정이 연결되었습니다.");
      setError(null);
      void load();
    },
    onError: (message) => setError(message),
  });

  const connect = () => {
    window.location.assign(connectUrl("/settings"));
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/ms/connection", { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "연결을 해제하지 못했습니다."));
      setStatus({ connected: false });
      setNotice("연결을 해제했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결을 해제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="h-4 w-4" />
          Microsoft 계정
          {status?.connected && (
            <Badge variant={status.lastError ? "destructive" : "secondary"} className="text-xs font-normal">
              {status.lastError ? "다시 연결 필요" : "연결됨"}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          RFP 분석 결과를 SharePoint에 올릴 때 쓰는 계정입니다. 연결하면 서버가 갱신 토큰을 암호화해 보관하고, 업로드는 내 계정 권한으로 실행됩니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}

        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중...
          </div>
        ) : !status.connected ? (
          <>
            <p className="text-sm text-muted-foreground">연결된 계정이 없습니다.</p>
            <Button size="sm" onClick={connect}>
              <Link2 className="mr-1 h-4 w-4" />
              Microsoft 계정 연결
            </Button>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">계정</dt>
              <dd>
                {status.accountName ?? "—"}
                {status.accountUpn && <span className="ml-1 text-muted-foreground">({status.accountUpn})</span>}
              </dd>
              <dt className="text-muted-foreground">연결</dt>
              <dd>{new Date(status.connectedAt).toLocaleString("ko-KR")}</dd>
              <dt className="text-muted-foreground">마지막 사용</dt>
              <dd>{status.lastUsedAt ? new Date(status.lastUsedAt).toLocaleString("ko-KR") : "—"}</dd>
            </dl>
            {status.lastError && (
              <Alert variant="destructive">
                <AlertDescription>연결이 만료되었습니다. 다시 연결하세요. ({status.lastError})</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={connect} disabled={busy}>
                <RefreshCw className="mr-1 h-4 w-4" />
                다시 연결
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={busy}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Unlink className="mr-1 h-4 w-4" />}
                    해제
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Microsoft 계정 연결을 해제할까요?</AlertDialogTitle>
                    <AlertDialogDescription>저장된 갱신 토큰을 삭제합니다. 이미 올라간 파일과 프로젝트의 폴더 설정은 그대로 남습니다.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={disconnect}>해제</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `frontend/src/app/settings/page.tsx`에 카드 삽입**

import 줄 `import MyTeamCard from "@/components/settings/MyTeamCard";` 바로 아래에 추가:

```ts
import MicrosoftAccountCard from "@/components/settings/MicrosoftAccountCard";
```

JSX에서 아래 블록을

```tsx
      {/* 내 팀 구성원 */}
      <MyTeamCard />

      {/* Dooray 연동 */}
```

이렇게 바꾼다:

```tsx
      {/* 내 팀 구성원 */}
      <MyTeamCard />

      {/* Microsoft 계정 (SharePoint 업로드) */}
      <MicrosoftAccountCard />

      {/* Dooray 연동 */}
```

- [ ] **Step 4: 타입·린트·빌드 확인**

Run: `cd frontend && npx tsc --noEmit -p . && npm run lint && npm run build`
Expected: 오류 없음. 빌드에서 `/settings`에 Suspense 경고·오류가 없어야 한다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/hooks/useMsCallbackQuery.ts frontend/src/components/settings/MicrosoftAccountCard.tsx frontend/src/app/settings/page.tsx
git commit -m "feat(ms): /settings Microsoft 계정 카드 — 연결 상태·연결·다시 연결·해제, 콜백 쿼리 처리 훅

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

### Task 11: 프로젝트 상세 SharePoint 섹션

**Files:**
- Create: `frontend/src/components/rfp/SharePointSection.tsx`
- Modify: `frontend/src/app/rfp/[id]/page.tsx` (import 1줄 + 섹션 1줄)

**Interfaces:**
- Consumes: `RfpProjectDetail["sharepoint"]`·`SharepointResponse`·`SharepointFolder`·`UploadResponse`·`SharepointErrorCode`·`RfpSharepointUpload`(Task 1), `MsConnectionStatus`(Task 1), `connectUrl`(Task 10), `useMsCallbackQuery`(Task 10), 라우트 `GET …/sharepoint`, `PUT/DELETE …/sharepoint/folder`, `POST …/sharepoint/upload`, `GET /api/ms/connection`(Task 8·9).
- Produces: `SharePointSection({ projectId, projectStatus, initial })`(default export).
- 오류 응답의 `code`로 화면 상태를 바꾼다: `not_connected` → 연결 버튼, `reconnect` → 재연결 버튼, 그 외는 문구만.

- [ ] **Step 1: `frontend/src/components/rfp/SharePointSection.tsx` 작성**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudUpload, ExternalLink, FolderOpen, Link2, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { connectUrl } from "@/components/settings/MicrosoftAccountCard";
import { useMsCallbackQuery } from "@/hooks/useMsCallbackQuery";
import type { MsConnectionStatus } from "@/types/ms";
import type { RfpProjectDetail, SharepointErrorCode, SharepointFolder, SharepointResponse, UploadResponse } from "@/types/rfp";

interface Props {
  projectId: string;
  projectStatus: RfpProjectDetail["status"];
  /** 상세 GET의 sharepoint — 첫 렌더용. 마운트 뒤 GET …/sharepoint로 이력까지 다시 읽는다 */
  initial: RfpProjectDetail["sharepoint"];
}

type ApiError = { error?: string; code?: SharepointErrorCode };

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR");

/** 프로젝트 상세: 폴더 지정 → 업로드 → 결과·이력(스펙 §8) */
export default function SharePointSection({ projectId, projectStatus, initial }: Props) {
  const [data, setData] = useState<SharepointResponse>({ folder: initial.folder, lastUpload: initial.lastUpload, uploads: initial.lastUpload ? [initial.lastUpload] : [] });
  const [conn, setConn] = useState<MsConnectionStatus | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const [folderInput, setFolderInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"folder" | "unset" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);

  const base = `/api/rfp/projects/${projectId}/sharepoint`;

  const loadData = useCallback(async () => {
    const res = await fetch(base);
    if (!res.ok) return;
    setData((await res.json()) as SharepointResponse);
  }, [base]);

  const loadConn = useCallback(async () => {
    const res = await fetch("/api/ms/connection");
    setConn(res.ok ? ((await res.json()) as MsConnectionStatus) : { connected: false });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadData();
      void loadConn();
    }, 0);
    return () => clearTimeout(t);
  }, [loadData, loadConn]);

  useMsCallbackQuery({
    onConnected: () => {
      setNotice("Microsoft 계정이 연결되었습니다.");
      setReconnect(false);
      void loadConn();
    },
    onError: (message) => setError(message),
  });

  const connect = () => {
    window.location.assign(connectUrl(window.location.pathname));
  };

  /** 오류 응답을 화면 상태로: not_connected → 연결 버튼, reconnect → 재연결 버튼, 문구는 항상 표시 */
  const applyError = async (res: Response, fallback: string) => {
    const j = (await res.json().catch(() => ({}))) as ApiError;
    if (j.code === "not_connected") setConn({ connected: false });
    if (j.code === "reconnect") setReconnect(true);
    setError(j.error ?? fallback);
  };

  const setFolder = async () => {
    const url = folderInput.trim();
    if (!url) return;
    setBusy("folder");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${base}/folder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      if (!res.ok) {
        await applyError(res, "폴더를 지정하지 못했습니다.");
        return;
      }
      const { folder } = (await res.json()) as { folder: SharepointFolder };
      setData((d) => ({ ...d, folder }));
      setFolderInput("");
      setEditing(false);
      setNotice(`폴더를 지정했습니다: ${folder.name}`);
    } finally {
      setBusy(null);
    }
  };

  const clearFolder = async () => {
    setBusy("unset");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${base}/folder`, { method: "DELETE" });
      if (!res.ok) {
        await applyError(res, "폴더를 해제하지 못했습니다.");
        return;
      }
      setData((d) => ({ ...d, folder: null }));
      setEditing(false);
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    setBusy("upload");
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const res = await fetch(`${base}/upload`, { method: "POST" });
      if (!res.ok) {
        await applyError(res, "업로드에 실패했습니다.");
        return;
      }
      setResult((await res.json()) as UploadResponse);
      setReconnect(false);
      await loadData();
    } finally {
      setBusy(null);
    }
  };

  const canUpload = !!data.folder && projectStatus === "ready" && busy === null;
  const uploadHint = !data.folder ? "먼저 SharePoint 폴더를 지정하세요." : projectStatus !== "ready" ? "요구사항 추출이 끝난 뒤 업로드할 수 있습니다." : undefined;
  const needsReconnect = reconnect || (conn?.connected === true && !!conn.lastError);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CloudUpload className="h-4 w-4" />
          SharePoint 등록
          {data.lastUpload && <span className="text-xs font-normal text-muted-foreground">마지막 업로드 {fmt(data.lastUpload.createdAt)}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}

        {/* 폴더 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-muted-foreground">폴더</span>
          {data.folder && !editing ? (
            <>
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{data.folder.name}</span>
              <Button size="sm" variant="link" className="h-auto p-0" asChild>
                <a href={data.folder.webUrl} target="_blank" rel="noreferrer">
                  폴더 열기
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setFolderInput(data.folder?.url ?? ""); setEditing(true); }}>
                변경
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={busy !== null}>해제</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>폴더 지정을 해제할까요?</AlertDialogTitle>
                    <AlertDialogDescription>이미 올라간 파일과 업로드 이력은 그대로 남습니다. 다시 업로드하려면 폴더를 다시 지정해야 합니다.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={clearFolder}>해제</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <>
              <Input
                className="h-8 min-w-[280px] flex-1"
                placeholder="Teams/SharePoint 폴더의 '링크 복사' 값을 붙이세요"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void setFolder(); }}
                disabled={busy !== null}
              />
              <Button size="sm" disabled={busy !== null || !folderInput.trim()} onClick={setFolder}>
                {busy === "folder" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
                폴더 지정
              </Button>
              {data.folder && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(false)}>취소</Button>
              )}
            </>
          )}
        </div>

        {/* 업로드 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-muted-foreground">업로드</span>
          {conn === null ? (
            <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />연결 확인 중…</span>
          ) : !conn.connected ? (
            <>
              <span className="text-muted-foreground">업로드하려면 Microsoft 계정을 연결하세요.</span>
              <Button size="sm" variant="outline" onClick={connect}>
                <Link2 className="mr-1 h-4 w-4" />
                Microsoft 계정 연결
              </Button>
            </>
          ) : needsReconnect ? (
            <>
              <span className="text-destructive">연결이 만료되었습니다. 다시 연결하세요.</span>
              <Button size="sm" variant="outline" onClick={connect}>
                <RefreshCw className="mr-1 h-4 w-4" />
                다시 연결
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={!canUpload} title={uploadHint} onClick={upload}>
                {busy === "upload" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-1 h-4 w-4" />}
                SharePoint에 업로드
              </Button>
              <span className="text-xs text-muted-foreground">{conn.accountUpn ?? conn.accountName ?? ""} 계정으로 · 같은 날 파일은 덮어씁니다</span>
            </>
          )}
        </div>
        {result && (
          <Alert>
            <AlertDescription>
              업로드 완료 — <a className="underline" href={result.upload.webUrl} target="_blank" rel="noreferrer">{result.upload.fileName}</a>
              {" · "}
              {result.notified ? "Teams 알림 전송됨" : result.notifyError ? `알림 실패: ${result.notifyError}` : "Teams 알림 미설정(웹후크 없음)"}
            </AlertDescription>
          </Alert>
        )}

        {/* 최근 파일·이력 */}
        {data.lastUpload && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-muted-foreground">최근 파일</span>
            <a className="underline" href={data.lastUpload.webUrl} target="_blank" rel="noreferrer">{data.lastUpload.fileName}</a>
            <span className="text-xs text-muted-foreground">{fmt(data.lastUpload.createdAt)} · {data.lastUpload.uploadedBy.name ?? "—"}</span>
          </div>
        )}
        {data.uploads.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">이력 ({data.uploads.length}건)</summary>
            <ul className="mt-1 space-y-1">
              {data.uploads.map((u) => (
                <li key={u.id} className="flex flex-wrap gap-2">
                  <span className="text-muted-foreground">{fmt(u.createdAt)}</span>
                  <a className="underline" href={u.webUrl} target="_blank" rel="noreferrer">{u.fileName}</a>
                  <span className="text-muted-foreground">{u.uploadedBy.name ?? "—"} · {Math.round(u.sizeBytes / 1024)}KB</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: `frontend/src/app/rfp/[id]/page.tsx`에 섹션 삽입**

import 줄 `import MappingSummary, { type VerdictFilter } from "@/components/rfp/MappingSummary";` 바로 아래에 추가:

```ts
import SharePointSection from "@/components/rfp/SharePointSection";
```

JSX에서 아래 줄을

```tsx
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      {project.status === "extracting" ? (
```

이렇게 바꾼다(OverviewCard 아래·매핑 요약 위, 추출 중에도 보이되 업로드 버튼은 비활성):

```tsx
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      <SharePointSection projectId={project.id} projectStatus={project.status} initial={project.sharepoint} />
      {project.status === "extracting" ? (
```

- [ ] **Step 3: 타입·린트·빌드·전체 테스트 확인**

Run: `cd frontend && npx tsc --noEmit -p . && npm run lint && npm run build && npm test`
Expected: 오류 없음, 전체 PASS.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/rfp/SharePointSection.tsx "frontend/src/app/rfp/[id]/page.tsx"
git commit -m "feat(rfp): 상세 화면 SharePoint 섹션 — 폴더 링크 지정/변경/해제, 업로드 버튼·결과, 최근 파일·이력

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---
### Task 12: 문서 — 런북·Teams 연동 가이드·CLAUDE.md

**Files:**
- Modify: `docs/rfp-analyzer.md`
- Modify: `docs/teams-integration.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1~11의 파일·라우트·env 이름(아래 본문에 모두 적혀 있다).
- 편집은 아래 "찾을 문장 → 바꿀 문장"을 그대로 적용한다. 찾을 문장이 파일에 없으면(다른 세션이 먼저 고쳤을 수 있다) `grep -n`으로 위치를 확인하고 같은 의미가 되게 넣되, 스펙과 다른 내용을 새로 쓰지 않는다.

- [ ] **Step 1: `docs/rfp-analyzer.md`**

(a) 3행 설계 링크 줄 끝에 3단계를 덧붙인다.

찾을 문장:
```
설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md`(1단계) · `docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md`(2단계) · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md` · `docs/superpowers/plans/2026-09-04-rfp-analyzer-phase2.md`
```
바꿀 문장:
```
설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md`(1단계) · `docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md`(2단계) · `docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md`(3단계) · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md` · `docs/superpowers/plans/2026-09-04-rfp-analyzer-phase2.md` · `docs/superpowers/plans/2026-09-05-rfp-analyzer-phase3.md`
```

(b) "## 구성"의 2단계 불릿(`- **2단계(솔루션 매핑)**: …` 로 시작하는 단락) 바로 아래에 빈 줄 하나를 두고 추가:

```
- **3단계(SharePoint 등록)**: 사용자가 `/settings`(또는 상세)에서 **Microsoft 계정을 연결**(OAuth 위임, 스코프 `offline_access User.Read Files.ReadWrite.All Sites.Read.All`, 앱 권한·관리자 동의 불필요) → 서버가 refresh 토큰을 AES-256-GCM(`MS_TOKEN_ENC_KEY`)으로 암호화해 `ms_connections`에 보관. 상세 화면 "SharePoint 등록" 섹션에서 Teams/SharePoint 폴더의 **'링크 복사' 값을 붙이면** Graph `shares/{u!…}/driveItem`으로 해석해 `rfp_projects.sharepoint_folder`에 저장(프로젝트 속성). "SharePoint에 업로드" → xlsx 다운로드와 같은 `buildProjectWorkbook` 결과를 그 폴더에 PUT(`conflictBehavior=replace`, 파일명 날짜 KST → 같은 날 덮어쓰기·SharePoint 버전 이력) → `rfp_sharepoint_uploads`에 이력 → `notify_provider=teams` 웹후크가 있으면 채널에 링크 알림(실패해도 업로드는 성공). 라이브러리 `frontend/src/lib/ms/`(crypto·oauth·config·origin·connections·graph-drive) + `lib/rfp/sharepoint.ts`. API `/api/ms/{connect,callback,connection}`, `/api/rfp/projects/[id]/sharepoint{,/folder,/upload}`. SQL `docs/sql/2026-09-05-rfp-sharepoint.sql`.
```

(c) "## 환경 변수" 표 마지막 행(`ATLASSIAN_*`) 아래에 행 3개 추가:

```
| `MS_TOKEN_ENC_KEY` | 3단계. refresh 토큰 암호화 키(64자 hex, `openssl rand -hex 32`). 없으면 연결·업로드 500. **교체하면 모든 연결이 복호화 실패 → 재연결 안내** |
| `MS_ALLOWED_ORIGINS` | 3단계(선택). OAuth 리디렉션 오리진 허용 목록(쉼표). 기본 `https://inje-playground.vercel.app,http://localhost:3003`. Entra 앱 리디렉션 URI와 짝을 맞춘다 |
| `TEAMS_GRAPH_CLIENT_SECRET` | 기존(Teams 멤버 Graph 방식과 공유). 3단계 토큰 교환·갱신에 필수. settings `teams_tenant_id`·`teams_graph_client_id`도 함께 필요 |
```

(d) "## 최초 설치" 목록 끝(5번 뒤)에 추가:

```
6. (3단계) Entra 앱 등록(기존 Teams 앱) → 인증 → 플랫폼 "웹" 리디렉션 URI `https://inje-playground.vercel.app/api/ms/callback`, `http://localhost:3003/api/ms/callback` 추가. API 권한 → Microsoft Graph → **위임된 권한** `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`, `offline_access` 추가(관리자 동의 버튼은 누르지 않아도 된다. 테넌트가 사용자 동의를 막아 첫 연결에서 "관리자 승인 필요"가 뜨면 Application Administrator가 위임 권한에 동의 — 앱 권한과 달리 GA 불필요). 클라이언트 암호가 없으면 새로 만들어 `TEAMS_GRAPH_CLIENT_SECRET`에.
7. (3단계) `docs/sql/2026-09-05-rfp-sharepoint.sql` 실행 → `ms_connections`·`rfp_sharepoint_uploads` + `rfp_projects.sharepoint_folder`. Vercel env에 `MS_TOKEN_ENC_KEY`·`TEAMS_GRAPH_CLIENT_SECRET` 추가 후 재배포. 관리자 시스템 설정에 `teams_tenant_id`·`teams_graph_client_id` 확인.
8. (3단계) Teams 알림을 받으려면 `notify_provider=teams` + `teams_notify_webhook_url`(기존 채널 웹후크). 없어도 업로드는 되고 화면에 "Teams 알림 미설정"으로 표시된다.
```

(e) "## 운영 메모" 마지막 불릿(`- 비용 감: …`) 아래에 빈 줄 하나를 두고 추가:

```
- (3단계) 연결은 사용자당 1행. 다른 계정으로 다시 연결하면 교체된다. 해제해도 프로젝트의 폴더 설정과 업로드 이력은 남는다. 업로드 권한은 Graph가 **업로더 계정** 기준으로 판정하므로, 다른 사람이 지정한 폴더라도 내 계정에 쓰기 권한이 없으면 403.
- (3단계) refresh 실패 코드(`invalid_grant`·`interaction_required`·`consent_required`)와 복호화 실패(`decrypt`)는 `ms_connections.last_error`에 남고 화면은 "다시 연결"을 띄운다. 그 외 Azure 오류는 502. Graph 429·503은 Retry-After(기본 2초, 최대 5초) 뒤 1회 재시도하고, 그래도 실패하면 502 "SharePoint 응답 오류(NNN)". 서버 로그에는 오류 코드·상태·`request-id`만 남는다(토큰·시크릿·error_description은 클라이언트에 나가지 않는다).
- (3단계) 폴더 링크는 `https://`만, 파일 링크는 "폴더 링크가 아닙니다" 400. 폴더가 삭제·이동되면 업로드 404 "폴더가 없습니다(삭제·이동)" — 폴더 설정은 그대로 두고 다시 지정한다. 파일이 열려 잠겨 있으면(423) 409 "파일이 열려 있어 덮어쓸 수 없습니다".
- (3단계) 파일명 날짜가 KST로 바뀌어 xlsx 다운로드도 함께 KST를 쓴다(Vercel UTC에서 밤 시간대 하루 어긋남 해소). 4MiB 미만은 단순 PUT, 이상은 업로드 세션(10MiB 청크). 업로드 라우트 `maxDuration 60`.
```

(f) "## 수동 회귀 체크리스트" 20번 아래에 빈 줄 하나를 두고 추가:

```
21. `/settings` → "Microsoft 계정" 카드 → "Microsoft 계정 연결" → Azure 로그인·동의 → `/settings?ms_connected=1`로 복귀, 카드에 계정 이름·UPN·연결 시각, 주소에서 쿼리가 사라짐. `GET /api/ms/connection` 응답에 토큰 필드 없음.
22. 동의 화면에서 "취소" → `ms_error=연결이 취소되었습니다.` 문구 표시. `state`를 고쳐 콜백을 열면 "연결 요청이 만료되었습니다".
23. 샘플 프로젝트 상세 → "SharePoint 등록" 섹션 → 파일 링크를 붙이면 400 "폴더 링크가 아닙니다"; 폴더 '링크 복사' 값을 붙이면 폴더명·"폴더 열기"(새 탭) 표시. 새로고침 후 유지. 다른 사용자로 열어도 같은 폴더가 보인다(프로젝트 속성).
24. "SharePoint에 업로드" → 스피너 → "업로드 완료 — (발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx" + Teams 알림 문구. SharePoint 폴더에 파일이 있고, 열면 xlsx 다운로드와 같은 시트 구성(매핑 시트 포함).
25. 같은 날 다시 업로드 → 파일이 하나(덮어쓰기), SharePoint 버전 기록 +1, 이력은 2건. 날짜가 바뀌면(서버 날짜를 바꾸거나 다음 날) 새 파일.
26. Teams 채널에 "[RFP] {사업명} 요구사항 검토 파일을 SharePoint에 올렸습니다 — {이름} · {폴더명}" 카드 + 파일명 + 링크. `teams_notify_webhook_url`을 비우면 "Teams 알림 미설정(웹후크 없음)"이지만 업로드는 성공.
27. `/settings`에서 "해제" → 상세 업로드 행이 "Microsoft 계정 연결" 버튼으로 바뀜(`not_connected`); 폴더 설정·이력은 그대로. 상세에서 연결하면 상세 경로로 복귀(`returnTo`).
28. Vercel env `MS_TOKEN_ENC_KEY`를 다른 값으로 바꾼 뒤(테스트 환경) 업로드 → 409 "연결이 만료되었습니다" + "다시 연결" 버튼, `last_error=decrypt`. 되돌리고 재연결하면 정상.
```

(g) 파일 끝의 "## 3단계 접점" 절(제목 줄과 그 아래 불릿 1줄)을 삭제한다 — (b)의 3단계 불릿이 대신한다.

- [ ] **Step 2: `docs/teams-integration.md`**

(a) "## 1. 관리자 설정" 표의 `teams_graph_client_id` 행 바로 아래 행(`teams_group_id`) 다음에 표 밖 문단으로 이어지는 "**환경변수(서버 전용·비밀, Graph 방식일 때만)**: `TEAMS_GRAPH_CLIENT_SECRET` — …" 문장 끝에 덧붙인다.

찾을 문장:
```
settings 테이블에 저장하지 않는다. §3-B 웹훅 방식을 쓰면 불필요.
```
바꿀 문장:
```
settings 테이블에 저장하지 않는다. §3-B 웹훅 방식을 쓰면 불필요 — 단, RFP 분석 SharePoint 업로드(§3-C 위임 OAuth)를 쓰면 다시 필수이고 `MS_TOKEN_ENC_KEY`(64자 hex)도 함께 둔다.
```

(b) "## 4. 코드 구조" 제목 줄 바로 위에 새 절을 넣는다.

```
## 3-C. RFP 분석 SharePoint 업로드 — Microsoft Graph 위임 권한 (관리자 동의 불필요)

> 3-A의 앱 권한과 달리 **위임된 권한**은 사용자가 스스로 동의한다. 테넌트가 사용자 동의를 막아 "관리자 승인 필요"가 뜨더라도 Application Administrator가 동의할 수 있다(GA 불필요). 설계: `docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md`, 런북: `docs/rfp-analyzer.md`.

1. Entra 앱 등록(3-A와 같은 앱) → 인증 → 플랫폼 "웹" 리디렉션 URI 추가: `https://inje-playground.vercel.app/api/ms/callback`, `http://localhost:3003/api/ms/callback` (다른 도메인을 쓰면 env `MS_ALLOWED_ORIGINS`에도 추가).
2. API 권한 → Microsoft Graph → **위임된 권한** → `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`, `offline_access` 추가. "관리자 동의 부여"는 누르지 않아도 된다.
3. 인증서 및 암호 → 클라이언트 암호(없으면 새로) → `TEAMS_GRAPH_CLIENT_SECRET`. `openssl rand -hex 32` → `MS_TOKEN_ENC_KEY`. 둘 다 Vercel env(+로컬 `.env.local`), settings에는 저장하지 않는다.
4. settings `teams_tenant_id`·`teams_graph_client_id`는 3-A와 공용.
5. 흐름: `/settings` "Microsoft 계정 연결" → `GET /api/ms/connect`(state HMAC 서명·10분) → `login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` → `GET /api/ms/callback`(state 검증·세션 사용자 일치 → 코드 교환 → `GET /me` → refresh 토큰 AES-256-GCM 암호화 → `ms_connections` upsert) → `returnTo?ms_connected=1`. 업로드 때마다 refresh로 access 토큰(서버 메모리 5분 캐시) → `GET /shares/{u!base64url(폴더 링크)}/driveItem`, `PUT /drives/{driveId}/items/{itemId}:/{파일명}:/content?@microsoft.graph.conflictBehavior=replace`(4MiB 이상은 `createUploadSession` + 10MiB 청크).
6. 확인: 연결 후 `GET /api/ms/connection` → `{connected:true, accountUpn, …}`(토큰 없음). 업로드 실패 502 로그의 `request-id`로 Microsoft 지원 문의. `invalid_grant`가 `ms_connections.last_error`에 남으면 사용자가 "다시 연결".
```

(c) "## 4. 코드 구조" 표 마지막 행 아래에 행 추가:

```
| `frontend/src/lib/ms/` | 3-C 위임 OAuth — `crypto.ts`(AES-GCM·HMAC state), `oauth.ts`(authorize·토큰 교환/갱신·/me), `config.ts`(settings+env), `origin.ts`(리디렉션 오리진·returnTo), `connections.ts`(ms_connections·access 토큰 캐시), `graph-drive.ts`(shares 해석·업로드) |
| `frontend/src/app/api/ms/{connect,callback,connection}/route.ts` | 연결 시작·콜백·상태/해제 |
| `frontend/src/lib/rfp/sharepoint.ts`, `app/api/rfp/projects/[id]/sharepoint/**` | RFP xlsx SharePoint 업로드·폴더 지정·이력(런북 `docs/rfp-analyzer.md`) |
| `frontend/src/components/settings/MicrosoftAccountCard.tsx`, `components/rfp/SharePointSection.tsx`, `hooks/useMsCallbackQuery.ts` | 개인 설정 카드·상세 섹션·콜백 쿼리 처리 |
```

- [ ] **Step 3: `CLAUDE.md`**

(a) 페이지 — 찾을 문장 → 바꿀 문장:

```
- `/rfp`, `/rfp/[id]` — RFP 분석(user): 제안요청서(hwp·hwpx·docx) 업로드 → 프로젝트 등록(중복 판단) → 요구사항 표(TanStack Table 셀 편집·행 추가/삭제) → xlsx 다운로드 → 솔루션 매핑(상세 "솔루션 매핑 실행", 요구사항별 판정 충족/부분충족/설계·구축영역/해당없음, 행 펼침 편집). 런북 `docs/rfp-analyzer.md`
```
→
```
- `/rfp`, `/rfp/[id]` — RFP 분석(user): 제안요청서(hwp·hwpx·docx) 업로드 → 프로젝트 등록(중복 판단) → 요구사항 표(TanStack Table 셀 편집·행 추가/삭제) → xlsx 다운로드 → 솔루션 매핑(상세 "솔루션 매핑 실행", 요구사항별 판정 충족/부분충족/설계·구축영역/해당없음, 행 펼침 편집) → SharePoint 등록(3단계: 상세 "SharePoint 등록" 섹션에서 폴더 '링크 복사' 값 지정 → 같은 xlsx를 사용자 위임 권한으로 업로드(같은 날 덮어쓰기) → 이력·Teams 채널 알림). 런북 `docs/rfp-analyzer.md`
```

```
- `/settings` — Dooray API token and project ID configuration (stored in localStorage)
```
→
```
- `/settings` — Dooray API token and project ID configuration (stored in localStorage) + Microsoft 계정 연결 카드(`MicrosoftAccountCard`: SharePoint 업로드용 위임 OAuth, refresh 토큰은 서버가 암호화 보관)
```

(b) API — 2단계 매핑 API 줄(`- `GET /api/rfp/catalog`, … (20건 청크·동시 3·청크별 저장)`) 바로 아래에 추가:

```
- `GET /api/ms/connect?returnTo=`(Azure authorize 302), `GET /api/ms/callback`(state 검증·코드 교환·`ms_connections` 저장 → `returnTo?ms_connected=1|ms_error=`), `GET·DELETE /api/ms/connection` — Microsoft 계정 연결(user 이상, `lib/ms/`). 오리진은 `MS_ALLOWED_ORIGINS` 허용 목록만
- `GET /api/rfp/projects/[id]/sharepoint`, `PUT·DELETE …/sharepoint/folder`({url} → Graph shares 해석 → `rfp_projects.sharepoint_folder`), `POST …/sharepoint/upload`(→ `{upload, notified, notifyError?}`, 오류 `code: no_folder|not_connected|reconnect`) — SharePoint 등록(user 이상). 업로드는 `uploadProjectXlsx`(xlsx 라우트와 같은 `buildProjectWorkbook`)
```

(c) 테이블 — "### Supabase Tables (RFP 분석)"의 2단계 줄 아래에 추가:

```
- `ms_connections`(사용자당 1행, `refresh_token_enc` AES-256-GCM `v1.iv.tag.cipher`, RLS 정책 없음 = service role만), `rfp_projects.sharepoint_folder`(jsonb {url, driveId, itemId, name, webUrl, setBy, setAt}), `rfp_sharepoint_uploads`(업로드 이력) — SQL `docs/sql/2026-09-05-rfp-sharepoint.sql`
```

(d) Key Patterns "RFP 분석" 단락 끝 문장 뒤에 덧붙인다.

찾을 문장:
```
`rfp_requirements.solution`은 더는 편집하지 않고 화면·xlsx의 "당사 솔루션"은 `mappingSummary`로 만든다.
```
바꿀 문장:
```
`rfp_requirements.solution`은 더는 편집하지 않고 화면·xlsx의 "당사 솔루션"은 `mappingSummary`로 만든다. 3단계: `lib/ms/`(crypto AES-GCM·HMAC state / oauth 위임 토큰 / config settings+env / origin 허용 오리진·returnTo / connections `ms_connections`+access 토큰 5분 캐시 / graph-drive shares 해석·업로드) + `lib/rfp/sharepoint.ts`(`buildProjectWorkbook` xlsx 라우트 공용·`uploadProjectXlsx`·`buildUploadNotice`·`loadUploads`). 파일명 날짜는 KST(`kstYmd`). 토큰·시크릿은 어떤 로그·응답에도 쓰지 않는다.
```

(e) Environment Variables — 찾을 문장 → 바꿀 문장:

```
- `TEAMS_GRAPH_CLIENT_SECRET` — Graph app-only 클라이언트 시크릿 (멤버 가져오기를 Graph 방식으로 쓸 때만 필수; `teams_members_webhook_url` 웹훅 방식이면 불필요; settings에 저장 금지)
```
→
```
- `TEAMS_GRAPH_CLIENT_SECRET` — Graph 클라이언트 시크릿. 멤버 가져오기 Graph 방식(app-only)과 RFP SharePoint 업로드(위임 OAuth 토큰 교환·갱신)에 필수; 멤버 가져오기만 웹훅 방식이면 후자 때문에 여전히 필요. settings에 저장 금지
- `MS_TOKEN_ENC_KEY` — RFP SharePoint 업로드용 Microsoft refresh 토큰 암호화 키(64자 hex, `openssl rand -hex 32`). 교체 시 모든 연결이 재연결 필요
- `MS_ALLOWED_ORIGINS` — (선택) Microsoft OAuth 리디렉션 오리진 허용 목록(쉼표). 기본 `https://inje-playground.vercel.app,http://localhost:3003`
```

(f) Directory Layout — 찾을 문장 → 바꿀 문장(세 줄):

```
- `components/` — Organized by feature: `ladder/`, `team/`, `food/`, `guide/`, `settings/`, `shared/`, `layout/`, `admin/claude-usage/`(Claude 사용량 대시보드 탭·차트), `admin/directory/`(사내 조직도 표), `admin/rfp-catalog/`(솔루션·소스·기능 표), `rfp/`(업로드·개요·요구사항 표)
```
→
```
- `components/` — Organized by feature: `ladder/`, `team/`, `food/`, `guide/`, `settings/`(+`MicrosoftAccountCard`), `shared/`, `layout/`, `admin/claude-usage/`(Claude 사용량 대시보드 탭·차트), `admin/directory/`(사내 조직도 표), `admin/rfp-catalog/`(솔루션·소스·기능 표), `rfp/`(업로드·개요·요구사항 표·`SharePointSection`)
```

```
- `hooks/` — `useLocalStorage`, `useParticipants`, `useBgm`, `useTts`, `useSettings`(관리자 전역 설정), `useProviderSettings`(provider 3축)
```
→
```
- `hooks/` — `useLocalStorage`, `useParticipants`, `useBgm`, `useTts`, `useSettings`(관리자 전역 설정), `useProviderSettings`(provider 3축), `useMsCallbackQuery`(Microsoft 연결 콜백 쿼리 처리)
```

```
- `lib/` — Pure logic: `ladder.ts`, `team-divider.ts`, `dooray.ts`, `nlm-service.ts`, `providers.ts`(provider 상수/파서), `settings-server.ts`(서버 settings 로더), `teams-graph.ts`(Graph app-only), `notify/`(Notifier: dooray/teams/messages/recipients), `members/`(MemberSource: dooray/teams), `claude-usage/`(OTLP 파서·CSV 파서·집계·인증), `rfp/`(파서·개요·중복·추출·xlsx·catalog/·mapping/)
```
→
```
- `lib/` — Pure logic: `ladder.ts`, `team-divider.ts`, `dooray.ts`, `nlm-service.ts`, `providers.ts`(provider 상수/파서), `settings-server.ts`(서버 settings 로더), `teams-graph.ts`(Graph app-only), `ms/`(Microsoft 위임 OAuth·토큰 암호화·연결 저장·Graph 드라이브), `notify/`(Notifier: dooray/teams/messages/recipients), `members/`(MemberSource: dooray/teams), `claude-usage/`(OTLP 파서·CSV 파서·집계·인증), `rfp/`(파서·개요·중복·추출·xlsx·catalog/·mapping/·sharepoint.ts)
```

```
- `types/` — TypeScript interfaces: `ladder.ts`, `team.ts`, `dooray.ts`, `guide.ts`, `claude-usage.ts`, `rfp.ts`
```
→
```
- `types/` — TypeScript interfaces: `ladder.ts`, `team.ts`, `dooray.ts`, `guide.ts`, `claude-usage.ts`, `rfp.ts`, `ms.ts`
```

- [ ] **Step 4: 확인**

Run: `cd /Users/seunguk.kang/orca/workspaces/inje-playground/rfp-analyzer && grep -n "3단계" docs/rfp-analyzer.md | head -20 && grep -n "3-C" docs/teams-integration.md && grep -n "MS_TOKEN_ENC_KEY\|lib/ms\|useMsCallbackQuery\|ms.ts" CLAUDE.md`
Expected: 각 파일에 새 내용이 보이고, `docs/rfp-analyzer.md`에 "## 3단계 접점" 제목이 남아 있지 않다(`grep -c "3단계 접점" docs/rfp-analyzer.md` → 0).

- [ ] **Step 5: 커밋**

```bash
git add docs/rfp-analyzer.md docs/teams-integration.md CLAUDE.md
git commit -m "docs(rfp): 3단계 런북(구성·env·설치 6~8·운영 메모·체크리스트 21~28), Teams 가이드 3-C 위임 권한 절, CLAUDE.md 갱신

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBFSDo2gi4ZcXWhXTHTpWv"
```

---

## 실행 뒤(컨트롤러)

- Task 1 직후 `docs/sql/2026-09-05-rfp-sharepoint.sql`을 Management API로 운영 DB에 적용한다.
- 전체 태스크 완료 후 `npm test`(전체)·`npm run build` → 최종 whole-branch 리뷰 → `superpowers:finishing-a-development-branch`(push → PR → 머지 → `vercel --prod`).
- 배포 전 사용자 액션(런북 최초 설치 6~8): Entra 리디렉션 URI·위임 권한 4개, Vercel env `MS_TOKEN_ENC_KEY`·`TEAMS_GRAPH_CLIENT_SECRET`, settings `teams_tenant_id`·`teams_graph_client_id`. 수동 체크리스트 21~28은 이 액션이 끝난 뒤 실행할 수 있다.
