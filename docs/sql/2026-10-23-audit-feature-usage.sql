-- 2026-10-23: 어드민 Audit 로그의 "기능별 사용" 요약(GET /api/admin/audit/usage)
-- PostgREST select는 1000행에서 잘리므로(Supabase 기본 상한) 집계는 DB에서 한 번에 jsonb 하나로 돌려준다.
-- ① categories: action_history 카테고리별 건수·고유 사용자 수
-- ② pages: 페이지 열람(category 'page', detail.path)의 경로별 건수와 고유 사용자 id 배열 — 경로→페이지 키 묶음은 서버가 lib/page-access.ts로 하고(카탈로그를 SQL에 두 벌 두지 않으려고),
--    사용자 id는 서버에서 고유 수만 세고 화면에는 내보내지 않는다
-- ③ platforms: login_history User-Agent `InnogridApp/<ver> (<platform>…)`로 iOS·Android·macOS·Windows, 그 밖은 '웹' — 플랫폼별 고유 사용자 수 + 전체 고유 사용자 수
-- service_role(관리자 API)만 실행한다. 감사 이력 보존이 100일이라 그보다 긴 기간은 의미가 없다.
begin;
create or replace function public.audit_feature_usage(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('category', c.category, 'count', c.n, 'users', c.u) order by c.n desc)
      from (select coalesce(a.category, '') as category, count(*) as n, count(distinct a.user_id) as u from public.action_history a
            where a.created_at >= p_from and a.created_at <= p_to group by 1) c), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('path', v.path, 'count', v.n, 'userIds', v.ids))
      from (select a.detail->>'path' as path, count(*) as n, coalesce(array_agg(distinct a.user_id) filter (where a.user_id is not null), '{}') as ids from public.action_history a
            where a.category = 'page' and a.created_at >= p_from and a.created_at <= p_to and a.detail ? 'path' group by 1) v), '[]'::jsonb),
    'platforms', coalesce((select jsonb_agg(jsonb_build_object('platform', x.platform, 'users', x.u))
      from (select case lower(substring(l.user_agent from 'InnogridApp/[^\s;()]+\s*\(\s*([A-Za-z]+)'))
                     when 'ios' then 'iOS' when 'android' then 'Android' when 'macos' then 'macOS' when 'windows' then 'Windows' else '웹' end as platform,
                   count(distinct l.user_id) as u
            from public.login_history l where l.logged_in_at >= p_from and l.logged_in_at <= p_to group by 1) x), '[]'::jsonb),
    'loginUsers', (select count(distinct l.user_id) from public.login_history l where l.logged_in_at >= p_from and l.logged_in_at <= p_to)
  );
$$;
comment on function public.audit_feature_usage(timestamptz, timestamptz) is '어드민 Audit "기능별 사용" 집계(카테고리·페이지 열람·앱 플랫폼별 로그인 사용자). service_role 전용';
revoke all on function public.audit_feature_usage(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.audit_feature_usage(timestamptz, timestamptz) to service_role;
commit;
