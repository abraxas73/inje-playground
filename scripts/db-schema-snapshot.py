"""운영 DB(public 스키마) 구조 스냅샷 → supabase/schema/public.sql (데이터 없음, 읽기 전용 카탈로그 조회).

실행(토큰은 화면에 찍지 않는다):
  T=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d) python3 -I scripts/db-schema-snapshot.py supabase/schema/public.sql; unset T
docs/sql 에 새 SQL을 적용한 뒤 다시 돌려 커밋하면 실제 구조와 저장소가 맞는다.
"""
import json, sys, urllib.request, os, time
from collections import defaultdict
T = os.environ['T']
URL = 'https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/database/query'
def q(sql):
    for i in range(5):
        req = urllib.request.Request(URL, data=json.dumps({'query': sql}).encode(), headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(10 * (i + 1))
    raise RuntimeError('rate limited')
P = "n.nspname='public'"
tables = q(f"select c.relname t, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where {P} and c.relkind in ('r','p') order by 1")
cols = q(f"""select c.relname t, a.attname n, format_type(a.atttypid,a.atttypmod) ty, a.attnotnull nn, pg_get_expr(d.adbin,d.adrelid) df from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where {P} and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by c.relname, a.attnum""")
cons = q(f"select c.relname t, k.conname n, pg_get_constraintdef(k.oid) d from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where {P} order by c.relname, k.contype, k.conname")
idx = q("select tablename t, indexname n, indexdef d from pg_indexes where schemaname='public' order by tablename, indexname")
pol = q("select tablename t, policyname n, cmd, roles::text r, qual, with_check wc, permissive from pg_policies where schemaname='public' order by tablename, policyname")
views = q("select viewname n, definition d from pg_views where schemaname='public' order by 1")
funcs = q(f"select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where {P} and p.prokind in ('f','p') order by p.proname, p.oid")
trig = q(f"select pg_get_triggerdef(t.oid) d from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where {P} and not t.tgisinternal order by c.relname, t.tgname")
buckets = q("select id, public from storage.buckets order by id")
try: cron = q("select jobname, schedule from cron.job order by jobname")
except Exception: cron = None
g = lambda rows: (lambda d: [d[r['t']].append(r) for r in rows] and d or d)(defaultdict(list))
C, K, I, PO = g(cols), g(cons), g(idx), g(pol)
out = ['-- INNOCREW 운영 DB(public 스키마) 구조 스냅샷 — 데이터 없음. 참고용이며 그대로 복원 스크립트로 쓰지 않는다.',
       '-- 다시 만들기: python3 scripts/db-schema-snapshot.py (Management API 읽기 전용 카탈로그 조회). 변경 이력의 원본은 docs/sql/*.sql.', '']
for t in tables:
    name = t['t']; conn = {k['n'] for k in K[name]}
    lines = [f"  {c['n']} {c['ty']}" + (f" default {c['df']}" if c['df'] else '') + (' not null' if c['nn'] else '') for c in C[name]]
    lines += [f"  constraint {k['n']} {k['d']}" for k in K[name]]
    out.append(f"create table public.{name} (\n" + ",\n".join(lines) + "\n);")
    if t['rls']: out.append(f"alter table public.{name} enable row level security;")
    out += [i['d'] + ';' for i in I[name] if i['n'] not in conn]
    for p in PO[name]:
        s = f"create policy \"{p['n']}\" on public.{name} as {p['permissive'].lower()} for {p['cmd'].lower()} to {p['r'].strip('{}')}"
        if p['qual']: s += f" using ({p['qual']})"
        if p['wc']: s += f" with check ({p['wc']})"
        out.append(s + ';')
    out.append('')
out.append('-- 뷰')
out += [f"create view public.{v['n']} as\n{v['d'].rstrip().rstrip(';')};\n" for v in views]
out.append('-- 함수')
out += [f['d'].rstrip() + ';\n' for f in funcs]
out.append('-- 트리거')
out += [tr['d'] + ';' for tr in trig]
out.append('\n-- 저장소 버킷')
out += [f"-- bucket {b['id']} (public={b['public']})" for b in buckets]
out.append('\n-- pg_cron 작업')
out += [f"-- cron {j['jobname']}: {j['schedule']}" for j in cron] if cron is not None else ['-- (조회 불가)']
open(sys.argv[1], 'w').write("\n".join(out) + "\n")
print(len(tables), 'tables', len(funcs), 'functions', len(views), 'views')
