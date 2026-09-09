-- 2026-09-09 RFP 분석 결과 공유 링크(로그인 없이 열람 가능한 URL)
-- 사용자 지시: 소유자(최초 생성자)가 공유 링크를 만들 수 있고, 만들 때 public/private를 고른다.
--   public  = 링크만 있으면 로그인 없이 열람(사외 공유용)
--   private = 링크가 있어도 사내 계정 로그인이 필요(사내 공유용)
--
-- token은 URL 자체가 열람 권한(capability URL)이다. 그래서
--   - 이 테이블은 RLS를 켜고 정책을 두지 않는다 → service role(서버)만 읽는다. 클라이언트 키로는 접근 불가.
--   - 토큰은 어떤 로그·감사 기록에도 남기지 않는다(감사에는 링크 id와 공개 범위만).
--   - 유출에 대비해 소유자가 언제든 폐기(삭제)할 수 있다.
create table if not exists public.rfp_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  token text not null unique,
  visibility text not null check (visibility in ('public', 'private')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- 열람 흔적(소유자 화면에 "N회 열람"으로 보여 준다). 열람자 신원은 남기지 않는다.
  view_count integer not null default 0,
  last_viewed_at timestamptz
);

comment on table public.rfp_share_links is 'RFP 분석 공유 링크. token = capability URL, service role만 조회';
comment on column public.rfp_share_links.visibility is 'public = 로그인 없이 열람, private = 사내 로그인 필요';

create index if not exists rfp_share_links_project_idx on public.rfp_share_links (project_id, created_at desc);

alter table public.rfp_share_links enable row level security;
-- 정책 없음 = service role 전용(ms_connections와 같은 방식)

-- 열람 카운트는 익명 요청에서도 올라가야 하므로 service role이 쓰는 함수로 둔다(원자적 증가).
create or replace function public.rfp_share_link_viewed(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rfp_share_links
     set view_count = view_count + 1, last_viewed_at = now()
   where token = p_token;
$$;

revoke all on function public.rfp_share_link_viewed(text) from anon, authenticated;
grant execute on function public.rfp_share_link_viewed(text) to service_role;
