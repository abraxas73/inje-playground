"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Loader2, Mail, MessageCircle, Network, RefreshCw, Search, Users, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { descendants, type OrgData, type OrgDept, type OrgPerson } from "@/lib/directory/org";
import { cn } from "@/lib/utils";
import { ancestorIds, appActionUrl, byName, defaultExpanded, deptPath, indexOrg, mailtoUrl, searchOrg, type OrgIndex } from "./org-tree";

const fmtKst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음";

interface TreeCtx {
  idx: OrgIndex;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selected: string;
  select: (id: string) => void;
  hits: Set<string>;
}

function DeptCard({ d, ctx }: { d: OrgDept; ctx: TreeCtx }) {
  const kids = ctx.idx.children.get(d.id) ?? [];
  const open = ctx.expanded.has(d.id);
  return (
    <div
      role="button"
      tabIndex={0}
      data-dept-id={d.id}
      onClick={() => ctx.select(d.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.select(d.id); } }}
      className={cn(
        "flex w-52 cursor-pointer items-start gap-1 rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition hover:border-primary/50",
        ctx.hits.has(d.id) && "border-amber-400 bg-amber-50 dark:bg-amber-950/40",
        ctx.selected === d.id && "ring-2 ring-primary",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" title={d.name}>{d.name}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Users className="h-3 w-3 shrink-0" />전체 {ctx.idx.total.get(d.id) ?? 0}명 · 직속 {ctx.idx.direct.get(d.id) ?? 0}명
        </div>
      </div>
      {kids.length > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); ctx.toggle(d.id); }}
          onKeyDown={(e) => e.stopPropagation()}
          className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label={open ? `${d.name} 접기` : `${d.name} 펼치기`}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

/** 하위 부서 — 왼쪽 연결선과 들여쓰기로 세로로 쌓는다. 세로선은 부서마다 제 몫만(마지막은 가지 높이에서 끝). */
function Kids({ kids, ctx }: { kids: OrgDept[]; ctx: TreeCtx }) {
  if (!kids.length) return null;
  return (
    <div className="ml-4 pl-4">
      {kids.map((k, i) => (
        <div
          key={k.id}
          className={cn(
            "relative pt-2 before:absolute before:top-[1.6rem] before:-left-4 before:h-px before:w-4 before:bg-border after:absolute after:top-0 after:-left-4 after:w-px after:bg-border",
            i === kids.length - 1 ? "after:h-[1.6rem]" : "after:bottom-0",
          )}
        >
          <SubTree d={k} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

function SubTree({ d, ctx }: { d: OrgDept; ctx: TreeCtx }) {
  return (
    <div>
      <DeptCard d={d} ctx={ctx} />
      <Kids kids={ctx.expanded.has(d.id) ? ctx.idx.children.get(d.id) ?? [] : []} ctx={ctx} />
    </div>
  );
}

interface PeopleActions {
  picked: Map<string, OrgPerson>;
  toggle: (p: OrgPerson) => void;
  setAll: (people: OrgPerson[], on: boolean) => void;
  /** 앱 안(WebView)에서만 메신저를 연다 — 브라우저에는 메신저 버튼을 두지 않는다 */
  inApp: boolean;
  messenger: (people: OrgPerson[]) => void;
  mail: (people: OrgPerson[]) => void;
  /** 검색 결과에서 사람을 누르면 조직도에서 그 소속 부서를 찾아 보여 준다 */
  locate?: (p: OrgPerson) => void;
  located?: string;
}

function RowActions({ p, a }: { p: OrgPerson; a: PeopleActions }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {a.inApp && p.empSeq && (
        <button type="button" onClick={() => a.messenger([p])} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary" title={`${p.name}에게 메신저`} aria-label={`${p.name}에게 메신저`}>
          <MessageCircle className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={() => a.mail([p])} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary" title={`${p.name}에게 메일`} aria-label={`${p.name}에게 메일`}>
        <Mail className="h-4 w-4" />
      </button>
    </span>
  );
}

function PeopleTable({ people, a }: { people: OrgPerson[]; a: PeopleActions }) {
  if (!people.length) return <p className="p-6 text-center text-sm text-muted-foreground">표시할 직원이 없습니다.</p>;
  const all = people.every((p) => a.picked.has(p.email));
  const some = !all && people.some((p) => a.picked.has(p.email));
  return (
    <ul className="divide-y">
      <li className="sticky top-0 z-10 flex items-center gap-3 bg-muted/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
        <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(v) => a.setAll(people, v === true)} aria-label="목록 전체 선택" />
        <span>전체 선택 · {people.length}명</span>
      </li>
      {people.map((p) => (
        <li key={p.email} className={cn("flex items-start gap-3 px-4 py-2 text-sm hover:bg-muted/40", a.picked.has(p.email) && "bg-primary/5", a.located === p.email && "bg-amber-50 dark:bg-amber-950/40")}>
          <Checkbox className="mt-0.5" checked={a.picked.has(p.email)} onCheckedChange={() => a.toggle(p)} aria-label={`${p.name} 선택`} />
          <div
            className={cn("min-w-0 flex-1", a.locate && p.deptId && "cursor-pointer")}
            {...(a.locate && p.deptId ? { role: "button", tabIndex: 0, title: "조직도에서 소속 보기", onClick: () => a.locate!(p), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); a.locate!(p); } } } : {})}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{[p.duty, p.position].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground" title={p.email}>{p.deptName ?? "-"} · {p.email}</div>
          </div>
          <RowActions p={p} a={a} />
        </li>
      ))}
    </ul>
  );
}

/** 선택 인원 띠 — 이름 칩(✕로 빼기) + 메신저 대화 / 메일 보내기. */
function PickedBar({ a }: { a: PeopleActions }) {
  const list = [...a.picked.values()];
  if (!list.length) return null;
  const shown = list.slice(0, 30);
  return (
    <div className="sticky bottom-2 z-20 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">선택 인원 {list.length}명</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {shown.map((p) => (
            <span key={p.email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {p.name}
              <button type="button" onClick={() => a.toggle(p)} className="text-muted-foreground hover:text-foreground" aria-label={`${p.name} 빼기`}><X className="h-3 w-3" /></button>
            </span>
          ))}
          {list.length > shown.length && <span className="text-xs text-muted-foreground">외 {list.length - shown.length}명</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {a.inApp && <Button size="sm" onClick={() => a.messenger(list)} disabled={!list.some((p) => p.empSeq)}><MessageCircle className="h-4 w-4" />메신저 대화</Button>}
          <Button size="sm" variant={a.inApp ? "outline" : "default"} onClick={() => a.mail(list)}><Mail className="h-4 w-4" />메일 보내기</Button>
          <Button size="sm" variant="ghost" onClick={() => a.setAll(list, false)}>선택 해제</Button>
        </div>
      </div>
    </div>
  );
}

export default function OrgChart() {
  const [data, setData] = useState<OrgData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState("");
  const [withSub, setWithSub] = useState(true);
  const [picked, setPicked] = useState<Map<string, OrgPerson>>(new Map());
  const [inApp, setInApp] = useState(false);
  const [located, setLocated] = useState("");
  useEffect(() => setInApp(document.body.dataset.app === "1"), []);

  const idx = useMemo(() => (data?.departments.length ? indexOrg(data) : null), [data]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/directory/org", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `조직도를 불러오지 못했습니다 (${r.status})`);
      const next = j as OrgData;
      setData(next);
      setError(null);
      if (next.departments.length) {
        const i = indexOrg(next);
        setExpanded((cur) => (cur.size ? cur : defaultExpanded(i)));
        setSelected((cur) => (cur && i.byId.has(cur) ? cur : i.root.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "조직도를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const search = useMemo(() => (idx && data ? searchOrg(idx, data.people, query) : null), [idx, data, query]);
  const onQuery = (v: string) => {
    setQuery(v);
    if (idx && data) {
      const { expand } = searchOrg(idx, data.people, v);
      if (expand.size) setExpanded((cur) => new Set([...cur, ...expand]));
    }
  };

  if (error && !data) return <Alert variant="destructive" className="mx-auto max-w-xl"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!data || !idx) return <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />조직도를 불러오는 중입니다…</div>;

  const ctx: TreeCtx = {
    idx,
    expanded,
    toggle: (id) => setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    selected,
    select: setSelected,
    hits: search?.depts ?? new Set(),
  };
  const sel = idx.byId.get(selected) ?? idx.root;
  const searching = query.trim().length > 0;
  const scope = withSub ? descendants(data.departments, sel.id) : new Set([sel.id]);
  const people = (searching ? search!.people : data.people.filter((p) => p.deptId !== null && scope.has(p.deptId))).slice().sort(byName);
  const level1 = expanded.has(idx.root.id) ? idx.children.get(idx.root.id) ?? [] : [];
  // 메신저·메일 — 앱 안이면 같은 사이트 /app-action으로 보내 앱이 네이티브 화면(대화방·메일 쓰기)을 연다
  const go = (url: string) => { window.location.href = url; };
  const actions: PeopleActions = {
    picked,
    inApp,
    toggle: (p) => setPicked((cur) => { const n = new Map(cur); if (n.has(p.email)) n.delete(p.email); else n.set(p.email, p); return n; }),
    setAll: (list, on) => setPicked((cur) => { const n = new Map(cur); for (const p of list) { if (on) n.set(p.email, p); else n.delete(p.email); } return n; }),
    messenger: (list) => go(appActionUrl("messenger", list)),
    mail: (list) => go(inApp ? appActionUrl("mail", list) : mailtoUrl(list)),
    located,
    // 조상을 펼치고 소속 부서를 선택한 뒤, 보이는 트리(넓은/좁은 화면 중 하나)에서 그 카드로 스크롤
    locate: searching
      ? (p) => {
          const id = p.deptId!;
          setExpanded((cur) => new Set([...cur, ...ancestorIds(idx, id)]));
          setSelected(id);
          setLocated(p.email);
          setTimeout(() => {
            const el = [...document.querySelectorAll<HTMLElement>(`[data-dept-id="${CSS.escape(id)}"]`)].find((e) => e.getClientRects().length);
            el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
          }, 50);
        }
      : undefined,
  };

  return (
    <div className="animate-fade-up space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 sm:flex"><Network className="h-5 w-5 text-indigo-600" /></div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">이노그리드 조직도</h1>
            <p className="text-sm text-muted-foreground">
              {data.departments.length}개 부서 · 최근 동기화 {fmtKst(data.syncedAt)} · 재직자 {data.people.length}명
            </p>
            {data.derived && <p className="text-xs text-muted-foreground/80">부서 순서·빈 부서는 다음 동기화부터 반영됩니다</p>}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 basis-full sm:w-64 sm:flex-none sm:basis-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="부서, 이름, 이메일 검색" className="pl-8" aria-label="조직도 검색" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set(idx.byId.keys()))}><ChevronsUpDown className="h-4 w-4" />전체 펼치기</Button>
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set([idx.root.id]))}><ChevronsDownUp className="h-4 w-4" />전체 접기</Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />새로고침
          </Button>
        </div>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* 왼쪽 부서 트리 · 오른쪽 소속 직원(좁은 화면은 위아래) */}
      <div className="grid gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[minmax(0,4fr)_minmax(280px,1fr)] [body[data-app]_&]:lg:h-[calc(100dvh-9rem)]">
        {/* 넓은 화면: 위→아래로 펼친 전체 조직도 / 좁은 화면(모바일): 세로 들여쓰기 트리. 스크롤은 이 안에서만 */}
        <Card className="h-[55dvh] gap-0 overflow-auto p-3 lg:h-auto lg:p-4">
          <div className="w-max min-w-full lg:hidden">
            <div
              role="button"
              tabIndex={0}
              data-dept-id={idx.root.id}
              onClick={() => setSelected(idx.root.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(idx.root.id); } }}
              className={cn("flex w-52 cursor-pointer items-center gap-3 rounded-xl bg-slate-900 px-3 py-2 text-left text-white shadow-md dark:bg-slate-800", selected === idx.root.id && "ring-2 ring-primary ring-offset-2")}
            >
              <Building2 className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{idx.root.name}</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-300"><Users className="h-3 w-3" />전체 {idx.total.get(idx.root.id) ?? 0}명</span>
              </span>
              {(idx.children.get(idx.root.id)?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); ctx.toggle(idx.root.id); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="rounded p-0.5 text-slate-300 hover:bg-white/10"
                  aria-label={expanded.has(idx.root.id) ? `${idx.root.name} 접기` : `${idx.root.name} 펼치기`}
                  aria-expanded={expanded.has(idx.root.id)}
                >
                  {expanded.has(idx.root.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              )}
            </div>
            <Kids kids={level1} ctx={ctx} />
          </div>
          <div className="mx-auto hidden w-max min-w-full flex-col items-center lg:flex">
            <div
              role="button"
              tabIndex={0}
              data-dept-id={idx.root.id}
              onClick={() => setSelected(idx.root.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(idx.root.id); } }}
              className={cn("flex cursor-pointer items-center gap-3 rounded-xl bg-slate-900 px-5 py-3 text-left text-white shadow-md dark:bg-slate-800", selected === idx.root.id && "ring-2 ring-primary ring-offset-2")}
            >
              <Building2 className="h-6 w-6 shrink-0" />
              <span>
                <span className="block font-bold">{idx.root.name}</span>
                <span className="flex items-center gap-1 text-xs text-slate-300"><Users className="h-3 w-3" />전체 {idx.total.get(idx.root.id) ?? 0}명</span>
              </span>
              {(idx.children.get(idx.root.id)?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); ctx.toggle(idx.root.id); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="rounded p-0.5 text-slate-300 hover:bg-white/10"
                  aria-label={expanded.has(idx.root.id) ? `${idx.root.name} 접기` : `${idx.root.name} 펼치기`}
                  aria-expanded={expanded.has(idx.root.id)}
                >
                  {expanded.has(idx.root.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              )}
            </div>
            {level1.length > 0 && (
              <>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-start">
                  {level1.map((d, i) => (
                    <div key={d.id} className="relative px-2 pt-4">
                      {/* 가로 연결선(첫·끝 칸은 반쪽) + 세로 짧은 선 */}
                      <span className={cn("absolute top-0 h-px bg-border", i === 0 ? "left-1/2" : "left-0", i === level1.length - 1 ? "right-1/2" : "right-0", level1.length === 1 && "hidden")} />
                      <span className="absolute top-0 left-1/2 h-4 w-px bg-border" />
                      <SubTree d={d} ctx={ctx} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-semibold">{searching ? `‘${query.trim()}’ 검색 결과` : `${sel.name} · 소속 직원`}</h2>
              <p className="text-xs break-keep text-muted-foreground">
                {searching
                  ? `전사에서 ${people.length}명`
                  : `${deptPath(idx, sel.id)} · 직속 ${idx.direct.get(sel.id) ?? 0}명 / 하위 포함 ${idx.total.get(sel.id) ?? 0}명`}
              </p>
            </div>
            {!searching && (
              <div className="flex items-center gap-2">
                <Checkbox id="org-with-sub" checked={withSub} onCheckedChange={(v) => setWithSub(v === true)} />
                <Label htmlFor="org-with-sub" className="text-sm">하위 부서 포함</Label>
              </div>
            )}
          </div>
          <div className="max-h-[60dvh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
            <PeopleTable people={people} a={actions} />
          </div>
        </Card>
      </div>

      <PickedBar a={actions} />

      <p className="text-xs text-muted-foreground">그룹웨어(아마란스) 조직도를 매일 자동 동기화합니다.</p>
    </div>
  );
}
