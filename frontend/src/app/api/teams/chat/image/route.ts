import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { HOSTED_CONTENT_ID_RE, MESSAGE_ID_RE, fetchHostedImage } from "@/lib/teams/chat";
import { graphErrorResponse, parseChatId } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

/**
 * GET /api/teams/chat/image?chat&message&content — 메시지 본문 그림(hostedContents)을 본인 위임 토큰으로 받아 흘려준다.
 * 본문 마크다운의 그림 주소(`hostedImagePath`)가 여기를 가리킨다. 참여 여부는 Graph가 검사한다. 그림 형식만·4MB까지(넘으면 413 — 화면은 [이미지]·새 탭 원본), 감사·로그 없음(읽기).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const chatId = parseChatId(q.get("chat"));
  const messageId = q.get("message") ?? "";
  const contentId = q.get("content") ?? "";
  if (!chatId || !MESSAGE_ID_RE.test(messageId) || !HOSTED_CONTENT_ID_RE.test(contentId)) return NextResponse.json({ error: "chat·message·content가 필요합니다." }, { status: 400 });
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try {
    const img = await fetchHostedImage(tok.token, chatId, messageId, contentId);
    if ("error" in img) return img.error === "size" ? NextResponse.json({ error: "그림이 너무 큽니다." }, { status: 413 }) : NextResponse.json({ error: "그림이 아닙니다." }, { status: 415 });
    // 같은 메시지의 그림은 바뀌지 않는다 — 브라우저·앱이 하루 동안 다시 받지 않게(본인 것만, 공용 캐시 금지)
    return new NextResponse(new Blob([img.body]), { headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
