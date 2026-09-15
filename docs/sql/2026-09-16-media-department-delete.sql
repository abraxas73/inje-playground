-- 부서 삭제(admin). media_obituary_matches.department_id는 on delete cascade라 그 부서로 기록된 매칭도 함께 지워진다.
-- 2026-09-15-media-directory.sql 이후 적용. 재적용 안전.
begin;

create or replace function public.media_department_delete(p_id uuid) returns public.media_departments
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); removed public.media_departments;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'Department id required' using errcode = '22023'; end if;
  delete from public.media_departments where id = p_id returning * into removed;
  if not found then raise exception 'Department not found' using errcode = 'P0002'; end if;
  return removed;
end;
$$;
revoke all on function public.media_department_delete(uuid) from public, anon;
grant execute on function public.media_department_delete(uuid) to authenticated;

commit;
