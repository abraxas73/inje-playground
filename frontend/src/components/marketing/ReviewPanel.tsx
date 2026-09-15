"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELDS, emptyContact, visibleData, type Contact, type ContactData, type Field, type Organization, type Submission, type ReviewEvent, type ValidationRecord, type ReviewCheck, type Validation } from "@/lib/marketing/types";
import { fieldErrors, mergeUpdate } from "@/lib/marketing/validation";
import { api, date, errorMessage, KindBadge, OrganizationPicker, selectClass } from "./shared";
import { HistoryList, ValidationHistory } from "./HistoryList";
interface Inspection { submission: Submission; validation: Validation; contacts: Contact[]; organizations: Organization[] }
export default function ReviewPanel({ submission, reviewer, onSaved, onResubmit }: { submission: Submission; reviewer: boolean; onSaved: () => void; onResubmit: () => void }) {
  const [inspection, setInspection] = useState<Inspection | null>(null); const [target, setTarget] = useState<Contact | null>(null);
  const [org, setOrg] = useState<Organization | null>(null); const [category, setCategory] = useState("확인 필요"); const [final, setFinal] = useState<ContactData>(submission.data);
  const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [loading, setLoading] = useState(reviewer);
  const [showExtra, setShowExtra] = useState(false); const [rejectOpen, setRejectOpen] = useState(false);
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
      setTarget(c); const recommended = r.organizations.find(o => o.id === r.submission.submitted_organization_id) ?? (r.submission.submitted_organization_id ? null : c?.organization ?? (r.organizations.length === 1 ? r.organizations[0] : null));
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
  const approvalNeeds = [
    ...(loading || !inspection ? ["최신 Master 비교 완료"] : []),
    ...(!org ? ["등록된 회사·기관 검색 및 선택"] : []),
    ...(errors.length ? ["입력 오류 수정"] : []),
    ...(!currentCheck ? ["최종값 재검증 실행 (수정 후에는 다시 실행)"] : []),
    ...(currentCheck?.blockingErrors?.length ? [`승인 차단 오류 ${currentCheck.blockingErrors.length}건 해결`] : []),
    ...(currentCheck?.conflicts.length && (!resolved || resolution.trim().length < 2) ? [`확인 항목 ${currentCheck.conflicts.length}건의 근거 작성 및 확인 체크`] : []),
    ...(reason.trim().length < 2 ? ["검수 사유 / 확인 근거 2자 이상 입력"] : []),
    ...(!confirmed ? ["반영 대상·동일 인물·법인·최종값 확인 체크"] : []),
  ];
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
      {reviewer && pending && <div className="rounded-lg border p-4 space-y-3 text-sm"><p>승인: 최종값 재검증 → 확인 항목 근거 작성 → 검수 사유와 최종 확인 체크 → Master 반영.</p><p className="text-muted-foreground">반려: 사유만 입력해 반려할 수 있습니다. Master는 변경되지 않으며 제출자가 내용을 보완해 다시 제출할 수 있습니다.</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => document.getElementById(`review-actions-${submission.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>승인 조건·처리 버튼으로 이동</Button><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => setRejectOpen(v => !v)}>반려 사유 입력</Button></div>
        {rejectOpen && <div className="space-y-2 border-t pt-3"><label className="block">반려 사유<textarea className="mt-1 w-full rounded border p-3" value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} placeholder="반려 이유와 보완할 내용을 기록하세요."/></label><p className="text-xs text-muted-foreground">최종값 재검증이나 승인용 확인 체크 없이 반려할 수 있습니다. 사유는 변경 이력과 제출자 화면에 남습니다.</p><Button variant="outline" disabled={busy || loading || reason.trim().length < 2} onClick={() => review("reject")}>사유를 저장하고 반려</Button></div>}
      </div>}
      <div className="rounded-lg bg-primary/5 p-4 text-sm space-y-2"><h3 className="font-semibold">검증 근거</h3>{[...validation.errors, ...validation.reasons].map((r, i) => <p key={i}>· {r}</p>)}<p className="border-t border-primary/10 pt-2">AI · {validation.ai.reason}</p>{validation.ai.category && <p>AI 추천 분류: {validation.ai.category} (담당자 확인 필요)</p>}{reviewer && pending && <Button variant="outline" size="sm" disabled={busy || loading} onClick={retryAi}>AI 추천 다시 확인</Button>}</div>
      {reviewer && pending && !loading && inspection && <>
        <div className="space-y-2"><h3 className="font-semibold text-sm">반영 대상</h3><select aria-label="반영 대상 Contact" className={`${selectClass} w-full`} value={target?.id ?? ""} onChange={e => applyTarget(inspection.contacts.find(c => c.id === e.target.value) ?? null)}><option value="">새 Contact로 등록</option>{[...new Map([...inspection.contacts, ...(target ? [target] : [])].map(c => [c.id, c])).values()].map(c => <option key={c.id} value={c.id}>{c.db_id} · {c.data.name} · {c.data.email}</option>)}</select>
          <div className="flex gap-2"><Input aria-label="다른 Contact 검색" placeholder="다른 DB ID·이메일·성명 검색" value={targetQuery} onChange={e => setTargetQuery(e.target.value)} /><Button variant="outline" onClick={searchTarget} disabled={!targetQuery.trim()}>찾기</Button></div>{targetResults.length > 0 && <div className="max-h-40 overflow-auto border rounded-lg">{targetResults.map(c => <button key={c.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { applyTarget(c); setTargetResults([]); }}>{c.db_id} · {c.data.name} · {c.data.email}</button>)}</div>}
        </div>
        <div className="space-y-2"><h3 className="font-semibold text-sm">회사·기관 기준</h3><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><span className="text-sm">{org ? `${org.name} · ${org.category}` : "등록된 회사·기관을 선택해 주세요."}</span>{org && <Button variant="ghost" size="sm" onClick={() => { setOrg(null); setConfirmed(false); }}>다른 회사 선택</Button>}</div><OrganizationPicker onPick={o => { setOrg(o); setCategory(o.category); setConfirmed(false); }}/><p className="text-xs text-muted-foreground">새 회사·기관은 <a href="/marketing?view=organizations" target="_blank" rel="noopener noreferrer" className="text-primary underline">회사·기관에 먼저 등록 (새 탭)</a>한 뒤 다시 검색하세요. 표준명·분류는 선택한 회사 기준을 적용합니다.</p></div>
      </>}
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm text-left"><thead className="bg-muted/50"><tr><th className="p-3">항목</th>{reviewer && pending && <th className="p-3 min-w-28">기존 정보</th>}<th className="p-3 min-w-28">제출 정보</th>{reviewer && pending && <th className="p-3 min-w-44">최종 반영값</th>}</tr></thead><tbody>{(Object.keys(FIELDS) as Field[]).filter(k => showExtra || ["company", "name", "department", "position", "email", "phone", "confirmedAt", "notes"].includes(k)).map(k => <tr key={k} className={`border-t ${reviewer && pending && changed.includes(k) ? "bg-primary/[0.025]" : ""}`}><th className="p-3 font-medium whitespace-nowrap">{FIELDS[k]}</th>{reviewer && pending && <td className="p-3 text-muted-foreground break-all">{before[k] || "—"}</td>}<td className="p-3 break-all">{submission.clear_fields.includes(k) ? "삭제 요청" : submission.data[k] || "—"}</td>{reviewer && pending && <td className="p-2"><Input aria-label={`최종 ${FIELDS[k]}`} disabled={busy || loading || k === "company"} value={proposed[k]} type="text" maxLength={2000} onChange={e => { setFinal(d => ({ ...d, [k]: e.target.value })); setConfirmed(false); }} /></td>}</tr>)}</tbody></table></div>
      <Button variant="ghost" size="sm" onClick={() => setShowExtra(v => !v)}>{showExtra ? "원본·Eco 정보 접기" : "원본·Eco 정보 8개 펼치기"}</Button>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">원본 출처 · 검증 버전</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ source: submission.source, ruleVersion: validation.ruleVersion, ruleCheck: validation.ruleCheck, ai: validation.ai }, null, 2)}</pre></details>
      {!reviewer && <p className="text-sm text-muted-foreground">검수 담당자가 확인한 뒤 Master에 반영합니다.</p>}
      {events.length > 0 && <HistoryList events={events} />}
      <ValidationHistory records={validations} />
      {submission.status === "rejected" && <Button variant="outline" onClick={onResubmit}>내용 수정 후 다시 제출</Button>}
      {reviewer && pending && <div id={`review-actions-${submission.id}`} className="space-y-3 border-t pt-5 scroll-mt-6"><p className="text-sm">{target ? `${target.db_id} 업데이트` : "새 Contact 등록"} · {changed.length}개 필드 반영{!org && " · 회사·기관 선택 필요"}</p><p className="text-xs text-muted-foreground">변경 항목: {changed.map(k => FIELDS[k]).join(", ") || "없음"}</p>{errors.length > 0 && <p className="text-sm text-destructive">{errors.join(" · ")}</p>}
        <div className="rounded-lg border p-3 space-y-2"><Button variant="outline" disabled={busy || loading || !inspection || !!errors.length} onClick={checkFinal}>최종값 재검증</Button>{!currentCheck && <p className="text-xs text-muted-foreground">승인 전에 최종값으로 중복과 현재 관리 규칙을 다시 검사하세요. 값을 바꾸면 다시 검사해야 합니다.</p>}{currentCheck && <><p className="text-sm">{date(currentCheck.checkedAt)} · {currentCheck.blockingErrors?.length ? "승인을 차단하는 오류가 있습니다" : currentCheck.conflicts.length ? `확인이 필요한 항목 ${currentCheck.conflicts.length}건` : "추가 확인 항목 없음"}</p>{currentCheck.blockingErrors?.map((message,i) => <p key={i} role="alert" className="text-sm text-destructive">{message}</p>)}<p className="text-xs text-muted-foreground">승인 차단 오류 {currentCheck.blockingErrors?.length ?? 0}건 · 담당자 확인 항목 {currentCheck.conflicts.length}건</p>{!!currentCheck.conflicts.length && <p className="text-sm">아래 항목을 실제로 확인한 근거를 작성하세요. 확인하지 못한 항목이 있으면 검수 대기로 두거나 사유를 적어 반려하세요.</p>}{currentCheck.conflicts.map(c => <article key={c.key} className="rounded border bg-muted/20 p-3 space-y-1"><p className="text-sm text-amber-700">· {c.message}</p><p className="text-xs text-muted-foreground">{reviewHint(c.key, currentCheck)}</p></article>)}{!!currentCheck.conflicts.length && <><label className="block text-sm">확인 항목·충돌 해결 근거<textarea className="w-full rounded border p-2" value={resolution} maxLength={2000} onChange={e => { setResolution(e.target.value); setResolved(false); setConfirmed(false); }} placeholder="발송 정제 확인 자료, 정보 확인 근거, 동일 인물·법인 판단 등을 기록하세요." /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={resolved} onChange={e => { setResolved(e.target.checked); setConfirmed(false); }} />모든 관리 기준과 충돌을 확인하고 근거를 기록했습니다.</label></>}</>}</div>
        <label className="block space-y-1 text-sm">검수 사유 / 확인 근거<textarea className="w-full min-h-20 rounded-md border bg-background p-3" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="동일 인물·법인 여부, 분류 또는 반려 사유를 기록하세요." /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>반영 대상, 동일 인물·법인 여부와 최종값을 확인했습니다. 분류 ‘확인 필요’는 보류 상태로 유지됩니다.</span></label>
        <div aria-label="승인까지 남은 작업" className="rounded-lg border bg-muted/30 p-3 text-sm"><h3 className="font-semibold">{approvalNeeds.length ? "승인까지 남은 작업" : "승인 준비 완료"}</h3>{approvalNeeds.length ? <ul className="mt-2 list-disc pl-5 space-y-1">{approvalNeeds.map(item => <li key={item}>{item}</li>)}</ul> : <p className="mt-1">아래 ‘승인 후 Master 반영’을 누르면 확인한 내용이 반영됩니다.</p>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">승인 전에는 Master DB에 반영되지 않습니다.</p><div className="flex gap-2"><Button variant="outline" disabled={busy || loading || reason.trim().length < 2} onClick={() => review("reject")}>반려</Button><Button variant="outline" disabled={busy || loading || !inspection || !org || !confirmed || reason.trim().length < 2 || !!errors.length || !currentCheck || unresolved || !target || changed.length > 0 || target.organization_id !== org?.id} onClick={() => review("unchanged")}>변경 없음 종결</Button><Button disabled={busy || loading || !inspection || !org || !confirmed || reason.trim().length < 2 || !!errors.length || !currentCheck || unresolved} onClick={() => review("approve")}>{busy ? "처리 중…" : "승인 후 Master 반영"}</Button></div></div>
      </div>}
    </div>
  </section>;
}
function BadgeStatus({ status }: { status: string }) { return status === "pending" ? null : <span className="text-xs text-muted-foreground">{status === "approved" ? "반영 완료" : status === "unchanged" ? "변경 없음" : status === "validating" ? "검증 중" : "반려"}</span>; }

function reviewHint(key: string, check: ReviewCheck): string {
  if (key === "submitted-company") return "제출자가 선택한 회사와 최종 연결할 회사가 다릅니다. 제출 내용·실제 소속을 확인하고 변경 이유를 기록하세요.";
  if (key === "company") return "선택한 표준 회사와 제출 회사가 같은 법인인지 확인하세요. 다른 법인이면 올바른 회사를 선택하거나 별도 법인으로 등록한 뒤 재검증하세요.";
  if (key === "identity") return "빈 회사 정보를 보완하는 경우에도 표시될 수 있습니다. 해당 DB ID의 실제 인물·소속인지 확인하고 확인 자료를 기록하세요.";
  if (key.startsWith("submission:")) return "중복된 대기 요청과 비교하세요. 후속 보완본이라면 이전 요청을 반려한 뒤 이 요청에서 최종값을 다시 검증하세요. 서로 다른 요청이면 구분 근거가 필요합니다.";
  if (key.startsWith("contact:")) return "기존 Contact와 동일 인물인지 확인하세요. 같은 사람이면 새 등록 대신 해당 Master를 반영 대상으로 선택하세요.";
  const code = check.ruleCheck?.violations.find(v => `rule:${v.id}` === key)?.code;
  const hints: Record<string, string> = {
    "EXCEL-03-REVIEW": "명함·제출 부서 확인 등으로 실제 관리 대상과 소속을 확인하고 자료 출처를 기록하세요.",
    "EXCEL-04": "수신거부·반송 등 발송 정제 자료를 확인해야 합니다. Stibee 미연계만으로 확인 완료가 되지 않습니다. 자료가 없으면 확인 완료로 체크하지 마세요.",
    "EXCEL-07": "동일 법인이 확인된 표준 회사를 연결하세요. 비슷한 이름만으로 합치지 말고 확인 자료 또는 별도 법인 판단 근거를 기록하세요.",
    "EXCEL-08": "분류가 확실하면 회사 기준을 확인하고, 불확실하면 ‘확인 필요’로 유지한 사유를 기록하세요.",
    "EXCEL-12": "최종 반영값마다 확인된 출처를 점검하세요. 확인되지 않은 내용은 반영하지 말고 대기 또는 반려로 처리하세요.",
  };
  return code && hints[code] ? hints[code] : "판단 내용과 확인한 자료·출처를 ‘확인 항목·충돌 해결 근거’에 기록하세요. 체크만으로 사실 확인을 대신할 수 없습니다.";
}
