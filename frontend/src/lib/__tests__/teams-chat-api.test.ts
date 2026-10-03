// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({
  user: true as boolean, adminOk: true as boolean, token: { ok: true, token: "AT" } as unknown, status: { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] } as unknown,
  settings: { teams_chat_id: "19:abc@thread.v2", teams_chat_topic: "개발팀" } as Record<string, string>, audit: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.user ? { ok: true, userId: "u1", role: "user", admin: {} } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
vi.mock("@/lib/claude-usage/require-admin", () => ({
  requireAdmin: async () => m.adminOk ? { ok: true, userId: "u1", email: "a@innogrid.com" } : { ok: false, response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }) },
  adminClientOr500: () => ({ ok: true, admin: {} }),
}));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForRoute: async () => m.token }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: async () => m.status }));
vi.mock("@/lib/settings-server", () => ({ loadSettings: async () => m.settings }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
vi.stubGlobal("fetch", m.fetch);
import { GET as chatGET } from "@/app/api/teams/chat/route";
import { GET as msgGET, POST as msgPOST } from "@/app/api/teams/chat/messages/route";
import { GET as adminChatsGET } from "@/app/api/admin/teams/chats/route";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rawMsg = (id: string) => ({ id, messageType: "message", createdDateTime: `2026-10-03T12:0${id}:00Z`, lastModifiedDateTime: `2026-10-03T12:0${id}:00Z`, deletedDateTime: null, from: { user: { id: "aad-1", displayName: "강승욱" } }, body: { contentType: "text", content: `m${id}` }, attachments: [] });
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://app.test${url}`, init);
beforeEach(() => {
  m.user = true; m.adminOk = true; m.token = { ok: true, token: "AT" }; m.status = { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] };
  m.settings = { teams_chat_id: "19:abc@thread.v2", teams_chat_topic: "개발팀" }; m.audit.mockReset(); m.fetch.mockReset();
});

it("GET /api/teams/chat — 설정 없으면 configured:false", async () => {
  m.settings = {};
  expect(await (await chatGET()).json()).toEqual({ configured: false });
});
it("GET /api/teams/chat — 연결 안 됐거나 Chat.ReadWrite 스코프가 없으면 그 사실만(Graph 호출 없음)", async () => {
  m.status = { connected: false };
  expect(await (await chatGET()).json()).toEqual({ configured: true, topic: "개발팀", connected: false, hasChatScope: false });
  m.status = { connected: true, scopes: ["User.Read", "Files.ReadWrite.All"] };
  expect(await (await chatGET()).json()).toEqual({ configured: true, topic: "개발팀", connected: true, hasChatScope: false });
  expect(m.fetch).not.toHaveBeenCalled();
});
it("GET /api/teams/chat — 준비되면 채팅 정보(주제·webUrl)와 내 Graph id", async () => {
  m.fetch.mockImplementation(async (url: string) => url.includes("/me?") ? json(200, { id: "aad-1", displayName: "강승욱", userPrincipalName: "k@innogrid.com", mail: null }) : json(200, { id: "19:abc@thread.v2", topic: "개발팀 수다", webUrl: "https://teams/x" }));
  expect(await (await chatGET()).json()).toEqual({ configured: true, topic: "개발팀 수다", connected: true, hasChatScope: true, webUrl: "https://teams/x", meId: "aad-1" });
});
it("GET /api/teams/chat/messages — since를 Graph 필터로 넘기고 정규화 목록을 돌려준다", async () => {
  m.fetch.mockResolvedValue(json(200, { value: [rawMsg("2"), rawMsg("1")] }));
  const res = await msgGET(req("/api/teams/chat/messages?since=2026-10-03T12:00:00Z"));
  expect(res.status).toBe(200);
  expect((await res.json()).messages.map((x: { id: string }) => x.id)).toEqual(["1", "2"]);
  expect((m.fetch.mock.calls[0] as unknown as [string])[0]).toContain("$filter=lastModifiedDateTime%20gt%202026-10-03T12%3A00%3A00Z");
});
it("GET /api/teams/chat/messages — Graph 403은 409 reconnect(스코프 추가 재연결 안내), 토큰 실패는 그 응답 그대로", async () => {
  m.fetch.mockResolvedValue(json(403, { error: { code: "Forbidden", message: "x" } }));
  const res = await msgGET(req("/api/teams/chat/messages"));
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: "reconnect" });
  m.token = { ok: false, response: NextResponse.json({ error: "Microsoft 계정을 먼저 연결하세요.", code: "not_connected" }, { status: 400 }) };
  expect((await msgGET(req("/api/teams/chat/messages"))).status).toBe(400);
});
it("POST /api/teams/chat/messages — 빈 글·4000자 초과는 400, 정상이면 Graph로 보내고 감사 로그(내용 없음)", async () => {
  expect((await msgPOST(req("/api/teams/chat/messages", { method: "POST", body: JSON.stringify({ text: "  " }) }))).status).toBe(400);
  expect((await msgPOST(req("/api/teams/chat/messages", { method: "POST", body: JSON.stringify({ text: "a".repeat(4001) }) }))).status).toBe(400);
  m.fetch.mockResolvedValue(json(201, rawMsg("7")));
  const res = await msgPOST(req("/api/teams/chat/messages", { method: "POST", body: JSON.stringify({ text: "안녕하세요" }) }));
  expect(res.status).toBe(200);
  expect((await res.json()).message.id).toBe("7");
  const [url, init] = m.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.v2/messages");
  expect(JSON.parse(init.body as string)).toEqual({ body: { contentType: "text", content: "안녕하세요" } });
  expect(m.audit).toHaveBeenCalledTimes(1);
  expect(m.audit.mock.calls[0][2]).toMatchObject({ userId: "u1", category: "teams" });
  expect(JSON.stringify(m.audit.mock.calls[0][2])).not.toContain("안녕하세요");
});
it("미설정이면 메시지 API는 400, 비로그인은 401", async () => {
  m.settings = {};
  expect((await msgGET(req("/api/teams/chat/messages"))).status).toBe(400);
  m.user = false;
  expect((await msgGET(req("/api/teams/chat/messages"))).status).toBe(401);
});
it("GET /api/admin/teams/chats — 관리자의 그룹 채팅 목록(고르기용), 비관리자 403", async () => {
  m.fetch.mockResolvedValue(json(200, { value: [{ id: "19:a", topic: "개발팀", webUrl: "https://teams/a", lastUpdatedDateTime: "2026-10-01T00:00:00Z", members: [{ displayName: "강승욱" }] }] }));
  expect(await (await adminChatsGET()).json()).toEqual({ chats: [{ id: "19:a", topic: "개발팀", members: ["강승욱"], webUrl: "https://teams/a", lastUpdated: "2026-10-01T00:00:00Z" }] });
  m.adminOk = false;
  expect((await adminChatsGET()).status).toBe(403);
});
