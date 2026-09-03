"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface DuplicateCandidate { id: string; name: string; agency: string | null; createdAt: string }

interface Props {
  open: boolean;
  candidates: DuplicateCandidate[];
  overview: { name: string; agency: string | null } | null;
  busy: boolean;
  onRegisterNew: () => void;
  onOpenExisting: (id: string) => void;
  onCancel: () => void;
}

export default function ConfirmDuplicateDialog({ open, candidates, overview, busy, onRegisterNew, onOpenExisting, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>유사한 프로젝트가 있습니다</DialogTitle>
          <DialogDescription>
            올린 문서: <span className="font-medium text-foreground">{overview?.name ?? "-"}</span>
            {overview?.agency ? ` · ${overview.agency}` : " · 발주기관을 문서에서 찾지 못했습니다"}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.agency ?? "발주기관 미상"} · {new Date(c.createdAt).toLocaleDateString("ko-KR")} 등록</div>
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenExisting(c.id)}>기존으로 이동</Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>취소</Button>
          <Button disabled={busy} onClick={onRegisterNew}>새 프로젝트로 등록</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
