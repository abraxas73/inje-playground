-- 2026-09-07 Audit 로그: 로그인 이력 + 액션 이력을 한 화면에서 조회
-- 사용자 지시: 로그인 히스토리/Action 히스토리 모두 남기고, 어드민에서 검색 가능한 Audit 로그 조회를 넣는다.
--
-- 1) action_history에 감사에 필요한 맥락(IP·UA)과 출처(source) 추가
--    source: 'app' = 화면·서버 라우트가 의미 있는 액션으로 남긴 행, 'api' = proxy가 자동으로 남긴 변경 요청
alter table public.action_history add column if not exists ip_address text;
alter table public.action_history add column if not exists user_agent text;
alter table public.action_history add column if not exists source text not null default 'app';

comment on column public.action_history.ip_address is '요청 IP(x-forwarded-for 첫 값)';
comment on column public.action_history.user_agent is '요청 User-Agent';
comment on column public.action_history.source is 'app = 의미 있는 액션 기록, api = proxy 자동 기록(변경 요청)';

-- 2) 조회 인덱스(최근순 + 사용자·카테고리 필터)
create index if not exists action_history_created_at_idx on public.action_history (created_at desc);
create index if not exists action_history_user_email_idx on public.action_history (user_email);
create index if not exists action_history_category_idx on public.action_history (category);
create index if not exists login_history_logged_in_at_idx on public.login_history (logged_in_at desc);

-- 3) 두 이력을 합친 조회용 뷰. 열 이름을 통일해 어드민 API가 한 쿼리로 필터·검색·페이징한다.
--    login_history는 시각 열이 logged_in_at, action_history는 created_at이라 뷰에서 at으로 맞춘다.
--    (열 구성이 바뀔 수 있으므로 create or replace가 아니라 drop 후 생성 — 뷰라 데이터 손실은 없다)
drop view if exists public.audit_log;
create view public.audit_log
with (security_invoker = true) as
select
  'login'::text as kind,
  l.id as id,
  l.logged_in_at as at,
  l.user_id as user_id,
  p.email as user_email,
  p.display_name as user_name,
  'auth'::text as category,
  '로그인'::text as action,
  '{}'::jsonb as detail,
  ''::text as detail_text,
  l.ip_address as ip_address,
  l.user_agent as user_agent
from public.login_history l
left join public.user_profiles p on p.user_id = l.user_id
union all
select
  case when a.source = 'api' then 'api' else 'action' end,
  a.id,
  a.created_at,
  a.user_id,
  coalesce(a.user_email, p.email),
  p.display_name,
  a.category,
  a.action,
  coalesce(a.detail, '{}'::jsonb),
  coalesce(a.detail::text, ''),
  a.ip_address,
  a.user_agent
from public.action_history a
left join public.user_profiles p on p.user_id = a.user_id;

comment on view public.audit_log is '로그인 이력 + 액션 이력 통합 조회(어드민 Audit 로그). kind: login|action|api, detail_text = detail을 검색용 문자열로';

-- 감사 로그는 관리자 화면(service_role)만 읽는다 — 클라이언트 키로는 접근 불가
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to service_role;
