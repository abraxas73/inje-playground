-- RFP 분석 4단계 — 규칙 기반 카탈로그 적재·매핑. 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 설계: docs/superpowers/specs/2026-09-06-rfp-analyzer-phase4-design.md

-- 기능 키워드(소문자 NFKC, 최대 20개)
alter table public.rfp_solution_features add column if not exists keywords text[] not null default '{}';

-- 소스 종류·xlsx 드라이브(kind='xlsx'면 page_id = driveItem id, drive_id = driveId)
alter table public.rfp_solution_sources add column if not exists kind text not null default 'confluence';
alter table public.rfp_solution_sources add column if not exists drive_id text;
alter table public.rfp_solution_sources drop constraint if exists rfp_solution_sources_kind_check;
alter table public.rfp_solution_sources add constraint rfp_solution_sources_kind_check check (kind in ('confluence','xlsx'));

-- 판정에 candidate(후보), 행의 출처 엔진과 규칙 점수
alter table public.rfp_requirement_mappings drop constraint if exists rfp_requirement_mappings_verdict_check;
alter table public.rfp_requirement_mappings add constraint rfp_requirement_mappings_verdict_check
  check (verdict in ('fulfilled','partial','candidate','build','na'));
alter table public.rfp_requirement_mappings add column if not exists engine text not null default 'manual';
alter table public.rfp_requirement_mappings add column if not exists score numeric;
-- 4단계 이전의 자동 행은 모두 Claude가 만든 것. 사람이 고친 행은 manual로 둔다.
update public.rfp_requirement_mappings set engine = 'llm' where edited = false and engine = 'manual';
alter table public.rfp_requirement_mappings drop constraint if exists rfp_requirement_mappings_engine_check;
alter table public.rfp_requirement_mappings add constraint rfp_requirement_mappings_engine_check check (engine in ('rules','llm','manual'));
