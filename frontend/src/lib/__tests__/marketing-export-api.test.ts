// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { emptyContact } from "@/lib/marketing/types";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/marketing/server", async original => ({ ...await original<typeof import("@/lib/marketing/server")>(), marketingAuth: mocks.auth }));
import { GET } from "@/app/api/marketing/export/route";
import { MarketingError } from "@/lib/marketing/server";
const request = () => new NextRequest("https://test.local/api/marketing/export?q=  한빛  &category=IT기업&department=마케팅&issues=true&page=3&sort=name&direction=desc");
beforeEach(() => { mocks.rpc.mockReset(); mocks.auth.mockReset().mockResolvedValue({ db: { rpc: mocks.rpc } }); });

it("exports every matched row, preserves 2-row headers and literal text, and ignores UI pagination", async () => {
  const rows = Array.from({ length: 37 }, (_, i) => ({ id: String(i), db_id: `DB-${i}`, data: { ...emptyContact(), company: "원본명", name: "담당자", phone: "010-0012-0034", ecoId: "00012", notes: '=HYPERLINK("https://example.test")' }, organization: { name: "한빛 표준명", category: "IT기업" } }));
  mocks.rpc.mockResolvedValue({ data: { rows, total: rows.length } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("marketing_search_contacts", { p_q: "한빛", p_category: "IT기업", p_department: "마케팅", p_issues: true, p_offset: 0, p_limit: null, p_sort: "name", p_direction: "desc" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="Master-DB-.*\.xlsx"/);
  expect(response.headers.get("X-Export-Count")).toBe("37");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet("01_Master_DB")!;
  expect(sheet.rowCount).toBe(40); expect(sheet.columnCount).toBe(18);
  expect(sheet.model.merges).toEqual(expect.arrayContaining(["A1:R1", "B2:H2", "I2:K2", "L2:P2", "Q2:R2"]));
  expect(sheet.getCell("B2").value).toBe("기본정보"); expect(sheet.getCell("Q3").value).toBe("최종\n확인일");
  expect(sheet.getCell("C4").value).toBe("한빛 표준명"); expect(sheet.getCell("A4").value).toBe("IT기업");
  expect(sheet.getCell("H4").value).toBe("010-0012-0034"); expect(sheet.getCell("M4").value).toBe("00012");
  expect(sheet.getCell("R4").value).toBe(rows[0].data.notes); expect(sheet.getCell("R4").type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getCell("B40").value).toBe("DB-36"); expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
  expect(workbook.getWorksheet("조회 조건")!.getCell("B3").value).toBe(37);
  expect(workbook.getWorksheet("조회 조건")!.getCell("B6").value).toBe("마케팅");
  expect(workbook.getWorksheet("조회 조건")!.getCell("B8").value).toBe("성명");
  expect(workbook.getWorksheet("조회 조건")!.getCell("B9").value).toBe("내림차순");
});
it.each([401, 403])("denies unauthorized downloads (%s) before querying Contact data", async status => {
  mocks.auth.mockRejectedValue(new MarketingError("접근 불가", status));
  expect((await GET(request())).status).toBe(status); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("fails instead of silently producing a truncated export", async () => {
  mocks.rpc.mockResolvedValue({ data: { rows: [], total: 37 } });
  const response = await GET(request()); expect(response.status).toBe(503);
  expect((await response.json()).error).toContain("전체 결과");
});
it("propagates database errors and handles an empty result as a header-only workbook", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { message: "조회 실패" } }).mockResolvedValueOnce({ data: { rows: [], total: 0 } });
  expect((await GET(request())).status).toBe(400);
  const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get("X-Export-Count")).toBe("0");
});
