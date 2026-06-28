"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, ClipboardList, Pencil } from "lucide-react";
import type { Survey, SurveyStatus } from "@/types/survey";

type SurveyListItem = Survey & { response_count: number; complete_count: number };

const STATUS_BADGE: Record<SurveyStatus, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-slate-100 text-slate-600 border-slate-200" },
  open: { label: "진행중", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "마감", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function AdminSurveysPage() {
  const [items, setItems] = useState<SurveyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/surveys");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "조회에 실패했습니다.");
      }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSurveys();
  }, [fetchSurveys]);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">설문 목록</h2>
          <Badge variant="secondary" className="text-xs">
            {items.length}개
          </Badge>
        </div>
        <Link href="/admin/surveys/new">
          <Button size="sm" className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" />새 설문
          </Button>
        </Link>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">로딩 중...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          아직 설문이 없습니다. 새 설문을 만들어 보세요.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((s) => {
            const badge = STATUS_BADGE[s.status];
            return (
              <Card key={s.id} className="hover:bg-muted/30 transition-colors">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{s.title}</p>
                      <Badge variant="outline" className={`text-[10px] h-5 ${badge.className}`}>
                        {badge.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">/{s.slug}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">
                      {s.complete_count}
                      <span className="text-muted-foreground font-normal"> / {s.response_count}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground">완료 / 응답</p>
                  </div>
                  <Link href={`/admin/surveys/${s.id}/edit`}>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      편집
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
