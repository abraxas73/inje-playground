# 매체·부서 관리 및 부고 매칭 알림 메일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미디어 리스트(매체·부서)를 DB로 관리하고, 새 연합뉴스 부고가 관리 매체+부서와 일치하면 알림을 켠 사용자에게 사내 SMTP 릴레이(465)로 묶음 메일을 보낸다.

**Architecture:** 기존 Edge Function `yonhap-notices`가 부고를 저장한 직후 새 부고 ID만 SQL 함수 `media_match_notices`로 매칭하고, 새 매칭이 있으면 `smtp.ts`(implicit TLS + AUTH LOGIN)로 구독자 전원에게 1통을 보낸다. 매체·부서·매칭·구독·발송 이력은 Supabase 테이블이며 쓰기는 admin RPC 또는 service role만 한다. 프런트는 `/media-directory`(조회 전체, 편집 admin)와 `/people-news`의 알림 카드·일치 배지를 추가한다.

**Tech Stack:** Supabase Postgres(PL/pgSQL, RLS), Supabase Edge Functions(Deno 2, `Deno.connectTls`), Next.js 16 App Router, React 19, shadcn/ui, exceljs, Vitest + Testing Library, `deno test`.

**Spec:** `docs/superpowers/specs/2026-09-15-media-obituary-alerts-design.md`

## Global Constraints

- 매칭은 **매체 + 등록 부서가 함께 포함될 때만**. `any_department=true`(원본 부서 빈칸) 매체는 매체만으로 일치.
- 발송 단위: 수집 run당 새 매칭을 모아 수신자별 1통. 자동 재발송 없음. 같은 부고는 한 번만.
- 발송 경로: `MEDIA_SMTP_HOST=wblock.innogrid.com`, `MEDIA_SMTP_PORT=465`, `MEDIA_SMTP_USER`, `MEDIA_SMTP_PASS`(Edge Function secrets, 이미 등록됨). From = `MEDIA_SMTP_USER`. 자격증명·수신자·기사 본문은 로그·오류·응답에 쓰지 않는다.
- 권한: 조회는 `has_page_access('people_news')`, 편집·엑셀 적재·발송 이력은 `user_profiles.role='admin'`. 새 페이지 키를 만들지 않고 `/media-directory`·`/api/media-directory`를 `people_news`에 매핑한다.
- 매체명·별칭·부서명 2~100자, 별칭 최대 20개, 엑셀 2MB·2,000행.
- 기존 유틸 재사용: `requireNewsUser`(`lib/people-news/auth.ts`), `requireAdmin`(`lib/claude-usage/require-admin.ts`), `checkXlsxArchive`(`lib/marketing/excel.ts`), `createServerSupabase`, `createAdminClient`.
- SQL 파일은 `begin; … commit;`로 감싸고 `revoke … from public, anon` → `grant execute … to authenticated|service_role` 순서를 지킨다. 검증 SQL은 `begin; do $$ … $$; rollback;`.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`와 `Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW`를 붙인다.
- 작업 디렉터리: `/Users/seunguk.kang/orca/workspaces/inje-playground/마케팅-고객-마스터-디비-관리`(브랜치 `abraxas73/마케팅-고객-마스터-디비-관리`, origin/main 7ed2680 + 스펙 커밋 4eb21b6). 프런트 명령은 `frontend/`에서, Deno 명령은 `supabase/functions/yonhap-notices/`에서 실행.

## File Structure

| 파일 | 역할 |
|---|---|
| `docs/sql/2026-09-15-media-directory.sql` | 테이블 5개, `media_norm`, RPC 6개, RLS |
| `scripts/check-media-directory.sql` | 운영 DB에서 롤백 트랜잭션으로 규칙·권한 검증 |
| `supabase/functions/yonhap-notices/smtp.ts` (있음) · `smtp_test.ts` | SMTP 클라이언트 + 가짜 서버 테스트 |
| `supabase/functions/yonhap-notices/alerts.ts` · `alerts_test.ts` | 매칭 호출·다이제스트·발송·이력 |
| `supabase/functions/yonhap-notices/handler.ts` · `index.ts` · `deno.json` · `handler_test.ts` | 새 부고 ID 계산, 알림 호출, 응답 `alerts` |
| `frontend/src/types/media-directory.ts` · `types/people-news.ts` | 타입 |
| `frontend/src/lib/media-directory/normalize.ts` · `excel.ts` · `preview.ts` · `server.ts` | 정규화(SQL 미러), xlsx 파싱, 미리보기 집계, 목록 로더 |
| `frontend/src/lib/page-access.ts` | 경로 → `people_news` 매핑 |
| `frontend/src/app/api/media-directory/{route,outlets/route,departments/route,import/preview/route,import/route,deliveries/route}.ts` | 목록·편집·적재·이력 API |
| `frontend/src/app/api/people-news/media-alerts/route.ts` · `api/people-news/route.ts` | 구독 API, 목록에 `matches` |
| `frontend/src/components/media-directory/{MediaDirectory,OutletEditor,ImportDialog,DeliveryHistory}.tsx` · `app/media-directory/page.tsx` | 관리 화면 |
| `frontend/src/components/people-news/MediaAlertCard.tsx` · `app/people-news/page.tsx` | 알림 카드, 헤더 링크, 일치 배지 |
| `frontend/src/lib/__tests__/media-directory-*.test.ts(x)` · `media-alert-card.test.tsx` · `people-news-matches.test.ts` · `page-access.test.ts` | Vitest |
| `docs/media-directory.md` · `CLAUDE.md` · `docs/yonhap-notices.md` | 런북·문서 |

---

### Task 1: DB 스키마·함수 SQL과 운영 검증 스크립트

**Files:**
- Create: `docs/sql/2026-09-15-media-directory.sql`
- Create: `scripts/check-media-directory.sql`

**Interfaces:**
- Produces: 테이블 `media_outlets(id,name,name_norm,aliases,aliases_norm,any_department,active,…)`, `media_departments(id,outlet_id,name,name_norm,active,…)`, `media_obituary_matches(id,source_id,outlet_id,department_id,matched_text,sync_run_id,created_at,notified_at)`, `media_alert_subscriptions(user_id,enabled,updated_at)`, `media_alert_deliveries(id,sync_run_id,recipient_user_id,recipient_email,match_count,status,error_message,created_at)`.
- RPC: `media_norm(text)→text`, `media_directory_import(p_rows jsonb)→jsonb {outletsAdded,outletsExisting,departmentsAdded,departmentsExisting,anyDepartmentSet,skipped}`, `media_outlet_save(p_id uuid,p_name text,p_aliases text[],p_any_department boolean,p_active boolean)→media_outlets`, `media_department_save(p_id uuid,p_outlet_id uuid,p_name text,p_active boolean)→media_departments`, `set_media_alert_subscription(p_enabled boolean)→media_alert_subscriptions`, `media_match_notices(p_source_ids text[],p_run_id bigint)→jsonb[]`(service_role), `media_alert_recipients()→table(user_id uuid,email text)`(service_role).

- [ ] **Step 1: 스키마 SQL 작성**

`docs/sql/2026-09-15-media-directory.sql`:

```sql
-- 매체·부서 관리 및 부고 매칭 알림. yonhap-notices·page-access SQL 이후 적용. 재적용 안전.
begin;

create or replace function public.media_norm(p text) returns text
language sql immutable strict set search_path = '' as $$
  select translate(regexp_replace(lower(p), '㈜|㈔|\(주\)|\(사\)|주식회사|사단법인|\s', '', 'g'), '·.,()[]/\''"“”‘’&:;!?-', '');
$$;

create table if not exists public.media_outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 100),
  name_norm text not null unique check (length(name_norm) >= 2),
  aliases text[] not null default '{}',
  aliases_norm text[] not null default '{}',
  any_department boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists media_outlets_aliases_norm_idx on public.media_outlets using gin (aliases_norm);

