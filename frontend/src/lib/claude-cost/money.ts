/** 금액·날짜 유틸. 금액은 센트 정수로만 다룬다(부동소수 달러 금지). */

const MONEY_RE = /^(-)?(?:US)?\$\s*([\d,]+)\.(\d{2})$/;

/** "$12,072.22" | "-$4,978.24" | "US$7,803.38" → 센트 정수. 형식이 다르면 null */
export function parseMoneyCents(s: string): number | null {
  const m = MONEY_RE.exec(s.trim());
  if (!m) return null;
  const whole = Number(m[2].replace(/,/g, ""));
  if (!Number.isInteger(whole)) return null;
  const cents = whole * 100 + Number(m[3]);
  return m[1] ? -cents : cents;
}

/** 센트 → "$1,234.56". 소수 센트(Admin API)는 반올림 */
export function formatCents(cents: number, currency = "USD"): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${whole}.${frac}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (name: string): number => MONTHS.indexOf(name.toLowerCase().slice(0, 3));
const ymd = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "August 23, 2026" | "Aug 23, 2026" → "2026-08-23" */
export function parseEnglishDate(s: string): string | null {
  const m = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mi = monthIndex(m[1]);
  if (mi < 0) return null;
  return ymd(Number(m[3]), mi + 1, Number(m[2]));
}

const DATE_PART = String.raw`([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?`;
const PERIOD_RE = new RegExp(String.raw`^${DATE_PART}\s*[–—-]\s*${DATE_PART}$`);

/**
 * Stripe 라인 아이템 기간 "Aug 23–Sep 23, 2026". 연도는 뒤에만 있는 게 보통이라 앞 날짜에 보정하고,
 * 연말을 걸치면(12월→1월) 앞 연도를 하나 뺀다. 둘 다 연도가 없으면 기간으로 보지 않는다.
 */
export function parsePeriod(s: string): { start: string; end: string } | null {
  const m = PERIOD_RE.exec(s.trim());
  if (!m) return null;
  const m1 = monthIndex(m[1]);
  const m2 = monthIndex(m[4]);
  if (m1 < 0 || m2 < 0) return null;
  const d1 = Number(m[2]);
  const d2 = Number(m[5]);
  const startBeforeEnd = m1 < m2 || (m1 === m2 && d1 <= d2);
  let y1 = m[3] ? Number(m[3]) : null;
  let y2 = m[6] ? Number(m[6]) : null;
  if (y1 === null && y2 === null) return null;
  if (y1 === null) y1 = startBeforeEnd ? (y2 as number) : (y2 as number) - 1;
  if (y2 === null) y2 = startBeforeEnd ? y1 : y1 + 1;
  return { start: ymd(y1, m1 + 1, d1), end: ymd(y2, m2 + 1, d2) };
}

export const monthOf = (day: string): string => day.slice(0, 7);

/** "2026-02" → { from: "2026-02-01", to: "2026-02-28" } */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 이번 달을 포함한 최근 n개월(오래된 → 최신) */
export function lastMonths(n: number, today: Date = new Date()): string[] {
  const t = new Date(today.getTime() + KST_OFFSET_MS);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
