# 데스크탑 앱 아마란스 MCP 커넥터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** claude.ai 조직 커넥터 `https://innocrew.innogrid.com/api/mcp`가 inno-creed 2.2.0과 같은 도구 57개를 제공하고, 실제 실행은 사용자의 데스크탑 앱(macOS·Windows)이 Supabase 중계 행을 받아 아마란스를 호출해 돌려준다.

**Architecture:** 웹(Next.js) `/api/mcp`가 Streamable HTTP JSON-RPC를 받아 Supabase JWT(OAuth 2.1 서버 발급)로 사용자를 식별하고 `mcp_calls` 행을 넣은 뒤 결과를 폴링한다. 앱은 Realtime으로 자기 행을 받아 클레임·실행(`McpTools` 57개 디스패치 → `GwClient`)·결과 저장. 동의 화면 `/oauth/consent`만 우리가 만들고 인가·토큰·DCR은 Supabase가 맡는다.

**Tech Stack:** Next.js 16(App Router, vitest), Supabase(Postgres·RLS·Realtime·OAuth 2.1 서버), Flutter 3.47(Riverpod 3, supabase_flutter 2.18, http MockClient), mitmproxy(개발자 실측 전용).

**Spec:** `docs/superpowers/specs/2026-10-10-desktop-mcp-connector-design.md` — 충돌하면 스펙이 우선.

## Global Constraints

- 도구 이름·입력 스키마·응답 키는 inno-creed 2.2.0과 **동일**. 원본: `frontend/src/lib/mcp/tools.json`(스키마 57), 응답 픽스처: `mobile/test/mcp/fixtures/expected/<tool>.json`(읽기 28개, 2026-10-10 실측).
- 서버는 도구 인자·결과·토큰을 로그·감사에 남기지 않는다. 감사는 `{tool, ms, ok}`만.
- `mcp_calls` 행은 응답 직후 삭제. 10분 지난 행은 크론이 삭제.
- 앱 `mobile/lib`·`mobile/test`의 기존 파일에 `dart format`을 돌리지 않는다(문자열 치환으로만 편집). 확인은 `flutter analyze`·`flutter test`.
- 앱 실행기는 macOS·Windows에서만 켜진다(`Platform.isMacOS || Platform.isWindows`).
- 웹 라우트는 `requireUser()`(user 이상)로 인증. 401에는 `WWW-Authenticate: Bearer resource_metadata="https://innocrew.innogrid.com/.well-known/oauth-protected-resource"`.
- 구현자는 **커밋하지 않는다**(두 작업 트리 작업이 병렬이라 index 충돌 방지). 컨트롤러가 검토 뒤 커밋한다.
- 한국어 UI·메시지. 커밋 메시지 한국어.

## Review Focus

1. 같은 사용자의 Mac·Windows 앱이 동시에 떠 있을 때 한 호출이 두 번 실행되면 안 된다(클레임 UPDATE의 `status='pending'` 조건). `McpWorker` 경합 테스트.
2. 앱이 꺼져 있으면 Claude가 110초를 기다리면 안 된다(10초 미클레임 → 즉시 안내). 웹 relay 테스트.
3. 웹 응답 뒤 늦게 도착한 앱 결과가 없는 행에 UPDATE를 치면 조용히 무시돼야 한다(앱은 `UPDATE … WHERE id=? AND status='running'`의 0행을 오류로 보지 않는다).
4. 토큰 없는 요청은 반드시 **401 + resource_metadata 헤더**여야 Claude가 로그인을 시작한다(403·200이면 "Couldn't reach the MCP server").
5. inno-creed 스키마가 `['string','integer']`를 허용하므로 숫자 인자(예 `seq_num: 123`)와 문자열 인자 둘 다 받아야 한다 — 디스패치 인자 정규화 테스트.

---

### Task 1: 중계 테이블·정리 크론 (web)

**Files:**
- Create: `docs/sql/2026-10-10-mcp-calls.sql`
- Create: `frontend/src/app/api/cron/mcp-purge/route.ts`
- Modify: `frontend/vercel.json` (crons에 `{ "path": "/api/cron/mcp-purge", "schedule": "*/5 * * * *" }`)
- Test: `frontend/src/lib/__tests__/mcp-purge.test.ts`

