"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { KpiCardData } from "@/lib/survey-metrics";

export interface KpiCardProps {
  card: KpiCardData;
}

const TRAFFIC: Record<KpiCardData["traffic"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  unset: "bg-slate-300",
};

export default function KpiCard({ card }: KpiCardProps) {
  return (
    <Card className={card.unset ? "opacity-60" : ""}>
      <CardContent className="py-4 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
          <span className={`h-2.5 w-2.5 rounded-full ${TRAFFIC[card.traffic]}`} title={card.traffic} />
        </div>
        <p className="text-2xl font-bold tabular-nums">{card.display}</p>
        {card.secondary && <p className="text-[11px] text-muted-foreground">{card.secondary}</p>}
        <div className="flex items-center justify-between pt-1">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
            모수: {card.population_label}
          </span>
        </div>
        {card.note && <p className="text-[10px] text-muted-foreground/70">⚠ {card.note}</p>}
      </CardContent>
    </Card>
  );
}
