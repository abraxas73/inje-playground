"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessagesSquare } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { int } from "@/components/admin/claude-usage/format";

interface Row {
  email: string;
  employee_name: string | null;
  last_active: string | null;
  days_active: number;
  chats: number;
  messages: number;
  code_sessions: number;
  pull_requests: number;
  cowork_sessions: number;
  cowork_messages: number;
  projects_used: number;
  artifacts_created: number;
}
interface Resp { period: { from: string; to: string } | null; scope: { scope: string; scopeLabel: string }; rows: Row[] }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** 같은 사람이 여러 Claude 조직에 있으면 행이 여러 개 → 이메일 단위 합산 */
function mergeByEmail(rows: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const r of rows) {
    const k = r.email.toLowerCase();
    const prev = map.get(k);
    if (!prev) { map.set(k, { ...r }); continue; }
    prev.days_active = Math.max(prev.days_active, r.days_active);
    prev.last_active = [prev.last_active, r.last_active].filter(Boolean).sort().at(-1) ?? null;
    prev.chats += r.chats; prev.messages += r.messages; prev.code_sessions += r.code_sessions;
    prev.pull_requests += r.pull_requests; prev.cowork_sessions += r.cowork_sessions;
    prev.cowork_messages += r.cowork_messages; prev.projects_used += r.projects_used;
    prev.artifacts_created += r.artifacts_created;
  }
  return [...map.values()];
}

export default function MyChatUsagePage() {
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = "chat";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage/chat")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, []);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const merged = useMemo(() => mergeByEmail(data?.rows ?? []), [data]);
  const mine = useMemo(() => merged.length === 1 ? merged[0] : null, [merged]);
  const totals = useMemo(() => merged.reduce((a, r) => ({
    chats: a.chats + r.chats, messages: a.messages + r.messages, code: a.code + r.code_sessions,
    cowork: a.cowork + r.cowork_sessions, cwmsg: a.cwmsg + r.cowork_messages,
    proj: a.proj + r.projects_used, art: a.art + r.artifacts_created,
  }), { chats: 0, messages: 0, code: 0, cowork: 0, cwmsg: 0, proj: 0, art: 0 }), [merged]);

  const columns: Column<Row>[] = [
    { key: "user", header: "구성원", value: (r) => r.employee_name ?? r.email, render: (r) => (
      <div><div className="font-medium">{r.employee_name ?? r.email.split("@")[0]}</div><div className="text-muted-foreground">{r.email}</div></div>) },
    { key: "last", header: "마지막 활동", value: (r) => r.last_active ?? "" },
    { key: "days", header: "활동일", align: "right", value: (r) => r.days_active, render: (r) => int(r.days_active) },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats, render: (r) => int(r.chats) },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages, render: (r) => int(r.messages) },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions, render: (r) => int(r.code_sessions) },
    { key: "cowork", header: "Cowork", align: "right", value: (r) => r.cowork_sessions, render: (r) => int(r.cowork_sessions) },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created, render: (r) => int(r.artifacts_created) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 md:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <MessagesSquare className="h-5 w-5" />내 Claude 사용량 (Chat/Cowork)
          {data && <Badge variant="secondary" className="ml-1">{data.scope.scopeLabel}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">
          claude.ai 채팅 · Cowork 활동(30일 롤링, 월간 CSV 스냅샷{data?.period ? ` · ${data.period.from} ~ ${data.period.to}` : ""}). 팀장·본부장은 소속 구성원까지 보입니다.
        </p>
      </div>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && merged.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="채팅 · 메시지" value={`${int(totals.chats)} · ${int(totals.messages)}`} />
          <Stat label="코드 세션" value={int(totals.code)} />
          <Stat label="Cowork 세션 · 메시지" value={`${int(totals.cowork)} · ${int(totals.cwmsg)}`} />
          <Stat label="프로젝트 · 아티팩트" value={`${int(totals.proj)} · ${int(totals.art)}`} />
        </div>
      )}

      {!loading && merged.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별 ({merged.length}명)</CardTitle></CardHeader>
          <CardContent>
            <SortableTable rows={merged} columns={columns} rowKey={(r) => r.email} defaultSort={{ key: "msgs", dir: "desc" }} emptyText="데이터가 없습니다." />
          </CardContent>
        </Card>
      )}

      {!loading && !error && merged.length === 0 && (
        <p className="text-sm text-muted-foreground">아직 수집된 활동이 없습니다. 월간 CSV 수집 이후 표시됩니다.</p>
      )}
      {mine && (
        <p className="text-xs text-muted-foreground">마지막 활동: {mine.last_active ?? "—"} · 활동일 {int(mine.days_active)}일</p>
      )}
    </div>
  );
}
