/**
 * PDF → DocumentModel.
 *
 * PDF에는 표(表) 구조가 없다. 글자와 좌표만 있어서 표는 **좌표로 복원**한다:
 * 기준선 y가 비슷한 조각을 한 줄로 묶고, 한 줄 안에서 가로로 크게 벌어진 곳을 칸 경계로 본다.
 * 칸이 2개 이상인 줄이 이어지면 표로 보고, 칸이 1개인 줄은 문단(또는 앞 칸의 이어지는 줄)으로 본다.
 *
 * 괘선(테두리 선)은 읽지 않는다 — 선을 그리는 방식이 만든 프로그램(한/글·워드·크롬)마다 달라서
 * 글자 좌표만 쓰는 쪽이 문서를 가리지 않는다. 그 대가로 한계가 있다:
 * - 셀 병합(rowSpan·colSpan)은 복원하지 못한다. 비어 있는 칸은 그냥 없는 칸이 된다.
 * - 칸 사이 여백이 글자 높이보다 좁은 촘촘한 표는 한 칸으로 붙을 수 있다.
 * - 한 표가 페이지 경계를 넘으면 페이지마다 다른 표가 된다(페이지를 이어 붙이면 서로 다른 표가
 *   한 표로 합쳐질 위험이 더 크다 — 요구사항 표 하나가 통째로 사라지는 쪽이 더 나쁘다).
 * 요구사항 표는 "라벨 | 값" 2칸 표라 이 방식으로 잘 복원된다. hwp·hwpx·docx는 문서에 표 구조가
 * 있으니 그대로 읽는다(parse-hwp·parse-hwpx·parse-docx) — 이 파일은 PDF에만 쓴다.
 */
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel, type Table } from "./document-model";

/** 같은 줄로 볼 기준선 y 차이 = 글자 높이 × 이 값 */
const LINE_TOL_RATIO = 0.5;
/** 다른 칸으로 볼 가로 간격 = max(글자 높이 × 이 값, CELL_GAP_MIN) */
const CELL_GAP_RATIO = 1.2;
const CELL_GAP_MIN = 6;
/** 같은 칸 안에서도 이만큼(글자 높이 × 값) 벌어지면 공백 한 칸을 넣는다(글자마다 조각을 내는 PDF 대비) */
const WORD_GAP_RATIO = 0.2;
/** 공백 조각이 이 폭(글자 높이 × 값) 이상이면 칸 구분 신호로 본다 */
const BLANK_SEP_RATIO = 0.8;
/** 표 안 줄 간격이 지금까지 간격 중앙값의 이 배수를 넘으면 다른 표로 끊는다 */
const ROW_GAP_OUTLIER_RATIO = 1.8;
const ROW_GAP_OUTLIER_MIN = 8;

/**
 * PDF에서 뽑은 글자 정리.
 * 한/글로 만든 PDF는 낱말 사이 글리프가 유니코드로 매핑되지 않아 **NUL(U+0000)** 로 나온다
 * (`국가를 당사자로`). 그대로 두면 라벨 비교(`요구사항분류`)가 어긋나 요구사항 표를 못 찾고,
 * Postgres text 컬럼은 NUL을 아예 저장하지 못해 프로젝트 등록이 실패한다.
 * 제어문자는 공백으로 바꿔 낱말 경계를 살리고, 이어진 공백은 한 칸으로 접는다
 * (줄바꿈은 세부 내용 글머리를 나누는 데 필요해 남긴다).
 */
export function cleanPdfText(s: string): string {
  return s
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? "\n" : " "))
    .replace(/ {2,}/g, " ");
}

/** 한 줄 안의 텍스트 런 하나(PDF 좌표: y는 기준선, 위로 갈수록 크다) */
export interface TextFrag {
  x0: number;
  x1: number;
  y: number;
  /** 글자 높이 — 모든 임계값의 기준 */
  h: number;
  text: string;
  /** 공백만 있는 조각. 텍스트로는 쓰지 않고 칸 구분 신호로만 쓴다. */
  blank: boolean;
}

export interface TextLine {
  y: number;
  h: number;
  frags: TextFrag[];
}

/** 한 줄을 가로 간격으로 끊은 칸 */
export interface LineCell {
  x0: number;
  x1: number;
  text: string;
}

/** 기준선 y가 비슷한 조각끼리 한 줄로 묶는다(위 → 아래). */
export function groupLines(frags: TextFrag[]): TextLine[] {
  const sorted = [...frags].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines: TextLine[] = [];
  for (const f of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - f.y) <= Math.max(f.h, last.h) * LINE_TOL_RATIO) {
      last.frags.push(f);
      last.h = Math.max(last.h, f.h);
    } else {
      lines.push({ y: f.y, h: f.h, frags: [f] });
    }
  }
  for (const l of lines) l.frags.sort((a, b) => a.x0 - b.x0);
  return lines;
}

