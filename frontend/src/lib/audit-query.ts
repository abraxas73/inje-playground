/**
 * 어드민 Audit 로그 조회 조건 해석. 순수 함수라 라우트와 테스트가 같은 규칙을 쓴다.
 * 뷰 `audit_log`(로그인 이력 + 액션 이력)를 대상으로 kind·카테고리·기간·검색어·페이징을 만든다.
 */
export const AUDIT_KINDS = ["all", "login", "action", "api"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_PAGE_SIZE_DEFAULT = 50;
export const AUDIT_PAGE_SIZE_MAX = 200;

export interface AuditQuery {
  kind: AuditKind;
  category: string | null;
  /** 검색어(정리된 값). action·이메일·이름·IP·detail을 훑는다 */
  q: string | null;
  /** KST 날짜(YYYY-MM-DD) */
  from: string | null;
  to: string | null;
  page: number;
  pageSize: number;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 검색어를 PostgREST `or=(…)`에 안전하게 넣을 수 있게 다듬는다.
 * 쉼표·괄호는 or 구문 구분자, %·_는 ilike 와일드카드라 모두 없애 "적은 대로 찾기"로 만든다.
 */
export function sanitizeSearch(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,()%_*\\"']/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 100) : null;
}

function ymd(v: string | null): string | null {
  return v && YMD_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}

export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  const kindRaw = params.get("kind");
  const kind = (AUDIT_KINDS as readonly string[]).includes(kindRaw ?? "") ? (kindRaw as AuditKind) : "all";
  const pageRaw = Number(params.get("page") ?? 1);
  const sizeRaw = Number(params.get("pageSize") ?? AUDIT_PAGE_SIZE_DEFAULT);
  const category = (params.get("category") ?? "").trim();
  return {
    kind,
    category: category && category !== "all" ? category.slice(0, 40) : null,
    q: sanitizeSearch(params.get("q")),
    from: ymd(params.get("from")),
    to: ymd(params.get("to")),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    pageSize: Number.isFinite(sizeRaw) ? Math.min(Math.max(Math.floor(sizeRaw), 1), AUDIT_PAGE_SIZE_MAX) : AUDIT_PAGE_SIZE_DEFAULT,
  };
}

/** KST 하루 경계를 timestamptz 범위로. from은 00:00, to는 그날 끝까지 포함한다. */
export function kstRange(from: string | null, to: string | null): { gte: string | null; lte: string | null } {
  return {
    gte: from ? `${from}T00:00:00+09:00` : null,
    lte: to ? `${to}T23:59:59.999+09:00` : null,
  };
}

/** PostgREST or 필터 문자열(검색어가 없으면 null) */
export function searchOrFilter(q: string | null): string | null {
  if (!q) return null;
  const like = `*${q}*`;
  return ["action", "user_email", "user_name", "ip_address", "detail_text"].map((c) => `${c}.ilike.${like}`).join(",");
}

/** 0-based range(끝 포함) */
export function pageRange(page: number, pageSize: number): { start: number; end: number } {
  const start = (page - 1) * pageSize;
  return { start, end: start + pageSize - 1 };
}
