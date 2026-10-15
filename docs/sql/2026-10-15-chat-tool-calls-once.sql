-- 이미 2026-10-15-chat-portal.sql을 적용한 DB용(멱등). 승인 요청 중복 실행 방지를 위한 'running' 선점 상태 + 유일 인덱스.
-- 전제: 기존 check 제약 이름은 Postgres 기본 규칙(chat_tool_calls_status_check)이다.
begin;
alter table public.chat_tool_calls drop constraint if exists chat_tool_calls_status_check;
alter table public.chat_tool_calls add constraint chat_tool_calls_status_check check (status in ('running','ok','error','timeout','cancelled'));
create unique index if not exists chat_tool_calls_once on public.chat_tool_calls(message_id, tool_use_id);
commit;
