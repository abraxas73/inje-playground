// OAuth 동의 화면(/oauth/consent) 표시용 순수 함수.

const SCOPE_LABELS: Record<string, string> = {
  email: "이메일 주소",
  profile: "이름·프로필",
  openid: "로그인 확인",
  offline_access: "자동 갱신(다시 로그인 없이 유지)",
};

const parse = (uri: string) => {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
};

export function describeScopes(scopes: string[]): string[] {
  return scopes.map((s) => SCOPE_LABELS[s] ?? s);
}

export function loopbackWarning(redirectUri: string): string | null {
  const host = parse(redirectUri)?.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
    ? "이 PC에서 실행 중인 프로그램(Claude Code)이 연결을 요청했습니다. 직접 연결을 시작한 경우에만 허용하세요."
    : null;
}

export function redirectHost(redirectUri: string): string {
  return parse(redirectUri)?.host ?? redirectUri;
}

/** 허용하면 이 클라이언트가 할 수 있는 일 — 동의 화면에 항상 표시. */
export const ACCESS_SUMMARY =
  "허용하면 이 클라이언트는 내 계정으로 INNOGRID 데스크탑 앱을 통해 아마란스 메일·결재·일정·회의실·게시판 작업을 읽고 쓸 수 있습니다(쓰기는 Claude가 실행 전에 확인합니다).";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ALLOWED_DOMAINS = ["claude.ai", "claude.com"];

/** 동적 등록(DCR)으로 아무 주소나 등록될 수 있으므로, 돌아갈 주소가 Claude 또는 이 PC(루프백)일 때만 [허용]을 연다. */
export function redirectAllowed(redirectUri: string): boolean {
  const u = parse(redirectUri);
  if (!u) return false;
  if (LOOPBACK.has(u.hostname)) return u.protocol === "http:" || u.protocol === "https:";
  if (u.protocol !== "https:") return false;
  return ALLOWED_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
}
