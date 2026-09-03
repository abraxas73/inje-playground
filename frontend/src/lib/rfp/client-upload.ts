import { createClient } from "@/lib/supabase";
import type { RegisterResponse, UploadTicket } from "@/types/rfp";

export type UploadPhase = "uploading" | "registering";
export const PHASE_LABEL: Record<UploadPhase, string> = { uploading: "업로드 중…", registering: "분석 중…" };

export interface RegisterOptions {
  force?: boolean;
  onPhase?: (phase: UploadPhase) => void;
  /** needsConfirm 뒤 "새로 등록"일 때: 이미 올린 파일을 다시 쓰기 위해 넘긴다 */
  ticket?: UploadTicket;
}

export interface RegisterOutcome {
  response: RegisterResponse;
  ticket: UploadTicket;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? fallback;
}

/** 서명 URL → Storage 직접 업로드 → 등록 요청. 스펙 §3 1~3단계(sha256은 서버가 계산). */
export async function uploadAndRegister(file: File, opts: RegisterOptions = {}): Promise<RegisterOutcome> {
  let ticket = opts.ticket;
  if (!ticket) {
    opts.onPhase?.("uploading");
    const tr = await fetch("/api/rfp/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, size: file.size }),
    });
    if (!tr.ok) throw new Error(await readError(tr, "업로드 URL을 받지 못했습니다."));
    ticket = (await tr.json()) as UploadTicket;
    const supabase = createClient();
    const { error } = await supabase.storage.from("rfp").uploadToSignedUrl(ticket.storagePath, ticket.token, file, { contentType: "application/octet-stream" });
    if (error) throw new Error(`파일 업로드에 실패했습니다: ${error.message}`);
  }
  opts.onPhase?.("registering");
  const rr = await fetch("/api/rfp/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storagePath: ticket.storagePath, fileName: file.name, sizeBytes: file.size, force: opts.force === true }),
  });
  if (!rr.ok) throw new Error(await readError(rr, "등록에 실패했습니다."));
  return { response: (await rr.json()) as RegisterResponse, ticket };
}
