import { unzipSync, strFromU8 } from "fflate";
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel, type Paragraph, type Table } from "./document-model";
import { parseXml, tagOf, childrenOf, attrsOf, findChild, findChildren, type XmlNode } from "./xml-utils";

/** hp:p 하나 → 문단 텍스트(비어 있지 않으면) + 그 안의 표들. 표는 앵커 문단 뒤에 온다(HWP 바이너리와 같은 순서). */
function paragraphBlocks(p: XmlNode): Block[] {
  const out: Block[] = [];
  const text = paragraphText(p);
  if (text.trim()) out.push({ type: "paragraph", text });
  for (const run of findChildren(p, "hp:run")) {
    for (const tbl of findChildren(run, "hp:tbl")) out.push(tableOf(tbl));
  }
  return out;
}

function paragraphText(p: XmlNode): string {
  let s = "";
  for (const run of findChildren(p, "hp:run")) {
    for (const t of findChildren(run, "hp:t")) {
      for (const ch of childrenOf(t)) {
        const tag = tagOf(ch);
        if (tag === "#text") s += String(ch["#text"]);
        else if (tag === "hp:lineBreak") s += "\n";
        else if (tag === "hp:tab") s += " ";
      }
    }
  }
  return s;
}

function tableOf(tbl: XmlNode): Table {
  const a = attrsOf(tbl);
  const cells: Cell[] = [];
  for (const tr of findChildren(tbl, "hp:tr")) {
    for (const tc of findChildren(tr, "hp:tc")) {
      const addrNode = findChild(tc, "hp:cellAddr");
      const spanNode = findChild(tc, "hp:cellSpan");
      const addr = addrNode ? attrsOf(addrNode) : {};
      const span = spanNode ? attrsOf(spanNode) : {};
      const sub = findChild(tc, "hp:subList");
      const inner: Block[] = sub ? findChildren(sub, "hp:p").flatMap(paragraphBlocks) : [];
      cells.push({
        row: Number(addr.rowAddr ?? 0),
        col: Number(addr.colAddr ?? 0),
        rowSpan: Math.max(1, Number(span.rowSpan ?? 1)),
        colSpan: Math.max(1, Number(span.colSpan ?? 1)),
        text: inner.filter((b): b is Paragraph => b.type === "paragraph").map((b) => b.text).join("\n"),
        tables: inner.filter((b): b is Table => b.type === "table"),
      });
    }
  }
  const rows = a.rowCnt ? Number(a.rowCnt) : Math.max(0, ...cells.map((c) => c.row + c.rowSpan));
  const cols = a.colCnt ? Number(a.colCnt) : Math.max(0, ...cells.map((c) => c.col + c.colSpan));
  return { type: "table", rows, cols, cells };
}

function sectionBlocks(root: XmlNode[]): Block[] {
  const sec = root.find((n) => tagOf(n) === "hs:sec") ?? root.find((n) => tagOf(n) !== "?xml");
  if (!sec) return [];
  return findChildren(sec, "hp:p").flatMap(paragraphBlocks);
}

/** HWPX(zip + OWPML) → DocumentModel */
export function parseHwpx(buf: Buffer): DocumentModel {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new UnsupportedDocumentError("HWPX(zip) 파일을 열 수 없습니다.");
  }
  const names = Object.keys(files)
    .map((n) => ({ n, m: /^Contents\/section(\d+)\.xml$/.exec(n) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  if (!names.length) throw new UnsupportedDocumentError("HWPX 본문(Contents/section*.xml)이 없습니다.");
  const blocks: Block[] = [];
  for (const { n } of names) blocks.push(...sectionBlocks(parseXml(strFromU8(files[n]))));
  return { format: "hwpx", blocks };
}
