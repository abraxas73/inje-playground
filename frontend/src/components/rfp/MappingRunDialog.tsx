"use client";

import { useMemo, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAPPING_CANDIDATES_MAX, MAPPING_CANDIDATES_MIN, parseMaxCandidates } from "@/lib/rfp/mapping/settings";
import type { EngineKind } from "@/lib/rfp/mapping/types";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";

export interface MappingRunSolution {
  code: string;
  name: string;
  featureCount: number;
}

/** 실행 스코프 — 프로젝트 전체 / 요구사항 하나 / 세부 항목 하나. 같은 레이어를 쓰고 대상만 달라진다. */
export type MappingRunScope =
  | { kind: "project"; requirementCount: number; missing: number; editedRequirements: number; hasAny: boolean }
  | { kind: "requirement"; reqId: string; title: string }
  | { kind: "detail"; reqId: string; detailKey: string; detailLabel: string };

export interface MappingRunArgs {
  mode: MappingMode;
  engine: EngineKind;
  solutionCodes: string[];
  maxCandidates: number;
}

/**
 * 솔루션 매핑 실행 레이어. 대상 솔루션(체크박스, 기본 모두)·엔진(Claude 키가 있을 때만)·후보 상한(어드민 기본값에서 바꿀 수 있음)을 고르고 실행한다.
 * 프로젝트 스코프는 전체/미매핑 모드 버튼을 보여주고, 요구사항·세부 항목 스코프는 그 대상만 다시 매핑한다(사람이 고친 행은 유지).
 */
