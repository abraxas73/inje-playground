"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import SortableTable, { sumBy, type Column } from "./SortableTable";
import PeriodSelect from "./PeriodSelect";
import { usd, int } from "./format";
import type { ClaudeOrg, CsvImport, MemberActivityRow } from "@/types/claude-usage";
import { aggregateChatTeams, type ChatTeamRow } from "@/lib/claude-usage/chat-team-summary";

type Row = MemberActivityRow & { org_id: string; import_id: string; employee_name?: string | null; team?: string | null; parent_unit?: string | null; headquarters?: string | null; division?: string | null };
interface MembersResponse { imports: CsvImport[]; rows: Row[]; period: { start: string; end: string } | null }

type TeamRow = ChatTeamRow;

export default function ChatTeamSummaryTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [org, setOrg] = useState("all");
  const [periodEnd, setPeriodEnd] = useState("latest");
  const [result, setResult] = useState<{ key: string; data?: MembersResponse; error?: string } | null>(null);
  const requestKey = `${org}|${periodEnd}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/claude-usage/members?org=${encodeURIComponent(org)}&periodEnd=${encodeURIComponent(periodEnd)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as MembersResponse; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [org, periodEnd, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  /** 선택된 CSV들의 데이터 기간(서버 계산) — 표 설명용 */
  const period = data?.period ?? null;

  const rows = useMemo(() => aggregateChatTeams(data?.rows ?? []), [data]);

  const maxMessages = Math.max(1, ...rows.map((r) => r.messages));
  const columns: Column<TeamRow>[] = [
    { key: "team", header: "팀 / 센터", value: (r) => r.team, render: (r) => (
      <div><div className="font-medium">{r.team}</div>{r.parent && <div className="text-muted-foreground">{r.parent}</div>}</div>) },
    { key: "users", header: "활동자/시트", align: "right", value: (r) => r.users, render: (r) => <span title="기간 내 활동일이 있는 인원 / 이 팀에서 Claude 시트를 가진 인원(고유 이메일)">{`${r.active_users}/${r.users}`}</span> , total: (rows) => `${sumBy(rows, (r) => r.active_users)}/${sumBy(rows, (r) => r.users)}` },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages, render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-2 rounded bg-primary/20" style={{ width: `${Math.max(2, Math.round((r.messages / maxMessages) * 90))}px` }} />
        <span>{int(r.messages)}</span>
      </div>) , total: (rows) => int(sumBy(rows, (r) => r.messages)) },
    { key: "msgsPerUser", header: "메시지/활동자", align: "right", value: (r) => (r.active_users ? r.messages / r.active_users : 0), render: (r) => (r.active_users ? int(Math.round(r.messages / r.active_users)) : "—") , total: (rows) => { const a = sumBy(rows, (r) => r.active_users); return a ? int(Math.round(sumBy(rows, (r) => r.messages) / a)) : "—"; } },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats, render: (r) => int(r.chats) , total: "sum" },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions, render: (r) => int(r.code_sessions) , total: "sum" },
    { key: "cowork", header: "Cowork 세션", align: "right", value: (r) => r.cowork_sessions, render: (r) => int(r.cowork_sessions) , total: "sum" },
    { key: "cwmsg", header: "Cowork 메시지", align: "right", value: (r) => r.cowork_messages, render: (r) => int(r.cowork_messages) , total: "sum" },
    { key: "proj", header: "프로젝트", align: "right", value: (r) => r.projects_used, render: (r) => int(r.projects_used) , total: "sum" },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created, render: (r) => int(r.artifacts_created) , total: "sum" },
    { key: "spend", header: "초과 지출", align: "right", value: (r) => r.spend_usd, render: (r) => usd(r.spend_usd) , total: (rows) => usd(sumBy(rows, (r) => r.spend_usd)) },
  ];

  const exportCsv = () => {
    const head = ["team", "parent", "active_users", "users", "chats", "messages", "code_sessions", "cowork_sessions", "cowork_messages", "projects_used", "artifacts_created", "spend_usd"];
    const lines = rows.map((r) => [r.team, r.parent ?? "", r.active_users, r.users, r.chats, r.messages, r.code_sessions, r.cowork_sessions, r.cowork_messages, r.projects_used, r.artifacts_created, r.spend_usd.toFixed(2)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claude-chat-by-team${period ? `-${period.start}-to-${period.end}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={org} onValueChange={(v) => { setOrg(v); setPeriodEnd("latest"); }}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Claude 조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Claude 조직</SelectItem>
            {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <PeriodSelect value={periodEnd} onChange={setPeriodEnd} imports={data?.imports ?? []} />
        {period && <span className="text-xs text-muted-foreground" title="선택한 기간의 CSV 중 조직별 최신 업로드 기준">데이터 기간 {period.start} ~ {period.end}</span>}
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">팀별 채팅 · Cowork 활동 ({rows.length}개 팀 · 사내 조직도 기준)</CardTitle>
          <p className="text-xs text-muted-foreground">팀 = 조직도 말단 부서(팀·센터), 아래 줄은 팀 바로 위 조직. &quot;활동자/시트&quot;는 기간 내 활동일이 있는 인원 / 이 팀에서 Claude 시트를 가진 인원(조직도 인원과 다를 수 있음). 여러 Claude 조직에 속한 계정은 활동 수치는 합산하고 인원은 1명으로 셉니다. 명부에 없는 이메일은 &quot;명부 없음&quot;으로 묶입니다.</p>
        </CardHeader>
        <CardContent>
          <SortableTable totalLabel={`총계 (${rows.length}개 팀)`} rows={rows} columns={columns} rowKey={(r) => r.team} defaultSort={{ key: "msgs", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "업로드된 CSV가 없습니다."} />
        </CardContent>
      </Card>
    </div>
  );
}
