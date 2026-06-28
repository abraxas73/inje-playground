"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { SurveyWithQuestions, SurveyQuestion, AnswerValue } from "@/types/survey";
import { validateAnswer, answerToColumns, emptyAnswer } from "@/lib/survey";
import { isUserResponse } from "@/lib/survey-metrics";
import QuestionRenderer from "./QuestionRenderer";

export interface SurveyFormProps {
  survey: SurveyWithQuestions;
  isAuthenticated: boolean;
  onSubmitted?: (responseId: string) => void;
}

const SKIP_SECTIONS = ["S1", "S2", "S3"];

export default function SurveyForm({ survey, isAuthenticated, onSubmitted }: SurveyFormProps) {
  // isAuthenticated is passed for future gating; consumed to avoid lint warning
  void isAuthenticated;

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const init: Record<string, AnswerValue> = {};
    for (const q of survey.questions) init[q.id] = emptyAnswer(q);
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const s0q3 = survey.questions.find((q) => q.config.analysis_metric === "s0q3_duration");
  const s0q4 = survey.questions.find((q) => q.config.analysis_metric === "s0q4_frequency");

  const nonUser = useMemo(() => {
    const v3 = s0q3 ? answers[s0q3.id] : undefined;
    const v4 = s0q4 ? answers[s0q4.id] : undefined;
    const s3 = v3 && v3.type === "single_choice" ? v3.value : null;
    const s4 = v4 && v4.type === "single_choice" ? v4.value : null;
    return !isUserResponse({ s0q3_value: s3, s0q4_value: s4 });
  }, [answers, s0q3, s0q4]);

  function isVisible(q: SurveyQuestion): boolean {
    if (!nonUser) return true;
    const sec = q.section ?? "";
    return !SKIP_SECTIONS.some((p) => sec.startsWith(p));
  }

  const visibleQuestions = survey.questions.filter(isVisible);

  const grouped = useMemo(() => {
    const map = new Map<string, SurveyQuestion[]>();
    for (const q of visibleQuestions) {
      const key = q.section ?? "기타";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(q);
    }
    return Array.from(map.entries());
  }, [visibleQuestions]);

  const answeredCount = visibleQuestions.filter((q) => {
    const r = validateAnswer(q, answers[q.id]);
    return r.ok && hasValue(answers[q.id]);
  }).length;
  const progress = visibleQuestions.length === 0 ? 0 : Math.round((answeredCount / visibleQuestions.length) * 100);

  function update(q: SurveyQuestion, v: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [q.id]: v }));
    setErrors((prev) => {
      if (!prev[q.id]) return prev;
      const next = { ...prev };
      delete next[q.id];
      return next;
    });
  }

  async function handleSubmit() {
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    for (const q of visibleQuestions) {
      const r = validateAnswer(q, answers[q.id]);
      if (!r.ok) nextErrors[q.id] = r.error ?? "응답을 확인해 주세요.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setFormError("응답하지 않았거나 잘못된 문항이 있습니다.");
      return;
    }

    setSubmitting(true);
    try {
      const payloadAnswers = visibleQuestions.map((q) => answerToColumns(q, answers[q.id]));
      const res = await fetch(`/api/surveys/${survey.slug}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: payloadAnswers,
          meta: { ua: typeof navigator !== "undefined" ? navigator.userAgent : "" },
        }),
      });
      if (res.status === 409) {
        setDuplicate(true);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError((err as { error?: string }).error || "제출에 실패했습니다.");
        return;
      }
      const data = (await res.json()) as { response_id: string };
      setDone(data.response_id);
      onSubmitted?.(data.response_id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (duplicate) {
    return (
      <Card>
        <CardContent
          className="flex flex-col items-center gap-3 py-12 text-center"
          data-testid="survey-duplicate"
        >
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="text-sm font-medium">이미 제출한 설문입니다.</p>
          <p className="text-xs text-muted-foreground">소중한 응답에 감사드립니다.</p>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardContent
          className="flex flex-col items-center gap-3 py-12 text-center"
          data-testid="survey-complete"
        >
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="text-sm font-medium">응답이 제출되었습니다.</p>
          <p className="text-xs text-muted-foreground">참여해 주셔서 감사합니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur py-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>진행률</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {grouped.map(([section, qs]) => (
        <Card key={section}>
          <CardContent className="flex flex-col gap-6 py-5">
            <h2 className="text-base font-semibold">{section}</h2>
            {qs.map((q) => (
              <QuestionRenderer
                key={q.id}
                question={q}
                value={answers[q.id]}
                onChange={(v) => update(q, v)}
                error={errors[q.id]}
                disabled={submitting}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button onClick={handleSubmit} disabled={submitting} className="w-full" data-testid="survey-submit">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        제출하기
      </Button>
    </div>
  );
}

function hasValue(v: AnswerValue): boolean {
  switch (v.type) {
    case "single_choice":
      return v.value !== null && v.value !== "";
    case "multi_choice":
      return v.value.length > 0;
    case "scale":
    case "nps":
    case "number":
      return v.value !== null;
    case "text":
    case "textarea":
      return v.value.trim().length > 0;
    case "pre_post_scale":
      return v.value.before !== null && v.value.after !== null;
  }
}
