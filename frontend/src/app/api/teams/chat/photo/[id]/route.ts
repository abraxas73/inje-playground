import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { TEAMS_USER_ID_RE, teamsPhoto } from "@/lib/teams/photo";

export const runtime = "nodejs";

/**
 * GET /api/teams/chat/photo/{Entra 사용자 id} — Teams 프로필 사진(96px). 로그인 + teams_chat 권한(proxy가 /api/teams/chat으로 확인).
 * 받아 둔 사본을 주고 하루 지나면 부른 사람의 Microsoft 토큰으로 다시 받는다(`lib/teams/photo.ts`). id는 사진이 바뀌어도 같아서 하루만 캐시.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!TEAMS_USER_ID_RE.test(id)) return NextResponse.json({ error: "잘못된 사용자입니다." }, { status: 400 });
  const photo = await teamsPhoto(auth.admin, id, async () => {
    const tok = await graphTokenForRoute(auth.admin, auth.userId);
    return tok.ok ? tok.token : null;
  });
  // 사진이 없다고 확인된 사람만 하루 캐시 — 토큰 없음·Graph 장애로 못 받은 건 다음에 다시 묻게
  if (photo === "none" || !photo) return NextResponse.json({ error: "사진이 없습니다." }, { status: 404, headers: { "Cache-Control": photo === "none" ? "private, max-age=86400" : "no-store" } });
  return new NextResponse(photo.body, { headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
