-- Apply after 2026-09-15-marketing-email-integrity.sql. Safe to reapply.
begin;
alter table public.marketing_review_events add column if not exists email_result_id uuid references public.marketing_email_results(id);
create unique index if not exists marketing_event_email_result_idx on public.marketing_review_events(email_result_id) where email_result_id is not null;
create index if not exists marketing_event_contact_email_idx on public.marketing_review_events(contact_id,created_at desc,id desc) where email_result_id is not null;

-- One immutable audit event per accepted attempt, including failed attempts.
-- Contact-only events deliberately leave organization_id null: coworkers must
-- not inherit another person's email result through the company history.
create or replace function public.marketing_email_record_history(p_result uuid default null)
returns void language sql security definer set search_path='' as $$
 insert into public.marketing_review_events
 (email_result_id,contact_id,actor,actor_name,action,reason,after_data,source,validation_snapshot,created_at)
 select r.id,r.contact_id,j.actor,j.actor_name,'이메일 검증',
  concat(t.snapshot->>'db_id',' · ',t.snapshot->>'email',' · ',
   case r.result->>'state' when 'pass' then '근거 확인' when 'fail' then '문제 발견' when 'error' then '실행 오류' else '확인 필요' end),
  jsonb_build_object('contact',t.snapshot),
  jsonb_build_object('type','email-integrity','runId',r.run_id,'resultId',r.id),r.result,r.created_at
 from public.marketing_email_results r
 join public.marketing_email_targets t on t.run_id=r.run_id and t.contact_id=r.contact_id
 join public.marketing_email_runs j on j.id=r.run_id
 where p_result is null or r.id=p_result
 on conflict (email_result_id) where email_result_id is not null do nothing;
$$;
create or replace function public.marketing_email_result_audit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.marketing_email_record_history(new.id);
 return new;
end $$;
revoke all on function public.marketing_email_record_history(uuid),public.marketing_email_result_audit() from public,anon,authenticated,service_role;
drop trigger if exists marketing_email_result_audit on public.marketing_email_results;
create trigger marketing_email_result_audit after insert on public.marketing_email_results
 for each row execute function public.marketing_email_result_audit();
-- Preserve original timestamps and evidence for checks performed before this change.
select public.marketing_email_record_history(null);

create or replace function public.marketing_email_contact_history(p_contact uuid,p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare current_contact public.marketing_contacts;
begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 select * into current_contact from public.marketing_contacts where id=p_contact;
 if not found then return null; end if;
 return jsonb_build_object(
  'total',(select count(*) from public.marketing_review_events where contact_id=p_contact and email_result_id is not null),
  'pageSize',20,
  'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
   select e.*,
    (current_contact.version is distinct from (e.after_data->'contact'->>'version')::integer
     or current_contact.organization_id is distinct from (e.after_data->'contact'->>'organization_id')::uuid
     or o.version is distinct from (e.after_data->'contact'->>'organization_version')::integer
     or coalesce(p.version,0)<>coalesce((e.after_data->'contact'->'profile'->>'version')::integer,0)
     or e.created_at<now()-interval '30 days') stale
   from public.marketing_review_events e
   left join public.marketing_organizations o on o.id=current_contact.organization_id
   left join public.marketing_email_profiles p on p.organization_id=current_contact.organization_id
   where e.contact_id=p_contact and e.email_result_id is not null
   order by e.created_at desc,e.id desc limit 20 offset (greatest(1,least(100000,coalesce(p_page,1)))-1)*20
  ) x),'[]'::jsonb));
end $$;
revoke all on function public.marketing_email_contact_history(uuid,integer) from public,anon;
grant execute on function public.marketing_email_contact_history(uuid,integer) to authenticated;
commit;