**Interfaces:**
- Produces: 테이블 `public.mcp_calls(id uuid pk default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, tool text not null, args jsonb not null default '{}', status text not null default 'pending' check (status in ('pending','running','done','error')), result jsonb, worker text, created_at timestamptz not null default now(), claimed_at timestamptz, done_at timestamptz)`; 인덱스 `mcp_calls_user_status_idx on (user_id, status, created_at)`; RLS 켬 — 정책 `mcp_calls_own_select`(select, `auth.uid() = user_id`), `mcp_calls_own_update`(update, using·with check `auth.uid() = user_id`); `alter publication supabase_realtime add table public.mcp_calls`; `grant select, update on public.mcp_calls to authenticated`.

- [ ] **Step 1: SQL 작성** — 위 DDL을 파일로. 주석에 "행은 웹이 응답 뒤 삭제, 10분 지나면 크론 삭제".
- [ ] **Step 2: SQL 적용** — 컨트롤러가 Management API로 적용한다(메모리 `supabase-sql-via-management-api`). 구현자는 적용하지 않고 파일만 만든다.
- [ ] **Step 3: 크론 라우트 테스트(실패 확인)** — `mcp-purge.test.ts`: `GET` 핸들러를 `authorization: Bearer <CRON_SECRET>`로 부르면 admin 클라이언트의 `from('mcp_calls').delete().lt('created_at', <10분 전 ISO>)`가 한 번 호출되고 `{deleted: n}`을 돌려준다; 시크릿이 틀리면 401. `jira-privacy/route.ts`의 시크릿 비교(상수 시간 비교)를 그대로 복사.
- [ ] **Step 4: 구현** — `export const runtime = "nodejs"; export const maxDuration = 30;` `createAdminClient()`로 삭제, `select('id', {count:'exact', head:true})` 대신 `delete().lt(...).select('id')` 길이로 건수.
- [ ] **Step 5: 테스트 통과·vercel.json 크론 추가** — `cd frontend && npx vitest run src/lib/__tests__/mcp-purge.test.ts`.

### Task 2: MCP 끝점 뼈대 — 메타데이터·401·initialize·tools/list (web)

**Files:**
- Create: `frontend/src/lib/mcp/tools.json` — 컨트롤러가 `scratchpad/inno-creed-tools.json`(57개)을 복사해 둔다. 구현자는 설명 문자열 안의 `~/.config/inno-creed/person_groups.json`·`~/.config/inno-creed/approval_line.json`을 각각 `앱 설정 폴더의 person_groups.json`·`(앱에서는 미지원)`으로 치환한다(이름·inputSchema는 손대지 않는다).
- Create: `frontend/src/lib/mcp/protocol.ts`
- Create: `frontend/src/app/api/mcp/route.ts`
- Create: `frontend/src/app/.well-known/oauth-protected-resource/route.ts` 와 `frontend/src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`(같은 JSON)
- Modify: `frontend/src/lib/page-access.ts` — `PAGES`에 `{ key: "mcp", href: "/apps#mcp", label: "Claude 커넥터 (메뉴 숨김)", group: "work", minRole: "user", hidden: true }`, routes에 `["/api/mcp", ["mcp"]]`.
- Test: `frontend/src/lib/__tests__/mcp-protocol.test.ts`, `frontend/src/lib/__tests__/mcp-route.test.ts`

