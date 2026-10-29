-- 2026-10-29: 홈 대시보드 템플릿 — 위젯 편집 툴바의 "템플릿"에서 고르고(내 배치로 교체), 내 배치를 이름 붙여 공유.
-- 읽기·쓰기는 서버(service role)만 — /api/users/home-dashboard/templates. 기본 템플릿(is_default)은 하나, 맨 위에 보인다.
create table if not exists public.home_dashboard_templates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users(id) on delete set null,
  owner_email text not null,
  name        text not null check (char_length(name) between 1 and 40),
  tiles       jsonb not null,                  -- [{id,x,y,w,h}] (user_settings home_dashboard와 같은 모양)
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists home_dashboard_templates_one_default on public.home_dashboard_templates (is_default) where is_default;
create index if not exists home_dashboard_templates_owner_idx on public.home_dashboard_templates (owner_id);
alter table public.home_dashboard_templates enable row level security; -- 정책 없음: service role만

-- 기본 템플릿: 강승억(seunguk.kang@innogrid.com)의 현재 배치
insert into public.home_dashboard_templates (owner_id, owner_email, name, tiles, is_default)
select s.user_id, u.email, '기본 템플릿', s.value::jsonb, true
from public.user_settings s join auth.users u on u.id = s.user_id
where u.email = 'seunguk.kang@innogrid.com' and s.key = 'home_dashboard'
  and not exists (select 1 from public.home_dashboard_templates where is_default);
