import { unzipSync, strFromU8 } from "fflate";
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel, type Paragraph, type Table } from "./document-model";
import { parseXml, tagOf, childrenOf, attrsOf, findChild, findChildren, textOf, type XmlNode } from "./xml-utils";

/** 문단 텍스트: w:t 텍스트, w:br/w:cr 줄바꿈, w:tab 공백. 하이퍼링크·변경추적 삽입 등은 안으로 들어간다. */
function paragraphText(p: XmlNode): string {
  let s = "";
  const walk = (n: XmlNode) => {
    for (const ch of childrenOf(n)) {
      const tag = tagOf(ch);
      if (tag === "w:t") s += textOf(ch);
      else if (tag === "w:br" || tag === "w:cr") s += "\n";
      else if (tag === "w:tab") s += " ";
      else if (tag === "w:r" || tag === "w:hyperlink" || tag === "w:smartTag" || tag === "w:ins" || tag === "w:sdt" || tag === "w:sdtContent" || tag === "w:fldSimple") walk(ch);
    }
  };
  walk(p);
  return s;
}

/** 컨테이너(w:body, w:tc, w:sdtContent) 안의 문단·표를 순서대로 */
function containerBlocks(container: XmlNode): Block[] {
  const out: Block[] = [];
  for (const ch of childrenOf(container)) {
    const tag = tagOf(ch);
    if (tag === "w:p") {
      const t = paragraphText(ch);
      if (t.trim()) out.push({ type: "paragraph", text: t });
    } else if (tag === "w:tbl") {
      out.push(tableOf(ch));
    } else if (tag === "w:sdt") {
      const content = findChild(ch, "w:sdtContent");
      if (content) out.push(...containerBlocks(content));
    }
  }
  return out;
}

function tableOf(tbl: XmlNode): Table {
  const grid = findChild(tbl, "w:tblGrid");
  const gridCols = grid ? findChildren(grid, "w:gridCol").length : 0;
  const cells: Cell[] = [];
  const trs = findChildren(tbl, "w:tr");
  trs.forEach((tr, r) => {
    let col = 0;
    for (const tc of findChildren(tr, "w:tc")) {
      const pr = findChild(tc, "w:tcPr");
      const spanNode = pr ? findChild(pr, "w:gridSpan") : undefined;
      const colSpan = Math.max(1, Number(spanNode ? attrsOf(spanNode)["w:val"] ?? 1 : 1) || 1);
      const vm = pr ? findChild(pr, "w:vMerge") : undefined;
      const vmVal = vm ? (attrsOf(vm)["w:val"] ?? "continue") : null;
      if (vmVal === "continue") {
        // 위 셀에 합쳐진 셀: 새 셀을 만들지 않고 위 셀의 rowSpan을 늘린다
        const above = cells.find((c) => c.col === col && c.row + c.rowSpan === r);
        if (above) above.rowSpan += 1;
      } else {
        const inner = containerBlocks(tc);
        cells.push({
          row: r,
          col,
          rowSpan: 1,
          colSpan,
          text: inner.filter((b): b is Paragraph => b.type === "paragraph").map((b) => b.text).join("\n"),
          tables: inner.filter((b): b is Table => b.type === "table"),
        });
      }
      col += colSpan;
    }
  });
  const cols = Math.max(gridCols, 0, ...cells.map((c) => c.col + c.colSpan));
  return { type: "table", rows: trs.length, cols, cells };
}

/** DOCX(zip + WordprocessingML) → DocumentModel */
export function parseDocx(buf: Buffer): DocumentModel {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new UnsupportedDocumentError("DOCX(zip) 파일을 열 수 없습니다.");
  }
  const xml = files["word/document.xml"];
  if (!xml) throw new UnsupportedDocumentError("DOCX 본문(word/document.xml)이 없습니다.");
  const root = parseXml(strFromU8(xml));
  const document = root.find((n) => tagOf(n) === "w:document");
  const body = document ? findChild(document, "w:body") : undefined;
  if (!body) throw new UnsupportedDocumentError("DOCX 본문(w:body)이 없습니다.");
  return { format: "docx", blocks: containerBlocks(body) };
}
