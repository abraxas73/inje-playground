"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Copy, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { postJson, readError } from "@/lib/ppt/client";
import { MODE_LABEL, type JobRow, type ProfileRow, type ProposalMode } from "@/lib/proposal/core";
import { fmt, JobStatus, ModePicker, profileLabel, ProfileSelect } from "@/components/proposal/shared";

type Detail = Omit<JobRow, never> & { hasFile: boolean; mine: boolean; profile: Pick<ProfileRow, "id" | "title" | "as_of"> | null };

export default function ProposalJobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Detail | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mode, setMode] = useState<ProposalMode | null>(null);
  const [profileId, setProfileId] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/proposal/jobs/${id}`);
    if (!r.ok) return setError(await readError(r, "결과를 불러오지 못했습니다."));
    setJob(((await r.json()) as { item: Detail }).item);
  }, [id]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    void fetch("/api/proposal/profiles").then(async (r) => { if (r.ok) setProfiles(((await r.json()) as { items: ProfileRow[] }).items); });
  }, []);
  // 만드는 동안 3초마다 상태를 다시 읽는다
  const active = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
  }, [active, load]);

  if (error && !job) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!job) return <p className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />불러오는 중…</p>;

  const share = async (on: boolean) => {
    setBusy(true); setError(null);
    try { await postJson(`/api/proposal/jobs/${id}`, { shareEnabled: on }, "PATCH"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try { await postJson(`/api/proposal/jobs/${id}`, undefined, "DELETE"); router.push("/proposal/general"); }
    catch (e) { setError(e instanceof Error ? e.message : "지우지 못했습니다."); setBusy(false); }
  };
  const rerun = async () => {
    setBusy(true); setError(null);
    try {
      const { id: next } = await postJson<{ id: string }>("/api/proposal/jobs", { projectName: job.project_name, fromJobId: id, mode: mode ?? job.mode, profileId: profileId || job.profile_id });
      router.push(`/proposal/general/${next}`);
    } catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); setBusy(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/proposal/general/${id}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* 복사 거부 — 주소창을 쓰면 된다 */ }
  };

  return (
    <div className="space-y-6">
      <Link href="/proposal/general" className="inline-flex items-center text-sm text-muted-foreground hover:underline"><ArrowLeft className="mr-1 h-4 w-4" />제안도우미-일반현황</Link>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{job.project_name}</h1><JobStatus status={job.status} /></div>
        <p className="text-sm text-muted-foreground">
          {job.profile ? profileLabel(job.profile) : "일반현황"} · {MODE_LABEL[job.mode]} · 고객사 템플릿 {job.template_name}{job.slide_count ? ` · ${job.slide_count}장` : ""} · {job.owner_name ?? ""} · {fmt(job.created_at)}
        </p>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {active && <Alert><AlertDescription><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />만드는 중입니다. {job.mode === "reflow" ? "AI 배치까지 1~3분" : "보통 1분 안팎"} 걸립니다. 이 화면을 닫아도 계속 만듭니다.</AlertDescription></Alert>}
      {job.status === "failed" && <Alert variant="destructive"><AlertDescription>만들지 못했습니다: {job.error ?? "알 수 없는 오류"}</AlertDescription></Alert>}
      {job.status === "done" && job.hasFile && (
        <div className="flex flex-wrap gap-2">
          <Button asChild><a href={`/api/proposal/jobs/${id}/file`}><Download className="mr-1 h-4 w-4" />PPT 내려받기</a></Button>
          {job.mode === "reflow" && <p className="self-center text-xs text-muted-foreground">AI가 다시 배치한 결과입니다. 숫자·표를 원본과 한 번 대조해 주세요.</p>}
        </div>
      )}
      {job.mine && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-base font-medium">공유</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={job.share_enabled} disabled={busy} onCheckedChange={(v) => void share(v)} />공유하면 이 메뉴를 쓰는 구성원의 &lsquo;공유된 결과&rsquo;에 보이고, 링크로 열 수 있습니다.</label>
          {job.share_enabled && <Button variant="outline" size="sm" onClick={() => void copyLink()}><Copy className="mr-1 h-4 w-4" />{copied ? "복사했습니다" : "링크 복사"}</Button>}
        </section>
      )}
      {!active && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-base font-medium">다시 만들기</h2>
          <p className="text-xs text-muted-foreground">같은 고객사 템플릿으로 방식이나 일반현황 버전을 바꿔 새 결과를 만듭니다(이 결과는 그대로 남습니다).</p>
          {profiles.length > 0 && <ProfileSelect profiles={profiles} value={profileId || job.profile_id} onChange={setProfileId} disabled={busy} />}
          <ModePicker value={mode ?? job.mode} onChange={setMode} disabled={busy} />
          <Button variant="outline" disabled={busy} onClick={() => void rerun()}><RefreshCw className="mr-1 h-4 w-4" />다시 만들기</Button>
        </section>
      )}
      {job.mine && !active && (confirmDelete
        ? <div className="flex items-center gap-2 text-sm"><span>이 결과를 지울까요? 되돌릴 수 없습니다.</span><Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>지우기</Button><Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>취소</Button></div>
        : <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 className="mr-1 h-4 w-4" />이 결과 지우기</Button>)}
    </div>
  );
}
