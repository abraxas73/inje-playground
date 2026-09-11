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
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [{ id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: "https://c/iam", isActive: true, keywords: [] }] },
    { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [{ id: "f-pipe", solutionCode: "devopsit", name: "파이프라인", description: "", evidenceUrl: null, isActive: true, keywords: [] }] },
  ];
  const m = (id: string, requirementId: string, verdict: MappingRow["verdict"], featureId: string | null, solutionCode: string | null, sortOrder: number, edited = false): MappingRow =>
    ({ id, requirementId, verdict, featureId, solutionCode, rationale: `이유 ${id}`, evidenceUrl: featureId === "f-iam" ? "https://c/iam" : null, edited, sortOrder });
  const mappingRows: MappingRow[] = [
    m("m1", "SER-001-uuid", "fulfilled", "f-iam", "secloudit", 0, true),
    m("m2", "SER-001-uuid", "partial", "f-pipe", "devopsit", 1),
    m("m3", "INR-DTL-001-uuid", "build", null, null, 0),
  ];
  const mapping = { rows: mappingRows, catalog, mappingAt: "2026-09-04T01:23:00.000Z" };

  it("목록 시트에는 매핑 열이 아니라 요약(당사 솔루션·세부 항목 매핑)만 있다", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    const list = wb.getWorksheet("1.요구사항_목록")!;
    expect(list.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션", "세부 항목\n매핑"]);
    expect(list.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "2.SER", "SECloudit·IAM(충족) / Devopsit·파이프라인(부분충족)", ""]);
    expect(list.getRow(5).getCell(6).value).toBe("미매핑");
    expect(list.getRow(6).getCell(6).value).toBe(VERDICT_LABEL.build);
  });
  it("상세 시트에 판정·솔루션·기능·근거 열이 붙는다(매핑이 없으면 1단계 7열)", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    const ser = wb.getWorksheet("2.SER")!;
    expect(ser.getRow(3).values).toEqual([
      undefined, "연번", "요구사항\nID", "요구사항명", "정의", "산출정보", "관련요구사항",
      "항목", "세부 내용", "판정", "솔루션", "기능", "매핑 설명", "근거 문장", "근거 URL", "비고", "수정",
    ]);
    // 세부 내용이 목록이 아니면 항목 열은 비고, 요구사항 한 건이 매핑 행 수만큼 늘어난다
    expect(ser.getRow(4).getCell(7).value).toBe("");
    expect(ser.getRow(4).getCell(8).value).toBe("◦ 세부\n - 둘째");
    expect(ser.getRow(4).getCell(9).value).toBe("충족");
    expect(ser.getRow(5).getCell(9).value).toBe("부분충족");
    // 5행 ID 칸은 4행과 병합돼 있다(같은 요구사항)
    expect(ser.getCell("B5").master.address).toBe("B4");
    expect(ser.getRow(6).getCell(2).value).toBe("SER-002");
    expect(ser.getRow(6).getCell(9).value).toBe("미매핑");
  });
  it("상세 시트 번호는 그대로이고 마지막에 '{n}.솔루션_매핑' 시트가 붙는다(미매핑 포함, 수정 표시)", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows, mapping));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL", "4.솔루션_매핑", "5.요구사항_대응표", "6.Gap_리포트"]);
    const ms = wb.getWorksheet("4.솔루션_매핑")!;
    expect(ms.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "세부 항목", "솔루션", "기능", "판정", "매핑 설명", "근거 문장", "근거 URL", "비고", "수정"]);
    expect(ms.getRow(4).values).toEqual([undefined, 1, "서비스 요구사항", "SER-001", "제목 SER-001", "", "SECloudit", "IAM", "충족", "이유 m1", "", "https://c/iam", "", "수정"]);
    expect(ms.getRow(5).values).toEqual([undefined, 2, "서비스 요구사항", "SER-001", "제목 SER-001", "", "Devopsit", "파이프라인", "부분충족", "이유 m2", "", "", "", ""]);
    expect(ms.getRow(6).values).toEqual([undefined, 3, "서비스 요구사항", "SER-002", "제목 SER-002", "", "", "", "미매핑", "", "", "", "", ""]);
    expect(ms.getRow(7).values).toEqual([undefined, 4, "인프라 상세 요구사항", "INR-DTL-001", "제목 INR-DTL-001", "", "", "", "설계·구축영역", "이유 m3", "", "", "", ""]);
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
    expect(ov.getCell("B15").value).toBe("후보");
    expect(ov.getCell("C15").value).toBe("0건");
    expect(ov.getCell("B16").value).toBe("설계·구축영역");
    expect(ov.getCell("C16").value).toBe("1건");
    expect(ov.getCell("B18").value).toBe("미매핑");
    expect(ov.getCell("C18").value).toBe("1건");
    expect(ov.getCell("B19").value).toBe("SECloudit");
    expect(ov.getCell("C19").value).toBe("충족 1건 · 부분충족 0건 · 후보 0건");
    expect(ov.getCell("B20").value).toBe("Devopsit");
    expect(ov.getCell("C20").value).toBe("충족 0건 · 부분충족 1건 · 후보 0건");
  });
  it("후보 판정은 '후보'로 표시된다", async () => {
    const withCandidate = { ...mapping, rows: [...mappingRows, m("m4", "SER-002-uuid", "candidate", "f-pipe", "devopsit", 0)] };
    const wb = await loadWorkbook(await buildWorkbook(project, rows, withCandidate));
    expect(wb.getWorksheet("2.SER")!.getRow(6).getCell(9).value).toBe("후보");
    expect(wb.getWorksheet("1.요구사항_목록")!.getRow(5).getCell(6).value).toBe("Devopsit·파이프라인(후보)");
    expect(wb.getWorksheet("0.개요")!.getCell("C15").value).toBe("1건");
    expect(wb.getWorksheet("0.개요")!.getCell("C20").value).toBe("충족 0건 · 부분충족 1건 · 후보 1건");
  });
  it("mapping을 주지 않으면 1단계와 같은 시트·열", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, rows));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL"]);
    expect(wb.getWorksheet("1.요구사항_목록")!.getRow(3).cellCount).toBe(6);
  });
});

