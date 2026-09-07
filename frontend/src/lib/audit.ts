/**
 * 감사 기록(Audit). 로그인 이력은 `login_history`, 그 밖의 행위는 `action_history`에 남기고
 * 어드민 `/admin/audit`이 뷰 `audit_log`로 함께 조회한다(SQL `docs/sql/2026-09-07-audit-log.sql`).
 *
 * 원칙
 * - **감사 기록이 본래 요청을 깨뜨리지 않는다** — 모든 실패를 삼키고 콘솔에만 남긴다.
 * - 비밀은 남기지 않는다: detail에 토큰·비밀번호·쿠키를 넣지 말 것(값 대신 키 이름·건수).
 * - source: "app" = 의미 있는 액션(라우트·화면이 직접 기록), "api" = proxy가 자동으로 남긴 변경 요청.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** 액션 분류. 화면 필터의 선택지가 되므로 새 값을 넣을 땐 라벨도 함께 추가한다. */
export const AUDIT_CATEGORIES = ["auth", "admin", "users", "settings", "guide", "rfp", "usage", "ladder", "team", "food", "survey", "api"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number] | string;

export const AUDIT_KIND_LABEL: Record<string, string> = {
  login: "로그인",
  action: "액션",
  api: "API 호출",
};

export const AUDIT_CATEGORY_LABEL: Record<string, string> = {
  auth: "인증",
  admin: "어드민",
  users: "사용자",
  settings: "설정",
  guide: "가이드",
  rfp: "RFP 분석",
  usage: "사용량",
  ladder: "사다리",
  team: "팀 나누기",
  food: "뭐 먹지",
  survey: "설문",
  api: "API",
};

export interface AuditActor {
  userId: string | null;
  userEmail: string | null;
}

export interface AuditEntry extends Partial<AuditActor> {
  /** 사람이 읽는 행위 이름: "설정 변경", "사용자 삭제" */
  action: string;
  category: AuditCategory;
  /** 무엇에 대한 행위인지(식별자·건수 등). 비밀 값은 넣지 않는다 */
  detail?: Record<string, unknown>;
  /** proxy 자동 기록만 "api" */
  source?: "app" | "api";
}

/** 요청 헤더에서 IP·User-Agent를 뽑는다(프록시 뒤라 x-forwarded-for 첫 값). */
export function requestContext(request: { headers: Headers } | null | undefined): { ip: string | null; userAgent: string | null } {
  if (!request) return { ip: null, userAgent: null };
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent"),
  };
}

/** detail이 너무 커지면 저장·조회가 무거워진다 — 값은 문자열 500자, 전체 4000자로 자른다. */
function trimDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined) continue;
    out[k] = typeof v === "string" && v.length > 500 ? `${v.slice(0, 500)}…` : v;
  }
  const json = JSON.stringify(out);
  return json.length > 4000 ? { truncated: true, preview: json.slice(0, 3900) } : out;
}

/**
 * 액션 한 건 기록. 실패해도 예외를 던지지 않는다.
 * client는 라우트가 이미 갖고 있는 supabase 클라이언트(사용자 세션 또는 service role) 아무거나.
 */
export async function logAudit(
  client: SupabaseClient,
  request: { headers: Headers } | null,
  entry: AuditEntry,
): Promise<void> {
  try {
    const { ip, userAgent } = requestContext(request);
    const { error } = await client.from("action_history").insert({
      user_id: entry.userId ?? null,
      user_email: entry.userEmail ?? null,
      action: entry.action,
      category: entry.category,
      detail: trimDetail(entry.detail),
      ip_address: ip,
      user_agent: userAgent,
      source: entry.source ?? "app",
    });
    if (error) console.error("[audit] insert failed", entry.action, error.message);
  } catch (e) {
    console.error("[audit] insert threw", entry.action, e instanceof Error ? e.message : e);
  }
}

/** 로그인 이력 한 건 + user_profiles.last_login_at 갱신. 실패해도 로그인 흐름을 막지 않는다. */
export async function logLogin(
  client: SupabaseClient,
  request: { headers: Headers } | null,
  actor: { userId: string; userEmail?: string | null },
): Promise<void> {
  const { ip, userAgent } = requestContext(request);
  try {
    const [history, profile] = await Promise.all([
      client.from("login_history").insert({ user_id: actor.userId, ip_address: ip, user_agent: userAgent }),
      client.from("user_profiles").update({ last_login_at: new Date().toISOString() }).eq("user_id", actor.userId),
    ]);
    if (history.error) console.error("[audit] login_history insert failed", history.error.message);
    if (profile.error) console.error("[audit] last_login_at update failed", profile.error.message);
  } catch (e) {
    console.error("[audit] login insert threw", e instanceof Error ? e.message : e);
  }
}