**Interfaces:**
- Produces (`protocol.ts`):
  ```ts
  export const MCP_RESOURCE = "https://innocrew.innogrid.com/api/mcp";
  export const MCP_AUTH_SERVER = "https://avooqcxehfeurjhqqgui.supabase.co/auth/v1";
  export const MCP_SERVER_INFO = { name: "innogrid-app", version: "1.0.0" };
  export type JsonRpcId = string | number | null;
  export type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: unknown };
  export function parseJsonRpc(body: unknown): JsonRpcRequest | { error: { code: number; message: string } }; // 배치(배열)는 -32600, jsonrpc≠"2.0"·method 없음 -32600
  export function rpcResult(id: JsonRpcId, result: unknown): object;
  export function rpcError(id: JsonRpcId, code: number, message: string): object;
  export function protectedResourceMetadata(): { resource: string; authorization_servers: string[]; scopes_supported: string[]; bearer_methods_supported: string[] };
  export function wwwAuthenticate(): string; // `Bearer resource_metadata="https://innocrew.innogrid.com/.well-known/oauth-protected-resource"`
  export function listTools(): Array<{ name: string; description: string; inputSchema: object }>; // tools.json 그대로(57)
  export function handleStateless(req: JsonRpcRequest): { kind: "respond"; body: object } | { kind: "accepted" } | { kind: "call"; id: JsonRpcId; name: string; args: Record<string, unknown> } | { kind: "error"; body: object };
  ```
  `handleStateless`: `initialize` → result `{ protocolVersion: params.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo }`; `notifications/initialized`·`notifications/*` → accepted(HTTP 202 빈 본문); `ping` → `{}`; `tools/list` → `{ tools }`; `tools/call` → `{kind:"call"}`(name이 목록에 없으면 -32602 "모르는 도구"); 그 외 -32601.
- Consumes: `requireUser()`(`lib/rfp/require-user.ts`).

