// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ conf: vi.fn(), confReq: vi.fn(), canWrite: true, ok: true as boolean, status: { connected: true, scopes: ["Chat.ReadWrite"] } as unknown, chats: vi.fn(), send: vi.fn(), mentions: vi.fn(), audit: vi.fn(), cfg: [] as Array<{ key: string; value: string }>, cfgErr: false, perms: null as unknown, role: "user" }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok ? { ok: true, userId: "u1", role: m.role, admin: { from: (t: string) => t === "user_page_access" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.perms === null ? null : { permissions: m.perms }, error: null }) }) }) } : { select: () => ({ in: async () => ({ data: m.cfg, error: m.cfgErr ? { message: "x" } : null }) }) } } } : { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) } }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: async () => m.status }));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForRoute: async () => ({ ok: true, token: "AT" }) }));
vi.mock("@/lib/ms/oauth", async (orig) => ({ ...(await orig<typeof import("@/lib/ms/oauth")>()), fetchMe: async () => ({ id: "me", userPrincipalName: "a", displayName: "A", mail: "a@x" }) }));
vi.mock("@/lib/teams/chat", async (orig) => ({ ...(await orig<typeof import("@/lib/teams/chat")>()), listMyChats: m.chats, sendChatMessage: m.send }));
vi.mock("@/lib/teams/mentions-collect", () => ({ collectMentions: m.mentions }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
vi.mock("@/lib/confluence/client", async (orig) => ({ ...(await orig<typeof import("@/lib/confluence/client")>()), confluenceFor: m.conf }));
import { POST } from "@/app/api/assistant/execute/route";
const req = (b: unknown) => new NextRequest("https://app.test/api/assistant/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test"); m.cfg = []; m.cfgErr = false; m.ok = true; m.perms = null; m.role = "user"; m.status = { connected: true, scopes: ["Chat.ReadWrite"] }; m.audit.mockReset();
  m.chats.mockReset().mockResolvedValue([{ id: "19:abc@thread.v2", type: "group", topic: "센터", members: ["김민준"], webUrl: null, lastUpdated: null }]);
  m.send.mockReset().mockResolvedValue({ id: "m1" });
  m.mentions.mockReset().mockResolvedValue({ connected: true, items: [{ id: "1", chatId: "c", topic: "센터", type: "group", from: "김", text: "확인", at: "x", webUrl: null }] });
});
it("teams_chats·teams_mentions·teams_send 실행, 감사엔 도구 이름만", async () => {
  expect((await (await POST(req({ tool: "teams_chats", args: {} }))).json())).toEqual({ ok: true, result: { chats: [{ id: "19:abc@thread.v2", name: "센터", type: "group" }] } });
  expect((await (await POST(req({ tool: "teams_mentions", args: {} }))).json()).result.items).toHaveLength(1);
  const j = await (await POST(req({ tool: "teams_send", args: { chat_id: "19:abc@thread.v2", text: "안녕하세요 — 비밀" } }))).json();
  expect(j).toEqual({ ok: true, result: { sent: true } });
  expect(m.send).toHaveBeenCalledWith("AT", "19:abc@thread.v2", "안녕하세요 — 비밀");
  expect(JSON.stringify(m.audit.mock.calls)).not.toContain("비밀");
});
it("화이트리스트 밖 도구·잘못된 chat_id·빈 글은 거부, 미연결은 ok:false", async () => {
  expect((await POST(req({ tool: "mail_send", args: {} }))).status).toBe(400);
  expect((await (await POST(req({ tool: "teams_send", args: { chat_id: "bad id!", text: "x" } }))).json()).ok).toBe(false);
  expect((await (await POST(req({ tool: "teams_send", args: { chat_id: "19:abc@thread.v2", text: "  " } }))).json()).ok).toBe(false);
  m.status = { connected: false, scopes: [] };
  expect((await (await POST(req({ tool: "teams_chats", args: {} }))).json())).toEqual({ ok: false, error: "Microsoft 계정이 연결되지 않았거나 Teams 채팅 권한이 없습니다. 웹 설정에서 다시 연결하세요." });
  m.ok = false;
  expect((await POST(req({ tool: "teams_chats", args: {} }))).status).toBe(401);
});

