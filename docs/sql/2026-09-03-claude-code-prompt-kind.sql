-- Claude Code 프롬프트 사람/자동화 구분 (2026-09-03) — Supabase SQL Editor에서 실행(멱등)
-- 배경: claude-mem 같은 플러그인이 도구 호출마다 별도 Claude 세션(관찰자)에 프롬프트를 보내 user_prompt 이벤트가
--       사람이 친 명령 수십 배로 잡힌다. 수집 단계에서 내용 패턴으로 분류(lib/claude-usage/prompt-kind.ts)해
--       claude_code_daily.prompts_auto 에 따로 더하고, 프롬프트 내용 행에는 kind 를 남긴다.
--       프롬프트(사람) = prompts - prompts_auto. 내용 수집(OTEL_LOG_USER_PROMPTS=1)이 없는 사용자는 분류할 수 없어 전부 사람으로 잡힌다(상한).

alter table public.claude_code_daily add column if not exists prompts_auto numeric not null default 0;
alter table public.claude_code_prompts add column if not exists kind text not null default 'human';
create index if not exists claude_code_prompts_kind_idx on public.claude_code_prompts (kind, ts desc);

-- RPC: prompts_auto 합산 추가 (2026-08-26 원본과 동일 + prompts_auto)
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
$$;

-- 소급 분류: 이미 저장된 프롬프트 내용에 같은 패턴 적용(lib/claude-usage/prompt-kind.ts 와 동일하게 유지)
update public.claude_code_prompts set kind = 'automation'
where kind <> 'automation' and (
  prompt like '<observed_from_primary_session>%'
  or prompt like 'You are a Claude-Mem%'
  or prompt like 'Hello memory agent%'
  or prompt like '--- MODE SWITCH%'
  or lower(btrim(prompt)) = 'reply with: ok'
);

-- 소급 집계: 내용이 수집된 기간(08-31~)에 대해 일·조직·사용자별 자동화 건수를 prompts_auto 에 반영(덮어쓰기)
update public.claude_code_daily d
set prompts_auto = s.n
from (
  select (ts at time zone 'Asia/Seoul')::date as day, org_id, user_email, count(*)::numeric as n
  from public.claude_code_prompts where kind = 'automation'
  group by 1, 2, 3
) s
where d.day = s.day and d.org_id = s.org_id and d.user_email = s.user_email;
