import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseDocx } from "@/lib/rfp/parse-docx";
import { cellAt, topLevelTables, paragraphTexts, UnsupportedDocumentError } from "@/lib/rfp/document-model";

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t xml:space="preserve"> □ 사업명 : 테스트 사업</w:t></w:r></w:p>
<w:p><w:r><w:t>첫 줄</w:t><w:br/><w:t>둘째 줄</w:t></w:r></w:p>
<w:tbl><w:tblGrid><w:gridCol w:w="1"/><w:gridCol w:w="1"/><w:gridCol w:w="1"/></w:tblGrid>
 <w:tr>
  <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>요구사항 분류</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>서비스</w:t></w:r></w:p></w:tc>
 </w:tr>
 <w:tr>
  <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
  <w:tc><w:p><w:r><w:t>정의</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t>값</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>중첩</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc>
 </w:tr>
</w:tbl>
<w:sectPr/></w:body></w:document>`;

function docxZip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v);
  return Buffer.from(zipSync(entries));
}

describe("parseDocx", () => {
  const doc = parseDocx(docxZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": DOCUMENT }));
  it("문단·공백 보존·줄바꿈", () => {
    expect(doc.format).toBe("docx");
    expect(paragraphTexts(doc)).toEqual([" □ 사업명 : 테스트 사업", "첫 줄\n둘째 줄"]);
  });
  it("표: gridSpan → colSpan, vMerge → rowSpan, 중첩 표", () => {
    const t = topLevelTables(doc)[0];
    expect([t.rows, t.cols, t.cells.length]).toEqual([2, 3, 4]);
    expect(cellAt(t, 0, 0)).toMatchObject({ row: 0, col: 0, rowSpan: 2, colSpan: 1, text: "요구사항 분류" });
    expect(cellAt(t, 0, 2)).toMatchObject({ row: 0, col: 1, colSpan: 2, text: "서비스" });
    expect(cellAt(t, 1, 1)?.text).toBe("정의");
    const c12 = cellAt(t, 1, 2)!;
    expect(c12.text).toBe("값");
    expect(c12.tables[0].cells[0].text).toBe("중첩");
  });
  it("word/document.xml이 없으면 UnsupportedDocumentError", () => {
    expect(() => parseDocx(docxZip({ "word/styles.xml": "<w:styles/>" }))).toThrow(UnsupportedDocumentError);
  });
});
