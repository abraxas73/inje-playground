import { NextRequest, NextResponse } from "next/server";
import { deckForRequest } from "@/lib/ppt/deck-access";
import { safeFileName } from "@/lib/ppt/deck-json";
import { PPT_BUCKET, pptxFileName } from "@/lib/ppt/store";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; no: string }> };

/**
 * GET /api/ppt/decks/[id]/versions/[no]/file?kind=pptx|yaml|source → {url, fileName} (300초 서명 URL).
 * kind=source: 파일 원고는 {url, fileName}, 텍스트 원고는 {text}. 생성 중·실패 버전도 원고는 볼 수 있다.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id, no: noRaw } = await params;
  const r = await deckForRequest(id);
  if (!r.ok) return r.response;
  const no = Number(noRaw);
  if (!Number.isInteger(no) || no < 1) return NextResponse.json({ error: "버전 번호가 올바르지 않습니다." }, { status: 400 });
  const kindRaw = request.nextUrl.searchParams.get("kind");
  const kind = kindRaw === "yaml" ? "yaml" : kindRaw === "source" ? "source" : "pptx";
  const { data } = await r.auth.admin.from("ppt_deck_versions").select("status, pptx_path, yaml_path, source_kind, source_path, source_name, source_text").eq("deck_id", id).eq("no", no).maybeSingle();
  const v = data as { status: string; pptx_path: string | null; yaml_path: string | null; source_kind: string; source_path: string | null; source_name: string | null; source_text: string | null } | null;
  if (!v) return NextResponse.json({ error: "버전이 없습니다." }, { status: 404 });
  if (kind === "source") {
    if (v.source_kind === "text" || v.source_kind === "url") return NextResponse.json({ text: v.source_text ?? "", url: v.source_kind === "url" ? v.source_name : undefined }, { headers: { "Cache-Control": "no-store" } });
    if (!v.source_path) return NextResponse.json({ error: "원고 파일이 없습니다." }, { status: 404 });
    const name = v.source_name ?? v.source_path.slice(v.source_path.lastIndexOf("/") + 1);
    const { data: s, error: e } = await r.auth.admin.storage.from(PPT_BUCKET).createSignedUrl(v.source_path, 300, { download: name });
    if (e || !s) return NextResponse.json({ error: `다운로드 URL을 만들지 못했습니다: ${e?.message ?? ""}` }, { status: 500 });
    return NextResponse.json({ url: s.signedUrl, fileName: name }, { headers: { "Cache-Control": "no-store" } });
  }
  const path = kind === "pptx" ? v.pptx_path : v.yaml_path;
  if (v.status !== "done" || !path) return NextResponse.json({ error: "아직 생성 중이거나 실패한 버전입니다." }, { status: 409 });
  const fileName = kind === "pptx" ? pptxFileName(r.deck.title, no) : `${safeFileName(r.deck.title)}_v${String(no).padStart(2, "0")}.deck.yaml`;
  const { data: signed, error } = await r.auth.admin.storage.from(PPT_BUCKET).createSignedUrl(path, 300, { download: fileName });
  if (error || !signed) return NextResponse.json({ error: `다운로드 URL을 만들지 못했습니다: ${error?.message ?? ""}` }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl, fileName }, { headers: { "Cache-Control": "no-store" } });
}
