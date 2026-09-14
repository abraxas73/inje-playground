// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ rpc: vi.fn(), duplicate: false }));
vi.mock("@/lib/marketing/server", async original => ({ ...await original<typeof import("@/lib/marketing/server")>(), marketingAuth: async () => ({ db: { rpc: m.rpc } }), snapshot: async () => ({ contacts: [], organizations: [] }) }));
vi.mock("@/lib/marketing/ai", () => ({ recommendCompany: async () => ({ status: "unavailable", reason: "후속 단계" }) }));
import { POST } from "@/app/api/marketing/submissions/route";
const row = (name: string) => ({ data: { company: "한빛", name, email: `${name}@example.test` } });
const req = (rows: unknown[], partial = true) => new NextRequest("https://test.local/api/marketing/submissions", { method: "POST", body: JSON.stringify({ rows, partial }) });
beforeEach(() => {
  m.duplicate = false;
  m.rpc.mockReset().mockImplementation(async (name: string, p: { p_rows?: { data: { name: string } }[] }) => {
    if (name === "marketing_validate_rules") return { data: { version: "test-rules", rules: [], violations: [{ id: "name", code: "BASE-NAME", version: 2, severity: "error", manual: false, message: "성명 누락" }, { id: "email", code: "BASE-EMAIL-FORMAT", version: 2, severity: "error", manual: false, message: "이메일 형식 오류" }] } };
    if (name === "marketing_submit") return p.p_rows?.[0].data.name === "dbfail" ? { error: { message: "저장 실패" } } : { data: ["submitted-id"] };
    return { data: name === "marketing_pending_duplicate" && m.duplicate };
  });
});
it("commits valid rows and returns row-specific errors without losing successful results", async () => {
  const response = await POST(req([row("one"), { ...row("two"), dbId: "UNKNOWN", source: { row: 7 } }, row("dbfail"), row("four")]));
  expect(response.status).toBe(200); const body = await response.json();
  expect(body).toMatchObject({ count: 2, failed: 2 });
  expect(body.results.map((r: { status: string }) => r.status)).toEqual(["submitted", "error", "error", "submitted"]);
  expect(body.results[1]).toMatchObject({ row: 7, error: expect.stringContaining("DB ID") });
  expect(m.rpc.mock.calls.filter(c => c[0] === "marketing_finish_validation")).toHaveLength(2);
});
it.each([false, true])("collects invalid fields as confirmation-needed even with pending duplicate=%s", async duplicate => {
  m.duplicate = duplicate;
  const response = await POST(req([{ data: { company: "한빛", email: "bad" }, source: { file: "original.xlsx", row: 3 } }]));
  const body = await response.json();
  expect(body).toMatchObject({ count: 1, failed: 0, results: [{ status: "submitted", kind: "확인 필요", validationErrors: ["[BASE-NAME v2] 성명 누락", "[BASE-EMAIL-FORMAT v2] 이메일 형식 오류"] }] });
  const initial = m.rpc.mock.calls.find(c => c[0] === "marketing_submit")![1].p_rows[0];
  expect(initial.source).toMatchObject({ file: "original.xlsx", row: 3, submittedData: { company: "한빛", email: "bad" } });
  const final = m.rpc.mock.calls.find(c => c[0] === "marketing_finish_validation")![1].p_validation;
  expect(final).toMatchObject({ kind: "확인 필요", errors: ["[BASE-NAME v2] 성명 누락", "[BASE-EMAIL-FORMAT v2] 이메일 형식 오류"] });
});
it("collects missing fields from the single form without changing Master", async () => {
  const response = await POST(req([{ data: {} }], false)); expect(response.status).toBe(200);
  expect((await response.json()).results[0]).toMatchObject({ status: "submitted", kind: "확인 필요" });
  expect(m.rpc.mock.calls.some(c => c[0] === "marketing_review")).toBe(false);
});
it("still rejects unreadable contact structures per row", async () => {
  const response = await POST(req([{ data: null }, { data: { name: 123 } }]));
  expect((await response.json())).toMatchObject({ count: 0, failed: 2 });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("preserves supplied retry request keys and source metadata", async () => {
  const r = { ...row("one"), requestKey: "10000000-0000-4000-8000-000000000001", source: { file: "batch.xlsx", row: 4 } };
  await POST(req([r])); await POST(req([r]));
  const calls = m.rpc.mock.calls.filter(c => c[0] === "marketing_submit");
  expect(calls[0][1].p_rows[0]).toMatchObject({ requestKey: r.requestKey, source: r.source, processing: true });
  expect(calls[1][1].p_rows[0].requestKey).toBe(r.requestKey);
});
