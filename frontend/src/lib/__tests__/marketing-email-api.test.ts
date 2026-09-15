// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ rpc: vi.fn(), denied: false, worker: vi.fn() }));
vi.mock("@/lib/marketing/server", async original => ({ ...await original<typeof import("@/lib/marketing/server")>(), marketingAuth: async () => { if (m.denied) throw new Error("접근 불가"); return { db: { rpc: m.rpc } }; } }));
vi.mock("@/lib/marketing/email/worker", () => ({ runEmailWorker: m.worker }));
import { GET as download } from "@/app/api/marketing/email-checks/[id]/export/route";
import { POST as profile } from "@/app/api/marketing/email-checks/profiles/route";
import { GET as cron } from "@/app/api/cron/marketing-email/route";
const run = { id: "run1", scope: "all", created_at: "2026-09-15", filters: {}, total: 501 };
const target = (i: number) => ({ snapshot: { db_id: `DB${i}`, company: "회사", name: "담당", email: "=danger@innogrid.com", profile: null }, stale: false, result: { state: "review", checkedAt: "2026-09-15", syntax: { message: "형식" }, mail: { message: "MX 확인", mx: [] }, website: { title: "=1+1", message: "후보" }, mailbox: { message: "개별 메일함 미확인" } } });
beforeEach(() => { m.denied = false; m.rpc.mockReset(); m.worker.mockReset(); });
it("exports every matching contact with literal values and mailbox limits", async () => {
 m.rpc.mockImplementation(async (_name, p) => ({ data: { run, token: "same", total: 501, rows: p.p_page === 1 ? Array.from({ length: 500 }, (_, i) => target(i)) : [target(500)] } }));
 const r = await download(new NextRequest("https://test/api?state=review"), { params: Promise.resolve({ id: "run1" }) }); expect(r.status).toBe(200);
 const book = new ExcelJS.Workbook(); await book.xlsx.load(await r.arrayBuffer()); const sheet = book.getWorksheet("이메일 검사")!;
 expect(sheet.rowCount).toBe(502); expect(sheet.getCell("A502").value).toBe("DB500"); expect(sheet.getCell("D2").value).toBe("=danger@innogrid.com"); expect(sheet.getCell("M2").value).toBe("=1+1"); expect(sheet.getCell("O2").value).toBe("개별 메일함 미확인"); expect(m.rpc.mock.calls[0][1].p_state).toBe("review");
});
it("rejects mixed export snapshots and unauthorized downloads", async () => {
 m.rpc.mockImplementation(async (_name, p) => ({ data: { run, token: String(p.p_page), total: 501, rows: p.p_page === 1 ? Array.from({ length: 500 }, (_, i) => target(i)) : [target(500)] } }));
 expect((await download(new NextRequest("https://test/api"), { params: Promise.resolve({ id: "run1" }) })).status).toBe(409);
 m.denied = true; m.rpc.mockClear(); expect((await download(new NextRequest("https://test/api"), { params: Promise.resolve({ id: "run1" }) })).status).not.toBe(200); expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects private URLs and public mail company claims before saving", async () => {
 for (const b of [{ website: "http://127.0.0.1", domains: ["innogrid.com"] }, { website: "https://innogrid.com", domains: ["gmail.com"] }]) expect((await profile(new NextRequest("https://test/api", { method: "POST", body: JSON.stringify(b) }))).status).toBe(400);
 expect(m.rpc).not.toHaveBeenCalled();
});
it("normalizes company bases and passes optimistic versions to the RPC", async () => {
 m.rpc.mockResolvedValue({ data: {} }); const r = await profile(new NextRequest("https://test/api", { method: "POST", body: JSON.stringify({ id: "o1", website: "INNOGRID.COM", domains: ["INNOGRID.COM", "innogrid.com"], version: 3, organizationVersion: 4, reason: "담당자 확인" }) })); expect(r.status).toBe(200); expect(m.rpc).toHaveBeenCalledWith("marketing_email_profile_save", expect.objectContaining({ p_website: "https://innogrid.com/", p_domains: ["innogrid.com"], p_version: 3, p_org_version: 4 }));
});
it("cron rejects absent or incorrect credentials without running the worker", async () => {
 vi.stubEnv("CRON_SECRET", "test-secret"); expect((await cron(new NextRequest("https://test/api"))).status).toBe(401); expect((await cron(new NextRequest("https://test/api", { headers: { authorization: "Bearer wrong-value" } }))).status).toBe(401); expect(m.worker).not.toHaveBeenCalled(); vi.unstubAllEnvs();
});

// Master-level history uses the authenticated, paginated RPC rather than service access.
import { GET as contactHistory } from "@/app/api/marketing/email-checks/contacts/[id]/route";
const contactId = "10000000-0000-4000-8000-000000000001";
it("retrieves the requested Contact history page with preserved evidence", async () => {
 const data = { total: 21, pageSize: 20, rows: [{ validation_snapshot: { state: "review", message: "original evidence" } }] }; m.rpc.mockResolvedValue({ data });
 const r = await contactHistory(new NextRequest("https://test/api?page=2.8"), { params: Promise.resolve({ id: contactId }) });
 expect(r.status).toBe(200); expect(await r.json()).toEqual(data); expect(m.rpc).toHaveBeenCalledWith("marketing_email_contact_history", { p_contact: contactId, p_page: 2 });
});
it("rejects unauthorized history and malformed IDs, and reports missing Contacts", async () => {
 m.denied = true; expect((await contactHistory(new NextRequest("https://test/api"), { params: Promise.resolve({ id: contactId }) })).status).not.toBe(200); expect(m.rpc).not.toHaveBeenCalled();
 m.denied = false; expect((await contactHistory(new NextRequest("https://test/api"), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled();
 m.rpc.mockResolvedValue({ data: null }); expect((await contactHistory(new NextRequest("https://test/api"), { params: Promise.resolve({ id: contactId }) })).status).toBe(404);
});
