"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import OrgSelect from "@/components/admin/claude-usage/OrgSelect";
import { Loader2 } from "lucide-react";
import { dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { int } from "./format";
import { useMoney } from "@/components/shared/currency-context";
import HourHeatmap from "@/components/shared/HourHeatmap";
import type { ClaudeOrg } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

interface Cell { dow: number; hour: number; requests: number; cost_usd: number; users: number }
interface Resp { range: { from: string; to: string }; cells: Cell[]; notReady: boolean }

export default function HourlyPatternTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const { usd } = useMoney();
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [org, setOrg] = useState("all");
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}|${org}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/claude-usage/hourly?from=${range.from}&to=${range.to}&org=${encodeURIComponent(org)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, org, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const total = useMemo(() => (data?.cells ?? []).reduce((a, c) => a + Number(c.requests), 0), [data]);
  const heat = useMemo(() => (data?.cells ?? []).map((c) => {
    const dow = Number(c.dow) === 0 ? 7 : Number(c.dow); // RPC는 dow 0=일 → isodow
    return { dow, hour: Number(c.hour), value: Number(c.requests), title: `${DOW[Number(c.dow)]} ${c.hour}시 — 요청 ${int(Number(c.requests))}건 · ${usd(Number(c.cost_usd))} · 사용자 ${int(Number(c.users))}명` };
  }), [data, usd]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        <OrgSelect orgs={orgs} value={org} onChange={setOrg} personal unknown />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.notReady && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          시간대 집계 함수가 아직 없습니다 — Supabase SQL Editor에서 <code>docs/sql/2026-08-31-claude-usage-tools.sql</code>을 실행하세요.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">시간대별 사용 패턴 (KST · API 요청 {int(total)}건)</CardTitle>
          <p className="text-xs text-muted-foreground">Claude Code API 요청(claude_code_requests) 발생 시각 기준. 진할수록 요청이 많은 시간대입니다.</p>
        </CardHeader>
        <CardContent>
          <HourHeatmap cells={heat} unit="건" footnote="색 농도 = 해당 요일·시각의 요청 수. 셀에 마우스를 올리면 요청·비용·사용자 수가 보입니다. 마지막 줄은 시각별 합계입니다." />
        </CardContent>
      </Card>
    </div>
  );
}
