"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { usd, int } from "@/components/admin/claude-usage/format";
import { dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

interface UserPerf {
  email: string; name: string | null; team: string | null;
  claude_cost: number; claude_sessions: number; claude_days: number; claude_commits: number;
  issues_created: number; issues_resolved: number; story_points: number;
  cycle_hours_sum: number; cycle_count: number; lead_hours_sum: number;
  commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number;
  pages_created: number; pages_updated: number;
}
interface Weekly { week: string; claude_sessions: number; claude_cost: number; issues_resolved: number; commits: number; mrs_merged: number; pages: number }
interface Resp { range: { from: string; to: string }; scope: { scope: string; scopeLabel: string }; notReady: boolean; users: UserPerf[]; weekly: Weekly[] }

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const h = (sum: number, count: number) => (count > 0 ? `${(sum / count).toFixed(1)}h` : "—");

export default function MyPerfPage() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/usage/perf?from=${range.from}&to=${range.to}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const t = (data?.users ?? []).reduce(
    (a, u) => ({
      resolved: a.resolved + u.issues_resolved, created: a.created + u.issues_created,
      cycleSum: a.cycleSum + u.cycle_hours_sum, cycleN: a.cycleN + u.cycle_count,
      commits: a.commits + u.commits, claudeCommits: a.claudeCommits + u.claude_commits,
      merged: a.merged + u.mrs_merged, mrLead: a.mrLead + u.mr_lead_hours_sum,
      pages: a.pages + u.pages_created + u.pages_updated,
      cost: a.cost + u.claude_cost, sessions: a.sessions + u.claude_sessions,
    }),
    { resolved: 0, created: 0, cycleSum: 0, cycleN: 0, commits: 0, claudeCommits: 0, merged: 0, mrLead: 0, pages: 0, cost: 0, sessions: 0 }
  );
  const claudeShare = t.commits > 0 ? Math.min(100, Math.round((t.claudeCommits / t.commits) * 100)) : null;
  const maxWeekIssues = Math.max(1, ...(data?.weekly ?? []).map((w) => w.issues_resolved));
  const maxWeekSessions = Math.max(1, ...(data?.weekly ?? []).map((w) => w.claude_sessions));
  const isTeamView = (data?.users.length ?? 0) > 1;

  const columns: Column<UserPerf>[] = [
    { key: "user", header: "구성원", value: (r) => r.name ?? r.email, render: (r) => (
      <div><div className="font-medium">{r.name ?? r.email.split("@")[0]}</div><div className="text-muted-foreground">{r.email}</div></div>) },
    { key: "claude", header: "Claude 활동일", align: "right", value: (r) => r.claude_days, render: (r) => int(r.claude_days) },
    { key: "cost", header: "Claude 비용", align: "right", value: (r) => r.claude_cost, render: (r) => usd(r.claude_cost) },
    { key: "resolved", header: "이슈 해결", align: "right", value: (r) => r.issues_resolved, render: (r) => int(r.issues_resolved) },
    { key: "cycle", header: "사이클(평균)", align: "right", value: (r) => (r.cycle_count ? r.cycle_hours_sum / r.cycle_count : -1), render: (r) => h(r.cycle_hours_sum, r.cycle_count) },
    { key: "commits", header: "커밋(전체)", align: "right", value: (r) => r.commits, render: (r) => int(r.commits) },
    { key: "ccommits", header: "커밋(Claude)", align: "right", value: (r) => r.claude_commits, render: (r) => int(r.claude_commits) },
    { key: "merged", header: "MR 머지", align: "right", value: (r) => r.mrs_merged, render: (r) => int(r.mrs_merged) },
    { key: "mrlead", header: "MR 리드(평균)", align: "right", value: (r) => (r.mrs_merged ? r.mr_lead_hours_sum / r.mrs_merged : -1), render: (r) => h(r.mr_lead_hours_sum, r.mrs_merged) },
    { key: "pages", header: "문서", align: "right", value: (r) => r.pages_created + r.pages_updated, render: (r) => `${int(r.pages_created)}+${int(r.pages_updated)}` },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 md:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <TrendingUp className="h-5 w-5" />성과 지표
          {data && <Badge variant="secondary" className="ml-1">{data.scope.scopeLabel}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">
          Claude 투입(비용·세션) 대비 업무 산출 — Jira 이슈, GitLab 커밋·MR, Confluence 문서. 팀장·본부장은 소속 구성원까지 보입니다. 상관관계이며 인과를 뜻하지 않습니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.notReady && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">성과 테이블이 아직 없습니다 — 관리자에게 문의하세요(docs/sql/2026-08-31-work-metrics.sql).</p>}

      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="이슈 해결" value={int(t.resolved)} sub={`생성 ${int(t.created)}`} />
          <Stat label="사이클 타임(평균)" value={h(t.cycleSum, t.cycleN)} sub="진행 시작→해결" />
          <Stat label="커밋" value={int(t.commits)} sub={claudeShare === null ? "Claude 경유 —" : `Claude 경유 ${claudeShare}%`} />
          <Stat label="MR 머지" value={int(t.merged)} sub={`리드 ${h(t.mrLead, t.merged)}`} />
          <Stat label="문서(생성+수정)" value={int(t.pages)} sub={`Claude ${usd(t.cost)} · 세션 ${int(t.sessions)}`} />
        </div>
      )}

      {(data?.weekly.length ?? 0) > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">주별 추이 — <span className="text-primary">이슈 해결</span> vs <span className="text-muted-foreground">Claude 세션</span></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-28 items-end gap-1">
              {data!.weekly.map((w) => (
                <div key={w.week} className="flex flex-1 items-end justify-center gap-[2px]" title={`${w.week} 주 · 이슈 ${w.issues_resolved} · 세션 ${w.claude_sessions} · 커밋 ${w.commits}`}>
                  <div className="w-1/3 rounded-t bg-primary/70" style={{ height: `${Math.max(2, Math.round((w.issues_resolved / maxWeekIssues) * 100))}%` }} />
                  <div className="w-1/3 rounded-t bg-muted-foreground/40" style={{ height: `${Math.max(2, Math.round((w.claude_sessions / maxWeekSessions) * 100))}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{data!.weekly[0]?.week} 주</span><span>{data!.weekly.at(-1)?.week} 주</span></div>
          </CardContent>
        </Card>
      )}

      {isTeamView && data && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별 ({data.users.length}명)</CardTitle></CardHeader>
          <CardContent>
            <SortableTable rows={data.users} columns={columns} rowKey={(r) => r.email} defaultSort={{ key: "resolved", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다."} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
