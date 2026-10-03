import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { CHAT_MESSAGE_MAX, listChatMessages, sendChatMessage } from "@/lib/teams/chat";
import { graphErrorResponse, loadChatTarget } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

async function prepare() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const target = await loadChatTarget();
  if (!target.chatId) return { ok: false as const, response: NextResponse.json({ error: "관리자가 Teams 그룹 채팅을 아직 지정하지 않았습니다." }, { status: 400 }) };
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok;
  return { ok: true as const, admin: auth.admin, userId: auth.userId, chatId: target.chatId, token: tok.token };
}

/** GET /api/teams/chat/messages?since=<ISO> — 최근 50건(오래된 것부터). since가 있으면 그 뒤 수정·생성분만(폴링). */
export async function GET(request: NextRequest) {
  const since = request.nextUrl.searchParams.get("since") ?? undefined;
  if (since && Number.isNaN(Date.parse(since))) return NextResponse.json({ error: "since 형식이 잘못되었습니다." }, { status: 400 });
  const p = await prepare();
  if (!p.ok) return p.response;
  try {
    return NextResponse.json({ messages: await listChatMessages(p.token, p.chatId, since) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}

/** POST /api/teams/chat/messages {text} — 본인 이름으로 전송. 감사 로그에는 글자 수만. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "보낼 내용이 없습니다." }, { status: 400 });
  if (text.length > CHAT_MESSAGE_MAX) return NextResponse.json({ error: `메시지는 ${CHAT_MESSAGE_MAX}자까지 보낼 수 있습니다.` }, { status: 400 });
  const p = await prepare();
  if (!p.ok) return p.response;
  try {
    const message = await sendChatMessage(p.token, p.chatId, text);
    await logAudit(p.admin, request, { userId: p.userId, action: "Teams 채팅 전송", category: "teams", detail: { chars: text.length } });
    return NextResponse.json({ message });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
