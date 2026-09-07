"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, unregisteredHits } from "@/lib/rfp/catalog/confluence-search";
import type { ConfluenceSearchHit, RfpAdminSolution } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/**
 * 소스 표 아래 접이식 패널: Confluence를 검색해 결과 행을 소스로 등록한다(4단계 §7.1 + 5단계 전체 등록).
 * 기본은 제목 검색이고 "본문까지"를 켜면 솔루션 이름이 본문에 있는 페이지까지 모은다(회의록 잡음이 늘어난다).
 * "미등록 N개 모두 등록"으로 한꺼번에 등록하고, 원하면 이어서 전체 가져오기까지 실행한다.
 */
export default function ConfluenceSearchPanel({ solution, registeredPageIds, onRegistered, onImportAll, importDisabled }: {
  solution: RfpAdminSolution;
  /** 이미 등록된 confluence 소스의 pageId — "등록됨" 표시 */
  registeredPageIds: ReadonlySet<string>;
  onRegistered: () => void | Promise<void>;
  /** 등록 뒤 전체 소스 가져오기(규칙) 실행 */
  onImportAll: () => Promise<void>;
  importDisabled: boolean;
}) {
  const [q, setQ] = useState(solution.name);
  const [hits, setHits] = useState<ConfluenceSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [thenImport, setThenImport] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  /** ATLASSIAN_* 미설정 400을 받으면 입력을 비활성화한다 */
  const [unavailable, setUnavailable] = useState(false);

  const search = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({ q: q.trim(), limit: String(wide ? SEARCH_LIMIT_MAX : SEARCH_LIMIT_DEFAULT), scope: wide ? "text" : "title" });
      const res = await fetch(`/api/admin/rfp-catalog/confluence-search?${params}`);
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

  const pending = useMemo(() => unregisteredHits(hits ?? [], registeredPageIds), [hits, registeredPageIds]);

  const registerAll = async () => {
    if (!pending.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/sources/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: pending.map((h) => h.url) }),
      });
      const json = (await res.json().catch(() => ({}))) as { registered?: number; skipped?: number; failed?: { url: string; error: string }[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "등록에 실패했습니다.");
      await onRegistered();
      const parts = [`${json.registered ?? 0}개 등록`];
      if (json.skipped) parts.push(`${json.skipped}개는 이미 등록됨`);
      if (json.failed?.length) parts.push(`${json.failed.length}개 실패(${json.failed[0].error})`);
      if (thenImport && (json.registered ?? 0) > 0) {
        await onImportAll();
        parts.push("전체 가져오기를 시작했습니다");
      }
      setNotice(parts.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록에 실패했습니다.");
    } finally {
      setBusy(false);
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5" title="제목만 찾으면 정확하지만 놓치는 문서가 있고, 본문까지 찾으면 회의록 같은 잡음이 늘어납니다">
            <Checkbox checked={wide} disabled={busy || unavailable} onCheckedChange={(v) => setWide(v === true)} />
            본문까지 검색(최대 {SEARCH_LIMIT_MAX}건)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox checked={thenImport} disabled={busy} onCheckedChange={(v) => setThenImport(v === true)} />
            등록 후 전체 가져오기(규칙) 실행
          </label>
        </div>
        {hits && hits.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              검색 결과 {hits.length}건 · 미등록 {pending.length}건
            </div>
            <Button size="sm" disabled={busy || importDisabled || !pending.length} onClick={registerAll} title="검색 결과에서 아직 등록되지 않은 페이지를 모두 소스로 등록합니다">
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}미등록 {pending.length}개 모두 등록
            </Button>
          </div>
        )}
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
        {notice && <div className="text-sm text-emerald-700">{notice}</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>
    </details>
  );
}
