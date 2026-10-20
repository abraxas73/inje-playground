"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, FileStack, Link2, Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson, readError } from "@/lib/ppt/client";
import { latestProfile, MODE_LABEL, type JobRow, type ProfileRow, type ProposalMode } from "@/lib/proposal/core";
import { fmt, JobStatus, ModePicker, profileLabel, ProfileSelect, uploadProposalFile } from "@/components/proposal/shared";

export default function ProposalGeneralPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [scope, setScope] = useState<"mine" | "shared">("mine");
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    const r = await fetch("/api/proposal/profiles");
    if (!r.ok) return setError(await readError(r, "일반현황 목록을 불러오지 못했습니다."));
    setProfiles(((await r.json()) as { items: ProfileRow[] }).items);
  }, []);
  const loadJobs = useCallback(async () => {
    const r = await fetch(`/api/proposal/jobs?scope=${scope}`);
    if (!r.ok) return setError(await readError(r, "결과 목록을 불러오지 못했습니다."));
    setJobs(((await r.json()) as { items: JobRow[] }).items);
  }, [scope]);
  useEffect(() => { const t = setTimeout(() => { void loadProfiles(); }, 0); return () => clearTimeout(t); }, [loadProfiles]);
  useEffect(() => { const t = setTimeout(() => { void loadJobs(); }, 0); return () => clearTimeout(t); }, [loadJobs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2"><FileStack className="h-6 w-6 text-sky-600" /><h1 className="text-xl font-semibold">제안도우미-일반현황</h1></div>
      <p className="text-sm text-muted-foreground">고객사 PowerPoint 템플릿을 올리면, 미리 등록한 회사 일반현황 PPT를 그 양식에 맞춘 장표로 만들어 줍니다. 결과는 내 목록에 남고, 공유하면 다른 구성원도 볼 수 있습니다.</p>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {profiles && <NewJob profiles={profiles} onCreated={(id) => router.push(`/proposal/general/${id}`)} onError={setError} />}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">{scope === "mine" ? "내 결과" : "공유된 결과"}</h2>
          <Button variant="ghost" size="sm" onClick={() => setScope((s) => (s === "mine" ? "shared" : "mine"))}>{scope === "mine" ? "공유된 결과 보기" : "내 결과만"}</Button>
        </div>
        {jobs && <JobList jobs={jobs} profiles={profiles ?? []} shared={scope === "shared"} />}
      </section>
      {profiles && <Profiles profiles={profiles} onChanged={loadProfiles} onError={setError} />}
    </div>
  );
}

function NewJob({ profiles, onCreated, onError }: { profiles: ProfileRow[]; onCreated: (id: string) => void; onError: (m: string | null) => void }) {
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [profileId, setProfileId] = useState("");
  const [mode, setMode] = useState<ProposalMode>("restyle");
  const [busy, setBusy] = useState(false);
  const latest = latestProfile(profiles);
  const chosen = profileId || latest?.id || "";
  if (!latest) return <Alert><AlertDescription>등록된 일반현황 PPT가 없습니다. 아래 &lsquo;일반현황 버전&rsquo;에서 먼저 올려 주세요.</AlertDescription></Alert>;
  const submit = async () => {
    if (!projectName.trim() || !file) return;
    setBusy(true); onError(null);
    try {
      const templatePath = await uploadProposalFile(file, "template");
      const { id } = await postJson<{ id: string }>("/api/proposal/jobs", { projectName: projectName.trim(), templatePath, templateName: file.name, profileId: chosen, mode });
      onCreated(id);
    } catch (e) { onError(e instanceof Error ? e.message : "요청에 실패했습니다."); setBusy(false); }
  };
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5">
      <h2 className="text-base font-medium">새로 만들기</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">프로젝트명 <span className="text-destructive">*</span></span>
          <Input value={projectName} maxLength={100} placeholder="예: ○○공사 차세대 클라우드 구축" disabled={busy} onChange={(e) => setProjectName(e.target.value)} />
          <span className="block text-xs text-muted-foreground">결과와 공유 목록의 제목이 됩니다.</span>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">고객사 템플릿 <span className="text-destructive">*</span></span>
          <Input type="file" accept=".pptx,.potx" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="block text-xs text-muted-foreground">.pptx·.potx, 20MB 이하. 템플릿에 들어 있던 예시 장표는 빠집니다.</span>
        </label>
        <ProfileSelect profiles={profiles} value={chosen} onChange={setProfileId} disabled={busy} />
      </div>
      <ModePicker value={mode} onChange={setMode} disabled={busy} />
      <Button disabled={busy || !projectName.trim() || !file} onClick={() => void submit()}>{busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />요청 중…</> : "만들기"}</Button>
    </section>
  );
}

