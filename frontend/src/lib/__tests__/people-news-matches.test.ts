// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  user: { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" } as { id: string; email: string; email_confirmed_at: string | null } | null,
  role: "user", rpc: vi.fn(), matchesQueried: [] as string[],
}));
const notices = [
  { source_id: "AKR1", category: "obituary", title: "[부고] a", summary: "", source_url: "https://www.yna.co.kr/view/AKR1", published_at: "2026-09-15T00:00:00Z" },
  { source_id: "AKR2", category: "personnel", title: "[인사] b", summary: "", source_url: "https://www.yna.co.kr/view/AKR2", published_at: "2026-09-15T00:00:00Z" },
];
function table(name: string) {
  const q: Record<string, unknown> = {};
  const rows = name === "yonhap_notices" ? notices : name === "media_obituary_matches" ? [{ source_id: "AKR1", matched_text: "중앙일보 / 테크부" }, { source_id: "AKR1", matched_text: "중앙일보 / 산업부" }] : name === "media_alert_subscriptions" ? [{ enabled: true, updated_at: "2026-09-15T01:00:00Z" }] : [];
  for (const m of ["select", "order", "eq", "gte", "lt", "ilike", "limit"]) q[m] = () => q;
  q.in = (_col: string, ids: string[]) => { if (name === "media_obituary_matches") mock.matchesQueried = ids; return q; };
  q.range = async () => ({ data: rows, count: rows.length, error: null });
  q.single = async () => ({ data: { role: mock.role }, error: null });
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return q;
}
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: mock.user } }) }, from: table, rpc: mock.rpc }) }));
import { GET as listNotices } from "@/app/api/people-news/route";
import { GET as getAlerts, PUT as putAlerts } from "@/app/api/people-news/media-alerts/route";

beforeEach(() => { mock.user = { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" }; mock.role = "user"; mock.matchesQueried = []; mock.rpc.mockReset().mockResolvedValue({ data: { enabled: false, updated_at: "2026-09-15T02:00:00Z" }, error: null }); });

describe("people-news list matches", () => {
  it("attaches matched media labels to obituaries on the page only", async () => {
    const body = await (await listNotices(new NextRequest("https://app.test/api/people-news"))).json();
    expect(mock.matchesQueried).toEqual(["AKR1"]);
    expect(body.matches).toEqual({ AKR1: ["중앙일보 / 테크부", "중앙일보 / 산업부"] });
  });
});
describe("media alert subscription", () => {
  it("returns settings with the caller's email and latest delivery", async () => {
    const body = await (await getAlerts()).json();
    expect(body).toMatchObject({ email: "u@example.test", emailVerified: true, enabled: true, updatedAt: "2026-09-15T01:00:00Z", latestDelivery: null });
  });
  it("saves through the RPC and ignores other fields", async () => {
    const response = await putAlerts(new NextRequest("https://app.test/api/people-news/media-alerts", { method: "PUT", body: JSON.stringify({ enabled: false, userId: "other" }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("set_media_alert_subscription", { p_enabled: false });
  });
  it("blocks unverified enable, guests and malformed bodies", async () => {
    const put = (body: unknown) => putAlerts(new NextRequest("https://app.test/api/people-news/media-alerts", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
    mock.user!.email_confirmed_at = null;
    expect((await put({ enabled: true })).status).toBe(400);
    expect((await put({ enabled: "yes" })).status).toBe(400);
    mock.role = "guest";
    expect((await put({ enabled: true })).status).toBe(403);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }); mock.role = "user"; mock.user!.email_confirmed_at = "2026-09-01T00:00:00Z";
    expect((await put({ enabled: true })).status).toBe(403);
  });
});
