import { NextRequest, NextResponse } from "next/server";
import { bad, caller } from "@/lib/proposal/api";
import { PREVIEW_COUNT, previewPath, PROPOSAL_BUCKET } from "@/lib/proposal/core";

type Params = { params: Promise<{ id: string }> };
const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

/** GET — 미리보기 이미지 서명 URL(10분, 있는 것만 순서대로) */
export async function GET(_: NextRequest, { params }: Params) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!validId(id)) return bad("없는 버전입니다.", 404);
  const paths = Array.from({ length: PREVIEW_COUNT }, (_, i) => previewPath(id, i + 1));
  const { data } = await auth.admin.storage.from(PROPOSAL_BUCKET).createSignedUrls(paths, 600);
  return NextResponse.json({ urls: (data ?? []).filter((d) => !d.error && d.signedUrl).map((d) => d.signedUrl) });
}

/** POST {count} — 미리보기 올릴 서명 주소(덮어쓰기). 올린 사람 또는 관리자만 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { count?: unknown };
  const count = Number(b.count);
  if (!validId(id) || !Number.isInteger(count) || count < 1 || count > PREVIEW_COUNT) return bad("count는 1~3이어야 합니다.");
  const { data: row } = await auth.admin.from("proposal_profiles").select("uploaded_by").eq("id", id).maybeSingle();
  if (!row) return bad("없는 버전입니다.", 404);
  if (row.uploaded_by !== auth.userId && auth.role !== "admin") return bad("올린 사람이나 관리자만 미리보기를 올릴 수 있습니다.", 403);
  const tickets = [];
  for (let n = 1; n <= count; n++) {
    const path = previewPath(id, n);
    const { data, error } = await auth.admin.storage.from(PROPOSAL_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) return bad("업로드 주소를 만들지 못했습니다.", 500);
    tickets.push({ path, token: data.token });
  }
  return NextResponse.json({ tickets });
}
