import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, MarketingError, response } from "@/lib/marketing/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await marketingAuth(); const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new MarketingError("올바른 Contact ID가 필요합니다.");
    const page = Math.max(1, Math.min(100000, Math.trunc(Number(req.nextUrl.searchParams.get("page"))) || 1));
    const r = await db.rpc("marketing_email_contact_history", { p_contact: id, p_page: page }); dbCheck(r.error);
    if (!r.data) throw new MarketingError("Master 레코드를 찾을 수 없습니다.", 404);
    return response(r.data);
  } catch (e) { return failure(e); }
}
