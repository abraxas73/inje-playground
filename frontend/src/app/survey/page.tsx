"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { createBrowserClient } from "@supabase/ssr";
import type { Survey } from "@/types/survey";

export default function SurveyListPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase
      .from("surveys")
      .select("*")
      .eq("status", "open")
      .order("sort_order", { ascending: true })
      .returns<Survey[]>()
      .then(({ data }) => {
        setSurveys(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
          <ClipboardList className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">설문</h1>
          <p className="text-sm text-muted-foreground">진행 중인 설문에 참여해 주세요.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
        </div>
      ) : surveys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            진행 중인 설문이 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {surveys.map((s) => (
            <Link key={s.id} href={`/survey/${s.slug}`}>
              <Card className="group hover-glow cursor-pointer">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    {s.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 ml-3 group-hover:translate-x-0.5 transition-transform" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
