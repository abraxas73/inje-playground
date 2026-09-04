"use client";

import { useEffect, useState } from "react";
import { Download, FileText, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import { StatusBadge, MappingStatusBadge } from "@/components/rfp/ProjectList";
import MappingRunButton from "@/components/rfp/MappingRunButton";
import type { MappingMode } from "@/lib/rfp/mapping/run-job";
import type { RfpProjectDetail } from "@/types/rfp";

interface Props {
  project: RfpProjectDetail;
  canDelete: boolean;
  catalogReady: boolean;
  onPatched: (patch: Partial<Pick<RfpProjectDetail, "name" | "agency" | "period" | "budget" | "bidMethod">>) => void;
  onReextract: () => Promise<void>;
  onRunMapping: (mode: MappingMode) => Promise<void>;
  onDelete: () => Promise<void>;
}

const FIELDS: { key: "name" | "agency" | "period" | "budget" | "bidMethod"; label: string }[] = [
  { key: "name", label: "사업명" }, { key: "agency", label: "발주기관" }, { key: "period", label: "사업기간" }, { key: "budget", label: "설계금액" }, { key: "bidMethod", label: "입찰 및 계약방법" },
];

/** 서버(reextract 라우트)와 같은 기준: extracting이 이만큼 지나면 멈춘 것으로 보고 재추출 버튼을 다시 활성화한다. */
const STALE_EXTRACTING_MS = 6 * 60 * 1000;

export default function OverviewCard({ project, canDelete, catalogReady, onPatched, onReextract, onRunMapping, onDelete }: Props) {
  const [busy, setBusy] = useState<"reextract" | "delete" | "file" | null>(null);
  // extracting 중에는 부모가 상태만 폴링하고 project를 갱신하지 않을 수 있어(멈춘 경우), 여기서 직접 시간을 흘려 재계산한다.
  const [, tick] = useState(0);
  useEffect(() => {
    if (project.status !== "extracting") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [project.status]);
  const staleExtracting = project.status === "extracting" && Date.now() - Date.parse(project.updatedAt) > STALE_EXTRACTING_MS;

  const save = (key: (typeof FIELDS)[number]["key"]) => async (next: string) => {
    const res = await fetch(`/api/rfp/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: next }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
    onPatched({ [key]: next || null } as Partial<RfpProjectDetail>);
  };

  const openFile = async () => {
    setBusy("file");
    try {
      const res = await fetch(`/api/rfp/projects/${project.id}/file`);
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "다운로드 URL을 받지 못했습니다.");
      window.open(json.url, "_blank", "noopener");
    } catch (e) {
      alert(e instanceof Error ? e.message : "다운로드 실패");
    } finally {
      setBusy(null);
    }
  };

  const file = project.files[0];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            <span className="break-keep">{project.name}</span>
            <StatusBadge status={project.status} />
            <MappingStatusBadge status={project.mappingStatus} />
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            요구사항 {project.requirementCount}건
            {project.extractionMethod && ` · ${project.extractionMethod === "standard" ? "표준 양식(규칙 추출)" : "LLM 추출"}`}
            {" · "}등록 {project.createdBy.name ?? "—"} · {new Date(project.createdAt).toLocaleString("ko-KR")}
            {project.mappingAt && ` · 매핑 ${new Date(project.mappingAt).toLocaleString("ko-KR")}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {file && <Button variant="outline" size="sm" disabled={busy === "file"} onClick={openFile}><FileText className="mr-1 h-4 w-4" />{file.originalFilename}</Button>}
          <MappingRunButton project={project} catalogReady={catalogReady} onRun={onRunMapping} />
          {project.status === "ready" ? (
            <Button size="sm" asChild>
              <a href={`/api/rfp/projects/${project.id}/xlsx`}><Download className="mr-1 h-4 w-4" />xlsx 다운로드</a>
            </Button>
          ) : (
            <Button size="sm" disabled><Download className="mr-1 h-4 w-4" />xlsx 다운로드</Button>
          )}
          <Button variant="outline" size="sm" disabled={busy !== null || (project.status === "extracting" && !staleExtracting)} onClick={async () => { setBusy("reextract"); try { await onReextract(); } finally { setBusy(null); } }}>
            <RefreshCw className="mr-1 h-4 w-4" />재추출
          </Button>
          {canDelete && (
            <AlertDialog>
              <Button variant="destructive" size="sm" asChild disabled={busy !== null}>
                <AlertDialogTrigger><Trash2 className="mr-1 h-4 w-4" />삭제</AlertDialogTrigger>
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>프로젝트를 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>원본 파일과 요구사항 {project.requirementCount}건이 함께 지워지며 되돌릴 수 없습니다.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction onClick={async () => { setBusy("delete"); try { await onDelete(); } finally { setBusy(null); } }}>삭제</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-1"><EditableCell value={project[f.key] ?? ""} onSave={save(f.key)} clampLines={0} placeholder="클릭해서 입력" /></dd>
            </div>
          ))}
        </dl>
        {project.status === "failed" && project.error && (
          <Alert variant="destructive"><AlertDescription>추출 실패: {project.error} — 개요를 확인하고 &quot;재추출&quot;을 눌러 다시 시도하세요.</AlertDescription></Alert>
        )}
        {project.warnings.length > 0 && (
          <Alert><AlertDescription><ul className="list-disc pl-4">{project.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></AlertDescription></Alert>
        )}
        {project.mappingStatus === "failed" && project.mappingError && (
          <Alert variant="destructive"><AlertDescription>솔루션 매핑 실패: {project.mappingError} — &quot;솔루션 매핑 실행 → 미매핑만&quot;으로 이어서 할 수 있습니다.</AlertDescription></Alert>
        )}
        {project.mappingWarnings.length > 0 && (
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">매핑 경고 {project.mappingWarnings.length}건</summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">{project.mappingWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
