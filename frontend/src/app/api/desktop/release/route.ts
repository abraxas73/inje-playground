import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { DESKTOP_BUCKET, DESKTOP_RELEASE_KEY, isDesktopPlatform, parseDesktopRelease } from "@/lib/desktop/release";
import { canAutoUpdate, UPDATE_HEADERS, UPDATE_ORIGIN } from "@/lib/desktop/update-feed";

export async function GET(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data, error } = await r.admin.from("settings").select("value").eq("key", DESKTOP_RELEASE_KEY).maybeSingle();
  if (error) return NextResponse.json({ error: "배포 정보를 불러오지 못했습니다." }, { status: 503 });
  const release = parseDesktopRelease(data?.value);
  const requestedPlatform = request.nextUrl.searchParams.get("platform");
  if (!requestedPlatform) {
    return NextResponse.json(release, { headers: { "Cache-Control": "no-store" } });
  }
  if (!isDesktopPlatform(requestedPlatform)) {
    return NextResponse.json({ error: "지원하지 않는 플랫폼입니다." }, { status: 400 });
  }

  const platform = requestedPlatform;
  const artifact = release[platform];
  if (!artifact) {
    return NextResponse.json({ error: "설치 파일을 준비 중입니다." }, { status: 404 });
  }
  if (request.nextUrl.searchParams.get("mode") === "automatic") {
    return NextResponse.json({ ...artifact,
      update: canAutoUpdate(platform, artifact) ? artifact.update : undefined,
      url: `${UPDATE_ORIGIN}/api/desktop/update/artifact/${platform}/${encodeURIComponent(artifact.version)}`,
    }, { headers: UPDATE_HEADERS });
  }
  const { data: signed, error: signingError } = await r.admin.storage
    .from(DESKTOP_BUCKET)
    .createSignedUrl(artifact.path, 300, { download: artifact.filename });
  if (signingError || !signed) {
    return NextResponse.json({ error: "다운로드를 준비하지 못했습니다." }, { status: 503 });
  }
  return NextResponse.json(
    { ...artifact, url: signed.signedUrl },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
