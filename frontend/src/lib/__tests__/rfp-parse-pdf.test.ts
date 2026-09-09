// @vitest-environment node
// pdf.js(unpdf)는 브라우저 흉내를 내는 jsdom에서 워커를 찾으려 하므로 node 환경에서 돈다.
import { describe, expect, it } from "vitest";
import {
  blocksFromLines,
  cleanPdfText,
  columnOf,
  columnRanges,
  groupLines,
  parsePdf,
  splitLineCells,
  type TextFrag,
} from "@/lib/rfp/parse-pdf";
import { cellAt, tableText, type Table } from "@/lib/rfp/document-model";
import { detectFormat, parseDocumentAsync } from "@/lib/rfp/parse";
import { extractStandard, isStandardFormat } from "@/lib/rfp/extract-standard";
import { UnsupportedDocumentError } from "@/lib/rfp/document-model";

const NUL = String.fromCharCode(0);

/** 글자 폭 대신 글자 수 × 비율로 x1을 잡는 조각 만들기 도우미 */
function frag(x: number, y: number, text: string, h = 11): TextFrag {
  return { x0: x, x1: x + text.length * h * 0.5, y, h, text, blank: !text.trim() };
}

/**
 * 최소 PDF 한 장(표준 폰트 Helvetica, 폰트 내장 없음).
 * unpdf 연동과 좌표 추출이 실제로 되는지 보기 위한 픽스처라 아스키만 쓴다.
 */
