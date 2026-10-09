import { listSpaces } from "@/lib/confluence/client";
import { withConfluence } from "@/lib/confluence/route";
export const runtime = "nodejs";
/** GET /api/confluence/spaces — 내가 볼 수 있는 공간(페이지 만들기 대상 고르기) */
export async function GET() {
  return withConfluence(async (c) => ({ spaces: await listSpaces(c.request, c.accountId), canWrite: c.canWrite }));
}
