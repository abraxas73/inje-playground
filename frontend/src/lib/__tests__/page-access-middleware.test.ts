// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: true, role: "user", denied: {} as Record<string, boolean>, fail: false }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({
  auth: { getUser: async () => ({ data: { user: m.user ? { id: "self" } : null } }) },
  from: (_table: string) => ({ select: () => ({ eq: () => ({
    single: async () => ({ data: { role: m.role } }),
    maybeSingle: async () => ({ data: { permissions: m.denied }, error: m.fail ? { message: "offline" } : null }),
  }) }) }),
}) }));
vi.mock("@/lib/audit-proxy", () => ({ auditProxyRequest: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
import { updateSession } from "@/lib/supabase-middleware";
beforeEach(() => { m.user = true; m.role = "user"; m.denied = {}; m.fail = false; });
const visit = (path: string) => updateSession(new NextRequest(`https://app.test${path}`));
it("blocks direct pages and their APIs", async () => {
  m.denied = { people_news: false };
  expect((await visit("/people-news")).headers.get("location")).toBe("https://app.test/access-denied");
  expect((await visit("/api/people-news/email")).status).toBe(403);
});
it("does not allow errors to fail open", async () => {
  m.fail = true;
  expect((await visit("/api/people-news/email")).status).toBe(503);
});
it("does not require individual overrides for administrator access", async () => {
  m.role = "admin"; m.denied = { people_news: false }; m.fail = true;
  expect((await visit("/api/people-news/email")).status).toBe(200);
});
it("rejects anonymous feature API calls but preserves public shares and surveys", async () => {
  m.user = false;
  expect((await visit("/api/people-news/email")).status).toBe(401);
  expect((await visit("/api/rfp/shared/token")).status).toBe(200);
  expect((await visit("/rfp/shared/token")).status).toBe(200);
  expect((await visit("/api/surveys/public")).status).toBe(200);
});
it("blocks an authenticated restricted survey user", async () => {
  m.denied = { survey: false };
  expect((await visit("/api/surveys/public")).status).toBe(403);
});
it("handles shared usage APIs using any allowed consuming page", async () => {
  m.denied = { usage_code: false, usage_chat: false };
  expect((await visit("/api/usage/scope")).status).toBe(200);
  m.denied.usage_perf = false;
  expect((await visit("/api/usage/scope")).status).toBe(403);
});
