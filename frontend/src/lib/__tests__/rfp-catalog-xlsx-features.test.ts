import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseXlsxFeatures, xlsxNote, XLSX_HEADER_SCAN_ROWS } from "@/lib/rfp/catalog/xlsx-features";

/** exceljs writeBuffer는 exceljs 자체 Buffer 타입을 돌려준다 — Node Buffer로 감싸 넘긴다 */
async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function workbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("기능목록");
  ws.getRow(1).values = ["DevOpsit v1.7 기능명세서"];
  ws.getRow(3).values = ["No", "기능명", "설명", "키워드", "비고"];
  ws.getRow(4).values = [1, "파이프라인 템플릿", "CI/CD 파이프라인을 템플릿으로 생성", "파이프라인, 템플릿", "v1.5"];
  ws.getRow(5).values = [2, "DEV-002", "코드만 있는 행", "", ""];
  ws.getRow(6).values = [3, "기능명", "반복 헤더", "", ""];
  ws.getRow(7).values = [4, { richText: [{ text: "알림 " }, { text: "연동" }] }, "Slack·Teams", "", ""];
  ws.getRow(8).values = [5, "", "이름 없음", "", ""];
  const memo = wb.addWorksheet("메모");
  memo.getRow(1).values = ["회의록", "2026-09-01"];
  return wb;
}

describe("parseXlsxFeatures", () => {
  it("앞 10행에서 헤더를 찾아 이름·설명·키워드 열을 읽고 코드·반복 헤더·빈 이름을 건너뛴다. 헤더 없는 시트는 경고", async () => {
    const r = await parseXlsxFeatures(await toBuffer(workbook()));
    expect(r.features).toEqual([
      { name: "파이프라인 템플릿", description: "CI/CD 파이프라인을 템플릿으로 생성", keywords: ["파이프라인", "템플릿"] },
      { name: "알림 연동", description: "Slack·Teams" },
    ]);
    expect(r.sheets).toBe(1);
    expect(r.warnings).toEqual(["시트 메모: 기능 열을 찾지 못했습니다."]);
    expect(xlsxNote(r)).toBe("xlsx: 시트 1개 → 기능 2개");
    expect(XLSX_HEADER_SCAN_ROWS).toBe(10);
  });
  it("설명 열이 없으면 이름·키워드 열을 뺀 텍스트 셀을 ' · '로 잇는다(코드·버전 셀 제외)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getRow(1).values = ["구분", "Feature", "코드", "버전"];
    ws.getRow(2).values = ["보안", "SSO", "SEC-001", "v2.6"];
    const r = await parseXlsxFeatures(await toBuffer(wb));
    expect(r.features).toEqual([{ name: "SSO", description: "보안" }]);
  });
  it("기능이 하나도 없으면 경고", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("빈 시트");
    const r = await parseXlsxFeatures(await toBuffer(wb));
    expect(r.features).toEqual([]);
    expect(r.sheets).toBe(0);
    expect(r.warnings).toEqual(["시트 빈 시트: 기능 열을 찾지 못했습니다.", "파일에서 기능을 찾지 못했습니다."]);
  });
  it("여러 시트의 기능을 합산하고 sheets는 헤더를 찾은 시트 수", async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet("A");
    a.getRow(1).values = ["기능명", "설명"];
    a.getRow(2).values = ["백업", "일 1회"];
    const b = wb.addWorksheet("B");
    b.getRow(2).values = ["Feature", "Description"];
    b.getRow(3).values = ["복구", "시점 복구"];
    const r = await parseXlsxFeatures(await toBuffer(wb));
    expect(r.features).toEqual([{ name: "백업", description: "일 1회" }, { name: "복구", description: "시점 복구" }]);
    expect(r.sheets).toBe(2);
    expect(r.warnings).toEqual([]);
  });
  it("결과가 없는 수식 셀·날짜·하이퍼링크 셀이 있어도 예외 없이 읽는다", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getRow(1).values = ["기능명", "설명", "비고"];
    ws.getCell("A2").value = { formula: "B9", result: null as unknown as undefined };
    ws.getCell("B2").value = "수식 이름";
    ws.getCell("A3").value = "일정 관리";
    ws.getCell("B3").value = { text: "링크 설명", hyperlink: "https://example.com" };
    ws.getCell("C3").value = new Date("2026-09-07T00:00:00Z");
    ws.getCell("A4").value = { formula: "A3", result: "수식 결과" };
    ws.getCell("B4").value = "결과 있는 수식";
    const r = await parseXlsxFeatures(await toBuffer(wb));
    expect(r.features.map((f) => f.name)).toEqual(["일정 관리", "수식 결과"]);
    expect(r.features[0].description).toBe("링크 설명");
  });
});
