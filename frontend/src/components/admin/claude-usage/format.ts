/** Claude 사용량 대시보드 공용 숫자 포맷터 */
export const usd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const int = (v: number) => Math.round(v).toLocaleString("ko-KR");
export const hours = (sec: number) => `${(sec / 3600).toFixed(1)}h`;
