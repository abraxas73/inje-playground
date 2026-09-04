-- Claude for M365(Office 추가 기능) 커스텀 OTel 수집기 스파이크 — 스팬 집계 속성 로그
-- 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 내용 속성(프롬프트·도구 입출력·문서 URL)은 서버가 읽지 않으므로 이 표에는 없다. attr_keys는 어떤 속성이 왔는지 키 이름만.

create table if not exists public.claude_office_trace_log (
  id                    bigserial primary key,
  received_at           timestamptz not null default now(),
  span_name             text not null,
  trace_id              text,
  span_start            timestamptz,
  surface               text,              -- sheet | doc | slide | mail
  user_email            text,
  org_id                text,
  session_id            text,
  model                 text,
  input_tokens          numeric not null default 0,
  output_tokens         numeric not null default 0,
  cache_read_tokens     numeric not null default 0,
  cache_creation_tokens numeric not null default 0,
  tool_name             text,
  tool_success          boolean,
  office_platform       text,
  attr_keys             text[] not null default '{}',
  bytes                 integer
);
create index if not exists claude_office_trace_log_received_idx on public.claude_office_trace_log (received_at desc);
create index if not exists claude_office_trace_log_user_idx on public.claude_office_trace_log (user_email, span_start);

alter table public.claude_office_trace_log enable row level security;
-- 정책 없음: service_role(서버)만 읽고 쓴다.
