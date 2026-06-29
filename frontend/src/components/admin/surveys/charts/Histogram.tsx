"use client";

export interface HistogramProps {
  bins: { label: string; n: number }[];
  meanLine?: number;
  unit?: string;
}

export default function Histogram({ bins, meanLine, unit }: HistogramProps) {
  const max = Math.max(1, ...bins.map((b) => b.n));
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1 h-28">
        {bins.map((b) => (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted-foreground">{b.n}</span>
            <div
              className="w-full rounded-t bg-sky-500/70"
              style={{ height: `${(b.n / max) * 100}%`, minHeight: b.n > 0 ? 2 : 0 }}
            />
            <span className="text-[10px] text-muted-foreground/70 text-center">{b.label}</span>
          </div>
        ))}
      </div>
      {meanLine !== undefined && (
        <p className="text-[10px] text-muted-foreground">
          평균 {meanLine}
          {unit ? ` ${unit}` : ""}
        </p>
      )}
    </div>
  );
}
