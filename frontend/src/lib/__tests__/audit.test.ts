import { describe, it, expect } from "vitest";
import { AUTH_EVENT_ACTION, isAuthEvent, requestContext, toAuthProvider } from "@/lib/audit";
import { auditCategoryFor, shouldAuditRequest } from "@/lib/audit-proxy";
import { kstRange, pageRange, parseAuditQuery, sanitizeSearch, searchOrFilter, AUDIT_PAGE_SIZE_MAX } from "@/lib/audit-query";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe("requestContext", () => {
  it("x-forwarded-for 첫 값을 IP로 쓴다", () => {
    expect(requestContext(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "user-agent": "UA" }))).toEqual({ ip: "1.2.3.4", userAgent: "UA" });
  });
  it("forwarded가 없으면 x-real-ip, 둘 다 없으면 null", () => {
    expect(requestContext(req({ "x-real-ip": "9.9.9.9" })).ip).toBe("9.9.9.9");
    expect(requestContext(req({}))).toEqual({ ip: null, userAgent: null });
    expect(requestContext(null)).toEqual({ ip: null, userAgent: null });
  });
});

describe("shouldAuditRequest", () => {
  it("변경 요청만 기록한다", () => {
    expect(shouldAuditRequest("POST", "/api/settings")).toBe(true);
    expect(shouldAuditRequest("delete", "/api/rfp/mappings/abc")).toBe(true);
    expect(shouldAuditRequest("GET", "/api/settings")).toBe(false);
    expect(shouldAuditRequest("POST", "/admin/audit")).toBe(false);
  });
  it("수집·프록시·자기기록·익명 설문은 빼고 기록한다", () => {
    expect(shouldAuditRequest("POST", "/api/otel/v1/metrics")).toBe(false);
    expect(shouldAuditRequest("POST", "/api/action-history")).toBe(false);
    expect(shouldAuditRequest("POST", "/api/users/login-history")).toBe(false);
    expect(shouldAuditRequest("POST", "/api/food/payco")).toBe(false);
    expect(shouldAuditRequest("POST", "/api/surveys/claude-2026/responses")).toBe(false);
    // 어드민 설문 관리는 남긴다(응답자 익명성과 무관)
    expect(shouldAuditRequest("POST", "/api/admin/surveys")).toBe(true);
  });
});

describe("auditCategoryFor", () => {
  it("경로에서 카테고리를 뽑는다", () => {
    expect(auditCategoryFor("/api/admin/rfp-catalog/solutions/secloudit/import")).toBe("rfp");
    expect(auditCategoryFor("/api/admin/surveys/1")).toBe("survey");
    expect(auditCategoryFor("/api/admin/claude-usage/imports")).toBe("admin");
    expect(auditCategoryFor("/api/rfp/projects")).toBe("rfp");
    expect(auditCategoryFor("/api/guide/notebooks")).toBe("guide");
    expect(auditCategoryFor("/api/users/abc")).toBe("users");
    expect(auditCategoryFor("/api/settings")).toBe("settings");
    expect(auditCategoryFor("/api/ms/connection")).toBe("auth");
    expect(auditCategoryFor("/api/ladder-sessions")).toBe("ladder");
    expect(auditCategoryFor("/api/team-sessions")).toBe("team");
    expect(auditCategoryFor("/api/food/favorites")).toBe("food");
    expect(auditCategoryFor("/api/something-else")).toBe("api");
  });
});

describe("sanitizeSearch", () => {
  it("or 구문·ilike 와일드카드 문자를 없앤다", () => {
    expect(sanitizeSearch("a,b(c)%_*")).toBe("a b c");
    expect(sanitizeSearch("  kang@innogrid.com ")).toBe("kang@innogrid.com");
  });
  it("비었으면 null, 100자로 자른다", () => {
    expect(sanitizeSearch("")).toBeNull();
    expect(sanitizeSearch("   ")).toBeNull();
    expect(sanitizeSearch(null)).toBeNull();
    expect(sanitizeSearch("x".repeat(150))).toHaveLength(100);
  });
});

