"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import SortableTable, { type Column } from "./SortableTable";
import { usd, int } from "./format";
import type { ClaudeOrg, CsvImport, MemberActivityRow } from "@/types/claude-usage";

type Row = MemberActivityRow & { org_id: string; import_id: string; employee_name?: string | null; team?: string | null; headquarters?: string | null; division?: string | null };
interface MembersResponse { imports: CsvImport[]; rows: Row[] }

/** 조직도 팀(없으면 본부→부문) 단위로 채팅·Cowork 활동(CSV) 합계 */
interface TeamRow {
  team: string;
  parent: string | null;
  users: number;
  active_users: number;
  chats: number;
  messages: number;
  code_sessions: number;
  cowork_sessions: number;
  cowork_messages: number;
  projects_used: number;
  artifacts_created: number;
  spend_usd: number;
}

export default function ChatTeamSummaryTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [org, setOrg] = useState("all");
  const [result, setResult] = useState<{ key: string; data?: MembersResponse; error?: string } | null>(null);
  const requestKey = org;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/claude-usage/members?org=${encodeURIComponent(org)}&importId=latest`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as MembersResponse; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [org, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  /** 조직별 최신 import의 데이터 기간 — 표 설명용 */
  const period = useMemo(() => {
    const latest = new Map<string, CsvImport>();
    for (const i of data?.imports ?? []) if (!latest.has(i.org_id)) latest.set(i.org_id, i);
    if (latest.size === 0) return null;
    const vals = [...latest.values()];
    return { from: vals.map((v) => v.period_start).sort()[0], to: vals.map((v) => v.period_end).sort().at(-1)! };
  }, [data]);

  const rows = useMemo(() => {
    const map = new Map<string, TeamRow>();
    for (const u of data?.rows ?? []) {
      const team = u.team ?? "명부 없음";
      const parent = u.team ? (u.headquarters && u.headquarters !== u.team ? u.headquarters : (u.division ?? null) !== u.team ? u.division ?? null : null) : null;
      let t = map.get(team);
      if (!t) {
        t = { team, parent, users: 0, active_users: 0, chats: 0, messages: 0, code_sessions: 0, cowork_sessions: 0, cowork_messages: 0, projects_used: 0, artifacts_created: 0, spend_usd: 0 };
        map.set(team, t);
      }
      t.users += 1;
      if (u.days_active > 0) t.active_users += 1;
      t.chats += u.chats;
      t.messages += u.messages;
      t.code_sessions += u.code_sessions;
      t.cowork_sessions += u.cowork_sessions;
      t.cowork_messages += u.cowork_messages;
      t.projects_used += u.projects_used;
      t.artifacts_created += u.artifacts_created;
      t.spend_usd += u.estimated_spend_usd;
    }
    return [...map.values()];
  }, [data]);

  const maxMessages = Math.max(1, ...rows.map((r) => r.messages));
  const columns: Column<TeamRow>[] = [
    { key: "team", header: "팀 / 센터", value: (r) => r.team, render: (r) => (
      <div><div className="font-medium">{r.team}</div>{r.parent && <div className="text-muted-foreground">{r.parent}</div>}</div>) },
    { key: "users", header: "사용자", align: "right", value: (r) => r.users, render: (r) => `${r.active_users}/${r.users}` },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages, render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-2 rounded bg-primary/20" style={{ width: `${Math.max(2, Math.round((r.messages / maxMessages) * 90))}px` }} />
        <span>{int(r.messages)}</span>
      </div>) },
    { key: "msgsPerUser", header: "메시지/인", align: "right", value: (r) => (r.active_users ? r.messages / r.active_users : 0), render: (r) => (r.active_users ? int(Math.round(r.messages / r.active_users)) : "—") },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats, render: (r) => int(r.chats) },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions, render: (r) => int(r.code_sessions) },
    { key: "cowork", header: "Cowork 세션", align: "right", value: (r) => r.cowork_sessions, render: (r) => int(r.cowork_sessions) },
    { key: "cwmsg", header: "Cowork 메시지", align: "right", value: (r) => r.cowork_messages, render: (r) => int(r.cowork_messages) },
    { key: "proj", header: "프로젝트", align: "right", value: (r) => r.projects_used, render: (r) => int(r.projects_used) },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created, render: (r) => int(r.artifacts_created) },
    { key: "spend", header: "초과 지출", align: "right", value: (r) => r.spend_usd, render: (r) => usd(r.spend_usd) },
  ];

  const exportCsv = () => {
    const head = ["team", "parent", "active_users", "users", "chats", "messages", "code_sessions", "cowork_sessions", "cowork_messages", "projects_used", "artifacts_created", "spend_usd"];
    const lines = rows.map((r) => [r.team, r.parent ?? "", r.active_users, r.users, r.chats, r.messages, r.code_sessions, r.cowork_sessions, r.cowork_messages, r.projects_used, r.artifacts_created, r.spend_usd.toFixed(2)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claude-chat-by-team${period ? `-${period.from}-to-${period.to}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Claude 조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Claude 조직(최신 기간)</SelectItem>
            {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {period && <span className="text-xs text-muted-foreground">데이터 기간 {period.from} ~ {period.to} (조직별 최신 CSV)</span>}
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">팀별 채팅 · Cowork 활동 ({rows.length}개 팀 · 사내 조직도 기준)</CardTitle>
          <p className="text-xs text-muted-foreground">팀 = 조직도 말단 부서(팀·센터). &quot;사용자&quot;는 기간 내 활동일이 있는 인원/전체. 여러 Claude 조직에 속한 계정은 조직별 행이 합산되며, 명부에 없는 이메일은 &quot;명부 없음&quot;으로 묶입니다.</p>
        </CardHeader>
        <CardContent>
          <SortableTable rows={rows} columns={columns} rowKey={(r) => r.team} defaultSort={{ key: "msgs", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "업로드된 CSV가 없습니다."} />
        </CardContent>
      </Card>
    </div>
  );
}
