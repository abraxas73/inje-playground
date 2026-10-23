import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 사용자 한 명의 개인 데이터 → 프로필 → 로그인 계정(auth.users) 순 삭제. 관리자 사용자 삭제(`DELETE /api/users/[id]`)와
 * 테스트 계정 삭제(`DELETE /api/admin/test-accounts/[id]`)가 같은 경로를 쓴다. 권한·대상 검사는 호출하는 라우트가 한다.
 */
export async function deleteUserCompletely(admin: SupabaseClient, id: string, email: string) {
  // 개인 데이터 먼저(각 테이블은 독립적으로 시도하고 결과를 보고한다)
  const deleted: Record<string, number | string> = {};
  const del = async (table: string, col: string, val: string) => {
    const r = await admin.from(table).delete().eq(col, val).select(col);
    deleted[table] = r.error ? `error: ${r.error.message}` : (r.data?.length ?? 0);
  };
  await del("user_settings", "user_id", id);
  await del("user_members", "user_id", id);
  await del("login_history", "user_id", id);
  if (email) await del("nlm_chat_messages", "user_email", email);

  const p = await admin.from("user_profiles").delete().eq("user_id", id).select("user_id");
  if (p.error) return { ok: false as const, error: `user_profiles 삭제 실패: ${p.error.message}`, deleted };
  deleted.user_profiles = p.data?.length ?? 0;

  // 로그인 계정 제거 — 이후 같은 계정으로 다시 로그인하면 새 프로필(게스트)이 생성된다
  const a = await admin.auth.admin.deleteUser(id);
  const warning = a.error ? `프로필은 삭제됐지만 로그인 계정 삭제에 실패했습니다: ${a.error.message}` : null;
  return { ok: true as const, deleted, authDeleted: !a.error, warning };
}
