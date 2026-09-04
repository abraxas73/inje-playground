-- RFP 분석 2단계 — 솔루션 기능 카탈로그 + 요구사항 매핑. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md

create table if not exists public.rfp_solutions (
  code text primary key,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.rfp_solutions (code, name, sort_order) values
  ('secloudit', 'SECloudit', 1),
  ('devopsit', 'Devopsit', 2),
  ('aicubeit', 'AICubeit', 3),
  ('tabcloudit', 'TabCloudit', 4),
  ('openstackit', 'Openstackit', 5)
on conflict (code) do nothing;

create table if not exists public.rfp_solution_sources (
  id uuid primary key default gen_random_uuid(),
  solution_code text not null references public.rfp_solutions(code) on delete cascade,
  url text not null,
  page_id text not null,
  title text,
  page_version int,
  import_status text not null default 'idle' check (import_status in ('idle','running','ready','failed')),
  imported_at timestamptz,
  feature_count int not null default 0,
  error text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (solution_code, page_id)
);

create table if not exists public.rfp_solution_features (
  id uuid primary key default gen_random_uuid(),
  solution_code text not null references public.rfp_solutions(code) on delete cascade,
  name text not null,
  name_norm text not null,
  description text not null default '',
  evidence_url text,
  source_id uuid references public.rfp_solution_sources(id) on delete set null,
  is_active boolean not null default true,
  edited boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (solution_code, name_norm)
);
create index if not exists rfp_solution_features_solution_idx on public.rfp_solution_features (solution_code, sort_order);

create table if not exists public.rfp_requirement_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  requirement_id uuid not null references public.rfp_requirements(id) on delete cascade,
  solution_code text references public.rfp_solutions(code) on delete set null,
  feature_id uuid references public.rfp_solution_features(id) on delete set null,
  verdict text not null check (verdict in ('fulfilled','partial','build','na')),
  rationale text not null default '',
  evidence_url text,
  edited boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rfp_requirement_mappings_req_idx on public.rfp_requirement_mappings (project_id, requirement_id, sort_order);
create index if not exists rfp_requirement_mappings_feature_idx on public.rfp_requirement_mappings (feature_id);

alter table public.rfp_projects
  add column if not exists mapping_status text not null default 'none',
  add column if not exists mapping_error text,
  add column if not exists mapping_warnings jsonb not null default '[]'::jsonb,
  add column if not exists mapping_at timestamptz;
alter table public.rfp_projects drop constraint if exists rfp_projects_mapping_status_check;
alter table public.rfp_projects add constraint rfp_projects_mapping_status_check check (mapping_status in ('none','running','ready','failed'));

-- updated_at 자동 갱신(1단계 함수 재사용)
drop trigger if exists rfp_solutions_set_updated_at on public.rfp_solutions;
create trigger rfp_solutions_set_updated_at before update on public.rfp_solutions
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_solution_sources_set_updated_at on public.rfp_solution_sources;
create trigger rfp_solution_sources_set_updated_at before update on public.rfp_solution_sources
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_solution_features_set_updated_at on public.rfp_solution_features;
create trigger rfp_solution_features_set_updated_at before update on public.rfp_solution_features
  for each row execute function public.rfp_set_updated_at();
drop trigger if exists rfp_requirement_mappings_set_updated_at on public.rfp_requirement_mappings;
create trigger rfp_requirement_mappings_set_updated_at before update on public.rfp_requirement_mappings
  for each row execute function public.rfp_set_updated_at();

-- RLS: 서버(service_role)만 읽고 쓴다. 관리자 세션 읽기만 진단용으로 허용(1단계와 동일).
do $$
declare t text;
begin
  foreach t in array array['rfp_solutions','rfp_solution_sources','rfp_solution_features','rfp_requirement_mappings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format('create policy %I_admin_read on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))', t, t);
  end loop;
end $$;
