"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, NotebookPen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PublishForm from "@/components/confluence/PublishForm";
import { asProblem, confluenceFetch, ConnectNotice, type ApiProblem } from "@/components/confluence/shared";

type Draft = { title: string; markdown: string; llm: boolean; range: { from: string; to: string }; counts: { jira: number; pages: number } };

/** 주간보고 초안 — 이번 주 Jira 업무·내가 쓴 Confluence 문서(+메모)로 초안을 만들고, 고친 뒤 Confluence에 올린다. */
export default function WeeklyReportPage() {
  const [memo, setMemo] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  async function make() {
    setBusy(true); setProblem(null);
    try {
      const d = await confluenceFetch<Draft>("/api/confluence/weekly-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memo }) });
      setDraft(d); setMarkdown(d.markdown);
    } catch (e) { setProblem(asProblem(e)); }
    finally { setBusy(false); }
  }
  return <div className="animate-fade-up space-y-5">
    <div className="flex items-center gap-3">
      <Button asChild variant="ghost" size="icon" aria-label="내 Confluence로"><Link href="/confluence"><ArrowLeft className="h-4 w-4" /></Link></Button>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50"><NotebookPen className="h-5 w-5 text-sky-600" /></div>
      <div><h1 className="text-2xl font-bold tracking-tight">주간보고 초안</h1><p className="text-sm text-muted-foreground">이번 주 Jira 담당 업무와 내가 작성·수정한 Confluence 문서로 초안을 만듭니다</p></div>
    </div>
    {problem && problem.kind !== "error" ? <ConnectNotice problem={problem} /> : <>
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <Label htmlFor="w-memo">메모(선택) — 회의·외근·고객 미팅처럼 Jira·Confluence에 없는 일</Label>
        <Textarea id="w-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} maxLength={2000} />
        <Button onClick={() => void make()} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}{draft ? "초안 다시 만들기" : "초안 만들기"}</Button>
        {problem && <p role="alert" className="text-sm text-destructive">{problem.message}</p>}
        {draft && <p className="text-xs text-muted-foreground">{draft.range.from} ~ {draft.range.to} · Jira {draft.counts.jira}건 · 문서 {draft.counts.pages}건{draft.llm ? " · Claude가 다듬음" : ""} — 아래에서 고친 뒤 올리세요.</p>}
      </div>
      {draft && <PublishForm kind="weekly" title={draft.title} markdown={markdown} onMarkdown={setMarkdown} />}
    </>}
  </div>;
}
