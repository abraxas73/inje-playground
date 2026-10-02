-- Admin API usage_report(api_key_id·model별 토큰) + api_keys 목록 — API 비용을 키별로 나눠 보기 위함.
-- cost_report는 group_by가 workspace_id·description뿐이라 키별 금액이 없다 → (일, 모델) 실제 비용을 키의 토큰 추정 비용 비중으로 배분한다.
create table if not exists public.claude_api_usage_daily (
  day date not null,
  api_key_id text not null default '',          -- '' = 키 없음(Console Workbench 등)
  model text not null default '',
  uncached_input bigint not null default 0,
  cache_write_5m bigint not null default 0,
  cache_write_1h bigint not null default 0,
  cache_read bigint not null default 0,
  output bigint not null default 0,
  web_search int not null default 0,
  synced_at timestamptz not null default now(),
  primary key (day, api_key_id, model)
);
alter table public.claude_api_usage_daily enable row level security;

create table if not exists public.claude_api_keys (
  id text primary key,
  name text not null,
  status text not null,
  workspace_id text null,
  hint text null,                                -- partial_key_hint(sk-ant-…끝 4자), 전체 키는 API가 주지 않는다
  created_at timestamptz null,
  synced_at timestamptz not null default now()
);
alter table public.claude_api_keys enable row level security;
