-- 2026-09-07 매핑 행마다 사람이 적는 메모(비고)
-- 사용자 지시: 매핑 정보 외에 각 매핑에 메모를 입력하고, 엑셀 "비고" 열로 내보낸다.
-- rationale(판정 이유·엔진이 채움)과 구분한다 — note는 사람만 쓰고 자동 매핑이 덮어쓰지 않는다.
alter table public.rfp_requirement_mappings add column if not exists note text;

comment on column public.rfp_requirement_mappings.note is '사람이 적는 메모(엑셀 "비고" 열). 자동 매핑은 채우지 않는다';
