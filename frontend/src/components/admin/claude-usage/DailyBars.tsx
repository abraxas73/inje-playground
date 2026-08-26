"use client";

export default function DailyBars({ data, valueKey, label, format }: {
  data: { day: string; cost_usd: number; sessions: number; active_users: number }[];
  valueKey: "cost_usd" | "sessions" | "active_users";
  label: string;
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const w = 720;
  const h = 140;
  const pad = 4;
  const bw = data.length ? (w - pad * 2) / data.length : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>최대 {format(max)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 16}`} className="w-full h-40" role="img" aria-label={label}>
        {data.map((d, i) => {
          const v = d[valueKey];
          const bh = (v / max) * h;
          return (
            <g key={d.day}>
              <rect x={pad + i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh} className="fill-primary/80">
                <title>{`${d.day}: ${format(v)}`}</title>
              </rect>
              {(i === 0 || i === data.length - 1 || data.length <= 14 || i % Math.ceil(data.length / 8) === 0) && (
                <text x={pad + i * bw + bw / 2} y={h + 12} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
