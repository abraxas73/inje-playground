/** /auth/mobile?next= 값 검증 — 같은 오리진의 절대 경로만. 그 외(스킴·//·역슬래시·인코딩된 //)는 홈으로. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || decoded.includes("\\")) return "/";
  } catch {
    return "/";
  }
  return raw;
}
