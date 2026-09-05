import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook, kstYmd, xlsxFileName, type XlsxProject } from "@/lib/rfp/xlsx";
import type { RequirementRow } from "@/lib/rfp/requirements";
import { VERDICT_LABEL } from "@/lib/rfp/mapping/types";
import type { CatalogSolution, MappingRow } from "@/lib/rfp/mapping/types";

const project: XlsxProject = { name: "생성형 AI 플랫폼 구축 및 AX 개발 사업", agency: "한국석유공사", period: "12개월", budget: "13,225,835,150원", bidMethod: "일반경쟁입찰", extra: {} };
const row = (code: string, id: string, sortOrder: number, o: Partial<RequirementRow> = {}): RequirementRow => ({
  id: `${id}-uuid`, categoryCode: code, categoryName: code === "SER" ? "서비스 요구사항" : "인프라 상세 요구사항", reqId: id,
  title: `제목 ${id}`, definition: "정의", details: "◦ 세부\n - 둘째", deliverables: "", related: "", solution: "", sortOrder, source: { blockIndex: sortOrder }, ...o,
});
const rows = [row("INR-DTL", "INR-DTL-001", 2, { solution: "Openstackit" }), row("SER", "SER-002", 1), row("SER", "SER-001", 0)];

/** exceljs의 `load(data: Buffer)`는 exceljs 자체 Buffer 타입(ArrayBuffer 확장)을 쓰기 때문에
 * Node `Buffer<ArrayBufferLike>`를 그대로 넘기면 tsc가 타입 불일치로 잡는다. 정확한 길이의
 * 새 ArrayBuffer로 복사해 넘겨 피한다(값·동작은 동일). */
async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(buf).buffer as ArrayBuffer);
  return wb;
}

describe("buildWorkbook", () => {
  it("시트 구성·헤더·행·너비가 샘플과 같다", async () => {
    const buf = await buildWorkbook(project, rows);
    const wb = await loadWorkbook(buf);
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
    const wb = await loadWorkbook(buf);
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

  it("날짜는 KST 기준 — UTC 15:30은 KST 다음날 00:30", () => {
    expect(xlsxFileName({ ...project, agency: null, name: "A" }, new Date("2026-09-03T15:30:00Z"))).toBe("A_요구사항 검토_20260904.xlsx");
    expect(xlsxFileName({ ...project, agency: null, name: "A" }, new Date("2026-09-03T14:59:59Z"))).toBe("A_요구사항 검토_20260903.xlsx");
    expect(kstYmd(new Date("2026-12-31T15:00:00Z"))).toBe("20270101");
  });
});

describe("buildWorkbook + mapping", () => {
  const catalog: CatalogSolution[] = [
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [{ id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: "https://c/iam", isActive: true }] },
    { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [{ id: "f-pipe", solutionCode: "devopsit", name: "파이프라인", description: "", evidenceUrl: null, isActive: true }] },
  ];
  const m = (id: string, requirementId: string, verdict: MappingRow["verdict"], featureId: string | null, solutionCode: string | null, sortOrder: number, edited = false): MappingRow =>
    ({ id, requirementId, verdict, featureId, solutionCode, rationale: `이유 ${id}`, evidenceUrl: featureId === "f-iam" ? "https://c/iam" : null, edited, sortOrder });
  const mappingRows: MappingRow[] = [
    m("m1", "SER-001-uuid", "fulfilled", "f-iam", "secloudit", 0, true),
    m("m2", "SER-001-uuid", "partial", "f-pipe", "devopsit", 1),
    m("m3", "INR-DTL-001-uuid", "build", null, null, 0),
  ];
  const mapping = { rows: mappingRows, catalog, mappingAt: "2026-09-04T01:23:00.000Z" };

  it("목록 시트에 요약 + 5열, 여러 매핑은 셀 안 줄바꿈, 미매핑은 '미매핑'", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    const list = wb.getWorksheet("1.요구사항_목록")!;
    expect(list.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션", "솔루션", "기능", "판정", "매핑 설명", "근거 URL"]);
    expect(list.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "2.SER", "SECloudit·IAM(충족) / Devopsit·파이프라인(부분충족)", "SECloudit\nDevopsit", "IAM\n파이프라인", "충족\n부분충족", "이유 m1\n이유 m2", "https://c/iam\n"]);
    expect(list.getRow(5).getCell(7).value).toBe("");
    expect(list.getRow(5).getCell(9).value).toBe("미매핑");
    expect(list.getRow(6).getCell(9).value).toBe(VERDICT_LABEL.build);
    expect(list.getRow(6).getCell(8).value).toBe("");
    expect(list.getColumn(11).width).toBe(40);
  });
  it("상세 시트 번호는 그대로이고 마지막에 '{n}.솔루션_매핑' 시트가 붙는다(미매핑 포함, 수정 표시)", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL", "4.솔루션_매핑"]);
    const ms = wb.getWorksheet("4.솔루션_매핑")!;
    expect(ms.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "솔루션", "기능", "판정", "매핑 설명", "근거 URL", "수정"]);
    expect(ms.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "SECloudit", "IAM", "충족", "이유 m1", "https://c/iam", "수정"]);
    expect(ms.getRow(5).values).toEqual([undefined, 2, "서비스 요구사항", "SER-001", "제목 SER-001", "Devopsit", "파이프라인", "부분충족", "이유 m2", "", ""]);
    expect(ms.getRow(6).values).toEqual([undefined, 3, "서비스 요구사항", "SER-002", "제목 SER-002", "", "", "미매핑", "", "", ""]);
    expect(ms.getRow(7).values).toEqual([undefined, 4, "인프라 상세 요구사항", "INR-DTL-001", "제목 INR-DTL-001", "", "", "설계·구축영역", "이유 m3", "", ""]);
    expect(ms.getRow(8).getCell(3).value).toBeNull();
  });
  it("개요 시트에 '3. 솔루션 매핑 요약' 블록", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    const ov = wb.getWorksheet("0.개요")!;
    expect(ov.getCell("B11").value).toBe("3. 솔루션 매핑 요약");
    expect(ov.getCell("B12").value).toBe("실행 시각");
    expect(ov.getCell("B13").value).toBe("충족");
    expect(ov.getCell("C13").value).toBe("1건");
    expect(ov.getCell("B14").value).toBe("부분충족");
    expect(ov.getCell("C14").value).toBe("0건");
    expect(ov.getCell("B15").value).toBe("설계·구축영역");
    expect(ov.getCell("C15").value).toBe("1건");
    expect(ov.getCell("B17").value).toBe("미매핑");
    expect(ov.getCell("C17").value).toBe("1건");
    expect(ov.getCell("B18").value).toBe("SECloudit");
    expect(ov.getCell("C18").value).toBe("충족 1건 · 부분충족 0건");
    expect(ov.getCell("B19").value).toBe("Devopsit");
    expect(ov.getCell("C19").value).toBe("충족 0건 · 부분충족 1건");
  });
  it("mapping을 주지 않으면 1단계와 같은 시트·열", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL"]);
    expect(wb.getWorksheet("1.요구사항_목록")!.getRow(3).cellCount).toBe(6);
  });
});
