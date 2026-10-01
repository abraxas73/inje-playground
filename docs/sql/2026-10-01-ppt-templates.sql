-- 2026-10-01 PPT 만들기 — 업로드 템플릿(디자인센터 배포본) + 버전 행에 사용 템플릿 기록
-- 템플릿은 내장본과 같은 106장 구성이어야 하며(패키지 tokens.py가 장표 번호·좌표를 고정), 등록 시 ppt-service가 샘플 덱 전체를 빌드해 검증한다.
-- 쓰기는 service_role(서버)만. 읽기는 admin. 파일은 버킷 ppt의 templates/<id>.pptx.

create table if not exists public.ppt_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_name text not null,
  storage_path text not null unique,
  bytes bigint not null default 0,
  slides integer,
  check_issues jsonb not null default '{}'::jsonb,
  advisories jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','disabled')),
  is_default boolean not null default false,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_by_email text not null default '',
  note text,
  created_at timestamptz not null default now()
);
comment on table public.ppt_templates is 'PPT 만들기 업로드 템플릿. 내장 템플릿은 행이 없다(버전의 template_id null). 비활성화만 하고 삭제하지 않는다(버전이 참조)';
create unique index if not exists ppt_templates_one_default_idx on public.ppt_templates (is_default) where is_default;

alter table public.ppt_deck_versions
  add column if not exists template_id uuid references public.ppt_templates(id) on delete set null,
  add column if not exists template_name text;
comment on column public.ppt_deck_versions.template_name is '생성에 쓴 템플릿 표시 이름(내장이면 서비스 카탈로그의 파일명). template_id null = 내장';

alter table public.ppt_templates enable row level security;
drop policy if exists ppt_templates_admin_read on public.ppt_templates;
create policy ppt_templates_admin_read on public.ppt_templates for select to authenticated
  using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'));
