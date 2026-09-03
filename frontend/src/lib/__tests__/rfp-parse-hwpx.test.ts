import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseHwpx } from "@/lib/rfp/parse-hwpx";
import { parseXml, tagOf, childrenOf, attrsOf, findChild, findChildren, textOf } from "@/lib/rfp/xml-utils";
import { cellAt, topLevelTables, paragraphTexts, UnsupportedDocumentError } from "@/lib/rfp/document-model";

const SECTION = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t> □ 사업명 : 테스트 사업</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>첫 줄<hp:lineBreak/>둘째 줄</hp:t></hp:run></hp:p>
  <hp:p><hp:run>
    <hp:tbl rowCnt="2" colCnt="2">
      <hp:tr>
        <hp:tc><hp:subList><hp:p><hp:run><hp:t>요구사항 분류</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="2"/></hp:tc>
        <hp:tc><hp:subList><hp:p><hp:run><hp:t>서비스</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc><hp:subList>
          <hp:p><hp:run><hp:t>둘째 행</hp:t></hp:run></hp:p>
          <hp:p><hp:run><hp:tbl rowCnt="1" colCnt="1"><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>중첩</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
        </hp:subList><hp:cellAddr colAddr="1" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>
      </hp:tr>
    </hp:tbl>
  </hp:run></hp:p>
</hs:sec>`;

function hwpxZip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v);
  return Buffer.from(zipSync(entries));
}

describe("xml-utils", () => {
  it("preserveOrder 노드를 태그·자식·속성·텍스트로 읽는다", () => {
    const root = parseXml(`<a x="1"><b>hi</b><b>yo</b><c/></a>`);
    const a = root[0];
    expect(tagOf(a)).toBe("a");
    expect(attrsOf(a)).toEqual({ x: "1" });
    expect(findChildren(a, "b").map(textOf)).toEqual(["hi", "yo"]);
    expect(findChild(a, "c")).toBeDefined();
    expect(childrenOf(findChild(a, "c")!)).toEqual([]);
    expect(textOf(a)).toBe("hiyo");
  });
});

describe("parseHwpx", () => {
  const doc = parseHwpx(hwpxZip({ "Contents/content.hpf": "<opf:package/>", "Contents/section0.xml": SECTION }));
  it("문단과 줄바꿈", () => {
    expect(doc.format).toBe("hwpx");
    expect(paragraphTexts(doc)).toEqual([" □ 사업명 : 테스트 사업", "첫 줄\n둘째 줄"]);
  });
  it("표·병합·중첩 표", () => {
    const tables = topLevelTables(doc);
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect([t.rows, t.cols, t.cells.length]).toEqual([2, 2, 3]);
    expect(cellAt(t, 1, 0)?.text).toBe("요구사항 분류");
    expect(cellAt(t, 0, 0)?.rowSpan).toBe(2);
    const c11 = cellAt(t, 1, 1)!;
    expect(c11.text).toBe("둘째 행");
    expect(c11.tables).toHaveLength(1);
    expect(c11.tables[0].cells[0].text).toBe("중첩");
  });
  it("여러 섹션은 번호순으로 이어 붙인다", () => {
    const two = parseHwpx(hwpxZip({
      "Contents/section1.xml": SECTION.replace("테스트 사업", "둘째 섹션"),
      "Contents/section0.xml": SECTION,
    }));
    const names = paragraphTexts(two).filter((p) => p.includes("사업명"));
    expect(names[0]).toContain("테스트 사업");
    expect(names[1]).toContain("둘째 섹션");
  });
  it("본문이 없으면 UnsupportedDocumentError", () => {
    expect(() => parseHwpx(hwpxZip({ "mimetype": "application/hwp+zip" }))).toThrow(UnsupportedDocumentError);
  });
});
