/**
 * 표시 통화(USD ↔ KRW). 저장은 언제나 USD 센트이고, 원화는 관리자 전역 설정 `usd_krw_rate`(1달러당 원)를 곱해 표시할 때만 만든다.
 * 환율이 없으면(미설정·잘못된 값) 원화 표시를 요청해도 달러로 보여 주고 화면이 안내한다 — 숫자를 0원으로 보이게 하지 않는다.
 */
import { formatCents } from "./money";

export const USD_KRW_RATE_KEY = "usd_krw_rate";
export type DisplayCurrency = "USD" | "KRW";
export const CURRENCY_STORAGE_KEY = "claude-cost-currency";

/** 설정값(문자열) → 1달러당 원. 비었거나 숫자가 아니거나 0 이하면 null(미설정) */
export function parseUsdKrwRate(raw: unknown): number | null {
  const text = typeof raw === "string" ? raw.replace(/,/g, "").trim() : raw;
  const n = typeof text === "number" ? text : typeof text === "string" && text !== "" ? Number(text) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 센트 → 원(정수). 부동소수 오차를 피해 센트 단위로 곱한 뒤 100으로 나눠 반올림 */
export function centsToKrw(cents: number, rate: number): number {
  return Math.round((cents * rate) / 100);
}

/** "₩1,703,000" — 원화는 소수 없이 */
export function formatKrw(krw: number): string {
  const rounded = Math.round(krw);
  return `${rounded < 0 ? "-" : ""}₩${Math.abs(rounded).toLocaleString("ko-KR")}`;
}

/** 센트를 표시 통화로. KRW인데 환율이 없으면 USD로 */
export function formatMoney(cents: number, currency: DisplayCurrency, rate: number | null): string {
  if (currency === "KRW" && rate) return formatKrw(centsToKrw(cents, rate));
  return formatCents(cents);
}

/** 달러 실수(OTel 추정 비용 등) → 표시 통화 */
export function formatUsdAmount(usd: number, currency: DisplayCurrency, rate: number | null): string {
  return formatMoney(Math.round(usd * 100), currency, rate);
}

/** CSV 헤더 접미·값: 표시 통화에 맞춘 숫자(달러 2자리 / 원 정수) */
export function moneyCsv(cents: number, currency: DisplayCurrency, rate: number | null): string {
  if (currency === "KRW" && rate) return String(centsToKrw(cents, rate));
  return (cents / 100).toFixed(2);
}
export const csvSuffix = (currency: DisplayCurrency, rate: number | null): "usd" | "krw" => (currency === "KRW" && rate ? "krw" : "usd");
