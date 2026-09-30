"use client";
import { createClient } from "@/lib/supabase";
import type { PptCreateRequest, PptUploadTicket } from "@/types/ppt";

export async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: string } | null;
  return j?.error ?? fallback;
}

export async function postJson<T>(url: string, body: unknown, method: "POST" | "PUT" | "DELETE" = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    const e = new Error(j?.error ?? `요청에 실패했습니다(${res.status}).`) as Error & { code?: string; status?: number };
    e.code = j?.code; e.status = res.status;
    throw e;
  }
  return (await res.json()) as T;
}

/** 서명 URL → Storage 직접 업로드(파일은 서버를 거치지 않는다) */
export async function uploadSource(file: File): Promise<PptUploadTicket> {
  const tr = await fetch("/api/ppt/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, size: file.size }) });
  if (!tr.ok) throw new Error(await readError(tr, "업로드 URL을 받지 못했습니다."));
  const ticket = (await tr.json()) as PptUploadTicket;
  const { error } = await createClient().storage.from("ppt").uploadToSignedUrl(ticket.storagePath, ticket.token, file, { contentType: "application/octet-stream" });
  if (error) throw new Error(`파일 업로드에 실패했습니다: ${error.message}`);
  return ticket;
}

export async function createDeck(req: PptCreateRequest): Promise<{ deckId: string }> {
  return postJson<{ deckId: string }>("/api/ppt/decks", req);
}
