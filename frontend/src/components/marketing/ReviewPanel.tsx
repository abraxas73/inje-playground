"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIES, FIELDS, emptyContact, visibleData, type Contact, type ContactData, type Field, type Organization, type Submission, type ReviewEvent, type ValidationRecord, type ReviewCheck, type Validation } from "@/lib/marketing/types";
import { fieldErrors, mergeUpdate } from "@/lib/marketing/validation";
import { api, date, errorMessage, KindBadge, OrganizationPicker, selectClass } from "./shared";
import { HistoryList, ValidationHistory } from "./HistoryList";
interface Inspection { submission: Submission; validation: Validation; contacts: Contact[]; organizations: Organization[] }
export default function ReviewPanel({ submission, reviewer, onSaved, onResubmit }: { submission: Submission; reviewer: boolean; onSaved: () => void; onResubmit: () => void }) {
  const [inspection, setInspection] = useState<Inspection | null>(null); const [target, setTarget] = useState<Contact | null>(null);
  const [org, setOrg] = useState<Organization | null>(null); const [category, setCategory] = useState("확인 필요"); const [final, setFinal] = useState<ContactData>(submission.data);
  const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [loading, setLoading] = useState(reviewer);
  const [showExtra, setShowExtra] = useState(false);
  const [targetQuery, setTargetQuery] = useState(""); const [targetResults, setTargetResults] = useState<Contact[]>([]);
  const pending = submission.status === "pending" || submission.status === "validating";
  const [events, setEvents] = useState<ReviewEvent[]>([]); const [validations, setValidations] = useState<ValidationRecord[]>([]);
  const [check, setCheck] = useState<{ key: string; result: ReviewCheck } | null>(null); const [resolution, setResolution] = useState(""); const [resolved, setResolved] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    api<{ events: ReviewEvent[]; validations: ValidationRecord[] }>(`/api/marketing?view=submission&id=${submission.id}`, undefined, abort.signal).then(r => { if (!abort.signal.aborted) { setEvents(r.events); setValidations(r.validations); } }).catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); });
    return () => abort.abort();
  }, [submission.id, inspection]);
  function applyTarget(c: Contact | null, s = submission) {
    setTarget(c); setOrg(c?.organization ?? null); setCategory(c?.organization?.category ?? "확인 필요");
    setFinal(c ? mergeUpdate(visibleData(c), s.data, s.clear_fields) : { ...emptyContact(), ...s.data }); setConfirmed(false);
  }
  useEffect(() => {
    if (!reviewer || !pending) { setLoading(false); return; }
    const controller = new AbortController();
    api<Inspection>("/api/marketing/review", { action: "inspect", id: submission.id }, controller.signal).then(r => {
      if (controller.signal.aborted) return;
      setInspection(r); const c = r.contacts.find(c => c.id === r.validation.targetId) ?? null;
      setTarget(c); const recommended = c?.organization ?? (r.organizations.length === 1 ? r.organizations[0] : null);
      setOrg(recommended); setCategory(recommended?.category ?? r.validation.ai.category ?? "확인 필요");
      setFinal(c ? mergeUpdate(visibleData(c), r.submission.data, r.submission.clear_fields) : { ...emptyContact(), ...r.submission.data });
    }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [submission.id, reviewer, pending]);
  const validation = inspection?.validation ?? submission.validation;
  const proposed = { ...final, company: org?.name ?? final.company };
  const errors = fieldErrors(proposed); const before = target ? visibleData(target) : emptyContact();
  const changed = (Object.keys(FIELDS) as Field[]).filter(k => before[k] !== proposed[k]);
  const checkKey = JSON.stringify([proposed, target?.id, org?.id, category, inspection?.submission.version]);
  const currentCheck = check?.key === checkKey ? check.result : null;
  const unresolved = !!currentCheck?.blockingErrors?.length || (!!currentCheck?.conflicts.length && (!resolved || resolution.trim().length < 2));
  async function checkFinal() {
    setBusy(true); setError(""); setConfirmed(false); setResolved(false);
    try { const result = await api<ReviewCheck>("/api/marketing/review", { action: "check", id: submission.id, final: proposed, targetId: target?.id, organizationId: org?.id, category }); setCheck({ key: checkKey, result }); }
    catch(e) { setError(errorMessage(e)); setCheck(null); } finally { setBusy(false); }
  }
  async function review(action: "approve" | "reject" | "unchanged") {
    setBusy(true); setError("");
    try { await api("/api/marketing/review", { id: submission.id, version: inspection?.submission.version ?? submission.version, action, final: proposed, targetId: target?.id, targetVersion: target?.version, organizationId: org?.id, organizationVersion: org?.version, category, reason, resolution: currentCheck ? { token: currentCheck.token, reason: resolved ? resolution : "" } : null }); onSaved(); }
    catch (e) { setError(errorMessage(e)); setConfirmed(false); setCheck(null); } finally { setBusy(false); }
  }
  async function searchTarget() {
    try { const r = await api<{ rows: Contact[] }>(`/api/marketing?q=${encodeURIComponent(targetQuery)}`); setTargetResults(r.rows); } catch (e) { setError(errorMessage(e)); }
  }
  async function retryAi() {
    setBusy(true); setError("");
    try { const r = await api<Inspection>("/api/marketing/review", { action: "inspect", id: submission.id, ai: true }); setInspection(r); setConfirmed(false); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="min-w-0 rounded-xl border bg-card flex flex-col" aria-label="Contact 검수 상세">
    <header className="border-b p-5 space-y-2"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{submission.data.name || "성명 미입력"}</h2><KindBadge kind={validation.kind} /><BadgeStatus status={inspection?.submission.status ?? submission.status} /></div><p className="text-sm text-muted-foreground break-all">{submission.data.email || "이메일 미입력"}</p><p className="text-xs text-muted-foreground">{submission.division} · {submission.submitter} · {date(submission.created_at)}</p></header>
    <div className="p-5 space-y-5">
      {loading && <p role="status">최신 Master와 비교하고 있습니다…</p>}
      {error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <div className="rounded-lg bg-primary/5 p-4 text-sm space-y-2"><h3 className="font-semibold">검증 근거</h3>{[...validation.errors, ...validation.reasons].map((r, i) => <p key={i}>· {r}</p>)}<p className="border-t border-primary/10 pt-2">AI · {validation.ai.reason}</p>{validation.ai.category && <p>AI 추천 분류: {validation.ai.category} (담당자 확인 필요)</p>}{reviewer && pending && <Button variant="outline" size="sm" disabled={busy || loading} onClick={retryAi}>AI 추천 다시 확인</Button>}</div>
      {reviewer && pending && !loading && inspection && <>
        <div className="space-y-2"><h3 className="font-semibold text-sm">반영 대상</h3><select aria-label="반영 대상 Contact" className={`${selectClass} w-full`} value={target?.id ?? ""} onChange={e => applyTarget(inspection.contacts.find(c => c.id === e.target.value) ?? null)}><option value="">새 Contact로 등록</option>{[...new Map([...inspection.contacts, ...(target ? [target] : [])].map(c => [c.id, c])).values()].map(c => <option key={c.id} value={c.id}>{c.db_id} · {c.data.name} · {c.data.email}</option>)}</select>
          <div className="flex gap-2"><Input aria-label="다른 Contact 검색" placeholder="다른 DB ID·이메일·성명 검색" value={targetQuery} onChange={e => setTargetQuery(e.target.value)} /><Button variant="outline" onClick={searchTarget} disabled={!targetQuery.trim()}>찾기</Button></div>{targetResults.length > 0 && <div className="max-h-40 overflow-auto border rounded-lg">{targetResults.map(c => <button key={c.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { applyTarget(c); setTargetResults([]); }}>{c.db_id} · {c.data.name} · {c.data.email}</button>)}</div>}
        </div>
        <div className="space-y-2"><h3 className="font-semibold text-sm">회사·기관 기준</h3><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><span className="text-sm">{org ? `${org.name} · ${org.category}` : "새 회사·기관으로 등록"}</span>{org && <Button variant="ghost" size="sm" onClick={() => { setOrg(null); setConfirmed(false); }}>별도 법인으로 등록</Button>}</div><OrganizationPicker onPick={o => { setOrg(o); setCategory(o.category); setConfirmed(false); }} />{!org && <label className="block text-sm space-y-1">신규 회사·기관 분류<select className={`${selectClass} w-full`} value={category} onChange={e => { setCategory(e.target.value); setConfirmed(false); }}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>}</div>
      </>}
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm text-left"><thead className="bg-muted/50"><tr><th className="p-3">항목</th>{reviewer && pending && <th className="p-3 min-w-28">기존 정보</th>}<th className="p-3 min-w-28">제출 정보</th>{reviewer && pending && <th className="p-3 min-w-44">최종 반영값</th>}</tr></thead><tbody>{(Object.keys(FIELDS) as Field[]).filter(k => showExtra || ["company", "name", "department", "position", "email", "phone", "confirmedAt", "notes"].includes(k)).map(k => <tr key={k} className={`border-t ${reviewer && pending && changed.includes(k) ? "bg-primary/[0.025]" : ""}`}><th className="p-3 font-medium whitespace-nowrap">{FIELDS[k]}</th>{reviewer && pending && <td className="p-3 text-muted-foreground break-all">{before[k] || "—"}</td>}<td className="p-3 break-all">{submission.clear_fields.includes(k) ? "삭제 요청" : submission.data[k] || "—"}</td>{reviewer && pending && <td className="p-2"><Input aria-label={`최종 ${FIELDS[k]}`} disabled={busy || loading || (k === "company" && !!org)} value={proposed[k]} type="text" maxLength={2000} onChange={e => { setFinal(d => ({ ...d, [k]: e.target.value })); setConfirmed(false); }} /></td>}</tr>)}</tbody></table></div>
      <Button variant="ghost" size="sm" onClick={() => setShowExtra(v => !v)}>{showExtra ? "원본·Eco 정보 접기" : "원본·Eco 정보 8개 펼치기"}</Button>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">원본 출처 · 검증 버전</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ source: submission.source, ruleVersion: validation.ruleVersion, ruleCheck: validation.ruleCheck, ai: validation.ai }, null, 2)}</pre></details>
      {!reviewer && <p className="text-sm text-muted-foreground">검수 담당자가 확인한 뒤 Master에 반영합니다.</p>}
      {events.length > 0 && <HistoryList events={events} />}
      <ValidationHistory records={validations} />
      {submission.status === "rejected" && <Button variant="outline" onClick={onResubmit}>내용 수정 후 다시 제출</Button>}
      {reviewer && pending && <div className="space-y-3 border-t pt-5"><p className="text-sm">{target ? `${target.db_id} 업데이트` : "새 Contact 등록"} · {changed.length}개 필드 반영{!org && " · 새 회사·기관 생성"}</p><p className="text-xs text-muted-foreground">변경 항목: {changed.map(k => FIELDS[k]).join(", ") || "없음"}</p>{errors.length > 0 && <p className="text-sm text-destructive">{errors.join(" · ")}</p>}
        <div className="rounded-lg border p-3 space-y-2"><Button variant="outline" disabled={busy || loading || !inspection || !!errors.length} onClick={checkFinal}>최종값 재검증</Button>{!currentCheck && <p className="text-xs text-muted-foreground">승인 전에 최종값으로 중복과 현재 관리 규칙을 다시 검사하세요. 값을 바꾸면 다시 검사해야 합니다.</p>}{currentCheck && <><p className="text-sm">{date(currentCheck.checkedAt)} · {currentCheck.blockingErrors?.length ? "승인을 차단하는 오류가 있습니다" : currentCheck.conflicts.length ? `확인이 필요한 항목 ${currentCheck.conflicts.length}건` : "추가 확인 항목 없음"}</p>{currentCheck.blockingErrors?.map((message,i) => <p key={i} role="alert" className="text-sm text-destructive">{message}</p>)}{currentCheck.conflicts.map(c => <p key={c.key} className="text-sm text-amber-700">· {c.message}</p>)}{!!currentCheck.conflicts.length && <><label className="block text-sm">확인 항목·충돌 해결 근거<textarea className="w-full rounded border p-2" value={resolution} maxLength={2000} onChange={e => { setResolution(e.target.value); setResolved(false); setConfirmed(false); }} placeholder="발송 정제 확인 자료, 정보 확인 근거, 동일 인물·법인 판단 등을 기록하세요." /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={resolved} onChange={e => { setResolved(e.target.checked); setConfirmed(false); }} />모든 관리 기준과 충돌을 확인하고 근거를 기록했습니다.</label></>}</>}</div>
        <label className="block space-y-1 text-sm">검수 사유 / 확인 근거<textarea className="w-full min-h-20 rounded-md border bg-background p-3" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="동일 인물·법인 여부, 분류 또는 반려 사유를 기록하세요." /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>반영 대상, 동일 인물·법인 여부와 최종값을 확인했습니다. 분류 ‘확인 필요’는 보류 상태로 유지됩니다.</span></label>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">승인 전에는 Master DB에 반영되지 않습니다.</p><div className="flex gap-2"><Button variant="outline" disabled={busy || reason.trim().length < 2} onClick={() => review("reject")}>반려</Button><Button variant="outline" disabled={busy || loading || !inspection || !confirmed || reason.trim().length < 2 || !!errors.length || !currentCheck || unresolved || !target || changed.length > 0 || target.organization_id !== org?.id} onClick={() => review("unchanged")}>변경 없음 종결</Button><Button disabled={busy || loading || !inspection || !confirmed || reason.trim().length < 2 || !!errors.length || !currentCheck || unresolved} onClick={() => review("approve")}>{busy ? "처리 중…" : "승인 후 Master 반영"}</Button></div></div>
      </div>}
    </div>
  </section>;
}
function BadgeStatus({ status }: { status: string }) { return status === "pending" ? null : <span className="text-xs text-muted-foreground">{status === "approved" ? "반영 완료" : status === "unchanged" ? "변경 없음" : status === "validating" ? "검증 중" : "반려"}</span>; }
