/**
 * PDF → DocumentModel.
 *
 * PDF에는 표(表) 구조가 없다. 글자와 좌표, 그리고 그려진 선만 있다.
 * 그래서 **괘선(테두리 선)으로 표를 찾는다**: 세로선이 열 경계, 가로선이 행 경계이고
 * 선이 없는 곳은 셀이 이어져 있다는 뜻이라 **셀 병합(rowSpan·colSpan)까지 복원된다**.
 * 선으로 둘러싸인 칸 안에 있는 글자는 그 셀의 텍스트, 어떤 셀에도 들지 않는 글자는 문단이다.
 *
 * 글자 간격만으로 표를 추측하지 않는다. 한글 제안요청서 본문은 `사 업 명 : …`처럼 자간을
 * 벌리고 탭으로 정렬해서, "가로로 벌어지면 다른 칸"으로 보면 **본문 문단이 표로 오인된다**
 * (실측: 98쪽 제안요청서에서 표 349개가 잡히고 개요의 사업명이 엉뚱한 값으로 채워졌다).
 * 요구사항 표는 언제나 테두리가 있으니 괘선을 믿는 쪽이 맞다.
 *
 * 한계:
 * - 테두리가 없는 표는 표로 잡히지 않는다(문단이 된다). 틀린 표를 만드는 것보다 낫다.
 * - 표 전체를 한 번의 경로(path)로 그리는 PDF는 선을 낱개로 알 수 없어 표를 놓친다.
 * - 한 표가 페이지 경계를 넘으면 페이지마다 다른 표가 된다.
 * - 그림·도형이 많은 페이지는 도형 테두리가 작은 표로 잡힐 수 있다(요구사항 표와 섞이지는 않는다).
 * hwp·hwpx·docx는 문서에 표 구조가 있으니 그대로 읽는다 — 이 파일은 PDF에만 쓴다.
 */
import { UnsupportedDocumentError, type Block, type Cell, type DocumentModel } from "./document-model";

/** 같은 줄로 볼 기준선 y 차이 = 글자 높이 × 이 값 */
const LINE_TOL_RATIO = 0.5;
/** 같은 줄에서 이만큼(글자 높이 × 값) 벌어지면 공백 한 칸을 넣는다(낱말·글자마다 조각을 내는 PDF 대비) */
const WORD_GAP_RATIO = 0.2;
/** 선으로 볼 두께(pt)와 최소 길이(pt) */
const LINE_MAX_THICK = 3;
const LINE_MIN_LEN = 8;
/** 선끼리 이 거리(pt) 안에서 닿으면 같은 표로 묶는다 */
const JOIN_TOL = 3;
/** 같은 열·행 경계로 볼 좌표 차이(pt) */
const SNAP_TOL = 2.5;
/** 경계선이 칸 범위의 이 비율 이상을 덮으면 칸이 나뉘어 있다고 본다 */
const CLOSED_RATIO = 0.6;

/**
 * PDF에서 뽑은 글자 정리.
 * 한/글로 만든 PDF는 낱말 사이 글리프가 유니코드로 매핑되지 않아 **NUL(U+0000)** 로 나온다.
 * 그대로 두면 라벨 비교(`요구사항분류`)가 어긋나 요구사항 표를 못 찾고,
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
  /** 글자 높이 — 줄 묶기·낱말 간격의 기준 */
  h: number;
  text: string;
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 페이지에서 뽑은 괘선(가로·세로 따로) */
export interface PageRules {
  horizontal: Rect[];
  vertical: Rect[];
}

export interface TextLine {
  y: number;
  h: number;
  frags: TextFrag[];
}

/** 기준선 y가 비슷한 조각끼리 한 줄로 묶는다(위 → 아래, 줄 안에서는 왼쪽 → 오른쪽). */
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

/** 한 줄의 조각들을 한 문자열로. 벌어진 만큼만 공백을 넣는다(양쪽에 이미 공백이 있으면 넣지 않는다). */
export function joinFrags(frags: TextFrag[]): string {
  let out = "";
  let prevX1 = 0;
  frags.forEach((f, i) => {
    const gap = f.x0 - prevX1;
    const space = i > 0 && gap > f.h * WORD_GAP_RATIO && !/\s$/.test(out) && !/^\s/.test(f.text);
    out += (space ? " " : "") + f.text;
    prevX1 = Math.max(prevX1, f.x1);
  });
  return cleanPdfText(out).trim();
}

