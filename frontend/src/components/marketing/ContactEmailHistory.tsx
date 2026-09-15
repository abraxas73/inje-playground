"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ContactEmailEvent, ContactEmailHistory as History } from "@/lib/marketing/email/types";
import { api, date, errorMessage } from "./shared";
import EmailEvidence, { EmailBadge } from "./EmailEvidence";

export function EmailHistoryEntry({ event }: { event: ContactEmailEvent }) {
  const snapshot = event.after_data.contact; const result = event.validation_snapshot;
  return <article className="rounded-lg border p-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><time className="text-sm font-medium">{date(event.created_at)}</time><EmailBadge value={result.state}/></div>
    <p className="text-sm break-all">검사 이메일: {snapshot.email || "이메일 없음"}</p>
    <p className="text-xs text-muted-foreground">{snapshot.db_id} · {snapshot.company || "회사 미등록"} · 실행 요청자: {event.actor_name}</p>
    {event.stale && <p className="text-xs text-amber-700">현재 정보·회사 기준이 변경되었거나 30일이 경과한 과거 결과입니다. 재검사가 필요합니다.</p>}
    <details><summary className="cursor-pointer text-sm font-medium">검증 내용·판정 근거 보기</summary>
      <div className="mt-3 space-y-3"><EmailEvidence result={result}/>
        <p className="text-xs text-muted-foreground">당시 Contact v{snapshot.version} · 회사 v{snapshot.organization_version ?? "없음"} · 검사 엔진 {result.engine || "미기록"}</p>
        <p className="text-xs text-muted-foreground">{snapshot.profile ? `회사 이메일 기준 v${snapshot.profile.version} · ${snapshot.profile.actor_name} · ${snapshot.profile.reason}` : "당시 회사 이메일 기준 미등록"}</p>
        {snapshot.profile && <p className="text-xs break-all">당시 승인 도메인: {snapshot.profile.domains.join(", ") || "없음"} · 홈페이지: {snapshot.profile.website || "없음"}</p>}
        <details className="text-xs"><summary className="cursor-pointer">검증 원본·당시 정보</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ snapshot, result, source: event.source }, null, 2)}</pre></details>
      </div>
    </details>
    <Link className="inline-block text-xs text-primary underline" href={`/marketing/email-checks/${event.source.runId}`}>전체 검사 실행 보기</Link>
  </article>;
}
export default function ContactEmailHistory({ contactId }: { contactId: string }) {
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const key = `${contactId}:${page}:${revision}`;
  const [response, setResponse] = useState<{ key: string; data?: History; error?: string }>();
  const loading = response?.key !== key; const data = loading ? undefined : response?.data; const error = loading ? "" : response?.error;
  useEffect(() => {
    const controller = new AbortController();
    api<History>(`/api/marketing/email-checks/contacts/${contactId}?page=${page}`, undefined, controller.signal)
      .then(r => { if (!controller.signal.aborted) setResponse({ key, data: r }); })
      .catch(e => { if (!controller.signal.aborted) setResponse({ key, error: errorMessage(e) }); });
    return () => controller.abort();
  }, [contactId, page, key]);
  return <section aria-label="이메일 검증 이력" className="rounded-xl border bg-muted/20 p-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">이메일 검증 이력{data ? ` · ${data.total.toLocaleString()}건` : ""}</h3><Button variant="ghost" size="sm" disabled={loading} onClick={() => setRevision(x => x + 1)}>이력 새로고침</Button></div>
    {loading && <p role="status" className="text-sm">검증 이력 불러오는 중…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {data && !data.total && <p className="text-sm text-muted-foreground">아직 이 레코드의 이메일 검증 이력이 없습니다.</p>}
    {data?.rows[0] && <EmailHistoryEntry event={data.rows[0]}/>}
    {data && data.rows.length > 1 && <details><summary className="cursor-pointer text-sm">이전 검사 이력 ({data.rows.length - 1}건 · 현재 페이지)</summary><div className="mt-3 space-y-3">{data.rows.slice(1).map(e => <EmailHistoryEntry key={e.id} event={e}/>)}</div></details>}
    {data && data.total > data.pageSize && <nav aria-label="검증 이력 페이지" className="flex justify-between items-center gap-2 text-xs"><Button variant="outline" size="sm" disabled={page === 1 || loading} onClick={() => setPage(x => x - 1)}>이전 이력</Button><span>{page} / {Math.ceil(data.total / data.pageSize)}</span><Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage(x => x + 1)}>다음 이력</Button></nav>}
  </section>;
}
