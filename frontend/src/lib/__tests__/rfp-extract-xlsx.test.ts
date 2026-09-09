import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseDocumentAsync } from "@/lib/rfp/parse";
import { parseMergeRef } from "@/lib/rfp/parse-xlsx";
import { extractXlsx, findHeader, isXlsxRequirementFormat, titleFromItem, xlsxCategoryCode } from "@/lib/rfp/extract-xlsx";
import { extractOverview } from "@/lib/rfp/overview";
import type { DocumentModel, Table } from "@/lib/rfp/document-model";

/** 실제 견적요청서(한국철도공사 IaaS)와 같은 모양: 구역 제목 병합 → 안내 문단 → 헤더 → 구분 세로 병합 데이터 → 빈 행 */
async function sampleWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const qty = wb.addWorksheet("물량");
  qty.getCell("B3").value = "품목";
  qty.getCell("C3").value = "영역";
  qty.getCell("D3").value = "수량";
  qty.getCell("B4").value = "IaaS (컴퓨팅 가상화)";
  qty.getCell("C4").value = "IaaS#1 클러스터";
  qty.getCell("D4").value = "3식";

  const ws = wb.addWorksheet("기술검토");
  ws.getCell("B2").value = "■ 기술검토 항목";
  ws.mergeCells("B2:F2");
  ws.getCell("B3").value = "아래의 기술검토 항목은 금번 사업에 구현이 가능해야 하며 \"기술검토\" 결과를 적으세요";
  ws.mergeCells("B3:F3");
  ws.getCell("B5").value = "구분";
  ws.getCell("C5").value = "No.";
  ws.getCell("D5").value = "기술검토 항목";
  ws.getCell("E5").value = "답변 (증빙 자료 첨부 가능)";
  ws.getCell("F5").value = "비고";
  const rows: [string, number, string, string, string][] = [
    ["IaaS", 1, "○ 오픈소스 커널 기반 가상화 기술인 KVM(Kernel Based Virtual Machine) 또는\n    자체 가상화 기술 제공", "제공", "Openstackit는 KVM 기반"],
    ["IaaS", 2, "○ 가상화 인프라 전반에 대한 다양한 서비스의 대시보드 제공", "제공", ""],
    ["GPU", 1, "○ VM에 GPU, vGPU 자원의 실시간 적용 기능을 지원", "부분 지원", "자원 할당은 가능"],
    ["공통", 1, "○ 레퍼런스 내역 (사업명/도입년도/제품정보 포함)", "제공", ""],
  ];
  rows.forEach(([cat, no, item, answer, note], i) => {
    const r = 6 + i;
    ws.getCell(`B${r}`).value = cat;
    ws.getCell(`C${r}`).value = no;
    ws.getCell(`D${r}`).value = item;
    ws.getCell(`E${r}`).value = answer;
    ws.getCell(`F${r}`).value = note;
  });
  ws.mergeCells("B6:B7"); // IaaS 세로 병합(엑셀 요건표 관용) — 아래 행은 값이 비어 있다
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseMergeRef", () => {
  it("A1 표기를 0기준 범위로", () => {
    expect(parseMergeRef("B6:B22")).toEqual({ top: 5, left: 1, bottom: 21, right: 1 });
    expect(parseMergeRef("AA1:AB2")).toEqual({ top: 0, left: 26, bottom: 1, right: 27 });
    expect(parseMergeRef("B6")).toBeNull();
    expect(parseMergeRef("B22:B6")).toBeNull();
  });
});

describe("xlsxCategoryCode", () => {
  it("라틴 → 대문자, 관용어·표준 분류 → 코드, 한글은 초성", () => {
    expect(xlsxCategoryCode("IaaS")).toBe("IAAS");
    expect(xlsxCategoryCode("GPU")).toBe("GPU");
    expect(xlsxCategoryCode("공통")).toBe("COM");
    expect(xlsxCategoryCode("보안")).toBe("SEC");
    expect(xlsxCategoryCode("성능 요구사항")).toBe("PER");
    expect(xlsxCategoryCode("나머지")).toBe("NMJ");
  });
  it("이미 쓴 코드는 뒤에 글자를 붙인다", () => {
    expect(xlsxCategoryCode("공통", new Set(["COM"]))).toBe("COMA");
    expect(xlsxCategoryCode("공통", new Set(["COM", "COMA"]))).toBe("COMB");
  });
});

