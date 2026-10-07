"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUserRole } from "@/hooks/useUserRole";
import type { JiraIssue } from "@/lib/jira/issues";
type State = { kind: "loading" | "connect" | "forbidden" | "error" } | { kind: "ready"; items: JiraIssue[]; more: boolean };
export default function JiraWorkCard() {
  const { userId, canAccessPage } = useUserRole();
  return userId && canAccessPage("/jira") ? <WorkList key={userId} /> : null;
}
function WorkList() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    // KST 07:00 = UTC 22:00 of the previous day.
    const period = () => Math.floor((Date.now() + 2 * 3600_000) / 86400_000);
    let previous = period();
    const timer = setInterval(() => { const next = period(); if (previous !== next) { previous = next; refresh(); } }, 60_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 30_000);
    void (async () => {
      try {
        const response = await fetch("/api/jira/issues?scope=open", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!active) return;
        if (response.status === 401 || response.status === 403) { setState({ kind: "forbidden" }); return; }
        if (response.status === 409) { setState({ kind: "connect" }); return; }
        if (!response.ok) throw new Error("Jira unavailable");
        if (data.connected === false) { setState({ kind: "connect" }); return; }
        if (data.connected !== true || !Array.isArray(data.items)) throw new Error("Invalid response");
        const items = (data.items as JiraIssue[]).filter(x => x.category !== "done");
        setState({ kind: "ready", items: items.slice(0, 5), more: items.length > 5 || !!data.nextPageToken });
      } catch { if (active) setState({ kind: "error" }); }
      finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [revision]);
  const refresh = () => { setState({ kind: "loading" }); setRevision(n => n + 1); };
  if (state.kind === "forbidden") return null;
  return <section aria-labelledby="jira-work-title" className="mb-8 rounded-xl border bg-card p-5 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="jira-work-title" className="flex items-center gap-2 font-semibold"><ClipboardList aria-hidden="true" className="h-5 w-5 text-primary" />Jira 미완료 업무</h2>
      <Button variant="ghost" size="sm" onClick={refresh} disabled={state.kind === "loading"}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />새로고침</Button>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">본인 담당 할 일·진행 중 업무를 최근 수정 순으로 최대 5개 표시합니다. 완료된 업무는 제외합니다.</p>
    {state.kind === "loading" && <p role="status" className="mt-4 text-sm text-muted-foreground">Jira 업무를 확인하고 있습니다…</p>}
    {state.kind === "connect" && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><p>Jira 계정을 연결하거나 다시 연결해 주세요.</p><Link href="/settings#jira" className="font-medium text-primary hover:underline">지라 연결</Link></div>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-sm text-destructive">Jira 업무를 불러오지 못했습니다. 새로고침해 주세요.</p>}
    {state.kind === "ready" && (state.items.length ? <ul className="mt-4 divide-y">{state.items.map(item => <li key={item.key}>
      <Link href={`/jira/${encodeURIComponent(item.key)}`} className="block rounded-lg px-2 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium text-primary">{item.key}</span><Badge variant="secondary">{item.status}</Badge>{item.dueDate && <span className="text-muted-foreground">마감 {item.dueDate}</span>}</div>
        <p className="mt-1 break-words text-sm font-medium">{item.summary}</p>
      </Link>
    </li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">담당한 미완료 업무가 없습니다.</p>)}
    {state.kind === "ready" && <Link href="/jira" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">{state.more ? "더 많은 업무 보기" : "전체 목록"} →</Link>}
  </section>;
}
