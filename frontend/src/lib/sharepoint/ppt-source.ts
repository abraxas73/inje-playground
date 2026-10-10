/** PPT 만들기 웹 주소 원고 — SharePoint·OneDrive 문서 링크는 로그인 벽 때문에 HTML로 못 읽으므로 본인 Microsoft 권한으로 내려받아 업로드 원고처럼 저장한다(pptx는 /extract 흐름 그대로). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { downloadFile, GraphError, XLSX_SOURCE_MAX_BYTES } from "@/lib/ms/graph-drive";
import { PPT_SOURCE_EXTENSIONS, PPT_SOURCE_EXTENSIONS_TEXT } from "@/types/ppt";
import { newSourcePath, PPT_BUCKET } from "@/lib/ppt/store";
import { resolveRef } from "./client";
import { SharepointError } from "./core";

export type SharepointSourceResult = { ok: true; storagePath: string; fileName: string } | { ok: false; error: string; status: number };
export async function sharepointSource(admin: SupabaseClient, userId: string, url: string): Promise<SharepointSourceResult> {
  const tok = await graphTokenForRoute(admin, userId);
  if (!tok.ok) {
    const j = (await tok.response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: `SharePoint 문서를 읽으려면 Microsoft 계정 연결이 필요합니다. ${j.error ?? ""}`.trim(), status: 400 };
  }
  try {
    const item = await resolveRef(tok.token, { url });
    if (item.kind !== "file") return { ok: false, error: "폴더 링크입니다. 문서 파일 링크를 넣어 주세요.", status: 400 };
    if (!(PPT_SOURCE_EXTENSIONS as readonly string[]).includes(item.ext)) return { ok: false, error: `${PPT_SOURCE_EXTENSIONS_TEXT} 문서만 원고로 쓸 수 있습니다.`, status: 415 };
    if (item.size > XLSX_SOURCE_MAX_BYTES) return { ok: false, error: "파일이 너무 큽니다(20MB 이하).", status: 413 };
    const buf = await downloadFile(tok.token, item.driveId, item.id);
    const storagePath = newSourcePath(item.ext);
    const { error } = await admin.storage.from(PPT_BUCKET).upload(storagePath, buf, { contentType: "application/octet-stream", upsert: false });
    if (error) return { ok: false, error: `원고 파일을 저장하지 못했습니다: ${error.message}`, status: 500 };
    return { ok: true, storagePath, fileName: item.name };
  } catch (e) {
    if (e instanceof SharepointError) return { ok: false, error: e.message, status: e.status === 403 ? 403 : 400 };
    if (e instanceof GraphError) { console.error(`[sharepoint] 원고 받기 실패 status=${e.status} code=${e.code}`); return { ok: false, error: `SharePoint 문서를 읽지 못했습니다(${e.status}).`, status: 502 }; }
    return { ok: false, error: "SharePoint 문서를 읽지 못했습니다.", status: 502 };
  }
}
