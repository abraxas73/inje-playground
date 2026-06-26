"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SurveyWithQuestions } from "@/types/survey";
import SurveyForm from "@/components/survey/SurveyForm";

export default function SurveyRespondPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [survey, setSurvey] = useState<SurveyWithQuestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/surveys/${slug}`)
      .then(async (res) => {
        if (cancelled) return;
        setStatus(res.status);
        if (res.ok) {
          setSurvey(await res.json());
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  if (!survey) {
    // 404 can mean: survey doesn't exist, OR authenticated-mode survey where RLS hides the row.
    // 401 is returned when the row IS visible but the user isn't logged in.
    // We present both cases with a login prompt where applicable.
    const isLoginNeeded = status === 401 || status === 404;
    const message =
      status === 410
        ? "마감된 설문입니다."
        : isLoginNeeded
          ? "설문을 찾을 수 없거나 로그인이 필요합니다."
          : "설문을 찾을 수 없습니다.";

    return (
      <Card className="max-w-2xl mx-auto mt-10">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">{message}</p>
          {isLoginNeeded && (
            <Button asChild variant="default" size="sm">
              <Link href="/login">로그인하기</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/survey">설문 목록으로</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/survey">
          <ArrowLeft className="h-4 w-4 mr-1" /> 설문 목록
        </Link>
      </Button>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{survey.title}</h1>
        {survey.description && (
          <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{survey.description}</p>
        )}
      </div>
      <SurveyForm survey={survey} isAuthenticated={status !== 401} />
    </div>
  );
}
