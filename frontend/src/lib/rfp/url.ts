/** 근거 URL은 http(s)만 허용. 비어 있으면 null. 길이 2000 초과·다른 스킴은 오류 문구를 돌려준다. */
export function normalizeHttpUrl(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "URL은 문자열이어야 합니다." };
  const s = v.trim();
  if (!s) return { ok: true, value: null };
  if (s.length > 2000) return { ok: false, error: "URL이 너무 깁니다(2000자 이하)." };
  if (!/^https?:\/\//i.test(s)) return { ok: false, error: "URL은 http(s)로 시작해야 합니다." };
  return { ok: true, value: s };
}
