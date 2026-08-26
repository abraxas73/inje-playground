-- Claude 사용량 대시보드 (OTel + CSV) — 2026-08-26
-- Supabase SQL Editor에서 그대로 실행. 멱등(if not exists / or replace).

create table if not exists public.claude_orgs (
  id text primary key,                      -- Anthropic organization UUID
  name text not null,
  seats_total int,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.claude_code_daily (
  day date not null,
  org_id text not null references public.claude_orgs(id),
  user_email text not null,
  account_uuid text,
  sessions numeric not null default 0,
  prompts numeric not null default 0,
  cost_usd numeric not null default 0,
  input_tokens numeric not null default 0,
  output_tokens numeric not null default 0,
  cache_read_tokens numeric not null default 0,
  cache_creation_tokens numeric not null default 0,
  loc_added numeric not null default 0,
  loc_removed numeric not null default 0,
  edits_accepted numeric not null default 0,
  edits_rejected numeric not null default 0,
  commits numeric not null default 0,
  pull_requests numeric not null default 0,
  active_user_seconds numeric not null default 0,
  active_cli_seconds numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, org_id, user_email)
);
create index if not exists claude_code_daily_email_idx on public.claude_code_daily (user_email, day);

create table if not exists public.claude_code_daily_model (
  day date not null,
  org_id text not null,
  user_email text not null,
  model text not null,
  cost_usd numeric not null default 0,
  input_tokens numeric not null default 0,
  output_tokens numeric not null default 0,
  cache_read_tokens numeric not null default 0,
  cache_creation_tokens numeric not null default 0,
  primary key (day, org_id, user_email, model)
);

create table if not exists public.claude_code_requests (
  id bigint generated always as identity primary key,
  ts timestamptz not null,
  org_id text not null,
  user_email text not null,
  account_uuid text,
  session_id text,
  model text,
  cost_usd numeric not null default 0,
  input_tokens numeric not null default 0,
  output_tokens numeric not null default 0,
  cache_read_tokens numeric not null default 0,
  cache_creation_tokens numeric not null default 0,
  duration_ms numeric,
  query_source text,
  request_id text
);
create index if not exists claude_code_requests_ts_idx on public.claude_code_requests (ts);
create index if not exists claude_code_requests_email_idx on public.claude_code_requests (user_email, ts);

create table if not exists public.claude_ingest_log (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  signal text not null,                     -- 'metrics' | 'logs'
  org_ids text[] not null default '{}',
  rows int not null default 0,
  dropped int not null default 0,
  bytes int not null default 0,
  ok boolean not null default true,
  error text
);
create index if not exists claude_ingest_log_received_idx on public.claude_ingest_log (received_at desc);

create table if not exists public.claude_csv_imports (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.claude_orgs(id),
  period_start date not null,
  period_end date not null,
  filename text,
  uploaded_by uuid,
  row_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, period_start, period_end)
);

create table if not exists public.claude_member_activity (
  import_id uuid not null references public.claude_csv_imports(id) on delete cascade,
  org_id text not null,
  period_start date not null,
  period_end date not null,
  name text,
  email text not null,
  role text,
  seat_tier text,
  last_active date,
  days_active int not null default 0,
  chats int not null default 0,
  messages int not null default 0,
  projects_created int not null default 0,
  projects_used int not null default 0,
  pull_requests int not null default 0,
  code_sessions int not null default 0,
  file_edits int not null default 0,
  cowork_sessions int not null default 0,
  cowork_messages int not null default 0,
  artifacts_created int not null default 0,
  claude_code_artifacts int not null default 0,
  cowork_artifacts int not null default 0,
  estimated_spend_usd numeric not null default 0,
  primary key (import_id, email)
);
create index if not exists claude_member_activity_email_idx on public.claude_member_activity (email);

