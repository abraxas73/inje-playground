import type { SupabaseClient } from "@supabase/supabase-js";
import { isPagePermissions, type PagePermissions } from "@/lib/page-access";

/** 사용자별 페이지 권한. 조회 오류·형식 오류는 null — 호출자는 닫힌 채로 실패한다. */
export async function loadPermissions(admin: SupabaseClient, userId: string): Promise<PagePermissions | null> {
  const { data, error } = await admin.from("user_page_access").select("permissions").eq("user_id", userId).maybeSingle();
  if (error || (data && !isPagePermissions(data.permissions))) return null;
  return (data?.permissions as PagePermissions | undefined) ?? {};
}
