# 사내 LLM 포털 1단계(웹·서버) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버가 대화를 저장하고 턴을 진행하는 `/api/chat/*`와 웹 채팅 `/chat`(첨부 포함), 거버넌스(권한·모델·하루 상한·마스킹·보존·감사·관리자 사용량), 채팅 중심 홈·메뉴를 만든다.

**Architecture:** 턴 엔진(`lib/chat/engine.ts`)이 의존성 주입으로 저장소·Claude 스트림·도구 실행기를 받아 한 요청 안에서 "기록 불러오기 → 마스킹 → Claude 호출 → 서버·중계 도구 실행(최대 3회) → 저장"을 돌리고, 이벤트를 `emit`으로 내보낸다. 라우트는 이 이벤트를 SSE로 흘린다. 사람 확인이 필요한 호출(쓰기, 앱 도구)은 `needs_action`으로 멈추고, 다음 요청의 `actions`로 이어 간다.

**Tech Stack:** Next.js 16 App Router(Node 런타임), React 19, Tailwind 4, shadcn/ui, `@anthropic-ai/sdk`(스트리밍), Supabase(Postgres·RLS·Storage), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-llm-portal-phase1-design.md`

**범위 밖(별도 계획):** 앱(Flutter) 이노봇을 새 API로 옮기기와 🕘 기록 버튼. 이 계획의 API는 `client: "app"`을 이미 지원하므로(앱 도구 = `needs_action`) 앱 계획은 화면·클라이언트만 바꾸면 된다. 기존 `/api/assistant/turn`·`/execute`는 이 계획에서 지우지 않는다.

## Global Constraints

- 작업은 main에 직접 커밋(브랜치·worktree 금지). 커밋: `git -c user.email=native.platform@innogrid.com commit`, 메시지 끝에 두 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01CfA8c3gbbdi3ZSNWEy3GnD`. `.claude/skills/claude-usage-csv/SKILL.md`는 커밋하지 않는다.
- 화면 문구·오류·주석은 한국어.
- 모델: 기본 `claude-sonnet-5-5`, 허용 `claude-sonnet-5-5`·`claude-opus-5-5`(settings `assistant_models`로 줄일 수 있음).
- 보존 기본 90일(settings `assistant_retention_days`), 저장 안 함은 마지막 활동 후 24시간.
- 하루 상한: settings `assistant_daily_turns`(기본 200), 기준은 `assistant_usage.turns`(Claude 호출 1회 = 1턴, KST 날짜). 실패한 호출은 세지 않는다.
- 마스킹 치환어: `[주민번호]` `[카드번호]` `[계좌번호]` `[전화번호]`. 조직도 도구(`find_person`·`my_team`·`org_chart`) 결과는 전화번호를 가리지 않는다.
- 도구 결과 원문은 DB에 저장하지 않는다(요약 한 줄만). 로그·감사에 본문·인자·검색어를 남기지 않는다.
- 웹의 아마란스 도구는 읽기만(`RELAY_READ_TOOLS`), 데스크톱 앱이 켜져 있을 때만.
- 첨부: 메시지당 5개, 파일당 10MB, 확장자 docx·pdf·pptx·xlsx·hwp·hwpx·txt·md·png·jpg·jpeg·gif·webp.
- 서버 라우트는 service_role 클라이언트(`requireUser().admin`)로 `user_id`를 직접 걸러 읽는다. 테이블 RLS는 본인만.
- 새 의존성 금지(마크다운은 이미 있는 `react-markdown`).
- 프론트 배포는 반드시 `frontend/`에서 `vercel --prod --yes`, 배포 URL `innogrid-playground-…`·alias `innocrew.innogrid.com` 확인.

## Review Focus

1. 확인 대기(`needs_action`) 중에 사용자가 새 질문을 보내는 경우 → 대기 호출은 "취소됨" 결과로 닫히고 새 질문이 정상 처리돼야 한다(Anthropic 400 없이). — Task 7 테스트 "대기 중 새 입력".
2. 날짜(`2026-10-15`)·회사 전화(`02-1234-5678`)·사업자번호(`123-45-67890`)가 계좌로 가려지는 오탐 → 그대로 남아야 한다. — Task 2 테스트 "오탐 없음".
3. 스트림 도중 사용자가 [중지] → 받은 데까지 `stopped`로 저장, 다음 질문이 이어져야 한다. — Task 7 테스트 "중지".
4. 다른 사람 대화 ID·첨부 ID를 넣는 요청 → 404/무시, 남의 데이터가 섞이지 않아야 한다. — Task 6·9·10 테스트.
5. 실패 뒤 [다시 시도] → 실패한 응답은 기록에서 빠지고 같은 질문으로 다시 호출돼야 한다. — Task 7 테스트 "다시 시도".

## 설계서와 달라진 점(계획 단계 결정)

- 첨부 경로는 `chat/<user_id>/<attachment_id>/original.<ext>`(+ `text.txt`)다. 설계서의 `<conversation_id>` 대신 첨부 id를 쓴다 — 새 대화의 첫 메시지 첨부는 대화보다 먼저 올라오기 때문이다. 대화 연결은 `chat_attachments.conversation_id`로 한다.
- `chat_attachments`에 `kind`·`masked_count`, `chat_tool_calls`에 `tool_use_id` 열을 더한다(화면 복원·가린 건수 표시용).
- 웹의 아마란스 중계 도구는 페이지 키 `mcp`(Claude 커넥터와 같은 중계 통로)로 권한을 본다.
- 하루 상한의 "턴"은 지금 앱과 같이 Claude 호출 1회다. 기존 앱 API도 같은 `assistant_usage`를 세도록 바꾼다(Task 3).
- 확인 대기 중 새 질문이 오면 대기 호출을 "취소됨" 결과로 닫는다. 새로고침하면 확인 카드는 복원하지 않는다(다시 요청하면 된다).
- 홈의 큰 제목 블록("이노크루를 위한 서비스")은 지운다(Task 16).

## 파일 구조

```
docs/sql/2026-10-15-chat-portal.sql            테이블·RLS·버킷·RPC·페이지 키 assistant
frontend/src/lib/chat/
  mask.ts           maskText — 민감정보 가리기
  usage.ts          kstDay·turnsToday·recordUsage
  events.ts         ChatEvent·PendingCall·ActionReply 타입, sseLine(클라이언트 겸용, 서버 import 없음)
  toolset.ts        도구 위치·등급, buildToolset, 웹용 시스템 문구
  summary.ts        도구 결과 → 사람이 읽는 한 줄, TOOL_LABEL
  store.ts          ChatStore 인터페이스·Supabase 구현, historyForModel, expiresAt, titleFrom
  engine.ts         runTurn·parseTurnBody·TurnInputError
  access.ts         loadPermissions
  attachments.ts    추출·저장·불러오기·삭제
  sse-client.ts     createSseParser·postTurn(브라우저)
  view.ts           API 응답·이벤트 → 화면 메시지(reducer), groupByDate
frontend/src/lib/assistant/
  settings.ts       (수정) 허용 모델·보존일 추가
  server-tools.ts   (신규) execute 라우트 본체를 함수로
  llm.ts            (수정) streamAssistant 추가
  tools.ts          (수정) assistantSystemPrompt에 extra 줄
frontend/src/app/api/chat/{turn,config,status,attachments,conversations,conversations/[id]}/route.ts
frontend/src/app/api/cron/chat-purge/route.ts
frontend/src/app/api/admin/assistant-usage/route.ts
frontend/src/app/chat/page.tsx, frontend/src/app/chat/[id]/page.tsx
frontend/src/app/admin/assistant-usage/page.tsx
frontend/src/components/chat/{ChatWorkspace,ChatSidebar,MessageView,ToolChip,ConfirmCard,Composer,StatusStrip}.tsx
frontend/src/components/home/{HomeChatBox,RecentConversations}.tsx
```

---

### Task 1: DB 스키마·페이지 키 `assistant`

**Files:**
- Create: `docs/sql/2026-10-15-chat-portal.sql`
- Modify: `frontend/src/lib/page-access.ts:16`(AI 그룹 첫 줄 앞)
- Modify: `frontend/src/components/layout/Navigation.tsx:22-23`(아이콘 표)
- Modify: `frontend/src/lib/__tests__/gw-mail.test.tsx:22-23`(대조할 SQL 파일)

**Interfaces:**
- Produces: 테이블 `chat_conversations`·`chat_messages`·`chat_tool_calls`·`chat_attachments`·`assistant_usage`, RPC `chat_usage_add(p_user uuid, p_day date, p_model text, p_in int, p_out int, p_masked int)`, 버킷 `chat`, 페이지 키 `"assistant"`(`PageKey`).

- [ ] **Step 1: SQL 대조 테스트를 새 파일로 바꿔 실패시키기**

`gw-mail.test.tsx`의 두 곳에서 `2026-10-11-dooray-connections.sql`을 `2026-10-15-chat-portal.sql`로 바꾸고, `page-access.ts` PAGES의 `usage_code` 줄 바로 앞에 아래 줄을 넣는다.

```ts
  { key: "assistant", href: "/chat", label: "이노봇", group: "ai", minRole: "user" },
```

Run: `cd frontend && npx vitest run src/lib/__tests__/gw-mail.test.tsx`
Expected: FAIL — `ENOENT ... 2026-10-15-chat-portal.sql`

- [ ] **Step 2: SQL 작성**

`docs/sql/2026-10-15-chat-portal.sql`:

```sql
-- 2026-10-15: 사내 LLM 포털 1단계 — 서버 대화 저장(chat_*), 사용량(assistant_usage), 첨부 버킷 chat, 페이지 키 assistant.
-- 본문 테이블은 RLS로 본인만. 서버 라우트는 service_role로 user_id를 직접 걸러 읽는다(관리자 본문 열람 화면 없음).
-- 규칙: PAGES에 키를 넣으면 아래 두 함수의 목록도 같이 갱신한다(frontend/src/lib/__tests__/gw-mail.test.tsx가 이 파일을 대조).
begin;
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  model text not null,
  ephemeral boolean not null default false,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists chat_conversations_user_idx on public.chat_conversations(user_id, last_message_at desc);
create index if not exists chat_conversations_expires_idx on public.chat_conversations(expires_at);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,
  status text not null default 'ok' check (status in ('ok','failed','stopped')),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  masked_count int not null default 0,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists chat_messages_conv_idx on public.chat_messages(conversation_id, created_at);

create table if not exists public.chat_tool_calls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  tool_use_id text not null,
  tool text not null,
  location text not null check (location in ('server','device','desktop-relay')),
  status text not null check (status in ('ok','error','timeout','cancelled')),
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists chat_tool_calls_msg_idx on public.chat_tool_calls(message_id);

-- 첨부는 대화보다 먼저 올라온다(새 대화 첫 메시지). 대화가 지워지면 set null → 크론이 하루 지난 고아 행과 버킷 객체를 지운다.
create table if not exists public.chat_attachments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  name text not null,
  mime text not null,
  size int not null,
  kind text not null check (kind in ('text','image','pdf')),
  storage_path text not null,
  text_excerpt text not null default '',
  masked_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists chat_attachments_conv_idx on public.chat_attachments(conversation_id);
create index if not exists chat_attachments_orphan_idx on public.chat_attachments(created_at) where conversation_id is null;

create table if not exists public.assistant_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  turns int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  model_turns jsonb not null default '{}'::jsonb,
  masked int not null default 0,
  primary key (user_id, day)
);

create or replace function public.chat_usage_add(p_user uuid, p_day date, p_model text, p_in int, p_out int, p_masked int) returns void
language sql security definer set search_path='' as $$
  insert into public.assistant_usage as u (user_id, day, turns, input_tokens, output_tokens, model_turns, masked)
  values (p_user, p_day, 1, p_in, p_out, jsonb_build_object(p_model, 1), p_masked)
  on conflict (user_id, day) do update set
    turns = u.turns + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    masked = u.masked + excluded.masked,
    model_turns = u.model_turns || jsonb_build_object(p_model, coalesce((u.model_turns->>p_model)::int, 0) + 1);
$$;
revoke all on function public.chat_usage_add(uuid, date, text, int, int, int) from public, anon, authenticated;
grant execute on function public.chat_usage_add(uuid, date, text, int, int, int) to service_role;

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_tool_calls enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.assistant_usage enable row level security;
drop policy if exists chat_conversations_own on public.chat_conversations;
create policy chat_conversations_own on public.chat_conversations for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists chat_messages_own on public.chat_messages;
create policy chat_messages_own on public.chat_messages for all to authenticated
  using (exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));
drop policy if exists chat_tool_calls_own on public.chat_tool_calls;
create policy chat_tool_calls_own on public.chat_tool_calls for select to authenticated
  using (exists (select 1 from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id where m.id = message_id and c.user_id = (select auth.uid())));
drop policy if exists chat_attachments_own on public.chat_attachments;
create policy chat_attachments_own on public.chat_attachments for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists assistant_usage_own on public.assistant_usage;
create policy assistant_usage_own on public.assistant_usage for select to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.chat_conversations, public.chat_messages to authenticated;
grant select on public.chat_tool_calls, public.chat_attachments, public.assistant_usage to authenticated;
grant all on public.chat_conversations, public.chat_messages, public.chat_tool_calls, public.chat_attachments, public.assistant_usage to service_role;

insert into storage.buckets (id, name, public, file_size_limit) values ('chat', 'chat', false, 10485760) on conflict (id) do nothing;

create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail','dooray','assistant') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail','dooray','assistant')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;
commit;
```

`Navigation.tsx`: lucide import에 `Bot`을 추가하고 `PAGE_ICONS`에 `assistant: Bot,`을 넣는다.

- [ ] **Step 3: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/gw-mail.test.tsx src/lib/__tests__/page-access.test.ts && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 0

- [ ] **Step 4: 운영 DB에 적용**

Supabase MCP(`mcp__supabase__*`)가 인증돼 있으면 그것으로, 아니면 메모리 `supabase-sql-via-management-api.md`의 Management API 방식(키체인 토큰, 출력 금지, 사용 후 `unset T`)으로 파일 전체를 실행한다. 확인 쿼리:

```sql
select count(*) from information_schema.tables where table_schema='public' and table_name in ('chat_conversations','chat_messages','chat_tool_calls','chat_attachments','assistant_usage');
select public.valid_page_permissions('{"assistant":true}'::jsonb);
select id, public from storage.buckets where id='chat';
```
Expected: `5`, `true`, `chat | false`

- [ ] **Step 5: 커밋**

```bash
git add docs/sql/2026-10-15-chat-portal.sql frontend/src/lib/page-access.ts frontend/src/components/layout/Navigation.tsx frontend/src/lib/__tests__/gw-mail.test.tsx
git -c user.email=native.platform@innogrid.com commit -m "feat(chat): 대화 저장·사용량 테이블과 페이지 키 assistant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CfA8c3gbbdi3ZSNWEy3GnD"
```

---

### Task 2: 민감정보 마스킹 `maskText`

**Files:**
- Create: `frontend/src/lib/chat/mask.ts`
- Test: `frontend/src/lib/__tests__/chat-mask.test.ts`

**Interfaces:**
- Produces: `maskText(text: string, opts?: { keepPhone?: boolean }): { text: string; count: number }`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import { maskText } from "@/lib/chat/mask";

describe("maskText", () => {
  it("주민번호 — 하이픈 유무, 날짜가 아니면 그대로", () => {
    expect(maskText("주민 900101-1234567 끝")).toEqual({ text: "주민 [주민번호] 끝", count: 1 });
    expect(maskText("주민 9001012234567").text).toBe("주민 [주민번호]");
    expect(maskText("코드 901399-1234567").count).toBe(0);
  });
  it("카드번호 — Luhn이 맞을 때만", () => {
    expect(maskText("카드 4111-1111-1111-1111 결제").text).toBe("카드 [카드번호] 결제");
    expect(maskText("카드 4111 1111 1111 1111").text).toBe("카드 [카드번호]");
    expect(maskText("주문 4111-1111-1111-1112").count).toBe(0);
  });
  it("휴대전화, 조직도 예외(keepPhone)", () => {
    expect(maskText("연락 010-1234-5678").text).toBe("연락 [전화번호]");
    expect(maskText("연락 01012345678").text).toBe("연락 [전화번호]");
    expect(maskText("연락 010-1234-5678", { keepPhone: true })).toEqual({ text: "연락 010-1234-5678", count: 0 });
  });
  it("계좌번호 — 하이픈 형식, 숫자 10~14자리", () => {
    expect(maskText("계좌 110-123-456789 입금").text).toBe("계좌 [계좌번호] 입금");
    expect(maskText("계좌 1002-345-678901").text).toBe("계좌 [계좌번호]");
    expect(maskText("계좌 110123456789").count).toBe(0);
  });
  it("오탐 없음 — 날짜·회사 전화·사업자번호·금액·시각", () => {
    const s = "2026-10-15 14:00 회의, 대표 02-1234-5678, 031-123-4567, 사업자 123-45-67890, 1,234,567원";
    expect(maskText(s)).toEqual({ text: s, count: 0 });
  });
  it("여러 건을 센다", () => {
    expect(maskText("010-1111-2222, 900101-1234567, 110-123-456789").count).toBe(3);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-mask.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/chat/mask"`

- [ ] **Step 3: 구현**

```ts
/**
 * Claude에 보내기 직전에 민감정보를 가린다(설계서 §2-4). 순서: 주민 → 카드 → 전화 → 계좌(겹치는 형식을 앞에서 먼저 잡는다).
 * ponytail: 정규식 휴리스틱 — 하이픈 없는 계좌·외국 형식은 놓친다. 오탐·미탐 사례가 나오면 여기 규칙을 고친다.
 */
const EDGE_L = "(?<![\\d-])", EDGE_R = "(?![\\d-])";
const RRN = new RegExp(`${EDGE_L}(\\d{2})(\\d{2})(\\d{2})-?[1-4]\\d{6}${EDGE_R}`, "g");
const CARD = new RegExp(`${EDGE_L}\\d(?:[ -]?\\d){12,18}${EDGE_R}`, "g");
const PHONE = new RegExp(`${EDGE_L}01[016789]-?\\d{3,4}-?\\d{4}${EDGE_R}`, "g");
const ACCOUNT = new RegExp(`${EDGE_L}\\d{2,6}-\\d{2,6}-\\d{2,7}(?:-\\d{1,3})?${EDGE_R}`, "g");
const LANDLINE = /^0\d{1,2}-\d{3,4}-\d{4}$/;
const BIZ_NO = /^\d{3}-\d{2}-\d{5}$/;

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i];
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export function maskText(text: string, opts: { keepPhone?: boolean } = {}): { text: string; count: number } {
  let count = 0;
  const sub = (re: RegExp, label: string, ok: (m: string, g: string[]) => boolean) => (s: string) =>
    s.replace(re, (m, ...g) => (ok(m, g as string[]) ? (count++, label) : m));
  let out = sub(RRN, "[주민번호]", (_m, [, mm, dd]) => +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31)(text);
  out = sub(CARD, "[카드번호]", (m) => { const d = m.replace(/\D/g, ""); return d.length >= 13 && d.length <= 19 && luhn(d); })(out);
  if (!opts.keepPhone) out = sub(PHONE, "[전화번호]", () => true)(out);
  out = sub(ACCOUNT, "[계좌번호]", (m) => {
    const n = m.replace(/\D/g, "").length;
    return n >= 10 && n <= 14 && !LANDLINE.test(m) && !BIZ_NO.test(m) && !/^01[016789]-\d{3,4}-\d{4}$/.test(m);
  })(out);
  return { text: out, count };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-mask.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋** — `git add frontend/src/lib/chat/mask.ts frontend/src/lib/__tests__/chat-mask.test.ts` 후 메시지 `feat(chat): 민감정보 마스킹(주민·카드·전화·계좌)`(Global Constraints의 커밋 형식).

---

### Task 3: 설정(허용 모델·보존일)·사용량 기록, 기존 턴 API의 상한을 새 사용량으로

**Files:**
- Create: `frontend/src/lib/chat/usage.ts`
- Modify: `frontend/src/lib/assistant/settings.ts`(전체 교체)
- Modify: `frontend/src/app/api/assistant/turn/route.ts:3-4,29-31,38`
- Modify: `frontend/src/lib/__tests__/assistant-turn-api.test.ts:4-12`
- Test: `frontend/src/lib/__tests__/chat-usage.test.ts`

**Interfaces:**
- Produces:
  - `ALLOWED_MODELS: readonly ["claude-sonnet-5-5", "claude-opus-5-5"]`, `ASSISTANT_MODELS_KEY = "assistant_models"`, `ASSISTANT_RETENTION_KEY = "assistant_retention_days"`, `DEFAULT_RETENTION_DAYS = 90`
  - `parseModels(s?: string | null): string[]`, `retentionDays(s?: string | null): number`, `pickModel(requested: unknown, models: string[]): string`
  - `loadAssistantSettings(admin) → Promise<{ ok: false } | { ok: true; enabled: boolean; dailyLimit: number; models: string[]; retentionDays: number }>`
  - `kstDay(now: Date): string`(YYYY-MM-DD), `turnsToday(admin, userId, now?): Promise<number | null>`(null = 조회 오류), `recordUsage(admin, u: { userId: string; model: string; inputTokens: number; outputTokens: number; masked: number }, now?): Promise<void>`

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/lib/__tests__/chat-usage.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { kstDay, recordUsage, turnsToday } from "@/lib/chat/usage";
import { parseModels, pickModel, retentionDays } from "@/lib/assistant/settings";

describe("사용량", () => {
  it("KST 날짜 — UTC 15:00은 다음 날", () => {
    expect(kstDay(new Date("2026-10-15T14:59:00Z"))).toBe("2026-10-15");
    expect(kstDay(new Date("2026-10-15T15:00:00Z"))).toBe("2026-10-16");
  });
  it("오늘 턴 수 — 행 없음 0, 오류 null", async () => {
    const q = (data: unknown, error: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) }) });
    expect(await turnsToday(q(null, null) as never, "u1")).toBe(0);
    expect(await turnsToday(q({ turns: 7 }, null) as never, "u1")).toBe(7);
    expect(await turnsToday(q(null, { message: "x" }) as never, "u1")).toBeNull();
  });
  it("기록은 RPC 한 번", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await recordUsage({ rpc } as never, { userId: "u1", model: "claude-opus-5-5", inputTokens: 10, outputTokens: 3, masked: 1 }, new Date("2026-10-15T01:00:00Z"));
    expect(rpc).toHaveBeenCalledWith("chat_usage_add", { p_user: "u1", p_day: "2026-10-15", p_model: "claude-opus-5-5", p_in: 10, p_out: 3, p_masked: 1 });
  });
});
describe("설정 해석", () => {
  it("허용 모델 — 모르는 값은 버리고 비면 기본 둘", () => {
    expect(parseModels("")).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(parseModels("claude-sonnet-5-5, gpt-x")).toEqual(["claude-sonnet-5-5"]);
  });
  it("모델 고르기 — 허용 밖이면 Sonnet", () => {
    const all = ["claude-sonnet-5-5", "claude-opus-5-5"];
    expect(pickModel("claude-opus-5-5", all)).toBe("claude-opus-5-5");
    expect(pickModel("claude-opus-5-5", ["claude-sonnet-5-5"])).toBe("claude-sonnet-5-5");
    expect(pickModel(undefined, all)).toBe("claude-sonnet-5-5");
  });
  it("보존일 — 1~3650 정수, 아니면 90", () => {
    expect(retentionDays("30")).toBe(30);
    expect(retentionDays("0")).toBe(90);
    expect(retentionDays("abc")).toBe(90);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-usage.test.ts`
Expected: FAIL — `@/lib/chat/usage` 해석 실패

- [ ] **Step 3: 구현**

`frontend/src/lib/chat/usage.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** 주어진 순간의 KST 날짜(YYYY-MM-DD) — 하루 상한·사용량 행의 기준. */
export function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 오늘(KST) 비서 턴 수. 조회 오류는 null — 호출자는 닫힌 채로(503) 실패해야 한다. */
export async function turnsToday(admin: SupabaseClient, userId: string, now = new Date()): Promise<number | null> {
  const { data, error } = await admin.from("assistant_usage").select("turns").eq("user_id", userId).eq("day", kstDay(now)).maybeSingle();
  if (error) return null;
  return (data as { turns?: number } | null)?.turns ?? 0;
}

/** Claude 호출 1회를 사용량에 더한다(원자적 RPC). 실패해도 턴은 막지 않는다. */
export async function recordUsage(admin: SupabaseClient, u: { userId: string; model: string; inputTokens: number; outputTokens: number; masked: number }, now = new Date()): Promise<void> {
  const { error } = await admin.rpc("chat_usage_add", { p_user: u.userId, p_day: kstDay(now), p_model: u.model, p_in: u.inputTokens, p_out: u.outputTokens, p_masked: u.masked });
  if (error) console.error("[chat] 사용량 기록 실패:", error.message);
}
```

`frontend/src/lib/assistant/settings.ts` 전체:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_DAILY_TURNS_KEY, ASSISTANT_ENABLED_KEY, DEFAULT_ASSISTANT_MODEL, assistantEnabled, dailyTurnLimit } from "./tools";

export const ASSISTANT_MODELS_KEY = "assistant_models";
export const ASSISTANT_RETENTION_KEY = "assistant_retention_days";
export const ALLOWED_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;
export const DEFAULT_RETENTION_DAYS = 90;

/** settings 값(쉼표 목록) → 허용 모델. 모르는 이름은 버리고, 비면 전부. */
export function parseModels(s: string | null | undefined): string[] {
  const picked = (s ?? "").split(",").map((x) => x.trim()).filter((x) => (ALLOWED_MODELS as readonly string[]).includes(x));
  return picked.length ? picked : [...ALLOWED_MODELS];
}
export function retentionDays(s: string | null | undefined): number {
  const n = Number((s ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS;
}
/** 요청 모델이 허용 목록에 없으면 기본(Sonnet), 기본도 없으면 목록 첫 번째. */
export function pickModel(requested: unknown, models: string[]): string {
  if (typeof requested === "string" && models.includes(requested)) return requested;
  return models.includes(DEFAULT_ASSISTANT_MODEL) ? DEFAULT_ASSISTANT_MODEL : models[0];
}

/** 관리자 설정 읽기. DB 오류는 ok:false — 호출자는 닫힌 채로(503) 실패해야 한다. */
export async function loadAssistantSettings(admin: SupabaseClient): Promise<{ ok: false } | { ok: true; enabled: boolean; dailyLimit: number; models: string[]; retentionDays: number }> {
  const { data, error } = await admin.from("settings").select("key,value").in("key", [ASSISTANT_ENABLED_KEY, ASSISTANT_DAILY_TURNS_KEY, ASSISTANT_MODELS_KEY, ASSISTANT_RETENTION_KEY]);
  if (error) return { ok: false };
  const get = (k: string) => ((data ?? []) as Array<{ key: string; value: string }>).find((x) => x.key === k)?.value;
  return {
    ok: true,
    enabled: assistantEnabled(get(ASSISTANT_ENABLED_KEY), process.env.ANTHROPIC_API_KEY),
    dailyLimit: dailyTurnLimit(get(ASSISTANT_DAILY_TURNS_KEY)),
    models: parseModels(get(ASSISTANT_MODELS_KEY)),
    retentionDays: retentionDays(get(ASSISTANT_RETENTION_KEY)),
  };
}
```

`frontend/src/app/api/assistant/turn/route.ts`: import에 `import { recordUsage, turnsToday } from "@/lib/chat/usage";`를 더하고 `kstDayStartIso` import를 지운다. 상한 블록(현재 29~31줄)을 아래로 바꾼다.

```ts
  // 확인 후 기록이라 원자적이지 않다 — 동시 요청에서 상한을 조금 넘을 수 있으나 허용한다. 웹 채팅(/api/chat/turn)과 같은 assistant_usage를 센다.
  const used = await turnsToday(r.admin, r.userId);
  if (used === null) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (used >= cfg.dailyLimit) return NextResponse.json({ error: "오늘 비서 사용 한도를 넘었습니다. 내일 다시 이용해 주세요." }, { status: 429 });
```

`logAudit(...)` 줄 바로 앞에 넣는다.

```ts
    await recordUsage(r.admin, { userId: r.userId, model: msg.model, inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0, masked: 0 });
```

`assistant-turn-api.test.ts`의 `fakeAdmin`에서 `action_history` 분기를 아래 두 줄로 바꾸고, 반환 객체에 `rpc`를 더한다(`m`에 `rpc: vi.fn()` 추가, `beforeEach`에서 `m.rpc.mockReset().mockResolvedValue({ error: null })`).

```ts
      if (table === "assistant_usage") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { turns: m.used }, error: m.cntErr ? { message: "x" } : null }) }) }) }) };
