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
- 페이지 `/admin/ppt`(관리자: 모든 사용자 덱 조회·검색·소유자/상태 필터·삭제, API `GET /api/admin/ppt/decks` — selectAll로 1000행 상한 없이), `/ppt`(내 덱·새로 만들기), `/ppt/[id]`(버전·구성 보기·다운로드·피드백·공유·Teams·SharePoint), `/ppt/s/[token]`(로그인 필요 공유 뷰).
- API `/api/ppt/uploads`, `/api/ppt/decks[...]`, `/api/ppt/shared/[token]`. 생성·재생성은 `after()`에서 `lib/ppt/generate.ts`의 `runGeneration`이 돈다(`maxDuration 800`).
- 테이블 `ppt_decks`, `ppt_deck_versions`(삭제 없음), `ppt_templates`(업로드 템플릿, 비활성화만·삭제 없음), 버킷 `ppt`. SQL `docs/sql/2026-09-30-ppt-maker.sql`, `2026-10-01-ppt-templates.sql`. 관리자 API `/api/admin/ppt/templates`.
- 생성 엔진은 **별도 Vercel 프로젝트** `ppt-service/`(FastAPI + 디자인센터 패키지 `innogrid_ppt`). 패키지 원본·템플릿·`check.py`·`sample.deck.yaml`은 수정 금지. 호출은 `lib/ppt/service.ts`만 통해서(`PPT_SERVICE_URL`, `PPT_SERVICE_TOKEN`).
- LLM 입출력은 deck **JSON**. 프롬프트는 `lib/ppt/prompt.ts`(규칙·카탈로그 시스템 블록은 prompt caching). 규칙 기본본은 `lib/ppt/rules-default.ts`, 운영은 settings `ppt_llm_rules`가 있으면 그것(관리자 > 시스템 설정). 템플릿은 내장(`ppt-service/template/`) 또는 업로드(`ppt_templates`, `/build`에 `templateUrl`·`templateId`; `/template/validate`가 샘플 덱 빌드로 검증) — 같은 106장 구성만. 카탈로그에는 장표별 슬롯 용량(`capacity`, 패키지 `capacity.py` 실측)이 실려 LLM이 상자 크기를 알고 쓴다. 표 장표는 `table`(표 자리 높이·행 예산). 빌드 오류는 오류난 장표만 수정 요청(최대 4회, 그 장표의 용량표를 붙이고 같은 장표가 다시 넘치면 행 수 축소·장표 교체·`{"slides":[…]}` 장 분리로 지시를 올림), 실패해도 마지막 덱은 `deck_json`에 남긴다. 재생성은 `{"keep": true}` 패치.
- URL 원고: `lib/ppt/web-source.ts`(가드·본문 추출·이미지 추출·이미지 다운로드). 이미지는 `source_images`→버킷 `images/`→`/build imageUrls`→deck JSON `images:["url:N"]`; free-title에 images만 있으면 서비스 `_place_free_images`가 1~3장을 그린다.
- 공유 토큰·서명 URL은 로그·감사 detail에 넣지 않는다. 감사 카테고리 `ppt`.
