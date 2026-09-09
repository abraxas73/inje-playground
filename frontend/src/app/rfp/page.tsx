"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UploadDropzone from "@/components/rfp/UploadDropzone";
import ProjectList from "@/components/rfp/ProjectList";
import HowItWorks from "@/components/rfp/HowItWorks";
import ConfirmDuplicateDialog, { type DuplicateCandidate } from "@/components/rfp/ConfirmDuplicateDialog";
import { uploadAndRegister, PHASE_LABEL, type UploadPhase } from "@/lib/rfp/client-upload";
import { MAPPING_CANDIDATES_DEFAULT, parseMaxCandidates } from "@/lib/rfp/mapping/settings";
import type { RfpCatalogResponse, RfpProjectSummary, UploadTicket } from "@/types/rfp";

/** 한 페이지에 보여 줄 프로젝트 수 */
const PAGE_SIZE = 10;

interface Pending { file: File; ticket: UploadTicket }

export default function RfpPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<RfpProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ candidates: DuplicateCandidate[]; overview: { name: string; agency: string | null }; pending: Pending } | null>(null);
  const [page, setPage] = useState(1);
  /** 아래 안내에 쓸 카탈로그 규모·설정(설명이 실제 상태와 어긋나지 않게 서버 값을 쓴다) */
  const [catalog, setCatalog] = useState<{ solutions: number; features: number; maxCandidates: number; llmAvailable: boolean }>({
    solutions: 0, features: 0, maxCandidates: MAPPING_CANDIDATES_DEFAULT, llmAvailable: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rfp/projects${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (res.status === 401) { setMessage({ kind: "error", text: "로그인이 필요합니다." }); return; }
      if (res.status === 403) { setMessage({ kind: "error", text: "RFP 분석은 사용자 권한이 필요합니다. 관리자에게 요청하세요." }); return; }
      const json = (await res.json()) as { projects?: RfpProjectSummary[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "목록을 불러오지 못했습니다.");
      setProjects(json.projects ?? []);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "목록을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => { setPage(1); }, [q]);

  useEffect(() => {
    fetch("/api/rfp/catalog")
      .then((r) => (r.ok ? (r.json() as Promise<RfpCatalogResponse>) : null))
      .then((res) => {
        if (!res) return;
        const active = res.solutions.filter((s) => s.isActive);
        setCatalog({
          solutions: active.length,
          features: active.reduce((n, s) => n + s.features.filter((f) => f.isActive).length, 0),
          maxCandidates: parseMaxCandidates(res.mappingMaxCandidates),
          llmAvailable: res.llmAvailable === true,
        });
      })
      .catch(() => {});
  }, []);

  const pageCount = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = useMemo(() => projects.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), [projects, current]);

  const handleOutcome = (file: File, outcome: Awaited<ReturnType<typeof uploadAndRegister>>) => {
    const r = outcome.response;
    if ("duplicate" in r) {
      setMessage({ kind: "info", text: "이미 등록된 프로젝트입니다. 상세 화면으로 이동합니다." });
      router.push(`/rfp/${r.projectId}`);
    } else if ("needsConfirm" in r) {
      setConfirm({ candidates: r.candidates, overview: r.overview, pending: { file, ticket: outcome.ticket } });
    } else {
      router.push(`/rfp/${r.projectId}`);
    }
  };

  const handleFile = async (file: File) => {
    setMessage(null);
    setBusy(true);
    try {
      const outcome = await uploadAndRegister(file, { onPhase: setPhase });
      handleOutcome(file, outcome);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "업로드에 실패했습니다." });
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const registerNew = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const { file, ticket } = confirm.pending;
      const outcome = await uploadAndRegister(file, { force: true, ticket, onPhase: setPhase });
      setConfirm(null);
      handleOutcome(file, outcome);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "등록에 실패했습니다." });
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileSearch className="h-7 w-7 text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold">RFP 분석</h1>
          <p className="text-sm text-muted-foreground">제안요청서(hwp·hwpx·docx·pdf)나 엑셀 요건표(xlsx)를 올리면 프로젝트를 등록하고 요구사항 표를 만듭니다.</p>
        </div>
      </div>

      <UploadDropzone busy={busy} phaseLabel={phase ? PHASE_LABEL[phase] : undefined} onFile={handleFile} />

      {message && (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">프로젝트 <span className="text-sm font-normal text-muted-foreground">{projects.length}건</span></h2>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="사업명·발주기관 검색" className="max-w-xs" />
      </div>
      <ProjectList projects={shown} loading={loading} />

      {!loading && projects.length > 0 && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, projects.length)} / {projects.length}건
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 px-2" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                <ChevronLeft className="h-4 w-4" />이전
              </Button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <Button key={n} variant={n === current ? "secondary" : "ghost"} size="sm" className="h-7 w-7 p-0 tabular-nums" onClick={() => setPage(n)}>
                  {n}
                </Button>
              ))}
              <Button variant="outline" size="sm" className="h-7 px-2" disabled={current >= pageCount} onClick={() => setPage(current + 1)}>
                다음<ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <HowItWorks solutions={catalog.solutions} features={catalog.features} maxCandidates={catalog.maxCandidates} llmAvailable={catalog.llmAvailable} />

      <ConfirmDuplicateDialog
        open={!!confirm}
        candidates={confirm?.candidates ?? []}
        overview={confirm?.overview ?? null}
        busy={busy}
        onRegisterNew={registerNew}
        onOpenExisting={(id) => { setConfirm(null); router.push(`/rfp/${id}`); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
