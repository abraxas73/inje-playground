/**
 * OAuth 리디렉션 안전장치(스펙 §3.1·§12).
 * redirect_uri의 오리진은 허용 목록(env MS_ALLOWED_ORIGINS)에 있는 값만, returnTo는 같은 오리진 경로만.
 */
export const DEFAULT_ALLOWED_ORIGINS = ["https://inje-playground.vercel.app", "http://localhost:3003"];
export const DEFAULT_RETURN_TO = "/settings";
const RETURN_TO_MAX = 500;

const stripSlash = (s: string) => s.trim().replace(/\/+$/, "");

export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.MS_ALLOWED_ORIGINS?.trim();
  if (!raw) return [...DEFAULT_ALLOWED_ORIGINS];
  return raw.split(",").map(stripSlash).filter(Boolean);
}

/** 프록시(Vercel) 뒤에서는 x-forwarded-proto/x-forwarded-host(첫 값)가 실제 접속 오리진. 둘 중 하나라도 없으면 nextUrl.origin */
export function requestOrigin(req: { nextUrl: { origin: string }; headers: { get(name: string): string | null } }): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return proto && host ? `${proto}://${host}` : req.nextUrl.origin;
}

/** 접속 오리진이 허용 목록에 있으면 끝 슬래시를 뗀 값, 아니면 null */
export function resolveRedirectOrigin(requestOrigin: string, env: Record<string, string | undefined> = process.env): string | null {
  const origin = stripSlash(requestOrigin);
  return allowedOrigins(env).includes(origin) ? origin : null;
}

/** "/"로 시작하는 같은 오리진 경로만. "//"·"://"·백슬래시·개행·500자 초과는 기본값 */
export function sanitizeReturnTo(v: string | null | undefined): string {
  if (!v) return DEFAULT_RETURN_TO;
  if (v.length > RETURN_TO_MAX) return DEFAULT_RETURN_TO;
  if (!v.startsWith("/") || v.startsWith("//")) return DEFAULT_RETURN_TO;
  if (v.includes("://") || /[\\\r\n]/.test(v)) return DEFAULT_RETURN_TO;
  return v;
}

export function appendQuery(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