- [ ] **Step 1: protocol 테스트 작성** — initialize 에코, 배치 거부, 모르는 메서드, tools/list 길이 57·첫 항목 `approval_counts`, tools/call 분기, 모르는 도구.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/mcp-protocol.test.ts`.
- [ ] **Step 3: protocol 구현**.
- [ ] **Step 4: 라우트 테스트** — `requireUser`를 `vi.mock`으로 가짜: ① 미인증 → 401, 헤더 `www-authenticate` 값 정확히, 본문 `{error}`; ② user → `POST` initialize 200 JSON; ③ `GET` 405; ④ `DELETE` 200; ⑤ 본문 1MB 초과(`content-length`) → 413; ⑥ JSON 파싱 실패 → 200 본문 `-32700`(JSON-RPC 규약); ⑦ 메타데이터 라우트 `GET` → JSON·`Cache-Control: public, max-age=300`.
- [ ] **Step 5: 라우트 구현** — `export const runtime = "nodejs"; export const maxDuration = 120;` `tools/call`은 이번 태스크에서 `rpcError(id, -32603, "중계 미구현")`로 두고 Task 3이 바꾼다. 응답 헤더 `Cache-Control: no-store`.
- [ ] **Step 6: 통과 확인** — vitest 두 파일 + `npx tsc --noEmit -p .` + `npx eslint src/lib/mcp src/app/api/mcp "src/app/.well-known"`.

### Task 3: tools/call 중계 (web)

**Files:**
- Create: `frontend/src/lib/mcp/relay.ts`
- Modify: `frontend/src/app/api/mcp/route.ts` (tools/call → relay)
- Test: `frontend/src/lib/__tests__/mcp-relay.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RelayDeps = { admin: SupabaseClient; now?: () => number; sleep?: (ms: number) => Promise<void> };
  export const CLAIM_TIMEOUT_MS = 10_000, DONE_TIMEOUT_MS = 110_000, POLL_MS = 500, RATE_LIMIT_PER_MIN = 60;
  export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
  export async function relayToolCall(deps: RelayDeps, userId: string, tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  ```
  동작: ① 최근 60초 `mcp_calls` 건수(`user_id`) ≥ 60 → `isError` "요청이 너무 많습니다. 잠시 후 다시 시도하세요." ② insert → id. ③ 0.5초마다 `select status,result` — 10초 안에 `status==='pending'`이면 delete 후 `isError` "데스크탑 앱이 실행 중이 아닙니다. https://innocrew.innogrid.com/apps 에서 INNOGRID 앱을 설치·로그인하고 더보기 > 아마란스에서 연결하세요." ④ `done` → delete, `result.text`(문자열) → `{content:[{type:"text",text}]}`; `error` → delete, `isError` + `result.error`. ⑤ 110초 초과 → delete, `isError` "앱이 응답하지 않았습니다(시간 초과). 쓰기 작업이었다면 아마란스에서 반영 여부를 확인하세요."
- 라우트: 성공·실패 모두 `rpcResult(id, toolResult)`(MCP 도구 오류는 JSON-RPC 오류가 아니다). `logAudit(admin, request, { userId, action: "mcp.tool", category: "mcp", detail: { tool, ms, ok } })`.

- [ ] **Step 1: 테스트** — 가짜 admin(`from().insert().select().single()`, `select().eq().single()`, `delete().eq()`, `select(count)`)을 상태 기계로: pending 그대로 → 10초 안내(가짜 시계·sleep); running→done → 결과; error → isError; 110초 초과; 분당 상한; 모든 경로에서 delete 호출 1회.
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `npx vitest run src/lib/__tests__/mcp-relay.test.ts src/lib/__tests__/mcp-route.test.ts`.
- [ ] **Step 3: 감사 카테고리** — `lib/audit.ts` `AUDIT_CATEGORIES`에 `"mcp"`, `AUDIT_CATEGORY_LABEL`에 `mcp: "Claude 커넥터"` 추가(기존 배열 끝에).

### Task 4: OAuth 동의 화면 `/oauth/consent` (web)

**Files:**
- Create: `frontend/src/app/oauth/consent/page.tsx`
- Modify: `frontend/src/middleware.ts` 또는 공개 경로 목록 — `/oauth/consent`는 로그인 필요 페이지(미로그인 → `/login?next=`)로 두되 `page-access` 검사는 하지 않는다(모든 로그인 사용자).
- Test: `frontend/src/lib/__tests__/oauth-consent.test.ts`(렌더 로직 분리: `lib/mcp/consent.ts`)

**Interfaces:**
- `lib/mcp/consent.ts`: `export function loopbackWarning(redirectUri: string): string | null` — host가 `localhost`·`127.0.0.1`이면 "이 PC에서 실행 중인 프로그램(Claude Code)이 연결을 요청했습니다. 직접 연결을 시작한 경우에만 허용하세요." 아니면 null. `export function describeScopes(scopes: string[]): string[]`(email → "이메일 주소", profile → "이름·프로필", openid → "로그인 확인", offline_access → "자동 갱신(다시 로그인 없이 유지)").
- 페이지(클라이언트): `authorization_id` 쿼리 → `supabase.auth.oauth.getAuthorizationDetails(id)` → 클라이언트 이름·redirect_uri·scope 표시 → [허용] `approveAuthorization(id)` → `redirect_url`로 `window.location.assign`; [거부] `denyAuthorization(id)` → 같은 처리. 로그인 세션 없으면 `router.replace('/login?next=' + encodeURIComponent(현재 경로+쿼리))`. 오류는 한 줄 + "다시 시도". 브라우저 Supabase 클라이언트는 `lib/supabase.ts`의 것.

- [ ] **Step 1: consent.ts 테스트·구현**.
- [ ] **Step 2: 페이지 구현** — shadcn Card·Button, 제목 "Claude를 INNOGRID 계정에 연결", 본문: "{client_name}이(가) 다음 정보에 접근하려 합니다", scope 목록, 돌아갈 주소 호스트, 루프백 경고(있을 때), 버튼 두 개. 감사: `POST /api/mcp/consent-audit`는 만들지 않는다 — 대신 승인·거부 결과를 `logAudit`하려면 서버가 필요하므로 **생략**(Supabase 자체 감사 로그로 충분; 스펙 §5.2의 감사 항목은 이 결정으로 제외).
- [ ] **Step 3: 타입·린트** — `npx tsc --noEmit -p . && npx eslint src/app/oauth src/lib/mcp`.

### Task 5: 앱 실행기 `McpWorker`·설정 행 (app)

**Files:**
- Create: `mobile/lib/mcp/mcp_worker.dart`, `mobile/lib/mcp/mcp_worker_provider.dart`, `mobile/lib/mcp/mcp_settings_sheet.dart`
- Modify: `mobile/lib/main.dart`(`ref.watch(mcpWorkerProvider);` — `talkAlertWatcherProvider` 줄 아래), `mobile/lib/more/more_screen.dart`(계정 카드의 `_GwRow` 아래에 데스크탑 전용 행 "Claude 커넥터" → `McpSettingsSheet`)
- Test: `mobile/test/mcp/mcp_worker_test.dart`

**Interfaces:**
- Produces:
  ```dart
  class McpCall { final String id, tool; final Map<String, dynamic> args; }
  typedef McpExecutor = Future<String> Function(String tool, Map<String, dynamic> args); // 성공 JSON 문자열, 실패는 McpToolError(message) throw
  class McpToolError implements Exception { final String message; }
  /// 순수 로직: 알림·폴링으로 받은 pending 행을 클레임→실행→완료. 저장소·실시간은 주입.
  class McpWorker {
    McpWorker({required Future<List<McpCall>> Function() fetchPending, required Future<McpCall?> Function(String id) claim,
      required Future<void> Function(String id, {String? text, String? error}) complete, required McpExecutor execute,
      Stream<McpCall>? inserts, Duration poll = const Duration(seconds: 5), String worker = ''});
    Future<void> start(); void dispose();
    Future<void> handle(McpCall c); // 테스트용 공개: claim→execute→complete, 직렬(큐)
    int get handled; DateTime? get lastAt; String? get lastTool; // 설정 화면 표시
  }
  ```
  실행 시간 제한 90초(`timeout`) → `error: "앱 실행 시간 초과"`. 결과 512KB 초과 → 앞 512KB + `…(truncated)` 를 `text`로 보내고 JSON이면 `{"truncated":true,"text":…}` 로 감싼다. 예외는 `McpToolError.message` 또는 `'처리하지 못했습니다: ${e.runtimeType}'`(원문 금지 — 토큰이 섞일 수 있음).
- `mcp_worker_provider.dart`: `final mcpEnabledProvider = NotifierProvider<McpEnabled, bool>`(shared_preferences `mcp_enabled`, 기본 true); `final mcpWorkerProvider = Provider<McpWorker?>` — `Platform.isMacOS || Platform.isWindows`이고 `sessionProvider`가 로그인 상태이고 enabled일 때만. Supabase 바인딩: `Supabase.instance.client.from('mcp_calls')` — fetchPending `select().eq('status','pending').order('created_at')`, claim `update({'status':'running','worker':w,'claimed_at':now}).eq('id',id).eq('status','pending').select().maybeSingle()`, complete `update({...}).eq('id',id).eq('status','running')`; inserts는 `client.channel('mcp_calls:$uid').onPostgresChanges(event: PostgresChangeEvent.insert, schema:'public', table:'mcp_calls', filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column:'user_id', value: uid), callback: …)`. 사용자 id는 `Supabase.instance.client.auth.currentUser!.id`. executor는 Task 6의 `McpTools.execute`(이 태스크에서는 모르는 도구 오류만 내는 자리표시 함수를 넣고 Task 6이 바꾼다).
- 설정 시트: 제목 "Claude 커넥터", 설명 "claude.ai·Claude Code에서 'INNOGRID 아마란스' 커넥터를 연결하면 이 앱이 요청을 대신 실행합니다. 아마란스가 연결돼 있어야 합니다.", 스위치 "요청 받기", 상태 줄(`handled`건·`lastTool`·`lastAt` "N분 전", 아마란스 미연결 경고), 링크 "커넥터 연결 방법" → `https://innocrew.innogrid.com/apps#mcp`(url_launcher).