describe("parseAuditQuery", () => {
  it("기본값", () => {
    const q = parseAuditQuery(new URLSearchParams());
    expect(q).toEqual({ kind: "all", category: null, q: null, from: null, to: null, page: 1, pageSize: 50 });
  });
  it("값을 검증·보정한다", () => {
    const q = parseAuditQuery(new URLSearchParams({ kind: "login", category: "rfp", q: "kang", from: "2026-09-01", to: "2026-09-07", page: "3", pageSize: "500" }));
    expect(q.kind).toBe("login");
    expect(q.category).toBe("rfp");
    expect(q.pageSize).toBe(AUDIT_PAGE_SIZE_MAX);
    expect(q.page).toBe(3);
  });
  it("잘못된 kind·날짜·페이지는 무시한다", () => {
    const q = parseAuditQuery(new URLSearchParams({ kind: "hack", from: "2026-13-40", to: "어제", page: "0", category: "all" }));
    expect(q.kind).toBe("all");
    expect(q.from).toBeNull();
    expect(q.to).toBeNull();
    expect(q.page).toBe(1);
    expect(q.category).toBeNull();
  });
});

describe("kstRange", () => {
  it("KST 하루 경계로 만든다(to는 그날 끝까지 포함)", () => {
    expect(kstRange("2026-09-01", "2026-09-07")).toEqual({ gte: "2026-09-01T00:00:00+09:00", lte: "2026-09-07T23:59:59.999+09:00" });
    expect(kstRange(null, null)).toEqual({ gte: null, lte: null });
  });
});

describe("searchOrFilter · pageRange", () => {
  it("검색 대상 열 5개를 ilike로 잇는다", () => {
    expect(searchOrFilter("kang")).toBe("action.ilike.*kang*,user_email.ilike.*kang*,user_name.ilike.*kang*,ip_address.ilike.*kang*,detail_text.ilike.*kang*");
    expect(searchOrFilter(null)).toBeNull();
  });
  it("페이지는 0-based 끝 포함 범위", () => {
    expect(pageRange(1, 50)).toEqual({ start: 0, end: 49 });
    expect(pageRange(3, 20)).toEqual({ start: 40, end: 59 });
  });
});

describe("로그인 이벤트(익명)", () => {
  it("event는 화이트리스트만 통과한다", () => {
    expect(isAuthEvent("attempt")).toBe(true);
    expect(isAuthEvent("failure")).toBe(true);
    expect(isAuthEvent("blocked")).toBe(true);
    expect(isAuthEvent("success")).toBe(false);
    expect(isAuthEvent(1)).toBe(false);
    expect(isAuthEvent(null)).toBe(false);
  });
  it("provider는 목록 밖 값을 unknown으로 바꾼다(공개 엔드포인트 방어)", () => {
    expect(toAuthProvider("google")).toBe("google");
    expect(toAuthProvider("azure")).toBe("azure");
    expect(toAuthProvider("gw")).toBe("gw");
    expect(toAuthProvider("<script>")).toBe("unknown");
    expect(toAuthProvider(undefined)).toBe("unknown");
  });
  it("행위 이름은 한국어 고정 문구", () => {
    expect(AUTH_EVENT_ACTION.attempt).toBe("로그인 시도");
    expect(AUTH_EVENT_ACTION.failure).toBe("로그인 실패");
    expect(AUTH_EVENT_ACTION.blocked).toBe("로그인 차단");
  });
  it("실패·시도 kind로 조회할 수 있다", () => {
    expect(parseAuditQuery(new URLSearchParams({ kind: "login_failed" })).kind).toBe("login_failed");
    expect(parseAuditQuery(new URLSearchParams({ kind: "login_attempt" })).kind).toBe("login_attempt");
  });
});
