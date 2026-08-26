"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download } from "lucide-react";
import HBar from "@/components/admin/surveys/charts/HBar";
import SortableTable, { type Column } from "./SortableTable";
import DailyBars from "./DailyBars";
import { acceptRate, dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { usd, int, hours } from "./format";
import type { UsageSummary, UserUsageRow } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

export default function CodeUsageTab() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [org, setOrg] = useState("all");
  const [q, setQ] = useState("");

  const key = `${range.from}|${range.to}|${org}`;
  const [result, setResult] = useState<{ key: string; data?: UsageSummary; error?: string } | null>(null);
  const loading = result?.key !== key;
  const data = result?.key === key ? result.data ?? null : null;
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-usage/summary?from=${range.from}&to=${range.to}&org=${encodeURIComponent(org)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as UsageSummary;
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
  }, [key, range.from, range.to, org]);

  const orgName = useMemo(() => new Map((data?.orgs ?? []).map((o) => [o.id, o.name])), [data]);
  const users = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !s || u.user_email.includes(s) || (u.name ?? "").toLowerCase().includes(s));
  }, [data, q]);

  const columns: Column<UserUsageRow>[] = [
    { key: "user", header: "사용자", value: (u) => u.user_email, render: (u) => (
      <div><div className="font-medium">{u.name ?? u.user_email}</div>{u.name && <div className="text-muted-foreground">{u.user_email}</div>}</div>) },
    { key: "orgs", header: "조직", value: (u) => u.orgs.join(","), render: (u) => (
      <div className="flex flex-wrap gap-1">{u.orgs.map((o) => <Badge key={o} variant="outline" className="text-[10px]">{orgName.get(o) ?? o.slice(0, 8)}</Badge>)}</div>) },
    { key: "seat", header: "시트", value: (u) => u.seat_tier ?? "" },
    { key: "cost", header: "비용", align: "right", value: (u) => u.cost_usd, render: (u) => usd(u.cost_usd) },
    { key: "sessions", header: "세션", align: "right", value: (u) => u.sessions, render: (u) => int(u.sessions) },
    { key: "prompts", header: "프롬프트", align: "right", value: (u) => u.prompts, render: (u) => int(u.prompts) },
    { key: "days", header: "활성일", align: "right", value: (u) => u.active_days },
    { key: "in", header: "입력 토큰", align: "right", value: (u) => u.input_tokens, render: (u) => int(u.input_tokens) },
    { key: "out", header: "출력 토큰", align: "right", value: (u) => u.output_tokens, render: (u) => int(u.output_tokens) },
    { key: "cache", header: "캐시 읽기", align: "right", value: (u) => u.cache_read_tokens, render: (u) => int(u.cache_read_tokens) },
    { key: "loc", header: "라인 +/−", align: "right", value: (u) => u.loc_added, render: (u) => `${int(u.loc_added)} / ${int(u.loc_removed)}` },
    { key: "accept", header: "수락률", align: "right", value: (u) => acceptRate(u.edits_accepted, u.edits_rejected), render: (u) => { const r = acceptRate(u.edits_accepted, u.edits_rejected); return r === null ? "—" : `${r}%`; } },
    { key: "commits", header: "커밋", align: "right", value: (u) => u.commits, render: (u) => int(u.commits) },
    { key: "prs", header: "PR", align: "right", value: (u) => u.pull_requests, render: (u) => int(u.pull_requests) },
    { key: "active", header: "활성 시간", align: "right", value: (u) => u.active_user_seconds, render: (u) => hours(u.active_user_seconds) },
  ];

  const exportCsv = () => {
    if (!data) return;
    const head = ["email", "name", "orgs", "seat_tier", "cost_usd", "sessions", "prompts", "active_days", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "loc_added", "loc_removed", "edits_accepted", "edits_rejected", "commits", "pull_requests", "active_user_seconds"];
    const lines = users.map((u) => [u.user_email, u.name ?? "", u.orgs.map((o) => orgName.get(o) ?? o).join("|"), u.seat_tier ?? "", u.cost_usd.toFixed(4), u.sessions, u.prompts, u.active_days, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens, u.loc_added, u.loc_removed, u.edits_accepted, u.edits_rejected, u.commits, u.pull_requests, Math.round(u.active_user_seconds)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claude-code-usage-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 조직</SelectItem>
            {(data?.orgs ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일/이름 검색" className="h-8 w-[200px] text-xs" />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {[
            ["비용", usd(t.cost_usd)], ["활성 사용자", int(t.active_users)], ["세션", int(t.sessions)],
            ["수락 라인", int(t.loc_added)], ["수락률", (() => { const r = acceptRate(t.edits_accepted, t.edits_rejected); return r === null ? "—" : `${r}%`; })()],
            ["커밋 / PR", `${int(t.commits)} / ${int(t.pull_requests)}`],
          ].map(([k, v]) => (
            <Card key={k}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></CardContent></Card>
          ))}
        </div>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2"><CardHeader className="pb-2"><CardTitle className="text-sm">일별 비용</CardTitle></CardHeader>
            <CardContent><DailyBars data={data.daily} valueKey="cost_usd" label="USD / 일" format={usd} /></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">모델별 비용</CardTitle></CardHeader>
            <CardContent>
              <HBar
                showPct={false}
                formatValue={usd}
                items={data.models.slice(0, 8).map((m) => ({ label: m.model, value: m.cost_usd, pct: data.totals.cost_usd ? Math.round((m.cost_usd / data.totals.cost_usd) * 100) : 0 }))}
              />
            </CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">사용자별 Claude Code 사용량 ({users.length}명)</CardTitle></CardHeader>
        <CardContent>
          <SortableTable rows={users} columns={columns} rowKey={(u) => u.user_email} defaultSort={{ key: "cost", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "아직 수집된 데이터가 없습니다. 조직·설정 탭에서 관리형 설정을 적용하세요."} />
        </CardContent>
      </Card>
    </div>
  );
}
