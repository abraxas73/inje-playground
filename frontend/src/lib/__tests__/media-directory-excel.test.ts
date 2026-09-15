// @vitest-environment node
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { mediaNorm } from "@/lib/media-directory/normalize";
import { parseMediaListXlsx } from "@/lib/media-directory/excel";
import { buildImportPreview } from "@/lib/media-directory/preview";
import type { MediaOutlet } from "@/types/media-directory";

async function workbook(rows: Array<[unknown, unknown]>, header: [string, string] = ["매체", "부서"]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Sheet1");
  ws.addRow(header); for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const outlet = (name: string, departments: string[], extra: Partial<MediaOutlet> = {}): MediaOutlet => ({
  id: name, name, aliases: [], any_department: false, active: true, updated_at: "2026-09-15T00:00:00Z",
  departments: departments.map((d) => ({ id: `${name}-${d}`, outlet_id: name, name: d, active: true, updated_at: "2026-09-15T00:00:00Z" })), ...extra,
});

describe("mediaNorm mirrors public.media_norm", () => {
  it.each([["㈜헤럴드 경제", "헤럴드경제"], ["IT산업부 팩플팀", "it산업부팩플팀"], ["테크&사이언스부", "테크사이언스부"], ["(주)이데일리·M", "이데일리m"], ["뉴스1", "뉴스1"]])("%s → %s", (input, expected) => {
    expect(mediaNorm(input)).toBe(expected);
  });
});

describe("parseMediaListXlsx", () => {
  it("reads 매체/부서 columns, trims values and separates blank departments", async () => {
    const parsed = await parseMediaListXlsx(await workbook([["조선일보", "테크부"], [" 조선일보 ", "테크부 "], ["중앙일보", null], [null, null], [null, "부서만"], ["X", "y"]]));
    expect(parsed.total).toBe(5);
    expect(parsed.blank).toBe(1);
    expect(parsed.rows.map((r) => [r.outlet, r.department])).toEqual([["조선일보", "테크부"], ["조선일보", "테크부"], ["중앙일보", null]]);
    expect(parsed.invalid).toEqual([{ row: 6, reason: "매체 없음" }, { row: 7, reason: "매체명이 너무 짧습니다" }]);
  });
  it("requires the two headers and rejects formulas", async () => {
    await expect(parseMediaListXlsx(await workbook([["a", "b"]], ["언론사", "부서"]))).rejects.toThrow("매체");
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Sheet1"); ws.addRow(["매체", "부서"]); ws.addRow([{ formula: "1+1" }, "x"]);
    await expect(parseMediaListXlsx(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow("수식");
  });
});

describe("buildImportPreview", () => {
  it("dedupes pairs and compares against existing outlets, aliases and departments", async () => {
    const parsed = await parseMediaListXlsx(await workbook([["조선일보", "테크부"], ["조선일보", "테크부"], ["조선일보", "산업부"], ["헤럴드경제", null], ["㈜헤럴드경제", "IT부"], ["전자신문", "미래부"], ["전자신문", null]]));
    const preview = buildImportPreview(parsed, [outlet("조선일보", ["테크부"]), outlet("헤럴드경제", [], { aliases: ["㈜헤럴드경제"] })], "list.xlsx");
    expect(preview.filename).toBe("list.xlsx");
    expect(preview.total).toBe(7);
    expect(preview.duplicates).toBe(1);
    expect(preview.rows).toHaveLength(6);
    expect(preview.newOutlets).toEqual(["전자신문"]);
    expect(preview.newDepartments).toBe(3);
    expect(preview.existingPairs).toBe(1);
    expect(preview.anyDepartmentOutlets).toEqual(["헤럴드경제", "전자신문"]);
  });
});
