-- 2026-10-01 PPT 만들기 — URL 원고의 이미지 목록. [{url, alt, width, height, path}] (path = 버킷 ppt의 images/<versionId>/<n>.<ext>, null이면 받기 실패)
alter table public.ppt_deck_versions add column if not exists source_images jsonb;
