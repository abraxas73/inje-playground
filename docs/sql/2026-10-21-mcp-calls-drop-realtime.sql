-- 2026-10-21: mcp_calls를 Realtime 발행에서 뺀다.
-- postgres_changes 구독이 하나라도 있으면 Realtime이 realtime.list_changes()로 WAL 전체를 0.1초마다 디코딩한다
-- (pg_stat_statements 1위 — 125만 회·누적 2.2시간, 최대 5.5초). 데스크톱 앱 워커는 원래 폴링도 하므로(다음 릴리스부터 2초) 구독 없이 동작한다.
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'mcp_calls') then
    alter publication supabase_realtime drop table public.mcp_calls;
  end if;
end $$;
