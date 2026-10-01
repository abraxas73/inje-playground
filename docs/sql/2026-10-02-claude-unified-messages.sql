-- claude.ai 멤버 CSV에 2026-10 추가된 "Messages in Chat and Cowork unified (beta)" 칼럼 보관
alter table public.claude_member_activity add column if not exists unified_messages int not null default 0;
comment on column public.claude_member_activity.unified_messages is 'CSV "Messages in Chat and Cowork unified (beta)" — 채팅+Cowork 통합 메시지 수(베타). 칼럼이 없던 과거 CSV는 0';
