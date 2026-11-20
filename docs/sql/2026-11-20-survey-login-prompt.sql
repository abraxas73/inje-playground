-- 설문 로그인 팝업(2026-11-20): 관리자가 켠 진행 중 설문을 아직 참여하지 않은 사람에게 로그인 때 팝업으로(웹·데스크톱 앱, 모바일 제외).
-- 참여 여부는 submit_survey_response와 같은 기준 — 익명 설문은 sha256(uid||survey_id) 해시, 기명은 respondent_user_id. 응답 내용은 보지 않는다.

alter table public.surveys add column if not exists prompt_on_login boolean not null default false;

create or replace function public.pending_login_survey()
returns table(slug text, title text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.slug, s.title
  from public.surveys s
  where auth.uid() is not null
    and s.prompt_on_login
    and s.status = 'open'
    and s.access_mode = 'authenticated'
    and (s.opens_at is null or s.opens_at <= now())
    and (s.closes_at is null or s.closes_at > now())
    and public.has_page_access('survey')
    and not exists (
      select 1 from public.survey_responses r
      where r.survey_id = s.id
        and r.is_complete
        and (r.respondent_user_id = auth.uid()
             or r.respondent_hash = encode(extensions.digest(auth.uid()::text || s.id::text, 'sha256'), 'hex'))
    )
  order by s.sort_order, s.created_at
  limit 1
$$;

revoke all on function public.pending_login_survey() from public, anon;
grant execute on function public.pending_login_survey() to authenticated;
