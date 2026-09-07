"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Download, ExternalLink, HelpCircle, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfluenceSearchPanel from "@/components/admin/rfp-catalog/ConfluenceSearchPanel";
import type { EngineKind } from "@/lib/rfp/mapping/types";
import type { FreshnessState } from "@/lib/rfp/catalog/freshness";
import type { RfpAdminSolution, RfpImportStatus, RfpSolutionSource, RfpSourceKind } from "@/types/rfp";

interface FreshnessRow { id: string; state: FreshnessState; label: string; detail: string }

/** 원본(Confluence 페이지·SharePoint 파일)과 가져온 스냅샷을 비교한 결과 */
function FreshnessBadge({ row, loading }: { row: FreshnessRow | undefined; loading: boolean }) {
  if (loading && !row) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />확인 중</span>;
  if (!row) return <span className="text-xs text-muted-foreground">—</span>;
  if (row.state === "fresh") {
    return <span className="inline-flex items-center gap-1 text-xs text-emerald-700" title={row.detail}><Check className="h-3.5 w-3.5" />{row.label}</span>;
  }
  if (row.state === "stale" || row.state === "never") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-900" title={row.detail}>
        <AlertTriangle className="h-3 w-3" />{row.label}
      </Badge>
    );
  }
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={row.detail}><HelpCircle className="h-3.5 w-3.5" />{row.label}</span>;
}

const POLL_MS = 3000;
const KIND_LABEL: Record<RfpSourceKind, string> = { confluence: "Confluence", xlsx: "xlsx" };

function ImportBadge({ status }: { status: RfpImportStatus }) {
  if (status === "running") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />가져오는 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">실패</Badge>;
  if (status === "ready") return <Badge>완료</Badge>;
  return <Badge variant="outline">대기</Badge>;
}

interface ApiError { message: string; code?: string }
async function readError(res: Response, fallback: string): Promise<ApiError> {
  const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return { message: j.error ?? fallback, code: j.code };
}

