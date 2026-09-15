"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, selectClass } from "./shared";
export default function EmailCheckDialog({ filters = {}, ids = [], filteredCount, onClose }: { filters?: Record<string, unknown>; ids?: string[]; filteredCount?: number; onClose: () => void }) {
  const router = useRouter(); const [scope, setScope] = useState(ids.length ? "selected" : filteredCount === undefined ? "all" : "filtered");
  const [total, setTotal] = useState<number>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [key] = useState(() => crypto.randomUUID());
  useEffect(() => { const a = new AbortController(); api<{ total: number }>("/api/marketing?view=meta", undefined, a.signal).then(r => setTotal(r.total)).catch(e => { if (!a.signal.aborted) setError(errorMessage(e)); }); return () => a.abort(); }, []);
  const count = scope === "all" ? total : scope === "selected" ? ids.length : filteredCount;
  async function start() {
    setBusy(true); setError("");
    try { const r = await api<{ id: string }>("/api/marketing/email-checks", { requestKey: key, scope, filters: scope === "filtered" ? filters : {}, ids: scope === "selected" ? ids : [] }); router.push(`/marketing/email-checks/${r.id}`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return <Dialog open onOpenChange={v => { if (!v && !busy) onClose(); }}><DialogContent><DialogHeader><DialogTitle>이메일 정합성 검사</DialogTitle><DialogDescription>회사 도메인 연관성, 홈페이지 응답, 메일 수신 도메인 설정을 확인합니다.</DialogDescription></DialogHeader>
    <label className="space-y-2 text-sm">검사 대상<select aria-label="이메일 검사 대상" className={`${selectClass} w-full`} value={scope} onChange={e => setScope(e.target.value)}><option value="all">전체 Master · {total?.toLocaleString() ?? "조회 중"}건</option>{filteredCount !== undefined && <option value="filtered">현재 필터 결과 전체 · {filteredCount.toLocaleString()}건</option>}<option value="selected" disabled={!ids.length}>직접 선택 · {ids.length}건</option></select></label>
    <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-2"><p>회사별로 확인한 홈페이지·이메일 도메인 기준과 비교합니다. 기준이 없으면 이메일 도메인의 홈페이지를 후보로 확인합니다.</p><p>개별 메일함 존재·실제 수신 성공은 별도 확인이 필요합니다. 검사 메일을 발송하지 않으며, Master 값은 변경하지 않습니다.</p><p className="text-xs text-muted-foreground">외부 조회에는 도메인과 홈페이지 주소만 사용합니다. 화면을 닫아도 검사가 이어집니다.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy || !count} onClick={() => void start()}>{busy ? "검사 생성 중…" : `${count?.toLocaleString() ?? "…"}건 검사 시작`}</Button>
  </DialogContent></Dialog>;
}
