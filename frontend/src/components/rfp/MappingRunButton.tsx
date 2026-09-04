"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STALE_RUNNING_MS } from "@/lib/rfp/mapping/types";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
import type { RfpProjectDetail } from "@/types/rfp";

export default function MappingRunButton({ project, catalogReady, onRun }: { project: RfpProjectDetail; catalogReady: boolean; onRun: (mode: MappingMode) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (project.mappingStatus !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [project.mappingStatus]);

  const running = project.mappingStatus === "running" && Date.now() - Date.parse(project.updatedAt) <= STALE_RUNNING_MS;
  const hasAny = project.mappings.length > 0;
  const editedRequirements = new Set(project.mappings.filter((m) => m.edited).map((m) => m.requirementId)).size;
  const mapped = new Set(project.mappings.map((m) => m.requirementId));
  const missing = project.requirements.filter((r) => !mapped.has(r.id)).length;
  const disabled = busy || running || project.status !== "ready" || !catalogReady;
  const title = !catalogReady ? "카탈로그가 비어 있습니다. 관리자에게 문의하세요." : project.status !== "ready" ? "요구사항 추출이 끝난 뒤 실행할 수 있습니다." : undefined;

  const run = async (mode: MappingMode) => {
    setBusy(true);
    try {
      await onRun(mode);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" disabled={disabled} title={title} onClick={() => (hasAny ? setOpen(true) : run("all"))}>
        {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
        {running ? "매핑 중" : "솔루션 매핑 실행"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>솔루션 매핑을 다시 실행할까요?</DialogTitle>
            <DialogDescription>
              {editedRequirements > 0
                ? `사람이 고친 매핑이 있는 요구사항 ${editedRequirements}건은 어느 방식이든 건드리지 않습니다.`
                : "Claude가 만든 매핑은 새 결과로 교체됩니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button variant="outline" className="h-auto justify-start py-3 text-left" disabled={busy} onClick={() => run("all")}>
              <div>
                <div className="font-medium">전체 다시 매핑</div>
                <div className="text-xs text-muted-foreground">사람이 고치지 않은 모든 요구사항을 다시 매핑합니다. 카탈로그가 바뀌었을 때.</div>
              </div>
            </Button>
            <Button variant="outline" className="h-auto justify-start py-3 text-left" disabled={busy || missing === 0} onClick={() => run("missing")}>
              <div>
                <div className="font-medium">미매핑 {missing}건만</div>
                <div className="text-xs text-muted-foreground">매핑이 하나도 없는 요구사항만 채웁니다. 실패·중단 뒤 이어서 할 때.</div>
              </div>
            </Button>
          </div>
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>닫기</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
