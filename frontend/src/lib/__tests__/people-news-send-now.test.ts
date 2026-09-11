// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), load: vi.fn(), send: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/people-news/auth", () => ({ requireNewsUser: m.auth }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/people-news/load-digest", () => ({ digestAppUrl: () => "https://app.test", loadDigest: m.load }));
vi.mock("@/lib/ms/config", () => ({ loadMsConfig: async () => ({ ok: true, config: { app: {}, encKey: "key" } }) }));
vi.mock("@/lib/ms/connections", () => ({ getAccessTokenForUser: m.token }));
vi.mock("@/lib/people-news/mail", () => ({ sendUserDigest: m.send }));
import { GET, POST } from "@/app/api/people-news/email/route";

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ ok: true, user: { id: "self", email: "self@example.test", email_confirmed_at: "2026-01-01" }, supabase: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: [{ delivery_id: "manual", period_from: "2026-09-10T00:00:00Z", period_to: "2026-09-11T00:00:00Z" }] });
  m.from.mockReturnValue({ update: m.update });
  m.update.mockReturnValue({ eq: m.eq });
  m.eq.mockResolvedValue({ error: null });
  m.load.mockResolvedValue({ digest: { subject: "digest", html: "<p>News</p>", text: "News" }, count: 3 });
  m.token.mockResolvedValue("access");
  m.send.mockResolvedValue("provider-id");
});

it("previews the latest 24 hours without sending or reserving a delivery", async () => {
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(Date.parse(body.to) - Date.parse(body.from)).toBe(86_400_000);
  expect(body.html).toBe("<p>News</p>");
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});

it("sends to the verified caller and records only a manual delivery", async () => {
  expect((await POST()).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("claim_yonhap_notice_send_now");
  expect(m.send).toHaveBeenCalledWith("access", "self@example.test", expect.objectContaining({ subject: "digest" }));
  expect(m.from).toHaveBeenCalledTimes(1);
  expect(m.from).toHaveBeenCalledWith("yonhap_notice_manual_deliveries");
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", item_count: 3 }));
});

it.each([401, 403])("rejects unauthorized access (%s) without sending", async (status) => {
  m.auth.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status }) });
  expect((await POST()).status).toBe(status);
  expect((await GET()).status).toBe(status);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});

it("requires a verified email", async () => {
  m.auth.mockResolvedValue({ ok: true, user: { email: "self@example.test" } });
  expect((await POST()).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("requires Microsoft mail consent", async () => {
  m.rpc.mockResolvedValue({ error: { code: "55000" } });
  expect((await POST()).status).toBe(409);
  expect(m.send).not.toHaveBeenCalled();
});

it("enforces the server cooldown before sending", async () => {
  m.rpc.mockResolvedValue({ data: [] });
  const response = await POST();
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(m.send).not.toHaveBeenCalled();
});

it("records a failed manual send without advancing scheduled deliveries", async () => {
  m.send.mockRejectedValue(new Error("Graph unavailable"));
  expect((await POST()).status).toBe(502);
  expect(m.from).toHaveBeenCalledWith("yonhap_notice_manual_deliveries");
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
});
