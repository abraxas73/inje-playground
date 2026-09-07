-- 2026-09-07 카탈로그 기능 이름·설명의 HTML 이름 엔티티 정리(일회성 데이터 수정)
-- 배경: Confluence storage → 평문 변환(decodeEntities)이 &middot; 등 이름 엔티티를 풀지 않아 433건 중 79건에 남음.
-- 파서는 같은 날 수정했고(storage-text.ts NAMED 확장), 이미 들어간 행만 여기서 고친다. name_norm은 overview.ts normalizeName과 같은 규칙으로 재계산.
begin;
update public.rfp_solution_features
   set description = replace(replace(replace(replace(replace(replace(replace(replace(replace(description, '&middot;', '·'), '&rarr;', '→'), '&mdash;', '—'), '&ldquo;', '“'), '&harr;', '↔'), '&larr;', '←'), '&lsquo;', '‘'), '&rdquo;', '”'), '&rsquo;', '’')
 where description ~ '&(middot|rarr|mdash|ldquo|harr|larr|lsquo|rdquo|rsquo);';
with fixed as (
  select id, replace(replace(replace(replace(replace(replace(replace(replace(replace(name, '&middot;', '·'), '&rarr;', '→'), '&mdash;', '—'), '&ldquo;', '“'), '&harr;', '↔'), '&larr;', '←'), '&lsquo;', '‘'), '&rdquo;', '”'), '&rsquo;', '’') as name
    from public.rfp_solution_features
   where name ~ '&(middot|rarr|mdash|ldquo|harr|larr|lsquo|rdquo|rsquo);'
), normed as (
  select id, name, regexp_replace(lower(normalize(name, NFKC)), $re$[\s·・,./\\\-_—–「」｢｣『』\"'“”‘’:;!?~<>〈〉《》()（）\[\]【】]$re$, '', 'g') as name_norm from fixed
)
update public.rfp_solution_features f
   set name = n.name, name_norm = n.name_norm
  from normed n
 where f.id = n.id
   and not exists (select 1 from public.rfp_solution_features g where g.solution_code = f.solution_code and g.name_norm = n.name_norm and g.id <> f.id);
update public.rfp_solution_features
   set keywords = (select coalesce(array_agg(k order by k), '{}') from unnest(keywords) k where k <> all(array['middot','rarr','mdash','ldquo','harr','larr','lsquo','rdquo','rsquo']))
 where keywords && array['middot','rarr','mdash','ldquo','harr','larr','lsquo','rdquo','rsquo'];
commit;
select count(*) filter (where name ~ '&(middot|rarr|mdash|ldquo|harr|larr|lsquo|rdquo|rsquo);') as names_left,
       count(*) filter (where description ~ '&(middot|rarr|mdash|ldquo|harr|larr|lsquo|rdquo|rsquo);') as descs_left,
       count(*) filter (where keywords && array['middot','rarr','mdash','ldquo','harr','larr','lsquo','rdquo','rsquo']) as kw_left,
       count(*) as total
  from public.rfp_solution_features;
