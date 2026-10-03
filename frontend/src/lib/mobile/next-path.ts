/**
 * /auth/mobile?next= 값 검증 — 같은 오리진의 절대 경로만. 그 외(스킴·//·역슬래시·인코딩된 //·제어문자)는 홈으로.
 * 탭·개행 같은 제어문자는 브라우저 URL 파서가 지워 버리므로("/\t/evil.com" → "//evil.com") 원문·디코드 결과 모두에서 거부한다.
 * 마지막으로 실제 URL 파서에 넣어 오리진이 바뀌지 않는지 확인한다.
 */
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || CONTROL.test(raw)) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || decoded.includes("\\") || CONTROL.test(decoded)) return "/";
    const u = new URL(raw, "https://next.invalid");
    if (u.origin !== "https://next.invalid") return "/";
  } catch {
    return "/";
  }
  return raw;
}
