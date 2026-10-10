/** 관리자 덱 목록의 소유자 표시 — 이메일 대신 "이름(팀)". 명부(company_directory)에 없으면 프로필 이름, 그것도 없으면 이메일 앞부분. */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OwnerInfo { email: string; name?: string | null; team?: string | null; displayName?: string | null }
export function ownerLabel(o: OwnerInfo): string {
  const name = o.name?.trim() || o.displayName?.trim();
  if (!name) return o.email.split("@")[0] || o.email;
  const team = o.team?.trim();
  return team ? `${name}(${team})` : name;
}

/** 덱 소유자(이메일·user_id) → 표시명. 조회는 두 번(명부·프로필), 실패는 이메일로 둔다. */
export async function ownerLabels(admin: SupabaseClient, owners: Array<{ email: string; userId: string | null }>): Promise<Map<string, string>> {
  const emails = [...new Set(owners.map((o) => o.email.toLowerCase()).filter(Boolean))];
  const ids = [...new Set(owners.map((o) => o.userId).filter((x): x is string => !!x))];
  const [dir, prof] = await Promise.all([
    emails.length ? admin.from("company_directory").select("email, name, team").in("email", emails) : Promise.resolve({ data: [], error: null }),
    ids.length ? admin.from("user_profiles").select("user_id, email, display_name").in("user_id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  const byEmail = new Map<string, { name: string; team: string | null }>();
  for (const r of (dir.data ?? []) as Array<{ email: string; name: string; team: string | null }>) byEmail.set(r.email.toLowerCase(), { name: r.name, team: r.team });
  const byId = new Map<string, string | null>();
  for (const r of (prof.data ?? []) as Array<{ user_id: string; display_name: string | null }>) byId.set(r.user_id, r.display_name);
  const out = new Map<string, string>();
  for (const o of owners) {
    const d = byEmail.get(o.email.toLowerCase());
    out.set(o.email, ownerLabel({ email: o.email, name: d?.name, team: d?.team, displayName: o.userId ? byId.get(o.userId) : null }));
  }
  return out;
}
