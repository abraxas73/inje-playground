"use client";
import { useEffect, useState } from "react";
import { Database, Download, FileSpreadsheet, Plus, RefreshCw, Search, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORIES, FIELDS, KINDS, visibleData, type Contact, type ContactData, type Field, type Organization, type ReviewEvent, type OrganizationConflict, type Submission, type MasterSortField, type SortDirection } from "@/lib/marketing/types";
import { api, date, errorMessage, KindBadge, selectClass } from "./shared";
import { HistoryList } from "./HistoryList";
import MasterTable from "./MasterTable";
import ContactForm from "./ContactForm";
import ExcelUpload from "./ExcelUpload";
import ReviewPanel from "./ReviewPanel";
import Link from "next/link";
import ValidationRunDialog from "./ValidationRunDialog";
import EmailCheckDialog from "./EmailCheckDialog";
import EmailProfileEditor from "./EmailProfileEditor";
import ContactEmailHistory from "./ContactEmailHistory";
import ReviewerManagement from "./ReviewerManagement";
import OrganizationEditor from "./OrganizationEditor";
type View = "master" | "queue" | "organizations" | "history";
interface Meta { total: number; pending: number; missingCompany: number; missingName: number; unclassified: number; reviewer: boolean; admin: boolean; reviewerManager: boolean; identity: { name: string; division: string } }
interface Listing { rows: (Contact | Submission | Organization | ReviewEvent)[]; total: number; counts?: Record<string, number> }
export default function MarketingWorkspace() {
  const [view, setView] = useState<View>("master"); const [meta, setMeta] = useState<Meta | null>(null);
  const [result, setResult] = useState<{ key: string; listing: Listing } | null>(null); const [page, setPage] = useState(1);
  const [department, setDepartment] = useState(""); const [conflicts, setConflicts] = useState<OrganizationConflict[]>([]);
  const [q, setQ] = useState(""); const [kind, setKind] = useState(""); const [category, setCategory] = useState(""); const [division, setDivision] = useState(""); const [issues, setIssues] = useState(false); const [status, setStatus] = useState("pending");
  const [revision, setRevision] = useState(0); const [selected, setSelected] = useState<string | null>(null); const [loading, setBusy] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [validationOpen,setValidationOpen]=useState(false);
  const [emailOpen, setEmailOpen] = useState(false); const [emailProfile, setEmailProfile] = useState<string>();
  const filterKey=JSON.stringify([q,category,department,issues]);
  const [selection,setSelection]=useState<{key:string;ids:string[]}>({key:filterKey,ids:[]});
  const selectedIds=selection.key===filterKey?selection.ids:[];
  const [sort, setSort] = useState<MasterSortField>("db_id"); const [direction, setDirection] = useState<SortDirection>("asc");
  const requestKey = JSON.stringify([view, page, q, kind, category, division, issues, status, revision, department, sort, direction]);
  const listing: Listing = result?.key === requestKey ? result.listing : { rows: [], total: 0 };
  const busy = loading || result?.key !== requestKey;
  const [form, setForm] = useState<{ initial?: ContactData; initialOrganizationId?: string | null; initialClear?: Field[]; dbId?: string } | null>(null); const [upload, setUpload] = useState<"master" | "submit" | null>(null);
  const [contact, setContact] = useState<{ contact: Contact; sources: unknown[]; events: ReviewEvent[] } | null>(null); const [organization, setOrganization] = useState<Organization | null>(null); const [createOrganization, setCreateOrganization] = useState(false); const [adminOpen, setAdminOpen] = useState(false);
  function refresh(message = "") { setRevision(v => v + 1); setSelected(null); setNotice(message); }
  function filterChanged() { setSelection({key:"",ids:[]}); if(selectedIds.length) setNotice("필터가 바뀌어 행 선택을 해제했습니다."); }
  function navigate(v: View) { filterChanged(); setView(v); setPage(1); setQ(""); setKind(""); setCategory(""); setDivision(""); setDepartment(""); setIssues(false); setSelected(null); }
  function sortMaster(field: MasterSortField) { setDirection(sort === field && direction === "asc" ? "desc" : "asc"); setSort(field); setPage(1); }
  useEffect(() => {
    const abort = new AbortController(); api<Meta>("/api/marketing?view=meta", undefined, abort.signal).then(setMeta).catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); });
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError("");
      const params = new URLSearchParams({ view, page: String(page), q, kind, category, division, status, department, issues: String(issues), sort, direction });
      api<Listing>(`/api/marketing?${params}`, undefined, abort.signal).then(r => { if (abort.signal.aborted) return; setResult({ key: requestKey, listing: r }); setSelected(s => r.rows.some(row => row.id === s) ? s : r.rows[0]?.id ?? null); }).catch(e => { if (!abort.signal.aborted) { setError(errorMessage(e)); setResult({ key: requestKey, listing: { rows: [], total: 0 } }); } }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [view, page, q, kind, category, division, issues, status, revision, requestKey, department, sort, direction]);
  useEffect(() => {
    const abort = new AbortController();
    if (view === "organizations") api<{ rows: OrganizationConflict[] }>("/api/marketing?view=organization-conflicts", undefined, abort.signal).then(r => { if (!abort.signal.aborted) setConflicts(r.rows); }).catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); });
    return () => abort.abort();
  }, [view, revision]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "organizations") setView("organizations");
  }, []);
  async function openContact(c: Contact) { try { setContact(await api(`/api/marketing?view=contact&id=${c.id}`)); } catch (e) { setError(errorMessage(e)); } }
  async function downloadMaster() {
    setExporting(true); setError("");
    try {
      const params = new URLSearchParams({ q, category, department, issues: String(issues), sort, direction });
      const response = await fetch(`/api/marketing/export?${params}`);
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Excel 다운로드에 실패했습니다."); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Master-DB.xlsx";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`필터 결과 ${Number(response.headers.get("X-Export-Count") ?? 0).toLocaleString()}건의 Excel 다운로드를 시작했습니다.`);
    } catch (e) { setError(errorMessage(e)); } finally { setExporting(false); }
  }
  async function resubmit(s: Submission) {
    try {
      const target = s.target_id ? await api<{ contact: Contact }>(`/api/marketing?view=contact&id=${s.target_id}`) : null;
      setForm({ initial: s.data, initialOrganizationId: s.submitted_organization_id, initialClear: s.clear_fields, dbId: target?.contact.db_id });
    } catch (e) { setError(errorMessage(e)); }
  }
  const selectedSubmission = view === "queue" ? (listing.rows as Submission[]).find(s => s.id === selected) : null;
  const pages = Math.max(1, Math.ceil(listing.total / 25));
  return <div className="w-full min-w-0 space-y-6">
    <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div><div className="flex items-center gap-2"><Database className="h-6 w-6 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">마케팅 Master DB</h1></div><p className="mt-1 text-sm text-muted-foreground">부문별 Contact를 취합하고, 검증·검수·승인을 거쳐 관리합니다.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href="/api/marketing/excel"><Download className="h-4 w-4" />양식 다운로드</a></Button><Button variant="outline" onClick={() => setUpload("submit")}><FileSpreadsheet className="h-4 w-4" />Excel 제출</Button><Button onClick={() => setForm({})}><Plus className="h-4 w-4" />Contact 등록</Button></div></div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4 text-sm"><div className="flex flex-wrap gap-x-6 gap-y-2"><Stat label="Master" value={meta?.total} /><Stat label="검수 대기" value={meta?.pending} /><Stat label="회사명 누락" value={meta?.missingCompany} /><Stat label="성명 누락" value={meta?.missingName} /><Stat label="분류 확인 필요" value={meta?.unclassified} /></div><div className="flex items-center gap-2">{meta && <span className="text-xs text-muted-foreground">{meta.reviewer ? "검수 담당자" : "제출 담당자"} · {meta.identity?.division}</span>}<Button variant="ghost" size="icon" aria-label="새로고침" onClick={() => refresh()}><RefreshCw className="h-4 w-4" /></Button>{meta && <Button variant="outline" size="sm" onClick={() => setAdminOpen(true)}><ShieldCheck className="h-4 w-4" />{meta.reviewerManager ? "검수자 관리" : "검수자 정보"}</Button>}</div></div>
    <div className="flex justify-end"><Button variant="outline" size="sm" asChild><Link href="/marketing/rules"><ShieldCheck className="h-4 w-4" />관리 규칙</Link></Button><Button variant="outline" size="sm" asChild><Link href="/marketing/validations">검증 이력</Link></Button><Button variant="outline" size="sm" asChild><Link href="/marketing/email-checks">이메일 정합성</Link></Button></div>
    {notice && <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">{notice}</p>}
    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={() => refresh()}>다시 시도</Button></div>}
    <div role="tablist" aria-label="마케팅 DB 메뉴" onKeyDown={e => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')); const i = tabs.indexOf(e.target as HTMLButtonElement); const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; tabs[next]?.focus(); tabs[next]?.click(); }} className="flex overflow-x-auto border-b">{([['master','Master DB'],['queue',meta?.reviewer ? '검수 대기' : '내 제출'],['organizations','회사·기관'],['history','변경 이력']] as [View,string][]).map(([v,t]) => <button key={v} role="tab" tabIndex={v === view ? 0 : -1} aria-selected={v === view} onClick={() => navigate(v)} className={`whitespace-nowrap border-b-2 px-5 py-3 text-sm font-medium ${v === view ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}{v === "queue" && !!meta?.pending && <span className="ml-2 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs">{meta.pending}</span>}</button>)}</div>
    <div className="flex flex-wrap gap-2">{<div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="목록 검색" placeholder={view === "organizations" ? "회사·기관 검색" : view === "history" ? "제출자·승인자·DB ID·사유 검색" : "회사명·성명·이메일 검색"} value={q} onChange={e => { filterChanged(); setQ(e.target.value); setPage(1); }} /></div>}
      {view === "queue" && <><select aria-label="처리 상태" className={selectClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="validating">검증 중</option><option value="pending">검수 대기</option><option value="approved">반영 완료</option><option value="rejected">반려</option><option value="unchanged">변경 없음</option></select><select aria-label="검증 분류" className={selectClass} value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="">모든 검증 결과</option>{KINDS.map(k => <option key={k}>{k}</option>)}</select><Input className="w-44" aria-label="제출부문 검색" placeholder="제출부문 검색" value={division} onChange={e => { setDivision(e.target.value); setPage(1); }} /></>}
      {(view === "master" || view === "organizations") && <select aria-label="회사 분류" className={selectClass} value={category} onChange={e => { filterChanged(); setCategory(e.target.value); setPage(1); }}><option value="">모든 회사·기관 분류</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>}
      {view === "master" && <Input className="w-48" aria-label="내부 관리부서 필터" placeholder="내부 관리부서 검색" value={department} onChange={e => { filterChanged(); setDepartment(e.target.value); setPage(1); }} />}
      {view === "history" && <Input className="w-44" aria-label="이력 제출부문" placeholder="제출부문 검색" value={division} onChange={e => { setDivision(e.target.value); setPage(1); }} />}
      {view === "master" && <label className="flex items-center gap-2 px-2 text-sm"><input type="checkbox" checked={issues} onChange={e => { filterChanged(); setIssues(e.target.checked); setPage(1); }} />정비 필요만 보기</label>}
      {view === "master" && <Button className="sm:ml-auto" variant="outline" disabled={busy || exporting || listing.total === 0} onClick={() => void downloadMaster()}><Download className="h-4 w-4" />{exporting ? "Excel 생성 중…" : "필터 결과 Excel 다운로드"}</Button>}
    </div>
    {view === "organizations" && meta?.reviewer && <div className="flex items-center gap-3"><Button onClick={() => setCreateOrganization(true)}><Plus className="h-4 w-4"/>회사·기관 등록</Button><p className="text-sm text-muted-foreground">새 회사를 먼저 등록한 뒤 Contact에서 검색·선택하세요.</p></div>}
    {view === "organizations" && conflicts.length > 0 && <details className="rounded-lg border border-amber-200 p-4"><summary className="cursor-pointer text-sm font-medium">동일 표기·상이한 분류 정비 목록 · 미확인 {conflicts.filter(c => c.unresolved).length}그룹</summary><p className="my-2 text-xs text-muted-foreground">같은 법인은 기준을 정리하고, 별도 법인은 각 회사의 확인 상태와 사유를 기록하세요. 자동 병합하지 않습니다.</p>{conflicts.map(c => <div key={c.key} className="border-t py-3 text-sm"><p>{c.key} · {c.unresolved ? "확인 필요" : "확인 완료"}</p>{c.organizations.map(o => <Button key={o.id} variant="ghost" size="sm" onClick={() => { setQ(o.name); setPage(1); }}>{o.name} · {o.category}</Button>)}</div>)}</details>}
    {view === "master" && meta?.reviewer && <div className="flex flex-wrap items-center gap-3 text-sm"><Button variant="outline" disabled={busy||!listing.total} onClick={()=>setValidationOpen(true)}>규칙 검증</Button><Button variant="outline" disabled={busy||!listing.total} onClick={()=>setEmailOpen(true)}>이메일 정합성 검사</Button><span>직접 선택 {selectedIds.length}건 · 필터 결과 전체 {listing.total.toLocaleString()}건</span>{selectedIds.length>0&&<Button variant="ghost" size="sm" onClick={()=>setSelection({key:filterKey,ids:[]})}>선택 해제</Button>}<span className="text-xs text-muted-foreground">헤더 체크박스는 현재 페이지를 선택합니다. 필터 전체는 ‘규칙 검증’에서 선택하세요.</span>{selection.key!==filterKey&&selection.ids.length>0&&<span role="status" className="text-xs text-amber-700">필터가 바뀌어 이전 행 선택을 해제했습니다.</span>}</div>}
    {view === "master" && <MasterTable contacts={listing.rows as Contact[]} onOpen={c => void openContact(c)} sort={sort} direction={direction} onSort={sortMaster} busy={busy} selectedIds={selectedIds} onSelection={meta?.reviewer ? ids=>setSelection({key:filterKey,ids}) : undefined} />}
    {busy ? <div role="status" className="rounded-xl border bg-card p-12 text-center text-muted-foreground">데이터를 불러오고 있습니다…</div> : !listing.rows.length ? <div className="rounded-xl border bg-card py-16 text-center space-y-3"><Database className="mx-auto h-9 w-9 text-muted-foreground/50" /><h2 className="font-medium">{error ? "데이터를 불러오지 못했습니다" : view === "queue" ? "표시할 제출이 없습니다" : "표시할 데이터가 없습니다"}</h2><p className="text-sm text-muted-foreground">{view === "queue" ? "Contact 등록 또는 Excel 제출로 검수 요청을 시작하세요." : "검색 조건을 확인하거나 Contact를 등록해 주세요."}</p>{meta?.admin && view === "master" && meta.total === 0 && <Button variant="outline" onClick={() => setUpload("master")}>기존 Master Excel 이관</Button>}</div> : <>
      {view === "queue" && <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,0.65fr)_minmax(0,1.35fr)]"><div className="overflow-hidden rounded-xl border bg-card"><div className="border-b px-4 py-3 text-sm font-medium">{listing.total.toLocaleString()}건 · {meta?.reviewer ? "전체 제출" : "내 제출"}</div><div className="max-h-[780px] overflow-auto">{(listing.rows as Submission[]).map(s => <button key={s.id} onClick={() => setSelected(s.id)} className={`block w-full border-b border-l-[3px] p-4 text-left last:border-b-0 ${selected === s.id ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-muted/40"}`} aria-pressed={selected === s.id}><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{s.data.name || "성명 미입력"}</span><KindBadge kind={s.validation.kind} /></div><p className="mt-2 text-sm">{s.data.company || "회사명 미입력"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{s.data.email}</p><p className="mt-3 text-xs text-muted-foreground">{s.division} · {s.submitter}</p><p className="mt-1 text-xs text-muted-foreground">{date(s.created_at)}</p></button>)}</div></div>{selectedSubmission && <ReviewPanel key={`${selectedSubmission.id}-${revision}`} submission={selectedSubmission} reviewer={!!meta?.reviewer} onSaved={() => refresh("검수 결과를 저장했습니다.")} onResubmit={() => void resubmit(selectedSubmission)} />}</div>}
      {view === "organizations" && <div className="overflow-auto rounded-xl border bg-card"><table className="w-full text-sm text-left"><thead className="bg-muted/50"><tr>{["표준 회사·기관명", "분류", "확인 상태", "승인 별칭", "Contact", ""].map((t,i) => <th key={i} className="p-4 font-medium">{t}</th>)}</tr></thead><tbody>{(listing.rows as Organization[]).map(o => <tr key={o.id} className="border-t"><td className="p-4 font-medium">{o.name}</td><td className="p-4"><KindBadge kind={o.category} /></td><td className="p-4 whitespace-nowrap">{o.review_status === "confirmed" ? "확인 완료" : "확인 필요"}</td><td className="p-4 text-muted-foreground">{o.aliases.join(", ") || "—"}</td><td className="p-4">{listing.counts?.[o.id] ?? 0}명</td><td className="p-4">{meta?.reviewer && <Button variant="outline" size="sm" onClick={() => setOrganization(o)}>기준 수정</Button>}{meta?.reviewer && <Button variant="ghost" size="sm" onClick={() => setEmailProfile(o.id)}>홈페이지·이메일</Button>}</td></tr>)}</tbody></table></div>}
      {view === "history" && <HistoryList events={listing.rows as ReviewEvent[]} />}
    </>}
    <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{listing.total.toLocaleString()}건 · 페이지당 25건</span><div className="flex items-center gap-3"><Button aria-label="이전 페이지" variant="outline" size="icon" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button><span>{page} / {pages}</span><Button aria-label="다음 페이지" variant="outline" size="icon" disabled={busy || page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
    {form && <ContactForm {...form} onClose={() => setForm(null)} onSaved={() => { setForm(null); navigate("queue"); setStatus("pending"); refresh("Contact를 제출했습니다. 담당자 승인 후 Master에 반영됩니다."); }} />}
    {upload && <ExcelUpload master={upload === "master"} onClose={() => setUpload(null)} onSaved={() => { const master = upload === "master"; setUpload(null); navigate(master ? "master" : "queue"); refresh(master ? "원본 Master DB 이관을 완료했습니다." : "Excel Contact를 제출했습니다."); }} />}
    {contact && <Dialog open onOpenChange={() => setContact(null)}><DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{contact.contact.db_id} · {contact.contact.data.name || "성명 미입력"}</DialogTitle><DialogDescription>Master 상세 정보·이메일 검증 이력·원본 출처</DialogDescription></DialogHeader><ContactEmailHistory key={contact.contact.id} contactId={contact.contact.id}/><dl className="grid grid-cols-[120px_1fr] gap-3 text-sm">{Object.entries(FIELDS).map(([k,t]) => <div key={k} className="contents"><dt className="text-muted-foreground">{t}</dt><dd className="break-all">{visibleData(contact.contact)[k as keyof ContactData] || "—"}</dd></div>)}</dl><details><summary className="text-sm cursor-pointer">최초 이관 원본</summary><pre className="text-xs max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(contact.sources, null, 2)}</pre></details><h3 className="text-sm font-semibold">Contact 및 소속 회사 변경 이력</h3><HistoryList events={contact.events ?? []} /><Button onClick={() => { setForm({ initial: visibleData(contact.contact), initialOrganizationId: contact.contact.organization_id, dbId: contact.contact.db_id }); setContact(null); }}>변경 정보 제출</Button></DialogContent></Dialog>}
    {organization && <OrganizationEditor org={organization} count={listing.counts?.[organization.id] ?? 0} onClose={() => setOrganization(null)} onSaved={() => { setOrganization(null); refresh("회사·기관 기준을 변경했습니다. 소속 Contact에 동일 기준이 적용됩니다."); }} />}
    {createOrganization && <OrganizationEditor onClose={() => setCreateOrganization(false)} onSaved={() => { setCreateOrganization(false); refresh("회사·기관을 등록했습니다. Contact 입력 창에서 회사명을 다시 검색해 선택하세요."); }}/>}
    {adminOpen && <ReviewerManagement onChanged={() => refresh()} onClose={() => setAdminOpen(false)} onImport={() => { setAdminOpen(false); setUpload("master"); }} empty={meta?.total === 0} />}
    {emailOpen && <EmailCheckDialog filters={{q,category,department,issues}} filteredCount={listing.total} ids={selectedIds} onClose={()=>setEmailOpen(false)}/>}
    {emailProfile && <EmailProfileEditor organizationId={emailProfile} onClose={()=>setEmailProfile(undefined)} onSaved={()=>{setEmailProfile(undefined);refresh("회사 홈페이지·이메일 기준을 저장했습니다.");}}/>}
    {validationOpen && <ValidationRunDialog filters={{q,category,department,issues,sort,direction}} filteredCount={listing.total} ids={selectedIds} onClose={()=>setValidationOpen(false)}/>}
  </div>;
}
function Stat({ label, value }: { label: string; value?: number }) { return <span className="text-muted-foreground">{label} <strong className="ml-1 text-foreground font-semibold">{value === undefined ? "—" : value.toLocaleString()}</strong></span>; }
