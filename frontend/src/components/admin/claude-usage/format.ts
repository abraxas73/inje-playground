/** Claude 사용량 대시보드 공용 숫자 포맷터 */
export const usd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const int = (v: number) => Math.round(v).toLocaleString("ko-KR");
export const hours = (sec: number) => `${(sec / 3600).toFixed(1)}h`;
/** ISO → "2026-08-27 15:44" (브라우저 로캘, KST 환경 기준) */
export const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/\. /g, "-").replace(/\.$/, "").replace(/-(\d{2}:\d{2})/, " $1");
};
