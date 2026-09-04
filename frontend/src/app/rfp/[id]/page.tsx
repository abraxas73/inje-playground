"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import OverviewCard from "@/components/rfp/OverviewCard";
import RequirementsTable from "@/components/rfp/RequirementsTable";
import MappingSummary, { type VerdictFilter } from "@/components/rfp/MappingSummary";
import { useUserRole } from "@/hooks/useUserRole";
import { toCatalog } from "@/lib/rfp/mapping/client-catalog";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
import type { MappingResponse, RfpCatalogResponse, RfpProjectDetail, StatusResponse } from "@/types/rfp";

const POLL_MS = 3000;
const STUCK_MS = 3 * 60 * 1000;

export default function RfpProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isAdmin } = useUserRole();
  const [project, setProject] = useState<RfpProjectDetail | null>(null);
  const [catalog, setCatalog] = useState<CatalogSolution[]>([]);
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>(null);
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

  const loadMappings = useCallback(async () => {
    const res = await fetch(`/api/rfp/projects/${id}/mapping`);
    if (!res.ok) return;
    const m = (await res.json()) as MappingResponse;
    setProject((p) => (p ? { ...p, mappingStatus: m.mappingStatus, mappingError: m.mappingError, mappingWarnings: m.mappingWarnings, mappingAt: m.mappingAt, mappings: m.mappings } : p));
  }, [id]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    fetch("/api/users/role").then((r) => r.json()).then((j: { userId?: string }) => setMe(j.userId ?? null)).catch(() => undefined);
    fetch("/api/rfp/catalog").then(async (r) => (r.ok ? toCatalog((await r.json()) as RfpCatalogResponse) : [])).then(setCatalog).catch(() => setCatalog([]));
  }, []);

  // 추출 중이거나 매핑 중이면 상태만 폴링, 끝나면 재조회(추출은 전체, 매핑은 매핑만)
  useEffect(() => {
    if (!project) return;
    const extracting = project.status === "extracting";
    const mapping = project.mappingStatus === "running";
    if (!extracting && !mapping) return;
    const startedAt = new Date(project.updatedAt).getTime();
    const t = setInterval(async () => {
      const res = await fetch(`/api/rfp/projects/${id}?fields=status`);
      if (!res.ok) return;
      const s = (await res.json()) as StatusResponse;
      if (extracting && s.status !== "extracting") { await load(); return; }
      if (mapping && s.mappingStatus !== "running") { await loadMappings(); return; }
      if (Date.now() - startedAt > STUCK_MS && !stuckRef.current) {
        stuckRef.current = true;
        setNotice(extracting
          ? "추출이 3분 넘게 진행 중입니다. 서버 시간 제한(5분)에 걸리면 실패로 표시되며, 그때 '재추출'로 다시 시도할 수 있습니다."
          : "매핑이 3분 넘게 진행 중입니다. 서버 시간 제한(5분)에 걸리면 끝난 청크까지만 저장되며, 6분 뒤 '솔루션 매핑 실행 → 미매핑만'으로 이어서 할 수 있습니다.");
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [project, id, load, loadMappings]);

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

  const runMapping = async (mode: MappingMode) => {
    setNotice(null);
    setError(null);
    const post = (body: object) => fetch(`/api/rfp/projects/${id}/mapping`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let res = await post({ mode });
    if (res.status === 409) {
      const j = (await res.json()) as { needsConfirm?: boolean; editedRequirements?: number; running?: boolean; error?: string };
      if (j.running) { setNotice(j.error ?? "이미 매핑 중입니다."); await loadMappings(); return; }
      if (!j.needsConfirm) { setError(j.error ?? "매핑을 시작할 수 없습니다."); return; }
      if (!window.confirm(`사람이 고친 매핑이 있는 요구사항 ${j.editedRequirements}건은 건너뛰고 나머지를 다시 매핑합니다. 계속할까요?`)) return;
      res = await post({ mode, confirm: true });
    }
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "매핑 요청에 실패했습니다."); return; }
    stuckRef.current = false;
    setProject((p) => (p ? { ...p, mappingStatus: "running", mappingError: null, updatedAt: new Date().toISOString() } : p));
  };

  const remove = async () => {
    const res = await fetch(`/api/rfp/projects/${id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    router.push("/rfp");
  };

  if (error && !project) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        <Button variant="outline" asChild><Link href="/rfp"><ArrowLeft className="mr-1 h-4 w-4" />목록으로</Link></Button>
      </div>
    );
  }
  if (!project) return <div className="p-10 text-center text-sm text-muted-foreground">불러오는 중…</div>;

  const catalogReady = catalog.some((s) => s.isActive && s.features.some((f) => f.isActive));

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
      <Link href="/rfp" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />RFP 분석 목록</Link>
      <OverviewCard
        project={project}
        canDelete={isAdmin || (me !== null && me === project.createdBy.id)}
        catalogReady={catalogReady}
        onPatched={(patch) => setProject((p) => (p ? { ...p, ...patch } : p))}
        onReextract={reextract}
        onRunMapping={runMapping}
        onDelete={remove}
      />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      {project.status === "extracting" ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">요구사항을 추출하고 있습니다… 표준 양식은 몇 초, LLM 추출은 수 분 걸릴 수 있습니다.</div>
      ) : (
        <>
          <MappingSummary
            requirementIds={project.requirements.map((r) => r.id)}
            mappings={project.mappings}
            catalog={catalog}
            filter={verdictFilter}
            onFilter={setVerdictFilter}
          />
          <RequirementsTable
            projectId={project.id}
            requirements={project.requirements}
            mappings={project.mappings}
            catalog={catalog}
            verdictFilter={verdictFilter}
            onChange={(next) => setProject((p) => (p ? { ...p, requirements: next, requirementCount: next.length } : p))}
            onMappingsChange={(next) => setProject((p) => (p ? { ...p, mappings: next } : p))}
          />
        </>
      )}
    </div>
  );
}
