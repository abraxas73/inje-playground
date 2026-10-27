-- 2026-10-27: Teams 조직 사용자 정의 반응(넵·대박 등) 등록부 — 반응 고르기 창이 어느 대화방에서나 쓰도록.
-- 조직 목록을 주는 Graph API가 없어, 메시지 목록(GET /api/teams/chat/messages)에서 처음 본 반응을 서버가 그림과 함께 저장한다.
-- 그림은 원래 메시지 hostedContents라 그 방에 없는 사람은 못 받으므로 바이트를 여기 둔다(base64, 1MB 이하).
-- 읽기·쓰기는 서버(service role)만 — GET /api/teams/chat/custom-reactions.
create table if not exists public.teams_custom_reactions (
  name         text primary key,              -- displayName(예: daebak)
  reaction_id  text not null,                 -- beta reactionId(예: daebak;0-skr-d3-…) — setReaction에 그대로
  content_type text not null,                 -- image/png·gif 등
  image        text not null,                 -- base64
  created_at   timestamptz not null default now()
);
alter table public.teams_custom_reactions enable row level security; -- 정책 없음: service role만