describe("buildWorkbook + 세부 항목 단위 매핑", () => {
  // 1단 글머리 3개 = 세부 항목 3개(둘째 줄은 항목 1의 하위 줄)
  const details = "○ 첫째 항목\n - 하위 설명\n○ 둘째 항목\n○ 셋째 항목";
  const req = row("SER", "SER-010", 0, { details });
  const catalog: CatalogSolution[] = [
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [{ id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: "https://c/iam", isActive: true, keywords: [] }] },
    { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [{ id: "f-pipe", solutionCode: "devopsit", name: "파이프라인", description: "", evidenceUrl: null, isActive: true, keywords: [] }] },
  ];
  const base = { requirementId: "SER-010-uuid", edited: false, evidenceUrl: null as string | null };
  const mappingRows: MappingRow[] = [
    { ...base, id: "d0", verdict: "build", featureId: null, solutionCode: null, rationale: "옛 요구사항 단위 행", sortOrder: 0, detailKey: null },
    { ...base, id: "d1", verdict: "fulfilled", featureId: "f-iam", solutionCode: "secloudit", rationale: "이유 d1", sortOrder: 10, detailKey: "1", detailText: "첫째 항목", evidenceText: "근거 문장 1", evidenceUrl: "https://c/iam", edited: true, note: "메모 한 줄" },
    { ...base, id: "d2", verdict: "candidate", featureId: "f-pipe", solutionCode: "devopsit", rationale: "이유 d2", sortOrder: 11, detailKey: "1", detailText: "첫째 항목" },
    { ...base, id: "d3", verdict: "na", featureId: null, solutionCode: null, rationale: "이유 d3", sortOrder: 20, detailKey: "2", detailText: "둘째 항목" },
  ];
  const mapping = { rows: mappingRows, catalog, mappingAt: "2026-09-07T11:00:00.000Z" };

  it("상세 시트가 세부 항목마다 펼쳐지고 요구사항·항목 칸은 세로로 합쳐진다", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, [req], mapping));
    const ws = wb.getWorksheet("2.SER")!;
    // 4행: 요구사항 전체(옛 행) / 5~6행: 항목 1의 두 매핑 / 7행: 항목 2 / 8행: 매핑 없는 항목 3
    expect(ws.getRow(4).values).toEqual([undefined, 1, "SER-010", "제목 SER-010", "정의", "", "", "전체", details, "설계·구축영역", "", "", "옛 요구사항 단위 행", "", "", "", ""]);
    expect(ws.getRow(5).getCell(7).value).toBe("1");
    expect(ws.getRow(5).getCell(8).value).toBe("○ 첫째 항목\n- 하위 설명");
    expect(ws.getRow(5).getCell(9).value).toBe("충족");
    expect(ws.getRow(5).getCell(11).value).toBe("IAM");
    expect(ws.getRow(5).getCell(13).value).toBe("근거 문장 1");
    expect(ws.getRow(5).getCell(15).value).toBe("메모 한 줄");
    expect(ws.getRow(5).getCell(16).value).toBe("수정");
    expect(ws.getRow(6).getCell(9).value).toBe("후보");
    expect(ws.getRow(7).getCell(7).value).toBe("2");
    expect(ws.getRow(7).getCell(9).value).toBe("해당없음");
    expect(ws.getRow(8).getCell(7).value).toBe("3");
    expect(ws.getRow(8).getCell(8).value).toBe("○ 셋째 항목");
    expect(ws.getRow(8).getCell(9).value).toBe("미매핑");
    // 요구사항 칸은 4~8행, 항목 1 칸은 5~6행 병합
    expect(ws.getCell("A8").master.address).toBe("A4");
    expect(ws.getCell("G6").master.address).toBe("G5");
    expect(ws.getCell("G7").isMerged).toBe(false);
  });

  it("목록·개요는 세부 항목 진행도를 요약한다", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, [req], mapping));
    expect(wb.getWorksheet("1.요구사항_목록")!.getRow(4).getCell(7).value).toBe("2/3");
    const ov = wb.getWorksheet("0.개요")!;
    expect(ov.getCell("B13").value).toBe("세부 항목 매핑");
    expect(ov.getCell("C13").value).toBe("2/3개 항목 (목록형 요구사항 1건)");
  });

  it("솔루션_매핑 시트는 항목 라벨과 함께 한 줄 = 한 매핑, 빈 항목도 미매핑으로 남는다", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, [req], mapping));
    const ms = wb.getWorksheet("3.솔루션_매핑")!;
    expect(ms.getRow(4).getCell(5).value).toBe("");
    expect(ms.getRow(5).getCell(5).value).toBe("1. 첫째 항목");
    expect(ms.getRow(6).getCell(5).value).toBe("1. 첫째 항목");
    expect(ms.getRow(7).getCell(5).value).toBe("2. 둘째 항목");
    expect(ms.getRow(8).getCell(5).value).toBe("3. 셋째 항목");
    expect(ms.getRow(8).getCell(8).value).toBe("미매핑");
    // 메모는 "비고" 열(12번)로 나간다
    expect(ms.getRow(5).getCell(12).value).toBe("메모 한 줄");
    expect(ms.getRow(6).getCell(12).value).toBe("");
    expect(ms.getRow(9).getCell(1).value).toBeNull();
  });
});

