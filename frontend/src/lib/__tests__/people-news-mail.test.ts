// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { sendUserDigest } from "@/lib/people-news/mail";
import { buildDigest } from "@/lib/people-news/digest";
import { buildAuthorizeUrl, refreshAccessToken } from "@/lib/ms/oauth";

const digest = { subject: "인사·부고", html: "<p>소식</p>", text: "소식" };
describe("personal Microsoft email", () => {
  it("checks the mailbox and sends only to that same address", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ mail: "User@example.test" })).mockResolvedValueOnce(new Response(null, { status: 202, headers: { "request-id": "id-1" } }));
    expect(await sendUserDigest("token", "user@example.test", digest, fetcher)).toBe("id-1");
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "user@example.test" } }]);
    expect(body.message.from).toBeUndefined();
    expect(fetcher.mock.calls[1][0]).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
  });
  it("never sends from a different linked mailbox", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ mail: "other@example.test", userPrincipalName: "user@example.test" }));
    await expect(sendUserDigest("token", "user@example.test", digest, fetcher)).rejects.toThrow("발신 계정이 다릅니다");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("sanitizes Graph errors without returning their body", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ mail: "user@example.test" })).mockResolvedValueOnce(Response.json({ error: "secret detail" }, { status: 403 }));
    await expect(sendUserDigest("token", "user@example.test", digest, fetcher)).rejects.toThrow("발송 실패 (403)");
  });
  it("requests Mail.Send only on the mail connection flow and refresh", async () => {
    const params = { tenantId: "tenant", clientId: "client", redirectUri: "https://app.test/callback", state: "state" };
    expect(new URL(buildAuthorizeUrl(params)).searchParams.get("scope")).not.toContain("Mail.Send");
    expect(new URL(buildAuthorizeUrl({ ...params, mail: true })).searchParams.get("scope")).toContain("Mail.Send");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: "token" }));
    await refreshAccessToken({ tenantId: "t", clientId: "c", clientSecret: "s" }, "refresh", fetcher, true);
    expect(new URLSearchParams(fetcher.mock.calls[0][1].body).get("scope")).toContain("Mail.Send");
  });
  it("escapes article HTML and rejects unsafe source links", () => {
    const result = buildDigest([{ title: "<img onerror=x>", summary: "<script>x</script>", source_url: "javascript:x", published_at: "2026-09-11T00:00:00Z" }], 1, "2026-09-11T00:00:00Z", null, "https://app.test");
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).toContain("수신 해제");
  });
});
