-- INNOCREW 운영 DB(public 스키마) 구조 스냅샷 — 데이터 없음. 참고용이며 그대로 복원 스크립트로 쓰지 않는다.
-- 다시 만들기: python3 scripts/db-schema-snapshot.py (Management API 읽기 전용 카탈로그 조회). 변경 이력의 원본은 docs/sql/*.sql.

create table public.action_history (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  user_email text,
  action text not null,
  category text not null,
  detail jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now() not null,
  ip_address text,
  user_agent text,
  source text default 'app'::text not null,
  constraint action_history_pkey PRIMARY KEY (id)
);
alter table public.action_history enable row level security;
CREATE INDEX action_history_category_idx ON public.action_history USING btree (category);
CREATE INDEX action_history_created_at_idx ON public.action_history USING btree (created_at DESC);
CREATE INDEX action_history_user_email_idx ON public.action_history USING btree (user_email);
CREATE INDEX idx_action_history_category ON public.action_history USING btree (category);
CREATE INDEX idx_action_history_created_at ON public.action_history USING btree (created_at DESC);
CREATE INDEX idx_action_history_user_id ON public.action_history USING btree (user_id);
create policy "action_history_delete" on public.action_history as permissive for delete to authenticated using (private.is_admin());
create policy "action_history_insert" on public.action_history as permissive for insert to authenticated with check ((user_id = auth.uid()));
create policy "action_history_select" on public.action_history as permissive for select to authenticated using (((user_id = auth.uid()) OR private.is_admin()));

create table public.assistant_usage (
  user_id uuid not null,
  day date not null,
  turns integer default 0 not null,
  input_tokens bigint default 0 not null,
  output_tokens bigint default 0 not null,
  model_turns jsonb default '{}'::jsonb not null,
  masked integer default 0 not null,
  constraint assistant_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint assistant_usage_pkey PRIMARY KEY (user_id, day)
);
alter table public.assistant_usage enable row level security;
create policy "assistant_usage_own" on public.assistant_usage as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

create table public.atlassian_account_map (
  account_id text not null,
  email text not null,
  updated_at timestamp with time zone default now() not null,
  constraint atlassian_account_map_pkey PRIMARY KEY (account_id)
);
alter table public.atlassian_account_map enable row level security;
create policy "atlassian_account_map_admin_read" on public.atlassian_account_map as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.chat_attachments (
  id uuid not null,
  user_id uuid not null,
  conversation_id uuid,
  name text not null,
  mime text not null,
  size integer not null,
  kind text not null,
  storage_path text not null,
  text_excerpt text default ''::text not null,
  masked_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint chat_attachments_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'image'::text, 'pdf'::text]))),
  constraint chat_attachments_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE SET NULL,
  constraint chat_attachments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint chat_attachments_pkey PRIMARY KEY (id)
);
alter table public.chat_attachments enable row level security;
CREATE INDEX chat_attachments_conv_idx ON public.chat_attachments USING btree (conversation_id);
CREATE INDEX chat_attachments_orphan_idx ON public.chat_attachments USING btree (created_at) WHERE (conversation_id IS NULL);
create policy "chat_attachments_own" on public.chat_attachments as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

create table public.chat_conversations (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text default ''::text not null,
  model text not null,
  ephemeral boolean default false not null,
  created_at timestamp with time zone default now() not null,
  last_message_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  constraint chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint chat_conversations_pkey PRIMARY KEY (id)
);
alter table public.chat_conversations enable row level security;
CREATE INDEX chat_conversations_expires_idx ON public.chat_conversations USING btree (expires_at);
CREATE INDEX chat_conversations_user_idx ON public.chat_conversations USING btree (user_id, last_message_at DESC);
create policy "chat_conversations_own" on public.chat_conversations as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

create table public.chat_messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  role text not null,
  content jsonb not null,
  status text default 'ok'::text not null,
  input_tokens integer default 0 not null,
  output_tokens integer default 0 not null,
  masked_count integer default 0 not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))),
  constraint chat_messages_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'failed'::text, 'stopped'::text]))),
  constraint chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  constraint chat_messages_pkey PRIMARY KEY (id)
);
alter table public.chat_messages enable row level security;
CREATE INDEX chat_messages_conv_idx ON public.chat_messages USING btree (conversation_id, created_at);
create policy "chat_messages_own" on public.chat_messages as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))));

create table public.chat_tool_calls (
  id uuid default gen_random_uuid() not null,
  message_id uuid not null,
  tool_use_id text not null,
  tool text not null,
  location text not null,
  status text not null,
  summary text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  constraint chat_tool_calls_location_check CHECK ((location = ANY (ARRAY['server'::text, 'device'::text, 'desktop-relay'::text]))),
  constraint chat_tool_calls_status_check CHECK ((status = ANY (ARRAY['running'::text, 'ok'::text, 'error'::text, 'timeout'::text, 'cancelled'::text]))),
  constraint chat_tool_calls_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  constraint chat_tool_calls_pkey PRIMARY KEY (id)
);
alter table public.chat_tool_calls enable row level security;
CREATE INDEX chat_tool_calls_msg_idx ON public.chat_tool_calls USING btree (message_id);
CREATE UNIQUE INDEX chat_tool_calls_once ON public.chat_tool_calls USING btree (message_id, tool_use_id);
create policy "chat_tool_calls_own" on public.chat_tool_calls as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (chat_messages m
     JOIN chat_conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = chat_tool_calls.message_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))));

create table public.claude_api_cost_daily (
  day date not null,
  workspace_id text default ''::text not null,
  description text not null,
  cost_type text,
  model text,
  amount_cents numeric not null,
  currency text default 'USD'::text not null,
  synced_at timestamp with time zone default now() not null,
  constraint claude_api_cost_daily_pkey PRIMARY KEY (day, workspace_id, description)
);
alter table public.claude_api_cost_daily enable row level security;

create table public.claude_api_keys (
  id text not null,
  name text not null,
  status text not null,
  workspace_id text,
  hint text,
  created_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  constraint claude_api_keys_pkey PRIMARY KEY (id)
);
alter table public.claude_api_keys enable row level security;

create table public.claude_api_usage_daily (
  day date not null,
  api_key_id text default ''::text not null,
  model text default ''::text not null,
  uncached_input bigint default 0 not null,
  cache_write_5m bigint default 0 not null,
  cache_write_1h bigint default 0 not null,
  cache_read bigint default 0 not null,
  output bigint default 0 not null,
  web_search integer default 0 not null,
  synced_at timestamp with time zone default now() not null,
  constraint claude_api_usage_daily_pkey PRIMARY KEY (day, api_key_id, model)
);
alter table public.claude_api_usage_daily enable row level security;

create table public.claude_code_daily (
  day date not null,
  org_id text not null,
  user_email text not null,
  account_uuid text,
  sessions numeric default 0 not null,
  prompts numeric default 0 not null,
  cost_usd numeric default 0 not null,
  input_tokens numeric default 0 not null,
  output_tokens numeric default 0 not null,
  cache_read_tokens numeric default 0 not null,
  cache_creation_tokens numeric default 0 not null,
  loc_added numeric default 0 not null,
  loc_removed numeric default 0 not null,
  edits_accepted numeric default 0 not null,
  edits_rejected numeric default 0 not null,
  commits numeric default 0 not null,
  pull_requests numeric default 0 not null,
  active_user_seconds numeric default 0 not null,
  active_cli_seconds numeric default 0 not null,
  updated_at timestamp with time zone default now() not null,
  prompts_auto numeric default 0 not null,
  constraint claude_code_daily_org_id_fkey FOREIGN KEY (org_id) REFERENCES claude_orgs(id),
  constraint claude_code_daily_pkey PRIMARY KEY (day, org_id, user_email)
);
alter table public.claude_code_daily enable row level security;
CREATE INDEX claude_code_daily_email_idx ON public.claude_code_daily USING btree (user_email, day);
CREATE INDEX claude_code_daily_org_id_idx ON public.claude_code_daily USING btree (org_id);
create policy "claude_code_daily_admin_read" on public.claude_code_daily as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_code_daily_model (
  day date not null,
  org_id text not null,
  user_email text not null,
  model text not null,
  cost_usd numeric default 0 not null,
  input_tokens numeric default 0 not null,
  output_tokens numeric default 0 not null,
  cache_read_tokens numeric default 0 not null,
  cache_creation_tokens numeric default 0 not null,
  constraint claude_code_daily_model_pkey PRIMARY KEY (day, org_id, user_email, model)
);
alter table public.claude_code_daily_model enable row level security;
create policy "claude_code_daily_model_admin_read" on public.claude_code_daily_model as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_code_env_daily (
  day date not null,
  org_id text not null,
  user_email text not null,
  os_type text default ''::text not null,
  host_arch text default ''::text not null,
  app_version text default ''::text not null,
  terminal_type text default ''::text not null,
  points numeric default 0 not null,
  constraint claude_code_env_daily_org_id_fkey FOREIGN KEY (org_id) REFERENCES claude_orgs(id),
  constraint claude_code_env_daily_pkey PRIMARY KEY (day, org_id, user_email, os_type, host_arch, app_version, terminal_type)
);
alter table public.claude_code_env_daily enable row level security;
CREATE INDEX claude_code_env_daily_user_idx ON public.claude_code_env_daily USING btree (user_email, day);

create table public.claude_code_identity_map (
  user_id text not null,
  email text not null,
  note text,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid,
  constraint claude_code_identity_map_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint claude_code_identity_map_pkey PRIMARY KEY (user_id)
);
alter table public.claude_code_identity_map enable row level security;

create table public.claude_code_prompts (
  id bigint not null,
  ts timestamp with time zone not null,
  org_id text not null,
  user_email text not null,
  account_uuid text,
  session_id text,
  prompt_length integer,
  prompt text not null,
  kind text default 'human'::text not null,
  constraint claude_code_prompts_pkey PRIMARY KEY (id)
);
alter table public.claude_code_prompts enable row level security;
CREATE INDEX claude_code_prompts_email_idx ON public.claude_code_prompts USING btree (user_email, ts DESC);
CREATE INDEX claude_code_prompts_kind_idx ON public.claude_code_prompts USING btree (kind, ts DESC);
CREATE INDEX claude_code_prompts_ts_idx ON public.claude_code_prompts USING btree (ts DESC);
create policy "claude_code_prompts_admin_read" on public.claude_code_prompts as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_code_requests (
  id bigint not null,
  ts timestamp with time zone not null,
  org_id text not null,
  user_email text not null,
  account_uuid text,
  session_id text,
  model text,
  cost_usd numeric default 0 not null,
  input_tokens numeric default 0 not null,
  output_tokens numeric default 0 not null,
  cache_read_tokens numeric default 0 not null,
  cache_creation_tokens numeric default 0 not null,
  duration_ms numeric,
  query_source text,
  request_id text,
  constraint claude_code_requests_pkey PRIMARY KEY (id)
);
alter table public.claude_code_requests enable row level security;
CREATE INDEX claude_code_requests_email_idx ON public.claude_code_requests USING btree (user_email, ts);
CREATE INDEX claude_code_requests_lower_email_ts_cov_idx ON public.claude_code_requests USING btree (lower(user_email), ts) INCLUDE (cost_usd, user_email);
CREATE INDEX claude_code_requests_org_ts_idx ON public.claude_code_requests USING btree (org_id, ts);
CREATE INDEX claude_code_requests_ts_idx ON public.claude_code_requests USING btree (ts);
create policy "claude_code_requests_admin_read" on public.claude_code_requests as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_code_tool_daily (
  day date not null,
  org_id text not null,
  user_email text not null,
  tool_name text not null,
  calls numeric default 0 not null,
  errors numeric default 0 not null,
  duration_ms_sum numeric default 0 not null,
  accepts numeric default 0 not null,
  rejects numeric default 0 not null,
  constraint claude_code_tool_daily_org_id_fkey FOREIGN KEY (org_id) REFERENCES claude_orgs(id),
  constraint claude_code_tool_daily_pkey PRIMARY KEY (day, org_id, user_email, tool_name)
);
alter table public.claude_code_tool_daily enable row level security;
CREATE INDEX claude_code_tool_daily_email_day_idx ON public.claude_code_tool_daily USING btree (user_email, day);
CREATE INDEX claude_code_tool_daily_org_id_idx ON public.claude_code_tool_daily USING btree (org_id);
CREATE INDEX claude_code_tool_daily_tool_idx ON public.claude_code_tool_daily USING btree (tool_name, day);
create policy "claude_code_tool_daily_admin_read" on public.claude_code_tool_daily as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_csv_imports (
  id uuid default gen_random_uuid() not null,
  org_id text not null,
  period_start date not null,
  period_end date not null,
  filename text,
  uploaded_by uuid,
  row_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  unknown_headers text[] default '{}'::text[] not null,
  constraint claude_csv_imports_org_id_fkey FOREIGN KEY (org_id) REFERENCES claude_orgs(id),
  constraint claude_csv_imports_pkey PRIMARY KEY (id),
  constraint claude_csv_imports_org_id_period_start_period_end_key UNIQUE (org_id, period_start, period_end)
);
alter table public.claude_csv_imports enable row level security;
create policy "claude_csv_imports_admin_read" on public.claude_csv_imports as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_ingest_log (
  id bigint not null,
  received_at timestamp with time zone default now() not null,
  signal text not null,
  org_ids text[] default '{}'::text[] not null,
  rows integer default 0 not null,
  dropped integer default 0 not null,
  bytes integer default 0 not null,
  ok boolean default true not null,
  error text,
  constraint claude_ingest_log_pkey PRIMARY KEY (id)
);
alter table public.claude_ingest_log enable row level security;
CREATE INDEX claude_ingest_log_received_idx ON public.claude_ingest_log USING btree (received_at DESC);
create policy "claude_ingest_log_admin_read" on public.claude_ingest_log as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_invoice_lines (
  invoice_id uuid not null,
  position integer not null,
  description text not null,
  quantity integer,
  amount_cents integer not null,
  tax_rate text,
  period_start date,
  period_end date,
  seats integer,
  plan text,
  constraint claude_invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES claude_invoices(id) ON DELETE CASCADE,
  constraint claude_invoice_lines_pkey PRIMARY KEY (invoice_id, "position")
);
alter table public.claude_invoice_lines enable row level security;

create table public.claude_invoices (
  id uuid default gen_random_uuid() not null,
  invoice_number text not null,
  org_id text,
  bill_to text not null,
  issued_on date not null,
  period_start date,
  period_end date,
  currency text default 'USD'::text not null,
  subtotal_cents integer not null,
  tax_cents integer default 0 not null,
  total_cents integer not null,
  seats integer,
  plan text,
  source text not null,
  source_url text,
  storage_path text not null,
  raw_text text not null,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint claude_invoices_source_check CHECK ((source = ANY (ARRAY['link'::text, 'pdf'::text]))),
  constraint claude_invoices_org_id_fkey FOREIGN KEY (org_id) REFERENCES claude_orgs(id),
  constraint claude_invoices_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint claude_invoices_pkey PRIMARY KEY (id),
  constraint claude_invoices_invoice_number_key UNIQUE (invoice_number)
);
alter table public.claude_invoices enable row level security;
CREATE INDEX claude_invoices_org_issued_idx ON public.claude_invoices USING btree (org_id, issued_on);

create table public.claude_member_activity (
  import_id uuid not null,
  org_id text not null,
  period_start date not null,
  period_end date not null,
  name text,
  email text not null,
  role text,
  seat_tier text,
  last_active date,
  days_active integer default 0 not null,
  chats integer default 0 not null,
  messages integer default 0 not null,
  projects_created integer default 0 not null,
  projects_used integer default 0 not null,
  pull_requests integer default 0 not null,
  code_sessions integer default 0 not null,
  file_edits integer default 0 not null,
  cowork_sessions integer default 0 not null,
  cowork_messages integer default 0 not null,
  artifacts_created integer default 0 not null,
  claude_code_artifacts integer default 0 not null,
  cowork_artifacts integer default 0 not null,
  estimated_spend_usd numeric default 0 not null,
  unified_messages integer default 0 not null,
  constraint claude_member_activity_import_id_fkey FOREIGN KEY (import_id) REFERENCES claude_csv_imports(id) ON DELETE CASCADE,
  constraint claude_member_activity_pkey PRIMARY KEY (import_id, email)
);
alter table public.claude_member_activity enable row level security;
CREATE INDEX claude_member_activity_email_idx ON public.claude_member_activity USING btree (email);
create policy "claude_member_activity_admin_read" on public.claude_member_activity as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_office_trace_log (
  id bigint default nextval('claude_office_trace_log_id_seq'::regclass) not null,
  received_at timestamp with time zone default now() not null,
  span_name text not null,
  trace_id text,
  span_start timestamp with time zone,
  surface text,
  user_email text,
  org_id text,
  session_id text,
  model text,
  input_tokens numeric default 0 not null,
  output_tokens numeric default 0 not null,
  cache_read_tokens numeric default 0 not null,
  cache_creation_tokens numeric default 0 not null,
  tool_name text,
  tool_success boolean,
  office_platform text,
  attr_keys text[] default '{}'::text[] not null,
  bytes integer,
  constraint claude_office_trace_log_pkey PRIMARY KEY (id)
);
alter table public.claude_office_trace_log enable row level security;
CREATE INDEX claude_office_trace_log_name_start_idx ON public.claude_office_trace_log USING btree (span_name, span_start);
CREATE INDEX claude_office_trace_log_received_idx ON public.claude_office_trace_log USING btree (received_at DESC);
CREATE INDEX claude_office_trace_log_trace_idx ON public.claude_office_trace_log USING btree (trace_id);
CREATE INDEX claude_office_trace_log_user_idx ON public.claude_office_trace_log USING btree (user_email, span_start);

create table public.claude_org_members (
  org_id text not null,
  email text not null,
  name text,
  role text,
  seat_tier text,
  status text not null,
  synced_at timestamp with time zone default now() not null,
  constraint claude_org_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text]))),
  constraint claude_org_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES claude_orgs(id),
  constraint claude_org_members_pkey PRIMARY KEY (org_id, email)
);
alter table public.claude_org_members enable row level security;
CREATE INDEX claude_org_members_email_idx ON public.claude_org_members USING btree (email);
CREATE INDEX claude_org_members_status_idx ON public.claude_org_members USING btree (status);
create policy "claude_org_members_admin_read" on public.claude_org_members as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_orgs (
  id text not null,
  name text not null,
  seats_total integer,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  category text default 'personal'::text not null,
  constraint claude_orgs_category_check CHECK ((category = ANY (ARRAY['team'::text, 'personal'::text, 'system'::text]))),
  constraint claude_orgs_pkey PRIMARY KEY (id)
);
alter table public.claude_orgs enable row level security;
create policy "claude_orgs_admin_read" on public.claude_orgs as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_seat_actions (
  id uuid default gen_random_uuid() not null,
  org_id text not null,
  email text not null,
  action text not null,
  target_tier text,
  status text default 'requested'::text not null,
  requested_by uuid not null,
  requested_by_email text not null,
  requested_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  before_tier text,
  after_tier text,
  error text,
  executor text,
  constraint claude_seat_actions_action_check CHECK ((action = ANY (ARRAY['unassign'::text, 'assign'::text]))),
  constraint claude_seat_actions_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text]))),
  constraint claude_seat_actions_target_tier_check CHECK ((target_tier = ANY (ARRAY['Standard'::text, 'Premium'::text]))),
  constraint claude_seat_actions_org_id_fkey FOREIGN KEY (org_id) REFERENCES claude_orgs(id),
  constraint claude_seat_actions_pkey PRIMARY KEY (id)
);
alter table public.claude_seat_actions enable row level security;
CREATE INDEX claude_seat_actions_email_idx ON public.claude_seat_actions USING btree (email, requested_at DESC);
CREATE INDEX claude_seat_actions_open_idx ON public.claude_seat_actions USING btree (status) WHERE (status = ANY (ARRAY['requested'::text, 'running'::text]));
CREATE UNIQUE INDEX claude_seat_actions_open_uniq ON public.claude_seat_actions USING btree (org_id, email) WHERE (status = ANY (ARRAY['requested'::text, 'running'::text]));
create policy "claude_seat_actions_admin_read" on public.claude_seat_actions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.claude_seat_executor (
  id text not null,
  last_seen_at timestamp with time zone not null,
  logged_in boolean default false not null,
  note text,
  host text,
  version text,
  constraint claude_seat_executor_pkey PRIMARY KEY (id)
);
alter table public.claude_seat_executor enable row level security;
create policy "claude_seat_executor_admin_read" on public.claude_seat_executor as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.company_directory (
  email text not null,
  emp_seq text,
  login_id text,
  name text not null,
  dept_id text,
  dept_name text,
  dept_path text,
  units text[] default '{}'::text[] not null,
  division text,
  headquarters text,
  team text,
  duty text,
  position text,
  active boolean default true not null,
  synced_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_leader boolean,
  constraint company_directory_pkey PRIMARY KEY (email)
);
alter table public.company_directory enable row level security;
CREATE INDEX company_directory_team_idx ON public.company_directory USING btree (team);
CREATE INDEX company_directory_unit_idx ON public.company_directory USING btree (division, headquarters);
create policy "company_directory_admin_read" on public.company_directory as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.company_directory_sync (
  id bigint not null,
  synced_at timestamp with time zone default now() not null,
  source text default 'amaranth'::text not null,
  query text,
  total integer default 0 not null,
  upserted integer default 0 not null,
  deactivated integer default 0 not null,
  synced_by text,
  note text,
  constraint company_directory_sync_pkey PRIMARY KEY (id)
);
alter table public.company_directory_sync enable row level security;
CREATE INDEX company_directory_sync_at_idx ON public.company_directory_sync USING btree (synced_at DESC);
create policy "company_directory_sync_admin_read" on public.company_directory_sync as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.confluence_daily (
  day date not null,
  user_email text not null,
  space_key text not null,
  pages_created integer default 0 not null,
  pages_updated integer default 0 not null,
  constraint confluence_daily_pkey PRIMARY KEY (day, user_email, space_key)
);
alter table public.confluence_daily enable row level security;
CREATE INDEX confluence_daily_email_idx ON public.confluence_daily USING btree (user_email, day DESC);
create policy "confluence_daily_admin_read" on public.confluence_daily as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.dooray_connections (
  user_id uuid not null,
  member_id text not null,
  organization_id text not null,
  account_name text not null,
  account_email text not null,
  token_enc text not null,
  connected_at timestamp with time zone default now() not null,
  constraint dooray_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint dooray_connections_pkey PRIMARY KEY (user_id)
);
alter table public.dooray_connections enable row level security;

create table public.dooray_members (
  id text not null,
  name text not null,
  updated_at timestamp with time zone default now(),
  constraint dooray_members_pkey PRIMARY KEY (id)
);
alter table public.dooray_members enable row level security;
create policy "dooray_members_delete" on public.dooray_members as permissive for delete to authenticated using (private.is_admin());
create policy "dooray_members_insert" on public.dooray_members as permissive for insert to authenticated with check ((auth.uid() IS NOT NULL));
create policy "dooray_members_select" on public.dooray_members as permissive for select to authenticated using (true);
create policy "dooray_members_update" on public.dooray_members as permissive for update to authenticated using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL));

create table public.food_categories (
  id uuid default gen_random_uuid() not null,
  category_group_code text not null,
  category_group_name text not null,
  sub_category text not null,
  created_at timestamp with time zone default now() not null,
  constraint food_categories_pkey PRIMARY KEY (id),
  constraint food_categories_category_group_code_sub_category_key UNIQUE (category_group_code, sub_category)
);
alter table public.food_categories enable row level security;
create policy "food_categories_select" on public.food_categories as permissive for select to authenticated using (true);
create policy "food_categories_write" on public.food_categories as permissive for all to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.food_decisions (
  id uuid default gen_random_uuid() not null,
  place_name text not null,
  place_url text,
  category_name text,
  address text,
  members text[] not null,
  decided_by text not null,
  created_at timestamp with time zone default now(),
  constraint food_decisions_pkey PRIMARY KEY (id)
);
alter table public.food_decisions enable row level security;
create policy "food_decisions_delete" on public.food_decisions as permissive for delete to authenticated using (private.is_admin());
create policy "food_decisions_insert" on public.food_decisions as permissive for insert to authenticated with check ((decided_by = (auth.jwt() ->> 'email'::text)));
create policy "food_decisions_select" on public.food_decisions as permissive for select to authenticated using (true);

create table public.food_detail_categories (
  id uuid default gen_random_uuid() not null,
  category_group_code text not null,
  sub_category text not null,
  detail_category text not null,
  created_at timestamp with time zone default now() not null,
  constraint food_detail_categories_pkey PRIMARY KEY (id),
  constraint food_detail_categories_category_group_code_sub_category_det_key UNIQUE (category_group_code, sub_category, detail_category)
);
alter table public.food_detail_categories enable row level security;
create policy "food_detail_categories_select" on public.food_detail_categories as permissive for select to authenticated using (true);
create policy "food_detail_categories_write" on public.food_detail_categories as permissive for all to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.food_favorites (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  user_email text,
  place_id text not null,
  place_name text not null,
  category_name text,
  address text,
  road_address text,
  phone text,
  place_url text,
  x double precision,
  y double precision,
  created_at timestamp with time zone default now() not null,
  constraint food_favorites_pkey PRIMARY KEY (id),
  constraint food_favorites_user_email_place_id_key UNIQUE (user_email, place_id)
);
alter table public.food_favorites enable row level security;
CREATE INDEX idx_food_favorites_user ON public.food_favorites USING btree (user_email);
create policy "food_favorites_delete" on public.food_favorites as permissive for delete to authenticated using ((user_id = auth.uid()));
create policy "food_favorites_insert" on public.food_favorites as permissive for insert to authenticated with check ((user_id = auth.uid()));
create policy "food_favorites_select" on public.food_favorites as permissive for select to authenticated using ((user_id = auth.uid()));
create policy "food_favorites_update" on public.food_favorites as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

create table public.gitlab_daily (
  day date not null,
  user_email text not null,
  project_path text not null,
  commits integer default 0 not null,
  mrs_opened integer default 0 not null,
  mrs_merged integer default 0 not null,
  mr_lead_hours_sum numeric default 0 not null,
  claude_commits integer default 0 not null,
  constraint gitlab_daily_pkey PRIMARY KEY (day, user_email, project_path)
);
alter table public.gitlab_daily enable row level security;
CREATE INDEX gitlab_daily_email_idx ON public.gitlab_daily USING btree (user_email, day DESC);
create policy "gitlab_daily_admin_read" on public.gitlab_daily as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.gitlab_email_map (
  raw_email text not null,
  email text not null,
  note text,
  created_at timestamp with time zone default now() not null,
  constraint gitlab_email_map_pkey PRIMARY KEY (raw_email)
);
alter table public.gitlab_email_map enable row level security;
create policy "gitlab_email_map_admin_read" on public.gitlab_email_map as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.group_members (
  id uuid default gen_random_uuid() not null,
  group_id uuid not null,
  member_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  constraint group_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint group_members_pkey PRIMARY KEY (id),
  constraint group_members_group_id_member_id_key UNIQUE (group_id, member_id)
);
alter table public.group_members enable row level security;
CREATE INDEX idx_group_members_group_id ON public.group_members USING btree (group_id);
CREATE INDEX idx_group_members_member_id ON public.group_members USING btree (member_id);
create policy "group_members_admin_all" on public.group_members as permissive for all to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.groups (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint groups_pkey PRIMARY KEY (id)
);
alter table public.groups enable row level security;
create policy "groups_admin_all" on public.groups as permissive for all to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.jira_connections (
  user_id uuid not null,
  account_id text not null,
  account_name text not null,
  email text not null,
  api_base text not null,
  token_enc text not null,
  connected_at timestamp with time zone default now() not null,
  auth_type text default 'api_token'::text not null,
  refresh_token_enc text,
  expires_at timestamp with time zone,
  refresh_lock uuid,
  refresh_lock_until timestamp with time zone,
  privacy_next_at timestamp with time zone default now() not null,
  scopes text[],
  constraint jira_connections_auth_type_check CHECK ((auth_type = ANY (ARRAY['api_token'::text, 'oauth'::text]))),
  constraint jira_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint jira_connections_pkey PRIMARY KEY (user_id)
);
alter table public.jira_connections enable row level security;
CREATE INDEX jira_connections_privacy_due_idx ON public.jira_connections USING btree (privacy_next_at) WHERE (auth_type = 'oauth'::text);

create table public.jira_issue_daily (
  day date not null,
  user_email text not null,
  project_key text not null,
  issues_created integer default 0 not null,
  issues_resolved integer default 0 not null,
  lead_hours_sum numeric default 0 not null,
  cycle_hours_sum numeric default 0 not null,
  cycle_count integer default 0 not null,
  story_points numeric default 0 not null,
  constraint jira_issue_daily_pkey PRIMARY KEY (day, user_email, project_key)
);
alter table public.jira_issue_daily enable row level security;
CREATE INDEX jira_issue_daily_email_idx ON public.jira_issue_daily USING btree (user_email, day DESC);
create policy "jira_issue_daily_admin_read" on public.jira_issue_daily as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.ladder_sessions (
  id uuid default gen_random_uuid() not null,
  title text,
  participants text[] not null,
  results jsonb not null,
  bridges jsonb not null,
  bridge_density real default 0.4 not null,
  mappings jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  constraint ladder_sessions_pkey PRIMARY KEY (id)
);
alter table public.ladder_sessions enable row level security;
create policy "ladder_sessions_delete" on public.ladder_sessions as permissive for delete to authenticated using ((auth.uid() IS NOT NULL));
create policy "ladder_sessions_insert" on public.ladder_sessions as permissive for insert to authenticated with check ((auth.uid() IS NOT NULL));
create policy "ladder_sessions_select" on public.ladder_sessions as permissive for select to authenticated using (true);
create policy "ladder_sessions_update" on public.ladder_sessions as permissive for update to authenticated using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL));
create policy "page_access_limit" on public.ladder_sessions as restrictive for all to authenticated using (( SELECT has_page_access('ladder'::text) AS has_page_access)) with check (( SELECT has_page_access('ladder'::text) AS has_page_access));

create table public.login_history (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  logged_in_at timestamp with time zone default now() not null,
  ip_address text,
  user_agent text,
  constraint login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint login_history_pkey PRIMARY KEY (id)
);
alter table public.login_history enable row level security;
CREATE INDEX idx_login_history_logged_in_at ON public.login_history USING btree (logged_in_at DESC);
CREATE INDEX idx_login_history_user_id ON public.login_history USING btree (user_id);
CREATE INDEX login_history_logged_in_at_idx ON public.login_history USING btree (logged_in_at DESC);
create policy "login_history_insert" on public.login_history as permissive for insert to authenticated with check ((user_id = auth.uid()));
create policy "login_history_select" on public.login_history as permissive for select to authenticated using (((user_id = auth.uid()) OR private.is_admin()));

create table public.marketing_contacts (
  id uuid default gen_random_uuid() not null,
  db_id text not null,
  organization_id uuid,
  data jsonb not null,
  version integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  delete_candidate jsonb,
  constraint marketing_contacts_data_check CHECK ((jsonb_typeof(data) = 'object'::text)),
  constraint marketing_contacts_delete_candidate_check CHECK (((delete_candidate IS NULL) OR (jsonb_typeof(delete_candidate) = 'object'::text))),
  constraint marketing_contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES marketing_organizations(id),
  constraint marketing_contacts_pkey PRIMARY KEY (id),
  constraint marketing_contacts_db_id_key UNIQUE (db_id)
);
alter table public.marketing_contacts enable row level security;
CREATE UNIQUE INDEX marketing_contact_email_idx ON public.marketing_contacts USING btree (lower(btrim((data ->> 'email'::text)))) WHERE (btrim(COALESCE((data ->> 'email'::text), ''::text)) <> ''::text);
CREATE INDEX marketing_contact_name_idx ON public.marketing_contacts USING btree (lower(btrim((data ->> 'name'::text))));
CREATE INDEX marketing_contact_org_idx ON public.marketing_contacts USING btree (organization_id);
create policy "marketing_read" on public.marketing_contacts as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_email_probe_cache (
  run_id uuid not null,
  key text not null,
  result jsonb not null,
  created_at timestamp with time zone default now() not null,
  constraint marketing_email_probe_cache_run_id_fkey FOREIGN KEY (run_id) REFERENCES marketing_email_runs(id),
  constraint marketing_email_probe_cache_pkey PRIMARY KEY (run_id, key)
);
alter table public.marketing_email_probe_cache enable row level security;

create table public.marketing_email_profile_history (
  id bigint not null,
  organization_id uuid not null,
  version integer not null,
  before_data jsonb,
  after_data jsonb not null,
  actor uuid not null,
  actor_name text not null,
  reason text not null,
  created_at timestamp with time zone default now() not null,
  constraint marketing_email_profile_history_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES marketing_organizations(id),
  constraint marketing_email_profile_history_pkey PRIMARY KEY (id),
  constraint marketing_email_profile_history_organization_id_version_key UNIQUE (organization_id, version)
);
alter table public.marketing_email_profile_history enable row level security;
create policy "marketing_email_read" on public.marketing_email_profile_history as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_email_profiles (
  organization_id uuid not null,
  version integer default 1 not null,
  website text default ''::text not null,
  domains text[] default '{}'::text[] not null,
  reason text not null,
  actor uuid not null,
  actor_name text not null,
  updated_at timestamp with time zone default now() not null,
  constraint marketing_email_profiles_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_email_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES marketing_organizations(id),
  constraint marketing_email_profiles_pkey PRIMARY KEY (organization_id)
);
alter table public.marketing_email_profiles enable row level security;
create policy "marketing_email_read" on public.marketing_email_profiles as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_email_results (
  id uuid not null,
  run_id uuid not null,
  contact_id uuid not null,
  result jsonb not null,
  created_at timestamp with time zone default now() not null,
  constraint marketing_email_results_run_id_contact_id_fkey FOREIGN KEY (run_id, contact_id) REFERENCES marketing_email_targets(run_id, contact_id),
  constraint marketing_email_results_pkey PRIMARY KEY (id)
);
alter table public.marketing_email_results enable row level security;
CREATE INDEX marketing_email_results_run_id_contact_id_created_at_idx ON public.marketing_email_results USING btree (run_id, contact_id, created_at DESC);
create policy "marketing_email_read" on public.marketing_email_results as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_email_runs (
  id uuid default gen_random_uuid() not null,
  request_key uuid not null,
  request jsonb not null,
  actor uuid not null,
  actor_name text not null,
  scope text not null,
  filters jsonb not null,
  status text default 'queued'::text not null,
  total integer default 0 not null,
  processed integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  constraint marketing_email_runs_scope_check CHECK ((scope = ANY (ARRAY['all'::text, 'filtered'::text, 'selected'::text]))),
  constraint marketing_email_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'cancelled'::text]))),
  constraint marketing_email_runs_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_email_runs_pkey PRIMARY KEY (id),
  constraint marketing_email_runs_request_key_key UNIQUE (request_key)
);
alter table public.marketing_email_runs enable row level security;
CREATE INDEX marketing_email_runs_created_at_idx ON public.marketing_email_runs USING btree (created_at DESC);
create policy "marketing_email_read" on public.marketing_email_runs as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_email_targets (
  run_id uuid not null,
  contact_id uuid not null,
  ordinal integer not null,
  snapshot jsonb not null,
  processed boolean default false not null,
  lease uuid,
  lease_until timestamp with time zone,
  result jsonb,
  checked_at timestamp with time zone,
  constraint marketing_email_targets_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES marketing_contacts(id),
  constraint marketing_email_targets_run_id_fkey FOREIGN KEY (run_id) REFERENCES marketing_email_runs(id),
  constraint marketing_email_targets_pkey PRIMARY KEY (run_id, contact_id)
);
alter table public.marketing_email_targets enable row level security;
CREATE INDEX marketing_email_targets_run_id_lease_until_idx ON public.marketing_email_targets USING btree (run_id, lease_until) WHERE (NOT processed);
CREATE INDEX marketing_email_targets_run_id_ordinal_idx ON public.marketing_email_targets USING btree (run_id, ordinal);
create policy "marketing_email_read" on public.marketing_email_targets as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_import_batches (
  id uuid default gen_random_uuid() not null,
  file_hash text not null,
  filename text not null,
  row_count integer not null,
  imported_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint marketing_import_batches_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES auth.users(id),
  constraint marketing_import_batches_pkey PRIMARY KEY (id),
  constraint marketing_import_batches_file_hash_key UNIQUE (file_hash)
);
alter table public.marketing_import_batches enable row level security;
create policy "marketing_read" on public.marketing_import_batches as permissive for select to authenticated using (( SELECT marketing_can_review() AS marketing_can_review));

create table public.marketing_organizations (
  id uuid default gen_random_uuid() not null,
  name text not null,
  category text not null,
  aliases text[] default '{}'::text[] not null,
  version integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  review_status text default 'pending'::text not null,
  constraint marketing_organizations_category_check CHECK (marketing_category_valid(category)),
  constraint marketing_organizations_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 2000))),
  constraint marketing_organizations_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'confirmed'::text]))),
  constraint marketing_organizations_pkey PRIMARY KEY (id)
);
alter table public.marketing_organizations enable row level security;
CREATE INDEX marketing_org_name_idx ON public.marketing_organizations USING btree (lower(btrim(name)));
create policy "marketing_read" on public.marketing_organizations as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_review_events (
  id uuid default gen_random_uuid() not null,
  submission_id uuid,
  actor uuid,
  actor_name text not null,
  action text not null,
  reason text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamp with time zone default now() not null,
  contact_id uuid,
  organization_id uuid,
  submitter text,
  division text,
  source jsonb,
  validation_snapshot jsonb,
  email_result_id uuid,
  constraint marketing_review_events_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_review_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES marketing_contacts(id),
  constraint marketing_review_events_email_result_id_fkey FOREIGN KEY (email_result_id) REFERENCES marketing_email_results(id),
  constraint marketing_review_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES marketing_organizations(id),
  constraint marketing_review_events_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES marketing_submissions(id),
  constraint marketing_review_events_pkey PRIMARY KEY (id)
);
alter table public.marketing_review_events enable row level security;
CREATE INDEX marketing_event_contact_email_idx ON public.marketing_review_events USING btree (contact_id, created_at DESC, id DESC) WHERE (email_result_id IS NOT NULL);
CREATE INDEX marketing_event_contact_idx ON public.marketing_review_events USING btree (contact_id, created_at DESC);
CREATE UNIQUE INDEX marketing_event_email_result_idx ON public.marketing_review_events USING btree (email_result_id) WHERE (email_result_id IS NOT NULL);
CREATE INDEX marketing_event_org_idx ON public.marketing_review_events USING btree (organization_id, created_at DESC);
CREATE INDEX marketing_event_submission_idx ON public.marketing_review_events USING btree (submission_id);
CREATE INDEX marketing_event_time_idx ON public.marketing_review_events USING btree (created_at DESC);
CREATE INDEX marketing_reviewer_event_target_idx ON public.marketing_review_events USING btree (((after_data ->> 'userId'::text)), created_at DESC, id DESC) WHERE (action = '검수 권한 변경'::text);
create policy "marketing_read" on public.marketing_review_events as permissive for select to authenticated using ((( SELECT has_page_access('marketing'::text) AS has_page_access) AND (( SELECT marketing_can_review() AS marketing_can_review) OR (EXISTS ( SELECT 1
   FROM marketing_submissions s
  WHERE ((s.id = marketing_review_events.submission_id) AND (s.submitted_by = ( SELECT auth.uid() AS uid))))))));

create table public.marketing_reviewers (
  user_id uuid not null,
  constraint marketing_reviewers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint marketing_reviewers_pkey PRIMARY KEY (user_id)
);
alter table public.marketing_reviewers enable row level security;
create policy "marketing_read" on public.marketing_reviewers as permissive for select to authenticated using ((( SELECT has_page_access('marketing'::text) AS has_page_access) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT marketing_can_review() AS marketing_can_review))));

create table public.marketing_rule_drafts (
  id uuid not null,
  rule_id uuid,
  base_version integer,
  revision integer default 1 not null,
  definition jsonb not null,
  reason text not null,
  actor uuid not null,
  updated_at timestamp with time zone default now() not null,
  published_version integer,
  published_rule_id uuid,
  constraint marketing_rule_drafts_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_rule_drafts_published_rule_id_fkey FOREIGN KEY (published_rule_id) REFERENCES marketing_rules(id),
  constraint marketing_rule_drafts_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES marketing_rules(id),
  constraint marketing_rule_drafts_pkey PRIMARY KEY (id)
);
alter table public.marketing_rule_drafts enable row level security;
CREATE INDEX marketing_rule_drafts_rule_id_idx ON public.marketing_rule_drafts USING btree (rule_id);
create policy "marketing_read" on public.marketing_rule_drafts as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_rule_history (
  id uuid default gen_random_uuid() not null,
  rule_id uuid not null,
  version integer not null,
  actor uuid,
  actor_name text not null,
  reason text not null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamp with time zone default now() not null,
  constraint marketing_rule_history_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_rule_history_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES marketing_rules(id),
  constraint marketing_rule_history_pkey PRIMARY KEY (id),
  constraint marketing_rule_history_rule_id_version_key UNIQUE (rule_id, version)
);
alter table public.marketing_rule_history enable row level security;
create policy "marketing_read" on public.marketing_rule_history as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_rule_versions (
  rule_id uuid not null,
  version integer not null,
  definition jsonb not null,
  reason text not null,
  actor uuid,
  actor_name text not null,
  created_at timestamp with time zone default now() not null,
  constraint marketing_rule_versions_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES marketing_rules(id),
  constraint marketing_rule_versions_pkey PRIMARY KEY (rule_id, version)
);
alter table public.marketing_rule_versions enable row level security;
create policy "marketing_read" on public.marketing_rule_versions as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_rules (
  id uuid default gen_random_uuid() not null,
  code text not null,
  title text not null,
  description text default ''::text not null,
  config jsonb not null,
  severity text not null,
  enabled boolean default true not null,
  protected boolean default false not null,
  source text default '사용자 추가'::text not null,
  version integer default 1 not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid,
  constraint marketing_rule_config_check CHECK (marketing_rule_config_valid(config)),
  constraint marketing_rules_severity_check CHECK ((severity = ANY (ARRAY['error'::text, 'warning'::text]))),
  constraint marketing_rules_title_check CHECK (((length(title) >= 1) AND (length(title) <= 120))),
  constraint marketing_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id),
  constraint marketing_rules_pkey PRIMARY KEY (id),
  constraint marketing_rules_code_key UNIQUE (code)
);
alter table public.marketing_rules enable row level security;
create policy "marketing_read" on public.marketing_rules as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_source_rows (
  id bigint not null,
  batch_id uuid not null,
  contact_id uuid not null,
  sheet text not null,
  row_number integer not null,
  raw jsonb not null,
  constraint marketing_source_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES marketing_import_batches(id),
  constraint marketing_source_rows_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES marketing_contacts(id),
  constraint marketing_source_rows_pkey PRIMARY KEY (id),
  constraint marketing_source_rows_batch_id_sheet_row_number_key UNIQUE (batch_id, sheet, row_number)
);
alter table public.marketing_source_rows enable row level security;
CREATE INDEX marketing_source_contact_idx ON public.marketing_source_rows USING btree (contact_id);
create policy "marketing_read" on public.marketing_source_rows as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_submissions (
  id uuid default gen_random_uuid() not null,
  request_key uuid not null,
  submitted_by uuid not null,
  submitter text not null,
  division text not null,
  data jsonb not null,
  target_id uuid,
  clear_fields text[] default '{}'::text[] not null,
  validation jsonb not null,
  source jsonb default '{}'::jsonb not null,
  status text default 'pending'::text not null,
  version integer default 1 not null,
  result_contact_id uuid,
  created_at timestamp with time zone default now() not null,
  submitted_organization_id uuid,
  constraint marketing_submissions_data_check CHECK ((jsonb_typeof(data) = 'object'::text)),
  constraint marketing_submissions_status_check CHECK ((status = ANY (ARRAY['validating'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'unchanged'::text]))),
  constraint marketing_submissions_result_contact_id_fkey FOREIGN KEY (result_contact_id) REFERENCES marketing_contacts(id),
  constraint marketing_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id),
  constraint marketing_submissions_submitted_organization_id_fkey FOREIGN KEY (submitted_organization_id) REFERENCES marketing_organizations(id),
  constraint marketing_submissions_target_id_fkey FOREIGN KEY (target_id) REFERENCES marketing_contacts(id),
  constraint marketing_submissions_pkey PRIMARY KEY (id),
  constraint marketing_submissions_request_key_key UNIQUE (request_key)
);
alter table public.marketing_submissions enable row level security;
CREATE INDEX marketing_submission_org_idx ON public.marketing_submissions USING btree (submitted_organization_id) WHERE (submitted_organization_id IS NOT NULL);
CREATE INDEX marketing_submission_owner_idx ON public.marketing_submissions USING btree (submitted_by, created_at DESC);
CREATE INDEX marketing_submission_queue_idx ON public.marketing_submissions USING btree (status, created_at DESC);
CREATE INDEX marketing_submission_result_idx ON public.marketing_submissions USING btree (result_contact_id) WHERE (result_contact_id IS NOT NULL);
create policy "marketing_read" on public.marketing_submissions as permissive for select to authenticated using ((( SELECT has_page_access('marketing'::text) AS has_page_access) AND ((submitted_by = ( SELECT auth.uid() AS uid)) OR ( SELECT marketing_can_review() AS marketing_can_review))));

create table public.marketing_validation_followups (
  id uuid default gen_random_uuid() not null,
  request_key uuid not null,
  run_id uuid not null,
  contact_id uuid not null,
  result_id bigint,
  status text not null,
  reason text not null,
  actor uuid not null,
  actor_name text not null,
  current_version integer not null,
  organization_version integer,
  submission_id uuid,
  created_at timestamp with time zone default now() not null,
  constraint marketing_validation_followups_reason_check CHECK (((length(btrim(reason)) >= 2) AND (length(btrim(reason)) <= 2000))),
  constraint marketing_validation_followups_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'deferred'::text, 'submitted'::text]))),
  constraint marketing_validation_followups_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_validation_followups_result_id_fkey FOREIGN KEY (result_id) REFERENCES marketing_validation_results(id),
  constraint marketing_validation_followups_run_id_contact_id_fkey FOREIGN KEY (run_id, contact_id) REFERENCES marketing_validation_targets(run_id, contact_id),
  constraint marketing_validation_followups_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES marketing_submissions(id),
  constraint marketing_validation_followups_pkey PRIMARY KEY (id),
  constraint marketing_validation_followups_request_key_key UNIQUE (request_key)
);
alter table public.marketing_validation_followups enable row level security;
CREATE INDEX marketing_validation_followups_run_id_contact_id_created_at_idx ON public.marketing_validation_followups USING btree (run_id, contact_id, created_at DESC);
CREATE INDEX marketing_validation_followups_submission_id_idx ON public.marketing_validation_followups USING btree (submission_id);
create policy "marketing_read" on public.marketing_validation_followups as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_validation_organizations (
  run_id uuid not null,
  organization_id uuid not null,
  snapshot jsonb not null,
  context jsonb not null,
  constraint marketing_validation_organizations_run_id_fkey FOREIGN KEY (run_id) REFERENCES marketing_validation_runs(id),
  constraint marketing_validation_organizations_pkey PRIMARY KEY (run_id, organization_id)
);
alter table public.marketing_validation_organizations enable row level security;
create policy "marketing_read" on public.marketing_validation_organizations as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_validation_reference (
  run_id uuid not null,
  contact_id uuid not null,
  version integer not null,
  db_id text not null,
  email_key text,
  name_key text,
  company_keys text[] not null,
  organization_id uuid,
  constraint marketing_validation_reference_run_id_fkey FOREIGN KEY (run_id) REFERENCES marketing_validation_runs(id),
  constraint marketing_validation_reference_pkey PRIMARY KEY (run_id, contact_id)
);
alter table public.marketing_validation_reference enable row level security;
CREATE INDEX marketing_validation_reference_run_id_email_key_idx ON public.marketing_validation_reference USING btree (run_id, email_key);
CREATE INDEX marketing_validation_reference_run_id_name_key_idx ON public.marketing_validation_reference USING btree (run_id, name_key);
CREATE INDEX marketing_validation_reference_run_id_organization_id_idx ON public.marketing_validation_reference USING btree (run_id, organization_id);
create policy "marketing_read" on public.marketing_validation_reference as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_validation_results (
  id bigint not null,
  run_id uuid not null,
  contact_id uuid not null,
  rule_index integer not null,
  attempt integer not null,
  outcome text not null,
  severity text not null,
  detail jsonb not null,
  created_at timestamp with time zone default now() not null,
  constraint marketing_validation_results_outcome_check CHECK ((outcome = ANY (ARRAY['pass'::text, 'fail'::text, 'review'::text, 'not_applicable'::text, 'error'::text]))),
  constraint marketing_validation_results_severity_check CHECK ((severity = ANY (ARRAY['error'::text, 'warning'::text]))),
  constraint marketing_validation_results_run_id_contact_id_fkey FOREIGN KEY (run_id, contact_id) REFERENCES marketing_validation_targets(run_id, contact_id),
  constraint marketing_validation_results_pkey PRIMARY KEY (id),
  constraint marketing_validation_results_run_id_contact_id_rule_index_a_key UNIQUE (run_id, contact_id, rule_index, attempt)
);
alter table public.marketing_validation_results enable row level security;
CREATE INDEX marketing_validation_results_run_id_contact_id_rule_index_a_idx ON public.marketing_validation_results USING btree (run_id, contact_id, rule_index, attempt DESC);
CREATE INDEX marketing_validation_results_run_id_outcome_severity_idx ON public.marketing_validation_results USING btree (run_id, outcome, severity);
create policy "marketing_read" on public.marketing_validation_results as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_validation_runs (
  id uuid default gen_random_uuid() not null,
  request_key uuid not null,
  request jsonb not null,
  actor uuid not null,
  actor_name text not null,
  scope text not null,
  filters jsonb not null,
  rules jsonb not null,
  trial boolean default false not null,
  engine_version text default '2026-09-14.2'::text not null,
  status text default 'queued'::text not null,
  total integer default 0 not null,
  processed integer default 0 not null,
  attempt integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  last_error text,
  constraint marketing_validation_runs_scope_check CHECK ((scope = ANY (ARRAY['all'::text, 'filtered'::text, 'selected'::text]))),
  constraint marketing_validation_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'completed_with_errors'::text, 'cancel_requested'::text, 'cancelled'::text, 'failed'::text]))),
  constraint marketing_validation_runs_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_validation_runs_pkey PRIMARY KEY (id),
  constraint marketing_validation_runs_request_key_key UNIQUE (request_key)
);
alter table public.marketing_validation_runs enable row level security;
CREATE INDEX marketing_validation_runs_created_at_id_idx ON public.marketing_validation_runs USING btree (created_at DESC, id);
CREATE INDEX marketing_validation_runs_status_created_at_idx ON public.marketing_validation_runs USING btree (status, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text, 'cancel_requested'::text]));
create policy "marketing_read" on public.marketing_validation_runs as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_validation_targets (
  run_id uuid not null,
  contact_id uuid not null,
  ordinal bigint not null,
  snapshot jsonb not null,
  context jsonb not null,
  submission_request_key uuid default gen_random_uuid() not null,
  processed boolean default false not null,
  outcome text,
  severity text,
  issue_count integer default 0 not null,
  constraint marketing_validation_targets_run_id_fkey FOREIGN KEY (run_id) REFERENCES marketing_validation_runs(id),
  constraint marketing_validation_targets_pkey PRIMARY KEY (run_id, contact_id),
  constraint marketing_validation_targets_run_id_ordinal_key UNIQUE (run_id, ordinal)
);
alter table public.marketing_validation_targets enable row level security;
CREATE INDEX marketing_validation_targets_run_id_outcome_severity_idx ON public.marketing_validation_targets USING btree (run_id, outcome, severity);
CREATE INDEX marketing_validation_targets_run_id_processed_ordinal_idx ON public.marketing_validation_targets USING btree (run_id, processed, ordinal);
create policy "marketing_read" on public.marketing_validation_targets as permissive for select to authenticated using (( SELECT has_page_access('marketing'::text) AS has_page_access));

create table public.marketing_validations (
  id uuid default gen_random_uuid() not null,
  submission_id uuid not null,
  submission_version integer not null,
  result jsonb not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  actor uuid,
  origin text default 'validation'::text not null,
  constraint marketing_validations_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id),
  constraint marketing_validations_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES marketing_submissions(id),
  constraint marketing_validations_pkey PRIMARY KEY (id),
  constraint marketing_validations_submission_id_submission_version_key UNIQUE (submission_id, submission_version)
);
alter table public.marketing_validations enable row level security;
CREATE INDEX marketing_validation_submission_idx ON public.marketing_validations USING btree (submission_id, created_at DESC);
create policy "marketing_read" on public.marketing_validations as permissive for select to authenticated using ((( SELECT has_page_access('marketing'::text) AS has_page_access) AND (( SELECT marketing_can_review() AS marketing_can_review) OR (EXISTS ( SELECT 1
   FROM marketing_submissions s
  WHERE ((s.id = marketing_validations.submission_id) AND (s.submitted_by = ( SELECT auth.uid() AS uid))))))));

create table public.mcp_calls (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  tool text not null,
  args jsonb default '{}'::jsonb not null,
  status text default 'pending'::text not null,
  result jsonb,
  worker text,
  created_at timestamp with time zone default now() not null,
  claimed_at timestamp with time zone,
  done_at timestamp with time zone,
  constraint mcp_calls_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text]))),
  constraint mcp_calls_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint mcp_calls_pkey PRIMARY KEY (id)
);
alter table public.mcp_calls enable row level security;
CREATE INDEX mcp_calls_user_status_idx ON public.mcp_calls USING btree (user_id, status, created_at);
create policy "mcp_calls_own_select" on public.mcp_calls as permissive for select to public using ((auth.uid() = user_id));
create policy "mcp_calls_own_update" on public.mcp_calls as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

create table public.media_alert_deliveries (
  id uuid default gen_random_uuid() not null,
  sync_run_id bigint not null,
  recipient_user_id uuid not null,
  recipient_email text not null,
  match_count integer not null,
  status text not null,
  error_message text,
  created_at timestamp with time zone default now() not null,
  constraint media_alert_deliveries_match_count_check CHECK ((match_count >= 0)),
  constraint media_alert_deliveries_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text]))),
  constraint media_alert_deliveries_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint media_alert_deliveries_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES yonhap_notice_sync_runs(id) ON DELETE CASCADE,
  constraint media_alert_deliveries_pkey PRIMARY KEY (id),
  constraint media_alert_deliveries_sync_run_id_recipient_user_id_key UNIQUE (sync_run_id, recipient_user_id)
);
alter table public.media_alert_deliveries enable row level security;
CREATE INDEX media_alert_deliveries_created_idx ON public.media_alert_deliveries USING btree (created_at DESC);
create policy "media_alert_deliveries_read" on public.media_alert_deliveries as permissive for select to authenticated using (((recipient_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT (EXISTS ( SELECT 1
           FROM user_profiles
          WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))) AS "exists")));

create table public.media_alert_subscriptions (
  user_id uuid not null,
  enabled boolean default false not null,
  updated_at timestamp with time zone default now() not null,
  constraint media_alert_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint media_alert_subscriptions_pkey PRIMARY KEY (user_id)
);
alter table public.media_alert_subscriptions enable row level security;
create policy "media_alert_subscriptions_own" on public.media_alert_subscriptions as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

create table public.media_departments (
  id uuid default gen_random_uuid() not null,
  outlet_id uuid not null,
  name text not null,
  name_norm text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid,
  constraint media_departments_name_check CHECK (((length(btrim(name)) >= 2) AND (length(btrim(name)) <= 100))),
  constraint media_departments_name_norm_check CHECK ((length(name_norm) >= 2)),
  constraint media_departments_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES media_outlets(id) ON DELETE CASCADE,
  constraint media_departments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint media_departments_pkey PRIMARY KEY (id),
  constraint media_departments_outlet_id_name_norm_key UNIQUE (outlet_id, name_norm)
);
alter table public.media_departments enable row level security;
create policy "media_departments_read" on public.media_departments as permissive for select to authenticated using (( SELECT has_page_access('people_news'::text) AS has_page_access));

create table public.media_obituary_matches (
  id bigint not null,
  source_id text not null,
  outlet_id uuid not null,
  department_id uuid,
  matched_text text not null,
  sync_run_id bigint,
  created_at timestamp with time zone default now() not null,
  notified_at timestamp with time zone,
  constraint media_obituary_matches_department_id_fkey FOREIGN KEY (department_id) REFERENCES media_departments(id) ON DELETE CASCADE,
  constraint media_obituary_matches_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES media_outlets(id) ON DELETE CASCADE,
  constraint media_obituary_matches_source_id_fkey FOREIGN KEY (source_id) REFERENCES yonhap_notices(source_id) ON DELETE CASCADE,
  constraint media_obituary_matches_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES yonhap_notice_sync_runs(id) ON DELETE SET NULL,
  constraint media_obituary_matches_pkey PRIMARY KEY (id)
);
alter table public.media_obituary_matches enable row level security;
CREATE INDEX media_obituary_matches_run_idx ON public.media_obituary_matches USING btree (sync_run_id);
CREATE INDEX media_obituary_matches_source_idx ON public.media_obituary_matches USING btree (source_id);
CREATE UNIQUE INDEX media_obituary_matches_unique ON public.media_obituary_matches USING btree (source_id, outlet_id, department_id) NULLS NOT DISTINCT;
create policy "media_obituary_matches_read" on public.media_obituary_matches as permissive for select to authenticated using (( SELECT has_page_access('people_news'::text) AS has_page_access));

create table public.media_outlets (
  id uuid default gen_random_uuid() not null,
  name text not null,
  name_norm text not null,
  aliases text[] default '{}'::text[] not null,
  aliases_norm text[] default '{}'::text[] not null,
  any_department boolean default false not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid,
  constraint media_outlets_name_check CHECK (((length(btrim(name)) >= 2) AND (length(btrim(name)) <= 100))),
  constraint media_outlets_name_norm_check CHECK ((length(name_norm) >= 2)),
  constraint media_outlets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint media_outlets_pkey PRIMARY KEY (id),
  constraint media_outlets_name_norm_key UNIQUE (name_norm)
);
alter table public.media_outlets enable row level security;
CREATE INDEX media_outlets_aliases_norm_idx ON public.media_outlets USING gin (aliases_norm);
create policy "media_outlets_read" on public.media_outlets as permissive for select to authenticated using (( SELECT has_page_access('people_news'::text) AS has_page_access));

create table public.members (
  id uuid default gen_random_uuid() not null,
  name text not null,
  dooray_member_id text,
  is_card_holder boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint members_pkey PRIMARY KEY (id),
  constraint members_dooray_member_id_key UNIQUE (dooray_member_id)
);
alter table public.members enable row level security;
CREATE INDEX idx_members_name ON public.members USING btree (name);
create policy "members_admin_all" on public.members as permissive for all to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.mobile_app_requests (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  platform text not null,
  store_email text not null,
  status text default 'pending'::text not null,
  admin_note text default ''::text not null,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  submitted_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  revision integer default 1 not null,
  constraint mobile_app_requests_admin_note_check CHECK ((length(admin_note) <= 2000)),
  constraint mobile_app_requests_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text]))),
  constraint mobile_app_requests_revision_check CHECK ((revision > 0)),
  constraint mobile_app_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'approved'::text, 'rejected'::text]))),
  constraint mobile_app_requests_store_email_check CHECK (((length(store_email) >= 3) AND (length(store_email) <= 254))),
  constraint mobile_app_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint mobile_app_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint mobile_app_requests_pkey PRIMARY KEY (id),
  constraint mobile_app_requests_user_id_platform_key UNIQUE (user_id, platform)
);
alter table public.mobile_app_requests enable row level security;
CREATE INDEX mobile_app_requests_status_submitted_idx ON public.mobile_app_requests USING btree (status, submitted_at DESC);

create table public.ms_connections (
  user_id uuid not null,
  account_upn text,
  account_name text,
  refresh_token_enc text not null,
  scopes text not null,
  connected_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone,
  last_error text,
  updated_at timestamp with time zone default now() not null,
  constraint ms_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint ms_connections_pkey PRIMARY KEY (user_id)
);
alter table public.ms_connections enable row level security;

create table public.nlm_chat_messages (
  id uuid default gen_random_uuid() not null,
  notebook_id uuid,
  user_email text not null,
  conversation_id text,
  role text not null,
  content text not null,
  citations jsonb,
  created_at timestamp with time zone default now(),
  constraint nlm_chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))),
  constraint nlm_chat_messages_notebook_id_fkey FOREIGN KEY (notebook_id) REFERENCES nlm_notebooks(id) ON DELETE CASCADE,
  constraint nlm_chat_messages_pkey PRIMARY KEY (id)
);
alter table public.nlm_chat_messages enable row level security;
CREATE INDEX idx_nlm_chat_messages_notebook ON public.nlm_chat_messages USING btree (notebook_id, user_email, created_at);
create policy "nlm_chat_messages_delete" on public.nlm_chat_messages as permissive for delete to authenticated using (((user_email = (auth.jwt() ->> 'email'::text)) OR private.is_admin()));
create policy "nlm_chat_messages_insert" on public.nlm_chat_messages as permissive for insert to authenticated with check ((user_email = (auth.jwt() ->> 'email'::text)));
create policy "nlm_chat_messages_select" on public.nlm_chat_messages as permissive for select to authenticated using (((user_email = (auth.jwt() ->> 'email'::text)) OR private.is_admin()));

create table public.nlm_notebooks (
  id uuid default gen_random_uuid() not null,
  nlm_notebook_id text not null,
  title text not null,
  description text,
  is_visible boolean default false,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint nlm_notebooks_pkey PRIMARY KEY (id)
);
alter table public.nlm_notebooks enable row level security;
CREATE INDEX idx_nlm_notebooks_visible ON public.nlm_notebooks USING btree (is_visible, sort_order);
create policy "nlm_notebooks_delete" on public.nlm_notebooks as permissive for delete to authenticated using (private.is_admin());
create policy "nlm_notebooks_insert" on public.nlm_notebooks as permissive for insert to authenticated with check (private.is_admin());
create policy "nlm_notebooks_select" on public.nlm_notebooks as permissive for select to authenticated using (((is_visible = true) OR private.is_admin()));
create policy "nlm_notebooks_update" on public.nlm_notebooks as permissive for update to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.nlm_sources (
  id uuid default gen_random_uuid() not null,
  notebook_id uuid,
  nlm_source_id text not null,
  title text not null,
  source_type text not null,
  created_at timestamp with time zone default now(),
  storage_path text,
  original_filename text,
  constraint nlm_sources_notebook_id_fkey FOREIGN KEY (notebook_id) REFERENCES nlm_notebooks(id) ON DELETE CASCADE,
  constraint nlm_sources_pkey PRIMARY KEY (id)
);
alter table public.nlm_sources enable row level security;
CREATE INDEX idx_nlm_sources_notebook ON public.nlm_sources USING btree (notebook_id);
create policy "nlm_sources_delete" on public.nlm_sources as permissive for delete to authenticated using (private.is_admin());
create policy "nlm_sources_insert" on public.nlm_sources as permissive for insert to authenticated with check (private.is_admin());
create policy "nlm_sources_select" on public.nlm_sources as permissive for select to authenticated using (true);
create policy "nlm_sources_update" on public.nlm_sources as permissive for update to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.ppt_deck_versions (
  id uuid default gen_random_uuid() not null,
  deck_id uuid not null,
  no integer not null,
  status text default 'generating'::text not null,
  source_kind text not null,
  source_text text,
  source_path text,
  source_name text,
  prompt text,
  feedback text,
  base_version integer,
  deck_json jsonb,
  pptx_path text,
  yaml_path text,
  slide_count integer,
  advisories jsonb default '[]'::jsonb not null,
  check_issues jsonb default '{}'::jsonb not null,
  llm_model text,
  llm_calls integer default 0 not null,
  tokens_in integer default 0 not null,
  tokens_out integer default 0 not null,
  tokens_cache_read integer default 0 not null,
  tokens_cache_write integer default 0 not null,
  duration_ms integer,
  error text,
  sharepoint_url text,
  sharepoint_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  template_id uuid,
  template_name text,
  source_images jsonb,
  constraint ppt_deck_versions_source_kind_check CHECK ((source_kind = ANY (ARRAY['text'::text, 'file'::text, 'pptx'::text, 'url'::text]))),
  constraint ppt_deck_versions_status_check CHECK ((status = ANY (ARRAY['generating'::text, 'building'::text, 'done'::text, 'failed'::text]))),
  constraint ppt_deck_versions_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES ppt_decks(id) ON DELETE CASCADE,
  constraint ppt_deck_versions_template_id_fkey FOREIGN KEY (template_id) REFERENCES ppt_templates(id) ON DELETE SET NULL,
  constraint ppt_deck_versions_pkey PRIMARY KEY (id),
  constraint ppt_deck_versions_deck_id_no_key UNIQUE (deck_id, no)
);
alter table public.ppt_deck_versions enable row level security;
CREATE INDEX ppt_deck_versions_active_idx ON public.ppt_deck_versions USING btree (status, created_at) WHERE (status = ANY (ARRAY['generating'::text, 'building'::text]));
create policy "ppt_deck_versions_admin_read" on public.ppt_deck_versions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));
create policy "ppt_deck_versions_owner_read" on public.ppt_deck_versions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM ppt_decks d
  WHERE ((d.id = ppt_deck_versions.deck_id) AND (d.owner_id = auth.uid())))));

create table public.ppt_decks (
  id uuid default gen_random_uuid() not null,
  owner_id uuid,
  owner_email text not null,
  title text default ''::text not null,
  share_token text not null,
  share_enabled boolean default false not null,
  current_version integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint ppt_decks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint ppt_decks_pkey PRIMARY KEY (id),
  constraint ppt_decks_share_token_key UNIQUE (share_token)
);
alter table public.ppt_decks enable row level security;
CREATE INDEX ppt_decks_owner_idx ON public.ppt_decks USING btree (owner_id, updated_at DESC);
create policy "ppt_decks_admin_read" on public.ppt_decks as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));
create policy "ppt_decks_owner_read" on public.ppt_decks as permissive for select to authenticated using ((owner_id = auth.uid()));

create table public.ppt_templates (
  id uuid default gen_random_uuid() not null,
  name text not null,
  file_name text not null,
  storage_path text not null,
  bytes bigint default 0 not null,
  slides integer,
  check_issues jsonb default '{}'::jsonb not null,
  advisories jsonb default '[]'::jsonb not null,
  status text default 'active'::text not null,
  is_default boolean default false not null,
  uploaded_by uuid,
  uploaded_by_email text default ''::text not null,
  note text,
  created_at timestamp with time zone default now() not null,
  constraint ppt_templates_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
  constraint ppt_templates_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint ppt_templates_pkey PRIMARY KEY (id),
  constraint ppt_templates_storage_path_key UNIQUE (storage_path)
);
alter table public.ppt_templates enable row level security;
CREATE UNIQUE INDEX ppt_templates_one_default_idx ON public.ppt_templates USING btree (is_default) WHERE is_default;
create policy "ppt_templates_admin_read" on public.ppt_templates as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.proposal_jobs (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  owner_name text,
  project_name text not null,
  profile_id uuid not null,
  template_path text not null,
  template_name text not null,
  mode text not null,
  status text default 'queued'::text not null,
  result_path text,
  slide_count integer,
  error text,
  share_enabled boolean default false not null,
  created_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  constraint proposal_jobs_mode_check CHECK ((mode = ANY (ARRAY['restyle'::text, 'reflow'::text]))),
  constraint proposal_jobs_project_name_check CHECK (((length(btrim(project_name)) >= 1) AND (length(btrim(project_name)) <= 100))),
  constraint proposal_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text]))),
  constraint proposal_jobs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint proposal_jobs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES proposal_profiles(id),
  constraint proposal_jobs_pkey PRIMARY KEY (id)
);
alter table public.proposal_jobs enable row level security;
CREATE INDEX proposal_jobs_owner_idx ON public.proposal_jobs USING btree (owner_id, created_at DESC);
CREATE INDEX proposal_jobs_shared_idx ON public.proposal_jobs USING btree (created_at DESC) WHERE share_enabled;

create table public.proposal_profiles (
  id uuid default gen_random_uuid() not null,
  title text not null,
  as_of date,
  storage_path text not null,
  file_name text not null,
  slide_count integer not null,
  uploaded_by uuid not null,
  uploader_name text,
  hidden boolean default false not null,
  created_at timestamp with time zone default now() not null,
  constraint proposal_profiles_slide_count_check CHECK (((slide_count >= 1) AND (slide_count <= 80))),
  constraint proposal_profiles_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 100))),
  constraint proposal_profiles_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id),
  constraint proposal_profiles_pkey PRIMARY KEY (id)
);
alter table public.proposal_profiles enable row level security;
CREATE INDEX proposal_profiles_latest_idx ON public.proposal_profiles USING btree (hidden, created_at DESC);

create table public.rfp_files (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  storage_path text not null,
  original_filename text not null,
  format text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint rfp_files_format_check CHECK ((format = ANY (ARRAY['hwp'::text, 'hwpx'::text, 'docx'::text, 'xlsx'::text, 'pdf'::text]))),
  constraint rfp_files_project_id_fkey FOREIGN KEY (project_id) REFERENCES rfp_projects(id) ON DELETE CASCADE,
  constraint rfp_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_files_pkey PRIMARY KEY (id),
  constraint rfp_files_sha256_key UNIQUE (sha256)
);
alter table public.rfp_files enable row level security;
CREATE INDEX rfp_files_project_idx ON public.rfp_files USING btree (project_id, created_at DESC);
create policy "rfp_files_admin_read" on public.rfp_files as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.rfp_projects (
  id uuid default gen_random_uuid() not null,
  name text not null,
  agency text,
  period text,
  budget text,
  bid_method text,
  extra jsonb default '{}'::jsonb not null,
  name_norm text not null,
  agency_norm text,
  status text not null,
  extraction_method text,
  error text,
  warnings jsonb default '[]'::jsonb not null,
  requirement_count integer default 0 not null,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  mapping_status text default 'none'::text not null,
  mapping_error text,
  mapping_warnings jsonb default '[]'::jsonb not null,
  mapping_at timestamp with time zone,
  sharepoint_folder jsonb,
  category_summary jsonb,
  constraint rfp_projects_extraction_method_check CHECK ((extraction_method = ANY (ARRAY['standard'::text, 'llm'::text, 'xlsx'::text]))),
  constraint rfp_projects_mapping_status_check CHECK ((mapping_status = ANY (ARRAY['none'::text, 'running'::text, 'ready'::text, 'failed'::text]))),
  constraint rfp_projects_status_check CHECK ((status = ANY (ARRAY['extracting'::text, 'ready'::text, 'failed'::text]))),
  constraint rfp_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_projects_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_projects_pkey PRIMARY KEY (id)
);
alter table public.rfp_projects enable row level security;
CREATE INDEX rfp_projects_created_idx ON public.rfp_projects USING btree (created_at DESC);
CREATE UNIQUE INDEX rfp_projects_name_agency_uq ON public.rfp_projects USING btree (name_norm, agency_norm) WHERE (agency_norm IS NOT NULL);
create policy "rfp_projects_admin_read" on public.rfp_projects as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.rfp_requirement_mappings (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  requirement_id uuid not null,
  solution_code text,
  feature_id uuid,
  verdict text not null,
  rationale text default ''::text not null,
  evidence_url text,
  edited boolean default false not null,
  sort_order integer default 0 not null,
  updated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  engine text default 'manual'::text not null,
  score numeric,
  detail_key text,
  detail_text text,
  evidence_text text,
  note text,
  constraint rfp_requirement_mappings_engine_check CHECK ((engine = ANY (ARRAY['rules'::text, 'llm'::text, 'manual'::text]))),
  constraint rfp_requirement_mappings_verdict_check CHECK ((verdict = ANY (ARRAY['fulfilled'::text, 'partial'::text, 'candidate'::text, 'build'::text, 'na'::text]))),
  constraint rfp_requirement_mappings_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES rfp_solution_features(id) ON DELETE SET NULL,
  constraint rfp_requirement_mappings_project_id_fkey FOREIGN KEY (project_id) REFERENCES rfp_projects(id) ON DELETE CASCADE,
  constraint rfp_requirement_mappings_requirement_id_fkey FOREIGN KEY (requirement_id) REFERENCES rfp_requirements(id) ON DELETE CASCADE,
  constraint rfp_requirement_mappings_solution_code_fkey FOREIGN KEY (solution_code) REFERENCES rfp_solutions(code) ON DELETE SET NULL,
  constraint rfp_requirement_mappings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_requirement_mappings_pkey PRIMARY KEY (id)
);
alter table public.rfp_requirement_mappings enable row level security;
CREATE INDEX rfp_requirement_mappings_detail_idx ON public.rfp_requirement_mappings USING btree (requirement_id, detail_key, sort_order);
CREATE INDEX rfp_requirement_mappings_feature_idx ON public.rfp_requirement_mappings USING btree (feature_id);
CREATE INDEX rfp_requirement_mappings_req_idx ON public.rfp_requirement_mappings USING btree (project_id, requirement_id, sort_order);
create policy "rfp_requirement_mappings_admin_read" on public.rfp_requirement_mappings as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.rfp_requirements (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  category_code text not null,
  category_name text not null,
  req_id text not null,
  title text default ''::text not null,
  definition text default ''::text not null,
  details text default ''::text not null,
  deliverables text default ''::text not null,
  related text default ''::text not null,
  solution text default ''::text not null,
  sort_order integer not null,
  source jsonb default '{}'::jsonb not null,
  updated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint rfp_requirements_project_id_fkey FOREIGN KEY (project_id) REFERENCES rfp_projects(id) ON DELETE CASCADE,
  constraint rfp_requirements_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_requirements_pkey PRIMARY KEY (id),
  constraint rfp_requirements_project_id_req_id_key UNIQUE (project_id, req_id)
);
alter table public.rfp_requirements enable row level security;
CREATE INDEX rfp_requirements_project_idx ON public.rfp_requirements USING btree (project_id, sort_order);
create policy "rfp_requirements_admin_read" on public.rfp_requirements as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.rfp_share_links (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  token text not null,
  visibility text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  view_count integer default 0 not null,
  last_viewed_at timestamp with time zone,
  constraint rfp_share_links_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text]))),
  constraint rfp_share_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_share_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES rfp_projects(id) ON DELETE CASCADE,
  constraint rfp_share_links_pkey PRIMARY KEY (id),
  constraint rfp_share_links_token_key UNIQUE (token)
);
alter table public.rfp_share_links enable row level security;
CREATE INDEX rfp_share_links_project_idx ON public.rfp_share_links USING btree (project_id, created_at DESC);

create table public.rfp_sharepoint_uploads (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  drive_id text not null,
  item_id text not null,
  file_name text not null,
  web_url text not null,
  size_bytes bigint default 0 not null,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint rfp_sharepoint_uploads_project_id_fkey FOREIGN KEY (project_id) REFERENCES rfp_projects(id) ON DELETE CASCADE,
  constraint rfp_sharepoint_uploads_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_sharepoint_uploads_pkey PRIMARY KEY (id)
);
alter table public.rfp_sharepoint_uploads enable row level security;
CREATE INDEX rfp_sharepoint_uploads_project_idx ON public.rfp_sharepoint_uploads USING btree (project_id, created_at DESC);
create policy "rfp_sharepoint_uploads_admin_read" on public.rfp_sharepoint_uploads as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.rfp_solution_features (
  id uuid default gen_random_uuid() not null,
  solution_code text not null,
  name text not null,
  name_norm text not null,
  description text default ''::text not null,
  evidence_url text,
  source_id uuid,
  is_active boolean default true not null,
  edited boolean default false not null,
  sort_order integer default 0 not null,
  updated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  keywords text[] default '{}'::text[] not null,
  constraint rfp_solution_features_solution_code_fkey FOREIGN KEY (solution_code) REFERENCES rfp_solutions(code) ON DELETE CASCADE,
  constraint rfp_solution_features_source_id_fkey FOREIGN KEY (source_id) REFERENCES rfp_solution_sources(id) ON DELETE SET NULL,
  constraint rfp_solution_features_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_solution_features_pkey PRIMARY KEY (id),
  constraint rfp_solution_features_solution_code_name_norm_key UNIQUE (solution_code, name_norm)
);
alter table public.rfp_solution_features enable row level security;
CREATE INDEX rfp_solution_features_solution_idx ON public.rfp_solution_features USING btree (solution_code, sort_order);
create policy "rfp_solution_features_admin_read" on public.rfp_solution_features as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.rfp_solution_sources (
  id uuid default gen_random_uuid() not null,
  solution_code text not null,
  url text not null,
  page_id text not null,
  title text,
  page_version integer,
  import_status text default 'idle'::text not null,
  imported_at timestamp with time zone,
  feature_count integer default 0 not null,
  error text,
  note text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  kind text default 'confluence'::text not null,
  drive_id text,
  constraint rfp_solution_sources_import_status_check CHECK ((import_status = ANY (ARRAY['idle'::text, 'running'::text, 'ready'::text, 'failed'::text]))),
  constraint rfp_solution_sources_kind_check CHECK ((kind = ANY (ARRAY['confluence'::text, 'xlsx'::text]))),
  constraint rfp_solution_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_solution_sources_solution_code_fkey FOREIGN KEY (solution_code) REFERENCES rfp_solutions(code) ON DELETE CASCADE,
  constraint rfp_solution_sources_pkey PRIMARY KEY (id),
  constraint rfp_solution_sources_solution_code_page_id_key UNIQUE (solution_code, page_id)
);
alter table public.rfp_solution_sources enable row level security;
create policy "rfp_solution_sources_admin_read" on public.rfp_solution_sources as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.rfp_solutions (
  code text not null,
  name text not null,
  description text default ''::text not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  updated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint rfp_solutions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint rfp_solutions_pkey PRIMARY KEY (code)
);
alter table public.rfp_solutions enable row level security;
create policy "rfp_solutions_admin_read" on public.rfp_solutions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.settings (
  id uuid default gen_random_uuid() not null,
  key text not null,
  value text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint settings_pkey PRIMARY KEY (id),
  constraint settings_key_key UNIQUE (key)
);
alter table public.settings enable row level security;
create policy "settings_select" on public.settings as permissive for select to authenticated using (true);
create policy "settings_write" on public.settings as permissive for all to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.survey_answers (
  id uuid default gen_random_uuid() not null,
  response_id uuid not null,
  question_id uuid not null,
  value_text text,
  value_number numeric,
  value_json jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint survey_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES survey_questions(id) ON DELETE CASCADE,
  constraint survey_answers_response_id_fkey FOREIGN KEY (response_id) REFERENCES survey_responses(id) ON DELETE CASCADE,
  constraint survey_answers_pkey PRIMARY KEY (id),
  constraint survey_answers_response_id_question_id_key UNIQUE (response_id, question_id)
);
alter table public.survey_answers enable row level security;
CREATE INDEX survey_answers_question_id_idx ON public.survey_answers USING btree (question_id);
CREATE INDEX survey_answers_response_id_idx ON public.survey_answers USING btree (response_id);
create policy "survey_answers_delete" on public.survey_answers as permissive for delete to authenticated using ((private.is_admin() OR private.survey_response_is_writable(response_id)));
create policy "survey_answers_insert" on public.survey_answers as permissive for insert to authenticated with check (private.survey_response_is_writable(response_id));
create policy "survey_answers_insert_public" on public.survey_answers as permissive for insert to anon with check (private.survey_response_is_writable(response_id));
create policy "survey_answers_select" on public.survey_answers as permissive for select to authenticated using ((private.is_admin() OR (EXISTS ( SELECT 1
   FROM survey_responses r
  WHERE ((r.id = survey_answers.response_id) AND (r.respondent_user_id = auth.uid()))))));
create policy "survey_answers_update" on public.survey_answers as permissive for update to authenticated using ((private.survey_response_is_writable(response_id) OR private.is_admin())) with check ((private.survey_response_is_writable(response_id) OR private.is_admin()));

create table public.survey_questions (
  id uuid default gen_random_uuid() not null,
  survey_id uuid not null,
  section text,
  order_index integer default 0 not null,
  type text not null,
  title text not null,
  description text,
  required boolean default false not null,
  config jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint survey_questions_type_check CHECK ((type = ANY (ARRAY['single_choice'::text, 'multi_choice'::text, 'scale'::text, 'nps'::text, 'number'::text, 'text'::text, 'textarea'::text, 'pre_post_scale'::text]))),
  constraint survey_questions_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  constraint survey_questions_pkey PRIMARY KEY (id)
);
alter table public.survey_questions enable row level security;
CREATE INDEX survey_questions_survey_id_idx ON public.survey_questions USING btree (survey_id);
CREATE INDEX survey_questions_survey_order_idx ON public.survey_questions USING btree (survey_id, order_index);
create policy "page_access_limit" on public.survey_questions as restrictive for all to authenticated using (( SELECT has_page_access('survey'::text) AS has_page_access)) with check (( SELECT has_page_access('survey'::text) AS has_page_access));
create policy "survey_questions_select" on public.survey_questions as permissive for select to authenticated using ((private.is_admin() OR (EXISTS ( SELECT 1
   FROM surveys s
  WHERE ((s.id = survey_questions.survey_id) AND (s.status = 'open'::text))))));
create policy "survey_questions_select_public" on public.survey_questions as permissive for select to anon using ((EXISTS ( SELECT 1
   FROM surveys s
  WHERE ((s.id = survey_questions.survey_id) AND (s.status = 'open'::text) AND (s.access_mode = 'public'::text)))));
create policy "survey_questions_write" on public.survey_questions as permissive for all to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.survey_responses (
  id uuid default gen_random_uuid() not null,
  survey_id uuid not null,
  respondent_user_id uuid,
  respondent_hash text,
  is_complete boolean default false not null,
  submitted_at timestamp with time zone,
  meta jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint survey_responses_respondent_user_id_fkey FOREIGN KEY (respondent_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint survey_responses_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  constraint survey_responses_pkey PRIMARY KEY (id)
);
alter table public.survey_responses enable row level security;
CREATE INDEX survey_responses_hash_idx ON public.survey_responses USING btree (respondent_hash);
CREATE INDEX survey_responses_survey_id_idx ON public.survey_responses USING btree (survey_id);
CREATE UNIQUE INDEX survey_responses_unique_hash ON public.survey_responses USING btree (survey_id, respondent_hash) WHERE ((respondent_user_id IS NULL) AND (respondent_hash IS NOT NULL));
CREATE UNIQUE INDEX survey_responses_unique_user ON public.survey_responses USING btree (survey_id, respondent_user_id) WHERE (respondent_user_id IS NOT NULL);
CREATE INDEX survey_responses_user_id_idx ON public.survey_responses USING btree (respondent_user_id);
create policy "page_access_limit" on public.survey_responses as restrictive for all to authenticated using (( SELECT has_page_access('survey'::text) AS has_page_access)) with check (( SELECT has_page_access('survey'::text) AS has_page_access));
create policy "survey_responses_delete" on public.survey_responses as permissive for delete to authenticated using (private.is_admin());
create policy "survey_responses_insert" on public.survey_responses as permissive for insert to authenticated with check (((respondent_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM surveys s
  WHERE ((s.id = survey_responses.survey_id) AND (s.status = 'open'::text))))));
create policy "survey_responses_insert_public" on public.survey_responses as permissive for insert to anon with check (((respondent_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM surveys s
  WHERE ((s.id = survey_responses.survey_id) AND (s.status = 'open'::text) AND (s.access_mode = 'public'::text))))));
create policy "survey_responses_select" on public.survey_responses as permissive for select to authenticated using (((respondent_user_id = auth.uid()) OR private.is_admin()));
create policy "survey_responses_update" on public.survey_responses as permissive for update to authenticated using ((((respondent_user_id = auth.uid()) AND (is_complete = false)) OR private.is_admin())) with check ((((respondent_user_id = auth.uid()) AND (is_complete = ANY (ARRAY[true, false]))) OR private.is_admin()));

create table public.surveys (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  title text not null,
  description text,
  status text default 'draft'::text not null,
  access_mode text default 'authenticated'::text not null,
  is_anonymous boolean default false not null,
  opens_at timestamp with time zone,
  closes_at timestamp with time zone,
  created_by uuid,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint surveys_access_mode_check CHECK ((access_mode = ANY (ARRAY['authenticated'::text, 'public'::text]))),
  constraint surveys_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9-]*$'::text)),
  constraint surveys_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'closed'::text]))),
  constraint surveys_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint surveys_pkey PRIMARY KEY (id),
  constraint surveys_slug_key UNIQUE (slug)
);
alter table public.surveys enable row level security;
CREATE INDEX surveys_access_mode_idx ON public.surveys USING btree (access_mode);
CREATE INDEX surveys_sort_order_idx ON public.surveys USING btree (sort_order);
CREATE INDEX surveys_status_idx ON public.surveys USING btree (status);
create policy "page_access_limit" on public.surveys as restrictive for all to authenticated using (( SELECT has_page_access('survey'::text) AS has_page_access)) with check (( SELECT has_page_access('survey'::text) AS has_page_access));
create policy "surveys_delete" on public.surveys as permissive for delete to authenticated using (private.is_admin());
create policy "surveys_insert" on public.surveys as permissive for insert to authenticated with check (private.is_admin());
create policy "surveys_select" on public.surveys as permissive for select to authenticated using (((status = 'open'::text) OR private.is_admin()));
create policy "surveys_select_public" on public.surveys as permissive for select to anon using (((status = 'open'::text) AND (access_mode = 'public'::text)));
create policy "surveys_update" on public.surveys as permissive for update to authenticated using (private.is_admin()) with check (private.is_admin());

create table public.team_comments (
  id uuid default gen_random_uuid() not null,
  team_result_id uuid not null,
  author text default '익명'::text not null,
  content text not null,
  created_at timestamp with time zone default now() not null,
  constraint team_comments_team_result_id_fkey FOREIGN KEY (team_result_id) REFERENCES team_results(id) ON DELETE CASCADE,
  constraint team_comments_pkey PRIMARY KEY (id)
);
alter table public.team_comments enable row level security;
CREATE INDEX idx_team_comments_result ON public.team_comments USING btree (team_result_id);
create policy "page_access_limit" on public.team_comments as restrictive for all to authenticated using (( SELECT has_page_access('team'::text) AS has_page_access)) with check (( SELECT has_page_access('team'::text) AS has_page_access));
create policy "team_comments_delete" on public.team_comments as permissive for delete to authenticated using ((auth.uid() IS NOT NULL));
create policy "team_comments_insert" on public.team_comments as permissive for insert to authenticated with check ((auth.uid() IS NOT NULL));
create policy "team_comments_select" on public.team_comments as permissive for select to authenticated using (true);
create policy "team_comments_update" on public.team_comments as permissive for update to authenticated using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL));

create table public.team_results (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  team_name text not null,
  members jsonb default '[]'::jsonb not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  attendance jsonb default '{}'::jsonb,
  constraint team_results_session_id_fkey FOREIGN KEY (session_id) REFERENCES team_sessions(id) ON DELETE CASCADE,
  constraint team_results_pkey PRIMARY KEY (id)
);
alter table public.team_results enable row level security;
CREATE INDEX idx_team_results_session ON public.team_results USING btree (session_id);
create policy "team_results_delete" on public.team_results as permissive for delete to authenticated using ((auth.uid() IS NOT NULL));
create policy "team_results_insert" on public.team_results as permissive for insert to authenticated with check ((auth.uid() IS NOT NULL));
create policy "team_results_select" on public.team_results as permissive for select to authenticated using (true);
create policy "team_results_update" on public.team_results as permissive for update to authenticated using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL));

create table public.team_sessions (
  id uuid default gen_random_uuid() not null,
  title text,
  participants text[] not null,
  team_count integer not null,
  card_holder_distribution boolean default true not null,
  created_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  constraint team_sessions_pkey PRIMARY KEY (id)
);
alter table public.team_sessions enable row level security;
create policy "page_access_limit" on public.team_sessions as restrictive for all to authenticated using (( SELECT has_page_access('team'::text) AS has_page_access)) with check (( SELECT has_page_access('team'::text) AS has_page_access));
create policy "team_sessions_delete" on public.team_sessions as permissive for delete to authenticated using ((auth.uid() IS NOT NULL));
create policy "team_sessions_insert" on public.team_sessions as permissive for insert to authenticated with check ((auth.uid() IS NOT NULL));
create policy "team_sessions_select" on public.team_sessions as permissive for select to authenticated using (true);
create policy "team_sessions_update" on public.team_sessions as permissive for update to authenticated using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL));

create table public.user_members (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  dooray_member_id text,
  name text not null,
  is_card_holder boolean default false not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  email text,
  external_id text,
  constraint user_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_members_pkey PRIMARY KEY (id),
  constraint user_members_user_id_name_key UNIQUE (user_id, name)
);
alter table public.user_members enable row level security;
CREATE INDEX idx_user_members_user_id ON public.user_members USING btree (user_id);
create policy "user_members_delete" on public.user_members as permissive for delete to authenticated using ((user_id = auth.uid()));
create policy "user_members_insert" on public.user_members as permissive for insert to authenticated with check ((user_id = auth.uid()));
create policy "user_members_select" on public.user_members as permissive for select to authenticated using ((user_id = auth.uid()));
create policy "user_members_update" on public.user_members as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

create table public.user_page_access (
  user_id uuid not null,
  permissions jsonb default '{}'::jsonb not null,
  version integer default 1 not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid,
  constraint user_page_access_permissions_check CHECK (valid_page_permissions(permissions)),
  constraint user_page_access_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint user_page_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_page_access_pkey PRIMARY KEY (user_id)
);
alter table public.user_page_access enable row level security;
create policy "user_page_access_read" on public.user_page_access as permissive for select to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT (EXISTS ( SELECT 1
           FROM user_profiles
          WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))) AS "exists")));

create table public.user_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  email text not null,
  role text default 'user'::text not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  last_login_at timestamp with time zone,
  constraint user_roles_role_check CHECK ((role = ANY (ARRAY['guest'::text, 'user'::text, 'admin'::text]))),
  constraint user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_roles_pkey PRIMARY KEY (id),
  constraint user_roles_user_id_key UNIQUE (user_id)
);
alter table public.user_profiles enable row level security;
CREATE INDEX idx_user_roles_email ON public.user_profiles USING btree (email);
CREATE INDEX idx_user_roles_user_id ON public.user_profiles USING btree (user_id);
create policy "user_profiles_delete" on public.user_profiles as permissive for delete to authenticated using (private.is_admin());
create policy "user_profiles_insert" on public.user_profiles as permissive for insert to authenticated with check (private.is_admin());
create policy "user_profiles_select" on public.user_profiles as permissive for select to authenticated using (((user_id = auth.uid()) OR private.is_admin()));
create policy "user_profiles_update" on public.user_profiles as permissive for update to authenticated using (((user_id = auth.uid()) OR private.is_admin())) with check (((user_id = auth.uid()) OR private.is_admin()));

create table public.user_settings (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  key text not null,
  value text default ''::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_settings_pkey PRIMARY KEY (id),
  constraint user_settings_user_id_key_key UNIQUE (user_id, key)
);
alter table public.user_settings enable row level security;
CREATE INDEX idx_user_settings_user_id ON public.user_settings USING btree (user_id);
create policy "user_settings_delete" on public.user_settings as permissive for delete to authenticated using ((user_id = auth.uid()));
create policy "user_settings_insert" on public.user_settings as permissive for insert to authenticated with check ((user_id = auth.uid()));
create policy "user_settings_select" on public.user_settings as permissive for select to authenticated using (((user_id = auth.uid()) OR private.is_admin()));
create policy "user_settings_update" on public.user_settings as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

create table public.work_items (
  source text not null,
  kind text not null,
  item_key text not null,
  user_email text not null,
  scope_key text not null,
  created_at timestamp with time zone not null,
  started_at timestamp with time zone,
  done_at timestamp with time zone,
  story_points numeric,
  is_claude boolean default false not null,
  extra jsonb,
  synced_at timestamp with time zone default now() not null,
  constraint work_items_pkey PRIMARY KEY (source, kind, item_key)
);
alter table public.work_items enable row level security;
CREATE INDEX work_items_created_idx ON public.work_items USING btree (created_at);
CREATE INDEX work_items_done_idx ON public.work_items USING btree (done_at);
CREATE INDEX work_items_email_idx ON public.work_items USING btree (user_email, done_at DESC);
create policy "work_items_admin_read" on public.work_items as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.work_metrics_sync (
  id bigint not null,
  source text not null,
  range_from date not null,
  range_to date not null,
  rows integer default 0 not null,
  ok boolean default true not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint work_metrics_sync_pkey PRIMARY KEY (id)
);
alter table public.work_metrics_sync enable row level security;
CREATE INDEX work_metrics_sync_source_idx ON public.work_metrics_sync USING btree (source, created_at DESC);
create policy "work_metrics_sync_admin_read" on public.work_metrics_sync as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.user_id = auth.uid()) AND (up.role = 'admin'::text)))));

create table public.yonhap_notice_email_deliveries (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  send_date date not null,
  scheduled_for timestamp with time zone not null,
  period_from timestamp with time zone not null,
  period_to timestamp with time zone not null,
  status text default 'processing'::text not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  item_count integer default 0 not null,
  provider_id text,
  error_message text,
  constraint yonhap_notice_email_deliveries_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'sent'::text, 'failed'::text, 'cancelled'::text]))),
  constraint yonhap_notice_email_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint yonhap_notice_email_deliveries_pkey PRIMARY KEY (id),
  constraint yonhap_notice_email_deliveries_user_id_send_date_key UNIQUE (user_id, send_date)
);
alter table public.yonhap_notice_email_deliveries enable row level security;
CREATE INDEX yonhap_notice_email_deliveries_user_idx ON public.yonhap_notice_email_deliveries USING btree (user_id, started_at DESC);
create policy "page_access_limit" on public.yonhap_notice_email_deliveries as restrictive for all to authenticated using (( SELECT has_page_access('people_news'::text) AS has_page_access)) with check (( SELECT has_page_access('people_news'::text) AS has_page_access));
create policy "yonhap_notice_email_delivery_own" on public.yonhap_notice_email_deliveries as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

create table public.yonhap_notice_manual_deliveries (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  period_from timestamp with time zone not null,
  period_to timestamp with time zone default now() not null,
  status text default 'processing'::text not null,
  finished_at timestamp with time zone,
  item_count integer default 0 not null,
  provider_id text,
  error_message text,
  constraint yonhap_notice_manual_deliveries_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))),
  constraint yonhap_notice_manual_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint yonhap_notice_manual_deliveries_pkey PRIMARY KEY (id)
);
alter table public.yonhap_notice_manual_deliveries enable row level security;
CREATE INDEX yonhap_manual_delivery_user_idx ON public.yonhap_notice_manual_deliveries USING btree (user_id, period_to DESC);

create table public.yonhap_notice_manual_sync_gate (
  singleton boolean default true not null,
  requested_at timestamp with time zone not null,
  constraint yonhap_notice_manual_sync_gate_singleton_check CHECK (singleton),
  constraint yonhap_notice_manual_sync_gate_pkey PRIMARY KEY (singleton)
);
alter table public.yonhap_notice_manual_sync_gate enable row level security;

create table public.yonhap_notice_subscriptions (
  user_id uuid not null,
  enabled boolean default false not null,
  send_time time without time zone default '07:10:00'::time without time zone not null,
  next_send_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  exclude_sent boolean default true not null,
  constraint yonhap_notice_subscriptions_send_time_check CHECK ((EXTRACT(second FROM send_time) = (0)::numeric)),
  constraint yonhap_notice_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint yonhap_notice_subscriptions_pkey PRIMARY KEY (user_id)
);
alter table public.yonhap_notice_subscriptions enable row level security;
CREATE INDEX yonhap_notice_subscriptions_due_idx ON public.yonhap_notice_subscriptions USING btree (next_send_at) WHERE enabled;
create policy "page_access_limit" on public.yonhap_notice_subscriptions as restrictive for all to authenticated using (( SELECT has_page_access('people_news'::text) AS has_page_access)) with check (( SELECT has_page_access('people_news'::text) AS has_page_access));
create policy "yonhap_notice_subscription_own" on public.yonhap_notice_subscriptions as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

create table public.yonhap_notice_sync_runs (
  id bigint not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  status text not null,
  trigger_source text default 'cron'::text not null,
  item_count integer default 0 not null,
  error_message text,
  constraint yonhap_notice_sync_runs_item_count_check CHECK ((item_count >= 0)),
  constraint yonhap_notice_sync_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text]))),
  constraint yonhap_notice_sync_runs_trigger_source_check CHECK ((trigger_source = ANY (ARRAY['cron'::text, 'manual'::text]))),
  constraint yonhap_notice_sync_runs_pkey PRIMARY KEY (id)
);
alter table public.yonhap_notice_sync_runs enable row level security;
CREATE INDEX yonhap_notice_sync_runs_started_idx ON public.yonhap_notice_sync_runs USING btree (started_at DESC);
CREATE INDEX yonhap_notice_sync_runs_success_idx ON public.yonhap_notice_sync_runs USING btree (finished_at DESC) WHERE (status = 'success'::text);
create policy "page_access_limit" on public.yonhap_notice_sync_runs as restrictive for all to authenticated using (( SELECT has_page_access('people_news'::text) AS has_page_access)) with check (( SELECT has_page_access('people_news'::text) AS has_page_access));
create policy "yonhap_notice_sync_runs_read" on public.yonhap_notice_sync_runs as permissive for select to authenticated using (( SELECT (EXISTS ( SELECT 1
           FROM user_profiles
          WHERE ((user_profiles.user_id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = ANY (ARRAY['user'::text, 'admin'::text]))))) AS "exists"));

create table public.yonhap_notices (
  source_id text not null,
  category text not null,
  title text not null,
  summary text default ''::text not null,
  source_url text not null,
  published_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null,
  fetched_at timestamp with time zone default now() not null,
  constraint yonhap_notices_category_check CHECK ((category = ANY (ARRAY['personnel'::text, 'obituary'::text]))),
  constraint yonhap_notices_check CHECK ((source_url = ('https://www.yna.co.kr/view/'::text || source_id))),
  constraint yonhap_notices_source_id_check CHECK ((source_id ~ '^AKR[0-9]+$'::text)),
  constraint yonhap_notices_pkey PRIMARY KEY (source_id)
);
alter table public.yonhap_notices enable row level security;
CREATE INDEX yonhap_notices_category_published_idx ON public.yonhap_notices USING btree (category, published_at DESC, source_id DESC);
CREATE INDEX yonhap_notices_created_idx ON public.yonhap_notices USING btree (created_at);
CREATE INDEX yonhap_notices_published_idx ON public.yonhap_notices USING btree (published_at DESC, source_id DESC);
create policy "page_access_limit" on public.yonhap_notices as restrictive for all to authenticated using (( SELECT has_page_access('people_news'::text) AS has_page_access)) with check (( SELECT has_page_access('people_news'::text) AS has_page_access));
create policy "yonhap_notices_read" on public.yonhap_notices as permissive for select to authenticated using (( SELECT (EXISTS ( SELECT 1
           FROM user_profiles
          WHERE ((user_profiles.user_id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = ANY (ARRAY['user'::text, 'admin'::text]))))) AS "exists"));

-- 뷰
create view public.audit_log as
 SELECT 'login'::text AS kind,
    l.id,
    l.logged_in_at AS at,
    l.user_id,
    p.email AS user_email,
    p.display_name AS user_name,
    'auth'::text AS category,
    '로그인'::text AS action,
    '{}'::jsonb AS detail,
    ''::text AS detail_text,
    l.ip_address,
    l.user_agent
   FROM (login_history l
     LEFT JOIN user_profiles p ON ((p.user_id = l.user_id)))
UNION ALL
 SELECT
        CASE
            WHEN (a.source = 'api'::text) THEN 'api'::text
            WHEN ((a.category = 'auth'::text) AND ((a.detail ->> 'result'::text) = ANY (ARRAY['failure'::text, 'blocked'::text]))) THEN 'login_failed'::text
            WHEN ((a.category = 'auth'::text) AND ((a.detail ->> 'result'::text) = 'attempt'::text)) THEN 'login_attempt'::text
            ELSE 'action'::text
        END AS kind,
    a.id,
    a.created_at AS at,
    a.user_id,
    COALESCE(a.user_email, p.email, pe.email) AS user_email,
    COALESCE(p.display_name, pe.display_name) AS user_name,
    a.category,
    a.action,
    COALESCE(a.detail, '{}'::jsonb) AS detail,
    COALESCE((a.detail)::text, ''::text) AS detail_text,
    a.ip_address,
    a.user_agent
   FROM ((action_history a
     LEFT JOIN user_profiles p ON ((p.user_id = a.user_id)))
     LEFT JOIN user_profiles pe ON (((a.user_id IS NULL) AND (lower(pe.email) = lower(a.user_email)))));

-- 함수
CREATE OR REPLACE FUNCTION public.chat_usage_add(p_user uuid, p_day date, p_model text, p_in integer, p_out integer, p_masked integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.assistant_usage as u (user_id, day, turns, input_tokens, output_tokens, model_turns, masked)
  values (p_user, p_day, 1, p_in, p_out, jsonb_build_object(p_model, 1), p_masked)
  on conflict (user_id, day) do update set
    turns = u.turns + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    masked = u.masked + excluded.masked,
    model_turns = u.model_turns || jsonb_build_object(p_model, coalesce((u.model_turns->>p_model)::int, 0) + 1);
$function$;

CREATE OR REPLACE FUNCTION public.claim_yonhap_notice_emails(p_limit integer DEFAULT 20)
 RETURNS TABLE(delivery_id uuid, recipient_id uuid, recipient_email text, period_from timestamp with time zone, period_to timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  due record;
  delivery public.yonhap_notice_email_deliveries;
  period_start timestamptz;
begin
  update public.yonhap_notice_email_deliveries set status = 'failed', finished_at = now(), error_message = '발송 작업이 중단되었습니다.'
    where status = 'processing' and started_at < now() - interval '10 minutes';
  for due in
    select s.*, u.email from public.yonhap_notice_subscriptions s
    join auth.users u on u.id = s.user_id and u.email_confirmed_at is not null
    join public.user_profiles p on p.user_id = s.user_id and p.role in ('user', 'admin')
    where s.enabled and s.next_send_at <= now()
    order by s.next_send_at for update of s skip locked limit least(greatest(p_limit, 1), 50)
  loop
    update public.yonhap_notice_subscriptions set next_send_at =
      (((now() at time zone 'Asia/Seoul')::date + 1) + due.send_time) at time zone 'Asia/Seoul'
      where user_id = due.user_id;
    if due.exclude_sent then
      period_start := coalesce(public.yonhap_notice_last_sent_all(due.user_id), now() - interval '1 day');
    else
      select coalesce(max(e.period_to), now() - interval '1 day') into period_start
        from public.yonhap_notice_email_deliveries e where e.user_id = due.user_id and e.status = 'sent';
    end if;
    insert into public.yonhap_notice_email_deliveries (user_id, send_date, scheduled_for, period_from, period_to)
      values (due.user_id, (now() at time zone 'Asia/Seoul')::date, due.next_send_at, period_start, now())
      on conflict (user_id, send_date) do nothing returning * into delivery;
    if found then
      delivery_id := delivery.id; recipient_id := due.user_id; recipient_email := due.email;
      period_from := delivery.period_from; period_to := delivery.period_to;
      return next;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_yonhap_notice_manual_sync()
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  with claimed as (
    insert into public.yonhap_notice_manual_sync_gate (singleton, requested_at)
    values (true, clock_timestamp())
    on conflict (singleton) do update set requested_at = excluded.requested_at
      where public.yonhap_notice_manual_sync_gate.requested_at < clock_timestamp() - interval '1 minute'
    returning singleton
  ) select exists (select 1 from claimed);
$function$;

CREATE OR REPLACE FUNCTION public.claim_yonhap_notice_send_now(p_exclude_sent boolean DEFAULT NULL::boolean)
 RETURNS TABLE(delivery_id uuid, period_from timestamp with time zone, period_to timestamp with time zone, excluded boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare caller uuid := auth.uid(); claimed public.yonhap_notice_manual_deliveries; v_exclude boolean; v_from timestamptz;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id=caller and role in ('user','admin')) then
    raise exception 'User permission required' using errcode='42501';
  end if;
  if not exists (select 1 from auth.users where id=caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode='22023';
  end if;
  v_exclude := coalesce(p_exclude_sent, (select s.exclude_sent from public.yonhap_notice_subscriptions s where s.user_id = caller), true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('yonhap-send-now:' || caller::text,0));
  if exists (select 1 from public.yonhap_notice_manual_deliveries m where m.user_id=caller and m.period_to > now()-interval '1 minute') then
    return;
  end if;
  v_from := case when v_exclude then coalesce(public.yonhap_notice_last_sent_all(caller), now()-interval '24 hours')
                 else now()-interval '24 hours' end;
  insert into public.yonhap_notice_manual_deliveries(user_id,period_from,period_to)
    values(caller, v_from, now()) returning * into claimed;
  return query select claimed.id, claimed.period_from, claimed.period_to, v_exclude;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claude_code_accountless_candidates(p_from date, p_to date)
 RETURNS TABLE(user_id text, days bigint, prompts numeric, sessions numeric, cost_usd numeric, first_day date, last_day date, os_type text, host_arch text, app_version text, terminal_type text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with usage as (
    select substring(d.user_email from 4) as user_id, count(distinct d.day)::bigint as days,
           sum(d.prompts) as prompts, sum(d.sessions) as sessions, sum(d.cost_usd) as cost_usd,
           min(d.day) as first_day, max(d.day) as last_day
    from claude_code_daily d
    where d.day between p_from and p_to and d.user_email like 'id:%'
    group by 1
  ), env as (
    select distinct on (substring(e.user_email from 4))
           substring(e.user_email from 4) as user_id, e.os_type, e.host_arch, e.app_version, e.terminal_type
    from claude_code_env_daily e
    where e.day between p_from and p_to and e.user_email like 'id:%'
    order by substring(e.user_email from 4), e.points desc, e.day desc
  )
  select u.user_id, u.days, u.prompts, u.sessions, u.cost_usd, u.first_day, u.last_day,
         coalesce(env.os_type, ''), coalesce(env.host_arch, ''), coalesce(env.app_version, ''), coalesce(env.terminal_type, '')
  from usage u left join env on env.user_id = u.user_id
  order by u.cost_usd desc, u.days desc;
$function$;

CREATE OR REPLACE FUNCTION public.claude_code_env_ingest(p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into claude_orgs (id, name)
  select distinct x->>'org_id', left(x->>'org_id', 8)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  where coalesce(x->>'org_id', '') <> ''
  on conflict (id) do nothing;

  insert into claude_code_env_daily (day, org_id, user_email, os_type, host_arch, app_version, terminal_type, points)
  select (x->>'day')::date, x->>'org_id', x->>'user_email',
         left(coalesce(x->>'os_type', ''), 40), left(coalesce(x->>'host_arch', ''), 40),
         left(coalesce(x->>'app_version', ''), 40), left(coalesce(x->>'terminal_type', ''), 60),
         coalesce((x->>'points')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  where coalesce(x->>'day', '') <> '' and coalesce(x->>'org_id', '') <> '' and coalesce(x->>'user_email', '') <> ''
  on conflict (day, org_id, user_email, os_type, host_arch, app_version, terminal_type) do update set
    points = claude_code_env_daily.points + excluded.points;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claude_code_hourly(p_from date, p_to date, p_org text DEFAULT NULL::text)
 RETURNS TABLE(dow integer, hour integer, requests bigint, cost_usd numeric, users bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select extract(dow  from r.ts at time zone 'Asia/Seoul')::int,
         extract(hour from r.ts at time zone 'Asia/Seoul')::int,
         count(*), coalesce(sum(r.cost_usd), 0), count(distinct r.user_email)
  from claude_code_requests r
  where r.ts >= (p_from::timestamp at time zone 'Asia/Seoul')
    and r.ts <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    and (p_org is null or r.org_id = p_org
         or (p_org in ('personal', 'team') and r.org_id in (select o.id from claude_orgs o where o.category = p_org)))
  group by 1, 2;
$function$;

CREATE OR REPLACE FUNCTION public.claude_code_hourly_emails(p_from date, p_to date, p_emails text[])
 RETURNS TABLE(dow integer, hour integer, requests bigint, cost_usd numeric, users bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    extract(isodow from (ts at time zone 'Asia/Seoul'))::int as dow,
    extract(hour   from (ts at time zone 'Asia/Seoul'))::int as hour,
    count(*)::bigint as requests,
    coalesce(sum(cost_usd), 0)::numeric as cost_usd,
    count(distinct lower(user_email))::bigint as users
  from claude_code_requests
  where ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and lower(user_email) = any (p_emails)
  group by 1, 2
$function$;

CREATE OR REPLACE FUNCTION public.claude_code_ingest(p_daily jsonb, p_model jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into claude_orgs (id, name)
  select distinct x->>'org_id', left(x->>'org_id', 8)
  from jsonb_array_elements(coalesce(p_daily, '[]'::jsonb)) x
  where coalesce(x->>'org_id', '') <> ''
  on conflict (id) do nothing;

  insert into claude_code_daily (day, org_id, user_email, account_uuid,
    sessions, prompts, prompts_auto, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    loc_added, loc_removed, edits_accepted, edits_rejected, commits, pull_requests,
    active_user_seconds, active_cli_seconds)
  select (x->>'day')::date, x->>'org_id', x->>'user_email', nullif(x->>'account_uuid', ''),
    coalesce((x->>'sessions')::numeric, 0), coalesce((x->>'prompts')::numeric, 0), coalesce((x->>'prompts_auto')::numeric, 0),
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
    prompts_auto = claude_code_daily.prompts_auto + excluded.prompts_auto,
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
$function$;

CREATE OR REPLACE FUNCTION public.claude_code_tool_ingest(p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into claude_orgs (id, name)
  select distinct x->>'org_id', left(x->>'org_id', 8)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  where coalesce(x->>'org_id', '') <> ''
  on conflict (id) do nothing;

  insert into claude_code_tool_daily (day, org_id, user_email, tool_name, calls, errors, duration_ms_sum, accepts, rejects)
  select (x->>'day')::date, x->>'org_id', x->>'user_email', coalesce(nullif(x->>'tool_name', ''), 'unknown'),
         coalesce((x->>'calls')::numeric, 0), coalesce((x->>'errors')::numeric, 0), coalesce((x->>'duration_ms_sum')::numeric, 0),
         coalesce((x->>'accepts')::numeric, 0), coalesce((x->>'rejects')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  on conflict (day, org_id, user_email, tool_name) do update set
    calls = claude_code_tool_daily.calls + excluded.calls,
    errors = claude_code_tool_daily.errors + excluded.errors,
    duration_ms_sum = claude_code_tool_daily.duration_ms_sum + excluded.duration_ms_sum,
    accepts = claude_code_tool_daily.accepts + excluded.accepts,
    rejects = claude_code_tool_daily.rejects + excluded.rejects;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claude_code_tool_summary(p_from date, p_to date, p_org text DEFAULT NULL::text)
 RETURNS TABLE(tool_name text, calls numeric, errors numeric, duration_ms_sum numeric, accepts numeric, rejects numeric, users bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.tool_name, sum(t.calls), sum(t.errors), sum(t.duration_ms_sum), sum(t.accepts), sum(t.rejects), count(distinct t.user_email)
  from claude_code_tool_daily t
  where t.day between p_from and p_to
    and (p_org is null or t.org_id = p_org
         or (p_org in ('personal', 'team') and t.org_id in (select o.id from claude_orgs o where o.category = p_org)))
  group by t.tool_name
  order by sum(t.calls) desc;
$function$;

CREATE OR REPLACE FUNCTION public.claude_office_usage(p_from date, p_to date, p_emails text[] DEFAULT NULL::text[], p_org text DEFAULT NULL::text)
 RETURNS TABLE(day date, org_id text, user_email text, surface text, turns bigint, sessions bigint, model_calls bigint, input_tokens numeric, output_tokens numeric, cache_read_tokens numeric, cache_creation_tokens numeric, tool_calls bigint, tool_errors bigint, file_uploads bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin return query   with q as (
    select trace_id, lower(user_email) as user_email, org_id, coalesce(surface, 'unknown') as surface, session_id,
           (coalesce(span_start, received_at) at time zone 'Asia/Seoul')::date as day
    from claude_office_trace_log
    where span_name = 'agent.query' and trace_id is not null and user_email is not null
      and (coalesce(span_start, received_at) at time zone 'Asia/Seoul')::date between p_from and p_to
      and (p_emails is null or lower(user_email) = any (p_emails))
      and (p_org is null or org_id = p_org)
  ),
  c as (
    select l.trace_id,
           count(*) filter (where l.span_name = 'agent.stream') as model_calls,
           coalesce(sum(l.input_tokens) filter (where l.span_name = 'agent.stream'), 0) as input_tokens,
           coalesce(sum(l.output_tokens) filter (where l.span_name = 'agent.stream'), 0) as output_tokens,
           coalesce(sum(l.cache_read_tokens) filter (where l.span_name = 'agent.stream'), 0) as cache_read_tokens,
           coalesce(sum(l.cache_creation_tokens) filter (where l.span_name = 'agent.stream'), 0) as cache_creation_tokens,
           count(*) filter (where l.span_name = 'agent.tool_execution') as tool_calls,
           count(*) filter (where l.span_name = 'agent.tool_execution' and l.tool_success = false) as tool_errors
    from claude_office_trace_log l
    where l.trace_id in (select trace_id from q)
    group by l.trace_id
  ),
  agg as (
    select q.day, q.org_id, q.user_email, q.surface,
           count(*)::bigint as turns,
           count(distinct q.session_id)::bigint as sessions,
           coalesce(sum(c.model_calls), 0)::bigint as model_calls,
           coalesce(sum(c.input_tokens), 0)::numeric as input_tokens,
           coalesce(sum(c.output_tokens), 0)::numeric as output_tokens,
           coalesce(sum(c.cache_read_tokens), 0)::numeric as cache_read_tokens,
           coalesce(sum(c.cache_creation_tokens), 0)::numeric as cache_creation_tokens,
           coalesce(sum(c.tool_calls), 0)::bigint as tool_calls,
           coalesce(sum(c.tool_errors), 0)::bigint as tool_errors
    from q left join c on c.trace_id = q.trace_id
    group by q.day, q.org_id, q.user_email, q.surface
  ),
  f as (
    -- 파일 업로드는 같은 세션의 표면에 귀속(세션은 한 표면에서만 생긴다)
    select s.day, s.org_id, s.user_email, s.surface, count(*)::bigint as file_uploads
    from claude_office_trace_log fu
    join (select distinct day, org_id, user_email, surface, session_id from q) s
      on s.user_email = lower(fu.user_email) and s.session_id = fu.session_id
    where fu.span_name = 'file.upload'
    group by s.day, s.org_id, s.user_email, s.surface
  )
  select a.day, a.org_id, a.user_email, a.surface, a.turns, a.sessions, a.model_calls,
         a.input_tokens, a.output_tokens, a.cache_read_tokens, a.cache_creation_tokens,
         a.tool_calls, a.tool_errors, coalesce(f.file_uploads, 0)::bigint as file_uploads
  from agg a
  left join f on f.day = a.day and f.org_id is not distinct from a.org_id and f.user_email = a.user_email and f.surface = a.surface
  order by a.day, a.user_email, a.surface; end $function$;

CREATE OR REPLACE FUNCTION public.claude_seat_action_claim(p_executor text)
 RETURNS SETOF claude_seat_actions
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.claude_seat_actions a
     set status = 'running', started_at = now(), executor = p_executor
   where a.id = (
     select id from public.claude_seat_actions
      where status = 'requested'
      order by requested_at
      limit 1
      for update skip locked
   )
  returning a.*;
$function$;

CREATE OR REPLACE FUNCTION public.get_survey_aggregate(p_survey_id uuid, p_segments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_resp_ids      uuid[];
  v_total         integer;
  v_all_total     integer;
  v_complete_rate numeric;
  v_avg_dur       numeric;
  v_questions     jsonb := '[]'::jsonb;
  v_q             record;
  v_card          jsonb;
  v_qn            integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden';
  end if;

  -- Segment AND(across) + OR(within), branch by question type (single→value_text, multi→value_json overlap)
  with seg as (
    select (e->>'question_id')::uuid as qid,
           array(select jsonb_array_elements_text(e->'values')) as vals
    from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) e
  ),
  seg_typed as (
    select s.qid, s.vals, q.type
    from seg s
    join public.survey_questions q on q.id = s.qid
  ),
  filtered as (
    select r.id, r.meta
    from public.survey_responses r
    where r.survey_id = p_survey_id
      and r.is_complete = true
      and not exists (
        select 1 from seg_typed s
        where not exists (
          select 1 from public.survey_answers a
          where a.response_id = r.id
            and a.question_id = s.qid
            and (
              (s.type = 'multi_choice'
                and a.value_json is not null
                and exists (
                  select 1 from jsonb_array_elements_text(a.value_json) ev
                  where ev = any(s.vals)
                ))
              or (s.type <> 'multi_choice' and a.value_text = any(s.vals))
            )
        )
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[]), count(*),
         avg(nullif(meta->>'duration_sec','')::numeric)
  into v_resp_ids, v_total, v_avg_dur
  from filtered;

  select count(*) into v_all_total
  from public.survey_responses where survey_id = p_survey_id;

  v_complete_rate := case when v_all_total > 0
    then round(v_total * 100.0 / v_all_total, 1) else 0 end;

  for v_q in
    select * from public.survey_questions
    where survey_id = p_survey_id order by order_index
  loop
    select count(*) into v_qn
    from public.survey_answers a
    where a.question_id = v_q.id and a.response_id = any(v_resp_ids)
      and (a.value_text is not null or a.value_number is not null or a.value_json is not null);

    if v_qn < 5 then
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', v_q.type, 'title', v_q.title, 'n', v_qn, 'masked', true);

    elsif v_q.type = 'single_choice' then
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', 'single_choice', 'title', v_q.title, 'n', v_qn, 'masked', false,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'value', opt->>'value', 'label', opt->>'label', 'n', coalesce(c.n,0),
            'pct', case when v_qn>0 then round(coalesce(c.n,0)*100.0/v_qn,1) else 0 end))
          from jsonb_array_elements(coalesce(v_q.config->'options','[]'::jsonb)) opt
          left join (
            select value_text v, count(*) n from public.survey_answers
            where question_id = v_q.id and response_id = any(v_resp_ids) and value_text is not null
            group by value_text) c on c.v = opt->>'value'), '[]'::jsonb));

    elsif v_q.type = 'multi_choice' then
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', 'multi_choice', 'title', v_q.title, 'n', v_qn, 'masked', false, 'respondent_n', v_qn,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'value', opt->>'value', 'label', opt->>'label', 'n', coalesce(c.n,0),
            'pct', case when v_qn>0 then round(coalesce(c.n,0)*100.0/v_qn,1) else 0 end))
          from jsonb_array_elements(coalesce(v_q.config->'options','[]'::jsonb)) opt
          left join (
            select elem v, count(*) n
            from public.survey_answers a, lateral jsonb_array_elements_text(a.value_json) elem
            where a.question_id = v_q.id and a.response_id = any(v_resp_ids) and a.value_json is not null
            group by elem) c on c.v = opt->>'value'), '[]'::jsonb));

    elsif v_q.type = 'nps' then
      declare v_prom numeric; v_pass numeric; v_detr numeric;
      begin
        select round(count(*) filter (where value_number>=9)*100.0/nullif(v_qn,0),1),
               round(count(*) filter (where value_number between 7 and 8)*100.0/nullif(v_qn,0),1),
               round(count(*) filter (where value_number<=6)*100.0/nullif(v_qn,0),1)
        into v_prom, v_pass, v_detr
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'nps', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n', v_qn,
            'score', round(coalesce(v_prom,0)-coalesce(v_detr,0),1),
            'promoters_pct', coalesce(v_prom,0), 'passives_pct', coalesce(v_pass,0),
            'detractors_pct', coalesce(v_detr,0)));
      end;

    elsif v_q.type = 'scale' then
      declare v_mean numeric; v_med numeric; v_sd numeric; v_min numeric; v_max numeric;
              v_dist jsonb; v_topbox numeric;
      begin
        select avg(value_number), percentile_cont(0.5) within group (order by value_number),
               stddev_samp(value_number), min(value_number), max(value_number)
        into v_mean, v_med, v_sd, v_min, v_max
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        select jsonb_agg(jsonb_build_object('value', val, 'n', cnt) order by val) into v_dist
        from (select value_number::int val, count(*) cnt from public.survey_answers
              where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null
              group by value_number::int) d;
        -- MANDATORY FIX: numeric coercion for top_box (config stores strings like "4","5")
        if v_q.config ? 'top_box' then
          select round(count(*) filter (where value_number::int = any(
                   array(select x::int from jsonb_array_elements_text(v_q.config->'top_box') x)))*100.0/nullif(v_qn,0),1)
          into v_topbox from public.survey_answers
          where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        else v_topbox := null; end if;
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'scale', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n', v_qn, 'mean', round(v_mean,2), 'median', v_med,
            'sd', round(v_sd,2), 'min', v_min, 'max', v_max,
            'distribution', coalesce(v_dist,'[]'::jsonb), 'top_box_pct', v_topbox));
      end;

    elsif v_q.type = 'number' then
      declare v_mean numeric; v_med numeric; v_sum numeric; v_min numeric; v_max numeric;
              v_trim numeric; v_zero numeric;
      begin
        select avg(value_number), percentile_cont(0.5) within group (order by value_number),
               sum(value_number), min(value_number), max(value_number),
               round(count(*) filter (where value_number=0)*100.0/nullif(v_qn,0),1)
        into v_mean, v_med, v_sum, v_min, v_max, v_zero
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        select avg(value_number) into v_trim from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null
          and value_number <= (select percentile_cont(0.95) within group (order by value_number)
            from public.survey_answers
            where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null);
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'number', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n', v_qn, 'mean', round(v_mean,2), 'median', v_med,
            'sum', v_sum, 'min', v_min, 'max', v_max, 'mean_trimmed', round(v_trim,2),
            'zero_pct', coalesce(v_zero,0), 'unit', v_q.config->>'unit'));
      end;

    elsif v_q.type = 'pre_post_scale' then
      declare v_npair int; v_bmean numeric; v_amean numeric; v_bdist jsonb; v_adist jsonb;
      begin
        select count(*), avg((value_json->>'before')::numeric), avg((value_json->>'after')::numeric)
        into v_npair, v_bmean, v_amean
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids)
          and value_json ? 'before' and value_json ? 'after'
          and value_json->>'before' is not null and value_json->>'after' is not null;
        select jsonb_agg(jsonb_build_object('value', val, 'n', cnt) order by val) into v_bdist
        from (select (value_json->>'before')::int val, count(*) cnt from public.survey_answers
              where question_id = v_q.id and response_id = any(v_resp_ids)
                and value_json ? 'before' and value_json ? 'after'
              group by (value_json->>'before')::int) d;
        select jsonb_agg(jsonb_build_object('value', val, 'n', cnt) order by val) into v_adist
        from (select (value_json->>'after')::int val, count(*) cnt from public.survey_answers
              where question_id = v_q.id and response_id = any(v_resp_ids)
                and value_json ? 'before' and value_json ? 'after'
              group by (value_json->>'after')::int) d;
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'pre_post_scale', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n_pairwise', coalesce(v_npair,0),
            'before_mean', round(v_bmean,2), 'after_mean', round(v_amean,2),
            'delta_mean', round(v_amean - v_bmean, 2),
            'improvement_pct', case when v_bmean > 0 then round((v_amean - v_bmean)*100.0/v_bmean,1) else null end,
            'before_distribution', coalesce(v_bdist,'[]'::jsonb),
            'after_distribution', coalesce(v_adist,'[]'::jsonb)));
      end;

    else -- text / textarea
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', v_q.type, 'title', v_q.title, 'n', v_qn, 'masked', false, 'text_n', v_qn);
    end if;

    -- KPI runtime meta (for survey-metrics only, components do not reference)
    v_card := v_card || jsonb_build_object(
      'analysis_metric', v_q.config->>'analysis_metric',
      'target', case when v_q.config ? 'target' then (v_q.config->>'target')::numeric else null end,
      'top_box', coalesce(v_q.config->'top_box', '[]'::jsonb),
      'option_midpoints', coalesce(v_q.config->'option_midpoints', '{}'::jsonb));

    v_questions := v_questions || jsonb_build_array(v_card);
  end loop;

  return jsonb_build_object(
    'survey_id', p_survey_id, 'total_responses', v_total,
    'complete_rate', v_complete_rate, 'avg_duration_sec', round(coalesce(v_avg_dur,0)),
    'segments_applied', coalesce(p_segments, '[]'::jsonb), 'questions', v_questions);
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.user_profiles (user_id, email, role, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN NEW.email = 'abraxas73@gmail.com' THEN 'admin' ELSE 'user' END,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_page_access(p_page text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail','dooray','assistant','proposal')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$function$;

CREATE OR REPLACE FUNCTION public.invoke_yonhap_notice_email()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare project_url text; sync_secret text; request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'yonhap_project_url';
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'yonhap_sync_secret';
  if project_url is null or project_url !~ '^https://' or sync_secret is null or length(sync_secret) < 32 then
    raise exception 'Yonhap sync Vault secrets are missing';
  end if;
  select net.http_post(
    url := project_url || '/functions/v1/yonhap-notices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || sync_secret),
    body := '{"action":"send-digests"}'::jsonb, timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_yonhap_notices_sync()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  project_url text;
  sync_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'yonhap_project_url';
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'yonhap_sync_secret';
  if project_url is null or sync_secret is null or length(sync_secret) < 32 then
    raise exception 'Yonhap sync Vault secrets are missing';
  end if;
  select net.http_post(
    url := project_url || '/functions/v1/yonhap-notices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_access_account(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.user_profiles p where p.user_id=p_user and p.role in ('user','admin') and (public.marketing_manager_account(p_user) or exists(select 1 from public.marketing_reviewers r where r.user_id=p_user)));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_can_manage_reviewers()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select public.marketing_manager_account(auth.uid()); $function$;

CREATE OR REPLACE FUNCTION public.marketing_can_review()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.has_page_access('marketing') and (public.marketing_can_manage_reviewers() or exists(select 1 from public.marketing_reviewers where user_id=auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_category_valid(p text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(p in ('IT기업','솔루션·제품사','공공기관','확인 필요','기타','교육·연구','제조사','금융','협회·단체','언론'),false);
$function$;

CREATE OR REPLACE FUNCTION public.marketing_change_reviewer(p_user uuid, p_enabled boolean, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior jsonb; updated jsonb; ident jsonb;
begin
 if not public.marketing_can_manage_reviewers() then raise exception '강승억·김하연 검수 관리자만 검수자를 지정·해제할 수 있습니다.' using errcode='42501'; end if;
 if p_enabled is null then raise exception '지정 여부가 필요합니다.' using errcode='22023'; end if;
 perform 1 from public.user_profiles where user_id=p_user for update;
 if not found then raise exception '등록된 사용자 계정이 필요합니다.' using errcode='22023'; end if;
 prior:=public.marketing_reviewer_details(p_user);
 if public.marketing_manager_account(p_user) then raise exception '고정 검수 관리자는 지정·해제 대상이 아닙니다.' using errcode='42501'; end if;
 if p_enabled and prior->>'role' not in ('user','admin') then raise exception '승인된 사내 사용자만 지정할 수 있습니다.' using errcode='42501'; end if;
 if p_version is not null and p_version is distinct from prior->>'version' then raise exception '권한 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.' using errcode='40001'; end if;
 if (prior->>'explicit')::boolean=p_enabled then return jsonb_build_object('changed',false,'row',prior); end if;
 if p_enabled then insert into public.marketing_reviewers(user_id) values(p_user); else delete from public.marketing_reviewers where user_id=p_user; end if;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data,source,created_at)
 values(auth.uid(),ident->>'name','검수 권한 변경',concat(prior->>'name',' · ',case when p_enabled then '검수자 지정' else '검수자 지정 해제' end),
  prior,jsonb_build_object('userId',p_user,'name',prior->>'name','email',prior->>'email','enabled',p_enabled,
   'role',prior->>'role','canReview',public.marketing_access_account(p_user),'pageAccess',public.marketing_access_account(p_user)),
  jsonb_build_object('type','marketing-reviewer'),clock_timestamp());
 updated:=public.marketing_reviewer_details(p_user);
 return jsonb_build_object('changed',true,'row',updated);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_company_key(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select regexp_replace(lower(btrim(coalesce(p,''))),'주식회사|\(주\)|㈜|[[:space:]]','','g');
$function$;

CREATE OR REPLACE FUNCTION public.marketing_company_matches(a text, b text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select public.marketing_company_key(a)<>'' and public.marketing_company_key(b)<>'' and (public.marketing_company_key(a)=public.marketing_company_key(b) or exists(
 select 1 from public.marketing_organizations o where
 public.marketing_company_key(a)=any(array_prepend(public.marketing_company_key(o.name),array(select public.marketing_company_key(x) from unnest(o.aliases) x))) and
 public.marketing_company_key(b)=any(array_prepend(public.marketing_company_key(o.name),array(select public.marketing_company_key(x) from unnest(o.aliases) x)))));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_create_organization(p_id uuid, p_name text, p_category text, p_aliases text[], p_reason text, p_review_status text DEFAULT 'pending'::text, p_separate boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.marketing_organizations; ident jsonb; payload jsonb; aliases_clean text[]; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_id is null or length(btrim(coalesce(p_name,''))) not between 1 and 2000 or p_category is null or not public.marketing_category_valid(p_category) or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 or coalesce(array_length(p_aliases,1),0)>50 then raise exception '회사명·분류·등록 사유를 확인해 주세요.' using errcode='22023'; end if;
 if p_review_status is null or p_review_status not in ('pending','confirmed') or (p_review_status='confirmed' and p_category='확인 필요') then raise exception '분류 미확정 회사는 확인 완료로 처리할 수 없습니다.' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_aliases) a where a is null or length(btrim(a)) not between 1 and 2000) then raise exception '별칭은 1~2,000자여야 합니다.' using errcode='22023'; end if;
 select coalesce(array_agg(distinct btrim(a) order by btrim(a)),'{}'::text[]) into aliases_clean from unnest(p_aliases) a;
 payload:=jsonb_build_object('id',p_id,'name',btrim(p_name),'category',p_category,'aliases',aliases_clean,'reason',btrim(p_reason),'reviewStatus',p_review_status,'separate',coalesce(p_separate,false));
 perform pg_advisory_xact_lock(20260914,1);
 select * into o from public.marketing_organizations where id=p_id;
 if found then
  if exists(select 1 from public.marketing_review_events where organization_id=p_id and actor=auth.uid() and action='회사·기관 등록' and after_data->'request'=payload) then return to_jsonb(o); end if;
  raise exception '등록 요청이 이미 사용되었습니다. 목록을 새로고침해 주세요.' using errcode='40001';
 end if;
 if not coalesce(p_separate,false) and exists(
  select 1 from public.marketing_organizations existing,unnest(array_prepend(existing.name,existing.aliases)) a,unnest(array_prepend(btrim(p_name),aliases_clean)) b
  where public.marketing_company_key(a)=public.marketing_company_key(b)
 ) then raise exception '같거나 유사한 회사명·별칭이 이미 등록되어 있습니다. 기존 회사를 선택하거나 별도 법인 여부와 근거를 확인해 주세요.' using errcode='23505'; end if;
 insert into public.marketing_organizations(id,name,category,aliases,review_status) values(p_id,btrim(p_name),p_category,aliases_clean,p_review_status) returning * into o;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,organization_id,after_data)
 values(auth.uid(),ident->>'name','회사·기관 등록',btrim(p_reason),o.id,jsonb_build_object('organization',to_jsonb(o),'request',payload));
 return to_jsonb(o);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_create_validation(p_request_key uuid, p_scope text, p_filters jsonb, p_ids uuid[], p_rules jsonb, p_trial uuid DEFAULT NULL::uuid, p_trial_revision integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run uuid:=gen_random_uuid(); chosen jsonb; n integer; prior public.marketing_validation_runs; draft public.marketing_rule_drafts; request jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_request_key is null or p_scope is null or p_scope not in ('all','filtered','selected') or jsonb_typeof(p_filters) is distinct from 'object' or jsonb_typeof(p_rules) is distinct from 'array' then raise exception '검증 범위를 확인해 주세요.' using errcode='22023'; end if;
 if p_scope='selected' and coalesce(cardinality(p_ids),0)=0 then raise exception 'Contact를 하나 이상 선택해 주세요.' using errcode='22023'; end if;
 request:=jsonb_build_object('scope',p_scope,'filters',p_filters,'ids',p_ids,'rules',p_rules,'trial',p_trial,'trialRevision',p_trial_revision);
 perform pg_advisory_xact_lock(20260914,1);
 select * into prior from public.marketing_validation_runs where request_key=p_request_key;
 if found then
  if prior.actor<>auth.uid() or prior.request<>request then raise exception '같은 요청 키에 다른 실행 설정입니다.' using errcode='22023'; end if;
  return prior.id;
 end if;
 if p_trial is not null then
  select * into draft from public.marketing_rule_drafts where id=p_trial;
  if not found or draft.revision is distinct from p_trial_revision or draft.published_version is not null then raise exception '시험 수정본이 변경되었습니다.' using errcode='40001'; end if;
  chosen:=jsonb_build_array(draft.definition||jsonb_build_object('id',coalesce(draft.rule_id,draft.id),'code','DRAFT','version',draft.revision,'draftId',draft.id));
 else
  if jsonb_array_length(p_rules) not between 1 and 100 then raise exception '규칙을 1~100개 선택해 주세요.' using errcode='22023'; end if;
  select jsonb_agg(to_jsonb(r) order by r.code) into chosen from public.marketing_rules r
  join jsonb_to_recordset(p_rules) as x(id uuid,version integer) on x.id=r.id and x.version=r.version where r.enabled;
  if coalesce(jsonb_array_length(chosen),0)<>jsonb_array_length(p_rules) or (select count(distinct x->>'id') from jsonb_array_elements(p_rules) x)<>jsonb_array_length(p_rules) then raise exception '선택 규칙이 변경되거나 비활성화되었습니다. 목록을 갱신해 주세요.' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(chosen) r where not public.marketing_rule_config_valid(r->'config') or r->'config'->>'operator'='builtin') then raise exception '운영 원칙은 자동 실행할 수 없습니다. 실행할 규칙을 선택해 주세요.' using errcode='22023'; end if;

 -- All source reads and copies below use ONE MVCC statement snapshot.
 with orgs as materialized (select o.*, array_prepend(public.marketing_company_key(o.name),array(select public.marketing_company_key(a) from unnest(o.aliases) a)) as keys from public.marketing_organizations o),
 org_keys as materialized (select distinct o.id,k.key from orgs o cross join lateral unnest(o.keys) k(key) where k.key<>''),
 org_pairs as materialized (select distinct a.id,b.id as other_id from org_keys a join org_keys b on b.key=a.key and b.id<>a.id),
 org_relations as materialized (select p.id,jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'category',x.category,'version',x.version) order by x.id) as companies,bool_or(x.category<>o.category) as category_conflict from org_pairs p join orgs x on x.id=p.other_id join orgs o on o.id=p.id group by p.id),
 org_counts as materialized (select organization_id,count(*) as contacts from public.marketing_contacts group by organization_id),
 org_context as materialized (select o.id,to_jsonb(o)-'keys' as snapshot,
  jsonb_build_object('hasOrganization',true,'companyAmbiguous',r.id is not null,'categoryConflict',coalesce(r.category_conflict,false),'companies',coalesce(r.companies,'[]'::jsonb),'companyContacts',coalesce(c.contacts,0)) as context
  from orgs o left join org_relations r on r.id=o.id left join org_counts c on c.organization_id=o.id),
 contacts as materialized (select c.*,to_jsonb(o)-'keys' as organization,coalesce(o.keys,array[public.marketing_company_key(c.data->>'company')]) as keys from public.marketing_contacts c left join orgs o on o.id=c.organization_id),
 selected as materialized (select c.*,row_number() over(order by
  case when p_filters->>'direction'='desc' then nullif(lower(btrim(case when p_filters->>'sort'='category' then coalesce(c.organization->>'category','확인 필요') when p_filters->>'sort'='company' then coalesce(c.organization->>'name',c.data->>'company') when p_filters->>'sort'='db_id' then c.db_id else c.data->>coalesce(p_filters->>'sort','db_id') end)),'') end desc nulls last,
  case when p_filters->>'direction' is distinct from 'desc' then nullif(lower(btrim(case when p_filters->>'sort'='category' then coalesce(c.organization->>'category','확인 필요') when p_filters->>'sort'='company' then coalesce(c.organization->>'name',c.data->>'company') when coalesce(p_filters->>'sort','db_id')='db_id' then c.db_id else c.data->>(p_filters->>'sort') end)),'') end asc nulls last,c.db_id,c.id) as ordinal from contacts c
  where p_scope='all' or (p_scope='selected' and c.id=any(p_ids)) or (p_scope='filtered'
   and (coalesce(p_filters->>'q','')='' or position(lower(p_filters->>'q') in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',c.organization->>'name')))>0)
   and (coalesce(p_filters->>'department','')='' or position(lower(p_filters->>'department') in lower(coalesce(c.data->>'ownerDepartment','')))>0)
   and (coalesce(p_filters->>'category','')='' or c.organization->>'category'=p_filters->>'category')
   and (coalesce(p_filters->>'issues','false')<>'true' or c.organization_id is null or c.organization->>'category'='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))),
 new_run as (insert into public.marketing_validation_runs(id,request_key,request,actor,actor_name,scope,filters,rules,trial,total)
  select run,p_request_key,request,auth.uid(),public.marketing_identity()->>'name',p_scope,p_filters,chosen,p_trial is not null,(select count(*) from selected) returning id),
 copy_orgs as (insert into public.marketing_validation_organizations select run,o.id,o.snapshot,o.context from org_context o cross join new_run returning organization_id),
 copy_reference as (insert into public.marketing_validation_reference select run,c.id,c.version,c.db_id,nullif(lower(btrim(c.data->>'email')),''),nullif(lower(btrim(c.data->>'name')),''),c.keys,c.organization_id from contacts c cross join new_run returning contact_id),
 copy_targets as (insert into public.marketing_validation_targets(run_id,contact_id,ordinal,snapshot,context)
  select run,c.id,c.ordinal,jsonb_build_object('id',c.id,'db_id',c.db_id,'version',c.version,'organization_id',c.organization_id,'organization',c.organization,'data',c.data),
   coalesce(oc.context,'{}')||jsonb_build_object('mode','master','hasProvenance',exists(select 1 from public.marketing_source_rows s where s.contact_id=c.id) or exists(select 1 from public.marketing_submissions s where s.result_contact_id=c.id and s.status in ('approved','unchanged')),
    'companyLinked',c.organization_id is not null and lower(btrim(coalesce(c.data->>'company','')))=any(array_prepend(lower(btrim(c.organization->>'name')),array(select lower(btrim(a)) from jsonb_array_elements_text(coalesce(c.organization->'aliases','[]')) a))))
  from selected c left join org_context oc on oc.id=c.organization_id cross join new_run returning contact_id)
 select count(*) into n from copy_targets;
 if n=0 then raise exception '검증 대상이 없습니다.' using errcode='22023'; end if;
 if p_scope='selected' and n<>(select count(distinct x) from unnest(p_ids) x) then raise exception '선택한 Contact가 변경되거나 삭제되었습니다.' using errcode='40001'; end if;
 return run;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_designated_accounts()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.user_id from public.user_profiles p
  where exists (select 1 from public.user_profiles me where me.user_id = auth.uid() and me.role = 'admin')
    and (public.marketing_manager_account(p.user_id) or exists (select 1 from public.marketing_reviewers r where r.user_id = p.user_id));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_edit_rule(p_draft_id uuid, p_revision integer, p_rule_id uuid, p_base_version integer, p_definition jsonb, p_reason text, p_publish boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.marketing_rule_drafts; r public.marketing_rules; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into d from public.marketing_rule_drafts where id=p_draft_id for update;
 if found then
  if d.published_version is not null and p_publish and d.definition=p_definition and d.reason=p_reason then return jsonb_build_object('draft',to_jsonb(d),'published',true); end if;
  if d.published_version is not null or d.revision is distinct from p_revision or d.rule_id is distinct from p_rule_id or d.base_version is distinct from p_base_version then raise exception '수정본이 변경되었습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 elsif p_revision<>0 or p_draft_id is null then raise exception '수정본 버전을 확인해 주세요.' using errcode='40001'; end if;
 select * into r from public.marketing_rules where id=p_rule_id;
 if p_rule_id is not null and (r.id is null or r.version is distinct from p_base_version) then raise exception '적용 규칙이 변경되었습니다. 최신 버전과 비교해 주세요.' using errcode='40001'; end if;
 perform public.marketing_rule_definition_check(p_definition,coalesce(r.code,''));
 if length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '변경 사유를 입력해 주세요.' using errcode='22023'; end if;
 insert into public.marketing_rule_drafts(id,rule_id,base_version,definition,reason,actor) values(p_draft_id,p_rule_id,p_base_version,p_definition,p_reason,auth.uid())
 on conflict(id) do update set definition=excluded.definition,reason=excluded.reason,actor=excluded.actor,revision=marketing_rule_drafts.revision+1,updated_at=now() returning * into d;
 if p_publish then
  r:=public.marketing_save_rule(p_rule_id,p_base_version,p_definition->>'title',p_definition->>'description',p_definition->'config',p_definition->>'severity',(p_definition->>'enabled')::boolean,p_reason);
  update public.marketing_rule_drafts set published_version=r.version,published_rule_id=r.id where id=d.id returning * into d;
 end if;
 return jsonb_build_object('draft',to_jsonb(d),'published',p_publish);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_action(p_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.marketing_email_runs; n integer;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into job from public.marketing_email_runs where id=p_id for update;
 if not found then raise exception '검사 실행을 찾을 수 없습니다.' using errcode='22023'; end if;
 if p_action='cancel' then
  update public.marketing_email_runs set status='cancelled',finished_at=now() where id=p_id and status in ('queued','running');
 elsif p_action='retry' then
  if job.status in ('queued','running') then return; end if;
  update public.marketing_email_targets set processed=false,lease=null,lease_until=null,result=null,checked_at=null where run_id=p_id and (not processed or result->>'state'='error');
  select count(*) into n from public.marketing_email_targets where run_id=p_id and processed;
  update public.marketing_email_runs set processed=n,status=case when n=total then 'completed' else 'queued' end,finished_at=case when n=total then finished_at else null end where id=p_id;
 else raise exception '지원하지 않는 작업입니다.' using errcode='22023'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_claim(p_run uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.marketing_email_runs; targets jsonb;
begin
 select * into job from public.marketing_email_runs r where (p_run is null or r.id=p_run) and r.status in ('queued','running')
 and exists(select 1 from public.marketing_email_targets t where t.run_id=r.id and not t.processed and (t.lease_until is null or t.lease_until<now()))
 order by r.created_at for update skip locked limit 1;
 if not found then return '[]'; end if;
 update public.marketing_email_runs set status='running' where id=job.id;
 with chosen as (select contact_id from public.marketing_email_targets where run_id=job.id and not processed and (lease_until is null or lease_until<now()) order by ordinal for update skip locked limit 20),
 claimed as (update public.marketing_email_targets t set lease=gen_random_uuid(),lease_until=now()+interval '120 seconds' from chosen c where t.run_id=job.id and t.contact_id=c.contact_id returning t.run_id,t.contact_id,t.lease,t.snapshot)
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into targets from claimed c;
 return targets;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_contact_history(p_contact uuid, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare current_contact public.marketing_contacts;
begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 select * into current_contact from public.marketing_contacts where id=p_contact;
 if not found then return null; end if;
 return jsonb_build_object(
  'total',(select count(*) from public.marketing_review_events where contact_id=p_contact and email_result_id is not null),
  'pageSize',20,
  'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
   select e.*,
    (current_contact.version is distinct from (e.after_data->'contact'->>'version')::integer
     or current_contact.organization_id is distinct from (e.after_data->'contact'->>'organization_id')::uuid
     or o.version is distinct from (e.after_data->'contact'->>'organization_version')::integer
     or coalesce(p.version,0)<>coalesce((e.after_data->'contact'->'profile'->>'version')::integer,0)
     or e.created_at<now()-interval '30 days') stale
   from public.marketing_review_events e
   left join public.marketing_organizations o on o.id=current_contact.organization_id
   left join public.marketing_email_profiles p on p.organization_id=current_contact.organization_id
   where e.contact_id=p_contact and e.email_result_id is not null
   order by e.created_at desc,e.id desc limit 20 offset (greatest(1,least(100000,coalesce(p_page,1)))-1)*20
  ) x),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_create(p_key uuid, p_scope text, p_filters jsonb, p_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rid uuid:=gen_random_uuid(); old public.marketing_email_runs; request jsonb; n integer;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_key is null or p_scope is null or p_scope not in ('all','filtered','selected') or jsonb_typeof(p_filters) is distinct from 'object' or (p_scope='selected' and coalesce(cardinality(p_ids),0) not between 1 and 10000) then raise exception '검사 범위를 확인하세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260915,1);
 request:=jsonb_build_object('scope',p_scope,'filters',p_filters,'ids',p_ids);
 select * into old from public.marketing_email_runs where request_key=p_key;
 if found then
  if old.actor<>auth.uid() or old.request<>request then raise exception '요청 키의 검사 범위가 다릅니다.' using errcode='22023'; end if;
  return old.id;
 end if;
 if (select count(*) from public.marketing_email_runs where status in ('queued','running'))>=3 then raise exception '실행 중인 검사가 3개입니다. 완료 후 다시 실행하세요.' using errcode='22023'; end if;
 with selected as materialized (
  select c.*,o.name as company,o.version as organization_version,to_jsonb(p) as profile
  from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id left join public.marketing_email_profiles p on p.organization_id=o.id
  where p_scope='all' or (p_scope='selected' and c.id=any(p_ids)) or (p_scope='filtered'
   and (coalesce(p_filters->>'q','')='' or position(lower(p_filters->>'q') in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',o.name)))>0)
   and (coalesce(p_filters->>'category','')='' or o.category=p_filters->>'category')
   and (coalesce(p_filters->>'department','')='' or position(lower(p_filters->>'department') in lower(coalesce(c.data->>'ownerDepartment','')))>0)
   and (coalesce(p_filters->>'issues','false')<>'true' or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))
 ), job as (
  insert into public.marketing_email_runs(id,request_key,request,actor,actor_name,scope,filters,total)
  select rid,p_key,request,auth.uid(),public.marketing_identity()->>'name',p_scope,p_filters,count(*) from selected returning id
 ), targets as (
  insert into public.marketing_email_targets(run_id,contact_id,ordinal,snapshot)
  select rid,s.id,row_number() over(order by s.db_id,s.id),jsonb_build_object('id',s.id,'db_id',s.db_id,'version',s.version,'organization_id',s.organization_id,'organization_version',s.organization_version,'company',coalesce(s.company,s.data->>'company',''),'name',coalesce(s.data->>'name',''),'email',coalesce(s.data->>'email',''),'profile',s.profile)
  from selected s cross join job returning contact_id
 ) select count(*) into n from targets;
 if n=0 then raise exception '검사 대상이 없습니다.' using errcode='22023'; end if;
 if n>100000 then raise exception '한 번에 100,000건까지 검사할 수 있습니다.' using errcode='22023'; end if;
 if p_scope='selected' and n<>(select count(distinct x) from unnest(p_ids) x) then raise exception '선택한 Contact가 변경되었습니다.' using errcode='40001'; end if;
 return rid;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_finish(p_run uuid, p_contact uuid, p_lease uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.marketing_email_runs;
begin
 select * into job from public.marketing_email_runs where id=p_run for update;
 if job.status not in ('queued','running') or job.id is null then return false; end if;
 if coalesce(p_result->>'state','') not in ('pass','review','fail','error') or length(p_result::text)>40000 then raise exception 'Invalid result'; end if;
 update public.marketing_email_targets set processed=true,result=p_result,checked_at=now(),lease=null,lease_until=null
 where run_id=p_run and contact_id=p_contact and lease=p_lease and lease_until>=now() and not processed;
 if not found then return false; end if;
 insert into public.marketing_email_results(id,run_id,contact_id,result) values(p_lease,p_run,p_contact,p_result);
 update public.marketing_email_runs set processed=processed+1,status=case when processed+1=total then 'completed' else 'running' end,finished_at=case when processed+1=total then now() else null end where id=p_run;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_profile_save(p_id uuid, p_version integer, p_org_version integer, p_website text, p_domains text[], p_reason text)
 RETURNS marketing_email_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.marketing_email_profiles; saved public.marketing_email_profiles; ident jsonb; org public.marketing_organizations; d text;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into org from public.marketing_organizations where id=p_id for update;
 if not found or org.version is distinct from p_org_version then raise exception '회사 기준이 변경되었습니다. 다시 조회하세요.' using errcode='40001'; end if;
 select * into old from public.marketing_email_profiles where organization_id=p_id;
 if coalesce(old.version,0) is distinct from p_version then raise exception '홈페이지·도메인 기준이 변경되었습니다. 다시 조회하세요.' using errcode='40001'; end if;
 if p_website is null or length(p_website)>500 or (p_website<>'' and p_website !~ '^https?://[a-z0-9.-]+(/[^?#]*)?$') or p_domains is null or cardinality(p_domains)>20 or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '주소·도메인·확인 근거를 확인하세요.' using errcode='22023'; end if;
 foreach d in array p_domains loop if d is null or length(d)>253 or d !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' then raise exception '이메일 도메인 형식을 확인하세요.' using errcode='22023'; end if; end loop;
 ident:=public.marketing_identity();
 insert into public.marketing_email_profiles(organization_id,website,domains,reason,actor,actor_name)
 values(p_id,p_website,p_domains,btrim(p_reason),auth.uid(),ident->>'name')
 on conflict(organization_id) do update set website=excluded.website,domains=excluded.domains,reason=excluded.reason,actor=excluded.actor,actor_name=excluded.actor_name,version=marketing_email_profiles.version+1,updated_at=now() returning * into saved;
 insert into public.marketing_email_profile_history(organization_id,version,before_data,after_data,actor,actor_name,reason) values(p_id,saved.version,case when old.organization_id is null then null else to_jsonb(old) end,to_jsonb(saved),auth.uid(),ident->>'name',p_reason);
 return saved;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_record_history(p_result uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 insert into public.marketing_review_events
 (email_result_id,contact_id,actor,actor_name,action,reason,after_data,source,validation_snapshot,created_at)
 select r.id,r.contact_id,j.actor,j.actor_name,'이메일 검증',
  concat(t.snapshot->>'db_id',' · ',t.snapshot->>'email',' · ',
   case r.result->>'state' when 'pass' then '근거 확인' when 'fail' then '문제 발견' when 'error' then '실행 오류' else '확인 필요' end),
  jsonb_build_object('contact',t.snapshot),
  jsonb_build_object('type','email-integrity','runId',r.run_id,'resultId',r.id),r.result,r.created_at
 from public.marketing_email_results r
 join public.marketing_email_targets t on t.run_id=r.run_id and t.contact_id=r.contact_id
 join public.marketing_email_runs j on j.id=r.run_id
 where p_result is null or r.id=p_result
 on conflict (email_result_id) where email_result_id is not null do nothing;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_email_report(p_id uuid, p_page integer DEFAULT 1, p_state text DEFAULT ''::text, p_q text DEFAULT ''::text, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 select jsonb_build_object('run',to_jsonb(r)-'request'-'request_key'-'actor','counts',(select jsonb_object_agg(s.state,s.n) from (select coalesce(t.result->>'state','pending') state,count(*) n from public.marketing_email_targets t where t.run_id=p_id group by 1) s),
 'total',(select count(*) from public.marketing_email_targets t where t.run_id=p_id and (p_state='' or coalesce(t.result->>'state','pending')=p_state) and (p_q='' or position(lower(p_q) in lower(concat_ws(' ',t.snapshot->>'db_id',t.snapshot->>'company',t.snapshot->>'name',t.snapshot->>'email')))>0)),
 'token',md5(concat_ws('|',r.status,r.processed,(select coalesce(max(updated_at)::text,'') from public.marketing_email_profiles),(select coalesce(max(updated_at)::text,'') from public.marketing_contacts),(select concat_ws(':',count(*),sum(version)) from public.marketing_organizations))),
 'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.ordinal) from (
  select t.contact_id,t.ordinal,t.snapshot,t.result,to_jsonb(p) profile,
   (c.version is distinct from (t.snapshot->>'version')::integer or o.version is distinct from (t.snapshot->>'organization_version')::integer or coalesce(p.version,0)<>coalesce((t.snapshot->'profile'->>'version')::integer,0) or coalesce(t.checked_at<now()-interval '30 days',false)) stale
  from public.marketing_email_targets t left join public.marketing_contacts c on c.id=t.contact_id left join public.marketing_organizations o on o.id=c.organization_id left join public.marketing_email_profiles p on p.organization_id=c.organization_id
  where t.run_id=p_id and (p_state='' or coalesce(t.result->>'state','pending')=p_state) and (p_q='' or position(lower(p_q) in lower(concat_ws(' ',t.snapshot->>'db_id',t.snapshot->>'company',t.snapshot->>'name',t.snapshot->>'email')))>0)
  order by t.ordinal limit greatest(1,least(p_limit,500)) offset (greatest(1,p_page)-1)*greatest(1,least(p_limit,500))
 ) x),'[]')) into result from public.marketing_email_runs r where r.id=p_id;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_rerun(p_id uuid, p_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.marketing_email_runs; ids uuid[];
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into old from public.marketing_email_runs where id=p_id;
 if not found then raise exception '검사 실행을 찾을 수 없습니다.' using errcode='22023'; end if;
 select array_agg(contact_id order by ordinal) into ids from public.marketing_email_targets where run_id=p_id and old.scope='selected';
 return public.marketing_email_create(p_key,old.scope,old.filters,coalesce(ids,'{}'));
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_email_result_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform public.marketing_email_record_history(new.id);
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_enrich_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.marketing_submissions; begin
 if new.submission_id is not null then
  select * into s from public.marketing_submissions where id=new.submission_id;
  new.contact_id:=coalesce(s.result_contact_id,s.target_id);
  new.submitter:=s.submitter; new.division:=s.division; new.source:=s.source; new.validation_snapshot:=s.validation;
  select organization_id into new.organization_id from public.marketing_contacts where id=new.contact_id;
 elsif new.action='회사·기관 기준 변경' then new.organization_id:=nullif(new.after_data->>'id','')::uuid;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_evaluate_rule(p_rule jsonb, p_data jsonb, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare cfg jsonb:=p_rule->'config'; op text:=cfg->>'operator'; val text:=btrim(coalesce(p_data->>(cfg->>'field'),'')); outcome text:='pass'; msg text:='기준 충족'; failed boolean:=false; applicable boolean:=true; related jsonb:='[]'; begin
 if not public.marketing_rule_config_valid(cfg) then raise exception '지원하지 않는 검증기/설정'; end if;
 if cfg ? 'whenField' then
  if cfg ? 'whenValue' then applicable:=lower(btrim(coalesce(p_data->>(cfg->>'whenField'),'')))=lower(btrim(cfg->>'whenValue'));
  else applicable:=btrim(coalesce(p_data->>(cfg->>'whenField'),''))<>''; end if;
 end if;
 if cfg ? 'whenAnyFields' then applicable:=applicable and exists(select 1 from jsonb_array_elements_text(cfg->'whenAnyFields') f where btrim(coalesce(p_data->>f,''))<>''); end if;
 if not applicable then outcome:='not_applicable'; msg:='적용 조건에 해당하지 않음';
 elsif op='builtin' then outcome:='not_applicable'; msg:='운영 원칙 · 자동 실행 대상 아님';
 elsif cfg->>'field' in ('category','db_id') and not p_data ? (cfg->>'field') then outcome:='not_applicable'; msg:='이 입력에는 해당 Master 기준값이 없음';
 elsif op='review' then outcome:='review'; msg:=p_rule->>'description';
 elsif op in ('duplicates','company_standard','classification','organization','provenance') then
  if p_context->>'mode' is distinct from 'master' then outcome:='not_applicable'; msg:='Master 비교 컨텍스트 필요 · 접수/승인의 별도 비교 단계에서 확인';
  elsif op='duplicates' then
   related:=coalesce(p_context->'duplicates','[]');
   if related<>'[]'::jsonb then outcome:='review'; msg:='전체 Master에서 중복 후보 발견 · 동일 인물 확인 필요';
   elsif btrim(coalesce(p_data->>'email',''))='' and (btrim(coalesce(p_data->>'name',''))='' or btrim(coalesce(p_data->>'company',''))='') then outcome:='not_applicable'; msg:='중복 비교에 필요한 이메일 또는 회사·성명 부족'; end if;
  elsif op='company_standard' then
   related:=coalesce(p_context->'companies','[]');
   if not coalesce((p_context->>'companyLinked')::boolean,false) or coalesce((p_context->>'companyAmbiguous')::boolean,false) then outcome:='review'; msg:='표준 회사 연결 또는 동일 법인 여부 확인 필요'; end if;
  elsif op='classification' then
   related:=coalesce(p_context->'companies','[]');
   if coalesce(p_data->>'category','확인 필요')='확인 필요' or p_data->>'organization_status' is distinct from 'confirmed' or coalesce((p_context->>'categoryConflict')::boolean,false) then outcome:='review'; msg:='회사 단위 분류 또는 상이한 분류 후보 확인 필요'; end if;
  elsif op='organization' then failed:=not coalesce((p_context->>'hasOrganization')::boolean,false); msg:=case when failed then '회사·기관 기준 연결 누락' else '기준 충족' end;
  elsif op='provenance' then failed:=not coalesce((p_context->>'hasProvenance')::boolean,false); msg:=case when failed then '최초 이관 또는 제출·승인 출처 연결 누락' else '기준 충족' end; end if;
 elsif op='required' then failed:=val='';
 elsif op='email' then failed:=val<>'' and val!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
 elsif op='date' and val<>'' then
  begin failed:=val!~'^\d{4}-\d{2}-\d{2}$' or to_char(val::date,'YYYY-MM-DD')<>val; exception when invalid_datetime_format or datetime_field_overflow then failed:=true; end;
 elsif op='one_of' then failed:=not exists(select 1 from jsonb_array_elements_text(cfg->'values') x where lower(btrim(x))=lower(val));
 elsif op='forbidden_values' then failed:=exists(select 1 from jsonb_array_elements_text(cfg->'values') x where lower(btrim(x))=lower(val));
 elsif op='max_length' then failed:=length(val)>(cfg->>'max')::integer;
 end if;
 if failed then outcome:='fail'; if op not in ('organization','provenance') then msg:=coalesce(nullif(p_rule->>'description',''),p_rule->>'title'); end if; end if;
 return jsonb_build_object('outcome',outcome,'severity',case when outcome='review' then 'warning' else p_rule->>'severity' end,'message',msg,'field',cfg->>'field','actual',val,'related',related,'manual',outcome='review');
exception when others then
 return jsonb_build_object('outcome','error','severity','error','message','검증 실행 오류 · '||sqlstate,'field',cfg->>'field','actual',val,'related','[]'::jsonb,'manual',false);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_find_organizations(p_q text DEFAULT ''::text, p_page integer DEFAULT 1, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if length(coalesce(p_q,''))>2000 or p_page is null or p_page not between 1 and 100000 then raise exception '검색 조건을 확인해 주세요.' using errcode='22023'; end if;
 with matched as materialized (
  select o.* from public.marketing_organizations o where
  (p_id is not null and o.id=p_id) or (p_id is null and btrim(coalesce(p_q,''))<>'' and
   exists(select 1 from unnest(array_prepend(o.name,o.aliases)) n where position(lower(btrim(p_q)) in lower(n))>0 or public.marketing_company_key(n)=public.marketing_company_key(p_q)))
 ), page as (select * from matched order by name,id limit 25 offset (p_page-1)*25)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by name,id) from page p),'[]'::jsonb),'total',(select count(*) from matched),'pageSize',25) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_finish_validation(p_id uuid, p_validation jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 update public.marketing_submissions set validation=public.marketing_safe_validation(p_validation),status='pending',version=version+1
 where id=p_id and submitted_by=auth.uid() and status='validating';
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_identity()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('name',coalesce(p.display_name,p.email),'division',coalesce(d.division,d.dept_name,'소속 미확인'))
 from public.user_profiles p left join public.company_directory d on lower(d.email)=lower(p.email) and d.active where p.user_id=auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.marketing_import_master(p_hash text, p_filename text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; batch uuid; cid uuid; oid uuid; n integer:=0; import_category text; ident jsonb;
begin
 if not public.has_page_access('marketing') or not exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin') then raise exception '관리자만 최초 이관할 수 있습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 or p_hash !~ '^[a-f0-9]{64}$' then raise exception '이관 파일이 올바르지 않습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 if exists(select 1 from public.marketing_import_batches where file_hash=p_hash) then raise exception '이미 이관된 파일입니다.' using errcode='23505'; end if;
 if exists(select 1 from public.marketing_contacts) then raise exception '최초 이관은 비어 있는 Master에서만 가능합니다.' using errcode='22023'; end if;
 insert into public.marketing_import_batches(file_hash,filename,row_count,imported_by) values(p_hash,p_filename,jsonb_array_length(p_rows),auth.uid()) returning id into batch;
 for r in select value from jsonb_array_elements(p_rows) loop
  oid:=null; import_category:=r->>'category';
  if coalesce(r->>'dbId','')='' or not public.marketing_category_valid(import_category) or jsonb_typeof(r->'data')<>'object' then raise exception 'DB ID 또는 분류가 올바르지 않습니다.' using errcode='22023'; end if;
  if btrim(coalesce(r->'data'->>'company',''))<>'' then
   select id into oid from public.marketing_organizations where lower(btrim(name))=lower(btrim(r->'data'->>'company')) and marketing_organizations.category=import_category limit 1;
   if oid is null then insert into public.marketing_organizations(name,category) values(btrim(r->'data'->>'company'),import_category) returning id into oid; end if;
  end if;
  insert into public.marketing_contacts(db_id,organization_id,data) values(r->>'dbId',oid,r->'data') returning id into cid;
  insert into public.marketing_source_rows(batch_id,contact_id,sheet,row_number,raw) values(batch,cid,r->>'sheet',(r->>'row')::integer,r->'raw');
  n:=n+1;
 end loop;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,after_data) values(auth.uid(),ident->>'name','최초 Master 이관',p_filename,jsonb_build_object('batchId',batch,'rows',n,'hash',p_hash));
 return n;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_link_validation_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.marketing_validation_targets; c public.marketing_contacts; ov integer; begin
 if coalesce(new.source->>'validationRunId','')='' then return new; end if;
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into t from public.marketing_validation_targets where run_id=(new.source->>'validationRunId')::uuid and contact_id=new.target_id;
 if not found or t.submission_request_key<>new.request_key or new.source->>'validationContactId' is distinct from new.target_id::text then raise exception '검증 결과의 변경 요청 키와 대상을 확인해 주세요.' using errcode='22023'; end if;
 select * into c from public.marketing_contacts where id=new.target_id;
 select version into ov from public.marketing_organizations where id=c.organization_id;
 insert into public.marketing_validation_followups(request_key,run_id,contact_id,status,reason,actor,actor_name,current_version,organization_version,submission_id)
 values(new.request_key,t.run_id,t.contact_id,'submitted','검증 결과를 검토하고 변경 요청 제출',auth.uid(),public.marketing_identity()->>'name',c.version,ov,new.id);
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_manager_account(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.user_profiles where user_id=p_user and role in ('user','admin') and user_id in ('46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid,'a4e1906d-b915-4e00-9b4e-657beeb396ae'::uuid));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_org_counts(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_object_agg(organization_id,n),'{}') from (select organization_id,count(*) n from public.marketing_contacts where organization_id=any(p_ids) group by organization_id) t;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_organization_conflicts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with grouped as (select public.marketing_company_key(name) as key,jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category,'review_status',review_status) order by name,id) as organizations,
 bool_or(review_status='pending') as unresolved from public.marketing_organizations group by public.marketing_company_key(name) having count(distinct category)>1)
 select coalesce(jsonb_agg(to_jsonb(grouped) order by key),'[]') from grouped;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_pending_duplicate(p_data jsonb, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.has_page_access('marketing') and exists(select 1 from public.marketing_submissions s left join public.marketing_contacts t on t.id=s.target_id left join public.marketing_organizations o on o.id=t.organization_id
 where s.status in ('pending','validating') and s.id is distinct from p_exclude and
 (nullif(lower(btrim(coalesce(nullif(s.data->>'email',''),t.data->>'email'))),'')=nullif(lower(btrim(p_data->>'email')),'') or
 (nullif(lower(btrim(coalesce(nullif(s.data->>'name',''),t.data->>'name'))),'')=nullif(lower(btrim(p_data->>'name')),'') and public.marketing_company_matches(coalesce(nullif(s.data->>'company',''),o.name,t.data->>'company'),p_data->>'company'))));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_process_validation_chunk(p_run uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.marketing_validation_runs; t public.marketing_validation_targets; rule jsonb; idx integer; eval jsonb; ctx jsonb; vals jsonb; n integer:=0; v_outcome text; v_severity text; issues integer; begin
 select * into job from public.marketing_validation_runs where (p_run is null or id=p_run) and status in ('queued','running','cancel_requested') order by created_at,id for update skip locked limit 1;
 if not found then return 0; end if;
 begin
 if job.status='cancel_requested' then update public.marketing_validation_runs set status='cancelled',finished_at=clock_timestamp() where id=job.id; return 0; end if;
 update public.marketing_validation_runs set status='running',started_at=coalesce(started_at,clock_timestamp()) where id=job.id;
 for t in select * from public.marketing_validation_targets where run_id=job.id and not processed order by ordinal limit greatest(1,least(p_limit,500)) loop
  begin
   ctx:=t.context;
   if exists(select 1 from jsonb_array_elements(job.rules) r where r->'config'->>'operator'='duplicates') then
    select ctx||jsonb_build_object('duplicates',coalesce(jsonb_agg(jsonb_build_object('id',b.contact_id,'dbId',b.db_id,'version',b.version) order by b.db_id),'[]'::jsonb)) into ctx
    from public.marketing_validation_reference a join public.marketing_validation_reference b on b.run_id=a.run_id and b.contact_id<>a.contact_id
     and (b.email_key=a.email_key or (b.name_key=a.name_key and (b.organization_id=a.organization_id or b.company_keys&&array_remove(a.company_keys,''))))
    where a.run_id=job.id and a.contact_id=t.contact_id;
   end if;
   vals:=t.snapshot->'data'||jsonb_build_object('company',coalesce(t.snapshot->'organization'->>'name',t.snapshot->'data'->>'company',''),'category',coalesce(t.snapshot->'organization'->>'category','확인 필요'),'db_id',t.snapshot->>'db_id','organization_status',t.snapshot->'organization'->>'review_status');
   for rule,idx in select value,ordinality::integer from jsonb_array_elements(job.rules) with ordinality loop
    -- Preserve successful results and all previous error attempts.
    if exists(select 1 from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id and r.rule_index=idx and r.outcome<>'error') then continue; end if;
    eval:=public.marketing_evaluate_rule(rule,vals,ctx);
    insert into public.marketing_validation_results(run_id,contact_id,rule_index,attempt,outcome,severity,detail) values(job.id,t.contact_id,idx,job.attempt,eval->>'outcome',eval->>'severity',eval);
   end loop;
  exception when others then
   for rule,idx in select value,ordinality::integer from jsonb_array_elements(job.rules) with ordinality loop
    if not exists(select 1 from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id and r.rule_index=idx and r.outcome<>'error') then
     insert into public.marketing_validation_results(run_id,contact_id,rule_index,attempt,outcome,severity,detail) values(job.id,t.contact_id,idx,job.attempt,'error','error',jsonb_build_object('message','검증 처리 오류 · '||sqlstate));
    end if;
   end loop;
  end;
  select x.outcome,x.severity into v_outcome,v_severity from (select distinct on (rule_index) r.outcome,r.severity,r.rule_index from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id order by rule_index,attempt desc) x
   order by case when x.outcome='error' then 0 when x.outcome='fail' and x.severity='error' then 1 when x.outcome='fail' then 2 when x.outcome='review' then 3 when x.outcome='pass' then 4 else 5 end limit 1;
  select count(*) into issues from (select distinct on (rule_index) r.outcome from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id order by rule_index,attempt desc) x where x.outcome in ('error','fail','review');
  -- Column-qualified assignment below avoids PL/pgSQL name ambiguity.
  update public.marketing_validation_targets mt set processed=true,outcome=v_outcome,severity=v_severity,issue_count=issues where mt.run_id=job.id and mt.contact_id=t.contact_id;
  n:=n+1;
 end loop;
 update public.marketing_validation_runs j set processed=(select count(*) from public.marketing_validation_targets where run_id=job.id and processed) where j.id=job.id;
 if not exists(select 1 from public.marketing_validation_targets where run_id=job.id and not processed) then
  update public.marketing_validation_runs set status=case when exists(select 1 from public.marketing_validation_targets where run_id=job.id and outcome='error') then 'completed_with_errors' else 'completed' end,finished_at=clock_timestamp() where id=job.id;
 end if;
 return n;
 exception when others then
  update public.marketing_validation_runs set status='failed',last_error='작업 처리 실패 · '||sqlstate,finished_at=clock_timestamp() where id=job.id;
  return 0;
 end;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_record_validation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
 insert into public.marketing_validations(submission_id,submission_version,result,actor) values(new.id,new.version,new.validation,auth.uid()) on conflict do nothing;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_resolve_delete_candidate(p_id uuid, p_version integer, p_action text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.marketing_contacts; ident jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action is null or p_action not in ('keep','delete') or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '처리 사유를 입력해 주세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into c from public.marketing_contacts where id=p_id for update;
 if not found or c.version is distinct from p_version then raise exception 'Contact 정보가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 if c.delete_candidate is null then raise exception '삭제 후보가 아닙니다.' using errcode='22023'; end if;
 ident:=public.marketing_identity();
 if p_action='keep' then
  update public.marketing_contacts set delete_candidate=null,version=version+1,updated_at=now() where id=p_id;
  insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data,contact_id,organization_id)
   values(auth.uid(),ident->>'name','삭제 후보 해제',p_reason,to_jsonb(c),jsonb_build_object('contact',(select to_jsonb(x) from public.marketing_contacts x where x.id=p_id)),p_id,c.organization_id);
  return;
 end if;
 if exists(select 1 from public.marketing_email_targets where contact_id=p_id) then
  raise exception '이메일 정합성 검사 이력이 있어 삭제할 수 없습니다. 후보로 남겨 두세요.' using errcode='22023';
 end if;
 update public.marketing_review_events set contact_id=null where contact_id=p_id;
 update public.marketing_submissions set target_id=null where target_id=p_id;
 update public.marketing_submissions set result_contact_id=null where result_contact_id=p_id;
 insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data,organization_id)
  values(auth.uid(),ident->>'name','삭제',p_reason,jsonb_build_object('contact',to_jsonb(c),
   'sources',(select coalesce(jsonb_agg(jsonb_build_object('sheet',s.sheet,'row',s.row_number,'raw',s.raw)),'[]') from public.marketing_source_rows s where s.contact_id=p_id)),
   jsonb_build_object('deletedContactId',p_id,'dbId',c.db_id),c.organization_id);
 delete from public.marketing_source_rows where contact_id=p_id;
 delete from public.marketing_contacts where id=p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_revalidate(p_id uuid, p_version integer, p_validation jsonb)
 RETURNS marketing_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare result public.marketing_submissions; begin
 if not public.marketing_can_review() then raise exception '검수 권한이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 update public.marketing_submissions set validation=public.marketing_safe_validation(p_validation),status='pending',version=version+1
 where id=p_id and version=p_version and status in ('pending','validating') returning * into result;
 if not found then raise exception '제출 상태가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_review(p_id uuid, p_version integer, p_action text, p_final jsonb, p_target uuid, p_target_version integer, p_org uuid, p_org_version integer, p_category text, p_reason text, p_resolution jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.marketing_submissions; c public.marketing_contacts; o public.marketing_organizations; ident jsonb;
 cid uuid; oid uuid; before_value jsonb; final_value jsonb; k text; duplicate_count integer; check_result jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action is null or p_action not in ('approve','reject','unchanged') or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '검수 사유를 입력해 주세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into s from public.marketing_submissions where id=p_id for update;
 if not found then raise exception '제출을 찾을 수 없습니다.' using errcode='P0002'; end if;
 if (s.status='approved' and p_action='approve') or (s.status='unchanged' and p_action='unchanged') then return s.result_contact_id; end if;
 if s.status<>'pending' or s.version is distinct from p_version then raise exception '검수 상태가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 ident:=public.marketing_identity();
 if p_action='reject' then
  update public.marketing_submissions set status='rejected',version=version+1 where id=p_id;
  insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data) values(p_id,auth.uid(),ident->>'name','반려',p_reason,to_jsonb(s),null);
  return null;
 end if;
 if jsonb_typeof(p_final) is distinct from 'object' then raise exception '최종 반영값이 필요합니다.' using errcode='22023'; end if;
 final_value:='{}';
 foreach k in array array['company','name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet'] loop
  if p_final ? k and jsonb_typeof(p_final->k)<>'string' then raise exception '문자 필드가 필요합니다.' using errcode='22023'; end if;
  if length(coalesce(p_final->>k,''))>2000 then raise exception '입력값이 너무 깁니다.' using errcode='22023'; end if;
  final_value:=final_value||jsonb_build_object(k,btrim(coalesce(p_final->>k,'')));
 end loop;
 if p_target is not null then
  select * into c from public.marketing_contacts where id=p_target for update;
  if not found or c.version is distinct from p_target_version then raise exception '기존 정보가 변경되었습니다. 재검증해 주세요.' using errcode='40001'; end if;
  before_value:=to_jsonb(c); cid:=c.id;
 end if;
 if exists(select 1 from public.marketing_contacts where nullif(lower(btrim(data->>'email')),'')=nullif(lower(btrim(final_value->>'email')),'') and id is distinct from p_target) then raise exception '다른 Contact에서 사용 중인 이메일입니다. 대상을 다시 선택해 주세요.' using errcode='23505'; end if;
 check_result:=public.marketing_review_check(p_id,final_value||jsonb_build_object('category',p_category),p_target,p_org);
 if jsonb_array_length(check_result->'blockingErrors')>0 then raise exception '%', (check_result->'blockingErrors')::text using errcode='22023'; end if;
 if p_resolution->>'token' is distinct from check_result->>'token' or (jsonb_array_length(check_result->'conflicts')>0 and length(btrim(coalesce(p_resolution->>'reason','')))<2) then
  raise exception '미해결 충돌이 있거나 검증 기준이 바뀌었습니다. 최종값 재검증 후 해결 근거를 확인해 주세요.' using errcode='40001';
 end if;
 if p_action='unchanged' then
  if p_target is null or c.organization_id is distinct from p_org or exists(
   select 1 from jsonb_each_text(final_value) f where f.value is distinct from
   case when f.key='company' then coalesce((select name from public.marketing_organizations where id=c.organization_id),c.data->>'company','') else coalesce(c.data->>f.key,'') end
  ) then raise exception '변경 없음 종결은 기존 대상과 모든 최종값이 같아야 합니다.' using errcode='22023'; end if;
  update public.marketing_submissions set status='unchanged',version=version+1,result_contact_id=cid where id=p_id;
  insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data)
   values(p_id,auth.uid(),ident->>'name','변경 없음',p_reason,to_jsonb(c),jsonb_build_object('contact',to_jsonb(c),'reviewCheck',check_result,'resolution',p_resolution));
  return cid;
 end if;
 if p_org is not null then
  select * into o from public.marketing_organizations where id=p_org for update;
  if not found or o.version is distinct from p_org_version then raise exception '회사 기준이 변경되었습니다. 재검증해 주세요.' using errcode='40001'; end if;
  oid:=o.id; final_value:=jsonb_set(final_value,'{company}',to_jsonb(o.name));
 else
  raise exception '회사·기관에 먼저 등록한 뒤 선택해 주세요.' using errcode='22023';
 end if;
 if p_target is null then
  cid:=gen_random_uuid();
  insert into public.marketing_contacts(id,db_id,organization_id,data) values(cid,'M-'||cid::text,oid,final_value);
 else
  update public.marketing_contacts set organization_id=oid,data=final_value,version=version+1,updated_at=now() where id=cid;
 end if;
 update public.marketing_submissions set status='approved',version=version+1,result_contact_id=cid where id=p_id;
 insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data)
 values(p_id,auth.uid(),ident->>'name',case when p_target is null then '신규 등록' else '기존 정보 업데이트' end,p_reason,before_value,
 jsonb_build_object('contact',(select to_jsonb(mc) from public.marketing_contacts mc where id=cid),'organization',(select to_jsonb(mo) from public.marketing_organizations mo where id=oid),'submissionSource',s.source,'reviewCheck',check_result,'resolution',p_resolution));
 return cid;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_review_check(p_id uuid, p_final jsonb, p_target uuid, p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.marketing_submissions; c public.marketing_contacts; r record; conflicts jsonb:='[]'; blocking jsonb:='[]'; company text; token text; rule_check jsonb; violation jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 권한이 필요합니다.' using errcode='42501'; end if;
 select * into s from public.marketing_submissions where id=p_id;
 if not found or s.status<>'pending' then raise exception '검수 상태가 변경되었습니다.' using errcode='40001'; end if;
 select * into c from public.marketing_contacts where id=p_target;
 select name into company from public.marketing_organizations where id=p_org;
 company:=coalesce(company,p_final->>'company','');
 if p_org is not null and nullif(btrim(s.data->>'company'),'') is not null and not exists(
 select 1 from public.marketing_organizations o where o.id=p_org and lower(btrim(s.data->>'company'))=any(array_prepend(lower(btrim(o.name)),array(select lower(btrim(a)) from unnest(o.aliases) a)))) then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','company','message','제출 회사명이 선택한 표준명·승인 별칭과 다릅니다. 동일 법인 여부를 확인하세요.'));
 end if;
 if s.target_id is not null and s.target_id is distinct from p_target then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','target','message','원래 지정한 DB ID와 최종 반영 대상이 다릅니다.')); end if;
 if c.id is not null and (lower(btrim(c.data->>'name')) is distinct from lower(btrim(p_final->>'name')) or c.organization_id is distinct from p_org) then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','identity','message','대상 Contact의 성명 또는 회사가 변경됩니다. 동일 인물·법인 여부를 확인하세요.','version',c.version));
 end if;
 for r in select mc.id,mc.db_id,mc.version from public.marketing_contacts mc left join public.marketing_organizations o on o.id=mc.organization_id
 where mc.id is distinct from p_target and
 (nullif(lower(btrim(mc.data->>'email')),'')=nullif(lower(btrim(s.data->>'email')),'') or
 (nullif(lower(btrim(mc.data->>'name')),'')=nullif(lower(btrim(p_final->>'name')),'') and
 (mc.organization_id=p_org or public.marketing_company_matches(coalesce(o.name,mc.data->>'company'),company)))) order by mc.id loop
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','contact:'||r.id,'message',r.db_id||' · 이메일 또는 회사·성명이 겹치는 기존 Contact','version',r.version));
 end loop;
 for r in select x.id,x.version from public.marketing_submissions x left join public.marketing_contacts t on t.id=x.target_id left join public.marketing_organizations o on o.id=t.organization_id
 where x.status in ('pending','validating') and x.id<>p_id and
 (nullif(lower(btrim(coalesce(nullif(x.data->>'email',''),t.data->>'email'))),'')=nullif(lower(btrim(p_final->>'email')),'') or
 (nullif(lower(btrim(coalesce(nullif(x.data->>'name',''),t.data->>'name'))),'')=nullif(lower(btrim(p_final->>'name')),'') and
 public.marketing_company_matches(coalesce(nullif(x.data->>'company',''),o.name,t.data->>'company'),company))) order by x.id loop
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','submission:'||r.id,'message','다른 검수 대기 제출과 이메일 또는 회사·성명이 겹칩니다.','version',r.version));
 end loop;
 if exists(select 1 from public.marketing_contacts where id is distinct from p_target and nullif(lower(btrim(data->>'email')),'')=nullif(lower(btrim(p_final->>'email')),'')) then
  blocking:=jsonb_build_array('최종 이메일을 다른 Contact가 사용하고 있습니다. 대상을 다시 선택하거나 이메일을 수정하세요.');
 end if;
 if p_org is null or not exists(select 1 from public.marketing_organizations where id=p_org) then
  blocking:=blocking||jsonb_build_array('회사·기관에 먼저 등록한 뒤 검색 결과에서 선택해 주세요.');
 end if;
 if s.submitted_organization_id is not null and s.submitted_organization_id is distinct from p_org then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','submitted-company','message','제출자가 선택한 회사·기관과 승인 대상이 다릅니다. 동일 법인 여부와 변경 근거를 확인하세요.'));
 end if;
 rule_check:=public.marketing_validate_rules_context(p_final||jsonb_build_object('company',company,'category',coalesce((select category from public.marketing_organizations where id=p_org),p_final->>'category','확인 필요'),'organization_status',coalesce((select review_status from public.marketing_organizations where id=p_org),'pending'))||case when c.id is not null then jsonb_build_object('db_id',c.db_id) else '{}'::jsonb end,
 jsonb_build_object('mode','master','hasOrganization',btrim(company)<>'','hasProvenance',true,'companyLinked',not exists(select 1 from jsonb_array_elements(conflicts) x where x->>'key'='company'),'duplicates',coalesce((select jsonb_agg(x) from jsonb_array_elements(conflicts) x where x->>'key' like 'contact:%'),'[]'::jsonb)));

 for violation in select value from jsonb_array_elements(rule_check->'violations') loop
  if violation->>'severity'='error' then blocking:=blocking||jsonb_build_array(violation->>'message');
  else conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','rule:'||(violation->>'id'),'message',violation->>'message','version',(violation->>'version')::integer)); end if;
 end loop;
 token:=md5(jsonb_build_object('id',p_id,'version',s.version,'final',p_final,'target',p_target,'org',p_org,'conflicts',conflicts,'rulesVersion',rule_check->>'version')::text);
 return jsonb_build_object('conflicts',conflicts,'blockingErrors',blocking,'ruleCheck',rule_check,'token',token,'checkedAt',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_reviewer_candidates(p_q text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare needle text:=lower(btrim(coalesce(p_q,''))); begin
 if not public.marketing_can_manage_reviewers() then raise exception '검수 관리자 권한이 필요합니다.' using errcode='42501'; end if;
 if length(needle)<2 or length(needle)>100 then raise exception '이름 또는 이메일을 2~100자로 검색하세요.' using errcode='22023'; end if;
 return jsonb_build_object('pageSize',20,
 'total',(select count(*) from public.user_profiles p where p.role in ('user','admin') and not public.marketing_manager_account(p.user_id) and not exists(select 1 from public.marketing_reviewers r where r.user_id=p.user_id) and position(needle in lower(concat_ws(' ',p.display_name,p.email)))>0),
 'rows',coalesce((select jsonb_agg(public.marketing_reviewer_details(x.user_id) order by x.display_name,x.user_id) from (
 select p.user_id,p.display_name from public.user_profiles p where p.role in ('user','admin') and not public.marketing_manager_account(p.user_id) and not exists(select 1 from public.marketing_reviewers r where r.user_id=p.user_id) and position(needle in lower(concat_ws(' ',p.display_name,p.email)))>0
 order by p.display_name,p.user_id limit 20 offset (greatest(1,least(100000,coalesce(p_page,1)))-1)*20) x),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_reviewer_details(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'userId',p.user_id,'name',coalesce(p.display_name,p.email),'email',p.email,'role',p.role,
  'isManager',public.marketing_manager_account(p.user_id),'pageAccess',a.allowed,'explicit',r.user_id is not null,
  'canReview',a.allowed,
  'grantedAt',case when r.user_id is not null and e.after_data->>'enabled'='true' then e.created_at end,
  'grantedBy',case when r.user_id is not null and e.after_data->>'enabled'='true' then e.actor_name end,
  'version',md5(jsonb_build_array(p.user_id,p.role,p.email,p.display_name,r.user_id,e.id,a.allowed)::text))
 from public.user_profiles p left join public.marketing_reviewers r on r.user_id=p.user_id
 cross join lateral (select public.marketing_access_account(p.user_id) allowed) a
 left join lateral (select ev.id,ev.actor_name,ev.created_at,ev.after_data from public.marketing_review_events ev
  where ev.action='검수 권한 변경' and ev.after_data->>'userId'=p.user_id::text order by ev.created_at desc,ev.id desc limit 1) e on true
 where p.user_id=p_user;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_reviewer_directory(p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.has_page_access('marketing') then raise exception '마케팅 DB 접근 권한이 없습니다.' using errcode='42501'; end if;
 return jsonb_build_object(
  'canManage',public.marketing_can_manage_reviewers(),
  'canImport',public.marketing_can_manage_reviewers() and exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin'),
  'rows',coalesce((select jsonb_agg(public.marketing_reviewer_details(p.user_id) order by p.display_name,p.user_id)
   from public.user_profiles p where p.user_id in ('46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid,'a4e1906d-b915-4e00-9b4e-657beeb396ae'::uuid)
   or exists(select 1 from public.marketing_reviewers r where r.user_id=p.user_id)),'[]'::jsonb),
  'total',(select count(*) from public.marketing_review_events where action='검수 권한 변경'), 'pageSize',20,
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
   select e.id,e.created_at,e.actor_name,e.reason,e.after_data->>'userId' as user_id,
    coalesce(e.after_data->>'name',p.display_name,'이름 미상') as name,
    coalesce(e.after_data->>'email',p.email,'') as email,
    e.after_data->>'enabled'='true' as enabled
   from public.marketing_review_events e left join public.user_profiles p on p.user_id::text=e.after_data->>'userId'
   where e.action='검수 권한 변경' order by e.created_at desc,e.id desc
   limit 20 offset (greatest(1,least(100000,coalesce(p_page,1)))-1)*20
  ) h),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_rule_config_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare fields text[]:=array['category','db_id','company','name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet']; op text:=p->>'operator'; k text; v jsonb; begin
 if jsonb_typeof(p) is distinct from 'object' or length(p::text)>10000 or op is null or op not in ('required','email','date','one_of','forbidden_values','max_length','review','builtin','duplicates','company_standard','classification','organization','provenance') then return false; end if;
 if op in ('required','email','date','one_of','forbidden_values','max_length') and not coalesce(p->>'field'=any(fields),false) then return false; end if;
 if p ? 'whenField' and not coalesce(p->>'whenField'=any(fields),false) then return false; end if;
 if p ? 'whenValue' and (not p ? 'whenField' or jsonb_typeof(p->'whenValue') is distinct from 'string') then return false; end if;
 if p ? 'whenAnyFields' then
  if jsonb_typeof(p->'whenAnyFields') is distinct from 'array' or jsonb_array_length(p->'whenAnyFields')<1 then return false; end if;
  for v in select value from jsonb_array_elements(p->'whenAnyFields') loop if jsonb_typeof(v)<>'string' or not (v#>>'{}')=any(fields) then return false; end if; end loop;
 end if;
 if op in ('one_of','forbidden_values') then
  if jsonb_typeof(p->'values') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'values') not between 1 and 100 then return false; end if;
  for v in select value from jsonb_array_elements(p->'values') loop if jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200 then return false; end if; end loop;
 end if;
 if op='max_length' and (jsonb_typeof(p->'max') is distinct from 'number' or not (p->>'max')~'^[0-9]{1,4}$') then return false; end if;
 if op='max_length' and (p->>'max')::integer not between 1 and 2000 then return false; end if;
 for k in select jsonb_object_keys(p) loop if k not in ('operator','field','values','max','whenField','whenValue','whenAnyFields') then return false; end if; end loop;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_rule_definition_check(p jsonb, p_code text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 if jsonb_typeof(p) is distinct from 'object' or length(btrim(coalesce(p->>'title',''))) not between 1 and 120 or length(coalesce(p->>'description',''))>2000
 or jsonb_typeof(p->'enabled') is distinct from 'boolean' or not public.marketing_rule_config_valid(p->'config')
 or coalesce(p->>'severity','') not in ('error','warning') or (p->'config'->>'operator'='review' and p->>'severity'<>'warning') then
  raise exception '규칙 이름·조건·등급을 확인해 주세요.' using errcode='22023'; end if;
 -- Organization names are structurally required to establish a company relationship.
 if p_code='EXCEL-03' and (p->'config'<>'{"operator":"required","field":"company"}'::jsonb or p->>'severity'<>'error' or p->>'enabled'<>'true') then
  raise exception '회사명 필수는 회사 연결의 시스템 제약입니다. 규칙 이름·설명은 수정할 수 있습니다.' using errcode='22023'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_safe_validation(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v jsonb; k text; a jsonb; begin
 v:=jsonb_build_object('kind',case when p->>'kind' in ('신규 등록','기존 정보 업데이트','중복 의심','확인 필요') then p->>'kind' else '확인 필요' end,
 'ruleVersion',coalesce(p->>'ruleVersion','직접 제출 · 검수 시 재검증'),'targetId',p->>'targetId','targetVersion',case when jsonb_typeof(p->'targetVersion')='number' then p->'targetVersion' else 'null'::jsonb end);
 foreach k in array array['errors','reasons','candidates','organizationIds'] loop
  a:='[]';
  if jsonb_typeof(p->k)='array' then select coalesce(jsonb_agg(value),'[]') into a from jsonb_array_elements(p->k) where jsonb_typeof(value)='string'; end if;
  v:=v||jsonb_build_object(k,a);
 end loop;
 v:=v||jsonb_build_object('ai',jsonb_build_object('status',case when p->'ai'->>'status' in ('not_needed','unavailable','success','failed') then p->'ai'->>'status' else 'unavailable' end,
 'reason',coalesce(p->'ai'->>'reason','검수 시 다시 확인해 주세요.'),'category',p->'ai'->>'category','organizationId',p->'ai'->>'organizationId','model',p->'ai'->>'model'));
 return v||jsonb_build_object('ruleCheck',case when jsonb_typeof(p->'ruleCheck')='object' and length((p->'ruleCheck')::text)<1000000 then p->'ruleCheck' else 'null'::jsonb end);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_save_rule(p_id uuid, p_version integer, p_title text, p_description text, p_config jsonb, p_severity text, p_enabled boolean, p_reason text)
 RETURNS marketing_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.marketing_rules; result public.marketing_rules; ident jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 담당자만 규칙을 변경할 수 있습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 if length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '변경 사유를 입력해 주세요.' using errcode='22023'; end if;
 if p_id is not null then
  select * into old from public.marketing_rules where id=p_id for update;
  if not found or old.version is distinct from p_version then raise exception '규칙이 변경되었습니다. 최신 버전과 비교해 주세요.' using errcode='40001'; end if;
 end if;
 perform public.marketing_rule_definition_check(jsonb_build_object('title',p_title,'description',p_description,'config',p_config,'severity',p_severity,'enabled',p_enabled),coalesce(old.code,''));
 ident:=public.marketing_identity();
 if p_id is null then
  insert into public.marketing_rules(code,title,description,config,severity,enabled,updated_by) values('CUSTOM-'||gen_random_uuid(),btrim(p_title),coalesce(p_description,''),p_config,p_severity,p_enabled,auth.uid()) returning * into result;
 else
  update public.marketing_rules set title=btrim(p_title),description=coalesce(p_description,''),config=p_config,severity=p_severity,enabled=p_enabled,protected=false,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into result;
 end if;
 insert into public.marketing_rule_history(rule_id,version,actor,actor_name,reason,before_data,after_data) values(result.id,result.version,auth.uid(),ident->>'name',p_reason,case when p_id is null then null else to_jsonb(old) end,to_jsonb(result));
 insert into public.marketing_rule_versions(rule_id,version,definition,reason,actor,actor_name) values(result.id,result.version,to_jsonb(result),p_reason,auth.uid(),ident->>'name');
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_search_contacts(p_q text, p_category text, p_issues boolean, p_offset integer, p_department text DEFAULT ''::text, p_limit integer DEFAULT 25, p_sort text DEFAULT 'db_id'::text, p_direction text DEFAULT 'asc'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with matched as (select c.*,to_jsonb(o) as organization, (c.delete_candidate is not null or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))='') as needs_maintenance,
 nullif(lower(btrim(case
  when p_sort='category' then coalesce(o.category,'확인 필요')
  when p_sort='company' then coalesce(o.name,c.data->>'company')
  when p_sort in ('name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet') then c.data->>p_sort
  else c.db_id end)),'') as sort_value
 from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id
 where (coalesce(p_q,'')='' or position(lower(p_q) in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',o.name)))>0)
 and (coalesce(p_department,'')='' or position(lower(p_department) in lower(coalesce(c.data->>'ownerDepartment','')))>0)
 and (coalesce(p_category,'')='' or o.category=p_category)
 and (not coalesce(p_issues,false) or c.delete_candidate is not null or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(t)-'sort_value') from (
  select * from matched order by
   case when p_direction='desc' then sort_value end desc nulls last,
   case when p_direction is distinct from 'desc' then sort_value end asc nulls last,
   db_id asc,id asc
  offset greatest(0,p_offset) limit case when p_limit is null then null else greatest(1,least(1000,p_limit)) end
 ) t),'[]'), 'total',(select count(*) from matched),'pageSize',p_limit);
$function$;

CREATE OR REPLACE FUNCTION public.marketing_set_reviewer(p_user uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin perform public.marketing_change_reviewer(p_user,p_enabled,null); end $function$;

CREATE OR REPLACE FUNCTION public.marketing_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('total',(select count(*) from public.marketing_contacts),
 'missingCompany',(select count(*) from public.marketing_contacts where btrim(coalesce(data->>'company',''))=''),
 'missingName',(select count(*) from public.marketing_contacts where btrim(coalesce(data->>'name',''))=''),
 'unclassified',(select count(*) from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id where o.id is null or o.category='확인 필요'),
 'pending',(select count(*) from public.marketing_submissions where status='pending'));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_submit(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; ident jsonb; result jsonb:='[]'; sid uuid; prior public.marketing_submissions; normalized jsonb; k text; selected_org public.marketing_organizations; selected_id uuid; selection_source jsonb;
begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception '한 번에 1~200건을 제출할 수 있습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 ident:=public.marketing_identity();
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r->'data')<>'object' or length((r->'data')::text)>40000 then raise exception '잘못된 입력입니다.' using errcode='22023'; end if;
  normalized:='{}';
  foreach k in array array['company','name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet'] loop
   if r->'data' ? k and (jsonb_typeof(r->'data'->k)<>'string' or length(r->'data'->>k)>2000) then raise exception 'Contact 필드는 2,000자 이하 문자열이어야 합니다.' using errcode='22023'; end if;
   normalized:=normalized||jsonb_build_object(k,btrim(coalesce(r->'data'->>k,'')));
  end loop;
  selected_id:=nullif(r->>'organizationId','')::uuid;
  selection_source:=coalesce(r->'source','{}')-'companySelection';
  if r->>'requireOrganization'='true' and selected_id is null then raise exception '등록된 회사·기관을 검색하여 선택해 주세요.' using errcode='22023'; end if;
  if selected_id is not null then
   select * into selected_org from public.marketing_organizations where id=selected_id;
   if not found then raise exception '선택한 회사·기관이 없습니다. 다시 검색해 주세요.' using errcode='22023'; end if;
   if selected_org.version is distinct from (r->>'organizationVersion')::integer then raise exception '회사 기준이 변경되었습니다. 다시 선택해 주세요.' using errcode='40001'; end if;
   if exists(select 1 from jsonb_array_elements_text(coalesce(r->'clearFields','[]')) f where f='company') then raise exception '회사·기관 선택은 삭제할 수 없습니다.' using errcode='22023'; end if;
   normalized:=jsonb_set(normalized,'{company}',to_jsonb(selected_org.name));
   selection_source:=selection_source||jsonb_build_object('companySelection',to_jsonb(selected_org));
  end if;
  insert into public.marketing_submissions(request_key,submitted_by,submitter,division,data,target_id,clear_fields,validation,source,status,submitted_organization_id)
   values((r->>'requestKey')::uuid,auth.uid(),ident->>'name',ident->>'division',normalized,nullif(r->>'targetId','')::uuid,
   array(select jsonb_array_elements_text(coalesce(r->'clearFields','[]'))),public.marketing_safe_validation(r->'validation'),selection_source,case when r->>'processing'='true' then 'validating' else 'pending' end,selected_id)
   on conflict(request_key) do nothing returning id into sid;
  if sid is null then
   select * into prior from public.marketing_submissions where request_key=(r->>'requestKey')::uuid;
   if prior.submitted_by<>auth.uid() or prior.data<>normalized or prior.submitted_organization_id is distinct from selected_id or prior.target_id is distinct from nullif(r->>'targetId','')::uuid or prior.clear_fields is distinct from array(select jsonb_array_elements_text(coalesce(r->'clearFields','[]'))) then raise exception '동일 요청 키가 다른 제출에 사용되었습니다.' using errcode='22023'; end if;
   sid:=prior.id;
  end if;
  result:=result||jsonb_build_array(sid);
 end loop;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_update_organization(p_id uuid, p_version integer, p_name text, p_category text, p_aliases text[], p_reason text, p_review_status text DEFAULT 'pending'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.marketing_organizations; ident jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 2000 or not public.marketing_category_valid(p_category) or length(btrim(coalesce(p_reason,'')))<2 or coalesce(array_length(p_aliases,1),0)>50 then raise exception '회사명·분류·변경 사유를 확인해 주세요.' using errcode='22023'; end if;
 if p_review_status not in ('pending','confirmed') or (p_review_status='confirmed' and p_category='확인 필요') then raise exception '분류 미확정 회사는 확인 완료로 처리할 수 없습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into old from public.marketing_organizations where id=p_id for update;
 if not found or old.version is distinct from p_version then raise exception '회사 정보가 변경되었습니다.' using errcode='40001'; end if;
 update public.marketing_organizations set name=btrim(p_name),category=p_category,aliases=p_aliases,review_status=p_review_status,version=version+1 where id=p_id;
 -- Invalidates open contact reviews when the company-wide classification/name changes.
 update public.marketing_contacts set version=version+1,updated_at=now() where organization_id=p_id;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data) values(auth.uid(),ident->>'name','회사·기관 기준 변경',p_reason,to_jsonb(old),(select to_jsonb(o) from public.marketing_organizations o where id=p_id));
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_update_reviewer(p_user uuid, p_enabled boolean, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if p_version is null or length(p_version)<>32 then raise exception '현재 권한 정보를 불러온 뒤 변경해 주세요.' using errcode='22023'; end if;
 return public.marketing_change_reviewer(p_user,p_enabled,p_version);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_validate_rules(p_data jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select public.marketing_validate_rules_context(p_data,'{}');
$function$;

CREATE OR REPLACE FUNCTION public.marketing_validate_rules_context(p_data jsonb, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r public.marketing_rules; rules jsonb:='[]'; violations jsonb:='[]'; results jsonb:='[]'; evaluated jsonb; begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Contact 필드가 필요합니다.' using errcode='22023'; end if;
 for r in select * from public.marketing_rules where enabled order by code loop
  rules:=rules||jsonb_build_array(to_jsonb(r)); evaluated:=public.marketing_evaluate_rule(to_jsonb(r),p_data,p_context);
  results:=results||jsonb_build_array(evaluated||jsonb_build_object('id',r.id,'code',r.code,'version',r.version,'title',r.title));
  if evaluated->>'outcome' in ('fail','review','error') then
   violations:=violations||jsonb_build_array(evaluated||jsonb_build_object('id',r.id,'code',r.code,'version',r.version,'title',r.title,'message',r.title||': '||(evaluated->>'message')));
  end if;
 end loop;
 return jsonb_build_object('version',md5(rules::text),'rules',rules,'violations',violations,'results',results);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_validation_action(p_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.marketing_validation_runs; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action='kick' then perform public.marketing_process_validation_chunk(p_id,200); return jsonb_build_object('ok',true); end if;
 select * into j from public.marketing_validation_runs where id=p_id for update;
 if not found then raise exception '검증 실행을 찾을 수 없습니다.' using errcode='P0002'; end if;
 if p_action='cancel' then
  if j.status in ('queued','running','cancel_requested') then update public.marketing_validation_runs set status='cancelled',finished_at=clock_timestamp() where id=p_id; end if;
 elsif p_action='retry' then
  if j.status not in ('completed_with_errors','failed','cancelled') then raise exception '실패 또는 취소된 실행만 재시도할 수 있습니다.' using errcode='22023'; end if;
  update public.marketing_validation_targets set processed=false where run_id=p_id and outcome='error';
  update public.marketing_validation_runs set status='queued',attempt=attempt+1,finished_at=null,last_error=null,processed=(select count(*) from public.marketing_validation_targets where run_id=p_id and processed) where id=p_id;
 else raise exception '지원하지 않는 작업입니다.' using errcode='22023'; end if;
 return jsonb_build_object('ok',true);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_validation_basis_changed(p_run uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.marketing_validation_runs j,jsonb_array_elements(j.rules) r where j.id=p_run and r->'config'->>'operator' in ('duplicates','company_standard','classification','organization')) and (
 exists(select 1 from public.marketing_validation_reference r left join public.marketing_contacts c on c.id=r.contact_id where r.run_id=p_run and (c.id is null or c.version<>r.version))
 or exists(select 1 from public.marketing_contacts c where not exists(select 1 from public.marketing_validation_reference r where r.run_id=p_run and r.contact_id=c.id))
 or exists(select 1 from public.marketing_validation_organizations r left join public.marketing_organizations o on o.id=r.organization_id where r.run_id=p_run and (o.id is null or o.version<>(r.snapshot->>'version')::integer))
 or exists(select 1 from public.marketing_organizations o where not exists(select 1 from public.marketing_validation_organizations r where r.run_id=p_run and r.organization_id=o.id)));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_validation_followup(p_request_key uuid, p_run uuid, p_contact uuid, p_status text, p_reason text, p_current_version integer, p_org_version integer, p_submission uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.marketing_validation_targets; c public.marketing_contacts; j public.marketing_validation_runs; ov integer; result uuid; prior public.marketing_validation_followups; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into prior from public.marketing_validation_followups where request_key=p_request_key;
 if found then
  if prior.run_id=p_run and prior.contact_id=p_contact and prior.status=p_status and prior.reason=p_reason and prior.submission_id is not distinct from p_submission and prior.actor=auth.uid() then return prior.id; end if;
  raise exception '같은 요청 키에 다른 처리 내용입니다.' using errcode='22023';
 end if;
 select * into t from public.marketing_validation_targets where run_id=p_run and contact_id=p_contact;
 select * into j from public.marketing_validation_runs where id=p_run;
 select * into c from public.marketing_contacts where id=p_contact;
 select version into ov from public.marketing_organizations where id=c.organization_id;
 if t.contact_id is null or c.id is null or c.version is distinct from p_current_version or ov is distinct from p_org_version then raise exception '현재 Contact/회사 기준이 변경되었습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 if p_status='confirmed' and (public.marketing_validation_basis_changed(p_run) or not t.processed or c.version<>(t.snapshot->>'version')::integer or coalesce(ov,0)<>coalesce((t.snapshot->'organization'->>'version')::integer,0) or
  exists(select 1 from jsonb_array_elements(j.rules) r join public.marketing_rules live on live.id=(r->>'id')::uuid where r->>'code'<>'DRAFT' and live.version<>(r->>'version')::integer)) then raise exception '검증 이후 기준이 바뀌었거나 미처리 자료입니다. 최신 상태로 재검증해 주세요.' using errcode='40001'; end if;
 if p_status='submitted' and not exists(select 1 from public.marketing_submissions s where s.id=p_submission and s.target_id=p_contact and s.source->>'validationRunId'=p_run::text) then raise exception '이 검증에서 제출한 변경 요청만 연결할 수 있습니다.' using errcode='22023'; end if;
 insert into public.marketing_validation_followups(request_key,run_id,contact_id,status,reason,actor,actor_name,current_version,organization_version,submission_id)
 values(p_request_key,p_run,p_contact,p_status,p_reason,auth.uid(),public.marketing_identity()->>'name',c.version,ov,p_submission) returning id into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_validation_report(p_id uuid, p_page integer DEFAULT 1, p_rule integer DEFAULT 0, p_outcome text DEFAULT ''::text, p_q text DEFAULT ''::text, p_followup text DEFAULT ''::text, p_limit integer DEFAULT 25, p_severity text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; begin
 -- A parameter-specific plan avoids the generic SQL-function plan for differently sized runs.
 -- The query is fixed text; all caller inputs are bound with USING.
 execute $report$
with job as materialized (select * from public.marketing_validation_runs where id=$1),
 latest as materialized (select distinct on (r.contact_id,r.rule_index) r.* from public.marketing_validation_results r join job on job.id=r.run_id order by r.contact_id,r.rule_index,r.attempt desc),
 targets as materialized (select t.*, (c.id is null or c.version<>(t.snapshot->>'version')::integer or coalesce(o.version,0)<>coalesce((t.snapshot->'organization'->>'version')::integer,0)) as stale,
  f.status as followup_status, f.reason as followup_reason, f.submission_id, s.status as submission_status,
  (f.id is not null and (c.version<>f.current_version or coalesce(o.version,0)<>coalesce(f.organization_version,0) or (select public.marketing_validation_basis_changed($1)) or exists(select 1 from job,jsonb_array_elements(job.rules) r join public.marketing_rules live on live.id=(r->>'id')::uuid where r->>'code'<>'DRAFT' and live.version<>(r->>'version')::integer))) as followup_stale,
  c.version as current_version, o.version as current_organization_version
  from public.marketing_validation_targets t join job on job.id=t.run_id left join public.marketing_contacts c on c.id=t.contact_id left join public.marketing_organizations o on o.id=c.organization_id
  left join lateral (select * from public.marketing_validation_followups f where f.run_id=t.run_id and f.contact_id=t.contact_id order by f.created_at desc,f.id desc limit 1) f on true
  left join public.marketing_submissions s on s.id=f.submission_id),
 filtered as materialized (select t.* from targets t where
  (coalesce($5,'')='' or position(lower($5) in lower(concat_ws(' ',t.snapshot->>'db_id',t.snapshot->'data'->>'name',t.snapshot->'organization'->>'name',t.snapshot->'data'->>'company')))>0)
  and (coalesce($6,'')='' or ($6='open' and (t.followup_status is null or t.followup_stale)) or (t.followup_status=$6 and not t.followup_stale))
  and (($3=0 and coalesce($4,'')='' and coalesce($8,'')='') or exists(select 1 from latest r where r.contact_id=t.contact_id and ($3=0 or r.rule_index=$3) and (coalesce($4,'')='' or r.outcome=$4) and (coalesce($8,'')='' or r.severity=$8)))),
 page_targets as materialized (select * from filtered order by ordinal offset (greatest(1,$2)-1)*greatest(1,least($7,500)) limit greatest(1,least($7,500))),
 page_results as materialized (select r.contact_id,jsonb_agg(to_jsonb(r)||case when r.outcome='pass' then jsonb_build_object('detail',r.detail||jsonb_build_object('message','기준 충족')) else '{}'::jsonb end order by r.rule_index) as results from latest r join page_targets t on t.contact_id=r.contact_id where ($3=0 or r.rule_index=$3) and (coalesce($4,'')='' or r.outcome=$4) and (coalesce($8,'')='' or r.severity=$8) group by r.contact_id)
 select jsonb_build_object('run',(select to_jsonb(job)-'request' from job),'total',(select count(*) from filtered),
 'comparisonChanged',(select public.marketing_validation_basis_changed($1)),
 'rulesChanged',exists(select 1 from job,jsonb_array_elements(job.rules) r left join public.marketing_rules live on live.id=(r->>'id')::uuid where r->>'code'<>'DRAFT' and (live.id is null or live.version<>(r->>'version')::integer)),
 'exportToken',md5(coalesce((select jsonb_agg(jsonb_build_array(t.contact_id,t.current_version,t.current_organization_version,t.followup_status,t.followup_reason,t.submission_status,t.followup_stale) order by ordinal)::text from targets t),'[]')||coalesce((select to_jsonb(job)::text from job),'')||coalesce((select jsonb_agg(jsonb_build_array(id,version) order by id)::text from public.marketing_rules),'')||'report-v2.3'),
 'selectedIds',case when (select scope from job)='selected' then coalesce((select jsonb_agg(contact_id order by ordinal) from targets),'[]') else '[]'::jsonb end,
 'counts',coalesce((select jsonb_object_agg(outcome,n) from (select coalesce(outcome,'pending') as outcome,count(*) as n from targets group by 1) x),'{}'),
 'ruleCounts',coalesce((select jsonb_agg(to_jsonb(x) order by rule_index,outcome) from (select r.rule_index,r.outcome,r.severity,count(*) as count,
  count(distinct t.snapshot->>'organization_id') as companies from latest r join targets t on t.contact_id=r.contact_id group by r.rule_index,r.outcome,r.severity) x),'[]'),
 'rows',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('results',coalesce(pr.results,'[]'),'followups',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.marketing_validation_followups f where f.run_id=t.run_id and f.contact_id=t.contact_id),'[]')) order by t.ordinal)
  from page_targets t left join page_results pr on pr.contact_id=t.contact_id),'[]'));
$report$ into result using p_id,p_page,p_rule,p_outcome,p_q,p_followup,p_limit,p_severity;
 return result;
end $function$;

CREATE OR REPLACE PROCEDURE public.marketing_validation_worker()
 LANGUAGE plpgsql
AS $procedure$
declare started timestamptz:=clock_timestamp(); n integer; begin
 loop
  n:=public.marketing_process_validation_chunk(null,200);
  commit;
  exit when n=0 or clock_timestamp()-started>interval '20 seconds';
 end loop;
end $procedure$;

CREATE OR REPLACE FUNCTION public.media_alert_recipients()
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.user_id, u.email
  from public.media_alert_subscriptions s
  join auth.users u on u.id = s.user_id and u.email is not null and u.email_confirmed_at is not null
  join public.user_profiles p on p.user_id = s.user_id and p.role in ('user', 'admin')
  left join public.user_page_access a on a.user_id = s.user_id
  where s.enabled and (p.role = 'admin' or coalesce((a.permissions->>'people_news')::boolean, true))
  order by u.email;
$function$;

CREATE OR REPLACE FUNCTION public.media_department_delete(p_id uuid)
 RETURNS media_departments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare caller uuid := auth.uid(); removed public.media_departments;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'Department id required' using errcode = '22023'; end if;
  delete from public.media_departments where id = p_id returning * into removed;
  if not found then raise exception 'Department not found' using errcode = 'P0002'; end if;
  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_department_save(p_id uuid, p_outlet_id uuid, p_name text, p_active boolean)
 RETURNS media_departments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare caller uuid := auth.uid(); n text := btrim(coalesce(p_name, '')); nn text := public.media_norm(btrim(coalesce(p_name, ''))); result public.media_departments;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_outlet_id is null or not exists (select 1 from public.media_outlets where id = p_outlet_id) then raise exception 'Outlet not found' using errcode = 'P0002'; end if;
  if length(n) < 2 or length(n) > 100 or length(nn) < 2 then raise exception 'Invalid department name' using errcode = '22023'; end if;
  if exists (select 1 from public.media_departments d where d.outlet_id = p_outlet_id and d.name_norm = nn and d.id is distinct from p_id) then
    raise exception 'Department already exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.media_departments (outlet_id, name, name_norm, active, updated_by) values (p_outlet_id, n, nn, coalesce(p_active, true), caller) returning * into result;
  else
    update public.media_departments set name = n, name_norm = nn, active = coalesce(p_active, active), updated_at = now(), updated_by = caller
      where id = p_id and outlet_id = p_outlet_id returning * into result;
    if not found then raise exception 'Department not found' using errcode = 'P0002'; end if;
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_directory_import(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := auth.uid();
  item jsonb; outlet_name text; dept_name text; outlet_norm text; dept_norm text; outlet_row public.media_outlets;
  outlets_added integer := 0; outlets_existing integer := 0; depts_added integer := 0; depts_existing integer := 0; any_set integer := 0; skipped integer := 0;
  seen_outlets text[] := '{}'; seen_pairs text[] := '{}';
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Invalid rows' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_rows) loop
    outlet_name := btrim(coalesce(item->>'outlet', '')); dept_name := btrim(coalesce(item->>'department', ''));
    outlet_norm := public.media_norm(outlet_name);
    if length(outlet_norm) < 2 or length(outlet_name) > 100 or length(dept_name) > 100 then skipped := skipped + 1; continue; end if;
    select * into outlet_row from public.media_outlets where name_norm = outlet_norm;
    if not found then
      insert into public.media_outlets (name, name_norm, updated_by) values (outlet_name, outlet_norm, caller) returning * into outlet_row;
      outlets_added := outlets_added + 1;
    elsif not (outlet_norm = any(seen_outlets)) then
      outlets_existing := outlets_existing + 1;
      if not outlet_row.active then update public.media_outlets set active = true, updated_at = now(), updated_by = caller where id = outlet_row.id; end if;
    end if;
    seen_outlets := array_append(seen_outlets, outlet_norm);
    if dept_name = '' then
      if not outlet_row.any_department then
        update public.media_outlets set any_department = true, updated_at = now(), updated_by = caller where id = outlet_row.id;
        any_set := any_set + 1;
      end if;
      continue;
    end if;
    dept_norm := public.media_norm(dept_name);
    if length(dept_norm) < 2 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from public.media_departments where outlet_id = outlet_row.id and name_norm = dept_norm) then
      if not ((outlet_norm || '|' || dept_norm) = any(seen_pairs)) then depts_existing := depts_existing + 1; end if;
      update public.media_departments set active = true, updated_at = now(), updated_by = caller where outlet_id = outlet_row.id and name_norm = dept_norm and not active;
    else
      insert into public.media_departments (outlet_id, name, name_norm, updated_by) values (outlet_row.id, dept_name, dept_norm, caller);
      depts_added := depts_added + 1;
    end if;
    seen_pairs := array_append(seen_pairs, outlet_norm || '|' || dept_norm);
  end loop;
  return jsonb_build_object('outletsAdded', outlets_added, 'outletsExisting', outlets_existing, 'departmentsAdded', depts_added,
    'departmentsExisting', depts_existing, 'anyDepartmentSet', any_set, 'skipped', skipped);
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_match_notices(p_source_ids text[], p_run_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted jsonb;
begin
  with notices as (
    select n.source_id, public.media_norm(n.title || ' ' || n.summary) as body
    from public.yonhap_notices n where n.source_id = any(coalesce(p_source_ids, '{}'::text[])) and n.category = 'obituary'
  ), outlet_hits as (
    select x.source_id, o.id as outlet_id, o.name, o.any_department
    from notices x join public.media_outlets o on o.active
    where position(o.name_norm in x.body) > 0 or exists (select 1 from unnest(o.aliases_norm) a where position(a in x.body) > 0)
  ), candidates as (
    select h.source_id, h.outlet_id, null::uuid as department_id, h.name as matched_text from outlet_hits h where h.any_department
    union all
    select h.source_id, h.outlet_id, d.id, h.name || ' / ' || d.name
    from outlet_hits h join public.media_departments d on d.outlet_id = h.outlet_id and d.active
    join notices x on x.source_id = h.source_id where position(d.name_norm in x.body) > 0
  ), ins as (
    insert into public.media_obituary_matches (source_id, outlet_id, department_id, matched_text, sync_run_id)
    select c.source_id, c.outlet_id, c.department_id, c.matched_text, p_run_id from candidates c
    on conflict do nothing returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'sourceId', i.source_id, 'outlet', o.name, 'department', d.name, 'matchedText', i.matched_text,
           'title', n.title, 'summary', n.summary, 'url', n.source_url, 'publishedAt', n.published_at) order by n.published_at desc, i.id), '[]'::jsonb)
    into inserted
  from ins i join public.yonhap_notices n on n.source_id = i.source_id
  join public.media_outlets o on o.id = i.outlet_id left join public.media_departments d on d.id = i.department_id;
  return inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select translate(regexp_replace(lower(p), '㈜|㈔|\(주\)|\(사\)|주식회사|사단법인|\s', '', 'g'), '·.,()[]/\''"“”‘’&:;!?-', '');
$function$;

CREATE OR REPLACE FUNCTION public.media_outlet_save(p_id uuid, p_name text, p_aliases text[], p_any_department boolean, p_active boolean)
 RETURNS media_outlets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := auth.uid(); n text := btrim(coalesce(p_name, '')); nn text := public.media_norm(btrim(coalesce(p_name, '')));
  al text[] := '{}'; aln text[] := '{}'; a text; an text; result public.media_outlets;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if length(n) < 2 or length(n) > 100 or length(nn) < 2 then raise exception 'Invalid outlet name' using errcode = '22023'; end if;
  foreach a in array coalesce(p_aliases, '{}'::text[]) loop
    a := btrim(coalesce(a, '')); an := public.media_norm(a);
    if a = '' then continue; end if;
    if length(a) > 100 or length(an) < 2 then raise exception 'Invalid alias' using errcode = '22023'; end if;
    if an = nn or an = any(aln) then continue; end if;
    al := array_append(al, a); aln := array_append(aln, an);
  end loop;
  if cardinality(al) > 20 then raise exception 'Too many aliases' using errcode = '22023'; end if;
  if exists (select 1 from public.media_outlets o where o.id is distinct from p_id
             and (o.name_norm = nn or o.name_norm = any(aln) or nn = any(o.aliases_norm) or o.aliases_norm && aln)) then
    raise exception 'Outlet name or alias already used' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.media_outlets (name, name_norm, aliases, aliases_norm, any_department, active, updated_by)
      values (n, nn, al, aln, coalesce(p_any_department, false), coalesce(p_active, true), caller) returning * into result;
  else
    update public.media_outlets set name = n, name_norm = nn, aliases = al, aliases_norm = aln,
      any_department = coalesce(p_any_department, any_department), active = coalesce(p_active, active), updated_at = now(), updated_by = caller
      where id = p_id returning * into result;
    if not found then raise exception 'Outlet not found' using errcode = 'P0002'; end if;
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_user_profile_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change user role';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_audit_logs(p_days integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  a_deleted bigint := 0;
  l_deleted bigint := 0;
  n bigint;
begin
  loop
    delete from public.action_history
     where id in (select id from public.action_history where created_at < cutoff limit 5000);
    get diagnostics n = row_count;
    a_deleted := a_deleted + n;
    exit when n = 0;
  end loop;

  delete from public.login_history l
   where l.logged_in_at < cutoff
     and l.id not in (
       select distinct on (x.user_id, x.platform) x.id
         from (
           select id, user_id, logged_in_at,
                  substring(lower(coalesce(user_agent, '')) from '^innogridapp/\S+ \((ios|android|macos|windows)\)') as platform
             from public.login_history
         ) x
        where x.platform is not null
        order by x.user_id, x.platform, x.logged_in_at desc
     );
  get diagnostics l_deleted = row_count;

  return jsonb_build_object('cutoff', cutoff, 'action_history', a_deleted, 'login_history', l_deleted);
end;
$function$;

CREATE OR REPLACE FUNCTION public.rfp_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.rfp_share_link_viewed(p_token text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.rfp_share_links
     set view_count = view_count + 1, last_viewed_at = now()
   where token = p_token;
$function$;

CREATE OR REPLACE FUNCTION public.set_media_alert_subscription(p_enabled boolean)
 RETURNS media_alert_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare caller uuid := auth.uid(); saved public.media_alert_subscriptions;
begin
  if caller is null or not public.has_page_access('people_news') then raise exception 'Page access denied' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'Invalid subscription' using errcode = '22023'; end if;
  if p_enabled and not exists (select 1 from auth.users where id = caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode = '22023';
  end if;
  insert into public.media_alert_subscriptions (user_id, enabled) values (caller, p_enabled)
    on conflict (user_id) do update set enabled = excluded.enabled, updated_at = now() returning * into saved;
  return saved;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_page_access(p_user_id uuid, p_permissions jsonb, p_expected_version integer)
 RETURNS user_page_access
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target_role text; current_version integer; result public.user_page_access;
begin
  if not exists (select 1 from public.user_profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_permissions is null or not public.valid_page_permissions(p_permissions) or p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid permissions' using errcode = '22023';
  end if;
  select role into target_role from public.user_profiles where user_id = p_user_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  -- Administrators always reach every ordinary page; only the marketing key may be stored for them.
  if target_role = 'admin' and exists (select 1 from jsonb_object_keys(p_permissions) k where k <> 'marketing') then
    raise exception 'Administrators always have access' using errcode = '22023';
  end if;
  select version into current_version from public.user_page_access where user_id = p_user_id;
  if coalesce(current_version, 0) <> p_expected_version then
    raise exception 'Permissions changed; reload first' using errcode = '40001';
  end if;
  insert into public.user_page_access(user_id, permissions, version, updated_by)
    values (p_user_id, p_permissions, 1, auth.uid())
    on conflict (user_id) do update set permissions = excluded.permissions,
      version = public.user_page_access.version + 1, updated_at = now(), updated_by = auth.uid()
    returning * into result;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_yonhap_notice_subscription(p_enabled boolean, p_send_time text, p_exclude_sent boolean DEFAULT NULL::boolean)
 RETURNS yonhap_notice_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := auth.uid();
  due timestamptz;
  saved public.yonhap_notice_subscriptions;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role in ('user', 'admin')) then
    raise exception 'User permission required' using errcode = '42501';
  end if;
  if p_enabled is null or p_send_time is null or p_send_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid subscription settings' using errcode = '22023';
  end if;
  if p_enabled and not exists (select 1 from auth.users where id = caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode = '22023';
  end if;
  due := ((now() at time zone 'Asia/Seoul')::date + p_send_time::time) at time zone 'Asia/Seoul';
  if due <= now() then due := due + interval '1 day'; end if;
  insert into public.yonhap_notice_subscriptions (user_id, enabled, send_time, next_send_at, exclude_sent)
    values (caller, p_enabled, p_send_time::time, case when p_enabled then due end, coalesce(p_exclude_sent, true))
  on conflict (user_id) do update set
    enabled = excluded.enabled, send_time = excluded.send_time,
    exclude_sent = coalesce(p_exclude_sent, public.yonhap_notice_subscriptions.exclude_sent),
    next_send_at = case
      when not excluded.enabled then null
      when public.yonhap_notice_subscriptions.enabled and public.yonhap_notice_subscriptions.send_time = excluded.send_time
        then public.yonhap_notice_subscriptions.next_send_at
      else excluded.next_send_at end,
    updated_at = now()
  returning * into saved;
  return saved;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_survey_response(p_survey_id uuid, p_answers jsonb, p_meta jsonb DEFAULT '{}'::jsonb, p_respondent_hash text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_survey   public.surveys;
  v_uid      uuid := auth.uid();
  v_resp_id  uuid;
  v_hash     text;
  v_ans      jsonb;
BEGIN
  SELECT * INTO v_survey FROM public.surveys WHERE id = p_survey_id;
  IF v_survey.id IS NULL OR v_survey.status <> 'open' THEN
    RAISE EXCEPTION 'survey_not_open';
  END IF;

  IF v_survey.access_mode = 'authenticated' AND v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF v_uid IS NOT NULL AND v_survey.is_anonymous THEN
    -- ANONYMOUS SURVEY + logged-in user: NULL user_id, one-way hash dedup.
    -- digest lives in the extensions schema; schema-qualify since search_path excludes it.
    v_hash := encode(extensions.digest(v_uid::text || p_survey_id::text, 'sha256'), 'hex');
    INSERT INTO public.survey_responses(survey_id, respondent_user_id, respondent_hash, is_complete, meta)
      VALUES (p_survey_id, NULL, v_hash, false, COALESCE(p_meta, '{}'::jsonb))
    ON CONFLICT (survey_id, respondent_hash)
      WHERE respondent_user_id IS NULL AND respondent_hash IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_resp_id;
    IF v_resp_id IS NULL THEN
      RAISE EXCEPTION 'already_submitted';
    END IF;

  ELSIF v_uid IS NOT NULL THEN
    INSERT INTO public.survey_responses(survey_id, respondent_user_id, is_complete, meta)
      VALUES (p_survey_id, v_uid, false, COALESCE(p_meta, '{}'::jsonb))
    ON CONFLICT (survey_id, respondent_user_id)
      WHERE respondent_user_id IS NOT NULL
      DO UPDATE SET meta = EXCLUDED.meta, updated_at = now()
    RETURNING id INTO v_resp_id;
    IF EXISTS (
      SELECT 1 FROM public.survey_responses
      WHERE id = v_resp_id AND is_complete = true
    ) THEN
      RAISE EXCEPTION 'already_submitted';
    END IF;

  ELSE
    IF p_respondent_hash IS NULL THEN
      RAISE EXCEPTION 'hash_required';
    END IF;
    INSERT INTO public.survey_responses(survey_id, respondent_hash, is_complete, meta)
      VALUES (p_survey_id, p_respondent_hash, false, COALESCE(p_meta, '{}'::jsonb))
    ON CONFLICT (survey_id, respondent_hash)
      WHERE respondent_user_id IS NULL AND respondent_hash IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_resp_id;
    IF v_resp_id IS NULL THEN
      RAISE EXCEPTION 'already_submitted';
    END IF;
  END IF;

  FOR v_ans IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
    INSERT INTO public.survey_answers(response_id, question_id, value_text, value_number, value_json)
      VALUES (
        v_resp_id,
        (v_ans->>'question_id')::uuid,
        v_ans->>'value_text',
        NULLIF(v_ans->>'value_number', '')::numeric,
        v_ans->'value_json'
      )
    ON CONFLICT (response_id, question_id)
      DO UPDATE SET
        value_text   = EXCLUDED.value_text,
        value_number = EXCLUDED.value_number,
        value_json   = EXCLUDED.value_json,
        updated_at   = now();
  END LOOP;

  UPDATE public.survey_responses
    SET is_complete = true, submitted_at = now(), updated_at = now()
    WHERE id = v_resp_id;

  RETURN v_resp_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.valid_page_permissions(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail','dooray','assistant','proposal') or jsonb_typeof(e.value)<>'boolean') end;
$function$;

CREATE OR REPLACE FUNCTION public.work_items_contributors(p_from date, p_to date, p_emails text[], p_kinds text[])
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct lower(user_email))::bigint
  from (
    select kind, user_email, case when kind = 'commit' then created_at else done_at end as ts
    from work_items
  ) x
  where ts is not null
    and ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and kind = any (p_kinds)
    and (p_emails is null or lower(user_email) = any (p_emails))
$function$;

CREATE OR REPLACE FUNCTION public.work_items_hourly(p_from date, p_to date, p_emails text[], p_kinds text[])
 RETURNS TABLE(kind text, dow integer, hour integer, n bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select kind,
    extract(isodow from (ts at time zone 'Asia/Seoul'))::int as dow,
    extract(hour   from (ts at time zone 'Asia/Seoul'))::int as hour,
    count(*)::bigint as n
  from (
    select kind, user_email, case when kind = 'commit' then created_at else done_at end as ts
    from work_items
  ) x
  where ts is not null
    and ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and kind = any (p_kinds)
    and (p_emails is null or lower(user_email) = any (p_emails))
  group by 1, 2, 3
$function$;

CREATE OR REPLACE FUNCTION public.work_items_time_stats(p_from date, p_to date, p_emails text[])
 RETURNS TABLE(grp text, kind text, metric text, n bigint, p50 numeric, p90 numeric, avg numeric, b1 bigint, b2 bigint, b3 bigint, b4 bigint, b5 bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with base as (
    select kind, lower(user_email) as user_email, scope_key,
      to_char(date_trunc('week', done_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as week,
      greatest(0, extract(epoch from (done_at - created_at)) / 3600) as lead_h,
      case when started_at is not null then greatest(0, extract(epoch from (done_at - started_at)) / 3600) end as cycle_h,
      case when started_at is not null then greatest(0, extract(epoch from (started_at - created_at)) / 3600) end as wait_h
    from work_items
    where done_at >= (p_from::text || ' 00:00:00+09')::timestamptz
      and done_at <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
      and kind in ('issue', 'mr')
      and (p_emails is null or lower(user_email) = any (p_emails))
  ), m as (
    select kind, user_email, scope_key, week, 'lead'::text as metric, lead_h as h from base
    union all select kind, user_email, scope_key, week, 'cycle', cycle_h from base where kind = 'issue' and cycle_h is not null
    union all select kind, user_email, scope_key, week, 'wait',  wait_h  from base where kind = 'issue' and wait_h  is not null
  )
  select coalesce('week:' || week, 'user:' || user_email, 'scope:' || scope_key, 'all') as grp, kind, metric,
    count(*)::bigint as n,
    (percentile_cont(0.5) within group (order by h))::numeric as p50,
    (percentile_cont(0.9) within group (order by h))::numeric as p90,
    avg(h)::numeric as avg,
    count(*) filter (where h <= 4)::bigint               as b1,
    count(*) filter (where h > 4   and h <= 24)::bigint  as b2,
    count(*) filter (where h > 24  and h <= 72)::bigint  as b3,
    count(*) filter (where h > 72  and h <= 168)::bigint as b4,
    count(*) filter (where h > 168)::bigint              as b5
  from m
  group by grouping sets ((kind, metric), (kind, metric, week), (kind, metric, user_email), (kind, metric, scope_key))
$function$;

CREATE OR REPLACE FUNCTION public.yonhap_notice_digest_window(p_user uuid, p_exclude_sent boolean DEFAULT NULL::boolean)
 RETURNS TABLE(period_from timestamp with time zone, period_to timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when coalesce(p_exclude_sent, (select s.exclude_sent from public.yonhap_notice_subscriptions s where s.user_id = p_user), true)
              then coalesce(public.yonhap_notice_last_sent_all(p_user), now()-interval '24 hours')
              else now()-interval '24 hours' end,
         now();
$function$;

CREATE OR REPLACE FUNCTION public.yonhap_notice_last_sent_all(p_user uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select max(t) from (
    select max(period_to) as t from public.yonhap_notice_email_deliveries where user_id = p_user and status = 'sent'
    union all
    select max(period_to) from public.yonhap_notice_manual_deliveries where user_id = p_user and status = 'sent'
  ) s;
$function$;

-- 트리거
CREATE TRIGGER groups_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER marketing_email_result_audit AFTER INSERT ON public.marketing_email_results FOR EACH ROW EXECUTE FUNCTION marketing_email_result_audit();
CREATE TRIGGER marketing_event_context BEFORE INSERT ON public.marketing_review_events FOR EACH ROW EXECUTE FUNCTION marketing_enrich_event();
CREATE TRIGGER marketing_validation_log AFTER INSERT OR UPDATE OF validation ON public.marketing_submissions FOR EACH ROW EXECUTE FUNCTION marketing_record_validation();
CREATE TRIGGER marketing_validation_submission_link AFTER INSERT ON public.marketing_submissions FOR EACH ROW EXECUTE FUNCTION marketing_link_validation_submission();
CREATE TRIGGER members_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER ms_connections_set_updated_at BEFORE UPDATE ON public.ms_connections FOR EACH ROW EXECUTE FUNCTION rfp_set_updated_at();
CREATE TRIGGER rfp_projects_set_updated_at BEFORE UPDATE ON public.rfp_projects FOR EACH ROW EXECUTE FUNCTION rfp_set_updated_at();
CREATE TRIGGER rfp_requirement_mappings_set_updated_at BEFORE UPDATE ON public.rfp_requirement_mappings FOR EACH ROW EXECUTE FUNCTION rfp_set_updated_at();
CREATE TRIGGER rfp_requirements_set_updated_at BEFORE UPDATE ON public.rfp_requirements FOR EACH ROW EXECUTE FUNCTION rfp_set_updated_at();
CREATE TRIGGER rfp_solution_features_set_updated_at BEFORE UPDATE ON public.rfp_solution_features FOR EACH ROW EXECUTE FUNCTION rfp_set_updated_at();
CREATE TRIGGER rfp_solution_sources_set_updated_at BEFORE UPDATE ON public.rfp_solution_sources FOR EACH ROW EXECUTE FUNCTION rfp_set_updated_at();
CREATE TRIGGER rfp_solutions_set_updated_at BEFORE UPDATE ON public.rfp_solutions FOR EACH ROW EXECUTE FUNCTION rfp_set_updated_at();
CREATE TRIGGER settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER survey_answers_updated_at BEFORE UPDATE ON public.survey_answers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER survey_questions_updated_at BEFORE UPDATE ON public.survey_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER survey_responses_updated_at BEFORE UPDATE ON public.survey_responses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER surveys_updated_at BEFORE UPDATE ON public.surveys FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER protect_user_profile_role_trg BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION protect_user_profile_role();

-- 저장소 버킷
-- bucket chat (public=False)
-- bucket claude-invoices (public=False)
-- bucket desktop-releases (public=False)
-- bucket mobile (public=False)
-- bucket nlm-files (public=False)
-- bucket ppt (public=False)
-- bucket rfp (public=False)

-- pg_cron 작업
-- cron audit-log-retention-100d: 10 19 * * *
-- cron marketing-master-validation: * * * * *
-- cron yonhap-notice-email-every-minute: * * * * *
-- cron yonhap-notices-daily-0700-kst: 0 22 * * *
