import { describe, it, expect, vi } from "vitest";
import { createTeamsNotifier, toAdaptiveText, buildTeamsCardPayload } from "@/lib/notify/teams";

function mockRes(status: number, body = ""): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => ({}) } as unknown as Response;
}

describe("toAdaptiveText", () => {
  it("줄바꿈을 Adaptive Card 단락(\\n\\n)으로, 3개 이상 연속은 2개로, 마크다운 굵게는 유지", () => {
    expect(toAdaptiveText("a\nb")).toBe("a\n\nb");
    expect(toAdaptiveText("a\n\nb")).toBe("a\n\nb");
    expect(toAdaptiveText("a\n\n\n\nb")).toBe("a\n\nb");
    expect(toAdaptiveText("**굵게** 유지")).toBe("**굵게** 유지");
  });
});

describe("buildTeamsCardPayload", () => {
  it("채널: Teams 웹후크 트리거 스키마(type=message, attachments[0]=adaptive card) + body=[제목, 본문]", () => {
    const p = buildTeamsCardPayload({ title: "팀 구성 결과", text: "**1팀**\nA" });
    expect(p.type).toBe("message");
    expect(p.attachments).toHaveLength(1);
    const att = p.attachments[0];
    expect(att.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(att.contentUrl).toBeNull();
    expect(att.content.type).toBe("AdaptiveCard");
    expect(att.content.version).toBe("1.4");
    expect(att.content.body).toEqual([
      { type: "TextBlock", text: "팀 구성 결과", weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text: "**1팀**\n\nA", wrap: true },
    ]);
  });

  it("recipientEmail은 title과 함께 주어져도 항상 body[0] (흐름 식의 고정 위치 불변)", () => {
    const p = buildTeamsCardPayload({ title: "제목", recipientEmail: "u@innogrid.com", text: "hi" });
    expect(p.attachments[0].content.body[0]).toEqual({ type: "TextBlock", id: "recipientEmail", text: "u@innogrid.com", isVisible: false });
    expect(p.attachments[0].content.body).toHaveLength(3);
  });

  it("DM: body[0]=숨김 수신자 이메일(id=recipientEmail), body[1]=본문 — 흐름이 식으로 읽는 고정 위치", () => {
    const p = buildTeamsCardPayload({ recipientEmail: "u@innogrid.com", text: "hi" });
    expect(p.attachments[0].content.body).toEqual([
      { type: "TextBlock", id: "recipientEmail", text: "u@innogrid.com", isVisible: false },
      { type: "TextBlock", text: "hi", wrap: true },
    ]);
  });
});

describe("createTeamsNotifier.sendChannel", () => {
  it("채널 웹후크에 Adaptive Card 봉투를 JSON POST, 202도 성공", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(202));
    const n = createTeamsNotifier({ notifyWebhookUrl: "https://prod.westus.logic.azure.com/wf1" }, fetchImpl);
    expect(n.provider).toBe("teams");
    expect(n.channelConfigured).toBe(true);
    expect(n.directConfigured).toBe(false);

    expect(await n.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: "**1팀**\nA" })).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://prod.westus.logic.azure.com/wf1");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual(buildTeamsCardPayload({ title: "팀 구성 결과", text: "**1팀**\nA" }));
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
  it("DM 웹후크에 수신자 숨김 필드가 든 Adaptive Card 봉투 POST — 이메일 기준(trim)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(202));
    const n = createTeamsNotifier({ dmWebhookUrl: "https://w/dm" }, fetchImpl);
    expect(n.directConfigured).toBe(true);
    expect(await n.sendDirect({ email: " user@innogrid.com ", memberId: "ignored" }, { text: "hi" })).toEqual({ ok: true });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(
      buildTeamsCardPayload({ recipientEmail: "user@innogrid.com", text: "hi" })
    );
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
