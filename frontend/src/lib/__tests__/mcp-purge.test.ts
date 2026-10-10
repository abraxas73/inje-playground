// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ from: vi.fn(), lt: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
import { GET } from "@/app/api/cron/mcp-purge/route";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); m.from.mockReset(); m.lt.mockReset(); });

it("deletes rows older than 10 minutes with the cron secret", async () => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T00:10:00Z"));
  const select = vi.fn().mockResolvedValue({ data: [{ id: "a" }, { id: "b" }], error: null });
  m.lt.mockReturnValue({ select });
  m.from.mockReturnValue({ delete: () => ({ lt: m.lt }) });
  const r = await GET(new NextRequest("https://test/api/cron/mcp-purge", { headers: { authorization: "Bearer s3cret" } }));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ deleted: 2 });
  expect(m.from).toHaveBeenCalledWith("mcp_calls");
  expect(m.lt).toHaveBeenCalledTimes(1);
  expect(m.lt).toHaveBeenCalledWith("created_at", "2026-10-10T00:00:00.000Z");
  expect(select).toHaveBeenCalledWith("id");
});

it("rejects a wrong or missing secret", async () => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  expect((await GET(new NextRequest("https://test/api/cron/mcp-purge", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  expect((await GET(new NextRequest("https://test/api/cron/mcp-purge"))).status).toBe(401);
  expect(m.from).not.toHaveBeenCalled();
});
