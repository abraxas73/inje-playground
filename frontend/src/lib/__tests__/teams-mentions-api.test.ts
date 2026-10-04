// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ user: true as boolean, status: { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] } as unknown, token: { ok: true, token: "AT" } as unknown, chats: vi.fn(), messages: vi.fn(), profileName: "강승욱" }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.user
  ? { ok: true, userId: "u1", role: "user", admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: m.profileName }, error: null }) }) }) }) } }
  : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: async () => m.status }));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForRoute: async () => m.token }));
vi.mock("@/lib/ms/oauth", async (orig) => ({ ...(await orig<typeof import("@/lib/ms/oauth")>()), fetchMe: async () => ({ id: "me", userPrincipalName: "seunguk.kang@innogrid.com", displayName: "SeungUk Kang", mail: "seunguk.kang@innogrid.com" }) }));
vi.mock("@/lib/teams/chat", async (orig) => ({ ...(await orig<typeof import("@/lib/teams/chat")>()), listMyChats: m.chats, listChatMessages: m.messages }));
import { GET } from "@/app/api/teams/mentions/route";
const req = (q = "") => new NextRequest(`https://app.test/api/teams/mentions${q}`);
const recent = new Date(Date.now() - 3600_000).toISOString();
beforeEach(() => {
  m.user = true; m.status = { connected: true, scopes: ["User.Read", "Chat.ReadWrite"] }; m.token = { ok: true, token: "AT" }; m.profileName = "강승욱";
  m.chats.mockReset().mockResolvedValue([{ id: "g1", type: "group", topic: "센터", members: [], webUrl: null, lastUpdated: recent }, { id: "d1", type: "oneOnOne", topic: "김민준", members: [], webUrl: null, lastUpdated: recent }]);
  m.messages.mockReset().mockImplementation(async (_t: string, chatId: string) => chatId === "g1"
    ? [{ id: "1", createdAt: recent, modifiedAt: recent, from: { id: "u2", name: "김민준" }, text: "강승욱님 확인 부탁", attachments: 0 }, { id: "2", createdAt: recent, modifiedAt: recent, from: { id: "u2", name: "김민준" }, text: "다들 수고", attachments: 0 }]
    : [{ id: "3", createdAt: recent, modifiedAt: recent, from: { id: "u2", name: "김민준" }, text: "시간 되세요?", attachments: 0 }]);
});

it("미연결·권한 없음이면 Graph 호출 없이 connected:false", async () => {
  m.status = { connected: true, scopes: ["User.Read"] };
  expect(await (await GET(req())).json()).toEqual({ connected: false, items: [] });
  expect(m.chats).not.toHaveBeenCalled();
});
it("최근 채팅을 훑어 답장 대기만 — 그룹은 한글 이름(user_profiles.display_name) 멘션도 잡는다, no-store", async () => {
  const res = await GET(req("?days=2"));
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const j = await res.json();
  expect(j.connected).toBe(true);
  expect(j.items.map((x: { id: string }) => x.id).sort()).toEqual(["1", "3"]);
  expect(m.messages).toHaveBeenCalledTimes(2);
  expect(m.messages.mock.calls[0][2]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
it("days는 1~7 밖이면 2로, 비로그인은 401, 채팅 하나의 Graph 오류는 그 채팅만 비운다", async () => {
  m.messages.mockImplementation(async (_t: string, chatId: string) => { if (chatId === "g1") throw new Error("boom"); return [{ id: "3", createdAt: recent, modifiedAt: recent, from: { id: "u2", name: "김민준" }, text: "시간 되세요?", attachments: 0 }]; });
  const j = await (await GET(req("?days=99"))).json();
  expect(j.items.map((x: { id: string }) => x.id)).toEqual(["3"]);
  m.user = false;
  expect((await GET(req())).status).toBe(401);
});
