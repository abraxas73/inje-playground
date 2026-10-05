// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true as boolean, status: { connected: true, scopes: ["Chat.ReadWrite"] } as unknown, chats: vi.fn(), send: vi.fn(), mentions: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok ? { ok: true, userId: "u1", role: "user", admin: {} } : { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) } }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: async () => m.status }));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForRoute: async () => ({ ok: true, token: "AT" }) }));
vi.mock("@/lib/ms/oauth", async (orig) => ({ ...(await orig<typeof import("@/lib/ms/oauth")>()), fetchMe: async () => ({ id: "me", userPrincipalName: "a", displayName: "A", mail: "a@x" }) }));
vi.mock("@/lib/teams/chat", async (orig) => ({ ...(await orig<typeof import("@/lib/teams/chat")>()), listMyChats: m.chats, sendChatMessage: m.send }));
vi.mock("@/lib/teams/mentions-collect", () => ({ collectMentions: m.mentions }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { POST } from "@/app/api/assistant/execute/route";
const req = (b: unknown) => new NextRequest("https://app.test/api/assistant/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
beforeEach(() => {
  m.ok = true; m.status = { connected: true, scopes: ["Chat.ReadWrite"] }; m.audit.mockReset();
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
