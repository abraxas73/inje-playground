/**
 * proxy(구 middleware)에서 조회·변경 요청을 자동으로 감사 기록한다 — 라우트마다 손으로 넣지 않아도
 * "누가 언제 무엇을 바꿨는지"가 남는다(source "api"). 의미 있는 행위 이름은 라우트가 따로 `logAudit`으로 남긴다.
 *
 * 기록하지 않는 것
 * - 수집·프록시 엔드포인트(OTel 수신, PAYCO·Dooray 프록시, cron): 하루 수천 건이라 로그가 묻힌다.
 * - 이미 자기 자신을 기록하는 곳(`/api/action-history`, `/api/auth/events`, `/api/users/login-history`).
 * - **익명 설문 응답(`/api/surveys/…`)**: 설문은 익명 보장이라 IP·시각을 남기면 응답자를 좁힐 수 있다.
 * - 로그인하지 않은 요청: 남길 행위자가 없고 라우트가 어차피 401로 막는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "./audit";
import { matchesPath } from "./page-access";

const AUDITED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** 앞부분이 일치하면 자동 기록에서 뺀다 */
const SKIP_PREFIXES = [
  "/api/admin/audit",
  "/api/page-views",
  "/api/rfp/shared/",
  "/api/ppt/shared/",
  "/api/otel/",
  "/api/cron/",
  "/api/action-history",
  "/api/auth/events",
  "/api/users/login-history",
  "/api/food/payco",
  "/api/dooray/members",
  "/api/surveys/",
];

export function shouldAuditRequest(method: string, pathname: string): boolean {
  if (!AUDITED_METHODS.has(method.toUpperCase())) return false;
  if (!pathname.startsWith("/api/")) return false;
  if (matchesPath(pathname, "/api/mcp")) return false; // MCP 끝점은 라우트가 도구 이름·소요만 직접 감사한다
  return !SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

/** API 경로 첫 마디 → 기능 카테고리(기능별 사용 통계용). 표에 없으면 "api" */
const CATEGORY_BY_SEGMENT: Record<string, string> = {
  rfp: "rfp", users: "users", members: "users", settings: "settings", auth: "auth", ms: "auth",
  "ladder-sessions": "ladder", ladder: "ladder", food: "food", team: "team", "team-sessions": "team", "team-attendance": "team", "team-comments": "team", "team-notify": "team",
  chat: "assistant", assistant: "assistant", gw: "gw", ppt: "ppt", proposal: "proposal", teams: "teams", sharepoint: "sharepoint", confluence: "confluence", jira: "jira",
  marketing: "marketing", "people-news": "personnel", "media-directory": "personnel", dooray: "dooray", usage: "usage", mobile: "mobile", desktop: "desktop", surveys: "survey", mcp: "mcp",
};

/** 자동 기록의 카테고리 — 화면 필터·기능별 사용 통계에서 기능 단위로 나눠 보기 위해 경로에서 뽑는다 */
export function auditCategoryFor(pathname: string): string {
  const seg = pathname.replace(/^\/api\//, "").split("/");
  if (seg[0] === "admin") return seg[1]?.startsWith("rfp") ? "rfp" : seg[1] === "surveys" ? "survey" : seg[1]?.startsWith("claude-") ? "usage" : "admin";
  return Object.hasOwn(CATEGORY_BY_SEGMENT, seg[0]) ? CATEGORY_BY_SEGMENT[seg[0]] : "api";
}

/** 자동 기록 한 건. 실패는 삼킨다(logAudit 안에서 처리). */
export async function auditProxyRequest(
  client: SupabaseClient,
  request: { method: string; headers: Headers; nextUrl: { pathname: string } },
  actor: { id: string; email?: string | null },
): Promise<void> {
  const pathname = request.nextUrl.pathname;
  if (!shouldAuditRequest(request.method, pathname)) return;
  await logAudit(client, request, {
    userId: actor.id,
    userEmail: actor.email ?? null,
    action: `${request.method.toUpperCase()} ${pathname}`,
    category: auditCategoryFor(pathname),
    detail: { method: request.method.toUpperCase(), path: pathname },
    source: "api",
  });
}
