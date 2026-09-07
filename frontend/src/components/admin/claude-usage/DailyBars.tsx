"use client";

/** 일별 막대 — data[valueKey](숫자)를 그린다. 비용·세션·활성 사용자·턴 등 어떤 숫자 키든 쓸 수 있다 */
export default function DailyBars<K extends string>({ data, valueKey, label, format }: {
  data: ({ day: string } & Record<K, number>)[];
  valueKey: K;
  label: string;
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const w = 720;
  const h = 140;
  const pad = 4;
  const bw = data.length ? (w - pad * 2) / data.length : 0;
  const step = Math.ceil(data.length / 8);
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
              {(i === 0 || i === data.length - 1 || (i % step === 0 && data.length - 1 - i >= step / 2)) && (
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
