/**
 * GitLab 커미터 이메일 → 회사 이메일 정규화.
 * 커밋 author_email은 git config대로 들어오므로 개인 이메일·오타 도메인·구 회사 도메인이 섞여
 * 팀/개인 필터(조직도 이메일 기준)에서 누락된다(2026-09-03 기준 전체 커밋의 29%).
 * 규칙: 수동 매핑(gitlab_email_map) → 조직도에 있는 그대로 → 로컬파트@회사도메인이 조직도에 있으면 그것.
 * 로컬파트 일치는 오탐을 줄이기 위해 관계 도메인이거나 로컬파트가 5자 이상일 때만 적용한다.
 */

export const COMPANY_DOMAIN = "innogrid.com";

/** 관측된 회사 도메인 오타·구 회사(인재아이엔씨)·모회사 도메인 — 로컬파트 일치를 바로 신뢰 */
export const AFFILIATED_DOMAINS: ReadonlySet<string> = new Set([
  "innogird.com", "inngorid.com", "inngrid.com", "innogrd.com", "innnogrid.com", "innogrid.co.kr",
  "injeinc.co.kr", "nhn.com", "nhnenter.com",
]);

export interface EmailResolver {
  /** 조직도 이메일(소문자) */
  known: ReadonlySet<string>;
  /** raw(소문자) → 회사 이메일 수동 매핑 */
  manual: ReadonlyMap<string, string>;
}

export function resolveCommitterEmail(raw: string, r: EmailResolver): string {
  const s = raw.trim().toLowerCase();
  const manual = r.manual.get(s);
  if (manual) return manual.toLowerCase();
  if (r.known.has(s)) return s;
  const at = s.indexOf("@");
  if (at <= 0) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (domain === COMPANY_DOMAIN) return s;
  const candidate = `${local}@${COMPANY_DOMAIN}`;
  if (r.known.has(candidate) && (AFFILIATED_DOMAINS.has(domain) || local.length >= 5)) return candidate;
  return s;
}

type GitlabRow = { day: string; user_email: string; project_path: string } & Record<string, unknown>;

/** user_email을 정규화하고 같은 (day, email, project)로 모인 행의 숫자 컬럼을 합친다 */
export function resolveAndMergeGitlabRows<T extends GitlabRow>(rows: T[], resolve: (email: string) => string): T[] {
  const out = new Map<string, T>();
  for (const row of rows) {
    const email = resolve(String(row.user_email));
    const k = `${row.day}|${email}|${row.project_path}`;
    const cur = out.get(k);
    if (!cur) {
      out.set(k, { ...row, user_email: email });
      continue;
    }
    for (const [col, v] of Object.entries(row)) {
      if (typeof v === "number" && typeof cur[col] === "number") (cur as Record<string, unknown>)[col] = (cur[col] as number) + v;
    }
  }
  return [...out.values()];
}

/** 조직도 이메일 + 수동 매핑(gitlab_email_map, 테이블이 없으면 빈 매핑)을 읽어 리졸버를 만든다 */
export async function loadEmailResolver(admin: import("@supabase/supabase-js").SupabaseClient): Promise<EmailResolver> {
  const known = new Set<string>();
  for (let lo = 0; ; lo += 1000) {
    const { data, error } = await admin.from("company_directory").select("email").order("email").range(lo, lo + 999);
    if (error) throw new Error(`company_directory 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as { email: string }[]) known.add(r.email.toLowerCase());
    if ((data?.length ?? 0) < 1000) break;
  }
  const manual = new Map<string, string>();
  const m = await admin.from("gitlab_email_map").select("raw_email, email").range(0, 4999);
  if (m.error && !/does not exist|schema cache/i.test(m.error.message)) throw new Error(`gitlab_email_map 조회 실패: ${m.error.message}`);
  for (const r of (m.data ?? []) as { raw_email: string; email: string }[]) manual.set(r.raw_email.toLowerCase(), r.email.toLowerCase());
  return { known, manual };
}
