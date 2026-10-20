"use client";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase";
import { readError } from "@/lib/ppt/client";
import { MODE_LABEL, PROPOSAL_BUCKET, type JobRow, type ProfileRow, type ProposalMode } from "@/lib/proposal/core";

export const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

/** 서명 URL로 Storage에 바로 올린다(파일은 서버를 거치지 않음) → storagePath */
export async function uploadProposalFile(file: File, kind: "profile" | "template"): Promise<string> {
  const tr = await fetch("/api/proposal/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, size: file.size, kind }) });
  if (!tr.ok) throw new Error(await readError(tr, "업로드 주소를 받지 못했습니다."));
  const t = (await tr.json()) as { storagePath: string; token: string };
  const { error } = await createClient().storage.from(PROPOSAL_BUCKET).uploadToSignedUrl(t.storagePath, t.token, file, { contentType: "application/octet-stream" });
  if (error) throw new Error(`파일 업로드에 실패했습니다: ${error.message}`);
  return t.storagePath;
}

export function profileLabel(p: Pick<ProfileRow, "title" | "as_of">) {
  return p.as_of ? `${p.title} (${p.as_of} 기준)` : p.title;
}

export function JobStatus({ status }: { status: JobRow["status"] }) {
  const map = { queued: ["대기", "secondary"], running: ["만드는 중", "secondary"], done: ["완료", "default"], failed: ["실패", "destructive"] } as const;
  const [label, variant] = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export const MODE_HELP: Record<ProposalMode, string> = {
  restyle: "일반현황 장표의 표·도표·그림은 그대로 두고 고객사 배경·로고·글꼴·색·크기만 입힙니다. 숫자가 원본 그대로라 가장 정확합니다.",
  reflow: "AI가 일반현황 내용을 고객사 템플릿의 레이아웃 칸에 다시 배치합니다. 양식에 더 잘 맞지만 도표 모양이 바뀌므로 꼭 검수하세요(원문에 없는 숫자가 나오면 생성을 멈춥니다).",
};

export function ModePicker({ value, onChange, disabled }: { value: ProposalMode; onChange: (m: ProposalMode) => void; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">적용 방식</legend>
      {(Object.keys(MODE_LABEL) as ProposalMode[]).map((m) => (
        <label key={m} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${value === m ? "border-primary bg-primary/5" : ""}`}>
          <input type="radio" name="mode" className="mt-1" checked={value === m} onChange={() => onChange(m)} />
          <span><span className="font-medium">{MODE_LABEL[m]}</span><span className="mt-0.5 block text-xs text-muted-foreground">{MODE_HELP[m]}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

export function ProfileSelect({ profiles, value, onChange, disabled }: { profiles: ProfileRow[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const visible = profiles.filter((p) => !p.hidden);
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">일반현황 버전</span>
      <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {visible.map((p, i) => <option key={p.id} value={p.id}>{profileLabel(p)}{i === 0 ? " — 최신" : ""} · {p.slide_count}장</option>)}
      </select>
    </label>
  );
}
