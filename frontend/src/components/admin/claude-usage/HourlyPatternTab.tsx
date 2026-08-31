"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { int, usd } from "./format";
import type { ClaudeOrg } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

interface Cell { dow: number; hour: number; requests: number; cost_usd: number; users: number }
interface Resp { range: { from: string; to: string }; cells: Cell[]; notReady: boolean }

export default function HourlyPatternTab({ orgs }: { orgs: ClaudeOrg[] }) {
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

  const { grid, max, total, hourTotals } = useMemo(() => {
    const grid = new Map<string, Cell>();
    let max = 0;
    let total = 0;
    const hourTotals = Array.from({ length: 24 }, () => 0);
    for (const c of data?.cells ?? []) {
      const cell = { ...c, requests: Number(c.requests), cost_usd: Number(c.cost_usd), users: Number(c.users) };
      grid.set(`${cell.dow}:${cell.hour}`, cell);
      max = Math.max(max, cell.requests);
      total += cell.requests;
      hourTotals[cell.hour] += cell.requests;
    }
    return { grid, max: Math.max(1, max), total, hourTotals };
  }, [data]);
  const maxHourTotal = Math.max(1, ...hourTotals);

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
          시간대 집계 함수가 아직 없습니다 — Supabase SQL Editor에서 <code>docs/sql/2026-08-31-claude-usage-tools.sql</code>을 실행하세요.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">시간대별 사용 패턴 (KST · API 요청 {int(total)}건)</CardTitle>
          <p className="text-xs text-muted-foreground">Claude Code API 요청(claude_code_requests) 발생 시각 기준. 진할수록 요청이 많은 시간대입니다.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="border-separate" style={{ borderSpacing: 2 }}>
              <thead>
                <tr>
                  <th className="pr-1 text-right text-[10px] font-normal text-muted-foreground">시</th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className="w-7 text-center text-[10px] font-normal text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                  <tr key={dow}>
                    <td className={`pr-1 text-right text-[11px] ${dow === 0 || dow === 6 ? "text-red-500" : "text-muted-foreground"}`}>{DOW[dow]}</td>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = grid.get(`${dow}:${h}`);
                      const v = cell?.requests ?? 0;
                      const alpha = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
                      return (
                        <td
                          key={h}
                          className="h-7 w-7 rounded-sm text-center align-middle text-[9px]"
                          style={{ backgroundColor: v === 0 ? "var(--muted)" : `rgba(79, 70, 229, ${alpha.toFixed(2)})`, color: alpha > 0.55 ? "#fff" : undefined }}
                          title={cell ? `${DOW[dow]} ${h}시 — 요청 ${int(v)}건 · ${usd(cell.cost_usd)} · 사용자 ${int(cell.users)}명` : `${DOW[dow]} ${h}시 — 없음`}
                        >
                          {v > 0 && v >= max * 0.5 ? int(v) : ""}
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
          <p className="mt-2 text-[11px] text-muted-foreground">색 농도 = 해당 요일·시각의 요청 수(최대 {int(max)}건 기준). 셀에 마우스를 올리면 요청·비용·사용자 수가 보입니다. 마지막 줄은 시각별 합계입니다.</p>
        </CardContent>
      </Card>
    </div>
  );
}
