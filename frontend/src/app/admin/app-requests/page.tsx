"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { REQUEST_STATUS, type AdminAppRequest, type RequestStatus } from '@/lib/mobile/app-requests';
const selectStyle = 'rounded-md border bg-background px-3 py-2 text-sm';
export default function AppRequestsAdmin() {
  const [status, setStatus] = useState('pending');
  const [platform, setPlatform] = useState('all');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<AdminAppRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError('');
      try {
        const res = await fetch(`/api/admin/app-requests?status=${status}&platform=${platform}&page=${page}`, { cache: 'no-store', signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '목록 조회 실패');
        if (!controller.signal.aborted) { setItems(data.items); setTotal(data.total); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '목록 조회 실패'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [status, platform, page, revision]);
  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold">앱 사용 신청 관리</h2><p className="mt-1 text-sm text-muted-foreground">플랫폼별 스토어 계정을 확인하고 테스터 등록 결과를 처리합니다. 관리자 안내는 신청자에게 표시됩니다.</p></div>
    <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2"><p>1. 신청을 ‘처리 중’으로 변경 → 2. 스토어 콘솔에서 테스터 등록·초대 → 3. ‘등록 완료’로 저장</p><div className="flex flex-wrap gap-4"><a className="text-primary underline" href="https://appstoreconnect.apple.com/apps/6818983333/testflight" target="_blank" rel="noreferrer">App Store Connect</a><a className="text-primary underline" href="https://play.google.com/console/u/0/developers/9115286728049311811/app/4974351096970053750/tracks/internal-testing" target="_blank" rel="noreferrer">Google Play 내부 테스트</a></div><p className="text-xs text-muted-foreground">이 화면의 상태 변경은 스토어 등록이나 외부 테스트 심사 제출을 자동으로 실행하지 않습니다.</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">상태 <select aria-label="신청 상태 필터" className={selectStyle} value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="all">전체</option>{Object.entries(REQUEST_STATUS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm">플랫폼 <select aria-label="플랫폼 필터" className={selectStyle} value={platform} onChange={e => { setPlatform(e.target.value); setPage(0); }}><option value="all">전체</option><option value="ios">iOS</option><option value="android">Android</option></select></label>
      <Button variant="outline" size="sm" onClick={() => setRevision(n => n+1)} disabled={loading}>새로고침</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p role="status">불러오는 중…</p> : !error && <>
      <p className="text-sm text-muted-foreground">총 {total}건</p>
      {!items.length && <p className="rounded-lg border p-6 text-sm text-muted-foreground">해당하는 신청이 없습니다.</p>}
      <div className="grid gap-4 xl:grid-cols-2">{items.map(item => <RequestEditor key={`${item.id}-${item.revision}`} item={item} onSaved={() => setRevision(n => n+1)} />)}</div>
      <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(n => n-1)}>이전</Button><span className="text-sm">{page+1} 페이지</span><Button variant="outline" size="sm" disabled={(page+1)*50 >= total} onClick={() => setPage(n => n+1)}>다음</Button></div>
    </>}
  </div>;
}
function RequestEditor({ item, onSaved }: { item: AdminAppRequest; onSaved: () => void }) {
  const [next, setNext] = useState<RequestStatus>('processing');
  const [note, setNote] = useState(item.admin_note);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const active = item.status === 'pending' || item.status === 'processing';
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (next === 'approved' && !confirmed) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/admin/app-requests/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: item.revision, status: next, note }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '처리에 실패했습니다.');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '처리에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="rounded-xl border bg-card p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{item.applicant.name || item.applicant.email || '신청자'} · {item.platform === 'ios' ? 'iOS' : 'Android'}</h3><Badge variant="secondary">{REQUEST_STATUS[item.status]}</Badge></div>
    <p className="break-all text-xs text-muted-foreground">{item.applicant.email}</p>
    <div className="text-sm"><p className="text-muted-foreground">스토어 계정 이메일</p><div className="flex flex-wrap items-center gap-2"><span className="break-all font-medium">{item.store_email}</span><Button type="button" size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(item.store_email); setCopied(true); } catch { setError('복사하지 못했습니다. 이메일을 직접 복사하세요.'); } }}>{copied ? '복사됨' : '복사'}</Button></div></div>
    <p className="text-xs text-muted-foreground">신청: {new Date(item.submitted_at).toLocaleString('ko-KR')}{item.reviewed_at && <> · 처리: {new Date(item.reviewed_at).toLocaleString('ko-KR')}</>}</p>
    {active ? <>
      <label className="block space-y-1 text-sm"><span>처리 결과</span><select className={`${selectStyle} w-full`} value={next} disabled={busy} onChange={e => { setNext(e.target.value as RequestStatus); setConfirmed(false); }}><option value="processing">처리 중</option><option value="approved">등록 완료</option><option value="rejected">반려</option></select></label>
      <label className="block space-y-1 text-sm"><span>신청자에게 보여줄 안내{next === 'rejected' ? ' (필수)' : ''}</span><Textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} required={next === 'rejected'} disabled={busy} placeholder="초대 확인 방법 또는 반려 사유" /></label>
      {next === 'approved' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />해당 이메일로 스토어 테스터 등록·초대를 완료했습니다.</label>}
      <Button type="submit" variant="outline" size="sm" disabled={busy || (next === 'approved' && !confirmed)}>{busy ? '저장 중…' : '처리 결과 저장'}</Button>
    </> : item.admin_note && <p className="whitespace-pre-wrap break-words text-sm">{item.admin_note}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