/** 여러 줄 → 줄바꿈으로 이은 텍스트(빈 줄은 버린다) */
function linesText(frags: TextFrag[]): string {
  return groupLines(frags)
    .map((l) => joinFrags(l.frags))
    .filter((t) => t.length > 0)
    .join("\n");
}

function unionLength(intervals: [number, number][]): number {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curStart = 0;
  let curEnd = -Infinity;
  for (const [a, b] of sorted) {
    if (a > curEnd) {
      total += Math.max(0, curEnd - curStart);
      curStart = a;
      curEnd = b;
    } else if (b > curEnd) {
      curEnd = b;
    }
  }
  return total + Math.max(0, curEnd - curStart);
}

/** 좌표들을 가까운 것끼리 묶어 대표값 하나씩(오름차순) */
export function snapValues(values: number[], tol = SNAP_TOL): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  return out;
}

function touches(a: Rect, b: Rect, tol: number): boolean {
  return a.x0 - tol <= b.x1 && b.x0 - tol <= a.x1 && a.y0 - tol <= b.y1 && b.y0 - tol <= a.y1;
}

/** 서로 닿는 선끼리 묶은 덩어리. 가로·세로선이 각 2개 이상이면 표가 된다. */
export function ruleClusters(rules: PageRules): PageRules[] {
  const all = [
    ...rules.horizontal.map((r) => ({ r, vertical: false })),
    ...rules.vertical.map((r) => ({ r, vertical: true })),
  ];
  const parent = all.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (touches(all[i].r, all[j].r, JOIN_TOL)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, PageRules>();
  all.forEach((item, i) => {
    const key = find(i);
    const g = groups.get(key) ?? { horizontal: [], vertical: [] };
    (item.vertical ? g.vertical : g.horizontal).push(item.r);
    groups.set(key, g);
  });
  return [...groups.values()].filter((g) => g.horizontal.length >= 2 && g.vertical.length >= 2);
}

interface GridCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  rect: Rect;
}

/** 세로 경계 x가 [yLo, yHi] 구간을 막고 있는지(선이 여러 조각으로 나뉘어 있어도 합쳐 센다) */
function vClosed(vs: Rect[], x: number, yLo: number, yHi: number): boolean {
  const spans = vs
    .filter((v) => Math.abs((v.x0 + v.x1) / 2 - x) <= SNAP_TOL)
    .map((v) => [Math.max(v.y0, yLo), Math.min(v.y1, yHi)] as [number, number]);
  return unionLength(spans) >= (yHi - yLo) * CLOSED_RATIO;
}

/** 가로 경계 y가 [xLo, xHi] 구간을 막고 있는지 */
function hClosed(hs: Rect[], y: number, xLo: number, xHi: number): boolean {
  const spans = hs
    .filter((h) => Math.abs((h.y0 + h.y1) / 2 - y) <= SNAP_TOL)
    .map((h) => [Math.max(h.x0, xLo), Math.min(h.x1, xHi)] as [number, number]);
  return unionLength(spans) >= (xHi - xLo) * CLOSED_RATIO;
}

/**
 * 선들이 공통으로 뻗어 있는 양 끝. 바깥 테두리를 그리지 않는 표(가로줄만 있고 좌우 테두리가 없는 양식)에서
 * 가로선의 양 끝이 곧 첫 열의 왼쪽·마지막 열의 오른쪽 경계다. 두 줄 이상이 같은 끝에 닿을 때만 인정한다
 * (표 위에 걸친 장식 선 하나 때문에 없는 열이 생기지 않도록).
 */
export function outerEdges(spans: [number, number][]): number[] {
  if (spans.length < 2) return [];
  const lo = Math.min(...spans.map((s) => s[0]));
  const hi = Math.max(...spans.map((s) => s[1]));
  const edges: number[] = [];
  if (spans.filter((s) => Math.abs(s[0] - lo) <= SNAP_TOL).length >= 2) edges.push(lo);
  if (spans.filter((s) => Math.abs(s[1] - hi) <= SNAP_TOL).length >= 2) edges.push(hi);
  return edges;
}

