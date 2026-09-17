// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const m = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/people-news/auth", () => ({ requireNewsUser: m.auth }));
import { GET, POST } from "@/app/api/people-news/email/route";

const req = (query = "") => new NextRequest(`https://app.test/api/people-news/email${query}`, { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.test";
  vi.stubGlobal("fetch", m.fetch);
  m.auth.mockResolvedValue({ ok: true, user: { id: "self", email: "self@example.test", email_confirmed_at: "2026-01-01" }, supabase: { auth: { getSession: m.session } } });
  m.session.mockResolvedValue({ data: { session: { access_token: "jwt-1" } } });
  m.fetch.mockResolvedValue(Response.json({ count: 3, from: "2026-09-10T00:00:00Z", to: "2026-09-11T00:00:00Z" }));
});
afterEach(() => vi.unstubAllGlobals());

function edgeCall() {
  expect(m.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = m.fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://proj.supabase.test/functions/v1/yonhap-notices");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
  return JSON.parse(String(init.body)) as { action: string };
}

it("GET asks the Edge Function for a read-only preview with the caller's session", async () => {
  m.fetch.mockResolvedValue(Response.json({ subject: "digest", html: "<p>News</p>", text: "News", count: 3, from: "a", to: "b" }));
  const response = await GET(req());
  expect(response.status).toBe(200);
  expect((await response.json()).html).toBe("<p>News</p>");
  expect(edgeCall().action).toBe("preview");
});

it("POST asks the Edge Function to send now and relays its result", async () => {
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ count: 3 });
  expect(edgeCall().action).toBe("send-now");
});

it("relays cooldown and failure statuses including Retry-After", async () => {
  m.fetch.mockResolvedValue(Response.json({ error: "1분 후 다시 수신할 수 있습니다." }, { status: 429, headers: { "Retry-After": "60" } }));
  const cooldown = await POST(req());
  expect(cooldown.status).toBe(429);
  expect(cooldown.headers.get("Retry-After")).toBe("60");
  m.fetch.mockResolvedValue(Response.json({ error: "메일 발송을 확인하지 못했습니다." }, { status: 502 }));
  expect((await POST(req())).status).toBe(502);
});

it.each([401, 403])("rejects unauthorized access (%s) without calling the Edge Function", async (status) => {
  m.auth.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status }) });
  expect((await POST(req())).status).toBe(status);
  expect((await GET(req())).status).toBe(status);
  expect(m.fetch).not.toHaveBeenCalled();
});

it("requires a verified email before sending", async () => {
  m.auth.mockResolvedValue({ ok: true, user: { id: "self", email: "self@example.test", email_confirmed_at: null }, supabase: { auth: { getSession: m.session } } });
  expect((await POST(req())).status).toBe(400);
  expect(m.fetch).not.toHaveBeenCalled();
});

it("answers 401 when the session token is missing", async () => {
  m.session.mockResolvedValue({ data: { session: null } });
  expect((await POST(req())).status).toBe(401);
  expect(m.fetch).not.toHaveBeenCalled();
});

it("answers 502 when the Edge Function is unreachable", async () => {
  m.fetch.mockRejectedValue(new Error("timeout"));
  const response = await POST(req());
  expect(response.status).toBe(502);
  expect((await response.json()).error).toContain("메일 발송을 확인하지 못했습니다");
});

it("이전 발송 내역 제외 값을 Edge Function 본문으로 넘기고, 없으면 보내지 않는다", async () => {
  await POST(req("?excludeSent=1"));
  expect(JSON.parse(String((m.fetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ action: "send-now", excludeSent: true });
  m.fetch.mockClear();
  await POST(req("?excludeSent=0"));
  expect(JSON.parse(String((m.fetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ action: "send-now", excludeSent: false });
  m.fetch.mockClear();
  await POST(req());
  expect(JSON.parse(String((m.fetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ action: "send-now" });
  m.fetch.mockClear();
  await GET(req("?excludeSent=1"));
  expect(JSON.parse(String((m.fetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ action: "preview", excludeSent: true });
});

it("보낼 것이 없어 건너뛴 응답을 그대로 전달한다", async () => {
  m.fetch.mockResolvedValue(Response.json({ count: 0, skipped: true }));
  const response = await POST(req("?excludeSent=1"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ count: 0, skipped: true });
});
