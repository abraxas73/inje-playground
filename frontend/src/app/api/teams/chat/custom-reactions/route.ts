import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { CUSTOM_REACTION_NAME_RE, customReactionImage, listCustomReactions } from "@/lib/teams/custom-reactions";

export const runtime = "nodejs";

/**
 * GET /api/teams/chat/custom-reactions — 등록된 조직 사용자 정의 반응 [{type(reactionId), emoji(:이름:), image}] (고르기 창).
 * GET ?name=<이름> — 그 반응 그림(등록부에 저장한 바이트, 하루 개인 캐시). 감사·로그 없음(읽기).
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (name !== null && !CUSTOM_REACTION_NAME_RE.test(name)) return NextResponse.json({ error: "name이 잘못되었습니다." }, { status: 400 });
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (name === null) {
    try {
      return NextResponse.json({ reactions: await listCustomReactions(auth.admin) }, { headers: { "Cache-Control": "private, max-age=300" } });
    } catch (e) {
      console.error("[teams-chat] 사용자 정의 반응 목록 실패:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "반응 목록을 읽지 못했습니다." }, { status: 500 });
    }
  }
  const img = await customReactionImage(auth.admin, name);
  if (!img) return NextResponse.json({ error: "없는 반응입니다." }, { status: 404 });
  return new NextResponse(new Blob([new Uint8Array(img.body)]), { headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