/**
 * 괘선 덩어리 → 격자. 세로선 x가 열 경계, 가로선 y가 행 경계이고,
 * 경계에 선이 없으면 그만큼 셀이 이어진 것(병합)으로 본다.
 */
export function buildGrid(cluster: PageRules): { cells: GridCell[]; rows: number; cols: number; rect: Rect } | null {
  const xs = snapValues([
    ...cluster.vertical.map((v) => (v.x0 + v.x1) / 2),
    ...outerEdges(cluster.horizontal.map((h) => [h.x0, h.x1])),
  ]);
  const ysAsc = snapValues([
    ...cluster.horizontal.map((h) => (h.y0 + h.y1) / 2),
    ...outerEdges(cluster.vertical.map((v) => [v.y0, v.y1])),
  ]);
  if (xs.length < 2 || ysAsc.length < 2) return null;
  const ys = [...ysAsc].reverse(); // 위 → 아래
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const taken = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r][c]) continue;
      let colSpan = 1;
      while (c + colSpan < cols && !vClosed(cluster.vertical, xs[c + colSpan], ys[r + 1], ys[r])) colSpan++;
      let rowSpan = 1;
      while (r + rowSpan < rows && !hClosed(cluster.horizontal, ys[r + rowSpan], xs[c], xs[c + colSpan])) rowSpan++;
      for (let rr = r; rr < r + rowSpan; rr++) for (let cc = c; cc < c + colSpan; cc++) taken[rr][cc] = true;
      cells.push({
        row: r,
        col: c,
        rowSpan,
        colSpan,
        rect: { x0: xs[c], x1: xs[c + colSpan], y0: ys[r + rowSpan], y1: ys[r] },
      });
    }
  }
  return { cells, rows, cols, rect: { x0: xs[0], x1: xs[xs.length - 1], y0: ys[rows], y1: ys[0] } };
}

