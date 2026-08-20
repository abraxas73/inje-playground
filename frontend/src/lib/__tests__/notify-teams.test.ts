import { describe, it, expect, vi } from "vitest";
import { createTeamsNotifier, toTeamsHtml } from "@/lib/notify/teams";

function mockRes(status: number, body = ""): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => ({}) } as unknown as Response;
}

describe("toTeamsHtml", () => {
  it("마크다운 굵게/줄바꿈을 HTML로, 특수문자는 이스케이프", () => {
    expect(toTeamsHtml("**1팀** (2명): A, B\n<x> & y")).toBe("<b>1팀</b> (2명): A, B<br>&lt;x&gt; &amp; y");
  });
});

describe("createTeamsNotifier.sendChannel", () => {
  it("채널 웹훅에 {title,text,html} POST, 202도 성공", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(202));
    const n = createTeamsNotifier({ notifyWebhookUrl: "https://prod.westus.logic.azure.com/wf1" }, fetchImpl);
    expect(n.provider).toBe("teams");
    expect(n.channelConfigured).toBe(true);
    expect(n.directConfigured).toBe(false);

    expect(await n.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: "**1팀**\nA" })).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://prod.westus.logic.azure.com/wf1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "팀 구성 결과", text: "**1팀**\nA", html: "<b>1팀</b><br>A" }),
    });
  });

  it("미설정 → not_configured, 실패 응답/예외 → ok:false", async () => {
    const fetchImpl = vi.fn();
    expect(await createTeamsNotifier({}, fetchImpl).sendChannel({ title: "t", text: "x" })).toEqual({ ok: false, error: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await createTeamsNotifier({ notifyWebhookUrl: "https://w" }, vi.fn().mockResolvedValue(mockRes(401, "denied"))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "teams hook: 401 denied" });
    expect(
      await createTeamsNotifier({ notifyWebhookUrl: "https://w" }, vi.fn().mockRejectedValue(new Error("boom"))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "teams hook exception: boom" });
  });
});

describe("createTeamsNotifier.sendDirect", () => {
  it("DM 웹훅에 {recipientEmail,text,html} POST — 이메일 기준", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(202));
    const n = createTeamsNotifier({ dmWebhookUrl: "https://w/dm" }, fetchImpl);
    expect(n.directConfigured).toBe(true);
    expect(await n.sendDirect({ email: " user@innogrid.com ", memberId: "ignored" }, { text: "hi" })).toEqual({ ok: true });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ recipientEmail: "user@innogrid.com", text: "hi", html: "hi" });
  });

  it("이메일 없는 수신자는 호출 없이 오류", async () => {
    const fetchImpl = vi.fn();
    expect(await createTeamsNotifier({ dmWebhookUrl: "https://w/dm" }, fetchImpl).sendDirect({ memberId: "m1", name: "홍길동" }, { text: "hi" })).toEqual({
      ok: false,
      error: "dm(홍길동): 이메일 없음 — Teams DM은 이메일 기준",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("실패 응답/예외 포맷", async () => {
    expect(
      await createTeamsNotifier({ dmWebhookUrl: "https://w" }, vi.fn().mockResolvedValue(mockRes(500, "err"))).sendDirect({ email: "a@b.c" }, { text: "x" })
    ).toEqual({ ok: false, error: "dm(a@b.c): 500 err" });
    expect(
      await createTeamsNotifier({ dmWebhookUrl: "https://w" }, vi.fn().mockRejectedValue(new Error("net"))).sendDirect({ email: "a@b.c" }, { text: "x" })
    ).toEqual({ ok: false, error: "exception(a@b.c): net" });
  });
});
