// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({
  user: true as boolean, token: { ok: true, token: "AT" } as unknown, status: { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] } as unknown, audit: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.user ? { ok: true, userId: "u1", role: "user", admin: {} } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForRoute: async () => m.token }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: async () => m.status }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
vi.stubGlobal("fetch", m.fetch);
import { GET as chatGET } from "@/app/api/teams/chat/route";
import { GET as msgGET, POST as msgPOST } from "@/app/api/teams/chat/messages/route";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rawMsg = (id: string) => ({ id, messageType: "message", createdDateTime: `2026-10-03T12:0${id}:00Z`, lastModifiedDateTime: `2026-10-03T12:0${id}:00Z`, deletedDateTime: null, from: { user: { id: "aad-1", displayName: "강승욱" } }, body: { contentType: "text", content: `m${id}` }, attachments: [] });
const CHAT = "19:abc@thread.v2";
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://app.test${url}`, init);
beforeEach(() => {
  m.user = true; m.token = { ok: true, token: "AT" }; m.status = { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] }; m.audit.mockReset(); m.fetch.mockReset();
});

it("GET /api/teams/chat — 연결 안 됐거나 Chat.ReadWrite 스코프가 없으면 그 사실만(Graph 호출 없음)", async () => {
  m.status = { connected: false };
  expect(await (await chatGET()).json()).toEqual({ connected: false, hasChatScope: false });
  m.status = { connected: true, scopes: ["User.Read", "Files.ReadWrite.All"] };
  expect(await (await chatGET()).json()).toEqual({ connected: true, hasChatScope: false });
  expect(m.fetch).not.toHaveBeenCalled();
});
it("GET /api/teams/chat — 준비되면 내 Graph id와 내가 속한 채팅 목록(그룹·1:1)", async () => {
  m.fetch.mockImplementation(async (url: string) => url.includes("/me?")
    ? json(200, { id: "aad-1", displayName: "강승욱", userPrincipalName: "k@innogrid.com", mail: null })
    : json(200, { value: [{ id: CHAT, chatType: "group", topic: "개발팀", webUrl: "https://teams/x", lastUpdatedDateTime: "2026-10-01T00:00:00Z", members: [{ userId: "aad-1", displayName: "강승욱" }, { userId: "u2", displayName: "김민준" }] }] }));
  expect(await (await chatGET()).json()).toEqual({ connected: true, hasChatScope: true, meId: "aad-1", chats: [{ id: CHAT, type: "group", topic: "개발팀", members: ["강승욱", "김민준"], webUrl: "https://teams/x", lastUpdated: "2026-10-01T00:00:00Z" }] });
});
it("GET /api/teams/chat — Graph 403은 409 reconnect", async () => {
  m.fetch.mockResolvedValue(json(403, { error: { code: "Forbidden", message: "x" } }));
  const res = await chatGET();
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: "reconnect" });
});
it("GET /api/teams/chat/messages — chat 필수(400), since는 Graph 필터로, 정규화 목록", async () => {
  expect((await msgGET(req("/api/teams/chat/messages"))).status).toBe(400);
  expect((await msgGET(req("/api/teams/chat/messages?chat=bad/id"))).status).toBe(400);
  m.fetch.mockResolvedValue(json(200, { value: [rawMsg("2"), rawMsg("1")] }));
  const res = await msgGET(req(`/api/teams/chat/messages?chat=${encodeURIComponent(CHAT)}&since=2026-10-03T12:00:00Z`));
  expect(res.status).toBe(200);
  expect((await res.json()).messages.map((x: { id: string }) => x.id)).toEqual(["1", "2"]);
  const url = (m.fetch.mock.calls[0] as unknown as [string])[0];
  expect(url).toContain("/chats/19%3Aabc%40thread.v2/messages");
  expect(url).toContain("$filter=lastModifiedDateTime%20gt%202026-10-03T12%3A00%3A00Z");
});
it("GET /api/teams/chat/messages — Graph 403(미참여·스코프 없음)은 409 reconnect, 토큰 실패는 그 응답 그대로, 비로그인 401", async () => {
  m.fetch.mockResolvedValue(json(403, { error: { code: "Forbidden", message: "x" } }));
  expect((await msgGET(req(`/api/teams/chat/messages?chat=${encodeURIComponent(CHAT)}`))).status).toBe(409);
  m.token = { ok: false, response: NextResponse.json({ error: "Microsoft 계정을 먼저 연결하세요.", code: "not_connected" }, { status: 400 }) };
  expect((await msgGET(req(`/api/teams/chat/messages?chat=${encodeURIComponent(CHAT)}`))).status).toBe(400);
  m.user = false;
  expect((await msgGET(req(`/api/teams/chat/messages?chat=${encodeURIComponent(CHAT)}`))).status).toBe(401);
});
it("POST /api/teams/chat/messages — chat·text 검증(400), 정상이면 Graph로 보내고 감사 로그(내용 없음)", async () => {
  const post = (body: unknown) => msgPOST(req("/api/teams/chat/messages", { method: "POST", body: JSON.stringify(body) }));
  expect((await post({ chat: CHAT, text: "  " })).status).toBe(400);
  expect((await post({ chat: CHAT, text: "a".repeat(4001) })).status).toBe(400);
  expect((await post({ text: "안녕" })).status).toBe(400);
  m.fetch.mockResolvedValue(json(201, rawMsg("7")));
  const res = await post({ chat: CHAT, text: "안녕하세요" });
  expect(res.status).toBe(200);
  expect((await res.json()).message.id).toBe("7");
  const [url, init] = m.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.v2/messages");
  expect(JSON.parse(init.body as string)).toEqual({ body: { contentType: "text", content: "안녕하세요" } });
  expect(m.audit).toHaveBeenCalledTimes(1);
  expect(m.audit.mock.calls[0][2]).toMatchObject({ userId: "u1", category: "teams" });
  expect(JSON.stringify(m.audit.mock.calls[0][2])).not.toContain("안녕하세요");
});
