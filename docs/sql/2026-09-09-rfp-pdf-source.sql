-- 2026-09-09 PDF 제안요청서를 RFP 원본으로 허용
-- 나라장터에서 내려받는 제안요청서가 PDF뿐인 경우가 있어 파일 형식 체크 제약에 'pdf'를 더한다.
-- 파서 lib/rfp/parse-pdf.ts(글자 좌표로 표 복원). 추출 방식은 기존 그대로다 —
-- 복원한 표가 표준 7행이면 'standard', 요건표 꼴이면 'xlsx', 아니면 'llm'이라
-- rfp_projects.extraction_method 제약은 손대지 않는다.
alter table public.rfp_files drop constraint if exists rfp_files_format_check;
alter table public.rfp_files add constraint rfp_files_format_check check (format in ('hwp','hwpx','docx','xlsx','pdf'));
