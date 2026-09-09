// @vitest-environment node
// pdf.js(unpdf)는 브라우저 흉내를 내는 jsdom에서 워커를 찾으려 하므로 node 환경에서 돈다.
import { describe, expect, it } from "vitest";
import {
  blocksFromPage,
  buildGrid,
  cleanPdfText,
  fragsOfPage,
  groupLines,
  joinFrags,
  outerEdges,
  parsePdf,
  ruleClusters,
  rulesFromOperatorList,
  snapValues,
  type PageRules,
  type Rect,
  type TextFrag,
} from "@/lib/rfp/parse-pdf";
import { cellAt, tableText, UnsupportedDocumentError, type Table } from "@/lib/rfp/document-model";
import { detectFormat, parseDocumentAsync } from "@/lib/rfp/parse";
import { extractStandard, isStandardFormat } from "@/lib/rfp/extract-standard";

const NUL = String.fromCharCode(0);

/** 글자 폭은 글자 수 × 높이 절반으로 어림한다(실제 폰트 대신) */
function frag(x: number, y: number, text: string, h = 11): TextFrag {
  return { x0: x, x1: x + text.length * h * 0.5, y, h, text };
}
const hLine = (x0: number, x1: number, y: number): Rect => ({ x0, x1, y0: y - 0.25, y1: y + 0.25 });
const vLine = (x: number, y0: number, y1: number): Rect => ({ x0: x - 0.25, x1: x + 0.25, y0, y1 });

/**
 * 최소 PDF 한 장(표준 폰트 Helvetica, 폰트 내장 없음).
 * 괘선은 얇은 사각형 채우기(`re f`)로 그린다 — 한/글·크롬이 테두리를 그리는 방식과 같다.
 */
function onePagePdf(items: { x: number; y: number; text: string }[], rects: [number, number, number, number][] = []): Buffer {
  const content = [
    ...rects.map(([x, y, w, h]) => `${x} ${y} ${w} ${h} re f`),
    ...items.map((i) => `BT /F1 11 Tf 1 0 0 1 ${i.x} ${i.y} Tm (${i.text}) Tj ET`),
  ].join("\n");
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

describe("groupLines / joinFrags", () => {
  it("기준선 y가 비슷하면 한 줄로 묶고 x 순으로 정렬한다", () => {
    const lines = groupLines([frag(200, 700, "값"), frag(100, 700.4, "라벨"), frag(100, 680, "다음 줄")]);
    expect(lines.map((l) => l.frags.map((f) => f.text))).toEqual([["라벨", "값"], ["다음 줄"]]);
  });

  it("붙어 있는 조각은 그대로, 벌어진 조각 사이에는 공백 하나", () => {
    const a = frag(100, 700, "사용자");
    expect(joinFrags([a, { ...frag(a.x1, 700, "관리"), x0: a.x1 }])).toBe("사용자관리");
    expect(joinFrags([a, { ...frag(a.x1 + 4, 700, "관리"), x0: a.x1 + 4 }])).toBe("사용자 관리");
  });
});

describe("snapValues / outerEdges", () => {
  it("가까운 좌표는 하나로 묶는다", () => {
    expect(snapValues([100, 101, 300, 300.5, 99])).toEqual([99, 300]);
  });

  it("두 줄 이상이 같은 끝에 닿을 때만 바깥 경계로 인정한다", () => {
    // 가로줄만 있고 좌우 테두리를 안 그린 표: 가로줄들의 양 끝이 첫·마지막 열 경계다
    expect(outerEdges([[55, 543], [55, 543], [55, 543]])).toEqual([55, 543]);
    // 표 위에 걸친 장식 선 하나 때문에 없는 열이 생기면 안 된다
    expect(outerEdges([[10, 543], [55, 543], [55, 543]])).toEqual([543]);
  });
});

describe("ruleClusters", () => {
  it("서로 닿는 선끼리 묶고, 가로·세로선이 2개 이상인 덩어리만 표로 본다", () => {
    const rules: PageRules = {
      horizontal: [hLine(100, 400, 700), hLine(100, 400, 600), hLine(50, 200, 300)],
      vertical: [vLine(100, 600, 700), vLine(400, 600, 700), vLine(60, 290, 310)],
    };
    const clusters = ruleClusters(rules);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].horizontal).toHaveLength(2);
    expect(clusters[0].vertical).toHaveLength(2);
  });
});