```
```ts
    rpc: m.rpc,
```

같은 파일 첫 번째 테스트 끝에 `expect(m.rpc).toHaveBeenCalledWith("chat_usage_add", expect.objectContaining({ p_user: "u1" }));`를 더한다(목 응답에 `model: "claude-sonnet-5-5", usage: { input_tokens: 5, output_tokens: 2 }`를 넣는다).

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-usage.test.ts src/lib/__tests__/assistant-turn-api.test.ts src/lib/__tests__/assistant-execute-api.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 허용 모델·보존일 설정과 assistant_usage 사용량(기존 앱 턴도 같은 상한)`.

---

### Task 4: 서버 도구 실행을 함수로 분리 `runServerTool`

**Files:**
- Create: `frontend/src/lib/assistant/server-tools.ts`
- Modify: `frontend/src/app/api/assistant/execute/route.ts`(전체 교체)
- Test: 기존 `frontend/src/lib/__tests__/assistant-execute-api.test.ts`(그대로 통과해야 함)

**Interfaces:**
- Produces: `type ToolRun = { ok: true; result: unknown } | { ok: false; error: string }`, `runServerTool(admin: SupabaseClient, userId: string, role: "user" | "admin", tool: string, args: Record<string, unknown>): Promise<ToolRun>` — 페이지 권한 검사 포함, 감사 기록은 하지 않는다.

- [ ] **Step 1: 기존 테스트가 지금 통과하는지 확인(리팩터링 기준선)**

Run: `cd frontend && npx vitest run src/lib/__tests__/assistant-execute-api.test.ts`
Expected: PASS

- [ ] **Step 2: 함수로 옮기기**

`frontend/src/lib/assistant/server-tools.ts` — 현재 `execute/route.ts`의 POST 본문 중 "권한 확인부터 결과 계산까지"를 그대로 옮기고, `NextResponse` 대신 `ToolRun`을 돌려준다.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectionStatus } from "@/lib/ms/connections";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe, TEAMS_CHAT_SCOPE } from "@/lib/ms/oauth";
import { CHAT_MESSAGE_MAX, listMyChats, sendChatMessage } from "@/lib/teams/chat";
import { parseChatId } from "@/lib/teams/chat-route";
import { collectMentions } from "@/lib/teams/mentions-collect";
import { canUsePage, isPagePermissions } from "@/lib/page-access";
import { JiraError } from "@/lib/jira/config";
import { confluenceFor, createPage, feed, listSpaces, readPage, searchPages } from "@/lib/confluence/client";
import { FEED_KINDS, type FeedKind } from "@/lib/confluence/core";
import { feed as spFeed, readDoc, searchDocs } from "@/lib/sharepoint/client";
import { FEED_KINDS as SP_FEED_KINDS, SharepointError, type FeedKind as SpFeedKind } from "@/lib/sharepoint/core";
import { pptxExtractor } from "@/lib/sharepoint/pptx";

export type ToolRun = { ok: true; result: unknown } | { ok: false; error: string };
const NOT_CONNECTED = "Microsoft 계정이 연결되지 않았거나 Teams 채팅 권한이 없습니다. 웹 설정에서 다시 연결하세요.";
const SP_NOT_CONNECTED = "Microsoft 계정이 연결되지 않았습니다. 웹 설정에서 연결하세요.";

/** 비서의 서버 도구(Teams·Confluence·SharePoint) 실행. 페이지 권한을 여기서 본다. 쓰기의 사용자 확인은 호출자 책임. */
export async function runServerTool(admin: SupabaseClient, userId: string, role: "user" | "admin", tool: string, args: Record<string, unknown>): Promise<ToolRun> {
  const fail = (error: string): ToolRun => ({ ok: false, error });
  const done = (result: unknown): ToolRun => ({ ok: true, result });
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
  const isConfluence = tool.startsWith("confluence_");
  const isSharepoint = tool.startsWith("sharepoint_");
  const pageKey = isConfluence ? "confluence" : isSharepoint ? "sharepoint" : "teams_chat";
  if (role !== "admin") {
    const access = await admin.from("user_page_access").select("permissions").eq("user_id", userId).maybeSingle();
    if (access.error || (access.data && !isPagePermissions(access.data.permissions)) || !canUsePage(role, pageKey, access.data?.permissions ?? {})) return fail(isConfluence ? "Confluence 권한이 없습니다" : isSharepoint ? "SharePoint 권한이 없습니다" : "Teams 채팅 권한이 없습니다");
  }
  if (isSharepoint) {
    try {
      const tok = await graphTokenForRoute(admin, userId);
      if (!tok.ok) return fail(SP_NOT_CONNECTED);
      if (tool === "sharepoint_search") {
        if (!str("query")) return fail("검색어가 없습니다.");
        return done({ items: await searchDocs(tok.token, str("query"), 8) });
      }
      if (tool === "sharepoint_recent") {
        const kind = str("kind") as SpFeedKind;
        if (!SP_FEED_KINDS.includes(kind)) return fail("kind는 used·shared·trending·recent 중 하나입니다.");
        return done(await spFeed(tok.token, kind, 10));
      }
      const ref = str("drive_id") && str("item_id") ? { driveId: str("drive_id"), id: str("item_id") } : str("url") ? { url: str("url") } : null;
      if (!ref) return fail("drive_id·item_id 또는 url이 필요합니다.");
      return done(await readDoc(tok.token, ref, 20_000, { extractPptx: pptxExtractor(admin) }));
    } catch (e) {
      if (e instanceof SharepointError) return fail(e.message);
      console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
      return fail("SharePoint 요청이 실패했습니다.");
    }
  }
  if (isConfluence) {
    try {
      const c = await confluenceFor(admin, userId);
      if (tool === "confluence_search") {
        if (!str("query")) return fail("검색어가 없습니다.");
        return done({ items: await searchPages(c.request, str("query").slice(0, 200), { spaceKey: str("space_key") || undefined, limit: 8 }) });
      }
      if (tool === "confluence_read") return done(await readPage(c.request, str("page_id")));
      if (tool === "confluence_feed") {
        const kind = str("kind") as FeedKind;
        if (!FEED_KINDS.includes(kind)) return fail("kind는 mentions·watching·recent 중 하나입니다.");
        return done({ items: await feed(c.request, kind, 10) });
      }
      if (tool === "confluence_spaces") {
        // key: 확인 카드용 정확히 한 공간, query: 이름·key 일부로 좁히기(공간이 수백 개라 전부 주지 않는다)
        const all = await listSpaces(c.request, c.accountId);
        const key = str("key"), q = str("query").toLowerCase();
        const spaces = key ? all.filter((x) => x.key === key) : q ? all.filter((x) => x.name.toLowerCase().includes(q) || x.key.toLowerCase().includes(q)) : all;
        return done({ spaces: spaces.slice(0, 80), total: spaces.length, canWrite: c.canWrite });
      }
      if (!c.canWrite) return fail("Confluence 쓰기 권한이 없습니다. 웹 설정에서 Atlassian 계정을 다시 연결하세요.");
      return done(await createPage(c.request, { spaceKey: str("space_key"), parentId: str("parent_id") || null, title: str("title"), markdown: typeof args.markdown === "string" ? args.markdown.slice(0, 100_000) : "" }));
    } catch (e) {
      if (e instanceof JiraError) return fail(e.message);
      console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
      return fail(tool === "confluence_create_page" ? "Confluence 응답을 확인하지 못했습니다. Confluence에서 페이지가 만들어졌는지 확인하세요." : "Confluence 요청이 실패했습니다.");
    }
  }
  try {
    if (tool === "teams_mentions") {
      const m = await collectMentions(admin, userId, 2);
      if ("response" in m || !m.connected) return fail(NOT_CONNECTED);
      return done({ items: m.items.slice(0, 10) });
    }
    const status = await getConnectionStatus(admin, userId);
    if (!status.connected || !status.scopes.includes(TEAMS_CHAT_SCOPE)) return fail(NOT_CONNECTED);
    const tok = await graphTokenForRoute(admin, userId);
    if (!tok.ok) return fail(NOT_CONNECTED);
    if (tool === "teams_chats") {
      const me = await fetchMe(tok.token);
      const chats = await listMyChats(tok.token, me.id);
      return done({ chats: chats.slice(0, 30).map((c) => ({ id: c.id, name: c.topic, type: c.type })) });
    }
    const chatId = parseChatId(args.chat_id);
    const text = typeof args.text === "string" ? args.text.trim() : "";
    if (!chatId) return fail("채팅 id가 올바르지 않습니다.");
    if (!text) return fail("보낼 내용이 없습니다.");
    if (text.length > CHAT_MESSAGE_MAX) return fail(`메시지는 ${CHAT_MESSAGE_MAX}자까지 보낼 수 있습니다.`);
    await sendChatMessage(tok.token, chatId, text);
    return done({ sent: true });
  } catch (e) {
    console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
    return fail("Teams 요청이 실패했습니다.");
  }
}
```

`execute/route.ts` 전체:

```ts
import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { SERVER_TOOLS } from "@/lib/assistant/tools";
import { loadAssistantSettings } from "@/lib/assistant/settings";
import { runServerTool } from "@/lib/assistant/server-tools";

export const runtime = "nodejs";

/** POST /api/assistant/execute — 앱 이노봇의 서버 도구 실행. 쓰기는 앱이 확인 카드를 받은 뒤에만 부른다. 결과는 {ok,result}|{ok:false,error}(도구 결과로 Claude에 간다). */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const body = (await request.json().catch(() => ({}))) as { tool?: unknown; args?: unknown };
  const tool = typeof body.tool === "string" ? body.tool : "";
  if (!(SERVER_TOOLS as readonly string[]).includes(tool)) return NextResponse.json({ error: "지원하지 않는 도구입니다." }, { status: 400 });
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!cfg.enabled) return NextResponse.json({ enabled: false });
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  const run = await runServerTool(r.admin, r.userId, r.role, tool, args);
  if (run.ok) await logAudit(r.admin, request, { userId: r.userId, action: "비서 실행", category: "assistant", detail: { tool } });
  return NextResponse.json(run);
}
```

- [ ] **Step 3: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/assistant-execute-api.test.ts && npx tsc --noEmit -p .`
Expected: PASS(기존 테스트 수 그대로), 타입 오류 0. 기존 테스트가 모듈 경로(`@/lib/teams/chat` 등)를 `vi.mock`으로 막고 있으면 그대로 동작한다 — 실패하면 테스트를 고치지 말고 옮긴 코드와 원본을 줄 단위로 비교한다.

- [ ] **Step 4: 커밋** — 메시지 `refactor(assistant): 서버 도구 실행을 runServerTool로 분리(웹 채팅과 공유)`.

---
### Task 5: 이벤트 타입·도구 목록(실행 위치)·도구 결과 요약

**Files:**
- Create: `frontend/src/lib/chat/events.ts`, `frontend/src/lib/chat/toolset.ts`, `frontend/src/lib/chat/summary.ts`
- Modify: `frontend/src/lib/assistant/tools.ts:110-115`(`assistantSystemPrompt`에 `extra`)
- Test: `frontend/src/lib/__tests__/chat-toolset.test.ts`

**Interfaces:**
- Produces (`events.ts`, 서버 import 없음 — 브라우저도 씀):
  - `type Location = "server" | "device" | "desktop-relay"`
  - `type PendingCall = { id: string; tool: string; input: Record<string, unknown>; location: Location; tier: string }`
  - `type ActionReply = { id: string; approve?: boolean; result?: unknown; isError?: boolean }`
  - `type ChatEvent = { type: "conversation"; id: string } | { type: "text"; delta: string } | { type: "tool"; id: string; tool: string; location: Location | null; status: "running" | "ok" | "error"; summary?: string } | { type: "masked"; count: number } | { type: "needs_action"; messageId: string; calls: PendingCall[] } | { type: "done"; messageId: string } | { type: "error"; message: string; retryable: boolean }`
  - `sseLine(e: ChatEvent): string`
- Produces (`toolset.ts`): `RELAY_READ_TOOLS`, `ORG_TOOLS: Set<string>`, `buildToolset(o: { client: "web" | "app"; desktopOnline: boolean; allowed: (k: PageKey) => boolean }): { tools: Anthropic.Tool[]; location: Record<string, Location> }`, `tierOf(name: string): ToolTier`, `needsAction(c: { location: Location | null; tier: string }): boolean`, `clientPromptLines(client: "web" | "app", desktopOnline: boolean): string[]`
- Produces (`summary.ts`): `TOOL_LABEL: Record<string, string>`, `toolLabel(name: string): string`, `summarizeToolResult(tool: string, ok: boolean, result: unknown): string`
- Produces (`tools.ts`): `assistantSystemPrompt(p: { now; name; email }, extra?: string[])`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import { buildToolset, clientPromptLines, needsAction, tierOf } from "@/lib/chat/toolset";
import { summarizeToolResult } from "@/lib/chat/summary";
import { sseLine } from "@/lib/chat/events";