create table if not exists public.media_departments (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.media_outlets(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 100),
  name_norm text not null check (length(name_norm) >= 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (outlet_id, name_norm)
);

create table if not exists public.media_obituary_matches (
  id bigint generated always as identity primary key,
  source_id text not null references public.yonhap_notices(source_id) on delete cascade,
  outlet_id uuid not null references public.media_outlets(id) on delete cascade,
  department_id uuid references public.media_departments(id) on delete cascade,
  matched_text text not null,
  sync_run_id bigint references public.yonhap_notice_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists media_obituary_matches_unique on public.media_obituary_matches (source_id, outlet_id, department_id) nulls not distinct;
create index if not exists media_obituary_matches_source_idx on public.media_obituary_matches (source_id);
create index if not exists media_obituary_matches_run_idx on public.media_obituary_matches (sync_run_id);

create table if not exists public.media_alert_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.media_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  sync_run_id bigint not null references public.yonhap_notice_sync_runs(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  match_count integer not null check (match_count >= 0),
  status text not null check (status in ('sent', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (sync_run_id, recipient_user_id)
);
create index if not exists media_alert_deliveries_created_idx on public.media_alert_deliveries (created_at desc);

alter table public.media_outlets enable row level security;
alter table public.media_departments enable row level security;
alter table public.media_obituary_matches enable row level security;
alter table public.media_alert_subscriptions enable row level security;
alter table public.media_alert_deliveries enable row level security;
revoke all on public.media_outlets, public.media_departments, public.media_obituary_matches, public.media_alert_subscriptions, public.media_alert_deliveries from anon, authenticated;
grant select on public.media_outlets, public.media_departments, public.media_obituary_matches, public.media_alert_subscriptions, public.media_alert_deliveries to authenticated;
grant all on public.media_outlets, public.media_departments, public.media_obituary_matches, public.media_alert_subscriptions, public.media_alert_deliveries to service_role;
grant usage, select on sequence public.media_obituary_matches_id_seq to service_role;

drop policy if exists media_outlets_read on public.media_outlets;
create policy media_outlets_read on public.media_outlets for select to authenticated using ((select public.has_page_access('people_news')));
drop policy if exists media_departments_read on public.media_departments;
create policy media_departments_read on public.media_departments for select to authenticated using ((select public.has_page_access('people_news')));
drop policy if exists media_obituary_matches_read on public.media_obituary_matches;
create policy media_obituary_matches_read on public.media_obituary_matches for select to authenticated using ((select public.has_page_access('people_news')));
drop policy if exists media_alert_subscriptions_own on public.media_alert_subscriptions;
create policy media_alert_subscriptions_own on public.media_alert_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists media_alert_deliveries_read on public.media_alert_deliveries;
create policy media_alert_deliveries_read on public.media_alert_deliveries for select to authenticated
using (recipient_user_id = (select auth.uid()) or (select exists (select 1 from public.user_profiles where user_id = auth.uid() and role = 'admin')));

-- Admin bulk import from the media list spreadsheet. Idempotent: existing rows are kept and re-activated.
create or replace function public.media_directory_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  item jsonb; outlet_name text; dept_name text; outlet_norm text; dept_norm text; outlet_row public.media_outlets;
  outlets_added integer := 0; outlets_existing integer := 0; depts_added integer := 0; depts_existing integer := 0; any_set integer := 0; skipped integer := 0;
  seen_outlets text[] := '{}'; seen_pairs text[] := '{}';
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Invalid rows' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_rows) loop
    outlet_name := btrim(coalesce(item->>'outlet', '')); dept_name := btrim(coalesce(item->>'department', ''));
    outlet_norm := public.media_norm(outlet_name);
    if length(outlet_norm) < 2 or length(outlet_name) > 100 or length(dept_name) > 100 then skipped := skipped + 1; continue; end if;
    select * into outlet_row from public.media_outlets where name_norm = outlet_norm;
    if not found then
      insert into public.media_outlets (name, name_norm, updated_by) values (outlet_name, outlet_norm, caller) returning * into outlet_row;
      outlets_added := outlets_added + 1;
    elsif not (outlet_norm = any(seen_outlets)) then
      outlets_existing := outlets_existing + 1;
      if not outlet_row.active then update public.media_outlets set active = true, updated_at = now(), updated_by = caller where id = outlet_row.id; end if;
    end if;
    seen_outlets := array_append(seen_outlets, outlet_norm);
    if dept_name = '' then
      if not outlet_row.any_department then
        update public.media_outlets set any_department = true, updated_at = now(), updated_by = caller where id = outlet_row.id;
        any_set := any_set + 1;
      end if;
      continue;
    end if;
    dept_norm := public.media_norm(dept_name);
    if length(dept_norm) < 2 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from public.media_departments where outlet_id = outlet_row.id and name_norm = dept_norm) then
      if not ((outlet_norm || '|' || dept_norm) = any(seen_pairs)) then depts_existing := depts_existing + 1; end if;
      update public.media_departments set active = true, updated_at = now(), updated_by = caller where outlet_id = outlet_row.id and name_norm = dept_norm and not active;
    else
      insert into public.media_departments (outlet_id, name, name_norm, updated_by) values (outlet_row.id, dept_name, dept_norm, caller);
      depts_added := depts_added + 1;
    end if;
    seen_pairs := array_append(seen_pairs, outlet_norm || '|' || dept_norm);
  end loop;
  return jsonb_build_object('outletsAdded', outlets_added, 'outletsExisting', outlets_existing, 'departmentsAdded', depts_added,
    'departmentsExisting', depts_existing, 'anyDepartmentSet', any_set, 'skipped', skipped);
end;
$$;
revoke all on function public.media_directory_import(jsonb) from public, anon;
grant execute on function public.media_directory_import(jsonb) to authenticated;

create or replace function public.media_outlet_save(p_id uuid, p_name text, p_aliases text[], p_any_department boolean, p_active boolean) returns public.media_outlets
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); n text := btrim(coalesce(p_name, '')); nn text := public.media_norm(btrim(coalesce(p_name, '')));
  al text[] := '{}'; aln text[] := '{}'; a text; an text; result public.media_outlets;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if length(n) < 2 or length(n) > 100 or length(nn) < 2 then raise exception 'Invalid outlet name' using errcode = '22023'; end if;
  foreach a in array coalesce(p_aliases, '{}'::text[]) loop
    a := btrim(coalesce(a, '')); an := public.media_norm(a);
    if a = '' then continue; end if;
    if length(a) > 100 or length(an) < 2 then raise exception 'Invalid alias' using errcode = '22023'; end if;
    if an = nn or an = any(aln) then continue; end if;
    al := array_append(al, a); aln := array_append(aln, an);
  end loop;
  if cardinality(al) > 20 then raise exception 'Too many aliases' using errcode = '22023'; end if;
  if exists (select 1 from public.media_outlets o where o.id is distinct from p_id
             and (o.name_norm = nn or o.name_norm = any(aln) or nn = any(o.aliases_norm) or o.aliases_norm && aln)) then
    raise exception 'Outlet name or alias already used' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.media_outlets (name, name_norm, aliases, aliases_norm, any_department, active, updated_by)
      values (n, nn, al, aln, coalesce(p_any_department, false), coalesce(p_active, true), caller) returning * into result;
  else
    update public.media_outlets set name = n, name_norm = nn, aliases = al, aliases_norm = aln,
      any_department = coalesce(p_any_department, any_department), active = coalesce(p_active, active), updated_at = now(), updated_by = caller
      where id = p_id returning * into result;
    if not found then raise exception 'Outlet not found' using errcode = 'P0002'; end if;
  end if;
  return result;
end;
$$;
revoke all on function public.media_outlet_save(uuid, text, text[], boolean, boolean) from public, anon;
grant execute on function public.media_outlet_save(uuid, text, text[], boolean, boolean) to authenticated;

create or replace function public.media_department_save(p_id uuid, p_outlet_id uuid, p_name text, p_active boolean) returns public.media_departments
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); n text := btrim(coalesce(p_name, '')); nn text := public.media_norm(btrim(coalesce(p_name, ''))); result public.media_departments;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_outlet_id is null or not exists (select 1 from public.media_outlets where id = p_outlet_id) then raise exception 'Outlet not found' using errcode = 'P0002'; end if;
  if length(n) < 2 or length(n) > 100 or length(nn) < 2 then raise exception 'Invalid department name' using errcode = '22023'; end if;
  if exists (select 1 from public.media_departments d where d.outlet_id = p_outlet_id and d.name_norm = nn and d.id is distinct from p_id) then
    raise exception 'Department already exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.media_departments (outlet_id, name, name_norm, active, updated_by) values (p_outlet_id, n, nn, coalesce(p_active, true), caller) returning * into result;
  else
    update public.media_departments set name = n, name_norm = nn, active = coalesce(p_active, active), updated_at = now(), updated_by = caller
      where id = p_id and outlet_id = p_outlet_id returning * into result;
    if not found then raise exception 'Department not found' using errcode = 'P0002'; end if;
  end if;
  return result;
end;
$$;
revoke all on function public.media_department_save(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.media_department_save(uuid, uuid, text, boolean) to authenticated;

create or replace function public.set_media_alert_subscription(p_enabled boolean) returns public.media_alert_subscriptions
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); saved public.media_alert_subscriptions;
begin
  if caller is null or not public.has_page_access('people_news') then raise exception 'Page access denied' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'Invalid subscription' using errcode = '22023'; end if;
  if p_enabled and not exists (select 1 from auth.users where id = caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode = '22023';
  end if;
  insert into public.media_alert_subscriptions (user_id, enabled) values (caller, p_enabled)
    on conflict (user_id) do update set enabled = excluded.enabled, updated_at = now() returning * into saved;
  return saved;
end;
$$;
revoke all on function public.set_media_alert_subscription(boolean) from public, anon;
grant execute on function public.set_media_alert_subscription(boolean) to authenticated;

-- Collector only. Matches the given obituaries against active outlets; returns rows inserted by THIS call.
create or replace function public.media_match_notices(p_source_ids text[], p_run_id bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inserted jsonb;
begin
  with notices as (
    select n.source_id, public.media_norm(n.title || ' ' || n.summary) as body
    from public.yonhap_notices n where n.source_id = any(coalesce(p_source_ids, '{}'::text[])) and n.category = 'obituary'
  ), outlet_hits as (
    select x.source_id, o.id as outlet_id, o.name, o.any_department
    from notices x join public.media_outlets o on o.active
    where position(o.name_norm in x.body) > 0 or exists (select 1 from unnest(o.aliases_norm) a where position(a in x.body) > 0)
  ), candidates as (
    select h.source_id, h.outlet_id, null::uuid as department_id, h.name as matched_text from outlet_hits h where h.any_department
    union all
    select h.source_id, h.outlet_id, d.id, h.name || ' / ' || d.name
    from outlet_hits h join public.media_departments d on d.outlet_id = h.outlet_id and d.active
    join notices x on x.source_id = h.source_id where position(d.name_norm in x.body) > 0
  ), ins as (
    insert into public.media_obituary_matches (source_id, outlet_id, department_id, matched_text, sync_run_id)
    select c.source_id, c.outlet_id, c.department_id, c.matched_text, p_run_id from candidates c
    on conflict do nothing returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'sourceId', i.source_id, 'outlet', o.name, 'department', d.name, 'matchedText', i.matched_text,
           'title', n.title, 'summary', n.summary, 'url', n.source_url, 'publishedAt', n.published_at) order by n.published_at desc, i.id), '[]'::jsonb)
    into inserted
  from ins i join public.yonhap_notices n on n.source_id = i.source_id
  join public.media_outlets o on o.id = i.outlet_id left join public.media_departments d on d.id = i.department_id;
  return inserted;
end;
$$;
revoke all on function public.media_match_notices(text[], bigint) from public, anon, authenticated;
grant execute on function public.media_match_notices(text[], bigint) to service_role;

create or replace function public.media_alert_recipients() returns table (user_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, u.email
  from public.media_alert_subscriptions s
  join auth.users u on u.id = s.user_id and u.email is not null and u.email_confirmed_at is not null
  join public.user_profiles p on p.user_id = s.user_id and p.role in ('user', 'admin')
  left join public.user_page_access a on a.user_id = s.user_id
  where s.enabled and (p.role = 'admin' or coalesce((a.permissions->>'people_news')::boolean, true))
  order by u.email;
$$;
revoke all on function public.media_alert_recipients() from public, anon, authenticated;
grant execute on function public.media_alert_recipients() to service_role;

commit;
```

- [ ] **Step 2: 검증 스크립트 작성 (롤백 트랜잭션, 실제 데이터·메일 변경 없음)**

`scripts/check-media-directory.sql`:

```sql
-- Transaction-only verification for media directory + matching. Runs on the linked DB and rolls back everything.
begin;
do $$
declare
  admin_id uuid; user_id uuid; o public.media_outlets; d public.media_departments; r jsonb; s public.media_alert_subscriptions; n integer; body text;
begin
  select p.user_id into admin_id from public.user_profiles p join auth.users u on u.id = p.user_id where p.role = 'admin' limit 1;
  select p.user_id into user_id from public.user_profiles p join auth.users u on u.id = p.user_id and u.email_confirmed_at is not null where p.role = 'user' limit 1;
  if admin_id is null or user_id is null then raise exception 'Need one admin and one user'; end if;

  if public.media_norm('㈜헤럴드 경제') <> '헤럴드경제' then raise exception 'norm 1: %', public.media_norm('㈜헤럴드 경제'); end if;
  if public.media_norm('IT산업부 팩플팀') <> 'it산업부팩플팀' then raise exception 'norm 2'; end if;
  if public.media_norm('테크&사이언스부') <> '테크사이언스부' then raise exception 'norm 3'; end if;

  -- Non-admin cannot import or edit.
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  begin perform public.media_directory_import('[{"outlet":"테스트일보","department":"테크부"}]'::jsonb); raise exception 'user imported';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  r := public.media_directory_import('[{"outlet":"테스트일보","department":"테크부"},{"outlet":"테스트일보","department":"테크부"},{"outlet":"테스트일보","department":null},{"outlet":"검증경제","department":"산업부"},{"outlet":"X","department":"y"}]'::jsonb);
  if (r->>'outletsAdded')::int <> 2 or (r->>'departmentsAdded')::int <> 2 or (r->>'anyDepartmentSet')::int <> 1 or (r->>'skipped')::int <> 1 then raise exception 'import counts %', r; end if;
  r := public.media_directory_import('[{"outlet":"테스트일보","department":"테크부"},{"outlet":"테스트 일보","department":null}]'::jsonb);
  if (r->>'outletsAdded')::int <> 0 or (r->>'departmentsAdded')::int <> 0 or (r->>'outletsExisting')::int <> 1 then raise exception 'reimport not idempotent %', r; end if;

  select * into o from public.media_outlets where name_norm = '검증경제';
  o := public.media_outlet_save(o.id, '검증경제', array['검증경제신문', ' '], false, true);
  if o.aliases <> array['검증경제신문'] or o.aliases_norm <> array['검증경제신문'] then raise exception 'alias save'; end if;
  begin perform public.media_outlet_save(null, '검증경제신문', '{}', false, true); raise exception 'alias collision accepted';
  exception when unique_violation then null; end;
  begin perform public.media_department_save(null, o.id, '산업부', true); raise exception 'duplicate department accepted';
  exception when unique_violation then null; end;

  -- Matching: outlet+department required unless any_department.
  insert into public.yonhap_notices (source_id, category, title, summary, source_url, published_at) values
    ('AKR99990000000001', 'obituary', '[부고] 김검증(검증경제 기자)씨 부친상', '▲ 김검증(검증경제 산업부 기자)씨 부친상 = 15일', 'https://www.yna.co.kr/view/AKR99990000000001', now()),
    ('AKR99990000000002', 'obituary', '[부고] 이검증(검증경제 기자)씨 모친상', '▲ 이검증(검증경제 기자)씨 모친상 = 15일', 'https://www.yna.co.kr/view/AKR99990000000002', now()),
    ('AKR99990000000003', 'obituary', '[부고] 박검증(테스트일보 기자)씨 조부상', '▲ 박검증(테스트일보 기자)씨 조부상', 'https://www.yna.co.kr/view/AKR99990000000003', now()),
    ('AKR99990000000004', 'personnel', '[인사] 검증경제 산업부', '검증경제 산업부 인사', 'https://www.yna.co.kr/view/AKR99990000000004', now());
  r := public.media_match_notices(array['AKR99990000000001','AKR99990000000002','AKR99990000000003','AKR99990000000004'], null);
  if jsonb_array_length(r) <> 2 then raise exception 'expected 2 matches, got %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r) e where e->>'sourceId' = 'AKR99990000000001' and e->>'department' = '산업부') then raise exception 'dept match missing'; end if;
  if not exists (select 1 from jsonb_array_elements(r) e where e->>'sourceId' = 'AKR99990000000003' and e->>'department' is null and e->>'matchedText' = '테스트일보') then raise exception 'any-department match missing'; end if;
  r := public.media_match_notices(array['AKR99990000000001','AKR99990000000003'], null);
  if jsonb_array_length(r) <> 0 then raise exception 'rematch returned rows %', r; end if;
  -- Alias hit
  update public.yonhap_notices set summary = '▲ 최검증(검증경제신문 산업부 차장)씨 빙모상' where source_id = 'AKR99990000000002';
  r := public.media_match_notices(array['AKR99990000000002'], null);
  if jsonb_array_length(r) <> 1 then raise exception 'alias match failed %', r; end if;

  -- Subscription: page access + recipients filter.
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  s := public.set_media_alert_subscription(true);
  if not s.enabled then raise exception 'subscribe failed'; end if;
  select count(*) into n from public.media_alert_recipients() where media_alert_recipients.user_id = s.user_id;
  if n <> 1 then raise exception 'recipient missing'; end if;
  s := public.set_media_alert_subscription(false);
  select count(*) into n from public.media_alert_recipients() where media_alert_recipients.user_id = s.user_id;
  if n <> 0 then raise exception 'unsubscribed still recipient'; end if;
  -- Reader without people_news permission cannot see outlets.
  insert into public.user_page_access (user_id, permissions) values (user_id, '{"people_news": false}'::jsonb)
    on conflict (user_id) do update set permissions = '{"people_news": false}'::jsonb;
  set local role authenticated;
  select count(*) into n from public.media_outlets;
  if n <> 0 then raise exception 'restricted user read % outlets', n; end if;
  reset role;
  raise notice 'media directory checks passed';
end;
$$;
rollback;
```

- [ ] **Step 3: 운영 DB에 적용 후 검증 스크립트 실행**

Run (프로젝트 루트):
```bash
supabase db query --linked --file docs/sql/2026-09-15-media-directory.sql
supabase db query --linked --file scripts/check-media-directory.sql
```
Expected: 첫 명령 오류 없음. 둘째 명령 출력에 `media directory checks passed` NOTICE, 오류 없음(전부 롤백). 만약 `nulls not distinct` 문법 오류(PG14 이하)가 나면 유니크 인덱스를 `(source_id, outlet_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid))`로 바꾸고 재적용.

- [ ] **Step 4: 적용 상태 확인**

Run:
```bash
supabase db query --linked "select count(*) as outlets from public.media_outlets; select proname from pg_proc where proname like 'media_%' order by 1;" -o json
```
Expected: `outlets: 0`, 함수 7개(`media_alert_recipients, media_department_save, media_directory_import, media_match_notices, media_norm, media_outlet_save`, `set_media_alert_subscription`은 `set_` 접두라 별도 확인 — `select to_regprocedure('public.set_media_alert_subscription(boolean)')` not null).

- [ ] **Step 5: Commit**

```bash
git add docs/sql/2026-09-15-media-directory.sql scripts/check-media-directory.sql
git commit -m "feat(media): 매체·부서 테이블, 부고 매칭·알림 구독 RPC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 2: SMTP 클라이언트 테스트(가짜 서버)와 보정

**Files:**
- Test: `supabase/functions/yonhap-notices/smtp_test.ts`
- Modify: `supabase/functions/yonhap-notices/smtp.ts`(테스트가 드러내는 결함만), `supabase/functions/yonhap-notices/deno.json`

**Interfaces:**
- Consumes(이미 구현됨): `sendMail(config: SmtpConfig, message: MailMessage, options?: SendOptions): Promise<SendResult>`, `SendOptions.connect?: (host, port) => Promise<Transport>`, `SmtpError { step, code }`, `encodeHeaderWord(value)`, `dotStuff(data)`, `buildMessage(message, messageId, date)`, `sanitize(text)`, `smtpConfigFromEnv(get)`.
- Produces: 검증된 `smtp.ts`; Task 3이 `sendMail`·`SmtpError`·`sanitize`를 사용.

- [ ] **Step 1: 가짜 SMTP 서버와 테스트 작성**

`supabase/functions/yonhap-notices/smtp_test.ts`:

```ts
import { buildMessage, dotStuff, encodeHeaderWord, sanitize, sendMail, SmtpError, smtpConfigFromEnv, type Transport } from "./smtp.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
const decodeWord = (word: string) => dec.decode(Uint8Array.from(atob(word.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "")), (c) => c.charCodeAt(0)));

/** Scripted SMTPS peer: replies are queued by write(), consumed by read(). */
class FakeServer implements Transport {
  commands: string[] = []; data = ""; closed = false;
  private inData = false; private inbox = ""; private outbox: Uint8Array[] = [];
  constructor(private options: { rejects?: Record<string, number>; authCode?: number; silentAfterBanner?: boolean } = {}) { this.queue("220 test.local ESMTP ready"); }
  private queue(line: string) { this.outbox.push(enc.encode(`${line}\r\n`)); }
  read(p: Uint8Array): Promise<number | null> {
    const next = this.outbox.shift();
    if (!next) return new Promise(() => {});
    p.set(next); return Promise.resolve(next.length);
  }
  write(p: Uint8Array): Promise<number> {
    this.inbox += dec.decode(p);
    let index: number;
    while ((index = this.inbox.indexOf("\r\n")) >= 0) {
      const line = this.inbox.slice(0, index); this.inbox = this.inbox.slice(index + 2);
      if (this.inData) { if (line === ".") { this.inData = false; this.queue("250 2.0.0 queued as ABC123"); } else this.data += `${line}\r\n`; continue; }
      this.commands.push(line);
      if (this.options.silentAfterBanner) continue;
      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO")) { this.queue("250-test.local"); this.queue("250-AUTH LOGIN PLAIN"); this.queue("250 HELP"); }
      else if (upper === "AUTH LOGIN") this.queue("334 VXNlcm5hbWU6");
      else if (this.commands.at(-2)?.toUpperCase() === "AUTH LOGIN") this.queue("334 UGFzc3dvcmQ6");
      else if (this.commands.at(-3)?.toUpperCase() === "AUTH LOGIN") {
        const code = this.options.authCode ?? 235;
        this.queue(code === 235 ? "235 2.7.0 Authentication successful" : `${code} 5.7.8 Authentication credentials invalid for sender@example.test`);
      }
      else if (upper.startsWith("MAIL FROM")) this.queue("250 2.1.0 Ok");
      else if (upper.startsWith("RCPT TO")) { const address = line.slice(line.indexOf("<") + 1, line.indexOf(">")); const code = this.options.rejects?.[address]; this.queue(code ? `${code} 5.1.1 <${address}>: Recipient address rejected` : "250 2.1.5 Ok"); }
      else if (upper === "DATA") { this.inData = true; this.queue("354 End data with <CR><LF>.<CR><LF>"); }
      else if (upper === "QUIT") this.queue("221 2.0.0 Bye");
      else this.queue("500 5.5.1 Unknown command");
    }
    return Promise.resolve(p.length);
  }
  close() { this.closed = true; }
}
const config = { host: "relay.test", port: 465, user: "sender@example.test", pass: "p@ss#word" };
const message = { from: { name: "인사·부고 알림", address: "sender@example.test" }, to: ["a@example.test", "b@example.test"], subject: "[부고 알림] 관리 매체·부서 일치 2건 · 9월 15일", text: "본문\n.숨은 점\n", html: "<p>본문</p>" };
const send = (server: FakeServer, overrides: Partial<typeof message> = {}, options: { stepTimeoutMs?: number } = {}) =>
  sendMail(config, { ...message, ...overrides }, { connect: () => Promise.resolve(server), now: () => new Date("2026-09-15T02:00:00Z"), messageId: "test-id@example.test", ...options });

Deno.test("authenticates with AUTH LOGIN over the injected TLS transport and delivers one message", async () => {
  const server = new FakeServer();
  const result = await send(server);
  assert(result.accepted.length === 2 && result.rejected.length === 0 && result.messageId === "test-id@example.test");
  assert(server.commands[0].startsWith("EHLO "), "EHLO first");
  assert(server.commands.includes("AUTH LOGIN") && server.commands.includes(b64(config.user)) && server.commands.includes(b64(config.pass)), "credentials base64");
  assert(server.commands.includes("MAIL FROM:<sender@example.test>") && server.commands.includes("RCPT TO:<a@example.test>") && server.commands.includes("RCPT TO:<b@example.test>"));
  assert(server.commands.filter((c) => c === "DATA").length === 1 && server.commands.at(-1) === "QUIT" && server.closed);
  assert(server.data.includes("Date: Tue, 15 Sep 2026 02:00:00 +0000") && server.data.includes("Message-ID: <test-id@example.test>"), "headers");
  assert(server.data.includes("Content-Type: multipart/alternative") && server.data.includes("Content-Transfer-Encoding: base64"));
  const subjectLine = server.data.split("\r\n").find((l) => l.startsWith("Subject: "))!;
  assert(subjectLine.split(" ").slice(1).map(decodeWord).join("") === message.subject, "subject round-trips through RFC 2047");
  assert(!server.data.includes(config.pass) && !server.data.includes("\n.숨은"), "no raw secrets or bare dots");
});

Deno.test("records rejected recipients per RCPT reply and still sends to accepted ones", async () => {
  const server = new FakeServer({ rejects: { "b@example.test": 550 } });
  const result = await send(server);
  assert(result.accepted.length === 1 && result.accepted[0] === "a@example.test");
  assert(result.rejected.length === 1 && result.rejected[0].address === "b@example.test" && result.rejected[0].code === 550);
  assert(server.commands.includes("DATA"));
});

Deno.test("skips DATA when every recipient is rejected", async () => {
  const server = new FakeServer({ rejects: { "a@example.test": 550, "b@example.test": 551 } });
  const result = await send(server);
  assert(result.accepted.length === 0 && result.rejected.length === 2 && !server.commands.includes("DATA") && server.closed);
});

Deno.test("authentication failure surfaces step and code without addresses or secrets", async () => {
  const server = new FakeServer({ authCode: 535 });
  try { await send(server); throw new Error("expected failure"); }
  catch (error) {
    assert(error instanceof SmtpError && error.step === "auth" && error.code === 535, `unexpected ${String(error)}`);
    assert(!error.message.includes("sender@example.test") && error.message.includes("[email]") && !error.message.includes(config.pass));
  }
  assert(!server.commands.some((c) => c.startsWith("MAIL FROM")) && server.closed);
});

Deno.test("times out when the server stops answering and closes the connection", async () => {
  const server = new FakeServer({ silentAfterBanner: true });
  try { await send(server, {}, { stepTimeoutMs: 30 }); throw new Error("expected timeout"); }
  catch (error) { assert(error instanceof SmtpError && error.step === "ehlo" && error.message.includes("timeout"), String(error)); }
  assert(server.closed);
});

Deno.test("rejects malformed addresses before connecting", async () => {
  const server = new FakeServer();
  for (const bad of ["a@b", "x y@example.test", "<a@example.test>", "a@example.test\r\nRCPT TO:<z@example.test>"]) {
    try { await send(server, { to: [bad] }); throw new Error("accepted " + bad); }
    catch (error) { assert(error instanceof SmtpError && error.step === "recipient", String(error)); }
  }
  assert(server.commands.length === 0);
});

Deno.test("header words, dot stuffing and sanitize", () => {
  assert(encodeHeaderWord("Plain ASCII subject") === "Plain ASCII subject");
  const long = encodeHeaderWord("가".repeat(40));
  assert(long.split(" ").every((w) => w.length <= 75 && w.startsWith("=?UTF-8?B?")) && long.split(" ").map(decodeWord).join("") === "가".repeat(40));
  assert(dotStuff("abc\r\n.hidden\r\n..x\r\nend") === "abc\r\n..hidden\r\n...x\r\nend");
  assert(sanitize("550 <who@example.test> rejected\r\nsecond line") === "550 <[email]> rejected second line");
  assert(sanitize("x".repeat(300)).length === 200);
  const built = buildMessage({ ...message, to: ["a@example.test"] }, "id@example.test", new Date("2026-09-15T02:00:00Z"));
  assert(built.includes("From: =?UTF-8?B?") && built.includes("<sender@example.test>") && built.includes("To: <a@example.test>") && built.endsWith("--\r\n"));
  assert(smtpConfigFromEnv(() => undefined) === null);
  const cfg = smtpConfigFromEnv((k) => ({ MEDIA_SMTP_HOST: "h", MEDIA_SMTP_USER: "u@x.test", MEDIA_SMTP_PASS: "p" } as Record<string, string>)[k]);
  assert(cfg?.port === 465 && cfg.host === "h");
});
```

- [ ] **Step 2: 테스트 태스크에 파일 추가**

`supabase/functions/yonhap-notices/deno.json`의 `tasks.test`를 다음으로 교체:
```json
"test": "deno test --allow-net feed_test.ts handler_test.ts smtp_test.ts alerts_test.ts"
```
(alerts_test.ts는 Task 3에서 생긴다. Task 2 실행 시점엔 `deno test smtp_test.ts`로 단독 실행.)

- [ ] **Step 3: 테스트 실행**

Run (`supabase/functions/yonhap-notices/`): `deno test --allow-net smtp_test.ts`
Expected: 7개 통과. 실패하면 `smtp.ts`의 해당 동작만 고친다. 알려진 후보: (a) `read()`가 영원히 대기하는 페이크에서 타임아웃이 `ehlo` 단계로 보고되는지(배너는 큐에 있으므로 EHLO 응답 대기에서 타임아웃), (b) `formatAddress`의 인코딩된 표시 이름 앞뒤 공백, (c) `dotStuff`가 첫 줄 `.`도 처리하는지. 코드 변경 후 `deno check smtp.ts`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/yonhap-notices/smtp.ts supabase/functions/yonhap-notices/smtp_test.ts supabase/functions/yonhap-notices/deno.json
git commit -m "feat(media): Edge Function용 SMTPS(465) 클라이언트와 가짜 서버 테스트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 3: 알림 실행기 `alerts.ts` (매칭 호출 → 다이제스트 → 발송 → 이력)

**Files:**
- Create: `supabase/functions/yonhap-notices/alerts.ts`
- Test: `supabase/functions/yonhap-notices/alerts_test.ts`

**Interfaces:**
- Consumes: Task 1 RPC `media_match_notices(p_source_ids, p_run_id)`→`AlertMatch[]`(camelCase 키), `media_alert_recipients()`→`{user_id,email}[]`; 테이블 `media_alert_deliveries`(insert), `media_obituary_matches`(update `notified_at`). Task 2 `sendMail`, `SmtpError`, `sanitize`, `SmtpConfig`.
- Produces:
```ts
export interface AlertMatch { id: number; sourceId: string; outlet: string; department: string | null; matchedText: string; title: string; summary: string; url: string; publishedAt: string }
export interface AlertSummary { matches: number; recipients: number; sent: number; failed: number; skipped?: "no-new-notices" | "no-matches" | "smtp-unconfigured" | "no-recipients" }
export interface AlertDeps { admin: SupabaseClient; runId: number; sourceIds: string[]; smtp: SmtpConfig | null; appUrl: string; send?: typeof sendMail; now?: () => Date }
export function buildAlertDigest(matches: AlertMatch[], appUrl: string, now: Date): { subject: string; text: string; html: string }
export async function runMediaAlerts(deps: AlertDeps): Promise<AlertSummary>
```

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/functions/yonhap-notices/alerts_test.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { buildAlertDigest, runMediaAlerts, type AlertMatch } from "./alerts.ts";
import { SmtpError, type SendResult } from "./smtp.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const match = (id: number, department: string | null = "테크부"): AlertMatch => ({
  id, sourceId: `AKR2026091500000000${id}`, outlet: "중앙일보", department, matchedText: department ? `중앙일보 / ${department}` : "중앙일보",
  title: `[부고] 홍길동(중앙일보 기자)씨 부친상 <script>`, summary: "▲ 홍길순씨 별세, 홍길동(중앙일보 테크부 기자)씨 부친상 = 15일", url: `https://www.yna.co.kr/view/AKR2026091500000000${id}`, publishedAt: "2026-09-14T23:00:00Z",
});
const recipients = [{ user_id: "u1", email: "a@example.test" }, { user_id: "u2", email: "b@example.test" }];
const smtp = { host: "relay.test", port: 465, user: "sender@example.test", pass: "secret" };