describe("buildGrid", () => {
  it("경계에 선이 없으면 셀이 이어진 것(병합)으로 본다", () => {
    // 위 행만 가운데 세로선이 있다 → 아래 행은 가로 병합, 첫 열은 가운데 가로선이 없어 세로 병합
    const grid = buildGrid({
      horizontal: [hLine(100, 400, 700), hLine(200, 400, 660), hLine(100, 400, 600)],
      vertical: [vLine(100, 600, 700), vLine(200, 600, 700), vLine(400, 600, 700)],
    })!;
    expect([grid.rows, grid.cols]).toEqual([2, 3 - 1]);
    const c00 = grid.cells.find((c) => c.row === 0 && c.col === 0)!;
    expect([c00.rowSpan, c00.colSpan]).toEqual([2, 1]);
    const c01 = grid.cells.find((c) => c.row === 0 && c.col === 1)!;
    expect([c01.rowSpan, c01.colSpan]).toEqual([1, 1]);
    expect(grid.cells.some((c) => c.row === 1 && c.col === 1)).toBe(true);
  });

  it("좌우 테두리를 안 그린 표도 가로선 끝으로 열을 잡는다", () => {
    const grid = buildGrid({
      horizontal: [hLine(55, 543, 663), hLine(55, 543, 637), hLine(55, 543, 581)],
      vertical: [vLine(232, 581, 663), vLine(508, 581, 663)],
    })!;
    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(2);
  });
});

describe("blocksFromPage", () => {
  it("괘선 안 글자는 셀, 밖 글자는 문단이고 위에서 아래 순서로 나온다", () => {
    const frags = [
      frag(110, 670, "요구사항 번호"),
      frag(210, 670, "ECR-001"),
      frag(110, 620, "이어진 칸"),
      frag(100, 550, "본문 왼쪽"),
      frag(300, 550, "본문 오른쪽"),
    ];
    const rules: PageRules = {
      horizontal: [hLine(100, 400, 700), hLine(100, 400, 650), hLine(100, 400, 600)],
      // 가운데 세로선은 위 행에만 있다 → 아래 행은 두 열이 한 칸(가로 병합)
      vertical: [vLine(100, 600, 700), vLine(200, 650, 700), vLine(400, 600, 700)],
    };
    const blocks = blocksFromPage(frags, rules);
    expect(blocks.map((b) => b.type)).toEqual(["table", "paragraph"]);
    const t = blocks[0] as Table;
    expect(tableText(t)).toBe("| 요구사항 번호 | ECR-001 |\n| 이어진 칸 |  |");
    // 자간·탭으로 벌어진 본문은 표가 아니라 한 문단이어야 한다(괘선이 없으므로)
    expect(blocks[1]).toEqual({ type: "paragraph", text: "본문 왼쪽 본문 오른쪽" });
  });

  it("한 셀에 여러 줄이 있으면 줄바꿈으로 잇는다(세부 내용 글머리 유지)", () => {
    const frags = [frag(110, 690, "○ 첫째 항목"), frag(110, 670, "○ 둘째 항목"), frag(120, 650, "- 하위 항목")];
    const blocks = blocksFromPage(frags, {
      horizontal: [hLine(100, 400, 700), hLine(100, 400, 600)],
      vertical: [vLine(100, 600, 700), vLine(400, 600, 700)],
    });
    expect((blocks[0] as Table).cells[0].text).toBe("○ 첫째 항목\n○ 둘째 항목\n- 하위 항목");
  });

  it("괘선이 없으면 표를 만들지 않는다", () => {
    const blocks = blocksFromPage([frag(100, 700, "사 업 명 : KEPCO형 AI 인프라 구축 사업")], { horizontal: [], vertical: [] });
    expect(blocks).toEqual([{ type: "paragraph", text: "사 업 명 : KEPCO형 AI 인프라 구축 사업" }]);
  });
});