/** 글자 조각이 이 사각형 안에 있는지 — 시작점(왼쪽 아래)으로 판정해 칸을 넘겨 쓴 글자도 시작한 칸에 넣는다 */
function inRect(f: TextFrag, rect: Rect): boolean {
  const x = f.x0 + Math.min(1.5, Math.max(0, (f.x1 - f.x0) / 2));
  const y = f.y + f.h * 0.25;
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

/** 한 페이지의 글자·괘선 → 문단·표 블록(위에서 아래 순서) */
export function blocksFromPage(frags: TextFrag[], rules: PageRules): Block[] {
  const blocks: { top: number; block: Block }[] = [];
  const consumed = new Set<TextFrag>();

  for (const cluster of ruleClusters(rules)) {
    const grid = buildGrid(cluster);
    if (!grid) continue;
    const cells: Cell[] = [];
    for (const g of grid.cells) {
      const inside = frags.filter((f) => !consumed.has(f) && inRect(f, g.rect));
      const text = linesText(inside);
      inside.forEach((f) => consumed.add(f));
      if (!text) continue;
      cells.push({ row: g.row, col: g.col, rowSpan: g.rowSpan, colSpan: g.colSpan, text, tables: [] });
    }
    if (!cells.length) continue;
    blocks.push({ top: grid.rect.y1, block: { type: "table", rows: grid.rows, cols: grid.cols, cells } });
  }

  for (const line of groupLines(frags.filter((f) => !consumed.has(f)))) {
    const text = joinFrags(line.frags);
    if (text) blocks.push({ top: line.y, block: { type: "paragraph", text } });
  }

  return blocks.sort((a, b) => b.top - a.top).map((b) => b.block);
}

/** PDF 한 페이지의 텍스트 조각. 회전된 글자(가로쓰기가 아닌 것)는 줄 묶음을 망치므로 버린다. */
export function fragsOfPage(items: unknown[]): TextFrag[] {
  const frags: TextFrag[] = [];
  for (const raw of items) {
    const it = raw as { str?: string; width?: number; height?: number; transform?: number[] };
    if (typeof it.str !== "string" || !it.str.length || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue;
    // 제어문자는 여기서 걷어낸다 — 그래야 빈 조각을 걸러내는 판정도 맞는다
    const text = cleanPdfText(it.str);
    if (!text.trim()) continue;
    const h = it.height || Math.abs(d) || Math.abs(a) || 10;
    frags.push({ x0: e, x1: e + (it.width ?? 0), y: f, h, text });
  }
  return frags;
}

type Matrix = [number, number, number, number, number, number];

function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * 페이지 연산자 목록 → 괘선. 경로(path)마다 pdf.js가 함께 주는 경계 상자를 현재 변환행렬로 옮긴 뒤,
 * 한쪽이 얇고 다른 쪽이 길면 선으로 본다(테두리를 얇은 사각형으로 채우는 PDF와 선으로 긋는 PDF 모두 걸린다).
 * 변환행렬은 save/restore/transform을 따라가며 관리한다 — 문서마다 페이지 전체에 축척·뒤집기를 걸어 두기 때문.
 */
export function rulesFromOperatorList(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: { save: number; restore: number; transform: number; constructPath: number },
): PageRules {
  const rules: PageRules = { horizontal: [], vertical: [] };
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.transform) {
      const a = argsArray[i] as ArrayLike<number> | undefined;
      if (a && a.length >= 6) ctm = mul(ctm, [a[0], a[1], a[2], a[3], a[4], a[5]]);
    } else if (fn === ops.constructPath) {
      const args = argsArray[i] as ArrayLike<unknown> | undefined;
      const box = args?.[2] as ArrayLike<number> | undefined;
      if (!box || box.length < 4) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [px, py] of [
        [box[0], box[1]],
        [box[2], box[1]],
        [box[0], box[3]],
        [box[2], box[3]],
      ]) {
        xs.push(ctm[0] * px + ctm[2] * py + ctm[4]);
        ys.push(ctm[1] * px + ctm[3] * py + ctm[5]);
      }
      const rect: Rect = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      const w = rect.x1 - rect.x0;
      const h = rect.y1 - rect.y0;
      if (h <= LINE_MAX_THICK && w >= LINE_MIN_LEN) rules.horizontal.push(rect);
      else if (w <= LINE_MAX_THICK && h >= LINE_MIN_LEN) rules.vertical.push(rect);
    }
  }
  return rules;
}

/**
 * PDF → DocumentModel. 페이지마다 글자와 괘선을 읽어 표·문단을 복원하고 순서대로 이어 붙인다.
 * 텍스트가 전혀 없으면(스캔 이미지 PDF) UnsupportedDocumentError.
 */
export async function parsePdf(buf: Buffer): Promise<DocumentModel> {
  // unpdf = 서버리스용으로 묶은 pdf.js(워커·canvas 없이 동작). 동적 import로 실제 PDF에서만 로드한다.
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // 원본 Buffer를 그대로 넘기면 pdf.js가 내부에서 조각내며 손상시킬 수 있어 복사해서 넘긴다.
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") throw new UnsupportedDocumentError("암호가 걸린 PDF는 읽을 수 없습니다. 암호를 푼 파일을 올려주세요.");
    throw new UnsupportedDocumentError(`PDF를 열 수 없습니다: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
  }
  const { OPS } = await getResolvedPDFJS();
  const ops = { save: OPS.save, restore: OPS.restore, transform: OPS.transform, constructPath: OPS.constructPath };

  const blocks: Block[] = [];
  let fragCount = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const [content, opList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const frags = fragsOfPage(content.items);
    fragCount += frags.length;
    blocks.push(...blocksFromPage(frags, rulesFromOperatorList(opList.fnArray, opList.argsArray, ops)));
  }
  if (fragCount === 0) {
    throw new UnsupportedDocumentError(
      "PDF에 글자가 없습니다(스캔한 이미지로 보입니다). 텍스트가 있는 PDF나 원본 문서(hwp·hwpx·docx)를 올려주세요.",
    );
  }
  return { format: "pdf", blocks };
}
