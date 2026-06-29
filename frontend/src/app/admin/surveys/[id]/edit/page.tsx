"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, Play, Square, ExternalLink } from "lucide-react";
import SurveyBuilder from "@/components/admin/surveys/SurveyBuilder";
import { default_config_for } from "@/lib/survey";
import type {
  Survey,
  SurveyQuestion,
  SurveyStatus,
  SurveyWithQuestions,
  QuestionType,
} from "@/types/survey";

const STATUS_BADGE: Record<SurveyStatus, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-slate-100 text-slate-600 border-slate-200" },
  open: { label: "진행중", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "마감", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function SurveyEditPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "조회에 실패했습니다.");
      }
      const data: SurveyWithQuestions = await res.json();
      const { questions: qs, ...meta } = data;
      setSurvey(meta as Survey);
      setQuestions(qs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddQuestion = async (type: QuestionType) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: "새 문항",
          required: false,
          config: default_config_for(type),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "문항 추가 실패");
      }
      const created: SurveyQuestion = await res.json();
      setQuestions((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  const handleQuestionChange = async (id: string, patch: Partial<SurveyQuestion>) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "문항 수정 실패");
      }
      const updated: SurveyQuestion = await res.json();
      setQuestions((prev) => prev.map((q) => (q.id === id ? updated : q)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      load();
    }
  };

  const handleReorder = async (
    items: { id: string; order_index: number; section?: string | null }[]
  ) => {
    const orderMap = new Map(items.map((it) => [it.id, it.order_index]));
    setQuestions((prev) =>
      [...prev]
        .map((q) => ({ ...q, order_index: orderMap.get(q.id) ?? q.order_index }))
        .sort((a, b) => a.order_index - b.order_index)
    );
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "순서 변경 실패");
      }
      const data = await res.json();
      setQuestions(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      load();
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "삭제 실패");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      load();
    }
  };

  const changeStatus = async (status: SurveyStatus) => {
    if (!survey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "상태 변경 실패");
      }
      const updated: Survey = await res.json();
      setSurvey(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">로딩 중...</span>
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        {error || "설문을 찾을 수 없습니다."}
      </div>
    );
  }

  const badge = STATUS_BADGE[survey.status];

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/surveys"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        설문 목록
      </Link>

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                {survey.title}
                <Badge
                  variant="outline"
                  className={`text-[10px] h-5 ${badge.className}`}
                  data-testid="survey-status-badge"
                >
                  {badge.label}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 font-mono">/survey/{survey.slug}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {survey.status !== "open" && (
                <Button size="sm" className="h-8 gap-1.5" disabled={busy} onClick={() => changeStatus("open")}>
                  <Play className="h-3.5 w-3.5" />
                  공개
                </Button>
              )}
              {survey.status === "open" && (
                <>
                  <Link href={`/survey/${survey.slug}`} target="_blank">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5">
                      <ExternalLink className="h-3.5 w-3.5" />
                      미리보기
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={busy}
                    onClick={() => changeStatus("closed")}
                  >
                    <Square className="h-3.5 w-3.5" />
                    마감
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        {survey.description && (
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">{survey.description}</p>
          </CardContent>
        )}
      </Card>

      {error && <p className="text-sm text-destructive mb-3">{error}</p>}

      <SurveyBuilder
        surveyId={surveyId}
        questions={questions}
        onReorder={handleReorder}
        onQuestionChange={handleQuestionChange}
        onAddQuestion={handleAddQuestion}
        onDeleteQuestion={handleDeleteQuestion}
      />
    </div>
  );
}
