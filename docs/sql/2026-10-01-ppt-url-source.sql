-- 2026-10-01 PPT 만들기 — URL 원고(source_kind 'url'). 서버가 페이지 본문을 가져와 source_text에 저장하고 source_name에 주소를 둔다.
alter table public.ppt_deck_versions drop constraint if exists ppt_deck_versions_source_kind_check;
alter table public.ppt_deck_versions add constraint ppt_deck_versions_source_kind_check check (source_kind in ('text','file','pptx','url'));
