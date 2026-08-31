"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, SquareTerminal } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { usd, int } from "@/components/admin/claude-usage/format";
import { acceptRate, dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import type { DailyMetrics } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

type UserRow = { email: string; name: string | null; team: string | null; active_days: number } & DailyMetrics;
interface Resp {
  range: { from: string; to: string };
  scope: { scope: "self" | "team" | "unit"; scopeLabel: string };
  totals: DailyMetrics & { active_days: number };
  users: UserRow[];
  daily: { day: string; cost_usd: number; sessions: number; prompts: number }[];
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function MyCodeUsagePage() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
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

  const t = data?.totals;
  const accept = t ? acceptRate(t.edits_accepted, t.edits_rejected) : null;
  const maxDayCost = Math.max(0.01, ...(data?.daily ?? []).map((d) => d.cost_usd));
  const isTeamView = (data?.users.length ?? 0) > 1;

  const columns: Column<UserRow>[] = [
    { key: "user", header: "구성원", value: (r) => r.name ?? r.email, render: (r) => (
      <div><div className="font-medium">{r.name ?? r.email.split("@")[0]}</div><div className="text-muted-foreground">{r.email}</div></div>) },
    { key: "cost", header: "비용", align: "right", value: (r) => r.cost_usd, render: (r) => usd(r.cost_usd) },
    { key: "days", header: "활동일", align: "right", value: (r) => r.active_days, render: (r) => int(r.active_days) },
    { key: "sessions", header: "세션", align: "right", value: (r) => r.sessions, render: (r) => int(r.sessions) },
    { key: "prompts", header: "프롬프트", align: "right", value: (r) => r.prompts, render: (r) => int(r.prompts) },
    { key: "commits", header: "커밋", align: "right", value: (r) => r.commits, render: (r) => int(r.commits) },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests, render: (r) => int(r.pull_requests) },
    { key: "accept", header: "수락률", align: "right", value: (r) => acceptRate(r.edits_accepted, r.edits_rejected) ?? -1, render: (r) => { const a = acceptRate(r.edits_accepted, r.edits_rejected); return a === null ? "—" : `${a}%`; } },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 md:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <SquareTerminal className="h-5 w-5" />내 Claude Code 사용량
          {data && <Badge variant="secondary" className="ml-1">{data.scope.scopeLabel}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">관리형 설정 OTel로 수집된 본인{data?.scope.scope !== "self" ? "·팀" : ""} 사용량입니다. 팀장·본부장은 소속 구성원까지 보입니다.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {t && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="비용" value={usd(t.cost_usd)} />
          <Stat label="세션" value={int(t.sessions)} sub={`프롬프트 ${int(t.prompts)}`} />
          <Stat label="커밋 · PR" value={`${int(t.commits)} · ${int(t.pull_requests)}`} />
          <Stat label="편집 수락률" value={accept === null ? "—" : `${accept}%`} sub={`수락 ${int(t.edits_accepted)} / 거절 ${int(t.edits_rejected)}`} />
        </div>
      )}

      {(data?.daily.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">일별 비용</CardTitle></CardHeader>
          <CardContent>
            <div className="flex h-24 items-end gap-[2px]">
              {data!.daily.map((d) => (
                <div key={d.day} className="flex-1 rounded-t bg-primary/60" title={`${d.day} · ${usd(d.cost_usd)} · 세션 ${d.sessions}`} style={{ height: `${Math.max(2, Math.round((d.cost_usd / maxDayCost) * 100))}%` }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{data!.daily[0]?.day}</span><span>{data!.daily.at(-1)?.day}</span></div>
          </CardContent>
        </Card>
      )}

      {isTeamView && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별 ({data!.users.length}명)</CardTitle></CardHeader>
          <CardContent>
            <SortableTable rows={data!.users} columns={columns} rowKey={(r) => r.email} defaultSort={{ key: "cost", dir: "desc" }} emptyText="데이터가 없습니다." />
          </CardContent>
        </Card>
      )}

      {!loading && !error && t && t.sessions === 0 && (
        <p className="text-sm text-muted-foreground">기간 내 수집된 사용량이 없습니다. Claude Code에서 관리형 설정을 승인하고 재시작한 뒤부터 집계됩니다.</p>
      )}
    </div>
  );
}