function JobList({ jobs, profiles, shared }: { jobs: JobRow[]; profiles: ProfileRow[]; shared: boolean }) {
  if (!jobs.length) return <p className="py-8 text-center text-sm text-muted-foreground">{shared ? "공유된 결과가 아직 없습니다." : "아직 만든 결과가 없습니다."}</p>;
  const title = (id: string) => profiles.find((p) => p.id === id);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left text-xs whitespace-nowrap text-muted-foreground">
          <tr><th className="px-3 py-2">프로젝트명</th>{shared && <th className="px-3 py-2">만든 사람</th>}<th className="px-3 py-2">일반현황 버전</th><th className="px-3 py-2">방식</th><th className="px-3 py-2">장 수</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">만든 날</th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const p = title(j.profile_id);
            return (
              <tr key={j.id} className="border-t hover:bg-muted/30">
                <td className="max-w-[300px] px-3 py-2"><span className="flex items-center gap-1"><Link href={`/proposal/general/${j.id}`} className="truncate font-medium hover:underline" title={j.project_name}>{j.project_name}</Link>{j.share_enabled && <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="공유 중" />}</span></td>
                {shared && <td className="px-3 py-2 text-muted-foreground">{j.owner_name ?? "-"}</td>}
                <td className="px-3 py-2 text-muted-foreground">{p ? profileLabel(p) : "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{MODE_LABEL[j.mode]}</td>
                <td className="px-3 py-2">{j.slide_count ?? "-"}</td>
                <td className="px-3 py-2"><JobStatus status={j.status} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmt(j.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Profiles({ profiles, onChanged, onError }: { profiles: ProfileRow[]; onChanged: () => void; onError: (m: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [asOf, setAsOf] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const latest = latestProfile(profiles);
  const upload = async () => {
    if (!title.trim() || !file) return;
    setBusy(true); onError(null);
    try {
      const storagePath = await uploadProposalFile(file, "profile");
      await postJson("/api/proposal/profiles", { storagePath, fileName: file.name, title: title.trim(), asOf: asOf || undefined });
      setTitle(""); setAsOf(""); setFile(null);
      onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "등록에 실패했습니다."); }
    finally { setBusy(false); }
  };
  const toggle = async (p: ProfileRow) => {
    try { await postJson(`/api/proposal/profiles/${p.id}`, { hidden: !p.hidden }, "PATCH"); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : "저장하지 못했습니다."); }
  };
  const rows = profiles.filter((p) => showHidden || !p.hidden);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">일반현황 버전</h2>
        {profiles.some((p) => p.hidden) && <Button variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)}>{showHidden ? "숨긴 버전 감추기" : "숨긴 버전도 보기"}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">가장 나중에 올린 버전이 기본으로 쓰입니다. 옛 버전도 만들기에서 고를 수 있고, 지우는 대신 숨깁니다(예전 결과가 참조).</p>
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="font-medium">{profileLabel(p)}</span>
              {latest?.id === p.id && <Badge>최신</Badge>}
              {p.hidden && <Badge variant="secondary">숨김</Badge>}
              <span className="text-xs text-muted-foreground">{p.slide_count}장 · {p.uploader_name ?? "-"} · {fmt(p.created_at)}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void toggle(p)}><EyeOff className="mr-1 h-3.5 w-3.5" />{p.hidden ? "다시 보이기" : "숨기기"}</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 md:grid-cols-[1fr_160px_1fr_auto] md:items-end">
        <label className="block space-y-1 text-sm"><span>제목</span><Input value={title} maxLength={100} placeholder="예: 2026년 4분기 일반현황" disabled={busy} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>기준일</span><Input type="date" value={asOf} disabled={busy} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>일반현황 PPT(.pptx)</span><Input type="file" accept=".pptx" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <Button variant="outline" disabled={busy || !title.trim() || !file} onClick={() => void upload()}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}새 버전 올리기</Button>
      </div>
    </section>
  );
}
