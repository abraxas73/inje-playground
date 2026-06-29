"use client";

import KpiCard from "./KpiCard";
import { buildKpiCards, type KpiContext } from "@/lib/survey-metrics";
import type { SurveyResultSummary } from "@/types/survey";

export interface SummaryViewProps {
  summary: SurveyResultSummary;
  context?: KpiContext;
}

export default function SummaryView({ summary, context }: SummaryViewProps) {
  const cards = buildKpiCards(summary, context ?? {});
  const roiCard = cards.find((c) => c.id === "weekly_hours_saved");
  return (
    <div className="space-y-6 print:space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <KpiCard key={c.id} card={c} />
        ))}
      </div>

      {roiCard && !roiCard.unset && (
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="text-sm font-semibold mb-1">ROI 요약</p>
          <p className="text-lg font-bold">{roiCard.display}</p>
          {roiCard.secondary && <p className="text-xs text-muted-foreground">{roiCard.secondary}</p>}
          <p className="mt-2 text-[10px] text-muted-foreground/70">
            절감시간 × 사용인원(절감시간 응답 n) × 인건비(app_settings) − 라이센스 비용(app_settings).
            자기보고 기반 추정치이며 S1Q1·S2Q2와 합산 금지.
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/70">
        총 응답 {summary.total_responses}건 · 완료율 {summary.complete_rate}% · 모든 지표는 익명 집계(n&lt;5 마스킹).
        사용자 모수 카드의 n은 스킵 로직상 사용자 응답자 수.
      </p>
    </div>
  );
}
