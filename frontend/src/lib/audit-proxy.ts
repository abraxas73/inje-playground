/**
 * proxy(구 middleware)에서 변경 요청을 자동으로 감사 기록한다 — 라우트마다 손으로 넣지 않아도
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

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 앞부분이 일치하면 자동 기록에서 뺀다 */
const SKIP_PREFIXES = [
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
  return !SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

/** 자동 기록의 카테고리 — 화면 필터에서 어드민/RFP/가이드 등으로 나눠 보기 위해 경로에서 뽑는다 */
export function auditCategoryFor(pathname: string): string {
  const seg = pathname.replace(/^\/api\//, "").split("/");
  if (seg[0] === "admin") return seg[1]?.startsWith("rfp") ? "rfp" : seg[1] === "surveys" ? "survey" : "admin";
  if (seg[0] === "rfp") return "rfp";
  if (seg[0] === "guide") return "guide";
  if (seg[0] === "users" || seg[0] === "members") return "users";
  if (seg[0] === "settings") return "settings";
  if (seg[0] === "auth" || seg[0] === "ms") return "auth";
  if (["ladder-sessions", "team-sessions", "team-attendance", "team-comments", "team-notify", "food", "ladder", "team"].includes(seg[0])) {
    return seg[0].startsWith("ladder") ? "ladder" : seg[0] === "food" ? "food" : "team";
  }
  return "api";
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
