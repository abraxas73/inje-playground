import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";

export const runtime = "nodejs";

/**
 * POST /api/mobile/web-token — 앱 안 WebView가 자기 쿠키 세션을 만들 일회용 토큰.
 * 앱 세션을 복사하지 않는 이유: Supabase 리프레시 토큰 회전(재사용 간격 10초) 때문에 두 클라이언트가 한 세션을 나눠 쓰면
 * 세션이 통째로 끊긴다. generateLink(magiclink)는 메일을 보내지 않고 hashed_token만 돌려주며, 웹 /auth/mobile이
 * verifyOtp(type email)로 소비한다(1회·1시간). 토큰은 감사 로그에 남기지 않는다.
 */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data: u, error: ue } = await r.admin.auth.admin.getUserById(r.userId);
  const email = u?.user?.email;
  if (ue || !email) return NextResponse.json({ error: "사용자 이메일을 확인하지 못했습니다." }, { status: 502 });
  const { data, error } = await r.admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return NextResponse.json({ error: "웹 세션 토큰을 발급하지 못했습니다." }, { status: 502 });
  await logAudit(r.admin, request, { userId: r.userId, action: "모바일 웹 세션 발급", category: "mobile", detail: {} });
  return NextResponse.json({ tokenHash }, { headers: { "Cache-Control": "no-store" } });
}
