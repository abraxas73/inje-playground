/**
 * 테스트 전용 이메일 로그인(애플 심사·공개 테스트용). 런북 `docs/test-accounts.md`.
 *
 * 계약(앱과 공유): 테스트 계정은 `auth.users.raw_app_meta_data.test_account = true`.
 * 로그인 세션의 `app_metadata.provider === 'email'`이면서 `test_account !== true`이면 거부한다.
 * 같은 규칙을 DB 훅 `public.hook_before_user_created`(docs/sql/2026-10-23-test-accounts.sql)가 가입 시점에 한 번 더 막는다.
 */

type AuthUserLike = { app_metadata?: Record<string, unknown> | null } | null | undefined;

export const EMAIL_LOGIN_DENIED = {
  error: "테스트 계정이 아닌 이메일 로그인은 허용되지 않습니다.",
  code: "email_login_not_allowed",
} as const;

export function isTestAccount(user: AuthUserLike): boolean {
  return user?.app_metadata?.test_account === true;
}

/** 이메일 공급자 세션은 테스트 계정만 허용. 다른 공급자(azure 등)는 이 규칙과 무관하다. */
export function emailLoginAllowed(user: AuthUserLike): boolean {
  return user?.app_metadata?.provider !== "email" || isTestAccount(user);
}

export const PASSWORD_MIN = 12;
/** bcrypt가 72바이트 이후를 버린다 — 그보다 긴 비밀번호는 받지 않는다(ASCII 기준) */
export const PASSWORD_MAX = 72;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 입력 검증. 통과하면 null, 아니면 사람이 읽는 오류 문구 */
export function validateEmail(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return "이메일을 입력하세요.";
  const s = v.trim();
  if (s.length > 254 || !EMAIL_RE.test(s)) return "이메일 형식이 올바르지 않습니다.";
  return null;
}

export function validateDisplayName(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return "이름을 입력하세요.";
  if (v.trim().length > 100) return "이름은 100자 이내로 입력하세요.";
  return null;
}

export function validatePassword(v: unknown): string | null {
  if (typeof v !== "string") return "비밀번호가 올바르지 않습니다.";
  if (v.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
  if (new TextEncoder().encode(v).length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}바이트 이내여야 합니다.`;
  return null;
}

const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const SYMBOL = "!@#$%^&*-_=+?";
const CLASSES = [LOWER, UPPER, DIGIT, SYMBOL];

/** 0..n-1 균등 난수(Web Crypto — 프록시·서버 어디서나). 치우침을 막으려 경계 밖 값은 다시 뽑는다 */
function randomInt(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

/** 암호학적 난수로 만든 강한 비밀번호 — 네 문자군을 하나 이상 포함, 헷갈리는 글자(0·O·1·l·I) 제외 */
export function generatePassword(length = 20): string {
  const all = CLASSES.join("");
  const chars = CLASSES.map((c) => c[randomInt(c.length)]);
  while (chars.length < Math.max(length, CLASSES.length)) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
