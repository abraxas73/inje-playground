/** 채팅 목록 최신 순 — 시각을 실제 시간값으로 비교(문자열 비교는 소수점 자릿수·표기가 섞이면 순서가 틀어진다). 시각 없는 채팅은 맨 아래. 서버·화면 공용. */
export function byNewest(a: { lastUpdated: string | null }, b: { lastUpdated: string | null }): number {
  const t = (v: string | null) => { const n = v ? Date.parse(v) : NaN; return Number.isNaN(n) ? -Infinity : n; };
  const ta = t(a.lastUpdated), tb = t(b.lastUpdated);
  return ta === tb ? 0 : tb > ta ? 1 : -1;
}