/** 한 줄 → 칸들. 가로 간격이 크거나 사이에 넓은 공백 조각이 있으면 다른 칸으로 끊는다. */
export function splitLineCells(line: TextLine): LineCell[] {
  const cells: LineCell[] = [];
  for (const f of line.frags) {
    if (f.blank) continue;
    const prev = cells[cells.length - 1];
    const gap = prev ? f.x0 - prev.x1 : 0;
    const wide = gap > Math.max(f.h * CELL_GAP_RATIO, CELL_GAP_MIN);
    const separated =
      !!prev &&
      line.frags.some((w) => w.blank && w.x1 - w.x0 > f.h * BLANK_SEP_RATIO && w.x0 >= prev.x1 - 1 && w.x0 <= f.x0 + 1);
    if (prev && !wide && !separated) {
      // 양쪽에 이미 공백이 있으면 더 넣지 않는다(낱말마다 조각을 내면서 공백까지 넣는 PDF가 있다)
      const space = gap > f.h * WORD_GAP_RATIO && !/\s$/.test(prev.text) && !/^\s/.test(f.text);
      prev.text += (space ? " " : "") + f.text;
      prev.x1 = Math.max(prev.x1, f.x1);
    } else {
      cells.push({ x0: f.x0, x1: f.x1, text: f.text });
    }
  }
  return cells.map((c) => ({ ...c, text: cleanPdfText(c.text).trim() })).filter((c) => c.text.length > 0);
}

