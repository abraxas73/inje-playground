-- 2026-09-07 솔루션 매핑을 요구사항의 "세부 항목" 단위로 + 판정 근거 문장 저장
-- 사용자 지시: 요구사항 ID 단위가 아니라 세부 내역(1단 리스트 항목, 2depth면 1단으로 묶음)마다 매핑하고 근거를 남긴다.
-- detail_key: "1","2"… (lib/rfp/mapping/detail-items.ts parseDetailUnits의 1단 항목 순번). null = 요구사항 전체 단위(기존 행).
-- detail_text: 그 항목 라벨 스냅샷(세부 내용을 나중에 고쳐도 보고서가 무엇에 대한 판정인지 알 수 있게).
-- evidence_text: 기능 설명에서 뽑은 뒷받침 문장(규칙 엔진). 화면 카드·xlsx "근거 문장" 열에 쓴다.
alter table public.rfp_requirement_mappings add column if not exists detail_key text;
alter table public.rfp_requirement_mappings add column if not exists detail_text text;
alter table public.rfp_requirement_mappings add column if not exists evidence_text text;

comment on column public.rfp_requirement_mappings.detail_key is '세부 항목 순번("1","2"…). null = 요구사항 전체 단위';
comment on column public.rfp_requirement_mappings.detail_text is '세부 항목 라벨 스냅샷';
comment on column public.rfp_requirement_mappings.evidence_text is '판정 근거 문장(기능 설명 발췌)';

-- 세부 항목별 조회·정렬용
create index if not exists rfp_requirement_mappings_detail_idx
  on public.rfp_requirement_mappings (requirement_id, detail_key, sort_order);
