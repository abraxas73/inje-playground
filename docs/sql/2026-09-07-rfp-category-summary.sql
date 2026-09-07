-- 2026-09-07 요구사항 총괄표 저장 — 구분 탭 분류명·검색용
-- 추출(runExtraction) 때 extract-standard.readSummaryTable 결과(CategorySummaryRow[]: name, nameEn, rule, count)를 jsonb로 저장한다.
-- 기존 프로젝트는 재추출 없이 로컬 백필 스크립트(파서 재실행)로 채웠다(2026-09-07 K-에듀파인·생성형 AI 2건).
alter table public.rfp_projects add column if not exists category_summary jsonb;
comment on column public.rfp_projects.category_summary is '요구사항 총괄표 행 [{name, nameEn, rule, count}] — lib/rfp/category-summary.ts';
