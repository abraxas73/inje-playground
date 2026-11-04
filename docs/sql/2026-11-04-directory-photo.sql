-- 조직도 명부 사진 — 아마란스 gw102A02 picFileId를 "{groupSeq}/empPic/{picFileId}"로 저장(동기화 스크립트 scripts/gw-directory-sync.mjs).
-- 아마란스 사진 주소(/gw/contentsImgController/download/{group}/empPic/[thum_]{id})는 로그인 쿠키가 있어야 받힌다(없으면 401 — 2026-11-04 실측).
-- 그래서 매일 동기화가 연동 계정으로 받아 비공개 버킷 directory-photos(thumb/{id}·large/{id})에 넣고,
-- 화면은 GET /api/directory/photo/{id}(로그인·org_chart 권한)로 본다. 사진이 바뀌면 picFileId가 바뀌어 새 객체가 된다.
alter table public.company_directory add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('directory-photos', 'directory-photos', false, 524288, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
