"use client";

import { useCurrency } from "@/components/shared/currency-context";
import type { MonthlyCost } from "@/types/claude-cost";

/**
 * 월별 막대 — 세전·VAT를 한 막대에 쌓고, API 비용은 옆에 가는 막대로 따로 그린다(합계에 더하지 않는다는 규칙을 그림으로도 지킨다).
 */
export default function MonthlyBars({ data, showApi }: { data: MonthlyCost[]; showApi: boolean }) {
  const { fmt } = useCurrency();
  const peak = Math.max(0, ...data.map((m) => Math.max(m.billed.totalCents, m.apiCostCents ?? 0)));
  const max = Math.max(1, peak); // 0으로 나누지 않기 위한 눈금 기준(라벨은 실제 최대값)
  const w = 720;
  const h = 150;
  const pad = 8;
  const slot = data.length ? (w - pad * 2) / data.length : 0;
  const barW = showApi ? slot * 0.5 : slot * 0.7;
  const apiW = slot * 0.18;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>월별 청구(세전 + VAT){showApi ? " · API 비용(별도)" : ""}</span>
        <span>최대 {fmt(peak)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 18}`} className="w-full h-44" role="img" aria-label="월별 청구 금액">
        {data.map((m, i) => {
          const x = pad + i * slot + (slot - barW - (showApi ? apiW + 2 : 0)) / 2;
          const subH = (m.billed.subtotalCents / max) * h;
          const taxH = (m.billed.taxCents / max) * h;
          const apiH = ((m.apiCostCents ?? 0) / max) * h;
          return (
            <g key={m.month}>
              <rect x={x} y={h - subH} width={barW} height={subH} className="fill-primary/80">
                <title>{`${m.month} 세전 ${fmt(m.billed.subtotalCents)}`}</title>
              </rect>
              <rect x={x} y={h - subH - taxH} width={barW} height={taxH} className="fill-primary/40">
                <title>{`${m.month} VAT ${fmt(m.billed.taxCents)}`}</title>
              </rect>
              {showApi && (
                <rect x={x + barW + 2} y={h - apiH} width={apiW} height={apiH} className="fill-amber-500/70">
                  <title>{`${m.month} API 비용 ${fmt(m.apiCostCents ?? 0)}`}</title>
                </rect>
              )}
              <text x={pad + i * slot + slot / 2} y={h + 13} textAnchor="middle" className="fill-muted-foreground" fontSize="9">{m.month.slice(2)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
