import { NextRequest } from "next/server";
import { JiraError } from "@/lib/jira/config";
import { searchPages } from "@/lib/confluence/client";
import { withConfluence } from "@/lib/confluence/route";
export const runtime = "nodejs";
/** GET /api/confluence/search?q=&space=&limit= — 본인 권한으로 문서 검색 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  return withConfluence(async (c) => {
    const q = (p.get("q") ?? "").trim();
    if (!q || q.length > 200) throw new JiraError("검색어는 1~200자로 입력하세요.", 400);
    return { items: await searchPages(c.request, q, { spaceKey: p.get("space") || undefined, limit: Number(p.get("limit")) || 10 }) };
  });
}
