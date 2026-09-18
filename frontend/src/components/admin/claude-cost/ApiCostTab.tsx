"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw } from "lucide-react";
import DailyBars from "@/components/admin/claude-usage/DailyBars";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { fmtDateTime } from "@/components/admin/claude-usage/format";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { formatCents } from "@/lib/claude-cost/money";
import { API_COST_HINT } from "@/lib/claude-cost/hints";
import type { ApiCostRow } from "@/types/claude-cost";

interface ApiCostResponse { available: boolean; rows: ApiCostRow[]; lastSyncedAt: string | null }
interface DescRow { description: string; cost_type: string | null; model: string | null; cents: number; days: number }

/** Admin API cost_report(Console API 사용분). 이 탭은 CLAUDE_ADMIN_API_KEY가 있을 때만 그려진다 */
export default function ApiCostTab() {
  const preset = useMemo(() => dateRangePreset("30d"), []);
  const [from, setFrom] = useState(preset.from);
  const [to, setTo] = useState(preset.to);
  const [tick, setTick] = useState(0);
  const key = `${from}|${to}|${tick}`;
  const [result, setResult] = useState<{ key: string; data?: ApiCostResponse; error?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const loading = result?.key !== key;
  const data = result?.key === key ? result.data ?? null : null;
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-cost/api-cost?from=${from}&to=${to}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as ApiCostResponse; })
      .then((j) => { if (alive) setResult({ key, data: j }); })
      .catch((e) => { if (alive) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [key, from, to]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch("/api/admin/claude-cost/api-cost/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSyncMsg(`${(j as { upserted: number }).upserted}행 수집`);
      setTick((t) => t + 1);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [from, to]);

  const daily = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of data?.rows ?? []) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.amount_cents));
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cents]) => ({ day, usd: cents / 100 }));
  }, [data]);
  const byDesc = useMemo<DescRow[]>(() => {
    const m = new Map<string, DescRow>();
    for (const r of data?.rows ?? []) {
      const cur = m.get(r.description) ?? { description: r.description, cost_type: r.cost_type, model: r.model, cents: 0, days: 0 };
      cur.cents += Number(r.amount_cents);
      cur.days += 1;
      m.set(r.description, cur);
    }
    return [...m.values()];
  }, [data]);
  const total = byDesc.reduce((a, r) => a + r.cents, 0);

  const columns: Column<DescRow>[] = [
    { key: "description", header: "항목", value: (r) => r.description },
    { key: "model", header: "모델", value: (r) => r.model ?? "", render: (r) => r.model ?? "—" },
    { key: "type", header: "종류", value: (r) => r.cost_type ?? "", render: (r) => r.cost_type ?? "—" },
    { key: "cents", header: "비용", hint: API_COST_HINT, value: (r) => r.cents / 100, align: "right", render: (r) => formatCents(r.cents), total: (rows) => formatCents(rows.reduce((a, r) => a + r.cents, 0)) },
    { key: "share", header: "비중", value: (r) => (total ? (r.cents / total) * 100 : 0), align: "right", render: (r) => (total ? `${((r.cents / total) * 100).toFixed(1)}%` : "—") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px] text-xs" />
        <span className="text-muted-foreground">~</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px] text-xs" />
        <Button size="sm" variant="outline" className="h-8" onClick={sync} disabled={syncing}>{syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}지금 수집</Button>
        {syncMsg && <span className="text-xs text-muted-foreground">{syncMsg}</span>}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {error && <span className="text-destructive">{error}</span>}
        <span className="ml-auto text-xs text-muted-foreground">마지막 수집 {data?.lastSyncedAt ? fmtDateTime(data.lastSyncedAt) : "—"} · 매일 08:00 KST 최근 3일 재수집</span>
      </div>
      <p className="text-xs text-muted-foreground">{API_COST_HINT}</p>
      <DailyBars data={daily} valueKey="usd" label="일별 API 비용(USD)" format={(v) => formatCents(v * 100)} />
      <SortableTable rows={byDesc} columns={columns} rowKey={(r) => r.description} defaultSort={{ key: "cents", dir: "desc" }} totalLabel={`총계 (${byDesc.length}항목)`} emptyText={loading ? "불러오는 중..." : "이 기간에 수집된 API 비용이 없습니다. '지금 수집'을 누르세요."} />
    </div>
  );
}