const all = () => true;
describe("도구 목록", () => {
  it("웹·앱 꺼짐 — 서버 도구만, 아마란스 없음", () => {
    const t = buildToolset({ client: "web", desktopOnline: false, allowed: all });
    expect(t.tools.map((x) => x.name)).toContain("teams_send");
    expect(t.tools.map((x) => x.name)).not.toContain("list_mail_inbox");
    expect(t.tools.map((x) => x.name)).not.toContain("mail_send");
    expect(t.location.teams_send).toBe("server");
  });
  it("웹·앱 켜짐 — 아마란스 읽기 도구만 중계로", () => {
    const t = buildToolset({ client: "web", desktopOnline: true, allowed: all });
    const names = t.tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["list_mail_inbox", "read_mail", "search_mail_index", "pending_approvals"]));
    expect(names).not.toEqual(expect.arrayContaining(["send_mail"]));
    expect(names).not.toContain("submit_approval");
    expect(t.location.read_mail).toBe("desktop-relay");
    expect(new Set(names).size).toBe(names.length);
  });
  it("앱 — 아마란스는 기기 도구, 서버 도구는 서버", () => {
    const t = buildToolset({ client: "app", desktopOnline: false, allowed: all });
    expect(t.location.mail_send).toBe("device");
    expect(t.location.offer_choices).toBe("device");
    expect(t.location.confluence_search).toBe("server");
  });
  it("페이지 권한이 없으면 그 서버 도구와 아마란스 중계를 뺀다", () => {
    const t = buildToolset({ client: "web", desktopOnline: true, allowed: (k) => k !== "teams_chat" && k !== "mcp" });
    const names = t.tools.map((x) => x.name);
    expect(names).not.toContain("teams_send");
    expect(names).not.toContain("read_mail");
    expect(names).toContain("confluence_search");
  });
  it("확인이 필요한 호출 — 기기 도구 전부, 서버 쓰기, 모르는 도구는 아님", () => {
    expect(needsAction({ location: "device", tier: "read" })).toBe(true);
    expect(needsAction({ location: "server", tier: tierOf("teams_send") })).toBe(true);
    expect(needsAction({ location: "server", tier: tierOf("teams_chats") })).toBe(false);
    expect(needsAction({ location: "desktop-relay", tier: tierOf("read_mail") })).toBe(false);
    expect(needsAction({ location: null, tier: "write" })).toBe(false);
  });
  it("웹 문구 — 앱이 꺼져 있으면 안내 줄", () => {
    expect(clientPromptLines("web", false).join("\n")).toContain("데스크톱 앱");
    expect(clientPromptLines("app", false)).toEqual([]);
  });
});
describe("요약·SSE", () => {
  it("목록은 건수와 제목 5개까지", () => {
    const s = summarizeToolResult("list_mail_inbox", true, { items: [{ subject: "a" }, { subject: "b" }, { subject: "c" }, { subject: "d" }, { subject: "e" }, { subject: "f" }] });
    expect(s).toBe("받은메일 목록 6건: a, b, c, d, e");
  });
  it("단건은 제목, 실패는 사유", () => {
    expect(summarizeToolResult("read_mail", true, { subject: "주간보고" })).toBe("메일 읽기: 주간보고");
    expect(summarizeToolResult("teams_send", false, "권한이 없습니다")).toBe("Teams 보내기 실패: 권한이 없습니다");
    expect(summarizeToolResult("whatever", true, { ok: 1 })).toBe("whatever 완료");
  });
  it("SSE 한 줄", () => {
    expect(sseLine({ type: "text", delta: "안녕" })).toBe('data: {"type":"text","delta":"안녕"}\n\n');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-toolset.test.ts`
Expected: FAIL — 모듈 해석 실패

- [ ] **Step 3: 구현**

`events.ts`:

```ts
/** 웹 채팅 턴 API의 SSE 이벤트 — 서버(engine)와 브라우저(sse-client·view)가 같이 쓴다. 서버 모듈을 import하지 않는다. */
export type Location = "server" | "device" | "desktop-relay";
export type PendingCall = { id: string; tool: string; input: Record<string, unknown>; location: Location; tier: string };
export type ActionReply = { id: string; approve?: boolean; result?: unknown; isError?: boolean };
export type ChatEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; tool: string; location: Location | null; status: "running" | "ok" | "error"; summary?: string }
  | { type: "masked"; count: number }
  | { type: "needs_action"; messageId: string; calls: PendingCall[] }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string; retryable: boolean };
export const sseLine = (e: ChatEvent) => `data: ${JSON.stringify(e)}\n\n`;
```

`toolset.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import mcpTools from "@/lib/mcp/tools.json";
import { ASSISTANT_TOOLS, SERVER_TOOLS, TOOL_TIERS, type ToolTier } from "@/lib/assistant/tools";
import type { PageKey } from "@/lib/page-access";
import type { Location } from "./events";

/** 웹에서 데스크톱 앱 중계로 여는 아마란스 도구 — 읽기만(설계서 §0 "웹의 아마란스"). 이름·스키마는 Claude 커넥터(tools.json)와 같다. */
export const RELAY_READ_TOOLS = ["find_person", "org_chart", "list_mail_inbox", "read_mail", "search_mail_index", "mailbox_counts", "pending_approvals", "approval_counts", "list_approvals", "read_approval", "list_notices", "read_notice", "search", "list_calendars", "list_events", "get_attendance_today", "my_reservations", "list_resources", "find_free_rooms"] as const;
/** 결과의 전화번호를 가리지 않는 사내 조직도 도구(설계서 §2-4 예외) */
export const ORG_TOOLS = new Set(["find_person", "my_team", "org_chart"]);

// 앱 1.6.9+의 기기 안 메일 색인 검색 — tools.json(커넥터 노출 목록) 밖이라 스키마를 여기 둔다.
const SEARCH_MAIL_INDEX: Anthropic.Tool = {
  name: "search_mail_index",
  description: "메일 찾기 — 데스크톱 앱이 기기 안에 만든 색인(받은·보낸 메일함의 제목·보낸 사람·받는 사람·첨부 이름, 읽은 메일 본문)을 검색식으로 찾는다. 단어 여러 개는 AND, 'a OR b', \"구문\", -제외, from: to: subject: body: file: after:YYYY-MM-DD before:YYYY-MM-DD has:attach is:unread in:sent. 결과에 본문 발췌·muid.",
  input_schema: { type: "object", properties: { query: { type: "string", description: "검색식" }, by_relevance: { type: "boolean", description: "관련도순(기본 최신순)" }, limit: { type: "integer", description: "최대 50, 기본 20" } }, required: ["query"] },
};
const RELAY_TOOLS: Anthropic.Tool[] = [
  ...(mcpTools as Array<{ name: string; description: string; inputSchema: Anthropic.Tool.InputSchema }>)
    .filter((t) => (RELAY_READ_TOOLS as readonly string[]).includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
  SEARCH_MAIL_INDEX,
];

const pageOf = (name: string): PageKey | null => (name.startsWith("teams_") ? "teams_chat" : name.startsWith("confluence_") ? "confluence" : name.startsWith("sharepoint_") ? "sharepoint" : null);

export function buildToolset(o: { client: "web" | "app"; desktopOnline: boolean; allowed: (k: PageKey) => boolean }): { tools: Anthropic.Tool[]; location: Record<string, Location> } {
  const tools: Anthropic.Tool[] = [];
  const location: Record<string, Location> = {};
  for (const t of ASSISTANT_TOOLS) {
    if ((SERVER_TOOLS as readonly string[]).includes(t.name)) {
      const key = pageOf(t.name);
      if (key && !o.allowed(key)) continue;
      tools.push(t); location[t.name] = "server";
    } else if (o.client === "app") {
      tools.push(t); location[t.name] = "device";
    }
  }
  // 아마란스 중계는 Claude 커넥터와 같은 통로라 같은 페이지 키(mcp)로 묶는다.
  if (o.client === "web" && o.desktopOnline && o.allowed("mcp")) for (const t of RELAY_TOOLS) { tools.push(t); location[t.name] = "desktop-relay"; }
  return { tools, location };
}

export function tierOf(name: string): ToolTier {
  return TOOL_TIERS[name] ?? ((RELAY_READ_TOOLS as readonly string[]).includes(name) ? "read" : "write");
}
/** 사람(확인 카드)이나 앱이 처리해야 하는 호출인가. 모르는 도구(location null)는 서버가 오류로 바로 답한다. */
export function needsAction(c: { location: Location | null; tier: string }): boolean {
  if (!c.location) return false;
  return c.location === "device" || c.tier !== "read";
}

/** 클라이언트별 추가 지침 — 고정 규칙(캐시) 뒤 두 번째 블록에 붙는다. */
export function clientPromptLines(client: "web" | "app", desktopOnline: boolean): string[] {
  if (client === "app") return [];
  return [
    "지금은 웹 채팅이다. 답에 마크다운(목록·표·굵게)을 써도 된다. 쓰기 도구는 웹 화면이 확인 카드를 띄운다.",
    "웹에서 아마란스는 조회만 된다. 회의실 예약·일정 등록·출퇴근·메일 저장·발송·결재 같은 아마란스 쓰기는 모바일·데스크톱 앱의 이노봇에서 하라고 안내한다.",
    desktopOnline
      ? "아마란스 도구 이름은 list_mail_inbox·read_mail·search_mail_index·pending_approvals 등이다."
      : "데스크톱 앱이 꺼져 있어 아마란스 도구가 없다. 메일·결재·일정 같은 아마란스 요청이면 INNOGRID 데스크톱 앱을 켜면 처리할 수 있다고 안내한다.",
  ];
}
```

`summary.ts`:

```ts
/** 도구 결과 → 사람이 읽는 한 줄(≤300자). DB에는 결과 원문 대신 이것만 남는다(설계서 §1.2). */
export const TOOL_LABEL: Record<string, string> = {
  list_mail_inbox: "받은메일 목록", mail_list: "받은메일 목록", read_mail: "메일 읽기", mail_read: "메일 읽기", search_mail_index: "메일 검색", mail_search: "메일 검색",
  pending_approvals: "미결 결재", approvals_pending: "미결 결재", read_approval: "결재 문서", approval_read: "결재 문서", approval_counts: "결재 건수", list_approvals: "결재 목록",
  list_notices: "게시판", notices_list: "게시판", read_notice: "게시글", notice_read: "게시글", search: "아마란스 통합검색",
  list_events: "일정", list_calendars: "캘린더", find_person: "사람 찾기", my_team: "우리 팀", org_chart: "조직도", get_attendance_today: "출퇴근", attendance_today: "출퇴근",
  my_reservations: "내 회의실 예약", list_resources: "회의실", list_rooms: "회의실", find_free_rooms: "빈 회의실",
  teams_chats: "Teams 채팅 목록", teams_mentions: "Teams 답장 대기", teams_send: "Teams 보내기",
  confluence_search: "Confluence 검색", confluence_read: "Confluence 문서", confluence_feed: "Confluence 소식", confluence_spaces: "Confluence 공간", confluence_create_page: "Confluence 페이지 만들기",
  sharepoint_search: "SharePoint 검색", sharepoint_recent: "SharePoint 문서", sharepoint_read: "SharePoint 문서 읽기",
};
export const toolLabel = (name: string) => TOOL_LABEL[name] ?? name;

const LIST_KEYS = ["items", "chats", "hits", "spaces", "events", "Records", "records", "results", "list", "people", "rooms"];
const TITLE_KEYS = ["subject", "title", "name", "topic", "docTitle", "artTitle"];
function findList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  for (const k of LIST_KEYS) if (Array.isArray(o[k])) return o[k] as unknown[];
  for (const x of Object.values(o)) if (Array.isArray(x)) return x;
  return null;
}
function titleOf(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  for (const k of TITLE_KEYS) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim().slice(0, 40);
  if (o.item && typeof o.item === "object") return titleOf(o.item);
  return "";
}

export function summarizeToolResult(tool: string, ok: boolean, result: unknown): string {
  const label = toolLabel(tool);
  if (!ok) return `${label} 실패: ${String(result).slice(0, 120)}`;
  const list = findList(result);
  if (list) {
    const titles = list.slice(0, 5).map(titleOf).filter(Boolean);
    return `${label} ${list.length}건${titles.length ? `: ${titles.join(", ")}` : ""}`.slice(0, 300);
  }
  const t = titleOf(result);
  return (t ? `${label}: ${t}` : `${label} 완료`).slice(0, 300);
}
```

`tools.ts`의 `assistantSystemPrompt`를 아래로 바꾼다(기존 호출부는 인자 하나라 그대로 동작).

```ts
/** 시스템 프롬프트 = [고정 규칙(캐시 표시)] + [이번 사용자·현재 시각 + 클라이언트별 줄]. 바뀌는 값을 뒤에 두어야 앞부분 캐시가 맞는다. */
export function assistantSystemPrompt(p: { now: string; name: string; email: string }, extra: string[] = []): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: ASSISTANT_RULES, cache_control: { type: "ephemeral" } },
    { type: "text", text: [`사용자는 이노그리드 구성원 ${p.name || "사용자"}(${p.email})이다. 현재 시각은 ${nowWithWeekday(p.now)}다.`, ...extra].join("\n") },
  ];
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-toolset.test.ts src/lib/__tests__/assistant-tools.test.ts src/lib/__tests__/assistant-turn-api.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 도구 실행 위치 목록·웹 아마란스 읽기 중계·도구 결과 요약`.

---

### Task 6: 대화 저장소 `ChatStore`·기록 → 모델 메시지

**Files:**
- Create: `frontend/src/lib/chat/store.ts`
- Test: `frontend/src/lib/__tests__/chat-store.test.ts`

**Interfaces:**
- Consumes: `events.ts`의 `Location`
- Produces:
  - `type StoredBlock = Anthropic.ContentBlockParam | { type: "attachment"; id: string; name: string }`
  - `type ConvRow = { id: string; user_id: string; title: string; model: string; ephemeral: boolean; created_at: string; last_message_at: string; expires_at: string }`
  - `type MsgRow = { id: string; role: "user" | "assistant"; content: StoredBlock[]; status: "ok" | "failed" | "stopped"; masked_count: number; created_at: string }`
  - `type AttachmentRow = { id: string; name: string; mime: string; kind: "text" | "image" | "pdf"; storage_path: string; masked_count: number }`
  - `interface ChatStore { create(o: { userId: string; model: string; ephemeral: boolean; title: string; expiresAt: string }): Promise<ConvRow>; get(userId: string, id: string): Promise<ConvRow | null>; messages(convId: string): Promise<MsgRow[]>; append(convId: string, m: { role: "user" | "assistant"; content: StoredBlock[]; status?: MsgRow["status"]; inputTokens?: number; outputTokens?: number; masked?: number }): Promise<string>; toolCalls(messageId: string, rows: Array<{ toolUseId: string; tool: string; location: Location; status: "ok" | "error" | "timeout" | "cancelled"; summary: string }>): Promise<void>; touch(convId: string, o: { model: string; expiresAt: string }): Promise<void>; linkAttachments(userId: string, ids: string[], convId: string): Promise<AttachmentRow[]> }`
  - `supabaseChatStore(admin: SupabaseClient): ChatStore`
  - `historyForModel(rows: MsgRow[], attachments: Map<string, Anthropic.ContentBlockParam[]>): Anthropic.MessageParam[]`
  - `pendingCalls(rows: MsgRow[]): { messageId: string; uses: Anthropic.ToolUseBlockParam[] } | null`
  - `attachmentIdsIn(rows: MsgRow[]): string[]`
  - `expiresAt(now: Date, ephemeral: boolean, retentionDays: number): string`, `titleFrom(text: string): string`
  - `cancelResult(id: string, why?: string): Anthropic.ToolResultBlockParam`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import { attachmentIdsIn, expiresAt, historyForModel, pendingCalls, titleFrom, type MsgRow } from "@/lib/chat/store";

const row = (id: string, role: MsgRow["role"], content: MsgRow["content"], status: MsgRow["status"] = "ok"): MsgRow => ({ id, role, content, status, masked_count: 0, created_at: "" });
const use = (id: string) => ({ type: "tool_use" as const, id, name: "read_mail", input: { muid: "1" } });

describe("historyForModel", () => {
  it("실패한 응답은 빼고, 첨부는 펼친다", () => {
    const h = historyForModel([
      row("1", "user", [{ type: "text", text: "요약해 줘" }, { type: "attachment", id: "a1", name: "보고.docx" }]),
      row("2", "assistant", [{ type: "text", text: "" }], "failed"),
    ], new Map([["a1", [{ type: "text", text: "[첨부: 보고.docx]\n본문" }]]]));
    expect(h).toEqual([{ role: "user", content: [{ type: "text", text: "요약해 줘" }, { type: "text", text: "[첨부: 보고.docx]\n본문" }] }]);
  });
  it("보존 기간이 지나 첨부가 없으면 안내 텍스트", () => {
    const h = historyForModel([row("1", "user", [{ type: "attachment", id: "gone", name: "옛.pdf" }])], new Map());
    expect(JSON.stringify(h)).toContain("옛.pdf");
  });
  it("답 없는 도구 호출 뒤에 다른 메시지가 오면 취소 결과를 끼운다", () => {
    const h = historyForModel([
      row("1", "user", [{ type: "text", text: "메일" }]),
      row("2", "assistant", [use("t1")]),
      row("3", "user", [{ type: "text", text: "그만, 다른 거" }]),
    ], new Map());
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user", "user"]);
    expect(JSON.stringify(h[2])).toContain('"tool_use_id":"t1"');
  });
  it("마지막이 답 없는 도구 호출이면 그대로 둔다(대기)", () => {
    const rows = [row("1", "user", [{ type: "text", text: "메일" }]), row("2", "assistant", [use("t1")])];
    expect(historyForModel(rows, new Map())).toHaveLength(2);
    expect(pendingCalls(rows)).toEqual({ messageId: "2", uses: [use("t1")] });
    expect(pendingCalls([...rows, row("3", "user", [{ type: "tool_result", tool_use_id: "t1", content: "ok" }])])).toBeNull();
  });
});
describe("보조 함수", () => {
  it("만료일 — 저장 안 함은 24시간", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(expiresAt(now, false, 90)).toBe("2027-01-13T00:00:00.000Z");
    expect(expiresAt(now, true, 90)).toBe("2026-10-16T00:00:00.000Z");
  });
  it("제목은 공백 정리 후 30자", () => {
    expect(titleFrom("  안녕\n하세요  ")).toBe("안녕 하세요");
    expect(titleFrom("가".repeat(40))).toHaveLength(30);
    expect(titleFrom("")).toBe("새 대화");
  });
  it("첨부 id 모으기", () => {
    expect(attachmentIdsIn([row("1", "user", [{ type: "attachment", id: "a", name: "x" }, { type: "text", text: "t" }])])).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-store.test.ts`
Expected: FAIL — 모듈 해석 실패

- [ ] **Step 3: 구현**

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Location } from "./events";

export type StoredBlock = Anthropic.ContentBlockParam | { type: "attachment"; id: string; name: string };
export type ConvRow = { id: string; user_id: string; title: string; model: string; ephemeral: boolean; created_at: string; last_message_at: string; expires_at: string };
export type MsgRow = { id: string; role: "user" | "assistant"; content: StoredBlock[]; status: "ok" | "failed" | "stopped"; masked_count: number; created_at: string };
export type AttachmentRow = { id: string; name: string; mime: string; kind: "text" | "image" | "pdf"; storage_path: string; masked_count: number };
export type ToolCallRecord = { toolUseId: string; tool: string; location: Location; status: "ok" | "error" | "timeout" | "cancelled"; summary: string };

export interface ChatStore {
  create(o: { userId: string; model: string; ephemeral: boolean; title: string; expiresAt: string }): Promise<ConvRow>;
  get(userId: string, id: string): Promise<ConvRow | null>;
  messages(convId: string): Promise<MsgRow[]>;
  append(convId: string, m: { role: "user" | "assistant"; content: StoredBlock[]; status?: MsgRow["status"]; inputTokens?: number; outputTokens?: number; masked?: number }): Promise<string>;
  toolCalls(messageId: string, rows: ToolCallRecord[]): Promise<void>;
  touch(convId: string, o: { model: string; expiresAt: string }): Promise<void>;
  linkAttachments(userId: string, ids: string[], convId: string): Promise<AttachmentRow[]>;
}

const CONV_COLS = "id,user_id,title,model,ephemeral,created_at,last_message_at,expires_at";
const ATT_COLS = "id,name,mime,kind,storage_path,masked_count";
const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error || r.data === null) throw new Error(`${what} 실패: ${r.error?.message ?? "no data"}`);
  return r.data;
};

/** service_role 클라이언트 위의 저장소. 소유자 확인은 get·linkAttachments가 user_id로 건다(다른 메서드는 확인된 대화 id로만 불린다). */
export function supabaseChatStore(admin: SupabaseClient): ChatStore {
  return {
    async create(o) {
      return must(await admin.from("chat_conversations").insert({ user_id: o.userId, model: o.model, ephemeral: o.ephemeral, title: o.title, expires_at: o.expiresAt }).select(CONV_COLS).single(), "대화 만들기") as ConvRow;
    },
    async get(userId, id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await admin.from("chat_conversations").select(CONV_COLS).eq("id", id).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`대화 조회 실패: ${error.message}`);
      return (data as ConvRow | null) ?? null;
    },
    async messages(convId) {
      return must(await admin.from("chat_messages").select("id,role,content,status,masked_count,created_at").eq("conversation_id", convId).order("created_at").limit(400), "메시지 조회") as MsgRow[];
    },
    async append(convId, m) {
      const row = must(await admin.from("chat_messages").insert({ conversation_id: convId, role: m.role, content: m.content, status: m.status ?? "ok", input_tokens: m.inputTokens ?? 0, output_tokens: m.outputTokens ?? 0, masked_count: m.masked ?? 0 }).select("id").single(), "메시지 저장") as { id: string };
      return row.id;
    },
    async toolCalls(messageId, rows) {
      if (!rows.length) return;
      const { error } = await admin.from("chat_tool_calls").insert(rows.map((r) => ({ message_id: messageId, tool_use_id: r.toolUseId, tool: r.tool, location: r.location, status: r.status, summary: r.summary })));
      if (error) throw new Error(`도구 기록 실패: ${error.message}`);
    },
    async touch(convId, o) {
      const { error } = await admin.from("chat_conversations").update({ model: o.model, last_message_at: new Date().toISOString(), expires_at: o.expiresAt }).eq("id", convId);
      if (error) throw new Error(`대화 갱신 실패: ${error.message}`);
    },
    async linkAttachments(userId, ids, convId) {
      if (!ids.length) return [];
      const { data, error } = await admin.from("chat_attachments").update({ conversation_id: convId }).in("id", ids).eq("user_id", userId).is("conversation_id", null).select(ATT_COLS);
      if (error) throw new Error(`첨부 연결 실패: ${error.message}`);
      return (data ?? []) as AttachmentRow[];
    },
  };
}

export const cancelResult = (id: string, why = "취소됨(사용자가 다른 요청을 함)"): Anthropic.ToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, content: why, is_error: true });
const isToolUse = (b: StoredBlock): b is Anthropic.ToolUseBlockParam => b.type === "tool_use";
const hasToolResult = (r: MsgRow | undefined) => !!r && r.role === "user" && r.content.some((b) => b.type === "tool_result");

/** 저장된 기록 → Claude 메시지. 실패 응답 제외, 첨부 펼침, 답 없이 지나간 도구 호출은 취소 결과로 닫는다(Anthropic은 짝 없는 tool_use를 거부). */
export function historyForModel(rows: MsgRow[], attachments: Map<string, Anthropic.ContentBlockParam[]>): Anthropic.MessageParam[] {
  const live = rows.filter((r) => r.status !== "failed");
  const out: Anthropic.MessageParam[] = [];
  live.forEach((r, i) => {
    const content = r.content.flatMap((b): Anthropic.ContentBlockParam[] => b.type === "attachment" ? (attachments.get(b.id) ?? [{ type: "text", text: `[첨부: ${b.name} — 보존 기간이 지나 내용을 읽을 수 없음]` }]) : [b]);
    if (!content.length) return;
    out.push({ role: r.role, content });
    const uses = r.role === "assistant" ? r.content.filter(isToolUse) : [];
    if (uses.length && i < live.length - 1 && !hasToolResult(live[i + 1])) out.push({ role: "user", content: uses.map((u) => cancelResult(u.id)) });
  });
  return out;
}

/** 마지막 메시지가 답을 기다리는 도구 호출이면 그 호출들. */
export function pendingCalls(rows: MsgRow[]): { messageId: string; uses: Anthropic.ToolUseBlockParam[] } | null {
  const live = rows.filter((r) => r.status !== "failed");
  const last = live[live.length - 1];
  if (!last || last.role !== "assistant") return null;
  const uses = last.content.filter(isToolUse);
  return uses.length ? { messageId: last.id, uses } : null;
}

export const attachmentIdsIn = (rows: MsgRow[]) => rows.flatMap((r) => r.content.flatMap((b) => (b.type === "attachment" ? [b.id] : [])));
export const expiresAt = (now: Date, ephemeral: boolean, retentionDays: number) => new Date(now.getTime() + (ephemeral ? 24 : retentionDays * 24) * 3600_000).toISOString();
export const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 30) || "새 대화";
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-store.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 대화 저장소와 기록→모델 메시지 변환(실패 제외·첨부 펼침·짝 없는 도구 호출 닫기)`.

---

### Task 7: 턴 엔진 `runTurn`

**Files:**
- Create: `frontend/src/lib/chat/engine.ts`
- Test: `frontend/src/lib/__tests__/chat-engine.test.ts`

**Interfaces:**
- Consumes: Task 2 `maskText`, Task 4 `ToolRun`, Task 5 `buildToolset·tierOf·needsAction·clientPromptLines·ORG_TOOLS·summarizeToolResult·ChatEvent·ActionReply·PendingCall`, Task 6 `ChatStore·historyForModel·pendingCalls·attachmentIdsIn·expiresAt·titleFrom·cancelResult`, `assistantSystemPrompt(p, extra)`
- Produces:
  - `type StreamFn = (p: { model: string; system: Anthropic.TextBlockParam[]; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]; noTools: boolean }, onText: (t: string) => void, signal?: AbortSignal) => Promise<Anthropic.Message>`
  - `type TurnInput = { userId: string; name: string; email: string; client: "web" | "app"; conversationId?: string; text?: string; attachmentIds?: string[]; actions?: ActionReply[]; retry?: boolean; model: string; ephemeral: boolean; desktopOnline: boolean; now: string }`
  - `type TurnDeps = { store: ChatStore; allowed: (k: PageKey) => boolean; retentionDays: number; stream: StreamFn; runServer: (tool: string, args: Record<string, unknown>) => Promise<ToolRun>; runRelay: (tool: string, args: Record<string, unknown>) => Promise<ToolRun>; loadAttachments: (ids: string[]) => Promise<Map<string, Anthropic.ContentBlockParam[]>>; recordUsage: (u: { model: string; inputTokens: number; outputTokens: number; masked: number }) => Promise<void>; audit: (d: { tools: string[]; model: string; inputTokens: number; outputTokens: number; masked: number; client: string }) => Promise<void>; signal?: AbortSignal }`
  - `class TurnInputError extends Error`
  - `MAX_SERVER_ROUNDS = 3`
  - `runTurn(d: TurnDeps, inp: TurnInput, emit: (e: ChatEvent) => void): Promise<void>`
  - `parseTurnBody(raw: unknown): { ok: true; body: TurnBody } | { ok: false; error: string }` — `TurnBody = { conversationId?: string; text?: string; attachmentIds?: string[]; actions?: ActionReply[]; retry?: boolean; model?: string; client: "web" | "app"; ephemeral: boolean; desktopOnline: boolean; now?: string }`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_SERVER_ROUNDS, parseTurnBody, runTurn, type TurnDeps, type TurnInput } from "@/lib/chat/engine";
import type { ChatStore, ConvRow, MsgRow, StoredBlock } from "@/lib/chat/store";
import type { ChatEvent } from "@/lib/chat/events";

/** 메모리 저장소 — 테스트 전용 */
function memStore() {
  const convs: ConvRow[] = [];
  const msgs: Record<string, MsgRow[]> = {};
  const calls: Array<{ messageId: string; tool: string; status: string; summary: string }> = [];
  let n = 0;
  const store: ChatStore = {
    async create(o) { const c = { id: `00000000-0000-0000-0000-00000000000${convs.length + 1}`, user_id: o.userId, title: o.title, model: o.model, ephemeral: o.ephemeral, created_at: "", last_message_at: "", expires_at: o.expiresAt }; convs.push(c); msgs[c.id] = []; return c; },
    async get(userId, id) { return convs.find((c) => c.id === id && c.user_id === userId) ?? null; },
    async messages(id) { return msgs[id].map((m) => ({ ...m, content: JSON.parse(JSON.stringify(m.content)) })); },
    async append(id, m) { const row: MsgRow = { id: `m${++n}`, role: m.role, content: m.content as StoredBlock[], status: m.status ?? "ok", masked_count: m.masked ?? 0, created_at: "" }; msgs[id].push(row); return row.id; },
    async toolCalls(messageId, rows) { calls.push(...rows.map((r) => ({ messageId, tool: r.tool, status: r.status, summary: r.summary }))); },
    async touch() {},
    async linkAttachments() { return []; },
  };
  return { store, convs, msgs, calls };
}
const reply = (content: Anthropic.ContentBlock[], usage = { input_tokens: 10, output_tokens: 5 }) => ({ id: "x", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", content, usage }) as unknown as Anthropic.Message;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.ContentBlock;
const use = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use", id, name, input }) as Anthropic.ContentBlock;

let mem: ReturnType<typeof memStore>, events: ChatEvent[], stream: ReturnType<typeof vi.fn>, d: TurnDeps;
const base: TurnInput = { userId: "u1", name: "강", email: "a@innogrid.com", client: "web", model: "claude-sonnet-5-5", ephemeral: false, desktopOnline: true, now: "2026-10-15T15:00" };
const emit = (e: ChatEvent) => { events.push(e); };
beforeEach(() => {
  mem = memStore(); events = [];
  stream = vi.fn();
  d = {
    store: mem.store, allowed: () => true, retentionDays: 90, stream,
    runServer: vi.fn().mockResolvedValue({ ok: true, result: { chats: [{ name: "개발팀" }] } }),
    runRelay: vi.fn().mockResolvedValue({ ok: true, result: { items: [{ subject: "주간보고", phone: "010-1234-5678" }] } }),
    loadAttachments: vi.fn().mockResolvedValue(new Map()),
    recordUsage: vi.fn().mockResolvedValue(undefined), audit: vi.fn().mockResolvedValue(undefined),
  };
});

describe("runTurn", () => {
  it("새 대화 — 마스킹해 저장·전송, 텍스트 스트림, done", async () => {
    stream.mockImplementation(async (_p, onText) => { onText("안녕"); onText("하세요"); return reply([text("안녕하세요")]); });
    await runTurn(d, { ...base, text: "내 번호 010-1111-2222" }, emit);
    expect(events[0]).toMatchObject({ type: "conversation" });
    expect(events).toContainEqual({ type: "masked", count: 1 });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("안녕하세요");
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const sent = JSON.stringify(stream.mock.calls[0][0].messages);
    expect(sent).toContain("[전화번호]");
    expect(sent).not.toContain("010-1111-2222");
    const id = mem.convs[0].id;
    expect(JSON.stringify(mem.msgs[id])).not.toContain("010-1111-2222");
    expect(mem.convs[0].title).toBe("내 번호 [전화번호]");
    expect(d.recordUsage).toHaveBeenCalledWith({ model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 5, masked: 1 });
    expect(d.audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((d.audit as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain("번호");
  });
  it("중계 읽기 도구는 바로 실행 — Claude엔 가린 결과 원문, DB엔 요약만", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "list_mail_inbox")])).mockResolvedValueOnce(reply([text("주간보고가 있어요")]));
    await runTurn(d, { ...base, text: "메일 보여 줘" }, emit);
    expect(d.runRelay).toHaveBeenCalledWith("list_mail_inbox", {});
    const second = JSON.stringify(stream.mock.calls[1][0].messages);
    expect(second).toContain("주간보고");
    expect(second).toContain("[전화번호]");
    const stored = JSON.stringify(mem.msgs[mem.convs[0].id]);
    expect(stored).toContain("받은메일 목록 1건: 주간보고");
    expect(stored).not.toContain("phone");
    expect(mem.calls).toEqual([{ messageId: "m2", tool: "list_mail_inbox", status: "ok", summary: "받은메일 목록 1건: 주간보고" }]);
    expect(events.filter((e) => e.type === "tool").map((e) => (e as { status: string }).status)).toEqual(["running", "ok"]);
  });
  it("쓰기 서버 도구는 멈추고 needs_action, 승인하면 실행·이어서 답", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", chat_name: "개발팀", text: "안녕" })]));
    await runTurn(d, { ...base, text: "개발팀에 안녕 보내" }, emit);
    expect(d.runServer).not.toHaveBeenCalled();
    const na = events.find((e) => e.type === "needs_action") as Extract<ChatEvent, { type: "needs_action" }>;
    expect(na.calls).toEqual([{ id: "t1", tool: "teams_send", input: { chat_id: "19:x", chat_name: "개발팀", text: "안녕" }, location: "server", tier: "write" }]);
    events = [];
    stream.mockResolvedValueOnce(reply([text("보냈어요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: true }] }, emit);
    expect(d.runServer).toHaveBeenCalledWith("teams_send", { chat_id: "19:x", chat_name: "개발팀", text: "안녕" });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("거절하면 실행하지 않고 취소 결과", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    stream.mockResolvedValueOnce(reply([text("취소했어요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: false }] }, emit);
    expect(d.runServer).not.toHaveBeenCalled();
    expect(mem.calls.at(-1)).toMatchObject({ tool: "teams_send", status: "cancelled" });
  });
  it("앱 — 기기 도구는 앱 결과로 이어 가고, 결과가 없으면 '앱 응답 없음'", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "mail_list"), use("t2", "attendance_today")]));
    await runTurn(d, { ...base, client: "app", text: "메일과 출근" }, emit);
    expect(events.find((e) => e.type === "needs_action")).toBeTruthy();
    stream.mockResolvedValueOnce(reply([text("완료")]));
    await runTurn(d, { ...base, client: "app", conversationId: mem.convs[0].id, actions: [{ id: "t1", result: { items: [{ subject: "a" }] } }] }, emit);
    const sent = JSON.stringify(stream.mock.calls[1][0].messages);
    expect(sent).toContain("앱 응답 없음");
    expect(mem.calls.map((c) => c.status)).toEqual(["ok", "timeout"]);
  });
  it("대기 중 새 입력 — 대기 호출을 취소로 닫고 새 질문 처리", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    stream.mockResolvedValueOnce(reply([text("네, 다른 거요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, text: "아니 됐고 다른 질문" }, emit);
    const msgs = stream.mock.calls[1][0].messages as Anthropic.MessageParam[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "user"]);
    expect(JSON.stringify(msgs[2])).toContain('"tool_use_id":"t1"');
  });
  it(`서버 도구 왕복은 ${MAX_SERVER_ROUNDS}회까지 — 그다음 호출은 도구 없이`, async () => {
    stream.mockResolvedValue(reply([use("t", "teams_chats")]));
    stream.mockImplementation(async (p) => (p.noTools ? reply([text("끝")]) : reply([use(`t${Math.random()}`, "teams_chats")])));
    await runTurn(d, { ...base, text: "채팅 목록" }, emit);
    expect(stream).toHaveBeenCalledTimes(MAX_SERVER_ROUNDS + 1);
    expect(stream.mock.calls.at(-1)![0].noTools).toBe(true);
    expect(d.recordUsage).toHaveBeenCalledTimes(MAX_SERVER_ROUNDS + 1);
  });
  it("Claude 실패 → failed 저장·error(retryable), 다시 시도 → 실패 응답 빼고 재호출", async () => {
    stream.mockRejectedValueOnce(new Error("overloaded"));
    await runTurn(d, { ...base, text: "질문" }, emit);
    expect(events.at(-1)).toEqual({ type: "error", message: "이노봇이 답하지 못했습니다. 다시 시도해 주세요.", retryable: true });
    expect(d.recordUsage).not.toHaveBeenCalled();
    const id = mem.convs[0].id;
    expect(mem.msgs[id].at(-1)!.status).toBe("failed");
    stream.mockResolvedValueOnce(reply([text("답")]));
    await runTurn(d, { ...base, conversationId: id, retry: true }, emit);
    expect((stream.mock.calls[1][0].messages as unknown[]).length).toBe(1);
  });
  it("중지 — 받은 데까지 stopped로 저장", async () => {
    const ac = new AbortController();
    stream.mockImplementationOnce(async (_p, onText) => { onText("반쯤"); ac.abort(); throw new Error("aborted"); });
    await runTurn({ ...d, signal: ac.signal }, { ...base, text: "길게" }, emit);
    const last = mem.msgs[mem.convs[0].id].at(-1)!;
    expect(last).toMatchObject({ role: "assistant", status: "stopped", content: [{ type: "text", text: "반쯤" }] });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
  it("남의 대화 id → TurnInputError", async () => {
    await expect(runTurn(d, { ...base, conversationId: "00000000-0000-0000-0000-000000000009", text: "x" }, emit)).rejects.toThrow("대화를 찾지 못했습니다");
  });
  it("모르는 도구 이름 → 오류 결과로 바로 답(멈추지 않음)", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "submit_approval")])).mockResolvedValueOnce(reply([text("못 해요")]));
    await runTurn(d, { ...base, text: "결재 올려" }, emit);
    expect(events.some((e) => e.type === "needs_action")).toBe(false);
    expect(mem.calls[0]).toMatchObject({ tool: "submit_approval", status: "error" });
  });
});

describe("parseTurnBody", () => {
  it("입력은 text/첨부·actions·retry 중 하나", () => {
    expect(parseTurnBody({ text: "a" })).toMatchObject({ ok: true, body: { client: "web", ephemeral: false, desktopOnline: false } });
    expect(parseTurnBody({ text: "a", retry: true }).ok).toBe(false);
    expect(parseTurnBody({}).ok).toBe(false);
    expect(parseTurnBody({ actions: [{ id: "t1", approve: true }], conversationId: "00000000-0000-0000-0000-000000000001" }).ok).toBe(true);
    expect(parseTurnBody({ actions: [{ id: "t1" }] }).ok).toBe(false);
  });
  it("길이·개수 제한", () => {
    expect(parseTurnBody({ text: "가".repeat(20_001) }).ok).toBe(false);
    expect(parseTurnBody({ text: "a", attachmentIds: Array(6).fill("00000000-0000-0000-0000-000000000001") }).ok).toBe(false);
    expect(parseTurnBody({ text: "a", attachmentIds: ["../x"] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-engine.test.ts`
