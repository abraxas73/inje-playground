"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import SortableTable, { type Column } from "./SortableTable";
import { acceptRate, dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { usd, int } from "./format";
import type { ClaudeOrg, UsageSummary } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

/** 조직도 팀(없으면 본부→부문) 단위로 Claude Code 사용량 합계 */
interface TeamRow {
  team: string;
  parent: string | null;
  users: number;
  active_users: number;
  cost_usd: number;
  sessions: number;
  prompts: number;
  output_tokens: number;
  commits: number;
  pull_requests: number;
  edits_accepted: number;
  edits_rejected: number;
}

export default function TeamSummaryTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [org, setOrg] = useState("all");
  const [result, setResult] = useState<{ key: string; data?: UsageSummary; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}|${org}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/claude-usage/summary?from=${range.from}&to=${range.to}&org=${encodeURIComponent(org)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as UsageSummary; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, org, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const rows = useMemo(() => {
    const map = new Map<string, TeamRow>();
    for (const u of data?.users ?? []) {
      const team = u.team ?? "명부 없음";
      const parent = u.team ? (u.headquarters && u.headquarters !== u.team ? u.headquarters : u.division !== u.team ? u.division : null) : null;
      let t = map.get(team);
      if (!t) {
        t = { team, parent, users: 0, active_users: 0, cost_usd: 0, sessions: 0, prompts: 0, output_tokens: 0, commits: 0, pull_requests: 0, edits_accepted: 0, edits_rejected: 0 };
        map.set(team, t);
      }
      t.users += 1;
      if (u.sessions > 0 || u.cost_usd > 0) t.active_users += 1;
      t.cost_usd += u.cost_usd;
      t.sessions += u.sessions;
      t.prompts += u.prompts;
      t.output_tokens += u.output_tokens;
      t.commits += u.commits;
      t.pull_requests += u.pull_requests;
      t.edits_accepted += u.edits_accepted;
      t.edits_rejected += u.edits_rejected;
    }
    return [...map.values()];
  }, [data]);

  const maxCost = Math.max(1, ...rows.map((r) => r.cost_usd));
  const columns: Column<TeamRow>[] = [
    { key: "team", header: "팀 / 센터", value: (r) => r.team, render: (r) => (
      <div><div className="font-medium">{r.team}</div>{r.parent && <div className="text-muted-foreground">{r.parent}</div>}</div>) },
    { key: "users", header: "사용자", align: "right", value: (r) => r.users, render: (r) => `${r.active_users}/${r.users}` },
    { key: "cost", header: "비용", align: "right", value: (r) => r.cost_usd, render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-2 rounded bg-primary/20" style={{ width: `${Math.max(2, Math.round((r.cost_usd / maxCost) * 90))}px` }} />
        <span>{usd(r.cost_usd)}</span>
      </div>) },
    { key: "costPerUser", header: "비용/인", align: "right", value: (r) => (r.active_users ? r.cost_usd / r.active_users : 0), render: (r) => (r.active_users ? usd(r.cost_usd / r.active_users) : "—") },
    { key: "sessions", header: "세션", align: "right", value: (r) => r.sessions, render: (r) => int(r.sessions) },
    { key: "prompts", header: "프롬프트", align: "right", value: (r) => r.prompts, render: (r) => int(r.prompts) },
    { key: "out", header: "출력 토큰", align: "right", value: (r) => r.output_tokens, render: (r) => int(r.output_tokens) },
    { key: "accept", header: "수락률", align: "right", value: (r) => acceptRate(r.edits_accepted, r.edits_rejected) ?? -1, render: (r) => { const a = acceptRate(r.edits_accepted, r.edits_rejected); return a === null ? "—" : `${a}%`; } },
    { key: "commits", header: "커밋", align: "right", value: (r) => r.commits, render: (r) => int(r.commits) },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests, render: (r) => int(r.pull_requests) },
  ];

  const exportCsv = () => {
    const head = ["team", "parent", "active_users", "users", "cost_usd", "sessions", "prompts", "output_tokens", "commits", "pull_requests"];
    const lines = rows.map((r) => [r.team, r.parent ?? "", r.active_users, r.users, r.cost_usd.toFixed(4), r.sessions, r.prompts, r.output_tokens, r.commits, r.pull_requests]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claude-usage-by-team-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">팀별 Claude Code 사용량 ({rows.length}개 팀 · 사내 조직도 기준)</CardTitle>
          <p className="text-xs text-muted-foreground">팀 = 조직도 말단 부서(팀·센터). &quot;사용자&quot;는 기간 내 활동자/전체. 명부에 없는 이메일(외부 계정 등)은 &quot;명부 없음&quot;으로 묶입니다.</p>
        </CardHeader>
        <CardContent>
          <SortableTable rows={rows} columns={columns} rowKey={(r) => r.team} defaultSort={{ key: "cost", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다."} />
        </CardContent>
      </Card>
    </div>
  );
}
