-- 2026-09-30 PPT 만들기 (스펙 docs/superpowers/specs/2026-09-30-ppt-maker-design.md §5)
-- 덱(공유 단위) + 버전(생성·재생성 1회 = 1행, 삭제하지 않음) + Storage 버킷 ppt.
-- 쓰기는 service_role(서버)만. 읽기는 소유자와 admin.

create table if not exists public.ppt_decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  owner_email text not null,
  title text not null default '',
  share_token text not null unique,
  share_enabled boolean not null default false,
  current_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ppt_decks is 'PPT 만들기 덱. share_token = capability URL(로그인 필요), 토큰은 로그에 남기지 않는다';

create table if not exists public.ppt_deck_versions (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.ppt_decks(id) on delete cascade,
  no integer not null,
  status text not null default 'generating' check (status in ('generating','building','done','failed')),
  source_kind text not null check (source_kind in ('text','file','pptx')),
  source_text text,
  source_path text,
  source_name text,
  prompt text,
  feedback text,
  base_version integer,
  deck_json jsonb,
  pptx_path text,
  yaml_path text,
  slide_count integer,
  advisories jsonb not null default '[]'::jsonb,
  check_issues jsonb not null default '{}'::jsonb,
  llm_model text,
  llm_calls integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  tokens_cache_read integer not null default 0,
  tokens_cache_write integer not null default 0,
  duration_ms integer,
  error text,
  sharepoint_url text,
  sharepoint_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (deck_id, no)
);
comment on table public.ppt_deck_versions is 'PPT 만들기 버전. 생성·재생성마다 1행, 토큰 사용량 포함, 삭제하지 않음';

create index if not exists ppt_decks_owner_idx on public.ppt_decks (owner_id, updated_at desc);
create index if not exists ppt_deck_versions_active_idx on public.ppt_deck_versions (status, created_at) where status in ('generating','building');

do $$
declare t text;
begin
  foreach t in array array['ppt_decks','ppt_deck_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format('create policy %I_admin_read on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))', t, t);
  end loop;
  drop policy if exists ppt_decks_owner_read on public.ppt_decks;
  create policy ppt_decks_owner_read on public.ppt_decks for select to authenticated using (owner_id = auth.uid());
  drop policy if exists ppt_deck_versions_owner_read on public.ppt_deck_versions;
  create policy ppt_deck_versions_owner_read on public.ppt_deck_versions for select to authenticated
    using (exists (select 1 from public.ppt_decks d where d.id = deck_id and d.owner_id = auth.uid()));
end $$;

-- Storage 버킷(private, 50MB). 브라우저는 서버가 발급한 서명 업로드 URL로만 올리고, 읽기는 서버가 300초 서명 URL을 만든다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ppt', 'ppt', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;
