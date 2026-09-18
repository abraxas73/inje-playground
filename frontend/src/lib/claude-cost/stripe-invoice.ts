/**
 * Anthropic(Stripe) 인보이스 PDF → ParsedInvoice.
 *
 * Stripe PDF는 글자 좌표만 있고 원시 순서는 뒤섞여 있어(라벨·값이 따로 나온다) **줄 단위로 복원한 텍스트**를 읽는다.
 * 실물 레이아웃(2026-08): "Invoice number X" / "Date of issue Month D, YYYY" / 왼쪽 발행자 주소·오른쪽 "Bill to" 열 /
 * "Description Qty Unit price Tax Amount" 표 → 라인 줄 + 다음 줄 기간 "Aug 23–Sep 23, 2026" → Subtotal · VAT · Total · Amount due.
 * 좌석 변경 시 프로레이션 2줄("Remaining time on 97 ×" +, "Unused time on 40 ×" −)이 들어온다.
 * 합계 검증(Σ라인 = 소계, 소계+세액 = 총액)에 어긋나면 라인을 놓친 것이므로 저장을 거절한다.
 *
 * 실물 확인(2026-09-18): pdf.js는 이 PDF 폰트의 하이픈·대시·괄호·마이너스 글리프를 NUL로 돌려주고(ToUnicode 없음)
 * `cleanPdfText`가 공백으로 바꾼다 — "RB6YCIF0 0003", "Aug 23 Sep 23, 2026", "$4,978.24"(마이너스 사라짐).
 * 그래서 이 문자들에 의존하지 않는다: 번호는 공백→하이픈, 기간은 공백 구분자 허용, 크레딧은 "Unused time on" 설명으로 판정.
 */
import { fragsOfPage, groupLines, joinFrags } from "@/lib/rfp/parse-pdf";
import { parseEnglishDate, parseMoneyCents, parsePeriod, formatCents } from "./money";
import type { InvoiceParseResult, ParsedInvoice, ParsedInvoiceLine } from "@/types/claude-cost";

/** 좌표로 복원한 한 줄. frags는 왼쪽→오른쪽 순, Bill to 열을 찾을 때만 x0를 쓴다 */
export interface InvoiceTextLine {
  text: string;
  frags: { x0: number; text: string }[];
}

