/** Only pathname: never query strings, OAuth codes, or public share tokens. */
export function auditPagePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500 || !value.startsWith("/") || value.startsWith("//")) return null;
  const path = value.split(/[?#]/)[0];
  if (/[\\\s\u0000-\u001f]/.test(path)) return null;
  if (/^\/(?:api|_next|auth|login|survey|splash)(?:\/|$)/.test(path)) return null;
  if (/^\/(?:rfp\/shared|ppt\/s)(?:\/|$)/.test(path)) return null;
  return path;
}
