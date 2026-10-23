-- 2026-10-23 테스트 전용 이메일 로그인 — 이메일 자가 가입 차단 Auth Hook (런북 docs/test-accounts.md)
--
-- 배경: Supabase 이메일 공급자가 켜져 있고 자가 가입도 열려 있어, 누구나 공개(anon) 키로 /auth/v1/signup을 부르면
-- handle_new_user 트리거가 role 'user'를 준다. 테스트 계정(애플 심사용)은 관리자가 service role로만 만든다
-- (app_metadata.test_account = true). 이 훅은 가입 시점에, 웹 프록시·API(lib/auth/test-account.ts)는 로그인 세션에서
-- 같은 규칙을 이중으로 건다. handle_new_user는 바꾸지 않는다(테스트 계정도 role 'user').
--
-- 규칙: event.user.app_metadata.provider = 'email' 이고 app_metadata.test_account 가 JSON true 가 아니면 403 거부.
--       그 외(azure OAuth 신규 직원 등)는 '{}' = 허용.
--
-- 페이로드(Supabase 문서 "Before User Created Hook", 2026-10 확인):
--   { "metadata": { "uuid", "time", "name": "before-user-created", "ip_address" },
--     "user": { "id", "aud", "role", "email", "phone",
--               "app_metadata": { "provider": "email", "providers": ["email"], ...관리자 API로 준 키 },
--               "user_metadata", "identities": [], "created_at", "updated_at", "is_anonymous" } }
--   응답: 허용 '{}' / 거부 {"error":{"http_code":4xx,"message":"..."}} (message는 가입 요청 클라이언트에 그대로 간다)
--   문서에 관리자 API(auth.admin.createUser)도 훅을 거치는지 명시가 없다 — 거쳐도 test_account=true라 통과한다.
--
-- ── 적용(운영자가 직접) ─────────────────────────────────────────────────────────────
-- 1) 이 파일을 SQL 편집기(또는 Management API `POST /v1/projects/{ref}/database/query`)로 실행.
-- 2) 훅 켜기 — Management API(대시보드: Authentication > Hooks > Before User Created > Postgres 함수 선택도 같음):
--      curl -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
--        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--        -d '{"hook_before_user_created_enabled": true,
--             "hook_before_user_created_uri": "pg-functions://postgres/public/hook_before_user_created"}'
-- 3) 실측:
--    a. 자가 가입이 막히는지(공개 키):
--       curl -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
--         -d '{"email":"selfsignup-check@example.com","password":"Xx-123456789012"}'
--       → 403 + "테스트 계정이 아닌 이메일 가입은 허용되지 않습니다." (auth.users에 행이 생기지 않아야 함)
--    b. /admin/users "테스트 계정"에서 계정 생성 → 성공(201)
--    c. 신규 Microsoft 로그인은 영향 없음(provider azure)
--
-- ── 롤백 ──────────────────────────────────────────────────────────────────────────
--   curl -X PATCH ".../v1/projects/$REF/config/auth" ... -d '{"hook_before_user_created_enabled": false}'
--   그다음(선택) drop function if exists public.hook_before_user_created(jsonb);
--   ※ 훅을 켠 채 함수를 먼저 지우면 모든 가입(신규 직원 Microsoft 로그인 포함)이 실패한다 — 반드시 훅을 먼저 끈다.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  app_meta jsonb := coalesce(event->'user'->'app_metadata', '{}'::jsonb);
begin
  if app_meta->>'provider' = 'email'
     and coalesce(app_meta->'test_account', 'null'::jsonb) <> 'true'::jsonb then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '테스트 계정이 아닌 이메일 가입은 허용되지 않습니다.'
      )
    );
  end if;
  return '{}'::jsonb;
end;
$$;

comment on function public.hook_before_user_created(jsonb) is
  'Auth Hook before-user-created: 이메일 공급자 가입은 app_metadata.test_account=true(관리자 생성)만 허용. docs/test-accounts.md';

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- 확인용(읽기 전용): 훅 적용 전에 이미 자가 가입된 이메일 계정이 있는지 — 있으면 검토 후 /admin/users에서 삭제
-- select id, email, created_at from auth.users
--  where raw_app_meta_data->>'provider' = 'email' and coalesce(raw_app_meta_data->'test_account', 'null') <> 'true';
