---
paths:
  - "frontend/src/app/ppt/**"
  - "frontend/src/app/api/ppt/**"
  - "frontend/src/lib/ppt/**"
  - "frontend/src/lib/__tests__/ppt-*"
  - "frontend/src/components/ppt/**"
  - "frontend/src/types/ppt.ts"
  - "ppt-service/**"
  - "docs/ppt-maker.md"
---

# PPT 만들기

- 스펙 `docs/superpowers/specs/2026-09-30-ppt-maker-design.md`, 런북 `docs/ppt-maker.md`.
- 페이지 `/ppt`(내 덱·새로 만들기), `/ppt/[id]`(버전·구성 보기·다운로드·피드백·공유·Teams·SharePoint), `/ppt/s/[token]`(로그인 필요 공유 뷰).
- API `/api/ppt/uploads`, `/api/ppt/decks[...]`, `/api/ppt/shared/[token]`. 생성·재생성은 `after()`에서 `lib/ppt/generate.ts`의 `runGeneration`이 돈다(`maxDuration 300`).
- 테이블 `ppt_decks`, `ppt_deck_versions`(삭제 없음), 버킷 `ppt`. SQL `docs/sql/2026-09-30-ppt-maker.sql`.
- 생성 엔진은 **별도 Vercel 프로젝트** `ppt-service/`(FastAPI + 디자인센터 패키지 `innogrid_ppt`). 패키지 원본·템플릿·`check.py`·`sample.deck.yaml`은 수정 금지. 호출은 `lib/ppt/service.ts`만 통해서(`PPT_SERVICE_URL`, `PPT_SERVICE_TOKEN`).
- LLM 입출력은 deck **JSON**. 프롬프트는 `lib/ppt/prompt.ts`(규칙·카탈로그 시스템 블록은 prompt caching). 빌드 오류는 오류난 장표만 수정 요청(최대 2회), 재생성은 `{"keep": true}` 패치.
- 공유 토큰·서명 URL은 로그·감사 detail에 넣지 않는다. 감사 카테고리 `ppt`.
