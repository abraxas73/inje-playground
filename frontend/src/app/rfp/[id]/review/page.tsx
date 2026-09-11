"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import ReviewQueue from "@/components/rfp/ReviewQueue";
import { toCatalog } from "@/lib/rfp/mapping/client-catalog";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";
import type { RfpCatalogResponse, RfpProjectDetail } from "@/types/rfp";

/** 확정 작업 화면 — 상세 화면과 같은 데이터(프로젝트 상세 + 카탈로그)를 읽어 리뷰 큐만 보여준다 */
export default function RfpReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<RfpProjectDetail | null>(null);
  const [catalog, setCatalog] = useState<CatalogSolution[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [pr, cr] = await Promise.all([fetch(`/api/rfp/projects/${id}`), fetch("/api/rfp/catalog")]);
        if (!pr.ok) throw new Error(((await pr.json().catch(() => ({}))) as { error?: string }).error ?? "프로젝트를 불러오지 못했습니다.");
        const p = (await pr.json()) as RfpProjectDetail;
        const c = cr.ok ? toCatalog((await cr.json()) as RfpCatalogResponse) : [];
        if (cancelled) return;
        setProject(p);
        setCatalog(c);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
      }
    };
    const t = setTimeout(load, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [id]);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        <Button variant="outline" asChild><Link href={`/rfp/${id}`}><ArrowLeft className="mr-1 h-4 w-4" />상세로</Link></Button>
      </div>
    );
  }
  if (!project) return <div className="p-10 text-center text-sm text-muted-foreground">불러오는 중…</div>;

  return (
    <ReviewQueue
      projectId={project.id}
      projectName={project.name}
      requirements={project.requirements}
      mappings={project.mappings}
      catalog={catalog}
      categorySummary={project.categorySummary}
      onMappingsChange={(next) => setProject((p) => (p ? { ...p, mappings: next } : p))}
    />
  );
}
