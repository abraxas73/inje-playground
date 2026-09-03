"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UploadDropzone from "@/components/rfp/UploadDropzone";
import ProjectList from "@/components/rfp/ProjectList";
import ConfirmDuplicateDialog, { type DuplicateCandidate } from "@/components/rfp/ConfirmDuplicateDialog";
import { uploadAndRegister, PHASE_LABEL, type UploadPhase } from "@/lib/rfp/client-upload";
import type { RfpProjectSummary, UploadTicket } from "@/types/rfp";

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
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <FileSearch className="h-7 w-7 text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold">RFP 분석</h1>
          <p className="text-sm text-muted-foreground">제안요청서를 올리면 프로젝트를 등록하고 요구사항 표를 만듭니다.</p>
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
      <ProjectList projects={projects} loading={loading} />

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
