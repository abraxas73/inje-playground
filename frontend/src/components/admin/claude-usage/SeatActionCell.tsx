"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2 } from "lucide-react";
import { hasSeat } from "@/lib/claude-usage/aggregate";
import { normalizeTier } from "@/lib/claude-usage/seat-tier";
import type { SeatActionSummary } from "@/types/claude-seat";

export interface SeatActionRow { org_id: string; email: string; name: string; seat_tier: string; seat_action: SeatActionSummary | null }
type Pending = { action: "unassign"; target: null } | { action: "assign"; target: "Standard" | "Premium" };

/**
 * 멤버 행의 시트 액션 — 시트 있으면 "해제", 미할당이면 "할당 ▾". 대기·실행 중이면 배지(+취소), 최근 결과가 있으면 결과 배지 뒤에 버튼.
 * 요청은 POST /api/admin/claude-usage/seat-actions, 실제 반영은 관리자 Mac 실행기가 한다(스펙 §6·§7).
 */
export default function SeatActionCell({ row, orgName, onChanged }: { row: SeatActionRow; orgName: string; onChanged: () => void }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = normalizeTier(row.seat_tier);
  const a = row.seat_action;

  const submit = async () => {
    if (!pending) return;
    setBusy(true); setError(null);
    const r = await fetch("/api/admin/claude-usage/seat-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: row.org_id, email: row.email, action: pending.action, target_tier: pending.target }) });
    const j = await r.json().catch(() => ({}) as { error?: string });
    setBusy(false);
    if (!r.ok) { setError(j.error ?? `HTTP ${r.status}`); return; }
    setPending(null); onChanged();
  };
  const cancel = async () => {
    if (!a) return;
    setBusy(true);
    await fetch(`/api/admin/claude-usage/seat-actions?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
    setBusy(false);
    onChanged(); // 409(실행기가 이미 claim) 등 실패해도 다시 조회해 최신 상태를 반영
  };

  const open = a && (a.status === "requested" || a.status === "running");
  const label = (s: SeatActionSummary) => (s.action === "unassign" ? "해제" : `할당 → ${s.target_tier}`);

  return (
    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
      {open && a ? (
        <>
          <Badge variant="secondary" className="text-[10px]">{a.status === "running" ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />적용 중 · {label(a)}</> : <>대기 · {label(a)}</>}</Badge>
          {a.status === "requested" && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={cancel}>취소</Button>}
        </>
      ) : (
        <>
          {a && a.status === "done" && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 dark:text-emerald-300" title={`${label(a)} 완료`}>완료</Badge>}
          {a && a.status === "failed" && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 dark:text-red-300" title={a.error ?? "실패"}>실패</Badge>}
          {hasSeat(current) ? (
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { setError(null); setPending({ action: "unassign", target: null }); }}>해제</Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-6 px-2 text-xs">할당 ▾</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { setError(null); setPending({ action: "assign", target: "Standard" }); }}>Standard</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setError(null); setPending({ action: "assign", target: "Premium" }); }}>Premium</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.action === "unassign" ? "시트 해제" : "시트 할당"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p><b>{row.name || row.email}</b> ({row.email}) · {orgName}</p>
                <p>현재 <b>{current}</b> → <b>{pending?.action === "unassign" ? "Unassigned" : pending?.target}</b></p>
                <p className="text-muted-foreground">{pending?.action === "unassign"
                  ? "회수한 시트는 다른 멤버에게 줄 수 있습니다. 구매 좌석 수는 바뀌지 않으며 claude.ai 결제 설정에서 줄여야 합니다. 멤버는 조직에 남습니다."
                  : "빈 좌석이 없으면 실패합니다. 좌석 추가는 claude.ai 결제 설정에서 합니다."}</p>
                <p className="text-muted-foreground">요청은 관리자 Mac의 실행기가 보통 1분 안에 claude.ai에 반영합니다. 실행기가 꺼져 있으면 켜질 때까지 대기합니다.</p>
                {error && <p className="text-destructive">{error}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void submit(); }}>{busy ? "요청 중…" : "확인"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