Expected: FAIL — `@/lib/chat/engine` 해석 실패

- [ ] **Step 3: 구현**

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { PageKey } from "@/lib/page-access";
import { assistantSystemPrompt } from "@/lib/assistant/tools";
import type { ToolRun } from "@/lib/assistant/server-tools";
import type { ActionReply, ChatEvent, Location, PendingCall } from "./events";
import { maskText } from "./mask";
import { ORG_TOOLS, buildToolset, clientPromptLines, needsAction, tierOf } from "./toolset";
import { summarizeToolResult } from "./summary";
import { attachmentIdsIn, cancelResult, expiresAt, historyForModel, pendingCalls, titleFrom, type ChatStore, type StoredBlock, type ToolCallRecord } from "./store";

export const MAX_SERVER_ROUNDS = 3;
export const TEXT_MAX = 20_000, ATTACH_MAX = 5, ACTIONS_MAX = 20;
const FAIL_MSG = "이노봇이 답하지 못했습니다. 다시 시도해 주세요.";

export type StreamFn = (p: { model: string; system: Anthropic.TextBlockParam[]; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]; noTools: boolean }, onText: (t: string) => void, signal?: AbortSignal) => Promise<Anthropic.Message>;
export type TurnInput = { userId: string; name: string; email: string; client: "web" | "app"; conversationId?: string; text?: string; attachmentIds?: string[]; actions?: ActionReply[]; retry?: boolean; model: string; ephemeral: boolean; desktopOnline: boolean; now: string };
export type TurnDeps = {
  store: ChatStore; allowed: (k: PageKey) => boolean; retentionDays: number; stream: StreamFn;
  runServer: (tool: string, args: Record<string, unknown>) => Promise<ToolRun>;
  runRelay: (tool: string, args: Record<string, unknown>) => Promise<ToolRun>;
  loadAttachments: (ids: string[]) => Promise<Map<string, Anthropic.ContentBlockParam[]>>;
  recordUsage: (u: { model: string; inputTokens: number; outputTokens: number; masked: number }) => Promise<void>;
  audit: (d: { tools: string[]; model: string; inputTokens: number; outputTokens: number; masked: number; client: string }) => Promise<void>;
  signal?: AbortSignal;
};
export class TurnInputError extends Error {}

type Call = { id: string; tool: string; input: Record<string, unknown>; location: Location | null; tier: string };

/**
 * 한 요청 = 사용자 입력(또는 확인·앱 결과, 다시 시도) → Claude 호출(서버·중계 읽기 도구는 최대 3회 왕복) → 저장.
 * 확인·앱 실행이 필요한 호출이 나오면 needs_action으로 멈춘다. 결과 원문은 이 요청 안에서만 Claude에 넘기고 DB엔 요약만 남긴다.
 */
export async function runTurn(d: TurnDeps, inp: TurnInput, emit: (e: ChatEvent) => void): Promise<void> {
  let conv = inp.conversationId ? await d.store.get(inp.userId, inp.conversationId) : null;
  if (inp.conversationId && !conv) throw new TurnInputError("대화를 찾지 못했습니다.");
  if (!conv) {
    if (inp.text === undefined && !inp.attachmentIds?.length) throw new TurnInputError("첫 메시지가 필요합니다.");
    conv = await d.store.create({ userId: inp.userId, model: inp.model, ephemeral: inp.ephemeral, title: titleFrom(maskText(inp.text ?? "").text || "첨부 파일"), expiresAt: expiresAt(new Date(), inp.ephemeral, d.retentionDays) });
  }
  const convId = conv.id, ephemeral = conv.ephemeral;
  emit({ type: "conversation", id: convId });
  const toolset = buildToolset({ client: inp.client, desktopOnline: inp.desktopOnline, allowed: d.allowed });
  const callOf = (u: { id: string; name: string; input: unknown }): Call => ({ id: u.id, tool: u.name, input: (u.input ?? {}) as Record<string, unknown>, location: toolset.location[u.name] ?? null, tier: tierOf(u.name) });
  const live = new Map<string, string>();
  const used: string[] = [];
  let masked = 0, tin = 0, tout = 0;
  const finish = () => d.audit({ tools: used, model: inp.model, inputTokens: tin, outputTokens: tout, masked, client: inp.client });

  const rows = await d.store.messages(convId);
  const pending = pendingCalls(rows);
  if (inp.actions) {
    if (!pending) throw new TurnInputError("처리할 작업이 없습니다.");
    const r = await executeCalls(d, pending.uses.map(callOf), inp.actions, emit);
    await d.store.toolCalls(pending.messageId, r.records);
    await d.store.append(convId, { role: "user", content: r.stored, masked: r.masked });
    r.live.forEach((v, k) => live.set(k, v)); masked += r.masked; used.push(...r.records.map((x) => x.tool));
  } else if (inp.retry) {
    const last = rows.filter((r) => r.status !== "failed").at(-1);
    if (!last || last.role !== "user") throw new TurnInputError("다시 시도할 질문이 없습니다.");
  } else {
    if (pending) await d.store.append(convId, { role: "user", content: pending.uses.map((u) => cancelResult(u.id)) });
    const m = maskText(inp.text ?? "");
    const atts = inp.attachmentIds?.length ? await d.store.linkAttachments(inp.userId, inp.attachmentIds, convId) : [];
    masked += m.count + atts.reduce((s, a) => s + a.masked_count, 0);
    const content: StoredBlock[] = [...(m.text ? [{ type: "text" as const, text: m.text }] : []), ...atts.map((a) => ({ type: "attachment" as const, id: a.id, name: a.name }))];
    if (!content.length) throw new TurnInputError("보낼 내용이 없습니다.");
    await d.store.append(convId, { role: "user", content, masked });
  }
  if (masked) emit({ type: "masked", count: masked });

  const system = assistantSystemPrompt({ now: inp.now, name: inp.name, email: inp.email }, clientPromptLines(inp.client, inp.desktopOnline));
  for (let round = 0; ; round++) {
    const all = await d.store.messages(convId);
    const atts = await d.loadAttachments(attachmentIdsIn(all));
    const messages = withLive(historyForModel(all, atts), live);
    let partial = "";
    let msg: Anthropic.Message;
    try {
      msg = await d.stream({ model: inp.model, system, tools: toolset.tools, messages, noTools: round >= MAX_SERVER_ROUNDS }, (t) => { partial += t; emit({ type: "text", delta: t }); }, d.signal);
    } catch (e) {
      if (d.signal?.aborted) {
        if (partial) await d.store.append(convId, { role: "assistant", content: [{ type: "text", text: partial }], status: "stopped" });
      } else {
        console.error("[chat] Claude 호출 실패:", e instanceof Error ? e.message.slice(0, 200) : e);
        await d.store.append(convId, { role: "assistant", content: [{ type: "text", text: partial }], status: "failed" });
        emit({ type: "error", message: FAIL_MSG, retryable: true });
      }
      await d.store.touch(convId, { model: inp.model, expiresAt: expiresAt(new Date(), ephemeral, d.retentionDays) });
      return finish();
    }
    tin += msg.usage.input_tokens; tout += msg.usage.output_tokens;
    await d.recordUsage({ model: inp.model, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, masked: round === 0 ? masked : 0 });
    const messageId = await d.store.append(convId, { role: "assistant", content: msg.content as unknown as StoredBlock[], inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
    await d.store.touch(convId, { model: inp.model, expiresAt: expiresAt(new Date(), ephemeral, d.retentionDays) });
    const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map(callOf);
    if (!calls.length) { emit({ type: "done", messageId }); return finish(); }
    if (calls.some(needsAction)) {
      used.push(...calls.map((c) => c.tool));
      emit({ type: "needs_action", messageId, calls: calls.map((c) => ({ ...c, location: c.location ?? "server" })) as PendingCall[] });
      return finish();
    }
    const r = await executeCalls(d, calls, null, emit);
    await d.store.toolCalls(messageId, r.records);
    await d.store.append(convId, { role: "user", content: r.stored, masked: r.masked });
    r.live.forEach((v, k) => live.set(k, v)); masked += r.masked; used.push(...r.records.map((x) => x.tool));
    if (r.masked) emit({ type: "masked", count: r.masked });
  }
}

/** 이번 요청에서 실행한 도구 결과는 요약 대신 가린 원문으로 Claude에 넘긴다. */
function withLive(messages: Anthropic.MessageParam[], live: Map<string, string>): Anthropic.MessageParam[] {
  if (!live.size) return messages;
  return messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map((b) => (b.type === "tool_result" && live.has(b.tool_use_id) ? { ...b, content: live.get(b.tool_use_id)! } : b)) } : m));
}

async function executeCalls(d: TurnDeps, calls: Call[], replies: ActionReply[] | null, emit: (e: ChatEvent) => void) {
  const stored: Anthropic.ToolResultBlockParam[] = [];
  const records: ToolCallRecord[] = [];
  const live = new Map<string, string>();
  let masked = 0;
  for (const c of calls) {
    emit({ type: "tool", id: c.id, tool: c.tool, location: c.location, status: "running" });
    const reply = replies?.find((r) => r.id === c.id);
    let run: ToolRun, status: ToolCallRecord["status"];
    if (!c.location) { run = { ok: false, error: "이 화면에서 쓸 수 없는 도구입니다." }; status = "error"; }
    else if (c.location === "device") {
      if (reply && "result" in reply) { run = reply.isError ? { ok: false, error: String(reply.result).slice(0, 2000) } : { ok: true, result: reply.result }; status = run.ok ? "ok" : "error"; }
      else { run = { ok: false, error: "앱 응답 없음" }; status = "timeout"; }
    } else if (c.tier !== "read" && !reply?.approve) { run = { ok: false, error: "사용자가 취소했습니다." }; status = "cancelled"; }
    else {
      run = c.location === "server" ? await d.runServer(c.tool, c.input) : await d.runRelay(c.tool, c.input);
      status = run.ok ? "ok" : /시간 초과/.test(run.error) ? "timeout" : "error";
    }
    const m = maskText(run.ok ? JSON.stringify(run.result ?? null) : run.error, { keepPhone: ORG_TOOLS.has(c.tool) });
    masked += m.count;
    let view: unknown = m.text;
    if (run.ok) { try { view = JSON.parse(m.text); } catch { view = m.text; } }
    const summary = summarizeToolResult(c.tool, run.ok, view);
    live.set(c.id, m.text);
    stored.push({ type: "tool_result", tool_use_id: c.id, content: summary, ...(run.ok ? {} : { is_error: true }) });
    records.push({ toolUseId: c.id, tool: c.tool, location: c.location ?? "server", status, summary });
    emit({ type: "tool", id: c.id, tool: c.tool, location: c.location, status: run.ok ? "ok" : "error", summary });
  }
  return { stored, records, live, masked };
}

export type TurnBody = { conversationId?: string; text?: string; attachmentIds?: string[]; actions?: ActionReply[]; retry?: boolean; model?: string; client: "web" | "app"; ephemeral: boolean; desktopOnline: boolean; now?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 요청 본문 검사 — 입력은 (text·첨부) | actions | retry 중 정확히 하나. */
export function parseTurnBody(raw: unknown): { ok: true; body: TurnBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "본문 형식이 올바르지 않습니다." };
  const o = raw as Record<string, unknown>;
  const bad = (error: string) => ({ ok: false as const, error });
  if (o.conversationId !== undefined && (typeof o.conversationId !== "string" || !UUID.test(o.conversationId))) return bad("대화 id가 올바르지 않습니다.");
  if (o.text !== undefined && (typeof o.text !== "string" || o.text.length > TEXT_MAX)) return bad(`메시지는 ${TEXT_MAX.toLocaleString("ko-KR")}자까지 보낼 수 있습니다.`);
  if (o.attachmentIds !== undefined && (!Array.isArray(o.attachmentIds) || o.attachmentIds.length > ATTACH_MAX || !o.attachmentIds.every((x) => typeof x === "string" && UUID.test(x)))) return bad(`첨부는 ${ATTACH_MAX}개까지입니다.`);
  if (o.actions !== undefined && (!Array.isArray(o.actions) || !o.actions.length || o.actions.length > ACTIONS_MAX || !o.actions.every((a) => a && typeof a === "object" && typeof (a as ActionReply).id === "string" && ("approve" in a || "result" in a)))) return bad("작업 응답 형식이 올바르지 않습니다.");
  const hasInput = o.text !== undefined || (Array.isArray(o.attachmentIds) && o.attachmentIds.length > 0);
  const kinds = [hasInput, o.actions !== undefined, o.retry === true].filter(Boolean).length;
  if (kinds !== 1) return bad("입력·작업 응답·다시 시도 중 하나만 보내세요.");
  if (o.actions !== undefined && o.conversationId === undefined) return bad("대화 id가 필요합니다.");
  if (o.retry === true && o.conversationId === undefined) return bad("대화 id가 필요합니다.");
  return { ok: true, body: {
    conversationId: o.conversationId as string | undefined,
    text: o.text as string | undefined,
    attachmentIds: o.attachmentIds as string[] | undefined,
    actions: o.actions as ActionReply[] | undefined,
    retry: o.retry === true,
    model: typeof o.model === "string" ? o.model : undefined,
    client: o.client === "app" ? "app" : "web",
    ephemeral: o.ephemeral === true,
    desktopOnline: o.desktopOnline === true,
    now: typeof o.now === "string" ? o.now : undefined,
  } };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-engine.test.ts`
Expected: PASS (13 tests). 실패하면 테스트가 아니라 엔진을 고친다(테스트는 설계서 §1·§2의 동작 그대로다).

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 턴 엔진 — 마스킹·서버/중계 도구 왕복(3회)·확인 대기·중지·다시 시도`.

---

### Task 8: Claude 스트리밍·턴 API `POST /api/chat/turn`·설정 API

**Files:**
- Modify: `frontend/src/lib/assistant/llm.ts`(끝에 `streamAssistant` 추가)
- Create: `frontend/src/lib/chat/access.ts`, `frontend/src/app/api/chat/turn/route.ts`, `frontend/src/app/api/chat/config/route.ts`
- Test: `frontend/src/lib/__tests__/chat-turn-api.test.ts`

**Interfaces:**
- Consumes: Task 3 `loadAssistantSettings·pickModel·turnsToday·recordUsage`, Task 4 `runServerTool`, Task 6 `supabaseChatStore`, Task 7 `runTurn·parseTurnBody·TurnInputError`, `relayToolCall`, Task 10 `attachmentLoader`(Task 10 전에는 `async () => new Map()`로 두고 Task 10에서 바꾼다)
- Produces:
  - `streamAssistant: StreamFn`
  - `loadPermissions(admin, userId): Promise<PagePermissions | null>`
  - `POST /api/chat/turn` → 401·400·403·429·503(JSON) 또는 200 SSE(`text/event-stream`)
  - `GET /api/chat/config` → `{ enabled: boolean; models: string[]; defaultModel: string }`

- [ ] **Step 1: 실패하는 테스트**

```ts
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true, role: "user" as "user" | "admin", settings: [] as Array<{ key: string; value: string }>, perms: null as unknown, used: 0 as number | null, run: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => (m.ok ? { ok: true, userId: "u1", role: m.role, admin: {
  from: (t: string) => t === "settings" ? { select: () => ({ in: async () => ({ data: m.settings, error: null }) }) }
    : t === "user_page_access" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.perms ? { permissions: m.perms } : null, error: null }) }) }) }
    : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: "강", email: "a@innogrid.com" }, error: null }) }) }) },
} } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) }) }));
vi.mock("@/lib/chat/usage", () => ({ turnsToday: async () => m.used, recordUsage: vi.fn() }));
vi.mock("@/lib/chat/engine", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/engine")>()), runTurn: m.run }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { POST } from "@/app/api/chat/turn/route";
const req = (b: unknown) => new NextRequest("https://app.test/api/chat/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test"); m.ok = true; m.role = "user"; m.settings = []; m.perms = null; m.used = 0;
  m.run.mockReset().mockImplementation(async (_d, inp, emit) => { emit({ type: "conversation", id: "c1" }); emit({ type: "text", delta: inp.model }); emit({ type: "done", messageId: "m1" }); });
});

it("SSE로 엔진 이벤트를 흘리고, 허용 밖 모델은 Sonnet으로", async () => {
  const res = await POST(req({ text: "안녕", model: "gpt-x" }));
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await res.text();
  expect(body).toContain('data: {"type":"conversation","id":"c1"}');
  expect(body).toContain('"delta":"claude-sonnet-5-5"');
  expect(m.run.mock.calls[0][1]).toMatchObject({ userId: "u1", name: "강", client: "web", text: "안녕" });
});
it("관리자가 Opus를 빼면 Opus 요청도 Sonnet", async () => {
  m.settings = [{ key: "assistant_models", value: "claude-sonnet-5-5" }];
  await (await POST(req({ text: "a", model: "claude-opus-5-5" }))).text();
  expect(m.run.mock.calls[0][1].model).toBe("claude-sonnet-5-5");
});
it("꺼짐 403, 권한 없음 403, 상한 429, 사용량 오류 503, 형식 400, 비로그인 401 — 엔진을 부르지 않는다", async () => {
  m.settings = [{ key: "assistant_enabled", value: "off" }];
  expect((await POST(req({ text: "a" }))).status).toBe(403);
  m.settings = []; m.perms = { assistant: false };
  expect((await POST(req({ text: "a" }))).status).toBe(403);
  m.perms = null; m.settings = [{ key: "assistant_daily_turns", value: "3" }]; m.used = 3;
  expect((await POST(req({ text: "a" }))).status).toBe(429);
  m.used = null;
  expect((await POST(req({ text: "a" }))).status).toBe(503);
  m.used = 0; m.settings = [];
  expect((await POST(req({}))).status).toBe(400);
  m.ok = false;
  expect((await POST(req({ text: "a" }))).status).toBe(401);
  expect(m.run).not.toHaveBeenCalled();
});
it("엔진의 입력 오류는 error 이벤트(retryable:false)", async () => {
  const { TurnInputError } = await import("@/lib/chat/engine");
  m.run.mockRejectedValueOnce(new TurnInputError("대화를 찾지 못했습니다."));
  const body = await (await POST(req({ text: "a", conversationId: "00000000-0000-0000-0000-000000000001" }))).text();
  expect(body).toContain('"type":"error","message":"대화를 찾지 못했습니다.","retryable":false');
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-turn-api.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: 구현**

`llm.ts` 끝에 추가:

```ts
/** 웹 채팅(/api/chat/turn) 한 번의 Claude 호출 — 스트리밍으로 텍스트를 흘리고 완성 메시지를 돌려준다. 도구 정의 마지막에 캐시 표시. */
export const streamAssistant: import("@/lib/chat/engine").StreamFn = async (p, onText, signal) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools = p.tools.map((t, i, a) => (i === a.length - 1 ? { ...t, cache_control: CACHE } : t));
  const s = client.messages.stream({
    model: p.model, max_tokens: 8192, system: p.system, tools, messages: p.messages,
    ...(p.noTools ? { tool_choice: { type: "none" } } : {}),
    thinking: { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam,
    cache_control: CACHE,
  } as Anthropic.MessageStreamParams, { signal });
  s.on("text", onText);
  const msg = await s.finalMessage();
  if (msg.stop_reason === "max_tokens") throw new Error("답이 잘렸습니다(max_tokens)");
  return msg;
};
```

`access.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPagePermissions, type PagePermissions } from "@/lib/page-access";

