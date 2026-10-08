import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { DESKTOP_BUCKET, DESKTOP_RELEASE_KEY, parseDesktopRelease } from "@/lib/desktop/release";
export async function GET(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { platform } = await params;
  if (platform !== "macos" && platform !== "windows") return NextResponse.json({ error: "지원하지 않는 플랫폼입니다." }, { status: 404 });
  const { data, error } = await r.admin.from("settings").select("value").eq("key", DESKTOP_RELEASE_KEY).maybeSingle();
  if (error) return NextResponse.json({ error: "배포 정보를 불러오지 못했습니다." }, { status: 503 });
  const artifact = parseDesktopRelease(data?.value)[platform];
  if (!artifact) return NextResponse.json({ error: "설치 파일을 준비 중입니다." }, { status: 404 });
  const { data: signed, error: signingError } = await r.admin.storage.from(DESKTOP_BUCKET).createSignedUrl(artifact.path, 300, { download: artifact.filename });
  if (signingError || !signed) return NextResponse.json({ error: "다운로드를 준비하지 못했습니다." }, { status: 503 });
  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
