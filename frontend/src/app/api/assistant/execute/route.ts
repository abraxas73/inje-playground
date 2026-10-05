import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { getConnectionStatus } from "@/lib/ms/connections";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe, TEAMS_CHAT_SCOPE } from "@/lib/ms/oauth";
import { CHAT_MESSAGE_MAX, listMyChats, sendChatMessage } from "@/lib/teams/chat";
import { parseChatId } from "@/lib/teams/chat-route";
import { collectMentions } from "@/lib/teams/mentions-collect";
import { SERVER_TOOLS } from "@/lib/assistant/tools";
import { loadAssistantSettings } from "@/lib/assistant/settings";
import { canUsePage, isPagePermissions } from "@/lib/page-access";

export const runtime = "nodejs";
const NOT_CONNECTED = "Microsoft 계정이 연결되지 않았거나 Teams 채팅 권한이 없습니다. 웹 설정에서 다시 연결하세요.";

/** POST /api/assistant/execute — 비서의 서버 도구(Teams) 실행. 쓰기(teams_send)는 앱이 확인 카드를 받은 뒤에만 부른다. 결과는 {ok,result}|{ok:false,error}(도구 결과로 Claude에 간다). */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const body = (await request.json().catch(() => ({}))) as { tool?: unknown; args?: unknown };
  const tool = typeof body.tool === "string" ? body.tool : "";
  if (!(SERVER_TOOLS as readonly string[]).includes(tool)) return NextResponse.json({ error: "지원하지 않는 도구입니다." }, { status: 400 });
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!cfg.enabled) return NextResponse.json({ enabled: false });
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  const fail = (error: string) => NextResponse.json({ ok: false, error });
  // /api/teams/chat·mentions와 같은 페이지 권한(teams_chat) — 미들웨어는 /api/assistant를 페이지에 묶지 않으므로 여기서 본다.
  if (r.role !== "admin") {
    const access = await r.admin.from("user_page_access").select("permissions").eq("user_id", r.userId).maybeSingle();
    if (access.error || (access.data && !isPagePermissions(access.data.permissions)) || !canUsePage(r.role, "teams_chat", access.data?.permissions ?? {})) return fail("Teams 채팅 권한이 없습니다");
  }
  try {
    if (tool === "teams_mentions") {
      const m = await collectMentions(r.admin, r.userId, 2);
      if ("response" in m) return fail(NOT_CONNECTED);
      if (!m.connected) return fail(NOT_CONNECTED);
      await logAudit(r.admin, request, { userId: r.userId, action: "비서 실행", category: "assistant", detail: { tool } });
      return NextResponse.json({ ok: true, result: { items: m.items.slice(0, 10) } });
    }
    const status = await getConnectionStatus(r.admin, r.userId);
    if (!status.connected || !status.scopes.includes(TEAMS_CHAT_SCOPE)) return fail(NOT_CONNECTED);
    const tok = await graphTokenForRoute(r.admin, r.userId);
    if (!tok.ok) return fail(NOT_CONNECTED);
    let result: unknown;
    if (tool === "teams_chats") {
      const me = await fetchMe(tok.token);
      const chats = await listMyChats(tok.token, me.id);
      result = { chats: chats.slice(0, 30).map((c) => ({ id: c.id, name: c.topic, type: c.type })) };
    } else {
      const chatId = parseChatId(args.chat_id);
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!chatId) return fail("채팅 id가 올바르지 않습니다.");
      if (!text) return fail("보낼 내용이 없습니다.");
      if (text.length > CHAT_MESSAGE_MAX) return fail(`메시지는 ${CHAT_MESSAGE_MAX}자까지 보낼 수 있습니다.`);
      await sendChatMessage(tok.token, chatId, text);
      result = { sent: true };
    }
    await logAudit(r.admin, request, { userId: r.userId, action: "비서 실행", category: "assistant", detail: { tool } });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
    return fail("Teams 요청이 실패했습니다.");
  }
}
