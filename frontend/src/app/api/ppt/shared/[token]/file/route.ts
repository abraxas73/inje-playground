import { NextRequest, NextResponse } from "next/server";
import { resolveSharedDeck } from "@/lib/ppt/shared-access";
import { PPT_BUCKET, pptxFileName } from "@/lib/ppt/store";

export const runtime = "nodejs";
type Params = { params: Promise<{ token: string }> };

/** GET /api/ppt/shared/[token]/file → {url, fileName} 최신 완료 버전 PPTX(300초) */
export async function GET(_request: NextRequest, { params }: Params) {
  const { token } = await params;
  const r = await resolveSharedDeck(token);
  if (!r.ok) return r.response;
  if (!r.version.pptx_path) return NextResponse.json({ error: "파일이 없습니다." }, { status: 404 });
  const fileName = pptxFileName(r.deck.title, r.version.no);
  const { data, error } = await r.admin.storage.from(PPT_BUCKET).createSignedUrl(r.version.pptx_path, 300, { download: fileName });
  if (error || !data) return NextResponse.json({ error: `다운로드 URL을 만들지 못했습니다: ${error?.message ?? ""}` }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, fileName }, { headers: { "Cache-Control": "no-store" } });
}