function onePagePdf(items: { x: number; y: number; text: string }[]): Buffer {
  const content = items.map((i) => `BT /F1 11 Tf 1 0 0 1 ${i.x} ${i.y} Tm (${i.text}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

describe("cleanPdfText", () => {
  it("제어문자를 공백으로 바꾸고 이어진 공백을 접는다", () => {
    // 한/글 PDF는 낱말 사이가 NUL로 나온다 — 그대로 두면 라벨 비교가 어긋나고 Postgres 저장도 실패한다
    expect(cleanPdfText(`요구사항${NUL} 분류`)).toBe("요구사항 분류");
    expect(cleanPdfText(`대전광역시${NUL}${NUL}서구`)).toBe("대전광역시 서구");
    expect(cleanPdfText("A\tB")).toBe("A B");
  });

  it("줄바꿈은 남긴다(세부 내용 글머리 구분에 필요)", () => {
    expect(cleanPdfText("○ 첫째\n○ 둘째")).toBe("○ 첫째\n○ 둘째");
  });
});

describe("groupLines", () => {
  it("기준선 y가 비슷하면 한 줄로 묶고 x 순으로 정렬한다", () => {
    const lines = groupLines([frag(200, 700, "값"), frag(100, 700.4, "라벨"), frag(100, 680, "다음 줄")]);
    expect(lines.map((l) => l.frags.map((f) => f.text))).toEqual([["라벨", "값"], ["다음 줄"]]);
  });
});

describe("splitLineCells", () => {
  it("가로로 크게 벌어지면 다른 칸으로 끊는다", () => {
    const line = groupLines([frag(100, 700, "요구사항 분류"), frag(250, 700, "기능 요구사항")])[0];
    expect(splitLineCells(line).map((c) => c.text)).toEqual(["요구사항 분류", "기능 요구사항"]);
  });

  it("붙어 있는 조각은 한 칸으로 이어 붙인다(글자마다 조각을 내는 PDF)", () => {
    const a = frag(100, 700, "사용자");
    const b = { ...frag(a.x1, 700, "관리"), x0: a.x1 };
    expect(splitLineCells(groupLines([a, b])[0]).map((c) => c.text)).toEqual(["사용자관리"]);
  });

  it("낱말만큼 벌어진 조각 사이에는 공백을 넣는다", () => {
    const a = frag(100, 700, "사용자");
    const b = { ...frag(a.x1 + 4, 700, "관리"), x0: a.x1 + 4 };
    expect(splitLineCells(groupLines([a, b])[0]).map((c) => c.text)).toEqual(["사용자 관리"]);
  });

  it("넓은 공백 조각은 칸 구분 신호로 쓰고 텍스트로는 쓰지 않는다", () => {
    const a = frag(100, 700, "구분");
    const gap: TextFrag = { x0: a.x1, x1: a.x1 + 20, y: 700, h: 11, text: " ", blank: true };
    const b: TextFrag = { x0: a.x1 + 4, x1: a.x1 + 30, y: 700, h: 11, text: "용역", blank: false };
    expect(splitLineCells(groupLines([a, gap, b])[0]).map((c) => c.text)).toEqual(["구분", "용역"]);
  });
});

describe("columnRanges / columnOf", () => {
  it("칸 수가 가장 많은 줄들로 열을 잡고, 칸이 모자란 줄은 x로 열을 찾는다", () => {
    const rows = [
      [{ x0: 60, x1: 120, text: "구분" }, { x0: 240, x1: 300, text: "부여규칙" }, { x0: 400, x1: 460, text: "건수" }],
      [{ x0: 400, x1: 410, text: "3" }],
    ];
    const cols = columnRanges(rows);
    expect(cols.length).toBe(3);
    // 병합·빈 칸으로 칸이 모자란 줄도 셋째 열로 들어간다(왼쪽으로 밀리지 않는다)
    expect(columnOf(rows[1][0], cols)).toBe(2);
  });
});

describe("blocksFromLines", () => {
  const reqTableLines = (y0: number, reqId: string) =>
    [
      ["요구사항 분류", "기능 요구사항"],
      ["요구사항 고유번호", reqId],
      ["요구사항 명칭", "사용자 관리"],
      ["정의", "계정을 관리한다."],
      ["세부 내용", "○ 등록·수정·삭제"],
      ["산출정보", "요구사항정의서"],
      ["관련 요구사항", "-"],
    ].flatMap((row, i) => [frag(100, y0 - i * 20, row[0]), frag(250, y0 - i * 20, row[1])]);

  it("2칸 줄이 이어지면 표, 첫 열보다 오른쪽에 있는 1칸 줄은 앞 칸에 이어 붙인다", () => {
    // 앞 5행(마지막이 y=620의 "세부 내용")까지 두고, 그 아래에 이어지는 줄을 붙인다
    const lines = groupLines([
      ...reqTableLines(700, "SFR-001").slice(0, 10),
      frag(250, 607, "○ 둘째 항목"),
      frag(250, 594, "○ 셋째 항목"),
    ]);
    const blocks = blocksFromLines(lines);
    expect(blocks.length).toBe(1);
    const t = blocks[0] as Table;
    expect(t.type).toBe("table");
    // 이어지는 줄은 줄바꿈으로 붙어야 세부 항목(글머리) 분해가 된다
    expect(cellAt(t, 4, 1)?.text).toBe("○ 등록·수정·삭제\n○ 둘째 항목\n○ 셋째 항목");
  });

  it("줄 간격이 튀면 잇달아 붙은 두 표를 나눈다", () => {
    // 표 사이에 제목 줄이 없어도 간격만으로 갈라야 한다 — 안 그러면 뒤 요구사항이 통째로 사라진다
    const blocks = blocksFromLines(groupLines([...reqTableLines(700, "SFR-001"), ...reqTableLines(520, "SFR-002")]));
    const tables = blocks.filter((b): b is Table => b.type === "table");
    expect(tables.length).toBe(2);
    expect(cellAt(tables[0], 1, 1)?.text).toBe("SFR-001");
    expect(cellAt(tables[1], 1, 1)?.text).toBe("SFR-002");
  });

  it("첫 열에 걸리는 1칸 줄은 표를 끝내고 문단이 된다", () => {
    const blocks = blocksFromLines(groupLines([...reqTableLines(700, "SFR-001"), frag(100, 540, "2. 보안 요구사항")]));
    expect(blocks.map((b) => b.type)).toEqual(["table", "paragraph"]);
  });

  it("복원한 표에서 표준 7행 규칙 추출이 그대로 동작한다", () => {
    const doc = { format: "pdf" as const, blocks: blocksFromLines(groupLines(reqTableLines(700, "SFR-001"))) };
    expect(isStandardFormat(doc)).toBe(true);
    const r = extractStandard(doc);
    expect(r.method).toBe("standard");
    expect(r.requirements.map((q) => [q.categoryCode, q.reqId, q.title])).toEqual([["SFR", "SFR-001", "사용자 관리"]]);
    expect(r.requirements[0].details).toBe("○ 등록·수정·삭제");
  });
});

describe("parsePdf", () => {
  it("실제 PDF에서 좌표를 읽어 표를 복원한다", async () => {
    const buf = onePagePdf([
      { x: 100, y: 700, text: "Category" },
      { x: 250, y: 700, text: "Functional" },
      { x: 100, y: 680, text: "Number" },
      { x: 250, y: 680, text: "SFR-001" },
      { x: 100, y: 640, text: "Plain paragraph line" },
    ]);
    expect(detectFormat(buf, "a.pdf")).toBe("pdf");
    const doc = await parseDocumentAsync(buf, "a.pdf");
    expect(doc.format).toBe("pdf");
    const t = doc.blocks[0] as Table;
    expect(tableText(t)).toBe("| Category | Functional |\n| Number | SFR-001 |");
    expect(doc.blocks[1]).toEqual({ type: "paragraph", text: "Plain paragraph line" });
  });

  it("글자가 없는 PDF(스캔본)는 안내와 함께 거절한다", async () => {
    await expect(parsePdf(onePagePdf([]))).rejects.toThrow(UnsupportedDocumentError);
    await expect(parsePdf(onePagePdf([]))).rejects.toThrow(/스캔한 이미지/);
  });

  it("PDF가 아닌 내용을 pdf 확장자로 올리면 거절한다", () => {
    expect(() => detectFormat(Buffer.from("not a pdf"), "a.pdf")).toThrow(UnsupportedDocumentError);
  });

  it("내용이 PDF인데 확장자가 다르면 거절한다", () => {
    expect(() => detectFormat(onePagePdf([{ x: 10, y: 10, text: "x" }]), "a.docx")).toThrow(/확장자가 다릅니다/);
  });
});
