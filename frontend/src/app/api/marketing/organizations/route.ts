import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
export async function GET(req: NextRequest) {
  try {
    const { db } = await marketingAuth(); const params = req.nextUrl.searchParams;
    const id = params.get("id");
    if (id && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error("회사·기관 ID가 올바르지 않습니다.");
    const result = await db.rpc("marketing_find_organizations", { p_q: params.get("q") ?? "", p_page: Math.max(1, Math.min(100000, Math.trunc(Number(params.get("page"))) || 1)), p_id: id || null }); dbCheck(result.error);
    return response(result.data);
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(true); const b = await req.json();
    if (!Array.isArray(b.aliases) || b.aliases.some((a: unknown) => typeof a !== "string" || a.length > 2000)) throw new Error("별칭 형식이 올바르지 않습니다.");
    if (b.action === "create") {
      if (typeof b.id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.id) || (b.separate !== undefined && typeof b.separate !== "boolean")) throw new Error("회사·기관 등록 요청이 올바르지 않습니다.");
      const result = await db.rpc("marketing_create_organization", { p_id: b.id, p_name: b.name, p_category: b.category, p_aliases: b.aliases, p_reason: b.reason, p_review_status: b.reviewStatus ?? "pending", p_separate: b.separate ?? false }); dbCheck(result.error);
      return response({ organization: result.data });
    }
    const result = await db.rpc("marketing_update_organization", { p_id: b.id, p_version: b.version, p_name: b.name, p_category: b.category, p_aliases: b.aliases, p_reason: b.reason, p_review_status: b.reviewStatus ?? "pending" }); dbCheck(result.error);
    return response({ ok: true });
  } catch (e) { return failure(e); }
}
