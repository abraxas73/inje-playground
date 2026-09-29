"use client";

import { Badge } from "@/components/ui/badge";
import { executorState } from "@/lib/claude-usage/seat-actions";
import type { SeatExecutor } from "@/types/claude-seat";

/** 관리자 Mac 실행기 상태 — 하트비트 60초 초과면 꺼짐, 세션 없으면 로그인 필요 */
export default function SeatExecutorChip({ executor }: { executor: SeatExecutor | null | undefined }) {
  const s = executorState(executor ?? null, new Date());
  const cls = s.level === "ok" ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" : s.level === "login" ? "border-red-300 text-red-700 dark:text-red-300" : "border-amber-300 text-amber-700 dark:text-amber-300";
  return <Badge variant="outline" className={`text-[10px] font-normal ${cls}`} title={executor ? `${executor.host ?? ""} ${executor.version ?? ""} ${executor.note ?? ""}`.trim() : "실행기가 한 번도 보고하지 않았습니다"}>{s.text}</Badge>;
}
