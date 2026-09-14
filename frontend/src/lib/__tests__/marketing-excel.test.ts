// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { checkXlsxArchive, parseExcel, submissionTemplate } from "@/lib/marketing/excel";
describe("marketing Excel", () => {
  it("round trips the submission template, text phones, dates and source rows", async () => {
    const b = await submissionTemplate(); const w = new ExcelJS.Workbook(); await w.xlsx.load(b);
    w.getWorksheet("Contact 제출")!.addRow(["DB001", "한빛", "김서연", "개발팀", "책임", "a@example.com", "010-0012-0034"]);
    const result = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()), "contacts.xlsx");
    expect(result.rows[0]).toMatchObject({ row: 2, dbId: "DB001", data: { phone: "010-0012-0034", company: "한빛" }, errors: [] });
    expect(result.hash).toHaveLength(64);
  });
  it("rejects formulas, wrong sheets, empty files and unsupported archives", async () => {
    const w = new ExcelJS.Workbook(); const s = w.addWorksheet("Contact 제출");
    await expect(parseExcel(Buffer.from(await w.xlsx.writeBuffer()), "bad.xlsx")).rejects.toThrow("필수 컬럼");
    const b = await submissionTemplate(); await w.xlsx.load(b);
    w.getWorksheet("Contact 제출")!.getCell("B2").value = { formula: 'HYPERLINK("https://example.com")', result: "x" };
    const parsed = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()), "bad.xlsx");
    expect(parsed.rows[0].blockingErrors?.[0]).toContain("수식 셀");
    expect(() => checkXlsxArchive(Buffer.from("invalid"))).toThrow();
    expect(s.name).toBe("Contact 제출");
  });
  it("retains invalid contact rows as review candidates", async () => {
    const w = new ExcelJS.Workbook(); await w.xlsx.load(await submissionTemplate());
    w.getWorksheet("Contact 제출")!.addRow(["", "한빛", "", "", "", "bad email"]);
    const parsed = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()), "bad-contact.xlsx");
    expect(parsed.rows[0].errors).toEqual([]); // Configurable business rules run on submission, after parsing.
    expect(parsed.rows[0].data).toMatchObject({ name: "", email: "bad email" });
  });
  it.skipIf(!process.env.MARKETING_TEST_XLSX)("reconciles the actual source workbook without altering it", async () => {
    const b = await readFile(process.env.MARKETING_TEST_XLSX!); const r = await parseExcel(b, "Master.xlsx", true);
    expect(r.total).toBe(7294); expect(r.errors).toEqual([]);
    expect(r.rows.filter(r => !r.data.company.trim())).toHaveLength(732);
    expect(r.rows.filter(r => !r.data.name.trim())).toHaveLength(434);
    expect(r.rows.filter(r => r.category === "확인 필요")).toHaveLength(913);
    expect(new Set(r.rows.map(r => r.dbId)).size).toBe(7294);
  });
});
