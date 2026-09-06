"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConfluenceSearchHit, RfpAdminSolution } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/** 소스 표 아래 접이식 패널: 제목으로 Confluence를 검색해 결과 행을 소스로 등록한다(4단계 스펙 §7.1). */
export default function ConfluenceSearchPanel({ solution, registeredPageIds, onRegistered }: {
  solution: RfpAdminSolution;
  /** 이미 등록된 confluence 소스의 pageId — "등록됨" 표시 */
  registeredPageIds: ReadonlySet<string>;
  onRegistered: () => void | Promise<void>;
}) {
  const [q, setQ] = useState(solution.name);
  const [hits, setHits] = useState<ConfluenceSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** ATLASSIAN_* 미설정 400을 받으면 입력을 비활성화한다 */
  const [unavailable, setUnavailable] = useState(false);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/confluence-search?q=${encodeURIComponent(q.trim())}`);
      const json = (await res.json().catch(() => ({}))) as { results?: ConfluenceSearchHit[]; error?: string };
      if (!res.ok) {
        if (res.status === 400 && /ATLASSIAN_/.test(json.error ?? "")) setUnavailable(true);
        throw new Error(json.error ?? "검색에 실패했습니다.");
      }
      setHits(json.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const register = async (hit: ConfluenceSearchHit) => {
    setAdding(hit.pageId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/sources`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: hit.url }),
      });
      if (!res.ok) throw new Error(await readError(res, "등록에 실패했습니다."));
      await onRegistered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록에 실패했습니다.");
    } finally {
      setAdding(null);
    }
  };

  const canSearch = !busy && !unavailable && q.trim().length >= 2;
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-semibold">Confluence에서 찾기</summary>
      <div className="mt-2 space-y-2">
        <div className="flex gap-2">
          <Input
            value={q} onChange={(e) => setQ(e.target.value)} disabled={unavailable} className="h-8"
            placeholder="페이지 제목 검색(예: 기능명세서)" onKeyDown={(e) => { if (e.key === "Enter" && canSearch) void search(); }}
          />
          <Button size="sm" variant="outline" disabled={!canSearch} onClick={search}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}검색
          </Button>
        </div>
        {hits && hits.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">제목</th><th className="px-3 py-2">스페이스</th><th className="px-3 py-2">수정일</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.pageId} className="border-t">
                    <td className="max-w-[360px] px-3 py-2">
                      <a href={h.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline"><span className="truncate">{h.title}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{h.spaceName ?? h.spaceKey ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{h.lastModified ? new Date(h.lastModified).toLocaleDateString("ko-KR") : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {registeredPageIds.has(h.pageId) ? (
                        <Badge variant="outline">등록됨</Badge>
                      ) : (
                        <Button size="sm" variant="outline" disabled={adding !== null} onClick={() => register(h)}>
                          {adding === h.pageId ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}등록
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hits && hits.length === 0 && <div className="text-sm text-muted-foreground">검색 결과가 없습니다.</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>
    </details>
  );
}
