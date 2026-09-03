"use client";

import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildPeriodOptions, periodLabel } from "@/lib/claude-usage/csv-periods";
import type { CsvImport } from "@/types/claude-usage";

/**
 * CSV 데이터 기간 선택 — 업로드된 CSV의 종료일(as-of)별 옵션. value는 "latest" 또는 period_end(YYYY-MM-DD).
 * 어느 기간의 통계인지 화면에 드러나도록 "최신 기간"에도 실제 날짜를 붙인다.
 */
export default function PeriodSelect({ value, onChange, imports, className }: { value: string; onChange: (v: string) => void; imports: CsvImport[]; className?: string }) {
  const options = useMemo(() => buildPeriodOptions(imports), [imports]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-8 w-[300px] text-xs"}><SelectValue placeholder="데이터 기간" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="latest">최신 기간{options[0] ? ` (${periodLabel(options[0])})` : ""}</SelectItem>
        {options.map((o) => <SelectItem key={o.end} value={o.end}>{periodLabel(o)} · {o.orgs}개 조직</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