/** 사용자별 페이지 권한. 조회 오류·형식 오류는 null — 호출자는 닫힌 채로 실패한다. */
export async function loadPermissions(admin: SupabaseClient, userId: string): Promise<PagePermissions | null> {
  const { data, error } = await admin.from("user_page_access").select("permissions").eq("user_id", userId).maybeSingle();
  if (error || (data && !isPagePermissions(data.permissions))) return null;
  return (data?.permissions as PagePermissions | undefined) ?? {};
}
```

`app/api/chat/turn/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { canUsePage } from "@/lib/page-access";
import { loadAssistantSettings, pickModel } from "@/lib/assistant/settings";
import { runServerTool } from "@/lib/assistant/server-tools";
import { streamAssistant } from "@/lib/assistant/llm";
import { relayToolCall } from "@/lib/mcp/relay";
import { recordUsage, turnsToday } from "@/lib/chat/usage";
import { loadPermissions } from "@/lib/chat/access";
import { supabaseChatStore } from "@/lib/chat/store";
import { parseTurnBody, runTurn, TurnInputError, type TurnDeps } from "@/lib/chat/engine";
import { sseLine, type ChatEvent } from "@/lib/chat/events";

export const runtime = "nodejs";
export const maxDuration = 300;
const BODY_MAX = 512 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };
const NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+09:00)?$/;

/**
 * POST /api/chat/turn — 웹·앱 공용 이노봇 한 턴(설계서 §1.4). 거버넌스(권한·모델·상한)는 스트림을 열기 전에 JSON으로 거절하고,
 * 그 뒤는 SSE 이벤트(conversation·text·tool·masked·needs_action·done·error). 본문·인자는 기록하지 않는다.
 */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > BODY_MAX) return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 400 });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON 형식이 아닙니다." }, { status: 400 }); }
  const parsed = parseTurnBody(json);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const b = parsed.body;
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!cfg.enabled) return NextResponse.json({ error: "관리자가 이노봇을 꺼 두었습니다." }, { status: 403 });
  const perms = await loadPermissions(r.admin, r.userId);
  if (!perms) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!canUsePage(r.role, "assistant", perms)) return NextResponse.json({ error: "이노봇 권한이 없습니다." }, { status: 403 });
  // 확인 후 기록이라 원자적이지 않다 — 동시 요청에서 상한을 조금 넘을 수 있으나 허용한다.
  const used = await turnsToday(r.admin, r.userId);
  if (used === null) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (used >= cfg.dailyLimit) return NextResponse.json({ error: "오늘 이노봇 사용 한도를 다 썼습니다. 내일 다시 이용해 주세요." }, { status: 429 });
  const { data: profile } = await r.admin.from("user_profiles").select("display_name,email").eq("user_id", r.userId).maybeSingle();
  const p = (profile ?? {}) as { display_name?: string | null; email?: string | null };
  const model = pickModel(b.model, cfg.models);
  const now = b.now && NOW_RE.test(b.now) ? b.now : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);

  const deps: TurnDeps = {
    store: supabaseChatStore(r.admin),
    allowed: (k) => canUsePage(r.role, k, perms),
    retentionDays: cfg.retentionDays,
    stream: streamAssistant,
    runServer: (tool, args) => runServerTool(r.admin, r.userId, r.role, tool, args),
    runRelay: async (tool, args) => {
      const x = await relayToolCall({ admin: r.admin }, r.userId, tool, args);
      const text = x.content.map((c) => c.text).join("\n");
      if (x.isError) return { ok: false, error: text };
      try { return { ok: true, result: JSON.parse(text) }; } catch { return { ok: true, result: text }; }
    },
    loadAttachments: async () => new Map(),
    recordUsage: (u) => recordUsage(r.admin, { userId: r.userId, ...u }),
    audit: (detail) => logAudit(r.admin, request, { userId: r.userId, action: "비서 턴", category: "assistant", detail }),
    signal: request.signal,
  };
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const emit = (e: ChatEvent) => { try { ctrl.enqueue(enc.encode(sseLine(e))); } catch { /* 연결이 끊김 */ } };
      try {
        await runTurn(deps, { userId: r.userId, name: p.display_name ?? "", email: p.email ?? "", client: b.client, conversationId: b.conversationId, text: b.text, attachmentIds: b.attachmentIds, actions: b.actions, retry: b.retry, model, ephemeral: b.ephemeral, desktopOnline: b.desktopOnline, now }, emit);
      } catch (e) {
        if (!(e instanceof TurnInputError)) console.error("[chat] 턴 실패:", e instanceof Error ? e.message.slice(0, 200) : e);
        emit({ type: "error", message: e instanceof TurnInputError ? e.message : "이노봇이 답하지 못했습니다. 다시 시도해 주세요.", retryable: !(e instanceof TurnInputError) });
      } finally {
        try { ctrl.close(); } catch { /* 이미 닫힘 */ }
      }
    },
  });
  return new Response(stream, { headers: { ...NO_STORE, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
}
```

`app/api/chat/config/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadAssistantSettings, pickModel } from "@/lib/assistant/settings";

export const runtime = "nodejs";
/** GET /api/chat/config — 채팅 화면의 모델 선택지·켜짐 여부. */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  return NextResponse.json({ enabled: cfg.enabled, models: cfg.models, defaultModel: pickModel(undefined, cfg.models) }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-turn-api.test.ts && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 0. `Anthropic.MessageStreamParams` 이름이 SDK 0.123에 없으면 `Anthropic.MessageCreateParamsStreaming`으로 바꾸고 Ruling을 남긴다.

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): POST /api/chat/turn SSE 턴 API·GET /api/chat/config`.

---
### Task 9: 대화 목록·본문·이름 바꾸기·삭제 API

**Files:**
- Create: `frontend/src/app/api/chat/conversations/route.ts`, `frontend/src/app/api/chat/conversations/[id]/route.ts`
- Test: `frontend/src/lib/__tests__/chat-conversations-api.test.ts`

**Interfaces:**
- Consumes: Task 10의 `deleteAttachmentObjects(admin, rows: Array<{ storage_path: string }>)` — 이 태스크에서는 `attachments.ts`에 함수 하나만 먼저 만든다(Step 3).
- Produces:
  - `GET /api/chat/conversations?limit=` → `{ conversations: Array<{ id; title; model; last_message_at }> }`(ephemeral 제외, 최신순, 기본 50·최대 100)
  - `GET /api/chat/conversations/[id]` → `{ conversation: ConvRow; messages: MsgRow[]; toolCalls: Array<{ message_id; tool_use_id; tool; location; status; summary }> }`, 남의 것·없음 404
  - `PATCH /api/chat/conversations/[id]` `{ title }`(1~80자) → `{ ok: true }`
  - `DELETE /api/chat/conversations/[id]` → `{ ok: true }`(첨부 객체 먼저 지우고 대화 삭제)

- [ ] **Step 1: 실패하는 테스트**

```ts
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ conv: null as null | Record<string, unknown>, calls: [] as string[], removed: [] as string[][] }));
function q(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "in", "is", "order", "limit", "update"]) chain[k] = (...a: unknown[]) => { m.calls.push(`${table}.${k}:${JSON.stringify(a)}`); return chain; };
  chain.maybeSingle = async () => ({ data: table === "chat_conversations" ? m.conv : null, error: null });
  chain.delete = () => { m.calls.push(`${table}.delete`); return chain; };
  chain.then = (res: (v: unknown) => void) => res({ data: table === "chat_conversations" ? [{ id: "c1", title: "t", model: "s", last_message_at: "x" }] : table === "chat_attachments" ? [{ storage_path: "u1/a1/original.pdf" }] : [], error: null });
  void self;
  return chain;
}
const admin = { from: q, storage: { from: () => ({ remove: async (p: string[]) => { m.removed.push(p); return { error: null }; } }) } };
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => ({ ok: true, userId: "u1", role: "user", admin }) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { GET as LIST } from "@/app/api/chat/conversations/route";
import { DELETE, GET, PATCH } from "@/app/api/chat/conversations/[id]/route";
const ID = "00000000-0000-0000-0000-000000000001";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
beforeEach(() => { m.conv = { id: ID, user_id: "u1" }; m.calls = []; m.removed = []; });

it("목록은 내 것·저장 안 함 제외", async () => {
  const j = await (await LIST(new NextRequest("https://a.test/api/chat/conversations"))).json();
  expect(j.conversations).toHaveLength(1);
  expect(m.calls).toEqual(expect.arrayContaining(['chat_conversations.eq:["user_id","u1"]', 'chat_conversations.eq:["ephemeral",false]']));
});
it("남의 대화·잘못된 id는 404", async () => {
  m.conv = null;
  expect((await GET(new NextRequest("https://a.test/x"), ctx())).status).toBe(404);
  expect((await GET(new NextRequest("https://a.test/x"), ctx("../etc"))).status).toBe(404);
  expect((await DELETE(new NextRequest("https://a.test/x", { method: "DELETE" }), ctx())).status).toBe(404);
});
it("이름 바꾸기는 1~80자", async () => {
  const p = (title: unknown) => PATCH(new NextRequest("https://a.test/x", { method: "PATCH", body: JSON.stringify({ title }) }), ctx());
  expect((await p("")).status).toBe(400);
  expect((await p("가".repeat(81))).status).toBe(400);
  expect((await p("새 이름")).status).toBe(200);
});
it("삭제는 첨부 원본·텍스트 객체를 지우고 대화를 지운다", async () => {
  expect((await DELETE(new NextRequest("https://a.test/x", { method: "DELETE" }), ctx())).status).toBe(200);
  expect(m.removed[0]).toEqual(["u1/a1/original.pdf", "u1/a1/text.txt"]);
  expect(m.calls).toContain("chat_conversations.delete");
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-conversations-api.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/chat/attachments.ts`(이 태스크에서는 아래 내용만, Task 10에서 이어 붙인다):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const CHAT_BUCKET = "chat";
/** 원본 경로(`<user>/<id>/original.<ext>`) 옆의 추출 텍스트 경로 */
export const textPathOf = (storagePath: string) => storagePath.replace(/\/[^/]+$/, "/text.txt");

/** 첨부 원본·추출 텍스트 객체를 지운다(없는 객체는 무시). 실패는 기록만 — 남은 객체는 보존 크론이 다시 지운다. */
export async function deleteAttachmentObjects(admin: SupabaseClient, rows: Array<{ storage_path: string }>): Promise<void> {
  const paths = rows.flatMap((r) => [r.storage_path, textPathOf(r.storage_path)]);
  if (!paths.length) return;
  const { error } = await admin.storage.from(CHAT_BUCKET).remove(paths);
  if (error) console.error("[chat] 첨부 객체 삭제 실패:", error.message);
}
```

`conversations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";

export const runtime = "nodejs";
/** GET /api/chat/conversations — 내 대화 목록(저장 안 함 제외, 최신순). */
export async function GET(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  const { data, error } = await r.admin.from("chat_conversations").select("id,title,model,last_message_at").eq("user_id", r.userId).eq("ephemeral", false).order("last_message_at", { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: "대화 목록을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
```

`conversations/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { supabaseChatStore } from "@/lib/chat/store";
import { deleteAttachmentObjects } from "@/lib/chat/attachments";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
const NOT_FOUND = () => NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });

async function own(ctx: Ctx) {
  const r = await requireUser();
  if (!r.ok) return { response: r.response } as const;
  const { id } = await ctx.params;
  const conv = await supabaseChatStore(r.admin).get(r.userId, id);
  if (!conv) return { response: NOT_FOUND() } as const;
  return { r, conv } as const;
}

/** GET — 대화 본문(메시지·도구 호출 요약). 도구 결과 원문은 저장돼 있지 않다. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const o = await own(ctx);
  if ("response" in o) return o.response;
  const messages = await supabaseChatStore(o.r.admin).messages(o.conv.id);
  const ids = messages.map((x) => x.id);
  const { data: toolCalls, error } = ids.length ? await o.r.admin.from("chat_tool_calls").select("message_id,tool_use_id,tool,location,status,summary").in("message_id", ids) : { data: [], error: null };
  if (error) return NextResponse.json({ error: "대화를 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ conversation: o.conv, messages, toolCalls: toolCalls ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

/** PATCH — 이름 바꾸기 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const o = await own(ctx);
  if ("response" in o) return o.response;
  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 80) return NextResponse.json({ error: "이름은 1~80자로 입력하세요." }, { status: 400 });
  const { error } = await o.r.admin.from("chat_conversations").update({ title }).eq("id", o.conv.id).eq("user_id", o.r.userId);
  if (error) return NextResponse.json({ error: "이름을 바꾸지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE — 즉시 삭제(첨부 객체 포함). 감사 로그·사용량은 남는다. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const o = await own(ctx);
  if ("response" in o) return o.response;
  const { data: atts } = await o.r.admin.from("chat_attachments").select("storage_path").eq("conversation_id", o.conv.id);
  await deleteAttachmentObjects(o.r.admin, (atts ?? []) as Array<{ storage_path: string }>);
  await o.r.admin.from("chat_attachments").delete().eq("conversation_id", o.conv.id);
  const { error } = await o.r.admin.from("chat_conversations").delete().eq("id", o.conv.id).eq("user_id", o.r.userId);
  if (error) return NextResponse.json({ error: "삭제하지 못했습니다." }, { status: 500 });
  await logAudit(o.r.admin, req, { userId: o.r.userId, action: "대화 삭제", category: "assistant", detail: {} });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-conversations-api.test.ts`
Expected: PASS (4 tests). 테스트의 가짜 체인은 `messages()`의 `order().limit()` 결과를 thenable로 돌려준다 — 실패하면 가짜 체인 쪽을 고친다.

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 대화 목록·본문·이름 바꾸기·즉시 삭제 API`.

---

### Task 10: 파일 첨부 — 업로드·추출·마스킹·턴에서 다시 읽기

**Files:**
- Modify: `frontend/src/lib/chat/attachments.ts`(Task 9 내용 뒤에 이어 붙임)
- Create: `frontend/src/app/api/chat/attachments/route.ts`
- Modify: `frontend/src/app/api/chat/turn/route.ts`(`loadAttachments`)
- Test: `frontend/src/lib/__tests__/chat-attachments.test.ts`

**Interfaces:**
- Consumes: `textFromDocument(buf, name)`(`@/lib/ppt/source`), `parseDocumentAsync`(`@/lib/rfp/parse`), `documentText`(`@/lib/rfp/document-model`), `pptxExtractor(admin)`(`@/lib/sharepoint/pptx`), `maskText`
- Produces:
  - `ATTACH_EXTS`, `IMAGE_MIME: Record<string, string>`, `ATTACH_MAX_BYTES = 10 * 1024 * 1024`, `ATTACH_TEXT_MAX = 50_000`
  - `extOf(name: string): string`
  - `extractAttachment(buf: Buffer, name: string, deps: { pptx?: (buf: Buffer, name: string) => Promise<string> }): Promise<{ kind: "text"; text: string } | { kind: "image" | "pdf" }>`
  - `attachmentBlocks(row: AttachmentRow, data: { original?: Buffer; text?: string }): Anthropic.ContentBlockParam[]`
  - `attachmentLoader(admin, userId): (ids: string[]) => Promise<Map<string, Anthropic.ContentBlockParam[]>>`
  - `POST /api/chat/attachments`(multipart `file`) → `{ id, name, kind, maskedCount, warning? }`

- [ ] **Step 1: 실패하는 테스트**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ppt/source", () => ({ textFromDocument: vi.fn(async (buf: Buffer, name: string) => (name.endsWith(".pdf") && buf.toString() === "scan" ? "" : `본문:${name}`)) }));
vi.mock("@/lib/rfp/parse", () => ({ parseDocumentAsync: vi.fn(async () => ({ kind: "xlsx" })) }));
vi.mock("@/lib/rfp/document-model", () => ({ documentText: () => "시트 내용" }));
import { attachmentBlocks, extOf, extractAttachment } from "@/lib/chat/attachments";

describe("첨부 추출", () => {
  it("문서는 텍스트, xlsx는 시트 텍스트, 이미지는 원본", async () => {
    expect(await extractAttachment(Buffer.from("x"), "보고.docx", {})).toEqual({ kind: "text", text: "본문:보고.docx" });
    expect(await extractAttachment(Buffer.from("x"), "표.xlsx", {})).toEqual({ kind: "text", text: "시트 내용" });
    expect(await extractAttachment(Buffer.from("x"), "사진.PNG", {})).toEqual({ kind: "image" });
  });
  it("텍스트가 빈 PDF는 원본(스캔), pptx는 추출기가 없으면 오류", async () => {
    expect(await extractAttachment(Buffer.from("scan"), "스캔.pdf", {})).toEqual({ kind: "pdf" });
    await expect(extractAttachment(Buffer.from("x"), "발표.pptx", {})).rejects.toThrow("PPT");
    expect(await extractAttachment(Buffer.from("x"), "발표.pptx", { pptx: async () => "장표" })).toEqual({ kind: "text", text: "장표" });
  });
  it("허용 밖 확장자는 오류", async () => {
    await expect(extractAttachment(Buffer.from("x"), "a.exe", {})).rejects.toThrow("첨부할 수 없는");
    expect(extOf("A.Tar.GZ")).toBe("gz");
  });
  it("모델 블록 — 텍스트는 이름 머리말, 이미지·PDF는 base64", () => {
    const row = { id: "a", name: "보고.docx", mime: "application/x", kind: "text" as const, storage_path: "u/a/original.docx", masked_count: 0 };
    expect(attachmentBlocks(row, { text: "내용" })).toEqual([{ type: "text", text: "[첨부: 보고.docx]\n내용" }]);
    const img = attachmentBlocks({ ...row, name: "p.png", mime: "image/png", kind: "image" }, { original: Buffer.from("png") });
    expect(img[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png").toString("base64") } });
    const pdf = attachmentBlocks({ ...row, name: "s.pdf", mime: "application/pdf", kind: "pdf" }, { original: Buffer.from("%PDF") });
    expect(pdf[1]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(attachmentBlocks({ ...row, kind: "image" }, {})).toEqual([{ type: "text", text: "[첨부: 보고.docx — 파일을 읽지 못함]" }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-attachments.test.ts`
Expected: FAIL — `extractAttachment` 없음

- [ ] **Step 3: 구현**

`attachments.ts`에 이어 붙인다(파일 맨 위 import에 아래 두 줄을 합친다).

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { textFromDocument } from "@/lib/ppt/source";
import { parseDocumentAsync } from "@/lib/rfp/parse";
import { documentText } from "@/lib/rfp/document-model";
import type { AttachmentRow } from "./store";

export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACH_TEXT_MAX = 50_000;
export const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const ATTACH_EXTS = ["docx", "pdf", "pptx", "xlsx", "hwp", "hwpx", "txt", "md", ...Object.keys(IMAGE_MIME)];
export const extOf = (name: string) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i + 1).toLowerCase(); };

/** 첨부 → 텍스트(마스킹 대상) 또는 원본 그대로(이미지·스캔 PDF, 가릴 수 없음). */
export async function extractAttachment(buf: Buffer, name: string, deps: { pptx?: (buf: Buffer, name: string) => Promise<string> }): Promise<{ kind: "text"; text: string } | { kind: "image" | "pdf" }> {
  const ext = extOf(name);
  if (!ATTACH_EXTS.includes(ext)) throw new Error(`${ext || "확장자 없는"} 파일은 첨부할 수 없는 형식입니다(${ATTACH_EXTS.join("·")}).`);
  if (IMAGE_MIME[ext]) return { kind: "image" };
  if (ext === "pptx") {
    if (!deps.pptx) throw new Error("PPT 본문 읽기를 쓸 수 없습니다(관리자 설정 필요).");
    return { kind: "text", text: (await deps.pptx(buf, name)).slice(0, ATTACH_TEXT_MAX) };
  }
  const text = ext === "xlsx" ? documentText(await parseDocumentAsync(buf, name)) : await textFromDocument(buf, name);
  if (ext === "pdf" && !text.trim()) return { kind: "pdf" };
  return { kind: "text", text: text.slice(0, ATTACH_TEXT_MAX) };
}

/** 저장된 첨부 → Claude 블록. 텍스트는 가린 추출본, 이미지·PDF는 원본 base64. */
export function attachmentBlocks(row: AttachmentRow, data: { original?: Buffer; text?: string }): Anthropic.ContentBlockParam[] {
  const head = `[첨부: ${row.name}]`;
  if (row.kind === "text" && data.text !== undefined) return [{ type: "text", text: `${head}\n${data.text}` }];
  if (row.kind === "image" && data.original) return [{ type: "text", text: head }, { type: "image", source: { type: "base64", media_type: row.mime as "image/png", data: data.original.toString("base64") } }];
  if (row.kind === "pdf" && data.original) return [{ type: "text", text: head }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: data.original.toString("base64") } }];
  return [{ type: "text", text: `[첨부: ${row.name} — 파일을 읽지 못함]` }];
}

async function download(admin: SupabaseClient, path: string): Promise<Buffer | undefined> {
  const { data, error } = await admin.storage.from(CHAT_BUCKET).download(path);
  if (error || !data) return undefined;
  return Buffer.from(await data.arrayBuffer());
}

/** 턴 엔진의 loadAttachments — 내 첨부만 읽는다. */
export function attachmentLoader(admin: SupabaseClient, userId: string) {
  return async (ids: string[]): Promise<Map<string, Anthropic.ContentBlockParam[]>> => {
    const out = new Map<string, Anthropic.ContentBlockParam[]>();
    if (!ids.length) return out;
    const { data, error } = await admin.from("chat_attachments").select("id,name,mime,kind,storage_path,masked_count").in("id", ids).eq("user_id", userId);
    if (error) throw new Error(`첨부 조회 실패: ${error.message}`);
    for (const row of (data ?? []) as AttachmentRow[]) {
      if (row.kind === "text") {
        const t = await download(admin, textPathOf(row.storage_path));
        out.set(row.id, attachmentBlocks(row, { text: t?.toString("utf8") }));
      } else {
        out.set(row.id, attachmentBlocks(row, { original: await download(admin, row.storage_path) }));
      }
    }
    return out;
  };
}
```

`app/api/chat/attachments/route.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { canUsePage } from "@/lib/page-access";
import { loadPermissions } from "@/lib/chat/access";
import { maskText } from "@/lib/chat/mask";
import { pptxExtractor } from "@/lib/sharepoint/pptx";
import { ATTACH_MAX_BYTES, CHAT_BUCKET, IMAGE_MIME, extOf, extractAttachment, textPathOf } from "@/lib/chat/attachments";

export const runtime = "nodejs";
export const maxDuration = 120;
const IMAGE_WARNING = "이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.";

