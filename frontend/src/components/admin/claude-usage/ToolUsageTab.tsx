"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import SortableTable, { sumBy, type Column } from "./SortableTable";
import { dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { int } from "./format";
import type { ClaudeOrg } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

interface ToolRow {
  tool_name: string;
  calls: number;
  errors: number;
  duration_ms_sum: number;
  accepts: number;
  rejects: number;
  users: number;
}
interface Resp { range: { from: string; to: string }; byTool: ToolRow[]; notReady: boolean }

/** mcp__server__tool → server:tool 로 축약 */
function toolLabel(name: string): string {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? `${m[1]} : ${m[2]}` : name;
}

export default function ToolUsageTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [org, setOrg] = useState("all");
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}|${org}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/claude-usage/tools?from=${range.from}&to=${range.to}&org=${encodeURIComponent(org)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, org, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const rows = useMemo(() => (data?.byTool ?? []).map((r) => ({
    ...r,
    calls: Number(r.calls), errors: Number(r.errors), duration_ms_sum: Number(r.duration_ms_sum),
    accepts: Number(r.accepts), rejects: Number(r.rejects), users: Number(r.users),
  })), [data]);
  const totals = useMemo(() => rows.reduce((a, r) => ({ calls: a.calls + r.calls, errors: a.errors + r.errors }), { calls: 0, errors: 0 }), [rows]);
  const maxCalls = Math.max(1, ...rows.map((r) => r.calls));

  const columns: Column<ToolRow>[] = [
    { key: "tool", header: "도구", value: (r) => r.tool_name, render: (r) => <span className="font-mono text-[11px]" title={r.tool_name}>{toolLabel(r.tool_name)}</span> },
    { key: "calls", header: "호출", align: "right", value: (r) => r.calls, render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-2 rounded bg-primary/20" style={{ width: `${Math.max(2, Math.round((r.calls / maxCalls) * 110))}px` }} />
        <span>{int(r.calls)}</span>
      </div>) , total: (rows) => int(sumBy(rows, (r) => r.calls)) },
    { key: "share", header: "비중", align: "right", value: (r) => r.calls, render: (r) => (totals.calls ? `${((r.calls / totals.calls) * 100).toFixed(1)}%` : "—") , total: (rows) => (totals.calls ? `${((sumBy(rows, (r) => r.calls) / totals.calls) * 100).toFixed(1)}%` : "—") },
    { key: "errors", header: "실패", align: "right", value: (r) => (r.calls ? r.errors / r.calls : 0), render: (r) => (r.calls ? `${int(r.errors)} (${((r.errors / r.calls) * 100).toFixed(1)}%)` : "—") , total: (rows) => { const c = sumBy(rows, (r) => r.calls), e = sumBy(rows, (r) => r.errors); return c ? `${int(e)} (${((e / c) * 100).toFixed(1)}%)` : "—"; } },
    { key: "avg", header: "평균 소요", align: "right", value: (r) => (r.calls ? r.duration_ms_sum / r.calls : 0), render: (r) => { if (!r.calls || !r.duration_ms_sum) return "—"; const ms = r.duration_ms_sum / r.calls; return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; } },
    { key: "decision", header: "승인 / 거절", align: "right", value: (r) => r.rejects, render: (r) => (r.accepts + r.rejects > 0 ? `${int(r.accepts)} / ${int(r.rejects)}` : "—") , total: (rows) => { const a = sumBy(rows, (r) => r.accepts), j = sumBy(rows, (r) => r.rejects); return a + j > 0 ? `${int(a)} / ${int(j)}` : "—"; } },
    { key: "users", header: "사용자", align: "right", value: (r) => r.users, render: (r) => int(r.users) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Claude 조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Claude 조직</SelectItem>
            {orgs.filter((o) => o.id !== "unknown" && o.id !== "test-org").map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.notReady && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          도구 집계 테이블이 아직 없습니다 — Supabase SQL Editor에서 <code>docs/sql/2026-08-31-claude-usage-tools.sql</code>을 실행하면 이후 수신분부터 집계됩니다.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">도구별 사용 분포 (호출 {int(totals.calls)} · 실패 {int(totals.errors)})</CardTitle>
          <p className="text-xs text-muted-foreground">Claude Code의 tool_result(호출·실패·소요)와 tool_decision(권한 승인/거절) 이벤트 기준. SQL 실행 이후 수신분부터 쌓이며 과거는 소급되지 않습니다.</p>
        </CardHeader>
        <CardContent>
          <SortableTable totalLabel={`총계 (${rows.length}개 도구)`} rows={rows} columns={columns} rowKey={(r) => r.tool_name} defaultSort={{ key: "calls", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "아직 집계된 도구 사용이 없습니다."} />
        </CardContent>
      </Card>
    </div>
  );
}
