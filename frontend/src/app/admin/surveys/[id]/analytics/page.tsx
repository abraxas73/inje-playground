"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Download, BarChart3, Briefcase } from "lucide-react";
import SegmentFilterBar from "@/components/admin/surveys/SegmentFilterBar";
import QuestionAggregateCard from "@/components/admin/surveys/QuestionAggregateCard";
import SummaryView from "@/components/admin/surveys/SummaryView";
import { createClient } from "@/lib/supabase";
import type { KpiContext } from "@/lib/survey-metrics";
import type { SurveyWithQuestions, SurveyResultSummary, SegmentFilter, QuestionAggregate } from "@/types/survey";

// 섹션 기반 모수 라벨: S0(공통/전수) → 전체, 그 외(S1~S4 사용자 문항) → 사용자
function populationLabelFor(section: string | null): string {
  return section && section.toUpperCase().startsWith("S0") ? "전체" : "사용자";
}

export default function SurveyAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [survey, setSurvey] = useState<SurveyWithQuestions | null>(null);
  const [summary, setSummary] = useState<SurveyResultSummary | null>(null);
  const [segments, setSegments] = useState<SegmentFilter[]>([]);
  const [costCtx, setCostCtx] = useState<KpiContext>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/surveys/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("설문 로드 실패");
        return r.json();
      })
      .then((d) => setSurvey(d))
      .catch((e) => setError(e instanceof Error ? e.message : "설문 로드 실패"));
  }, [id]);

  // ROI 비용 컨텍스트(app_settings) — 실패 시 기본값 폴백(graceful)
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("app_settings")
          .select("key, value")
          .in("key", ["survey_hourly_cost", "survey_annual_license_cost"]);
        const map = Object.fromEntries(
          (data ?? []).map((r: { key: string; value: unknown }) => [r.key, Number(r.value)])
        );
        setCostCtx({
          hourly_cost: Number.isFinite(map.survey_hourly_cost) ? map.survey_hourly_cost : undefined,
          annual_license_cost: Number.isFinite(map.survey_annual_license_cost)
            ? map.survey_annual_license_cost
            : undefined,
        });
      } catch {
        // 네트워크 실패 시 기본값 폴백 유지
      }
    })();
  }, []);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = segments.length > 0 ? `?segments=${encodeURIComponent(JSON.stringify(segments))}` : "";
      const res = await fetch(`/api/admin/surveys/${id}/analytics${qs}`);
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "집계 조회 실패");
      }
      setSummary(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [id, segments]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const segmentQuestions = useMemo(
    () =>
      (survey?.questions ?? []).filter(
        (q) => q.config.segment === true && (q.type === "single_choice" || q.type === "multi_choice")
      ),
    [survey]
  );

  const sections = useMemo(() => {
    const map = new Map<string, QuestionAggregate[]>();
    for (const q of summary?.questions ?? []) {
      const key = q.section ?? "기타";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(q);
    }
    return [...map.entries()];
  }, [summary]);

  const exportHref = (scope: string) => `/api/admin/surveys/${id}/export?format=csv&scope=${scope}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{survey?.title ?? "설문 분석"}</h2>
          {summary && (
            <p className="text-xs text-muted-foreground">
              응답 {summary.total_responses}건 · 완료율 {summary.complete_rate}% ·
              평균 {summary.avg_duration_sec ? Math.round(summary.avg_duration_sec / 60) : "-"}분
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportHref("raw")} download>
              <Download className="h-3.5 w-3.5 mr-1" /> 원본 CSV
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={exportHref("all")} download>
              <Download className="h-3.5 w-3.5 mr-1" /> 전체 CSV
            </a>
          </Button>
        </div>
      </div>

      <SegmentFilterBar segmentQuestions={segmentQuestions} value={segments} onChange={setSegments} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">집계 중...</span>
        </div>
      ) : summary ? (
        <Tabs defaultValue="dashboard">
          <TabsList>
            <TabsTrigger value="dashboard">
              <BarChart3 className="h-3.5 w-3.5 mr-1" /> 집계 대시보드
            </TabsTrigger>
            <TabsTrigger value="summary">
              <Briefcase className="h-3.5 w-3.5 mr-1" /> 경영 요약
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6 pt-4">
            {sections.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">집계할 문항이 없습니다.</p>
            )}
            {sections.map(([section, items]) => (
              <div key={section} className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">{section}</h3>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {items.map((agg) => (
                    <QuestionAggregateCard
                      key={agg.question_id}
                      aggregate={agg}
                      populationLabel={populationLabelFor(agg.section)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="summary" className="pt-4">
            <SummaryView summary={summary} context={costCtx} />
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">집계 데이터가 없습니다.</CardContent>
        </Card>
      )}
    </div>
  );
}
