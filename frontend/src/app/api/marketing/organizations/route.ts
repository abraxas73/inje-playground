import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(true); const b = await req.json();
    if (!Array.isArray(b.aliases) || b.aliases.some((a: unknown) => typeof a !== "string" || a.length > 2000)) throw new Error("별칭 형식이 올바르지 않습니다.");
    const result = await db.rpc("marketing_update_organization", { p_id: b.id, p_version: b.version, p_name: b.name, p_category: b.category, p_aliases: b.aliases, p_reason: b.reason, p_review_status: b.reviewStatus ?? "pending" }); dbCheck(result.error);
    return response({ ok: true });
  } catch (e) { return failure(e); }
}
