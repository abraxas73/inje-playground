import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isTestAccount } from "./test-account";

export interface TestAccountRow {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  disabled: boolean;
}

/** 비활성화 = 아주 긴 ban(약 100년). 재활성화는 "none" */
export const DISABLE_BAN = "876000h";

export function toTestAccountRow(u: User): TestAccountRow {
  const banned = (u as User & { banned_until?: string | null }).banned_until;
  return {
    id: u.id,
    email: u.email ?? null,
    name: (u.user_metadata?.full_name as string | undefined) ?? null,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    disabled: !!banned && Date.parse(banned) > Date.now(),
  };
}

/** auth.users 전체에서 test_account만(service role). 사용자 수가 수백 명이라 1000건 페이지로 끝까지 돈다 */
export async function listTestAccounts(admin: SupabaseClient): Promise<TestAccountRow[]> {
  const out: TestAccountRow[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    out.push(...data.users.filter(isTestAccount).map(toTestAccountRow));
    if (data.users.length < 1000) return out;
  }
}
