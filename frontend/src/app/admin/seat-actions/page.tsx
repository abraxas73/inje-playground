"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { History, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import OrgSelect from "@/components/admin/claude-usage/OrgSelect";
import SeatExecutorChip from "@/components/admin/claude-usage/SeatExecutorChip";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { fmtDateTime } from "@/components/admin/claude-usage/format";
import type { ClaudeOrg } from "@/types/claude-usage";
import type { SeatAction, SeatExecutor } from "@/types/claude-seat";

const LIMIT = 1000;
const STATUS_KO: Record<SeatAction["status"], string> = { requested: "대기", running: "적용 중", done: "완료", failed: "실패", cancelled: "취소" };
const ACTIONS = [["all", "작업: 전체"], ["unassign", "해제"], ["assign", "할당"]] as const;
type Person = { name: string; team: string | null };

/** 시트 작업 이력(claude_seat_actions) — 해제·할당 요청과 실행 결과. 멤버 표의 "이력"은 ?q=<이메일>로 들어온다 */
function SeatActionsPage() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [org, setOrg] = useState("all");
  const [status, setStatus] = useState("all");
  const [action, setAction] = useState<(typeof ACTIONS)[number][0]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orgs, setOrgs] = useState<ClaudeOrg[]>([]);
  const [data, setData] = useState<{ org: string; status: string; rows?: SeatAction[]; people?: Record<string, Person>; executor?: SeatExecutor | null; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/claude-usage/orgs").then((r) => r.json()).then((j) => setOrgs(j.orgs ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-usage/seat-actions?limit=${LIMIT}&org=${encodeURIComponent(org)}${status === "all" ? "" : `&status=${status}`}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j; })
      .then((j) => { if (alive) setData({ org, status, rows: j.rows, people: j.people ?? {}, executor: j.executor }); })
      .catch((e) => { if (alive) setData({ org, status, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [org, status]);

  const current = data?.org === org && data.status === status ? data : null;
  const people = current?.people ?? {};
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);
  const label = (email: string) => people[email.toLowerCase()]?.name ?? "";

  const s = q.trim().toLowerCase();
  const rows = (current?.rows ?? []).filter((r) => {
    if (action !== "all" && r.action !== action) return false;
    const day = new Date(Date.parse(r.requested_at) + 9 * 3600_000).toISOString().slice(0, 10); // KST 날짜
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (!s) return true;
    const p = people[r.email];
    return [r.email, r.requested_by_email, label(r.requested_by_email), p?.name, p?.team, r.error, orgName.get(r.org_id), r.target_tier, r.executor]
      .some((v) => v?.toLowerCase().includes(s));
  });

  const columns: Column<SeatAction>[] = [
    { key: "at", header: "요청 시각", value: (r) => r.requested_at, render: (r) => fmtDateTime(r.requested_at) },
    { key: "org", header: "조직", value: (r) => orgName.get(r.org_id) ?? r.org_id, render: (r) => <Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge> },
    { key: "email", header: "대상", value: (r) => r.email, render: (r) => <div>{people[r.email] && <div className="font-medium">{people[r.email].name}{people[r.email].team && <span className="ml-1 text-muted-foreground">· {people[r.email].team}</span>}</div>}<div className="text-muted-foreground">{r.email}</div></div> },
    { key: "action", header: "작업", value: (r) => r.action, render: (r) => (r.action === "unassign" ? "해제" : `할당 → ${r.target_tier}`) },
    { key: "tier", header: "전 → 후", value: (r) => `${r.before_tier ?? ""}→${r.after_tier ?? ""}`, render: (r) => (r.before_tier || r.after_tier ? `${r.before_tier ?? "?"} → ${r.after_tier ?? "?"}` : <span className="text-muted-foreground">—</span>) },
    { key: "by", header: "요청자", value: (r) => r.requested_by_email, render: (r) => label(r.requested_by_email) || r.requested_by_email },
    { key: "status", header: "상태", value: (r) => r.status, render: (r) => <span title={r.finished_at ? `종료 ${fmtDateTime(r.finished_at)}` : ""} className={r.status === "failed" ? "text-destructive" : r.status === "done" ? "text-emerald-700 dark:text-emerald-300" : ""}>{STATUS_KO[r.status]}</span> },
    { key: "err", header: "사유", value: (r) => r.error ?? "", render: (r) => <span className="text-muted-foreground">{r.error ?? ""}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><History className="h-5 w-5" />시트 작업 이력</h1>
          <p className="text-sm text-muted-foreground">Claude 시트 해제·할당 요청과 실행 결과(7일 미사용 자동 해제 포함). 삭제되지 않고 남으며 감사 로그에도 기록됩니다. 요청은 &quot;Claude 사용량 (Chat/Cowork)&quot; 멤버 표에서 합니다.</p>
        </div>
        <SeatExecutorChip executor={current?.executor} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·이메일·팀·요청자·사유 검색" className="h-8 w-[260px] text-xs" />
        <OrgSelect orgs={orgs} value={org} onChange={setOrg} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">상태: 전체</SelectItem>
            {Object.entries(STATUS_KO).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={(v) => setAction(v as typeof action)}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{ACTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          기간
          <input type="date" className="h-8 rounded-md border bg-background px-2 text-xs" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          ~
          <input type="date" className="h-8 rounded-md border bg-background px-2 text-xs" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {!current && !data?.error && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {current?.rows && <span className="text-xs text-muted-foreground">{rows.length}건{current.rows.length >= LIMIT && ` (최근 ${LIMIT}건 안에서)`}</span>}
      </div>
      {current?.error && <p className="text-sm text-destructive">{current.error}</p>}

      <Card>
        <CardContent className="pt-4">
          <SortableTable rows={rows} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "at", dir: "desc" }} emptyText={current ? "이력이 없습니다." : "불러오는 중..."} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return <Suspense><SeatActionsPage /></Suspense>;
}
