import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 계정 미식별(SDK) 세션 귀속 — OTel `user.id`만 있는 실행은 `id:<hash>`로 저장된다.
 * 관리자가 등록한 매핑(claude_code_identity_map)을 적용하면 그 행이 사람의 이메일로 합쳐진다.
 * 조직(org_id)은 바꾸지 않아 배지에는 "조직 미확인"이 남는다 — 실제로 어느 조직 시트로 결제됐는지 알 수 없기 때문.
 */
export const ACCOUNTLESS_PREFIX = "id:";

export function isAccountless(userEmail: string): boolean {
  return userEmail === "unknown" || userEmail.startsWith(ACCOUNTLESS_PREFIX);
}

/** 'id:<hash>' → 이메일. 테이블이 없으면(마이그레이션 전) 빈 맵. */
export async function loadIdentityMap(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await admin.from("claude_code_identity_map").select("user_id, email");
  if (error) {
    console.warn("[claude-usage] identity map skipped:", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((r: { user_id: string; email: string }) => [`${ACCOUNTLESS_PREFIX}${r.user_id}`, r.email.toLowerCase()]));
}

/** 매핑된 식별자의 user_email을 이메일로 바꾼다(원본 배열은 그대로 두고 새 배열 반환). */
export function applyIdentityMap<T extends { user_email: string }>(rows: T[], map: Map<string, string>): T[] {
  if (map.size === 0) return rows;
  return rows.map((r) => {
    const mapped = map.get(r.user_email);
    return mapped ? { ...r, user_email: mapped } : r;
  });
}
