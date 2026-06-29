"use client";

export interface HBarItem {
  label: string;
  value: number;
  pct: number;
}
export interface HBarProps {
  items: HBarItem[];
  showPct?: boolean;
  note?: string;
}

export default function HBar({ items, showPct = true, note }: HBarProps) {
  const max = Math.max(1, ...items.map((i) => i.pct));
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate text-muted-foreground" title={it.label}>
            {it.label}
          </span>
          <div className="relative h-5 flex-1 rounded bg-muted/50">
            <div
              className="absolute inset-y-0 left-0 rounded bg-primary/80"
              style={{ width: `${(it.pct / max) * 100}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right tabular-nums">
            {it.value}
            {showPct ? ` (${it.pct}%)` : ""}
          </span>
        </div>
      ))}
      {note && <p className="text-[10px] text-muted-foreground/70">{note}</p>}
    </div>
  );
}
