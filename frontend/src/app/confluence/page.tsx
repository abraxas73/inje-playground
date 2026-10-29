"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookText, FilePlus2, Loader2, NotebookPen, Plus, RefreshCw, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { asProblem, confluenceFetch, ConnectNotice, ItemRow, type ApiProblem } from "@/components/confluence/shared";
import type { ConfluenceItem, FeedKind } from "@/lib/confluence/core";
import type { ConfluenceFavorite } from "@/lib/confluence/favorites";

const asItem = (f: ConfluenceFavorite): ConfluenceItem => ({ ...f, spaceKey: "", excerpt: "", lastModified: "", by: "" });
const JSON_HEADERS = { "Content-Type": "application/json" };

const TABS: Array<[FeedKind, string, string]> = [
  ["mentions", "나를 멘션", "나를 멘션한 문서·댓글"],
  ["watching", "지켜보는 문서", "내가 지켜보는 문서의 최근 14일 변경"],
  ["recent", "내가 편집", "내가 편집한 문서"],
];

/** 내 Confluence — 문서 즐겨찾기·소식(멘션·지켜보는 문서·내 편집)·검색·회의록/주간보고 만들기. 본인 Atlassian 권한으로만 조회한다. */
export default function ConfluencePage() {
  const [kind, setKind] = useState<FeedKind>("mentions");
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [items, setItems] = useState<ConfluenceItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [favorites, setFavorites] = useState<ConfluenceFavorite[] | null>(null);
  const [favUrl, setFavUrl] = useState("");
  const [favBusy, setFavBusy] = useState(false);
  const [favError, setFavError] = useState<string | null>(null);

  const load = useCallback(async (query: string | null, k: FeedKind) => {
    setBusy(true); setProblem(null);
    try {
      const url = query ? `/api/confluence/search?${new URLSearchParams({ q: query, limit: "20" })}` : `/api/confluence/feed?${new URLSearchParams({ kind: k, limit: "20" })}`;
      setItems((await confluenceFetch<{ items: ConfluenceItem[] }>(url)).items);
    } catch (e) { setItems(null); setProblem(asProblem(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(searched, kind), 0); return () => clearTimeout(t); }, [load, searched, kind]);
  useEffect(() => { void confluenceFetch<{ items: ConfluenceFavorite[] }>("/api/confluence/favorites").then((r) => setFavorites(r.items)).catch(() => setFavorites([])); }, []);

  const starred = new Set((favorites ?? []).map((f) => f.id));
  const toggleStar = async (item: ConfluenceItem, isStarred: boolean) => {
    setFavError(null);
    try { setFavorites((await confluenceFetch<{ items: ConfluenceFavorite[] }>("/api/confluence/favorites", { method: isStarred ? "DELETE" : "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: item.id }) })).items); }
    catch (e) { setFavError(asProblem(e).message); }
  };
  const addByUrl = async () => {
    const url = favUrl.trim();
    if (!url) return;
    setFavBusy(true); setFavError(null);
    try { setFavorites((await confluenceFetch<{ items: ConfluenceFavorite[] }>("/api/confluence/favorites", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url }) })).items); setFavUrl(""); }
    catch (e) { setFavError(asProblem(e).message); }
    finally { setFavBusy(false); }
  };

  const blocked = problem && problem.kind !== "error";
  return <div className="animate-fade-up space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50"><BookText className="h-5 w-5 text-sky-600" /></div>
        <div><h1 className="text-2xl font-bold tracking-tight">내 Confluence</h1><p className="text-sm text-muted-foreground">즐겨찾기 · 멘션·지켜보는 문서·내 문서 · 검색 · 회의록·주간보고 만들기</p></div>
      </div>
      {!blocked && <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link href="/confluence/new"><FilePlus2 className="mr-1 h-4 w-4" />회의록 만들기</Link></Button>
        <Button asChild variant="outline" size="sm"><Link href="/confluence/weekly"><NotebookPen className="mr-1 h-4 w-4" />주간보고 초안</Link></Button>
      </div>}
    </div>

    {blocked ? <ConnectNotice problem={problem} /> : <>
      <section aria-labelledby="cf-fav" className="rounded-xl border bg-card p-4">
        <h2 id="cf-fav" className="flex items-center gap-2 text-sm font-semibold"><Star className="h-4 w-4 fill-amber-400 text-amber-500" />즐겨찾기{favorites && favorites.length > 0 && <span className="text-xs font-normal text-muted-foreground">{favorites.length}개</span>}</h2>
        {favorites === null ? <p className="mt-2 text-xs text-muted-foreground">불러오는 중…</p>
          : favorites.length ? <ul className="mt-2 divide-y">{favorites.map((f) => <ItemRow key={f.id} item={asItem(f)} starred onStar={toggleStar} />)}</ul>
          : <p className="mt-2 text-xs text-muted-foreground">아직 없습니다. 아래 목록의 ★를 누르거나 문서 링크를 붙여 넣어 추가하세요(최대 30개).</p>}
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void addByUrl(); }}>
          <Input value={favUrl} onChange={(e) => setFavUrl(e.target.value)} placeholder="Confluence 문서 링크 붙여 넣기" aria-label="즐겨찾기 링크" inputMode="url" maxLength={2000} />
          <Button type="submit" variant="outline" disabled={favBusy || !favUrl.trim()} aria-label="즐겨찾기 추가">{favBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
        </form>
        {favError && <p role="alert" className="mt-2 text-xs text-destructive">{favError}</p>}
      </section>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); setSearched(t || null); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="문서 찾기 (예: 보안 점검 가이드, 주간회의)" aria-label="Confluence 검색어" maxLength={200} />
        <Button type="submit" aria-label="검색"><Search className="h-4 w-4" /></Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {searched ? <><span className="text-sm">‘{searched}’ 검색 결과</span><Button size="sm" variant="ghost" onClick={() => { setQ(""); setSearched(null); }}>검색 지우기</Button></>
          : TABS.map(([k, label]) => <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</Button>)}
        <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label="새로고침" disabled={busy} onClick={() => void load(searched, kind)}><RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
      </div>
      {!searched && <p className="text-xs text-muted-foreground">{TABS.find(([k]) => k === kind)?.[2]} · 최근 수정 순</p>}
      {problem && <p role="alert" className="text-sm text-destructive">{problem.message}</p>}
      {busy && !items && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중…</p>}
      {items && (items.length ? <ul className="divide-y rounded-xl border bg-card px-3">{items.map((it) => <ItemRow key={it.id} item={it} starred={starred.has(it.id)} onStar={it.type === "comment" ? undefined : toggleStar} />)}</ul>
        : <p className="py-10 text-center text-sm text-muted-foreground">{searched ? "찾은 문서가 없습니다." : "표시할 문서가 없습니다."}</p>)}
    </>}
  </div>;
}