describe("rulesFromOperatorList", () => {
  it("변환행렬(save·transform·restore)을 따라가며 얇고 긴 경로만 선으로 뽑는다", () => {
    const ops = { save: 10, restore: 11, transform: 12, constructPath: 91 };
    const fn = [ops.save, ops.transform, ops.constructPath, ops.constructPath, ops.restore, ops.constructPath];
    const args = [
      null,
      [0.5, 0, 0, -0.5, 0, 800], // 페이지 전체에 축척·뒤집기를 걸어 둔 문서
      [0, [], [100, 100, 500, 102]], // → 가로선 (x 50~250, 두께 1)
      [0, [], [100, 100, 500, 600]], // → 큰 상자(그림 틀 등)는 버린다
      null,
      [0, [], [10, 10, 12, 200]], // restore 후 변환 없음 → 세로선
    ];
    const rules = rulesFromOperatorList(fn, args, ops);
    expect(rules.horizontal).toHaveLength(1);
    expect(rules.vertical).toHaveLength(1);
    expect(rules.horizontal[0].x0).toBeCloseTo(50);
    expect(rules.horizontal[0].y1).toBeCloseTo(750);
    expect(rules.vertical[0].y1).toBeCloseTo(200);
  });
});

describe("fragsOfPage", () => {
  it("회전된 글자와 빈 조각은 버린다", () => {
    const items = [
      { str: "정상", width: 20, height: 11, transform: [11, 0, 0, 11, 100, 700] },
      { str: "회전", width: 20, height: 11, transform: [0, 11, -11, 0, 100, 700] },
      { str: " ", width: 5, height: 11, transform: [11, 0, 0, 11, 130, 700] },
    ];
    expect(fragsOfPage(items).map((f) => f.text)).toEqual(["정상"]);
  });
});

describe("parsePdf", () => {
  it("실제 PDF에서 괘선과 글자를 읽어 표를 복원한다", async () => {
    const buf = onePagePdf(
      [
        { x: 110, y: 670, text: "Label" },
        { x: 210, y: 670, text: "Value" },
        { x: 110, y: 620, text: "Merged row" },
        { x: 100, y: 500, text: "Body paragraph" },
      ],
      [
        [100, 699.75, 300, 0.5], // 위 테두리
        [100, 659.75, 300, 0.5], // 가운데 가로선
        [100, 599.75, 300, 0.5], // 아래 테두리
        [99.75, 600, 0.5, 100], // 왼쪽 테두리
        [199.75, 660, 0.5, 40], // 가운데 세로선(위 행만 → 아래 행은 가로 병합)
        [399.75, 600, 0.5, 100], // 오른쪽 테두리
      ],
    );
    expect(detectFormat(buf, "a.pdf")).toBe("pdf");
    const doc = await parseDocumentAsync(buf, "a.pdf");
    expect(doc.format).toBe("pdf");
    const t = doc.blocks[0] as Table;
    expect([t.rows, t.cols]).toEqual([2, 2]);
    expect(cellAt(t, 0, 0)?.text).toBe("Label");
    expect(cellAt(t, 0, 1)?.text).toBe("Value");
    // 아래 행은 가운데 세로선이 없어 두 열이 한 칸이다
    expect(cellAt(t, 1, 1)?.text).toBe("Merged row");
    expect(cellAt(t, 1, 1)?.colSpan).toBe(2);
    expect(doc.blocks[1]).toEqual({ type: "paragraph", text: "Body paragraph" });
  });

  it("복원한 표로 표준 7행 규칙 추출이 동작한다", async () => {
    // 라벨 | 값 2열 표 7행(요구사항 표) — 괘선을 모두 그린다
    const rows = [
      ["Category", "SFR"],
      ["ReqId", "SFR-001"],
      ["Title", "Login"],
    ];
    const rects: [number, number, number, number][] = [[99.75, 600, 0.5, 100], [199.75, 600, 0.5, 100], [399.75, 600, 0.5, 100]];
    const items: { x: number; y: number; text: string }[] = [];
    rows.forEach((row, i) => {
      const top = 700 - i * 33;
      rects.push([100, top - 0.25, 300, 0.5]);
      items.push({ x: 110, y: top - 22, text: row[0] }, { x: 210, y: top - 22, text: row[1] });
    });
    rects.push([100, 599.75, 300, 0.5]);
    const doc = await parsePdf(onePagePdf(items, rects));
    const t = doc.blocks[0] as Table;
    expect(t.rows).toBe(3);
    expect(tableText(t).split("\n")[1]).toBe("| ReqId | SFR-001 |");
    // 한글 라벨이 아니어서 표준 추출은 되지 않는다 — 격자 복원만 확인한다
    expect(isStandardFormat(doc)).toBe(false);
    expect(extractStandard(doc).requirements).toHaveLength(0);
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
