// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { chatMessagesUrl, getChatInfo, listChatMessages, listMyChats, normalizeChatMessages, sendChatMessage, teamsHtmlToText } from "@/lib/teams/chat";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "rid-1" } });

describe("teamsHtmlToText", () => {
  it("블록·br은 줄바꿈, 멘션은 @이름, 엔티티 복원, 첨부 자리표시자 제거, 이미지는 [이미지]", () => {
    expect(teamsHtmlToText('<p>안녕 <at id="0">강승욱</at>님</p><p>두 번째 <b>줄</b><br>셋째</p>')).toBe("안녕 @강승욱님\n두 번째 줄\n셋째");
    expect(teamsHtmlToText("&lt;tag&gt; &amp; &quot;q&quot; &#39;s&#39;&nbsp;x")).toBe("<tag> & \"q\" 's' x");
    expect(teamsHtmlToText('<div>파일 보냅니다<attachment id="1"></attachment></div><div><img src="https://graph.microsoft.com/x" alt=""></div>')).toBe("파일 보냅니다\n[이미지]");
    expect(teamsHtmlToText('<a href="https://ex.com/a">문서</a> / <a href="https://ex.com/b">https://ex.com/b</a>')).toBe("문서 (https://ex.com/a) / https://ex.com/b");
    expect(teamsHtmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\nb");
  });
});

const raw = (over: Record<string, unknown>) => ({
  id: "1", messageType: "message", createdDateTime: "2026-10-03T12:00:00Z", lastModifiedDateTime: "2026-10-03T12:00:00Z", deletedDateTime: null,
  from: { user: { id: "aad-1", displayName: "강승욱" } }, body: { contentType: "html", content: "<p>hi</p>" }, attachments: [], ...over,
});

describe("normalizeChatMessages", () => {
  it("message만(시스템 이벤트·삭제 제외), 오래된 것부터, 본문은 텍스트, 봇은 application 이름", () => {
    const out = normalizeChatMessages({ value: [
      raw({ id: "3", createdDateTime: "2026-10-03T12:02:00Z", lastModifiedDateTime: "2026-10-03T12:02:00Z" }),
      raw({ id: "2", createdDateTime: "2026-10-03T12:01:00Z", messageType: "systemEventMessage" }),
      raw({ id: "4", createdDateTime: "2026-10-03T12:03:00Z", deletedDateTime: "2026-10-03T12:05:00Z" }),
      raw({ id: "1", body: { contentType: "text", content: "plain & text" }, attachments: [{ id: "a" }, { id: "b" }] }),
      raw({ id: "5", createdDateTime: "2026-10-03T12:04:00Z", from: { application: { id: "app-1", displayName: "알림봇" } } }),
    ] });
    expect(out.map((m) => m.id)).toEqual(["1", "3", "5"]);
    expect(out[0]).toEqual({ id: "1", createdAt: "2026-10-03T12:00:00Z", modifiedAt: "2026-10-03T12:00:00Z", from: { id: "aad-1", name: "강승욱" }, text: "plain & text", attachments: 2 });
    expect(out[1].text).toBe("hi");
    expect(out[2].from).toEqual({ id: "app-1", name: "알림봇" });
    expect(normalizeChatMessages({})).toEqual([]);
  });
});

describe("Graph 호출", () => {
  it("메시지 목록 URL — since가 있으면 lastModifiedDateTime 필터, 채팅 ID는 인코딩", () => {
    expect(chatMessagesUrl("19:abc@thread.v2")).toBe("https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.v2/messages?$top=50");
    expect(chatMessagesUrl("19:abc@thread.v2", "2026-10-03T12:00:00Z")).toBe("https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.v2/messages?$top=50&$filter=lastModifiedDateTime%20gt%202026-10-03T12%3A00%3A00Z");
  });
  it("listChatMessages — Bearer로 호출해 정규화하고, 403은 GraphError(403)", async () => {
    const fetchImpl = vi.fn(async () => json(200, { value: [raw({})] }));
    const out = await listChatMessages("AT", "19:x", undefined, fetchImpl as never);
    expect(out).toHaveLength(1);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer AT" });
    const denied = vi.fn(async () => json(403, { error: { code: "Forbidden", message: "Missing scope" } }));
    await expect(listChatMessages("AT", "19:x", undefined, denied as never)).rejects.toMatchObject({ status: 403, code: "Forbidden" });
  });
  it("sendChatMessage — text 본문으로 POST하고 만든 메시지를 정규화해 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => json(201, raw({ id: "9", body: { contentType: "text", content: "보냄" } })));
    const m = await sendChatMessage("AT", "19:x", "보냄", fetchImpl as never);
    expect(m.id).toBe("9");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/chats/19%3Ax/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: { contentType: "text", content: "보냄" } });
  });
  it("listMyChats — 내가 속한 그룹·1:1 채팅(모임 채팅 제외), 주제 없으면 나를 뺀 구성원 이름, 최근 활동 순", async () => {
    const fetchImpl = vi.fn(async () => json(200, { value: [
      { id: "19:a@thread.v2", chatType: "group", topic: null, webUrl: "https://teams/a", lastUpdatedDateTime: "2026-10-01T00:00:00Z", members: [{ userId: "me", displayName: "강승욱" }, { userId: "u2", displayName: "김민준" }, { userId: "u3", displayName: "이서연" }] },
      { id: "19:b@thread.v2", chatType: "group", topic: "개발팀 수다", webUrl: "https://teams/b", lastUpdatedDateTime: "2026-10-03T00:00:00Z", members: [{ userId: "me", displayName: "강승욱" }] },
      { id: "19:me_u2@unq.gbl.spaces", chatType: "oneOnOne", topic: null, webUrl: "https://teams/c", lastUpdatedDateTime: "2026-10-02T00:00:00Z", members: [{ userId: "me", displayName: "강승욱" }, { userId: "u2", displayName: "김민준" }] },
      { id: "19:meeting@thread.v2", chatType: "meeting", topic: "주간 회의", webUrl: null, lastUpdatedDateTime: "2026-10-04T00:00:00Z", members: [] },
    ] }));
    const out = await listMyChats("AT", "me", fetchImpl as never);
    const url = (fetchImpl.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("/me/chats?");
    expect(url).toContain("$expand=members&$top=50"); // 중첩 $select는 Graph가 400으로 거절(2026-10-03 운영 재현)
    expect(out).toEqual([
      { id: "19:b@thread.v2", type: "group", topic: "개발팀 수다", members: ["강승욱"], webUrl: "https://teams/b", lastUpdated: "2026-10-03T00:00:00Z" },
      { id: "19:me_u2@unq.gbl.spaces", type: "oneOnOne", topic: "김민준", members: ["강승욱", "김민준"], webUrl: "https://teams/c", lastUpdated: "2026-10-02T00:00:00Z" },
      { id: "19:a@thread.v2", type: "group", topic: "김민준, 이서연", members: ["강승욱", "김민준", "이서연"], webUrl: "https://teams/a", lastUpdated: "2026-10-01T00:00:00Z" },
    ]);
  });
  it("getChatInfo — 주제·webUrl", async () => {
    const fetchImpl = vi.fn(async () => json(200, { id: "19:a", topic: "개발팀", webUrl: "https://teams/a", chatType: "group" }));
    expect(await getChatInfo("AT", "19:a", fetchImpl as never)).toEqual({ id: "19:a", topic: "개발팀", webUrl: "https://teams/a" });
  });
});
