"use client";

import { Fragment, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, SquareTerminal } from "lucide-react";
import SortableTable, { sumBy, type Column } from "@/components/admin/claude-usage/SortableTable";
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
  scope: { scope: "self" | "org"; scopeLabel: string };
  totals: DailyMetrics & { active_days: number };
  users: UserRow[];
  daily: { day: string; cost_usd: number; sessions: number; prompts: number }[];
}
interface ToolRow { tool: string; calls: number; errors: number; duration_ms_sum: number; accepts: number; rejects: number; users: number }
interface HourCell { dow: number; hour: number; requests: number; cost_usd: number }

/** mcp__server__tool → server:tool 축약 */
function toolLabel(t: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}
const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

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

  const [tools, setTools] = useState<{ key: string; rows?: ToolRow[]; notReady?: boolean } | null>(null);
  const [hourly, setHourly] = useState<{ key: string; cells?: HourCell[]; notReady?: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/usage/tools?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTools({ key: requestKey, rows: j.rows ?? [], notReady: j.notReady }); })
      .catch(() => { if (!cancelled) setTools({ key: requestKey, rows: [] }); });
    fetch(`/api/usage/hourly?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setHourly({ key: requestKey, cells: j.cells ?? [], notReady: j.notReady }); })
      .catch(() => { if (!cancelled) setHourly({ key: requestKey, cells: [] }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, requestKey]);
  const toolRows = tools?.key === requestKey ? tools.rows ?? [] : [];
  const hourCells = hourly?.key === requestKey ? hourly.cells ?? [] : [];
  const maxCellReq = Math.max(1, ...hourCells.map((c) => c.requests));

  const t = data?.totals;
  const accept = t ? acceptRate(t.edits_accepted, t.edits_rejected) : null;
  const maxDayCost = Math.max(0.01, ...(data?.daily ?? []).map((d) => d.cost_usd));
  const isTeamView = (data?.users.length ?? 0) > 1;

  const columns: Column<UserRow>[] = [
    { key: "user", header: "구성원", value: (r) => r.name ?? r.email, render: (r) => (
      <div><div className="font-medium">{r.name ?? r.email.split("@")[0]}</div><div className="text-muted-foreground">{r.email}</div></div>) },
    { key: "cost", header: "비용", align: "right", value: (r) => r.cost_usd, render: (r) => usd(r.cost_usd) , total: (rows) => usd(sumBy(rows, (r) => r.cost_usd)) },
    { key: "days", header: "활동일", align: "right", value: (r) => r.active_days, render: (r) => int(r.active_days) , total: "sum" },
    { key: "sessions", header: "세션", align: "right", value: (r) => r.sessions, render: (r) => int(r.sessions) , total: "sum" },
    { key: "prompts", header: "프롬프트 (사람 / 자동)", align: "right", value: (r) => r.prompts - r.prompts_auto, render: (r) => `${int(r.prompts - r.prompts_auto)} / ${int(r.prompts_auto)}`, total: (rows) => `${int(sumBy(rows, (r) => r.prompts) - sumBy(rows, (r) => r.prompts_auto))} / ${int(sumBy(rows, (r) => r.prompts_auto))}` },
    { key: "commits", header: "커밋", align: "right", value: (r) => r.commits, render: (r) => int(r.commits) , total: "sum" },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests, render: (r) => int(r.pull_requests) , total: "sum" },
    { key: "accept", header: "수락률", align: "right", value: (r) => acceptRate(r.edits_accepted, r.edits_rejected) ?? -1, render: (r) => { const a = acceptRate(r.edits_accepted, r.edits_rejected); return a === null ? "—" : `${a}%`; } , total: (rows) => { const a = acceptRate(sumBy(rows, (r) => r.edits_accepted), sumBy(rows, (r) => r.edits_rejected)); return a === null ? "—" : `${a}%`; } },
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
          <Stat label="세션" value={int(t.sessions)} sub={`프롬프트 ${int(t.prompts - t.prompts_auto)} (자동 ${int(t.prompts_auto)})`} />
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

      {toolRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">도구 사용 (상위 {Math.min(15, toolRows.length)}개)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1 text-left">도구</th>
                    <th className="px-2 py-1 text-right">호출</th>
                    <th className="px-2 py-1 text-right">실패율</th>
                    <th className="px-2 py-1 text-right">평균 소요</th>
                    <th className="px-2 py-1 text-right">수락/거절</th>
                    {isTeamView && <th className="px-2 py-1 text-right">사용 인원</th>}
                  </tr>
                </thead>
                <tbody>
                  {toolRows.slice(0, 15).map((t) => (
                    <tr key={t.tool} className="border-t">
                      <td className="px-2 py-1 font-medium">{toolLabel(t.tool)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{int(t.calls)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.calls ? `${Math.round((t.errors / t.calls) * 100)}%` : "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.calls ? `${(t.duration_ms_sum / t.calls / 1000).toFixed(1)}s` : "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.accepts + t.rejects > 0 ? `${int(t.accepts)}/${int(t.rejects)}` : "—"}</td>
                      {isTeamView && <td className="px-2 py-1 text-right tabular-nums">{int(t.users)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {hourCells.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">시간대 패턴 (KST · 요일×시각 요청 수)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div className="grid min-w-[560px] grid-cols-[28px_repeat(24,1fr)] gap-[2px] text-[9px] text-muted-foreground">
                <div />
                {Array.from({ length: 24 }, (_, hh) => <div key={hh} className="text-center">{hh % 3 === 0 ? hh : ""}</div>)}
                {DOW_LABELS.map((label, di) => (
                  <Fragment key={label}>
                    <div className="flex items-center">{label}</div>
                    {Array.from({ length: 24 }, (_, hh) => {
                      const cell = hourCells.find((x) => x.dow === di + 1 && x.hour === hh);
                      const a = cell ? Math.max(0.12, cell.requests / maxCellReq) : 0;
                      return <div key={hh} className="aspect-square rounded-[2px]" title={`${label} ${hh}시 · 요청 ${cell?.requests ?? 0}`} style={{ backgroundColor: a ? `rgba(79,70,229,${a})` : "var(--muted)" }} />;
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && !error && t && t.sessions === 0 && (
        <p className="text-sm text-muted-foreground">기간 내 수집된 사용량이 없습니다. Claude Code에서 관리형 설정을 승인하고 재시작한 뒤부터 집계됩니다.</p>
      )}
    </div>
  );
}
