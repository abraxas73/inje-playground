"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SearchableSelect from "@/components/shared/SearchableSelect";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import SortableTable, { sumBy, type Column } from "@/components/admin/claude-usage/SortableTable";
import { usd, int } from "@/components/admin/claude-usage/format";
import { dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";

/**
 * 성과 지표 대시보드 — 개인용(/usage/perf)과 어드민(/admin/perf) 공용.
 * apiPath 응답에 teams가 있으면(어드민) 팀 필터 셀렉트를 보여준다.
 */

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

interface UserPerf {
  email: string; name: string | null; team: string | null;
  claude_cost: number; claude_sessions: number; claude_days: number; claude_commits: number; claude_prompts: number;
  active_hours: number; loc_added: number; loc_removed: number;
  issues_created: number; issues_resolved: number; story_points: number;
  cycle_hours_sum: number; cycle_count: number; lead_hours_sum: number;
  commits: number; gitlab_claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number;
  pages_created: number; pages_updated: number;
}
interface Weekly {
  week: string; claude_sessions: number; claude_cost: number; claude_commits: number; claude_prompts: number;
  issues_created: number; issues_resolved: number; story_points: number; cycle_hours_sum: number; cycle_count: number;
  commits: number; gitlab_claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number; pages_created: number; pages_updated: number;
}
interface JiraProject { key: string; issues_created: number; issues_resolved: number; story_points: number; cycle_hours_sum: number; cycle_count: number }
interface Repo { key: string; commits: number; gitlab_claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number }
interface Space { key: string; pages_created: number; pages_updated: number }
interface Resp {
  range: { from: string; to: string };
  scope: { scope: "self" | "org"; scopeLabel: string };
  teams?: string[];
  notReady: boolean;
  users: UserPerf[];
  weekly: Weekly[];
  jiraProjects: JiraProject[];
  repos: Repo[];
  spaces: Space[];
}

const h = (sum: number, count: number) => (count > 0 ? `${(sum / count).toFixed(1)}h` : "—");

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 주별 묶음 막대 — 시리즈별 상대 스케일(각자 max 기준) */
/** 시리즈는 기본적으로 각자 최대값으로 정규화한다(단위가 다른 지표 비교용). 같은 scale 키를 준 시리즈는 축을 공유해 높이를 서로 비교할 수 있다. */
function WeekBars({ weeks, series, title }: { weeks: Weekly[]; series: { label: string; cls: string; value: (w: Weekly) => number; scale?: string }[]; title: string }) {
  if (weeks.length < 2) return null;
  const groupMax = new Map<string, number>();
  series.forEach((s, i) => {
    const g = s.scale ?? `#${i}`;
    groupMax.set(g, Math.max(groupMax.get(g) ?? 1, ...weeks.map(s.value)));
  });
  const maxes = series.map((s, i) => groupMax.get(s.scale ?? `#${i}`) ?? 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {title} — {series.map((s, i) => (
            <span key={s.label}>{i > 0 && " vs "}<span className={s.cls.replace("bg-", "text-").replace("/70", "").replace("/40", "")}>{s.label}</span></span>
          ))}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-28 items-end gap-1">
          {weeks.map((w) => (
            // 컬럼 h-full 필수 — 없으면 자식 퍼센트 높이가 0으로 붕괴해 막대가 안 보임
            <div key={w.week} className="flex h-full flex-1 items-end justify-center gap-[2px]" title={`${w.week} 주 · ${series.map((s) => `${s.label} ${Math.round(s.value(w) * 10) / 10}`).join(" · ")}`}>
              {series.map((s, i) => (
                <div key={i} className={`rounded-t ${s.cls}`} style={{ width: `${Math.floor(80 / series.length)}%`, height: `${Math.max(2, Math.round((s.value(w) / maxes[i]) * 100))}%` }} />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{weeks[0]?.week} 주</span><span>{weeks.at(-1)?.week} 주</span></div>
      </CardContent>
    </Card>
  );
}

function pearson(pts: { x: number; y: number }[]): number | null {
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}

const userCell: Column<UserPerf> = {
  key: "user", header: "구성원", value: (r) => r.name ?? r.email, render: (r) => (
    <div><div className="font-medium">{r.name ?? r.email.split("@")[0]}</div><div className="text-muted-foreground">{r.email}</div></div>),
};

export default function PerfDashboard({ apiPath }: { apiPath: string }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [team, setTeam] = useState("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 400);
    return () => clearTimeout(t);
  }, [qInput]);
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}|${team}|${q}`;

  useEffect(() => {
    let cancelled = false;
    const teamQs = team !== "all" ? `&team=${encodeURIComponent(team)}` : "";
    const qQs = q ? `&q=${encodeURIComponent(q)}` : "";
    fetch(`${apiPath}?from=${range.from}&to=${range.to}${teamQs}${qQs}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [apiPath, range.from, range.to, team, q, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;
  // teams는 응답이 갈려도 흔들리지 않게 마지막으로 받은 목록을 유지
  const teams = result?.data?.teams ?? null;

  const t = useMemo(() => (data?.users ?? []).reduce(
    (a, u) => ({
      resolved: a.resolved + u.issues_resolved, created: a.created + u.issues_created, sp: a.sp + u.story_points,
      cycleSum: a.cycleSum + u.cycle_hours_sum, cycleN: a.cycleN + u.cycle_count, leadSum: a.leadSum + u.lead_hours_sum,
      commits: a.commits + u.commits, glClaude: a.glClaude + u.gitlab_claude_commits, claudeCommits: a.claudeCommits + u.claude_commits,
      opened: a.opened + u.mrs_opened, merged: a.merged + u.mrs_merged, mrLead: a.mrLead + u.mr_lead_hours_sum,
      pc: a.pc + u.pages_created, pu: a.pu + u.pages_updated,
      locA: a.locA + u.loc_added, locR: a.locR + u.loc_removed,
      cost: a.cost + u.claude_cost, sessions: a.sessions + u.claude_sessions, prompts: a.prompts + u.claude_prompts, hours: a.hours + u.active_hours,
    }),
    { resolved: 0, created: 0, sp: 0, cycleSum: 0, cycleN: 0, leadSum: 0, commits: 0, glClaude: 0, claudeCommits: 0, opened: 0, merged: 0, mrLead: 0, pc: 0, pu: 0, locA: 0, locR: 0, cost: 0, sessions: 0, prompts: 0, hours: 0 }
  ), [data]);
  // Claude 경유 비중 = GitLab 커밋 중 Co-Authored-By: Claude 커밋. 같은 모집단이라 항상 0~100%
  const claudeShare = t.commits > 0 ? Math.round((t.glClaude / t.commits) * 100) : null;
  const isTeamView = (data?.users.length ?? 0) > 1;
  const weeks = data?.weekly ?? [];
  const manyTeams = useMemo(() => new Set((data?.users ?? []).map((u) => u.team).filter(Boolean)).size > 1, [data]);

  // 코호트: 기간 내 업무일 대비 Claude 활동일 비율로 분류
  const cohorts = useMemo(() => {
    if (!data || !isTeamView) return null;
    const days = Math.max(1, Math.round((new Date(data.range.to).getTime() - new Date(data.range.from).getTime()) / 86400_000) + 1);
    const workdays = Math.max(1, Math.round((days * 5) / 7));
    const heavyMin = Math.max(3, Math.ceil(workdays / 2));
    const groups: { label: string; test: (u: UserPerf) => boolean }[] = [
      { label: `헤비 (활동 ${heavyMin}일+)`, test: (u) => u.claude_days >= heavyMin },
      { label: `라이트 (1~${heavyMin - 1}일)`, test: (u) => u.claude_days >= 1 && u.claude_days < heavyMin },
      { label: "미사용 (0일)", test: (u) => u.claude_days === 0 },
    ];
    return groups.map((g) => {
      const us = data.users.filter(g.test);
      const n = us.length || 1;
      const sum = (f: (u: UserPerf) => number) => us.reduce((a, u) => a + f(u), 0);
      return {
        label: g.label, n: us.length,
        resolved: sum((u) => u.issues_resolved) / n,
        sp: sum((u) => u.story_points) / n,
        cycle: (() => { const c = sum((u) => u.cycle_count); return c > 0 ? sum((u) => u.cycle_hours_sum) / c : null; })(),
        commits: sum((u) => u.commits) / n,
        merged: sum((u) => u.mrs_merged) / n,
        pages: sum((u) => u.pages_created + u.pages_updated) / n,
      };
    });
  }, [data, isTeamView]);

  const scatter = useMemo(() => {
    if (!data || !isTeamView) return null;
    const pts = data.users.map((u) => ({ x: u.claude_sessions, y: u.issues_resolved, label: u.name ?? u.email.split("@")[0] }));
    return { pts, r: pearson(pts) };
  }, [data, isTeamView]);

  const teamCol: Column<UserPerf>[] = manyTeams
    ? [{ key: "team", header: "팀", value: (r) => r.team ?? "", render: (r) => <span className="text-muted-foreground">{r.team ?? "—"}</span> }]
    : [];
  const jiraUserCols: Column<UserPerf>[] = [
    userCell,
    ...teamCol,
    { key: "resolved", header: "해결", align: "right", value: (r) => r.issues_resolved, render: (r) => int(r.issues_resolved) , total: "sum" },
    { key: "created", header: "생성", align: "right", value: (r) => r.issues_created, render: (r) => int(r.issues_created) , total: "sum" },
    { key: "sp", header: "SP", align: "right", value: (r) => r.story_points, render: (r) => int(Math.round(r.story_points)) , total: (rows) => int(Math.round(sumBy(rows, (r) => r.story_points))) },
    { key: "cycle", header: "사이클(평균)", align: "right", value: (r) => (r.cycle_count ? r.cycle_hours_sum / r.cycle_count : -1), render: (r) => h(r.cycle_hours_sum, r.cycle_count) , total: (rows) => h(sumBy(rows, (r) => r.cycle_hours_sum), sumBy(rows, (r) => r.cycle_count)) },
    { key: "lead", header: "리드(평균)", align: "right", value: (r) => (r.issues_resolved ? r.lead_hours_sum / r.issues_resolved : -1), render: (r) => h(r.lead_hours_sum, r.issues_resolved) , total: (rows) => h(sumBy(rows, (r) => r.lead_hours_sum), sumBy(rows, (r) => r.issues_resolved)) },
    { key: "cdays", header: "Claude 활동일", align: "right", value: (r) => r.claude_days, render: (r) => int(r.claude_days) , total: "sum" },
  ];
  const codeUserCols: Column<UserPerf>[] = [
    userCell,
    ...teamCol,
    { key: "commits", header: "커밋(GitLab)", align: "right", value: (r) => r.commits, render: (r) => int(r.commits) , total: "sum" },
    { key: "glc", header: "Claude 경유", align: "right", value: (r) => r.gitlab_claude_commits, render: (r) => int(r.gitlab_claude_commits) , total: "sum" },
    { key: "share", header: "Claude 비중", align: "right", value: (r) => (r.commits ? r.gitlab_claude_commits / r.commits : -1), render: (r) => (r.commits ? `${Math.round((r.gitlab_claude_commits / r.commits) * 100)}%` : "—") , total: (rows) => { const c = sumBy(rows, (r) => r.commits); return c ? `${Math.round((sumBy(rows, (r) => r.gitlab_claude_commits) / c) * 100)}%` : "—"; } },
    { key: "cc", header: "Claude Code 커밋", align: "right", value: (r) => r.claude_commits, render: (r) => int(r.claude_commits) , total: "sum" },
    { key: "opened", header: "MR 오픈", align: "right", value: (r) => r.mrs_opened, render: (r) => int(r.mrs_opened) , total: "sum" },
    { key: "merged", header: "MR 머지", align: "right", value: (r) => r.mrs_merged, render: (r) => int(r.mrs_merged) , total: "sum" },
    { key: "mrlead", header: "MR 리드(평균)", align: "right", value: (r) => (r.mrs_merged ? r.mr_lead_hours_sum / r.mrs_merged : -1), render: (r) => h(r.mr_lead_hours_sum, r.mrs_merged) , total: (rows) => h(sumBy(rows, (r) => r.mr_lead_hours_sum), sumBy(rows, (r) => r.mrs_merged)) },
    { key: "loc", header: "LOC(Claude)", align: "right", value: (r) => r.loc_added, render: (r) => `+${int(r.loc_added)}/-${int(r.loc_removed)}` , total: (rows) => `+${int(sumBy(rows, (r) => r.loc_added))}/-${int(sumBy(rows, (r) => r.loc_removed))}` },
  ];
  const docUserCols: Column<UserPerf>[] = [
    userCell,
    ...teamCol,
    { key: "pc", header: "문서 생성", align: "right", value: (r) => r.pages_created, render: (r) => int(r.pages_created) , total: "sum" },
    { key: "pu", header: "문서 수정", align: "right", value: (r) => r.pages_updated, render: (r) => int(r.pages_updated) , total: "sum" },
    { key: "cdays", header: "Claude 활동일", align: "right", value: (r) => r.claude_days, render: (r) => int(r.claude_days) , total: "sum" },
  ];
  const projCols: Column<JiraProject>[] = [
    { key: "key", header: "프로젝트", value: (r) => r.key, render: (r) => <span className="font-medium">{r.key}</span> },
    { key: "resolved", header: "해결", align: "right", value: (r) => r.issues_resolved, render: (r) => int(r.issues_resolved) , total: "sum" },
    { key: "created", header: "생성", align: "right", value: (r) => r.issues_created, render: (r) => int(r.issues_created) , total: "sum" },
    { key: "sp", header: "SP", align: "right", value: (r) => r.story_points, render: (r) => int(Math.round(r.story_points)) , total: (rows) => int(Math.round(sumBy(rows, (r) => r.story_points))) },
    { key: "cycle", header: "사이클(평균)", align: "right", value: (r) => (r.cycle_count ? r.cycle_hours_sum / r.cycle_count : -1), render: (r) => h(r.cycle_hours_sum, r.cycle_count) , total: (rows) => h(sumBy(rows, (r) => r.cycle_hours_sum), sumBy(rows, (r) => r.cycle_count)) },
  ];
  const repoCols: Column<Repo>[] = [
    { key: "key", header: "저장소", value: (r) => r.key, render: (r) => <span className="font-medium">{r.key}</span> },
    { key: "commits", header: "커밋", align: "right", value: (r) => r.commits, render: (r) => int(r.commits) , total: "sum" },
    { key: "glc", header: "Claude 경유", align: "right", value: (r) => r.gitlab_claude_commits, render: (r) => (r.commits ? `${int(r.gitlab_claude_commits)} (${Math.round((r.gitlab_claude_commits / r.commits) * 100)}%)` : "—") , total: "sum" },
    { key: "opened", header: "MR 오픈", align: "right", value: (r) => r.mrs_opened, render: (r) => int(r.mrs_opened) , total: "sum" },
    { key: "merged", header: "MR 머지", align: "right", value: (r) => r.mrs_merged, render: (r) => int(r.mrs_merged) , total: "sum" },
    { key: "lead", header: "MR 리드(평균)", align: "right", value: (r) => (r.mrs_merged ? r.mr_lead_hours_sum / r.mrs_merged : -1), render: (r) => h(r.mr_lead_hours_sum, r.mrs_merged) , total: (rows) => h(sumBy(rows, (r) => r.mr_lead_hours_sum), sumBy(rows, (r) => r.mrs_merged)) },
  ];
  const spaceCols: Column<Space>[] = [
    { key: "key", header: "스페이스", value: (r) => r.key, render: (r) => <span className="font-medium">{r.key}</span> },
    { key: "pc", header: "생성", align: "right", value: (r) => r.pages_created, render: (r) => int(r.pages_created) , total: "sum" },
    { key: "pu", header: "수정", align: "right", value: (r) => r.pages_updated, render: (r) => int(r.pages_updated) , total: "sum" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        {teams && (
          <>
            <SearchableSelect
              value={team}
              onChange={setTeam}
              options={[{ value: "all", label: "전체 팀" }, ...teams.map((name) => ({ value: name, label: name }))]}
              placeholder="팀"
              searchPlaceholder="팀 검색"
              className="w-[200px]"
            />
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="이름/이메일 검색"
              className="h-8 w-[180px] text-xs"
            />
          </>
        )}
        {data && <Badge variant="secondary">{data.scope.scopeLabel}</Badge>}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.notReady && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">성과 테이블이 아직 없습니다 — 관리자에게 문의하세요(docs/sql/2026-08-31-work-metrics.sql).</p>}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">요약</TabsTrigger>
          <TabsTrigger value="jira">Jira 이슈</TabsTrigger>
          <TabsTrigger value="code">코드 (GitLab)</TabsTrigger>
          <TabsTrigger value="docs">문서 (Confluence)</TabsTrigger>
          <TabsTrigger value="analysis">분석</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          {data && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="이슈 해결" value={int(t.resolved)} sub={`생성 ${int(t.created)} · SP ${int(Math.round(t.sp))}`} />
              <Stat label="사이클 타임(평균)" value={h(t.cycleSum, t.cycleN)} sub={`리드 ${h(t.leadSum, t.resolved)} (생성→해결)`} />
              <Stat label="커밋 (GitLab)" value={int(t.commits)} sub={claudeShare === null ? "Claude 경유 —" : `Claude 경유 ${claudeShare}% · Claude Code 커밋 ${int(t.claudeCommits)}`} />
              <Stat label="MR" value={`${int(t.merged)} 머지`} sub={`오픈 ${int(t.opened)} · 리드 ${h(t.mrLead, t.merged)}`} />
              <Stat label="문서" value={`${int(t.pc)}+${int(t.pu)}`} sub="생성+수정 (Confluence)" />
              <Stat label="코드 라인(Claude 세션)" value={`+${int(t.locA)}`} sub={`-${int(t.locR)} 삭제`} />
              <Stat label="Claude 투입" value={usd(t.cost)} sub={`세션 ${int(t.sessions)} · 프롬프트 ${int(t.prompts)}`} />
              <Stat label="Claude 활동 시간" value={`${int(Math.round(t.hours))}h`} sub="active time 합" />
            </div>
          )}
          <WeekBars weeks={weeks} title="주별 추이" series={[
            { label: "이슈 해결", cls: "bg-primary/70", value: (w) => w.issues_resolved },
            { label: "Claude 세션", cls: "bg-muted-foreground/40", value: (w) => w.claude_sessions },
          ]} />
        </TabsContent>

        <TabsContent value="jira" className="space-y-4">
          <WeekBars weeks={weeks} title="주별 이슈" series={[
            { label: "해결", cls: "bg-primary/70", value: (w) => w.issues_resolved, scale: "issues" },
            { label: "생성", cls: "bg-muted-foreground/40", value: (w) => w.issues_created, scale: "issues" },
          ]} />
          <WeekBars weeks={weeks} title="주별 사이클 타임(평균 h)" series={[
            { label: "사이클 h", cls: "bg-amber-500/60", value: (w) => (w.cycle_count ? Math.round((w.cycle_hours_sum / w.cycle_count) * 10) / 10 : 0) },
          ]} />
          {(data?.jiraProjects.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">프로젝트별 ({data!.jiraProjects.length})</CardTitle></CardHeader>
              <CardContent><SortableTable rows={data!.jiraProjects} columns={projCols} rowKey={(r) => r.key} defaultSort={{ key: "resolved", dir: "desc" }} emptyText="데이터가 없습니다." /></CardContent>
            </Card>
          )}
          {isTeamView && data && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별</CardTitle></CardHeader>
              <CardContent><SortableTable rows={data.users} columns={jiraUserCols} rowKey={(r) => r.email} defaultSort={{ key: "resolved", dir: "desc" }} emptyText="데이터가 없습니다." /></CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="code" className="space-y-4">
          <WeekBars weeks={weeks} title="주별 코드 산출" series={[
            { label: "커밋(GitLab)", cls: "bg-primary/70", value: (w) => w.commits, scale: "commits" },
            { label: "Claude 경유", cls: "bg-emerald-500/60", value: (w) => w.gitlab_claude_commits, scale: "commits" },
            { label: "MR 머지", cls: "bg-muted-foreground/40", value: (w) => w.mrs_merged },
          ]} />
          <p className="text-xs text-muted-foreground">
            커밋(GitLab)은 사내 GitLab 전 브랜치의 커밋(author 날짜 기준, 리베이스 중복 제거)이고, Claude 경유는 그중 <code>Co-Authored-By: Claude</code> 트레일러가 있는 커밋입니다(트레일러를 끈 사용자는 잡히지 않아 하한값).
            같은 단위인 두 막대는 같은 축, MR 머지는 별도 축입니다. 구성원별 표의 &quot;Claude Code 커밋&quot;은 Claude Code가 실행한 git commit 수(OTel)로 GitHub·로컬 저장소까지 포함하므로 GitLab 커밋과 모집단이 다릅니다.
          </p>
          {(data?.repos.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">저장소별 (상위 {data!.repos.length})</CardTitle></CardHeader>
              <CardContent><SortableTable rows={data!.repos} columns={repoCols} rowKey={(r) => r.key} defaultSort={{ key: "commits", dir: "desc" }} emptyText="데이터가 없습니다." /></CardContent>
            </Card>
          )}
          {isTeamView && data && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별</CardTitle></CardHeader>
              <CardContent><SortableTable rows={data.users} columns={codeUserCols} rowKey={(r) => r.email} defaultSort={{ key: "commits", dir: "desc" }} emptyText="데이터가 없습니다." /></CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="docs" className="space-y-4">
          <WeekBars weeks={weeks} title="주별 문서" series={[
            { label: "생성", cls: "bg-primary/70", value: (w) => w.pages_created, scale: "pages" },
            { label: "수정", cls: "bg-muted-foreground/40", value: (w) => w.pages_updated, scale: "pages" },
          ]} />
          {(data?.spaces.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">스페이스별 (상위 {data!.spaces.length})</CardTitle></CardHeader>
              <CardContent><SortableTable rows={data!.spaces} columns={spaceCols} rowKey={(r) => r.key} defaultSort={{ key: "pc", dir: "desc" }} emptyText="데이터가 없습니다." /></CardContent>
            </Card>
          )}
          {isTeamView && data && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별</CardTitle></CardHeader>
              <CardContent><SortableTable rows={data.users} columns={docUserCols} rowKey={(r) => r.email} defaultSort={{ key: "pc", dir: "desc" }} emptyText="데이터가 없습니다." /></CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          {!isTeamView && <p className="text-sm text-muted-foreground">코호트·상관 분석은 조직장 화면(구성원 2명 이상)에서 제공됩니다. 본인 데이터는 요약·Jira·코드·문서 탭에서 확인하세요.</p>}
          {cohorts && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Claude 사용 강도별 코호트 (1인 평균)</CardTitle>
                <p className="text-xs text-muted-foreground">같은 조직 안에서 Claude Code 활동일 기준으로 나눈 평균 비교입니다. 인원이 적은 코호트는 개인 편차의 영향이 큽니다.</p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50"><tr>
                      <th className="px-2 py-1 text-left">코호트</th><th className="px-2 py-1 text-right">인원</th>
                      <th className="px-2 py-1 text-right">이슈 해결</th><th className="px-2 py-1 text-right">SP</th>
                      <th className="px-2 py-1 text-right">사이클(평균)</th><th className="px-2 py-1 text-right">커밋</th>
                      <th className="px-2 py-1 text-right">MR 머지</th><th className="px-2 py-1 text-right">문서</th>
                    </tr></thead>
                    <tbody>
                      {cohorts.map((c) => (
                        <tr key={c.label} className="border-t">
                          <td className="px-2 py-1.5 font-medium">{c.label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.n}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.n ? c.resolved.toFixed(1) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.n ? c.sp.toFixed(1) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.n && c.cycle !== null ? `${c.cycle.toFixed(1)}h` : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.n ? c.commits.toFixed(1) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.n ? c.merged.toFixed(1) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.n ? c.pages.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
          {scatter && scatter.pts.length >= 3 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">상관 — Claude 세션 vs 이슈 해결 (점 = 구성원{scatter.r !== null ? ` · r=${scatter.r}` : ""})</CardTitle>
                <p className="text-xs text-muted-foreground">상관계수는 인과가 아닙니다. 헤비 유저가 원래 산출이 높은 사람일 수 있습니다(자기선택 편향).</p>
              </CardHeader>
              <CardContent>
                {(() => {
                  const W = 560, H = 220, P = 30;
                  const mx = Math.max(1, ...scatter.pts.map((p) => p.x));
                  const my = Math.max(1, ...scatter.pts.map((p) => p.y));
                  return (
                    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[560px]">
                      <line x1={P} y1={H - P} x2={W - 8} y2={H - P} stroke="currentColor" strokeOpacity="0.2" />
                      <line x1={P} y1={8} x2={P} y2={H - P} stroke="currentColor" strokeOpacity="0.2" />
                      <text x={W / 2} y={H - 6} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity="0.5">Claude 세션 (max {int(mx)})</text>
                      <text x={10} y={H / 2} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity="0.5" transform={`rotate(-90 10 ${H / 2})`}>이슈 해결 (max {int(my)})</text>
                      {scatter.pts.map((p, i) => (
                        <circle key={i} cx={P + (p.x / mx) * (W - P - 16)} cy={H - P - (p.y / my) * (H - P - 16)} r="4" className="fill-primary/60">
                          <title>{p.label} · 세션 {int(p.x)} · 이슈 {int(p.y)}</title>
                        </circle>
                      ))}
                    </svg>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