/** 표 만드는 중인 상태(줄 단위로 모아 두고 마지막에 열을 정한다) */
interface RawTable {
  rows: LineCell[][];
  /** 줄 사이 간격들 — 튀는 간격에서 표를 끊기 위해 */
  gaps: number[];
  lastY: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function overlap(a: { x0: number; x1: number }, b: { x0: number; x1: number }): number {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

/**
 * 열 경계. 칸 수가 가장 많은 줄들을 기준으로 열마다 x 범위를 잡는다.
 * 가운데 정렬·오른쪽 정렬이 섞여 있어도 열 개수는 이 줄들이 알려주고,
 * 칸이 모자란 줄(병합·빈 칸)은 x 범위로 어느 열인지 찾는다.
 */
export function columnRanges(rows: LineCell[][]): { x0: number; x1: number }[] {
  const max = Math.max(...rows.map((r) => r.length));
  const cols: { x0: number; x1: number }[] = [];
  for (const row of rows) {
    if (row.length !== max) continue;
    row.forEach((c, i) => {
      const col = cols[i];
      if (col) {
        col.x0 = Math.min(col.x0, c.x0);
        col.x1 = Math.max(col.x1, c.x1);
      } else {
        cols[i] = { x0: c.x0, x1: c.x1 };
      }
    });
  }
  return cols;
}

/** 칸이 들어갈 열 번호. 겹치는 폭이 가장 큰 열, 겹치는 열이 없으면 가장 가까운 열. */
export function columnOf(cell: LineCell, cols: { x0: number; x1: number }[]): number {
  let best = 0;
  let bestOverlap = -Infinity;
  cols.forEach((col, i) => {
    const ov = overlap(cell, col);
    const score = ov > 0 ? ov : -Math.min(Math.abs(cell.x0 - col.x1), Math.abs(col.x0 - cell.x1));
    if (score > bestOverlap) {
      bestOverlap = score;
      best = i;
    }
  });
  return best;
}

/** 한 행의 칸마다 열 번호. 칸 수가 열 수와 같으면 순서대로, 모자라면 x 범위로 찾는다. */
export function assignColumns(row: LineCell[], cols: { x0: number; x1: number }[]): { col: number; cell: LineCell }[] {
  return row.map((cell, i) => ({ col: row.length === cols.length ? i : columnOf(cell, cols), cell }));
}

function toTable(raw: RawTable): Table {
  const cols = columnRanges(raw.rows);
  const cells: Cell[] = [];
  raw.rows.forEach((row, r) => {
    for (const { col, cell } of assignColumns(row, cols)) {
      const existing = cells.find((x) => x.row === r && x.col === col);
      // 같은 열에 두 칸이 잡히면(간격 판정이 어긋난 경우) 텍스트를 이어 붙인다 — 버리지는 않는다
      if (existing) existing.text = `${existing.text} ${cell.text}`.trim();
      else cells.push({ row: r, col, rowSpan: 1, colSpan: 1, text: cell.text, tables: [] });
    }
  });
  return { type: "table", rows: raw.rows.length, cols: cols.length, cells };
}

/**
 * 줄들 → 문단·표 블록.
 * - 칸 2개 이상인 줄: 표의 새 행. 줄 간격이 튀면 다른 표로 끊는다.
 * - 칸 1개인 줄: 표를 만드는 중이고 첫 열보다 오른쪽에 있으면 앞 행의 그 열에 이어지는 줄,
 *   아니면 표를 끝내고 문단.
 */
export function blocksFromLines(lines: TextLine[]): Block[] {
  const out: Block[] = [];
  let raw: RawTable | null = null;
  const flush = () => {
    if (raw) out.push(toTable(raw));
    raw = null;
  };

  for (const line of lines) {
    const cells = splitLineCells(line);
    if (!cells.length) continue;
    const gap = raw ? raw.lastY - line.y : 0;
    const outlier =
      !!raw && raw.gaps.length > 0 && gap > Math.max(median(raw.gaps) * ROW_GAP_OUTLIER_RATIO, median(raw.gaps) + ROW_GAP_OUTLIER_MIN);

    if (cells.length >= 2) {
      if (raw && outlier) flush();
      if (raw) {
        raw.gaps.push(gap);
        raw.rows.push(cells);
        raw.lastY = line.y;
      } else {
        raw = { rows: [cells], gaps: [], lastY: line.y };
      }
      continue;
    }

    // 칸 1개
    const cell = cells[0];
    const cur: RawTable | null = raw;
    if (cur && !outlier) {
      const cols = columnRanges(cur.rows);
      const col = columnOf(cell, cols);
      // 첫 열(라벨 열)에 걸리는 줄은 표의 이어지는 줄로 보지 않는다 — 표 사이의 제목 줄이 그렇다
      if (col > 0 && overlap(cell, cols[col]) > 0) {
        const last = cur.rows[cur.rows.length - 1];
        const target = assignColumns(last, cols).find((x) => x.col === col)?.cell;
        if (target) {
          target.text = `${target.text}\n${cell.text}`;
          target.x1 = Math.max(target.x1, cell.x1);
        } else {
          last.push(cell);
        }
        cur.lastY = line.y;
        continue;
      }
    }
    flush();
    out.push({ type: "paragraph", text: cell.text });
  }
  flush();
  return out;
}

/** PDF 한 페이지의 텍스트 조각. 회전된 글자(가로쓰기가 아닌 것)는 줄 묶음을 망치므로 버린다. */
function fragsOfPage(items: unknown[]): TextFrag[] {
  const frags: TextFrag[] = [];
  for (const raw of items) {
    const it = raw as { str?: string; width?: number; height?: number; transform?: number[] };
    if (typeof it.str !== "string" || !it.str.length || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue;
    // 제어문자는 여기서 걷어낸다 — 그래야 "공백만 있는 조각"(칸 구분 신호) 판정도 맞는다
    const text = cleanPdfText(it.str);
    if (!text.length) continue;
    const h = it.height || Math.abs(d) || Math.abs(a) || 10;
    const w = it.width ?? 0;
    frags.push({ x0: e, x1: e + w, y: f, h, text, blank: !text.trim() });
  }
  return frags;
}

/**
 * PDF → DocumentModel. 페이지마다 줄·표를 복원해 순서대로 이어 붙인다.
 * 텍스트가 전혀 없으면(스캔 이미지 PDF) UnsupportedDocumentError.
 */
export async function parsePdf(buf: Buffer): Promise<DocumentModel> {
  // unpdf = 서버리스용으로 묶은 pdf.js(워커·canvas 없이 동작). 동적 import로 실제 PDF에서만 로드한다.
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // 원본 Buffer를 그대로 넘기면 pdf.js가 내부에서 조각내며 손상시킬 수 있어 복사해서 넘긴다.
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") throw new UnsupportedDocumentError("암호가 걸린 PDF는 읽을 수 없습니다. 암호를 푼 파일을 올려주세요.");
    throw new UnsupportedDocumentError(`PDF를 열 수 없습니다: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
  }

  const blocks: Block[] = [];
  let fragCount = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const frags = fragsOfPage(content.items);
    fragCount += frags.filter((f) => !f.blank).length;
    blocks.push(...blocksFromLines(groupLines(frags)));
  }
  if (fragCount === 0) {
    throw new UnsupportedDocumentError(
      "PDF에 글자가 없습니다(스캔한 이미지로 보입니다). 텍스트가 있는 PDF나 원본 문서(hwp·hwpx·docx)를 올려주세요.",
    );
  }
  return { format: "pdf", blocks };
}
