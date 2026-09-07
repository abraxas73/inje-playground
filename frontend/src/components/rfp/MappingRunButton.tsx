"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import MappingRunDialog, { type MappingRunArgs, type MappingRunSolution } from "@/components/rfp/MappingRunDialog";
import { STALE_RUNNING_MS } from "@/lib/rfp/mapping/types";
import type { RfpProjectDetail } from "@/types/rfp";

/** 개요 카드의 "솔루션 매핑 실행" — 프로젝트 전체 스코프로 공용 실행 레이어를 연다. */
export default function MappingRunButton({ project, catalogReady, llmAvailable, maxCandidates, solutions, onRun }: {
  project: RfpProjectDetail; catalogReady: boolean; llmAvailable: boolean; maxCandidates: number;
  solutions: MappingRunSolution[];
  onRun: (args: MappingRunArgs) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (project.mappingStatus !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [project.mappingStatus]);

  const running = project.mappingStatus === "running" && Date.now() - Date.parse(project.updatedAt) <= STALE_RUNNING_MS;
  const editedRequirements = new Set(project.mappings.filter((m) => m.edited).map((m) => m.requirementId)).size;
  const mapped = new Set(project.mappings.map((m) => m.requirementId));
  const missing = project.requirements.filter((r) => !mapped.has(r.id)).length;
  const disabled = busy || running || project.status !== "ready" || !catalogReady;
  const title = !catalogReady ? "카탈로그가 비어 있습니다. 관리자에게 문의하세요." : project.status !== "ready" ? "요구사항 추출이 끝난 뒤 실행할 수 있습니다." : undefined;

  return (
    <>
      <Button size="sm" variant="secondary" disabled={disabled} title={title} onClick={() => setOpen(true)}>
        {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
        {running ? "매핑 중" : "솔루션 매핑 실행"}
      </Button>
      {open && (
      <MappingRunDialog
        open
        onOpenChange={setOpen}
        scope={{ kind: "project", requirementCount: project.requirements.length, missing, editedRequirements, hasAny: project.mappings.length > 0 }}
        solutions={solutions}
        llmAvailable={llmAvailable}
        defaultMaxCandidates={maxCandidates}
        busy={busy}
        onRun={async (args) => {
          setBusy(true);
          try {
            await onRun(args);
            setOpen(false);
          } finally {
            setBusy(false);
          }
        }}
      />
      )}
    </>
  );
}
