-- 2026-10-21: claude_code_hourly_emails 슬로우 쿼리(평균 0.9초·최대 8초) — 대상 행은 인덱스로 찾지만
-- cost_usd를 읽으려 1.4GB 테이블 블록을 디스크에서 읽었다. 필요한 열을 모두 담은 인덱스로 index-only scan.
-- user_email을 include에 넣어야 lower(user_email) 식 인덱스에서도 index-only scan이 된다(PG 계획기 제약).
-- 각 문장을 따로 실행한다(concurrently는 트랜잭션 안에서 못 돈다).
create index concurrently if not exists claude_code_requests_lower_email_ts_cov_idx
  on public.claude_code_requests (lower(user_email), ts) include (cost_usd, user_email);
-- 앞 두 열이 같은 옛 인덱스는 새 인덱스가 대신한다.
drop index concurrently if exists public.claude_code_requests_lower_email_ts_idx;
-- index-only scan은 visibility map이 채워져 있어야 테이블을 건너뛴다.
vacuum (analyze) public.claude_code_requests;
