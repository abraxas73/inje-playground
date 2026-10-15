-- 2026-10-15: 사내 LLM 포털 1단계 — 서버 대화 저장(chat_*), 사용량(assistant_usage), 첨부 버킷 chat, 페이지 키 assistant.
-- 브라우저(authenticated)는 읽기만 — 쓰기는 서버(service_role)만.
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
create policy chat_conversations_own on public.chat_conversations for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists chat_messages_own on public.chat_messages;
create policy chat_messages_own on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));
drop policy if exists chat_tool_calls_own on public.chat_tool_calls;
create policy chat_tool_calls_own on public.chat_tool_calls for select to authenticated
  using (exists (select 1 from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id where m.id = message_id and c.user_id = (select auth.uid())));
drop policy if exists chat_attachments_own on public.chat_attachments;
create policy chat_attachments_own on public.chat_attachments for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists assistant_usage_own on public.assistant_usage;
create policy assistant_usage_own on public.assistant_usage for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.chat_conversations, public.chat_messages, public.chat_tool_calls, public.chat_attachments, public.assistant_usage from anon, authenticated;
grant select on public.chat_conversations, public.chat_messages, public.chat_tool_calls, public.chat_attachments, public.assistant_usage to authenticated;
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
