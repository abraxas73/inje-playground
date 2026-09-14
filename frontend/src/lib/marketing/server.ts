import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Contact, Organization } from "./types";

export async function marketingAuth(review = false, admin = false) {
  const db = await createServerSupabase();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new MarketingError("로그인이 필요합니다.", 401);
  const access = await db.rpc("has_page_access", { p_page: "marketing" });
  if (access.error) throw new MarketingError("마케팅 DB 설정을 확인해 주세요. DB 마이그레이션 적용이 필요할 수 있습니다.", 503);
  if (!access.data) throw new MarketingError("마케팅 DB 접근 권한이 없습니다.", 403);
  const [{ data: profile, error }, reviewer] = await Promise.all([
    db.from("user_profiles").select("role,display_name,email").eq("user_id", user.id).single(), db.rpc("marketing_can_review"),
  ]);
  if (error || reviewer.error) throw new MarketingError("마케팅 DB 설정 또는 권한을 확인하지 못했습니다.", 503);
  if ((review && !reviewer.data) || (admin && profile.role !== "admin")) throw new MarketingError("담당자 권한이 필요합니다.", 403);
  return { db, user, reviewer: !!reviewer.data, admin: profile.role === "admin" };
}
export class MarketingError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function dbCheck(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (["42P01", "PGRST202", "PGRST205"].includes(error.code ?? "")) throw new MarketingError("마케팅 DB 초기 설정이 필요합니다. 관리자에게 문의해 주세요.", 503);
  throw new MarketingError(error.code === "42501" ? "접근 권한이 없습니다." : error.message, ["40001", "23505"].includes(error.code ?? "") ? 409 : 400);
}
export function failure(e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : "요청 처리에 실패했습니다." }, { status: e instanceof MarketingError ? e.status : 400 }); }
export const response = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
type DB = Awaited<ReturnType<typeof createServerSupabase>>;
export async function snapshot(db: DB): Promise<{ contacts: Contact[]; organizations: Organization[] }> {
  async function all(table: string, columns: string) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await db.from(table).select(columns).order("id").range(offset, offset + 999);
      dbCheck(result.error); rows.push(...result.data ?? []);
      if ((result.data?.length ?? 0) < 1000) break;
      if (offset >= 100000) throw new MarketingError("검증 데이터가 조회 상한을 넘었습니다.");
    }
    return rows;
  }
  const [contacts, organizations] = await Promise.all([all("marketing_contacts", "*"), all("marketing_organizations", "*")]);
  const orgs = organizations as unknown as Organization[];
  const orgMap = new Map(orgs.map(o => [o.id, o]));
  return { contacts: (contacts as unknown as Contact[]).map(c => ({ ...c, organization: orgMap.get(c.organization_id ?? "") ?? null })), organizations: orgs };
}
