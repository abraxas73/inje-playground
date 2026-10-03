---
paths:
  - "mobile/**"
  - "frontend/src/app/api/mobile/**"
  - "frontend/src/app/auth/mobile/**"
  - "frontend/src/lib/mobile/**"
  - "frontend/src/lib/__tests__/mobile-*"
  - "docs/mobile-app.md"
---

# 모바일 앱(Flutter)

- 스펙 `docs/superpowers/specs/2026-10-03-mobile-app-design.md`, 계획 `docs/superpowers/plans/2026-10-03-mobile-app.md`, 런북 `docs/mobile-app.md`.
- 코드는 저장소 루트 `mobile/`(frontend와 같은 레벨). Flutter 3.44 stable, Android 8+/iOS 15+, 번들 ID `com.innogrid.playground`, 딥링크 `innogrid://login-callback`. 의존성은 pubspec의 9개뿐 — 추가는 스펙 변경으로.
- 하이브리드: 로그인·탭·뭐 먹지·사다리·커피 타임은 네이티브, 나머지는 WebView(`lib/web/`). 네이티브 API 호출은 `lib/api/client.dart`만 통해서(Bearer, 401 갱신 재시도 1회).
- 서버: `/api/*`는 `Authorization: Bearer`도 받는다(`createServerSupabase`·미들웨어 분기). `POST /api/mobile/login`(로그인 기록·역할·권한), `POST /api/mobile/web-token`(WebView용 일회용 magiclink 토큰), `/auth/mobile`(토큰 → 쿠키 세션 → next). WebView는 앱 세션을 복사하지 않는다(리프레시 회전 충돌).
- 토큰·세션 값은 로그·감사 detail·문서에 남기지 않는다. 감사 카테고리 `mobile`.
- 디자인: 토큰은 `lib/app/theme.dart`의 `Brand`, 공용 위젯은 `lib/app/brand.dart`(BrandHeader·BrandLogo·SquareIconButton·InitialBadge·PrimaryCta·GridBackdrop) — 새 화면은 이걸 쓰고 색을 직접 박지 않는다. 로고는 `assets/brand/*.png`(원본 frontend/public/logo.svg, 재생성 방법은 런북 §디자인). 시안: Claude Design 캔버스 "이노그리드 앱 디자인". AnimationController 등 Ticker는 `late final` 지연 생성 금지(initState에서 생성).
