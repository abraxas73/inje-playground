/** 경과 시간 표기: 59초까지는 "N초", 그 뒤는 "M분 SS초". 음수·NaN은 0초. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`;
}
