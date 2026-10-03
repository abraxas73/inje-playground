# 모바일 앱(Flutter) 런북

## 구성
- `mobile/` Flutter 앱(Android·iOS). 운영 서버 `https://inje-playground.vercel.app`를 그대로 쓴다(`--dart-define=API_BASE=` 로 교체).
- 로그인: Supabase Microsoft OAuth → `innogrid://login-callback`(Supabase uri_allow_list에 등록, 2026-10-03). Azure 앱 등록은 변경 없음.
- 네이티브 화면은 `/api/*`를 Bearer로 호출. WebView는 `POST /api/mobile/web-token` → `/auth/mobile?next=…#token=…`으로 자기 세션을 만든다.

## 서버 쪽 확인
- `login_history`에 앱 로그인이 남는다(user_agent `InnogridApp/…`). Audit 로그 → 로그인 성공으로 집계.
- 감사 `모바일 웹 세션 발급`(category mobile) — 토큰은 기록하지 않는다.

## 문제 해결
| 증상 | 원인 | 조치 |
|---|---|---|
| 로그인 후 앱으로 안 돌아옴 | 딥링크 미등록 | Supabase 인증 설정 `uri_allow_list`에 `innogrid://login-callback`, Android intent-filter·iOS CFBundleURLTypes 확인 |
| 네이티브 화면 401 반복 | 토큰 만료·갱신 실패 | 앱이 로그인 화면으로 보낸다. 재로그인 |
| WebView가 로그인 페이지로 튕김 | 웹 토큰 발급 실패(guest·서비스 키) | `/api/mobile/web-token` 응답 확인. guest는 WebView를 열 수 없다 |

## 개발기 설치
(Task 14에서 채움)
