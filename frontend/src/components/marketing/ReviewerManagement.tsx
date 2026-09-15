"use client";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MarketingReviewer, ReviewerDirectory } from "@/lib/marketing/reviewers";
import { api, date, errorMessage } from "./shared";

export default function ReviewerManagement({ onClose, onImport, onChanged, empty }: { onClose: () => void; onImport: () => void; onChanged: () => void; empty: boolean }) {
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0); const key = `${page}:${revision}`;
  const [loaded, setLoaded] = useState<{ key: string; data?: ReviewerDirectory; error?: string }>();
  const [pending, setPending] = useState<MarketingReviewer>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const loading = loaded?.key !== key; const data = loading ? undefined : loaded?.data;
  useEffect(() => {
    const controller = new AbortController();
    api<ReviewerDirectory>(`/api/marketing/reviewers?page=${page}`, undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setLoaded({ key, data }); })
      .catch(e => { if (!controller.signal.aborted) setLoaded({ key, error: errorMessage(e) }); });
    return () => controller.abort();
  }, [page, key]);
  function reload() { setPending(undefined); setError(""); setRevision(x => x + 1); }
  async function save() {
    if (!pending) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ changed: boolean; row: MarketingReviewer }>("/api/marketing/reviewers", { userId: pending.userId, enabled: !pending.explicit, version: pending.version });
      setMessage(result.changed ? `${result.row.name}님의 ${result.row.explicit ? "검수자 지정을 저장했습니다." : "검수자 지정을 해제했습니다. 마케팅 접근과 검수 권한이 함께 해제됩니다."}` : "이미 요청한 상태입니다. 현재 권한을 다시 불러왔습니다.");
      setPending(undefined); setPage(1); setRevision(x => x + 1); onChanged();
    } catch (e) { setError(errorMessage(e)); setPending(undefined); setRevision(x => x + 1); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-auto"><DialogHeader>
    <DialogTitle>마케팅 DB 관리 · 검수자</DialogTitle>
    <DialogDescription>현재 검수 권한과 지정 이력을 확인합니다. 강승억·김하연 검수 관리자만 다른 사용자를 지정·해제할 수 있습니다.</DialogDescription>
  </DialogHeader>
    <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2">
      <p><strong>검수 권한</strong>: 모든 부문의 제출 조회·승인·반려, 회사 기준·관리 규칙 수정, 규칙 검증·이메일 검사 실행.</p>
      <p className="text-muted-foreground">검수 관리자는 강승억·김하연입니다. 추가된 검수자는 마케팅에 접근해 검수할 수 있으며, 자신이나 다른 사람의 권한을 변경할 수 없습니다.</p>
    </div>
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">현재 검수자와 접근 계정{data ? ` · 검수 가능 ${data.rows.filter(r => r.canReview).length}명` : ""}</h3><Button variant="outline" size="sm" disabled={busy || loading} onClick={reload}>권한 새로고침</Button></div>
    {loading && <p role="status" className="text-sm">검수자 정보를 불러오는 중…</p>}
    {(error || (!loading && loaded?.error)) && <p role="alert" className="text-sm text-destructive">{error || loaded?.error}</p>}
    {message && <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">{message}</p>}
    {data?.canManage && <ReviewerCandidateSearch disabled={busy || !!pending} revision={revision} onPick={row => { setPending(row); setError(""); setMessage(""); }}/>}
    {data && [...data.rows, ...(pending && !data.rows.some(r => r.userId === pending.userId) ? [pending] : [])].map(row => <article key={row.userId} aria-label={`${row.name} 권한`} className="rounded-xl border p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">{row.name}</h4><p className="text-xs text-muted-foreground break-all">{row.email}</p></div><span className={`rounded-md px-2 py-1 text-xs ${row.canReview ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{row.canReview ? "검수 가능" : row.explicit ? "접근 차단 · 검수 불가" : "미지정 · 접근 불가"}</span></div>
      <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">권한 부여 근거</dt><dd>{row.isManager ? `검수 관리자 고정 권한${row.explicit ? " + 별도 검수자 지정" : ""}` : row.explicit ? "검수자 지정" : "검수자 미지정"}</dd>
        <dt className="text-muted-foreground">지정자</dt><dd>{row.explicit ? row.grantedBy || "기존 지정 기록 미상" : "별도 지정 없음"}</dd>
        <dt className="text-muted-foreground">지정 시각</dt><dd>{row.explicit ? row.grantedAt ? date(row.grantedAt) : "기존 지정 기록 미상" : "—"}</dd>
      </dl>
      {row.isManager && <p className="text-xs text-muted-foreground">고정 검수 관리자입니다. 이 화면에서 관리 권한을 부여하거나 해제할 수 없습니다.</p>}
      {!row.pageAccess && row.explicit && <p className="text-xs text-amber-700">저장된 지정이 있어도 마케팅 접근이 차단되어 검수 권한은 적용되지 않습니다.</p>}
      {data.canManage && !row.isManager && (row.explicit || row.pageAccess) && <Button variant="outline" size="sm" disabled={busy || !!pending} onClick={() => { setPending(row); setError(""); setMessage(""); }}>{row.name} {row.explicit ? "검수자 해제" : "검수자 지정"}</Button>}
      {pending?.userId === row.userId && <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
        <p className="text-sm">{!row.explicit ? `${row.name}님에게 마케팅 접근과 전체 제출의 승인·반려 및 기준 관리 권한을 부여합니다. 검수자 관리 권한은 부여하지 않습니다.` : `${row.name}님의 검수자 지정을 해제합니다. 마케팅 접근과 검수 권한이 함께 해제됩니다. 기존 처리 이력은 보존됩니다.`}</p>
        <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "저장 중…" : row.explicit ? "해제 적용" : "지정 적용"}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setPending(undefined)}>취소</Button></div>
      </div>}
    </article>)}
    {data && !data.rows.length && <p className="text-sm text-muted-foreground">등록된 접근 계정이 없습니다.</p>}
    {data && <section aria-label="검수 권한 변경 이력" className="border-t pt-4 space-y-3"><h3 className="text-sm font-semibold">지정·해제 이력 · {data.total}건</h3>
      <p className="text-xs text-muted-foreground">지정 시각은 최근 지정 감사 기록 기준입니다. 검수 관리자 고정 권한 부여 시각은 포함하지 않습니다.</p>
      {!data.history.length && <p className="text-sm text-muted-foreground">저장된 지정·해제 이력이 없습니다.</p>}
      {data.history.map(event => <article key={event.id} className="rounded-lg border p-3 text-sm space-y-1"><p><strong>{event.name}</strong> · {event.enabled ? "검수자 지정" : "검수자 지정 해제"}</p><p className="text-xs text-muted-foreground break-all">{event.email} · 처리자: {event.actor_name} · {date(event.created_at)}</p></article>)}
      {data.total > data.pageSize && <nav aria-label="권한 이력 페이지" className="flex items-center justify-end gap-3 text-xs"><Button variant="outline" size="sm" disabled={page === 1 || busy || !!pending} onClick={() => setPage(x => x - 1)}>이전 이력</Button>{page} / {Math.ceil(data.total / data.pageSize)}<Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total || busy || !!pending} onClick={() => setPage(x => x + 1)}>다음 이력</Button></nav>}
    </section>}
    {data?.canImport && <section className="border-t pt-4 space-y-2"><Button variant="outline" disabled={!empty || busy || !!pending} onClick={onImport}>기존 Master Excel 최초 이관</Button><p className="text-xs text-muted-foreground">최초 이관은 Master가 비어 있을 때만 가능합니다. 원본 18개 필드와 기존 누락값을 보존합니다.</p></section>}
  </DialogContent></Dialog>;
}

function ReviewerCandidateSearch({ disabled, revision, onPick }: { disabled: boolean; revision: number; onPick: (row: MarketingReviewer) => void }) {
  const [q, setQ] = useState(""); const [page, setPage] = useState(1); const [submitted, setSubmitted] = useState("");
  const [attempt, setAttempt] = useState(0); const key = `${submitted}:${page}:${revision}:${attempt}`;
  const [result, setResult] = useState<{ key: string; rows?: MarketingReviewer[]; total?: number; error?: string }>();
  const data = result?.key === key ? result : undefined; const loading = !!submitted && !data;
  useEffect(() => {
    if (!submitted) return; const abort = new AbortController();
    api<{ rows: MarketingReviewer[]; total: number }>(`/api/marketing/reviewers?${new URLSearchParams({ q: submitted, page: String(page) })}`, undefined, abort.signal)
      .then(r => { if (!abort.signal.aborted) setResult({ key, ...r }); }).catch(e => { if (!abort.signal.aborted) setResult({ key, error: errorMessage(e) }); });
    return () => abort.abort();
  }, [submitted, page, key]);
  return <section aria-label="검수자 추가" className="rounded-lg border bg-primary/5 p-4 space-y-3"><h3 className="text-sm font-semibold">검수자 추가</h3>
    <p className="text-xs text-muted-foreground">서비스에 가입하고 사용자 승인을 받은 계정을 이름 또는 이메일로 검색하세요. 이미 지정된 사람은 아래 목록에서 확인합니다.</p>
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (q.trim().length < 2) return; setSubmitted(q.trim()); setPage(1); setAttempt(x => x + 1); }}><Input aria-label="추가할 검수자 이름 또는 이메일" value={q} maxLength={100} disabled={disabled} onChange={e => setQ(e.target.value)} placeholder="이름 또는 이메일 2자 이상"/><Button type="submit" variant="outline" disabled={disabled || q.trim().length < 2 || loading}>사용자 검색</Button></form>
    {loading && <p role="status" className="text-sm">사용자 검색 중…</p>}{data?.error && <p role="alert" className="text-sm text-destructive">{data.error}</p>}
    {data?.rows?.map(row => <div key={row.userId} className="flex items-center justify-between gap-3 rounded border bg-background p-3"><div className="min-w-0 text-sm"><strong>{row.name}</strong><p className="break-all text-xs text-muted-foreground">{row.email}</p></div><Button size="sm" disabled={disabled} onClick={() => onPick(row)}>{row.name} 지정</Button></div>)}
    {data?.rows?.length === 0 && <p className="text-sm">추가할 수 있는 계정이 없습니다. 가입·사용자 승인 여부 또는 기존 검수자 목록을 확인하세요.</p>}
    {data?.total && data.total > 20 ? <div className="flex justify-end items-center gap-2 text-xs"><Button size="sm" variant="outline" disabled={disabled || page === 1} onClick={() => setPage(x => x - 1)}>이전 사용자</Button>{page} / {Math.ceil(data.total / 20)}<Button size="sm" variant="outline" disabled={disabled || page * 20 >= data.total} onClick={() => setPage(x => x + 1)}>다음 사용자</Button></div> : null}
  </section>;
}
