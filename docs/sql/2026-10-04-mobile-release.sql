-- 모바일 앱 사내 배포(2026-10-04): APK 저장 버킷. 비공개, 200MB. 쓰기는 릴리스 스크립트(service role)만, 읽기는 서버가 만든 600초 서명 URL만.
-- 릴리스 메타데이터는 settings 키 mobile_release(문자열 JSON: notes·testflightUrl·android{version,build,apkPath,releasedAt}·ios{version,build,releasedAt}).
-- 적용: Supabase MCP 또는 Management API(메모리 supabase-sql-via-management-api).
insert into storage.buckets (id, name, public, file_size_limit)
values ('mobile', 'mobile', false, 209715200)
on conflict (id) do update set public = false, file_size_limit = 209715200;
