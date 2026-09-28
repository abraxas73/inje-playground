"use client";

import { useMemo } from "react";
import { int } from "@/components/admin/claude-usage/format";

/** 요일×시각 히트맵(KST). dow는 isodow(1=월 … 7=일). Claude 사용량 시간대 탭과 성과 시간대 탭이 같이 쓴다 */
export interface HeatCell { dow: number; hour: number; value: number; title?: string }
const DOW = ["", "월", "화", "수", "목", "금", "토", "일"];

export default function HourHeatmap({ cells, unit, footnote }: { cells: HeatCell[]; unit: string; footnote?: string }) {
  const { grid, max, hourTotals } = useMemo(() => {
    const grid = new Map<string, HeatCell>();
    let max = 0;
    const hourTotals = Array.from({ length: 24 }, () => 0);
    for (const c of cells) {
      grid.set(`${c.dow}:${c.hour}`, c);
      max = Math.max(max, c.value);
      hourTotals[c.hour] += c.value;
    }
    return { grid, max: Math.max(1, max), hourTotals };
  }, [cells]);
  const maxHourTotal = Math.max(1, ...hourTotals);
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="pr-1 text-right text-[10px] font-normal text-muted-foreground">시</th>
            {Array.from({ length: 24 }, (_, h) => <th key={h} className="w-7 text-center text-[10px] font-normal text-muted-foreground">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
            <tr key={dow}>
              <td className={`pr-1 text-right text-[11px] ${dow >= 6 ? "text-red-500" : "text-muted-foreground"}`}>{DOW[dow]}</td>
              {Array.from({ length: 24 }, (_, h) => {
                const cell = grid.get(`${dow}:${h}`);
                const v = cell?.value ?? 0;
                const alpha = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
                return (
                  <td key={h} className="h-7 w-7 rounded-sm text-center align-middle text-[9px]"
                    style={{ backgroundColor: v === 0 ? "var(--muted)" : `rgba(79, 70, 229, ${alpha.toFixed(2)})`, color: alpha > 0.55 ? "#fff" : undefined }}
                    title={cell?.title ?? (cell ? `${DOW[dow]} ${h}시 — ${int(v)}${unit}` : `${DOW[dow]} ${h}시 — 없음`)}>
                    {v > 0 && v >= max * 0.5 ? int(v) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="pr-1 pt-1 text-right text-[10px] text-muted-foreground">합계</td>
            {hourTotals.map((v, h) => (
              <td key={h} className="pt-1 text-center align-bottom" title={`${h}시 합계 ${int(v)}${unit}`}>
                <div className="mx-auto w-4 rounded-sm bg-primary/30" style={{ height: `${Math.max(2, Math.round((v / maxHourTotal) * 28))}px` }} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">{footnote ?? `색 농도 = 해당 요일·시각의 ${unit} 수(최대 ${int(max)}${unit} 기준). 마지막 줄은 시각별 합계입니다.`}</p>
    </div>
  );
}
