// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { dayRange, DoorayError, events, doorayRequest, mailActivity, overview, verifyMember, type DoorayRequest } from "@/lib/dooray/client";

const envelope = (result: unknown, cursor?: string) => ({ header: { isSuccessful: true }, result, cursor });
const mail = (id: string) => ({ type: "mail", mail: { id, subject: "제목", sentAt: "2026-10-11T09:00:00+09:00", users: { from: { emailUser: { name: "보낸 사람" } } }, body: { mimeType: "text/plain", content: "private body" } } });
describe("Dooray API trust boundaries", () => {
  it("uses the fixed host, private fetch and never forwards credentials on redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(envelope([])));
    const request = doorayRequest("secret", undefined, fetcher);
    await request("/common/v1/members/me");
    expect(fetcher).toHaveBeenCalledWith("https://api.dooray.com/common/v1/members/me", expect.objectContaining({ redirect: "error", cache: "no-store", headers: { Authorization: "dooray-api secret" } }));
    await expect(request("https://evil.invalid/common/v1/members/me")).rejects.toMatchObject({ status: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([[401, 409, "reconnect"], [403, 403, "forbidden"], [404, 502, "not_found"], [429, 429, "rate_limit"], [500, 502, "upstream"]])("sanitizes upstream %s errors", async (upstream, status, code) => {
    const request = doorayRequest("secret", undefined, vi.fn().mockResolvedValue(new Response("private error", { status: upstream })));
    await expect(request("/common/v1/members/me")).rejects.toMatchObject({ status, code });
  });
  it("rejects unsuccessful HTTP-200 envelopes and non-JSON without disclosing response bodies", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ header: { isSuccessful: false, resultMessage: "secret" }, result: [] })).mockResolvedValueOnce(new Response("secret"));
    const request = doorayRequest("secret", undefined, fetcher);
    await expect(request("/common/v1/members/me")).rejects.toThrow("Dooray 조회에 실패했습니다.");
    await expect(request("/common/v1/members/me")).rejects.toThrow("Dooray 응답을 해석하지 못했습니다.");
  });
  it("validates the independent Dooray account and company organization", () => {
    const member = { id: "10", name: "이름", externalEmailAddress: "me@injeinc.co.kr", defaultOrganization: { id: "20" } };
    expect(verifyMember(member, "20").id).toBe("10");
    expect(() => verifyMember({ ...member, id: "" }, "20")).toThrow("회사 Dooray 조직");
    expect(() => verifyMember(member, "30")).toThrow("회사 Dooray 조직");
  });
});
describe("Dooray read models", () => {
  it("returns bounded plain-text previews only when requested, never HTML", async () => {
    const plain = mail("1"); plain.mail.body.content = "a".repeat(250);
    const html = mail("2"); html.mail.body.mimeType = "text/html";
    const request = vi.fn().mockResolvedValue(envelope([plain, html]));
    const result = await mailActivity(request, true);
    expect(result.items[0].preview).toHaveLength(200);
    expect(result.items[1]).not.toHaveProperty("preview");
  });
  it("uses KST date boundaries and rejects normalized invalid dates", () => {
    expect(dayRange("2026-10-11")).toEqual({ timeMin: "2026-10-10T15:00:00.000Z", timeMax: "2026-10-11T15:00:00.000Z" });
    expect(() => dayRange("2026-02-30")).toThrow();
    expect(() => dayRange("2026-1-1")).toThrow();
  });
  it("follows cursors after a short page, deduplicates mail and strips body", async () => {
    const request = vi.fn().mockResolvedValueOnce(envelope([mail("1")], "1781768002000000000")).mockResolvedValueOnce(envelope([mail("1"), mail("2")], "1781768001000000000")).mockResolvedValueOnce(envelope([]));
    const result = await mailActivity(request);
    expect(result.partial).toBe(false);
    expect(result.items.map(x => x.id)).toEqual(["1", "2"]);
    expect(JSON.stringify(result)).not.toContain("private body");
    expect(request.mock.calls[1][0]).toContain("before=1781768002000000000");
  });
  it("bounds repeated/non-mail feed pages without claiming a complete inbox", async () => {
    const request = vi.fn().mockResolvedValue(envelope([{ type: "project" }], "cursor"));
    expect(await mailActivity(request)).toEqual({ items: [], partial: true });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("isolates mail failure and skips channel fetching for briefing", async () => {
    const request: DoorayRequest = vi.fn(async path => {
      if (path === "/calendar/v1/calendars") return envelope([{id: "2", name: "개인", type: "private"}]);
      if (path.startsWith("/calendar/")) return envelope([{ id: "1", calendar: { id: "2" }, subject: "회의", startedAt: "2026-10-11T09:00:00+09:00", endedAt: "2026-10-11T10:00:00+09:00", wholeDayFlag: false, body: "private" }]);
      throw new Error("private network error");
    });
    const result = await overview(request, "2026-10-11", true);
    expect(result.events.items).toHaveLength(1);
    expect(result.mail).toMatchObject({ items: [], error: "조회하지 못했습니다. 다시 시도해 주세요." });
    expect(result.channels.items).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe("calendar selection", () => {
  const calendars = [{ id: "1", name: "개인", type: "private" }, { id: "2", name: "팀", type: "project" }, { id: "3", name: "구독", type: "subscription" }];
  it("queries only listed non-subscription calendar IDs and preserves KST boundaries", async () => {
    const request = vi.fn().mockResolvedValueOnce(envelope(calendars)).mockResolvedValueOnce(envelope([]));
    expect((await events(request, "2026-10-11")).calendars).toHaveLength(2);
    const url = new URL(request.mock.calls[1][0], "https://api.dooray.com");
    expect(url.searchParams.get("calendars")).toBe("1,2");
    expect(url.searchParams.get("timeMin")).toBe("2026-10-10T15:00:00.000Z");
  });
  it("filters a selected calendar and rejects IDs outside the user's list", async () => {
    const request = vi.fn().mockResolvedValueOnce(envelope(calendars)).mockResolvedValueOnce(envelope([]));
    await events(request, "2026-10-11", "2");
    expect(new URL(request.mock.calls[1][0], "https://api.dooray.com").searchParams.get("calendars")).toBe("2");
    const denied = vi.fn().mockResolvedValue(envelope(calendars));
    await expect(events(denied, "2026-10-11", "99")).rejects.toMatchObject({code: "input"});
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it("retains calendar choices on 403 without turning failure into an empty success", async () => {
    const request = vi.fn().mockResolvedValueOnce(envelope(calendars)).mockRejectedValueOnce(new DoorayError("접근 거부", 403));
    expect(await events(request, "2026-10-11")).toMatchObject({ calendars: [{id:"1"}, {id:"2"}], items: [], error: "접근 거부" });
  });
  it("does not query wildcard events if there are no supported calendars", async () => {
    const request = vi.fn().mockResolvedValue(envelope([calendars[2]]));
    expect(await events(request, "2026-10-11")).toEqual({items: [], calendars: []});
    expect(request).toHaveBeenCalledTimes(1);
  });
});

it("app-owned calendars never invoke the personal-token calendar API", async () => {
  const request = vi.fn().mockResolvedValue({ header: { isSuccessful: true }, result: [] });
  const result = await overview(request, "2026-10-11", true, undefined, false);
  expect(result.events.items).toEqual([]);
  expect(request.mock.calls.every(([path]) => !path.startsWith("/calendar/"))).toBe(true);
});
