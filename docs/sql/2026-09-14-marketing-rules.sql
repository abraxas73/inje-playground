-- Run after marketing-completion and marketing-export. No Contact data is changed.
begin;
create table if not exists public.marketing_rules (
 id uuid primary key default gen_random_uuid(), code text not null unique,
 title text not null check(length(title) between 1 and 120), description text not null default '',
 config jsonb not null, severity text not null check(severity in ('error','warning')),
 enabled boolean not null default true, protected boolean not null default false,
 source text not null default '사용자 추가', version integer not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table if not exists public.marketing_rule_history (
 id uuid primary key default gen_random_uuid(), rule_id uuid not null references public.marketing_rules(id),
 version integer not null, actor uuid references auth.users(id), actor_name text not null,
 reason text not null, before_data jsonb, after_data jsonb not null, created_at timestamptz not null default now(),
 unique(rule_id,version)
);
alter table public.marketing_rules enable row level security;
alter table public.marketing_rule_history enable row level security;
create policy marketing_read on public.marketing_rules for select to authenticated using((select public.has_page_access('marketing')));
create policy marketing_read on public.marketing_rule_history for select to authenticated using((select public.has_page_access('marketing')));
revoke all on public.marketing_rules,public.marketing_rule_history from public,anon,authenticated;
grant select on public.marketing_rules,public.marketing_rule_history to authenticated;
grant all on public.marketing_rules,public.marketing_rule_history to service_role;
insert into public.marketing_rules(code,title,description,config,severity,protected,source) values
 ('EXCEL-03','소속 회사·기관 식별','소속을 식별할 수 없는 Contact는 Master 등록 전에 확인합니다. 기존 이관 자료는 원본을 보존하고 정비 대상으로 관리합니다.','{"operator":"required","field":"company"}','error',true,'02_관리기준 3행'),
 ('EXCEL-03-REVIEW','등록 대상 확인','실제 관리 가능한 Contact이며 소속 회사·기관을 식별했는지 확인하세요.','{"operator":"review"}','warning',true,'02_관리기준 3행'),
 ('EXCEL-04','발송 유효성 정제 확인','수신거부·자동삭제·Hard Bounce·최근 3개월 연속 Soft Bounce 제외 여부를 정제 자료로 확인하세요. Stibee 미연계 상태이므로 자동 판정하지 않습니다.','{"operator":"review"}','warning',true,'02_관리기준 4행'),
 ('EXCEL-05','고유 DB ID·중복 방지','고유 DB ID와 이메일 중복 제한, 회사·성명 후보 비교 및 승인 직전 충돌 검사를 적용합니다.','{"operator":"builtin"}','error',true,'02_관리기준 5행'),
 ('EXCEL-06','회사·기관 포괄 범위','기업 외 공공기관·정부·지자체·협회·단체·언론·대학·연구기관도 소속 회사·기관으로 관리합니다.','{"operator":"builtin"}','warning',true,'02_관리기준 6행'),
 ('EXCEL-07','회사명 표기 통일·별도 법인 보존','기존 표준명·승인 별칭을 추천하며 동일 법인이 불확실하면 담당자 근거 확인 없이 통합하지 않습니다.','{"operator":"builtin"}','warning',true,'02_관리기준 7행'),
 ('EXCEL-08','불확실한 분류 보류','판단이 어려운 회사·기관은 확인 필요로 유지합니다.','{"operator":"builtin"}','warning',true,'02_관리기준 8행'),
 ('EXCEL-09','회사·기관 단위 분류','회사·기관 테이블의 분류를 모든 소속 Contact에 동일하게 적용합니다.','{"operator":"builtin"}','error',true,'02_관리기준 9행'),
 ('EXCEL-10','원본 출처·시트 추적','최초 이관 행, 제출 원문, 원본시트 및 변경 이력을 보존합니다.','{"operator":"builtin"}','error',true,'02_관리기준 10행'),
 ('EXCEL-11','Eco Partner 확정 정보 확인','Eco 정보는 별도 관리 DB의 확정 자료인지 확인하세요. 불확실하면 임의로 입력하지 않고 비워 둡니다.','{"operator":"review","whenAnyFields":["eco","ecoId","ecoType","ecoMiddle","ecoSmall"]}','warning',true,'02_관리기준 11행'),
 ('EXCEL-12','확인된 정보만 수정','최종 반영값이 확인된 사실인지 확인하고, 불확실한 내용은 보류 또는 반려하세요.','{"operator":"review"}','warning',true,'02_관리기준 12행'),
 ('EXCEL-13','담당자 이동·퇴사·회사명 변경','변경 정보 제출 → 기존 Master 비교 → 담당자 검수·승인으로 업데이트하고 전후 이력을 보존합니다. 이동·퇴사의 자동 감지는 하지 않습니다.','{"operator":"builtin"}','warning',true,'02_관리기준 13행'),
 ('EXCEL-14','최종확인일 형식','날짜가 있으면 유효한 YYYY-MM-DD여야 합니다. 마지막 실제 검증 날짜를 입력하며 제출·다운로드 날짜로 덮어쓰지 않습니다.','{"operator":"date","field":"confirmedAt"}','error',true,'02_관리기준 14행'),
 ('BASE-NAME','성명 필수','신규·변경 승인 시 성명을 확인합니다.','{"operator":"required","field":"name"}','error',true,'최초 구현 요구사항 · 필수정보'),
 ('BASE-EMAIL','이메일 필수','신규·변경 승인 시 이메일을 확인합니다.','{"operator":"required","field":"email"}','error',true,'최초 구현 요구사항 · 필수정보'),
 ('BASE-EMAIL-FORMAT','이메일 형식','이메일의 문법을 검사합니다. 실제 수신 가능성이나 동의 여부는 발송 유효성 확인 항목에서 별도 검수합니다.','{"operator":"email","field":"email"}','error',true,'최초 구현 요구사항 · 이메일 형식')
on conflict(code) do nothing;
insert into public.marketing_rule_history(rule_id,version,actor_name,reason,after_data)
 select id,version,'초기 규칙 이관','Excel 관리기준 및 기존 필수 검증 등록',to_jsonb(r) from public.marketing_rules r on conflict(rule_id,version) do nothing;

create or replace function public.marketing_rule_config_valid(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare fields text[]:=array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes']; op text:=p->>'operator'; k text; v jsonb; begin
 if jsonb_typeof(p) is distinct from 'object' or length(p::text)>10000 or op is null or op not in ('required','email','date','one_of','forbidden_values','max_length','review','builtin') then return false; end if;
 if op not in ('review','builtin') and not coalesce(p->>'field'=any(fields),false) then return false; end if;
 if p ? 'whenField' and not coalesce(p->>'whenField'=any(fields),false) then return false; end if;
 if p ? 'whenValue' and (not p ? 'whenField' or jsonb_typeof(p->'whenValue')<>'string') then return false; end if;
 if p ? 'whenAnyFields' then
  if jsonb_typeof(p->'whenAnyFields')<>'array' then return false; end if;
  for v in select value from jsonb_array_elements(p->'whenAnyFields') loop if jsonb_typeof(v)<>'string' or not (v#>>'{}')=any(fields) then return false; end if; end loop;
 end if;
 if op in ('one_of','forbidden_values') then
  if jsonb_typeof(p->'values') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'values') not between 1 and 100 then return false; end if;
  for v in select value from jsonb_array_elements(p->'values') loop if jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200 then return false; end if; end loop;
 end if;
 if op='max_length' and (jsonb_typeof(p->'max') is distinct from 'number' or not (p->>'max')~'^[0-9]{1,4}$') then return false; end if;
 if op='max_length' and (p->>'max')::integer not between 1 and 2000 then return false; end if;
 for k in select jsonb_object_keys(p) loop if k not in ('operator','field','values','max','whenField','whenValue','whenAnyFields') then return false; end if; end loop;
 return true;
end $$;
alter table public.marketing_rules add constraint marketing_rule_config_check check(public.marketing_rule_config_valid(config));

create or replace function public.marketing_save_rule(p_id uuid,p_version integer,p_title text,p_description text,p_config jsonb,p_severity text,p_enabled boolean,p_reason text)
returns public.marketing_rules language plpgsql security definer set search_path='' as $$
declare old public.marketing_rules; result public.marketing_rules; ident jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 담당자만 규칙을 변경할 수 있습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 if length(btrim(coalesce(p_reason,''))) not between 2 and 2000 or length(btrim(coalesce(p_title,''))) not between 1 and 120 or length(coalesce(p_description,''))>2000 or p_enabled is null or not public.marketing_rule_config_valid(p_config) or p_config->>'operator'='builtin' or p_severity is null or p_severity not in ('error','warning') or (p_config->>'operator'='review' and p_severity<>'warning') then raise exception '규칙 설정과 변경 사유를 확인해 주세요.' using errcode='22023'; end if;
 ident:=public.marketing_identity();
 if p_id is null then
  insert into public.marketing_rules(code,title,description,config,severity,enabled,updated_by) values('CUSTOM-'||gen_random_uuid(),btrim(p_title),coalesce(p_description,''),p_config,p_severity,p_enabled,auth.uid()) returning * into result;
 else
  select * into old from public.marketing_rules where id=p_id for update;
  if not found or old.version is distinct from p_version then raise exception '규칙이 변경되었습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
  if old.protected then raise exception '원본 관리기준·기본 보호 규칙은 해제할 수 없습니다. 추가 규칙으로 보완하세요.' using errcode='42501'; end if;
  update public.marketing_rules set title=btrim(p_title),description=coalesce(p_description,''),config=p_config,severity=p_severity,enabled=p_enabled,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into result;
 end if;
 insert into public.marketing_rule_history(rule_id,version,actor,actor_name,reason,before_data,after_data) values(result.id,result.version,auth.uid(),ident->>'name',p_reason,case when p_id is null then null else to_jsonb(old) end,to_jsonb(result));
 return result;
end $$;

create or replace function public.marketing_validate_rules(p_data jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r public.marketing_rules; violations jsonb:='[]'; rules jsonb:='[]'; applicable boolean; failed boolean; val text; op text; begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Contact 필드가 필요합니다.' using errcode='22023'; end if;
 for r in select * from public.marketing_rules where enabled order by code loop
  rules:=rules||jsonb_build_array(jsonb_build_object('id',r.id,'code',r.code,'version',r.version,'title',r.title,'description',r.description,'config',r.config,'severity',r.severity,'source',r.source));
  applicable:=true;
  if r.config ? 'whenField' then
   if r.config ? 'whenValue' then applicable:=lower(btrim(coalesce(p_data->>(r.config->>'whenField'),'')))=lower(btrim(r.config->>'whenValue'));
   else applicable:=btrim(coalesce(p_data->>(r.config->>'whenField'),''))<>''; end if;
  end if;
  if r.config ? 'whenAnyFields' then applicable:=applicable and exists(select 1 from jsonb_array_elements_text(r.config->'whenAnyFields') f where btrim(coalesce(p_data->>f,''))<>''); end if;
  if not applicable then continue; end if;
  val:=btrim(coalesce(p_data->>(r.config->>'field'),'')); op:=r.config->>'operator'; failed:=false;
  if op='required' then failed:=val='';
  elsif op='email' then failed:=val<>'' and val!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  elsif op='date' and val<>'' then
   begin failed:=val!~'^\d{4}-\d{2}-\d{2}$' or to_char(val::date,'YYYY-MM-DD')<>val; exception when others then failed:=true; end;
  elsif op='one_of' then failed:=not exists(select 1 from jsonb_array_elements_text(r.config->'values') x where lower(btrim(x))=lower(val));
  elsif op='forbidden_values' then failed:=exists(select 1 from jsonb_array_elements_text(r.config->'values') x where lower(btrim(x))=lower(val));
  elsif op='max_length' then failed:=length(val)>(r.config->>'max')::integer;
  elsif op='review' then failed:=true;
  end if;
  if failed then violations:=violations||jsonb_build_array(jsonb_build_object('id',r.id,'code',r.code,'version',r.version,'title',r.title,'message',r.title||case when r.description='' then '' else ': '||r.description end,'severity',r.severity,'manual',op='review','field',r.config->>'field')); end if;
 end loop;
 return jsonb_build_object('version',md5(rules::text),'rules',rules,'violations',violations);
end $$;

create or replace function public.marketing_safe_validation(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb; k text; a jsonb; begin
 v:=jsonb_build_object('kind',case when p->>'kind' in ('신규 등록','기존 정보 업데이트','중복 의심','확인 필요') then p->>'kind' else '확인 필요' end,
 'ruleVersion',coalesce(p->>'ruleVersion','직접 제출 · 검수 시 재검증'),'targetId',p->>'targetId','targetVersion',case when jsonb_typeof(p->'targetVersion')='number' then p->'targetVersion' else 'null'::jsonb end);
 foreach k in array array['errors','reasons','candidates','organizationIds'] loop
  a:='[]';
  if jsonb_typeof(p->k)='array' then select coalesce(jsonb_agg(value),'[]') into a from jsonb_array_elements(p->k) where jsonb_typeof(value)='string'; end if;
  v:=v||jsonb_build_object(k,a);
 end loop;
 v:=v||jsonb_build_object('ai',jsonb_build_object('status',case when p->'ai'->>'status' in ('not_needed','unavailable','success','failed') then p->'ai'->>'status' else 'unavailable' end,
 'reason',coalesce(p->'ai'->>'reason','검수 시 다시 확인해 주세요.'),'category',p->'ai'->>'category','organizationId',p->'ai'->>'organizationId','model',p->'ai'->>'model'));
 return v||jsonb_build_object('ruleCheck',case when jsonb_typeof(p->'ruleCheck')='object' and length((p->'ruleCheck')::text)<1000000 then p->'ruleCheck' else 'null'::jsonb end);
end $$;

create or replace function public.marketing_review_check(p_id uuid,p_final jsonb,p_target uuid,p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.marketing_submissions; c public.marketing_contacts; r record; conflicts jsonb:='[]'; blocking jsonb:='[]'; company text; token text; rule_check jsonb; violation jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 권한이 필요합니다.' using errcode='42501'; end if;
 select * into s from public.marketing_submissions where id=p_id;
 if not found or s.status<>'pending' then raise exception '검수 상태가 변경되었습니다.' using errcode='40001'; end if;
 select * into c from public.marketing_contacts where id=p_target;
 select name into company from public.marketing_organizations where id=p_org;
 company:=coalesce(company,p_final->>'company','');
 if p_org is not null and nullif(btrim(s.data->>'company'),'') is not null and not exists(
 select 1 from public.marketing_organizations o where o.id=p_org and lower(btrim(s.data->>'company'))=any(array_prepend(lower(btrim(o.name)),array(select lower(btrim(a)) from unnest(o.aliases) a)))) then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','company','message','제출 회사명이 선택한 표준명·승인 별칭과 다릅니다. 동일 법인 여부를 확인하세요.'));
 end if;
 if s.target_id is not null and s.target_id is distinct from p_target then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','target','message','원래 지정한 DB ID와 최종 반영 대상이 다릅니다.')); end if;
 if c.id is not null and (lower(btrim(c.data->>'name')) is distinct from lower(btrim(p_final->>'name')) or c.organization_id is distinct from p_org) then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','identity','message','대상 Contact의 성명 또는 회사가 변경됩니다. 동일 인물·법인 여부를 확인하세요.','version',c.version));
 end if;
 for r in select mc.id,mc.db_id,mc.version from public.marketing_contacts mc left join public.marketing_organizations o on o.id=mc.organization_id
 where mc.id is distinct from p_target and
 (nullif(lower(btrim(mc.data->>'email')),'')=nullif(lower(btrim(s.data->>'email')),'') or
 (nullif(lower(btrim(mc.data->>'name')),'')=nullif(lower(btrim(p_final->>'name')),'') and
 (mc.organization_id=p_org or public.marketing_company_matches(coalesce(o.name,mc.data->>'company'),company)))) order by mc.id loop
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','contact:'||r.id,'message',r.db_id||' · 이메일 또는 회사·성명이 겹치는 기존 Contact','version',r.version));
 end loop;
 for r in select x.id,x.version from public.marketing_submissions x left join public.marketing_contacts t on t.id=x.target_id left join public.marketing_organizations o on o.id=t.organization_id
 where x.status in ('pending','validating') and x.id<>p_id and
 (nullif(lower(btrim(coalesce(nullif(x.data->>'email',''),t.data->>'email'))),'')=nullif(lower(btrim(p_final->>'email')),'') or
 (nullif(lower(btrim(coalesce(nullif(x.data->>'name',''),t.data->>'name'))),'')=nullif(lower(btrim(p_final->>'name')),'') and
 public.marketing_company_matches(coalesce(nullif(x.data->>'company',''),o.name,t.data->>'company'),company))) order by x.id loop
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','submission:'||r.id,'message','다른 검수 대기 제출과 이메일 또는 회사·성명이 겹칩니다.','version',r.version));
 end loop;
 if exists(select 1 from public.marketing_contacts where id is distinct from p_target and nullif(lower(btrim(data->>'email')),'')=nullif(lower(btrim(p_final->>'email')),'')) then
  blocking:=jsonb_build_array('최종 이메일을 다른 Contact가 사용하고 있습니다. 대상을 다시 선택하거나 이메일을 수정하세요.');
 end if;
 rule_check:=public.marketing_validate_rules(p_final||jsonb_build_object('company',company));
 for violation in select value from jsonb_array_elements(rule_check->'violations') loop
  if violation->>'severity'='error' then blocking:=blocking||jsonb_build_array(violation->>'message');
  else conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','rule:'||(violation->>'id'),'message',violation->>'message','version',(violation->>'version')::integer)); end if;
 end loop;
 token:=md5(jsonb_build_object('id',p_id,'version',s.version,'final',p_final,'target',p_target,'org',p_org,'conflicts',conflicts,'rulesVersion',rule_check->>'version')::text);
 return jsonb_build_object('conflicts',conflicts,'blockingErrors',blocking,'ruleCheck',rule_check,'token',token,'checkedAt',clock_timestamp());
end $$;

create or replace function public.marketing_review(p_id uuid,p_version integer,p_action text,p_final jsonb,p_target uuid,p_target_version integer,p_org uuid,p_org_version integer,p_category text,p_reason text,p_resolution jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.marketing_submissions; c public.marketing_contacts; o public.marketing_organizations; ident jsonb;
 cid uuid; oid uuid; before_value jsonb; final_value jsonb; k text; duplicate_count integer; check_result jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action is null or p_action not in ('approve','reject','unchanged') or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '검수 사유를 입력해 주세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into s from public.marketing_submissions where id=p_id for update;
 if not found then raise exception '제출을 찾을 수 없습니다.' using errcode='P0002'; end if;
 if (s.status='approved' and p_action='approve') or (s.status='unchanged' and p_action='unchanged') then return s.result_contact_id; end if;
 if s.status<>'pending' or s.version is distinct from p_version then raise exception '검수 상태가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 ident:=public.marketing_identity();
 if p_action='reject' then
  update public.marketing_submissions set status='rejected',version=version+1 where id=p_id;
  insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data) values(p_id,auth.uid(),ident->>'name','반려',p_reason,to_jsonb(s),null);
  return null;
 end if;
 if jsonb_typeof(p_final) is distinct from 'object' then raise exception '최종 반영값이 필요합니다.' using errcode='22023'; end if;
 final_value:='{}';
 foreach k in array array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes'] loop
  if p_final ? k and jsonb_typeof(p_final->k)<>'string' then raise exception '문자 필드가 필요합니다.' using errcode='22023'; end if;
  if length(coalesce(p_final->>k,''))>2000 then raise exception '입력값이 너무 깁니다.' using errcode='22023'; end if;
  final_value:=final_value||jsonb_build_object(k,btrim(coalesce(p_final->>k,'')));
 end loop;
 if coalesce(final_value->>'name','')='' or coalesce(final_value->>'email','')='' or (final_value->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '성명과 유효한 이메일이 필요합니다.' using errcode='22023'; end if;
 if (final_value->>'confirmedAt')<>'' then
  if (final_value->>'confirmedAt') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '최종확인일 형식 오류' using errcode='22023'; end if;
  perform (final_value->>'confirmedAt')::date;
 end if;
 if p_target is not null then
  select * into c from public.marketing_contacts where id=p_target for update;
  if not found or c.version is distinct from p_target_version then raise exception '기존 정보가 변경되었습니다. 재검증해 주세요.' using errcode='40001'; end if;
  before_value:=to_jsonb(c); cid:=c.id;
 end if;
 if exists(select 1 from public.marketing_contacts where lower(btrim(data->>'email'))=lower(btrim(final_value->>'email')) and id is distinct from p_target) then raise exception '다른 Contact에서 사용 중인 이메일입니다. 대상을 다시 선택해 주세요.' using errcode='23505'; end if;
 check_result:=public.marketing_review_check(p_id,final_value,p_target,p_org);
 if jsonb_array_length(check_result->'blockingErrors')>0 then raise exception '%', (check_result->'blockingErrors')::text using errcode='22023'; end if;
 if p_resolution->>'token' is distinct from check_result->>'token' or (jsonb_array_length(check_result->'conflicts')>0 and length(btrim(coalesce(p_resolution->>'reason','')))<2) then
  raise exception '미해결 충돌이 있거나 검증 기준이 바뀌었습니다. 최종값 재검증 후 해결 근거를 확인해 주세요.' using errcode='40001';
 end if;
 if p_action='unchanged' then
  if p_target is null or c.organization_id is distinct from p_org or exists(
   select 1 from jsonb_each_text(final_value) f where f.value is distinct from
   case when f.key='company' then coalesce((select name from public.marketing_organizations where id=c.organization_id),c.data->>'company','') else coalesce(c.data->>f.key,'') end
  ) then raise exception '변경 없음 종결은 기존 대상과 모든 최종값이 같아야 합니다.' using errcode='22023'; end if;
  update public.marketing_submissions set status='unchanged',version=version+1,result_contact_id=cid where id=p_id;
  insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data)
   values(p_id,auth.uid(),ident->>'name','변경 없음',p_reason,to_jsonb(c),jsonb_build_object('contact',to_jsonb(c),'reviewCheck',check_result,'resolution',p_resolution));
  return cid;
 end if;
 if p_org is not null then
  select * into o from public.marketing_organizations where id=p_org for update;
  if not found or o.version is distinct from p_org_version then raise exception '회사 기준이 변경되었습니다. 재검증해 주세요.' using errcode='40001'; end if;
  oid:=o.id; final_value:=jsonb_set(final_value,'{company}',to_jsonb(o.name));
 else
  if coalesce(final_value->>'company','')='' or not public.marketing_category_valid(p_category) then raise exception '회사명과 분류를 확인해 주세요.' using errcode='22023'; end if;
  insert into public.marketing_organizations(name,category) values(final_value->>'company',p_category) returning id into oid;
 end if;
 if p_target is null then
  cid:=gen_random_uuid();
  insert into public.marketing_contacts(id,db_id,organization_id,data) values(cid,'M-'||cid::text,oid,final_value);
 else
  update public.marketing_contacts set organization_id=oid,data=final_value,version=version+1,updated_at=now() where id=cid;
 end if;
 update public.marketing_submissions set status='approved',version=version+1,result_contact_id=cid where id=p_id;
 insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data)
 values(p_id,auth.uid(),ident->>'name',case when p_target is null then '신규 등록' else '기존 정보 업데이트' end,p_reason,before_value,
 jsonb_build_object('contact',(select to_jsonb(mc) from public.marketing_contacts mc where id=cid),'organization',(select to_jsonb(mo) from public.marketing_organizations mo where id=oid),'submissionSource',s.source,'reviewCheck',check_result,'resolution',p_resolution));
 return cid;
end $$;

revoke all on function public.marketing_rule_config_valid(jsonb),public.marketing_save_rule(uuid,integer,text,text,jsonb,text,boolean,text),public.marketing_validate_rules(jsonb) from public,anon;
grant execute on function public.marketing_rule_config_valid(jsonb),public.marketing_save_rule(uuid,integer,text,text,jsonb,text,boolean,text),public.marketing_validate_rules(jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
