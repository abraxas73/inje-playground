import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { APK_URL_TTL_SECONDS, MOBILE_BUCKET, MOBILE_RELEASE_KEY, parseMobileRelease, releaseResponse } from "@/lib/mobile/release";

export const runtime = "nodejs";

/**
 * GET /api/mobile/release — 최신 앱 버전(플랫폼별)과 설치 링크. 웹 /apps와 앱 시작 시 업데이트 확인이 쓴다.
 * user 이상(쿠키·Bearer). APK는 비공개 버킷 `mobile`의 600초 서명 URL, iOS는 TestFlight 공개 링크. 서명 실패는 url null로 내리고 200 유지.
 */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data } = await r.admin.from("settings").select("value").eq("key", MOBILE_RELEASE_KEY).maybeSingle();
  const rel = parseMobileRelease((data as { value?: string } | null)?.value);
  let apkUrl: string | null = null;
  if (rel.android) {
    const name = `innogrid-${rel.android.version}+${rel.android.build}.apk`;
    const signed = await r.admin.storage.from(MOBILE_BUCKET).createSignedUrl(rel.android.apkPath, APK_URL_TTL_SECONDS, { download: name });
    apkUrl = signed.data?.signedUrl ?? null;
  }
  return NextResponse.json(releaseResponse(rel, apkUrl), { headers: { "Cache-Control": "no-store" } });
}
