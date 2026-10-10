"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { ItemRow } from "@/components/sharepoint/shared";
import { itemKey, type Favorite, type SharepointItem } from "@/lib/sharepoint/core";

/** 웹 홈 — 즐겨찾기 + 자주 쓰는 SharePoint 문서(합쳐 최대 6). 미연결·없음이면 숨긴다(Confluence 카드와 같은 규칙). */
export default function SharepointDocsCard() {
  const { userId, canAccessPage } = useUserRole();
  return userId && canAccessPage("/sharepoint") ? <Docs key={userId} /> : null;
}
function Docs() {
  const [items, setItems] = useState<Array<Favorite | SharepointItem> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    void (async () => {
      try {
        const [fav, used] = await Promise.all([
          fetch("/api/sharepoint/favorites", { cache: "no-store", signal: controller.signal }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
          fetch("/api/sharepoint/feed?kind=used&limit=6", { cache: "no-store", signal: controller.signal }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
        ]);
        const seen = new Set<string>();
        const merged = [...(Array.isArray(fav.items) ? fav.items : []), ...(Array.isArray(used.items) ? used.items : [])].filter((x: Favorite | SharepointItem) => { const k = itemKey(x); if (seen.has(k)) return false; seen.add(k); return true; });
        setItems(merged.slice(0, 6));
      } catch { /* 부가 카드 — 조용히 숨김 */ }
      finally { clearTimeout(timer); }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);
  if (!items?.length) return null;
  return <section aria-labelledby="sp-docs-title" className="mb-8 rounded-xl border bg-card p-5 md:p-6">
    <h2 id="sp-docs-title" className="flex items-center gap-2 font-semibold"><FolderOpen aria-hidden className="h-5 w-5 text-primary" />자주 쓰는 SharePoint 문서</h2>
    <p className="mt-1 text-xs text-muted-foreground">즐겨찾기와 최근 사용한 문서를 최대 6개 표시합니다. 누르면 SharePoint에서 열립니다.</p>
    <ul className="mt-3 divide-y">{items.map((it) => <ItemRow key={itemKey(it)} item={it} />)}</ul>
    <Link href="/sharepoint" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">SharePoint 문서 →</Link>
  </section>;
}
