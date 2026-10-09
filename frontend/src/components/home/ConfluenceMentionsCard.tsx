"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AtSign } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { ItemRow } from "@/components/confluence/shared";
import type { ConfluenceItem } from "@/lib/confluence/core";

/** 웹 홈 — 최근 나를 멘션한 Confluence 문서·댓글(최대 5). 미연결·권한 없음·없음이면 숨긴다(Jira 카드와 같은 규칙). */
export default function ConfluenceMentionsCard() {
  const { userId, canAccessPage } = useUserRole();
  return userId && canAccessPage("/confluence") ? <Mentions key={userId} /> : null;
}
function Mentions() {
  const [items, setItems] = useState<ConfluenceItem[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    void (async () => {
      try {
        const res = await fetch("/api/confluence/feed?kind=mentions&limit=5", { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.items)) setItems(data.items);
      } catch { /* 부가 카드 — 조용히 숨김 */ }
      finally { clearTimeout(timer); }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);
  if (!items?.length) return null;
  return <section aria-labelledby="cf-mentions-title" className="mb-8 rounded-xl border bg-card p-5 md:p-6">
    <h2 id="cf-mentions-title" className="flex items-center gap-2 font-semibold"><AtSign aria-hidden className="h-5 w-5 text-primary" />Confluence에서 나를 멘션</h2>
    <p className="mt-1 text-xs text-muted-foreground">나를 멘션한 문서·댓글을 최근 순으로 최대 5개 표시합니다.</p>
    <ul className="mt-3 divide-y">{items.map((it) => <ItemRow key={it.id} item={it} />)}</ul>
    <Link href="/confluence" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">내 Confluence →</Link>
  </section>;
}