it("비서가 꺼져 있으면 Teams를 부르지 않는다(설정 오류는 503)", async () => {
  m.cfg = [{ key: "assistant_enabled", value: "off" }];
  expect(await (await POST(req({ tool: "teams_send", args: { chat_id: "19:abc@thread.v2", text: "x" } }))).json()).toEqual({ enabled: false });
  m.cfgErr = true;
  expect((await POST(req({ tool: "teams_chats", args: {} }))).status).toBe(503);
  expect(m.send).not.toHaveBeenCalled();
  expect(m.chats).not.toHaveBeenCalled();
});

it("Teams 채팅 페이지 권한이 없으면 세 도구 모두 거부(관리자는 통과)", async () => {
  m.perms = { teams_chat: false };
  for (const tool of ["teams_chats", "teams_mentions", "teams_send"]) {
    expect(await (await POST(req({ tool, args: { chat_id: "19:abc@thread.v2", text: "x" } }))).json()).toEqual({ ok: false, error: "Teams 채팅 권한이 없습니다" });
  }
  expect(m.send).not.toHaveBeenCalled();
  expect(m.chats).not.toHaveBeenCalled();
  expect(m.mentions).not.toHaveBeenCalled();
  m.role = "admin";
  expect((await (await POST(req({ tool: "teams_chats", args: {} }))).json()).ok).toBe(true);
});

it("Confluence 도구 — 본인 세션으로 검색·페이지 만들기, 쓰기 권한·페이지 권한 확인, 감사엔 도구 이름만", async () => {
  const { JiraError } = await import("@/lib/jira/config");
  m.confReq.mockReset();
  m.conf.mockReset().mockImplementation(async () => ({ request: m.confReq, canWrite: m.canWrite }));
  m.confReq.mockResolvedValueOnce({ results: [{ content: { id: "1", type: "page", title: "회의록", _links: { webui: "/spaces/D/pages/1" } } }] });
  const s = await (await POST(req({ tool: "confluence_search", args: { query: "회의록" } }))).json();
  expect(s.ok).toBe(true);
  expect(s.result.items[0]).toMatchObject({ id: "1", url: "https://pms-innogrid.atlassian.net/wiki/spaces/D/pages/1" });
  m.confReq.mockResolvedValueOnce({ id: "9", title: "[회의록] 비밀회의", _links: { webui: "/spaces/D/pages/9" } });
  const c = await (await POST(req({ tool: "confluence_create_page", args: { space_key: "D", space_name: "개발", title: "[회의록] 비밀회의", markdown: "## 안건" } }))).json();
  expect(c).toEqual({ ok: true, result: { id: "9", title: "[회의록] 비밀회의", url: "https://pms-innogrid.atlassian.net/wiki/spaces/D/pages/9" } });
  expect(JSON.stringify(m.audit.mock.calls)).not.toContain("비밀");
  m.canWrite = false;
  expect((await (await POST(req({ tool: "confluence_create_page", args: { space_key: "D", title: "x", markdown: "y" } }))).json()).ok).toBe(false);
  m.canWrite = true;
  m.conf.mockRejectedValueOnce(new JiraError("Confluence 권한을 추가하려면 설정에서 Atlassian 계정을 다시 연결하세요.", 409, "confluence_scope"));
  expect(await (await POST(req({ tool: "confluence_feed", args: { kind: "mentions" } }))).json()).toEqual({ ok: false, error: "Confluence 권한을 추가하려면 설정에서 Atlassian 계정을 다시 연결하세요." });
  m.perms = { confluence: false };
  expect(await (await POST(req({ tool: "confluence_search", args: { query: "x" } }))).json()).toEqual({ ok: false, error: "Confluence 권한이 없습니다" });
});

it("confluence_spaces — key는 정확히 한 공간, query는 이름·key 일부로 좁힌다", async () => {
  m.perms = null; m.canWrite = true;
  m.conf.mockReset().mockImplementation(async () => ({ request: m.confReq, canWrite: true }));
  const page = { results: [{ space: { key: "SS", name: "솔루션전략실", type: "global" } }, { space: { key: "DEV", name: "개발센터", type: "global" } }] };
  m.confReq.mockReset().mockResolvedValue(page);
  expect((await (await POST(req({ tool: "confluence_spaces", args: { key: "DEV" } }))).json()).result.spaces).toEqual([{ key: "DEV", name: "개발센터", type: "global" }]);
  expect((await (await POST(req({ tool: "confluence_spaces", args: { query: "솔루션" } }))).json()).result.spaces.map((x: { key: string }) => x.key)).toEqual(["SS"]);
  expect((await (await POST(req({ tool: "confluence_spaces", args: {} }))).json()).result.total).toBe(2);
});