function fixture(options: { matches?: AlertMatch[]; recipients?: typeof recipients; sendResult?: Partial<SendResult>; sendError?: Error; failInsert?: boolean } = {}) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const admin = createClient("https://test.supabase.co", "service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const path = new URL(String(input)).pathname; const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (path.endsWith("/rpc/media_match_notices")) return Response.json(options.matches ?? [match(1), match(2, null)]);
    if (path.endsWith("/rpc/media_alert_recipients")) return Response.json(options.recipients ?? recipients);
    if (path.endsWith("/media_alert_deliveries")) return options.failInsert ? Response.json({ message: "down" }, { status: 500 }) : new Response(null, { status: 201 });
    if (path.endsWith("/media_obituary_matches")) return new Response(null, { status: 204 });
    return Response.json({ message: `unexpected ${path}` }, { status: 500 });
  } } });
  const sends: unknown[] = [];
  const send = async (_config: typeof smtp, message: { to: string[] }) => {
    sends.push(message);
    if (options.sendError) throw options.sendError;
    return { accepted: message.to, rejected: [], messageId: "m@example.test", ...options.sendResult } as SendResult;
  };
  return { calls, sends, run: (over: Partial<Parameters<typeof runMediaAlerts>[0]> = {}) => runMediaAlerts({ admin, runId: 7, sourceIds: ["AKR20260915000000001", "AKR20260915000000002"], smtp, appUrl: "https://app.test", send: send as never, now: () => new Date("2026-09-15T00:30:00Z"), ...over }) };
}

Deno.test("does nothing without new notices", async () => {
  const f = fixture(); const summary = await f.run({ sourceIds: [] });
  assert(summary.skipped === "no-new-notices" && f.calls.length === 0 && f.sends.length === 0);
});
Deno.test("stops after matching when nothing matched", async () => {
  const f = fixture({ matches: [] }); const summary = await f.run();
  assert(summary.skipped === "no-matches" && summary.matches === 0 && f.calls.length === 1 && f.sends.length === 0);
  assert(f.calls[0].body.p_source_ids.length === 2 && f.calls[0].body.p_run_id === 7);
});
Deno.test("keeps matches but skips sending when SMTP is not configured", async () => {
  const f = fixture(); const summary = await f.run({ smtp: null });
  assert(summary.skipped === "smtp-unconfigured" && summary.matches === 2 && f.sends.length === 0 && !f.calls.some((c) => c.path.endsWith("media_alert_recipients")));
});
Deno.test("skips when nobody subscribed", async () => {
  const f = fixture({ recipients: [] }); const summary = await f.run();
  assert(summary.skipped === "no-recipients" && f.sends.length === 0 && !f.calls.some((c) => c.path.endsWith("media_alert_deliveries")));
});
Deno.test("sends one digest to all recipients, records deliveries and marks matches notified", async () => {
  const f = fixture({ sendResult: { accepted: ["a@example.test"], rejected: [{ address: "b@example.test", code: 550 }] } });
  const summary = await f.run();
  assert(summary.sent === 1 && summary.failed === 1 && summary.recipients === 2 && summary.matches === 2 && f.sends.length === 1);
  const inserted = f.calls.find((c) => c.path.endsWith("media_alert_deliveries"))!.body as Array<Record<string, unknown>>;
  assert(inserted.length === 2 && inserted.every((d) => d.sync_run_id === 7 && d.match_count === 2));
  assert(inserted.find((d) => d.recipient_email === "a@example.test")!.status === "sent" && inserted.find((d) => d.recipient_email === "b@example.test")!.status === "failed");
  const marked = f.calls.find((c) => c.path.endsWith("media_obituary_matches") && c.method === "PATCH")!;
  assert(marked && (marked.body as { notified_at: string }).notified_at === "2026-09-15T00:30:00.000Z");
});
Deno.test("connection failure records every recipient as failed without marking matches", async () => {
  const f = fixture({ sendError: new SmtpError("auth", 535, "credentials invalid for sender@example.test") });
  const summary = await f.run();
  assert(summary.sent === 0 && summary.failed === 2);
  const inserted = f.calls.find((c) => c.path.endsWith("media_alert_deliveries"))!.body as Array<Record<string, string>>;
  assert(inserted.every((d) => d.status === "failed" && d.error_message.includes("auth") && !d.error_message.includes("sender@example.test")));
  assert(!f.calls.some((c) => c.path.endsWith("media_obituary_matches")));
});
Deno.test("delivery log failure propagates", async () => {
  const f = fixture({ failInsert: true });
  try { await f.run(); throw new Error("expected failure"); } catch (error) { assert(error instanceof Error && error.message.includes("이력")); }
});
Deno.test("digest lists matches with escaping, department fallback and links", () => {
  const digest = buildAlertDigest([match(1), match(2, null)], "https://app.test", new Date("2026-09-15T00:30:00Z"));
  assert(digest.subject === "[부고 알림] 관리 매체·부서 일치 2건 · 9월 15일", digest.subject);
  assert(digest.html.includes("&lt;script&gt;") && !digest.html.includes("<script>"), "escaped");
  assert(digest.html.includes("중앙일보 / 테크부") && digest.html.includes("부서 무관") && digest.html.includes("https://www.yna.co.kr/view/AKR20260915000000001"));
  assert(digest.html.includes("https://app.test/people-news") && digest.html.includes("https://app.test/media-directory"));
  assert(digest.text.includes("중앙일보 / 테크부") && digest.text.includes("원문: https://www.yna.co.kr/view/AKR20260915000000002"));
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net alerts_test.ts`
Expected: `Module not found "./alerts.ts"` 오류.

- [ ] **Step 3: 구현**

`supabase/functions/yonhap-notices/alerts.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize, sendMail, SmtpError, type SmtpConfig } from "./smtp.ts";

export interface AlertMatch { id: number; sourceId: string; outlet: string; department: string | null; matchedText: string; title: string; summary: string; url: string; publishedAt: string }
export interface AlertRecipient { user_id: string; email: string }
export interface AlertSummary { matches: number; recipients: number; sent: number; failed: number; skipped?: "no-new-notices" | "no-matches" | "smtp-unconfigured" | "no-recipients" }
export interface AlertDeps { admin: SupabaseClient; runId: number; sourceIds: string[]; smtp: SmtpConfig | null; appUrl: string; send?: typeof sendMail; now?: () => Date }

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const kst = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const kstDay = (date: Date) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).formatToParts(date).map((x) => [x.type, x.value])); return `${p.month}월 ${p.day}일`; };

export function buildAlertDigest(matches: AlertMatch[], appUrl: string, now: Date): { subject: string; text: string; html: string } {
  const subject = `[부고 알림] 관리 매체·부서 일치 ${matches.length}건 · ${kstDay(now)}`;
  const label = (m: AlertMatch) => m.department ? m.matchedText : `${m.outlet} (부서 무관)`;
  const text = [
    `관리 매체·부서와 일치하는 연합뉴스 부고 ${matches.length}건입니다.`, "",
    ...matches.flatMap((m) => [`■ ${label(m)}`, m.title, m.summary, `원문: ${m.url}`, `송고: ${kst.format(new Date(m.publishedAt))} KST`, ""]),
    `인사·부고 화면: ${appUrl}/people-news`, `관리 매체·부서 목록: ${appUrl}/media-directory`, "알림 해제는 인사·부고 화면의 '관리 매체·부서 부고 알림 받기'에서 할 수 있습니다.",
  ].join("\n");
  const items = matches.map((m) => `<li style="margin:0 0 16px"><div style="font-size:12px;color:#0369a1;font-weight:600">${escapeHtml(label(m))}</div>` +
    `<div style="font-weight:600;margin:2px 0"><a href="${escapeHtml(m.url)}" style="color:#111">${escapeHtml(m.title)}</a></div>` +
    `<div style="color:#444;font-size:14px;line-height:1.5">${escapeHtml(m.summary)}</div>` +
    `<div style="color:#888;font-size:12px">송고 ${escapeHtml(kst.format(new Date(m.publishedAt)))} KST · <a href="${escapeHtml(m.url)}">원문 보기</a></div></li>`).join("");
  const html = `<!doctype html><html lang="ko"><body style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">` +
    `<h1 style="font-size:18px;margin:0 0 4px">관리 매체·부서 부고 알림</h1><p style="margin:0 0 20px;color:#555">관리 매체·부서와 일치하는 연합뉴스 부고 ${matches.length}건입니다.</p>` +
    `<ul style="list-style:none;padding:0;margin:0">${items}</ul><hr style="border:0;border-top:1px solid #e5e5e5;margin:20px 0">` +
    `<p style="font-size:12px;color:#777"><a href="${escapeHtml(appUrl)}/people-news">인사·부고 화면</a> · <a href="${escapeHtml(appUrl)}/media-directory">관리 매체·부서 목록</a><br>알림 해제는 인사·부고 화면의 '관리 매체·부서 부고 알림 받기'에서 할 수 있습니다.</p></body></html>`;
  return { subject, text, html };
}

