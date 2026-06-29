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

    case "number":
      return (
        <Histogram
          bins={[
            { label: "min", n: aggregate.stats.min ?? 0 },
            { label: "mean", n: Math.round(aggregate.stats.mean ?? 0) },
            { label: "max", n: aggregate.stats.max ?? 0 },
          ]}
          meanLine={aggregate.stats.mean ?? undefined}
          unit={aggregate.stats.unit ?? undefined}
        />
      );

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
