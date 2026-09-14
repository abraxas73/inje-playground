import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, MarketingError, response } from "@/lib/marketing/server";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, context: Context) {
  try {
    const { db } = await marketingAuth(); const { id } = await context.params; const p = req.nextUrl.searchParams;
    const result = await db.rpc("marketing_validation_report", { p_id: id, p_page: Math.max(1,Number(p.get("page"))||1), p_rule: Number(p.get("rule"))||0, p_outcome: p.get("outcome")??"", p_q: (p.get("q")??"").slice(0,100), p_followup: p.get("followup")??"", p_limit: 25, p_severity: p.get("severity")??"" });
    dbCheck(result.error); if (!result.data?.run) throw new MarketingError("검증 실행을 찾을 수 없습니다.",404); return response(result.data);
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest, context: Context) {
  try {
    const { db } = await marketingAuth(true); const { id } = await context.params; const b = await req.json();
    if (!["cancel","retry"].includes(b.action)) throw new Error("지원하지 않는 검증 작업입니다.");
    const result = await db.rpc("marketing_validation_action", { p_id:id,p_action:b.action }); dbCheck(result.error); return response(result.data);
  } catch (e) { return failure(e); }
}