export async function runMediaAlerts({ admin, runId, sourceIds, smtp, appUrl, send = sendMail, now = () => new Date() }: AlertDeps): Promise<AlertSummary> {
  const summary: AlertSummary = { matches: 0, recipients: 0, sent: 0, failed: 0 };
  if (!sourceIds.length) return { ...summary, skipped: "no-new-notices" };
  const matched = await admin.rpc("media_match_notices", { p_source_ids: sourceIds, p_run_id: runId });
  if (matched.error) throw new Error("매체 매칭 실패");
  const matches = (matched.data ?? []) as AlertMatch[];
  summary.matches = matches.length;
  if (!matches.length) return { ...summary, skipped: "no-matches" };
  if (!smtp) { console.warn("[media-alerts] SMTP 미설정으로 발송 생략", matches.length); return { ...summary, skipped: "smtp-unconfigured" }; }
  const recipientsResult = await admin.rpc("media_alert_recipients");
  if (recipientsResult.error) throw new Error("알림 수신자 조회 실패");
  const recipients = (recipientsResult.data ?? []) as AlertRecipient[];
  summary.recipients = recipients.length;
  if (!recipients.length) return { ...summary, skipped: "no-recipients" };
  const digest = buildAlertDigest(matches, appUrl, now());
  const deliveries: Array<{ sync_run_id: number; recipient_user_id: string; recipient_email: string; match_count: number; status: "sent" | "failed"; error_message: string | null }> = [];
  const base = (r: AlertRecipient) => ({ sync_run_id: runId, recipient_user_id: r.user_id, recipient_email: r.email, match_count: matches.length });
  try {
    const result = await send(smtp, { from: { name: "인사·부고 알림", address: smtp.user }, to: recipients.map((r) => r.email), subject: digest.subject, text: digest.text, html: digest.html });
    const accepted = new Set(result.accepted.map((a) => a.toLowerCase()));
    for (const r of recipients) {
      const rejected = result.rejected.find((x) => x.address.toLowerCase() === r.email.toLowerCase());
      const ok = !rejected && accepted.has(r.email.toLowerCase());
      deliveries.push({ ...base(r), status: ok ? "sent" : "failed", error_message: ok ? null : `수신자 거절 (${rejected?.code ?? "unknown"})` });
    }
  } catch (error) {
    // SmtpError messages are already sanitized; anything else is scrubbed here.
    const message = error instanceof SmtpError ? error.message : sanitize(error instanceof Error ? error.message : "발송 실패");
    for (const r of recipients) deliveries.push({ ...base(r), status: "failed", error_message: message });
  }
  summary.sent = deliveries.filter((d) => d.status === "sent").length;
  summary.failed = deliveries.length - summary.sent;
  const saved = await admin.from("media_alert_deliveries").insert(deliveries);
  if (saved.error) throw new Error("알림 발송 이력 저장 실패");
  if (summary.sent) {
    const marked = await admin.from("media_obituary_matches").update({ notified_at: now().toISOString() }).in("id", matches.map((m) => m.id));
    if (marked.error) throw new Error("알림 완료 표시 실패");
  }
  return summary;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `deno test --allow-net alerts_test.ts smtp_test.ts && deno check alerts.ts`
Expected: alerts 8개 + smtp 7개 통과.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/yonhap-notices/alerts.ts supabase/functions/yonhap-notices/alerts_test.ts
git commit -m "feat(media): 부고 매칭 알림 실행기(다이제스트·SMTP 발송·이력)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 4: 수집 함수에 매칭·알림 연결 (`handler.ts`, `index.ts`)

**Files:**
- Modify: `supabase/functions/yonhap-notices/handler.ts`
- Modify: `supabase/functions/yonhap-notices/index.ts`
- Modify: `supabase/functions/yonhap-notices/handler_test.ts`

**Interfaces:**
- Consumes: Task 3 `runMediaAlerts(deps: AlertDeps)`, `AlertSummary`; Task 2 `smtpConfigFromEnv`, `SmtpConfig`.
- Produces: `Dependencies`에 `smtp: SmtpConfig | null`, `appUrl: string`, `alerts?: (deps: AlertDeps) => Promise<AlertSummary>` 추가. 응답 `{ ok, count, runId, alerts: AlertSummary | { error: "media-alerts-failed" } }`.

- [ ] **Step 1: 실패하는 테스트 추가**

`handler_test.ts`의 `fixture` 함수를 아래처럼 바꾼다(옵션 `existingIds`, `alertsThrow`, `obituary` 추가, `GET yonhap_notices` 처리, `alerts` 주입).

```ts
function fixture(options: { role?: string; cooldown?: boolean; invalidToken?: boolean; failSave?: boolean; failCollect?: boolean; secret?: string; denied?: boolean; accessError?: boolean; existingIds?: string[]; alertsThrow?: boolean; obituary?: boolean } = {}) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  const alertCalls: { runId: number; sourceIds: string[] }[] = [];
  let collected = 0;
  const db = createClient("https://test.supabase.co", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      if (path === "/auth/v1/user") return Response.json(options.invalidToken ? { message: "invalid token" } : { id: "user-1" }, { status: options.invalidToken ? 401 : 200 });
      if (path.endsWith("user_profiles")) return Response.json({ role: options.role ?? "user" });
      if (path.endsWith("user_page_access")) return Response.json(options.accessError ? { message: "offline" } : { permissions: { people_news: !options.denied } }, { status: options.accessError ? 500 : 200 });
      if (path.endsWith("claim_yonhap_notice_manual_sync")) return Response.json(!options.cooldown);
      if (path.endsWith("yonhap_notices") && method === "GET") return Response.json((options.existingIds ?? []).map((source_id) => ({ source_id })));
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      writes.push({ path, method, body });
      if (path.endsWith("yonhap_notice_sync_runs") && method === "POST") return Response.json({ id: 1 });
      if (options.failSave && path.endsWith("yonhap_notices")) return Response.json({ message: "db unavailable" }, { status: 500 });
      return new Response(null, { status: 204 });
    } },
  });
  return {
    writes, alertCalls,
    collected: () => collected,
    handler: createHandler({
      secret: options.secret ?? "cron-secret",
      createAdmin: () => db,
      smtp: null,
      appUrl: "https://app.test",
      alerts: async ({ runId, sourceIds }) => {
        alertCalls.push({ runId, sourceIds });
        if (options.alertsThrow) throw new Error("smtp down for sender@example.test");
        return { matches: sourceIds.length, recipients: 0, sent: 0, failed: 0, skipped: sourceIds.length ? "no-recipients" : "no-new-notices" };
      },
      collect: async () => {
        collected++;
        if (options.failCollect) throw new Error("RSS HTTP 503");
        const personnel = { source_id: "AKR20260911000100001", category: "personnel" as const, title: "[인사] 기관", summary: "요약", source_url: "https://www.yna.co.kr/view/AKR20260911000100001", published_at: "2026-09-10T22:00:00Z" };
        if (!options.obituary) return [personnel];
        return [personnel,
          { source_id: "AKR20260915000200001", category: "obituary" as const, title: "[부고] 새 부고", summary: "요약", source_url: "https://www.yna.co.kr/view/AKR20260915000200001", published_at: "2026-09-15T00:00:00Z" },
          { source_id: "AKR20260915000200002", category: "obituary" as const, title: "[부고] 기존 부고", summary: "요약", source_url: "https://www.yna.co.kr/view/AKR20260915000200002", published_at: "2026-09-14T00:00:00Z" }];
      },
    }),
  };
}
```

파일 끝에 테스트 3개 추가:

```ts
Deno.test("passes only newly stored obituaries to the alert runner", async () => {
  const f = fixture({ obituary: true, existingIds: ["AKR20260915000200002"] });
  const response = await f.handler(request("cron-secret"));
  assert(response.status === 200);
  const body = await response.json();
  assert(f.alertCalls.length === 1 && f.alertCalls[0].runId === 1, "alerts called once with run id");
  assert(f.alertCalls[0].sourceIds.length === 1 && f.alertCalls[0].sourceIds[0] === "AKR20260915000200001", "existing obituary excluded, personnel excluded");
  assert(body.alerts.matches === 1 && body.alerts.skipped === "no-recipients");
});

Deno.test("alert failure never fails the collection run", async () => {
  const f = fixture({ obituary: true, alertsThrow: true });
  const response = await f.handler(request("cron-secret"));
  assert(response.status === 200);
  const body = await response.json();
  assert(body.ok === true && body.count === 3 && body.alerts.error === "media-alerts-failed");
  assert((f.writes.at(-1)?.body as { status: string }).status === "success", "run stays successful");
});

Deno.test("alerts run after the success record and not when saving failed", async () => {
  const f = fixture({ obituary: true, failSave: true });
  assert((await f.handler(request("cron-secret"))).status === 500);
  assert(f.alertCalls.length === 0);
});
```

기존 테스트 `can collect, upsert and finish a run`의 `f.writes.length === 3` 단언은 그대로 유효해야 한다(GET은 writes에 넣지 않음).

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net handler_test.ts`
Expected: 타입 오류(`smtp`, `appUrl`, `alerts`가 `Dependencies`에 없음) 또는 새 테스트 3개 실패.

- [ ] **Step 3: handler.ts 수정**

`Dependencies`와 import:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNotices, type Notice } from "./feed.ts";
import { runMediaAlerts, type AlertDeps, type AlertSummary } from "./alerts.ts";
import type { SmtpConfig } from "./smtp.ts";

interface Dependencies {
  secret: string | undefined;
  createAdmin: () => SupabaseClient;
  collect?: () => Promise<Notice[]>;
  smtp: SmtpConfig | null;
  appUrl: string;
  alerts?: (deps: AlertDeps) => Promise<AlertSummary>;
}
```
`createHandler` 시그니처: `export function createHandler({ secret, createAdmin, collect = fetchNotices, smtp, appUrl, alerts = runMediaAlerts }: Dependencies)`.

`const notices = await collect();` 바로 뒤, upsert 앞에 추가:
```ts
      // Only obituaries stored for the first time in this run are eligible for alerts.
      const obituaryIds = notices.filter((notice) => notice.category === "obituary").map((notice) => notice.source_id);
      let newObituaryIds: string[] = [];
      if (obituaryIds.length) {
        const existing = await admin.from("yonhap_notices").select("source_id").in("source_id", obituaryIds);
        if (existing.error) throw new Error("기존 인사·부고 조회 실패");
        const known = new Set((existing.data ?? []).map((row: { source_id: string }) => row.source_id));
        newObituaryIds = obituaryIds.filter((id) => !known.has(id));
      }
```
success 기록(`status: "success"` update) 뒤의 `return Response.json({ ok: true, count: notices.length, runId });`를 다음으로 교체:
```ts
      let alertSummary: AlertSummary | { error: "media-alerts-failed" };
      try {
        alertSummary = await alerts({ admin, runId, sourceIds: newObituaryIds, smtp, appUrl });
      } catch (error) {
        // Alerts are best-effort; the collection run above is already recorded as success.
        console.error("[media-alerts]", error instanceof Error ? error.message.slice(0, 200) : "알림 실패");
        alertSummary = { error: "media-alerts-failed" };
      }
      return Response.json({ ok: true, count: notices.length, runId, alerts: alertSummary });
```

- [ ] **Step 4: index.ts 수정**

```ts
import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";
import { smtpConfigFromEnv } from "./smtp.ts";

Deno.serve(createHandler({
  secret: Deno.env.get("YONHAP_SYNC_SECRET"),
  createAdmin: () => createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ),
  smtp: smtpConfigFromEnv((key) => Deno.env.get(key)),
  appUrl: Deno.env.get("MEDIA_APP_URL") ?? "https://inje-playground.vercel.app",
}));
```

- [ ] **Step 5: 전체 Deno 테스트·타입 검사**

Run (`supabase/functions/yonhap-notices/`): `deno task test && deno check index.ts`
Expected: feed·handler(기존 + 3)·smtp·alerts 모두 통과, 타입 오류 없음.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/yonhap-notices/handler.ts supabase/functions/yonhap-notices/index.ts supabase/functions/yonhap-notices/handler_test.ts
git commit -m "feat(media): 수집 직후 새 부고 매칭·알림 발송 연결

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 5: 프런트 타입·정규화·엑셀 파서·미리보기 집계

**Files:**
- Create: `frontend/src/types/media-directory.ts`
- Create: `frontend/src/lib/media-directory/normalize.ts`
- Create: `frontend/src/lib/media-directory/excel.ts`
- Create: `frontend/src/lib/media-directory/preview.ts`
- Test: `frontend/src/lib/__tests__/media-directory-excel.test.ts`

**Interfaces:**
- Produces:
```ts
// types/media-directory.ts
export interface MediaDepartment { id: string; outlet_id: string; name: string; active: boolean; updated_at: string }
export interface MediaOutlet { id: string; name: string; aliases: string[]; any_department: boolean; active: boolean; updated_at: string; departments: MediaDepartment[] }
export interface MediaDirectoryResponse { outlets: MediaOutlet[]; totals: { outlets: number; activeOutlets: number; departments: number } }
export interface ImportRow { outlet: string; department: string | null }
export interface ImportPreview { filename: string; rows: ImportRow[]; total: number; blank: number; duplicates: number; invalid: { row: number; reason: string }[]; newOutlets: string[]; newDepartments: number; existingPairs: number; anyDepartmentOutlets: string[] }
export interface ImportResult { outletsAdded: number; outletsExisting: number; departmentsAdded: number; departmentsExisting: number; anyDepartmentSet: number; skipped: number }
export interface MediaAlertSettings { email: string | null; emailVerified: boolean; enabled: boolean; updatedAt: string | null; latestDelivery: { status: "sent" | "failed"; created_at: string; match_count: number; error_message: string | null } | null }
export interface MediaDelivery { id: string; sync_run_id: number; recipient_email: string; match_count: number; status: "sent" | "failed"; error_message: string | null; created_at: string }
// normalize.ts
export function mediaNorm(value: string): string
// excel.ts
export interface ParsedMediaSheet { rows: Array<ImportRow & { row: number }>; total: number; blank: number; invalid: { row: number; reason: string }[] }
export async function parseMediaListXlsx(buffer: Buffer): Promise<ParsedMediaSheet>
// preview.ts
export function buildImportPreview(parsed: ParsedMediaSheet, existing: MediaOutlet[], filename: string): ImportPreview
```

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/media-directory-excel.test.ts`:

```ts
// @vitest-environment node
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { mediaNorm } from "@/lib/media-directory/normalize";
import { parseMediaListXlsx } from "@/lib/media-directory/excel";
import { buildImportPreview } from "@/lib/media-directory/preview";
import type { MediaOutlet } from "@/types/media-directory";

async function workbook(rows: Array<[unknown, unknown]>, header: [string, string] = ["매체", "부서"]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Sheet1");
  ws.addRow(header); for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const outlet = (name: string, departments: string[], extra: Partial<MediaOutlet> = {}): MediaOutlet => ({
  id: name, name, aliases: [], any_department: false, active: true, updated_at: "2026-09-15T00:00:00Z",
  departments: departments.map((d) => ({ id: `${name}-${d}`, outlet_id: name, name: d, active: true, updated_at: "2026-09-15T00:00:00Z" })), ...extra,
});

describe("mediaNorm mirrors public.media_norm", () => {
  it.each([["㈜헤럴드 경제", "헤럴드경제"], ["IT산업부 팩플팀", "it산업부팩플팀"], ["테크&사이언스부", "테크사이언스부"], ["(주)이데일리·M", "이데일리m"], ["뉴스1", "뉴스1"]])("%s → %s", (input, expected) => {
    expect(mediaNorm(input)).toBe(expected);
  });
});

describe("parseMediaListXlsx", () => {
  it("reads 매체/부서 columns, trims values and separates blank departments", async () => {
    const parsed = await parseMediaListXlsx(await workbook([["조선일보", "테크부"], [" 조선일보 ", "테크부 "], ["중앙일보", null], [null, null], [null, "부서만"], ["X", "y"]]));
    expect(parsed.total).toBe(5);
    expect(parsed.blank).toBe(1);
    expect(parsed.rows.map((r) => [r.outlet, r.department])).toEqual([["조선일보", "테크부"], ["조선일보", "테크부"], ["중앙일보", null]]);
    expect(parsed.invalid).toEqual([{ row: 6, reason: "매체 없음" }, { row: 7, reason: "매체명이 너무 짧습니다" }]);
  });
  it("requires the two headers and rejects formulas", async () => {
    await expect(parseMediaListXlsx(await workbook([["a", "b"]], ["언론사", "부서"]))).rejects.toThrow("매체");
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Sheet1"); ws.addRow(["매체", "부서"]); ws.addRow([{ formula: "1+1" }, "x"]);
    await expect(parseMediaListXlsx(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow("수식");
  });
});

describe("buildImportPreview", () => {
  it("dedupes pairs and compares against existing outlets, aliases and departments", async () => {
    const parsed = await parseMediaListXlsx(await workbook([["조선일보", "테크부"], ["조선일보", "테크부"], ["조선일보", "산업부"], ["헤럴드경제", null], ["㈜헤럴드경제", "IT부"], ["전자신문", "미래부"], ["전자신문", null]]));
    const preview = buildImportPreview(parsed, [outlet("조선일보", ["테크부"]), outlet("헤럴드경제", [], { aliases: ["㈜헤럴드경제"] })], "list.xlsx");
    expect(preview.filename).toBe("list.xlsx");
    expect(preview.total).toBe(7);
    expect(preview.duplicates).toBe(1);
    expect(preview.rows).toHaveLength(6);
    expect(preview.newOutlets).toEqual(["전자신문"]);
    expect(preview.newDepartments).toBe(3);
    expect(preview.existingPairs).toBe(1);
    expect(preview.anyDepartmentOutlets).toEqual(["헤럴드경제", "전자신문"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (`frontend/`): `npx vitest run src/lib/__tests__/media-directory-excel.test.ts`
Expected: 모듈 없음 오류.

- [ ] **Step 3: 구현**

`frontend/src/types/media-directory.ts`: 위 Interfaces 블록의 타입을 그대로 작성.

`frontend/src/lib/media-directory/normalize.ts`:
```ts
/** Mirrors SQL public.media_norm so previews agree with what the database will match. */
export function mediaNorm(value: string): string {
  return value.toLowerCase().replace(/㈜|㈔|\(주\)|\(사\)|주식회사|사단법인|\s/g, "").replace(/[·.,()[\]\/\\'"“”‘’&:;!?-]/g, "");
}
```

`frontend/src/lib/media-directory/excel.ts`:
```ts
import ExcelJS from "exceljs";
import { checkXlsxArchive } from "@/lib/marketing/excel";
import { mediaNorm } from "./normalize";
import type { ImportRow } from "@/types/media-directory";

export interface ParsedMediaSheet { rows: Array<ImportRow & { row: number }>; total: number; blank: number; invalid: { row: number; reason: string }[] }
export const MAX_IMPORT_ROWS = 2000;

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) throw new Error(`${cell.address}: 수식 셀은 값으로 붙여넣은 후 업로드해 주세요.`);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    throw new Error(`${cell.address}: 지원하지 않는 셀 형식입니다.`);
  }
  return String(v);
}

export async function parseMediaListXlsx(buffer: Buffer): Promise<ParsedMediaSheet> {
  checkXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("시트가 없습니다.");
  let outletCol = 0, deptCol = 0;
  sheet.getRow(1).eachCell((cell, col) => {
    const label = cellText(cell).replace(/\s/g, "");
    if (label === "매체" || label === "매체명") outletCol = col;
    if (label === "부서" || label === "부서명") deptCol = col;
  });
  if (!outletCol || !deptCol) throw new Error("첫 행에 '매체'와 '부서' 헤더가 필요합니다.");
  const rows: ParsedMediaSheet["rows"] = []; const invalid: ParsedMediaSheet["invalid"] = [];
  let total = 0, blank = 0;
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const outlet = cellText(row.getCell(outletCol)).trim();
    const department = cellText(row.getCell(deptCol)).trim();
    if (!outlet && !department) { blank++; return; }
    total++;
    if (total > MAX_IMPORT_ROWS) throw new Error(`최대 ${MAX_IMPORT_ROWS}행까지 업로드할 수 있습니다.`);
    if (!outlet) { invalid.push({ row: index, reason: "매체 없음" }); return; }
    if (outlet.length > 100 || department.length > 100) { invalid.push({ row: index, reason: "100자를 넘습니다" }); return; }
    if (mediaNorm(outlet).length < 2) { invalid.push({ row: index, reason: "매체명이 너무 짧습니다" }); return; }
    if (department && mediaNorm(department).length < 2) { invalid.push({ row: index, reason: "부서명이 너무 짧습니다" }); return; }
    rows.push({ row: index, outlet, department: department || null });
  });
  return { rows, total, blank, invalid };
}
```

`frontend/src/lib/media-directory/preview.ts`:
```ts
import { mediaNorm } from "./normalize";
import type { ImportPreview, MediaOutlet } from "@/types/media-directory";
import type { ParsedMediaSheet } from "./excel";

export function buildImportPreview(parsed: ParsedMediaSheet, existing: MediaOutlet[], filename: string): ImportPreview {
  const byNorm = new Map<string, MediaOutlet>();
  for (const o of existing) { byNorm.set(mediaNorm(o.name), o); for (const alias of o.aliases) byNorm.set(mediaNorm(alias), o); }
  const seen = new Set<string>(); const rows: ImportPreview["rows"] = [];
  const newOutlets = new Map<string, string>(); const anyDept = new Map<string, string>();
  let duplicates = 0, newDepartments = 0, existingPairs = 0;
  for (const r of parsed.rows) {
    const on = mediaNorm(r.outlet), dn = r.department ? mediaNorm(r.department) : "";
    const key = `${on}|${dn}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key); rows.push({ outlet: r.outlet, department: r.department });
    const found = byNorm.get(on);
    if (!found && !newOutlets.has(on)) newOutlets.set(on, r.outlet);
    if (!r.department) { if ((!found || !found.any_department) && !anyDept.has(on)) anyDept.set(on, found?.name ?? r.outlet); continue; }
    if (found?.departments.some((d) => mediaNorm(d.name) === dn)) existingPairs++; else newDepartments++;
  }
  return { filename, rows, total: parsed.total, blank: parsed.blank, duplicates, invalid: parsed.invalid, newOutlets: [...newOutlets.values()], newDepartments, existingPairs, anyDepartmentOutlets: [...anyDept.values()] };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/media-directory-excel.test.ts`
Expected: 5개 통과. (`newDepartments` 3 = 조선일보/산업부, 헤럴드경제/IT부, 전자신문/미래부. `existingPairs` 1 = 조선일보/테크부.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/media-directory.ts frontend/src/lib/media-directory frontend/src/lib/__tests__/media-directory-excel.test.ts
git commit -m "feat(media): 매체·부서 타입, 정규화, 엑셀 파서와 적재 미리보기

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 6: 경로 권한 매핑과 매체·부서 API

**Files:**
- Modify: `frontend/src/lib/page-access.ts` (`pagesForPath`의 `routes` 배열)
- Modify: `frontend/src/lib/__tests__/page-access.test.ts`
- Create: `frontend/src/lib/media-directory/server.ts`
- Create: `frontend/src/app/api/media-directory/route.ts`
- Create: `frontend/src/app/api/media-directory/outlets/route.ts`
- Create: `frontend/src/app/api/media-directory/departments/route.ts`
- Create: `frontend/src/app/api/media-directory/import/preview/route.ts`
- Create: `frontend/src/app/api/media-directory/import/route.ts`
- Create: `frontend/src/app/api/media-directory/deliveries/route.ts`
- Test: `frontend/src/lib/__tests__/media-directory-api.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC(`media_outlet_save`, `media_department_save`, `media_directory_import`), Task 5 `parseMediaListXlsx`, `buildImportPreview`, `mediaNorm`, 타입. 기존 `requireNewsUser()`→`{ok, supabase, user}|{ok:false,response}`, `requireAdmin()`→`{ok:true,userId}|{ok:false,response}`, `createServerSupabase()`.
- Produces:
  - `loadDirectory(supabase, q?)` → `MediaDirectoryResponse` (`server.ts`).
  - `rpcErrorResponse(error)` → `NextResponse` (코드 매핑: 42501→403, 22023→400, 23505→409, P0002→404, 그 외 500).
  - `GET /api/media-directory?q=` → `MediaDirectoryResponse`
  - `POST /api/media-directory/outlets` `{id?, name, aliases?: string[], anyDepartment?, active?}` → `{ outlet }`
  - `POST /api/media-directory/departments` `{id?, outletId, name, active?}` → `{ department }`
  - `POST /api/media-directory/import/preview` multipart `file` → `ImportPreview`
  - `POST /api/media-directory/import` `{ rows: ImportRow[] }` → `ImportResult`
  - `GET /api/media-directory/deliveries` → `{ deliveries: MediaDelivery[] }`(최근 50)

- [ ] **Step 1: 실패하는 테스트 작성**

`page-access.test.ts`의 `describe("page access catalog", …)` 안에 추가:
```ts
  it("maps the media directory page and API to the people_news permission", () => {
    expect(pagesForPath("/media-directory")).toEqual(["people_news"]);
    expect(pagesForPath("/api/media-directory/import/preview")).toEqual(["people_news"]);
    expect(canOpenPage("user", "/media-directory", { people_news: false })).toBe(false);
    expect(canOpenPage("user", "/media-directory")).toBe(true);
  });
```

`frontend/src/lib/__tests__/media-directory-api.test.ts`:
```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  user: { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" } as { id: string; email: string; email_confirmed_at: string | null } | null,
  role: "admin",
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>,
}));
function table(name: string) {
  const rows = mock.tables[name] ?? [];
  const query: Record<string, unknown> = { data: rows, error: null };
  for (const method of ["select", "order", "eq", "in", "limit"]) query[method] = () => query;
  query.single = async () => ({ data: name === "user_profiles" ? { role: mock.role } : rows[0], error: null });
  query.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  query.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return query;
}
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: mock.user } }) },
  from: (name: string) => table(name),
  rpc: mock.rpc,
}) }));
import { GET as list } from "@/app/api/media-directory/route";
import { POST as saveOutlet } from "@/app/api/media-directory/outlets/route";
import { POST as saveDepartment } from "@/app/api/media-directory/departments/route";
import { POST as applyImport } from "@/app/api/media-directory/import/route";
import { GET as deliveries } from "@/app/api/media-directory/deliveries/route";

const json = (url: string, body: unknown) => new NextRequest(`https://app.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  mock.user = { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" };
  mock.role = "admin";
  mock.rpc.mockReset().mockResolvedValue({ data: { id: "o1", name: "조선일보" }, error: null });
  mock.tables = {
    media_outlets: [{ id: "o1", name: "조선일보", aliases: [], any_department: false, active: true, updated_at: "2026-09-15T00:00:00Z" }, { id: "o2", name: "헤럴드경제", aliases: ["㈜헤럴드"], any_department: true, active: false, updated_at: "2026-09-15T00:00:00Z" }],
    media_departments: [{ id: "d1", outlet_id: "o1", name: "테크부", active: true, updated_at: "2026-09-15T00:00:00Z" }],
    media_alert_deliveries: [{ id: "x", sync_run_id: 1, recipient_email: "a@example.test", match_count: 2, status: "sent", error_message: null, created_at: "2026-09-15T00:00:00Z" }],
  };
});

describe("GET /api/media-directory", () => {
  it("nests departments under outlets and filters by normalized query", async () => {
    mock.role = "user";
    const all = await (await list(new NextRequest("https://app.test/api/media-directory"))).json();
    expect(all.totals).toEqual({ outlets: 2, activeOutlets: 1, departments: 1 });
    expect(all.outlets[0].departments).toEqual([expect.objectContaining({ name: "테크부" })]);
    const filtered = await (await list(new NextRequest("https://app.test/api/media-directory?q=%E3%88%9C%20%ED%97%A4%EB%9F%B4%EB%93%9C"))).json();
    expect(filtered.outlets.map((o: { name: string }) => o.name)).toEqual(["헤럴드경제"]);
    const byDept = await (await list(new NextRequest("https://app.test/api/media-directory?q=테크"))).json();
    expect(byDept.outlets.map((o: { name: string }) => o.name)).toEqual(["조선일보"]);
  });
  it("requires login and user role", async () => {
    mock.role = "guest";
    expect((await list(new NextRequest("https://app.test/api/media-directory"))).status).toBe(403);
    mock.user = null;
    expect((await list(new NextRequest("https://app.test/api/media-directory"))).status).toBe(401);
  });
});

describe("admin writes", () => {
  it("saves an outlet through the RPC with normalized inputs", async () => {
    const response = await saveOutlet(json("/api/media-directory/outlets", { id: null, name: " 조선일보 ", aliases: ["조선", "", "조선"], anyDepartment: true, active: true }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("media_outlet_save", { p_id: null, p_name: "조선일보", p_aliases: ["조선"], p_any_department: true, p_active: true });
  });
  it("saves a department and maps RPC errors to HTTP codes", async () => {
    await saveDepartment(json("/api/media-directory/departments", { outletId: "o1", name: "산업부" }));
    expect(mock.rpc).toHaveBeenCalledWith("media_department_save", { p_id: null, p_outlet_id: "o1", p_name: "산업부", p_active: true });
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "dup" } });
    expect((await saveDepartment(json("/api/media-directory/departments", { outletId: "o1", name: "산업부" }))).status).toBe(409);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "missing" } });
    expect((await saveDepartment(json("/api/media-directory/departments", { outletId: "zz", name: "산업부" }))).status).toBe(404);
  });
  it("applies an import only with valid rows", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { outletsAdded: 1, outletsExisting: 0, departmentsAdded: 1, departmentsExisting: 0, anyDepartmentSet: 0, skipped: 0 }, error: null });
    const ok = await applyImport(json("/api/media-directory/import", { rows: [{ outlet: "전자신문", department: "미래부" }, { outlet: "전자신문", department: null }] }));
    expect(ok.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("media_directory_import", { p_rows: [{ outlet: "전자신문", department: "미래부" }, { outlet: "전자신문", department: null }] });
    expect((await applyImport(json("/api/media-directory/import", { rows: "nope" }))).status).toBe(400);
    expect((await applyImport(json("/api/media-directory/import", { rows: [{ outlet: 1 }] }))).status).toBe(400);
  });
  it("rejects non-admins for every write and for delivery history", async () => {
    mock.role = "user";
    expect((await saveOutlet(json("/api/media-directory/outlets", { name: "조선일보" }))).status).toBe(403);
    expect((await saveDepartment(json("/api/media-directory/departments", { outletId: "o1", name: "산업부" }))).status).toBe(403);
    expect((await applyImport(json("/api/media-directory/import", { rows: [] }))).status).toBe(403);
    expect((await deliveries()).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("lists recent deliveries for admins", async () => {
    const body = await (await deliveries()).json();
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0]).toMatchObject({ recipient_email: "a@example.test", status: "sent" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (`frontend/`): `npx vitest run src/lib/__tests__/media-directory-api.test.ts src/lib/__tests__/page-access.test.ts`
Expected: 모듈 없음 / 매핑 단언 실패.

- [ ] **Step 3: page-access 매핑**

`frontend/src/lib/page-access.ts`의 `routes` 배열에서 `["/api/marketing", ["marketing"]],` 바로 뒤에 추가:
```ts
    ["/media-directory", ["people_news"]], ["/api/media-directory", ["people_news"]],
```

- [ ] **Step 4: 서버 헬퍼**

`frontend/src/lib/media-directory/server.ts`:
```ts
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaNorm } from "./normalize";
import type { MediaDepartment, MediaDirectoryResponse, MediaOutlet } from "@/types/media-directory";

/** Whole directory (well under the 1,000-row PostgREST cap: ~70 outlets / ~100 departments). */
export async function loadDirectory(supabase: SupabaseClient, q = ""): Promise<MediaDirectoryResponse> {
  const [outlets, departments] = await Promise.all([
    supabase.from("media_outlets").select("id,name,aliases,any_department,active,updated_at").order("name"),
    supabase.from("media_departments").select("id,outlet_id,name,active,updated_at").order("name"),
  ]);
  if (outlets.error || departments.error) throw new Error("매체·부서 목록을 불러오지 못했습니다.");
  const grouped = new Map<string, MediaDepartment[]>();
  for (const d of (departments.data ?? []) as MediaDepartment[]) grouped.set(d.outlet_id, [...(grouped.get(d.outlet_id) ?? []), d]);
  let list: MediaOutlet[] = ((outlets.data ?? []) as Omit<MediaOutlet, "departments">[]).map((o) => ({ ...o, departments: grouped.get(o.id) ?? [] }));
  const norm = mediaNorm(q.trim().slice(0, 100));
  if (norm) list = list.filter((o) => mediaNorm(o.name).includes(norm) || o.aliases.some((a) => mediaNorm(a).includes(norm)) || o.departments.some((d) => mediaNorm(d.name).includes(norm)));
  return { outlets: list, totals: { outlets: outlets.data?.length ?? 0, activeOutlets: (outlets.data ?? []).filter((o: { active: boolean }) => o.active).length, departments: departments.data?.length ?? 0 } };
}

const STATUS: Record<string, [number, string]> = {
  "42501": [403, "관리자 권한이 필요합니다."], "22023": [400, "입력값을 확인해 주세요."],
  "23505": [409, "이미 같은 이름이나 별칭이 등록되어 있습니다."], P0002: [404, "대상을 찾을 수 없습니다."],
};
export function rpcErrorResponse(error: { code?: string; message?: string } | null): NextResponse {
  const [status, message] = STATUS[error?.code ?? ""] ?? [500, "저장하지 못했습니다. 잠시 후 다시 시도해 주세요."];
  return NextResponse.json({ error: message }, { status });
}
export const noStore = { headers: { "Cache-Control": "private, no-store" } };
export const cleanName = (value: unknown, max = 100) => (typeof value === "string" ? value.trim().slice(0, max) : "");
```

- [ ] **Step 5: API 라우트**

`frontend/src/app/api/media-directory/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import { loadDirectory, noStore } from "@/lib/media-directory/server";

export async function GET(request: NextRequest) {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await loadDirectory(auth.supabase, request.nextUrl.searchParams.get("q") ?? ""), noStore);
  } catch (e) {
    console.error("[media-directory] 조회 실패", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "매체·부서 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}
```

`frontend/src/app/api/media-directory/outlets/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { cleanName, noStore, rpcErrorResponse } from "@/lib/media-directory/server";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  const name = cleanName(body.name);
  if (name.length < 2) return NextResponse.json({ error: "매체명은 2자 이상이어야 합니다." }, { status: 400 });
  const aliases = Array.isArray(body.aliases) ? [...new Set(body.aliases.map((a) => cleanName(a)).filter(Boolean))].slice(0, 20) : [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("media_outlet_save", {
    p_id: typeof body.id === "string" ? body.id : null, p_name: name, p_aliases: aliases,
    p_any_department: typeof body.anyDepartment === "boolean" ? body.anyDepartment : null, p_active: typeof body.active === "boolean" ? body.active : null,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ outlet: data }, noStore);
}
```

`frontend/src/app/api/media-directory/departments/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { cleanName, noStore, rpcErrorResponse } from "@/lib/media-directory/server";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  const name = cleanName(body.name);
  if (typeof body.outletId !== "string" || !body.outletId) return NextResponse.json({ error: "매체를 선택해 주세요." }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "부서명은 2자 이상이어야 합니다." }, { status: 400 });
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("media_department_save", {
    p_id: typeof body.id === "string" ? body.id : null, p_outlet_id: body.outletId, p_name: name, p_active: typeof body.active === "boolean" ? body.active : true,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ department: data }, noStore);
}
```

`frontend/src/app/api/media-directory/import/preview/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { parseMediaListXlsx } from "@/lib/media-directory/excel";
import { buildImportPreview } from "@/lib/media-directory/preview";
import { loadDirectory, noStore } from "@/lib/media-directory/server";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "XLSX 파일을 선택해 주세요." }, { status: 400 });
    if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "파일은 2MB 이하여야 합니다." }, { status: 413 });
    const parsed = await parseMediaListXlsx(Buffer.from(await file.arrayBuffer()));
    const directory = await loadDirectory(await createServerSupabase());
    return NextResponse.json(buildImportPreview(parsed, directory.outlets, file.name), noStore);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "파일을 읽지 못했습니다." }, { status: 400 });
  }
}
```

`frontend/src/app/api/media-directory/import/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { MAX_IMPORT_ROWS } from "@/lib/media-directory/excel";
import { cleanName, noStore, rpcErrorResponse } from "@/lib/media-directory/server";
import type { ImportRow } from "@/types/media-directory";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  let body: { rows?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  if (!Array.isArray(body.rows) || body.rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: "적재할 행이 올바르지 않습니다." }, { status: 400 });
  const rows: ImportRow[] = [];
  for (const raw of body.rows) {
    if (!raw || typeof raw !== "object" || typeof (raw as ImportRow).outlet !== "string") return NextResponse.json({ error: "행 형식이 올바르지 않습니다." }, { status: 400 });
    const department = (raw as ImportRow).department;
    if (department !== null && department !== undefined && typeof department !== "string") return NextResponse.json({ error: "행 형식이 올바르지 않습니다." }, { status: 400 });
    rows.push({ outlet: cleanName((raw as ImportRow).outlet), department: department ? cleanName(department) || null : null });
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("media_directory_import", { p_rows: rows });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data, noStore);
}
```

`frontend/src/app/api/media-directory/deliveries/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { noStore } from "@/lib/media-directory/server";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("media_alert_deliveries").select("id,sync_run_id,recipient_email,match_count,status,error_message,created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "발송 이력을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ deliveries: data ?? [] }, noStore);
}
```

- [ ] **Step 6: 테스트·타입 확인**

Run: `npx vitest run src/lib/__tests__/media-directory-api.test.ts src/lib/__tests__/page-access.test.ts && npx tsc --noEmit`
Expected: 통과. `requireAdmin`은 `createServerSupabase`를 mock으로 쓰므로 role 전환이 테스트에 반영된다.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/page-access.ts frontend/src/lib/__tests__/page-access.test.ts frontend/src/lib/media-directory/server.ts frontend/src/app/api/media-directory frontend/src/lib/__tests__/media-directory-api.test.ts
git commit -m "feat(media): 매체·부서 목록·편집·엑셀 적재·발송 이력 API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 7: 알림 구독 API와 부고 목록의 일치 정보

**Files:**
- Create: `frontend/src/app/api/people-news/media-alerts/route.ts`
- Modify: `frontend/src/app/api/people-news/route.ts`
- Modify: `frontend/src/types/people-news.ts`
- Test: `frontend/src/lib/__tests__/people-news-matches.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC `set_media_alert_subscription(p_enabled)`, 테이블 `media_alert_subscriptions`, `media_alert_deliveries`(own row), `media_obituary_matches(source_id, matched_text)`.
- Produces:
  - `GET /api/people-news/media-alerts` → `MediaAlertSettings`
  - `PUT /api/people-news/media-alerts` `{ enabled: boolean }` → `{ enabled, updatedAt }`
  - `PeopleNewsResponse.matches: Record<string, string[]>` (source_id → matched_text 목록, 부고만).

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/people-news-matches.test.ts`:
```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  user: { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" } as { id: string; email: string; email_confirmed_at: string | null } | null,
  role: "user", rpc: vi.fn(), matchesQueried: [] as string[],
}));
const notices = [
  { source_id: "AKR1", category: "obituary", title: "[부고] a", summary: "", source_url: "https://www.yna.co.kr/view/AKR1", published_at: "2026-09-15T00:00:00Z" },
  { source_id: "AKR2", category: "personnel", title: "[인사] b", summary: "", source_url: "https://www.yna.co.kr/view/AKR2", published_at: "2026-09-15T00:00:00Z" },
];
function table(name: string) {
  const q: Record<string, unknown> = {};
  const rows = name === "yonhap_notices" ? notices : name === "media_obituary_matches" ? [{ source_id: "AKR1", matched_text: "중앙일보 / 테크부" }, { source_id: "AKR1", matched_text: "중앙일보 / 산업부" }] : name === "media_alert_subscriptions" ? [{ enabled: true, updated_at: "2026-09-15T01:00:00Z" }] : [];
  for (const m of ["select", "order", "eq", "gte", "lt", "ilike", "limit"]) q[m] = () => q;
  q.in = (_col: string, ids: string[]) => { if (name === "media_obituary_matches") mock.matchesQueried = ids; return q; };
  q.range = async () => ({ data: rows, count: rows.length, error: null });
  q.single = async () => ({ data: { role: mock.role }, error: null });
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return q;
}
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: mock.user } }) }, from: table, rpc: mock.rpc }) }));
import { GET as listNotices } from "@/app/api/people-news/route";
import { GET as getAlerts, PUT as putAlerts } from "@/app/api/people-news/media-alerts/route";

beforeEach(() => { mock.user = { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" }; mock.role = "user"; mock.matchesQueried = []; mock.rpc.mockReset().mockResolvedValue({ data: { enabled: false, updated_at: "2026-09-15T02:00:00Z" }, error: null }); });

describe("people-news list matches", () => {
  it("attaches matched media labels to obituaries on the page only", async () => {
    const body = await (await listNotices(new NextRequest("https://app.test/api/people-news"))).json();
    expect(mock.matchesQueried).toEqual(["AKR1"]);
    expect(body.matches).toEqual({ AKR1: ["중앙일보 / 테크부", "중앙일보 / 산업부"] });
  });
});
describe("media alert subscription", () => {
  it("returns settings with the caller's email and latest delivery", async () => {
    const body = await (await getAlerts()).json();
    expect(body).toMatchObject({ email: "u@example.test", emailVerified: true, enabled: true, updatedAt: "2026-09-15T01:00:00Z", latestDelivery: null });
  });
  it("saves through the RPC and ignores other fields", async () => {
    const response = await putAlerts(new NextRequest("https://app.test/api/people-news/media-alerts", { method: "PUT", body: JSON.stringify({ enabled: false, userId: "other" }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("set_media_alert_subscription", { p_enabled: false });
  });
  it("blocks unverified enable, guests and malformed bodies", async () => {
    const put = (body: unknown) => putAlerts(new NextRequest("https://app.test/api/people-news/media-alerts", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
    mock.user!.email_confirmed_at = null;
    expect((await put({ enabled: true })).status).toBe(400);
    expect((await put({ enabled: "yes" })).status).toBe(400);
    mock.role = "guest";
    expect((await put({ enabled: true })).status).toBe(403);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }); mock.role = "user"; mock.user!.email_confirmed_at = "2026-09-01T00:00:00Z";
    expect((await put({ enabled: true })).status).toBe(403);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/people-news-matches.test.ts`
Expected: 모듈 없음 / `matches` undefined.

- [ ] **Step 3: 타입과 목록 API 수정**

`frontend/src/types/people-news.ts`의 `PeopleNewsResponse`에 추가:
```ts
  /** 부고 source_id → 일치한 매체·부서 라벨(예: "중앙일보 / 테크부"). 인사 기사는 없음. */
  matches: Record<string, string[]>;
```

`frontend/src/app/api/people-news/route.ts`의 `if (notices.error || …) { throw … }` 뒤, `return NextResponse.json({…})` 앞에 추가하고 응답에 `matches` 포함:
```ts
    const obituaryIds = (notices.data ?? []).filter((n) => n.category === "obituary").map((n) => n.source_id);
    const matches: Record<string, string[]> = {};
    if (obituaryIds.length) {
      const found = await supabase.from("media_obituary_matches").select("source_id,matched_text").in("source_id", obituaryIds).order("matched_text");
      if (found.error) throw new Error(found.error.message);
      for (const m of found.data ?? []) matches[m.source_id] = [...(matches[m.source_id] ?? []), m.matched_text];
    }
```
응답 객체: `{ notices: notices.data ?? [], total: …, page: …, pageSize: PAGE_SIZE, lastSyncedAt: …, latestSync: …, matches }`.

- [ ] **Step 4: 구독 API**

`frontend/src/app/api/people-news/media-alerts/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import type { MediaAlertSettings } from "@/types/media-directory";
const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const [subscription, delivery] = await Promise.all([
    supabase.from("media_alert_subscriptions").select("enabled,updated_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("media_alert_deliveries").select("status,created_at,match_count,error_message").eq("recipient_user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (subscription.error || delivery.error) return NextResponse.json({ error: "알림 설정을 불러오지 못했습니다." }, { status: 500 });
  const body: MediaAlertSettings = {
    email: user.email ?? null, emailVerified: !!user.email_confirmed_at,
    enabled: subscription.data?.enabled === true, updatedAt: subscription.data?.updated_at ?? null,
    latestDelivery: delivery.data ?? null,
  };
  return NextResponse.json(body, noStore);
}

export async function PUT(request: NextRequest) {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  let body: { enabled?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "알림 수신 여부를 확인해 주세요." }, { status: 400 });
  if (body.enabled && (!auth.user.email || !auth.user.email_confirmed_at)) return NextResponse.json({ error: "계정 이메일 인증 후 알림을 켤 수 있습니다." }, { status: 400 });
  const { data, error } = await auth.supabase.rpc("set_media_alert_subscription", { p_enabled: body.enabled });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "인사·부고 접근 권한이 필요합니다." : "알림 설정을 저장하지 못했습니다." }, { status: error.code === "42501" ? 403 : 500 });
  const saved = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ enabled: saved?.enabled === true, updatedAt: saved?.updated_at ?? null }, noStore);
}
```

- [ ] **Step 5: 테스트 확인**

Run: `npx vitest run src/lib/__tests__/people-news-matches.test.ts src/lib/__tests__/people-news-subscription.test.ts && npx tsc --noEmit`
Expected: 통과(기존 구독 테스트 회귀 없음).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/people-news frontend/src/types/people-news.ts frontend/src/lib/__tests__/people-news-matches.test.ts
git commit -m "feat(media): 부고 알림 구독 API와 목록의 매체·부서 일치 정보

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 8: `/media-directory` 관리 화면

**Files:**
- Create: `frontend/src/components/media-directory/MediaDirectory.tsx`
- Create: `frontend/src/components/media-directory/OutletEditor.tsx`
- Create: `frontend/src/components/media-directory/ImportDialog.tsx`
- Create: `frontend/src/components/media-directory/DeliveryHistory.tsx`
- Create: `frontend/src/app/media-directory/page.tsx`
- Test: `frontend/src/lib/__tests__/media-directory-ui.test.tsx`

**Interfaces:**
- Consumes: Task 6 API 6개, Task 5 타입, `useUserRole()`→`{ isAdmin, loading }`, shadcn `Button Card Input Label Badge Switch Dialog Alert`.
- Produces: 컴포넌트 `MediaDirectory()`(페이지 본문 전체), `OutletEditor({ outlet: MediaOutlet | null; onClose(); onSaved() })`, `ImportDialog({ open; onClose(); onImported() })`, `DeliveryHistory()`.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/media-directory-ui.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MediaDirectory from "@/components/media-directory/MediaDirectory";
import ImportDialog from "@/components/media-directory/ImportDialog";

const role = vi.hoisted(() => ({ isAdmin: false, loading: false }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ ...role, role: role.isAdmin ? "admin" : "user", permissions: {}, error: false, canAccessPage: () => true, invalidate: () => {} }) }));
const directory = { outlets: [
  { id: "o1", name: "조선일보", aliases: ["조선"], any_department: false, active: true, updated_at: "2026-09-15T00:00:00Z", departments: [{ id: "d1", outlet_id: "o1", name: "테크부", active: true, updated_at: "" }, { id: "d2", outlet_id: "o1", name: "구부서", active: false, updated_at: "" }] },
  { id: "o2", name: "헤럴드경제", aliases: [], any_department: true, active: true, updated_at: "2026-09-15T00:00:00Z", departments: [] },
], totals: { outlets: 2, activeOutlets: 2, departments: 2 } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/media-directory/deliveries")) return { ok: true, json: async () => ({ deliveries: [] }) };
    if (url.startsWith("/api/media-directory/import/preview")) return { ok: true, json: async () => ({ filename: "list.xlsx", rows: [{ outlet: "전자신문", department: "미래부" }], total: 3, blank: 0, duplicates: 2, invalid: [], newOutlets: ["전자신문"], newDepartments: 1, existingPairs: 0, anyDepartmentOutlets: [] }) };
    if (url === "/api/media-directory/import") return { ok: true, json: async () => ({ outletsAdded: 1, outletsExisting: 0, departmentsAdded: 1, departmentsExisting: 0, anyDepartmentSet: 0, skipped: 0 }) };
    if (url.startsWith("/api/media-directory") && !init) return { ok: true, json: async () => directory };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); role.isAdmin = false; });

it("lists outlets with departments, aliases and any-department badge; hides admin controls for users", async () => {
  render(<MediaDirectory />);
  const row = await screen.findByRole("row", { name: /조선일보/ });
  expect(within(row).getByText("테크부")).toBeInTheDocument();
  expect(within(row).getByText("구부서")).toHaveClass("line-through");
  expect(within(row).getByText("별칭: 조선")).toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /헤럴드경제/ })).getByText("부서 무관")).toBeInTheDocument();
  expect(screen.getByText("매체 2 · 부서 2")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "엑셀 업로드" })).toBeNull();
  expect(screen.queryByRole("button", { name: "매체 추가" })).toBeNull();
});

