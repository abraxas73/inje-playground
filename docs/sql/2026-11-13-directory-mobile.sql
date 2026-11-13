-- 2026-11-13 조직도 휴대폰 — 검색(숫자 4자리 = 뒷자리, 그 이상 = 포함)·상세 표시(사용자 결정).
-- company_directory는 RLS로 막혀 있고 service role만 읽는다(로그인·org_chart 권한 확인 뒤 /api/directory/org가 내림). 멱등.
alter table public.company_directory add column if not exists mobile text;
comment on column public.company_directory.mobile is '휴대폰(아마란스 gw102A02 mobileTelNum) — 조직도 검색·상세 표시용, 매일 gw-directory-sync가 갱신';
-- 확인: select count(*) filter (where mobile is not null), count(*) from public.company_directory where active;
