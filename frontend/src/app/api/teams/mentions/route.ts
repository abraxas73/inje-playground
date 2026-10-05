import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { graphErrorResponse } from "@/lib/teams/chat-route";
import { collectMentions } from "@/lib/teams/mentions-collect";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/teams/mentions?days=2 — 홈 브리핑용 "Teams 답장 대기"(수집은 lib/teams/mentions-collect.ts). 본문은 전달만. */
export async function GET(request: NextRequest) {
  const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? "2");
  const days = Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 7 ? daysRaw : 2;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    const r = await collectMentions(auth.admin, auth.userId, days);
    if ("response" in r) return r.response;
    return NextResponse.json({ connected: r.connected, items: r.items }, { headers: NO_STORE });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
