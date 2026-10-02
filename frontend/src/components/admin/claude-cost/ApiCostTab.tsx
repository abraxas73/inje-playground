"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw } from "lucide-react";
import DailyBars from "@/components/admin/claude-usage/DailyBars";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { fmtDateTime } from "@/components/admin/claude-usage/format";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { useCurrency } from "@/components/shared/currency-context";
import { API_COST_HINT } from "@/lib/claude-cost/hints";
import type { ApiCostRow, ApiKeyCostRow, ApiKeyInfo } from "@/types/claude-cost";

interface ApiCostResponse { available: boolean; rows: ApiCostRow[]; keys: ApiKeyInfo[]; keyRows: ApiKeyCostRow[]; lastSyncedAt: string | null }
interface KeyRow { id: string; name: string; hint: string | null; status: string; cents: number; models: string }
interface ModelRow { model: string; cents: number }

const ALL = "__all";
const NONE = "__none";
const KEY_HINT = "Admin API cost_report는 키별 금액을 주지 않는다. (일, 모델, 토큰 종류)의 실제 금액을 그날 키별 토큰 수 비중으로 나눈 값 — 키 합계 = 실제 청구액. 토큰 외 비용·사용량 기록이 없는 금액은 '미배분'";
interface DescRow { description: string; cost_type: string | null; model: string | null; cents: number; days: number }

