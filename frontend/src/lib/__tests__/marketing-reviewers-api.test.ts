// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/marketing/server", async original => ({ ...await original<typeof import("@/lib/marketing/server")>(), marketingAuth: m.auth }));
import { GET, POST } from "@/app/api/marketing/reviewers/route";
import { MarketingError } from "@/lib/marketing/server";
const valid = { userId: "a4e1906d-b915-4e00-9b4e-657beeb396ae", enabled: false, version: "a".repeat(32) };
const post = (body: unknown) => POST(new NextRequest("https://test/api", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { m.rpc.mockReset(); m.auth.mockReset(); m.auth.mockResolvedValue({ reviewerManager: true, db: { rpc: m.rpc } }); });
it("serves a paginated roster through the user's session", async () => {
 m.rpc.mockResolvedValue({ data: { rows: [], history: [], canManage: false } }); const result = await GET(new NextRequest("https://test/api?page=2.5"));
 expect(result.status).toBe(200); expect(m.rpc).toHaveBeenCalledWith("marketing_reviewer_directory", { p_page: 2 }); expect(m.auth).toHaveBeenCalledWith();
});
it("requires a reviewer manager and passes the exact selected account and version", async () => {
 m.rpc.mockResolvedValue({ data: { changed: true } }); const result = await post(valid);
 expect(m.auth).toHaveBeenCalledWith(); expect(m.rpc).toHaveBeenCalledWith("marketing_update_reviewer", { p_user: valid.userId, p_enabled: false, p_version: valid.version }); expect(await result.json()).toEqual({ changed: true });
});
it("rejects invalid or stale requests and propagates authorization failures", async () => {
 for (const b of [{ email: "someone@example.com", enabled: true }, { ...valid, userId: "invalid" }, { ...valid, enabled: "true" }, { ...valid, version: "" }]) expect((await post(b)).status).toBe(400);
 expect(m.rpc).not.toHaveBeenCalled(); m.rpc.mockResolvedValue({ error: { code: "40001", message: "변경됨" } }); expect((await post(valid)).status).toBe(409);
 m.rpc.mockReset(); m.auth.mockRejectedValue(new MarketingError("권한 없음", 403)); expect((await post(valid)).status).toBe(403); expect((await GET(new NextRequest("https://test/api"))).status).toBe(403); expect(m.rpc).not.toHaveBeenCalled();
});

it("blocks candidate search and all privilege changes for an ordinary reviewer", async () => {
 m.auth.mockResolvedValue({ reviewerManager: false, db: { rpc: m.rpc } });
 expect((await GET(new NextRequest("https://test/api?q=person"))).status).toBe(403); expect((await post(valid)).status).toBe(403); expect(m.rpc).not.toHaveBeenCalled();
});
it("searches registered candidates with the manager's session", async () => {
 m.rpc.mockResolvedValue({ data: { rows: [], total: 0 } }); const result = await GET(new NextRequest("https://test/api?q=person&page=2"));
 expect(result.status).toBe(200); expect(m.rpc).toHaveBeenCalledWith("marketing_reviewer_candidates", { p_q: "person", p_page: 2 });
});
