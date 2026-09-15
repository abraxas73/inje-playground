// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  user: { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" } as { id: string; email: string; email_confirmed_at: string | null } | null,
  role: "admin",
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>,
}));
function table(name: string) {
  const rows = mock.tables[name] ?? [];
  const query: Record<string, unknown> = { data: rows, error: null };
  for (const method of ["select", "order", "eq", "in", "limit"]) query[method] = () => query;
  query.single = async () => ({ data: name === "user_profiles" ? { role: mock.role } : rows[0], error: null });
  query.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  query.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return query;
}
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: mock.user } }) },
  from: (name: string) => table(name),
  rpc: mock.rpc,
}) }));
import { GET as list } from "@/app/api/media-directory/route";
import { POST as saveOutlet } from "@/app/api/media-directory/outlets/route";
import { POST as saveDepartment } from "@/app/api/media-directory/departments/route";
import { POST as applyImport } from "@/app/api/media-directory/import/route";
import { GET as deliveries } from "@/app/api/media-directory/deliveries/route";

const json = (url: string, body: unknown) => new NextRequest(`https://app.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  mock.user = { id: "u1", email: "u@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" };
  mock.role = "admin";
  mock.rpc.mockReset().mockResolvedValue({ data: { id: "o1", name: "조선일보" }, error: null });
  mock.tables = {
    media_outlets: [{ id: "o1", name: "조선일보", aliases: [], any_department: false, active: true, updated_at: "2026-09-15T00:00:00Z" }, { id: "o2", name: "헤럴드경제", aliases: ["㈜헤럴드"], any_department: true, active: false, updated_at: "2026-09-15T00:00:00Z" }],
    media_departments: [{ id: "d1", outlet_id: "o1", name: "테크부", active: true, updated_at: "2026-09-15T00:00:00Z" }],
    media_alert_deliveries: [{ id: "x", sync_run_id: 1, recipient_email: "a@example.test", match_count: 2, status: "sent", error_message: null, created_at: "2026-09-15T00:00:00Z" }],
  };
});

describe("GET /api/media-directory", () => {
  it("nests departments under outlets and filters by normalized query", async () => {
    mock.role = "user";
    const all = await (await list(new NextRequest("https://app.test/api/media-directory"))).json();
    expect(all.totals).toEqual({ outlets: 2, activeOutlets: 1, departments: 1 });
    expect(all.outlets[0].departments).toEqual([expect.objectContaining({ name: "테크부" })]);
    const filtered = await (await list(new NextRequest("https://app.test/api/media-directory?q=%E3%88%9C%20%ED%97%A4%EB%9F%B4%EB%93%9C"))).json();
    expect(filtered.outlets.map((o: { name: string }) => o.name)).toEqual(["헤럴드경제"]);
    const byDept = await (await list(new NextRequest("https://app.test/api/media-directory?q=테크"))).json();
    expect(byDept.outlets.map((o: { name: string }) => o.name)).toEqual(["조선일보"]);
  });
  it("requires login and user role", async () => {
    mock.role = "guest";
    expect((await list(new NextRequest("https://app.test/api/media-directory"))).status).toBe(403);
    mock.user = null;
    expect((await list(new NextRequest("https://app.test/api/media-directory"))).status).toBe(401);
  });
});

describe("admin writes", () => {
  it("saves an outlet through the RPC with normalized inputs", async () => {
    const response = await saveOutlet(json("/api/media-directory/outlets", { id: null, name: " 조선일보 ", aliases: ["조선", "", "조선"], anyDepartment: true, active: true }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("media_outlet_save", { p_id: null, p_name: "조선일보", p_aliases: ["조선"], p_any_department: true, p_active: true });
  });
  it("saves a department and maps RPC errors to HTTP codes", async () => {
    await saveDepartment(json("/api/media-directory/departments", { outletId: "o1", name: "산업부" }));
    expect(mock.rpc).toHaveBeenCalledWith("media_department_save", { p_id: null, p_outlet_id: "o1", p_name: "산업부", p_active: true });
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "dup" } });
    expect((await saveDepartment(json("/api/media-directory/departments", { outletId: "o1", name: "산업부" }))).status).toBe(409);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "missing" } });
    expect((await saveDepartment(json("/api/media-directory/departments", { outletId: "zz", name: "산업부" }))).status).toBe(404);
  });
  it("applies an import only with valid rows", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { outletsAdded: 1, outletsExisting: 0, departmentsAdded: 1, departmentsExisting: 0, anyDepartmentSet: 0, skipped: 0 }, error: null });
    const ok = await applyImport(json("/api/media-directory/import", { rows: [{ outlet: "전자신문", department: "미래부" }, { outlet: "전자신문", department: null }] }));
    expect(ok.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("media_directory_import", { p_rows: [{ outlet: "전자신문", department: "미래부" }, { outlet: "전자신문", department: null }] });
    expect((await applyImport(json("/api/media-directory/import", { rows: "nope" }))).status).toBe(400);
    expect((await applyImport(json("/api/media-directory/import", { rows: [{ outlet: 1 }] }))).status).toBe(400);
  });
  it("rejects non-admins for every write and for delivery history", async () => {
    mock.role = "user";
    expect((await saveOutlet(json("/api/media-directory/outlets", { name: "조선일보" }))).status).toBe(403);
    expect((await saveDepartment(json("/api/media-directory/departments", { outletId: "o1", name: "산업부" }))).status).toBe(403);
    expect((await applyImport(json("/api/media-directory/import", { rows: [] }))).status).toBe(403);
    expect((await deliveries()).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("lists recent deliveries for admins", async () => {
    const body = await (await deliveries()).json();
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0]).toMatchObject({ recipient_email: "a@example.test", status: "sent" });
  });
});