describe("buildWorkbook + 대응표·Gap 리포트", () => {
  const catalog: CatalogSolution[] = [
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [{ id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: null, isActive: true, keywords: [] }] },
  ];
  const base = { requirementId: "SER-010-uuid", edited: false, evidenceUrl: null as string | null };
  const req = row("SER", "SER-010", 0, { details: "○ 첫째 항목\n○ 둘째 항목\n○ 셋째 항목" });
  const other = row("INR-DTL", "INR-DTL-001", 1, { details: "한 덩어리" });
  const mappingRows: MappingRow[] = [
    // 항목 1: 확정(충족) + 남은 후보 → 충족
    { ...base, id: "a1", verdict: "fulfilled", featureId: "f-iam", solutionCode: "secloudit", rationale: "자동 매칭 — 키워드 일치", evidenceText: "접근통제를 제공한다.", sortOrder: 0, detailKey: "1", detailText: "첫째 항목", edited: true, note: "확인 완료" },
    { ...base, id: "a2", verdict: "candidate", featureId: "f-iam", solutionCode: "secloudit", rationale: "자동 매칭 — 후보", sortOrder: 1, detailKey: "1", detailText: "첫째 항목" },
    // 항목 2: 후보만 → 검토 대기
    { ...base, id: "b1", verdict: "candidate", featureId: "f-iam", solutionCode: "secloudit", rationale: "자동 매칭 — 후보", sortOrder: 2, detailKey: "2", detailText: "둘째 항목" },
    // 항목 3: 없음 → 미매핑 / INR-DTL-001: 해당없음
    { ...base, id: "c1", requirementId: "INR-DTL-001-uuid", verdict: "na", featureId: null, solutionCode: null, rationale: "우리 범위 아님", sortOrder: 0, detailKey: null, edited: true },
  ];
  const mapping = { rows: mappingRows, catalog, mappingAt: "2026-09-12T00:00:00.000Z" };

  it("요구사항_대응표는 단위마다 한 줄이고 확정 판정만 담는다(후보는 검토 대기)", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, [req, other], mapping));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["0.개요", "1.요구사항_목록", "2.SER", "3.INRDTL", "4.솔루션_매핑", "5.요구사항_대응표", "6.Gap_리포트"]);
    const ws = wb.getWorksheet("5.요구사항_대응표")!;
    expect(String(ws.getCell("A1").value)).toContain("단위 4개 중 확정 2개");
    expect(ws.getRow(3).values).toEqual([undefined, "연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "세부 항목", "대응 여부", "대응 솔루션", "대응 기능", "대응 방안", "제안서 목차", "페이지", "비고"]);
    const r4 = ws.getRow(4).values as unknown[];
    expect(r4.slice(3, 10)).toEqual(["SER-010", "제목 SER-010", "1. 첫째 항목", "충족", "SECloudit", "IAM", "접근통제를 제공한다. — 키워드 일치"]);
    expect(r4[12]).toBe("확인 완료");
    expect((ws.getRow(5).values as unknown[])[6]).toBe("검토 대기");
    expect((ws.getRow(6).values as unknown[])[6]).toBe("미매핑");
    expect((ws.getRow(7).values as unknown[]).slice(3, 7)).toEqual(["INR-DTL-001", "제목 INR-DTL-001", "", "해당없음"]);
  });

  it("Gap_리포트는 충족이 아닌 단위만, 못 하는 것부터 나열하고 상태별 건수를 위에 둔다", async () => {
    const wb = await loadWorkbook(await buildWorkbook(project, [req, other], mapping));
    const ws = wb.getWorksheet("6.Gap_리포트")!;
    expect(String(ws.getCell("A1").value)).toContain("충족이 아닌 단위 3개 / 전체 4개");
    // 요약 줄: 설계·구축영역 0 · 해당없음 1 · 부분충족 0 · 검토 대기 1 · 미매핑 1
    expect([ws.getCell("B2").value, ws.getCell("C2").value, ws.getCell("D2").value, ws.getCell("E2").value]).toEqual(["설계·구축영역", 0, "해당없음", 1]);
    expect([ws.getCell("H2").value, ws.getCell("I2").value, ws.getCell("J2").value, ws.getCell("K2").value]).toEqual(["검토 대기", 1, "미매핑", 1]);
    const statuses = [5, 6, 7].map((r) => (ws.getRow(r).values as unknown[])[2]);
    expect(statuses).toEqual(["해당없음", "검토 대기", "미매핑"]);
    // 후보만 있는 단위는 후보 수와 최고 후보를 사유에 적어 검토 우선순위를 잡을 수 있게 한다
    expect((ws.getRow(6).values as unknown[])[7]).toBe("후보 1건 — 최고 SECloudit › IAM");
    expect((ws.getRow(5).values as unknown[])[7]).toBe("우리 범위 아님");
  });
});