- [ ] **Step 1: 테스트** — ① inserts 스트림으로 받은 호출을 claim→execute→complete(text) 순서로; ② claim이 null(다른 기기가 가져감)이면 execute 안 함; ③ execute가 McpToolError면 complete(error); ④ 두 호출이 동시에 와도 직렬(실행 중 카운터 최대 1); ⑤ 폴링(가짜 타이머 대신 `poll`을 짧게 주고 `fetchPending`가 한 번 pending을 주면 처리); ⑥ 90초 초과 → error 문구; ⑦ 512KB 초과 잘림.
- [ ] **Step 2: 실패 확인 → 구현 → `flutter test test/mcp/mcp_worker_test.dart` 통과**.
- [ ] **Step 3: provider·설정 시트·main 연결** — `flutter analyze` 0건. 기존 파일 편집은 치환만.

### Task 6: `McpTools` 디스패치 — 신규 엔드포인트가 필요 없는 35개 (app)

**Files:**
- Create: `mobile/lib/mcp/mcp_tools.dart`, `mobile/lib/mcp/mcp_args.dart`, `mobile/lib/mcp/person_groups.dart`, `mobile/lib/mcp/approval_schemas.dart`
- Create: `mobile/assets/mcp/approval_line_schemas.json`, `approval_line_schema_{36,40,41,43}.json`, `approval_submission_guides.json`, `approval_submission_guide_{36,40,41,43}.json`(컨트롤러가 픽스처에서 복사), pubspec `assets:`에 `- assets/mcp/`
- Modify: `mobile/lib/mcp/mcp_worker_provider.dart`(executor를 `McpTools(...).execute`로)
- Test: `mobile/test/mcp/mcp_tools_test.dart`(+ `mobile/test/mcp/fixtures/expected/*.json`은 컨트롤러가 배치)