/** POST /api/chat/attachments — 파일 하나(multipart `file`). 텍스트는 뽑아 가린 뒤 따로 저장한다. 대화 연결은 턴에서. */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const perms = await loadPermissions(r.admin, r.userId);
  if (!perms) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!canUsePage(r.role, "assistant", perms)) return NextResponse.json({ error: "이노봇 권한이 없습니다." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (file.size > ATTACH_MAX_BYTES) return NextResponse.json({ error: "파일은 10MB까지 첨부할 수 있습니다." }, { status: 413 });
  const name = file.name.replace(/[\\/]/g, "_").slice(0, 200) || "file";
  const buf = Buffer.from(await file.arrayBuffer());
  let extracted;
  try { extracted = await extractAttachment(buf, name, { pptx: pptxExtractor(r.admin) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "파일을 읽지 못했습니다." }, { status: 415 }); }
  const id = randomUUID();
  const ext = extOf(name);
  const storagePath = `${r.userId}/${id}/original.${ext}`;
  const mime = IMAGE_MIME[ext] ?? (ext === "pdf" ? "application/pdf" : file.type || "application/octet-stream");
  const bucket = r.admin.storage.from(CHAT_BUCKET);
  const up = await bucket.upload(storagePath, buf, { contentType: mime, upsert: false });
  if (up.error) return NextResponse.json({ error: "파일을 저장하지 못했습니다." }, { status: 500 });
  let masked = 0, excerpt = "";
  if (extracted.kind === "text") {
    const m = maskText(extracted.text);
    masked = m.count; excerpt = m.text.slice(0, 300);
    const t = await bucket.upload(textPathOf(storagePath), Buffer.from(m.text, "utf8"), { contentType: "text/plain; charset=utf-8", upsert: false });
    if (t.error) { await bucket.remove([storagePath]); return NextResponse.json({ error: "파일을 저장하지 못했습니다." }, { status: 500 }); }
  }
  const { error } = await r.admin.from("chat_attachments").insert({ id, user_id: r.userId, name, mime, size: file.size, kind: extracted.kind, storage_path: storagePath, text_excerpt: excerpt, masked_count: masked });
  if (error) { await bucket.remove([storagePath, textPathOf(storagePath)]); return NextResponse.json({ error: "파일을 저장하지 못했습니다." }, { status: 500 }); }
  return NextResponse.json({ id, name, kind: extracted.kind, maskedCount: masked, ...(extracted.kind === "text" ? {} : { warning: IMAGE_WARNING }) });
}
```

`chat/turn/route.ts`: import에 `import { attachmentLoader } from "@/lib/chat/attachments";`를 더하고 `loadAttachments: async () => new Map(),`를 `loadAttachments: attachmentLoader(r.admin, r.userId),`로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-attachments.test.ts src/lib/__tests__/chat-turn-api.test.ts && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 0

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 파일 첨부 — 추출·마스킹·비공개 버킷 저장, 이어지는 턴에서 다시 읽기`.

---

### Task 11: 연결 상태 API `GET /api/chat/status`

**Files:**
- Create: `frontend/src/app/api/chat/status/route.ts`
- Test: `frontend/src/lib/__tests__/chat-status-api.test.ts`

**Interfaces:**
- Produces: `GET /api/chat/status` → `{ desktop: boolean; microsoft: boolean; atlassian: boolean }` — desktop은 중계 `whoami`가 성공하면 true(앱이 없으면 최대 10초 걸림 — 화면은 "확인 중"으로 보여 준다).

- [ ] **Step 1: 실패하는 테스트**

```ts
// @vitest-environment node
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ relay: vi.fn(), ms: vi.fn(), jira: null as unknown }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => ({ ok: true, userId: "u1", role: "user", admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.jira, error: null }) }) }) }) } }) }));
vi.mock("@/lib/mcp/relay", () => ({ relayToolCall: m.relay }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: m.ms }));
import { GET } from "@/app/api/chat/status/route";

it("앱 응답·Microsoft·Atlassian 연결을 각각 본다", async () => {
  m.relay.mockResolvedValue({ content: [{ type: "text", text: "{}" }] }); m.ms.mockResolvedValue({ connected: true }); m.jira = { user_id: "u1" };
  expect(await (await GET()).json()).toEqual({ desktop: true, microsoft: true, atlassian: true });
  expect(m.relay).toHaveBeenCalledWith(expect.anything(), "u1", "whoami", {});
  m.relay.mockResolvedValue({ content: [{ type: "text", text: "실행 중이 아닙니다" }], isError: true }); m.ms.mockRejectedValue(new Error("db")); m.jira = null;
  expect(await (await GET()).json()).toEqual({ desktop: false, microsoft: false, atlassian: false });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-status-api.test.ts`
Expected: FAIL — 라우트 없음

- [ ] **Step 3: 구현**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { relayToolCall } from "@/lib/mcp/relay";
import { getConnectionStatus } from "@/lib/ms/connections";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/chat/status — 채팅 상단 연결 상태 띠. 데스크톱 앱은 중계 whoami로 직접 확인한다(앱이 없으면 클레임 시간 초과 10초). */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const [desktop, microsoft, atlassian] = await Promise.all([
    relayToolCall({ admin: r.admin }, r.userId, "whoami", {}).then((x) => !x.isError).catch(() => false),
    getConnectionStatus(r.admin, r.userId).then((s) => s.connected).catch(() => false),
    Promise.resolve(r.admin.from("jira_connections").select("user_id").eq("user_id", r.userId).maybeSingle()).then((x) => !!x.data).catch(() => false),
  ]);
  return NextResponse.json({ desktop, microsoft, atlassian }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-status-api.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 연결 상태 API(데스크톱 앱·Microsoft·Atlassian)`.

---

### Task 12: 보존 크론 `/api/cron/chat-purge`

**Files:**
- Create: `frontend/src/app/api/cron/chat-purge/route.ts`
- Modify: `frontend/vercel.json`(crons 배열 끝)
- Test: `frontend/src/lib/__tests__/chat-purge-cron.test.ts`

**Interfaces:**
- Consumes: `deleteAttachmentObjects`
- Produces: `GET /api/cron/chat-purge`(Bearer `CRON_SECRET`) → `{ conversations: number; attachments: number }`

- [ ] **Step 1: 실패하는 테스트**

```ts
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ log: [] as string[], removed: [] as string[][] }));
function q(table: string) {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "lt", "is", "in", "limit"]) c[k] = (...a: unknown[]) => { m.log.push(`${table}.${k}:${JSON.stringify(a)}`); return c; };
  c.delete = () => { m.log.push(`${table}.delete`); return c; };
  c.then = (res: (v: unknown) => void) => res({ data: table === "chat_conversations" ? [{ id: "c1" }] : [{ id: "a1", storage_path: "u/a1/original.png" }], error: null });
  return c;
}
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: () => ({ from: q, storage: { from: () => ({ remove: async (p: string[]) => { m.removed.push(p); return { error: null }; } }) } }) }));
import { GET } from "@/app/api/cron/chat-purge/route";
beforeEach(() => { m.log = []; m.removed = []; vi.stubEnv("CRON_SECRET", "s3"); });

