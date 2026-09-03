import CFB from "cfb";
import { inflateRawSync } from "node:zlib";
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel, type Table } from "./document-model";

/** HWP 5.x 레코드 태그(HWPTAG_BEGIN=16 기준) */
const TAG = { PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77 } as const;
/** 확장 컨트롤(뒤 14바이트에 컨트롤 정보) — 문자 8개(16바이트) 차지 */
const EXT_CTRL = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
/** 인라인 컨트롤 — 역시 16바이트 */
const INLINE_CTRL = new Set([4, 5, 6, 7, 8, 9, 19, 20]);

interface HwpRecord {
  tag: number;
  level: number;
  data: Buffer;
}

function* records(buf: Buffer): Generator<HwpRecord> {
  let off = 0;
  while (off + 4 <= buf.length) {
    const h = buf.readUInt32LE(off);
    off += 4;
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) {
      size = buf.readUInt32LE(off);
      off += 4;
    }
    yield { tag, level, data: buf.subarray(off, off + size) };
    off += size;
  }
}

/** PARA_TEXT(UTF-16LE + 컨트롤 문자) → 문자열 */
export function decodeParaText(data: Buffer): string {
  let s = "";
  for (let i = 0; i + 1 < data.length; ) {
    const c = data.readUInt16LE(i);
    if (EXT_CTRL.has(c) || INLINE_CTRL.has(c)) {
      i += 16;
      continue;
    }
    i += 2;
    if (c === 13) continue; // 문단 끝
    if (c === 10) {
      s += "\n";
      continue;
    }
    if (c === 24) {
      s += "-";
      continue;
    }
    if (c === 30 || c === 31) {
      s += " ";
      continue;
    }
    if (c < 32) continue;
    s += String.fromCharCode(c);
  }
  return s;
}

interface OpenTable {
  level: number;
  table: Table;
  cell: Cell | null;
}

function parseSection(buf: Buffer): Block[] {
  const blocks: Block[] = [];
  const stack: OpenTable[] = [];
  let pendingCtrl: string | null = null;

  for (const r of records(buf)) {
    // 표는 레코드 level이 표 level보다 낮아질 때 끝난다(셀 문단 헤더는 셀 헤더와 같은 level이므로 "<="로 하면 일찍 닫힌다)
    while (stack.length && r.level < stack[stack.length - 1].level) stack.pop();
    const top = stack[stack.length - 1];

    if (r.tag === TAG.CTRL_HEADER) {
      pendingCtrl = Buffer.from(r.data.subarray(0, 4)).reverse().toString("latin1");
    } else if (r.tag === TAG.TABLE && pendingCtrl === "tbl ") {
      const table: Table = { type: "table", rows: r.data.readUInt16LE(4), cols: r.data.readUInt16LE(6), cells: [] };
      if (top && top.cell) top.cell.tables.push(table);
      else blocks.push(table);
      stack.push({ level: r.level, table, cell: null });
      pendingCtrl = null;
    } else if (r.tag === TAG.LIST_HEADER) {
      // LIST_HEADER 공통 헤더는 paragraphs(UINT16) + unknown1(UINT16) + listflags(UINT32) = 8바이트다.
      // (paraCount(2)+property(4)=6바이트로 보면 col이 listflags 상위 16비트를 가리켜 값이 널뛴다.)
      // 표 셀 전용 필드(col/row/colSpan/rowSpan, 각 UINT16)는 그 뒤 offset 8부터 시작한다.
      if (top && r.level === top.level && r.data.length >= 16) {
        const cell: Cell = {
          col: r.data.readUInt16LE(8),
          row: r.data.readUInt16LE(10),
          colSpan: Math.max(1, r.data.readUInt16LE(12)),
          rowSpan: Math.max(1, r.data.readUInt16LE(14)),
          text: "",
          tables: [],
        };
        top.table.cells.push(cell);
        top.cell = cell;
      }
    } else if (r.tag === TAG.PARA_TEXT) {
      const t = decodeParaText(r.data);
      if (top && top.cell && r.level > top.level) top.cell.text = top.cell.text ? `${top.cell.text}\n${t}` : t;
      else if (!top) blocks.push({ type: "paragraph", text: t });
    }
  }
  return blocks;
}

/** HWP 5.x(OLE) → DocumentModel. 암호화·배포용 문서는 UnsupportedDocumentError. */
export function parseHwp(buf: Buffer): DocumentModel {
  let cfb: ReturnType<typeof CFB.read>;
  try {
    cfb = CFB.read(buf, { type: "buffer" });
  } catch {
    throw new UnsupportedDocumentError("HWP(OLE) 파일을 열 수 없습니다.");
  }
  const header = CFB.find(cfb, "/FileHeader");
  if (!header) throw new UnsupportedDocumentError("HWP FileHeader가 없습니다.");
  const hb = Buffer.from(header.content as Uint8Array);
  const signature = hb.subarray(0, 17).toString("latin1").replace(/\0.*$/, "");
  if (signature !== "HWP Document File") throw new UnsupportedDocumentError("HWP 5.x 문서가 아닙니다.");
  const flags = hb.readUInt32LE(36);
  if (flags & 2) throw new UnsupportedDocumentError("암호화된 HWP 문서는 지원하지 않습니다.");
  if (flags & 4) throw new UnsupportedDocumentError("배포용(읽기 전용) HWP 문서는 지원하지 않습니다.");
  const compressed = (flags & 1) !== 0;

  const sections = cfb.FullPaths
    .map((p, i) => ({ i, m: /BodyText\/Section(\d+)$/.exec(p) }))
    .filter((x): x is { i: number; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  if (!sections.length) throw new UnsupportedDocumentError("HWP 본문(BodyText)이 없습니다.");

  const blocks: Block[] = [];
  for (const s of sections) {
    let body = Buffer.from(cfb.FileIndex[s.i].content as Uint8Array);
    if (compressed) body = inflateRawSync(body);
    blocks.push(...parseSection(body));
  }
  return { format: "hwp", blocks };
}
