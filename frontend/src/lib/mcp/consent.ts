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
