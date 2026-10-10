"use client";
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, Plus, RefreshCw, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { asProblem, ConnectNotice, ItemRow, sharepointFetch, type ApiProblem, type RowItem } from "@/components/sharepoint/shared";
import { FEED_LABEL, itemKey, type Favorite, type FeedKind, type SharepointItem } from "@/lib/sharepoint/core";

const TABS: Array<[FeedKind, string]> = [["used", "최근 사용 순"], ["shared", "나와 공유된 문서 · 공유 순"], ["trending", "주변 사람들이 많이 보는 문서"]];
type Feed = { kind: FeedKind; source: FeedKind; items: SharepointItem[]; unavailable?: boolean };

/** SharePoint 문서 — 즐겨찾기·자주 쓰는/나와 공유/주변에서 많이 보는 문서·검색. 본인 Microsoft 권한으로만 본다(새 권한 없음). */
export default function SharepointPage() {
  const [kind, setKind] = useState<FeedKind>("used");
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [items, setItems] = useState<SharepointItem[] | null>(null);
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [favUrl, setFavUrl] = useState("");
  const [favBusy, setFavBusy] = useState(false);
  const [favError, setFavError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);

  const load = useCallback(async (query: string | null, k: FeedKind) => {
    setBusy(true); setProblem(null);
    try {
      if (query) { setFeed(null); setItems((await sharepointFetch<{ items: SharepointItem[] }>(`/api/sharepoint/search?${new URLSearchParams({ q: query, limit: "20" })}`)).items); }
      else { const f = await sharepointFetch<Feed>(`/api/sharepoint/feed?${new URLSearchParams({ kind: k, limit: "20" })}`); setFeed(f); setItems(f.items); }
    } catch (e) { setItems(null); setProblem(asProblem(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(searched, kind), 0); return () => clearTimeout(t); }, [load, searched, kind]);
  useEffect(() => { void sharepointFetch<{ items: Favorite[] }>("/api/sharepoint/favorites").then((r) => setFavorites(r.items)).catch(() => setFavorites([])); }, []);

  const starred = new Set((favorites ?? []).map(itemKey));
  const toggleStar = async (item: RowItem, isStarred: boolean) => {
    setFavError(null);
    try {
      const r = isStarred
        ? await sharepointFetch<{ items: Favorite[] }>("/api/sharepoint/favorites", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driveId: item.driveId, id: item.id }) })
        : await sharepointFetch<{ items: Favorite[] }>("/api/sharepoint/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driveId: item.driveId, id: item.id }) });
      setFavorites(r.items);
    } catch (e) { setFavError(asProblem(e).message); }
  };
  const addByUrl = async () => {
    const url = favUrl.trim();
    if (!url) return;
    setFavBusy(true); setFavError(null);
    try { setFavorites((await sharepointFetch<{ items: Favorite[] }>("/api/sharepoint/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })).items); setFavUrl(""); }
    catch (e) { setFavError(asProblem(e).message); }
    finally { setFavBusy(false); }
  };

  const blocked = problem?.kind === "connect";
  return <div className="animate-fade-up space-y-5">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50"><FolderOpen className="h-5 w-5 text-teal-600" /></div>
      <div><h1 className="text-2xl font-bold tracking-tight">SharePoint 문서</h1><p className="text-sm text-muted-foreground">즐겨찾기 · 자주 쓰는 문서 · 나와 공유 · 검색 — 내 Microsoft 계정 권한으로</p></div>
    </div>

    {blocked ? <ConnectNotice problem={problem} /> : <>
      <section aria-labelledby="sp-fav" className="rounded-xl border bg-card p-4">
        <h2 id="sp-fav" className="flex items-center gap-2 text-sm font-semibold"><Star className="h-4 w-4 fill-amber-400 text-amber-500" />즐겨찾기{favorites && favorites.length > 0 && <span className="text-xs font-normal text-muted-foreground">{favorites.length}개</span>}</h2>
        {favorites === null ? <p className="mt-2 text-xs text-muted-foreground">불러오는 중…</p>
          : favorites.length ? <ul className="mt-2 divide-y">{favorites.map((f) => <ItemRow key={itemKey(f)} item={f} starred onStar={toggleStar} />)}</ul>
          : <p className="mt-2 text-xs text-muted-foreground">아직 없습니다. 아래 목록의 ★를 누르거나 문서 링크를 붙여 넣어 추가하세요(최대 30개).</p>}
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void addByUrl(); }}>
          <Input value={favUrl} onChange={(e) => setFavUrl(e.target.value)} placeholder="SharePoint·OneDrive 문서 또는 폴더 링크 붙여 넣기" aria-label="즐겨찾기 링크" inputMode="url" maxLength={2000} />
          <Button type="submit" variant="outline" disabled={favBusy || !favUrl.trim()} aria-label="즐겨찾기 추가">{favBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
        </form>
        {favError && <p role="alert" className="mt-2 text-xs text-destructive">{favError}</p>}
      </section>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); setSearched(t || null); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="문서 찾기 (예: 제안서, 2026 사업계획, 보안 점검)" aria-label="SharePoint 검색어" maxLength={200} />
        <Button type="submit" aria-label="검색"><Search className="h-4 w-4" /></Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {searched ? <><span className="text-sm">‘{searched}’ 검색 결과</span><Button size="sm" variant="ghost" onClick={() => { setQ(""); setSearched(null); }}>검색 지우기</Button></>
          : TABS.map(([k]) => <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} aria-pressed={kind === k} onClick={() => setKind(k)}>{FEED_LABEL[k]}</Button>)}
        <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label="새로고침" disabled={busy} onClick={() => void load(searched, kind)}><RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
      </div>
      {!searched && <p className="text-xs text-muted-foreground">{feed?.source === "recent" && kind === "used" ? "이 조직은 Microsoft 인사이트가 꺼져 있어 ‘최근 연 문서’로 대신 보입니다" : TABS.find(([k]) => k === kind)?.[1]}</p>}
      {problem && <p role="alert" className="text-sm text-destructive">{problem.message}</p>}
      {busy && !items && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중…</p>}
      {items && (items.length ? <ul className="divide-y rounded-xl border bg-card px-3">{items.map((it) => <ItemRow key={itemKey(it)} item={it} starred={starred.has(itemKey(it))} onStar={toggleStar} />)}</ul>
        : <p className="py-10 text-center text-sm text-muted-foreground">{searched ? "찾은 문서가 없습니다." : feed?.unavailable ? "이 조직은 Microsoft 인사이트가 꺼져 있어 이 목록을 쓸 수 없습니다." : "표시할 문서가 없습니다."}</p>)}
    </>}
  </div>;
}
