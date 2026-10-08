// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ signedIn: true, insert: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: state.signedIn ? { id: "actor", email: "actor@example.com" } : null } }) },
  from: () => ({ insert: state.insert }),
}) }));
import { POST } from "@/app/api/page-views/route";
const request = (path: string) => new NextRequest("https://app.test/api/page-views", {
  method: "POST", headers: { "content-type": "application/json", "user-agent": "InnogridApp/1.4.5 (windows) InnogridBuild/30" },
  body: JSON.stringify({ path, userId: "forged" }),
});
beforeEach(() => { state.signedIn = true; state.insert.mockClear(); });
it("stores actual actor and platform UA without query secrets", async () => {
  expect((await POST(request('/settings?token=secret'))).status).toBe(200);
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({
    user_id: "actor", category: "page", action: "페이지 접근 /settings",
    detail: {path: "/settings"}, user_agent: "InnogridApp/1.4.5 (windows) InnogridBuild/30",
  }));
});
it("does not store unauthenticated or anonymous survey navigation", async () => {
  await POST(request('/survey/example'));
  state.signedIn = false;
  await POST(request('/settings'));
  expect(state.insert).not.toHaveBeenCalled();
});
