"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { issueDetail } from "@/lib/jira/issues";
type Detail = Awaited<ReturnType<typeof issueDetail>>;
/** 제목은 왼쪽 고정 폭, 내용은 오른쪽 — 모바일에서도 한 줄(공용 카드 기본 여백이 너무 넓어 쓰지 않음) */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid grid-cols-[4.5rem_1fr] gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"><h2 className="text-sm font-semibold leading-6">{title}</h2><div className="min-w-0">{children}</div></section>;
}
export default function JiraDetailPage() {
  const { key } = useParams<{ key: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ action: "comment" | "transition"; transitionId?: string; label: string } | null>(null);
  const seq = useRef(0);
  const cancelLoad = useCallback(() => { seq.current++; }, []);
  const load = useCallback(async () => {
    const run = ++seq.current;
    try {
      const res = await fetch(`/api/jira/issues/${encodeURIComponent(key)}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "상세를 불러오지 못했습니다.");
      if (run === seq.current) { setData(result); setError(null); }
    } catch (e) { if (run === seq.current) setError(e instanceof Error ? e.message : "조회에 실패했습니다."); }
  }, [key]);
  useEffect(() => { const timer = setTimeout(() => { setData(null); setText(""); setConfirm(null); void load(); }, 0); return () => { clearTimeout(timer); cancelLoad(); }; }, [load, cancelLoad]);
  async function execute() {
    if (!confirm || !data || data.key !== key || busy) return;
    const action = confirm; setConfirm(null); setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/jira/issues/${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: action.action, transitionId: action.transitionId, expectedStatus: data.statusId, text }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "처리하지 못했습니다.");
      if (action.action === "comment") setText("");
      setNotice(action.action === "comment" ? "댓글을 작성했습니다." : "상태를 변경했습니다.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "응답을 확인하지 못했습니다. Jira에서 반영 여부를 확인한 뒤 다시 시도하세요."); }
    finally { setBusy(false); }
  }
  return <div className="animate-fade-up space-y-4">
    <div className="flex justify-between gap-2"><Button asChild variant="ghost"><Link href="/jira">← 내 Jira 업무</Link></Button><Button variant="outline" disabled={busy} onClick={() => void load()}>새로고침</Button></div>
    {error && <div role="alert" className="rounded-xl border border-destructive p-4 text-sm">{error}<Link className="ml-2 underline" href="/settings#jira">연결 설정</Link></div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!data && !error && <p>이슈를 불러오고 있습니다…</p>}
    {data && <>
      <div><div className="mb-2 flex items-center gap-2"><span className="font-medium text-primary">{data.key}</span><Badge variant="secondary">{data.status}</Badge></div><h1 className="break-words text-xl font-bold">{data.summary}</h1><p className="mt-2 text-sm text-muted-foreground">{data.project} · {data.priority}{data.dueDate ? ` · 마감 ${data.dueDate}` : ""}</p><a href={data.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-primary underline">Jira에서 열기</a></div>
      <Section title="설명"><p className="whitespace-pre-wrap break-words text-sm leading-6">{data.description || "설명이 없습니다."}</p></Section>
      <Section title="상태 변경"><div className="space-y-2"><div className="flex flex-wrap gap-2">{data.transitions.map(t => <Button key={t.id} size="sm" variant="outline" disabled={busy || t.required.length > 0} onClick={() => setConfirm({ action: "transition", transitionId: t.id, label: `${t.name} → ${t.to}` })}>{t.name}{t.required.length ? " · 추가 입력 필요" : ""}</Button>)}</div>{data.transitions.some(t => t.required.length) && <p className="text-xs text-muted-foreground">추가 입력이 필요한 상태 변경은 ‘Jira에서 열기’에서 처리하세요.</p>}{!data.transitions.length && <p className="text-sm text-muted-foreground">현재 변경할 수 있는 상태가 없습니다.</p>}</div></Section>
      <Section title="댓글"><div className="space-y-3"><label htmlFor="jira-comment" className="sr-only">새 댓글</label><Textarea id="jira-comment" placeholder="댓글을 입력하세요" value={text} maxLength={4000} disabled={busy} onChange={e => setText(e.target.value)} /><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{text.length}/4,000</span><Button disabled={busy || !text.trim()} onClick={() => setConfirm({ action: "comment", label: "댓글 작성" })}>댓글 작성</Button></div>
        {data.comments.map(c => <article key={c.id} className="border-t pt-3"><p className="text-sm font-medium">{c.author} <span className="font-normal text-muted-foreground">{new Date(c.created).toLocaleString("ko-KR")}</span></p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p></article>)}
        {data.commentsTotal > data.comments.length && <a href={data.url} target="_blank" rel="noreferrer" className="block text-sm text-primary underline">이전 댓글은 Jira에서 확인</a>}
      </div></Section>
    </>}
    <AlertDialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.label}할까요?</AlertDialogTitle><AlertDialogDescription>{data?.key} · {data?.summary}<br />연결한 본인의 Jira 계정으로 처리됩니다.</AlertDialogDescription></AlertDialogHeader>{confirm?.action === "comment" && <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">{text}</p>}<AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => void execute()}>실행</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
