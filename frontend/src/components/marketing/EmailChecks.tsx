"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHECK_LABELS, type CheckState, type EmailReport, type EmailRow, type EmailRun } from "@/lib/marketing/email/types";
import { visibleData, type Contact } from "@/lib/marketing/types";
import { api, date, errorMessage, selectClass } from "./shared";
import ContactForm from "./ContactForm";
import EmailCheckDialog from "./EmailCheckDialog";
import EmailProfileEditor from "./EmailProfileEditor";
const statuses = { queued: "대기", running: "검사 중", completed: "완료", cancelled: "취소" };
import EmailEvidence, { EmailBadge as Badge } from "./EmailEvidence";
export default function EmailChecks({ runId }: { runId?: string }) {
  const router = useRouter(); const [report, setReport] = useState<EmailReport>(); const [runs, setRuns] = useState<EmailRun[]>([]); const [total, setTotal] = useState(0); const [editable, setEditable] = useState(false);
  const [page, setPage] = useState(1); const [state, setState] = useState(""); const [q, setQ] = useState(""); const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [start, setStart] = useState(false); const [detail, setDetail] = useState<EmailRow>(); const [profileId, setProfileId] = useState<string>(); const [form, setForm] = useState<Contact>();
  const query = new URLSearchParams({ page: String(page), state, q }).toString();
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        if (runId) {
          const r = await api<EmailReport & { editable: boolean }>(`/api/marketing/email-checks/${runId}?${query}`, undefined, abort.signal); if (abort.signal.aborted) return;
          setReport(r); setTotal(r.total); setEditable(r.editable); setDetail(old => old ? r.rows.find(t => t.contact_id === old.contact_id) ?? old : undefined);
          if (["queued", "running"].includes(r.run.status)) timer = setTimeout(load, 5000);
        } else {
          const r = await api<{ rows: EmailRun[]; total: number; editable: boolean }>(`/api/marketing/email-checks?page=${page}`, undefined, abort.signal); if (abort.signal.aborted) return;
          setRuns(r.rows); setTotal(r.total); setEditable(r.editable); if (r.rows.some(x => ["queued", "running"].includes(x.status))) timer = setTimeout(load, 5000);
        }
        setError("");
      } catch (e) { if (!abort.signal.aborted) setError(errorMessage(e)); } finally { if (!abort.signal.aborted) setLoading(false); }
    }
    setLoading(true); void load(); return () => { abort.abort(); clearTimeout(timer); };
  }, [runId, query, page, revision]);
  async function action(action: string) {
    setBusy(true); setError("");
    try { const r = await api<{ id?: string }>(`/api/marketing/email-checks/${runId}`, { action, requestKey: crypto.randomUUID() }); if (r.id) router.push(`/marketing/email-checks/${r.id}`); else { setRevision(x => x + 1); setNotice(action === "cancel" ? "검사를 취소했습니다. 완료된 결과는 보존됩니다." : "미처리·실행 오류 검사를 이어서 처리합니다."); } }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setError("");
    try { const r = await fetch(`/api/marketing/email-checks/${runId}/export?${new URLSearchParams({ state, q })}`); if (!r.ok) throw new Error((await r.json()).error); const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = "Master-DB-email-check.xlsx"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("현재 결과 필터 전체의 Excel을 다운로드했습니다."); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function change(row: EmailRow) {
    setBusy(true); setError(""); try { const r = await api<{ contact: Contact }>(`/api/marketing?view=contact&id=${row.contact_id}`); setDetail(undefined); setForm(r.contact); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const run = report?.run; const running = run && ["queued", "running"].includes(run.status);
  return <main className="mx-auto max-w-[1440px] space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">이메일 정합성 {runId ? "검사 결과" : "관리"}</h1><p className="mt-1 text-sm text-muted-foreground">회사 연관성·홈페이지·메일 수신 설정을 근거와 함께 관리합니다.</p></div><div className="flex gap-2">{runId && <Button asChild variant="outline"><Link href="/marketing/email-checks">검사 이력</Link></Button>}<Button asChild variant="outline"><Link href="/marketing">Master DB로</Link></Button>{!runId && editable && <Button onClick={() => setStart(true)}>새 이메일 검사</Button>}</div></div>
    <p className="rounded-lg border bg-muted/30 p-4 text-sm">‘근거 확인’은 회사 기준과 기술 설정이 확인됐다는 뜻입니다. <strong>개별 메일함의 실제 존재·수신 성공은 미확인</strong>이며 검사 메일은 발송하지 않습니다. Master 변경은 기존 검수·승인을 거칩니다.</p>
    {error && <p role="alert" className="rounded border border-destructive/30 p-3 text-sm text-destructive">{error}<Button size="sm" variant="ghost" onClick={() => setRevision(x => x + 1)}>새로고침</Button></p>}{notice && <p role="status" className="rounded border bg-primary/5 p-3 text-sm">{notice}</p>}
    {!runId && <div className="overflow-auto rounded-xl border"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-muted"><tr>{["실행 시각 / 담당자", "범위", "진행", "상태", ""].map((t, i) => <th key={i} className="p-3">{t}</th>)}</tr></thead><tbody>{runs.map(r => <tr key={r.id} className="border-t"><td className="p-3">{date(r.created_at)}<p className="text-xs text-muted-foreground">{r.actor_name}</p></td><td className="p-3">{r.scope === "all" ? "전체 Master" : r.scope === "filtered" ? "필터 결과 전체" : "직접 선택"}</td><td className="p-3">{r.processed.toLocaleString()} / {r.total.toLocaleString()}</td><td className="p-3">{statuses[r.status]}</td><td className="p-3"><Button variant="outline" size="sm" asChild><Link href={`/marketing/email-checks/${r.id}`}>결과 보기</Link></Button></td></tr>)}</tbody></table>{!runs.length && !loading && <p className="p-12 text-center text-sm text-muted-foreground">아직 실행한 이메일 검사가 없습니다. Master에서 필터·행을 선택해 검사할 수도 있습니다.</p>}</div>}
    {run && report && <>
      <section className="rounded-xl border p-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{statuses[run.status]} · {run.processed.toLocaleString()} / {run.total.toLocaleString()}건</h2><p className="mt-1 text-xs text-muted-foreground">{date(run.created_at)} · {run.actor_name} · 당시 Contact·회사 기준을 보존합니다.</p></div><div className="flex flex-wrap gap-2">{editable && <>{running ? <><Button variant="outline" disabled={busy} onClick={() => void action("resume")}>검사 이어가기</Button><Button variant="outline" disabled={busy} onClick={() => void action("cancel")}>취소</Button></> : <><Button variant="outline" disabled={busy} onClick={() => void action("recheck")}>최신 기준으로 다시 검사</Button>{(run.status === "cancelled" || !!report.counts.error) && <Button variant="outline" disabled={busy} onClick={() => void action("retry")}>미처리·실행 오류 재시도</Button>}</>}</>}<Button variant="outline" disabled={busy || !total} onClick={() => void download()}>결과 Excel 다운로드</Button></div></div><div role="progressbar" aria-label="이메일 검사 진행률" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.processed} className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${run.total ? run.processed / run.total * 100 : 0}%` }}/></div>{running && <p className="text-xs text-muted-foreground">화면을 닫아도 검사가 이어집니다. 대기 작업은 최대 5분 간격으로 이어서 처리합니다.</p>}</section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{["pass", "review", "fail", "error", "pending"].map(s => <button key={s} className={`rounded-xl border p-4 text-left ${state === s ? "border-primary bg-primary/5" : "bg-card"}`} onClick={() => { setState(state === s ? "" : s); setPage(1); setDetail(undefined); }}><span className="text-xs text-muted-foreground">{s === "pending" ? "미처리" : CHECK_LABELS[s as CheckState]}</span><strong className="block mt-1 text-xl">{(report.counts[s] ?? 0).toLocaleString()}</strong></button>)}</div>
      <div className="flex flex-wrap gap-2"><Input aria-label="이메일 검사 결과 검색" className="sm:w-80" placeholder="회사명·성명·이메일·DB ID" value={q} onChange={e => { setQ(e.target.value); setPage(1); setDetail(undefined); }}/><select aria-label="이메일 검사 판정" className={selectClass} value={state} onChange={e => { setState(e.target.value); setPage(1); setDetail(undefined); }}><option value="">모든 판정</option>{["pass", "review", "fail", "error", "pending"].map(s => <option key={s} value={s}>{s === "pending" ? "미처리" : CHECK_LABELS[s as CheckState]}</option>)}</select></div>
      <div className="overflow-auto rounded-xl border"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-muted"><tr>{["Contact / 이메일", "종합", "회사 연관성", "메일 수신 도메인", "홈페이지", "확인 시각 / 기준", ""].map((t, i) => <th key={i} className="p-3">{t}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.contact_id} className="border-t"><td className="p-3 max-w-xs"><button className="text-primary hover:underline" onClick={() => setDetail(row)}>{row.snapshot.db_id}</button><p>{row.snapshot.company || "회사 미등록"} · {row.snapshot.name}</p><p className="text-xs text-muted-foreground break-all">{row.snapshot.email || "이메일 없음"}</p></td><td className="p-3"><Badge value={row.result?.state}/></td><td className="p-3"><Badge value={row.result?.relationship?.state}/>{row.result?.relationship?.code === "public_mail" && <p className="mt-1 text-xs">공용 메일</p>}</td><td className="p-3"><Badge value={row.result?.mail?.state}/><p className="mt-1 text-xs text-muted-foreground">{row.result?.mail?.mx?.map(m => m.exchange || ".").join(", ").slice(0, 65)}</p></td><td className="p-3"><Badge value={row.result?.website?.state}/><p className="mt-1 text-xs">{row.result?.websiteSource === "candidate" ? "후보 홈페이지" : row.result?.websiteSource === "approved" ? "등록 홈페이지" : "기준 없음"}</p></td><td className="p-3 text-xs">{row.result ? date(row.result.checkedAt) : "—"}{row.stale && <p className="mt-1 text-amber-700">기준 변경·30일 경과 → 재검사</p>}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => setDetail(row)}>근거 보기</Button></td></tr>)}</tbody></table>{!report.rows.length && !loading && <p className="p-12 text-center text-muted-foreground">조건에 맞는 결과가 없습니다.</p>}</div>
    </>}
    {loading && <p role="status" className="text-sm text-muted-foreground">불러오는 중…</p>}<div className="flex items-center justify-between text-sm text-muted-foreground"><span>{total.toLocaleString()}건 · 페이지당 25건</span><div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page === 1 || loading} onClick={() => setPage(x => x - 1)}>이전</Button>{page} / {Math.max(1, Math.ceil(total / 25))}<Button variant="outline" size="sm" disabled={page * 25 >= total || loading} onClick={() => setPage(x => x + 1)}>다음</Button></div></div>
    {detail && <Dialog open onOpenChange={v => { if (!v && !busy) setDetail(undefined); }}><DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{detail.snapshot.db_id} · 이메일 검사 근거</DialogTitle><DialogDescription>{detail.snapshot.company || "회사 미등록"} · {detail.snapshot.email || "이메일 없음"}</DialogDescription></DialogHeader>{detail.stale && <p className="text-sm text-amber-700">현재 기준이 바뀌었거나 검사 후 30일이 지났습니다. 다시 검사하세요.</p>}<EmailEvidence result={detail.result}/><p className="text-xs text-muted-foreground">검사 기준: {detail.snapshot.profile ? `회사 이메일 기준 v${detail.snapshot.profile.version} · ${detail.snapshot.profile.actor_name} · ${detail.snapshot.profile.reason}` : "회사 이메일 기준 미등록"}</p><div className="flex flex-wrap gap-2">{editable && <><Button variant="outline" disabled={!detail.snapshot.organization_id || busy} onClick={() => setProfileId(detail.snapshot.organization_id!)}>회사 홈페이지·도메인 기준</Button><Button disabled={busy} onClick={() => void change(detail)}>변경 정보 제출</Button></>}{!detail.snapshot.organization_id && <p className="text-xs text-amber-700">회사 연결을 먼저 검수한 뒤 홈페이지·도메인 기준을 등록하세요.</p>}</div></DialogContent></Dialog>}
    {profileId && <EmailProfileEditor organizationId={profileId} onClose={() => setProfileId(undefined)} onSaved={() => { setProfileId(undefined); setDetail(undefined); setRevision(x => x + 1); setNotice("회사 기준을 저장했습니다. 최신 기준으로 다시 검사해 주세요."); }}/>}
    {form && <ContactForm initial={visibleData(form)} dbId={form.db_id} initialOrganizationId={form.organization_id} source={{ emailCheckRun: runId, type: "email-integrity" }} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); setNotice("변경 정보를 제출했습니다. 담당자 승인 후 Master에 반영됩니다."); }}/>}
    {start && <EmailCheckDialog onClose={() => setStart(false)}/>}
  </main>;
}
