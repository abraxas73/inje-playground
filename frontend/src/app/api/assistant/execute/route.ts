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
import { JiraError } from "@/lib/jira/config";
import { confluenceFor, createPage, feed, listSpaces, readPage, searchPages } from "@/lib/confluence/client";
import { FEED_KINDS, type FeedKind } from "@/lib/confluence/core";
import { feed as spFeed, readDoc, searchDocs } from "@/lib/sharepoint/client";
import { FEED_KINDS as SP_FEED_KINDS, SharepointError, type FeedKind as SpFeedKind } from "@/lib/sharepoint/core";
import { pptxExtractor } from "@/lib/sharepoint/pptx";

export const runtime = "nodejs";
const NOT_CONNECTED = "Microsoft 계정이 연결되지 않았거나 Teams 채팅 권한이 없습니다. 웹 설정에서 다시 연결하세요.";
const SP_NOT_CONNECTED = "Microsoft 계정이 연결되지 않았습니다. 웹 설정에서 연결하세요.";

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
  // 웹 API와 같은 페이지 권한(Teams 도구 → teams_chat, Confluence 도구 → confluence, SharePoint 도구 → sharepoint) — 미들웨어는 /api/assistant를 페이지에 묶지 않으므로 여기서 본다.
  const isConfluence = tool.startsWith("confluence_");
  const isSharepoint = tool.startsWith("sharepoint_");
  const pageKey = isConfluence ? "confluence" : isSharepoint ? "sharepoint" : "teams_chat";
  if (r.role !== "admin") {
    const access = await r.admin.from("user_page_access").select("permissions").eq("user_id", r.userId).maybeSingle();
    if (access.error || (access.data && !isPagePermissions(access.data.permissions)) || !canUsePage(r.role, pageKey, access.data?.permissions ?? {})) return fail(isConfluence ? "Confluence 권한이 없습니다" : isSharepoint ? "SharePoint 권한이 없습니다" : "Teams 채팅 권한이 없습니다");
  }
  if (isSharepoint) {
    try {
      const tok = await graphTokenForRoute(r.admin, r.userId);
      if (!tok.ok) return fail(SP_NOT_CONNECTED);
      const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
      let result: unknown;
      if (tool === "sharepoint_search") {
        if (!str("query")) return fail("검색어가 없습니다.");
        result = { items: await searchDocs(tok.token, str("query"), 8) };
      } else if (tool === "sharepoint_recent") {
        const kind = str("kind") as SpFeedKind;
        if (!SP_FEED_KINDS.includes(kind)) return fail("kind는 used·shared·trending·recent 중 하나입니다.");
        result = await spFeed(tok.token, kind, 10);
      } else {
        const ref = str("drive_id") && str("item_id") ? { driveId: str("drive_id"), id: str("item_id") } : str("url") ? { url: str("url") } : null;
        if (!ref) return fail("drive_id·item_id 또는 url이 필요합니다.");
        result = await readDoc(tok.token, ref, 20_000, { extractPptx: pptxExtractor() });
      }
      await logAudit(r.admin, request, { userId: r.userId, action: "비서 실행", category: "assistant", detail: { tool } });
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      if (e instanceof SharepointError) return fail(e.message);
      console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
      return fail("SharePoint 요청이 실패했습니다.");
    }
  }
  if (isConfluence) {
    try {
      const c = await confluenceFor(r.admin, r.userId);
      const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
      let result: unknown;
      if (tool === "confluence_search") {
        if (!str("query")) return fail("검색어가 없습니다.");
        result = { items: await searchPages(c.request, str("query").slice(0, 200), { spaceKey: str("space_key") || undefined, limit: 8 }) };
      } else if (tool === "confluence_read") {
        result = await readPage(c.request, str("page_id"));
      } else if (tool === "confluence_feed") {
        const kind = str("kind") as FeedKind;
        if (!FEED_KINDS.includes(kind)) return fail("kind는 mentions·watching·recent 중 하나입니다.");
        result = { items: await feed(c.request, kind, 10) };
      } else if (tool === "confluence_spaces") {
        // key: 확인 카드용 정확히 한 공간, query: 이름·key 일부로 좁히기(공간이 수백 개라 전부 주지 않는다)
        const all = await listSpaces(c.request, c.accountId);
        const key = str("key"), q = str("query").toLowerCase();
        const spaces = key ? all.filter((x) => x.key === key) : q ? all.filter((x) => x.name.toLowerCase().includes(q) || x.key.toLowerCase().includes(q)) : all;
        result = { spaces: spaces.slice(0, 80), total: spaces.length, canWrite: c.canWrite };
      } else {
        if (!c.canWrite) return fail("Confluence 쓰기 권한이 없습니다. 웹 설정에서 Atlassian 계정을 다시 연결하세요.");
        result = await createPage(c.request, { spaceKey: str("space_key"), parentId: str("parent_id") || null, title: str("title"), markdown: typeof args.markdown === "string" ? args.markdown.slice(0, 100_000) : "" });
      }
      await logAudit(r.admin, request, { userId: r.userId, action: "비서 실행", category: "assistant", detail: { tool } });
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      if (e instanceof JiraError) return fail(e.message);
      console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
      return fail(tool === "confluence_create_page" ? "Confluence 응답을 확인하지 못했습니다. Confluence에서 페이지가 만들어졌는지 확인하세요." : "Confluence 요청이 실패했습니다.");
    }
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
