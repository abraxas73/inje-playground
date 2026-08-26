-- 마이그레이션 2 (2026-08-26): api_request 이벤트 재수신 시 중복 방지용 부분 유니크 인덱스
create unique index if not exists claude_code_requests_request_id_uidx
  on public.claude_code_requests (request_id) where request_id is not null;
