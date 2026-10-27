// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({
  user: true as boolean, token: { ok: true, token: "AT" } as unknown, status: { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] } as unknown, audit: vi.fn(), fetch: vi.fn(), after: vi.fn(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: m.after })); // 응답 뒤 작업(사용자 정의 반응 등록)은 따로 검사
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.user ? { ok: true, userId: "u1", role: "user", admin: {} } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForRoute: async () => m.token }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: async () => m.status }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
vi.stubGlobal("fetch", m.fetch);
import { GET as chatGET } from "@/app/api/teams/chat/route";
import { GET as msgGET, POST as msgPOST } from "@/app/api/teams/chat/messages/route";
import { GET as searchGET } from "@/app/api/teams/chat/search/route";
import { POST as reactPOST } from "@/app/api/teams/chat/reaction/route";
import { GET as imageGET } from "@/app/api/teams/chat/image/route";
import { normalizeReactions } from "@/lib/teams/chat";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rawMsg = (id: string) => ({ id, messageType: "message", createdDateTime: `2026-10-03T12:0${id}:00Z`, lastModifiedDateTime: `2026-10-03T12:0${id}:00Z`, deletedDateTime: null, from: { user: { id: "aad-1", displayName: "강승욱" } }, body: { contentType: "text", content: `m${id}` }, attachments: [] });
const CHAT = "19:abc@thread.v2";
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://app.test${url}`, init);
beforeEach(() => {
  m.user = true; m.token = { ok: true, token: "AT" }; m.status = { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] }; m.audit.mockReset(); m.fetch.mockReset(); m.after.mockReset();
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
it("Graph가 아닌 예외(네트워크 끊김)도 HTML 500 대신 JSON 502 — 화면이 안내를 띄울 수 있게", async () => {
  m.fetch.mockRejectedValue(new TypeError("fetch failed"));
  const res = await msgGET(req(`/api/teams/chat/messages?chat=${encodeURIComponent(CHAT)}`));
  expect(res.status).toBe(502);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect((await res.json()).error).toContain("Teams에 연결하지 못했습니다");
  expect((await chatGET()).status).toBe(502);
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

it("GET /api/teams/chat/search — 검색어 2~100자, Microsoft Search로 채팅 메시지만(채널 제외)·요약 강조 태그 제거, 403은 409", async () => {
  expect((await searchGET(req("/api/teams/chat/search?q=a"))).status).toBe(400);
  const before = await searchGET(req("/api/teams/chat/search?q=견적"));
  expect(before.status).toBe(409);
  expect((await before.json()).code).toBe("reconnect_search");
  expect(m.fetch).not.toHaveBeenCalled();
  m.status = { connected: true, scopes: ["User.Read", "Chat.ReadWrite", "ChannelMessage.Read.All"] };
  m.fetch.mockResolvedValue(json(200, { value: [{ hitsContainers: [{ hits: [
    { summary: "...<c0>견적</c0>서 보냈습니다 &amp; 확인", resource: { id: "1", chatId: CHAT, createdDateTime: "2026-10-23T01:00:00Z", from: { emailAddress: { name: "김민준" } } } },
    { summary: "채널 글", resource: { id: "2", channelIdentity: { channelId: "c" } } },
  ] }] }] }));
  const res = await searchGET(req(`/api/teams/chat/search?q=${encodeURIComponent(" 견적  서 ")}`));
  expect(await res.json()).toEqual({ hits: [{ id: "1", chatId: CHAT, createdAt: "2026-10-23T01:00:00Z", from: "김민준", snippet: "...견적서 보냈습니다 & 확인" }] });
  const [url, init] = m.fetch.mock.calls[0];
  expect(url).toContain("/search/query");
  expect(JSON.parse(init.body).requests[0]).toMatchObject({ entityTypes: ["chatMessage"], query: { queryString: "견적 서" } });
  m.fetch.mockResolvedValue(json(403, { error: { code: "Forbidden", message: "x" } }));
  expect((await searchGET(req("/api/teams/chat/search?q=견적"))).status).toBe(409);
});

it("반응 — 옛 이름(like)은 그림 문자로, 종류별로 묶고 누가 붙였는지 남긴다", () => {
  expect(normalizeReactions([
    { reactionType: "like", user: { user: { id: "u2", displayName: "김민준" } } },
    { reactionType: "👍", user: { user: { id: "u3", displayName: null } } },
    { reactionType: "like", user: { user: { id: "aad-1" } } },
    { reactionType: "custom", displayName: "축하", user: { user: { id: "u4" } } },
    { reactionType: "custom", displayName: "감사", user: { user: { id: "u5" } } },
    { reactionType: "" },
  ])).toEqual([
    { type: "like", emoji: "👍", users: [{ id: "u2", name: "김민준" }, { id: "aad-1", name: "" }] },
    { type: "👍", emoji: "👍", users: [{ id: "u3", name: "" }] },
    { type: "custom", emoji: ":축하:", users: [{ id: "u4", name: "" }] },
    { type: "custom", emoji: ":감사:", users: [{ id: "u5", name: "" }] },
  ]);
});
it("반응 — 사용자 정의(넵 등)는 그림을 본문 그림과 같은 중계 주소로, 모르는 주소면 이름만(형식만 경고)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const url = `https://graph.microsoft.com/beta/chats/${CHAT}/messages/1729758683767/hostedContents/aWQ9MC1jdXMtZDE0LWQ3OGYwYTE5/$value`;
  expect(normalizeReactions([
    { reactionType: "custom", displayName: "nepp", reactionContentUrl: url, user: { user: { id: "u4", displayName: "김민준" } } },
    { reactionType: "custom", displayName: "nepp", reactionContentUrl: url, user: { user: { id: "u5", displayName: "박서연" } } },
    { reactionType: "custom", displayName: "daebak", reactionId: "daebak;0-skr-d3-216f8053e7c875499eca198aa1085d92", reactionContentUrl: url, user: { user: { id: "u7" } } },
    { reactionType: "custom", displayName: "bad", reactionId: "bad id/../x", user: { user: { id: "u8" } } },
    { reactionType: "custom", displayName: "thankyou", reactionContentUrl: "https://example.com/emoji/thankyou-1234567890abcdef.png", user: { user: { id: "u6" } } },
  ])).toEqual([
    { type: "custom", emoji: ":nepp:", image: `/api/teams/chat/image?chat=${encodeURIComponent(CHAT)}&message=1729758683767&content=aWQ9MC1jdXMtZDE0LWQ3OGYwYTE5`, users: [{ id: "u4", name: "김민준" }, { id: "u5", name: "박서연" }] },
    { type: "daebak;0-skr-d3-216f8053e7c875499eca198aa1085d92", emoji: ":daebak:", image: `/api/teams/chat/image?chat=${encodeURIComponent(CHAT)}&message=1729758683767&content=aWQ9MC1jdXMtZDE0LWQ3OGYwYTE5`, users: [{ id: "u7", name: "" }] },
    { type: "custom", emoji: ":bad:", users: [{ id: "u8", name: "" }] },
    { type: "custom", emoji: ":thankyou:", users: [{ id: "u6", name: "" }] },
  ]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("https://example.com/emoji/…"));
  warn.mockRestore();
});
it("POST /api/teams/chat/reaction — 입력 검증, 붙이기는 setReaction·떼기는 unsetReaction(원래 값 그대로), 감사엔 종류 없이", async () => {
  const post = (body: unknown) => reactPOST(req("/api/teams/chat/reaction", { method: "POST", body: JSON.stringify(body) }));
  expect((await post({ chat: CHAT, message: "1", reaction: "👍" })).status).toBe(400);
  expect((await post({ chat: CHAT, message: "../x", reaction: "👍", on: true })).status).toBe(400);
  expect((await post({ chat: CHAT, message: "1", reaction: "custom", on: true })).status).toBe(400);
  m.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  expect((await post({ chat: CHAT, message: "1700000000000", reaction: "👍", on: true })).status).toBe(200);
  expect(m.fetch.mock.calls[0][0]).toContain(`/chats/${encodeURIComponent(CHAT)}/messages/1700000000000/setReaction`);
  expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({ reactionType: "👍" });
  expect((await post({ chat: CHAT, message: "1700000000000", reaction: "like", on: false })).status).toBe(200);
  expect(m.fetch.mock.calls[1][0]).toMatch(/unsetReaction$/);
  expect(JSON.parse(m.fetch.mock.calls[1][1].body)).toEqual({ reactionType: "like" });
  // 사용자 정의 반응 ID — beta에 {reactionType:"custom", reactionId}
  expect((await post({ chat: CHAT, message: "1700000000000", reaction: "daebak;0-skr-d3-216f8053e7c875499eca198aa1085d92", on: true })).status).toBe(200);
  expect(m.fetch.mock.calls[2][0]).toBe(`https://graph.microsoft.com/beta/chats/${encodeURIComponent(CHAT)}/messages/1700000000000/setReaction`);
  expect(JSON.parse(m.fetch.mock.calls[2][1].body)).toEqual({ reactionType: "custom", reactionId: "daebak;0-skr-d3-216f8053e7c875499eca198aa1085d92" });
  expect((await post({ chat: CHAT, message: "1", reaction: "daebak;0-skr/../x-aaaaaaaaaaaa", on: true })).status).toBe(400);
  expect(m.audit.mock.calls.map((c) => [c[2].action, c[2].detail])).toEqual([["Teams 반응 붙임", {}], ["Teams 반응 뗌", {}], ["Teams 반응 붙임", {}]]);
  m.fetch.mockResolvedValue(json(403, { error: { code: "Forbidden", message: "x" } }));
  expect((await post({ chat: CHAT, message: "1", reaction: "👍", on: true })).status).toBe(409);
});

it("GET /api/teams/chat/image — 본문 그림을 본인 토큰으로 중계(그림 형식만, 개인 캐시), 잘못된 값 400·그림 아님 415·권한 409", async () => {
  const HC = "aWQ9eF8wLXd1cy1kMS0xMjM0LHR5cGU9MQ==";
  const q = (o: Record<string, string>) => req(`/api/teams/chat/image?${new URLSearchParams(o)}`);
  expect((await imageGET(q({ chat: CHAT, message: "1" }))).status).toBe(400);
  expect((await imageGET(q({ chat: CHAT, message: "../x", content: HC }))).status).toBe(400);
  expect(m.fetch).not.toHaveBeenCalled();

  m.fetch.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } }));
  const res = await imageGET(q({ chat: CHAT, message: "1615971548136", content: HC }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  const [url, init] = m.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(CHAT)}/messages/1615971548136/hostedContents/${encodeURIComponent(HC)}/$value`);
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  expect(m.audit).not.toHaveBeenCalled();

  m.fetch.mockResolvedValue(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
  expect((await imageGET(q({ chat: CHAT, message: "1", content: HC }))).status).toBe(415);
  m.fetch.mockResolvedValue(json(403, { error: { code: "Forbidden", message: "x" } }));
  expect((await imageGET(q({ chat: CHAT, message: "1", content: HC }))).status).toBe(409);
  // 4MB 넘으면 413 — 길이 머리글로 미리, 머리글이 없어도 읽다가 끊는다
  m.fetch.mockResolvedValue(new Response(new Uint8Array(10), { status: 200, headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) } }));
  expect((await imageGET(q({ chat: CHAT, message: "1", content: HC }))).status).toBe(413);
  const big = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } });
  m.fetch.mockResolvedValue(new Response(big, { status: 200, headers: { "content-type": "image/jpeg" } }));
  expect((await imageGET(q({ chat: CHAT, message: "1", content: HC }))).status).toBe(413);
});
it("GET /api/teams/chat/messages — 응답 뒤 사용자 정의 반응 등록을 맡긴다(응답을 기다리게 하지 않음)", async () => {
  m.fetch.mockResolvedValue(json(200, { value: [rawMsg("1")] }));
  expect((await msgGET(req(`/api/teams/chat/messages?chat=${encodeURIComponent(CHAT)}`))).status).toBe(200);
  expect(m.after).toHaveBeenCalledTimes(1);
});
