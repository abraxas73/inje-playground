"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import OverviewCard from "@/components/rfp/OverviewCard";
import RequirementsTable from "@/components/rfp/RequirementsTable";
import { useUserRole } from "@/hooks/useUserRole";
import type { RfpProjectDetail, StatusResponse } from "@/types/rfp";

const POLL_MS = 3000;
const STUCK_MS = 3 * 60 * 1000;

export default function RfpProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isAdmin } = useUserRole();
  const [project, setProject] = useState<RfpProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const stuckRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rfp/projects/${id}`);
    if (res.status === 404) { setError("프로젝트가 없습니다."); return; }
    const json = (await res.json()) as RfpProjectDetail & { error?: string };
    if (!res.ok) { setError(json.error ?? "불러오지 못했습니다."); return; }
    setProject(json);
  }, [id]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    fetch("/api/users/role").then((r) => r.json()).then((j: { userId?: string }) => setMe(j.userId ?? null)).catch(() => undefined);
  }, []);

  // 추출 중이면 상태만 폴링, 끝나면 전체 재조회
  useEffect(() => {
    if (!project || project.status !== "extracting") return;
    const startedAt = new Date(project.updatedAt).getTime();
    const t = setInterval(async () => {
      const res = await fetch(`/api/rfp/projects/${id}?fields=status`);
      if (!res.ok) return;
      const s = (await res.json()) as StatusResponse;
      if (s.status !== "extracting") { await load(); return; }
      if (Date.now() - startedAt > STUCK_MS && !stuckRef.current) {
        stuckRef.current = true;
        setNotice("추출이 3분 넘게 진행 중입니다. 서버 시간 제한(5분)에 걸리면 실패로 표시되며, 그때 '재추출'로 다시 시도할 수 있습니다.");
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [project, id, load]);

  const reextract = async () => {
    setNotice(null);
    let res = await fetch(`/api/rfp/projects/${id}/reextract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 409) {
      const j = (await res.json()) as { needsConfirm?: boolean; editedCount?: number; error?: string };
      if (!j.needsConfirm) { setError(j.error ?? "재추출할 수 없습니다."); return; }
      if (!window.confirm(`편집한 요구사항 ${j.editedCount}건이 원본 추출 결과로 덮어써집니다. 계속할까요?`)) return;
      res = await fetch(`/api/rfp/projects/${id}/reextract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    }
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "재추출 요청에 실패했습니다."); return; }
    stuckRef.current = false;
    await load();
  };

  const remove = async () => {
    const res = await fetch(`/api/rfp/projects/${id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    router.push("/rfp");
  };

  if (error) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        <Button variant="outline" asChild><Link href="/rfp"><ArrowLeft className="mr-1 h-4 w-4" />목록으로</Link></Button>
      </div>
    );
  }
  if (!project) return <div className="p-10 text-center text-sm text-muted-foreground">불러오는 중…</div>;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
      <Link href="/rfp" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />RFP 분석 목록</Link>
      <OverviewCard
        project={project}
        canDelete={isAdmin || (!!me && me === project.createdBy.id)}
        onPatched={(patch) => setProject((p) => (p ? { ...p, ...patch } : p))}
        onReextract={reextract}
        onDelete={remove}
      />
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      {project.status === "extracting" ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">요구사항을 추출하고 있습니다… 표준 양식은 몇 초, LLM 추출은 수 분 걸릴 수 있습니다.</div>
      ) : (
        <RequirementsTable projectId={project.id} requirements={project.requirements} onChange={(next) => setProject((p) => (p ? { ...p, requirements: next, requirementCount: next.length } : p))} />
      )}
    </div>
  );
}