**Interfaces:**
- `mcp_args.dart`: `String str(Map a, String k, [String d=''])`, `int? intOf(Map a, String k)`, `bool boolOf(Map a, String k, [bool d=false])`, `List<String> strList(Map a, String k)`(배열·콤마 문자열 모두), `String ymd(String v)`(`YYYY-MM-DD`·`YYYYMMDD`·`YYYYMMDDHHmm` 앞 8자리), `DateTime hm(String v)`(`YYYYMMDDHHmm` → KST `DateTime.utc` 규약은 `gw_models` 독스트링대로).
- `McpTools({required GwApi? gw, required String Function() appSupportDir})` with `Future<String> execute(String tool, Map<String, dynamic> args)` — 결과는 `jsonEncode` 문자열. gw null이면 모든 아마란스 도구는 `McpToolError('아마란스가 연결되어 있지 않습니다. 앱 더보기 > 아마란스에서 연결하세요.')`.
- 이번 태스크 범위(35): whoami, find_person, org_chart, person_group, save_person_group, delete_person_group, list_resources, list_reservations, my_reservations, find_free_rooms, reserve_resource, cancel_reservation, list_calendars, list_events, create_calendar_event(기존 옵션만: title/start/end/participants/contents→place 아님·calendar), delete_calendar_event, get_attendance_today, attendance_clock_in, attendance_clock_out, list_mailboxes, mailbox_counts, list_mail_inbox, list_mail_drafts(DRAFTS mboxSeq는 `mail000A01` 트리에서 `fullname/name=='DRAFTS'`), read_mail, save_mail_draft, send_mail, approval_counts, pending_approvals, read_approval, list_approval_line_schemas, get_approval_line_schema, list_approval_submission_guides, get_approval_submission_guide, suggest_approval_line, list_notices, read_notice, search. (실제로 37개 이름이지만 clock_in/out·whoami 등 포함해 세면 35 — 목록이 권위.)
- 응답 키는 `fixtures/expected/<tool>.json`과 같아야 한다(값은 다르다). 기존 앱 메서드가 슬림 모델을 돌려주면 이 태스크에서 **원본 봉투를 쓰는 저수준 호출을 `gw_mcp_api.dart`에 추가**한다(예: `list_mail_inbox`는 `client.call('/mail/mail003A01', …)` 결과를 그대로).
- `person_groups.dart`: 파일 `<appSupportDir>/person_groups.json`, 형식 `{"groups":{"<이름>":{"note":"","members":[{"empSeq":"3166","label":"이재학"}]}}}`; `save`는 `roster()`로 이름→empSeq 해석, 없는 사람·동명이인은 저장하지 않고 `{ok:false, candidates:[…]}`; `person_group(name)`은 members를 명부로 풀어 `members[]`(empSeq/name/email/dept/duty/status)·`empSeqs`·`emails`·`missing`.
- `approval_schemas.dart`: 자산 로드(`rootBundle`), `docType` 별칭·formId 해석(`list_approval_line_schemas.forms[].aliases`), `suggest(docType, trip, whoami, orgChartTree, deptMembers(deptId))`: 본인 duty로 grade 구간 → branch 선택(출장은 `trip` 국내/해외, 비면 둘 다) → 각 `pos`: `L_*`는 기안 부서에서 상위로 올라가며 그 duty 보유자, 고정 직책은 `positions[].dept`의 부서원에서 duty로 → 단계별 `status`(후보1/후보다수/미해결), `verificationRequired:true`, `warnings[]`. 스키마 JSON의 실제 필드명은 `fixtures/expected/get_approval_line_schema-연차휴가신청.json`을 열어 그대로 쓴다.

