import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { ANDROID_INTERNAL_TEST_URL, MOBILE_RELEASE_KEY, parseMobileRelease, releaseResponse } from "@/lib/mobile/release";

export const runtime = "nodejs";

/**
 * GET /api/mobile/release — 최신 앱 버전(플랫폼별)과 설치 링크. 웹 /apps와 앱 시작 시 업데이트 확인이 쓴다.
 * user 이상(쿠키·Bearer). Android는 Google Play 내부 테스트 링크, iOS는 설정된 TestFlight 링크.
 */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data } = await r.admin.from("settings").select("value").eq("key", MOBILE_RELEASE_KEY).maybeSingle();
  const rel = parseMobileRelease((data as { value?: string } | null)?.value);
  return NextResponse.json(releaseResponse(rel, ANDROID_INTERNAL_TEST_URL), { headers: { "Cache-Control": "no-store" } });
}
