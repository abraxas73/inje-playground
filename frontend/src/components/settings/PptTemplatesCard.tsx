"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase";
import { postJson, readError } from "@/lib/ppt/client";
import type { PptTemplate, PptTemplatesResponse, PptUploadTicket } from "@/types/ppt";

const fmtBytes = (b: number) => `${(b / 1024 / 1024).toFixed(1)}MB`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

/** 디자인센터 템플릿(pptx) 업로드·검증·기본 지정·비활성화. 내장 템플릿과 같은 106장 구성만 통과한다. */
export default function PptTemplatesCard() {
  const [data, setData] = useState<PptTemplatesResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ppt/templates");
    if (!res.ok) { setMsg({ kind: "error", text: await readError(res, "템플릿 목록을 불러오지 못했습니다.") }); return; }
    setData((await res.json()) as PptTemplatesResponse);
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const upload = async (file: File) => {
    setMsg(null);
    try {
      setBusy("upload");
      const tr = await fetch("/api/ppt/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, size: file.size, kind: "template" }) });
      if (!tr.ok) throw new Error(await readError(tr, "업로드 URL을 받지 못했습니다."));
      const ticket = (await tr.json()) as PptUploadTicket;
      const { error } = await createClient().storage.from("ppt").uploadToSignedUrl(ticket.storagePath, ticket.token, file, { contentType: "application/octet-stream" });
      if (error) throw new Error(`파일 업로드에 실패했습니다: ${error.message}`);
      setBusy("validate");
      const r = await postJson<{ template: PptTemplate }>("/api/admin/ppt/templates", { storagePath: ticket.storagePath, fileName: file.name });
      setMsg({ kind: "ok", text: `등록했습니다: ${r.template.name} (샘플 덱 ${r.template.slides}장 빌드, 브랜드 검사 ${r.template.issueCount === 0 ? "통과" : `${r.template.issueCount}건`})` });
      await load();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "템플릿 등록에 실패했습니다." });
    } finally { setBusy(null); }
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    setMsg(null); setBusy(id);
    try {
      const res = await fetch(`/api/admin/ppt/templates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res, "변경에 실패했습니다."));
      await load();
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "변경에 실패했습니다." }); }
    finally { setBusy(null); }
  };

  if (!data) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중…</div>;
  const hasDefault = data.templates.some((t) => t.status === "active" && t.isDefault);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        디자인센터가 배포한 표준 템플릿 pptx를 올리면 ppt-service가 장 수(106장)를 확인하고 샘플 덱 전체를 실제로 빌드해 검증한 뒤 등록합니다. 장표 번호·좌표가 내장본과 같은 구성이어야 하며, 다른 구성은 검증에서 거절됩니다.
        사용자는 PPT를 만들 때 템플릿을 고르고, 재생성·재시도는 그 버전의 템플릿을 그대로 씁니다. 템플릿은 삭제하지 않고 비활성화합니다(기존 버전이 참조).
      </p>
      <div className="rounded border px-3 py-2">
        <div className="flex items-center gap-2"><span className="font-medium">내장 템플릿</span>{!hasDefault && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">기본</span>}</div>
        <div className="text-xs text-muted-foreground">{data.builtin.file ?? "ppt-service 응답 없음"}{data.builtin.slides ? ` · ${data.builtin.slides}장` : ""} · 서비스에 포함된 파일(배포로만 바뀜)</div>
      </div>
      {data.templates.map((t) => (
        <div key={t.id} className={`rounded border px-3 py-2 ${t.status === "disabled" ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t.name}</span>
            {t.isDefault && t.status === "active" && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">기본</span>}
            {t.status === "disabled" && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">비활성</span>}
            <span className="ml-auto flex items-center gap-3 text-xs">
              {t.status === "active" && !t.isDefault && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => patch(t.id, { isDefault: true })}>기본으로</Button>}
              <label className="flex items-center gap-1.5"><Switch checked={t.status === "active"} disabled={busy !== null} onCheckedChange={(on) => patch(t.id, { status: on ? "active" : "disabled" })} />사용</label>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="break-all">{t.fileName}</span><span>{fmtBytes(t.bytes)}</span>
            <span>샘플 빌드 {t.slides ?? "-"}장</span>
            <span className="flex items-center gap-1">{t.issueCount === 0 ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}브랜드 검사 {t.issueCount === 0 ? "통과" : `${t.issueCount}건`}</span>
            <span>{t.uploadedByEmail} · {fmtDate(t.createdAt)}</span>
          </div>
        </div>
      ))}
      <input ref={inputRef} type="file" accept=".pptx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
          {busy === "upload" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : busy === "validate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {busy === "upload" ? "올리는 중…" : busy === "validate" ? "검증 중(샘플 덱 빌드)…" : "템플릿 pptx 올리기"}
        </Button>
        <span className="text-xs text-muted-foreground">50MB 이하 · 등록까지 보통 10~30초</span>
      </div>
      {msg && <Alert variant={msg.kind === "error" ? "destructive" : "default"}><AlertDescription className="whitespace-pre-wrap">{msg.text}</AlertDescription></Alert>}
    </div>
  );
}
