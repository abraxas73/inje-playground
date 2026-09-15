"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FIELDS, emptyContact, type ContactData, type Field, type SubmissionResult, type Organization } from "@/lib/marketing/types";
import { api, errorMessage } from "./shared";
import ContactOrganizationPicker from "./ContactOrganizationPicker";
export default function ContactForm({ initial, initialOrganizationId, initialClear = [], dbId = "", source, fixedRequestKey, onClose, onSaved }: { initial?: ContactData; initialOrganizationId?: string | null; initialClear?: Field[]; dbId?: string; source?: Record<string, unknown>; fixedRequestKey?: string; onClose: () => void; onSaved: (result?: SubmissionResult) => void }) {
  const [data, setData] = useState(initial ?? emptyContact()); const [target, setTarget] = useState(dbId); const [clear, setClear] = useState<Field[]>(initialClear);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [requestKey] = useState(() => fixedRequestKey ?? crypto.randomUUID());
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loadingOrganization, setLoadingOrganization] = useState(!!initialOrganizationId);
  useEffect(() => {
    if (!initialOrganizationId) return;
    const abort = new AbortController();
    api<{rows: Organization[]}>(`/api/marketing/organizations?id=${initialOrganizationId}`, undefined, abort.signal).then(r => { if (!abort.signal.aborted) setOrganization(r.rows[0] ?? null); }).catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!abort.signal.aborted) setLoadingOrganization(false); });
    return () => abort.abort();
  }, [initialOrganizationId]);
  const [required,setRequired] = useState<string[]>([]);
  useEffect(() => { const abort=new AbortController(); api<import("@/lib/marketing/rule-management").RulesData>("/api/marketing/rules",undefined,abort.signal).then(r=>setRequired(r.rules.filter(x=>x.enabled&&x.config.operator==="required"&&!x.config.whenField&&!x.config.whenAnyFields).map(x=>x.config.field??""))).catch(()=>{}); return()=>abort.abort(); },[]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!organization) { setError("등록된 회사·기관을 검색하여 선택해 주세요."); return; } setBusy(true); setError("");
    try { const result = await api<{results:SubmissionResult[]}>("/api/marketing/submissions", { mode: "form", rows: [{ data: { ...data, company: organization.name }, organizationId: organization.id, organizationVersion: organization.version, dbId: target, clearFields: clear.filter(k => k !== "company"), requestKey, source: { type: "단건 입력", ...source } }] }); onSaved(result.results[0]); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{target ? "Contact 변경 제출" : "Contact 등록"}</DialogTitle><DialogDescription>등록된 회사·기관을 선택해 주세요. 그 외 누락·형식 오류는 확인 필요로 접수됩니다. Master 반영 전 현재 적용 중인 관리 규칙으로 검증합니다.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><label className="block space-y-1 text-sm">변경 대상 DB ID (신규는 빈칸)<Input value={target} onChange={e => setTarget(e.target.value)} placeholder="기존 DB ID" /></label>
      {target && <p className="rounded-lg bg-muted p-3 text-sm">회사·기관은 검색 결과에서 선택합니다. 다른 필드의 빈칸은 기존값을 유지합니다. 값을 지우려면 해당 필드의 ‘삭제’를 선택하세요.</p>}
      <div className="grid gap-4 sm:grid-cols-2"><ContactOrganizationPicker value={organization} initialName={data.company} disabled={busy || loadingOrganization} onChange={setOrganization}/>{loadingOrganization && <p role="status">기존 회사·기관을 확인하고 있습니다…</p>}{(Object.keys(FIELDS) as Field[]).filter(k => k !== "company").map(k => <div key={k}><label className="block space-y-1 text-sm"><span>{FIELDS[k]}{required.includes(k) && " *"}</span><Input value={data[k]} maxLength={2000} disabled={clear.includes(k)} type="text" placeholder={k === "confirmedAt" ? "YYYY-MM-DD" : undefined} onChange={e => setData(d => ({ ...d, [k]: e.target.value }))} /></label>{target && <label className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={clear.includes(k)} onChange={e => setClear(v => e.target.checked ? [...v, k] : v.filter(x => x !== k))} />삭제</label>}</div>)}</div>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" disabled={busy || loadingOrganization || !organization}>{busy ? "검증·제출 중…" : "검증 후 제출"}</Button></div>
    </form></DialogContent></Dialog>;
}
