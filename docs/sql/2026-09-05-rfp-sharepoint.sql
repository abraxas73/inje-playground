-- RFP 분석 3단계 — SharePoint 등록. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md

-- 사용자별 Microsoft 계정 연결(refresh 토큰은 AES-256-GCM 암호문 v1.iv.tag.cipher). 사용자당 1행.
create table if not exists public.ms_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_upn text,
  account_name text,
  refresh_token_enc text not null,
  scopes text not null,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
drop trigger if exists ms_connections_set_updated_at on public.ms_connections;
create trigger ms_connections_set_updated_at before update on public.ms_connections
  for each row execute function public.rfp_set_updated_at();

-- 프로젝트별 업로드 대상 폴더 {url, driveId, itemId, name, webUrl, setBy, setAt}
alter table public.rfp_projects add column if not exists sharepoint_folder jsonb;

-- 업로드 이력(매 업로드 1행; 같은 날 덮어쓰기여도 남는다)
create table if not exists public.rfp_sharepoint_uploads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  drive_id text not null,
  item_id text not null,
  file_name text not null,
  web_url text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rfp_sharepoint_uploads_project_idx on public.rfp_sharepoint_uploads (project_id, created_at desc);

-- RLS: ms_connections는 토큰 컬럼 보호를 위해 정책 없이 켠다(service role만 접근).
alter table public.ms_connections enable row level security;
drop policy if exists ms_connections_admin_read on public.ms_connections;

-- rfp_sharepoint_uploads는 1·2단계와 같이 관리자 세션 읽기만 진단용으로 허용.
alter table public.rfp_sharepoint_uploads enable row level security;
drop policy if exists rfp_sharepoint_uploads_admin_read on public.rfp_sharepoint_uploads;
create policy rfp_sharepoint_uploads_admin_read on public.rfp_sharepoint_uploads for select to authenticated
  using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'));
