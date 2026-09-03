"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Loader2, SquareTerminal } from "lucide-react";
import HBar from "@/components/admin/surveys/charts/HBar";
import SortableTable, { sumBy, type Column } from "@/components/admin/claude-usage/SortableTable";
import DailyBars from "@/components/admin/claude-usage/DailyBars";
import UnitFilter, { matchUnit } from "@/components/admin/claude-usage/UnitFilter";
import { usd, int, hours } from "@/components/admin/claude-usage/format";
import { acceptRate, dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { aggregateCodeTeams, type CodeTeamRow } from "@/lib/claude-usage/code-team-summary";
import { downloadCsv } from "@/lib/claude-usage/csv-download";
import type { DailyMetrics } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

type UserRow = {
  email: string; name: string | null; team: string | null; parent_unit: string | null; headquarters: string | null; division: string | null; active_days: number;
} & DailyMetrics;
interface Resp {
  range: { from: string; to: string };
  scope: { scope: "self" | "org"; scopeLabel: string };
  totals: DailyMetrics & { active_days: number; active_users: number };
  users: UserRow[];
  daily: { day: string; cost_usd: number; sessions: number; prompts: number; active_users: number }[];
  models: { model: string; cost_usd: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number }[];
}
interface ToolRow { tool: string; calls: number; errors: number; duration_ms_sum: number; accepts: number; rejects: number; users: number }
/** RPC claude_code_hourly_emails — dow는 isodow(1=월 … 7=일). users = 그 시간대에 요청한 고유 사용자 수 */
interface HourCell { dow: number; hour: number; requests: number; cost_usd: number; users: number }

/** mcp__server__tool → server : tool 축약 */
function toolLabel(t: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(t);
  return m ? `${m[1]} : ${m[2]}` : t;
}
const ISODOW_LABELS: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일" };

function Stat({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="rounded-lg border p-3" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 조직 / 팀 셀 — 팀 아래 줄에 바로 위 조직(센터 등) */
function unitCell(r: { team: string | null; parent_unit: string | null; headquarters: string | null; division: string | null }) {
  if (!r.team) return <span className="text-muted-foreground">—</span>;
  const p = r.parent_unit ?? r.headquarters ?? r.division;
  return (
    <div title={[r.division, r.headquarters, r.parent_unit, r.team].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" > ")}>
      <div>{r.team}</div>
      {p && p !== r.team && <div className="text-muted-foreground">{p}</div>}
    </div>
  );
}

export default function MyCodeUsagePage() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [unit, setUnit] = useState("all");
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/usage/code?from=${range.from}&to=${range.to}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const [tools, setTools] = useState<{ key: string; rows?: ToolRow[]; notReady?: boolean } | null>(null);
  const [hourly, setHourly] = useState<{ key: string; cells?: HourCell[]; notReady?: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/usage/tools?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTools({ key: requestKey, rows: j.rows ?? [], notReady: j.notReady }); })
      .catch(() => { if (!cancelled) setTools({ key: requestKey, rows: [] }); });
    fetch(`/api/usage/hourly?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setHourly({ key: requestKey, cells: j.cells ?? [], notReady: j.notReady }); })
      .catch(() => { if (!cancelled) setHourly({ key: requestKey, cells: [] }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, requestKey]);

  const isTeamView = data?.scope.scope === "org";
  const users = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => matchUnit(u, unit) && (!s || u.email.includes(s) || (u.name ?? "").toLowerCase().includes(s) || (u.team ?? "").toLowerCase().includes(s)));
  }, [data, unit, q]);
  const distinctTeams = useMemo(() => new Set((data?.users ?? []).map((u) => u.team ?? "명부 없음")).size, [data]);
  const showTeams = isTeamView && distinctTeams > 1;
  const teamRows = useMemo(() => (showTeams ? aggregateCodeTeams(users) : []), [users, showTeams]);

  const toolRows = useMemo(() => (tools?.key === requestKey ? tools.rows ?? [] : []).map((t) => ({
    ...t, calls: Number(t.calls), errors: Number(t.errors), duration_ms_sum: Number(t.duration_ms_sum), accepts: Number(t.accepts), rejects: Number(t.rejects), users: Number(t.users),
  })), [tools, requestKey]);
  const toolTotals = useMemo(() => toolRows.reduce((a, r) => ({ calls: a.calls + r.calls, errors: a.errors + r.errors }), { calls: 0, errors: 0 }), [toolRows]);
  const maxCalls = Math.max(1, ...toolRows.map((r) => r.calls));

  const hourCells = useMemo(() => (hourly?.key === requestKey ? hourly.cells ?? [] : []), [hourly, requestKey]);
  const { hourGrid, hourMax, hourTotal, hourTotals } = useMemo(() => {
    const grid = new Map<string, HourCell>();
    let max = 0;
    let total = 0;
    const totals = Array.from({ length: 24 }, () => 0);
    for (const c of hourCells) {
      const cell = { ...c, requests: Number(c.requests), cost_usd: Number(c.cost_usd), users: Number(c.users) || 0 };
      grid.set(`${cell.dow}:${cell.hour}`, cell);
      max = Math.max(max, cell.requests);
      total += cell.requests;
      totals[cell.hour] += cell.requests;
    }
    return { hourGrid: grid, hourMax: Math.max(1, max), hourTotal: total, hourTotals: totals };
  }, [hourCells]);
  const maxHourTotal = Math.max(1, ...hourTotals);

  const t = data?.totals;
  const accept = t ? acceptRate(t.edits_accepted, t.edits_rejected) : null;
  const perPrompt = (inTok: number, outTok: number, prompts: number) => (prompts ? `${int(inTok / prompts)} / ${int(outTok / prompts)}` : "—");

  const userColumns: Column<UserRow>[] = [
    { key: "user", header: "구성원", value: (r) => r.name ?? r.email, render: (r) => (
      <div><div className="font-medium">{r.name ?? r.email.split("@")[0]}</div><div className="text-muted-foreground">{r.email}</div></div>) },
    ...(distinctTeams > 1 ? [{ key: "team", header: "조직 / 팀", value: (r: UserRow) => `${r.parent_unit ?? r.headquarters ?? ""} ${r.team ?? ""}`.trim(), render: unitCell } satisfies Column<UserRow>] : []),
    { key: "cost", header: "비용", align: "right", value: (r) => r.cost_usd, render: (r) => usd(r.cost_usd), total: (rows) => usd(sumBy(rows, (r) => r.cost_usd)) },
    { key: "days", header: "활동일", align: "right", value: (r) => r.active_days, render: (r) => int(r.active_days), total: "sum" },
    { key: "sessions", header: "세션", align: "right", value: (r) => r.sessions, render: (r) => int(r.sessions), total: "sum" },
    { key: "prompts", header: "프롬프트 (사람 / 자동)", align: "right", value: (r) => r.prompts - r.prompts_auto, render: (r) => <span title="사람이 친 프롬프트 / 플러그인·스크립트 자동화(claude-mem 관찰자 등) 프롬프트. 내용 수집이 없는 사용자는 전부 사람으로 잡힘">{`${int(r.prompts - r.prompts_auto)} / ${int(r.prompts_auto)}`}</span>, total: (rows) => `${int(sumBy(rows, (r) => r.prompts) - sumBy(rows, (r) => r.prompts_auto))} / ${int(sumBy(rows, (r) => r.prompts_auto))}` },
    { key: "in", header: "입력 토큰", align: "right", value: (r) => r.input_tokens, render: (r) => int(r.input_tokens), total: "sum" },
    { key: "out", header: "출력 토큰", align: "right", value: (r) => r.output_tokens, render: (r) => int(r.output_tokens), total: "sum" },
    { key: "perPrompt", header: "토큰/프롬프트 (입/출)", align: "right", value: (r) => (r.prompts ? r.output_tokens / r.prompts : 0), render: (r) => <span title="프롬프트 1건당 평균 토큰 — 입력(캐시 읽기 제외) / 출력">{perPrompt(r.input_tokens, r.output_tokens, r.prompts)}</span>, total: (rows) => perPrompt(sumBy(rows, (r) => r.input_tokens), sumBy(rows, (r) => r.output_tokens), sumBy(rows, (r) => r.prompts)) },
    { key: "loc", header: "라인 +/−", align: "right", value: (r) => r.loc_added, render: (r) => `${int(r.loc_added)} / ${int(r.loc_removed)}`, total: (rows) => `${int(sumBy(rows, (r) => r.loc_added))} / ${int(sumBy(rows, (r) => r.loc_removed))}` },
    { key: "accept", header: "수락률", align: "right", value: (r) => acceptRate(r.edits_accepted, r.edits_rejected) ?? -1, render: (r) => { const a = acceptRate(r.edits_accepted, r.edits_rejected); return a === null ? "—" : `${a}%`; }, total: (rows) => { const a = acceptRate(sumBy(rows, (r) => r.edits_accepted), sumBy(rows, (r) => r.edits_rejected)); return a === null ? "—" : `${a}%`; } },
    { key: "commits", header: "커밋", align: "right", value: (r) => r.commits, render: (r) => int(r.commits), total: "sum" },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests, render: (r) => int(r.pull_requests), total: "sum" },
    { key: "active", header: "활성 시간", align: "right", value: (r) => r.active_user_seconds, render: (r) => hours(r.active_user_seconds), total: (rows) => hours(sumBy(rows, (r) => r.active_user_seconds)) },
  ];

  const maxTeamCost = Math.max(1, ...teamRows.map((r) => r.cost_usd));
  const teamColumns: Column<CodeTeamRow>[] = [
    { key: "team", header: "팀 / 센터", value: (r) => r.team, render: (r) => (
      <div><div className="font-medium">{r.team}</div>{r.parent && <div className="text-muted-foreground">{r.parent}</div>}</div>) },
    { key: "users", header: "사용자", align: "right", value: (r) => r.users, render: (r) => <span title="기간 내 활동자 / 전체">{`${r.active_users}/${r.users}`}</span>, total: (rows) => `${sumBy(rows, (r) => r.active_users)}/${sumBy(rows, (r) => r.users)}` },
    { key: "cost", header: "비용", align: "right", value: (r) => r.cost_usd, render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-2 rounded bg-primary/20" style={{ width: `${Math.max(2, Math.round((r.cost_usd / maxTeamCost) * 90))}px` }} />
        <span>{usd(r.cost_usd)}</span>
      </div>), total: (rows) => usd(sumBy(rows, (r) => r.cost_usd)) },
    { key: "costPerUser", header: "비용/인", align: "right", value: (r) => (r.active_users ? r.cost_usd / r.active_users : 0), render: (r) => (r.active_users ? usd(r.cost_usd / r.active_users) : "—"), total: (rows) => { const a = sumBy(rows, (r) => r.active_users); return a ? usd(sumBy(rows, (r) => r.cost_usd) / a) : "—"; } },
    { key: "sessions", header: "세션", align: "right", value: (r) => r.sessions, render: (r) => int(r.sessions), total: "sum" },
    { key: "prompts", header: "프롬프트 (사람 / 자동)", align: "right", value: (r) => r.prompts - r.prompts_auto, render: (r) => `${int(r.prompts - r.prompts_auto)} / ${int(r.prompts_auto)}`, total: (rows) => `${int(sumBy(rows, (r) => r.prompts) - sumBy(rows, (r) => r.prompts_auto))} / ${int(sumBy(rows, (r) => r.prompts_auto))}` },
    { key: "out", header: "출력 토큰", align: "right", value: (r) => r.output_tokens, render: (r) => int(r.output_tokens), total: "sum" },
    { key: "accept", header: "수락률", align: "right", value: (r) => acceptRate(r.edits_accepted, r.edits_rejected) ?? -1, render: (r) => { const a = acceptRate(r.edits_accepted, r.edits_rejected); return a === null ? "—" : `${a}%`; }, total: (rows) => { const a = acceptRate(sumBy(rows, (r) => r.edits_accepted), sumBy(rows, (r) => r.edits_rejected)); return a === null ? "—" : `${a}%`; } },
    { key: "commits", header: "커밋", align: "right", value: (r) => r.commits, render: (r) => int(r.commits), total: "sum" },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests, render: (r) => int(r.pull_requests), total: "sum" },
  ];

  const toolColumns: Column<ToolRow>[] = [
    { key: "tool", header: "도구", value: (r) => r.tool, render: (r) => <span className="font-mono text-[11px]" title={r.tool}>{toolLabel(r.tool)}</span> },
    { key: "calls", header: "호출", align: "right", value: (r) => r.calls, render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-2 rounded bg-primary/20" style={{ width: `${Math.max(2, Math.round((r.calls / maxCalls) * 110))}px` }} />
        <span>{int(r.calls)}</span>
      </div>), total: (rows) => int(sumBy(rows, (r) => r.calls)) },
    { key: "share", header: "비중", align: "right", value: (r) => r.calls, render: (r) => (toolTotals.calls ? `${((r.calls / toolTotals.calls) * 100).toFixed(1)}%` : "—"), total: (rows) => (toolTotals.calls ? `${((sumBy(rows, (r) => r.calls) / toolTotals.calls) * 100).toFixed(1)}%` : "—") },
    { key: "errors", header: "실패", align: "right", value: (r) => (r.calls ? r.errors / r.calls : 0), render: (r) => (r.calls ? `${int(r.errors)} (${((r.errors / r.calls) * 100).toFixed(1)}%)` : "—"), total: (rows) => { const c = sumBy(rows, (r) => r.calls), e = sumBy(rows, (r) => r.errors); return c ? `${int(e)} (${((e / c) * 100).toFixed(1)}%)` : "—"; } },
    { key: "avg", header: "평균 소요", align: "right", value: (r) => (r.calls ? r.duration_ms_sum / r.calls : 0), render: (r) => { if (!r.calls || !r.duration_ms_sum) return "—"; const ms = r.duration_ms_sum / r.calls; return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; } },
    { key: "decision", header: "승인 / 거절", align: "right", value: (r) => r.rejects, render: (r) => (r.accepts + r.rejects > 0 ? `${int(r.accepts)} / ${int(r.rejects)}` : "—"), total: (rows) => { const a = sumBy(rows, (r) => r.accepts), j = sumBy(rows, (r) => r.rejects); return a + j > 0 ? `${int(a)} / ${int(j)}` : "—"; } },
    ...(isTeamView ? [{ key: "users", header: "사용 인원", align: "right", value: (r: ToolRow) => r.users, render: (r: ToolRow) => int(r.users) } satisfies Column<ToolRow>] : []),
  ];

  const exportUsersCsv = () => {
    const head = ["email", "name", "team", "parent_unit", "cost_usd", "active_days", "sessions", "prompts_human", "prompts_auto", "input_tokens", "output_tokens", "cache_read_tokens", "loc_added", "loc_removed", "edits_accepted", "edits_rejected", "commits", "pull_requests", "active_user_seconds"];
    downloadCsv(`my-claude-code-usage-${range.from}-to-${range.to}.csv`, head, users.map((u) => [u.email, u.name ?? "", u.team ?? "", u.parent_unit ?? "", u.cost_usd.toFixed(4), u.active_days, u.sessions, u.prompts - u.prompts_auto, u.prompts_auto, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.loc_added, u.loc_removed, u.edits_accepted, u.edits_rejected, u.commits, u.pull_requests, Math.round(u.active_user_seconds)]));
  };
  const exportTeamsCsv = () => {
    const head = ["team", "parent", "active_users", "users", "cost_usd", "sessions", "prompts_human", "prompts_auto", "output_tokens", "commits", "pull_requests"];
    downloadCsv(`my-claude-code-usage-by-team-${range.from}-to-${range.to}.csv`, head, teamRows.map((r) => [r.team, r.parent ?? "", r.active_users, r.users, r.cost_usd.toFixed(4), r.sessions, r.prompts - r.prompts_auto, r.prompts_auto, r.output_tokens, r.commits, r.pull_requests]));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 md:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <SquareTerminal className="h-5 w-5" />내 Claude Code 사용량
          {data && <Badge variant="secondary" className="ml-1">{data.scope.scopeLabel}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">관리형 설정 OTel로 수집된 본인{isTeamView ? "·조직" : ""} 사용량입니다. 조직장(팀장·센터장·본부장)은 소속 구성원까지 보입니다. 프롬프트 내용은 다루지 않습니다.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        {isTeamView && (
          <>
            {distinctTeams > 1 && <UnitFilter value={unit} onChange={setUnit} rows={data?.users ?? []} />}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름/이메일 검색" className="h-8 w-[180px] text-xs" />
            <Button size="sm" variant="outline" onClick={exportUsersCsv} disabled={users.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
          </>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {t && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="비용" value={usd(t.cost_usd)} />
          {isTeamView
            ? <Stat label="활성 사용자" value={`${int(t.active_users)} / ${int(data!.users.length)}`} sub="기간 내 사용 / 전체 구성원" />
            : <Stat label="활동일" value={int(t.active_days)} />}
          <Stat label="세션" value={int(t.sessions)} />
          <Stat label="프롬프트 (사람 / 자동)" value={`${int(t.prompts - t.prompts_auto)} / ${int(t.prompts_auto)}`} title="사람이 친 프롬프트 / 플러그인·스크립트 자동화(claude-mem 관찰자 등). 내용 수집이 없는 사용자는 전부 사람으로 잡힘" />
          <Stat label="토큰/프롬프트 (입/출)" value={perPrompt(t.input_tokens, t.output_tokens, t.prompts)} sub="프롬프트 1건당 평균 · 입력은 캐시 읽기 제외" />
          <Stat label="라인 +/−" value={`${int(t.loc_added)} / ${int(t.loc_removed)}`} />
          <Stat label="편집 수락률" value={accept === null ? "—" : `${accept}%`} sub={`수락 ${int(t.edits_accepted)} / 거절 ${int(t.edits_rejected)}`} />
          <Stat label="커밋 · PR" value={`${int(t.commits)} · ${int(t.pull_requests)}`} />
          <Stat label="활성 시간" value={hours(t.active_user_seconds)} sub="Claude Code와 상호작용한 시간" />
          <Stat label="캐시 읽기 토큰" value={int(t.cache_read_tokens)} />
        </div>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm">일별 비용</CardTitle></CardHeader>
            <CardContent><DailyBars data={data.daily} valueKey="cost_usd" label="USD / 일" format={usd} /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">모델별 비용</CardTitle></CardHeader>
            <CardContent>
              {data.models.length === 0
                ? <p className="text-xs text-muted-foreground">기간 내 모델별 데이터가 없습니다.</p>
                : <HBar showPct={false} formatValue={usd} items={data.models.slice(0, 8).map((m) => ({ label: m.model, value: m.cost_usd, pct: data.totals.cost_usd ? Math.round((m.cost_usd / data.totals.cost_usd) * 100) : 0 }))} />}
            </CardContent>
          </Card>
        </div>
      )}

      {showTeams && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">팀별 집계 ({teamRows.length}개 팀 · 사내 조직도 기준)</CardTitle>
              <Button size="sm" variant="outline" onClick={exportTeamsCsv} disabled={teamRows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
            </div>
            <p className="text-xs text-muted-foreground">팀 = 조직도 말단 부서(팀·센터), 아래 줄은 바로 위 조직. &quot;사용자&quot;는 기간 내 활동자/전체.</p>
          </CardHeader>
          <CardContent>
            <SortableTable totalLabel={`총계 (${teamRows.length}개 팀)`} rows={teamRows} columns={teamColumns} rowKey={(r) => r.team} defaultSort={{ key: "cost", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다."} />
          </CardContent>
        </Card>
      )}

      {isTeamView && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별 ({users.length}명)</CardTitle></CardHeader>
          <CardContent>
            <SortableTable totalLabel={`총계 (${users.length}명)`} rows={users} columns={userColumns} rowKey={(r) => r.email} defaultSort={{ key: "cost", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다."} />
          </CardContent>
        </Card>
      )}

      {toolRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">도구 사용 (호출 {int(toolTotals.calls)} · 실패 {int(toolTotals.errors)})</CardTitle>
            <p className="text-xs text-muted-foreground">Claude Code의 tool_result(호출·실패·소요)와 tool_decision(권한 승인/거절) 이벤트 기준.</p>
          </CardHeader>
          <CardContent>
            <SortableTable totalLabel={`총계 (${toolRows.length}개 도구)`} rows={toolRows} columns={toolColumns} rowKey={(r) => r.tool} defaultSort={{ key: "calls", dir: "desc" }} emptyText="아직 집계된 도구 사용이 없습니다." />
          </CardContent>
        </Card>
      )}

      {hourCells.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">시간대 패턴 (KST · API 요청 {int(hourTotal)}건)</CardTitle>
            <p className="text-xs text-muted-foreground">Claude Code API 요청 발생 시각 기준. 진할수록 요청이 많은 시간대이고 마지막 줄은 시각별 합계입니다. 셀에 마우스를 올리면 요청·비용{isTeamView ? "·사용자 수" : ""}가 보입니다.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="border-separate" style={{ borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th className="pr-1 text-right text-[10px] font-normal text-muted-foreground">시</th>
                    {Array.from({ length: 24 }, (_, h) => <th key={h} className="w-7 text-center text-[10px] font-normal text-muted-foreground">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                    <tr key={dow}>
                      <td className={`pr-1 text-right text-[11px] ${dow >= 6 ? "text-red-500" : "text-muted-foreground"}`}>{ISODOW_LABELS[dow]}</td>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = hourGrid.get(`${dow}:${h}`);
                        const v = cell?.requests ?? 0;
                        const alpha = v === 0 ? 0 : 0.15 + 0.85 * (v / hourMax);
                        return (
                          <td
                            key={h}
                            className="h-7 w-7 rounded-sm text-center align-middle text-[9px]"
                            style={{ backgroundColor: v === 0 ? "var(--muted)" : `rgba(79, 70, 229, ${alpha.toFixed(2)})`, color: alpha > 0.55 ? "#fff" : undefined }}
                            title={cell ? `${ISODOW_LABELS[dow]} ${h}시 — 요청 ${int(v)}건 · ${usd(cell.cost_usd)}${isTeamView ? ` · 사용자 ${int(cell.users)}명` : ""}` : `${ISODOW_LABELS[dow]} ${h}시 — 없음`}
                          >
                            {v > 0 && v >= hourMax * 0.5 ? int(v) : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="pr-1 pt-1 text-right text-[10px] text-muted-foreground">합계</td>
                    {hourTotals.map((v, h) => (
                      <td key={h} className="pt-1 text-center align-bottom" title={`${h}시 합계 ${int(v)}건`}>
                        <div className="mx-auto w-4 rounded-sm bg-primary/30" style={{ height: `${Math.max(2, Math.round((v / maxHourTotal) * 28))}px` }} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && !error && t && t.sessions === 0 && (
        <p className="text-sm text-muted-foreground">기간 내 수집된 사용량이 없습니다. Claude Code에서 관리형 설정을 승인하고 재시작한 뒤부터 집계됩니다.</p>
      )}
    </div>
  );
}
