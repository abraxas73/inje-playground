"use client";

export interface PrePostBarsProps {
  beforeMean: number;
  afterMean: number;
  delta: number;
  improvementPct: number | null;
  nPairwise: number;
  scaleMax: number;
}

export default function PrePostBars({
  beforeMean, afterMean, delta, improvementPct, nPairwise, scaleMax,
}: PrePostBarsProps) {
  const safeMax = scaleMax || 1;
  const bar = (label: string, v: number, color: string) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <div className="relative h-6 flex-1 rounded bg-muted/50">
        <div className={`absolute inset-y-0 left-0 rounded ${color}`} style={{ width: `${(v / safeMax) * 100}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums font-medium">{v}</span>
    </div>
  );
  return (
    <div className="space-y-2">
      {bar("도입 전", beforeMean, "bg-slate-400")}
      {bar("현재", afterMean, "bg-emerald-500")}
      <div className="flex items-center gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          Δ {delta >= 0 ? "+" : ""}{delta}
          {improvementPct !== null ? ` (${improvementPct}%)` : ""}
        </span>
        <span className="text-[10px] text-muted-foreground/70">pairwise n={nPairwise}</span>
      </div>
    </div>
  );
}
