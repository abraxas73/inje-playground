-- Claude for M365(Office 추가 기능) 사용량 — 원시 스팬(claude_office_trace_log)을 턴 단위로 묶어 일·사용자·표면별로 집계하는 RPC
-- 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
--
-- 스팬 구조: agent.query(턴 루트: user.email·surface·session.id) ← agent.stream(모델 호출·토큰) ← agent.tool_execution(도구).
-- 자식 스팬에는 사용자·표면이 없으므로 trace_id로 루트에 귀속시킨다. 루트가 아직 오지 않은 트레이스(배치 분할·유실)는 집계에서 빠진다.
-- file.upload는 별도 루트 스팬이라 session.id로 같은 세션의 표면에 귀속시킨다.
-- day = 루트 스팬 시작 시각(없으면 수신 시각)의 KST 날짜.

create index if not exists claude_office_trace_log_trace_idx on public.claude_office_trace_log (trace_id);
create index if not exists claude_office_trace_log_name_start_idx on public.claude_office_trace_log (span_name, span_start);

drop function if exists public.claude_office_usage(date, date, text[], text);

create function public.claude_office_usage(p_from date, p_to date, p_emails text[] default null, p_org text default null)
returns table (
  day date,
  org_id text,
  user_email text,
  surface text,
  turns bigint,
  sessions bigint,
  model_calls bigint,
  input_tokens numeric,
  output_tokens numeric,
  cache_read_tokens numeric,
  cache_creation_tokens numeric,
  tool_calls bigint,
  tool_errors bigint,
  file_uploads bigint
)
language sql
security definer
set search_path = public
as $$
  with q as (
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
  order by a.day, a.user_email, a.surface
$$;
revoke execute on function public.claude_office_usage(date, date, text[], text) from public, anon, authenticated;
grant execute on function public.claude_office_usage(date, date, text[], text) to service_role;
