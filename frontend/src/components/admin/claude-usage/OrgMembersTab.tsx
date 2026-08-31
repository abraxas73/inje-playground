"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import UnitFilter, { matchUnit } from "@/components/admin/claude-usage/UnitFilter";
import type { ClaudeOrg } from "@/types/claude-usage";

/** claude.ai 관리자 설정 > 멤버 화면 스냅샷 한 행 (+ 사내 조직도 조인) */
interface OrgMemberRow {
  org_id: string;
  email: string;
  name: string | null;
  role: string | null;
  seat_tier: string | null;
  status: "active" | "pending";
  synced_at: string;
  employee_name: string | null;
  team: string | null;
  headquarters: string | null;
  division: string | null;
}
interface Resp { rows: OrgMemberRow[]; lastByOrg: Record<string, string> }

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/\. /g, "-").replace(/\.$/, "").replace(/-(\d{2}:\d{2})/, " $1");
}

export default function OrgMembersTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [result, setResult] = useState<{ key: number; data?: Resp; error?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [org, setOrg] = useState("all");
  const [status, setStatus] = useState("all");
  const [unit, setUnit] = useState("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/claude-usage/org-members")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: reloadKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: reloadKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [reloadKey]);
  const loading = result?.key !== reloadKey;
  const data = result?.data ?? null;
  const error = result?.key === reloadKey ? result.error ?? null : null;

  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      (org === "all" || r.org_id === org) &&
      (status === "all" || r.status === status) &&
      matchUnit(r, unit) &&
      (!s || [r.email, r.name, r.employee_name, r.team].some((v) => (v ?? "").toLowerCase().includes(s)))
    );
  }, [data, org, status, unit, q]);

  const counts = useMemo(() => ({
    active: rows.filter((r) => r.status === "active").length,
    pending: rows.filter((r) => r.status === "pending").length,
  }), [rows]);
  const lastSynced = useMemo(() => {
    const vals = Object.values(data?.lastByOrg ?? {});
    return vals.length ? vals.sort().at(-1)! : null;
  }, [data]);

  const columns: Column<OrgMemberRow>[] = [
    { key: "user", header: "사용자 (Claude)", value: (r) => r.email, render: (r) => (<div><div className="font-medium">{r.name || r.email}</div>{r.name && <div className="text-muted-foreground">{r.email}</div>}</div>) },
    { key: "employee", header: "이름", value: (r) => r.employee_name ?? "", render: (r) => (r.employee_name ? <span title="사내 조직도(아마란스) 이름">{r.employee_name}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "team", header: "조직 / 팀", value: (r) => `${r.headquarters ?? r.division ?? ""} ${r.team ?? ""}`.trim(), render: (r) => (r.team
      ? <div title={[r.division, r.headquarters, r.team].filter(Boolean).join(" > ")}><div>{r.team}</div>{(r.headquarters ?? r.division) && (r.headquarters ?? r.division) !== r.team && <div className="text-muted-foreground">{r.headquarters ?? r.division}</div>}</div>
      : <span className="text-muted-foreground">—</span>) },
    { key: "org", header: "Claude 조직", value: (r) => orgName.get(r.org_id) ?? r.org_id, render: (r) => <Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge> },
    { key: "role", header: "역할", value: (r) => r.role ?? "" },
    { key: "tier", header: "티어", value: (r) => r.seat_tier ?? "", render: (r) => r.seat_tier ?? <span className="text-muted-foreground">—</span> },
    { key: "status", header: "상태", value: (r) => r.status, render: (r) => (r.status === "pending"
      ? <Badge className="border-amber-200 bg-amber-50 text-amber-800" variant="outline">대기 중</Badge>
      : <Badge className="border-green-200 bg-green-50 text-green-700" variant="outline">활성</Badge>) },
    { key: "synced", header: "수집", value: (r) => r.synced_at, render: (r) => <span className="text-muted-foreground">{fmtDateTime(r.synced_at)}</span> },
  ];

  const exportCsv = () => {
    const head = ["org", "email", "claude_name", "employee_name", "team", "headquarters", "division", "role", "seat_tier", "status", "synced_at"];
    const lines = rows.map((r) => [orgName.get(r.org_id) ?? r.org_id, r.email, r.name ?? "", r.employee_name ?? "", r.team ?? "", r.headquarters ?? "", r.division ?? "", r.role ?? "", r.seat_tier ?? "", r.status, r.synced_at]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claude-org-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Claude 조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Claude 조직</SelectItem>
            {orgs.filter((o) => o.id !== "unknown" && o.id !== "test-org").map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="pending">대기 중(초대 미수락)</SelectItem>
            <SelectItem value="active">활성</SelectItem>
          </SelectContent>
        </Select>
        <UnitFilter value={unit} onChange={setUnit} rows={data?.rows ?? []} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일/이름 검색" className="h-8 w-[200px] text-xs" />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
        <Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)}>새로고침</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">
              멤버 · 초대 상태 ({rows.length}명 — 활성 {counts.active} · <span className="text-amber-700">대기 중 {counts.pending}</span>)
            </CardTitle>
            <p className="text-xs text-muted-foreground">마지막 수집: {fmtDateTime(lastSynced)}{data && Object.keys(data.lastByOrg).length ? ` · ${Object.keys(data.lastByOrg).length}개 조직` : ""}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            <b>대기 중</b> = 초대했지만 아직 수락하지 않아 시트를 못 쓰는 사람(claude.ai 관리자 설정 › 멤버 › 대기 중). <b>노는 시트</b>(채팅·Cowork 탭)는 활성인데 30일 사용이 0인 경우로 다른 축입니다. 수집: <code>/claude-usage-csv</code> 실행 시 함께 갱신.
          </p>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={rows}
            columns={columns}
            rowKey={(r) => `${r.org_id}:${r.email}`}
            defaultSort={{ key: "status", dir: "desc" }}
            rowClassName={(r) => (r.status === "pending" ? "bg-amber-50/50" : "")}
            emptyText={loading ? "불러오는 중..." : "아직 수집된 멤버 상태가 없습니다. /claude-usage-csv를 실행하세요."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
