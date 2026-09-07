-- 2026-09-07 엑셀(xlsx) 요건표를 RFP 원본으로 허용
-- 견적요청서·기술검토표처럼 한 행 = 한 요구사항인 엑셀을 올려 요구사항 표를 만들고 솔루션 매핑까지 하기 위해
-- 파일 형식과 추출 방식 체크 제약에 'xlsx'를 더한다. 파서 lib/rfp/parse-xlsx.ts, 추출 lib/rfp/extract-xlsx.ts.
alter table public.rfp_files drop constraint if exists rfp_files_format_check;
alter table public.rfp_files add constraint rfp_files_format_check check (format in ('hwp','hwpx','docx','xlsx'));

alter table public.rfp_projects drop constraint if exists rfp_projects_extraction_method_check;
alter table public.rfp_projects add constraint rfp_projects_extraction_method_check check (extraction_method in ('standard','llm','xlsx'));
