"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { UNMAPPED_LABEL, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type MappingRow, type Verdict } from "@/lib/rfp/mapping/types";
import { countBySolution, countByVerdict } from "@/lib/rfp/mapping/summary";

export type VerdictFilter = Verdict | "unmapped" | null;

/** 판정별 색. 요약 칩·배지·요구사항 ID 버튼이 같은 색을 쓴다 */
export const VERDICT_CLASS: Record<Verdict | "unmapped", string> = {
  fulfilled: "bg-emerald-100 text-emerald-900 hover:bg-emerald-200",
  partial: "bg-amber-100 text-amber-900 hover:bg-amber-200",
  candidate: "bg-indigo-100 text-indigo-900 hover:bg-indigo-200",
  build: "bg-sky-100 text-sky-900 hover:bg-sky-200",
  na: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  unmapped: "bg-rose-100 text-rose-900 hover:bg-rose-200",
};

/** 판정별 왼쪽 강조선. 세부 항목 카드가 이 색으로 "이 항목은 어떤 상태인지"를 먼저 보여준다 */
export const VERDICT_ACCENT: Record<Verdict | "unmapped", string> = {
  fulfilled: "border-l-emerald-400",
  partial: "border-l-amber-400",
  candidate: "border-l-indigo-400",
  build: "border-l-sky-400",
  na: "border-l-slate-300",
  unmapped: "border-l-rose-300",
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict | "unmapped"; className?: string }) {
  return <Badge variant="outline" className={cn("border-transparent", VERDICT_CLASS[verdict], className)}>{verdict === "unmapped" ? UNMAPPED_LABEL : VERDICT_LABEL[verdict]}</Badge>;
}

/** 표 위 요약: 판정별 건수 칩(클릭 → 필터) + 솔루션별 건수 */
export default function MappingSummary({ requirementIds, mappings, catalog, filter, onFilter }: {
  requirementIds: string[]; mappings: MappingRow[]; catalog: CatalogSolution[]; filter: VerdictFilter; onFilter: (f: VerdictFilter) => void;
}) {
  const counts = countByVerdict(requirementIds, mappings);
  const bySolution = countBySolution(mappings, catalog).filter((s) => s.fulfilled + s.partial + s.candidate > 0);
  const keys: (Verdict | "unmapped")[] = [...VERDICT_ORDER, "unmapped"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => onFilter(filter === k ? null : k)} className={cn("rounded-full ring-offset-background transition", filter === k && "ring-2 ring-ring ring-offset-1")} title="클릭하면 표를 이 판정으로 걸러 봅니다">
            <span className={cn("inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium", VERDICT_CLASS[k])}>
              {k === "unmapped" ? UNMAPPED_LABEL : VERDICT_LABEL[k]}<span className="tabular-nums">{counts[k]}</span>
            </span>
          </button>
        ))}
      </div>
      {bySolution.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {bySolution.map((s) => (
            <span key={s.code}>
              <span className="font-medium text-foreground">{s.name}</span> 충족 {s.fulfilled} · 부분 {s.partial}{s.candidate > 0 && ` · 후보 ${s.candidate}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