export default function MappingRunDialog({ open, onOpenChange, scope, solutions, llmAvailable, defaultMaxCandidates, busy, onRun }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: MappingRunScope;
  solutions: MappingRunSolution[];
  llmAvailable: boolean;
  /** 어드민 설정값 — 이 값으로 초기화되고 사용자가 바꿀 수 있다. 레이어는 열 때 마운트되므로 매번 초기화된다 */
  defaultMaxCandidates: number;
  busy: boolean;
  onRun: (args: MappingRunArgs) => Promise<void>;
}) {
  const allCodes = useMemo(() => solutions.map((s) => s.code), [solutions]);
  const [engine, setEngine] = useState<EngineKind>("rules");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [cap, setCap] = useState(() => parseMaxCandidates(defaultMaxCandidates));
  const selected = picked ?? allCodes;
  const allSelected = selected.length === allCodes.length && allCodes.length > 0;

  const toggle = (code: string) => setPicked((cur) => {
    const base = cur ?? allCodes;
    return base.includes(code) ? base.filter((c) => c !== code) : allCodes.filter((c) => base.includes(c) || c === code);
  });

  const run = async (mode: MappingMode) => {
    await onRun({ mode, engine, solutionCodes: allSelected ? [] : selected, maxCandidates: parseMaxCandidates(cap) });
  };

  const title = scope.kind === "project"
    ? scope.hasAny ? "솔루션 매핑을 다시 실행할까요?" : "솔루션 매핑 실행"
    : scope.kind === "requirement" ? `${scope.reqId} 다시 매핑` : `${scope.reqId} 세부 ${scope.detailKey} 다시 매핑`;
  const description = scope.kind === "project"
    ? scope.editedRequirements > 0
      ? `사람이 고친 매핑이 있는 요구사항 ${scope.editedRequirements}건은 어느 방식이든 건드리지 않습니다.`
      : scope.hasAny ? "자동으로 만든 매핑(규칙 후보·Claude)은 새 결과로 교체됩니다." : "카탈로그 기능을 요구사항마다 대조합니다."
    : scope.kind === "requirement"
      ? `이 요구사항만 다시 매핑합니다(${scope.title}). 사람이 고친 행(✎)은 그대로 남고 자동 후보만 교체됩니다.`
      : `이 세부 항목만 다시 매핑합니다: ${scope.detailLabel}. 다른 항목과 사람이 고친 행은 건드리지 않습니다.`;

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
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {solutions.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>대상 솔루션 {selected.length}/{allCodes.length}</span>
                <button type="button" className="text-xs font-normal text-primary hover:underline" disabled={busy} onClick={() => setPicked(allSelected ? [] : null)}>
                  {allSelected ? "모두 해제" : "모두 선택"}
                </button>
              </div>
              <div className="grid gap-1.5 rounded-md border p-2 sm:grid-cols-2">
                {solutions.map((s) => (
                  <label key={s.code} className="flex cursor-pointer items-center gap-2 text-sm" title={`활성 기능 ${s.featureCount.toLocaleString("ko-KR")}개`}>
                    <Checkbox checked={selected.includes(s.code)} disabled={busy} onCheckedChange={() => toggle(s.code)} />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{s.featureCount.toLocaleString("ko-KR")}</span>
                  </label>
                ))}
              </div>
              {selected.length === 0 && <div className="mt-1 text-xs text-amber-700">솔루션을 하나 이상 고르세요.</div>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="mapping-cap" className="text-xs font-medium text-muted-foreground">세부 항목당 최대 후보</label>
            <Input
              id="mapping-cap" type="number" inputMode="numeric" min={MAPPING_CANDIDATES_MIN} max={MAPPING_CANDIDATES_MAX} step={1}
              value={cap} disabled={busy} className="h-8 w-16"
              onChange={(e) => setCap(e.target.value === "" ? MAPPING_CANDIDATES_MIN : Number(e.target.value))}
              onBlur={() => setCap((v) => parseMaxCandidates(v))}
            />
            <span className="text-xs text-muted-foreground">개 (기본 {defaultMaxCandidates}, 1~{MAPPING_CANDIDATES_MAX} · 솔루션당 2개까지)</span>
          </div>

          {llmAvailable ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">엔진</div>
              <div className="flex gap-2">
                {engineButton("rules", "규칙(키워드) — 기본", "카탈로그 키워드·유사도로 후보를 고릅니다")}
                {engineButton("llm", "Claude", "Claude가 충족·부분충족·설계·해당없음을 판정합니다")}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">규칙(키워드) 엔진 — 카탈로그 키워드·유사도로 후보를 고릅니다(Claude 엔진은 API 키가 있을 때 선택 가능).</div>
          )}

          <div className="grid gap-2">
            {scope.kind === "project" && scope.hasAny ? (
              <>
                <Button variant="outline" className="h-auto justify-start py-3 text-left" disabled={busy || selected.length === 0} onClick={() => run("all")}>
                  <div>
                    <div className="font-medium">전체 다시 매핑</div>
                    <div className="text-xs text-muted-foreground">사람이 고치지 않은 모든 요구사항을 다시 매핑합니다. 카탈로그가 바뀌었을 때.</div>
                  </div>
                </Button>
                <Button variant="outline" className="h-auto justify-start py-3 text-left" disabled={busy || scope.missing === 0 || selected.length === 0} onClick={() => run("missing")}>
                  <div>
                    <div className="font-medium">미매핑 {scope.missing}건만</div>
                    <div className="text-xs text-muted-foreground">매핑이 하나도 없는 요구사항만 채웁니다. 실패·중단 뒤 이어서 할 때.</div>
                  </div>
                </Button>
              </>
            ) : (
              <Button className="h-auto justify-start py-3 text-left" disabled={busy || selected.length === 0} onClick={() => run("all")}>
                <Wand2 className="mr-2 h-4 w-4" />
                <div>
                  <div className="font-medium">{scope.kind === "project" ? "매핑 실행" : "다시 매핑"}</div>
                  <div className="text-xs opacity-80">
                    {scope.kind === "project" ? `요구사항 ${scope.requirementCount}건 전체` : scope.kind === "requirement" ? "이 요구사항의 모든 세부 항목" : `세부 항목 ${scope.detailKey}`}
                  </div>
                </div>
              </Button>
            )}
          </div>
          {busy && <div className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />실행 중…</div>}
        </div>
        <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>닫기</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