it("shows admin controls and opens the outlet editor with existing values", async () => {
  role.isAdmin = true;
  render(<MediaDirectory />);
  await screen.findByRole("row", { name: /조선일보/ });
  expect(screen.getByRole("button", { name: "엑셀 업로드" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("row", { name: /조선일보/ })).getByRole("button", { name: "수정" }));
  expect(await screen.findByDisplayValue("조선일보")).toBeInTheDocument();
  expect(screen.getByDisplayValue("조선")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("부서 추가"), { target: { value: "산업부" } });
  fireEvent.click(screen.getByRole("button", { name: "부서 저장" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media-directory/departments", expect.objectContaining({ method: "POST" })));
  expect(JSON.parse(String(fetchMock.mock.calls.find(([u]) => u === "/api/media-directory/departments")?.[1]?.body))).toEqual({ id: null, outletId: "o1", name: "산업부", active: true });
});

it("previews an upload and applies only the deduplicated rows", async () => {
  const done = vi.fn();
  render(<ImportDialog open onClose={() => {}} onImported={done} />);
  const input = screen.getByLabelText("미디어 리스트 xlsx") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "list.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "미리보기" }));
  await screen.findByText("신규 매체 1 · 신규 부서 1 · 이미 있음 0 · 중복 행 2");
  fireEvent.click(screen.getByRole("button", { name: "1행 적용" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls.find(([u]) => u === "/api/media-directory/import")?.[1]?.body))).toEqual({ rows: [{ outlet: "전자신문", department: "미래부" }] });
  expect(await screen.findByText(/매체 1개, 부서 1개를 추가했습니다/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인**

Run (`frontend/`): `npx vitest run src/lib/__tests__/media-directory-ui.test.tsx`
Expected: 모듈 없음 오류.

- [ ] **Step 3: 컴포넌트 구현**

`frontend/src/components/media-directory/MediaDirectory.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Newspaper, Plus, RefreshCw, Search, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserRole } from "@/hooks/useUserRole";
import type { MediaDirectoryResponse, MediaOutlet } from "@/types/media-directory";
import OutletEditor from "./OutletEditor";
import ImportDialog from "./ImportDialog";
import DeliveryHistory from "./DeliveryHistory";

export default function MediaDirectory() {
  const { isAdmin } = useUserRole();
  const [q, setQ] = useState("");
  const [data, setData] = useState<MediaDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MediaOutlet | null | "new">(null);
  const [importOpen, setImportOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const response = await fetch(`/api/media-directory?${new URLSearchParams({ q })}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "매체·부서 목록을 불러오지 못했습니다.");
        if (!controller.signal.aborted) setData(result as MediaDirectoryResponse);
      } catch (e) {
        if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "매체·부서 목록을 불러오지 못했습니다."); setData(null); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, revision]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Newspaper className="h-7 w-7 shrink-0 text-sky-600" />
          <div>
            <h1 className="text-2xl font-bold">관리 매체·부서</h1>
            <p className="text-sm text-muted-foreground">부고 알림 매칭에 쓰는 매체·부서 목록입니다. 매체와 등록 부서가 함께 나올 때만 알림을 보내며, ‘부서 무관’ 매체는 매체만으로 일치합니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm"><Link href="/people-news"><ArrowLeft className="h-4 w-4" />인사·부고</Link></Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={reload}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />새로고침</Button>
          {isAdmin && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />엑셀 업로드</Button>}
          {isAdmin && <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />매체 추가</Button>}
        </div>
      </div>
      <Card><CardContent className="flex flex-wrap items-end gap-3 pt-5">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="media-search">매체·부서·별칭 검색</Label>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="media-search" className="pl-9" value={q} maxLength={100} placeholder="예: 조선일보, 테크부" onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {data && <p className="text-sm text-muted-foreground" role="status">매체 {data.totals.outlets} · 부서 {data.totals.departments}{data.totals.activeOutlets !== data.totals.outlets && ` · 비활성 매체 ${data.totals.outlets - data.totals.activeOutlets}`}</p>}
      </CardContent></Card>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <section aria-label="매체·부서 목록" aria-busy={loading}>
        {loading && !data ? <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />목록을 불러오는 중입니다.</div> : data && data.outlets.length ? (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">매체</th><th className="px-4 py-2 font-medium">부서</th>{isAdmin && <th className="px-4 py-2" />}</tr></thead>
              <tbody className="divide-y">
                {data.outlets.map((outlet) => (
                  <tr key={outlet.id} className={outlet.active ? undefined : "text-muted-foreground"}>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{outlet.name}</span>{outlet.any_department && <Badge variant="secondary">부서 무관</Badge>}{!outlet.active && <Badge variant="outline">비활성</Badge>}</div>
                      {outlet.aliases.length > 0 && <div className="mt-1 text-xs text-muted-foreground">별칭: {outlet.aliases.join(", ")}</div>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {outlet.departments.length ? <div className="flex flex-wrap gap-1.5">{outlet.departments.map((d) => <Badge key={d.id} variant="outline" className={d.active ? undefined : "line-through opacity-60"}>{d.name}</Badge>)}</div> : <span className="text-xs text-muted-foreground">{outlet.any_department ? "매체명만으로 일치" : "등록된 부서 없음 → 알림 없음"}</span>}
                    </td>
                    {isAdmin && <td className="px-4 py-3 text-right align-top"><Button size="sm" variant="outline" onClick={() => setEditing(outlet)}>수정</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data ? <div className="rounded-xl border border-dashed px-5 py-16 text-center text-sm text-muted-foreground">{q ? "조건에 맞는 매체·부서가 없습니다." : "등록된 매체·부서가 없습니다. 관리자가 엑셀을 업로드하면 목록이 채워집니다."}</div> : null}
      </section>
      {isAdmin && <DeliveryHistory />}
      {editing !== null && <OutletEditor outlet={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {isAdmin && <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />}
    </div>
  );
}
```

`frontend/src/components/media-directory/OutletEditor.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MediaDepartment, MediaOutlet } from "@/types/media-directory";

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
  return result;
}

export default function OutletEditor({ outlet, onClose, onSaved }: { outlet: MediaOutlet | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(outlet?.name ?? "");
  const [aliases, setAliases] = useState(outlet?.aliases.join(", ") ?? "");
  const [anyDepartment, setAnyDepartment] = useState(outlet?.any_department ?? false);
  const [active, setActive] = useState(outlet?.active ?? true);
  const [departments, setDepartments] = useState<MediaDepartment[]>(outlet?.departments ?? []);
  const [newDepartment, setNewDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function saveOutlet() {
    setBusy(true); setMessage(null);
    try {
      await post("/api/media-directory/outlets", { id: outlet?.id ?? null, name: name.trim(), aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean), anyDepartment, active });
      onSaved();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "저장하지 못했습니다.", error: true }); }
    finally { setBusy(false); }
  }
  async function saveDepartment(department: Partial<MediaDepartment> & { name: string }) {
    if (!outlet) return;
    setBusy(true); setMessage(null);
    try {
      const { department: saved } = await post("/api/media-directory/departments", { id: department.id ?? null, outletId: outlet.id, name: department.name.trim(), active: department.active ?? true });
      setDepartments((list) => department.id ? list.map((d) => (d.id === saved.id ? saved : d)) : [...list, saved]);
      setNewDepartment(""); setMessage({ text: `부서 ‘${saved.name}’을 저장했습니다.`, error: false });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "저장하지 못했습니다.", error: true }); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>{outlet ? "매체 수정" : "매체 추가"}</DialogTitle>
        <DialogDescription>매체명·별칭은 부고 기사 제목·요약에서 찾는 문자열입니다. 2자 이상, 다른 매체와 겹칠 수 없습니다.</DialogDescription>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="outlet-name">매체명</Label><Input id="outlet-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="outlet-aliases">별칭 (쉼표로 구분)</Label><Input id="outlet-aliases" value={aliases} placeholder="예: 헤럴드, ㈜헤럴드" onChange={(e) => setAliases(e.target.value)} /></div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2"><Switch id="outlet-any" checked={anyDepartment} onCheckedChange={setAnyDepartment} /><Label htmlFor="outlet-any">부서 무관 (매체명만으로 일치)</Label></div>
            <div className="flex items-center gap-2"><Switch id="outlet-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="outlet-active">활성</Label></div>
          </div>
          <Button onClick={saveOutlet} disabled={busy || name.trim().length < 2}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{outlet ? "매체 저장" : "매체 등록"}</Button>
          {outlet && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">부서</p>
              <ul className="space-y-2">
                {departments.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Input aria-label={`부서명 ${d.name}`} defaultValue={d.name} maxLength={100} onBlur={(e) => { if (e.target.value.trim() !== d.name && e.target.value.trim().length >= 2) void saveDepartment({ ...d, name: e.target.value }); }} />
                    <Switch aria-label={`${d.name} 활성`} checked={d.active} disabled={busy} onCheckedChange={(checked) => void saveDepartment({ ...d, active: checked })} />
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2">
                <Label htmlFor="department-new" className="sr-only">부서 추가</Label>
                <Input id="department-new" placeholder="부서명 (예: 테크부)" value={newDepartment} maxLength={100} onChange={(e) => setNewDepartment(e.target.value)} />
                <Button variant="outline" disabled={busy || newDepartment.trim().length < 2} onClick={() => void saveDepartment({ name: newDepartment })}>부서 저장</Button>
              </div>
            </div>
          )}
          {message && <p role="status" className={`text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>{message.text}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`frontend/src/components/media-directory/ImportDialog.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportPreview, ImportResult } from "@/types/media-directory";

export default function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    if (!file) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/media-directory/import/preview", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "미리보기에 실패했습니다.");
      setPreview(body as ImportPreview);
    } catch (e) { setError(e instanceof Error ? e.message : "미리보기에 실패했습니다."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/media-directory/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: preview.rows }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "적재에 실패했습니다.");
      setResult(body as ImportResult); setPreview(null); setFile(null); onImported();
    } catch (e) { setError(e instanceof Error ? e.message : "적재에 실패했습니다."); }
    finally { setBusy(false); }
  }
  function reset() { setFile(null); setPreview(null); setResult(null); setError(null); onClose(); }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>미디어 리스트 엑셀 업로드</DialogTitle>
        <DialogDescription>첫 시트의 ‘매체’·‘부서’ 열을 읽습니다. 부서가 빈 행은 그 매체를 ‘부서 무관’으로 표시합니다. 기존 항목은 유지되고 새 항목만 추가되므로 같은 파일을 다시 올려도 안전합니다. 2MB·2,000행 이하.</DialogDescription>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="media-xlsx">미디어 리스트 xlsx</Label><Input id="media-xlsx" type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); }} /></div>
          <Button variant="outline" disabled={!file || busy} onClick={loadPreview}>{busy && !preview && <Loader2 className="h-4 w-4 animate-spin" />}미리보기</Button>
          {preview && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{preview.filename} · 데이터 {preview.total}행{preview.blank > 0 && ` · 빈 행 ${preview.blank}`}</p>
              <p>신규 매체 {preview.newOutlets.length} · 신규 부서 {preview.newDepartments} · 이미 있음 {preview.existingPairs} · 중복 행 {preview.duplicates}</p>
              {preview.newOutlets.length > 0 && <p className="text-xs text-muted-foreground">신규 매체: {preview.newOutlets.slice(0, 30).join(", ")}{preview.newOutlets.length > 30 && " …"}</p>}
              {preview.anyDepartmentOutlets.length > 0 && <p className="text-xs text-muted-foreground">부서 무관으로 표시: {preview.anyDepartmentOutlets.slice(0, 30).join(", ")}{preview.anyDepartmentOutlets.length > 30 && " …"}</p>}
              {preview.invalid.length > 0 && <p className="text-xs text-destructive">건너뛰는 행 {preview.invalid.length}건: {preview.invalid.slice(0, 5).map((i) => `${i.row}행 ${i.reason}`).join(", ")}{preview.invalid.length > 5 && " …"}</p>}
              <Button disabled={busy || preview.rows.length === 0} onClick={apply}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{preview.rows.length}행 적용</Button>
            </div>
          )}
          {result && <p role="status" className="text-sm text-muted-foreground">매체 {result.outletsAdded}개, 부서 {result.departmentsAdded}개를 추가했습니다. 이미 있던 매체 {result.outletsExisting}·부서 {result.departmentsExisting}, 부서 무관 표시 {result.anyDepartmentSet}, 건너뜀 {result.skipped}.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`frontend/src/components/media-directory/DeliveryHistory.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { MediaDelivery } from "@/types/media-directory";
const when = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export default function DeliveryHistory() {
  const [rows, setRows] = useState<MediaDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/media-directory/deliveries", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); return body.deliveries as MediaDelivery[]; })
      .then((list) => { if (!controller.signal.aborted) setRows(list); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "발송 이력을 불러오지 못했습니다."); });
    return () => controller.abort();
  }, []);
  return (
    <Card><CardContent className="space-y-2 pt-5">
      <h2 className="font-semibold">최근 알림 발송 이력</h2>
      <p className="text-xs text-muted-foreground">수집 run마다 새 매칭이 있을 때 구독자별 1건. 실패는 자동 재발송하지 않습니다.</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : !rows ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">아직 발송 이력이 없습니다.</p> : (
        <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 font-medium">시각</th><th className="py-1 font-medium">수신자</th><th className="py-1 font-medium">건수</th><th className="py-1 font-medium">결과</th></tr></thead>
          <tbody className="divide-y">{rows.map((d) => <tr key={d.id}><td className="py-1.5">{when.format(new Date(d.created_at))}</td><td className="py-1.5">{d.recipient_email}</td><td className="py-1.5">{d.match_count}</td><td className={`py-1.5 ${d.status === "failed" ? "text-destructive" : ""}`}>{d.status === "sent" ? "발송" : `실패${d.error_message ? ` · ${d.error_message}` : ""}`}</td></tr>)}</tbody></table>
      )}
    </CardContent></Card>
  );
}
```

`frontend/src/app/media-directory/page.tsx`:
```tsx
"use client";

import MediaDirectory from "@/components/media-directory/MediaDirectory";

export default function MediaDirectoryPage() {
  return <MediaDirectory />;
}
```

- [ ] **Step 4: 테스트·린트 확인**

Run: `npx vitest run src/lib/__tests__/media-directory-ui.test.tsx && npx eslint src/components/media-directory src/app/media-directory && npx tsc --noEmit`
Expected: 3개 통과, 린트·타입 오류 없음. 표 행 접근성 이름은 셀 텍스트로 계산되므로 `getByRole("row", { name: /조선일보/ })`가 동작한다.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/media-directory frontend/src/app/media-directory frontend/src/lib/__tests__/media-directory-ui.test.tsx
git commit -m "feat(media): /media-directory 매체·부서 관리 화면(엑셀 업로드·편집·발송 이력)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 9: `/people-news` 알림 카드·헤더 링크·일치 배지

**Files:**
- Create: `frontend/src/components/people-news/MediaAlertCard.tsx`
- Modify: `frontend/src/app/people-news/page.tsx`
- Test: `frontend/src/lib/__tests__/media-alert-card.test.tsx`

**Interfaces:**
- Consumes: Task 7 `GET/PUT /api/people-news/media-alerts`, `PeopleNewsResponse.matches`, Task 5 `MediaAlertSettings`.
- Produces: `MediaAlertCard()` 컴포넌트.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/media-alert-card.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MediaAlertCard from "@/components/people-news/MediaAlertCard";

afterEach(() => vi.unstubAllGlobals());
const settings = (over: Record<string, unknown> = {}) => ({ email: "me@innogrid.com", emailVerified: true, enabled: false, updatedAt: null, latestDelivery: null, ...over });

it("shows the login email, toggles through PUT and reports the saved state", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "PUT" ? { enabled: true, updatedAt: "2026-09-15T01:00:00Z" } : settings() }));
  vi.stubGlobal("fetch", fetchMock);
  render(<MediaAlertCard />);
  expect(await screen.findByText(/me@innogrid.com/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "관리 매체·부서 부고 알림 받기" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/people-news/media-alerts", expect.objectContaining({ method: "PUT" })));
  expect(JSON.parse(String(fetchMock.mock.calls.find(([, o]) => o?.method === "PUT")?.[1]?.body))).toEqual({ enabled: true });
  expect(await screen.findByText("알림을 켰습니다. 새 부고가 관리 매체·부서와 일치하면 메일을 보냅니다.")).toBeInTheDocument();
});

it("disables the switch for unverified email and shows the latest failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => settings({ emailVerified: false, enabled: false, latestDelivery: { status: "failed", created_at: "2026-09-15T00:00:00Z", match_count: 2, error_message: "SMTP auth 실패 (535)" } }) })));
  render(<MediaAlertCard />);
  expect(await screen.findByRole("switch", { name: "관리 매체·부서 부고 알림 받기" })).toBeDisabled();
  expect(screen.getByText(/계정 이메일 인증이 필요합니다/)).toBeInTheDocument();
  expect(screen.getByText(/최근 알림 발송 실패/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인**

Run (`frontend/`): `npx vitest run src/lib/__tests__/media-alert-card.test.tsx`
Expected: 모듈 없음.

- [ ] **Step 3: 카드 구현**

`frontend/src/components/people-news/MediaAlertCard.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MediaAlertSettings } from "@/types/media-directory";
const format = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });

export default function MediaAlertCard() {
  const [settings, setSettings] = useState<MediaAlertSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/people-news/media-alerts", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); return body as MediaAlertSettings; })
      .then((body) => { if (!controller.signal.aborted) setSettings(body); })
      .catch((e) => { if (!controller.signal.aborted) setMessage({ text: e instanceof Error ? e.message : "알림 설정을 불러오지 못했습니다.", error: true }); });
    return () => controller.abort();
  }, []);

  async function toggle(enabled: boolean) {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/people-news/media-alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "알림 설정을 저장하지 못했습니다.");
      setSettings((old) => old ? { ...old, enabled: body.enabled, updatedAt: body.updatedAt } : old);
      setMessage({ text: body.enabled ? "알림을 켰습니다. 새 부고가 관리 매체·부서와 일치하면 메일을 보냅니다." : "알림을 꺼 두었습니다.", error: false });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "알림 설정을 저장하지 못했습니다.", error: true }); }
    finally { setSaving(false); }
  }

  return (
    <Card><CardContent className="space-y-3 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4 text-sky-600" />관리 매체·부서 부고 알림</h2>
          <p className="mt-1 text-xs text-muted-foreground">새로 수집된 부고가 <Link href="/media-directory" className="underline">관리 매체·부서</Link>와 일치하면 {settings?.email ?? "계정 이메일"}로 메일을 보냅니다. Microsoft 연결이 필요 없습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="media-alert" checked={settings?.enabled ?? false} disabled={!settings || saving || (!settings.enabled && !settings.emailVerified)} onCheckedChange={(checked) => void toggle(checked)} />
          <Label htmlFor="media-alert">관리 매체·부서 부고 알림 받기</Label>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      </div>
      {settings && !settings.emailVerified && <p className="text-xs text-destructive">계정 이메일 인증이 필요합니다.</p>}
      {settings?.latestDelivery?.status === "sent" && <p className="text-xs text-muted-foreground">최근 알림: {format(settings.latestDelivery.created_at)} · {settings.latestDelivery.match_count}건</p>}
      {settings?.latestDelivery?.status === "failed" && <p className="text-xs text-destructive">최근 알림 발송 실패 ({format(settings.latestDelivery.created_at)}){settings.latestDelivery.error_message ? ` · ${settings.latestDelivery.error_message}` : ""}. 관리자에게 문의해 주세요.</p>}
      {message && <p role="status" className={`text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>{message.text}</p>}
      <p className="text-xs text-muted-foreground">매일 07:00 수집과 ‘지금 가져오기’ 직후, 새 매칭이 있을 때만 수집 1회당 1통을 보냅니다. 매체와 등록 부서가 함께 나올 때만 일치하며 ‘부서 무관’ 매체는 매체명만으로 일치합니다.</p>
    </CardContent></Card>
  );
}
```

- [ ] **Step 4: 페이지 수정**

`frontend/src/app/people-news/page.tsx`:
1. import 추가: `import Link from "next/link";`, `import MediaAlertCard from "@/components/people-news/MediaAlertCard";`, lucide에 `ListChecks` 추가.
2. 헤더 버튼 묶음(`<div className="flex gap-2">`) 첫 자식으로 추가:
```tsx
          <Button asChild variant="outline" size="sm"><Link href="/media-directory"><ListChecks className="h-4 w-4" />관리 매체·부서</Link></Button>
```
3. `<SubscriptionCard />` 바로 아래에 `<MediaAlertCard />` 추가.
4. 목록 항목의 배지 줄(`<div className="mb-2 flex flex-wrap items-center gap-2">`) 안, `<time …/>` 뒤에 추가:
```tsx
                      {data.matches?.[notice.source_id]?.map((label) => <Badge key={label} className="bg-sky-100 text-sky-800 hover:bg-sky-100">{label} 일치</Badge>)}
```

- [ ] **Step 5: 확인**

Run: `npx vitest run src/lib/__tests__/media-alert-card.test.tsx src/lib/__tests__/people-news-matches.test.ts && npx eslint src/app/people-news src/components/people-news && npx tsc --noEmit`
Expected: 통과. `data.matches`가 없는 옛 응답에도 `?.`로 안전.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/people-news/MediaAlertCard.tsx frontend/src/app/people-news/page.tsx frontend/src/lib/__tests__/media-alert-card.test.tsx
git commit -m "feat(media): 인사·부고 화면에 매체·부서 알림 카드와 일치 배지

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 10: 문서 — 런북, CLAUDE.md, yonhap-notices.md

**Files:**
- Create: `docs/media-directory.md`
- Modify: `CLAUDE.md`
- Modify: `docs/yonhap-notices.md`

- [ ] **Step 1: 런북 작성**

`docs/media-directory.md`:
```markdown
# 관리 매체·부서 및 부고 매칭 알림

2026-09-15 구현. 설계: `docs/superpowers/specs/2026-09-15-media-obituary-alerts-design.md`.

## 사용 방법

1. `/people-news` 상단 **관리 매체·부서**(또는 `/media-directory`)에서 매체·부서 목록을 확인한다. 조회는 인사·부고 접근 사용자 전체, 편집은 admin.
2. admin은 **엑셀 업로드**로 미디어 리스트(첫 시트, `매체`·`부서` 열)를 적재한다. 미리보기에서 신규/기존/중복 건수를 확인한 뒤 **N행 적용**. 기존 항목은 유지되고 새 항목만 추가되므로 재적재는 안전하다. 부서가 빈 행은 그 매체를 **부서 무관**으로 표시한다.
3. **매체 추가/수정**에서 매체명·별칭(쉼표)·부서 무관·활성, 부서 추가·이름 변경·활성 토글을 한다. 매체명·별칭은 2자 이상이고 다른 매체와 겹칠 수 없다.
4. 알림을 받으려면 `/people-news`의 **관리 매체·부서 부고 알림 받기**를 켠다. 수신 주소는 로그인 이메일이며 Microsoft 연결이 필요 없다.

## 매칭 규칙

- 대상: 수집(07:00 KST 자동, ‘지금 가져오기’) 시 **처음 저장된 부고**만.
- 텍스트 = 제목 + 요약을 `media_norm`(소문자·공백 제거·`㈜`·`(주)`·구두점 제거)으로 정규화.
- 매체명 또는 별칭이 포함되고, **그 매체에 등록된 활성 부서 중 하나도 포함될 때** 일치. 부서 무관 매체는 매체만으로 일치. 부서가 없고 부서 무관도 아닌 매체는 알림 대상이 아니다.
- 일치는 `media_obituary_matches`에 남고 `/people-news` 목록에 “매체 / 부서 일치” 배지로 표시된다.

## 발송

- Edge Function `yonhap-notices`가 수집 성공 기록 뒤 `media_match_notices` → 새 매칭이 있으면 `media_alert_recipients` 전원에게 SMTPS(`wblock.innogrid.com:465`, `AUTH LOGIN`) 1통을 보낸다. 제목 `[부고 알림] 관리 매체·부서 일치 N건 · M월 D일`.
- 수신자별 결과는 `media_alert_deliveries`(sent/failed). 실패는 자동 재발송하지 않는다. `/media-directory` 하단 “최근 알림 발송 이력”(admin)과 알림 카드의 “최근 알림”에서 확인한다.
- 알림 실패는 수집 결과에 영향을 주지 않는다. 응답 `alerts` 필드에 요약(`matches, recipients, sent, failed, skipped`)이 담긴다.
- Secrets(Edge Function): `MEDIA_SMTP_HOST`, `MEDIA_SMTP_PORT=465`, `MEDIA_SMTP_USER`(발신 주소), `MEDIA_SMTP_PASS`, 선택 `MEDIA_APP_URL`. 25·587은 Supabase 런타임에서 아웃바운드가 막혀 있어 465만 쓴다. 비밀번호 변경 시 `supabase secrets set --project-ref avooqcxehfeurjhqqgui --env-file <로컬 파일>` 후 함수를 재배포하지 않아도 다음 호출부터 반영된다.

## 배포·운영

- SQL: `supabase db query --linked --file docs/sql/2026-09-15-media-directory.sql`. 검증: `supabase db query --linked --file scripts/check-media-directory.sql`(전부 롤백).
- 함수: `supabase functions deploy yonhap-notices --project-ref avooqcxehfeurjhqqgui --use-api`. 테스트: `cd supabase/functions/yonhap-notices && deno task test`.
- 프런트: `cd frontend && npm test && npm run build`, 배포 `NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects`.
- 기존 부고에 배지를 채우려면(메일 없음) service role로 `select public.media_match_notices(array(select source_id from public.yonhap_notices where category='obituary'), null);`를 실행한다. 새 부고만 메일 대상이므로 과거 매칭은 발송되지 않는다.
- 문제 시: 알림만 멈추려면 `MEDIA_SMTP_PASS`를 unset(발송 생략, 매칭·배지는 유지). 수집 자체는 영향 없음.
```

- [ ] **Step 2: CLAUDE.md 갱신**

`### App Router Pages`의 `/marketing/email-checks` 줄 뒤에 추가:
```markdown
- `/media-directory` — 관리 매체·부서(조회는 `people_news` 접근자, 편집·엑셀 업로드·발송 이력은 admin): 부고 알림 매칭 기준 목록. 매체(별칭·**부서 무관**·활성)·부서. `/people-news`에는 "관리 매체·부서 부고 알림 받기" 카드(`MediaAlertCard`, 로그인 이메일로 수신, Microsoft 연결 불필요)와 부고 항목의 "매체 / 부서 일치" 배지. 런북 `docs/media-directory.md`
```
`### API Routes`의 `/api/marketing/…` 줄 뒤에 추가:
```markdown
- `GET /api/media-directory?q=`, `POST …/outlets`, `POST …/departments`, `POST …/import/preview`(xlsx 2MB), `POST …/import`({rows}), `GET …/deliveries`(admin) — 매체·부서 관리(`lib/media-directory/`: normalize=SQL `media_norm` 미러·excel·preview·server). `GET·PUT /api/people-news/media-alerts` — 부고 알림 구독. `GET /api/people-news`는 `matches`(부고 source_id → 일치 라벨) 포함
```
`### Supabase Tables (마케팅 Master DB)` 뒤에 새 절:
```markdown
### Supabase Tables (관리 매체·부서·부고 알림)
- `media_outlets`(name_norm 유니크·aliases·any_department·active), `media_departments`(outlet별 name_norm 유니크), `media_obituary_matches`(부고 × 매체 × 부서, `notified_at`), `media_alert_subscriptions`(사용자별 on/off), `media_alert_deliveries`(run × 수신자 sent|failed) — SQL `docs/sql/2026-09-15-media-directory.sql`. RPC `media_directory_import`·`media_outlet_save`·`media_department_save`(admin), `set_media_alert_subscription`(people_news), `media_match_notices`·`media_alert_recipients`(service_role). 매칭·발송은 Edge Function `yonhap-notices`의 `alerts.ts`·`smtp.ts`(SMTPS 465, AUTH LOGIN — Supabase 런타임은 25·587 아웃바운드 차단)
```
`### 연합뉴스 인사·부고 메일` 절 끝에 한 문장 추가:
```markdown
수집 직후 새 부고를 관리 매체·부서와 매칭해 알림 구독자에게 SMTP 릴레이로 묶음 메일을 보낸다(`docs/media-directory.md`).
```
`**Environment Variables**` 목록 끝에 추가:
```markdown
- `MEDIA_SMTP_HOST`, `MEDIA_SMTP_PORT`, `MEDIA_SMTP_USER`, `MEDIA_SMTP_PASS`, `MEDIA_APP_URL` — **Edge Function secrets**(Vercel 아님). 부고 알림 SMTPS 발송. 비어 있으면 매칭만 하고 발송을 건너뛴다
```

- [ ] **Step 3: yonhap-notices.md 갱신**

`## 운영` 절 목록 끝에 추가:
```markdown
- 수집 직후 새 부고를 관리 매체·부서와 매칭하고, 새 매칭이 있으면 알림 구독자에게 SMTP 릴레이(465)로 1통을 보낸다. 응답 `alerts`에 요약. 상세는 `docs/media-directory.md`.
```
`검증:` 문단의 `deno task test`는 그대로(`smtp_test.ts`·`alerts_test.ts` 포함됨).

- [ ] **Step 4: Commit**

```bash
git add docs/media-directory.md CLAUDE.md docs/yonhap-notices.md
git commit -m "docs(media): 관리 매체·부서·부고 알림 런북과 CLAUDE.md 갱신

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW"
```

---

### Task 11: 운영 반영·초기 적재·검증·PR

**Files:** 없음(운영 작업). 실패 시 각 단계의 되돌리기 방법을 함께 적었다.

- [ ] **Step 1: 전체 테스트·빌드**

Run:
```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint src && npm run build
cd ../supabase/functions/yonhap-notices && deno task test && deno check index.ts
```
Expected: 모두 통과. 실패하면 배포하지 않는다.

- [ ] **Step 2: 운영 SQL(Task 1에서 적용했으면 재적용 — 안전)과 검증**

Run (루트):
```bash
supabase db query --linked --file docs/sql/2026-09-15-media-directory.sql
supabase db query --linked --file scripts/check-media-directory.sql
```
Expected: 오류 없음, `media directory checks passed`.

- [ ] **Step 3: Edge Function 배포와 스모크**

Run:
```bash
supabase functions deploy yonhap-notices --project-ref avooqcxehfeurjhqqgui --use-api
supabase functions list --project-ref avooqcxehfeurjhqqgui
```
Expected: `yonhap-notices` VERSION이 3 이상으로 증가, ACTIVE. 되돌리기: 이전 커밋(`git checkout 7ed2680 -- supabase/functions/yonhap-notices` 후 같은 deploy 명령).

- [ ] **Step 4: 프런트 배포**

Run:
```bash
cd frontend && NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects
NODE_OPTIONS= vercel inspect https://inje-playground.vercel.app --scope seunguk-kangs-projects | grep -E 'id|status|created'
```
Expected: 새 배포 `innogrid-playground-…` READY, alias가 방금 배포를 가리킴(`created` 몇 분 이내). **반드시 `frontend/`에서 실행**(루트에서 실행하면 새 프로젝트가 생긴다).

- [ ] **Step 5: 엑셀 초기 적재 (운영자 Chrome 세션, claude-in-chrome)**

1. `https://inje-playground.vercel.app/media-directory` 열기 → admin 로그인 상태 확인 → **엑셀 업로드** → `/Users/seunguk.kang/Downloads/미디어리스트_260909(매체 및 부서).xlsx` 선택 → **미리보기**.
2. 기대 미리보기: 데이터 274행, 신규 매체 73, 부서 무관 표시 대상 ≤38개 매체, 중복 행 약 180, 건너뛰는 행 0.
3. **N행 적용** → 결과 “매체 73개, 부서 …개를 추가했습니다”. 목록 새로고침 후 `매체 73 · 부서 N` 확인.
4. DB 대조: `supabase db query --linked "select (select count(*) from public.media_outlets) outlets, (select count(*) from public.media_outlets where any_department) any_dept, (select count(*) from public.media_departments) departments" -o json`.

- [ ] **Step 6: 과거 부고 배지 채우기(메일 없음)와 화면 확인**

Run:
```bash
supabase db query --linked "select jsonb_array_length(public.media_match_notices(array(select source_id from public.yonhap_notices where category='obituary'), null)) as backfilled" -o json
```
Expected: 0 이상의 정수(현재 56건 부고 중 매체+부서가 함께 나온 건만). `/people-news` 부고 탭에서 해당 기사에 “매체 / 부서 일치” 배지 표시 확인. 이 매칭은 `notified_at` null이지만 새 부고만 메일 대상이므로 발송되지 않는다.

- [ ] **Step 7: 실제 알림 경로 확인**

1. `/people-news`에서 운영자 계정으로 **관리 매체·부서 부고 알림 받기** 켜기 → `media_alert_subscriptions` 1행 확인.
2. **지금 가져오기** 실행 → 응답의 `alerts`를 Edge Function 로그(Supabase Dashboard → Functions → yonhap-notices → Logs)에서 확인. 새 부고가 없으면 `skipped: no-new-notices`가 정상.
3. 발송까지 검증하려면(선택) 아직 수집되지 않은 미래 기사를 기다리거나, 관리 매체에 실제 최신 부고의 매체+부서를 임시로 등록한 뒤 다음 자동 수집(07:00)을 기다린다. 강제 테스트가 필요하면 `select public.media_match_notices(...)`로 매칭만 만들고 발송은 하지 않는다(발송은 수집 함수 경로만).
4. 다음 날 07:05 이후 `media_alert_deliveries`와 받은편지함 확인.

- [ ] **Step 8: PR·머지**

```bash
git push -u origin "abraxas73/마케팅-고객-마스터-디비-관리"
gh pr create --base main --title "feat(media): 관리 매체·부서 및 부고 매칭 알림 메일(SMTPS 465)" --body-file - <<'MD'
## 요약
- 매체·부서 관리(`/media-directory`, 엑셀 적재·편집·별칭·부서 무관), 부고 매칭 RPC, 알림 구독·발송 이력 테이블
- Edge Function `yonhap-notices`: 새 부고만 매칭 → 구독자에게 SMTPS(wblock.innogrid.com:465, AUTH LOGIN) 1통. 25·587은 Supabase 런타임 차단으로 불가(스파이크 검증)
- `/people-news` 알림 카드·일치 배지, 런북 `docs/media-directory.md`

## 검증
- Deno: feed·handler·smtp·alerts 테스트, Vitest 전체, tsc·eslint·build
- 운영 SQL 적용 + `scripts/check-media-directory.sql`(롤백) 통과, Edge Function 재배포, Vercel 배포, 엑셀 73매체 적재, 테스트 메일 1통 수신 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GgFcnh47NpFqUnxDDtY4AW
MD
gh pr merge --squash
```
Expected: 머지 후 `git fetch && git reset --hard origin/main`으로 워크트리 정렬.

---

## Self-Review

- **Spec coverage:** §4 데이터 모델→Task 1, §5 매칭→Task 1(`media_match_notices`)+검증 스크립트, §6 수집 함수 확장→Task 3·4, SMTP→Task 2, §7 메일 내용→Task 3 `buildAlertDigest`, §8 화면·API→Task 6·7·8·9, §9 초기 적재→Task 11 Step 5, §10 보안(로그·이메일 제거·RLS)→Task 1 정책·Task 2 `sanitize`·Task 3 오류 처리, §11 테스트→각 태스크, §12 배포→Task 11, §13 대안→런북 "문제 시". 스펙의 `MEDIA_ALERT_FROM`은 From을 `MEDIA_SMTP_USER`로 고정해 사용하지 않는다(런북에 반영).
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 단계에 실제 코드 포함.
- **Type consistency:** `AlertMatch`(id, sourceId, outlet, department, matchedText, title, summary, url, publishedAt)는 Task 1 `media_match_notices` jsonb 키와 Task 3 인터페이스가 일치. `AlertDeps`/`AlertSummary` 이름은 Task 3·4 동일. API 본문 키(`anyDepartment`, `outletId`, `rows`)는 Task 6 라우트·Task 8 컴포넌트·테스트에서 동일. `PeopleNewsResponse.matches`는 Task 7·9 동일. `ImportPreview.rows`는 중복 제거된 `ImportRow[]`로 Task 5·6·8 일관.
