"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

/** 최근 대화 3개 — 없으면 아무것도 그리지 않는다. */
export default function RecentConversations() {
  const [items, setItems] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    fetch("/api/chat/conversations?limit=3").then((r) => (r.ok ? r.json() : null)).then((j) => j && setItems(j.conversations)).catch(() => {});
  }, []);
  if (!items.length) return null;
  return (
    <div className="mb-6">
      <p className="mb-2 text-sm font-medium text-muted-foreground">최근 대화</p>
      <ul className="flex flex-wrap gap-2">
        {items.map((c) => <li key={c.id}><Link href={`/chat/${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-muted"><MessageSquare className="h-3.5 w-3.5" />{c.title || "새 대화"}</Link></li>)}
      </ul>
    </div>
  );
}
