"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RfpAdminSolution, RfpImportStatus, RfpSolutionSource } from "@/types/rfp";

const POLL_MS = 3000;

function ImportBadge({ status }: { status: RfpImportStatus }) {
  if (status === "running") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />가져오는 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">실패</Badge>;
  if (status === "ready") return <Badge>완료</Badge>;
  return <Badge variant="outline">대기</Badge>;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function SourceTable({ solution, onImported }: { solution: RfpAdminSolution; onImported: () => void }) {
  const [sources, setSources] = useState<RfpSolutionSource[]>([]);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`);
    const json = (await res.json().catch(() => ({}))) as { running?: boolean; sources?: RfpSolutionSource[]; error?: string };
    if (!res.ok) { setError(json.error ?? "소스를 불러오지 못했습니다."); return; }
    setSources(json.sources ?? []);
    setRunning(json.running === true);
  }, [solution.code]);

  useEffect(() => { wasRunning.current = false; void load(); }, [load]);

  // 가져오는 중이면 3초 폴링, 끝나면 부모에 알려 기능 표를 다시 조회
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) { wasRunning.current = false; onImported(); }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [running, load, onImported]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      setUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
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

  const runImport = async (sourceIds?: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sourceIds ? { sourceIds } : {}) });
      if (!res.ok) throw new Error(await readError(res, "가져오기를 시작하지 못했습니다."));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "가져오기를 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Confluence 소스 <span className="font-normal text-muted-foreground">{sources.length}</span></h3>
        <Button size="sm" disabled={busy || running || !sources.length} onClick={() => runImport()}>
          {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}전체 가져오기
        </Button>
      </div>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://….atlassian.net/wiki/spaces/KEY/pages/123456/제목" className="h-8" />
        <Button size="sm" variant="outline" disabled={busy || !url.trim()} onClick={add}><Plus className="mr-1 h-4 w-4" />추가</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">페이지</th>
              <th className="px-3 py-2">버전</th>
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
                <td className="max-w-[320px] px-3 py-2">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    <span className="truncate">{s.title ?? s.url}</span><ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {s.title && <div className="truncate text-xs text-muted-foreground">{s.url}</div>}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.pageVersion ?? "—"}</td>
                <td className="px-3 py-2"><ImportBadge status={s.importStatus} /></td>
                <td className="px-3 py-2 text-muted-foreground">{s.importedAt ? new Date(s.importedAt).toLocaleString("ko-KR") : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.featureCount}</td>
                <td className="max-w-[260px] px-3 py-2 text-xs">
                  {s.error && <div className="text-destructive">{s.error}</div>}
                  {s.note && <div className="text-muted-foreground">{s.note}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="이 소스만 가져오기" disabled={busy || running} onClick={() => runImport([s.id])}><Download className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="삭제" disabled={running} onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {!sources.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">등록된 페이지가 없습니다. 위에 Confluence 페이지 URL을 넣어 추가하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