-- delta 합산 RPC: 같은 호출 안에 (day,org,email[,model]) 중복 키가 없어야 한다(파서가 사전 집계).
create or replace function public.claude_code_ingest(p_daily jsonb, p_model jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into claude_orgs (id, name)
  select distinct x->>'org_id', left(x->>'org_id', 8)
  from jsonb_array_elements(coalesce(p_daily, '[]'::jsonb)) x
  where coalesce(x->>'org_id', '') <> ''
  on conflict (id) do nothing;

  insert into claude_code_daily (day, org_id, user_email, account_uuid,
    sessions, prompts, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    loc_added, loc_removed, edits_accepted, edits_rejected, commits, pull_requests,
    active_user_seconds, active_cli_seconds)
  select (x->>'day')::date, x->>'org_id', x->>'user_email', nullif(x->>'account_uuid', ''),
    coalesce((x->>'sessions')::numeric, 0), coalesce((x->>'prompts')::numeric, 0),
    coalesce((x->>'cost_usd')::numeric, 0), coalesce((x->>'input_tokens')::numeric, 0),
    coalesce((x->>'output_tokens')::numeric, 0), coalesce((x->>'cache_read_tokens')::numeric, 0),
    coalesce((x->>'cache_creation_tokens')::numeric, 0), coalesce((x->>'loc_added')::numeric, 0),
    coalesce((x->>'loc_removed')::numeric, 0), coalesce((x->>'edits_accepted')::numeric, 0),
    coalesce((x->>'edits_rejected')::numeric, 0), coalesce((x->>'commits')::numeric, 0),
    coalesce((x->>'pull_requests')::numeric, 0), coalesce((x->>'active_user_seconds')::numeric, 0),
    coalesce((x->>'active_cli_seconds')::numeric, 0)
  from jsonb_array_elements(coalesce(p_daily, '[]'::jsonb)) x
  on conflict (day, org_id, user_email) do update set
    account_uuid = coalesce(excluded.account_uuid, claude_code_daily.account_uuid),
    sessions = claude_code_daily.sessions + excluded.sessions,
    prompts = claude_code_daily.prompts + excluded.prompts,
    cost_usd = claude_code_daily.cost_usd + excluded.cost_usd,
    input_tokens = claude_code_daily.input_tokens + excluded.input_tokens,
    output_tokens = claude_code_daily.output_tokens + excluded.output_tokens,
    cache_read_tokens = claude_code_daily.cache_read_tokens + excluded.cache_read_tokens,
    cache_creation_tokens = claude_code_daily.cache_creation_tokens + excluded.cache_creation_tokens,
    loc_added = claude_code_daily.loc_added + excluded.loc_added,
    loc_removed = claude_code_daily.loc_removed + excluded.loc_removed,
    edits_accepted = claude_code_daily.edits_accepted + excluded.edits_accepted,
    edits_rejected = claude_code_daily.edits_rejected + excluded.edits_rejected,
    commits = claude_code_daily.commits + excluded.commits,
    pull_requests = claude_code_daily.pull_requests + excluded.pull_requests,
    active_user_seconds = claude_code_daily.active_user_seconds + excluded.active_user_seconds,
    active_cli_seconds = claude_code_daily.active_cli_seconds + excluded.active_cli_seconds,
    updated_at = now();

  insert into claude_code_daily_model (day, org_id, user_email, model,
    cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
  select (x->>'day')::date, x->>'org_id', x->>'user_email', x->>'model',
    coalesce((x->>'cost_usd')::numeric, 0), coalesce((x->>'input_tokens')::numeric, 0),
    coalesce((x->>'output_tokens')::numeric, 0), coalesce((x->>'cache_read_tokens')::numeric, 0),
    coalesce((x->>'cache_creation_tokens')::numeric, 0)
  from jsonb_array_elements(coalesce(p_model, '[]'::jsonb)) x
  on conflict (day, org_id, user_email, model) do update set
    cost_usd = claude_code_daily_model.cost_usd + excluded.cost_usd,
    input_tokens = claude_code_daily_model.input_tokens + excluded.input_tokens,
    output_tokens = claude_code_daily_model.output_tokens + excluded.output_tokens,
    cache_read_tokens = claude_code_daily_model.cache_read_tokens + excluded.cache_read_tokens,
    cache_creation_tokens = claude_code_daily_model.cache_creation_tokens + excluded.cache_creation_tokens;
end;
$$;
revoke execute on function public.claude_code_ingest(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claude_code_ingest(jsonb, jsonb) to service_role;

-- RLS: 읽기는 admin만, 쓰기 정책 없음(service role만 쓴다)
do $$
declare t text;
begin
  foreach t in array array['claude_orgs','claude_code_daily','claude_code_daily_model','claude_code_requests','claude_ingest_log','claude_csv_imports','claude_member_activity']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))',
      t || '_admin_read', t);
  end loop;
end $$;