const INVOICE_LINK_RE = /^https:\/\/invoice\.stripe\.com\/i\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)(?:\/pdf)?(\?[^#\s]*)?$/;
const PAY_LINK_RE = /^https:\/\/pay\.stripe\.com\/invoice\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\/pdf(\?[^#\s]*)?$/;

/** 결제 메일의 호스팅 페이지 링크 → 서버가 인증 없이 받을 수 있는 PDF 링크. 허용 호스트 밖이면 null */
export function invoiceLinkToPdfUrl(url: string): string | null {
  const s = url.trim();
  const m = INVOICE_LINK_RE.exec(s) ?? PAY_LINK_RE.exec(s);
  if (!m) return null;
  return `https://pay.stripe.com/invoice/${m[1]}/${m[2]}/pdf${m[3] ?? ""}`;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

const MONEY = String.raw`-?(?:US)?\$[\d,]+\.\d{2}`;
/** 설명 · 수량 · [단가] · [세율] · 금액 — 금액이 줄 끝이라 설명 안의 숫자(97, 24 Aug 2026)와 헷갈리지 않는다 */
const ITEM_RE = new RegExp(String.raw`^(.+?)\s+(\d+)(?:\s+(${MONEY}))?(?:\s+(\d+(?:\.\d+)?%))?\s+(${MONEY})$`);
const SEATS_RE = /^(?:Remaining time on |Unused time on )?(\d+)\s*[×x]\s*(.+?)(?:\s+after\s+.+)?$/;
const SUBTOTAL_RE = new RegExp(String.raw`^Subtotal\s+(${MONEY})$`);
const TAX_RE = new RegExp(String.raw`^(?:VAT|Tax|GST)\b.*\s(${MONEY})$`);
const TOTAL_RE = new RegExp(String.raw`^Total\s+(${MONEY})$`);
const DUE_RE = new RegExp(String.raw`^Amount due\s+${MONEY}\s+([A-Z]{3})\b`);
/** Bill to 열로 볼 x 허용 오차(pt) — 같은 열의 조각은 x0가 거의 같다 */
const COLUMN_TOL = 20;

function firstMatch(texts: string[], re: RegExp): string | null {
  for (const t of texts) {
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

function moneyAt(texts: string[], re: RegExp): number | null {
  const s = firstMatch(texts, re);
  return s === null ? null : parseMoneyCents(s);
}

/** "Bill to" 조각의 x0 아래 첫 줄에서 같은 열(오른쪽) 조각만 이어 붙인다 — 왼쪽 열은 발행자 주소다 */
function findBillTo(lines: InvoiceTextLine[]): string | null {
  const idx = lines.findIndex((l) => l.frags.some((f) => f.text.trim() === "Bill to"));
  if (idx < 0) return null;
  const x = lines[idx].frags.find((f) => f.text.trim() === "Bill to")!.x0;
  for (let i = idx + 1; i < Math.min(lines.length, idx + 3); i++) {
    const own = lines[i].frags.filter((f) => f.x0 >= x - COLUMN_TOL).map((f) => f.text.trim()).filter(Boolean);
    if (own.length) return own.join(" ");
  }
  return null;
}

export function parseStripeInvoice(lines: InvoiceTextLine[]): InvoiceParseResult {
  const errors: string[] = [];
  const texts = lines.map((l) => l.text.trim());

  if (!texts.some((t) => t.includes("Anthropic"))) errors.push("Anthropic 인보이스가 아닙니다.");
  // pdf.js가 이 폰트의 하이픈을 NUL→공백으로 돌려줘 "RB6YCIF0 0003"처럼 온다. Stripe 번호에 공백은 없으니 하이픈으로 되돌린다
  const invoiceRaw = firstMatch(texts, /^Invoice number\s+(.+)$/);
  const invoiceNumber = invoiceRaw ? invoiceRaw.trim().replace(/\s+/g, "-") : null;
  if (!invoiceNumber) errors.push("인보이스 번호를 찾을 수 없습니다.");
  const issuedRaw = firstMatch(texts, /^Date of issue\s+(.+)$/);
  const issuedOn = issuedRaw ? parseEnglishDate(issuedRaw) : null;
  if (!issuedOn) errors.push("발행일을 읽을 수 없습니다.");
  const billTo = findBillTo(lines);
  if (!billTo) errors.push("Bill to(청구 대상)를 찾을 수 없습니다.");

  const items: ParsedInvoiceLine[] = [];
  const headerIdx = texts.findIndex((t) => /^Description\b/.test(t));
  const subtotalIdx = texts.findIndex((t) => SUBTOTAL_RE.test(t));
  if (headerIdx < 0 || subtotalIdx < 0 || subtotalIdx <= headerIdx) {
    errors.push("라인 아이템 표(Description … Subtotal)를 찾을 수 없습니다.");
  } else {
    for (let i = headerIdx + 1; i < subtotalIdx; i++) {
      const m = ITEM_RE.exec(texts[i]);
      if (!m) continue;
      const amountCents = parseMoneyCents(m[5]);
      if (amountCents === null) {
        errors.push(`금액을 읽을 수 없습니다: ${texts[i]}`);
        continue;
      }
      // 프로레이션 크레딧("Unused time on …")의 마이너스 기호도 같은 이유로 사라진다 — 설명으로 크레딧을 판정한다
      const signed = /^Unused time on /.test(m[1]) && amountCents > 0 ? -amountCents : amountCents;
      const period = i + 1 < subtotalIdx ? parsePeriod(texts[i + 1]) : null;
      if (period) i++;
      // 갱신·연간 인보이스는 설명이 "Team plan - Premium"뿐이고 좌석 수는 수량 열에 있다(실물 7장 확인, 2026-09-18).
      // 프로레이션("97 × Team plan …")은 설명의 N을, 그 외 plan이 든 설명은 수량을 좌석으로 본다.
      const s = SEATS_RE.exec(m[1]);
      const isPlan = /\bplan\b/i.test(m[1]);
      items.push({
        position: items.length,
        description: m[1],
        quantity: Number(m[2]),
        amountCents: signed,
        taxRate: m[4] ?? null,
        periodStart: period?.start ?? null,
        periodEnd: period?.end ?? null,
        seats: s ? Number(s[1]) : isPlan ? Number(m[2]) : null,
        plan: s ? s[2] : isPlan ? m[1] : null,
      });
    }
    if (items.length === 0) errors.push("라인 아이템이 없습니다.");
  }

  const subtotalCents = moneyAt(texts, SUBTOTAL_RE);
  const taxCents = moneyAt(texts, TAX_RE) ?? 0;
  const totalCents = moneyAt(texts, TOTAL_RE);
  if (subtotalCents === null) errors.push("소계(Subtotal)를 찾을 수 없습니다.");
  if (totalCents === null) errors.push("총액(Total)을 찾을 수 없습니다.");
  if (subtotalCents !== null && items.length) {
    const sum = items.reduce((a, l) => a + l.amountCents, 0);
    if (sum !== subtotalCents) errors.push(`라인 합(${formatCents(sum)})이 소계(${formatCents(subtotalCents)})와 다릅니다 — 라인을 놓쳤을 수 있습니다.`);
  }
  if (subtotalCents !== null && totalCents !== null && subtotalCents + taxCents !== totalCents) {
    errors.push(`소계+세액(${formatCents(subtotalCents + taxCents)})이 총액(${formatCents(totalCents)})과 다릅니다.`);
  }
  if (errors.length || !invoiceNumber || !issuedOn || !billTo || subtotalCents === null || totalCents === null) {
    return { ok: false, errors };
  }

  const positive = items.filter((l) => l.amountCents > 0 && l.seats !== null);
  const plans = [...new Set(positive.map((l) => l.plan).filter((p): p is string => !!p))];
  const starts = items.map((l) => l.periodStart).filter((d): d is string => !!d).sort();
  const ends = items.map((l) => l.periodEnd).filter((d): d is string => !!d).sort();
  const invoice: ParsedInvoice = {
    invoiceNumber,
    issuedOn,
    billTo,
    currency: firstMatch(texts, DUE_RE) ?? "USD",
    subtotalCents,
    taxCents,
    totalCents,
    periodStart: starts[0] ?? null,
    periodEnd: ends[ends.length - 1] ?? null,
    seats: positive.length ? positive.reduce((a, l) => a + (l.seats ?? 0), 0) : null,
    plan: plans.length ? plans.join(", ") : null,
    lines: items,
  };
  return { ok: true, invoice };
}

const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

/** Bill to 이름 ↔ claude_orgs.name — 대소문자·하이픈·공백 무시. 정확히 하나만 맞을 때만 배정한다 */
export function matchOrg(billTo: string, orgs: { id: string; name: string }[]): string | null {
  const key = normalizeName(billTo);
  if (!key) return null;
  const hits = orgs.filter((o) => normalizeName(o.name) === key);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * PDF 바이트 → 좌표로 복원한 줄. RFP 파서와 같은 조각 추출·줄 묶기를 쓰되 표(괘선)는 보지 않는다.
 * unpdf는 서버리스용 pdf.js 묶음이라 동적 import로 실제 요청에서만 로드한다.
 */
export async function extractInvoiceLines(pdf: Uint8Array): Promise<InvoiceTextLine[]> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const out: InvoiceTextLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const line of groupLines(fragsOfPage(content.items))) {
      const text = joinFrags(line.frags);
      if (!text) continue;
      out.push({ text, frags: line.frags.map((f) => ({ x0: f.x0, text: f.text })) });
    }
  }
  return out;
}