describe("titleFromItem", () => {
  it("글머리표·번호를 떼고 길면 자른다", () => {
    expect(titleFromItem("○ 가상화 인프라 대시보드 제공")).toBe("가상화 인프라 대시보드 제공");
    expect(titleFromItem("1) 성능 시험 결과 제출")).toBe("성능 시험 결과 제출");
    const long = titleFromItem("○ " + "가상화 플랫폼 구성을 위해 필요한 일체의 제반사항을 포함하여 설계 및 납품하여야 하며, 단 케이블 및 물리적 서버와 스토리지는 제외한다");
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(62);
  });
});

describe("findHeader", () => {
  it("여러 열에 걸친 구역 제목이 아니라 열이 가장 많이 인식된 행을 헤더로 고른다", async () => {
    const doc = await parseDocumentAsync(await sampleWorkbook(), "견적요청.xlsx");
    const table = doc.blocks.find((b): b is Table => b.type === "table" && b.cells.some((c) => c.text === "기술검토 항목"))!;
    const h = findHeader(table)!;
    expect(h.row).toBe(4);
    expect(h.cols).toEqual({ category: 1, no: 2, item: 3, answer: 4, note: 5 });
  });
});

describe("extractXlsx — 견적요청 양식", () => {
  it("한 행 = 한 요구사항, 구분 병합은 아래로 채우고 답변·비고는 산출정보로", async () => {
    const buf = await sampleWorkbook();
    const doc = await parseDocumentAsync(buf, "견적요청.xlsx");
    expect(doc.format).toBe("xlsx");
    expect(isXlsxRequirementFormat(doc)).toBe(true);

    const r = extractXlsx(doc);
    expect(r.method).toBe("xlsx");
    expect(r.requirements.map((q) => q.reqId)).toEqual(["IAAS-001", "IAAS-002", "GPU-001", "COM-001"]);
    expect(r.requirements.map((q) => q.categoryName)).toEqual(["IaaS", "IaaS", "GPU", "공통"]);
    expect(r.requirements[0]).toMatchObject({
      categoryCode: "IAAS",
      title: "오픈소스 커널 기반 가상화 기술인 KVM(Kernel Based Virtual Machine) 또는 자체…",
      deliverables: "답변: 제공\n비고: Openstackit는 KVM 기반",
      sortOrder: 0,
    });
    expect(r.requirements[0].details).toContain("○ 오픈소스 커널 기반");
    expect(r.requirements[0].details).toContain("\n자체 가상화 기술 제공");
    expect(r.requirements[1].categoryName).toBe("IaaS"); // 세로 병합 셀이 아래 행까지 채워진다
    expect(r.warnings).toEqual(["요건표가 아니라 건너뛴 시트: 물량"]);
  });

  it("엑셀에서는 셀 안 인용어를 사업명으로 잡지 않는다(파일명 폴백에 맡긴다)", async () => {
    const doc = await parseDocumentAsync(await sampleWorkbook(), "견적요청.xlsx");
    expect(extractOverview(doc).name).toBeNull();
  });

  it("요건표가 없는 엑셀은 빈 결과와 경고", () => {
    const table: Table = {
      type: "table", rows: 2, cols: 2,
      cells: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "제조사", tables: [] },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "호환 제품 목록", tables: [] },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "HPE", tables: [] },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "DL360", tables: [] },
      ],
    };
    const doc: DocumentModel = { format: "xlsx", blocks: [{ type: "paragraph", text: "# 호환성" }, table] };
    expect(isXlsxRequirementFormat(doc)).toBe(false);
    const r = extractXlsx(doc);
    expect(r.requirements).toEqual([]);
    expect(r.warnings.some((w) => w.includes("찾지 못했습니다"))).toBe(true);
  });
});

describe("findHeader — 라벨/값 표 오인 방지", () => {
  it("인식한 열이 하나뿐이면 요건표로 보지 않는다", () => {
    // PDF 요구사항 표는 값 칸에 "…기본 요건"처럼 항목 열 문구가 들어가 헤더로 오인될 수 있다
    const c = (row: number, col: number, text: string, colSpan = 1) => ({ row, col, rowSpan: 1, colSpan, text, tables: [] });
    const labelValue: Table = { type: "table", rows: 3, cols: 3, cells: [
      c(0, 0, "요구사항 번호", 2), c(0, 2, "ECR-002"),
      c(1, 0, "요구사항 명칭", 2), c(1, 2, "HW/SW 구성 기본 요건"),
      c(2, 0, "요구사항 상세", 2), c(2, 2, "○ 제안사는 서버, 스토리지를 산정해야 함"),
    ] };
    expect(findHeader(labelValue)).toBeNull();
    expect(isXlsxRequirementFormat({ format: "pdf", blocks: [labelValue] })).toBe(false);
  });
});
