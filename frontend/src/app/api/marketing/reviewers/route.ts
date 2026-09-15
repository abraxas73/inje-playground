import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, MarketingError, response } from "@/lib/marketing/server";
export async function GET(req: NextRequest) {
  try {
    const { db, reviewerManager } = await marketingAuth();
    const page = Math.max(1, Math.min(100000, Math.trunc(Number(req.nextUrl.searchParams.get("page"))) || 1));
    const q = req.nextUrl.searchParams.get("q");
    if (q !== null && !reviewerManager) throw new MarketingError("검수 관리자만 사용자를 검색할 수 있습니다.", 403);
    const result = q !== null ? await db.rpc("marketing_reviewer_candidates", { p_q: q, p_page: page }) : await db.rpc("marketing_reviewer_directory", { p_page: page }); dbCheck(result.error);
    return response(result.data);
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const { db, reviewerManager } = await marketingAuth();
    if (!reviewerManager) throw new MarketingError("검수 관리자만 검수자를 지정·해제할 수 있습니다.", 403);
    const b = await req.json();
    if (typeof b.userId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.userId) || typeof b.enabled !== "boolean" || typeof b.version !== "string" || !/^[0-9a-f]{32}$/i.test(b.version)) throw new MarketingError("검수자 목록을 새로고침한 뒤 대상과 지정 여부를 확인해 주세요.");
    const result = await db.rpc("marketing_update_reviewer", { p_user: b.userId, p_enabled: b.enabled, p_version: b.version }); dbCheck(result.error);
    return response(result.data);
  } catch (e) { return failure(e); }
}
