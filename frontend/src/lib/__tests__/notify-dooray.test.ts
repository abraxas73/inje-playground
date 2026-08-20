import { describe, it, expect, vi } from "vitest";
import { createDoorayNotifier, DOORAY_BOT_ICON } from "@/lib/notify/dooray";

function mockRes(status: number, body = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => (body ? JSON.parse(body) : {}),
  } as unknown as Response;
}

describe("createDoorayNotifier.sendChannel", () => {
  it("Incoming Hook에 기존 페이로드 그대로 POST (botName = botName ?? title)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(200));
    const n = createDoorayNotifier({ hookUrl: "https://hook.dooray.com/x" }, fetchImpl);
    expect(n.provider).toBe("dooray");
    expect(n.channelConfigured).toBe(true);

    const r = await n.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: "hello" });
    expect(r).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://hook.dooray.com/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botName: "팀봇", botIconImage: DOORAY_BOT_ICON, text: "hello" }),
    });
  });

  it("botName 없으면 title을 botName으로 사용", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(200));
    await createDoorayNotifier({ hookUrl: "https://h" }, fetchImpl).sendChannel({ title: "점심봇", text: "t" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).botName).toBe("점심봇");
  });

  it("hookUrl 미설정 → 호출 없이 not_configured", async () => {
    const fetchImpl = vi.fn();
    const n = createDoorayNotifier({}, fetchImpl);
    expect(n.channelConfigured).toBe(false);
    expect(await n.sendChannel({ title: "t", text: "x" })).toEqual({ ok: false, error: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("비정상 응답/예외는 ok:false로 삼킨다", async () => {
    expect(
      await createDoorayNotifier({ hookUrl: "https://h" }, vi.fn().mockResolvedValue(mockRes(500))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "hook: 500" });
    expect(
      await createDoorayNotifier({ hookUrl: "https://h" }, vi.fn().mockRejectedValue(new Error("boom"))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "hook exception: boom" });
  });
});

describe("createDoorayNotifier.sendDirect", () => {
  it("direct-send에 기존 페이로드·헤더 그대로 POST", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(200));
    const n = createDoorayNotifier({ token: "tok" }, fetchImpl);
    expect(n.directConfigured).toBe(true);

    const r = await n.sendDirect({ memberId: "m1", email: "ignored@x.com" }, { text: "hi" });
    expect(r).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.dooray.com/messenger/v1/channels/direct-send", {
      method: "POST",
      headers: { Authorization: "dooray-api tok", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi", organizationMemberId: "m1" }),
    });
  });

  it("오류 문자열 포맷은 기존과 동일", async () => {
    const n = createDoorayNotifier({ token: "tok" }, vi.fn().mockResolvedValue(mockRes(403, "forbidden")));
    expect(await n.sendDirect({ memberId: "m1" }, { text: "hi" })).toEqual({ ok: false, error: "dm(m1): 403 forbidden" });

    const n2 = createDoorayNotifier({ token: "tok" }, vi.fn().mockRejectedValue(new Error("net")));
    expect(await n2.sendDirect({ memberId: "m1" }, { text: "hi" })).toEqual({ ok: false, error: "exception(m1): net" });
  });

  it("토큰 없음 → not_configured, memberId 없음 → 설명 오류", async () => {
    const fetchImpl = vi.fn();
    expect(await createDoorayNotifier({}, fetchImpl).sendDirect({ memberId: "m1" }, { text: "x" })).toEqual({ ok: false, error: "not_configured" });
    expect(await createDoorayNotifier({ token: "t" }, fetchImpl).sendDirect({ email: "a@b.c", name: "홍길동" }, { text: "x" })).toEqual({
      ok: false,
      error: "dm(홍길동): Dooray 멤버 ID 없음",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
