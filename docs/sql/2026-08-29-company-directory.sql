-- 사내 조직도 명부 (그룹웨어 아마란스 → inno-creed MCP `find_person` 전사 명부)
-- Claude 조직(claude_orgs)과는 별개의 "회사 소속(부문/본부/센터/팀)" 정보.
-- 실행: Supabase SQL Editor. 재실행 안전(if not exists / drop policy if exists).

create table if not exists public.company_directory (
  email         text primary key,                 -- 소문자 정규화
  emp_seq       text,                              -- 아마란스 empSeq
  login_id      text,
  name          text not null,
  dept_id       text,
  dept_name     text,                              -- 말단 부서명(팀/센터/본부/부문)
  dept_path     text,                              -- 원본 "(주)이노그리드>(주)이노그리드>부문>본부>센터>팀"
  units         text[] not null default '{}',     -- 회사 세그먼트를 뗀 경로 [부문, 본부, 센터, 팀]
  division      text,                              -- units[1]  예) 기술·운영부문 / 사업·전략부문 / 경영지원부문 / 대표이사
  headquarters  text,                              -- units[2]  예) R&D본부
  team          text,                              -- 말단 = dept_name  예) XPU플랫폼팀 / 클라우드 네이티브 센터
  duty          text,                              -- 직책 예) 팀장/센터장/팀원
  position      text,                              -- 직급 예) 선임연구원/이사
  active        boolean not null default true,     -- 최근 동기화 명부에 없으면 false(퇴사·이동)
  synced_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists company_directory_team_idx on public.company_directory (team);
create index if not exists company_directory_unit_idx on public.company_directory (division, headquarters);

create table if not exists public.company_directory_sync (
  id           bigint generated always as identity primary key,
  synced_at    timestamptz not null default now(),
  source       text not null default 'amaranth',   -- 'amaranth' (inno-creed find_person)
  query        text,                                -- 사용한 검색어(예 'innogrid')
  total        int not null default 0,              -- 수신 명부 인원
  upserted     int not null default 0,
  deactivated  int not null default 0,              -- 이번 동기화에 없어 비활성 처리된 인원
  synced_by    text,                                -- 관리자 user_id 또는 'token'
  note         text
);
create index if not exists company_directory_sync_at_idx on public.company_directory_sync (synced_at desc);

-- RLS: 읽기는 admin만, 쓰기 정책 없음(service role만 쓴다)
do $$
declare t text;
begin
  foreach t in array array['company_directory', 'company_directory_sync']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))',
      t || '_admin_read', t
    );
  end loop;
end $$;
