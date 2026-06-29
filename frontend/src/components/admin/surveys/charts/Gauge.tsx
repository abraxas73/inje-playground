"use client";

export interface GaugeProps {
  value: number;
  min: number;
  max: number;
  label?: string;
  target?: number;
  variant?: "scale" | "nps";
}

export default function Gauge({ value, min, max, label, target, variant = "scale" }: GaugeProps) {
  const span = max - min || 1;
  const pos = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const targetPos =
    target !== undefined ? Math.min(100, Math.max(0, ((target - min) / span) * 100)) : null;
  const color = variant === "nps" ? "bg-violet-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
      </div>
      <div className="relative h-2.5 rounded-full bg-muted">
        <div className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${pos}%` }} />
        {targetPos !== null && (
          <div
            className="absolute -top-1 h-4.5 w-0.5 bg-amber-500"
            style={{ left: `${targetPos}%` }}
            title={`목표 ${target}`}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/70">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
