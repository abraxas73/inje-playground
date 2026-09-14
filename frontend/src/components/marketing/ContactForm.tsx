"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FIELDS, emptyContact, type ContactData, type Field, type SubmissionResult } from "@/lib/marketing/types";
import { api, errorMessage } from "./shared";
export default function ContactForm({ initial, initialClear = [], dbId = "", source, fixedRequestKey, onClose, onSaved }: { initial?: ContactData; initialClear?: Field[]; dbId?: string; source?: Record<string, unknown>; fixedRequestKey?: string; onClose: () => void; onSaved: (result?: SubmissionResult) => void }) {
  const [data, setData] = useState(initial ?? emptyContact()); const [target, setTarget] = useState(dbId); const [clear, setClear] = useState<Field[]>(initialClear);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [requestKey] = useState(() => fixedRequestKey ?? crypto.randomUUID());
  const [required,setRequired] = useState<string[]>([]);
  useEffect(() => { const abort=new AbortController(); api<import("@/lib/marketing/rule-management").RulesData>("/api/marketing/rules",undefined,abort.signal).then(r=>setRequired(r.rules.filter(x=>x.enabled&&x.config.operator==="required"&&!x.config.whenField&&!x.config.whenAnyFields).map(x=>x.config.field??""))).catch(()=>{}); return()=>abort.abort(); },[]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const result = await api<{results:SubmissionResult[]}>("/api/marketing/submissions", { rows: [{ data, dbId: target, clearFields: clear, requestKey, source: { type: "단건 입력", ...source } }] }); onSaved(result.results[0]); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{target ? "Contact 변경 제출" : "Contact 등록"}</DialogTitle><DialogDescription>누락·형식 오류도 확인 필요로 접수됩니다. Master 반영 전 현재 적용 중인 관리 규칙으로 검증합니다.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><label className="block space-y-1 text-sm">변경 대상 DB ID (신규는 빈칸)<Input value={target} onChange={e => setTarget(e.target.value)} placeholder="기존 DB ID" /></label>
      {target && <p className="rounded-lg bg-muted p-3 text-sm">변경 제출의 빈칸은 기존값을 유지합니다. 값을 지우려면 해당 필드의 ‘삭제’를 선택하세요.</p>}
      <div className="grid gap-4 sm:grid-cols-2">{(Object.keys(FIELDS) as Field[]).map(k => <div key={k}><label className="block space-y-1 text-sm"><span>{FIELDS[k]}{required.includes(k) && " *"}</span><Input value={data[k]} maxLength={2000} disabled={clear.includes(k)} type="text" placeholder={k === "confirmedAt" ? "YYYY-MM-DD" : undefined} onChange={e => setData(d => ({ ...d, [k]: e.target.value }))} /></label>{target && k !== "company" && <label className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={clear.includes(k)} onChange={e => setClear(v => e.target.checked ? [...v, k] : v.filter(x => x !== k))} />삭제</label>}</div>)}</div>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" disabled={busy}>{busy ? "검증·제출 중…" : "검증 후 제출"}</Button></div>
    </form></DialogContent></Dialog>;
}
