import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { MESSAGE_ID_RE, REACTION_MAX, setChatReaction } from "@/lib/teams/chat";
import { graphErrorResponse, parseChatId } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

/** POST {chat, message, reaction, on} — 메시지에 반응 붙이기(on)·떼기. 본인 이름으로, 감사에는 붙임/뗌만(반응 종류·메시지 내용 없음). */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as { chat?: unknown; message?: unknown; reaction?: unknown; on?: unknown };
  const chatId = parseChatId(b.chat);
  const messageId = typeof b.message === "string" && MESSAGE_ID_RE.test(b.message) ? b.message : null;
  const reaction = typeof b.reaction === "string" ? b.reaction.trim() : "";
  if (!chatId || !messageId || !reaction || reaction === "custom" || reaction.length > REACTION_MAX || typeof b.on !== "boolean") return NextResponse.json({ error: "chat·message·reaction·on이 필요합니다." }, { status: 400 });
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try {
    await setChatReaction(tok.token, chatId, messageId, reaction, b.on);
    await logAudit(auth.admin, request, { userId: auth.userId, action: b.on ? "Teams 반응 붙임" : "Teams 반응 뗌", category: "teams", detail: {} });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
