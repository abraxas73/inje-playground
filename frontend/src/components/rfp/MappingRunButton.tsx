"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { STALE_RUNNING_MS, type EngineKind } from "@/lib/rfp/mapping/types";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
import type { RfpProjectDetail } from "@/types/rfp";

/** 실행 다이얼로그: 모드(전체 / 미매핑) + 엔진 선택은 Claude 키가 있을 때만 보인다(없으면 규칙 고정, 사용자 요청으로 숨김). 첫 실행에도 다이얼로그를 연다. */
export default function MappingRunButton({ project, catalogReady, llmAvailable, onRun }: {
  project: RfpProjectDetail; catalogReady: boolean; llmAvailable: boolean; onRun: (mode: MappingMode, engine: EngineKind) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<EngineKind>("rules");
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
      await onRun(mode, engine);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const engineButton = (kind: EngineKind, label: string, desc: string) => (
    <button
      type="button" disabled={busy} onClick={() => setEngine(kind)}
      className={cn("flex-1 rounded-md border p-3 text-left text-sm transition-colors", engine === kind ? "border-primary bg-muted/60" : "hover:bg-muted/30")}
    >
      <div className="font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </button>
  );

  return (
    <>
      <Button size="sm" variant="secondary" disabled={disabled} title={title} onClick={() => setOpen(true)}>
        {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
        {running ? "매핑 중" : "솔루션 매핑 실행"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasAny ? "솔루션 매핑을 다시 실행할까요?" : "솔루션 매핑 실행"}</DialogTitle>
            <DialogDescription>
              {editedRequirements > 0
                ? `사람이 고친 매핑이 있는 요구사항 ${editedRequirements}건은 어느 방식이든 건드리지 않습니다.`
                : hasAny ? "자동으로 만든 매핑(규칙 후보·Claude)은 새 결과로 교체됩니다." : "카탈로그 기능을 요구사항마다 대조합니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {llmAvailable ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">엔진</div>
                <div className="flex gap-2">
                  {engineButton("rules", "규칙(키워드) — 기본", "카탈로그 키워드·유사도로 후보를 고릅니다")}
                  {engineButton("llm", "Claude", "Claude가 충족·부분충족·설계·해당없음을 판정합니다")}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">규칙(키워드) 엔진 — 카탈로그 키워드·유사도로 후보를 고릅니다.</div>
            )}
            <div className="grid gap-2">
              {hasAny ? (
                <>
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
                </>
              ) : (
                <Button className="h-auto justify-start py-3 text-left" disabled={busy} onClick={() => run("all")}>
                  <Wand2 className="mr-2 h-4 w-4" />
                  <div>
                    <div className="font-medium">매핑 실행</div>
                    <div className="text-xs opacity-80">요구사항 {project.requirements.length}건 전체</div>
                  </div>
                </Button>
              )}
            </div>
          </div>
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>닫기</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
