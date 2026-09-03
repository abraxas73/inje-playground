import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook, xlsxFileName, type XlsxProject } from "@/lib/rfp/xlsx";
import type { RequirementRow } from "@/lib/rfp/requirements";

const project: XlsxProject = { name: "생성형 AI 플랫폼 구축 및 AX 개발 사업", agency: "한국석유공사", period: "12개월", budget: "13,225,835,150원", bidMethod: "일반경쟁입찰", extra: {} };
const row = (code: string, id: string, sortOrder: number, o: Partial<RequirementRow> = {}): RequirementRow => ({
  id: `${id}-uuid`, categoryCode: code, categoryName: code === "SER" ? "서비스 요구사항" : "인프라 상세 요구사항", reqId: id,
  title: `제목 ${id}`, definition: "정의", details: "◦ 세부\n - 둘째", deliverables: "", related: "", solution: "", sortOrder, source: { blockIndex: sortOrder }, ...o,
});
const rows = [row("INR-DTL", "INR-DTL-001", 2, { solution: "Openstackit" }), row("SER", "SER-002", 1), row("SER", "SER-001", 0)];

describe("buildWorkbook", () => {
  it("시트 구성·헤더·행·너비가 샘플과 같다", async () => {
    const buf = await buildWorkbook(project, rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL"]);

    const ov = wb.getWorksheet("0.개요")!;
    expect(String(ov.getCell("B2").value)).toContain("생성형 AI 플랫폼 구축 및 AX 개발 사업");
    expect(ov.getCell("B5").value).toBe("사업명");
    expect(ov.getCell("C5").value).toBe(project.name);
    expect(ov.getCell("B8").value).toBe("발주기관");
    expect(ov.getCell("C8").value).toBe("한국석유공사");

    const list = wb.getWorksheet("1.요구사항_목록")!;
    expect(String(list.getCell("A1").value)).toContain("전체 3건");
    expect(list.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션"]);
    expect(list.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "2.SER", ""]);
    expect(list.getRow(6).values).toEqual([undefined, 3, "인프라 상세 요구사항", "INR-DTL-001", "제목 INR-DTL-001", "3.INRDTL", "Openstackit"]);
    expect(list.getColumn(5).width).toBe(55);

    const ser = wb.getWorksheet("2.SER")!;
    expect(String(ser.getCell("A1").value)).toBe("[SER] 서비스 요구사항 — 상세 요구사항");
    expect(ser.getRow(3).values).toEqual([undefined, "연번", "요구사항\nID", "요구사항명", "정의", "세부 내용", "산출정보", "관련요구사항"]);
    expect(ser.getRow(5).getCell(2).value).toBe("SER-002");
    expect(ser.getRow(6).getCell(2).value).toBeNull();
    expect(ser.getColumn(5).width).toBe(85);
    expect(ser.getRow(4).getCell(5).alignment?.wrapText).toBe(true);
  });
  it("extra가 있으면 개요 시트에 '2. 기타'로 이어 붙인다", async () => {
    const buf = await buildWorkbook({ ...project, extra: { "추진 배경": "AI 도입 필요" } }, rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ov = wb.getWorksheet("0.개요")!;
    expect(ov.getCell("B11").value).toBe("2. 기타");
    expect(ov.getCell("B12").value).toBe("추진 배경");
    expect(ov.getCell("C12").value).toBe("AI 도입 필요");
  });
});

describe("xlsxFileName", () => {
  it("(발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx, 파일명 금지 문자는 _", () => {
    expect(xlsxFileName(project, new Date(2026, 8, 3))).toBe("(한국석유공사) 생성형 AI 플랫폼 구축 및 AX 개발 사업_요구사항 검토_20260903.xlsx");
    expect(xlsxFileName({ ...project, agency: null, name: "A/B: C" }, new Date(2026, 0, 5))).toBe("A_B_ C_요구사항 검토_20260105.xlsx");
  });
});