it("비밀값이 틀리면 401", async () => {
  expect((await GET(new NextRequest("https://a.test/api/cron/chat-purge", { headers: { authorization: "Bearer x" } }))).status).toBe(401);
});
it("만료 대화를 지우고, 하루 지난 고아 첨부의 객체와 행을 지운다", async () => {
  const j = await (await GET(new NextRequest("https://a.test/api/cron/chat-purge", { headers: { authorization: "Bearer s3" } }))).json();
  expect(j).toEqual({ conversations: 1, attachments: 1 });
  expect(m.log).toContain("chat_conversations.delete");
  expect(m.removed[0]).toEqual(["u/a1/original.png", "u/a1/text.txt"]);
  expect(m.log.some((l) => l.startsWith('chat_attachments.is:["conversation_id",null]'))).toBe(true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-purge-cron.test.ts`
Expected: FAIL — 라우트 없음

- [ ] **Step 3: 구현**

```ts
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { deleteAttachmentObjects } from "@/lib/chat/attachments";

export const runtime = "nodejs";
export const maxDuration = 60;
const BATCH = 500;

/**
 * 보존 기간(expires_at)이 지난 대화를 지운다(메시지·도구 기록은 cascade, 첨부 행은 conversation_id가 null이 됨).
 * 이어서 하루 지난 고아 첨부(보내지 않은 업로드·지워진 대화의 첨부)의 버킷 객체와 행을 지운다. 한 번에 500건씩 — 남으면 다음 날 이어서.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || ""), expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: convs, error: e1 } = await admin.from("chat_conversations").select("id").lt("expires_at", new Date().toISOString()).limit(BATCH);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  const ids = (convs ?? []).map((c: { id: string }) => c.id);
  if (ids.length) {
    const { error } = await admin.from("chat_conversations").delete().in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: orphans, error: e2 } = await admin.from("chat_attachments").select("id,storage_path").is("conversation_id", null).lt("created_at", cutoff).limit(BATCH);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  const rows = (orphans ?? []) as Array<{ id: string; storage_path: string }>;
  if (rows.length) {
    await deleteAttachmentObjects(admin, rows);
    const { error } = await admin.from("chat_attachments").delete().in("id", rows.map((r) => r.id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ conversations: ids.length, attachments: rows.length });
}
```

`vercel.json` crons 배열 끝에 추가(03:40 KST):

```json
    {
      "path": "/api/cron/chat-purge",
      "schedule": "40 18 * * *"
    }
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-purge-cron.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 보존 크론 — 만료 대화·고아 첨부 정리(매일 03:40 KST)`.

---

### Task 13: 관리자 — 보존일·허용 모델 설정, 사용량 화면

**Files:**
- Modify: `frontend/src/hooks/useSettings.ts:34`(키 2개)
- Modify: `frontend/src/components/settings/AssistantSettings.tsx`(전체 교체)
- Create: `frontend/src/lib/chat/usage-report.ts`, `frontend/src/app/api/admin/assistant-usage/route.ts`, `frontend/src/app/admin/assistant-usage/page.tsx`
- Modify: `frontend/src/app/admin/layout.tsx:21`(탭 하나)
- Test: `frontend/src/lib/__tests__/chat-usage-report.test.ts`

**Interfaces:**
- Consumes: `selectAll`(`@/lib/work-metrics/common`), `requireAdmin`·`adminClientOr500`(`@/lib/claude-usage/require-admin`)
- Produces:
  - `type UsageRow = { user_id: string; day: string; turns: number; input_tokens: number; output_tokens: number; model_turns: Record<string, number>; masked: number }`
  - `type UserUsage = { userId: string; name: string; email: string; team: string; turns: number; inputTokens: number; outputTokens: number; opusTurns: number; masked: number }`
  - `aggregateUsage(rows: UsageRow[], people: Map<string, { name: string; email: string }>, teams: Map<string, string>): { users: UserUsage[]; teams: Array<{ team: string; users: number; turns: number; inputTokens: number; outputTokens: number }> }`
  - `GET /api/admin/assistant-usage?days=7|30|90` → `{ from: string; users: UserUsage[]; teams: [...] }`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { expect, it } from "vitest";
import { aggregateUsage } from "@/lib/chat/usage-report";

it("사용자별 합계·Opus 턴·팀 합계(팀 없으면 '미지정'), 턴 많은 순", () => {
  const rows = [
    { user_id: "u1", day: "2026-10-14", turns: 3, input_tokens: 100, output_tokens: 10, model_turns: { "claude-sonnet-5-5": 2, "claude-opus-5-5": 1 }, masked: 1 },
    { user_id: "u1", day: "2026-10-15", turns: 2, input_tokens: 50, output_tokens: 5, model_turns: { "claude-opus-5-5": 2 }, masked: 0 },
    { user_id: "u2", day: "2026-10-15", turns: 9, input_tokens: 900, output_tokens: 90, model_turns: { "claude-sonnet-5-5": 9 }, masked: 2 },
  ];
  const people = new Map([["u1", { name: "가", email: "a@x" }], ["u2", { name: "나", email: "b@x" }]]);
  const r = aggregateUsage(rows, people, new Map([["a@x", "플랫폼팀"]]));
  expect(r.users.map((u) => [u.name, u.turns, u.opusTurns, u.team])).toEqual([["나", 9, 0, "미지정"], ["가", 5, 3, "플랫폼팀"]]);
  expect(r.teams).toEqual([{ team: "미지정", users: 1, turns: 9, inputTokens: 900, outputTokens: 90 }, { team: "플랫폼팀", users: 1, turns: 5, inputTokens: 150, outputTokens: 15 }]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-usage-report.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`usage-report.ts`:

```ts
export type UsageRow = { user_id: string; day: string; turns: number; input_tokens: number; output_tokens: number; model_turns: Record<string, number>; masked: number };
export type UserUsage = { userId: string; name: string; email: string; team: string; turns: number; inputTokens: number; outputTokens: number; opusTurns: number; masked: number };
export type TeamUsage = { team: string; users: number; turns: number; inputTokens: number; outputTokens: number };

/** assistant_usage 행 → 사용자·팀 합계(턴 많은 순). 본문은 다루지 않는다. */
export function aggregateUsage(rows: UsageRow[], people: Map<string, { name: string; email: string }>, teams: Map<string, string>): { users: UserUsage[]; teams: TeamUsage[] } {
  const byUser = new Map<string, UserUsage>();
  for (const r of rows) {
    const p = people.get(r.user_id) ?? { name: "", email: "" };
    const u = byUser.get(r.user_id) ?? { userId: r.user_id, name: p.name || p.email || r.user_id.slice(0, 8), email: p.email, team: teams.get(p.email) || "미지정", turns: 0, inputTokens: 0, outputTokens: 0, opusTurns: 0, masked: 0 };
    u.turns += Number(r.turns); u.inputTokens += Number(r.input_tokens); u.outputTokens += Number(r.output_tokens); u.masked += Number(r.masked);
    u.opusTurns += Object.entries(r.model_turns ?? {}).filter(([k]) => k.includes("opus")).reduce((s, [, v]) => s + Number(v), 0);
    byUser.set(r.user_id, u);
  }
  const users = [...byUser.values()].sort((a, b) => b.turns - a.turns);
  const byTeam = new Map<string, TeamUsage>();
  for (const u of users) {
    const t = byTeam.get(u.team) ?? { team: u.team, users: 0, turns: 0, inputTokens: 0, outputTokens: 0 };
    t.users++; t.turns += u.turns; t.inputTokens += u.inputTokens; t.outputTokens += u.outputTokens;
    byTeam.set(u.team, t);
  }
  return { users, teams: [...byTeam.values()].sort((a, b) => b.turns - a.turns) };
}
```

`app/api/admin/assistant-usage/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { selectAll } from "@/lib/work-metrics/common";
import { kstDay } from "@/lib/chat/usage";
import { aggregateUsage, type UsageRow } from "@/lib/chat/usage-report";

export const runtime = "nodejs";
/** GET /api/admin/assistant-usage?days= — 이노봇 사용량(사용자·팀). 대화 본문은 읽지 않는다. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const days = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("days"))) ? Number(new URL(request.url).searchParams.get("days")) : 30;
  const from = kstDay(new Date(Date.now() - (days - 1) * 24 * 3600_000));
  const rows = await selectAll<UsageRow>(() => a.admin.from("assistant_usage").select("user_id,day,turns,input_tokens,output_tokens,model_turns,masked", { count: "exact" }).gte("day", from).order("day"));
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  const ids = [...new Set(rows.data.map((r) => r.user_id))];
  const { data: profiles } = ids.length ? await a.admin.from("user_profiles").select("user_id,display_name,email").in("user_id", ids) : { data: [] };
  const people = new Map(((profiles ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>).map((p) => [p.user_id, { name: p.display_name ?? "", email: (p.email ?? "").toLowerCase() }]));
  const emails = [...people.values()].map((p) => p.email).filter(Boolean);
  const { data: dir } = emails.length ? await a.admin.from("company_directory").select("email,team").in("email", emails) : { data: [] };
  const teams = new Map(((dir ?? []) as Array<{ email: string; team: string | null }>).map((d) => [d.email.toLowerCase(), d.team ?? ""]));
  return NextResponse.json({ from, ...aggregateUsage(rows.data, people, teams) }, { headers: { "Cache-Control": "no-store" } });
}
```

`app/admin/assistant-usage/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeamUsage, UserUsage } from "@/lib/chat/usage-report";

const n = (v: number) => v.toLocaleString("ko-KR");

/** 이노봇 사용량 — 사용자·팀별 턴·토큰·Opus 비율·가린 건수. 대화 본문은 관리자도 볼 수 없다. */
export default function AssistantUsagePage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ from: string; users: UserUsage[]; teams: TeamUsage[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    fetch(`/api/admin/assistant-usage?days=${days}`).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) setError(j.error ?? "불러오지 못했습니다."); else setData(j);
    }).catch(() => alive && setError("불러오지 못했습니다."));
    return () => { alive = false; };
  }, [days]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">이노봇 사용량</h1>
        <select aria-label="기간" className="rounded-md border bg-background px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground">턴은 Claude 호출 횟수입니다. 대화 본문은 저장한 사람만 볼 수 있고, 이 화면에는 건수만 나옵니다.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data && (
        <>
          <Card><CardHeader><CardTitle className="text-base">팀별</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-1">팀</th><th>사용자</th><th>턴</th><th>입력 토큰</th><th>출력 토큰</th></tr></thead>
              <tbody>{data.teams.map((t) => <tr key={t.team} className="border-t"><td className="py-1">{t.team}</td><td>{n(t.users)}</td><td>{n(t.turns)}</td><td>{n(t.inputTokens)}</td><td>{n(t.outputTokens)}</td></tr>)}</tbody></table>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">사용자별</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-1">이름</th><th>팀</th><th>턴</th><th>Opus 비율</th><th>입력 토큰</th><th>출력 토큰</th><th>가린 개인정보</th></tr></thead>
              <tbody>{data.users.map((u) => <tr key={u.userId} className="border-t"><td className="py-1">{u.name}</td><td>{u.team}</td><td>{n(u.turns)}</td><td>{u.turns ? Math.round((u.opusTurns / u.turns) * 100) : 0}%</td><td>{n(u.inputTokens)}</td><td>{n(u.outputTokens)}</td><td>{n(u.masked)}</td></tr>)}</tbody></table>
            {!data.users.length && <p className="py-4 text-center text-sm text-muted-foreground">{data.from} 이후 사용 기록이 없습니다.</p>}
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
```

`admin/layout.tsx` 탭 목록의 `/admin/perf` 줄 앞에 `{ href: "/admin/assistant-usage", label: "이노봇 사용량", icon: Bot },`를 넣고 lucide import에 `Bot`을 더한다.

`useSettings.ts` `SETTING_KEYS`의 `"assistant_daily_turns",` 뒤에 `"assistant_models",`·`"assistant_retention_days",`를 넣는다.

`AssistantSettings.tsx` 전체:

```tsx
"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type { useSettings } from "@/hooks/useSettings";

const MODELS = [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5(기본)" }, { id: "claude-opus-5-5", label: "Opus 5.5" }];

/** 이노봇(웹 채팅·앱) — 켜기/끄기, 하루 턴 상한, 허용 모델, 대화 보존 기간. */
export default function AssistantSettings({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { settings, updateLocal } = settingsHook;
  const on = settings.assistant_enabled.trim().toLowerCase() !== "off";
  const picked = settings.assistant_models.split(",").map((x) => x.trim()).filter(Boolean);
  const allowed = (id: string) => !picked.length || picked.includes(id);
  const toggle = (id: string, v: boolean) => {
    const next = MODELS.map((m) => m.id).filter((x) => (x === id ? v : allowed(x)));
    updateLocal("assistant_models", next.length === MODELS.length ? "" : next.join(","));
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch id="assistant-enabled" checked={on} onCheckedChange={(v) => updateLocal("assistant_enabled", v ? "on" : "off")} aria-label="이노봇(웹 채팅·앱)을 씁니다" />
        <Label htmlFor="assistant-enabled">이노봇(웹 채팅·앱)을 씁니다</Label>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="assistant-daily" className="shrink-0">사용자당 하루 턴 상한</Label>
        <Input id="assistant-daily" className="w-28" inputMode="numeric" placeholder="200" value={settings.assistant_daily_turns} onChange={(e) => updateLocal("assistant_daily_turns", e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="assistant-retention" className="shrink-0">대화 보존 기간(일)</Label>
        <Input id="assistant-retention" className="w-28" inputMode="numeric" placeholder="90" value={settings.assistant_retention_days} onChange={(e) => updateLocal("assistant_retention_days", e.target.value.replace(/\D/g, ""))} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">사용자가 고를 수 있는 모델</legend>
        {MODELS.map((m) => (
          <div key={m.id} className="flex items-center gap-3">
            <Switch id={`model-${m.id}`} checked={allowed(m.id)} disabled={m.id === "claude-sonnet-5-5"} onCheckedChange={(v) => toggle(m.id, v)} aria-label={m.label} />
            <Label htmlFor={`model-${m.id}`}>{m.label}</Label>
          </div>
        ))}
      </fieldset>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          이노봇은 Claude로 요청을 해석해 Teams·Confluence·SharePoint와 아마란스(앱, 웹은 데스크톱 앱이 켜져 있을 때 조회만) 작업을 합니다. 쓰기는 사용자가 확인 카드에서 &lsquo;실행&rsquo;을 눌러야 합니다. 대화는 사용자 본인만 볼 수 있게 서버에 저장되고 보존 기간이 지나면 지워집니다. 주민번호·카드번호·계좌번호·휴대전화는 Claude에 보내기 전에 가립니다. 감사 로그에는 쓴 도구 이름과 토큰 수만 남깁니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-usage-report.test.ts && npx tsc --noEmit -p . && npx eslint src/app/admin/assistant-usage src/components/settings/AssistantSettings.tsx`
Expected: PASS, 오류 0

- [ ] **Step 5: 커밋** — 메시지 `feat(admin): 이노봇 보존 기간·허용 모델 설정과 사용량 화면(사용자·팀)`.

---
### Task 14: 브라우저 쪽 — SSE 파서·화면 상태(reducer)·날짜 묶기

**Files:**
- Create: `frontend/src/lib/chat/sse-client.ts`, `frontend/src/lib/chat/view.ts`
- Test: `frontend/src/lib/__tests__/chat-view.test.ts`

**Interfaces:**
- Consumes: `events.ts`(`ChatEvent·PendingCall·Location`)
- Produces:
  - `createSseParser(onEvent: (e: ChatEvent) => void): (chunk: string) => void`
  - `postTurn(body: Record<string, unknown>, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void>` — HTTP 오류면 서버 `error` 문구로 throw
  - `type ToolView = { id: string; tool: string; location: Location | null; status: "running" | "ok" | "error" | "timeout" | "cancelled"; summary: string }`
  - `type ViewMessage = { id: string; role: "user" | "assistant"; text: string; attachments: Array<{ id: string; name: string }>; tools: ToolView[]; status: "ok" | "failed" | "stopped" | "streaming"; masked: number }`
  - `type ChatView = { conversationId: string | null; messages: ViewMessage[]; pending: PendingCall[] | null; error: { message: string; retryable: boolean } | null; busy: boolean }`
  - `emptyView(id: string | null): ChatView`, `toViewMessages(rows, toolCalls): ViewMessage[]`, `applyEvent(v, e): ChatView`, `startUserTurn(v, text, attachments): ChatView`, `startContinuation(v): ChatView`, `startRetry(v): ChatView`, `stopView(v): ChatView`
  - `groupByDate<T extends { last_message_at: string }>(items: T[], now: Date): Array<{ label: string; items: T[] }>`
  - `SUGGESTIONS: string[]`, `kstNow(): string`, `DRAFT_KEY = "innobot:draft"`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import { createSseParser } from "@/lib/chat/sse-client";
import { applyEvent, emptyView, groupByDate, startContinuation, startRetry, startUserTurn, stopView, toViewMessages } from "@/lib/chat/view";
import type { ChatEvent } from "@/lib/chat/events";

describe("SSE 파서", () => {
  it("조각난 청크를 이어 붙여 이벤트 단위로 낸다", () => {
    const got: ChatEvent[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed('data: {"type":"text","de'); feed('lta":"가"}\n\ndata: {"type":"done","messageId":"m1"}\n');
    expect(got).toEqual([{ type: "text", delta: "가" }]);
    feed("\n");
    expect(got.at(-1)).toEqual({ type: "done", messageId: "m1" });
  });
});

describe("화면 상태", () => {
  it("보내기 → 텍스트 스트림 → 도구 칩 → 완료", () => {
    let v = startUserTurn(emptyView(null), "메일 요약", [{ id: "a1", name: "x.pdf" }]);
    expect(v.busy).toBe(true);
    for (const e of [{ type: "conversation", id: "c1" }, { type: "masked", count: 1 }, { type: "tool", id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "running" }, { type: "tool", id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "ok", summary: "받은메일 목록 3건" }, { type: "masked", count: 2 }, { type: "text", delta: "세 통" }, { type: "text", delta: "입니다" }, { type: "done", messageId: "m9" }] as ChatEvent[]) v = applyEvent(v, e);
    expect(v.conversationId).toBe("c1");
    const [user, bot] = v.messages;
    expect(user).toMatchObject({ role: "user", text: "메일 요약", masked: 1, attachments: [{ id: "a1", name: "x.pdf" }] });
    expect(bot).toMatchObject({ role: "assistant", text: "세 통입니다", status: "ok", masked: 2, tools: [{ id: "t1", status: "ok", summary: "받은메일 목록 3건" }] });
    expect(v.busy).toBe(false);
  });
  it("needs_action → 대기 카드, 이어 가기는 새 응답 말풍선", () => {
    let v = startUserTurn(emptyView("c1"), "보내", []);
    v = applyEvent(v, { type: "needs_action", messageId: "m2", calls: [{ id: "t1", tool: "teams_send", input: { text: "a" }, location: "server", tier: "write" }] });
    expect(v.pending).toHaveLength(1);
    expect(v.busy).toBe(false);
    v = startContinuation(v);
    expect(v.pending).toBeNull();
    expect(v.messages.at(-1)).toMatchObject({ role: "assistant", status: "streaming", text: "" });
  });
  it("오류 → failed + 다시 시도 가능, 다시 시도는 실패 말풍선을 새로", () => {
    let v = startUserTurn(emptyView("c1"), "질문", []);
    v = applyEvent(v, { type: "error", message: "실패", retryable: true });
    expect(v.messages.at(-1)!.status).toBe("failed");
    expect(v.error).toEqual({ message: "실패", retryable: true });
    v = startRetry(v);
    expect(v.messages.filter((m) => m.status === "failed")).toHaveLength(0);
    expect(v.messages.at(-1)!.status).toBe("streaming");
  });
  it("중지는 stopped", () => {
    let v = startUserTurn(emptyView("c1"), "길게", []);
    v = applyEvent(v, { type: "text", delta: "반" });
    expect(stopView(v).messages.at(-1)).toMatchObject({ status: "stopped", text: "반" });
  });
  it("저장된 기록 → 말풍선: 도구 결과 메시지는 숨기고 도구 왕복은 한 말풍선으로", () => {
    const rows = [
      { id: "m1", role: "user", content: [{ type: "text", text: "메일" }, { type: "attachment", id: "a1", name: "x.pdf" }], status: "ok", masked_count: 1, created_at: "" },
      { id: "m2", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_mail_inbox", input: {} }], status: "ok", masked_count: 0, created_at: "" },
      { id: "m3", role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "받은메일 목록 3건" }], status: "ok", masked_count: 2, created_at: "" },
      { id: "m4", role: "assistant", content: [{ type: "text", text: "세 통입니다" }], status: "ok", masked_count: 0, created_at: "" },
    ];
    const v = toViewMessages(rows as never, [{ message_id: "m2", tool_use_id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "ok", summary: "받은메일 목록 3건" }]);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ text: "메일", masked: 1, attachments: [{ id: "a1", name: "x.pdf" }] });
    expect(v[1]).toMatchObject({ id: "m4", text: "세 통입니다", masked: 2, tools: [{ id: "t1", summary: "받은메일 목록 3건" }] });
  });
});

describe("날짜 묶기", () => {
  it("오늘·어제·지난 7일·이전(KST)", () => {
    const now = new Date("2026-10-15T03:00:00Z"); // KST 12:00
    const g = groupByDate([
      { id: "a", last_message_at: "2026-10-15T00:30:00Z" },
      { id: "b", last_message_at: "2026-10-14T14:00:00Z" }, // KST 10-14 23:00 → 어제
      { id: "c", last_message_at: "2026-10-10T00:00:00Z" },
      { id: "d", last_message_at: "2026-09-01T00:00:00Z" },
    ], now);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([["오늘", ["a"]], ["어제", ["b"]], ["지난 7일", ["c"]], ["이전", ["d"]]]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-view.test.ts`
Expected: FAIL — 모듈 해석 실패

- [ ] **Step 3: 구현**

`sse-client.ts`:

```ts
import type { ChatEvent } from "./events";

/** `data: {...}\n\n` 블록을 이벤트로. 청크 경계가 아무 데서나 잘려도 된다. */
export function createSseParser(onEvent: (e: ChatEvent) => void): (chunk: string) => void {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { onEvent(JSON.parse(data) as ChatEvent); } catch { /* 깨진 블록은 버린다 */ }
    }
  };
}

/** POST /api/chat/turn — 거절(4xx·5xx JSON)은 그 문구로 throw, 성공은 SSE를 끝까지 읽는다. */
export async function postTurn(body: Record<string, unknown>, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "요청이 실패했습니다.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const feed = createSseParser(onEvent);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(value);
  }
}
```

`view.ts`:

```ts
import type { ChatEvent, Location, PendingCall } from "./events";

export type ToolView = { id: string; tool: string; location: Location | null; status: "running" | "ok" | "error" | "timeout" | "cancelled"; summary: string };
export type ViewMessage = { id: string; role: "user" | "assistant"; text: string; attachments: Array<{ id: string; name: string }>; tools: ToolView[]; status: "ok" | "failed" | "stopped" | "streaming"; masked: number };
export type ChatView = { conversationId: string | null; messages: ViewMessage[]; pending: PendingCall[] | null; error: { message: string; retryable: boolean } | null; busy: boolean };
type Block = { type: string; text?: string; id?: string; name?: string };
type Row = { id: string; role: "user" | "assistant"; content: Block[]; status: "ok" | "failed" | "stopped"; masked_count: number };
type ToolCallRow = { message_id: string; tool_use_id: string; tool: string; location: Location; status: ToolView["status"]; summary: string };

export const SUGGESTIONS = ["오늘 일정 정리해 줘", "안 읽은 메일 요약해 줘", "Confluence에서 휴가 규정 찾아 줘", "이번 주 주간보고 초안 써 줘"];
export const DRAFT_KEY = "innobot:draft";
export const kstNow = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
export const emptyView = (id: string | null): ChatView => ({ conversationId: id, messages: [], pending: null, error: null, busy: false });

let seq = 0;
const draft = (): ViewMessage => ({ id: `draft-${++seq}`, role: "assistant", text: "", attachments: [], tools: [], status: "streaming", masked: 0 });
const textOf = (blocks: Block[]) => blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");

/** 저장된 기록 → 말풍선. 도구 결과만 든 user 행은 숨기고(가린 건수는 다음 답에), 도구 왕복으로 이어진 assistant 행은 한 말풍선으로 합친다. */
export function toViewMessages(rows: Row[], toolCalls: ToolCallRow[]): ViewMessage[] {
  const out: ViewMessage[] = [];
  let carryMasked = 0;
  for (const r of rows) {
    const onlyResults = r.role === "user" && r.content.length > 0 && r.content.every((b) => b.type === "tool_result");
    if (onlyResults) { carryMasked += r.masked_count; continue; }
    const tools = toolCalls.filter((t) => t.message_id === r.id).map((t) => ({ id: t.tool_use_id, tool: t.tool, location: t.location, status: t.status, summary: t.summary }));
    const last = out.at(-1);
    if (r.role === "assistant" && last?.role === "assistant") {
      out[out.length - 1] = { ...last, id: r.id, text: last.text + textOf(r.content), tools: [...last.tools, ...tools], status: r.status, masked: last.masked + carryMasked };
    } else {
      out.push({ id: r.id, role: r.role, text: textOf(r.content), attachments: r.content.filter((b) => b.type === "attachment").map((b) => ({ id: b.id!, name: b.name! })), tools, status: r.status, masked: r.role === "user" ? r.masked_count : carryMasked });
    }
    carryMasked = 0;
  }
  return out;
}

const withLast = (v: ChatView, f: (m: ViewMessage) => ViewMessage): ChatView => {
  const i = v.messages.length - 1;
  if (i < 0 || v.messages[i].role !== "assistant") return v;
  const messages = v.messages.slice();
  messages[i] = f(messages[i]);
  return { ...v, messages };
};

export function applyEvent(v: ChatView, e: ChatEvent): ChatView {
  switch (e.type) {
    case "conversation": return { ...v, conversationId: e.id };
    case "text": return withLast(v, (m) => ({ ...m, text: m.text + e.delta }));
    case "tool": return withLast(v, (m) => {
      const t: ToolView = { id: e.id, tool: e.tool, location: e.location, status: e.status, summary: e.summary ?? "" };
      return { ...m, tools: m.tools.some((x) => x.id === e.id) ? m.tools.map((x) => (x.id === e.id ? t : x)) : [...m.tools, t] };
    });
    case "masked": {
      const last = v.messages.at(-1);
      // 답이 아직 비어 있으면 방금 보낸 입력에서 가린 것, 아니면 도구 결과에서 가린 것
      if (last?.role === "assistant" && !last.text && !last.tools.length) {
        const messages = v.messages.slice();
        const ui = messages.length - 2;
        if (ui >= 0 && messages[ui].role === "user") messages[ui] = { ...messages[ui], masked: messages[ui].masked + e.count };
        return { ...v, messages };
      }
      return withLast(v, (m) => ({ ...m, masked: m.masked + e.count }));
    }
    case "needs_action": return { ...withLast(v, (m) => ({ ...m, status: "ok" })), pending: e.calls, busy: false };
    case "done": return { ...withLast(v, (m) => ({ ...m, status: "ok" })), busy: false };
    case "error": return { ...withLast(v, (m) => ({ ...m, status: "failed" })), error: { message: e.message, retryable: e.retryable }, busy: false };
  }
}

export function startUserTurn(v: ChatView, text: string, attachments: Array<{ id: string; name: string }>): ChatView {
  const user: ViewMessage = { id: `local-${++seq}`, role: "user", text, attachments, tools: [], status: "ok", masked: 0 };
  return { ...v, messages: [...v.messages, user, draft()], pending: null, error: null, busy: true };
}
export const startContinuation = (v: ChatView): ChatView => ({ ...v, messages: [...v.messages, draft()], pending: null, error: null, busy: true });
export const startRetry = (v: ChatView): ChatView => ({ ...v, messages: [...v.messages.filter((m) => m.status !== "failed"), draft()], error: null, busy: true });
export const stopView = (v: ChatView): ChatView => ({ ...withLast(v, (m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m)), busy: false });

const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
/** 대화 목록 묶음 — KST 날짜 기준 오늘·어제·지난 7일·이전(빈 묶음은 뺀다). */
export function groupByDate<T extends { last_message_at: string }>(items: T[], now: Date): Array<{ label: string; items: T[] }> {
  const today = Date.parse(kstDate(now));
  const groups: Record<string, T[]> = { "오늘": [], "어제": [], "지난 7일": [], "이전": [] };
  for (const it of items) {
    const days = Math.round((today - Date.parse(kstDate(new Date(it.last_message_at)))) / 86_400_000);
    groups[days <= 0 ? "오늘" : days === 1 ? "어제" : days <= 7 ? "지난 7일" : "이전"].push(it);
  }
  return Object.entries(groups).filter(([, v]) => v.length).map(([label, v]) => ({ label, items: v }));
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/chat-view.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋** — 메시지 `feat(chat): 브라우저 SSE 파서·채팅 화면 상태·대화 날짜 묶기`.

---

### Task 15: 웹 채팅 화면 `/chat`, `/chat/[id]`

**Files:**
- Create: `frontend/src/components/chat/ToolChip.tsx`, `ConfirmCard.tsx`, `MessageView.tsx`, `Composer.tsx`, `StatusStrip.tsx`, `ChatSidebar.tsx`, `ChatWorkspace.tsx`
- Create: `frontend/src/app/chat/page.tsx`, `frontend/src/app/chat/[id]/page.tsx`
- Test: `frontend/src/components/chat/__tests__/chat-ui.test.tsx`

**Interfaces:**
- Consumes: Task 14 전부, Task 5 `toolLabel`, `/api/chat/{config,status,conversations,attachments,turn}`
- Produces: `Composer` props `{ busy: boolean; models: string[]; model: string; onModel(m: string): void; onSend(text: string, attachments: Array<{ id: string; name: string }>): void; onStop?(): void; placeholder?: string }` — Task 16의 홈 입력창이 재사용한다.

- [ ] **Step 1: 실패하는 컴포넌트 테스트**

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ToolChip from "@/components/chat/ToolChip";
import ConfirmCard from "@/components/chat/ConfirmCard";
import MessageView from "@/components/chat/MessageView";
import Composer from "@/components/chat/Composer";

describe("채팅 UI", () => {
  it("도구 칩 — 접힌 한 줄, 누르면 요약", () => {
    render(<ToolChip tool={{ id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "ok", summary: "받은메일 목록 3건: a" }} />);
    const chip = screen.getByRole("button", { name: /받은메일 목록 · 아마란스\(데스크톱 앱\)/ });
    expect(screen.queryByText("받은메일 목록 3건: a")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText("받은메일 목록 3건: a")).toBeTruthy();
  });
  it("확인 카드 — 대상·내용을 보여 주고 실행/취소", () => {
    const onAnswer = vi.fn();
    render(<ConfirmCard calls={[{ id: "t1", tool: "teams_send", input: { chat_id: "19:x", chat_name: "개발팀", text: "안녕하세요" }, location: "server", tier: "write" }]} onAnswer={onAnswer} />);
    expect(screen.getByText("개발팀")).toBeTruthy();
    expect(screen.getByText("안녕하세요")).toBeTruthy();
    expect(screen.queryByText("19:x")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });
  it("메시지 — 가린 건수 배지, 실패면 다시 시도", () => {
    const onRetry = vi.fn();
    render(<MessageView message={{ id: "m1", role: "assistant", text: "**굵게**", attachments: [], tools: [], status: "failed", masked: 2 }} onRetry={onRetry} />);
    expect(screen.getByText("개인정보 2건 가림")).toBeTruthy();
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("입력 — Enter 전송, Shift+Enter·한글 조합 중에는 전송 안 함", () => {
    const onSend = vi.fn();
    render(<Composer busy={false} models={["claude-sonnet-5-5", "claude-opus-5-5"]} model="claude-sonnet-5-5" onModel={() => {}} onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "메시지" });
    fireEvent.change(box, { target: { value: "안녕" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("안녕", []);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/components/chat/__tests__/chat-ui.test.tsx`
Expected: FAIL — 컴포넌트 없음

- [ ] **Step 3: 구현**

`ToolChip.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, XCircle } from "lucide-react";
import { toolLabel } from "@/lib/chat/summary";
import type { ToolView } from "@/lib/chat/view";

const WHERE: Record<string, string> = { server: "서버", "desktop-relay": "아마란스(데스크톱 앱)", device: "앱" };

/** 도구 호출 한 줄 — 무엇을·어디서. 펼치면 요약(결과 원문은 저장하지 않는다). */
export default function ToolChip({ tool }: { tool: ToolView }) {
  const [open, setOpen] = useState(false);
  const Icon = tool.status === "running" ? Loader2 : tool.status === "ok" ? CheckCircle2 : XCircle;
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-muted-foreground hover:text-foreground">
        <Icon className={`h-3.5 w-3.5 ${tool.status === "running" ? "animate-spin" : tool.status === "ok" ? "text-emerald-600" : "text-destructive"}`} />
        <span>{toolLabel(tool.tool)} · {WHERE[tool.location ?? "server"]}</span>
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && tool.summary && <p className="mt-1 ml-3 text-muted-foreground">{tool.summary}</p>}
    </div>
  );
}
```

`ConfirmCard.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toolLabel } from "@/lib/chat/summary";
import type { PendingCall } from "@/lib/chat/events";

const FIELD: Record<string, string> = { chat_name: "채팅방", text: "내용", space_name: "공간", title: "제목", markdown: "본문" };

/** 쓰기 확인 카드 — 실제로 보낼 대상·내용을 보여 주고 사용자가 고른다. id류 값은 숨긴다. */
export default function ConfirmCard({ calls, onAnswer, busy = false }: { calls: PendingCall[]; onAnswer: (approve: boolean) => void; busy?: boolean }) {
  return (
    <Card className="border-primary/40 bg-primary/5 py-3">
      <CardContent className="space-y-3 px-4">
        <p className="text-sm font-medium">이 작업을 실행할까요?</p>
        {calls.map((c) => (
          <div key={c.id} className="space-y-1 rounded-md bg-background p-3 text-sm">
            <p className="font-medium">{toolLabel(c.tool)}</p>
            <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1">
              {Object.entries(c.input).filter(([k, v]) => FIELD[k] && typeof v === "string" && v).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{FIELD[k]}</dt><dd className="whitespace-pre-wrap break-words">{(v as string).slice(0, 2000)}</dd></div>
              ))}
            </dl>
          </div>
        ))}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onAnswer(true)}>실행</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAnswer(false)}>취소</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

`MessageView.tsx`:

```tsx
"use client";

import ReactMarkdown from "react-markdown";
import { Paperclip, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import ToolChip from "./ToolChip";
import type { ViewMessage } from "@/lib/chat/view";

/** 말풍선 하나 — 사용자는 오른쪽 평문, 이노봇은 왼쪽 마크다운 + 도구 칩. */
export default function MessageView({ message: m, onRetry }: { message: ViewMessage; onRetry?: () => void }) {
  const mine = m.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted/60"}`}>
        {m.tools.length > 0 && <div className="flex flex-wrap gap-1.5">{m.tools.map((t) => <ToolChip key={t.id} tool={t} />)}</div>}
        {m.attachments.length > 0 && <div className="flex flex-wrap gap-1.5">{m.attachments.map((a) => <span key={a.id} className="inline-flex items-center gap-1 rounded bg-background/20 px-2 py-0.5 text-xs"><Paperclip className="h-3 w-3" />{a.name}</span>)}</div>}
        {mine ? <p className="whitespace-pre-wrap break-words">{m.text}</p>
          : m.text ? <div className="prose prose-sm max-w-none break-words dark:prose-invert"><ReactMarkdown>{m.text}</ReactMarkdown></div>
          : m.status === "streaming" ? <p className="text-muted-foreground" role="status">생각하는 중…</p> : null}
        {m.masked > 0 && <p className={`inline-flex items-center gap-1 text-xs ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}><ShieldCheck className="h-3.5 w-3.5" />개인정보 {m.masked}건 가림</p>}
        {m.status === "stopped" && <p className="text-xs text-muted-foreground">중지됨</p>}
        {m.status === "failed" && <div className="flex items-center gap-2 text-xs text-destructive">답하지 못했습니다.{onRetry && <Button size="sm" variant="outline" onClick={onRetry}>다시 시도</Button>}</div>}
      </div>
    </div>
  );
}
```

`Composer.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Upload = { key: string; name: string; id?: string; error?: string; warning?: string };
const MAX_FILES = 5;
const MODEL_LABEL: Record<string, string> = { "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5" };

/** 입력창 — Enter 전송(한글 조합 중 제외), Shift+Enter 줄바꿈, 📎·끌어 놓기·붙여 넣기 첨부(바로 올림), 모델 선택, 중지. */
export default function Composer({ busy, models, model, onModel, onSend, onStop, placeholder = "무엇을 도와드릴까요?" }: {
  busy: boolean; models: string[]; model: string; onModel: (m: string) => void; onSend: (text: string, attachments: Array<{ id: string; name: string }>) => void; onStop?: () => void; placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = uploads.some((u) => !u.id && !u.error);
  const ready = uploads.filter((u) => u.id) as Array<Upload & { id: string }>;

  async function add(files: File[]) {
    const room = MAX_FILES - uploads.length;
    for (const f of files.slice(0, Math.max(0, room))) {
      const key = `${f.name}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: f.name }]);
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/chat/attachments", { method: "POST", body: fd }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      setUploads((u) => u.map((x) => (x.key === key ? (res?.ok ? { ...x, id: j.id, warning: j.warning } : { ...x, error: j.error ?? "올리지 못했습니다." }) : x)));
    }
  }
  function send() {
    const t = text.trim();
    if (busy || uploading || (!t && !ready.length)) return;
    onSend(t, ready.map((u) => ({ id: u.id, name: u.name })));
    setText(""); setUploads([]);
  }
  return (
    <div className="rounded-2xl border bg-background p-2 shadow-sm" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add([...e.dataTransfer.files]); }}>
      {uploads.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5 px-1">
          {uploads.map((u) => (
            <li key={u.key} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${u.error ? "border-destructive text-destructive" : ""}`} title={u.error ?? u.warning}>
              {!u.id && !u.error ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}{u.name}{u.error ? ` — ${u.error}` : ""}
              <button type="button" aria-label={`${u.name} 빼기`} onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
      {uploads.some((u) => u.warning) && <p className="mb-1 px-1 text-xs text-amber-600">이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.</p>}
      <Textarea aria-label="메시지" value={text} placeholder={placeholder} rows={2} className="min-h-[3rem] resize-none border-0 shadow-none focus-visible:ring-0"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); void add(files); } }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      <div className="flex items-center gap-2 px-1">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <Button type="button" size="icon" variant="ghost" aria-label="파일 첨부" disabled={uploads.length >= MAX_FILES} onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
        {models.length > 1 && (
          <select aria-label="모델" className="rounded-md border bg-background px-2 py-1 text-xs" value={model} onChange={(e) => onModel(e.target.value)}>
            {models.map((m) => <option key={m} value={m}>{MODEL_LABEL[m] ?? m}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {busy && onStop ? <Button type="button" size="sm" variant="outline" onClick={onStop}><Square className="mr-1 h-3.5 w-3.5" />중지</Button>
          : <Button type="button" size="sm" onClick={send} disabled={uploading || (!text.trim() && !ready.length)}><Send className="mr-1 h-3.5 w-3.5" />보내기</Button>}
      </div>
    </div>
  );
}
```

`StatusStrip.tsx`:

```tsx
"use client";

import Link from "next/link";

export type ChatStatus = { desktop: boolean; microsoft: boolean; atlassian: boolean } | null;
const Dot = ({ on, label }: { on: boolean | null; label: string }) => (
  <span className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${on === null ? "bg-muted-foreground/40 animate-pulse" : on ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />{label}</span>
);

/** 상단 연결 상태 띠 — 데스크톱 앱이 꺼져 있으면 아마란스가 안 된다는 것을 미리 알린다. */
export default function StatusStrip({ status }: { status: ChatStatus }) {
  return (
    <div className="space-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Dot on label="Teams·Confluence·SharePoint" />
        <Dot on={status ? status.desktop : null} label={status ? (status.desktop ? "데스크톱 앱 켜짐" : "데스크톱 앱 꺼짐") : "데스크톱 앱 확인 중"} />
        <Dot on={status ? status.microsoft : null} label="Microsoft" />
        <Dot on={status ? status.atlassian : null} label="Atlassian" />
      </div>
      {status && !status.desktop && <p>아마란스 메일·결재는 데스크톱 앱이 켜져 있어야 합니다. <Link href="/apps" className="text-primary hover:underline">앱 받기</Link></p>}
      {status && (!status.microsoft || !status.atlassian) && <p>연결이 꺼진 서비스는 <Link href="/settings" className="text-primary hover:underline">설정</Link>에서 연결하세요.</p>}
    </div>
  );
}
```

`ChatSidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { groupByDate } from "@/lib/chat/view";

export type ConvSummary = { id: string; title: string; model: string; last_message_at: string };

/** 대화 목록 — 새 대화·저장 안 함, 날짜 묶음, 이름 바꾸기, 삭제(두 번 눌러 확인). */
export default function ChatSidebar({ items, activeId, ephemeral, onEphemeral, canToggleEphemeral, onNew, onRename, onDelete }: {
  items: ConvSummary[]; activeId: string | null; ephemeral: boolean; onEphemeral: (v: boolean) => void; canToggleEphemeral: boolean;
  onNew: () => void; onRename: (id: string, title: string) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Button onClick={onNew} className="w-full justify-start"><Plus className="mr-2 h-4 w-4" />새 대화</Button>
      <div className="flex items-center gap-2 px-1">
        <Checkbox id="ephemeral" checked={ephemeral} disabled={!canToggleEphemeral} onCheckedChange={(v) => onEphemeral(v === true)} />
        <Label htmlFor="ephemeral" className="text-xs text-muted-foreground">저장 안 함(24시간 뒤 삭제)</Label>
      </div>
      <nav aria-label="대화 목록" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {groupByDate(items, new Date()).map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((c) => (
                <li key={c.id} className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${c.id === activeId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                  {editing === c.id ? (
                    <input autoFocus aria-label="대화 이름" defaultValue={c.title} maxLength={80} className="min-w-0 flex-1 rounded border bg-background px-1"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { onRename(c.id, e.currentTarget.value.trim()); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
                      onBlur={() => setEditing(null)} />
                  ) : <Link href={`/chat/${c.id}`} className="min-w-0 flex-1 truncate">{c.title || "새 대화"}</Link>}
                  <button type="button" aria-label="이름 바꾸기" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setEditing(c.id)}><Pencil className="h-3.5 w-3.5" /></button>
                  {confirming === c.id
                    ? <button type="button" className="text-xs text-destructive" onClick={() => { onDelete(c.id); setConfirming(null); }} onBlur={() => setConfirming(null)}>삭제 확인</button>
                    : <button type="button" aria-label="삭제" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setConfirming(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!items.length && <p className="px-2 text-xs text-muted-foreground">저장된 대화가 없습니다.</p>}
      </nav>
    </div>
  );
}
```

`ChatWorkspace.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import ChatSidebar, { type ConvSummary } from "./ChatSidebar";
import Composer from "./Composer";
import ConfirmCard from "./ConfirmCard";
import MessageView from "./MessageView";
import StatusStrip, { type ChatStatus } from "./StatusStrip";
import { postTurn } from "@/lib/chat/sse-client";
import { DRAFT_KEY, SUGGESTIONS, applyEvent, emptyView, kstNow, startContinuation, startRetry, startUserTurn, stopView, toViewMessages, type ChatView } from "@/lib/chat/view";

/** 웹 채팅 워크스페이스(설계서 §3). 새 대화의 주소는 첫 conversation 이벤트에서 history.replaceState로 바꾼다(페이지를 다시 그리지 않아 스트림이 끊기지 않게). */
export default function ChatWorkspace({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const [view, setView] = useState<ChatView>(() => emptyView(conversationId ?? null));
  const [convs, setConvs] = useState<ConvSummary[]>([]);
  const [config, setConfig] = useState<{ enabled: boolean; models: string[]; defaultModel: string } | null>(null);
  const [model, setModel] = useState("claude-sonnet-5-5");
  const [ephemeral, setEphemeral] = useState(false);
  const [status, setStatus] = useState<ChatStatus>(null);
  const [drawer, setDrawer] = useState(false);
  const convRef = useRef<string | null>(conversationId ?? null);
  const desktopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const r = await fetch("/api/chat/conversations").catch(() => null);
    if (r?.ok) setConvs((await r.json()).conversations);
  }, []);

  const run = useCallback(async (body: Record<string, unknown>, prep: (v: ChatView) => ChatView) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setView(prep);
    try {
      await postTurn({ ...body, conversationId: convRef.current ?? undefined, model, client: "web", ephemeral, desktopOnline: desktopRef.current, now: kstNow() }, (e) => {
        if (e.type === "conversation" && convRef.current !== e.id) { convRef.current = e.id; window.history.replaceState(null, "", `/chat/${e.id}`); }
        setView((v) => applyEvent(v, e));
      }, ac.signal);
    } catch (err) {
      setView((v) => (ac.signal.aborted ? stopView(v) : applyEvent(v, { type: "error", message: err instanceof Error ? err.message : "요청이 실패했습니다.", retryable: false })));
    } finally {
      abortRef.current = null;
      setView((v) => ({ ...v, busy: false }));
      void loadList();
    }
  }, [model, ephemeral, loadList]);

  const send = useCallback((text: string, attachments: Array<{ id: string; name: string }>) => {
    void run({ ...(text ? { text } : {}), ...(attachments.length ? { attachmentIds: attachments.map((a) => a.id) } : {}) }, (v) => startUserTurn(v, text, attachments));
  }, [run]);

  useEffect(() => {
    void loadList();
    fetch("/api/chat/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) { setConfig(c); setModel((m) => (c.models.includes(m) ? m : c.defaultModel)); } }).catch(() => {});
    fetch("/api/chat/status").then((r) => (r.ok ? r.json() : null)).then((s) => { if (s) { setStatus(s); desktopRef.current = s.desktop; } }).catch(() => {});
  }, [loadList]);

  useEffect(() => {
    if (!conversationId) {
      // 홈 입력창에서 넘어온 첫 질문
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY); } catch { /* 저장소 막힘 */ }
      if (raw) {
        try {
          const d = JSON.parse(raw) as { text: string; attachments: Array<{ id: string; name: string }>; model?: string };
          if (d.model) setModel(d.model);
          send(d.text, d.attachments ?? []);
        } catch { /* 깨진 초안은 버린다 */ }
      }
      return;
    }
    fetch(`/api/chat/conversations/${conversationId}`).then(async (r) => {
      if (!r.ok) { setView((v) => ({ ...v, error: { message: "대화를 찾지 못했습니다.", retryable: false } })); return; }
      const j = await r.json();
      setModel(j.conversation.model);
      setView({ ...emptyView(conversationId), messages: toViewMessages(j.messages, j.toolCalls) });
    }).catch(() => setView((v) => ({ ...v, error: { message: "대화를 불러오지 못했습니다.", retryable: false } })));
    // conversationId가 바뀔 때만(목록에서 다른 대화를 눌렀을 때) 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [view.messages]);

  const sidebar = (
    <ChatSidebar items={convs} activeId={view.conversationId} ephemeral={ephemeral} onEphemeral={setEphemeral} canToggleEphemeral={!view.conversationId}
      onNew={() => { abortRef.current?.abort(); convRef.current = null; setView(emptyView(null)); setDrawer(false); router.push("/chat"); }}
      onRename={async (id, title) => { if (!title) return; await fetch(`/api/chat/conversations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }); void loadList(); }}
      onDelete={async (id) => { await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" }); if (id === view.conversationId) { convRef.current = null; setView(emptyView(null)); router.push("/chat"); } void loadList(); }} />
  );

  if (config && !config.enabled) return <p className="py-16 text-center text-sm text-muted-foreground">관리자가 이노봇을 꺼 두었습니다.</p>;
  const last = view.messages.at(-1);
  return (
    <div className="-mx-4 flex h-[calc(100dvh-7.5rem)] md:-mx-8 md:h-[calc(100dvh-4rem)]">
      <aside className="hidden w-64 shrink-0 border-r md:block">{sidebar}</aside>
      <Sheet open={drawer} onOpenChange={setDrawer}><SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">대화 목록</SheetTitle>{sidebar}</SheetContent></Sheet>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 md:block">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="대화 목록 열기" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></Button>
          <div className="flex-1"><StatusStrip status={status} /></div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!view.messages.length && !view.error && (
            <div className="mx-auto max-w-xl pt-16 text-center">
              <h1 className="mb-4 text-xl font-bold">무엇을 도와드릴까요?</h1>
              <div className="flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <Button key={s} variant="outline" size="sm" onClick={() => send(s, [])}>{s}</Button>)}</div>
            </div>
          )}
          {view.messages.map((m) => <MessageView key={m.id} message={m} onRetry={m === last && view.error?.retryable ? () => void run({ retry: true }, startRetry) : undefined} />)}
          {view.pending && <ConfirmCard calls={view.pending} busy={view.busy} onAnswer={(approve) => void run({ actions: view.pending!.map((c) => ({ id: c.id, approve })) }, startContinuation)} />}
          {view.error && !view.error.retryable && <p role="alert" className="text-center text-sm text-destructive">{view.error.message}</p>}
          <div ref={endRef} />
        </div>
        <div className="border-t p-3">
          <Composer busy={view.busy} models={config?.models ?? [model]} model={model} onModel={setModel} onSend={send} onStop={() => abortRef.current?.abort()} />
        </div>
      </section>
    </div>
  );
}
```

`app/chat/page.tsx`:

```tsx
import ChatWorkspace from "@/components/chat/ChatWorkspace";
export default function ChatPage() { return <ChatWorkspace />; }
```

`app/chat/[id]/page.tsx`:

```tsx
import ChatWorkspace from "@/components/chat/ChatWorkspace";
export default async function ChatConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatWorkspace key={id} conversationId={id} />;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/components/chat/__tests__/chat-ui.test.tsx && npx tsc --noEmit -p . && npx eslint src/components/chat src/app/chat`
Expected: PASS, 오류 0. `@testing-library/react`가 설치돼 있지 않으면(`package.json` 확인) 기존 `.test.tsx`(예: `user-page-access-hook.test.tsx`)가 쓰는 렌더 방식을 따르고 Ruling을 남긴다. `prose` 클래스가 Tailwind typography 없이 무시되면 그대로 둔다(마크다운 기본 태그는 렌더된다).

- [ ] **Step 5: 수동 확인(개발 서버)**

Run: `./frontend/scripts/restart-frontend.sh` 뒤 ego-browser로 `http://localhost:3003/chat`을 연다(로그인 세션 필요 — 없으면 이 단계는 Task 18의 운영 확인으로 미루고 ledger에 남긴다). 확인: 추천 칩 → 답 스트리밍 → 주소가 `/chat/<id>`로 바뀜 → 왼쪽 목록 "오늘"에 보임 → 이름 바꾸기 → 삭제.

- [ ] **Step 6: 커밋** — 메시지 `feat(chat): 웹 채팅 화면 — 대화 목록·스트리밍·도구 칩·확인 카드·첨부·연결 상태 띠`.

---

### Task 16: 홈 재배치·메뉴의 이노봇

**Files:**
- Create: `frontend/src/components/home/HomeChatBox.tsx`, `frontend/src/components/home/RecentConversations.tsx`
- Modify: `frontend/src/app/page.tsx`(FEATURES 순서·렌더 전체)
- Modify: `frontend/src/components/layout/Navigation.tsx`(상단 바·하단 탭에 이노봇)
- Modify: `frontend/src/lib/page-access.ts:16-17`(사용량 이름)
- Test: `frontend/src/components/home/__tests__/home-chat.test.tsx`

**Interfaces:**
- Consumes: Task 15 `Composer`, Task 14 `DRAFT_KEY·SUGGESTIONS`
- Produces: 홈에서 보낸 질문은 `sessionStorage[DRAFT_KEY] = JSON.stringify({ text, attachments, model })` 뒤 `/chat`으로 이동(Task 15가 읽어 보낸다). URL에 질문을 싣지 않는다.

- [ ] **Step 1: 실패하는 테스트**

```tsx
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import HomeChatBox from "@/components/home/HomeChatBox";
beforeEach(() => { push.mockReset(); sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: true, models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" })))); });

it("홈에서 보내면 초안을 세션 저장소에 두고 /chat으로 — 주소에 질문이 없다", async () => {
  render(<HomeChatBox />);
  fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "오늘 일정" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "메시지" }), { key: "Enter" });
  expect(push).toHaveBeenCalledWith("/chat");
  expect(JSON.parse(sessionStorage.getItem("innobot:draft")!)).toMatchObject({ text: "오늘 일정", attachments: [] });
});
it("추천 질문 칩도 같은 길로", () => {
  render(<HomeChatBox />);
  fireEvent.click(screen.getByRole("button", { name: "오늘 일정 정리해 줘" }));
  expect(push).toHaveBeenCalledWith("/chat");
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/components/home/__tests__/home-chat.test.tsx`
Expected: FAIL — 컴포넌트 없음

- [ ] **Step 3: 구현**

`HomeChatBox.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Composer from "@/components/chat/Composer";
import { DRAFT_KEY, SUGGESTIONS } from "@/lib/chat/view";

/** 홈 맨 위 채팅 입력창 — 보내면 /chat이 이어받아 새 대화를 만든다(질문은 sessionStorage로 넘기고 URL에 싣지 않는다). */
export default function HomeChatBox() {
  const router = useRouter();
  const [models, setModels] = useState<string[]>(["claude-sonnet-5-5"]);
  const [model, setModel] = useState("claude-sonnet-5-5");
  useEffect(() => {
    fetch("/api/chat/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c?.models) { setModels(c.models); setModel(c.defaultModel); } }).catch(() => {});
  }, []);
  const go = (text: string, attachments: Array<{ id: string; name: string }>) => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text, attachments, model })); } catch { /* 저장소 막힘 — 빈 채팅으로 간다 */ }
    router.push("/chat");
  };
  return (
    <section aria-label="이노봇에게 묻기" className="mb-6 space-y-3">
      <Composer busy={false} models={models} model={model} onModel={setModel} onSend={go} />
      <div className="flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <Button key={s} variant="outline" size="sm" onClick={() => go(s, [])}>{s}</Button>)}</div>
    </section>
  );
}
```

`RecentConversations.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

/** 최근 대화 3개 — 없으면 아무것도 그리지 않는다. */
export default function RecentConversations() {
  const [items, setItems] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    fetch("/api/chat/conversations?limit=3").then((r) => (r.ok ? r.json() : null)).then((j) => j && setItems(j.conversations)).catch(() => {});
  }, []);
  if (!items.length) return null;
  return (
    <div className="mb-6">
      <p className="mb-2 text-sm font-medium text-muted-foreground">최근 대화</p>
      <ul className="flex flex-wrap gap-2">
        {items.map((c) => <li key={c.id}><Link href={`/chat/${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-muted"><MessageSquare className="h-3.5 w-3.5" />{c.title || "새 대화"}</Link></li>)}
      </ul>
    </div>
  );
}
```

`app/page.tsx` 변경:
1. import에 `HomeChatBox`·`RecentConversations`를 더한다.
2. `FEATURES` 배열 순서를 업무 → AI → 일상 → 관리로 바꾼다: `/teams/chat`, `/confluence`, `/sharepoint`, `/rfp`, `/ppt`, `/people-news`, `/marketing`, `/usage/code`, `/usage/chat`, `/usage/perf`, `/food`, `/ladder`, `/team`, `/survey`, `/apps`, `/admin`(각 항목 객체 내용은 그대로 옮긴다).
3. `HomePage`의 return을 아래로 바꾼다. 큰 제목 블록("이노크루를 위한 서비스")은 지운다 — 설계서 §4 "홈을 채팅 중심으로 재배치"에 따라 첫 화면의 주인공을 채팅 입력창으로 한다.

```tsx
  const canChat = canAccessPage("/chat");
  return (
    <div className="py-6 md:py-10">
      <DesktopAppCard />
      <DailyGreeting />
      {canChat && <><HomeChatBox /><RecentConversations /></>}
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:mb-0">
        <TeamsReplyCard />
        <JiraWorkCard />
        <ConfluenceMentionsCard />
        <SharepointDocsCard />
      </div>
      <p className="my-6 text-sm text-muted-foreground">사용법이 궁금하면 <Link href="/manual" className="text-primary hover:underline">사용자 매뉴얼</Link>에서 찾아보세요.</p>

      {loading && <p role="status" className="text-center text-sm text-muted-foreground">접근 권한을 확인하고 있습니다.</p>}
      {error && <p role="alert" className="text-center text-sm text-destructive">접근 권한을 확인하지 못했습니다. 페이지를 새로고침해 주세요.</p>}
      {!loading && !error && !visibleFeatures.length && <p className="text-center text-sm text-muted-foreground">표시할 서비스가 없습니다. 접근 권한은 관리자에게 문의해 주세요.</p>}
      {visibleFeatures.length > 0 && <h2 className="mb-3 text-sm font-medium text-muted-foreground">바로가기</h2>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,150px),1fr))] gap-2">
        {visibleFeatures.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link key={feature.href} href={feature.href} title={feature.description} className="group flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-sm font-medium hover:border-primary/40 hover:bg-primary/5">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${feature.bgAccent}`}><Icon className={`h-4 w-4 ${feature.iconColor}`} /></span>
              <span className="truncate">{feature.title}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
```

사용하지 않게 된 import(`Card`·`CardHeader`·`CardTitle`·`CardDescription`·`ArrowRight`)를 지운다.

`page-access.ts`: `usage_code` label을 `"Claude Code 사용량"`, `usage_chat` label을 `"Claude 채팅 사용량"`으로 바꾼다.

`Navigation.tsx`:
- 데스크톱 메뉴 `{groups.map((group) => groupMenu(group))}` 바로 앞에 넣는다.

```tsx
              {canAccessPage("/chat") && <Link href="/chat" className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium", matchesPath(pathname, "/chat") ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}><Bot className="h-4 w-4" />이노봇</Link>}
```

- 하단 탭 `{groups.map((group) => groupMenu(group, true))}` 바로 앞에 넣는다.

```tsx
          {canAccessPage("/chat") && <Link href="/chat" aria-current={matchesPath(pathname, "/chat") ? "page" : undefined} className={cn("flex flex-1 flex-col items-center justify-center gap-1 px-2 text-[11px] font-medium", matchesPath(pathname, "/chat") ? "text-primary" : "text-muted-foreground")}><Bot className="h-5 w-5" /><span>이노봇</span></Link>}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/components/home/__tests__/home-chat.test.tsx && npm test 2>&1 | tail -15 && npx tsc --noEmit -p . && npx eslint src/app/page.tsx src/components/home src/components/layout/Navigation.tsx`
Expected: 새 테스트 PASS, 전체 vitest 스위트 PASS(사용량 이름을 문자열로 고정한 기존 테스트가 깨지면 새 이름으로 고친다), 타입·린트 오류 0

- [ ] **Step 5: 커밋** — 메시지 `feat(home): 채팅 중심 홈(입력창·추천·최근 대화·바로가기 격자)과 메뉴의 이노봇`.

---

### Task 17: 문서·E2E

**Files:**
- Modify: `frontend/src/lib/manual/sections.ts`(`gw-mail` 절 앞에 새 절)
- Modify: `CLAUDE.md`(페이지·API·테이블)
- Modify: `docs/mobile-app.md`(§비서 끝에 한 문단)
- Create: `frontend/e2e/chat.spec.ts`

- [ ] **Step 1: E2E 작성**

```ts
/**
 * 이노봇 웹 채팅 — 1) 세션 없이 API 게이트(401). 2) 화면 흐름은 E2E_ADMIN_STORAGE_STATE가 있을 때만, /api/chat/*를 page.route로 가짜 응답(Claude·DB를 쓰지 않음).
 */
import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE, hasAdminSession } from "./helpers/auth";

test.describe("이노봇 API 게이트", () => {
  test("세션 없이 턴·목록·첨부·상태 → 401", async ({ request }) => {
    expect((await request.post("/api/chat/turn", { data: { text: "a" } })).status()).toBe(401);
    expect((await request.get("/api/chat/conversations")).status()).toBe(401);
    expect((await request.post("/api/chat/attachments", { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") } } })).status()).toBe(401);
    expect((await request.get("/api/chat/status")).status()).toBe(401);
  });
});

test.describe("이노봇 화면 (admin storageState 필요)", () => {
  test.skip(!hasAdminSession, "E2E_ADMIN_STORAGE_STATE 미설정");
  test.use({ storageState: hasAdminSession ? ADMIN_STORAGE_STATE : undefined });
  test("새 대화 → 답변 → 목록에 보임 → 삭제", async ({ page }) => {
    let list: Array<{ id: string; title: string; model: string; last_message_at: string }> = [];
    const id = "11111111-1111-1111-1111-111111111111";
    await page.route("**/api/chat/config", (r) => r.fulfill({ json: { enabled: true, models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" } }));
    await page.route("**/api/chat/status", (r) => r.fulfill({ json: { desktop: false, microsoft: true, atlassian: true } }));
    await page.route("**/api/chat/conversations?*", (r) => r.fulfill({ json: { conversations: list } }));
    await page.route("**/api/chat/conversations", (r) => r.fulfill({ json: { conversations: list } }));
    await page.route(`**/api/chat/conversations/${id}`, (r) => { if (r.request().method() === "DELETE") { list = []; return r.fulfill({ json: { ok: true } }); } return r.fulfill({ json: { conversation: { id, model: "claude-sonnet-5-5" }, messages: [], toolCalls: [] } }); });
    await page.route("**/api/chat/turn", (r) => {
      list = [{ id, title: "안녕", model: "claude-sonnet-5-5", last_message_at: new Date().toISOString() }];
      const ev = [{ type: "conversation", id }, { type: "text", delta: "안녕하세요, 이노봇입니다." }, { type: "done", messageId: "m1" }];
      return r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") });
    });
    await page.goto("/chat");
    await expect(page.getByText("데스크톱 앱 꺼짐")).toBeVisible();
    await page.getByRole("textbox", { name: "메시지" }).fill("안녕");
    await page.keyboard.press("Enter");
    await expect(page.getByText("안녕하세요, 이노봇입니다.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/chat/${id}$`));
    const item = page.getByRole("navigation", { name: "대화 목록" }).getByRole("link", { name: "안녕" });
    await expect(item).toBeVisible();
    await item.hover();
    await page.getByRole("button", { name: "삭제" }).first().click();
    await page.getByRole("button", { name: "삭제 확인" }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByText("저장된 대화가 없습니다.")).toBeVisible();
  });
});
```

- [ ] **Step 2: E2E 실행**

Run: `cd frontend && npx playwright test e2e/chat.spec.ts`
Expected: 게이트 테스트 PASS, 화면 테스트는 storageState가 없으면 SKIP(있으면 PASS)

- [ ] **Step 3: 문서**

`sections.ts` — `gw-mail` 절 바로 앞에 추가:

```ts
  {
    id: "innobot", title: "이노봇 — 사내 AI 채팅", category: "AI",
    description: "이노봇에게 일을 맡기는 채팅입니다. Teams·Confluence·SharePoint를 찾고 읽고 쓰며, 데스크톱 앱이 켜져 있으면 아마란스 메일·결재·일정도 조회합니다. 대화는 본인만 볼 수 있게 저장됩니다.",
    steps: [
      "홈 맨 위 입력창이나 메뉴의 ‘이노봇’(주소 /chat)에서 질문합니다. Enter로 보내고 Shift+Enter로 줄을 바꿉니다. 답이 오는 중에는 ‘중지’로 멈출 수 있습니다.",
      "📎로 파일을 붙이거나 끌어다 놓습니다(한 번에 5개, 파일당 10MB — docx·pdf·pptx·xlsx·hwp·txt·이미지). 문서는 글자를 뽑아 보내고, 이미지·스캔 문서는 원본을 보냅니다.",
      "도구를 쓰면 답 위에 ‘받은메일 목록 · 아마란스(데스크톱 앱)’ 같은 칩이 생깁니다. 누르면 무엇을 찾았는지 한 줄 요약이 보입니다.",
      "Teams 보내기·Confluence 페이지 만들기 같은 쓰기는 확인 카드가 뜹니다. 내용을 확인하고 ‘실행’을 눌러야 실행됩니다.",
      "아마란스는 웹에서 조회만 됩니다. 회의실 예약·일정 등록·메일 발송·결재는 모바일·데스크톱 앱의 이노봇을 쓰세요. 화면 위 띠에 ‘데스크톱 앱 꺼짐’이 보이면 앱을 켠 뒤 새로고침합니다.",
      "왼쪽 목록에서 지난 대화를 다시 열고 이어서 묻습니다. 연필로 이름을 바꾸고, 휴지통을 두 번 눌러 바로 지웁니다. 새 대화에서 ‘저장 안 함’을 켜면 24시간 뒤 자동으로 지워집니다.",
      "모델은 기본 Sonnet 5.5이고 입력창에서 Opus 5.5를 고를 수 있습니다(관리자가 허용한 경우).",
    ],
    note: "주민번호·카드번호·계좌번호·휴대전화는 Claude에 보내기 전에 가리고 ‘개인정보 N건 가림’으로 표시합니다(사내 조직도 결과의 전화번호는 그대로). 대화는 관리자 설정 기간(기본 90일)이 지나면 지워지며, 관리자도 대화 내용은 볼 수 없습니다. 하루에 쓸 수 있는 횟수에 상한이 있습니다.",
    links: [{ href: "/chat", label: "이노봇 열기" }, { href: "/apps", label: "데스크톱 앱 받기" }],
  },
