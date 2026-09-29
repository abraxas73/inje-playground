"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import OrgSelect from "@/components/admin/claude-usage/OrgSelect";
import UnitFilter, { matchUnit } from "@/components/admin/claude-usage/UnitFilter";
import { Loader2, Trash2, History } from "lucide-react";
import SortableTable, { sumBy, type Column } from "./SortableTable";
import PeriodSelect from "./PeriodSelect";
import SeatActionCell from "./SeatActionCell";
import SeatHistorySheet from "./SeatHistorySheet";
import SeatExecutorChip from "./SeatExecutorChip";
import { hasSeat, isIdleSeat } from "@/lib/claude-usage/aggregate";
import { int, fmtDateTime } from "./format";
import { useMoney } from "@/components/shared/currency-context";
import type { ClaudeOrg, CsvImport, MemberActivityRow } from "@/types/claude-usage";
import type { SeatActionSummary, SeatExecutor } from "@/types/claude-seat";

type Row = MemberActivityRow & { org_id: string; import_id: string; employee_name?: string | null; team?: string | null; parent_unit?: string | null; headquarters?: string | null; division?: string | null; code_prompts?: number; code_prompts_auto?: number; office_turns?: number; seat_action?: SeatActionSummary | null };
interface MembersResponse { imports: CsvImport[]; rows: Row[]; period: { start: string; end: string } | null; executor?: SeatExecutor | null }

/**
 * 채팅·Cowork(CSV) 멤버 활동 표. CSV 수집·업로드는 웹 UI가 아니라 /claude-usage-csv 스킬(launchd 매일 09:05)이
 * scripts/claude-usage-upload.sh → POST /api/admin/claude-usage/imports 로 처리하므로 여기서는 수집 상태·이력만 보여준다.
 */
