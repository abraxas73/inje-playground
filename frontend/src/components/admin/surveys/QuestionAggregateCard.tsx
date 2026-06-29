"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import HBar from "./charts/HBar";
import Gauge from "./charts/Gauge";
import Histogram from "./charts/Histogram";
import PrePostBars from "./charts/PrePostBars";
import type { QuestionAggregate } from "@/types/survey";

export interface QuestionAggregateCardProps {
  aggregate: QuestionAggregate;
  populationLabel: string;
}

export default function QuestionAggregateCard({ aggregate, populationLabel }: QuestionAggregateCardProps) {
  return (
    <Card data-testid="aggregate-card">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-snug">{aggregate.title}</CardTitle>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {populationLabel} · n={aggregate.n}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {aggregate.masked ? (
          <p className="text-xs text-muted-foreground">표본 부족(n&lt;5) — 재식별 방지를 위해 마스킹됨</p>
        ) : (
          <Body aggregate={aggregate} />
        )}
      </CardContent>
    </Card>
  );
}

function Body({ aggregate }: { aggregate: QuestionAggregate }) {
  switch (aggregate.type) {
    case "single_choice":
      return <HBar items={aggregate.options.map((o) => ({ label: o.label, value: o.n, pct: o.pct }))} />;

    case "multi_choice":
      return (
        <HBar
          items={aggregate.options.map((o) => ({ label: o.label, value: o.n, pct: o.pct }))}
          note={`복수응답 — 응답자 ${aggregate.respondent_n}명 기준 (합계 100% 초과 가능)`}
        />
      );

    case "scale":
      return (
        <div className="space-y-3">
          <Gauge
            value={aggregate.stats.mean ?? 0}
            min={aggregate.stats.min ?? 1}
            max={aggregate.stats.max ?? 5}
            label="평균"
          />
          <Histogram bins={aggregate.stats.distribution.map((d) => ({ label: String(d.value), n: d.n }))} />
          <p className="text-[10px] text-muted-foreground">
            중앙값 {aggregate.stats.median ?? "-"} · SD {aggregate.stats.sd ?? "-"}
            {aggregate.stats.top_box_pct != null ? ` · top-box ${aggregate.stats.top_box_pct}%` : ""}
          </p>
        </div>
      );

    case "nps":
      return (
        <div className="space-y-2">
          <Gauge value={aggregate.stats.score ?? 0} min={-100} max={100} label="NPS" variant="nps" />
          <HBar
            showPct={false}
            items={[
              { label: "추천(9-10)", value: aggregate.stats.promoters_pct, pct: aggregate.stats.promoters_pct },
              { label: "중립(7-8)", value: aggregate.stats.passives_pct, pct: aggregate.stats.passives_pct },
              { label: "비추천(0-6)", value: aggregate.stats.detractors_pct, pct: aggregate.stats.detractors_pct },
            ]}
          />
        </div>
      );

    case "number": {
      const s = aggregate.stats;
      const unit = s.unit ? ` ${s.unit}` : "";
      return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">평균</dt>
          <dd className="font-medium">{s.mean !== null ? `${s.mean}${unit}` : "—"}</dd>
          <dt className="text-muted-foreground">중앙값</dt>
          <dd className="font-medium">{s.median !== null ? `${s.median}${unit}` : "—"}</dd>
          <dt className="text-muted-foreground">0시간 응답 비율</dt>
          <dd className="font-medium">{s.zero_pct !== null ? `${s.zero_pct}%` : "—"}</dd>
          <dt className="text-muted-foreground">범위</dt>
          <dd className="font-medium">{s.min !== null && s.max !== null ? `${s.min}${unit} ~ ${s.max}${unit}` : "—"}</dd>
          <dt className="text-muted-foreground">응답 수</dt>
          <dd className="font-medium">{s.n}</dd>
        </dl>
      );
    }

    case "pre_post_scale":
      return (
        <PrePostBars
          beforeMean={aggregate.stats.before_mean ?? 0}
          afterMean={aggregate.stats.after_mean ?? 0}
          delta={aggregate.stats.delta_mean ?? 0}
          improvementPct={aggregate.stats.improvement_pct}
          nPairwise={aggregate.stats.n_pairwise}
          scaleMax={5}
        />
      );

    case "text":
    case "textarea":
      return <p className="text-xs text-muted-foreground">자유서술 {aggregate.text_n}건 — CSV로 전체 확인</p>;

    default: {
      const _exhaustive: never = aggregate;
      return null;
    }
  }
}
