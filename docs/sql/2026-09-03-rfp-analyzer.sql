-- RFP 분석 1단계 — 프로젝트·원본 파일·요구사항 표. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md

create table if not exists public.rfp_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agency text,
  period text,
  budget text,
  bid_method text,
  extra jsonb not null default '{}'::jsonb,
  name_norm text not null,
  agency_norm text,
  status text not null check (status in ('extracting','ready','failed')),
  extraction_method text check (extraction_method in ('standard','llm')),
  error text,
  warnings jsonb not null default '[]'::jsonb,
  requirement_count int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rfp_projects_name_agency_uq
  on public.rfp_projects (name_norm, agency_norm) where agency_norm is not null;
create index if not exists rfp_projects_created_idx on public.rfp_projects (created_at desc);

create table if not exists public.rfp_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  format text not null check (format in ('hwp','hwpx','docx')),
  size_bytes bigint not null,
  sha256 text not null unique,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rfp_files_project_idx on public.rfp_files (project_id, created_at desc);

create table if not exists public.rfp_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  category_code text not null,
  category_name text not null,
  req_id text not null,
  title text not null default '',
  definition text not null default '',
  details text not null default '',
  deliverables text not null default '',
  related text not null default '',
  solution text not null default '',
  sort_order int not null,
  source jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, req_id)
);
create index if not exists rfp_requirements_project_idx on public.rfp_requirements (project_id, sort_order);

-- updated_at 자동 갱신
create or replace function public.rfp_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists rfp_projects_set_updated_at on public.rfp_projects;
create trigger rfp_projects_set_updated_at before update on public.rfp_projects
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_requirements_set_updated_at on public.rfp_requirements;
create trigger rfp_requirements_set_updated_at before update on public.rfp_requirements
  for each row execute function public.rfp_set_updated_at();

-- RLS: 서버(service_role)만 읽고 쓴다. 접근 제어는 API 라우트(requireUser)가 한다. 관리자 세션 읽기만 진단용으로 허용.
do $$
declare t text;
begin
  foreach t in array array['rfp_projects','rfp_files','rfp_requirements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format('create policy %I_admin_read on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))', t, t);
  end loop;
end $$;

-- Storage 버킷(private, 50MB). 브라우저는 서버가 발급한 서명 업로드 URL로만 올리고, 읽기는 서버가 서명 URL을 만든다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('rfp', 'rfp', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- 2026-09-04: 사용자 삭제(/api/users/[id])가 FK에 막히지 않도록 on delete set null (재실행 안전)
alter table public.rfp_projects alter column created_by drop not null;
alter table public.rfp_files alter column uploaded_by drop not null;
alter table public.rfp_projects drop constraint if exists rfp_projects_created_by_fkey;
alter table public.rfp_projects add constraint rfp_projects_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.rfp_projects drop constraint if exists rfp_projects_updated_by_fkey;
alter table public.rfp_projects add constraint rfp_projects_updated_by_fkey foreign key (updated_by) references auth.users(id) on delete set null;
alter table public.rfp_files drop constraint if exists rfp_files_uploaded_by_fkey;
alter table public.rfp_files add constraint rfp_files_uploaded_by_fkey foreign key (uploaded_by) references auth.users(id) on delete set null;
alter table public.rfp_requirements drop constraint if exists rfp_requirements_updated_by_fkey;
alter table public.rfp_requirements add constraint rfp_requirements_updated_by_fkey foreign key (updated_by) references auth.users(id) on delete set null;
