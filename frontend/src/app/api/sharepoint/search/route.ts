import { NextRequest } from "next/server";
import { searchDocs } from "@/lib/sharepoint/client";
import { SharepointError } from "@/lib/sharepoint/core";
import { withSharepoint } from "@/lib/sharepoint/route";
export const runtime = "nodejs";
/** GET /api/sharepoint/search?q=&limit= — 회사 SharePoint·OneDrive 문서를 이름·본문으로(본인이 볼 수 있는 것만) */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  return withSharepoint(async (token) => {
    const q = (p.get("q") ?? "").trim();
    if (!q || q.length > 200) throw new SharepointError("검색어는 1~200자로 입력하세요.", 400);
    return { items: await searchDocs(token, q, Number(p.get("limit")) || 10) };
  });
}