- [ ] **Step 1: 테스트** — 도구마다 MockClient 라우팅(`test/assistant/gw_assistant_api_test.dart`의 패턴)으로 호출 → 결과 JSON의 키 집합이 expected 픽스처의 최상위 키와 같음(`containsAll`), 대표 값 1~2개 단정; 인자 정규화(`seq_num` 숫자·문자열); 사람 그룹 저장 검증; suggest 4양식.
- [ ] **Step 2: 실패 확인 → 구현 → `flutter test test/mcp` 통과, `flutter analyze` 0건**.

### Task 7: 실측 픽스처 (컨트롤러 작업 — 구현자 없음)

mitmproxy로 inno-creed 2.2.0의 신규 엔드포인트 22개분 요청·응답을 받아 `mobile/test/mcp/fixtures/captured/<tool>.json`(`{"calls":[{"path","contentType","body","response"}]}`, 토큰·서명·개인정보 가림)으로 저장한다. 쓰기 도구는 스펙 §10의 안전 대상으로 1회. 캡처가 끝난 도구만 Task 8~11에 넘긴다.

### Task 8: 회의실·일정 수정 + 근태 월 (app)

**Files:** `mobile/lib/gw/gw_mcp_api.dart`(추가), `mobile/lib/mcp/mcp_tools.dart`(분기 추가), `mobile/test/mcp/mcp_tools_update_test.dart`
- 도구: update_reservation(`rs121A12` 등 captured 그대로 → `rs121A05` 재조회 `attendeesVerified`), update_calendar_event(`sc111A05` 수정 → `sc111A03` 재조회, 본인 작성만), create_calendar_event 추가 인자(allday/secret_memo/video — captured에 있는 만큼), attendance_month(`days[]`·`summary` 계산은 expected 픽스처 형식).
- [ ] 테스트(captured 요청 본문 일치 + expected 키) → 구현 → 통과.

### Task 9: 메일 5 + 첨부 업로드 (app)

- 도구: mark_mail_unread(`mail002A15` + 최근 200건 목록 재조회 `verifiedByReadback`·`already`), delete_mail, send_mail_from_draft(초안 조회·제약 4가지·발송·초안 삭제 `draft_deleted`), download_mail_attachment·download_body_image(파일 저장: `out_path` 실패 시 `~/Downloads/<이름>` → `savedPath`), save_mail_draft/send_mail의 `attachments`(로컬 파일 업로드 — captured 흐름).
- [ ] 테스트 → 구현 → 통과. 저장 경로 폴백 테스트는 임시 디렉터리로.

### Task 10: 결재 조회·결재선·첨부 (app)

- 도구: list_approvals(8개 함 파라미터 표는 captured), list_approval_attachments, download_approval_attachment(1건만, 콤마 거부), list_approval_lines·read_approval_line·save_approval_line·delete_approval_line.
- [ ] 테스트 → 구현 → 통과.

### Task 11: 결재 상신·취소·임시 삭제 + 게시판 첨부 (app)

- 도구: submit_approval(근태 HP interlock → ECM 첨부 → `eap110A03` → 상신; 자동 주입 신원 값은 whoami·org_chart), cancel_approval(상태별 순차 + 재조회 `verified_by_readback`, 10·20·30만), delete_temp_approval, list_notice_attachments, download_notice_attachment.
- [ ] 테스트 → 구현 → 통과. 상신은 captured 흐름을 **순서까지** 단정한다.

### Task 12: 마무리 — 권한·문서·스크립트 (web+app)

**Files:** `mobile/macos/Runner/DebugProfile.entitlements`·`Release.entitlements`(`com.apple.security.files.downloads.read-write` true), `frontend/scripts/company-directory-sync.py`(옵션 `INNO_MCP_URL`+`INNO_MCP_TOKEN`로 HTTP JSON-RPC `tools/call find_person {no_limit:true}`; 기본은 기존 stdio), `frontend/src/app/apps/page.tsx`(섹션 `#mcp` "Claude 커넥터": 연결 방법 3단계·앱 필요 안내), `docs/mobile-app.md` §Claude 커넥터, `.claude/rules/mobile.md`, `CLAUDE.md`(API 한 줄), `docs/company-directory.md`(inno-creed → 커넥터 전환).
- [ ] 각 파일 수정 → `npm test`·`flutter test`·`flutter analyze` 전체 녹색.
