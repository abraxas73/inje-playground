import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { CHAT_MESSAGE_MAX, listChatMessages, sendChatMessage } from "@/lib/teams/chat";
import { graphErrorResponse, parseChatId } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

const badChat = () => NextResponse.json({ error: "채팅을 지정해 주세요(chat)." }, { status: 400 });

async function prepare() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok;
  return { ok: true as const, admin: auth.admin, userId: auth.userId, token: tok.token };
}

/** GET /api/teams/chat/messages?chat=<id>&since=<ISO> — 최근 50건(오래된 것부터). since가 있으면 그 뒤 수정·생성분만(폴링). 참여 여부는 Graph가 검사한다(미참여 403 → 409). */
export async function GET(request: NextRequest) {
  const chatId = parseChatId(request.nextUrl.searchParams.get("chat"));
  if (!chatId) return badChat();
  const since = request.nextUrl.searchParams.get("since") ?? undefined;
  if (since && Number.isNaN(Date.parse(since))) return NextResponse.json({ error: "since 형식이 잘못되었습니다." }, { status: 400 });
  const p = await prepare();
  if (!p.ok) return p.response;
  try {
    return NextResponse.json({ messages: await listChatMessages(p.token, chatId, since) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}

/** POST /api/teams/chat/messages {chat, text} — 본인 이름으로 전송. 감사 로그에는 글자 수만. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { chat?: unknown; text?: unknown };
  const chatId = parseChatId(body.chat);
  if (!chatId) return badChat();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "보낼 내용이 없습니다." }, { status: 400 });
  if (text.length > CHAT_MESSAGE_MAX) return NextResponse.json({ error: `메시지는 ${CHAT_MESSAGE_MAX}자까지 보낼 수 있습니다.` }, { status: 400 });
  const p = await prepare();
  if (!p.ok) return p.response;
  try {
    const message = await sendChatMessage(p.token, chatId, text);
    await logAudit(p.admin, request, { userId: p.userId, action: "Teams 채팅 전송", category: "teams", detail: { chars: text.length } });
    return NextResponse.json({ message });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
