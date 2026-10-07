"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { JiraIssue } from "@/lib/jira/issues";

type List = { connected: boolean; items: JiraIssue[]; nextPageToken: string | null };
const filters = [["open", "미완료"], ["progress", "진행 중"], ["done", "완료"], ["all", "전체"]] as const;
export default function JiraPage() {
  const [scope, setScope] = useState("open");
  const [data, setData] = useState<List | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const cancelLoad = useCallback(() => { seq.current++; }, []);
  const load = useCallback(async (cursor?: string) => {
    const run = ++seq.current; setBusy(true); setError(null);
    try {
      const q = new URLSearchParams({ scope, ...(cursor ? { cursor } : {}) });
      const res = await fetch(`/api/jira/issues?${q}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Jira 목록을 불러오지 못했습니다.");
      if (run === seq.current) setData(prev => cursor && prev ? { ...result, items: [...new Map([...prev.items, ...result.items].map((x: JiraIssue) => [x.key, x])).values()] } : result);
    } catch (e) { if (run === seq.current) setError(e instanceof Error ? e.message : "조회에 실패했습니다."); }
    finally { if (run === seq.current) setBusy(false); }
  }, [scope]);
  useEffect(() => { const timer = setTimeout(() => { setData(null); void load(); }, 0); return () => { clearTimeout(timer); cancelLoad(); }; }, [load, cancelLoad]);
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-bold">내 Jira 업무</h1><p className="mt-1 text-sm text-muted-foreground">본인 담당 이슈 · 최근 수정 순</p></div><Button variant="outline" size="icon" aria-label="Jira 새로고침" disabled={busy} onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button></div>
    <div className="flex flex-wrap gap-2">{filters.map(([id, label]) => <Button key={id} size="sm" variant={scope === id ? "default" : "outline"} aria-pressed={scope === id} onClick={() => setScope(id)}>{label}</Button>)}</div>
    {error && <div role="alert" className="space-y-2 rounded-xl border border-destructive p-4"><p className="text-sm">{error}</p><Button asChild variant="outline"><Link href="/settings#jira">Jira 연결 설정</Link></Button></div>}
    {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Jira 업무를 불러오고 있습니다…</p>}
    {data && !data.connected && <Card><CardContent className="space-y-4 py-6"><p>개인 Jira 계정을 연결하면 본인 담당 업무가 표시됩니다.</p><Button asChild><Link href="/settings#jira">지라 연결</Link></Button></CardContent></Card>}
    {data?.connected && <>
      {!busy && data.items.length === 0 && <p className="py-10 text-center text-muted-foreground">해당하는 본인 담당 이슈가 없습니다.</p>}
      <div className="space-y-3">{data.items.map(issue => <Link key={issue.key} href={`/jira/${issue.key}`} className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-primary">{issue.key}</span><Badge variant="secondary">{issue.status}</Badge><span className="text-xs text-muted-foreground">{issue.project}</span></div><p className="break-words font-medium">{issue.summary}</p><p className="mt-2 text-xs text-muted-foreground">{issue.priority}{issue.dueDate ? ` · 마감 ${issue.dueDate}` : ""}</p></Link>)}</div>
      {data.nextPageToken && <Button variant="outline" className="w-full" disabled={busy} onClick={() => void load(data.nextPageToken!)}>더 불러오기</Button>}
    </>}
  </main>;
}