/** Admin API cost_report(Console API 사용분). 이 탭은 CLAUDE_ADMIN_API_KEY가 있을 때만 그려진다 */
export default function ApiCostTab() {
  const { fmt } = useCurrency();
  const preset = useMemo(() => dateRangePreset("30d"), []);
  const [from, setFrom] = useState(preset.from);
  const [to, setTo] = useState(preset.to);
  const [tick, setTick] = useState(0);
  const key = `${from}|${to}|${tick}`;
  const [result, setResult] = useState<{ key: string; data?: ApiCostResponse; error?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [keyFilter, setKeyFilter] = useState(ALL);
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
      const jj = j as { upserted: number; usageRows?: number; keys?: number };
      setSyncMsg(`비용 ${jj.upserted}행 · 키별 사용량 ${jj.usageRows ?? 0}행 · 키 ${jj.keys ?? 0}개 수집`);
      setTick((t) => t + 1);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [from, to]);

  const keyName = useMemo(() => new Map((data?.keys ?? []).map((k) => [k.id, k])), [data]);
  const keyMatch = useCallback((r: ApiKeyCostRow) => keyFilter === ALL || (keyFilter === NONE ? r.apiKeyId === null : r.apiKeyId === keyFilter), [keyFilter]);
  const byKey = useMemo<KeyRow[]>(() => {
    const m = new Map<string, KeyRow & { _models: Set<string> }>();
    for (const r of data?.keyRows ?? []) {
      const id = r.apiKeyId ?? NONE;
      const k = r.apiKeyId ? keyName.get(r.apiKeyId) : undefined;
      const cur = m.get(id) ?? { id, name: r.apiKeyId ? k?.name ?? r.apiKeyId : "미배분", hint: k?.hint ?? null, status: r.apiKeyId ? k?.status ?? "—" : "—", cents: 0, models: "", _models: new Set<string>() };
      cur.cents += r.cents;
      if (r.model) cur._models.add(r.model);
      m.set(id, cur);
    }
    return [...m.values()].map(({ _models, ...r }) => ({ ...r, models: [..._models].sort().join(", ") }));
  }, [data, keyName]);
  const byModel = useMemo<ModelRow[]>(() => {
    const m = new Map<string, number>();
    for (const r of (data?.keyRows ?? []).filter(keyMatch)) m.set(r.model || "—", (m.get(r.model || "—") ?? 0) + r.cents);
    return [...m.entries()].map(([model, cents]) => ({ model, cents }));
  }, [data, keyMatch]);

  const daily = useMemo(() => {
    const byDay = new Map<string, number>();
    if (keyFilter === ALL) for (const r of data?.rows ?? []) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.amount_cents));
    else for (const r of (data?.keyRows ?? []).filter(keyMatch)) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.cents);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cents]) => ({ day, usd: cents / 100 }));
  }, [data, keyFilter, keyMatch]);
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
    { key: "cents", header: "비용", hint: API_COST_HINT, value: (r) => r.cents / 100, align: "right", render: (r) => fmt(r.cents), total: (rows) => fmt(rows.reduce((a, r) => a + r.cents, 0)) },
    { key: "share", header: "비중", value: (r) => (total ? (r.cents / total) * 100 : 0), align: "right", render: (r) => (total ? `${((r.cents / total) * 100).toFixed(1)}%` : "—") },
  ];

  const keyTotal = byKey.reduce((a, r) => a + r.cents, 0);
  const keyColumns: Column<KeyRow>[] = [
    { key: "name", header: "API 키", value: (r) => r.name, render: (r) => (
      <button type="button" className="text-left hover:underline" onClick={() => setKeyFilter(r.id)}>
        <span className="font-medium">{r.name}</span>{r.hint && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{r.hint}</span>}
      </button>) },
    { key: "status", header: "상태", value: (r) => r.status },
    { key: "models", header: "모델", value: (r) => r.models, render: (r) => r.models || "—" },
    { key: "cents", header: "비용(배분)", hint: KEY_HINT, value: (r) => r.cents / 100, align: "right", render: (r) => fmt(r.cents), total: (rows) => fmt(rows.reduce((a, r) => a + r.cents, 0)) },
    { key: "share", header: "비중", value: (r) => (keyTotal ? (r.cents / keyTotal) * 100 : 0), align: "right", render: (r) => (keyTotal ? `${((r.cents / keyTotal) * 100).toFixed(1)}%` : "—") },
  ];
  const modelColumns: Column<ModelRow>[] = [
    { key: "model", header: "모델", value: (r) => r.model },
    { key: "cents", header: "비용(배분)", hint: KEY_HINT, value: (r) => r.cents / 100, align: "right", render: (r) => fmt(r.cents), total: (rows) => fmt(rows.reduce((a, r) => a + r.cents, 0)) },
  ];
  const keyOptions = [...byKey].sort((a, b) => b.cents - a.cents);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px] text-xs" />
        <span className="text-muted-foreground">~</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px] text-xs" />
        <Select value={keyFilter} onValueChange={setKeyFilter}>
          <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>모든 API 키</SelectItem>
            {keyOptions.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}{k.hint ? ` (${k.hint})` : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8" onClick={sync} disabled={syncing}>{syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}지금 수집</Button>
        {syncMsg && <span className="text-xs text-muted-foreground">{syncMsg}</span>}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {error && <span className="text-destructive">{error}</span>}
        <span className="ml-auto text-xs text-muted-foreground">마지막 수집 {data?.lastSyncedAt ? fmtDateTime(data.lastSyncedAt) : "—"} · 매일 08:00 KST 최근 3일 재수집</span>
      </div>
      <p className="text-xs text-muted-foreground">{API_COST_HINT}</p>
      <DailyBars data={daily} valueKey="usd" label={keyFilter === ALL ? "일별 API 비용(USD)" : `일별 API 비용(USD) — ${byKey.find((k) => k.id === keyFilter)?.name ?? ""} (배분)`} format={(v) => fmt(v * 100)} />
      <SortableTable rows={byKey} columns={keyColumns} rowKey={(r) => r.id} defaultSort={{ key: "cents", dir: "desc" }} totalLabel={`키별 합계 (${byKey.length})`} emptyText={loading ? "불러오는 중..." : "키별 사용량이 아직 없습니다. '지금 수집'을 누르세요."} />
      {keyFilter !== ALL && <SortableTable rows={byModel} columns={modelColumns} rowKey={(r) => r.model} defaultSort={{ key: "cents", dir: "desc" }} totalLabel="선택한 키 합계" />}
      {keyFilter === ALL && <SortableTable rows={byDesc} columns={columns} rowKey={(r) => r.description} defaultSort={{ key: "cents", dir: "desc" }} totalLabel={`총계 (${byDesc.length}항목)`} emptyText={loading ? "불러오는 중..." : "이 기간에 수집된 API 비용이 없습니다. '지금 수집'을 누르세요."} />}
    </div>
  );
}