export default function MembersCsvTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const { usd } = useMoney();
  const [org, setOrg] = useState("all");
  const [periodEnd, setPeriodEnd] = useState("latest");
  const [tick, setTick] = useState(0);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("all");
  const [idleOnly, setIdleOnly] = useState(false);
  const [history, setHistory] = useState<{ open: boolean; email: string | null }>({ open: false, email: null });
  const pollUntil = useRef(0);

  const key = `${org}|${periodEnd}|${tick}`;
  const [result, setResult] = useState<{ key: string; data?: MembersResponse; error?: string } | null>(null);
  const loading = result?.key !== key;
  const data = result?.data ?? null; // 폴링 중에도 이전 데이터를 유지(키가 바뀌어도 result는 아직 이전 응답)
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-usage/members?org=${encodeURIComponent(org)}&periodEnd=${encodeURIComponent(periodEnd)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as MembersResponse;
      })
      .then((j) => {
        if (alive) setResult({ key, data: j });
      })
      .catch((e) => {
        if (alive) setResult({ key, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [key, org, periodEnd, tick]);

  /** 요청·취소 직후 5초 간격으로 다시 읽는다(대기·실행 중이 남아 있고 2분이 안 지났으면) */
  const onSeatChanged = () => { pollUntil.current = Date.now() + 120_000; setTick((t) => t + 1); };
  useEffect(() => {
    const pending = (data?.rows ?? []).some((r) => r.seat_action && (r.seat_action.status === "requested" || r.seat_action.status === "running"));
    if (!pending) return;
    if (!pollUntil.current) pollUntil.current = Date.now() + 120_000; // 로드 시 이미 대기·실행 중이면 여기서 폴링 시작
    if (Date.now() > pollUntil.current) return;
    const id = setTimeout(() => setTick((t) => t + 1), 5_000);
    return () => clearTimeout(id);
  }, [data]);

  const remove = async (id: string) => {
    setRemoveError(null);
    const r = await fetch(`/api/admin/claude-usage/imports/${id}`, { method: "DELETE" });
    if (r.ok) {
      setPeriodEnd("latest");
      setTick((t) => t + 1);
      return;
    }
    const j = await r.json().catch(() => ({}) as { error?: string });
    setRemoveError(j.error ?? `HTTP ${r.status}`);
  };

  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);
  /** 조직별 최신 import 중 가장 최근 업로드 시각 — "마지막 CSV 수집" 표시용 */
  const lastCollected = useMemo(() => {
    const latest = new Map<string, { created_at: string; period_start: string; period_end: string }>();
    for (const i of data?.imports ?? []) {
      const prev = latest.get(i.org_id);
      if (!prev || i.created_at > prev.created_at) latest.set(i.org_id, { created_at: i.created_at, period_start: i.period_start, period_end: i.period_end });
    }
    if (latest.size === 0) return null;
    const vals = [...latest.values()];
    return { at: vals.map((v) => v.created_at).sort().at(-1)!, orgs: latest.size, periodStart: vals.map((v) => v.period_start).sort()[0], periodEnd: vals.map((v) => v.period_end).sort().at(-1)! };
  }, [data]);
  /** 업로드 때 버려진 칼럼 — Anthropic이 CSV에 지표를 추가하면 여기에 뜬다(파서에 매핑 추가 필요) */
  const unknownHeaders = useMemo(() => {
    const set = new Set<string>();
    for (const i of data?.imports ?? []) for (const h of i.unknown_headers ?? []) set.add(h);
    return [...set];
  }, [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => matchUnit(r, unit) && (!s || r.email.includes(s) || r.name.toLowerCase().includes(s) || (r.employee_name ?? "").toLowerCase().includes(s) || (r.team ?? "").toLowerCase().includes(s)) && (!idleOnly || isIdleSeat(r)));
  }, [data, q, unit, idleOnly]);
  const idleCount = useMemo(() => (data?.rows ?? []).filter(isIdleSeat).length, [data]);

  const columns: Column<Row>[] = [
    { key: "user", header: "사용자 (Claude)", value: (r) => r.email, render: (r) => (<div><div className="font-medium">{r.name || r.email}</div>{r.name && <div className="text-muted-foreground">{r.email}</div>}<button type="button" className="text-[10px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setHistory({ open: true, email: r.email })}>이력</button></div>) },
    { key: "employee", header: "이름", value: (r) => r.employee_name ?? "", render: (r) => (r.employee_name ? <span title="사내 조직도(아마란스) 이름">{r.employee_name}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "org", header: "Claude 조직", value: (r) => orgName.get(r.org_id) ?? r.org_id, render: (r) => <Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge> },
    { key: "team", header: "조직 / 팀", value: (r) => `${r.headquarters ?? r.division ?? ""} ${r.team ?? ""}`.trim(), render: (r) => (r.team
      ? <div title={[r.division, r.headquarters, r.parent_unit, r.team].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" > ")}><div>{r.team}</div>{(() => { const p = r.parent_unit ?? r.headquarters ?? r.division; return p && p !== r.team ? <div className="text-muted-foreground">{p}</div> : null; })()}</div>
      : <span className="text-muted-foreground">—</span>) },
    { key: "role", header: "역할", value: (r) => r.role },
    { key: "tier", header: "시트", hint: "claude.ai 멤버 스냅샷(매일 09:05, 시트 작업 완료 시 즉시)의 티어. 없으면 CSV의 티어", value: (r) => r.seat_tier, render: (r) => (hasSeat(r.seat_tier) ? r.seat_tier : <span className="text-muted-foreground">미할당</span>) },
    { key: "last", header: "마지막 활동", value: (r) => r.last_active ?? "" },
    { key: "days", header: "활동일", align: "right", value: (r) => r.days_active, total: "sum" },
    { key: "codep", header: "Claude Code 프롬프트\n(사람 / 자동)", align: "right", value: (r) => r.code_prompts ?? 0, render: (r) => <span title="같은 데이터 기간의 Claude Code 프롬프트 수(OTel, Claude 조직 무관) — 사람이 친 것 / 플러그인·스크립트 자동화. 채팅 0이어도 Claude Code를 쓰는 시트 구분용">{`${int(r.code_prompts ?? 0)} / ${int(r.code_prompts_auto ?? 0)}`}</span>, total: (rows) => `${int(sumBy(rows, (r) => r.code_prompts ?? 0))} / ${int(sumBy(rows, (r) => r.code_prompts_auto ?? 0))}` },
    { key: "office", header: "Office 턴", align: "right", value: (r) => r.office_turns ?? 0, render: (r) => <span title="같은 데이터 기간의 Excel·Word·PowerPoint·Outlook 추가 기능 턴 수(Office Agents, OTel 수집기 등록 조직만). 상세는 Office Agents 탭">{int(r.office_turns ?? 0)}</span>, total: "sum" },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats , total: "sum" },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages , total: "sum" },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions , total: "sum" },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests , total: "sum" },
    { key: "cowork", header: "Cowork 세션", align: "right", value: (r) => r.cowork_sessions , total: "sum" },
    { key: "cwmsg", header: "Cowork 메시지", align: "right", value: (r) => r.cowork_messages , total: "sum" },
    { key: "proj", header: "프로젝트", align: "right", value: (r) => r.projects_used , total: "sum" },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created , total: "sum" },
    { key: "spend", header: "초과 지출", align: "right", value: (r) => r.estimated_spend_usd, render: (r) => usd(r.estimated_spend_usd) , total: (rows) => usd(sumBy(rows, (r) => r.estimated_spend_usd)) },
    { key: "seat_action", header: "시트 작업", align: "right", value: (r) => r.seat_action?.status ?? "", render: (r) => <SeatActionCell row={{ org_id: r.org_id, email: r.email, name: r.name, seat_tier: r.seat_tier, seat_action: r.seat_action ?? null }} orgName={orgName.get(r.org_id) ?? r.org_id.slice(0, 8)} onChanged={onSeatChanged} /> },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {lastCollected
          ? <>마지막 CSV 수집: <b>{fmtDateTime(lastCollected.at)}</b> <span className="text-muted-foreground">· {lastCollected.orgs}개 조직 · 데이터 기간 {lastCollected.periodStart} ~ {lastCollected.periodEnd}</span></>
          : <span className="text-muted-foreground">마지막 CSV 수집: 없음</span>}
        <span className="ml-2 text-xs text-muted-foreground">— 수집·업로드는 /claude-usage-csv 스킬(매일 09:05 launchd)이 처리합니다</span>
        <span className="ml-2 inline-flex items-center gap-2 align-middle">
          <SeatExecutorChip executor={data?.executor} />
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setHistory({ open: true, email: null })}><History className="mr-1 h-3.5 w-3.5" />시트 작업 이력</Button>
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <OrgSelect orgs={orgs} value={org} onChange={(v) => { setOrg(v); setPeriodEnd("latest"); }} />
        <PeriodSelect value={periodEnd} onChange={setPeriodEnd} imports={data?.imports ?? []} />
        {data?.period && <Badge variant="secondary" title="선택한 기간의 CSV 중 조직별 최신 업로드 기준">데이터 기간 {data.period.start} ~ {data.period.end}</Badge>}
        <UnitFilter value={unit} onChange={setUnit} rows={data?.rows ?? []} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일/이름 검색" className="h-8 w-[200px] text-xs" />
        <Button size="sm" variant={idleOnly ? "default" : "outline"} onClick={() => setIdleOnly((v) => !v)}>노는 시트만 ({idleCount})</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {unknownHeaders.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          CSV에 모르는 칼럼이 있어 저장하지 않았습니다: <span className="font-medium">{unknownHeaders.join(", ")}</span>
          {" "}— Anthropic이 지표를 추가한 것일 수 있습니다. 필요하면 파서(<code>lib/claude-usage/members-csv.ts</code>)에 칼럼을 추가하세요.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">멤버 활동 ({rows.length}명) — 노는 시트는 붉게 표시{data?.period && lastCollected && <span className="ml-2 font-normal text-muted-foreground">· 데이터 {data.period.start} ~ {data.period.end}, 수집 {fmtDateTime(lastCollected.at)}</span>}</CardTitle>
          <p className="text-xs text-muted-foreground">Cowork 세션·메시지에는 Claude in Chrome(사이드 패널) 세션이 포함됩니다(구분 없음). Excel·Word·PowerPoint 추가 기능은 CSV에 없어 OTel 수집기로 받은 턴 수를 &quot;Office 턴&quot; 컬럼에 붙였습니다(상세는 Office Agents 탭).</p>
        </CardHeader>
        <CardContent>
          <SortableTable totalLabel={`총계 (${rows.length}명)`} rows={rows} columns={columns} rowKey={(r) => `${r.import_id}:${r.email}`} defaultSort={{ key: "chats", dir: "desc" }} rowClassName={(r) => (isIdleSeat(r) ? "bg-destructive/5" : "")} emptyText={loading ? "불러오는 중..." : "업로드된 CSV가 없습니다."} />
        </CardContent>
      </Card>

      {(data?.imports.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">수집 이력</CardTitle>
            {lastCollected && <p className="text-xs text-muted-foreground">마지막 CSV 수집: {fmtDateTime(lastCollected.at)} · {lastCollected.orgs}개 조직(조직별 최신 기준)</p>}
          </CardHeader>
          <CardContent>
            {removeError && <p className="mb-2 text-xs text-destructive">{removeError}</p>}
            <ul className="space-y-1 text-xs">
              {(data?.imports ?? []).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 border-b py-1 last:border-0">
                  <span>{orgName.get(i.org_id) ?? i.org_id.slice(0, 8)} · {i.period_start} ~ {i.period_end} · {i.row_count}명 · 수집 {fmtDateTime(i.created_at)} · <span className="text-muted-foreground">{i.filename}</span>{(i.unknown_headers?.length ?? 0) > 0 && <Badge variant="outline" className="ml-2 border-amber-400 text-amber-700 dark:text-amber-300" title={`저장하지 않은 칼럼: ${i.unknown_headers!.join(", ")}`}>미매핑 칼럼 {i.unknown_headers!.length}</Badge>}</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(i.id)} aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <SeatHistorySheet open={history.open} onOpenChange={(o) => setHistory((h) => ({ ...h, open: o }))} email={history.email} orgName={orgName} />
    </div>
  );
}
