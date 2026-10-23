# 테스트 계정(이메일 로그인) 운영

애플 심사·공개 테스트용 **테스트 전용 이메일 계정**. 가입 기능은 없고 관리자가 만든다. 권한은 일반 사용자(user)와 같다.

## 구조

- 표시: `auth.users.raw_app_meta_data.test_account = true` (관리자 API `app_metadata: { test_account: true }`로만 붙는다 — 사용자가 고칠 수 없는 값).
- 거부 규칙(웹·앱 공통 계약): 세션의 `app_metadata.provider === 'email'`이고 `test_account !== true`이면 거부.
  - 웹 프록시(`lib/supabase-middleware.ts`): 페이지는 로그아웃 후 `/login?error=email_not_allowed`, API(쿠키·Bearer)는 403 `{ error, code: "email_login_not_allowed" }`.
  - `POST /api/mobile/login`, `POST /api/auth/password-login`도 같은 403.
  - 가입 시점: Auth Hook `public.hook_before_user_created`(`docs/sql/2026-10-23-test-accounts.sql`)가 이메일 자가 가입을 403으로 막는다.
- 규칙 코드는 `frontend/src/lib/auth/test-account.ts` 하나(테스트 `src/lib/__tests__/test-account.test.ts`).
- 역할은 기존 `handle_new_user` 트리거가 주는 `user` 그대로.

## 최초 적용(한 번)

1. SQL `docs/sql/2026-10-23-test-accounts.sql` 실행.
2. 훅 켜기 — 파일 머리 주석의 Management API `PATCH /v1/projects/{ref}/config/auth`
   `{"hook_before_user_created_enabled": true, "hook_before_user_created_uri": "pg-functions://postgres/public/hook_before_user_created"}`.
3. 실측: 공개 키로 `/auth/v1/signup` → 403, 관리자 화면에서 계정 생성 → 성공, 신규 Microsoft 로그인 영향 없음.
4. 롤백은 훅을 먼저 끄고(`hook_before_user_created_enabled: false`) 함수를 지운다.

## 애플 심사용 계정 만들기

1. `/admin/users` 아래 **테스트 계정** 카드 → 이메일(예: `appreview@innogrid.com` — 실제 받을 필요 없음), 이름(`Apple Review`), 비밀번호는 비우면 자동 생성(20자).
2. 노란 상자에 비밀번호가 **한 번만** 보인다 → 복사해 App Store Connect > 앱 심사 정보 > 로그인 정보에 붙여 넣는다. 다시 볼 수 없으니 잃어버리면 "비밀번호 재설정".
3. 심사 노트 예: "Sign in with the provided test account via 'Test account login' below the Microsoft button. The account has standard user permissions."
4. 앱·웹 모두 로그인 화면의 "테스트 계정으로 로그인"으로 들어온다.

## 심사가 끝나면

- **비활성화**(ban — 로그인 차단, 데이터 유지). 다음 심사 때 **재활성화** + 비밀번호 재설정.
- 더 쓰지 않으면 **삭제**(확인 단계 후, 관리자 사용자 삭제와 같은 정리 경로: 설정·내 팀·로그인 이력 → 프로필 → auth.users).

## 감사·보안

- 감사 카테고리 `users`: 테스트 계정 생성·비밀번호 재설정·비활성화·재활성화·삭제(대상 이메일·자동 생성 여부만, **비밀번호는 어디에도 기록하지 않음**). 로그인은 `auth`(provider `email`).
- 비밀번호 응답은 `Cache-Control: no-store`. 서버는 비밀번호를 저장·로그하지 않는다(Supabase Auth만 해시로 보관).