```

`CLAUDE.md`:
- `### App Router Pages`에 `/manual` 줄 다음에 추가: ``- `/chat`, `/chat/[id]` — 이노봇 웹 채팅(페이지 키 `assistant`, 메뉴 AI 맨 앞·상단 바 버튼): 서버 저장 대화·SSE 스트리밍·도구 칩·쓰기 확인 카드·첨부(5개·10MB)·연결 상태 띠. 웹의 아마란스는 데스크톱 앱 중계 읽기만. 설계 `docs/superpowers/specs/2026-10-15-llm-portal-phase1-design.md` ``
- `### API Routes`에 `/api/assistant/turn` 줄 앞에 추가: ``- `POST /api/chat/turn`(SSE), `GET /api/chat/{config,status,conversations}`, `GET·PATCH·DELETE /api/chat/conversations/[id]`, `POST /api/chat/attachments`, 크론 `/api/cron/chat-purge`, 관리자 `GET /api/admin/assistant-usage` — 이노봇 대화 플랫폼(`lib/chat/*`: 엔진·마스킹·도구 위치·저장소). 거버넌스는 턴 API 한 곳: 권한 → 허용 모델(settings `assistant_models`) → 하루 상한(`assistant_usage`) → 마스킹 → 도구 목록. 보존 settings `assistant_retention_days`(기본 90) ``
- `### Supabase Tables (mcp)` 다음에 절 추가: ``### Supabase Tables (chat)`` / ``- `chat_conversations`·`chat_messages`·`chat_tool_calls`(결과 원문 없이 요약만)·`chat_attachments`(버킷 `chat`)·`assistant_usage`(사용자×KST 날짜, RPC `chat_usage_add`) — RLS 본인만, SQL `docs/sql/2026-10-15-chat-portal.sql` ``

`docs/mobile-app.md` §비서 끝에 한 문단: "2026-10-15부터 웹 채팅(`/chat`)이 서버 저장 대화 API(`/api/chat/turn`)를 쓴다. 하루 상한은 웹·앱 모두 `assistant_usage.turns`로 센다(기존 `action_history` '비서 턴' 건수 대신). 앱 이노봇의 새 API 이전은 별도 계획에서 한다 — 그때까지 `/api/assistant/turn`·`/execute`를 유지한다."

- [ ] **Step 4: 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__ 2>&1 | tail -5 && npx tsc --noEmit -p .`
Expected: PASS(매뉴얼 테스트가 있으면 새 절의 `category: "AI"`가 허용 값인지 함께 확인된다)

- [ ] **Step 5: 커밋** — 메시지 `docs(chat): 매뉴얼 이노봇 절·CLAUDE.md·런북, E2E(게이트·화면 흐름)`.

---

### Task 18: 운영 반영·확인

**Files:** 없음(배포·검증)

- [ ] **Step 1: 전체 검증**

Run: `cd frontend && npm test 2>&1 | tail -8 && npx tsc --noEmit -p . && npx eslint src --quiet && npm run build 2>&1 | tail -15`
Expected: 테스트 전부 PASS, 타입·린트 오류 0, 빌드 성공(`/chat`, `/chat/[id]`, `/admin/assistant-usage` 경로 표시)

- [ ] **Step 2: 푸시**

```bash
git fetch && git status -sb   # main...origin/main 뒤처짐 없음 확인, 있으면 git pull --rebase
git push origin main
```

- [ ] **Step 3: 배포**

Run: `cd frontend && vercel --prod --yes`
Expected: 배포 URL이 `innogrid-playground-…`로 시작. 이어서 `vercel inspect https://innocrew.innogrid.com`으로 alias가 방금 배포를 가리키는지 확인.

- [ ] **Step 4: 운영 확인(ego-browser, 로그인된 세션)**

`https://innocrew.innogrid.com/chat`에서:
1. "안녕"을 보내 답이 스트리밍되고 주소가 `/chat/<id>`로 바뀌는지.
2. "내 번호 010-0000-0000 기억해"를 보내 내 말풍선에 "개인정보 1건 가림"이 보이는지.
3. "Confluence에서 휴가 규정 찾아 줘"로 도구 칩이 생기는지.
4. 데스크톱 앱을 켠 상태에서 "안 읽은 메일 몇 통이야"로 `아마란스(데스크톱 앱)` 칩이 생기는지(앱이 꺼져 있으면 띠 안내와 답의 안내를 확인).
5. 새로고침 후 같은 대화가 목록·본문으로 복원되는지, 삭제가 되는지.
6. `/admin/assistant-usage`에 방금 사용량이 보이는지.
7. 홈(`/`)의 입력창에서 보낸 질문이 `/chat`에서 바로 이어지는지.

확인 쿼리(본문을 읽지 않는다):

```sql
select count(*) from public.chat_conversations;
select day, turns, model_turns from public.assistant_usage order by day desc limit 3;
```

- [ ] **Step 5: 보고** — 배포 URL·alias·확인 결과·남은 일(앱 이노봇 이전 계획)을 보고하고 `TZ=Asia/Seoul date`로 현재 시각을 붙인다.
