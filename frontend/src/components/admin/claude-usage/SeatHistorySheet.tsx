"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import SortableTable, { type Column } from "./SortableTable";
import { fmtDateTime } from "./format";
import type { SeatAction } from "@/types/claude-seat";

const STATUS_KO: Record<SeatAction["status"], string> = { requested: "대기", running: "적용 중", done: "완료", failed: "실패", cancelled: "취소" };

/** 시트 작업 이력 — email이 있으면 그 사람만, 없으면 전체(검색 가능). GET /api/admin/claude-usage/seat-actions */
export default function SeatHistorySheet({ open, onOpenChange, email, orgName }: { open: boolean; onOpenChange: (o: boolean) => void; email: string | null; orgName: Map<string, string> }) {
  /** open·email이 바뀔 때마다 새 key — 검색어를 email로 리셋하고 이전 결과를 화면에서 밀어낸다(렌더 중 조정, 이펙트에서 동기 setState 금지) */
  const key = `${open}|${email ?? ""}`;
  const [q, setQ] = useState(email ?? "");
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) { setPrevKey(key); setQ(email ?? ""); }
  const [result, setResult] = useState<{ key: string; rows?: SeatAction[]; error?: string } | null>(null);
  const rows = result?.key === key ? result.rows ?? null : null;
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/admin/claude-usage/seat-actions?limit=500${email ? `&email=${encodeURIComponent(email)}` : ""}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j.rows as SeatAction[]; })
      .then((r) => { if (alive) setResult({ key, rows: r }); })
      .catch((e) => { if (alive) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [open, email, key]);

  const s = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !s || r.email.includes(s) || r.requested_by_email.toLowerCase().includes(s));
  const columns: Column<SeatAction>[] = [
    { key: "at", header: "요청 시각", value: (r) => r.requested_at, render: (r) => fmtDateTime(r.requested_at) },
    { key: "org", header: "조직", value: (r) => orgName.get(r.org_id) ?? r.org_id, render: (r) => <Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge> },
    { key: "email", header: "대상", value: (r) => r.email },
    { key: "action", header: "작업", value: (r) => r.action, render: (r) => (r.action === "unassign" ? "해제" : `할당 → ${r.target_tier}`) },
    { key: "tier", header: "전 → 후", value: (r) => `${r.before_tier ?? ""}→${r.after_tier ?? ""}`, render: (r) => (r.before_tier || r.after_tier ? `${r.before_tier ?? "?"} → ${r.after_tier ?? "?"}` : <span className="text-muted-foreground">—</span>) },
    { key: "by", header: "요청자", value: (r) => r.requested_by_email },
    { key: "status", header: "상태", value: (r) => r.status, render: (r) => <span title={r.error ?? (r.finished_at ? fmtDateTime(r.finished_at) : "")} className={r.status === "failed" ? "text-destructive" : r.status === "done" ? "text-emerald-700 dark:text-emerald-300" : ""}>{STATUS_KO[r.status]}</span> },
    { key: "err", header: "사유", value: (r) => r.error ?? "", render: (r) => <span className="text-muted-foreground">{r.error ?? ""}</span> },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>시트 작업 이력{email ? ` — ${email}` : ""}</SheetTitle>
          <SheetDescription>해제·할당 요청과 실행 결과. 삭제되지 않고 남습니다(감사 로그에도 기록).</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3 px-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="대상·요청자 이메일 검색" className="h-8 w-[260px] text-xs" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {rows === null && !error ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <SortableTable rows={shown} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "at", dir: "desc" }} emptyText="이력이 없습니다." />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