export default function SourceTable({ solution, llmAvailable, onImported }: { solution: RfpAdminSolution; llmAvailable: boolean; onImported: () => void }) {
  const [sources, setSources] = useState<RfpSolutionSource[]>([]);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const wasRunning = useRef(false);
  /** 소스별 최신 여부(원본 버전·수정 시각 비교). 화면을 열 때와 가져오기가 끝난 뒤 자동으로 확인한다 */
  const [freshness, setFreshness] = useState<Record<string, FreshnessRow>>({});
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`);
    const json = (await res.json().catch(() => ({}))) as { running?: boolean; sources?: RfpSolutionSource[]; error?: string };
    if (!res.ok) { setError({ message: json.error ?? "소스를 불러오지 못했습니다." }); return; }
    setSources(json.sources ?? []);
    setRunning(json.running === true);
  }, [solution.code]);

  const checkFreshness = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/sources/freshness`);
      const json = (await res.json().catch(() => ({}))) as { rows?: FreshnessRow[]; checkedAt?: string; error?: string };
      if (!res.ok) return;
      setFreshness(Object.fromEntries((json.rows ?? []).map((r) => [r.id, r])));
      setCheckedAt(json.checkedAt ?? new Date().toISOString());
    } finally {
      setChecking(false);
    }
  }, [solution.code]);

  useEffect(() => { wasRunning.current = false; setFreshness({}); setCheckedAt(null); void load(); }, [load]);

  // 소스가 있으면 원본 최신 여부를 자동으로 한 번 확인한다(가져오기가 돌고 있으면 끝난 뒤에)
  useEffect(() => {
    if (running || !sources.length || checkedAt !== null) return;
    void checkFreshness();
  }, [running, sources.length, checkedAt, checkFreshness]);

  // 가져오는 중이면 3초 폴링, 끝나면 부모에 알려 기능 표를 다시 조회하고 최신 여부도 다시 확인
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) { wasRunning.current = false; onImported(); void checkFreshness(); }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [running, load, onImported, checkFreshness]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      if (!res.ok) { setError(await readError(res, "추가에 실패했습니다.")); return; }
      setUrl("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: RfpSolutionSource) => {
    if (!window.confirm(`${s.title ?? s.url}\n이 소스를 삭제할까요? 가져온 기능은 남습니다.`)) return;
    const res = await fetch(`/api/admin/rfp-catalog/sources/${s.id}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    await load();
  };

  const runImport = async (engine: EngineKind, sourceIds?: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine, ...(sourceIds ? { sourceIds } : {}) }),
      });
      if (!res.ok) { setError(await readError(res, "가져오기를 시작하지 못했습니다.")); return; }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const registeredPageIds = new Set(sources.filter((s) => s.kind === "confluence").map((s) => s.pageId));
  const staleCount = sources.filter((s) => ["stale", "never"].includes(freshness[s.id]?.state ?? "")).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          소스 <span className="font-normal text-muted-foreground">{sources.length}</span>
          {staleCount > 0 && <span className="ml-2 text-xs font-normal text-amber-700">원본이 바뀐 소스 {staleCount}개 — 다시 가져오세요</span>}
        </h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={checking || !sources.length} title={checkedAt ? `원본 최신 여부 확인: ${new Date(checkedAt).toLocaleString("ko-KR")}` : "원본 최신 여부 확인"} onClick={() => void checkFreshness()}>
            {checking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}최신 확인
          </Button>
          <Button size="sm" disabled={busy || running || !sources.length} onClick={() => runImport("rules")}>
            {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}가져오기(규칙)
          </Button>
          {llmAvailable && (
            <Button size="sm" variant="outline" disabled={busy || running || !sources.length} title="Confluence 소스를 Claude로 다시 읽어 기능 설명을 보강합니다" onClick={() => runImport("llm")}>
              <Sparkles className="mr-1 h-4 w-4" />Claude로 보강
            </Button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Confluence 페이지 URL 또는 SharePoint xlsx 파일 링크" className="h-8" />
        <Button size="sm" variant="outline" disabled={busy || !url.trim()} onClick={add}><Plus className="mr-1 h-4 w-4" />추가</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">종류</th>
              <th className="px-3 py-2">페이지·파일</th>
              <th className="px-3 py-2">버전</th>
              <th className="px-3 py-2">원본 대비</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">마지막 가져온 시각</th>
              <th className="px-3 py-2 text-right">기능</th>
              <th className="px-3 py-2">메모</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="px-3 py-2"><Badge variant="outline">{KIND_LABEL[s.kind]}</Badge></td>
                <td className="max-w-[320px] px-3 py-2">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    <span className="truncate">{s.title ?? s.url}</span><ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {s.title && <div className="truncate text-xs text-muted-foreground">{s.url}</div>}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.kind === "xlsx" ? "—" : s.pageVersion ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2"><FreshnessBadge row={freshness[s.id]} loading={checking} /></td>
                <td className="px-3 py-2"><ImportBadge status={s.importStatus} /></td>
                <td className="px-3 py-2 text-muted-foreground">{s.importedAt ? new Date(s.importedAt).toLocaleString("ko-KR") : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.featureCount}</td>
                <td className="max-w-[260px] px-3 py-2 text-xs">
                  {s.error && <div className="text-destructive">{s.error}</div>}
                  {s.note && <div className="text-muted-foreground">{s.note}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="이 소스만 가져오기(규칙)" disabled={busy || running} onClick={() => runImport("rules", [s.id])}><Download className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="삭제" disabled={running} onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {!sources.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">등록된 소스가 없습니다. 위에 Confluence 페이지 URL이나 SharePoint xlsx 링크를 넣어 추가하거나, 아래에서 Confluence를 검색하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="text-sm text-destructive">
          {error.message}
          {error.code === "not_connected" && <> <Link href="/settings" className="underline">Microsoft 계정 연결</Link></>}
          {error.code === "reconnect" && <> <Link href="/settings" className="underline">다시 연결</Link></>}
        </div>
      )}
      <ConfluenceSearchPanel
        solution={solution}
        registeredPageIds={registeredPageIds}
        onRegistered={load}
        onImportAll={() => runImport("rules")}
        importDisabled={busy || running}
      />
    </div>
  );
}
