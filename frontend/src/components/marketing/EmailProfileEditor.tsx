"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EmailProfile } from "@/lib/marketing/email/types";
import { api, date, errorMessage } from "./shared";
type ProfileData = { organization: { id: string; name: string; version: number }; profile: EmailProfile | null; editable: boolean; history: { version: number; actor_name: string; reason: string; created_at: string; after_data: EmailProfile }[] };
export default function EmailProfileEditor({ organizationId, onClose, onSaved }: { organizationId: string; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<ProfileData>(); const [website, setWebsite] = useState(""); const [domains, setDomains] = useState(""); const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { const a = new AbortController(); api<ProfileData>(`/api/marketing/email-checks/profiles?id=${organizationId}`, undefined, a.signal).then(r => { setData(r); setWebsite(r.profile?.website ?? ""); setDomains(r.profile?.domains.join("\n") ?? ""); }).catch(e => { if (!a.signal.aborted) setError(errorMessage(e)); }); return () => a.abort(); }, [organizationId]);
  async function save() {
    if (!data) return; setBusy(true); setError("");
    try { await api("/api/marketing/email-checks/profiles", { id: organizationId, version: data.profile?.version ?? 0, organizationVersion: data.organization.version, website, domains: domains.split(/[\n,]/).map(x => x.trim()).filter(Boolean), reason }); onSaved(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={v => { if (!v && !busy) onClose(); }}><DialogContent className="sm:max-w-xl max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>회사 홈페이지·이메일 기준</DialogTitle><DialogDescription>{data?.organization.name ?? "회사 기준 조회 중…"} · 소속 Contact에 같은 기준을 적용합니다.</DialogDescription></DialogHeader>
    <p className="rounded border bg-muted/30 p-3 text-sm">공식 홈페이지와 실제 사용하는 이메일 도메인을 확인한 뒤 근거를 기록하세요. 후보 홈페이지의 응답만으로 회사 소유를 확정하지 않습니다.</p>
    <label className="space-y-1 text-sm">확인한 회사 홈페이지<Input aria-label="확인한 회사 홈페이지" placeholder="https://www.company.co.kr/" value={website} onChange={e => setWebsite(e.target.value)} disabled={!data?.editable || busy}/></label>
    <label className="space-y-1 text-sm">확인한 이메일 도메인 (한 줄에 하나)<textarea aria-label="확인한 이메일 도메인" className="w-full rounded border p-2 min-h-24" placeholder="company.co.kr" value={domains} onChange={e => setDomains(e.target.value)} disabled={!data?.editable || busy}/></label>
    <p className="text-xs text-muted-foreground">홈페이지와 이메일 도메인은 달라도 됩니다. 등록 도메인과 정확히 일치하는 주소에만 회사 연관성 확인을 적용합니다. 하위 메일 도메인도 각각 등록하세요.</p>
    <label className="space-y-1 text-sm">확인·변경 근거<textarea aria-label="확인·변경 근거" className="w-full rounded border p-2" maxLength={2000} placeholder="회사 홈페이지의 연락처 안내 또는 담당자 확인 내용" value={reason} onChange={e => setReason(e.target.value)} disabled={!data?.editable || busy}/></label>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}<Button disabled={busy || !data?.editable || reason.trim().length < 2} onClick={() => void save()}>확인한 기준 저장</Button>
    {!!data?.history.length && <details><summary className="text-sm cursor-pointer">최근 변경 이력 (최대 20개)</summary>{data.history.map(h => <div key={h.version} className="border-t py-3 text-xs space-y-1"><p>v{h.version} · {h.actor_name} · {date(h.created_at)}</p><p>{h.reason}</p><p className="break-all">{h.after_data.website || "홈페이지 미등록"} · {h.after_data.domains.join(", ") || "도메인 미등록"}</p></div>)}</details>}
  </DialogContent></Dialog>;
}
