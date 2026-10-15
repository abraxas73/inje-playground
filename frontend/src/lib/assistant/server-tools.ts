import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectionStatus } from "@/lib/ms/connections";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe, TEAMS_CHAT_SCOPE } from "@/lib/ms/oauth";
import { CHAT_MESSAGE_MAX, listMyChats, sendChatMessage } from "@/lib/teams/chat";
import { parseChatId } from "@/lib/teams/chat-route";
import { collectMentions } from "@/lib/teams/mentions-collect";
import { canUsePage, isPagePermissions } from "@/lib/page-access";
import { JiraError } from "@/lib/jira/config";
import { confluenceFor, createPage, feed, listSpaces, readPage, searchPages } from "@/lib/confluence/client";
import { FEED_KINDS, type FeedKind } from "@/lib/confluence/core";
import { feed as spFeed, readDoc, searchDocs } from "@/lib/sharepoint/client";
import { FEED_KINDS as SP_FEED_KINDS, SharepointError, type FeedKind as SpFeedKind } from "@/lib/sharepoint/core";
import { pptxExtractor } from "@/lib/sharepoint/pptx";

export type ToolRun = { ok: true; result: unknown } | { ok: false; error: string };
const NOT_CONNECTED = "Microsoft 계정이 연결되지 않았거나 Teams 채팅 권한이 없습니다. 웹 설정에서 다시 연결하세요.";
const SP_NOT_CONNECTED = "Microsoft 계정이 연결되지 않았습니다. 웹 설정에서 연결하세요.";

/** 비서의 서버 도구(Teams·Confluence·SharePoint) 실행. 페이지 권한을 여기서 본다. 쓰기의 사용자 확인은 호출자 책임. */
export async function runServerTool(admin: SupabaseClient, userId: string, role: "user" | "admin", tool: string, args: Record<string, unknown>): Promise<ToolRun> {
  const fail = (error: string): ToolRun => ({ ok: false, error });
  const done = (result: unknown): ToolRun => ({ ok: true, result });
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
  const isConfluence = tool.startsWith("confluence_");
  const isSharepoint = tool.startsWith("sharepoint_");
  const pageKey = isConfluence ? "confluence" : isSharepoint ? "sharepoint" : "teams_chat";
  if (role !== "admin") {
    const access = await admin.from("user_page_access").select("permissions").eq("user_id", userId).maybeSingle();
    if (access.error || (access.data && !isPagePermissions(access.data.permissions)) || !canUsePage(role, pageKey, access.data?.permissions ?? {})) return fail(isConfluence ? "Confluence 권한이 없습니다" : isSharepoint ? "SharePoint 권한이 없습니다" : "Teams 채팅 권한이 없습니다");
  }
  if (isSharepoint) {
    try {
      const tok = await graphTokenForRoute(admin, userId);
      if (!tok.ok) return fail(SP_NOT_CONNECTED);
      if (tool === "sharepoint_search") {
        if (!str("query")) return fail("검색어가 없습니다.");
        return done({ items: await searchDocs(tok.token, str("query"), 8) });
      }
      if (tool === "sharepoint_recent") {
        const kind = str("kind") as SpFeedKind;
        if (!SP_FEED_KINDS.includes(kind)) return fail("kind는 used·shared·trending·recent 중 하나입니다.");
        return done(await spFeed(tok.token, kind, 10));
      }
      const ref = str("drive_id") && str("item_id") ? { driveId: str("drive_id"), id: str("item_id") } : str("url") ? { url: str("url") } : null;
      if (!ref) return fail("drive_id·item_id 또는 url이 필요합니다.");
      return done(await readDoc(tok.token, ref, 20_000, { extractPptx: pptxExtractor(admin) }));
    } catch (e) {
      if (e instanceof SharepointError) return fail(e.message);
      console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
      return fail("SharePoint 요청이 실패했습니다.");
    }
  }
  if (isConfluence) {
    try {
      const c = await confluenceFor(admin, userId);
      if (tool === "confluence_search") {
        if (!str("query")) return fail("검색어가 없습니다.");
        return done({ items: await searchPages(c.request, str("query").slice(0, 200), { spaceKey: str("space_key") || undefined, limit: 8 }) });
      }
      if (tool === "confluence_read") return done(await readPage(c.request, str("page_id")));
      if (tool === "confluence_feed") {
        const kind = str("kind") as FeedKind;
        if (!FEED_KINDS.includes(kind)) return fail("kind는 mentions·watching·recent 중 하나입니다.");
        return done({ items: await feed(c.request, kind, 10) });
      }
      if (tool === "confluence_spaces") {
        // key: 확인 카드용 정확히 한 공간, query: 이름·key 일부로 좁히기(공간이 수백 개라 전부 주지 않는다)
        const all = await listSpaces(c.request, c.accountId);
        const key = str("key"), q = str("query").toLowerCase();
        const spaces = key ? all.filter((x) => x.key === key) : q ? all.filter((x) => x.name.toLowerCase().includes(q) || x.key.toLowerCase().includes(q)) : all;
        return done({ spaces: spaces.slice(0, 80), total: spaces.length, canWrite: c.canWrite });
      }
      if (!c.canWrite) return fail("Confluence 쓰기 권한이 없습니다. 웹 설정에서 Atlassian 계정을 다시 연결하세요.");
      return done(await createPage(c.request, { spaceKey: str("space_key"), parentId: str("parent_id") || null, title: str("title"), markdown: typeof args.markdown === "string" ? args.markdown.slice(0, 100_000) : "" }));
    } catch (e) {
      if (e instanceof JiraError) return fail(e.message);
      console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
      return fail(tool === "confluence_create_page" ? "Confluence 응답을 확인하지 못했습니다. Confluence에서 페이지가 만들어졌는지 확인하세요." : "Confluence 요청이 실패했습니다.");
    }
  }
  try {
    if (tool === "teams_mentions") {
      const m = await collectMentions(admin, userId, 2);
      if ("response" in m || !m.connected) return fail(NOT_CONNECTED);
      return done({ items: m.items.slice(0, 10) });
    }
    const status = await getConnectionStatus(admin, userId);
    if (!status.connected || !status.scopes.includes(TEAMS_CHAT_SCOPE)) return fail(NOT_CONNECTED);
    const tok = await graphTokenForRoute(admin, userId);
    if (!tok.ok) return fail(NOT_CONNECTED);
    if (tool === "teams_chats") {
      const me = await fetchMe(tok.token);
      const chats = await listMyChats(tok.token, me.id);
      return done({ chats: chats.slice(0, 30).map((c) => ({ id: c.id, name: c.topic, type: c.type })) });
    }
    const chatId = parseChatId(args.chat_id);
    const text = typeof args.text === "string" ? args.text.trim() : "";
    if (!chatId) return fail("채팅 id가 올바르지 않습니다.");
    if (!text) return fail("보낼 내용이 없습니다.");
    if (text.length > CHAT_MESSAGE_MAX) return fail(`메시지는 ${CHAT_MESSAGE_MAX}자까지 보낼 수 있습니다.`);
    await sendChatMessage(tok.token, chatId, text);
    return done({ sent: true });
  } catch (e) {
    console.error("[assistant] 실행 실패:", tool, e instanceof Error ? e.message.slice(0, 200) : e);
    return fail("Teams 요청이 실패했습니다.");
  }
}
