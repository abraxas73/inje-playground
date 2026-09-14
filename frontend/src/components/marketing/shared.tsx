"use client";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Organization } from "@/lib/marketing/types";
export async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const result = await fetch(url, body === undefined ? { signal, cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await result.json(); if (!result.ok) throw new Error(data.error || "요청에 실패했습니다."); return data;
}
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : "요청에 실패했습니다.";
export const date = (v: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(v));
export function KindBadge({ kind }: { kind: string }) { return <Badge variant="outline" className={kind === "확인 필요" || kind === "중복 의심" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-primary/20 bg-primary/5 text-primary"}>{kind}</Badge>; }
export const selectClass = "h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
export function OrganizationPicker({ onPick }: { onPick: (o: Organization) => void }) {
  const [q, setQ] = useState(""); const [items, setItems] = useState<Organization[]>([]); const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => { if (!q.trim()) { setItems([]); return; } api<{ rows: Organization[] }>(`/api/marketing?view=organizations&q=${encodeURIComponent(q)}`, undefined, abort.signal).then(r => { setItems(r.rows); setError(""); }).catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); }); }, 250);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [q]);
  return <div className="space-y-2"><Input aria-label="기존 회사 검색" placeholder="기존 회사·기관 검색" value={q} onChange={e => setQ(e.target.value)} />{error && <p role="alert" className="text-destructive text-xs">{error}</p>}{q && <div className="max-h-40 overflow-auto">{items.map(o => <Button key={o.id} variant="ghost" className="w-full justify-start text-left" onClick={() => { onPick(o); setQ(""); setItems([]); }}>{o.name} · {o.category}</Button>)}{!items.length && <p className="text-xs text-muted-foreground">검색 결과가 없습니다.</p>}</div>}</div>;
}
