"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import HourHeatmap from "@/components/shared/HourHeatmap";
import { int } from "@/components/admin/claude-usage/format";
import { offHoursShare } from "@/lib/work-metrics/hourly";
import type { HourlyKind, HourlyResponse } from "@/types/work-metrics";

const KIND_LABEL: Record<HourlyKind, string> = { commit: "커밋(authored)", issue: "이슈 해결", mr: "MR 머지" };
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** 활동 시간대 탭 — apiPath는 성과 API 경로(…/perf), 여기에 /hourly를 붙인다. 조직 화면은 팀 합계만, 개인 화면은 본인만 */
export default function PerfHourlyTab({ apiPath, from, to, team, isSelf }: { apiPath: string; from: string; to: string; team: string; isSelf: boolean }) {
  const [kind, setKind] = useState<HourlyKind>("commit");
  const [result, setResult] = useState<{ key: string; data?: HourlyResponse; error?: string } | null>(null);
  const key = `${from}|${to}|${team}|${kind}`;
  useEffect(() => {
    let cancelled = false;
    const teamQs = team !== "all" ? `&team=${encodeURIComponent(team)}` : "";
    fetch(`${apiPath}/hourly?from=${from}&to=${to}&kinds=${kind}${teamQs}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as HourlyResponse; })
      .then((j) => { if (!cancelled) setResult({ key, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [apiPath, from, to, team, kind, key]);
  const loading = result?.key !== key;
  const data = result?.data ?? null;
  const share = useMemo(() => offHoursShare(data?.cells ?? []), [data]);
  const heat = useMemo(() => (data?.cells ?? []).map((c) => ({ dow: c.dow, hour: c.hour, value: c.n })), [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_LABEL) as HourlyKind[]).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Button>
        ))}
        {data && <span className="text-xs text-muted-foreground">{data.scope.scopeLabel}</span>}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {result?.error && result.key === key && <p className="text-sm text-destructive">{result.error}</p>}
      {data?.notReady && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">시간대 집계 함수가 아직 없습니다 — docs/sql/2026-09-28-work-items.sql을 적용하세요.</p>}
      {data?.suppressed && <p className="rounded-md border p-2 text-xs text-muted-foreground">대상이 3명 미만이라 시간대는 표시하지 않습니다.</p>}
      {data && !data.suppressed && !data.notReady && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{KIND_LABEL[kind]}</div><div className="mt-1 text-lg font-semibold tabular-nums">{int(share.total)}건</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">업무시간 외 비중</div><div className="mt-1 text-lg font-semibold tabular-nums">{pct(share.offShare)}</div><div className="text-[11px] text-muted-foreground">평일 09~18시 밖 + 주말</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">주말 비중</div><div className="mt-1 text-lg font-semibold tabular-nums">{pct(share.weekendShare)}</div></div>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">시간대별 활동 (KST · {KIND_LABEL[kind]})</CardTitle>
              <p className="text-xs text-muted-foreground">{isSelf ? "내 활동만 집계합니다." : "팀·조직 합계입니다. 개인별 시간대는 표시하지 않습니다."} 커밋은 authored 시각, 이슈는 해결 시각, MR은 머지 시각 기준.</p>
            </CardHeader>
            <CardContent><HourHeatmap cells={heat} unit="건" /></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
